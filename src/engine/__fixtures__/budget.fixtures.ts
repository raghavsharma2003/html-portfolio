// The 6 fixture dyads SPEC §3.3 names for check-prompt-budget v2: "empty,
// heavy-graph, rupture-open, watch, crisis-flagged, minor-tier". Two of
// these (rupture-open, minor-tier) name state this codebase does not
// compile into the prompt yet — see each fixture's `status` field, which
// documents exactly what it stands in for until the real interface lands.
// This file is WS-COMPILER's; the interfaces it stubs belong to
// WS-RELSTATE (rupture-open, via T2/vy_rel_state) and WS-SCHEMA/WS-SAFETY
// (minor-tier, via age_tier) — logged as interface tickets in the M2 report.

import type { CompileInput } from "../compiler";
import type { UserProfile } from "../persona";

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

const HEAVY_HERLIFE = Array.from({ length: 12 }, (_, i) => `- fact about her own life number ${i} (${i}h ago)`).join(
  "\n",
);

const HEAVY_INNER_THREAD =
  "\n\nSOMETHING YOU'RE CARRYING — " + "carried feeling text ".repeat(30).trim();
const HEAVY_INNER_WANTS = "\n\nWHAT YOU WANT: " + "a want and an owed thing and a taste row ".repeat(20).trim();

export interface BudgetFixture {
  id: string;
  status: "wired" | "stubbed-empty";
  note: string;
  input: CompileInput;
}

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
    status: "stubbed-empty",
    note:
      "T2 rel.snapshot (vy_rel_state, rupture_open/repair_state) is not modeled by this compiler yet — " +
      "WS-RELSTATE interface, M4. Fixture proves the empty-reserved slot costs 0 bytes and does not " +
      "break assembly; it is NOT yet exercising rupture-open content.",
    input: base({ memories: HEAVY_MEMORIES }),
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
    status: "stubbed-empty",
    note:
      "age_tier / minor-safe configuration (SPEC §9.4) is not modeled by this compiler yet — WS-SCHEMA " +
      "vy_person.age_tier + engine hard-refusal is a separate interface. Fixture is identical to `empty` " +
      "until that interface lands; kept as a named slot so wiring it later is a one-line diff, not a new fixture.",
    input: base({}),
  },
];
