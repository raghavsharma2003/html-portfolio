// Shared fixtures for the WS-CONTINUITY suites. DATA ONLY — nothing here
// touches the database, the network or the compiler; the suites do the work.
//
// Row shapes are the REAL ones (src/engine/relstate.ts, india.ts, inner.ts),
// not a convenient JS re-model: a parity gate built on made-up shapes would
// pass while the render functions quietly filtered every row out.
//
// The relational bundle is deliberately a FULL one. Every slot the call lane
// was missing (T2 rel.snapshot, T3 india.dynamic, T4 dyadic.active, T6
// we.callbacks) has rows that actually render — a parity gate fed an empty
// bundle proves nothing, because both lanes would render zero and agree.

export const MS_MIN = 60_000;
export const MS_HOUR = 3_600_000;
export const MS_DAY = 86_400_000;
const PERSON = "wscont-test-fixture-person";

export const USER = {
  name: "Arjun",
  vibe: ["someone to talk to"],
  facts: { city: "Bengaluru", work: "backend at a fintech" },
};

export const REL_STATE = {
  person_id: PERSON,
  honorific: "tu",
  cs_ratio: 0.65,
  cs_on_stress: "intensify_l1",
  trust: 0.72,
  rupture_open: false,
  repair_state: "repaired",
  ritual_density: 0.6,
  pacing_gap_s: 9000,
  snapshot_ver: 11,
  updated_at: new Date().toISOString(),
};

// Two moments represented, so a moment-gated slot (T4) has something to select
// AND something to reject.
const PATTERNS = [
  {
    id: 1, person_id: PERSON, moment: "vulnerable",
    if_shape: "they go quiet", then_note: "give them room",
    self_in_relation: "", citations: [1, 2], support_count: 5, distinct_days: 3,
    prompt_eligible: true, times_contradicted: 0, t_invalid: null, last_used: null,
  },
  {
    id: 2, person_id: PERSON, moment: "stress",
    if_shape: "deadline weeks make them short", then_note: "do not read it as cold",
    self_in_relation: "", citations: [3, 4], support_count: 4, distinct_days: 3,
    prompt_eligible: true, times_contradicted: 0, t_invalid: null, last_used: null,
  },
];

// `WE_TOKEN_RE` in relstate.ts requires a shared-action token — these carry one.
const WE_EPISODES = [
  { id: 501, summary: "dono stayed on the phone till 4am the night the result came", at: new Date().toISOString() },
  { id: 502, summary: "we tried that new biryani place saath saath", at: new Date().toISOString() },
];
const PHRASES = [
  { phrase: "monday face", gloss: "their word for the sunday-night dread" },
  { phrase: "chai pe charcha", gloss: "their standing catch-up ritual" },
];
const RITUALS = [
  { person_id: PERSON, key: "good_morning", last_at: new Date(Date.now() - 30 * MS_HOUR).toISOString(), count: 12, cold_last: false, citations: [1, 2] },
  { person_id: PERSON, key: "khana_khaya", last_at: null, count: 0, cold_last: false, citations: [] },
];
const CURRENCY = [
  { person_id: PERSON, topic: "ipl", kind: "cricket", last_used: null, uses: 3, citations: [3] },
  { person_id: PERSON, topic: "diwali sweets", kind: "festival", last_used: null, uses: 1, citations: [4] },
];

export const REL_BUNDLE = {
  relState: REL_STATE,
  lastHonorificMoveAt: new Date(Date.now() - 21 * MS_DAY).toISOString(),
  patterns: PATTERNS,
  rituals: RITUALS,
  homeRegion: "karnataka",
  currency: CURRENCY,
  weEpisodes: WE_EPISODES,
  phrases: PHRASES,
  phraseLedger: PHRASES.map((p) => p.phrase),
};

/** The compile input both lanes are measured from. `overrides` is how a suite
 *  says "the same person, the same turn, one thing different" — which is the
 *  literal wording of gate G-C1. */
export function baseInput(overrides = {}) {
  return {
    user: USER,
    messageCount: 240,
    medium: "text",
    mode: "chat",
    voiceEngine: "gemini",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "- his on-call rotation lands every third week (2 days ago)",
    herLife: "- her flatmate Sneha is doing a pottery course",
    cultureNoteText: "",
    relBundle: REL_BUNDLE,
    selfBundle: null,
    latestUserText: "",
    gapSinceLastMs: 0,
    ageGates: null,
    ...overrides,
  };
}

/** A carried feeling well inside its 9h half-life and never voiced, so the
 *  ONLY thing that can suppress it in the suites below is the gap test. */
export function innerWithThread(now, ageMs = 2 * MS_HOUR) {
  return {
    thread: {
      text: "her manager took her work into a review without her",
      at: now - ageMs,
      w: 0.7,
      sign: -1,
      told: false,
    },
    wants: [],
    owed: [],
    lastAppraisedAt: now - ageMs,
    at: now - ageMs,
  };
}

export const msg = (from, at, text, channel = "chat", kind = "text") => ({
  id: `${from}-${at}`,
  from,
  kind,
  text,
  at,
  channel,
});
