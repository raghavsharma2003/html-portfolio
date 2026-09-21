// evals/room-account/fixtures.mjs - WS-R39's own extension of `evals/room/
// fixtures.mjs`'s shared fake `db`.
//
// `roomSettings`/`roomSettingsReviewed` (api/_room-surface.js) reach four
// tables the base fixture never modelled at all — `vy_room_push_subscription`,
// `vy_room_follower_whatsapp`, `vy_room_price`, `vy_room_upgrade_offer` — plus
// one query shape on `vy_room_follower_channel` the base fixture's own
// channel-pointer matcher does not answer (that one is keyed by `channel_ref`,
// for the Telegram deep-link resolution; `telegramCheckinsStatusFor`'s query
// is keyed by `follower_id`), and one new UPDATE on `vy_room_follower` itself
// (`settings_reviewed_at`). `evals/room-export/fixtures.mjs`'s own pattern:
// WRAP the base fixture's `fakeDb`, try new matches first, fall through to
// the base for everything else — a fresh, self-contained wrapper rather than
// an edit to the shared file three OTHER suites (`evals/room/run.mjs`,
// `evals/room-leak/run.mjs`, `evals/room-telegram/run.mjs`) read directly.
import { freshState as baseFreshState, fakeDb as baseFakeDb, ROOM_ID } from "../room/fixtures.mjs";

export { ROOM_ID };

export function freshAccountState() {
  return {
    ...baseFreshState(),
    pushSubs: [],   // { follower_id, revoked_at }
    waSubs: [],     // { follower_id, phone_e164, state }
    prices: [],     // { room_id, follower_price_inr, currency }
    offers: [],     // { offer_id, room_id, person_id, follower_id, reason, shown_at, outcome, outcome_at }
  };
}

export function accountDb(state) {
  const base = baseFakeDb(state);
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── push status (`roomSettings`, byte-similar to `_room-push.js`'s
    //    `subscriptionStatus`) ────────────────────────────────────────────
    if (has("vy_room_push_subscription") && has("select count(*)::int as n")) {
      const [followerId] = p;
      const n = state.pushSubs.filter((r) => r.follower_id === followerId && r.revoked_at == null).length;
      return [{ n }];
    }

    // ── WhatsApp status (`roomSettings`, byte-similar to `_room-whatsapp.js`'s
    //    `status`) ──────────────────────────────────────────────────────────
    if (has("vy_room_follower_whatsapp") && has("select phone_e164, state from")) {
      const [followerId] = p;
      const row = state.waSubs.find((r) => r.follower_id === followerId);
      return row ? [{ phone_e164: row.phone_e164, state: row.state }] : [];
    }

    // ── Telegram status (`telegramCheckinsStatusFor`, api/_room-surface.js's
    //    OWN function — `roomSettings` calls it directly, this suite only
    //    needs to answer ITS query shape, distinct from the base fixture's
    //    channel_ref-keyed one) ────────────────────────────────────────────
    if (has("select checkins_enabled, stopped_code from vy_room_follower_channel")) {
      const [followerId] = p;
      const row = state.channelMap.find((c) => c.follower_id === followerId && c.channel === "telegram");
      return row ? [{ checkins_enabled: row.checkins_enabled === true, stopped_code: row.stopped_code ?? null }] : [];
    }

    // ── the room's price (`roomSettings`, byte-similar to `roomSay`'s own
    //    inline read) ──────────────────────────────────────────────────────
    if (has("select follower_price_inr, currency from vy_room_price")) {
      const [roomId] = p;
      const row = state.prices.find((r) => r.room_id === roomId);
      return row ? [{ follower_price_inr: row.follower_price_inr, currency: row.currency }] : [];
    }

    // ── the OPEN cap-reached offer (`roomSettings`'s own new read) ─────────
    if (has("from vy_room_upgrade_offer") && has("reason = 'cap_reached'")) {
      const [followerId] = p;
      const rows = state.offers
        .filter((o) => o.follower_id === followerId && o.outcome == null && o.reason === "cap_reached")
        .sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at));
      return rows.length ? [{ reason: rows[0].reason, shown_at: rows[0].shown_at }] : [];
    }
    // `api/_phase-gate.js`'s `recordOffer`/`markOfferOutcome` — this suite's
    // own tests seed and dismiss offers through the REAL functions rather
    // than pushing fixture rows by hand, `evals/phase-gate/run.mjs`'s own
    // `withPhaseGateTables` precedent.
    if (has("insert into vy_room_upgrade_offer")) {
      const [offerId, roomId, personId, followerId, reason, nowIso] = params;
      const cooldownDays = params[6];
      const now = new Date(nowIso).getTime();
      const within = state.offers.some(
        (o) => o.follower_id === followerId && now - new Date(o.shown_at).getTime() < cooldownDays * 86_400_000,
      );
      if (within) return [];
      state.offers.push({
        offer_id: offerId, room_id: roomId, person_id: personId, follower_id: followerId,
        shown_at: nowIso, reason, outcome: null, outcome_at: null,
      });
      return [{ offer_id: offerId, reason, shown_at: nowIso }];
    }
    if (has("update vy_room_upgrade_offer o")) {
      const [followerId, outcome, nowIso] = params;
      const open = state.offers
        .filter((o) => o.follower_id === followerId && o.outcome == null)
        .sort((a, b) => new Date(b.shown_at) - new Date(a.shown_at))[0];
      if (!open) return [];
      open.outcome = outcome;
      open.outcome_at = nowIso;
      return [{ offer_id: open.offer_id, reason: open.reason, outcome: open.outcome }];
    }

    // ── settings_reviewed_at (`roomSettingsReviewed`'s own write, migration
    //    101) — matched by its SET clause so it cannot collide with the
    //    base fixture's other `update vy_room_follower` matchers (locale,
    //    the message cap, the voice cap), none of which name this column ──
    if (has("update vy_room_follower") && has("set settings_reviewed_at")) {
      const [roomId, personId, agentId, at] = p;
      const f = state.followers.find(
        (x) => x.room_id === roomId && x.person_id === personId && x.agent_id === agentId,
      );
      if (!f) return [];
      f.settings_reviewed_at = at;
      f.updated_at = new Date().toISOString();
      return [{ settings_reviewed_at: f.settings_reviewed_at }];
    }

    return base(sql, params);
  };
}
