// evals/room-export/fixtures.mjs — WS-R27's own extension of `evals/room/
// fixtures.mjs`'s shared fake `db`.
//
// WHY A NEW FILE RATHER THAN EDITING THE SHARED ONE
//
// `roomExport`/`roomForget` (api/_room-surface.js) now reach nine Room-scoped
// person-lane tables the base fixture never modelled at all -
// `vy_room_follower_day`, `vy_room_checkin`, `vy_room_checkin_delivery`,
// `vy_room_voice_usage`, `vy_room_subscription`, `vy_room_pulse_optin`,
// `vy_room_follower_channel`, `vy_room_push_subscription`, `vy_room_handoff`
// - and this suite needs a real, honest fake for every one of them to prove
// the completeness laws (export contains a row from each; forget leaves
// zero; the receipt's counts equal what was deleted). `evals/pulse/
// fixtures.mjs`/`evals/handoff/fixtures.mjs` already establish the pattern
// this file follows (`exportDb` WRAPS `evals/room/fixtures.mjs`'s own
// `fakeDb`, tries its own matches first, falls through to the base for
// everything else) - a fresh, self-contained wrapper rather than an edit to
// the shared file, because THREE other suites (`evals/room/run.mjs`,
// `evals/room-leak/run.mjs`, `evals/room-telegram/run.mjs`) read that file's
// `fakeDb` directly and a change to its matching logic risks a regression in
// all three for a table only this suite exercises.
//
// ── THE ONE REAL COLLISION, AND WHY IT MUST BE HANDLED HERE FIRST ──────────
//
// `api/_room.js`'s `unbindTelegramChannel` already issues `delete from
// vy_room_follower_channel where channel = 'telegram' and channel_ref = $1`
// (one param: a channel ref), and the base fixture's own matcher for it is
// `has("delete from vy_room_follower_channel")` - a SUBSTRING check, not a
// full-statement one. `roomForget`'s OWN new statement for this table
// (`delete from vy_room_follower_channel where room_id = ($1)::uuid and
// person_id = ($2)::uuid`) contains that same substring, so if it ever
// reached the base fixture's matcher first, `channelRef` would be bound to a
// ROOM ID, no row would ever match, and `deleted.vy_room_follower_channel`
// would silently read 0 forever regardless of how many rows really existed -
// `router-matched-a-table-instead-of-a-statement` (context/rejected.md,
// WS-R18's entry), the identical collision class, on the identical table
// name, one workstream later. Because `exportDb` below tries its OWN
// `vy_room_follower_channel` branch (matched on the FULLER, room_id+person_id
// shape) and returns before EVER calling `base(...)`, the base fixture's
// differently-shaped branch never gets a chance to see this statement at
// all - the collision is avoided by construction, not by editing the file
// that could reintroduce it.
import { freshState as baseFreshState, fakeDb as baseFakeDb, ROOM_ID } from "../room/fixtures.mjs";

export { ROOM_ID };

export function freshExportState() {
  return {
    ...baseFreshState(),
    followerDays: [],
    checkins: [],
    checkinDeliveries: [],
    voiceUsages: [],
    subscriptions: [],
    pulseOptinsX: [],
    pushSubscriptions: [],
    roomHandoffs: [],
    // WS-R67 (migration 116). The FOLLOWER lane only - the creator's mirror
    // (`vy_room_reply_flag`) is deliberately absent from this whole file:
    // it names no person at all (migration 116's own header), so
    // roomExport/roomForget never touch it and this fixture has no reason
    // to model it either.
    followerReplyFlags: [],
  };
}

export function exportDb(state) {
  const base = baseFakeDb(state);
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── roomExport's OWN generic agent-scoped select, for vy_room_thread and
    //    vy_room_follower (both `agent: true` in PERSON_TABLES, so
    //    `roomScopedTables()`'s loop reaches them through
    //    `api/_room-surface.js`'s SHARED, un-aliased
    //    `select * from ${t.table} where (person_id = $1) and agent_id =
    //    ($2)::uuid limit 5000` - a DIFFERENT statement shape than every
    //    other reader of these two tables in this codebase, every one of
    //    which selects specific, ALIASED columns (`listThreads`,
    //    `followerRow`, ...). The base fixture's own read matchers for both
    //    tables assume that alias (`"from vy_room_thread t"`, `"from
    //    vy_room_follower f"`), so neither ever recognised this shape -
    //    nothing before this suite ever drove the real PERSON_TABLES
    //    manifest through `roomExport` (every existing suite's own
    //    `personTables` override omits both, `evals/room/run.mjs`'s own
    //    comment: "present and NOT agent-scoped... a person-intrinsic table
    //    is not this creator's to delete" - about a DIFFERENT table, but the
    //    manifest those suites hand in never includes `vy_room_thread`/
    //    `vy_room_follower` either). Handled here rather than in the shared
    //    fixture for the same reason the header above gives for
    //    `vy_room_follower_channel`. ──────────────────────────────────────
    if (has("select * from vy_room_thread where")) {
      const [personId, agentId] = p;
      return state.threads.filter((t) => t.person_id === personId && t.agent_id === agentId);
    }
    if (has("select * from vy_room_follower where")) {
      const [personId, agentId] = p;
      return state.followers.filter((f) => f.person_id === personId && f.agent_id === agentId);
    }

    // ── vy_room_follower_day (COUNT shape) ─────────────────────────────────
    if (has("vy_room_follower_day")) {
      const [roomId, personId] = p;
      if (has("select count(*)::int as n")) {
        const n = state.followerDays
          .filter((r) => r.room_id === roomId && r.person_id === personId)
          .reduce((sum, r) => sum + r.turns, 0);
        return [{ n }];
      }
      if (has("delete from")) {
        const gone = state.followerDays.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.followerDays = state.followerDays.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_checkin_delivery (COUNT shape) — checked BEFORE plain
    //    vy_room_checkin, since "vy_room_checkin" is a substring of
    //    "vy_room_checkin_delivery" ─────────────────────────────────────────
    if (has("vy_room_checkin_delivery")) {
      const [roomId, personId] = p;
      if (has("select count(*)::int as n")) {
        const n = state.checkinDeliveries.filter((r) => r.room_id === roomId && r.person_id === personId).length;
        return [{ n }];
      }
      if (has("delete from")) {
        const gone = state.checkinDeliveries.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.checkinDeliveries = state.checkinDeliveries.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_checkin (ROWS shape) ────────────────────────────────────────
    if (has("vy_room_checkin") && !has("vy_room_checkin_delivery")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.checkins.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.checkins.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.checkins = state.checkins.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_voice_usage (COUNT shape) ───────────────────────────────────
    if (has("vy_room_voice_usage")) {
      const [roomId, personId] = p;
      if (has("select count(*)::int as n")) {
        const n = state.voiceUsages
          .filter((r) => r.room_id === roomId && r.person_id === personId)
          .reduce((sum, r) => sum + r.seconds, 0);
        return [{ n }];
      }
      if (has("delete from")) {
        const gone = state.voiceUsages.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.voiceUsages = state.voiceUsages.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_subscription (ROWS shape). The wipeWhere restriction is READ
    //    off the shipping SQL text, this repo's own convention (evals/room/
    //    fixtures.mjs's header), so a negative control that strikes it is
    //    honoured here too. ───────────────────────────────────────────────
    if (has("vy_room_subscription") && !has("vy_room_push_subscription")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.subscriptions.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from")) {
        const terminalOnly = has("state in ('cancelled','expired')");
        const gone = state.subscriptions.filter(
          (r) =>
            r.room_id === roomId &&
            r.person_id === personId &&
            (!terminalOnly || ["cancelled", "expired"].includes(r.state)),
        );
        state.subscriptions = state.subscriptions.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_pulse_optin — roomForget's/roomExport's OWN room_id+person_id
    //    statement, distinct from `api/_pulse.js`'s own toggle statements
    //    (`evals/pulse/fixtures.mjs`'s own shapes, not modelled here since
    //    this suite seeds rows directly rather than through `setOptIn`). ───
    if (has("vy_room_pulse_optin")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.pulseOptinsX.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
        const gone = state.pulseOptinsX.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.pulseOptinsX = state.pulseOptinsX.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_follower_channel — roomForget's/roomExport's OWN
    //    room_id+person_id statement. Checked and returned BEFORE `base(...)`
    //    is ever called, this file's own header explains why. ─────────────
    if (has("vy_room_follower_channel") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.channelMap.filter((c) => c.room_id === roomId && c.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.channelMap.filter((c) => c.room_id === roomId && c.person_id === personId);
        state.channelMap = state.channelMap.filter((c) => !gone.includes(c));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_push_subscription (ROWS shape) ──────────────────────────────
    if (has("vy_room_push_subscription")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.pushSubscriptions.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.pushSubscriptions.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.pushSubscriptions = state.pushSubscriptions.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_handoff (ROWS shape) — roomExport's/roomForget's OWN
    //    room_id+person_id statement, distinct from `api/_handoff.js`'s own
    //    hash-gated queue reads (not modelled here, same reason as pulse
    //    above). ────────────────────────────────────────────────────────
    if (has("vy_room_handoff") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.roomHandoffs.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.roomHandoffs.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.roomHandoffs = state.roomHandoffs.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_follower_reply_flag (ROWS shape, WS-R67 migration 116) ──────
    //    Same room_id+person_id statement shape as vy_room_handoff above -
    //    roomExport's `ROOM_EXPORT_EXTRA` read and roomForget's own explicit
    //    delete, never api/_room-surface.js's `flagReply`/`unflagReply`
    //    (those are keyed on follower_id and are not modelled here, the
    //    same reason vy_room_handoff's own hash-gated queue reads are not
    //    modelled in this file either). ──────────────────────────────────
    if (has("vy_room_follower_reply_flag") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select *")) {
        return state.followerReplyFlags.filter((r) => r.room_id === roomId && r.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.followerReplyFlags.filter((r) => r.room_id === roomId && r.person_id === personId);
        state.followerReplyFlags = state.followerReplyFlags.filter((r) => !gone.includes(r));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_forget_receipt (migration 090) ──────────────────────────────
    if (has("insert into vy_room_forget_receipt")) {
      const [receiptId, roomId, personHash, policyVersion, counts, issuedAt] = params;
      state.forgetReceipts = state.forgetReceipts || [];
      state.forgetReceipts.push({
        receipt_id: String(receiptId),
        room_id: String(roomId),
        person_hash: String(personHash),
        policy_version: Number(policyVersion),
        counts: JSON.parse(counts),
        issued_at: String(issuedAt),
      });
      return [];
    }

    // ── WS-R32: `purgeRoomForgetReceipts` (api/memory.js) - the whole
    //    wipe's OWN door, bounded by Rooms rather than by receipts. Two
    //    statements: read every room_id this database has, then delete every
    //    receipt whose person_hash is among a caller-supplied array. ────────
    if (has("select room_id from vy_room")) {
      return state.rooms.map((r) => ({ room_id: r.room_id }));
    }
    if (has("delete from vy_room_forget_receipt") && has("person_hash = any(")) {
      const [hashes] = params;
      const set = new Set((hashes || []).map(String));
      state.forgetReceipts = state.forgetReceipts || [];
      const before = state.forgetReceipts.length;
      state.forgetReceipts = state.forgetReceipts.filter((r) => !set.has(r.person_hash));
      const removed = before - state.forgetReceipts.length;
      return Array.from({ length: removed }, () => ({ x: 1 }));
    }

    return base(sql, params);
  };
}
