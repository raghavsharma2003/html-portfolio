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
