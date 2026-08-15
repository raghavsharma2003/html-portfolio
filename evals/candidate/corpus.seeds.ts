// evals/candidate/corpus.seeds.ts — WS-CORPUS state-variant seed data for
// the swap-test context corpus (docs/SWAP-TEST-PREREG.md Amendment 1,
// context/decisions.md `swap-prereg-amend-1`).
//
// Structured state data only — never prose she could recite (CLAUDE.md's
// "anything sentence-shaped in a prompt gets recited" law). Every string
// below is a memory-list entry, a pattern row, a ritual key, or similar
// third-person/tabular record — the same shape src/engine/__fixtures__'s
// own compiler.fixtures.ts and budget.fixtures.ts already use, and this
// file is modeled directly on those two (never on anything a real
// conversation said). No wall-clock reads anywhere in this file: every
// timestamp below is a LITERAL fixed ISO string, never `new Date()` /
// `Date.now()` — see corpus-generate.mjs's header for why (compile() and
// the functions it calls default several `now` params to a live clock read
// that CompileInput has no seam to override; this file's fixed strings are
// half of the workaround, the other half is corpus-generate.mjs's global
// Date pin around each compile() call).

import type { CompileInput, RelBundleInput } from "../../src/engine/compiler";
import type { UserProfile, VoiceEngine } from "../../src/engine/persona";
import type { RelState, PatternRow, WeEpisodeRow, PhraseRow } from "../../src/engine/relstate";
import type { RitualRow, CurrencyRow } from "../../src/engine/india";
import type { TierGates } from "../../src/engine/clock";

// ── pinned clock instants — one per time-of-day bucket persona.ts's
// timeOfDay() recognizes (h<5 night, <12 morning, <17 afternoon, <22
// evening, else night). Fixed calendar date, varying only the hour.
export const CLOCK = {
  DAWN: "2026-08-10T06:15:00+05:30", // -> "morning"
  MIDDAY: "2026-08-10T13:05:00+05:30", // -> "afternoon"
  DUSK: "2026-08-10T19:40:00+05:30", // -> "evening"
  LATE: "2026-08-10T23:50:00+05:30", // -> "night"
} as const;

// ── user profiles (structured only: name/vibe/facts, matching
// compiler.fixtures.ts's USER_MIN/USER_RICH shapes) ──
export const USER_LIGHT: UserProfile = { name: "Aakash", vibe: ["company"], facts: {} };
export const USER_HEAVY: UserProfile = {
  name: "Rohan",
  vibe: ["someone to talk to", "a friend who remembers"],
  facts: { city: "Bengaluru", job: "backend engineer", relationship: "single" },
};

// ── memory / herLife / inner content, two load levels. Structured
// third-person recall records, not dialogue — same format as
// compiler.fixtures.ts's MEMORIES_SAMPLE/HERLIFE_SAMPLE. ──
export const MEMORIES_LIGHT =
  '- goa trip (event, last came up 2 days ago): planned with college friends for december — their own words: "finally booking it this time" [college, friends]';
export const MEMORIES_HEAVY = Array.from(
  { length: 10 },
  (_, i) =>
    `- topic_${i} (kind, last came up ${i}h ago): recall summary entry number ${i}, kept short and factual — their own words: "note_${i}" [tag_a, tag_b]`,
).join("\n");

export const HERLIFE_LIGHT = "- flatmate is named sneha (2h ago)";
export const HERLIFE_HEAVY = Array.from(
  { length: 8 },
  (_, i) => `- fact about her own life number ${i} (${i}h ago)`,
).join("\n");

export const INNER_THREAD_LIGHT =
  '\n\nSOMETHING YOU\'RE CARRYING — from earlier, unresolved, in your own words: "kal thoda off feel ho raha tha". Let it show only if it naturally fits; never announce it.';
export const INNER_THREAD_HEAVY =
  "\n\nSOMETHING YOU'RE CARRYING — " + "carried feeling text ".repeat(20).trim();
export const INNER_WANTS_LIGHT =
  "\n\nWHAT YOU WANT RIGHT NOW: you want them to tell you how the interview went — ask once if it comes up naturally.";
export const INNER_WANTS_HEAVY =
  "\n\nWHAT YOU WANT: " + "a want and an owed thing and a taste row ".repeat(12).trim();

export const CULTURE_NOTE =
  "\n\nTHEY JUST REFERENCED a meme/trend you recognise: keep it light, one line, no explaining the joke.";

// ── relational state, fixed ISO timestamps throughout (never Date.now()) ──
const PERSON = "wscorpus-fixture-person";

export const REL_STATE_WARMING: RelState = {
  person_id: PERSON,
  honorific: "tum",
  cs_ratio: 0.35,
  cs_on_stress: "unknown",
  trust: 0.3,
  rupture_open: false,
  repair_state: "none",
  ritual_density: 0.15,
  pacing_gap_s: 7200,
  snapshot_ver: 2,
  updated_at: "2026-08-05T10:00:00+05:30",
};

export const REL_STATE_SETTLED: RelState = {
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
  updated_at: "2026-08-08T18:30:00+05:30",
};

export const REL_STATE_RUPTURE: RelState = {
  person_id: PERSON,
  honorific: "tum",
  cs_ratio: 0.42,
  cs_on_stress: "retreat_l2",
  trust: 0.38,
  rupture_open: true,
  repair_state: "open",
  ritual_density: 0.2,
  pacing_gap_s: 5400,
  snapshot_ver: 4,
  updated_at: "2026-08-09T21:15:00+05:30",
};

// Pattern rows — moment-shape-tagged, mirrors budget.fixtures.ts's
// HEAVY_PATTERNS structure exactly, fixed values, no timestamps involved.
function patternRows(moments: readonly string[]): PatternRow[] {
  return moments.map((moment, i) => ({
    id: i + 1,
    person_id: PERSON,
    moment,
    if_shape: `they go quiet ${i}`,
    then_note: `give them space ${i}`,
    self_in_relation: "",
    citations: [i * 2 + 1, i * 2 + 2],
    support_count: 5,
    distinct_days: 3,
    prompt_eligible: true,
    times_contradicted: 0,
    t_invalid: null,
    last_used: null,
  }));
}
export const PATTERNS_MIXED = patternRows(["conflict", "vulnerable", "celebration", "conflict", "planning"]);
export const PATTERNS_CONFLICT = patternRows(["conflict", "conflict", "conflict"]);

export const WE_EPISODES: WeEpisodeRow[] = [
  { id: 501, summary: "dono went to the beach together and got caught in rain", at: "2026-07-20T17:00:00+05:30" },
  { id: 502, summary: "we tried that new biryani place saath saath", at: "2026-08-01T20:15:00+05:30" },
];
export const PHRASES: PhraseRow[] = [
  { phrase: "chai pe charcha", gloss: "their standing catch-up ritual" },
  { phrase: "bas kar pagal", gloss: "their running joke phrase" },
];

export const RITUALS_DUE: RitualRow[] = [
  { person_id: PERSON, key: "good_morning", last_at: "2026-07-27T09:00:00+05:30", count: 12, cold_last: false, citations: [1, 2] },
  { person_id: PERSON, key: "khana_khaya", last_at: null, count: 0, cold_last: false, citations: [] },
];
export const RITUALS_COLD: RitualRow[] = [
  { person_id: PERSON, key: "match_checkin", last_at: "2026-08-09T09:00:00+05:30", count: 4, cold_last: true, citations: [5] },
];
export const CURRENCY: CurrencyRow[] = [
  { person_id: PERSON, topic: "ipl", kind: "cricket", last_used: null, uses: 3, citations: [3] },
  { person_id: PERSON, topic: "diwali sweets", kind: "festival", last_used: null, uses: 1, citations: [4] },
];

export function relBundle(
  state: RelState,
  opts: { patterns?: PatternRow[]; rituals?: RitualRow[]; lastHonorificMoveAt?: string | null } = {},
): RelBundleInput {
  return {
    relState: state,
    lastHonorificMoveAt: opts.lastHonorificMoveAt ?? "2026-07-20T10:00:00+05:30",
    patterns: opts.patterns ?? PATTERNS_MIXED,
    rituals: opts.rituals ?? RITUALS_DUE,
    homeRegion: "maharashtra",
    currency: CURRENCY,
    weEpisodes: WE_EPISODES,
    phrases: PHRASES,
    phraseLedger: PHRASES.map((p) => p.phrase),
  };
}

export const GATES_MINOR_SAFE: TierGates = { engagementMechanics: false, romanceRegisters: false };

// ─────────────────────────────────────────────────────────────────────────
// STATE VARIANTS — 4 relational regimes × 4 clock instants = 16, then each
// duplicated once more at the opposite MEMORY/HERLIFE/INNER load level
// (light/heavy) for 32 total. Every CompileInput field the engine actually
// takes is touched across this grid: user, messageCount, medium, mode,
// voiceEngine, isDirective, watching, innerThread/innerWants, memories,
// herLife, cultureNoteText, relBundle (relState/trust/stage/rupture,
// patterns, rituals, we-episodes/phrases), ageGates, gapSinceLastMs. Only
// `latestUserText` is deliberately left OUT of every variant — that is the
// per-stimulus axis, supplied by corpus-generate.mjs from the 72 distinct
// archived lines, never by this file.
// ─────────────────────────────────────────────────────────────────────────

export interface Regime {
  id: string;
  note: string;
  fragment: Omit<CompileInput, "latestUserText" | "user" | "memories" | "herLife" | "innerThread" | "innerWants" | "cultureNoteText">;
}

const REGIMES: Regime[] = [
  {
    id: "bare",
    note: "brand-new dyad, no relBundle, no recall — the 83-fixture baseline shape",
    fragment: {
      messageCount: 5,
      medium: "text",
      mode: "chat",
      voiceEngine: "device",
      isDirective: false,
      watching: false,
      gapSinceLastMs: 120_000,
    },
  },
  {
    id: "warming",
    note: "trust 0.30 (stageForDims: warming), light ritual density, no patterns eligible yet",
    fragment: {
      messageCount: 180,
      medium: "text",
      mode: "chat",
      voiceEngine: "device",
      isDirective: false,
      watching: false,
      relBundle: relBundle(REL_STATE_WARMING, { patterns: [] }),
      gapSinceLastMs: 1_800_000,
    },
  },
  {
    id: "settled-voice-watch",
    note: "trust 0.72 (settled), voice/call lane, watching on, we-episodes + patterns live",
    fragment: {
      messageCount: 520,
      medium: "voice",
      mode: "call",
      voiceEngine: "eleven",
      isDirective: false,
      watching: true,
      relBundle: relBundle(REL_STATE_SETTLED),
      gapSinceLastMs: 45_000,
    },
  },
  {
    id: "rupture-minor-gated",
    note:
      "rupture_open + conflict-heavy patterns present in relBundle, but ageGates = minor-safe: T2/T4 " +
      "must be unconditionally absent and AGE_TIER_SAFETY_OVERRIDE present regardless of the rich " +
      "relational content underneath — the unconditional-drop assertion, not a hint",
    fragment: {
      messageCount: 910,
      medium: "text",
      mode: "chat",
      voiceEngine: "device",
      isDirective: false,
      watching: false,
      relBundle: relBundle(REL_STATE_RUPTURE, { patterns: PATTERNS_CONFLICT, rituals: RITUALS_COLD }),
      ageGates: GATES_MINOR_SAFE,
      gapSinceLastMs: 5_400_000,
    },
  },
];

const CLOCK_LEVELS = [
  { id: "dawn", iso: CLOCK.DAWN },
  { id: "midday", iso: CLOCK.MIDDAY },
  { id: "dusk", iso: CLOCK.DUSK },
  { id: "late", iso: CLOCK.LATE },
];

const LOAD_LEVELS = [
  {
    id: "light",
    user: USER_LIGHT,
    memories: MEMORIES_LIGHT,
    herLife: HERLIFE_LIGHT,
    innerThread: INNER_THREAD_LIGHT,
    innerWants: INNER_WANTS_LIGHT,
    cultureNoteText: "",
  },
  {
    id: "heavy",
    user: USER_HEAVY,
    memories: MEMORIES_HEAVY,
    herLife: HERLIFE_HEAVY,
    innerThread: INNER_THREAD_HEAVY,
    innerWants: INNER_WANTS_HEAVY,
    cultureNoteText: CULTURE_NOTE,
  },
];

export interface StateVariant {
  id: string;
  note: string;
  pinnedNowIso: string;
  input: Omit<CompileInput, "latestUserText">;
}

export const STATE_VARIANTS: StateVariant[] = REGIMES.flatMap((regime) =>
  CLOCK_LEVELS.flatMap((clock) =>
    LOAD_LEVELS.map((load) => ({
      id: `${regime.id}__${clock.id}__${load.id}`,
      note: `${regime.note} | clock=${clock.id} | load=${load.id}`,
      pinnedNowIso: clock.iso,
      input: {
        ...regime.fragment,
        // "bare" regime's directive-ness rides the load axis (an extra,
        // free bit of coverage: light=directive open turn, heavy=normal
        // chat) rather than adding a 5th multiplicative axis for one flag.
        isDirective: regime.id === "bare" ? load.id === "light" : regime.fragment.isDirective,
        user: load.user,
        memories: load.memories,
        herLife: load.herLife,
        innerThread: load.innerThread,
        innerWants: load.innerWants,
        cultureNoteText: regime.fragment.mode === "call" ? "" : load.cultureNoteText,
      },
    })),
  ),
);
