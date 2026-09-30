// Shared fixture world for Handoff's offline suites (WS-R20's
// evals/handoff/run.mjs and the class it adds to evals/room-leak/run.mjs).
//
// `handoffDb` WRAPS `evals/room/fixtures.mjs`'s own `fakeDb` rather than
// reimplementing room/follower/thread behaviour - `evals/pulse/fixtures.mjs`'s
// own precedent and reason, restated: every statement api/_handoff.js issues
// against `vy_room`, `vy_room_follower` or `vy_room_thread` goes through
// functions already exported from api/_room-surface.js (`resolveRoom`,
// `followerRow`, `ownedThread`), so the base fake already answers those
// correctly and this file only adds the one table migration 083 introduces,
// plus the two new columns on `vy_room` the base fixture already carries
// (evals/room/fixtures.mjs's own `freshState`, WS-R20's own addition to it).
//
// THE CONSENTED-ONLY PREDICATE, MIRRORED FOR REAL. `payload_sha256 =
// encode(digest(payload_text,'sha256'),'hex')` is not decoration here - this
// fake actually recomputes the hash from `row.payload_text` on every read a
// creator-facing query performs, using the SAME node:crypto sha256 the real
// api/_handoff.js uses, so a test that tampers `row.payload_text` after
// insert (without touching `row.payload_sha256`) is honoured by this fake
// exactly as Postgres would honour it - a fake that instead trusted a
// `matches: true` flag set at insert time would be checking a WEAKER world
// than production, `sound-gate-proved-by-silence`'s standing warning.
import { createHash } from "node:crypto";

const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

export function freshHandoffState(base) {
  return { ...base, roomHandoffs: [] };
}

/**
 * @param base   the room fixture's own fake `db` (`fakeDb(state)`), already
 *               closed over the SAME `state` object this function extends.
 */
export function handoffDb(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── owner-scoped room handle (config_get/config_set/queue/answer) ───────
    if (has("handoff_enabled, handoff_monthly_cap") && has("from vy_room") &&
        has("owner_user_id = ($1)::uuid and replica_id = ($2)::uuid")) {
      const room = state.rooms.find(
        (r) => r.owner_user_id.toLowerCase() === p[0] && r.replica_id.toLowerCase() === p[1],
      );
      return room
        ? [{ room_id: room.room_id, owner_user_id: room.owner_user_id,
             handoff_enabled: room.handoff_enabled === true, handoff_monthly_cap: Number(room.handoff_monthly_cap) }]
        : [];
    }
    if (has("update vy_room") && has("handoff_enabled = ($3)::boolean")) {
      const [roomId, ownerUserId, enabled, cap] = params;
      const room = state.rooms.find((r) => r.room_id === String(roomId) && r.owner_user_id === String(ownerUserId));
      if (!room) return [];
      room.handoff_enabled = enabled === true;
      room.handoff_monthly_cap = Number(cap);
      return [{ room_id: room.room_id, handoff_enabled: room.handoff_enabled, handoff_monthly_cap: room.handoff_monthly_cap }];
    }

    // ── the queue: counts, then the one hash-matched 'sent' row ──────────────
    if (has("select state, count(*)::int as n") && has("from vy_room_handoff") && has("group by state")) {
      const roomId = p[0];
      const byState = { drafted: 0, sent: 0, answered: 0, withdrawn: 0 };
      for (const h of state.roomHandoffs) if (h.room_id === roomId) byState[h.state] = (byState[h.state] || 0) + 1;
      return Object.entries(byState).filter(([, n]) => n > 0).map(([st, n]) => ({ state: st, n }));
    }
    if (has("from vy_room_handoff") && has("payload_sha256 = encode(digest(payload_text") && has("order by sent_at asc")) {
      const roomId = p[0];
      const rows = state.roomHandoffs
        .filter((h) => h.room_id === roomId && h.state === "sent" && h.payload_sha256 === sha256Hex(h.payload_text))
        .sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""));
      const r = rows[0];
      return r
        ? [{ handoff_id: r.handoff_id, thread_id: r.thread_id, payload_text: r.payload_text,
             policy_version: r.policy_version, sent_at: r.sent_at }]
        : [];
    }

    // ── WS-R87: the kernel-on pre-read `answerHandoff` issues BEFORE the
    // answering UPDATE, when ROOM_HANDOFF_KERNEL=1 - the SAME hash-match
    // predicate as the write below, but a SELECT rather than an UPDATE, so
    // it must be matched first (its own text is a strict subset of the
    // UPDATE's own matched substrings otherwise).
    if (has("select handoff_id, follower_id, policy_version") && has("from vy_room_handoff") &&
        has("handoff_id = ($1)::uuid and room_id = ($2)::uuid")) {
      const [handoffId, roomId] = p;
      const row = state.roomHandoffs.find(
        (h) =>
          h.handoff_id === handoffId && h.room_id === roomId && h.state === "sent" &&
          h.payload_sha256 === sha256Hex(h.payload_text),
      );
      return row ? [{ handoff_id: row.handoff_id, follower_id: row.follower_id, policy_version: row.policy_version }] : [];
    }

    // ── the answer: the SAME hash-match predicate gates the write ───────────
    if (has("update vy_room_handoff") && has("set reply_text = $3")) {
      const [handoffId, roomId, replyText] = p;
      const row = state.roomHandoffs.find(
        (h) =>
          h.handoff_id === handoffId && h.room_id === roomId && h.state === "sent" &&
          h.payload_sha256 === sha256Hex(h.payload_text),
      );
      if (!row) return [];
      row.reply_text = replyText;
      row.state = "answered";
      row.answered_at = new Date(Date.now() + state.roomHandoffs.length).toISOString();
      row.updated_at = row.answered_at;
      return [{ handoff_id: row.handoff_id, thread_id: row.thread_id, person_id: row.person_id,
                follower_id: row.follower_id, state: row.state, answered_at: row.answered_at }];
    }

    // ── send: the cap+enabled predicate lives in the fake exactly as in the
    // real SELECT, read off the room row rather than re-derived from thin
    // air, so a negative control that flips the room's own flag is honoured.
    if (has("insert into vy_room_handoff")) {
      const [id, roomId, personId, followerId, threadId, text, hash, policyVersion, monthKey] = params;
      const room = state.rooms.find((r) => r.room_id === String(roomId));
      if (!room || room.handoff_enabled !== true) return [];
      const used = state.roomHandoffs.filter(
        (h) => h.follower_id === String(followerId) && h.month_key === monthKey && h.state !== "withdrawn",
      ).length;
      if (used >= Number(room.handoff_monthly_cap)) return [];
      const now = new Date(Date.now() + state.roomHandoffs.length).toISOString();
      const row = {
        handoff_id: String(id), room_id: String(roomId), person_id: String(personId),
        follower_id: String(followerId), thread_id: threadId == null ? null : String(threadId),
        payload_text: text, payload_sha256: hash, policy_version: policyVersion,
        state: "sent", reply_text: "", month_key: monthKey,
        sent_at: now, answered_at: null, created_at: now, updated_at: now,
      };
      state.roomHandoffs.push(row);
      return [{ handoff_id: row.handoff_id, state: row.state, sent_at: row.sent_at }];
    }
    if (has("select count(*)::int as n from vy_room_handoff") && has("where follower_id = ($1)::uuid and month_key = $2")) {
      const [followerId, monthKey] = p;
      const n = state.roomHandoffs.filter(
        (h) => h.follower_id === followerId && h.month_key === monthKey && h.state !== "withdrawn",
      ).length;
      return [{ n }];
    }

    // ── withdraw ──────────────────────────────────────────────────────────
    if (has("update vy_room_handoff") && has("set state = 'withdrawn'")) {
      const [handoffId, roomId, personId, followerId] = p;
      const row = state.roomHandoffs.find(
        (h) =>
          h.handoff_id === handoffId && h.room_id === roomId && h.person_id === personId &&
          h.follower_id === followerId && (h.state === "drafted" || h.state === "sent"),
      );
      if (!row) return [];
      row.state = "withdrawn";
      row.updated_at = new Date().toISOString();
      return [{ handoff_id: row.handoff_id, state: row.state }];
    }

    // ── mine: the follower's own requests and replies, nobody else's ────────
    if (has("select handoff_id, thread_id, state, payload_text, sent_at, answered_at, reply_text, created_at") &&
        has("from vy_room_handoff")) {
      const [roomId, personId, followerId] = p;
      return state.roomHandoffs
        .filter((h) => h.room_id === roomId && h.person_id === personId && h.follower_id === followerId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .map((h) => ({ ...h }));
    }

    // ── the "did this ever leak" world check: delete by room_id, the erasure
    // job's own shape one file over.
    if (has("delete from vy_room_handoff") && has("where room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      const before = state.roomHandoffs.length;
      state.roomHandoffs = state.roomHandoffs.filter((h) => !(h.room_id === roomId && h.person_id === personId));
      return before === state.roomHandoffs.length ? [] : [{ gone: 1 }];
    }

    return base(sql, params);
  };
}
