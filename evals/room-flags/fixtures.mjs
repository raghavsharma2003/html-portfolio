// Shared fixture world for "flag this reply" (WS-R67, migration 116),
// wrapping `evals/room/fixtures.mjs`'s own `fakeDb` rather than
// reimplementing room/follower/thread behaviour - `evals/handoff/fixtures.mjs`'s
// own precedent and reason, restated: every statement `flagReply`/
// `unflagReply`/`followerFlags` issues against `vy_room`, `vy_room_follower`
// or `vy_room_thread` goes through functions already exported from
// api/_room-surface.js (`resolveRoom`, `followerRow`, `threadDeviceSet`), so
// the base fake already answers those correctly and this file only adds the
// two tables migration 116 introduces, plus `vy_review_never_rule` for
// `neverRuleFromFlaggedReply` (api/_review-queue.js).
//
// Used by BOTH `evals/room-flags/run.mjs` (the feature's own suite) and
// `evals/room-leak/run.mjs`'s layer 7 (the boundary proof) - one wrapper,
// two callers, `evals/handoff/fixtures.mjs`'s own shape exactly.
export function freshFlagState(base) {
  return {
    ...base,
    // creator lane - one row per flag, no follower identity at all
    // (migration 116's own header). Shape: {id, room_id, reply_sha256,
    // reply_text, reason, created_at}.
    roomReplyFlags: [],
    // follower lane - one row per follower per reply (the unique index).
    // Shape: {flag_id, room_id, person_id, follower_id, reply_sha256,
    // reason, created_at}.
    roomFollowerReplyFlags: [],
    // vy_review_never_rule, for neverRuleFromFlaggedReply.
    neverRules: [],
  };
}

/**
 * @param base the room fixture's own fake `db` (`fakeDb(state)`), already
 *             closed over the SAME `state` object this function extends.
 */
export function flagsDb(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── flagReply's ONE statement: follower insert (unique conflict do
    //    nothing), then the creator mirror ONLY if that insert was new ────
    if (has("insert into vy_room_follower_reply_flag") && has("insert into vy_room_reply_flag") &&
        has("on conflict (follower_id, reply_sha256) do nothing")) {
      const [flagId, roomId, personId, followerId, hash, reason, mirrorId, text] = p;
      const already = state.roomFollowerReplyFlags.some(
        (r) => r.follower_id === followerId && r.reply_sha256 === hash,
      );
      if (already) return [{ landed: 0 }];
      const now = new Date().toISOString();
      state.roomFollowerReplyFlags.push({
        flag_id: flagId, room_id: roomId, person_id: personId, follower_id: followerId,
        reply_sha256: hash, reason, created_at: now,
      });
      state.roomReplyFlags.push({ id: mirrorId, room_id: roomId, reply_sha256: hash, reply_text: text, reason, created_at: now });
      return [{ landed: 1 }];
    }

    // ── unflagReply's ONE statement: follower delete, then exactly one
    //    matching creator-lane row deleted in the SAME statement ─────────
    if (has("delete from vy_room_follower_reply_flag") && has("delete from vy_room_reply_flag t")) {
      const [followerId, hash] = p;
      const idx = state.roomFollowerReplyFlags.findIndex(
        (r) => r.follower_id === followerId && r.reply_sha256 === hash,
      );
      if (idx === -1) return [{ withdrawn_count: 0 }];
      const [withdrawn] = state.roomFollowerReplyFlags.splice(idx, 1);
      const mirrorIdx = state.roomReplyFlags.findIndex(
        (r) => r.room_id === withdrawn.room_id && r.reply_sha256 === hash && r.reason === withdrawn.reason,
      );
      if (mirrorIdx !== -1) state.roomReplyFlags.splice(mirrorIdx, 1);
      return [{ withdrawn_count: 1 }];
    }

    // ── followerFlags' own read: this follower's rows, joined back to the
    //    creator lane's text by (room_id, reply_sha256) ───────────────────
    if (has("from vy_room_follower_reply_flag f") && has("left join vy_room_reply_flag c")) {
      const [roomId, followerId] = p;
      return state.roomFollowerReplyFlags
        .filter((r) => r.room_id === roomId && r.follower_id === followerId)
        .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""))
        .map((r) => {
          const mirror = state.roomReplyFlags.find((c) => c.room_id === r.room_id && c.reply_sha256 === r.reply_sha256);
          return { reply_sha256: r.reply_sha256, reason: r.reason, created_at: r.created_at, reply_text: mirror?.reply_text ?? null };
        });
    }

    // ── readFlaggedReplies' aggregate read: grouped by reply, scoped by
    //    (replica_id, owner_user_id) through vy_room ──────────────────────
    if (has("from vy_room_reply_flag f") && has("join vy_room r on r.room_id = f.room_id") &&
        has("group by f.reply_sha256")) {
      const [replicaId, ownerUserId] = p;
      const roomIds = state.rooms
        .filter((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)
        .map((r) => r.room_id);
      const groups = new Map();
      for (const row of state.roomReplyFlags.filter((f) => roomIds.includes(f.room_id))) {
        const g = groups.get(row.reply_sha256) ?? {
          reply_sha256: row.reply_sha256, reply_text: row.reply_text, flag_count: 0,
          wrong_count: 0, harmful_count: 0, not_them_count: 0, other_count: 0, last_flagged_at: row.created_at,
        };
        g.flag_count += 1;
        g[`${row.reason}_count`] += 1;
        if (row.created_at > g.last_flagged_at) g.last_flagged_at = row.created_at;
        groups.set(row.reply_sha256, g);
      }
      return [...groups.values()].sort((a, b) => b.flag_count - a.flag_count);
    }

    // ── neverRuleFromFlaggedReply's own text lookup, by (replica, hash) ───
    if (has("select f.reply_text") && has("from vy_room_reply_flag f join vy_room r on r.room_id = f.room_id") &&
        has("order by f.created_at asc limit 1")) {
      const [replicaId, ownerUserId, hash] = p;
      const roomIds = state.rooms
        .filter((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)
        .map((r) => r.room_id);
      const row = state.roomReplyFlags
        .filter((f) => roomIds.includes(f.room_id) && f.reply_sha256 === hash)
        .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""))[0];
      return row ? [{ reply_text: row.reply_text }] : [];
    }

    // ── neverRuleFromFlaggedReply's own never-rule upsert (existing/
    //    inserted CTE) ────────────────────────────────────────────────────
    if (has("insert into vy_review_never_rule") && has("with existing as (") &&
        has("lower(pattern) = lower($3::text)")) {
      const [replicaId, ownerUserId, pattern, reason] = p;
      const existing = state.neverRules.find(
        (r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId &&
          r.pattern.toLowerCase() === pattern.toLowerCase() && !r.revoked_at,
      );
      if (existing) return [{ rule_id: existing.rule_id }];
      const ruleId = `nr-${state.neverRules.length + 1}`;
      state.neverRules.push({
        rule_id: ruleId, replica_id: replicaId, owner_user_id: ownerUserId, pattern, reason: reason ?? "", revoked_at: null,
      });
      return [{ rule_id: ruleId }];
    }

    return base(sql, params);
  };
}
