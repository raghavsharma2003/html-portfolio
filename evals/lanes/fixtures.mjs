// Fixtures for the lane-parity gate: EVERY store has content.
//
// That is the whole trick. A block that renders nothing because its store is
// empty is indistinguishable from a block that renders nothing because its
// lane never passed it — and the second one is `call-opens-with-amnesia`, the
// defect a paying tester found before any test did. So every store here is
// non-empty, and an empty render is therefore always a verdict about the LANE.
//
// ── ON THE SECOND-AGENT DIMENSION ────────────────────────────────────────
// Nothing in this file names the agent, quotes her, or encodes her voice. The
// compiler takes an `agent` module (SPEC-AGENT-LAYER §3) and defaults to the
// shipped one; these fixtures pass none, so what is asserted here is the OS
// layer — which blocks a lane carries — and not one persona's content. The
// gate greps this file to keep it that way (deep second-agent parity is
// WS-SPINE's eval, not this one).

export const NOW = Date.UTC(2026, 7, 23, 14, 0, 0);
export const DAY = 86_400_000;

let n = 0;
const id = () => `m${++n}`;
export const msg = (from, text, at, opts = {}) => ({
  id: id(), from, kind: opts.kind || "text", channel: opts.channel || "chat", text, at, ...opts,
});

/** Typed exchanges. */
function chatDay(atStart, pairs) {
  const out = [];
  let t = atStart;
  for (const [mine, hers] of pairs) {
    out.push(msg("me", mine, t));
    t += 40_000;
    out.push(msg("her", hers, t));
    t += 120_000;
  }
  return out;
}

/** A voice call: the callmark closes it, exactly as endCall writes it. */
function callDay(atStart, pairs, { watch = false } = {}) {
  const out = [];
  let t = atStart;
  for (const [mine, hers] of pairs) {
    out.push(msg("me", mine, t, { channel: "call", watch }));
    t += 20_000;
    out.push(msg("her", hers, t, { channel: "call", watch }));
    t += 30_000;
  }
  out.push(msg("me", "6:20", t, { channel: "call", kind: "callmark" }));
  return out;
}

/** Three months of a real relationship: facts, photos, a fight and a repair,
 *  daily traffic, a call yesterday, a screen share, and this morning's chat.
 *  A promise of hers sits near the end so T16 has something open. */
export function history(now = NOW) {
  const h = [];
  h.push(...chatDay(now - 25 * DAY, [
    ["suno, maine naukri change kar li", "omg congrats!! kab se"],
    ["next monday se join", "haan matlab finally"],
    ["mera dost bhi wahi hai, usne hi refer kiya", "acha, tumne pehle nahi bataya"],
  ]));
  h.push(msg("me", "dekho balcony se", now - 21 * DAY, { kind: "photo", photoUrl: "https://x/p1.jpg" }));
  h.push(msg("her", "wah kitna pretty", now - 21 * DAY + 60_000));
  h.push(...chatDay(now - 10 * DAY, [
    ["tum kabhi sunti hi nahi ho", "main sun rahi hu"],
    ["nahi ho, bas apni sunati ho", "ok"],
    ["sorry yaar, din kharab tha", "koi baat nahi, samajh sakti hu"],
  ]));
  for (let d = 9; d >= 2; d--) {
    h.push(...chatDay(now - d * DAY, [
      [`din kaisa tha ${d}`, "theek tha, tum batao"],
      ["bas kaam", "haan same"],
      ["khana kya khaya", "maggi, aur tum"],
    ]));
  }
  h.push(...callDay(now - 1 * DAY, [
    ["maine socha hai bike lunga next month", "acha kaunsi"],
    ["classic 350", "wahi jo tumne dikhayi thi"],
    ["haan wahi, EMI dekh raha hu", "budget kitna rakha hai"],
  ]));
  h.push(...callDay(now - 1 * DAY + 2 * 3600_000, [
    ["ye dekho ye video", "hahaha uske face pe expression"],
    ["na na aage dekho", "arre wo gir gayi"],
  ], { watch: true }));
  // her open promise — T16's store
  h.push(msg("her", "main tumhe kal wo photo bhejungi", now - 20 * 3600_000));
  // 12 minutes ago: inside the chat tail's 30-minute window and past T9's
  // 10-minute floor — the one gap both of those blocks can share.
  h.push(...chatDay(now - 12 * 60_000, [["uth gaya", "good morning"]]));
  return h;
}

export const user = { name: "R", vibe: ["someone to talk to"], facts: { city: "pune", work: "a broker" } };

export const relBundle = {
  relState: {
    person_id: "p1", honorific: "tum", cs_ratio: 0.5, cs_on_stress: "hi",
    trust: 0.62, rupture_open: true, repair_state: "repairing",
    ritual_density: 0.4, pacing_gap_s: 30, snapshot_ver: 1,
    updated_at: new Date(NOW - DAY).toISOString(),
  },
  lastHonorificMoveAt: null,
  lastRuptureMoveAt: new Date(NOW - 10 * DAY).toISOString(),
  warmEpisodesSinceRupture: 3,
  patterns: [{
    id: 1, person_id: "p1", moment: "stress", if_shape: "he goes quiet after work",
    then_note: "he answers in one word", self_in_relation: "she slows down", citations: [1],
    support_count: 4, distinct_days: 3, prompt_eligible: true, times_contradicted: 0,
    t_invalid: null, last_used: null,
  }],
  rituals: [{ person_id: "p1", key: "goodnight", last_at: new Date(NOW - DAY).toISOString(), count: 12, cold_last: false, citations: [1] }],
  homeRegion: "maharashtra",
  currency: [{ person_id: "p1", topic: "chai", kind: "food", last_used: null, uses: 3, citations: [1] }],
  weEpisodes: [
    { id: 11, summary: "they watched a reel together and laughed at the same frame", at: new Date(NOW - DAY).toISOString() },
    { id: 12, summary: "we planned the bike test ride for next month", at: new Date(NOW - 2 * DAY).toISOString() },
  ],
  phrases: [{ phrase: "bike-wali baat", gloss: "the running bike joke" }],
  phraseLedger: ["bike-wali baat"],
};

// Every row here clears its own renderer's gate, so a dark slot in the table
// is the wiring and never a thin fixture. `dim: "patience"` is not arbitrary:
// SELF_ARC_MOMENTS maps patience to moment "stress", which is the shape
// `latestUserText` below really produces through momentGate.
export const selfBundle = {
  texture: {
    agent_id: "a0000000-0000-4000-8000-000000000001",
    person_id: "p1", teasing: 0.18, humour: 0.22, media_rate: 0.31,
    words_median: 9, emoji_rate: 0.4, profanity: 0.03, nickname: "bandar",
    avoid: [], avoid_cites: [], n_turns: 210,
  },
  arc: [{
    id: 1, agent_id: "a0000000-0000-4000-8000-000000000001",
    dim: "patience", note: "waits out a long pause", from_note: "rushes the ending",
    citations: [1, 2, 3], span_days: 190, superseded_by: null,
    created_at: new Date(NOW - 3 * DAY).toISOString(),
  }],
  untold: [{
    id: 1, at: new Date(NOW - 5 * DAY).toISOString(),
    beat: "the landlord still has not called back", kind: "small", arc_key: "", media: [],
  }],
};

/** A live board, so T15 has a store. */
export const game = {
  kind: "ttt", herSide: "o", startedAt: NOW - 20 * 60_000, touchedAt: NOW - 60_000,
  game: {
    board: ["x", "o", "x", null, "o", null, null, null, null],
    played: [0, 1, 2, 4].map((cell, i) => ({ cell, by: i % 2 ? "o" : "x" })),
    status: { over: false, result: null, winner: null, turn: "x" },
  },
};

/** A finished game, so the activity ledger has a store. */
export const ledger = [{
  kind: "chess", startedAt: NOW - DAY, closedAt: NOW - DAY + 1800_000,
  summary: "a game of chess together on 22 aug — she won, by checkmate; the opening was the italian",
}];

/** What op:"recall" hands back — the graph half of T5. */
export const graphRecall =
  "RELEVANT TO WHAT THEY JUST SAID:\n- a friend (person, last came up 3 weeks ago): the one who referred him";

/** Her interior, non-empty so T1/T8 have a store. Real `Inner` shape — the
 *  gate resolves it through the real `innerContext`, so the watch lane's empty
 *  thread is a return value rather than a hardcoded "". */
export const inner = {
  at: NOW - 3 * 3600_000,
  lastAppraisedAt: NOW - 3 * 3600_000,
  thread: { text: "still stuck on the landlord thing", at: NOW - 3 * 3600_000, w: 0.7, sign: -1, told: false },
  wants: [{ id: "w1", text: "finish the deck before the weekend", born: NOW - 2 * DAY, due: NOW + 3 * DAY }],
  owed: [],
};

export const herLifeText = "she works at a design studio, her day ran long";
export const cultureNoteText = "a festival weekend is coming up in her city";

/** The live turn. Stress-shaped through the REAL momentGate ("stress",
 *  "deadline"), which is what makes T4's pattern (moment "stress") and T12's
 *  arc (dim "patience") reachable at all — a turn that evokes neither would
 *  leave both dark for a correct reason and the gate would measure nothing. */
export const latestUserText = "yaar aaj bahut stress hai, deadline kal hai";

/** THE TWO CLOCKS, and why there are two.
 *
 *  T1's gate is an ENTRY gap — `innerContext` allows a carried thread only
 *  when the last message is older than GAP_ENTRY_MS (45 min). The chat tail
 *  the call lanes carry has the opposite requirement: it renders turns from
 *  the last CHAT_TAIL_WINDOW_MS (30 min). No single clock satisfies both, so
 *  the interior is resolved at a gap-entry clock and the history stays fresh.
 *  Same rule as everything else in this file — each block is measured under a
 *  store that CAN produce it, so an empty render is always about the lane. */
export const GAP_ENTRY_LAST_MSG_AT = NOW - 3 * 3600_000;
