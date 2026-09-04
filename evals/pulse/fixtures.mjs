// Shared fixture world for Pulse's offline suites (WS-R17's `evals/pulse/run.mjs`
// and the one check it adds to `evals/room-leak/run.mjs`).
//
// Extracted rather than duplicated, `evals/room/fixtures.mjs`'s own precedent
// and reason: two suites each hand-rolling a fake `db` for the same three
// tables is exactly the drift `dead-writers`'s sibling risk warns about.
//
// `pulseDb` WRAPS `evals/room/fixtures.mjs`'s own `fakeDb` rather than
// reimplementing room/thread/follower behaviour: every statement
// `api/_pulse.js` issues against `vy_room`, `vy_room_thread` or
// `vy_room_follower` goes through `resolveRoom`/`followerRow`/`listThreads`
// (all EXPORTED from `api/_room-surface.js`, `api/_pulse.js`'s own header),
// so the base fake already answers those correctly and this file only adds
// the three tables migration 080 introduces. Reads the SQL text for the
// clauses actually present, `evals/room/fixtures.mjs`'s own technique, so a
// negative control that strikes a clause out of the real SQL is honoured by
// this fake too.
import { OWNER, REPLICA_ID, ROOM_ID } from "../room/fixtures.mjs";

const NIL_UUID = "00000000-0000-0000-0000-000000000000";

export function freshPulseState(base) {
  // WS-R35: `pulseWeeks`/`pulseCombos` mirror migration 097's two new
  // tables, alongside v0's three (unchanged, still present, still written).
  return { ...base, pulseOptins: [], pulseTopics: [], pulseSnapshots: [], pulseWeeks: [], pulseCombos: [] };
}

/**
 * Mirrors `api/_pulse.js`'s SQL semantics exactly (room-scoped, actively
 * opted-in persons, a person counts iff EVERY label in `labels` matches at
 * least one of their own actively-opted-in threads) — the fixture's own
 * version of the same "for all labels, some matching thread" double
 * negation the real statements use, so a negative control that strikes a
 * clause out of the real SQL is honoured here too (this file's own header).
 */
function personsMatchingLabelSet(state, roomId, labels) {
  const room = String(roomId);
  const needles = (Array.isArray(labels) ? labels : []).map((l) => String(l).toLowerCase());
  const optedIn = new Set(
    state.pulseOptins.filter((o) => o.room_id === room && o.revoked_at == null).map((o) => o.person_id),
  );
  const matched = new Set();
  for (const personId of optedIn) {
    const allMatch = needles.every((needle) =>
      state.threads.some(
        (t) =>
          t.room_id === room &&
          t.person_id === personId &&
          t.archived_at == null &&
          t.title.toLowerCase().includes(needle) &&
          state.pulseOptins.some((o2) => o2.thread_id === t.thread_id && o2.revoked_at == null),
      ),
    );
    if (allMatch) matched.add(personId);
  }
  return matched;
}

/**
 * @param base   the room fixture's own fake `db` (`fakeDb(state)`), already
 *               closed over the SAME `state` object this function extends.
 */
export function pulseDb(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ═══════════════════════════════════════════════════════════════════════
    // WS-R35 (Pulse v1, migration 097) — checked BEFORE every v0 branch
    // below, because several v1 statements share a substring with a v0 one
    // (both use `count(*)::int as follower_count`, both touch
    // `vy_room_pulse_topic`/`select max(week_start)`) and the fixture must
    // not let a v0 branch silently swallow a v1 statement with the wrong
    // param shape.
    // ═══════════════════════════════════════════════════════════════════════

    // ── setTopics' new "clear every slot" pass — the fixture does not model
    //    `slot` at all (the 12-label cap is proved by migration 097's own
    //    CHECK + unique index, not by this offline fixture), so this is a
    //    deliberate, documented no-op rather than an accidental one.
    if (has("update vy_room_pulse_topic set slot = null")) {
      return [];
    }

    // ── computeComboSnapshot's own active-label read (label only, no
    //    topic_id, ordered by lower(label)) — distinct from v0's two
    //    `topic_id, label` reads below.
    if (has("select label from vy_room_pulse_topic") && has("order by lower(label) asc")) {
      const roomId = p[0];
      return state.pulseTopics
        .filter((t) => t.room_id === roomId)
        .map((t) => ({ label: t.label }))
        .sort((a, b) => a.label.toLowerCase().localeCompare(b.label.toLowerCase()));
    }

    // ── the week header ───────────────────────────────────────────────────
    if (has("delete from vy_room_pulse_combo")) {
      const [roomId, weekStart] = p;
      state.pulseCombos = state.pulseCombos.filter((c) => !(c.room_id === roomId && c.week_start === weekStart));
      return [];
    }
    if (has("delete from vy_room_pulse_week")) {
      const [roomId, weekStart] = p;
      state.pulseWeeks = state.pulseWeeks.filter((w) => !(w.room_id === roomId && w.week_start === weekStart));
      return [];
    }
    if (has("insert into vy_room_pulse_week")) {
      const [weekId, roomId, weekStart, suppressed] = params;
      state.pulseWeeks.push({
        week_id: String(weekId),
        room_id: String(roomId),
        week_start: String(weekStart),
        suppressed: Number(suppressed) || 0,
      });
      return [];
    }
    if (has("update vy_room_pulse_week") && has("set suppressed")) {
      const [weekId, suppressed] = params;
      const row = state.pulseWeeks.find((w) => w.week_id === String(weekId));
      if (row) row.suppressed = Number(suppressed) || 0;
      return [];
    }
    if (has("select suppressed from vy_room_pulse_week")) {
      const [roomId, weekStart] = p;
      const row = state.pulseWeeks.find((w) => w.room_id === roomId && w.week_start === weekStart);
      return row ? [{ suppressed: row.suppressed }] : [];
    }
    if (has("select max(week_start)") && has("from vy_room_pulse_week")) {
      const roomId = p[0];
      const weeks = state.pulseWeeks.filter((w) => w.room_id === roomId).map((w) => w.week_start);
      return [{ week_start: weeks.length ? weeks.sort().at(-1) : null }];
    }

    // ── the combo bucket: the k-anonymous PUBLISH — mirrors `publishCombo`'s
    //    own `having` exactly: own population >=5, and no OTHER active label
    //    (not already in this set) widens the population into 1-4. ─────────
    if (has("insert into vy_room_pulse_combo") && has("min(($1)::uuid)")) {
      const [comboId, weekId, roomId, weekStart, labels] = params;
      const room = String(roomId);
      const clean = Array.isArray(labels) ? labels : [];
      const matched = personsMatchingLabelSet(state, room, clean);
      if (matched.size < 5) return []; // law 6: own floor
      const already = new Set(clean.map((l) => String(l).toLowerCase()));
      const activeLabels = state.pulseTopics.filter((t) => t.room_id === room).map((t) => t.label);
      for (const other of activeLabels) {
        if (already.has(String(other).toLowerCase())) continue;
        const widened = personsMatchingLabelSet(state, room, [...clean, other]);
        if (widened.size >= 1 && widened.size <= 4) return []; // law 7: pairwise refusal
      }
      const row = {
        combo_id: String(comboId),
        week_id: String(weekId),
        room_id: room,
        week_start: String(weekStart),
        labels: clean.slice(),
        follower_count: matched.size,
      };
      state.pulseCombos.push(row);
      return [{ labels: row.labels, follower_count: row.follower_count }];
    }

    // ── the RAW, unguarded combo count — `comboFollowerCount`'s own negative-
    //    control read. `unnest(` distinguishes it from v0's `topicFollowerCount`
    //    below, which never uses it. ────────────────────────────────────────
    if (has("count(*)::int as follower_count") && has("unnest(")) {
      const [roomId, labels] = params;
      const matched = personsMatchingLabelSet(state, roomId, Array.isArray(labels) ? labels : []);
      return [{ follower_count: matched.size }];
    }

    // ── the creator's own read of a published combo week ────────────────────
    if (has("select labels, follower_count from vy_room_pulse_combo")) {
      const [roomId, weekStart] = p;
      return state.pulseCombos
        .filter((c) => c.room_id === roomId && c.week_start === weekStart)
        .map((c) => ({ labels: c.labels, follower_count: c.follower_count }))
        .sort((a, b) => b.follower_count - a.follower_count);
    }

    // ── owner-scoped room handle (readPulse / setTopics) ────────────────────
    if (has("from vy_room") && has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const room = state.rooms.find(
        (r) => r.owner_user_id.toLowerCase() === p[0] && r.replica_id.toLowerCase() === p[1],
      );
      return room ? [{ room_id: room.room_id, created_at: room.created_at ?? new Date().toISOString(), published_at: room.published_at }] : [];
    }

    // ── the sweep's room list ────────────────────────────────────────────────
    if (has("select room_id from vy_room where published_at is not null")) {
      return state.rooms.filter((r) => r.published_at != null && r.paused_at == null).map((r) => ({ room_id: r.room_id }));
    }

    // ── the follower's own toggle ────────────────────────────────────────────
    if (has("select optin_id from vy_room_pulse_optin")) {
      const [roomId, personId, threadId] = p;
      const row = state.pulseOptins.find(
        (o) => o.room_id === roomId && o.person_id === personId && (o.thread_id ?? NIL_UUID) === (threadId ?? NIL_UUID),
      );
      return row ? [{ optin_id: row.optin_id }] : [];
    }
    if (has("update vy_room_pulse_optin") && has("where optin_id = ($1)::uuid")) {
      const [optinId, policyVersion] = params;
      const row = state.pulseOptins.find((o) => o.optin_id === String(optinId));
      if (!row) return [];
      row.revoked_at = null;
      row.policy_version = policyVersion;
      row.granted_at = new Date().toISOString();
      return [{ ...row }];
    }
    if (has("insert into vy_room_pulse_optin")) {
      const [optinId, roomId, personId, threadId, policyVersion] = params;
      const row = {
        optin_id: String(optinId),
        room_id: String(roomId),
        person_id: String(personId),
        thread_id: threadId == null ? null : String(threadId),
        policy_version: policyVersion,
        granted_at: new Date().toISOString(),
        revoked_at: null,
      };
      state.pulseOptins.push(row);
      return [{ ...row }];
    }
    if (has("update vy_room_pulse_optin") && has("revoked_at = now()")) {
      const [roomId, personId, threadId] = p;
      const row = state.pulseOptins.find(
        (o) =>
          o.room_id === roomId &&
          o.person_id === personId &&
          (o.thread_id ?? NIL_UUID) === (threadId ?? NIL_UUID) &&
          o.revoked_at == null,
      );
      if (!row) return [];
      row.revoked_at = new Date().toISOString();
      return [{ ...row }];
    }

    // ── the creator's topic list ─────────────────────────────────────────────
    if (has("select topic_id, label from vy_room_pulse_topic") && has("order by created_at asc")) {
      const roomId = p[0];
      return state.pulseTopics
        .filter((t) => t.room_id === roomId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((t) => ({ topic_id: t.topic_id, label: t.label }));
    }
    if (has("select topic_id, label from vy_room_pulse_topic")) {
      const roomId = p[0];
      return state.pulseTopics.filter((t) => t.room_id === roomId).map((t) => ({ topic_id: t.topic_id, label: t.label }));
    }
    if (has("delete from vy_room_pulse_topic")) {
      const topicId = p[0];
      const before = state.pulseTopics.length;
      state.pulseTopics = state.pulseTopics.filter((t) => t.topic_id !== topicId);
      return before === state.pulseTopics.length ? [] : [{ gone: 1 }];
    }
    if (has("update vy_room_pulse_topic")) {
      const [topicId, label] = params;
      const row = state.pulseTopics.find((t) => t.topic_id === String(topicId));
      if (!row) return [];
      row.label = label;
      return [{ topic_id: row.topic_id, label: row.label }];
    }
    if (has("insert into vy_room_pulse_topic")) {
      const [topicId, roomId, ownerUserId, label] = params;
      const row = {
        topic_id: String(topicId),
        room_id: String(roomId),
        owner_user_id: String(ownerUserId).toLowerCase(),
        label,
        created_at: new Date(Date.now() + state.pulseTopics.length).toISOString(),
      };
      state.pulseTopics.push(row);
      return [{ topic_id: row.topic_id, label: row.label }];
    }

    // ── the room-total opt-in floor ──────────────────────────────────────────
    if (has("count(distinct o.person_id)::int as total_optin")) {
      const roomId = p[0];
      const distinct = new Set(
        state.pulseOptins.filter((o) => o.room_id === roomId && o.revoked_at == null).map((o) => o.person_id),
      );
      return [{ total_optin: distinct.size }];
    }

    // ── the per-topic bucket count. Mirrors the REAL statement's semantics:
    //    distinct persons with ANY active opt-in, restricted to those with a
    //    thread whose title matches the term AND is itself actively opted in.
    if (has("count(*)::int as follower_count")) {
      const [roomId, term] = params.map(String);
      const needle = term.slice(1, -1); // strip the leading/trailing '%'
      const distinctOptedIn = new Set(
        state.pulseOptins.filter((o) => o.room_id === roomId && o.revoked_at == null).map((o) => o.person_id),
      );
      let count = 0;
      for (const personId of distinctOptedIn) {
        const matched = state.threads.some(
          (t) =>
            t.room_id === roomId &&
            t.person_id === personId &&
            t.archived_at == null &&
            t.title.toLowerCase().includes(needle) &&
            state.pulseOptins.some((o2) => o2.thread_id === t.thread_id && o2.revoked_at == null),
        );
        if (matched) count += 1;
      }
      return [{ follower_count: count }];
    }

    // ── the snapshot table itself ─────────────────────────────────────────────
    if (has("delete from vy_room_pulse_snapshot")) {
      const [roomId, weekStart] = p;
      state.pulseSnapshots = state.pulseSnapshots.filter((s) => !(s.room_id === roomId && s.week_start === weekStart));
      return [];
    }
    if (has("insert into vy_room_pulse_snapshot")) {
      const [snapshotId, roomId, weekStart, topicId, followerCount] = params;
      if (Number(followerCount) < 5) {
        // THE FLOOR, MIRRORED. Migration 080's own `check (follower_count >=
        // 5)` — a fake that let a sub-floor row through would be checking a
        // weaker world than production, which is exactly the false-confidence
        // shape `sound-gate-proved-by-silence` warns about.
        throw new Error("vy_room_pulse_snapshot_follower_count_check");
      }
      state.pulseSnapshots.push({
        snapshot_id: String(snapshotId),
        room_id: String(roomId),
        week_start: String(weekStart),
        topic_id: String(topicId),
        follower_count: Number(followerCount),
      });
      return [];
    }
    if (has("select max(week_start)")) {
      const roomId = p[0];
      const weeks = state.pulseSnapshots.filter((s) => s.room_id === roomId).map((s) => s.week_start);
      return [{ week_start: weeks.length ? weeks.sort().at(-1) : null }];
    }
    if (has("select s.topic_id, t.label, s.follower_count")) {
      const [roomId, weekStart] = p;
      const rows = state.pulseSnapshots
        .filter((s) => s.room_id === roomId && s.week_start === weekStart)
        .map((s) => {
          const topic = state.pulseTopics.find((t) => t.topic_id === s.topic_id);
          return { topic_id: s.topic_id, label: topic?.label ?? "", follower_count: s.follower_count };
        })
        .sort((a, b) => b.follower_count - a.follower_count || a.label.localeCompare(b.label));
      return rows;
    }

    return base(sql, params);
  };
}
