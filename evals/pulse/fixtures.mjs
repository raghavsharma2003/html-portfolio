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
  return { ...base, pulseOptins: [], pulseTopics: [], pulseSnapshots: [] };
}

/**
 * @param base   the room fixture's own fake `db` (`fakeDb(state)`), already
 *               closed over the SAME `state` object this function extends.
 */
export function pulseDb(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

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
