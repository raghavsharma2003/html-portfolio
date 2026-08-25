// Realistic log fixtures for the consolidation-quality gates (WS-SPINE).
//
// DATA ONLY. Nothing here touches the database or the network — the suite
// drives the REAL exported predicates from api/consolidate.js against these
// rows, so a passing gate is a statement about the shipping tree.
//
// WHY THESE THREE. Each one is shaped around a specific way this pipeline can
// be wrong, not around a happy path:
//
//   A  "the ordinary evening" — a normal chat stretch with real kin, a real
//      ritual, real address terms and a real recurring phrase. This is the
//      fixture that proves the pipeline can still SEE things; a precision
//      story with no recall arm is just a story about refusing.
//   B  "the friend's mother" — the trap. Every kin word in it belongs to
//      somebody who is not him, in the shapes people actually use. If any of
//      these becomes HIS kin, a user gets told about a mother who is not
//      theirs, by name, for months.
//   C  "the watch turn" — a chat stretch with `channel: "watch"` rows spliced
//      into it, carrying content that is deliberately, obviously fabricatable
//      as biography: a name, a diagnosis, a salary, a flight. If any of it
//      reaches a derivation, that is the P0-3 failure in its exact shape.
//
// The turn text is Hinglish because meera_log is (see api/consolidate.js's
// CORPUS_COMMON_PHRASES, half of which is Devanagari) — a fixture in clean
// English would exercise regexes that never see clean English in production.

let nextId = 5000;
const row = (role, channel, content, atMs) => ({
  id: nextId++,
  device_id: "d0000000-0000-4000-8000-000000000001",
  role,
  channel,
  kind: "text",
  content,
  at: new Date(atMs).toISOString(),
});

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1, 9, 0, 0);

// ── A: the ordinary evening ───────────────────────────────────────────────
// role 'me' is HIM (api/memory.js's opLog shape — 'me'/'her'), which is what
// every address-term and code-switch read in consolidate.js filters on.
export const FIXTURE_A = {
  name: "ordinary-evening",
  rows: [
    row("me", "chat", "aap kaisi ho aaj", T0),
    row("her", "chat", "theek hoon yaar, tum batao", T0 + 60_000),
    row("me", "chat", "meri maa ka phone aaya tha subah, Sunita ki tabiyat theek nahi thi", T0 + 120_000),
    row("her", "chat", "arre ab kaisi hain woh", T0 + 180_000),
    row("me", "chat", "ab theek hain, khana khaya kya aapne", T0 + 240_000),
    row("her", "chat", "abhi nahi, tum khao pehle", T0 + 300_000),
    row("me", "chat", "chai pe scene set karo", T0 + 360_000),
    row("me", "chat", "aap ko pata hai kal interview hai mera", T0 + DAY),
    row("her", "chat", "all the best, nervous ho", T0 + DAY + 60_000),
    row("me", "chat", "thodi si, chai pe scene set karo shaam ko", T0 + DAY + 120_000),
    row("me", "chat", "khana khaya kya", T0 + 2 * DAY),
    row("her", "chat", "haan abhi khaya", T0 + 2 * DAY + 60_000),
    row("me", "chat", "chai pe scene set karo phir", T0 + 2 * DAY + 120_000),
  ],
};

// ── B: the friend's mother (THE TRAP) ─────────────────────────────────────
// Five third-party kin mentions in five different shapes. Not one of them is
// his. A pipeline that writes any of these has learned a stranger's family.
export const FIXTURE_B = {
  name: "friends-mother-trap",
  rows: [
    row("me", "chat", "Rohit ki maa ka naam Kavita hai, unhone bulaya tha aaj", T0),
    row("her", "chat", "acha, gaye the", T0 + 60_000),
    row("me", "chat", "haan mere dost ki maa bahut acha khana banati hain", T0 + 120_000),
    row("me", "chat", "uski behen Priya bhi thi wahan", T0 + 180_000),
    row("her", "chat", "nice", T0 + 240_000),
    row("me", "chat", "his mother told me the recipe", T0 + 300_000),
    row("me", "chat", "boss ke papa retire ho gaye", T0 + 360_000),
  ],
  // The names a correct run must never file as his kin.
  forbiddenKinNames: ["kavita", "priya", "rohit"],
};

// ── C: the watch turn (P0-3) ──────────────────────────────────────────────
// The watch rows carry exactly the kind of content a derivation would love:
// specific, biographical, confidently phrased, and read off a SCREEN rather
// than said by anyone. `FABRICATABLE` is what the negative test greps for.
export const WATCH_FABRICATABLE = [
  "Dr Anjali Mehta — follow-up: chronic hepatitis, next appointment 14 Aug",
  "Offer letter: Base salary INR 42,00,000 per annum, joining 1 September",
  "Boarding pass ARJUN SHARMA BOM-LHR 22 Aug seat 14C",
];
export const FIXTURE_C = {
  name: "watch-spliced",
  rows: [
    row("me", "chat", "kya kar rahi ho", T0),
    row("her", "chat", "bore ho rahi hoon", T0 + 60_000),
    row("me", "watch", WATCH_FABRICATABLE[0], T0 + 120_000),
    row("me", "watch", WATCH_FABRICATABLE[1], T0 + 180_000),
    row("me", "chat", "screen share kar raha hoon", T0 + 240_000),
    row("her", "watch", WATCH_FABRICATABLE[2], T0 + 300_000),
    row("me", "chat", "aaj ka din lamba tha", T0 + 360_000),
  ],
};

// ── D: plain vocabulary, said constantly (WS-RECALL coordination) ─────────
//
// WS-RECALL removed `kaam` and `baat` from RECALL_STOP on 2026-08-23 because
// they are content-bearing — correct for RETRIEVAL, whose job is to match on
// what someone said. RECALL_STOP is also half of phrase capture's stoplist,
// whose job is the exact opposite: find the one string nobody else would say.
//
// So this fixture is the shape that change opened up. A man talks about work
// across five days, in the most ordinary Hinglish available, and NONE of it
// is a phrase they coined together. Every turn is `role: 'me'` and carries an
// `episode_id`, i.e. it is exactly what `capturePhrasesForPerson` scans.
//
// If any of this becomes a vy_phrase row, she starts saying "kaam ka
// pressure" back to him as if it were theirs. That is `recited-prompt`'s
// worst case with a database behind it: not a line she was handed, a line she
// claims to remember them inventing.
const workRow = (content, dayOffset) => ({
  ...row("me", "chat", content, T0 + dayOffset * DAY),
  episode_id: 800 + dayOffset,
});
export const FIXTURE_D = {
  name: "plain-vocabulary",
  rows: [
    workRow("aaj kaam bahut hai", 0),
    workRow("kaam ka pressure hai yaar", 0),
    workRow("baat ye hai ki time nahi mil raha", 0),
    workRow("aaj bhi kaam bahut hai", 1),
    workRow("office ka kaam khatam nahi ho raha", 1),
    workRow("baat ye hai ki der ho jati hai", 1),
    workRow("kaam ka pressure bahut hai", 2),
    workRow("ghar se kaam kar raha hoon", 2),
    workRow("baat ye hai ki free time nahi hai", 2),
    workRow("kaam bahut hai aaj bhi", 3),
    workRow("kaam ka pressure kam nahi hua", 3),
    workRow("office ka kaam late tak", 4),
    workRow("baat ye hai ki busy hoon", 4),
  ],
  // Nothing here is theirs. Not one gram.
  expectCandidates: 0,
};

export const FIXTURES = [FIXTURE_A, FIXTURE_B, FIXTURE_C, FIXTURE_D];

// ── E: the judgment writers' input (WS-JUDGEWORK) ─────────────────────────
//
// Trust/repair and pattern extraction do not read `meera_log` — they read
// FINALIZED EPISODES, which is a different shape and a different failure
// surface, and until now nothing in this tree drove either writer on one.
//
// Eight episodes over nine days, in the shape `fetchFreshEpisodesForPerson`
// and `fetchHistoryEpisodesForPerson` really return (id, log_from, log_to,
// started_at, summary, affect_tags, importance). Deliberately mixed:
//
//   - a genuine recurring regularity (work stress -> goes quiet, wants
//     distraction) across THREE episodes on THREE different days, which is
//     the only thing in here that should ever become a pattern;
//   - a real rupture and a real, explicit repair signal from HIM;
//   - a "friend betrayed me" episode — the conservatism trap WS-DEPTH's smoke
//     run checked by hand and nothing has checked since: a rupture in HIS
//     life is not a rupture between him and her;
//   - two episodes of ordinary warmth, which are not evidence of anything.
const ep = (id, dayOffset, summary, affect, importance = 0.4) => ({
  id,
  log_from: 6000 + id * 10,
  log_to: 6009 + id * 10,
  started_at: new Date(T0 + dayOffset * DAY).toISOString(),
  summary,
  affect_tags: affect.map((tag) => ({ tag })),
  importance,
});

export const FIXTURE_E = {
  name: "judgment-episodes",
  episodes: [
    ep(9001, 0, "long day at work, went quiet mid-conversation, wanted memes not questions", ["stress", "withdrawn"]),
    ep(9002, 1, "ordinary evening, chai, complained about the neighbours", ["warm"], 0.2),
    ep(9003, 3, "work deadline again, stopped replying for an hour, came back asking for a distraction", ["stress", "withdrawn"]),
    ep(9004, 4, "told her his friend betrayed a confidence at work, was hurt about it", ["hurt"], 0.6),
    ep(9005, 5, "snapped at her for asking twice about the interview, said she was pushing", ["conflict"], 0.7),
    ep(9006, 6, "quiet day, one-word replies, no explanation", ["withdrawn"], 0.3),
    ep(9007, 7, "said sorry for snapping, said he had been carrying work home", ["repair"], 0.7),
    ep(9008, 9, "third week of the same pressure, went quiet, asked for something stupid to watch", ["stress", "withdrawn"]),
  ],
  // Index -> id, so a fixture answer can be written in the model's own output
  // space (indices) and checked in the writer's (episode ids).
  idAt(i) {
    return this.episodes[i].id;
  },
};

/** Existing pattern rows for the same person, in `vy_pattern`'s own shape —
 *  what the dedupe/reinforce read returns. The stored row cites the first two
 *  work-stress episodes; the third one is what a later pass must be able to
 *  ADD, since that is the only path to `prompt_eligible`. */
export const FIXTURE_E_EXISTING = [
  {
    id: 5501,
    moment: "stress",
    if_shape: "work pressure builds",
    citations: [9001, 9003],
  },
];

// ── model answers, written the way this model really answers ──────────────
//
// Every one of these is a fixture of the PROMPT'S OUTPUT SHAPE, not of the
// writer's internals, so they keep meaning something if the acceptance layer
// is rewritten.

/** The grounded case: a real rupture, cited; a real repair signal from HIM,
 *  cited; a real trust move, cited. */
export const TR_GROUNDED = {
  trust_move: { present: true, direction: "increase", citations: [6], note: "owned the snap himself, unprompted" },
  rupture: { present: true, citations: [4], note: "snapped at her for asking about the interview" },
  repair_signal: { present: true, citations: [6], note: "apologised and named what it was about" },
};

/** The conservatism trap: the model reads episode 3 — his friend betraying a
 *  confidence — as a rupture. It is a rupture in HIS life, not between them.
 *  Nothing in the acceptance layer can tell the difference (that is the
 *  prompt's job), so this fixture exists to pin what the layer DOES do with
 *  it: write exactly one cited rupture and nothing else, never a trust move
 *  as well, and never an uncited anything. */
export const TR_FRIEND_BETRAYAL = {
  trust_move: { present: false, direction: "increase", citations: [], note: "" },
  rupture: { present: true, citations: [3], note: "friend betrayed a confidence at work" },
  repair_signal: { present: false, citations: [], note: "" },
};

/** Every citation invented — indices outside the numbered batch. The writer
 *  window is the whole defence and this is what it is defending against. */
export const TR_FABRICATED_CITES = {
  trust_move: { present: true, direction: "increase", citations: [99, -1, 4.5], note: "he trusts her more now" },
  rupture: { present: true, citations: [40], note: "a fight" },
  repair_signal: { present: true, citations: [], note: "he apologised" },
};

/** His apology, with NO fresh conflict alongside it — the shape the second
 *  and third nights of a repair really have. Kept separate from TR_GROUNDED
 *  on purpose: when both signals arrive together the state machine's priority
 *  order puts re-rupture FIRST, so an answer carrying both can never walk the
 *  repair arc to its end, and a fixture that conflated them would have proved
 *  the arc closes when it does not. */
export const TR_REPAIR_ONLY = {
  trust_move: { present: false, direction: "increase", citations: [], note: "" },
  rupture: { present: false, citations: [], note: "" },
  repair_signal: { present: true, citations: [6], note: "apologised and named what it was about" },
};

/** Nothing happened. The correct and expected answer most nights. */
export const TR_SILENT = {
  trust_move: { present: false, direction: "increase", citations: [], note: "" },
  rupture: { present: false, citations: [], note: "" },
  repair_signal: { present: false, citations: [], note: "" },
};

/** The real regularity, cited across three distinct days — the one proposal
 *  in this file that deserves to be written. */
export const PAT_GROUNDED = {
  patterns: [
    {
      moment: "stress",
      if_shape: "work pressure builds",
      then_note: "goes quiet, wants distraction not questions",
      self_in_relation: "steady, undemanding, no follow-up questions",
      citations: [0, 2, 7],
    },
  ],
};

/** The same regularity again, one new episode — a REINFORCEMENT, not a new
 *  row and not a no-op. Before WS-JUDGEWORK this was counted as `deduped` and
 *  dropped, which is why `support_count` never moved and T4 was never
 *  reachable. */
export const PAT_RECURRENCE = {
  patterns: [
    {
      moment: "stress",
      if_shape: "Work pressure builds",   // same shape, different casing
      then_note: "goes quiet, wants distraction not questions",
      self_in_relation: "steady, undemanding",
      citations: [0, 7],                  // 9001 already stored, 9008 is new
    },
  ],
};

/** The same regularity, the same evidence, nothing new. Under an HOURLY sweep
 *  this is what the identical batch produces every single firing. */
export const PAT_NO_NEW_EVIDENCE = {
  patterns: [
    {
      moment: "stress",
      if_shape: "work pressure builds",
      then_note: "goes quiet, wants distraction not questions",
      citations: [0, 2],                  // both already stored
    },
  ],
};

/** Prose. Every string here is a line she could say out loud, which is what
 *  the recited-prompt law is about, and T4 renders `if_shape -> then_note`
 *  verbatim into the prompt. */
export const PAT_PROSE = {
  patterns: [
    {
      moment: "stress",
      if_shape: "Whenever he has had a genuinely difficult day at the office and the deadlines have piled up",
      then_note: "I should probably just send him something silly instead of asking him what is wrong.",
      self_in_relation: "I am the calm one here",
      citations: [0, 2],
    },
  ],
};

/** A shared taste dressed as a pattern, one instance, and a moment outside
 *  the closed set. Three different refusals, one fixture. */
export const PAT_JUNK = {
  patterns: [
    { moment: "coffee", if_shape: "both like coffee", then_note: "talk about coffee", citations: [0, 1] },
    { moment: "stress", if_shape: "one bad day", then_note: "cheer up", citations: [0] },
  ],
};

// ── texture-drift fixtures (change over time) ─────────────────────────────
// NEWEST FIRST, matching TEXTURE_SCAN_SQL's `order by l.id desc`. 60 turns:
// the recent 30 are quiet, the earlier 30 are full of laughter. A deriver
// that cannot see that has no business claiming anything about change.
const laugh = "hahaha yaar tu na pagal hai";
const quiet = "hmm theek hai";
export const DRIFT_CONTENTS = [...Array(30).fill(quiet), ...Array(30).fill(laugh)];
export const DRIFT_EPISODE_IDS = [...Array(30).fill(901), ...Array(30).fill(902)];
/** Same length, no movement — the control. Must derive "". */
export const DRIFT_FLAT_CONTENTS = Array(60).fill(quiet);
