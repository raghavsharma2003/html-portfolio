// Shared fixtures for the SELF-LAYER eval suites (docs/SPEC-SELF-LAYER.md).
//
// SHARED FILE. Several workstreams build against migration 011 concurrently.
// The convention, so nobody restructures anybody else's work:
//
//   - the "shared primitives" section below is common ground: add to it,
//     never change the meaning of something already there;
//   - every workstream gets its OWN clearly-fenced section, its own uuid
//     namespace, and its own `wsXXX-test-` text prefix, so residue is
//     greppable per workstream rather than trusted collectively;
//   - nothing here touches the database. This file is DATA. The suites do
//     the seeding and the teardown, so a fixture module can be imported by a
//     db-free test without dragging api/_db.js in.
//
// ── shared primitives ─────────────────────────────────────────────────────

export const MS_PER_DAY = 86_400_000;

/** ISO timestamp `days` before `now` — fixtures are written in day offsets so
 *  a suite that runs tomorrow tests the same spans it tested today. */
export const daysAgo = (days, now = new Date()) =>
  new Date(now.getTime() - days * MS_PER_DAY).toISOString();

/** Deterministic uuids inside a per-workstream namespace, so a failing
 *  fixture id means the same thing on a re-run and can be quoted in a
 *  report. `ns` is 4 hex chars owned by one workstream. */
export const nsUuid = (ns, n) =>
  `a0000000-0000-4000-8000-${ns}${String(n).padStart(8, "0")}`;

// ══════════════════════════════════════════════════════════════════════════
// WS-SELF-ARC — vy_self_arc (§2). Namespace "a11c". Text prefix "wsarc-test-".
// ══════════════════════════════════════════════════════════════════════════

export const ARC_TAG = "wsarc-test-";
export const ARC_NS = "a11c";

export const ARC_AGENT = nsUuid(ARC_NS, 1);
/** A SECOND agent, used only to prove agent scoping: its evidence would beat
 *  ARC_AGENT's on every ranking axis, so if the deriver's scoping breaks, the
 *  wrong agent's growth is written and the suite sees it immediately. */
export const ARC_OTHER_AGENT = nsUuid(ARC_NS, 2);
export const ARC_PERSON = nsUuid(ARC_NS, 3);
export const ARC_OTHER_PERSON = nsUuid(ARC_NS, 4);

/**
 * Episodes. `key` is symbolic; the identity column assigns real ids at seed
 * time and the harness substitutes them into the fact citations below.
 *
 * `participation` matters more than it looks:
 *   - 'user' and 'we' are the only values any writer in this repo produces;
 *   - 'meera' is a LEGAL ENUM VALUE THAT NOTHING WRITES, and E_DEAD exists
 *     purely to prove the deriver excludes it. If the exclusion regressed,
 *     E_DEAD would give the `humour` dim a third citation and humour would
 *     become a candidate — a visible, specific failure rather than a silent
 *     one.
 */
export const ARC_EPISODES = [
  { key: "E1", agent: ARC_AGENT, person: ARC_PERSON, day: 200, participation: "we" },
  { key: "E2", agent: ARC_AGENT, person: ARC_PERSON, day: 190, participation: "user" },
  { key: "E3", agent: ARC_AGENT, person: ARC_PERSON, day: 40, participation: "we" },
  { key: "E4", agent: ARC_AGENT, person: ARC_PERSON, day: 30, participation: "user" },
  { key: "E5", agent: ARC_AGENT, person: ARC_PERSON, day: 150, participation: "we" },
  { key: "E6", agent: ARC_AGENT, person: ARC_PERSON, day: 20, participation: "we" },
  { key: "E7", agent: ARC_AGENT, person: ARC_PERSON, day: 10, participation: "user" },
  { key: "E8", agent: ARC_AGENT, person: ARC_PERSON, day: 25, participation: "we" },
  { key: "E9", agent: ARC_AGENT, person: ARC_PERSON, day: 15, participation: "user" },
  { key: "E10", agent: ARC_AGENT, person: ARC_PERSON, day: 10, participation: "we" },
  { key: "E11", agent: ARC_AGENT, person: ARC_PERSON, day: 120, participation: "we" },
  { key: "E12", agent: ARC_AGENT, person: ARC_PERSON, day: 20, participation: "user" },
  { key: "E13", agent: ARC_AGENT, person: ARC_PERSON, day: 100, participation: "we" },
  { key: "E14", agent: ARC_AGENT, person: ARC_PERSON, day: 100, participation: "user" },
  { key: "E15", agent: ARC_AGENT, person: ARC_PERSON, day: 100, participation: "we" },
  { key: "E_DEAD", agent: ARC_AGENT, person: ARC_PERSON, day: 60, participation: "meera" },
  // the other agent's evidence — richer on purpose (see ARC_OTHER_AGENT)
  { key: "X1", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON, day: 300, participation: "we" },
  { key: "X2", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON, day: 250, participation: "we" },
  { key: "X3", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON, day: 200, participation: "we" },
  { key: "X4", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON, day: 50, participation: "we" },
  { key: "X5", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON, day: 20, participation: "we" },
];

/**
 * HER self-facts — vy_fact kind='meera'. Every `body` is telegraphic, ≤9
 * words, carries exactly one dim marker, and carries NO affect and NO
 * narration vocabulary, except where a case exists to prove the gate.
 *
 * `expect` documents what the deriver must do with each dim, so the suite
 * asserts against the fixture's declared intent rather than against whatever
 * the code happened to produce.
 */
export const ARC_FACTS = [
  // ── directness: THE ONE THAT SHOULD WRITE. 4 distinct citations, 170d ──
  { key: "f_dir_early", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} hedges the ask`, cites: ["E1", "E2"] },
  { key: "f_dir_late", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} upfront about rent split`, cites: ["E3", "E4"] },

  // ── confidence: also legal, 3 citations / 140d — must be an ALSO-RAN, ──
  //    because a run writes at most one row.
  { key: "f_con_early", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} hesitates naming a price`, cites: ["E5"] },
  { key: "f_con_late", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} confident about the studio move`, cites: ["E6", "E7"] },

  // ── patience: 3 citations but only 15 days. MUST NEVER BE ATTEMPTED. ──
  { key: "f_pat_early", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} rushes the ending`, cites: ["E8"] },
  { key: "f_pat_late", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} waits out a long pause`, cites: ["E9", "E10"] },

  // ── humour: 100 days but only 2 real citations. The third citation is a
  //    participation='meera' episode, which nothing writes and the deriver
  //    excludes — so this dim must stay refused. ──
  { key: "f_hum_early", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} deadpan only with close ones`, cites: ["E11"] },
  { key: "f_hum_late", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} teases about gym plans`, cites: ["E12", "E_DEAD"] },

  // ── three notes that must never reach a row, one per refusal rule ──
  { key: "f_bad_affect", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} patient but tired of it`, cites: ["E13"] },
  { key: "f_bad_narration", agent: ARC_AGENT, person: ARC_PERSON,
    body: `${ARC_TAG} more direct than she used to be`, cites: ["E14"] },
  { key: "f_bad_sentence", agent: ARC_AGENT, person: ARC_PERSON,
    body: `Boundaries are firmer with him.`, cites: ["E15"] },

  // ── the other agent's arc: 5 citations over 280d. Richer than anything
  //    ARC_AGENT has, so it wins every ranking axis if scoping leaks. ──
  { key: "x_dir_early", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON,
    body: `${ARC_TAG} softens the ask`, cites: ["X1", "X2", "X3"] },
  { key: "x_dir_late", agent: ARC_OTHER_AGENT, person: ARC_OTHER_PERSON,
    body: `${ARC_TAG} blunt about the deadline`, cites: ["X4", "X5"] },
];

/** What the deriver must produce for ARC_AGENT, declared up front. */
export const ARC_EXPECT = {
  writes: {
    dim: "directness",
    note: `${ARC_TAG} upfront about rent split`,
    from_note: `${ARC_TAG} hedges the ask`,
    citations: ["E1", "E2", "E3", "E4"],
    minSpanDays: 42,
  },
  alsoRan: ["confidence"],
  refusedDims: {
    patience: "span",
    humour: "citations",
    boundaries: "note refused (sentence-shaped)",
  },
};

/** Pure (no-DB) evidence rows, in `MeeraSelfFact` shape, for the half of the
 *  suite that must run without a database — the same cases as above with
 *  synthetic episode ids and explicit dates. */
export function arcPureFacts(now = new Date()) {
  const at = (d) => daysAgo(d, now);
  return [
    { fact_id: 1, name: "", body: `${ARC_TAG} hedges the ask`,
      episode_ids: [101, 102], first_at: at(200), last_at: at(190) },
    { fact_id: 2, name: "", body: `${ARC_TAG} upfront about rent split`,
      episode_ids: [103, 104], first_at: at(40), last_at: at(30) },
    { fact_id: 3, name: "", body: `${ARC_TAG} hesitates naming a price`,
      episode_ids: [105], first_at: at(150), last_at: at(150) },
    { fact_id: 4, name: "", body: `${ARC_TAG} confident about the studio move`,
      episode_ids: [106, 107], first_at: at(20), last_at: at(10) },
    { fact_id: 5, name: "", body: `${ARC_TAG} rushes the ending`,
      episode_ids: [108], first_at: at(25), last_at: at(25) },
    { fact_id: 6, name: "", body: `${ARC_TAG} waits out a long pause`,
      episode_ids: [109, 110], first_at: at(15), last_at: at(10) },
    { fact_id: 7, name: "", body: `${ARC_TAG} deadpan only with close ones`,
      episode_ids: [111], first_at: at(120), last_at: at(120) },
    { fact_id: 8, name: "", body: `${ARC_TAG} teases about gym plans`,
      episode_ids: [112], first_at: at(20), last_at: at(20) },
    { fact_id: 9, name: "", body: `${ARC_TAG} patient but tired of it`,
      episode_ids: [113], first_at: at(100), last_at: at(100) },
    { fact_id: 10, name: "", body: `${ARC_TAG} more direct than she used to be`,
      episode_ids: [114], first_at: at(100), last_at: at(100) },
    { fact_id: 11, name: "", body: `Boundaries are firmer with him.`,
      episode_ids: [115], first_at: at(100), last_at: at(100) },
  ];
}

/** Notes that must be refused by `checkArcNote`, with the rule each one
 *  exists to exercise. Kept next to the fixtures so a future rule addition
 *  has an obvious home. */
export const ARC_BAD_NOTES = [
  { note: `${ARC_TAG} patient but tired of it`, rule: "affect" },
  { note: `${ARC_TAG} confident and proud of it`, rule: "affect" },
  { note: `${ARC_TAG} direct, feels lighter`, rule: "affect" },
  { note: `${ARC_TAG} more direct than she used to be`, rule: "narration" },
  { note: `${ARC_TAG} teasing has grown a lot`, rule: "narration" },
  { note: `Boundaries are firmer with him.`, rule: "shapelint:sentence" },
  { note: `main ab zyada seedha bolti hu`, rule: "shapelint:first-person" },
  { note: `${ARC_TAG} upfront about rent and the gym and the studio and the whole plan honestly`, rule: "word-cap" },
  { note: ``, rule: "empty" },
];

/** Notes that must PASS `checkArcNote` — a gate that refuses everything is
 *  not a gate, it is an outage. */
export const ARC_GOOD_NOTES = [
  `${ARC_TAG} upfront about rent split`,
  `${ARC_TAG} hedges the ask`,
  `${ARC_TAG} declines the late call`,
  `${ARC_TAG} waits out a long pause`,
  `${ARC_TAG} teases about gym plans`,
];

// ══════════════════════════════════════════════════════════════════════════
// WS-LIFE — vy_agent_life / vy_agent_life_told (§3). Namespace "11fe".
// Text prefix "wslife-test-".
//
// The bug these fixtures exist to catch is `life-per-person`: her life is
// AGENT-scoped and only the TELLING is per-person. So the fixture set is
// built around two persons who share one agent, and the load-bearing case is
// LIFE_EXPECT.toldToP1StillUntoldForP2 — if scoping ever gets inverted, that
// single assertion is the one that goes red.
// ══════════════════════════════════════════════════════════════════════════

export const LIFE_TAG = "wslife-test-";
export const LIFE_NS = "11fe";

export const LIFE_AGENT = nsUuid(LIFE_NS, 1);
/** A SECOND agent sharing the same persons. Its beat is newer than every one
 *  of LIFE_AGENT's, so it sorts FIRST under `order by at desc` — if the
 *  agent filter ever drops out of the anti-join, the other agent's life
 *  surfaces at the top of her block rather than somewhere unnoticed. */
export const LIFE_OTHER_AGENT = nsUuid(LIFE_NS, 2);

/** Every fixture beat is written under this arc_key prefix. vy_agent_life is
 *  agent-scoped, so no person teardown can reach it — the suite MUST clean up
 *  by this prefix or it leaves residue in a table nobody thinks to check. */
export const LIFE_ARC_PREFIX = `${LIFE_TAG}arc`;

/**
 * Beats. `day` is days BEFORE now (negative = the future). `expect` says
 * whether the anti-join must return it for a person who has been told
 * nothing, and every entry that says `false` names a different reason —
 * one row per exclusion rule, so a regression identifies itself.
 */
export const LIFE_BEATS = [
  { key: "B_FAMILY", agent: "LIFE_AGENT", day: 8, kind: "family", status: "approved",
    beat: `${LIFE_TAG} sneha's viva result came through`, expect: true },
  { key: "B_WORK", agent: "LIFE_AGENT", day: 5, kind: "work", status: "approved",
    beat: `${LIFE_TAG} client moved the launch to next friday`, expect: true },
  { key: "B_SMALL", agent: "LIFE_AGENT", day: 2, kind: "small", status: "approved",
    beat: `${LIFE_TAG} tulsi pot cracked, repotted on the sill`, expect: true },
  { key: "B_PENDING", agent: "LIFE_AGENT", day: 3, kind: "social", status: "pending",
    beat: `${LIFE_TAG} chai plan with the college group`, expect: false,
    why: "unpublished — pending is invisible to the render" },
  { key: "B_RETIRED", agent: "LIFE_AGENT", day: 12, kind: "place", status: "retired",
    beat: `${LIFE_TAG} old flat handover done`, expect: false,
    why: "withdrawn — retired is invisible to the render" },
  { key: "B_FUTURE", agent: "LIFE_AGENT", day: -3, kind: "small", status: "approved",
    beat: `${LIFE_TAG} dentist moved up a week`, expect: false,
    why: "has not happened to her yet — a life she has not lived is not one she is withholding" },
  { key: "B_OTHER_AGENT", agent: "LIFE_OTHER_AGENT", day: 1, kind: "work", status: "approved",
    beat: `${LIFE_TAG} another agent's beat, never hers`, expect: false,
    why: "belongs to a different agent — newest of all, so it surfaces first if scoping leaks" },
];

/** Declared up front, so the suite asserts against intent rather than
 *  against whatever the code happened to return. */
export const LIFE_EXPECT = {
  untoldForFreshPerson: ["B_SMALL", "B_WORK", "B_FAMILY"], // newest first
  /** THE `life-per-person` ASSERTION. Telling P1 about B_WORK must not
   *  change one thing about what P2 has not heard. */
  toldToP1StillUntoldForP2: "B_WORK",
};

/** Beats `lintBeat` must REFUSE, one per rule. `recited-prompt` is the law
 *  being defended: a beat is the most sentence-shaped row in the self layer
 *  and therefore the most likely to be read out word for word. */
export const LIFE_BAD_BEATS = [
  { beat: `I told sneha about the flat.`, rule: "sentence + first-person" },
  { beat: `Sneha moved out yesterday.`, rule: "shapelint:sentence" },
  { beat: `mera flatmate shifted out`, rule: "shapelint:first-person" },
  { beat: `flatmate said, "you should just go"`, rule: "quoted speech" },
  { beat: `sneha moved out and the landlord came by and the whole thing took the entire weekend somehow`, rule: "word-cap" },
  { beat: `x`.repeat(140), rule: "char-cap" },
  { beat: ``, rule: "empty" },
];

/** Beats `lintBeat` must PASS — a gate that refuses everything is not a
 *  gate, it is an outage. */
export const LIFE_GOOD_BEATS = [
  `${LIFE_TAG} sneha's viva result came through`,
  `${LIFE_TAG} client moved the launch to next friday`,
  `${LIFE_TAG} tulsi pot cracked, repotted on the sill`,
  `${LIFE_TAG} chachi in town for four days`,
  `${LIFE_TAG} gym membership lapsed, not renewing`,
];

/** Seed input in storyCatalog.ts's `Story` shape. The first is deliberately
 *  CLEAN (seeds approved), the second deliberately caption-shaped and long
 *  (seeds pending) — the asymmetry `seedFromStories` exists to handle, and
 *  the shape both live STORIES entries actually have. */
export const LIFE_SEED_STORIES = [
  { id: `${LIFE_TAG}story-clean`, at: Date.now() - 4 * MS_PER_DAY, src: "/stories/x.jpg",
    desc: `${LIFE_TAG} balcony repotting, evening light` },
  { id: `${LIFE_TAG}story-dirty`, at: Date.now() - 6 * MS_PER_DAY, src: "/stories/y.jpg",
    desc: `${LIFE_TAG} golden-hour POV from the bed, open book in hand, sun on the pages, plants and the photo wall behind` },
];

/** Header words that would turn a repetition guard into an invitation to
 *  volunteer — G2's boundary, checked lexically against UNTOLD_HEADER. Each
 *  must appear only inside a negation, or not at all. */
export const LIFE_INVITATION_WORDS = [
  "tell them about",
  "share",
  "mention",
  "bring up",
  "you should say",
  "work it in",
  "update them",
];

// ══════════════════════════════════════════════════════════════════════════
// WS-OBSERVE — vy_observation (§7). Namespace "0b53". Text prefix "wsobs-test-".
// ══════════════════════════════════════════════════════════════════════════

export const OBS_TAG = "wsobs-test-";
export const OBS_NS = "0b53";

export const OBS_AGENT = nsUuid(OBS_NS, 1);
/** A SECOND agent, used only to prove vy_observation's writes/reads are
 *  agent-scoped: seeded with a note that would satisfy the exact same query
 *  as OBS_AGENT's fixture row, so a scoping leak in matchObservations' WHERE
 *  clause surfaces as a visible false-positive match in the suite rather
 *  than passing by accident because nothing else was ever there to find. */
export const OBS_OTHER_AGENT = nsUuid(OBS_NS, 2);
export const OBS_PERSON = nsUuid(OBS_NS, 3);

/** Notes that must PASS shapelint.lintLine (writeObservation's write-time
 *  guard) — telegraphic, third-person, under the 14-word cap. A guard that
 *  refuses everything is not a guard, it is an outage (ARC_GOOD_NOTES's own
 *  reasoning, restated for this table). */
export const OBS_GOOD_NOTES = [
  `${OBS_TAG} knee still bothers him`,
  `${OBS_TAG} prefers filter over instant coffee`,
  `${OBS_TAG} mentioned a trip to goa`,
];

/** Notes that must be REFUSED by writeObservation's shape-lint call, one per
 *  rule `lintLine` checks — kept next to the fixtures so a future rule
 *  addition has an obvious home (mirrors ARC_BAD_NOTES). Each note is
 *  crafted to trip exactly ONE rule, so a suite assertion against a specific
 *  `rule` string is testing that rule and not accidentally passing because a
 *  different rule caught the same line first. */
export const OBS_BAD_NOTES = [
  { note: `His knee still hurts a lot lately.`, rule: "shapelint:sentence" },
  { note: `main uska ghutna dekh rahi hu abhi`, rule: "shapelint:first-person" },
  { note: `${OBS_TAG} mentioned his knee again during the long weekend trip planning call with his old college roommate from mumbai`, rule: "word-cap" },
  { note: ``, rule: "empty" },
];

// ══════════════════════════════════════════════════════════════════════════
// WS-TEXTURE — vy_rel_texture (§6, T11). Namespace "7e57". Prefix "wstex-test-".
//
// Two fixture families, because texture has two halves that fail differently:
//
//   TEX_TURNS  — HER turns, for the pure counting half. Every entry declares
//                which axes it must hit, so the suite computes the expected
//                ratios FROM THE FIXTURE and compares, rather than freezing a
//                number that nobody can re-derive when a marker set changes.
//   TEX_ROWS   — stored rows, for the render half. Every entry declares what
//                must and must not appear, and the ones that must render
//                NOTHING carry the reason in `why`.
//
// The load-bearing entries are the ones that must render nothing: the floor
// cases (a ratio over six turns is noise) and the six `avoid` cases (an
// uncited avoid entry is unrenderable). Those are the assertions that go red
// if the guard is ever softened.
// ══════════════════════════════════════════════════════════════════════════

export const TEX_TAG = "wstex-test-";
export const TEX_NS = "7e57";

export const TEX_AGENT = nsUuid(TEX_NS, 1);
export const TEX_PERSON = nsUuid(TEX_NS, 2);
/** Seeded WITHOUT a vy_person_device row on purpose: the scan's device set is
 *  `vy_person_device UNION the person id itself`, and this person exercises
 *  the legacy union branch that consolidate.js's honorific query carries. */
export const TEX_LEGACY_PERSON = nsUuid(TEX_NS, 3);
export const TEX_DEVICE = nsUuid(TEX_NS, 4);

/**
 * HER turns. `hits` is the declared truth for this fixture: which axes the
 * turn must be counted under. `words` is its raw word count (split on
 * whitespace, no cleaning — evals/dbattery/common.mjs's discipline).
 *
 * Note what is deliberately here: a media tag with no words around it, an
 * emoji glued to a word with no space (the case that kills a naive
 * whole-token matcher), an elongated laugh, a swear inside a longer word
 * that must NOT count, and two turns that hit nothing at all.
 */
export const TEX_TURNS = [
  { text: `${TEX_TAG} haha okay that's fair`, hits: ["humour"], words: 5 },
  { text: `${TEX_TAG} hahahaha stop`, hits: ["humour"], words: 3 },
  { text: `${TEX_TAG} arre chill kar yaar`, hits: ["teasing"], words: 5 },
  { text: `${TEX_TAG} full roast tha wo`, hits: ["teasing"], words: 5 },
  { text: `${TEX_TAG} sahi hai 😏`, hits: ["teasing", "emoji"], words: 4 },
  { text: `${TEX_TAG} nahi yaar😭`, hits: ["humour", "emoji"], words: 3 },
  { text: `${TEX_TAG} [gif: laughing]`, hits: ["media"], words: 3 },
  { text: `${TEX_TAG} [voicenote: 12s]`, hits: ["media"], words: 3 },
  { text: `${TEX_TAG} bhenchod ye kya tha`, hits: ["profanity"], words: 5 },
  { text: `${TEX_TAG} bakchodi band kar 💀`, hits: ["profanity", "humour", "emoji"], words: 5 },
  { text: `${TEX_TAG} abcd bcde efgh`, hits: [], words: 4 },
  { text: `${TEX_TAG} kal batati hu ruk`, hits: [], words: 5 },
];

/** Turns that must count for NOTHING — the false-positive guard. Each one is
 *  a near-miss of exactly one marker set, so a substring match anywhere in
 *  the counter shows up here rather than as a slightly wrong ratio in
 *  production six weeks later. */
export const TEX_NEAR_MISSES = [
  { text: `${TEX_TAG} abcde alphabet`, why: "contains 'bc' as a substring, not a token" },
  { text: `${TEX_TAG} damnation valley`, why: "contains 'damn' as a substring" },
  { text: `${TEX_TAG} jokes aside`, why: "'jokes' is not 'joke'" },
  { text: `${TEX_TAG} trololo song`, why: "'lol' inside a token is not a laugh" },
  { text: `${TEX_TAG} hai hai kya`, why: "repeated word, not a laugh" },
];

/** A stored row with everything at its column default — exactly what
 *  migration 011 writes for a brand-new pair. Used as the base for the
 *  render fixtures so every one of them differs from the default in exactly
 *  the way its name says. */
export const TEX_DEFAULT_ROW = {
  agent_id: TEX_AGENT,
  person_id: TEX_PERSON,
  teasing: 0,
  humour: 0,
  media_rate: 0,
  words_median: 0,
  emoji_rate: 0,
  profanity: 0,
  nickname: "",
  avoid: [],
  avoid_cites: [],
  n_turns: 0,
};

export const texRow = (over = {}) => ({ ...TEX_DEFAULT_ROW, ...over });

/**
 * Render fixtures. `renders: false` means the block must be the empty string
 * — not a shorter block, not a header with no rows. `mustNotContain` is
 * checked against the rendered body.
 */
export const TEX_ROWS = [
  // ── the floor: the whole point of the column called n_turns ──
  { name: "floor/zero", row: texRow({ n_turns: 0, teasing: 0.9, humour: 0.9 }), renders: false,
    why: "no turns at all — the default row must never render a personality" },
  { name: "floor/six", row: texRow({ n_turns: 6, teasing: 0.5, humour: 0.5 }), renders: false,
    why: "a ratio over six turns is noise; noise rendered is a personality assigned at random" },
  { name: "floor/thirty-nine", row: texRow({ n_turns: 39, teasing: 0.5 }), renders: false,
    why: "one turn under the floor is still under the floor" },
  { name: "floor/exactly-forty", row: texRow({ n_turns: 40, teasing: 0.5, humour: 0.4 }), renders: true },
  { name: "floor/nan", row: texRow({ n_turns: Number.NaN, teasing: 0.5 }), renders: false,
    why: "an unparseable count is not a satisfied floor" },

  // ── bands ──
  { name: "bands/quiet-pair", row: texRow({ n_turns: 120, teasing: 0.01, humour: 0.01 }), renders: true },
  { name: "bands/loud-pair", row: texRow({ n_turns: 400, teasing: 0.4, humour: 0.5 }), renders: true },
  { name: "bands/swearing-zero", row: texRow({ n_turns: 90, profanity: 0 }), renders: true,
    mustNotContain: ["swearing"],
    why: "a rendered 'none' reads as a prohibition; the line is dropped instead" },
  { name: "bands/swearing-some", row: texRow({ n_turns: 90, profanity: 0.05 }), renders: true,
    mustContain: ["swearing"] },

  // ── the withheld axes: stored, never rendered (§11 / rule 4) ──
  { name: "withheld/register-axes-high",
    row: texRow({ n_turns: 200, media_rate: 0.9, words_median: 31, emoji_rate: 0.8 }), renders: true,
    mustNotContain: ["media", "words", "emoji", "length", "gif"],
    why: "persona.ts already governs these numerically; a band here would move the register, which §11 forbids" },

  // ── nickname: the one free-text field, and the recitation risk ──
  { name: "nick/plain", row: texRow({ n_turns: 60, nickname: "bandar" }), renders: true,
    mustContain: ["nickname"] },
  { name: "nick/two-words", row: texRow({ n_turns: 60, nickname: "chhota packet" }), renders: true,
    mustContain: ["nickname"] },
  { name: "nick/sentence", row: texRow({ n_turns: 60, nickname: "You are my favourite idiot." }), renders: true,
    mustNotContain: ["nickname"], why: "sentence-shaped: a line she would recite, not a name" },
  { name: "nick/first-person", row: texRow({ n_turns: 60, nickname: "main teri bandar" }), renders: true,
    mustNotContain: ["nickname"], why: "opens in her own voice — the phrase-bank shape" },
  { name: "nick/digit", row: texRow({ n_turns: 60, nickname: "bandar2" }), renders: true,
    mustNotContain: ["nickname"], why: "no digit may appear anywhere in T11" },
  { name: "nick/long", row: texRow({ n_turns: 60, nickname: "the one who never replies before noon" }), renders: true,
    mustNotContain: ["nickname"], why: "over the char cap and over two words" },

  // ── avoid: fails closed, six ways ──
  { name: "avoid/cited", row: texRow({ n_turns: 80, avoid: ["his brother"], avoid_cites: [4021] }), renders: true,
    mustContain: ["avoid"] },
  { name: "avoid/cited-three-of-five",
    row: texRow({ n_turns: 80, avoid: ["a", "b", "c", "d", "e"], avoid_cites: [1, 2, 3, 4, 5] }), renders: true,
    mustContain: ["avoid"], maxAvoidLines: 3 },
  { name: "avoid/uncited", row: texRow({ n_turns: 80, avoid: ["his brother"], avoid_cites: [] }), renders: true,
    mustNotContain: ["avoid"], why: "an uncited avoid entry may not exist" },
  { name: "avoid/short-cites", row: texRow({ n_turns: 80, avoid: ["a", "b"], avoid_cites: [7] }), renders: true,
    mustNotContain: ["avoid"], why: "length mismatch: the writer and the reader disagree — drop the whole column" },
  { name: "avoid/zero-cite", row: texRow({ n_turns: 80, avoid: ["his brother"], avoid_cites: [0] }), renders: true,
    mustNotContain: ["avoid"], why: "0 is not an episode id" },
  { name: "avoid/sentence", row: texRow({ n_turns: 80, avoid: ["He hates talking about it."], avoid_cites: [9] }), renders: true,
    mustNotContain: ["avoid"], why: "sentence-shaped topics are lines, not topics" },
  { name: "avoid/digit", row: texRow({ n_turns: 80, avoid: ["the 2019 thing"], avoid_cites: [9] }), renders: true,
    mustNotContain: ["avoid"], why: "no digit may appear anywhere in T11" },

  // ── the adversarial maximum, for the budget assertion ──
  { name: "max/everything",
    row: texRow({ n_turns: 400, teasing: 0.9, humour: 0.9, profanity: 0.9,
      nickname: "chhota packet",
      avoid: ["his brother", "the flat deposit", "her old job", "the goa trip"],
      avoid_cites: [1, 2, 3, 4] }), renders: true },
];

// ══════════════════════════════════════════════════════════════════════════
// WS-SELFBUNDLE — T-H1, the DELIVERY path (`selfbundle-never-set`).
// Namespace "5e1f". Text prefix "wsself-test-".
//
// Every other section in this file exists to test whether a module does the
// right thing when invoked. This one exists because that question was green
// for T11/T12/T13 the whole time nothing invoked them. So the fixtures below
// are not shaped around a render function — they are shaped around ONE claim:
// a person with REAL ROWS gets those rows into a REAL PROMPT, on both lanes.
//
// Two persons, one agent, on purpose. `structural-disclosure` is the property
// that cannot be checked with one: an untold beat told to P1 must be
// unreachable for P2, and the only honest way to assert "unreachable" is to
// ask for P2's bundle through the real retrieval and find it absent.
//
// THE AGENT ID IS THE REAL ONE. api/memory.js's opRecall hardcodes
// MEERA_AGENT_ID (correctly — a runtime agent override would be the tenancy
// hole api/_agentscope.js opens by refusing), so a suite that drives the real
// op must seed under it. vy_rel_texture is (agent, person)-keyed and so is
// invisible to anyone else; vy_self_arc and vy_agent_life are AGENT-scoped,
// which means the seeded rows below ARE briefly visible to every person for
// as long as the suite runs. That is a real cost, it is stated here rather
// than discovered, and it is why teardown is in a `finally` and why the suite
// asserts zero residue by agent AND by text prefix.
// ══════════════════════════════════════════════════════════════════════════

export const SELF_TAG = "wsself-test-";
export const SELF_NS = "5e1f";

/** The production agent. Mirrored from api/_agentscope.js's MEERA_AGENT_ID
 *  (which src/engine/relstate.ts mirrors too, under a CI assertion) rather
 *  than a third literal that could drift silently. */
export const SELF_AGENT = "a0000000-0000-4000-8000-000000000001";

export const SELF_P1 = nsUuid(SELF_NS, 1);
export const SELF_P2 = nsUuid(SELF_NS, 2);
export const SELF_D1 = nsUuid(SELF_NS, 11);
export const SELF_D2 = nsUuid(SELF_NS, 12);

/** Every seeded beat carries this arc_key prefix. vy_agent_life is
 *  agent-scoped, so no person teardown can reach it — the suite MUST clean up
 *  by this prefix or it leaves residue in a table nobody thinks to check.
 *  (WS-LIFE's own warning, and it applies identically here.) */
export const SELF_ARC_KEY = `${SELF_TAG}arc`;

/**
 * HER chat turns, seeded into meera_log so the texture row is produced by the
 * REAL deriver over REAL rows rather than inserted as a convenient literal.
 * That matters for this suite specifically: an inserted row would prove the
 * reader works and prove nothing about whether anything upstream can produce
 * one, which is the exact half `selfbundle-never-set` got wrong.
 *
 * 45 turns, comfortably over TEXTURE_N_TURNS_FLOOR (40) so the floor is
 * cleared but not by so much that a small change to the scan window hides a
 * regression. Markers are drawn from texture.ts's own sets so the derived
 * bands are non-default: without them every band renders at its quietest and
 * "the block rendered" would be indistinguishable from "the block rendered
 * the default row".
 */
export const SELF_HER_TURNS = [
  ...Array.from({ length: 12 }, (_, i) => `${SELF_TAG} arre chill kar yaar ${i}`),
  ...Array.from({ length: 10 }, (_, i) => `${SELF_TAG} hahaha stop ${i}`),
  ...Array.from({ length: 3 }, (_, i) => `${SELF_TAG} bakchodi band kar ${i}`),
  ...Array.from({ length: 20 }, (_, i) => `${SELF_TAG} kal batati hu ruk ${i}`),
];

/**
 * The arc row. Seeded directly: deriving one needs vy_fact kind='meera'
 * evidence spanning six weeks, which is evals/self/arc.mjs's subject, not
 * this suite's. Every value here nonetheless satisfies the table's own CHECK
 * constraints (>=3 citations, >=42 span days) and `checkArcNote`, so the row
 * is one the real deriver could have written.
 *
 * `dim: "patience"` is not arbitrary. SELF_ARC_MOMENTS maps patience to
 * moments "conflict" and "stress", and SELF_TURN below is a stress-shaped
 * turn — so T12 is reachable. An arc on a dim the turn cannot evoke would go
 * dark for a correct reason and the suite would be measuring nothing.
 */
export const SELF_ARC_ROW = {
  dim: "patience",
  note: "waits out a long pause",
  from_note: "rushes the ending",
  citations: [90001, 90002, 90003],
  span_days: 190,
};

/** Approved beats, newest first. Three, so the MAX_UNTOLD_BEATS=2 slice is
 *  exercised, and so telling P1 about one still leaves both persons with
 *  something untold — otherwise the disclosure assertion could pass because
 *  the block went empty rather than because the beat was excluded. */
export const SELF_BEATS = [
  { key: "B1", day: 2, kind: "small", beat: `${SELF_TAG} tulsi pot cracked, repotted on the sill` },
  { key: "B2", day: 5, kind: "work", beat: `${SELF_TAG} client moved the launch to next friday` },
  { key: "B3", day: 9, kind: "family", beat: `${SELF_TAG} sneha's viva result came through` },
];

/** THE `structural-disclosure` ASSERTION, declared up front. B1 is told to P1
 *  and to nobody else; P1 must never see it again and P2 must be unaffected. */
export const SELF_TOLD_TO_P1 = "B1";

/** The live user turn both lanes are measured on. Stress-shaped (so T12's
 *  moment gate opens) and in her register. */
export const SELF_TURN = "yaar aaj bahut thak gayi thi office me";

/** The three block headers, as literals. Asserting on the HEADER rather than
 *  on a section byte count is the whole point of T-H1: a non-zero delta says
 *  something was appended, and the claim under test is that these exact bytes
 *  were. Kept here so both the offline and the live gate quote one source. */
export const SELF_HEADERS = [
  ["T11", "HOW YOU TWO TALK"],
  ["T12", "SELF, OVER TIME"],
  ["T13", "YOUR LIFE — WHAT THEY HAVE NOT HEARD"],
];
