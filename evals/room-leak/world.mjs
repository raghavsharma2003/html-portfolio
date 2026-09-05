// WS-R68. THE FULL-WORLD LEAK BATTERY — a stronger layer inside the existing
// `room leak battery` gate (evals/room-leak/run.mjs), not a new named gate.
//
// Every prior Rooms suite (WS-R8's own layers, WS-R17's Pulse layer, WS-R20's
// Handoff layer, and the standalone room-export/room-doors batteries) proves
// its own lane on a SMALL, single-purpose world: two to twenty followers, one
// or two Rooms, one transport. Nothing before this workstream has run every
// lane AT ONCE, on ONE world, with the overlapping memberships a real
// platform actually has (a follower in two Rooms, a creator who is also a
// follower elsewhere, one owner running two Rooms in the same Suite). This
// file is the generator and the driver; `run.mjs`'s own new section calls it
// and does the assertions, `evals/room-leak/run.mjs`'s own established
// convention (every layer above calls the SAME module-level `ok`).
//
// ── WHY A NEW COMPOSED FAKE DB RATHER THAN REUSING ONE SUITE'S OWN ─────────
//
// `evals/pulse/fixtures.mjs`'s `pulseDb` and `evals/handoff/fixtures.mjs`'s
// `handoffDb` each wrap `evals/room/fixtures.mjs`'s base `fakeDb` directly and
// have never been combined — every existing suite that uses one leaves the
// other out. Composing both (plus this file's own whatsapp/push/check-in
// additions) surfaced a real ordering hazard: `pulseDb`'s owner-scoped
// room-handle match (`has("from vy_room") && has("owner_user_id = ($1)::uuid
// and replica_id = ($2)::uuid")`) is a strict SUBSET of `handoffDb`'s own
// (which additionally requires `"handoff_enabled, handoff_monthly_cap"` in
// the select list) — so if `pulseDb` is tried before `handoffDb`, it silently
// swallows `getHandoffConfig`/`setHandoffConfig`'s own statement and hands
// back a row with neither field, breaking every handoff call with no error at
// the call site (a stripped row, not a thrown one — the `plausible-return-
// hides-a-dead-pipeline` shape, one layer down in a shared fixture rather
// than in shipping code). Fixed by ORDER, not by narrowing either fixture:
// `handoffDb` is composed OUTSIDE `pulseDb` so its narrower match is tried
// first; this file's own additions are composed outside both, tried first of
// all. See `context/rejected.md#ws-r68-composed-fixture-owner-scope-shadowing`.
//
// ── WORLD SHAPE (workstream brief, law 1) ──────────────────────────────────
//
//   5 Rooms, 2 Suites (grouped by owner — vy_org itself holds no follower
//   content, so this battery groups by owner_user_id rather than building
//   real vy_org rows; the aggregate-only discipline over vy_org tables is
//   `evals/room-leak/run.mjs`'s own layer 1c, unaffected by this file):
//     Suite alpha: R0 "priya" and R1 "kabir" (same owner — the Suite admin
//                  who is also a creator, running two Rooms), R2 "meher"
//                  (a second creator in the same Suite).
//     Suite beta:  R3 "dev" and R4 "zara" (a third and fourth owner).
//   R2's OWNER is ALSO a follower of R3 — "a creator who is also a follower
//   elsewhere" (cross-Suite, the harder case).
//   100 followers, primary Room assigned round-robin (20 each); ~15 of them
//   (RNG-picked) additionally join a SECOND Room — "a follower in two Rooms."
//   Every transport is used by someone: web (the majority), a Telegram
//   pointer (`bindTelegramChannel`), a WhatsApp opt-in (paid-tier only, the
//   real gate `api/_room-whatsapp.js` enforces), a web push subscription, and
//   "installed" — the PWA-vs-browser distinction is client-side only (the
//   manifest, `api/_room-manifest.js`) and shares the identical server-side
//   session lane every other transport uses, so it carries no separate fake
//   `db` behaviour; followers tagged `installed` are real participants in
//   every other lane, the tag is metadata for the printed summary only.
//
// Seeded RNG (mulberry32) so a failing seed is reproducible — printed on
// every run, overridable with ROOM_WORLD_SEED for reproducing a failure.
import { randomUUID, createHash } from "node:crypto";
import fs from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { freshState, fakeDb } from "../room/fixtures.mjs";
import { freshPulseState, pulseDb } from "../pulse/fixtures.mjs";
import { freshHandoffState, handoffDb } from "../handoff/fixtures.mjs";
import { PERSON_TABLES, roomForgetReceiptHash } from "../../api/memory.js";
import { loadSchema } from "../sqlcast/schema.mjs";

const sha256Hex = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

export const DEFAULT_SEED = Number(process.env.ROOM_WORLD_SEED || 0) || 20260905;

/** mulberry32 — small, dependency-free, deterministic. Same algorithm family
 *  this repo already uses for other seeded generators (`evals/mp`'s own
 *  scenario shuffles); not imported from there because that module is not
 *  exported for reuse and a 6-line PRNG is not worth a new shared file. */
function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle(arr, rng) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function pickN(arr, n, rng) {
  return shuffle(arr, rng).slice(0, n);
}

// ═════════════════════════════════════════════════════════════════════════
// WORLD DESCRIPTOR
// ═════════════════════════════════════════════════════════════════════════

const OWNER_A = "a0000000-0000-4000-9000-00000000000a"; // suite alpha admin, owns R0+R1
const OWNER_B = "a0000000-0000-4000-9000-00000000000b"; // suite alpha, owns R2, also follows R3
const OWNER_C = "a0000000-0000-4000-9000-00000000000c"; // suite beta, owns R3
const OWNER_D = "a0000000-0000-4000-9000-00000000000d"; // suite beta, owns R4

export const ROOM_DEFS = [
  { idx: 0, slug: "priya", suite: "alpha", owner: OWNER_A },
  { idx: 1, slug: "kabir", suite: "alpha", owner: OWNER_A },
  { idx: 2, slug: "meher", suite: "alpha", owner: OWNER_B },
  { idx: 3, slug: "dev", suite: "beta", owner: OWNER_C },
  { idx: 4, slug: "zara", suite: "beta", owner: OWNER_D },
].map((r) => ({
  ...r,
  room_id: `d1000000-0000-4000-9000-0000000000${String(r.idx).padStart(2, "0")}`,
  agent_id: `b1000000-0000-4000-9000-0000000000${String(r.idx).padStart(2, "0")}`,
  replica_id: `c1000000-0000-4000-9000-0000000000${String(r.idx).padStart(2, "0")}`,
}));

const N_FOLLOWERS = 100;
const TURNS_PER_MEMBERSHIP = 3;
const N_OVERLAP = 15;

const fuid = (i) => `f0000000-0000-4000-b000-${String(i).padStart(12, "0")}`;
const factToken = (i, r) => `TOKFACT_W_${i}_${r}_${"x".repeat(6)}`;
const msgToken = (i, r, t) => `TOKMSG_W_${i}_${r}_${t}_${"y".repeat(6)}`;
const threadToken = (i, r) => `TOKTHREAD_W_${i}_${r}_${"z".repeat(6)}`;
const handoffToken = (i, r) => `TOKHANDOFF_W_${i}_${r}_${"v".repeat(6)}`;

function transportFor(rng) {
  const x = rng();
  if (x < 0.55) return "web";
  if (x < 0.70) return "telegram";
  if (x < 0.82) return "whatsapp";
  if (x < 0.93) return "push";
  return "installed";
}

/** Builds the world descriptor: which followers exist, which Room(s) each
 *  belongs to (a "membership" is a {followerIdx, roomIdx} pair), and which
 *  transport each follower primarily uses. Pure — no I/O, no db. */
export function buildWorld(seed = DEFAULT_SEED) {
  const rng = makeRng(seed);
  const followers = [];
  for (let i = 0; i < N_FOLLOWERS; i++) {
    followers.push({ idx: i, uid: fuid(i), primaryRoom: i % ROOM_DEFS.length, secondaryRoom: null, transport: transportFor(rng) });
  }
  const overlapPicks = pickN(followers.map((f) => f.idx), N_OVERLAP, rng);
  for (const i of overlapPicks) {
    const f = followers[i];
    let secondary = Math.floor(rng() * ROOM_DEFS.length);
    if (secondary === f.primaryRoom) secondary = (secondary + 1) % ROOM_DEFS.length;
    f.secondaryRoom = secondary;
  }
  const memberships = [];
  for (const f of followers) {
    memberships.push({ followerIdx: f.idx, roomIdx: f.primaryRoom });
    if (f.secondaryRoom != null) memberships.push({ followerIdx: f.idx, roomIdx: f.secondaryRoom });
  }
  // The two extra, non-follower memberships law 1 names by name: OWNER_B (a
  // creator) also follows R3, a different Suite's Room entirely.
  memberships.push({ followerIdx: "OWNER_B", roomIdx: 3, uidOverride: OWNER_B });

  return { seed, rooms: ROOM_DEFS, followers, memberships, overlapPicks: new Set(overlapPicks) };
}

// ═════════════════════════════════════════════════════════════════════════
// THE COMPOSED FAKE DB
// ═════════════════════════════════════════════════════════════════════════

export function freshWorldState() {
  const base = freshState();
  base.rooms = ROOM_DEFS.map((r) => ({
    room_id: r.room_id,
    slug: r.slug,
    replica_id: r.replica_id,
    agent_id: r.agent_id,
    owner_user_id: r.owner,
    display_name: r.slug,
    free_monthly_messages: 20,
    paid_monthly_messages: 500,
    paid_monthly_voice_seconds: 1800,
    handoff_enabled: true,
    handoff_monthly_cap: 50,
    default_locale: "en",
    published_at: "2026-09-01T00:00:00.000Z",
    paused_at: null,
  }));
  const withPulse = freshPulseState(base);
  const withHandoff = freshHandoffState(withPulse);
  return {
    ...withHandoff,
    // WS-R4's rule table, owner lane (no person column). Empty by default;
    // a suite seeds a rule to prove the Room's reply lanes carry it.
    neverRules: [],
    waOptins: [],
    pushSubs: [],
    checkinDesigns: [],
    checkins: [],
    checkinDeliveries: [],
    forgetReceipts: [],
  };
}

/** This file's own additions: WhatsApp opt-in, push subscription, check-in
 *  design+schedule, and the room+person GENERIC shapes `roomExport`/
 *  `roomForget` use for the tables above plus pulse-optin/handoff/telegram-
 *  channel — `evals/room-export/fixtures.mjs`'s own header names exactly why
 *  these are a DIFFERENT statement shape than each feature's own toggle SQL
 *  (matched here on the SAME distinguishing substrings that file uses), so
 *  composing this ahead of `pulseDb`/`handoffDb` cannot shadow either. */
function worldExtraDb(state, base) {
  return async (sql, params = []) => {
    const has = (s) => sql.includes(s);
    const p = (params || []).map((v) => (v == null ? null : String(v)));

    // ── generic export reads for the two agent-scoped PERSON_TABLES entries
    //    that carry `agent: true` but no dedicated table in the base fixture
    //    (`vy_room_thread`/`vy_room_follower` themselves) ───────────────────
    if (has("select * from vy_room_thread where")) {
      const [personId, agentId] = p;
      return state.threads.filter((t) => t.person_id === personId && t.agent_id === agentId);
    }
    if (has("select * from vy_room_follower where")) {
      const [personId, agentId] = p;
      return state.followers.filter((f) => f.person_id === personId && f.agent_id === agentId);
    }

    // ── vy_room_follower_whatsapp — api/_room-whatsapp.js's own optIn/status/
    //    stop/markFailed, plus roomExport's/roomForget's masked-phone shape ──
    if (has("insert into vy_room_follower_whatsapp")) {
      const [followerId, roomId, personId, phone] = p;
      const existing = state.waOptins.find((w) => w.follower_id === followerId);
      if (existing) {
        existing.phone_e164 = phone; existing.state = "active"; existing.last_failure_code = "";
      } else {
        state.waOptins.push({ follower_id: followerId, room_id: roomId, person_id: personId, phone_e164: phone, state: "active", last_failure_code: "" });
      }
      return [{ follower_id: followerId }];
    }
    if (has("select phone_e164, state from vy_room_follower_whatsapp where follower_id")) {
      const row = state.waOptins.find((w) => w.follower_id === p[0]);
      return row ? [{ phone_e164: row.phone_e164, state: row.state }] : [];
    }
    if (has("update vy_room_follower_whatsapp") && has("set state = 'stopped'")) {
      const row = state.waOptins.find((w) => w.follower_id === p[0]);
      if (row) row.state = "stopped";
      return [];
    }
    if (has("vy_room_follower_whatsapp") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select")) {
        return state.waOptins.filter((w) => w.room_id === roomId && w.person_id === personId);
      }
      if (has("delete from")) {
        const gone = state.waOptins.filter((w) => w.room_id === roomId && w.person_id === personId);
        state.waOptins = state.waOptins.filter((w) => !gone.includes(w));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_push_subscription — api/_room-push.js's own upsert-by-
    //    endpoint, plus the generic room+person export/forget shape ─────────
    if (has("insert into vy_room_push_subscription")) {
      const [subId, roomId, personId, followerId, endpoint, p256dh, auth] = p;
      const existing = state.pushSubs.find((s) => s.endpoint === endpoint);
      if (existing) {
        Object.assign(existing, { room_id: roomId, person_id: personId, follower_id: followerId, p256dh, auth, revoked_at: null });
      } else {
        state.pushSubs.push({ subscription_id: subId, room_id: roomId, person_id: personId, follower_id: followerId, endpoint, p256dh, auth, revoked_at: null });
      }
      return [{ subscription_id: (existing || state.pushSubs.at(-1)).subscription_id, created_at: new Date().toISOString() }];
    }
    if (has("select count(*)::int as n from vy_room_push_subscription")) {
      const followerId = p[0];
      const n = state.pushSubs.filter((s) => s.follower_id === followerId && s.revoked_at == null).length;
      return [{ n }];
    }
    if (has("vy_room_push_subscription") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select")) return state.pushSubs.filter((s) => s.room_id === roomId && s.person_id === personId);
      if (has("delete from")) {
        const gone = state.pushSubs.filter((s) => s.room_id === roomId && s.person_id === personId);
        state.pushSubs = state.pushSubs.filter((s) => !gone.includes(s));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_checkin_design — api/_checkins.js's createDesign/listRoomCheckinDesigns
    if (has("insert into vy_room_checkin_design")) {
      const [id, roomId, ownerUserId, title, shape, cadence] = p;
      const row = { design_id: id, room_id: roomId, owner_user_id: ownerUserId, title, prompt_shape: shape, cadence_hint: cadence, state: "active" };
      state.checkinDesigns.push(row);
      return [{ ...row, created_at: new Date().toISOString(), updated_at: new Date().toISOString() }];
    }
    if (has("from vy_room_checkin_design") && has("state = 'active'") && has("order by created_at asc")) {
      const roomId = p[0];
      return state.checkinDesigns.filter((d) => d.room_id === roomId && d.state === "active")
        .map((d) => ({ design_id: d.design_id, title: d.title, cadence_hint: d.cadence_hint }));
    }

    // ── vy_room_checkin (design lookup + insert via optIn's own SELECT-INSERT) ─
    if (has("insert into vy_room_checkin") && has("from vy_room_checkin_design d")) {
      const [id, roomId, personId, followerId, designId, , days, time, tz, nextDue, qf, qt] = params;
      const d = state.checkinDesigns.find((x) => x.design_id === String(designId) && x.room_id === String(roomId) && x.state === "active");
      if (!d) return [];
      const row = {
        checkin_id: String(id), room_id: String(roomId), person_id: String(personId), follower_id: String(followerId),
        design_id: d.design_id, days_of_week: days, local_time: time, timezone: tz, next_due_at: nextDue,
        quiet_from: qf, quiet_to: qt, state: "active",
      };
      state.checkins.push(row);
      return [{ ...row }];
    }
    if (has("vy_room_checkin_delivery") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select count(*)::int as n")) {
        return [{ n: state.checkinDeliveries.filter((d) => d.room_id === roomId && d.person_id === personId).length }];
      }
      if (has("delete from")) {
        const gone = state.checkinDeliveries.filter((d) => d.room_id === roomId && d.person_id === personId);
        state.checkinDeliveries = state.checkinDeliveries.filter((d) => !gone.includes(d));
        return gone.map(() => ({ gone: 1 }));
      }
    }
    if (has("vy_room_checkin") && !has("vy_room_checkin_delivery") && !has("vy_room_checkin_design") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select")) return state.checkins.filter((c) => c.room_id === roomId && c.person_id === personId);
      if (has("delete from")) {
        const gone = state.checkins.filter((c) => c.room_id === roomId && c.person_id === personId);
        state.checkins = state.checkins.filter((c) => !gone.includes(c));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_pulse_optin — roomExport's/roomForget's OWN room+person shape,
    //    distinct from pulseDb's own optin_id-keyed toggle statements ────────
    if (has("vy_room_pulse_optin") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select")) return state.pulseOptins.filter((o) => o.room_id === roomId && o.person_id === personId);
      if (has("delete from")) {
        const gone = state.pulseOptins.filter((o) => o.room_id === roomId && o.person_id === personId);
        state.pulseOptins = state.pulseOptins.filter((o) => !gone.includes(o));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_follower_channel — roomForget's/roomExport's OWN room+person
    //    shape, distinct from the base fixture's channel_ref-keyed shapes ────
    if (has("vy_room_follower_channel") && has("room_id = ($1)::uuid and person_id = ($2)::uuid")) {
      const [roomId, personId] = p;
      if (has("select")) return state.channelMap.filter((c) => c.room_id === roomId && c.person_id === personId);
      if (has("delete from")) {
        const gone = state.channelMap.filter((c) => c.room_id === roomId && c.person_id === personId);
        state.channelMap = state.channelMap.filter((c) => !gone.includes(c));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_handoff — roomForget's/roomExport's OWN room+person shape,
    //    distinct from handoffDb's own hash-gated queue reads ──────────────
    if (has("vy_room_handoff") && has("room_id = ($1)::uuid and person_id = ($2)::uuid") && !has("payload_sha256")) {
      const [roomId, personId] = p;
      if (has("select")) return state.roomHandoffs.filter((h) => h.room_id === roomId && h.person_id === personId);
      if (has("delete from")) {
        const gone = state.roomHandoffs.filter((h) => h.room_id === roomId && h.person_id === personId);
        state.roomHandoffs = state.roomHandoffs.filter((h) => !gone.includes(h));
        return gone.map(() => ({ gone: 1 }));
      }
    }

    // ── vy_room_forget_receipt (migration 090) ──────────────────────────────
    // ── vy_review_never_rule — `loadNeverRules`'s own SELECT (api/_review-
    //    queue.js), the read `roomSay`/`roomTaste`/the check-in sweep make per
    //    reply since 2026-09-05. Owner lane, no person column: keyed by the
    //    Room's replica and owner only. ──────────────────────────────────────
    if (has("from vy_review_never_rule n") && has("n.revoked_at is null")) {
      const [replicaIdValue, ownerUserId] = p;
      return (state.neverRules || [])
        .filter((n) => n.replica_id === replicaIdValue && n.owner_user_id === ownerUserId && !n.revoked_at)
        .map((n) => ({ rule_id: n.rule_id, pattern: n.pattern, revoked_at: null }));
    }

    if (has("insert into vy_room_forget_receipt")) {
      const [receiptId, roomId, personHash, policyVersion, counts, issuedAt] = params;
      state.forgetReceipts.push({
        receipt_id: String(receiptId), room_id: String(roomId), person_hash: String(personHash),
        policy_version: Number(policyVersion), counts: JSON.parse(counts), issued_at: String(issuedAt),
      });
      return [];
    }

    return base(sql, params);
  };
}

export function worldDb(state) {
  const base = fakeDb(state);
  const pulseLayer = pulseDb(state, base);
  const handoffLayer = handoffDb(state, pulseLayer); // narrower match, tried before pulseLayer
  return worldExtraDb(state, handoffLayer); // this file's own shapes, tried first of all
}

/** Every table `roomForget` might have left a row in, for ONE (room,person) —
 *  `evals/room-export/run.mjs`'s own `survivorTables`, generalized across the
 *  world's own extra state arrays rather than one seeded scenario's. A table
 *  this particular follower never populated simply contributes nothing to
 *  find (harmless); the ones the world DID populate for them (thread,
 *  pulse-optin — every membership gets both — plus whichever of checkin/
 *  whatsapp/push/telegram/handoff their own transport or pick assigned) are
 *  what makes each call of this function non-vacuous. */
export function survivorsFor(state, roomId, personId) {
  const survivors = [];
  if (state.threads.some((t) => t.room_id === roomId && t.person_id === personId)) survivors.push("vy_room_thread");
  if (state.followers.some((f) => f.room_id === roomId && f.person_id === personId)) survivors.push("vy_room_follower");
  if (state.facts.some((f) => f.person_id === personId && ROOM_DEFS.some((r) => r.room_id === roomId && r.agent_id === f.agent_id))) survivors.push("vy_fact");
  if (state.pulseOptins.some((o) => o.room_id === roomId && o.person_id === personId)) survivors.push("vy_room_pulse_optin");
  if (state.checkins.some((c) => c.room_id === roomId && c.person_id === personId)) survivors.push("vy_room_checkin");
  if (state.waOptins.some((w) => w.room_id === roomId && w.person_id === personId)) survivors.push("vy_room_follower_whatsapp");
  if (state.pushSubs.some((p) => p.room_id === roomId && p.person_id === personId)) survivors.push("vy_room_push_subscription");
  if (state.channelMap.some((c) => c.room_id === roomId && c.person_id === personId)) survivors.push("vy_room_follower_channel");
  if (state.roomHandoffs.some((h) => h.room_id === roomId && h.person_id === personId)) survivors.push("vy_room_handoff");
  return survivors;
}

// ═════════════════════════════════════════════════════════════════════════
// THE WORLD RUN — drives every lane through the REAL follower/creator lane
// modules. Returns raw findings; `run.mjs`'s new section does the `ok()`s.
// ═════════════════════════════════════════════════════════════════════════

export async function runFullWorld(REPO) {
  const world = buildWorld();
  const state = freshWorldState();
  const db = worldDb(state);

  // Five Rooms, ONE compiled bundle: `loadFixtureAgent`'s own `loadAgent` is
  // bound to a single fixed SLUG ("anjali"), so this world builds its own
  // multi-slug loader over the SAME `engine`/`SHEET` it exposes rather than
  // bundling five times over — `evals/room-export/run.mjs`'s own
  // `loadAgentAnySlug` precedent (layer 4 there), generalized from "any slug"
  // to "one of these five, each with its own display name."
  const { loadFixtureAgent } = await import(pathToFileURL(join(REPO, "evals/room/fixtures.mjs")).href);
  const { engine, SHEET } = await loadFixtureAgent(REPO);
  const loadAgent = async (slug) => {
    const r = ROOM_DEFS.find((x) => x.slug === slug);
    if (!r) throw new Error("teacher_sheet_unavailable");
    const sheet = { ...SHEET, name: r.slug, slug: r.slug };
    return { module: engine.sheetToModule(sheet), sheet, row: {} };
  };

  const room = await import(pathToFileURL(join(REPO, "api/_room-surface.js")).href);
  const { joinRoom, roomSay, createThread, roomExport, roomForget, roomExportManifest, roomStats, bindTelegramChannel, telegramChannelRoom } = room;
  const { setOptIn, setTopics, computeSnapshot, readPulse } = await import(pathToFileURL(join(REPO, "api/_pulse.js")).href);
  const { setHandoffConfig, sendHandoffRequest, handoffQueue } = await import(pathToFileURL(join(REPO, "api/_handoff.js")).href);
  const wa = await import(pathToFileURL(join(REPO, "api/_room-whatsapp.js")).href);
  const push = await import(pathToFileURL(join(REPO, "api/_room-push.js")).href);
  const CI = await import(pathToFileURL(join(REPO, "api/_checkins.js")).href);

  const env = { ...process.env, ROOM_WHATSAPP_TEMPLATE_APPROVED: "1" };
  const FULL_DEPS = { loadAgent, personTables: async () => PERSON_TABLES, tableApplied: async () => true, env };

  // ── setup: one Pulse topic, one check-in design, handoff enabled — per Room
  for (const r of ROOM_DEFS) {
    await setTopics(db, r.owner, r.replica_id, ["progress"]);
    await CI.createDesign(db, r.owner, r.replica_id, { title: "weekly nudge", promptShape: "ask how it is going", cadenceHint: "weekly" });
    await setHandoffConfig(db, r.owner, r.replica_id, { enabled: true, monthlyCap: 50 });
  }

  // ── join every membership, seed one long-term fact per membership ────────
  const sessionOf = new Map(); // `${followerIdx}:${roomIdx}` -> session
  const followerIdOf = new Map();
  for (const m of world.memberships) {
    const uid = m.uidOverride || fuid(m.followerIdx);
    const r = ROOM_DEFS[m.roomIdx];
    const joined = await joinRoom(db, { slug: r.slug, authUserId: uid, ageAttested: true, memoryConsent: true }, { loadAgent });
    sessionOf.set(`${m.followerIdx}:${m.roomIdx}`, joined.session);
    const followerRow = state.followers.find((f) => f.room_id === r.room_id && f.agent_id === r.agent_id &&
      state.accounts.some((a) => a.auth_user_id === uid && a.person_id === f.person_id));
    followerIdOf.set(`${m.followerIdx}:${m.roomIdx}`, followerRow?.follower_id);
    const personId = followerRow?.person_id;
    if (personId) state.facts.push({ person_id: personId, agent_id: r.agent_id, body: `note: ${factToken(m.followerIdx, m.roomIdx)}` });
  }

  // ── transports and per-membership extra lanes, RNG-independent (deterministic
  //    per follower via `world.followers[i].transport`) ─────────────────────
  const rng = makeRng(world.seed + 1);
  const paidFollowers = new Set();
  for (const f of world.followers) {
    const key = `${f.idx}:${f.primaryRoom}`;
    const r = ROOM_DEFS[f.primaryRoom];
    const session = sessionOf.get(key);
    const followerId = followerIdOf.get(key);
    if (f.transport === "telegram") {
      const followerRow = state.followers.find((x) => x.follower_id === followerId);
      await bindTelegramChannel(db, { roomId: r.room_id, personId: followerRow.person_id, followerId, channelRef: `tg-${f.idx}` }, {});
    } else if (f.transport === "whatsapp") {
      state.followers.find((x) => x.follower_id === followerId).tier = "paid";
      paidFollowers.add(f.idx);
      await wa.optIn(db, { session, phone: `+9190000${String(f.idx).padStart(5, "0")}` }, { env, loadAgent });
    } else if (f.transport === "push") {
      await push.setSubscription(db, {
        session, endpoint: `https://push.example/${f.idx}`,
        p256dh: "A".repeat(43) + "b", auth: "B".repeat(16),
      }, { loadAgent });
    }
  }
  // A separate paid-tier subset for check-ins (not tied to transport) — WS-R16's
  // own gate: paid + memory-consenting, both already true from `joinRoom` above.
  const checkinPicks = pickN(world.followers.map((f) => f.idx), 10, rng);
  for (const i of checkinPicks) {
    const f = world.followers[i];
    const key = `${i}:${f.primaryRoom}`;
    const followerId = followerIdOf.get(key);
    state.followers.find((x) => x.follower_id === followerId).tier = "paid";
    paidFollowers.add(i);
    const r = ROOM_DEFS[f.primaryRoom];
    const design = state.checkinDesigns.find((d) => d.room_id === r.room_id);
    await CI.optIn(db, {
      session: sessionOf.get(key), designId: design.design_id,
      daysOfWeek: [1, 3, 5], localTime: "09:00", timezone: "Asia/Kolkata",
    }, { loadAgent });
  }

  // ── every membership: a thread + a Pulse opt-in (extends layer 5 to the
  //    whole world), and a subset send a Handoff request (extends layer 6) ──
  const threadOf = new Map();
  for (const m of world.memberships) {
    const key = `${m.followerIdx}:${m.roomIdx}`;
    const session = sessionOf.get(key);
    const followerRow = state.followers.find((f) => f.follower_id === followerIdOf.get(key));
    const thread = await createThread(db, {
      roomId: followerRow.room_id, personId: followerRow.person_id, agentId: followerRow.agent_id,
      title: `progress ${threadToken(m.followerIdx, m.roomIdx)}`,
    });
    threadOf.set(key, thread);
    await setOptIn(db, { session, threadId: thread.thread_id }, { loadAgent });
  }
  const handoffPicks = pickN(world.memberships.map((_, i) => i), 15, rng);
  for (const mi of handoffPicks) {
    const m = world.memberships[mi];
    const key = `${m.followerIdx}:${m.roomIdx}`;
    const text = `please help with: ${handoffToken(m.followerIdx, m.roomIdx)}`;
    await sendHandoffRequest(db, { session: sessionOf.get(key), payloadText: text, payloadSha256: sha256Hex(text) }, { loadAgent });
  }

  // ── THE CHAT SWEEP — every membership x T turns, GLOBALLY SHUFFLED order ──
  const scopedRecall = async (personId, agentId) => state.facts.filter((f) => f.person_id === personId && f.agent_id === agentId);
  const turnPlan = [];
  for (const m of world.memberships) for (let t = 0; t < TURNS_PER_MEMBERSHIP; t++) turnPlan.push({ ...m, t });
  const shuffledPlan = shuffle(turnPlan, rng);

  const compiledBy = new Map(); // `${followerIdx}:${roomIdx}` -> [{turn, system, facts}]
  const turnLogs = new Map(); // per-membership device log, so shuffled order does not corrupt history
  for (const step of shuffledPlan) {
    const key = `${step.followerIdx}:${step.roomIdx}`;
    if (!turnLogs.has(key)) turnLogs.set(key, new Map());
    const log = turnLogs.get(key);
    let capturedFacts = null;
    const memory = {
      openEpisode: async () => ({ id: 1, extended: false }),
      logTurn: async ({ device, role, content }) => {
        if (!log.has(device)) log.set(device, []);
        log.get(device).push({ role, content });
      },
      history: async (device) => log.get(device) || [],
      recall: async (personId, agentId) => {
        capturedFacts = await scopedRecall(personId, agentId);
        return capturedFacts;
      },
    };
    let compiled = null;
    const session = sessionOf.get(key);
    const turn = await roomSay(db, { session, message: `q${step.t}: ${msgToken(step.followerIdx, step.roomIdx, step.t)}` },
      { loadAgent, memory, reply: (c) => { compiled = c; return "noted."; } });
    sessionOf.set(key, turn.session);
    if (!compiledBy.has(key)) compiledBy.set(key, []);
    compiledBy.get(key).push({ turn: step.t, system: compiled?.system ?? "", facts: capturedFacts ?? [] });
  }

  return {
    world, state, db, deps: FULL_DEPS, loadAgent,
    room, pulse: { setOptIn, computeSnapshot, readPulse }, checkins: CI, whatsapp: wa, pushApi: push,
    sessionOf, followerIdOf, threadOf, compiledBy, paidFollowers, checkinPicks: new Set(checkinPicks),
    roomExport, roomForget, roomExportManifest, roomStats, telegramChannelRoom,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// STATIC REACH LAYER — generalizes `run.mjs`'s own layer 1c to EVERY
// PERSON_TABLES entry carrying room_id+person_id (`evals/room-export/run.mjs`'s
// own `roomPersonEntries`, restated here rather than imported since that file
// exports no reusable function — a fresh, tiny copy is cheaper than a shared
// export nobody else needs yet). Files are discovered by GREP over the raw
// source (the workstream brief's own words), never hand-typed, so a NEW file
// that starts touching a table is caught the day it ships without anyone
// having remembered to add it here first — only the two closed ROLE sets
// below (who may read/write in full, who may read only an aggregate) are
// hand-maintained, exactly `run.mjs`'s own ALLOWED/AGGREGATE_ONLY precedent.
// ═════════════════════════════════════════════════════════════════════════

function roomPersonEntries(personTables, schemaMap) {
  return personTables.map((t) => t.table).filter((name) => {
    const cols = schemaMap[name];
    return cols && "room_id" in cols && "person_id" in cols;
  });
}

/** Every table this layer knows about, and who may touch it in full. A file
 *  NOT in `owners` gets the SAME_LINE bar: every line of its source naming
 *  the table must be a comment, a delete, or a bare manifest string entry —
 *  `run.mjs`'s own Handoff-lane precedent (layer 6a), generalized. A file in
 *  `aggregateOnly` may additionally carry ONE OR MORE statements naming the
 *  table whose own select list is count/sum/min-only, never a raw column —
 *  the SAME check `run.mjs`'s own layer 1c already runs, reused here as a
 *  named function so it is not a THIRD hand-rolled copy of the same logic. */
const TABLE_ROLES = {
  vy_room_follower_whatsapp: { owners: ["_room-whatsapp.js", "_room-surface.js"] },
  vy_room_checkin: { owners: ["_checkins.js", "_room-surface.js"], aggregateOnly: ["_ops.js"] },
  vy_room_checkin_delivery: { owners: ["_checkins.js", "_room-surface.js"], aggregateOnly: ["_ops.js"] },
  vy_room_push_subscription: { owners: ["_room-push.js", "_room-surface.js"] },
  vy_room_pulse_optin: { owners: ["_pulse.js", "_room-surface.js"] },
  vy_room_handoff: { owners: ["_handoff.js", "_room-surface.js"] },
  vy_room_follower_channel: { owners: ["_room-surface.js"] },
  // WS-R74 (migration 118): api/_creator-push.js's own "messages this week"
  // read, `_ops.js`'s own 24h `sum(turns)` read widened to 7 days - the
  // identical aggregate-only shape (no content column, no `select *`).
  vy_room_follower_day: { owners: ["_room-surface.js"], aggregateOnly: ["_ops.js", "_phase-gate.js", "_room-cohorts.js", "_creator-push.js"] },
  vy_room_voice_usage: { owners: ["_room-surface.js"] },
  // `_renewals.js` reads a follower's OWN subscription row back to THAT
  // follower (a reminder, never creator-facing) — `context/rejected.md`'s
  // `ws-r37-room-locale-does-not-exist...` entry: "admitted to the leak
  // battery's ALLOWED set for that one-row-back-to-its-own-follower shape" —
  // an owner here, not an aggregate-only reader.
  vy_room_subscription: { owners: ["_payments.js", "_room-surface.js", "_renewals.js"], aggregateOnly: ["_ops.js"] },
  vy_room_upgrade_offer: { owners: ["_payments.js", "_room-surface.js", "_phase-gate.js"] },
  // `_creator-export.js` (WS-R70) reads the CREATOR-subject slice only
  // (`subject_kind = 'creator'` and the owner in the WHERE), back to that
  // owner; MIXED_LANE_TABLES in that file names why this table is both.
  vy_renewal_reminder: { owners: ["_renewals.js", "_room-surface.js", "_creator-export.js"] },
  // WS-R67 (migration 116), added at the merge the day this layer first met
  // it: the follower's OWN copy of a flag (person + follower id + the reply
  // hash, never the reply text), written and read by `_room-surface.js`
  // alone; the creator-facing twin `vy_room_reply_flag` carries no person
  // column and is layer 9's own subject.
  vy_room_follower_reply_flag: { owners: ["_room-surface.js"] },
  // WS-R86 (migration 123). Referrals: no person column at all, so this
  // is not one of `roomPersonEntries`' own auto-discovered tables — added
  // here BY NAME anyway, deliberately, so the SAME generic static reach
  // layer that already guards every person+room table also guards this
  // room-aggregate one, `vy_room_arrival`'s own precedent restated as a
  // TABLE_ROLES entry rather than a second, bespoke scan (this
  // workstream's own layer 13, evals/room-leak/run.mjs). `_room-surface.js`
  // writes the referral (the self-referral WHERE), reads it back only to
  // recompute ONE follower's OWN count (`roomExport`), and mints the link
  // (`roomReferralLink`) — all three the SAME file, an owner.
  // `_replica-full-erasure.js` deletes it, child before parent.
  // `_funnel.js`'s `friendsBroughtThisWeek` is the one aggregate reader —
  // `count(*)`, never `referrer_hash` itself (the negative control below
  // this layer proves a reader that DOES select the hash is caught).
  vy_room_referral: { owners: ["_room-surface.js", "_replica-full-erasure.js"], aggregateOnly: ["_funnel.js"] },
  // WS-R100 (migration 126). The follower's receipt: NOT one of
  // `roomPersonEntries`' own auto-discovered tables either, on the same
  // technicality `vy_room_referral` above states for a different reason -
  // this one carries both `room_id` and `person_id`, but it is not a
  // `PERSON_TABLES` entry at all (`scripts/relcheck.mjs`'s `EXEMPT` map
  // carries the written reason: an account-wide forget NULLS `person_id`
  // here rather than deleting the row). Added here BY NAME anyway,
  // `vy_room_referral`'s own precedent restated: the generic static reach
  // layer guards it exactly as it guards every PERSON_TABLES-derived table.
  // `_room-surface.js` reads a follower's own receipts back to them
  // (`roomReceipt`/`roomReceipts`) and lists it in `ROOM_EXPORT_EXTRA`;
  // `_payments.js` writes it (`issueFollowerReceipt`, the webhook's own
  // call); `memory.js` nulls its `person_id` on a whole-account wipe;
  // `_replica-full-erasure.js` deletes it by name on a full Room erasure.
  vy_receipt: { owners: ["_room-surface.js", "_payments.js", "memory.js", "_replica-full-erasure.js"] },
  // WS-R104 (migration 128). Which WhatsApp phone currently means this Room,
  // for this follower - `vy_room_follower_channel`'s own two-owner shape
  // (the new transport file plus `_room-surface.js`'s own export/forget
  // reads) restated one transport over. `_replica-full-erasure.js` is
  // deliberately ABSENT from this owner list, on `vy_room_follower_channel`'s
  // and `vy_room_follower_whatsapp`'s own precedent (neither appears there
  // either): the table carries a real `room_id references vy_room(room_id)
  // on delete cascade` (migration 128's own header), so a full replica
  // erasure reaches it through that FK alone, the identical posture this
  // codebase already ships for its two closest siblings
  // (`context/decisions.md#ws-r104-no-explicit-replica-erasure-backstop-for-
  // the-whatsapp-chat-pointer`).
  vy_room_follower_whatsapp_chat: { owners: ["_room-whatsapp-chat.js", "_room-surface.js"] },
  // WS-R130 (migration 133). The referral reward's own identity link — NOT
  // one of `roomPersonEntries`' own auto-discovered tables (its identity
  // columns are `referrer_follower_id`/`referrer_person_id`/`referred_
  // follower_id`, never the literal `person_id` that loop's generic
  // discovery keys off), `vy_room_referral`'s own precedent restated for a
  // table that DOES name a real referrer. `_room-surface.js` writes it
  // (`joinRoom`'s own credit write) and reads a follower's own progress
  // back to them (`roomReferralProgress`); `_payments.js` reads it to find
  // a referrer and count their progress (`maybeGrantReferralReward`);
  // `memory.js` nulls `referrer_person_id` on a whole-account wipe.
  // `_replica-full-erasure.js` deletes it by name, child before parent.
  // No aggregate-only reader anywhere — unlike `vy_room_referral`'s own
  // n>=5-floored creator-facing count, nothing about this table is ever
  // shown to a creator at all.
  vy_room_referral_credit: { owners: ["_room-surface.js", "_payments.js", "memory.js", "_replica-full-erasure.js"] },
  // WS-R130 (migration 133). The grant itself — `vy_room_referral_credit`'s
  // own two-owner-plus-erasure shape restated one table over, with the
  // SAME reasoning: a real `referrer_person_id`, no creator-facing reader.
  vy_room_referral_reward: { owners: ["_room-surface.js", "_payments.js", "memory.js", "_replica-full-erasure.js"] },
};
// Every line naming a guarded table in a file that is neither an owner nor an
// aggregate-only reader must be ONE of: a comment (block or line), a DELETE,
// a bare manifest string/property entry, or an `isTableAppliedFor` guard —
// `run.mjs`'s own Handoff-lane (6a) and vy_room_arrival precedents,
// generalized so it applies by DEFAULT rather than to a hand-picked file
// list. This is what lets `api/_incidents.js`/`api/_room-telegram.js`/
// `api/_phase-gate.js`'s own PROSE mentions of a guarded table (naming it
// only to explain what a neighbouring function does NOT do,
// `context/rejected.md#ws-r28-leak-battery-scanner-matches-prose-not-only-sql`'s
// own class of near-miss) pass without either file needing a hand-typed
// admission — the same forgiveness those three files' authors relied on
// without this check existing yet.
const SAFE_LINE = new RegExp(
  "delete from|^\\s*//|^\\s*\\*|^\\s*--|isTableAppliedFor\\(deps\\)\\(|" +
    "table:\\s*\"vy_|^\\s*\"vy_[a-z_]+\",?\\s*$|deleted\\.vy_[a-z_]+\\s*=",
);

// WS-R104. `src.includes(table)`/`line.includes(table)` below used to be a
// PLAIN substring test - correct for every table name in this manifest until
// migration 128 added `vy_room_follower_whatsapp_chat`, which is itself a
// SUPERSTRING of the already-tracked `vy_room_follower_whatsapp` (WS-R29).
// Under the old plain-substring test, `api/_room-whatsapp-chat.js` - a file
// that OWNS `vy_room_follower_whatsapp_chat` and never once reads or writes
// `vy_room_follower_whatsapp` - was reported as touching THAT table's own
// role (no owner entry for it there) purely because the shorter name sits
// inside the longer one on every line, `context/rejected.md#ws-r28-leak-
// battery-scanner-matches-prose-not-only-sql`'s own class of near-miss,
// found by name rather than guessed at. `tableTouch` makes every "does this
// source touch this table" test word-boundary aware — `_` counts as a word
// character in JS regex, so `\bvy_room_follower_whatsapp\b` correctly
// refuses to match inside `vy_room_follower_whatsapp_chat` (no boundary
// between the shared `p` and the following `_`) while still matching every
// real, standalone mention. Table names in this manifest are closed
// identifiers (`[a-z0-9_]+`, no regex metacharacters), so interpolating one
// straight into a `RegExp` is safe.
const tableTouchRe = (table) => new RegExp(`\\b${table}\\b`);
const tableTouch = (text, table) => tableTouchRe(table).test(text);

/** Raw follower/creator content this codebase never puts on a creator- or
 *  platform-facing surface — the actual threat this layer guards against,
 *  checked directly rather than insisting every legitimate aggregate read
 *  match one narrow `count/sum/min` shape (`date_trunc`, `exists(select 1
 *  ...)` and multi-CTE window functions are all real, already-shipped,
 *  already-suite-proven shapes this repo's aggregate readers use — a check
 *  that could not tell those from a leak would be checking a stricter world
 *  than production and would have failed on today's tree before it ever
 *  caught a real bug, `sound-gate-proved-by-silence` read the other way). */
const CONTENT_COLUMNS = [
  "title", "content", "message_text", "payload_text", "reply_text",
  "phone_e164", "local_time", "timezone", "quiet_from", "quiet_to",
  "days_of_week", "endpoint", "p256dh", "auth\\b",
  // WS-R86 (migration 123). `vy_room_referral.referrer_hash` is the ONLY
  // thing in that table that ties a row to a follower — it carries no
  // content in the ordinary sense, but selecting it out to any reader
  // besides the two owners (`_room-surface.js`'s write and
  // self-recomputation, `_replica-full-erasure.js`'s delete) IS the leak
  // this table exists to make structurally impossible, so it is guarded
  // exactly like a content column would be.
  "referrer_hash",
  // WS-R104 (migration 128). `vy_room_follower_whatsapp_chat.phone_hash` is
  // the ONLY thing in that table that ties a row to a specific phone —
  // `referrer_hash`'s own reasoning restated one table over: it carries no
  // digits (the raw number is never written at all, migration 128's own
  // header), but a stable pseudonymous handle selected out to a reader
  // besides its two named owners would still be the correlation this table
  // exists to avoid, so it is guarded exactly like a content column would be.
  "phone_hash",
  // WS-R130 (migration 133). `vy_room_referral_credit`/`vy_room_referral_
  // reward`'s own identity columns — unlike `referrer_hash`/`phone_hash`
  // above, these are the RAW identity (a `follower_id`/`person_id`), never
  // a hash, so guarding them here is even more load-bearing: the whole
  // reason a reward needs a real referrer at all (this migration's own
  // header) makes a leak of these columns to any reader besides the two
  // named owners the exact thing `vy_room_referral`'s hash-only design
  // exists to prevent one table over.
  "referrer_follower_id", "referrer_person_id", "referred_follower_id",
];
const CONTENT_COLUMN_RE = new RegExp("\\b(" + CONTENT_COLUMNS.join("|") + ")\\b", "i");

function contentColumnLeaks(src, table) {
  const stmts = (src.match(new RegExp("`[^`]*" + table + "[^`]*`", "g")) || [])
    .filter((st) => new RegExp("\\bfrom\\s+" + table + "\\b", "i").test(st));
  if (!stmts.length) return ["no-statement-found"];
  const problems = [];
  for (const st of stmts) {
    const selectList = (st.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
    if (/select\s*\*/i.test(st.slice(0, 20))) problems.push("select-star");
    if (CONTENT_COLUMN_RE.test(selectList)) problems.push("content-column-selected");
  }
  return problems;
}

/** Returns `{ table -> [problem strings] }`. Empty for every table means the
 *  whole world is clean; the negative control below proves this function
 *  actually catches something rather than being vacuously permissive. */
export function staticReachProblems(REPO, tables = TABLE_ROLES) {
  const apiDir = join(REPO, "api");
  const files = fs.readdirSync(apiDir).filter((f) => f.endsWith(".js"));
  const problems = {};
  for (const [table, role] of Object.entries(tables)) {
    const owners = new Set(role.owners || []);
    const aggregateOnly = new Set(role.aggregateOnly || []);
    const found = [];
    for (const f of files) {
      const src = fs.readFileSync(join(apiDir, f), "utf8");
      if (!tableTouch(src, table)) continue;
      found.push(f);
      if (owners.has(f)) continue;
      if (aggregateOnly.has(f)) {
        const probs = contentColumnLeaks(src, table);
        if (probs.length) problems[table] = [...(problems[table] || []), ...probs.map((p) => `${f}:${p}`)];
        continue;
      }
      const badLines = src.split("\n").filter((l) => tableTouch(l, table) && !SAFE_LINE.test(l.trim()));
      if (badLines.length) problems[table] = [...(problems[table] || []), `${f}:unsafe-line(${badLines.length})`];
    }
    if (!found.length) problems[table] = [...(problems[table] || []), "no-file-touches-this-table-at-all"];
  }
  return problems;
}

/** Applies the SAME classification to an arbitrary {filename, source} pair
 *  instead of the real `api/` directory — the negative control's own seam,
 *  so "a writer added to a temp copy of a module" never has to touch a real
 *  file on disk (`evals/room-export/run.mjs`'s own struck-copy technique
 *  writes a real temp .mjs; this check is pure source-text classification
 *  and needs no import, so a string is enough and safer — nothing to clean
 *  up, nothing a concurrent worktree could collide with). */
export function classifyOneFile(filename, source, table, tables = TABLE_ROLES) {
  const role = tables[table];
  if (!role) throw new Error(`no TABLE_ROLES entry for ${table}`);
  if (!tableTouch(source, table)) return { touches: false, problems: [] };
  if ((role.owners || []).includes(filename)) return { touches: true, problems: [] };
  if ((role.aggregateOnly || []).includes(filename)) {
    return { touches: true, problems: contentColumnLeaks(source, table) };
  }
  const badLines = source.split("\n").filter((l) => tableTouch(l, table) && !SAFE_LINE.test(l.trim()));
  return { touches: true, problems: badLines.length ? [`unsafe-line(${badLines.length})`] : [] };
}

/** The world's OWN discovery of which tables actually need a role above —
 *  every PERSON_TABLES entry with room_id+person_id in the checked-in DDL,
 *  compared against `TABLE_ROLES`'s own keys. A table added to PERSON_TABLES
 *  without a matching entry here is a real gap this function surfaces. */
// `vy_room_thread`/`vy_room_follower` are already this gate's own layer 1c
// (the ALLOWED/AGGREGATE_ONLY/TIER_WRITE_ONLY sets earlier in `run.mjs`) —
// excluded here so this layer never disagrees with that one about who may
// touch them, rather than re-deriving a second, possibly-drifting opinion.
const ALREADY_COVERED_BY_LAYER_1C = new Set(["vy_room_thread", "vy_room_follower"]);

export function undeclaredRoomPersonTables(REPO) {
  const schema = loadSchema(REPO);
  const entries = roomPersonEntries(PERSON_TABLES, schema);
  return entries.filter((t) => !(t in TABLE_ROLES) && !ALREADY_COVERED_BY_LAYER_1C.has(t));
}

export { TABLE_ROLES, roomPersonEntries, roomForgetReceiptHash };
