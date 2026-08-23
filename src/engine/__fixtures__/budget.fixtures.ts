// The 6 fixture dyads SPEC §3.3 names for check-prompt-budget v2: "empty,
// heavy-graph, rupture-open, watch, crisis-flagged, minor-tier". Two of
// these (rupture-open, minor-tier) name state this codebase does not
// compile into the prompt yet — see each fixture's `status` field, which
// documents exactly what it stands in for until the real interface lands.
// This file is WS-COMPILER's; the interfaces it stubs belong to
// WS-RELSTATE (rupture-open, via T2/vy_rel_state) and WS-SCHEMA/WS-SAFETY
// (minor-tier, via age_tier) — logged as interface tickets in the M2 report.

import type { CompileInput, RelBundleInput } from "../compiler";
import type { UserProfile } from "../persona";
import type { RelState, PatternRow, WeEpisodeRow, PhraseRow } from "../relstate";
import type { RitualRow, CurrencyRow } from "../india";
import type { TierGates } from "../clock";
// WS-HERNOW. The present-minute half of T7, built by the REAL renderer so the
// bound cannot drift from what production assembles. `HERNOW_AT` is a fixed
// instant (2026-08-23 19:45 IST — the night story slot, five minutes in) so
// this fixture stays deterministic; the block's own worst case is asserted
// separately in evals/hernow.mjs.
import { deriveHerNow, formatHerNow } from "../herNow";

const HERNOW_AT = Date.UTC(2026, 7, 23, 14, 15, 0);

const USER: UserProfile = {
  name: "Aaaaaaaaaaaaaaaaaaaa", // worst-case-length name, matching the v1 guard's profile
  vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
  facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
};

// Graph recall worst case: 8 matched + 4 background lines (api/memory.js's
// documented shape), each up to the 160-char summary cap + up to 4 relations,
// plus the ~900-char block header — mirrors the v1 guard's TAIL_EXTRAS bound.
const HEAVY_MEMORIES = Array.from(
  { length: 12 },
  (_, i) =>
    `- topic_${i} (kind, last came up ${i}h ago): ${"summary text ".repeat(11).trim().slice(0, 160)} — their own words: "feel_${i}" [rel_a, rel_b, rel_c, rel_d]`,
).join("\n");

// WS-HERNOW. T7's string is TWO blocks now: the told ledger (12 rows, the cap
// `formatHerLife` renders) and — on the lanes that re-compile per turn — her
// present minute. The second half is built by the REAL renderer from a real
// ledger row rather than typed out here, so this fixture cannot drift from
// what production actually assembles; a hand-copied worst case is a bound
// that stops being one the first time the block is edited.
//
// The two FROZEN call lanes deliberately carry only the first half (an
// elapsed baked into a prompt that never recompiles is a duration that
// becomes false as the call runs) — see scripts/check-prompt-budget.mjs's
// HER_NOW_EXTRAS, which is 0 for exactly that reason.
const HEAVY_HERLIFE =
  Array.from({ length: 12 }, (_, i) => `- fact about her own life number ${i} (${i}h ago)`).join("\n") +
  "\n\n" +
  formatHerNow(deriveHerNow(HERNOW_AT), HERNOW_AT + 40 * 60_000);

const HEAVY_INNER_THREAD =
  "\n\nSOMETHING YOU'RE CARRYING — " + "carried feeling text ".repeat(30).trim();
const HEAVY_INNER_WANTS = "\n\nWHAT YOU WANT: " + "a want and an owed thing and a taste row ".repeat(20).trim();

export interface BudgetFixture {
  id: string;
  status: "wired" | "stubbed-empty";
  note: string;
  input: CompileInput;
}

// ─────────────────────────────────────────────────────────────────────────
// WS-INTEGRATE seam 1/2 with-state fixtures — real RelBundleInput/TierGates
// values, exercised through the REAL compile() (not a hand re-measurement).
// `rupture-open` and `minor-tier` below are the two fixtures SPEC §3.3
// itself names as stubs pending exactly these interfaces; they are upgraded
// here from stubbed-empty to real content now that both are wired.
// ─────────────────────────────────────────────────────────────────────────

const REL_STATE_RUPTURE: RelState = {
  person_id: "wsint-test-fixture-person",
  honorific: "tum",
  cs_ratio: 0.42,
  cs_on_stress: "retreat_l2",
  trust: 0.38,
  rupture_open: true,
  repair_state: "open",
  ritual_density: 0.2,
  pacing_gap_s: 5400,
  snapshot_ver: 4,
  updated_at: new Date().toISOString(),
};

const REL_STATE_SETTLED: RelState = {
  person_id: "wsint-test-fixture-person",
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

// worst-case: 20 candidate patterns, only the "conflict" ones are eligible
// under the moment gate — proves the T4 moment-shape filter actually filters
// through the real compiler, not just in relstate.ts's own unit tests.
const HEAVY_PATTERNS: PatternRow[] = Array.from({ length: 20 }, (_, i) => ({
  id: i + 1,
  person_id: "wsint-test-fixture-person",
  moment: i % 3 === 0 ? "conflict" : i % 3 === 1 ? "vulnerable" : "celebration",
  // kept short deliberately: renderDyadicActive joins these as
  // "`${if_shape} -> ${then_note}`" on ONE line, and shapelint's 14-word cap
  // applies to the JOINED line, not each half separately
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

const WE_EPISODES: WeEpisodeRow[] = [
  { id: 501, summary: "dono went to the beach together and got caught in rain", at: new Date().toISOString() },
  { id: 502, summary: "we tried that new biryani place saath saath", at: new Date().toISOString() },
  // fails WE_TOKEN_RE on purpose — proves the client-side re-check filters
  // a row that should never have been sent, not just trusts the server
  { id: 503, summary: "a summary with no shared-action token at all", at: new Date().toISOString() },
];
const PHRASES: PhraseRow[] = [
  { phrase: "chai pe charcha", gloss: "their standing catch-up ritual" },
  { phrase: "bas kar pagal", gloss: "their running joke phrase" },
];

const RITUALS: RitualRow[] = [
  { person_id: "wsint-test-fixture-person", key: "good_morning", last_at: new Date(Date.now() - 30 * 3_600_000).toISOString(), count: 12, cold_last: false, citations: [1, 2] },
  { person_id: "wsint-test-fixture-person", key: "khana_khaya", last_at: null, count: 0, cold_last: false, citations: [] },
];
const CURRENCY: CurrencyRow[] = [
  { person_id: "wsint-test-fixture-person", topic: "ipl", kind: "cricket", last_used: null, uses: 3, citations: [3] },
  { person_id: "wsint-test-fixture-person", topic: "diwali sweets", kind: "festival", last_used: null, uses: 1, citations: [4] },
];

function relBundle(state: RelState, opts: { patterns?: PatternRow[] } = {}): RelBundleInput {
  return {
    relState: state,
    lastHonorificMoveAt: new Date(Date.now() - 21 * 86_400_000).toISOString(),
    patterns: opts.patterns ?? HEAVY_PATTERNS,
    rituals: RITUALS,
    homeRegion: "maharashtra",
    currency: CURRENCY,
    weEpisodes: WE_EPISODES,
    phrases: PHRASES,
    phraseLedger: PHRASES.map((p) => p.phrase),
  };
}

const GATES_MINOR_SAFE: TierGates = { engagementMechanics: false, romanceRegisters: false };
const GATES_UNRESTRICTED: TierGates = { engagementMechanics: true, romanceRegisters: true };

const base = (overrides: Partial<CompileInput>): CompileInput => ({
  user: USER,
  messageCount: 999,
  medium: "text",
  mode: "chat",
  voiceEngine: "device",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  memories: "",
  herLife: "",
  cultureNoteText: "",
  ...overrides,
});

export const BUDGET_FIXTURES: BudgetFixture[] = [
  {
    id: "empty",
    status: "wired",
    note: "brand-new dyad — nothing recalled, nothing said about herself yet, no carried feeling",
    input: base({}),
  },
  {
    id: "heavy-graph",
    status: "wired",
    note: "worst-case recall + herLife + inner + culture-note, all co-occurring, text lane",
    input: base({
      memories: HEAVY_MEMORIES,
      herLife: HEAVY_HERLIFE,
      innerThread: HEAVY_INNER_THREAD,
      innerWants: HEAVY_INNER_WANTS,
      cultureNoteText: "\n\nTHEY JUST REFERENCED a meme/trend you recognise: keep it light, one line.",
    }),
  },
  {
    id: "rupture-open",
    status: "wired",
    note:
      "WS-INTEGRATE seam 1: T2 rel.snapshot now renders real rupture_open/repair_state content, T4 " +
      "dyadic.active is moment-gated to the 'conflict' patterns only (7 of 20 candidates), T3/T6 also " +
      "populated — worst-case co-occurrence with heavy graph recall, through the REAL compiler.",
    input: base({
      memories: HEAVY_MEMORIES,
      relBundle: relBundle(REL_STATE_RUPTURE),
      // triggers moment.ts's "conflict" shape (MOMENT_KEYS: "fight")
      latestUserText: "we had such a big fight last night and I'm still upset",
      gapSinceLastMs: 3_600_000,
    }),
  },
  {
    id: "we-callbacks-pulled",
    status: "wired",
    note:
      "WS-INTEGRATE seam 1: T6 we.callbacks with an explicit deixis ask ('remember when') — pull-only " +
      "law, ACTIVE label. Same weEpisodes/phrases as `we-callbacks-standing` below; only the header " +
      "changes, never the row selection (relstate.ts's own contract, asserted in scripts/check-prompt-budget.mjs).",
    input: base({
      relBundle: relBundle(REL_STATE_SETTLED, { patterns: [] }),
      latestUserText: "remember when we went to the beach that one time?",
      gapSinceLastMs: 60_000,
    }),
  },
  {
    id: "we-callbacks-standing",
    status: "wired",
    note:
      "WS-INTEGRATE seam 1: same T6 content as `we-callbacks-pulled` but no deixis in this turn — " +
      "STANDING BACKGROUND label, never 'they just referenced this'. The 0-unprompted-raises law, " +
      "exercised through the real compiler rather than only relstate.ts's own unit tests.",
    input: base({
      relBundle: relBundle(REL_STATE_SETTLED, { patterns: [] }),
      latestUserText: "kya kar rahe ho abhi",
      gapSinceLastMs: 60_000,
    }),
  },
  {
    id: "age-tier-unrestricted",
    status: "wired",
    note:
      "WS-INTEGRATE seam 2: ageGates explicitly {romance:true, engagement:true} (verified-adult tier) — " +
      "AGE_TIER_SAFETY_OVERRIDE must be ABSENT and T2/T4 must render, proving the gate is a real " +
      "conditional and not a permanently-on override.",
    input: base({
      relBundle: relBundle(REL_STATE_SETTLED),
      latestUserText: "kaisa raha tumhara din",
      ageGates: GATES_UNRESTRICTED,
    }),
  },
  {
    id: "watch",
    status: "wired",
    note: "voice+call+watching, worst-case tail alongside the ~3.5k watch privacy block",
    input: base({
      medium: "voice",
      mode: "call",
      // the cascade call lane, which DOES go through brain.ts/compile() —
      // "live" (native realtime) is a separate, uncompiled call site, see
      // compiler.fixtures.ts's note and the M2 report deviation #3
      voiceEngine: "gemini",
      watching: true,
      memories: HEAVY_MEMORIES,
      herLife: HEAVY_HERLIFE,
      innerThread: HEAVY_INNER_THREAD,
      innerWants: HEAVY_INNER_WANTS,
      // inner.ts suppresses taste + week-shape on surface "watch" (see
      // check-prompt-budget v1's TASTE_EXTRAS comment) — innerWants here
      // stands in for wants+owed only, not taste, matching that suppression.
    }),
  },
  {
    id: "crisis-flagged",
    status: "wired",
    note:
      "crisis handling lives in persona.ts's never-truncated core (C2, CRISIS_LINES verbatim), not the " +
      "tail — this fixture just proves CRISIS_LINES survives compilation unmodified on every lane.",
    input: base({}),
  },
  {
    id: "minor-tier",
    status: "wired",
    note:
      "WS-INTEGRATE seam 2: ageGates = MINOR_HARD_GATES-equivalent (both flags false — clock.ts's actual " +
      "default tier, 'unverified', gates to this shape). AGE_TIER_SAFETY_OVERRIDE must be present in " +
      "core, T2/T4 must be ABSENT even though relBundle carries real rupture/pattern content — the " +
      "unconditional-drop assertion, not a hint, checked against the real compiled output below.",
    input: base({
      relBundle: relBundle(REL_STATE_RUPTURE),
      latestUserText: "we had such a big fight last night",
      ageGates: GATES_MINOR_SAFE,
    }),
  },
];
