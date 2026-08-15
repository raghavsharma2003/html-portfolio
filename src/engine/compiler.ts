// The context compiler — SPEC.md §3. Extracted from brain.ts (WS-COMPILER,
// M2). Two jobs, kept strictly separate because they carry different risk:
//
//   1. ASSEMBLY (`compile`) — a pure function that produces the exact system
//      prompt brain.ts used to build inline. M2's law (SPEC §3, "M2 rule"):
//      byte-identical to today's assembly FIRST. `compile()` below is that
//      assembly, unchanged in content or order, just named and testable —
//      see `src/engine/__fixtures__/` for the harness that proves it against
//      a frozen copy of the pre-extraction code.
//   2. MANIFEST — typed, budgeted documentation of the TARGET layout
//      (§3.1–3.2: CORE C1–C6, TAIL T1–T10 + the multiparty addition) plus the
//      arithmetic CI must assert (§3.3). The manifest does NOT drive
//      `compile()` yet. Persona content is re-authored into that shape later,
//      each cut gated by a paired judged-equivalence run (§0.3) — "no content
//      cut happens at extraction, so no charm gate is needed there." Until
//      that lands, CORE arrives from persona.ts as one opaque, byte-stable
//      string per (medium, engine); the manifest's C1–C6 rows are the
//      documented target, not something this file can measure block-by-block
//      today. That gap is real and is reported, not hidden — see the M2
//      report for the measured numbers.
//
// Ownership (SPEC §13): this file, shapelint.ts, scripts/check-prompt-budget.mjs,
// api/chat.js and brain.ts's call sites belong to WS-COMPILER exclusively.
// persona.ts is READ-ONLY here — buildSystemPromptParts / buildSpeechStyle
// stay exactly where they are; this file only calls them.

import {
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
  SEARCH_DECISION,
  FORGET_DECISION,
  CRISIS_LINES,
  type UserProfile,
  type VoiceEngine,
} from "./persona";

export type Medium = "text" | "voice";
export type Mode = "chat" | "call";

// ─────────────────────────────────────────────────────────────────────────
// 1. ASSEMBLY — behavior-frozen extraction of brain.ts's `think()` prompt
//    build (formerly lines ~630–718). Every concatenation, every order, every
//    conditional is reproduced exactly. brain.ts still does the I/O (recall
//    lookups, forget resolution, inner-state read) and hands this function
//    the already-resolved strings — the compiler itself stays pure and
//    db-free, which is also what keeps check-prompt-budget.mjs db-free.
// ─────────────────────────────────────────────────────────────────────────

export interface CompileInput {
  user: UserProfile;
  messageCount: number;
  medium: Medium;
  mode: Mode;
  voiceEngine: VoiceEngine;
  // directive turns (open/nudge) never pull cultural currency — see brain.ts
  isDirective: boolean;
  // watch-together frame attached this turn (call lane only)
  watching: boolean;
  // her carried interior — already resolved by inner.innerContext()
  innerThread: string;
  innerWants: string;
  // graph-memory recall, already formatted ("" = nothing recalled)
  memories: string;
  // formatHerLife() output ("" = nothing said yet)
  herLife: string;
  // culture.cultureNote(latest) output ("" = no match)
  cultureNoteText: string;
}

export interface CompiledPrompt {
  core: string;
  tail: string;
  // core + tail — what actually goes to the model (fullSystem in brain.ts)
  system: string;
}

/**
 * The context compiler's one required property for M2: this function's
 * output must be byte-for-byte identical to what brain.ts assembled inline
 * before extraction, for every input this codebase can produce. See
 * `src/engine/__fixtures__/byte-identity.mjs` for the proof harness.
 */
export function compile(input: CompileInput): CompiledPrompt {
  const parts = buildSystemPromptParts(input.user, input.messageCount, input.medium);
  const core = parts.core + (input.mode === "call" ? buildSpeechStyle(input.voiceEngine) : "");

  let tail = parts.tail;

  // ── her carried interior — FIRST in the tail (see brain.ts's original
  // comment: api/chat.js keeps the first N chars of the tail and cuts the
  // end, so if anything is ever lost it must be the recall list, never
  // where she actually is) ──
  tail += input.innerThread;

  // watch mode goes in early, not at point of use — same reasoning: it must
  // outlive a long tail's truncation before recall/herLife do
  if (input.watching) tail += WATCH_MODE_NOTE;

  if (input.memories) {
    tail += `\n\nWHAT YOU REMEMBER ABOUT THEM — from your earlier conversations, each tagged with when it last came up. These are real: when they touch on one, you KNOW it and you say the specific detail rather than making them repeat themselves. Two things keep it honest:
- Something being listed here is not a reason to say it. It comes out only where it actually fits, one at a time, woven into normal talk — never several at once, never as a list, never with any mention of remembering.
- A memory is not a live update. Anything with a date, a plan or a situation in it may already have happened or changed, so an old one gets talked about as old ("us december wali shaadi ho gayi na?") instead of announced as if it's still ahead — and then you let them tell you where it stands.
${input.memories}`;
  }
  if (input.herLife) {
    tail += `\n\nWHAT YOU'VE ALREADY TOLD THEM ABOUT YOUR OWN LIFE — you said these, so they are now fixed between you two, not open to reinvention. Same job, same people, same flat, same plans, same things you did. Add new texture freely; never say anything that contradicts a line here, and never re-tell one as if it's news:\n${input.herLife}`;
  }
  // her forward-facing life goes right after her past-facing one (see
  // brain.ts's original note on herLife recency-eviction vs a want staying
  // the same object across weeks)
  tail += input.innerWants;

  if (input.mode === "chat" && !input.isDirective) tail += input.cultureNoteText;
  // dead last, chat only — see SEARCH_DECISION in persona.ts for why
  // position is the entire mechanism here
  if (input.mode === "chat") tail += SEARCH_DECISION;
  // both lanes — see FORGET_DECISION in persona.ts
  tail += FORGET_DECISION;

  return { core, tail, system: core + tail };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. MANIFEST — SPEC §3.1–3.2 target layout, as data. Not wired into
//    `compile()` yet (see file header). `sourceStatus` says, per block,
//    exactly how today's real code relates to the spec's row — this is the
//    honest bookkeeping the M2 report is built from.
// ─────────────────────────────────────────────────────────────────────────

export type DropPriority = "never" | 1 | 2 | 3 | 4 | 5 | 6;

export type SourceStatus =
  // this file computes it directly from a real, already-wired input
  | "wired"
  // the content exists today but is fused inside another block's string —
  // named so a future split doesn't have to be rediscovered
  | { fused: string; note: string }
  // reserved per the owner's multiparty direction / WS-RELSTATE's future
  // interface — zero bytes today, on purpose
  | "empty-reserved"
  // the spec names it; nothing in the current codebase produces it yet
  | "not-yet-modeled";

export interface CoreBlock {
  readonly id: "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
  readonly label: string;
  readonly budget: number;
  readonly sourceStatus: SourceStatus;
}

export interface TailBlock {
  readonly id: string;
  readonly label: string;
  readonly budget: number;
  readonly dropPriority: DropPriority;
  readonly sourceStatus: SourceStatus;
}

// §3.1 — cap 40,000, byte-stable per (persona_version, model, medium)
export const CORE_CAP = 40_000;
// §3.2 — cap 24,000, volatile per turn
export const TAIL_CAP = 24_000;
// §0.1 budget arithmetic: core 40,000 + tail 24,000 = SYSTEM_MAX exactly
export const SYSTEM_MAX = 64_000;

// What api/chat.js actually enforces TODAY (unchanged by this extraction —
// M2's law is byte-identical live behavior, and no persona content cut has
// happened, so shrinking the live guard to CORE_CAP would either truncate
// real traffic or require a content cut this milestone explicitly disclaims,
// SPEC §0.3 "Persona factoring charm risk"). check-prompt-budget.mjs asserts
// these two numbers match the literal constants in api/chat.js, so guard and
// guarded cannot drift even though they aren't (yet) the SPEC's target caps.
export const OPERATIONAL_CORE_CAP = 64_000;
export const OPERATIONAL_TAIL_CAP = 24_000;

export const CORE_MANIFEST: readonly CoreBlock[] = [
  {
    id: "C1",
    label: "identity.canon",
    budget: 14_000,
    sourceStatus: {
      fused: "persona.core",
      note:
        "buildSystemPromptParts().core is one opaque string; canon/voice/comfort-ladder " +
        "content is in there but not independently sliceable without editing persona.ts " +
        "(READ-ONLY for WS-COMPILER). See M2 report deviation #1.",
    },
  },
  {
    id: "C2",
    label: "identity.behavior",
    budget: 9_000,
    sourceStatus: {
      fused: "persona.core",
      note: "NEVER MANIPULATE / never-deny-AI / crisis protocol + CRISIS_LINES live inside persona.core.",
    },
  },
  {
    id: "C3",
    label: "watch.privacy",
    budget: 3_500,
    sourceStatus: {
      fused: "persona.core",
      note: "Watch directives + honest-answer paragraph are inside persona.core, byte-stable per medium already.",
    },
  },
  {
    id: "C4",
    label: "protocol.markers",
    budget: 5_500,
    sourceStatus: { fused: "persona.core", note: "Tag vocabulary / bubble rules live inside persona.core." },
  },
  {
    id: "C5",
    label: "relationship.legend",
    budget: 1_500,
    sourceStatus: "not-yet-modeled", // WS-RELSTATE interface — no legend text exists yet
  },
  {
    id: "C6",
    label: "adapter.<model>",
    budget: 4_500,
    sourceStatus: {
      fused: "buildSpeechStyle(engine)",
      note: "Appended to core only on mode==='call'; today it is a single per-engine string, not split by rendering concern.",
    },
  },
] as const;

// §3.2 — TAIL, drop priority 1 = first dropped, "never" = undroppable.
// T8-multiparty is the owner's addition (context/decisions.md
// `multiparty-direction`, logged as multiparty-direction): an empty,
// documented slot for GROUP/DISCLOSURE context so the group layer lands as
// content in a slot, not as edits to WS-COMPILER's files. Sized 0 now;
// budget ≤2,000 is the reserved ceiling for whoever wires it.
export const TAIL_MANIFEST: readonly TailBlock[] = [
  {
    id: "T1",
    label: "inner.thread",
    budget: 1_500,
    dropPriority: "never",
    sourceStatus: "wired", // input.innerThread, from inner.innerContext()
  },
  {
    id: "T2",
    label: "rel.snapshot",
    budget: 1_200,
    dropPriority: 6,
    sourceStatus: "empty-reserved", // WS-RELSTATE, vy_rel_state — M4
  },
  {
    id: "T3",
    label: "india.dynamic",
    budget: 1_000,
    dropPriority: 4,
    sourceStatus: "empty-reserved", // WS-RELSTATE, vy_ritual/vy_currency — M4
  },
  {
    id: "T4",
    label: "dyadic.active",
    budget: 1_600,
    dropPriority: 5,
    sourceStatus: "empty-reserved", // WS-RELSTATE, vy_pattern — M4
  },
  {
    id: "T5",
    label: "recall.facts",
    budget: 6_000,
    dropPriority: 2,
    sourceStatus: "wired", // input.memories — today's api/memory.js graph recall block
  },
  {
    id: "T6",
    label: "we.callbacks",
    budget: 2_000,
    dropPriority: 3,
    sourceStatus: "empty-reserved", // WS-RELSTATE / WS-CONSOLIDATE participation='we' — M3/M4
  },
  {
    id: "T7",
    label: "herlife",
    budget: 1_000,
    dropPriority: 1,
    sourceStatus: "wired", // input.herLife — brain.ts's formatHerLife()
  },
  {
    id: "T8",
    label: "taste.rows",
    budget: 800,
    dropPriority: "never",
    sourceStatus: {
      fused: "innerWants",
      note:
        "inner.innerContext() returns taste already concatenated into `wants` " +
        "(wantsBlock+owedBlock+taste in inner.ts, not owned by WS-COMPILER). " +
        "Cannot be measured or capped separately without an inner.ts interface change. " +
        "See M2 report deviation #2.",
    },
  },
  {
    id: "T9",
    label: "session.clock",
    budget: 300,
    dropPriority: "never",
    sourceStatus: "not-yet-modeled", // WS-SAFETY owns clock.ts/ClockCard.tsx concurrently — interface ticket filed
  },
  // ── the owner's multiparty addition (context/decisions.md `multiparty-direction`) ──
  {
    id: "T8-multiparty",
    label: "group.disclosure",
    budget: 0, // reserved; intended ceiling documented below, not enforced yet
    dropPriority: 3,
    sourceStatus: "empty-reserved",
  },
  {
    id: "T10",
    label: "decision.rules",
    budget: 2_000,
    dropPriority: "never",
    sourceStatus: "wired", // SEARCH_DECISION (chat only) + FORGET_DECISION, appended last by compile()
  },
] as const;

// The reserved ceiling for T8-multiparty once WS-GROUP wires it — kept out
// of TailBlock.budget (0 today) so the manifest's own arithmetic below stays
// truthful about what ships now, per the owner's direction that it must land
// as content in this slot, not as edits to WS-COMPILER's files.
export const T8_MULTIPARTY_RESERVED_CEILING = 2_000;

// Fixed compile-time order — T10 is PINNED LAST (shapelint enforces this;
// the appended-last set is capped at exactly two rules: SEARCH_DECISION and
// FORGET_DECISION, both folded into T10). T8-multiparty sits directly before
// T10 so a future group-context render never displaces the pinned position.
export const TAIL_ORDER: readonly string[] = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
  "T8-multiparty",
  "T10",
] as const;

// ─────────────────────────────────────────────────────────────────────────
// 3. ARITHMETIC — §3.3 "asserted in CI ... as numbers, not prose."
// ─────────────────────────────────────────────────────────────────────────

export interface ManifestArithmetic {
  coreCapSum: number;
  tailCapSum: number;
  capSumOk: boolean; // CORE_CAP + TAIL_CAP === SYSTEM_MAX
  coreBudgetTotal: number; // sum of CORE_MANIFEST budgets (the "38,000" row)
  undroppableActual: number; // core budget total + never-drop TAIL budgets
  undroppableAtCap: number; // CORE_CAP + never-drop TAIL budgets
  undroppableHeadroomActual: number; // SYSTEM_MAX - undroppableActual
  undroppableHeadroomAtCap: number; // SYSTEM_MAX - undroppableAtCap
}

export function computeManifestArithmetic(): ManifestArithmetic {
  const coreCapSum = CORE_CAP + TAIL_CAP;
  const coreBudgetTotal = CORE_MANIFEST.reduce((sum, b) => sum + b.budget, 0);
  const neverDropTotal = TAIL_MANIFEST.filter((b) => b.dropPriority === "never").reduce(
    (sum, b) => sum + b.budget,
    0,
  );
  const undroppableActual = coreBudgetTotal + neverDropTotal;
  const undroppableAtCap = CORE_CAP + neverDropTotal;
  return {
    coreCapSum,
    tailCapSum: TAIL_CAP,
    capSumOk: coreCapSum === SYSTEM_MAX,
    coreBudgetTotal,
    undroppableActual,
    undroppableAtCap,
    undroppableHeadroomActual: SYSTEM_MAX - undroppableActual,
    undroppableHeadroomAtCap: SYSTEM_MAX - undroppableAtCap,
  };
}

/** Throws with a specific message on the first violated identity — used by
 * check-prompt-budget.mjs v2 so a broken manifest fails loudly, never silently. */
export function assertManifestArithmetic(): void {
  const a = computeManifestArithmetic();
  if (!a.capSumOk) {
    throw new Error(
      `manifest arithmetic broken: CORE_CAP(${CORE_CAP}) + TAIL_CAP(${TAIL_CAP}) = ${a.coreCapSum}, ` +
        `expected SYSTEM_MAX(${SYSTEM_MAX}) exactly (SPEC §0.2 flaw #2)`,
    );
  }
  if (a.undroppableAtCap >= SYSTEM_MAX) {
    throw new Error(
      `undroppable set at cap (${a.undroppableAtCap}) does not sit strictly under SYSTEM_MAX (${SYSTEM_MAX})`,
    );
  }
  if (a.undroppableActual >= SYSTEM_MAX) {
    throw new Error(
      `undroppable set actual (${a.undroppableActual}) does not sit strictly under SYSTEM_MAX (${SYSTEM_MAX})`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────
// 4. DROP ORDER — "the compiler NEVER slices — it drops whole blocks
//    lowest-priority-first" (§3.2). Used by the forced-overflow fixture in
//    check-prompt-budget.mjs v2 today; will back real TAIL assembly once
//    WS-RELSTATE's blocks are wired (M4).
// ─────────────────────────────────────────────────────────────────────────

export interface DroppableBlock {
  id: string;
  priority: DropPriority;
  text: string;
}

export interface DropResult {
  kept: DroppableBlock[];
  dropped: DroppableBlock[];
  totalChars: number;
}

/** Drops whole blocks, in ascending drop-priority order (prio 1 first), one
 * at a time, until the kept set fits `capChars` — the literal mechanism
 * behind "the compiler NEVER slices ... drop prio 1 = first dropped" (§3.2):
 * this is sequential whole-block removal in priority order, not a bin-pack,
 * so a single low-priority block can be sacrificed to save everything above
 * it. "never" blocks are always kept, even over cap (that overflow is a
 * manifest bug to fix, not something this function may hide by silently
 * trimming — "a sliced block is a lie"). */
export function applyDropOrder(blocks: DroppableBlock[], capChars: number): DropResult {
  const never = blocks.filter((b) => b.priority === "never");
  const droppableAsc = blocks
    .filter((b) => b.priority !== "never")
    .sort((a, b) => (a.priority as number) - (b.priority as number));

  let kept = [...never, ...droppableAsc];
  const dropped: DroppableBlock[] = [];
  let total = kept.reduce((sum, b) => sum + b.text.length, 0);

  for (const b of droppableAsc) {
    if (total <= capChars) break;
    kept = kept.filter((x) => x !== b);
    dropped.push(b);
    total -= b.text.length;
  }
  return { kept, dropped, totalChars: total };
}

// ─────────────────────────────────────────────────────────────────────────
// 5. HASHING — for the cache-9x guard (double-compile byte-identity, prod
//    core-hash sampling per §3.3). Deliberately NOT node:crypto: compiler.ts
//    is imported by brain.ts, which runs in the browser/Capacitor app, so
//    this stays dependency-free and isomorphic. It is a fingerprint for
//    logging and equality-sampling, never a security boundary — the actual
//    byte-identity proof is strict string equality, done separately.
// ─────────────────────────────────────────────────────────────────────────

export function hashCore(text: string): string {
  // FNV-1a, 32-bit, doubled into two lanes for a 64-bit-ish hex fingerprint —
  // collision-cheap enough for "did the core change" telemetry sampling.
  let h1 = 0x811c9dc5;
  let h2 = 0x1000193 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + i;
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, "0") + (h2 >>> 0).toString(16).padStart(8, "0");
}

export function coresByteIdentical(a: string, b: string): boolean {
  return a === b;
}

export { CRISIS_LINES };
