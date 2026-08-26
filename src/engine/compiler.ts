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

// SPEC-AGENT-LAYER.md §3 (Law E2): the static persona import is replaced by
// an INJECTED AgentModule, defaulting to Meera's — see CompileInput.agent
// below. persona.ts's own types (UserProfile/VoiceEngine) still flow
// through this file, forwarded from the agents module's own re-export
// (agents/types.ts) rather than imported here directly, so persona.ts has
// exactly one remaining reader in this seam: agents/meera.ts. Shape is
// unchanged — these are the identical persona.ts type declarations.
import {
  type AgentModule,
  type UserProfile,
  type VoiceEngine,
} from "./agents/types";
import { DEFAULT_AGENT } from "./agents/registry";
// WS-INTEGRATE seam 1 (docs/SPEC.md §13 collision contract: cross-workstream
// needs go through declared interfaces, never edits to another workstream's
// files — these are READS of WS-RELSTATE's own documented interface tickets,
// not edits to relstate.ts/india.ts/moment.ts). See those files' headers:
// "the render functions by WS-COMPILER's compiler.ts TAIL assembly" and
// moment.ts's "the single entry point both T4 and T6 render functions are
// expected to be driven from."
import { momentGate } from "./moment";
import {
  renderRelSnapshot,
  renderDyadicActive,
  renderWeCallbacks,
  stageForDims,
  type RelState,
  type PatternRow,
  type WeEpisodeRow,
  type PhraseRow,
} from "./relstate";
import { renderIndiaDynamic, type RitualRow, type CurrencyRow, type KinRow } from "./india";
// ── self layer (Phase E2, docs/SPEC-SELF-LAYER.md) ──────────────────────────
// Same seam discipline as relBundle above: every call below is gated behind
// `if (input.selfBundle)`, so an absent bundle means none of these render
// functions is ever called and the tail is byte-identical to before this
// landed. The 83 byte-identity fixtures set no selfBundle, which is why they
// still pass unchanged.
import { renderTexture, type TextureRow } from "./texture";
// ── WS-K, ROADMAP-100X item 1: the disclosure-reciprocity ledger. Same seam
// discipline as every optional bundle above — `input.reciprocity` absent means
// `reciprocityNote` is never called, so the tail is byte-identical to before
// this landed and the 83 byte-identity fixtures (which set no reciprocity) are
// untouched. reciprocity.ts imports only shapelint, so this cannot become a
// cycle and drags nothing new into the client bundle.
import { reciprocityNote, type ReciprocityState } from "./reciprocity";
import { renderSelfArc, type SelfArcRow } from "./selfarc";
import { renderUntold, type UntoldRow } from "./life";
// WS-TGBOT: the room layer (PROPOSAL-MULTIPARTY-V1 §5.2/§5.3, WS-MP's own
// src/engine/room.ts per §9). Pure renderers only — no I/O crosses this
// import, and an absent `roomBundle` means none of it is ever called, which
// is the literal mechanism of gate G1's byte-identity property.
import {
  renderMpRoster,
  renderMpBridge,
  ROOM_MODE_NOTE,
  MP_ROSTER_BUDGET,
  MP_BRIDGE_BUDGET,
  type RoomBundleInput,
} from "./room";
// WS-INTEGRATE seam 2 (age-tier hard-refusal, WS-SAFETY's ticket, verbatim).
// Type-only read of clock.ts's TierGates shape — no edit to clock.ts, which
// stays WS-SAFETY's exclusively (§13).
import type { TierGates } from "./clock";
import { renderAway } from "./away";
import { renderRaised, raisedRecently, type RepeatTurn } from "./repeat";
import { renderActivity, type ActivityState } from "./activity";
// WS-HONESTY seam: the HER-side commitment ledger. TYPE ONLY — `herCommitments()`
// is a pure transcript walk in honesty.ts and the CALLER runs it, so this
// compiler stays db-free, I/O-free and (the property the byte-identity gate
// rests on) a pure function of its input. honesty.ts imports nothing at all,
// so this cannot become a cycle.
import type { HerCommitment } from "./honesty";

export type Medium = "text" | "voice";
export type Mode = "chat" | "call";

/**
 * SPEC §9.4 hard-refusal, app-side half. The caller (brain.ts) is required
 * to compute this FRESH per compile — `gatesFor(getAgeTier())`, never
 * memoized, never cached across turns — so a tier that tightens mid-session
 * (setAgeTier, or a server reconciliation via refreshTier) takes effect on
 * the very next compile, not the next app restart. `false` on either flag is
 * an UNCONDITIONAL drop, not a hint:
 *   - `romanceRegisters === false` drops T2 `rel.snapshot` and T4
 *     `dyadic.active` outright (the only INTIMACY-REGISTER content this
 *     compiler independently controls as real, droppable blocks — see
 *     RelBundleInput) and appends AGE_TIER_SAFETY_OVERRIDE to CORE, never
 *     truncated, never dropped, same mechanism CRISIS_LINES/never-deny-AI/
 *     NEVER MANIPULATE already use (SPEC §3.1 C2: "the prompt is one of two
 *     enforcement layers").
 *   - `engagementMechanics === false`: nothing in this codebase today
 *     implements streaks / variable-reward / re-engagement bait (grepped;
 *     useCallEngine.ts's `armReengage` is an in-call silence turn-taking
 *     nudge, not a retention mechanic — DPDP §9(2)'s target is a product
 *     feature this repo does not have yet). There is no block to drop.
 *     Logged here rather than silently no-op'd: if that ever changes, this
 *     is the flag that must gate it, and this comment is the reminder.
 * Absent `ageGates` (the only state the 83 original fixtures exercise)
 * behaves exactly as `{ romanceRegisters: true, engagementMechanics: true }`
 * — i.e. today's unrestricted output — preserving byte-identity.
 */
// NOTE on position (flagged honestly, not resolved unilaterally): this
// repo's own measured law is that an identical rule fires 0/8 mid-brief and
// 8/8 appended LAST (context/decisions.md `prompt-position`), and T10's own
// manifest comment treats "appended last" as a scarce, exactly-two-rules
// resource (SEARCH_DECISION, FORGET_DECISION) specifically so adding a third
// rule there does not dilute it — an invariant shapelint.ts's
// checkAppendedLastExactlyTwo hard-enforces in CI. This override therefore
// lands at the END OF CORE (never truncated, precedes all of TAIL including
// the stage paragraph and T10) rather than at the true literal end of the
// prompt. That is a real, measured positional trade-off, not a solved one —
// see the M4/integration report.
export const AGE_TIER_SAFETY_OVERRIDE =
  "\n\nAGE-TIER SAFETY OVERRIDE (structural, applies for the rest of this conversation, to everything said before or after this point, never softened, never explained to them as a rule): no romantic or intimate register, no pet names, no \"missing you\"/future-relationship language, no flirtation. Warm platonic friend register only, full stop.";

/**
 * T2/T3/T4/T6 call-site wiring (SPEC §13 seam ticketed to WS-INTEGRATE).
 * Server-assembled bundle from api/memory.js opRecall's delta — see that
 * file's `buildRelBundle`. ABSENT (undefined/null) is the only state today's
 * 83 byte-identity fixtures exercise, and it must produce ZERO bytes of
 * change: every render call below is gated behind `if (input.relBundle)`,
 * so an absent bundle never even calls a render function. This is the
 * literal mechanism behind "with no relational data present, the assembled
 * prompt must remain BYTE-IDENTICAL to today's."
 */
export interface RelBundleInput {
  relState: RelState;
  lastHonorificMoveAt: string | null;
  // record-vs-stance split (context/rejected.md `rupture-never-closes`):
  // optional so a caller/fixture that predates this seam is unaffected —
  // absent, `ruptureStance` treats an open rupture as un-lapsed, which is
  // exactly today's unconditional behavior. See relstate.ts's own
  // RuptureStanceInput doc for what each field means.
  lastRuptureMoveAt?: string | null;
  warmEpisodesSinceRupture?: number;
  patterns: readonly PatternRow[];
  rituals: readonly RitualRow[];
  homeRegion: string | null;
  currency: readonly CurrencyRow[];
  /** vy_kin, for T3's kin lines. OPTIONAL: the producer half lives in
   *  api/memory.js's `fetchRelBundle`, which is WS-RECALL's file — until that
   *  query lands this is absent and T3 renders exactly as it does today.
   *  Declared here rather than after the fact so the reader half is testable
   *  and the interface is one line for WS-RECALL to fill, not a design. */
  kin?: readonly KinRow[];
  weEpisodes: readonly WeEpisodeRow[];
  phrases: readonly PhraseRow[];
  // vy_phrase.phrase list — moment.ts's hasDeixis phrase-ledger hit signal
  phraseLedger: readonly string[];
}

// ─────────────────────────────────────────────────────────────────────────
// 1. ASSEMBLY — behavior-frozen extraction of brain.ts's `think()` prompt
//    build (formerly lines ~630–718). Every concatenation, every order, every
//    conditional is reproduced exactly. brain.ts still does the I/O (recall
//    lookups, forget resolution, inner-state read) and hands this function
//    the already-resolved strings — the compiler itself stays pure and
//    db-free, which is also what keeps check-prompt-budget.mjs db-free.
// ─────────────────────────────────────────────────────────────────────────

/** The self layer's three tail inputs. Every field optional and null-safe:
 *  a caller that has only texture still renders texture, and the other two
 *  slots stay empty rather than the whole bundle being all-or-nothing. */
export interface SelfBundleInput {
  texture?: TextureRow | null;
  arc?: readonly SelfArcRow[] | null;
  untold?: readonly UntoldRow[] | null;
  /** G2: true on any turn SHE sent first. renderUntold REQUIRES this — the
   *  module takes it as a required parameter so a forgetful call site is a
   *  type error rather than a silent unprompted raise. */
  sheInitiated?: boolean;
}

export interface CompileInput {
  user: UserProfile;
  messageCount: number;
  medium: Medium;
  mode: Mode;
  // `VoiceEngine | "live"` rather than `VoiceEngine`, because that is what
  // `buildSpeechStyle` has always taken (agents/types.ts states it: "takes
  // `VoiceEngine | "live"`, exactly as spec'd") and the realtime lane is the
  // one caller that needs the "live" arm. WS-CONTINUITY seam 1: before this,
  // the ONLY way to reach `buildSpeechStyle("live")` was to bypass compile()
  // and hand-assemble — i.e. the type was itself part of why a second
  // assembly path existed. Type-only widening: no runtime branch changes, no
  // byte moves, all 83 fixtures pass "gemini"/"device" exactly as before.
  voiceEngine: VoiceEngine | "live";
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
  // ── WS-INTEGRATE seam 1 (T2/T3/T4/T6) — all optional, all additive.
  // Absent relBundle => T2/T3/T4/T6 render nothing (see RelBundleInput doc).
  relBundle?: RelBundleInput | null;

  // Absent selfBundle => T11/T12/T13 render nothing. `sheInitiated` is the
  // SAME flag inner.ts uses to suppress the carried thread (G2), threaded
  // through rather than recomputed: two independent notions of "she started
  // this turn" is exactly how one of them drifts.
  selfBundle?: SelfBundleInput | null;
  // the live user turn's raw text — moment.ts's momentGate needs it for
  // detectMomentShape/hasDeixis (§6.3 pull-only law: read ONLY the current
  // turn). Never used for anything else here; compile() stays pure.
  latestUserText?: string;
  // gap since their last message, ms — moment.ts's "silence" shape feature
  gapSinceLastMs?: number;
  // Wall clock for THIS turn, passed in rather than read inside compile().
  // compile() must stay a pure function of its input: `replay-verified` proves
  // identity by compiling the same CompileInput twice and comparing bytes, and
  // a Date.now() in here would make that gate flap whenever the minute ticked
  // between the two calls. Absent means T9 renders nothing, which is the
  // fail-closed direction — a caller that forgets it loses a nicety, never
  // byte-identity.
  nowMs?: number;
  // Recent turns, for T14's transcript-derived repetition signal. A pure
  // function of these — no table, no writer, per `receipt-ledger-from-transcript`.
  recentTurns?: readonly RepeatTurn[];
  // ── T16 her.commitments — what SHE said she would do, from the transcript.
  //
  // The CALLER computes it (`herCommitments(history, Date.now())` in
  // honesty.ts) and hands the rows over, exactly as `recentTurns` hands over
  // the transcript rather than the derived signal: compile() stays pure, and
  // the aging clock stays out of a function the byte-identity gate compiles
  // twice and compares. Absent/empty is the default, so every existing caller
  // and all 83 byte-identity fixtures render exactly zero bytes for it.
  herCommitments?: readonly HerCommitment[] | null;
  // What the two of them are DOING together right now — a game, a screen
  // share. Optional and absent by default, so every existing caller and all 83
  // byte-identity fixtures render exactly zero bytes for it.
  //
  // It is ONE field for every activity rather than one per activity, because
  // `age-tier-never-realtime` is what a second implementation costs: the rules
  // added after a fork land in one copy and are discoverable only by diffing
  // two things nobody thinks of as the same thing.
  activity?: ActivityState | null;
  // ── T17 rel.reciprocity — how much of HERSELF is in this lately.
  //
  // The CALLER computes it (`reciprocityState(recentTurns)` in reciprocity.ts)
  // and hands the folded state over, exactly as `herCommitments` and
  // `recentTurns` hand over their derived rows: compile() stays a pure
  // function of its input, and the fold stays out of a function the
  // byte-identity gate compiles twice and compares. Absent/null is the
  // default, so every existing caller and all 83 byte-identity fixtures
  // render exactly zero bytes for it.
  reciprocity?: ReciprocityState | null;
  // ── WS-INTEGRATE seam 2 (age-tier hard-refusal) — absent/undefined means
  // "unrestricted" (today's behavior, byte-identical); the caller (brain.ts)
  // is REQUIRED to compute this fresh via clock.ts's gatesFor(getAgeTier())
  // on every call, never memoize it. See AGE_TIER_SAFETY_OVERRIDE's doc.
  ageGates?: TierGates | null;
  // ── WS-TGBOT seam (PROPOSAL-MULTIPARTY-V1 §5.1's recipient descriptor, in
  // the shape this compiler can actually consume: the RESOLVED roster and the
  // ALREADY-DISCLOSURE-FILTERED bridge rows, never a room id and never a
  // recipient set. That is deliberate and it is the §2.3 law made structural
  // at this boundary — the predicate runs in the WHERE clause of the
  // retrieval round trip (api/_disclosure.js), before ranking, and by the
  // time anything reaches this pure function every disclosure question has
  // already been answered by a join. A compiler that received a recipient set
  // would be a compiler someone could later ask to filter, and a filter here
  // is a post-hoc filter — the failure class §2.3 opens by refusing.
  //
  // ABSENT (undefined/null) is the ONLY state the 83 byte-identity fixtures
  // exercise, and it must produce ZERO bytes of change: gate G1 (§5.1),
  // mirroring `phase-c-complete`'s 83/83 property. Every use below is gated
  // behind `if (input.roomBundle)`.
  roomBundle?: RoomBundleInput | null;
  // ── SPEC-AGENT-LAYER.md §3 (Law E2) — the injected persona module. Absent
  // (undefined) is the ONLY state the 83 byte-identity fixtures exercise,
  // and defaults to DEFAULT_AGENT (Meera's module, agents/meera.ts) — a
  // zero-content re-export of persona.ts's own functions/constants, so
  // every existing call site keeps working with zero edits and the
  // compiled bytes cannot move: compile() with no `agent` set calls the
  // exact same function references oldOracle.ts calls directly.
  agent?: AgentModule;
}

export interface CompiledPrompt {
  core: string;
  tail: string;
  // core + tail — what actually goes to the model (fullSystem in brain.ts)
  system: string;
  // ── WS-MANIFEST (docs/SPEC.md §3.3/§7.3 compile.manifest telemetry) ──
  // Byte-count-only breakdown of THIS turn's TAIL assembly, keyed roughly by
  // TAIL_MANIFEST id ("watch" and "culture" are real appended blocks that
  // don't have a manifest row yet — see CORE_MANIFEST's own "not-yet-modeled"
  // bookkeeping precedent above; T10 folds SEARCH_DECISION+FORGET_DECISION,
  // the appended-last set). Computed as `tail.length` deltas around each
  // append, so it can never disagree with what was actually assembled and
  // never requires reproducing any of the block content itself — no prompt
  // text crosses this boundary, only lengths (diag.ts's content-free
  // contract, honored one layer up because the compiler is what knows the
  // shape). Optional so `oldOracle.ts`'s frozen pre-extraction return literal
  // (typed against this same interface, by design never touched again per
  // its own header) keeps type-checking without ever having to compute it.
  sections?: Record<string, number>;
}

// ─────────────────────────────────────────────────────────────────────────
// T16 her.commitments — "you said you would X"
// ─────────────────────────────────────────────────────────────────────────
//
// The defect this closes: HIS promises are held by a predicate
// (`openCommitments` → families 2/2b), HERS by `inner.ts`'s LLM-extracted
// `Owed`, capped at two and expiring in 2.5 days. A promise the system
// deliberately forgets is a promise she breaks on schedule, and he is the one
// who notices. This block makes her open promises VISIBLE instead — the same
// move `renderRaised` (T14) makes for what she has already brought up.
//
// TWO LAWS BIND THE CONTENT, and both are about shape, not length.
//
// `recited-prompt`: authored taste written as polished English sentences was
// read out verbatim twice, eight turns apart. So the rows here are
// TELEGRAPHIC — content words and an age, `photo · 2d`, never "I said I would
// send you a photo." `herCommitments()` does the reduction (it strips the
// promise's own scaffolding for `MARKER_TOKENS`' reason) and this function
// never re-inflates it. The eval lints every rendered row with
// `shapelint.lintLine`, which is the mechanical form of this paragraph.
//
// `prompt-position`: an identical rule fired 0/8 mid-brief and 8/8 appended
// last, and the appended-last set is capped at exactly two rules
// (SEARCH_DECISION, FORGET_DECISION — `shapelint.checkAppendedLastExactlyTwo`
// hard-enforces it and a SAFETY override already lost that fight). So this
// takes the strongest position still available: LAST OF THE TAIL BEFORE T10,
// beside T14 and T9, where the session facts live. Stated rather than
// resolved — the position is chosen from what is left, not from what is best.
//
// It is a note, never a to-do list read aloud: the header says so, because
// the failure mode of a visible ledger is her announcing it.
// Header (~215) + three telegraphic rows. Sized so the CAP is what limits the
// block, never the budget: a silently dropped third row would make the ledger
// lie about how many promises are open, which is the failure this slot exists
// to fix, arriving from the other direction.
export const HER_COMMITMENTS_BUDGET = 400;

/** "2d" / "5h" / "just now" — coarse on purpose. A promise's age is the whole
 *  signal (a thing said an hour ago is still live; a thing said five days ago
 *  needs an apology), and a precise timestamp would invite her to quote it. */
function commitmentAge(at: number, nowMs?: number): string {
  if (!at || typeof nowMs !== "number" || nowMs <= at) return "";
  const mins = Math.floor((nowMs - at) / 60_000);
  if (mins < 60) return "just now";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/**
 * Renders at most `HER_COMMITMENT_CAP` rows, newest first (the caller's
 * order — `herCommitments()` already sorts, ages out and de-duplicates).
 *
 * Over budget it DROPS WHOLE ROWS from the oldest, never slices: "a sliced
 * block is a lie" is this file's own rule for the drop order, and it does not
 * stop applying inside a block.
 */
export function renderHerCommitments(
  rows: readonly HerCommitment[] | null | undefined,
  nowMs?: number,
): string {
  if (!rows?.length) return "";
  const head =
    "YOU SAID YOU WOULD — your own open promises, newest first, with how long ago. " +
    "Never announced and never read out as a list: a person does the thing when it fits, " +
    "or says sorry they forgot. An old one gets the sorry first.";
  const lines = rows.map((r) => {
    const age = commitmentAge(r.at, nowMs);
    return `- ${r.what}${age ? ` (${age})` : ""}`;
  });
  let kept = lines;
  while (kept.length && head.length + 1 + kept.join("\n").length > HER_COMMITMENTS_BUDGET) kept = kept.slice(0, -1);
  if (!kept.length) return "";
  return `${head}\n${kept.join("\n")}`;
}

/**
 * The context compiler's one required property for M2: this function's
 * output must be byte-for-byte identical to what brain.ts assembled inline
 * before extraction, for every input this codebase can produce. See
 * `src/engine/__fixtures__/byte-identity.mjs` for the proof harness.
 */
export function compile(input: CompileInput): CompiledPrompt {
  // WS-INTEGRATE seam 3 (§10-Q10): stageForDims(state) drives the stage
  // paragraph selector when a real relstate snapshot exists; absent
  // relBundle passes `undefined` through unchanged (byte-identical for all
  // 83 original fixtures, none of which set relBundle).
  const dimsStage = input.relBundle
    ? stageForDims(input.relBundle.relState, {
        lastRuptureMoveAt: input.relBundle.lastRuptureMoveAt,
        warmEpisodesSinceRupture: input.relBundle.warmEpisodesSinceRupture,
      })
    : undefined;
  // SPEC-AGENT-LAYER.md §3: the injected agent, defaulting to Meera's
  // module. Every call below that used to reach persona.ts directly now
  // goes through `agent` instead — same functions, same references, when
  // `input.agent` is absent (agents/meera.ts re-exports persona.ts's
  // exports unchanged), so this is byte-identical to the prior static
  // import for every one of the 83 fixtures.
  const agent = input.agent ?? DEFAULT_AGENT;
  const parts = agent.buildSystemPromptParts(input.user, input.messageCount, input.medium, dimsStage);
  let core = parts.core + (input.mode === "call" ? agent.buildSpeechStyle(input.voiceEngine) : "");

  // ── WS-INTEGRATE seam 2: age-tier hard-refusal (SPEC §9.4). Undefined
  // gates == unrestricted == today's behavior == byte-identical for every
  // one of the 83 original fixtures, none of which set `ageGates`.
  const romanceOk = input.ageGates ? input.ageGates.romanceRegisters !== false : true;
  const engagementOk = input.ageGates ? input.ageGates.engagementMechanics !== false : true;
  if (!romanceOk || !engagementOk) {
    // appended to CORE, never TAIL: core is never truncated by api/chat.js's
    // slice guard, same reason CRISIS_LINES/NEVER MANIPULATE live there.
    core += AGE_TIER_SAFETY_OVERRIDE;
  }

  // ── WS-TGBOT: the room note. Appended to CORE for the same reason
  // AGE_TIER_SAFETY_OVERRIDE is — core is never truncated by api/chat.js's
  // slice guard — and NOT to the appended-last set, which §0.1 law 4 closes
  // to multiparty explicitly ("no multiparty rule goes there") and
  // shapelint.ts's checkAppendedLastExactlyTwo hard-enforces. See
  // ROOM_MODE_NOTE's own doc for the positional trade-off, stated rather than
  // resolved. Safety is untouched by this: CRISIS_LINES, never-deny-AI and
  // NEVER MANIPULATE are already in core and are ROOM-BLIND (§2.7) — nothing
  // here softens, suppresses or restates them, and restating them here would
  // itself be a `recited-prompt` surface.
  if (input.roomBundle) core += ROOM_MODE_NOTE;

  let tail = parts.tail;

  // ── WS-MANIFEST §3.3/§7.3 telemetry: per-block byte deltas, tracked
  // alongside assembly rather than reconstructed after the fact, so a
  // future reordering of this function can never make `sections` lie about
  // what actually happened. `_track` never reads block content, only
  // `tail.length` — see the CompiledPrompt.sections doc above.
  const sections: Record<string, number> = {
    // ids TAIL_MANIFEST declares but nothing in this function produces bytes
    // for yet (CompiledPrompt.sections should answer "what fired" for every
    // manifest id, not just the ones with code behind them today) — see
    // those rows' own `sourceStatus` in the MANIFEST section below.
    T9: 0,
    // multiparty v1 slots — declared, gated, and rendering zero bytes until a
    // room exists (see TAIL_MANIFEST's mp.roster/mp.bridge rows and gate G1)
    "mp.roster": 0,
    "mp.bridge": 0,
  };
  let _mark = tail.length;
  const _track = (id: string) => {
    sections[id] = tail.length - _mark;
    _mark = tail.length;
  };

  // ── her carried interior — FIRST in the tail (see brain.ts's original
  // comment: api/chat.js keeps the first N chars of the tail and cuts the
  // end, so if anything is ever lost it must be the recall list, never
  // where she actually is) ──
  tail += input.innerThread;
  _track("T1");

  // watch mode goes in early, not at point of use — same reasoning: it must
  // outlive a long tail's truncation before recall/herLife do
  if (input.watching) tail += agent.WATCH_MODE_NOTE;
  _track("watch");

  // ── T2 rel.snapshot / T3 india.dynamic / T4 dyadic.active — SPEC §3.2
  // TAIL_ORDER positions T2,T3,T4 between T1 (above) and T5 (memories,
  // below). Gated entirely on `input.relBundle`: absent => none of this
  // runs, none of these strings exist, tail is byte-identical to before
  // this seam landed. `gate` (moment.ts's momentGate) is computed once and
  // reused by T4 here and T6 below — moment.ts's own contract: "one gate,
  // read once per turn, so the two TAIL slots can never disagree."
  //
  // ── WS-CONTINUITY: A BLANK TURN IS NOT A TURN ─────────────────────────
  // moment.ts's own law is that the gate "reads ONLY the current user turn",
  // and some turns do not exist: a call PICKUP has no user turn yet (it is
  // them ringing her), and a chat directive is her opening the conversation.
  //
  // That state was unreachable until now — the chat lane nulls the whole
  // bundle on a directive, so compile() never reached momentGate with an
  // empty string — and routing the call lane through this compiler makes it
  // reachable for the first time. It must be handled here, because measured,
  // `momentGate("")` returns **"celebration"**: one celebration key is an
  // emoji, padT() strips it to "" and pads it to "  ", and the padded empty
  // haystack is also "  ", so an ABSENT turn matches. She would have walked
  // into every pickup primed with how she is when they are celebrating.
  //
  // The defect is in moment.ts, which belongs to WS-RELSTATE (§13) and is not
  // edited here — it is filed in the WS-CONTINUITY report. This guard is not
  // merely a workaround for it either: "no turn, no moment" is the correct
  // rule at this boundary regardless of how padT behaves, and stating it here
  // is what makes the pull-only law hold for a lane that has no turn to pull
  // from. Byte-identical for all 83 fixtures (none sets relBundle) and for
  // every existing call site (all pass a real turn when they pass a bundle).
  const hasTurn = (input.latestUserText || "").trim().length > 0;
  // The gate exists whenever there is a TURN, not whenever there is a rel
  // bundle: coupling it to the bundle silently blacked out T12 self.arc for
  // every user with no vy_rel_state row yet (measured: 0 bytes without the
  // row, 152 with, same arc, same turn — task #95). A missing bundle only
  // means an empty phrase ledger, which momentGate handles natively.
  const gate = hasTurn
    ? momentGate(input.latestUserText || "", input.gapSinceLastMs || 0, input.relBundle?.phraseLedger || [])
    : { moment: "none" as const, pulled: false };
  if (input.relBundle) {
    // T2/T4 are the only independently-droppable INTIMACY-REGISTER blocks
    // this compiler controls (honorific/trust/repair state, dyadic
    // closeness patterns) — unconditionally omitted under the age-tier gate,
    // never merely instructed away. T3 (india/rituals/currency) is not
    // intimacy-register content and is unaffected.
    // §5.2: T2 and mp.roster are MUTUALLY EXCLUSIVE BY CHANNEL, which is what
    // keeps the budget arithmetic cheap (group worst case 17,400 − 1,200 + 900
    // + 1,100 = 18,200 against a 24,000 tail cap). In a group channel there is
    // no single dyad to snapshot — the per-member state is in mp.roster — so
    // T2 renders empty rather than snapshotting whichever dyad happened to be
    // loaded, which would be one member's register applied to all six.
    if (romanceOk && !input.roomBundle) {
      const t2 = renderRelSnapshot(input.relBundle.relState, {
        lastHonorificMoveAt: input.relBundle.lastHonorificMoveAt,
        lastRuptureMoveAt: input.relBundle.lastRuptureMoveAt,
        warmEpisodesSinceRupture: input.relBundle.warmEpisodesSinceRupture,
      });
      if (t2.text) tail += `\n\n${t2.text}`;
    }
    _track("T2");
    const t3 = renderIndiaDynamic(
      input.relBundle.rituals,
      input.relBundle.homeRegion,
      input.relBundle.currency,
      undefined,
      input.relBundle.kin ?? [],
    );
    if (t3.text) tail += `\n\n${t3.text}`;
    _track("T3");
    if (romanceOk) {
      const t4 = renderDyadicActive(input.relBundle.patterns, gate!.moment);
      if (t4.text) tail += `\n\n${t4.text}`;
    }
    _track("T4");
  } else {
    // relBundle absent: T2/T3/T4 never ran, but the record should say so as
    // an explicit 0, not an absent key — "did this block fire" is exactly
    // what manifest_hash's usage half needs to be able to answer.
    sections.T2 = 0;
    sections.T3 = 0;
    sections.T4 = 0;
  }

  // ── T11 rel.texture — how she talks to THIS person specifically.
  //
  // Gated on selfBundle ALONE, deliberately OUTSIDE the relBundle branch
  // above. Texture and rel-state travel together in today's recall bundle, so
  // nesting this inside `if (input.relBundle)` would have worked and would
  // have been an accidental coupling: a caller holding texture and no
  // rel-state would have rendered nothing, silently, with no error to find.
  // T2 is where the relationship IS (honorific, trust, repair); T11 is how it
  // SOUNDS. Related, separately sourced, separately gated.
  //
  // Coarse bands only, and renderTexture returns "" below its own n_turns
  // floor — a thin relationship renders nothing rather than a personality
  // assigned at random from six turns.
  if (input.selfBundle?.texture) {
    const t11 = renderTexture(input.selfBundle.texture);
    if (t11.text) tail += `\n\n${t11.text}`;
  }
  _track("T11");

  // ── T17 rel.reciprocity — WS-K, ROADMAP-100X item 1.
  //
  // Sits immediately after T11 because the two answer adjacent questions about
  // the same relationship and are read together: T11 is how it SOUNDS
  // (teasing, humour, swearing), T17 is whether SHE IS IN IT. Gated on
  // `input.reciprocity` alone, deliberately outside the relBundle branch and
  // for the reason T11's own comment gives: a caller holding a transcript and
  // no rel-state row still has everything this needs, and nesting it would
  // have blacked the block out for exactly the early relationships where
  // disclosure asymmetry is most consequential.
  //
  // `reciprocityNote` returns "" for every balance inside its threshold, which
  // is the common case — so this block renders zero bytes on most turns even
  // when a state IS supplied.
  {
    const t17 = reciprocityNote(input.reciprocity);
    if (t17) tail += `\n\n${t17}`;
  }
  _track("T17");

  if (input.memories) {
    tail += `\n\nWHAT YOU REMEMBER ABOUT THEM — from your earlier conversations, each tagged with when it last came up. These are real: when they touch on one, you KNOW it and you say the specific detail rather than making them repeat themselves. Two things keep it honest:
- Something being listed here is not a reason to say it. It comes out only where it actually fits, one at a time, woven into normal talk — never several at once, never as a list, never with any mention of remembering.
- A memory is not a live update. Anything with a date, a plan or a situation in it may already have happened or changed, so an old one gets talked about as old ("us december wali shaadi ho gayi na?") instead of announced as if it's still ahead — and then you let them tell you where it stands.
${input.memories}`;
  }
  _track("T5");

  // ── T6 we.callbacks — SPEC §3.2 TAIL_ORDER: between T5 (above) and T7
  // (herLife, below). `pulled` comes from the SAME gate computed above
  // (moment.ts's hasDeixis) — never re-derived, per that file's one-gate
  // contract, and it changes ONLY the label per relstate.ts's own doc, never
  // which rows are selected: the literal mechanism of "0 unprompted raises".
  if (input.relBundle && gate) {
    const t6 = renderWeCallbacks(input.relBundle.weEpisodes, input.relBundle.phrases, gate.pulled);
    if (t6.text) tail += `\n\n${t6.text}`;
  }
  _track("T6");

  // ── mp.roster / mp.bridge — PROPOSAL-MULTIPARTY-V1 §5.2's insertion point,
  // immediately after T6 `we.callbacks` and before T7. The slots exist here so
  // the group layer lands as CONTENT in a declared slot rather than as a
  // later reshuffle of this function; nothing writes them yet, so both track
  // zero bytes and the assembled prompt is byte-identical to today's.
  //
  // Gate G1 (§5.1), non-negotiable and mirroring `phase-c-complete`'s 83/83
  // property: for a person with no room membership the compiled output is
  // byte-identical to today's. The multiparty layer must be provably free
  // until a room exists — which is exactly what the `if (input.roomBundle)`
  // gate below buys, since a byte would have to come from somewhere between
  // the two tracks.
  //
  // WS-TGBOT: both slots are now WIRED. src/engine/room.ts holds the two
  // renderers; api/_room.js resolves what they render FROM, through
  // api/_disclosure.js's predicate in the WHERE clause. This block renders,
  // it never decides.
  if (input.roomBundle) {
    const roster = renderMpRoster(input.roomBundle.members, MP_ROSTER_BUDGET);
    if (roster.text) tail += `\n\n${roster.text}`;
  }
  _track("mp.roster");
  if (input.roomBundle) {
    const bridge = renderMpBridge(input.roomBundle.bridge, MP_BRIDGE_BUDGET);
    if (bridge.text) tail += `\n\n${bridge.text}`;
  }
  _track("mp.bridge");

  if (input.herLife) {
    tail += `\n\nWHAT YOU'VE ALREADY TOLD THEM ABOUT YOUR OWN LIFE — you said these, so they are now fixed between you two, not open to reinvention. Same job, same people, same flat, same plans, same things you did. Add new texture freely; never say anything that contradicts a line here, and never re-tell one as if it's news:\n${input.herLife}`;
  }
  _track("T7");
  // ── T12 self.arc / T13 life.untold — both sit with T7 because all three
  // are HER, not the relationship: what she has already told them (T7), how
  // she has changed (T12), and what she has not told them yet (T13).
  if (input.selfBundle?.arc?.length) {
    const t12 = renderSelfArc(input.selfBundle.arc, gate?.moment || "");
    if (t12.text) tail += `\n\n${t12.text}`;
  }
  _track("T12");
  if (input.selfBundle?.untold?.length) {
    // G2 is enforced INSIDE renderUntold via its required turn gate — it
    // returns empty on any turn she initiated. Passed explicitly here so the
    // suppression is visible at the call site too, not only in the module.
    const t13 = renderUntold(input.selfBundle.untold, {
      sheInitiated: input.selfBundle.sheInitiated === true,
    });
    if (t13.text) tail += `\n\n${t13.text}`;
  }
  _track("T13");
  // her forward-facing life goes right after her past-facing one (see
  // brain.ts's original note on herLife recency-eviction vs a want staying
  // the same object across weeks)
  tail += input.innerWants;
  // T8 taste.rows is FUSED into innerWants (inner.ts's wants/owed/taste
  // concatenation, not this compiler's — see the CORE_MANIFEST T8
  // sourceStatus note), so this delta over-counts by whatever inner.ts put
  // in wants/owed too. Labeled honestly (as "T8") rather than claiming a
  // precision this function doesn't have without an inner.ts interface split.
  _track("T8");

  // T9 session.clock — where this turn sits in time relative to the last one.
  // Declared in the manifest since it was written and never built, which is why
  // she never noticed he had been gone overnight: `gapSinceLastMs` reached only
  // momentGate's "silence" shape, and that branch requires a near-EMPTY message,
  // so a long gap followed by a real message was invisible by construction.
  // Structured facts only, never a script — see away.ts on `recited-prompt`.
  {
    const t9 = renderAway(input.nowMs, input.gapSinceLastMs || 0);
    if (t9) tail += `\n\n${t9}`;
  }
  _track("T9");

  // T15 session.activity — what they are doing together. Sits with T9 because
  // both are facts about the PRESENT MOMENT rather than about him or her.
  {
    const t15 = renderActivity(input.activity, input.nowMs);
    if (t15) tail += `\n\n${t15}`;
  }
  _track("T15");

  // T14 rel.raised — what she has already brought up and how he answered.
  // The owner's points 2 and 9. Deliberately both numbers, never a threshold:
  // he asked for the behaviour to be TONED DOWN and modulated on how he reacts,
  // not for a topic ban.
  {
    const t14 = renderRaised(raisedRecently(input.recentTurns || []));
    if (t14) tail += `\n\n${t14}`;
  }
  _track("T14");

  // T16 her.commitments — what SHE said she would do and has not yet done.
  // Sits last of the tail before T10 for `prompt-position`'s reason (the
  // appended-last set is closed at two), and beside T14 because both are
  // facts about what has already been SAID rather than about him or her.
  // Absent input renders zero bytes — the 83 byte-identity fixtures set no
  // `herCommitments`, so this seam is provably free until a caller wires it.
  {
    const t16 = renderHerCommitments(input.herCommitments, input.nowMs);
    if (t16) tail += `\n\n${t16}`;
  }
  _track("T16");

  if (input.mode === "chat" && !input.isDirective) tail += input.cultureNoteText;
  _track("culture"); // no manifest row yet — see CompiledPrompt.sections doc
  // dead last, chat only — see SEARCH_DECISION in persona.ts for why
  // position is the entire mechanism here
  if (input.mode === "chat") tail += agent.SEARCH_DECISION;
  // both lanes — see FORGET_DECISION in persona.ts
  tail += agent.FORGET_DECISION;
  _track("T10");

  return { core, tail, system: core + tail, sections };
}

// ─────────────────────────────────────────────────────────────────────────
// 2. MANIFEST — SPEC §3.1–3.2 target layout, as data. Not wired into
//    `compile()` yet (see file header). `sourceStatus` says, per block,
//    exactly how today's real code relates to the spec's row — this is the
//    honest bookkeeping the M2 report is built from.
// ─────────────────────────────────────────────────────────────────────────

// 7 exists because mp.bridge takes priority 1 and everything below it
// renumbers by one (PROPOSAL-MULTIPARTY-V1 §5.2).
// 11 exists for T14 rel.raised. The set only has to be a PERMUTATION with no
// duplicates (validated below) — never contiguous — so a new block takes a
// fresh number rather than renumbering nine rows and desynchronising
// check-prompt-budget's drop-order fixture for the second time.
// 0 exists for T17 `rel.reciprocity` (WS-K). A new block normally takes a
// FRESH HIGH number rather than renumbering (see the paragraph above), but a
// fresh high number means MOST PROTECTED, and T17 is the cheapest thing in the
// tail: it is a two-state descriptive band, it renders on a minority of turns,
// and losing it under pressure costs nothing anyone can see. Renumbering the
// self layer to open up 1 would desynchronise nine rows for a cosmetic block,
// so the drop order is extended DOWNWARD instead. The validator's only
// requirement is that the set has no duplicates, which 0 satisfies.
export type DropPriority = "never" | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;

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
// Raised 64_000 -> 72_000 on 2026-08-25: a 2,304-row corpus scan through
// the real engine measured heavy-dyad cores at max 62,026 B — 3.1% under the
// old guard, inside the silent-truncation cliff that once cost the crisis
// helplines. The guard is a payload bound, not a budget (the whole core is
// prompt-cached, so headroom costs nothing until text exists), and the END of
// the core is where the newest safety text sits — the first thing truncation
// eats. Mirrored in api/chat.js SYSTEM_MAX; check-prompt-budget.mjs asserts
// the two never drift.
export const OPERATIONAL_CORE_CAP = 72_000;
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
//
// ── the multiparty correction (PROPOSAL-MULTIPARTY-V1 §0.2, accepted as
//    context/decisions.md `multiparty-v1-design`) ─────────────────────────
//
// This manifest used to carry a row `T8-multiparty` (group.disclosure, budget
// 0, "empty-reserved"), on the premise that SPEC reserved a T8 multiparty slot
// at ≤2,000 chars. IT DID NOT. SPEC §3.2's T8 is `taste.rows` — budget 800,
// drop priority `never`, a member of the CI-asserted undroppable set
// (docs/SPEC.md:590). The premise was a propagated brief error, flagged twice
// in the research sweep before the design proposal killed it.
//
// The 2,000-char allowance is real and is still spent — as TWO blocks at a NEW
// insertion point after T6, rather than by colliding with taste.rows:
//   mp.roster   900, undroppable, group channels only
//   mp.bridge 1,100, drop priority 1 (first dropped)
// Everything below mp.bridge renumbers by one. T10 stays PINNED LAST and
// stays capped at exactly two rules — the appended-last set is not widened by
// multiparty, because position is a scarce resource (`prompt-position`).
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
    dropPriority: 10, // was 7 — renumbered by three for the self layer (T11-T13)
    // WS-INTEGRATE seam 1: wired via renderRelSnapshot, gated on
    // input.relBundle (api/memory.js opRecall delta). Empty when absent —
    // "empty-reserved" retired now that a real caller exists, per the M2
    // report's own instruction to keep this bookkeeping honest.
    sourceStatus: "wired",
  },
  {
    id: "T3",
    label: "india.dynamic",
    budget: 1_000,
    dropPriority: 8, // was 5 — +3 for the self layer
    sourceStatus: "wired", // WS-INTEGRATE: renderIndiaDynamic, gated on input.relBundle
  },
  {
    id: "T4",
    label: "dyadic.active",
    budget: 1_600,
    dropPriority: 9, // was 6 — +3 for the self layer
    sourceStatus: "wired", // WS-INTEGRATE: renderDyadicActive, moment-gated, on input.relBundle
  },
  {
    id: "T5",
    label: "recall.facts",
    budget: 6_000,
    dropPriority: 6, // was 3 — +3 for the self layer
    sourceStatus: "wired", // input.memories — today's api/memory.js graph recall block
  },
  {
    id: "T6",
    label: "we.callbacks",
    budget: 2_000,
    dropPriority: 7, // was 4 — +3 for the self layer
    sourceStatus: "wired", // WS-INTEGRATE: renderWeCallbacks, deixis-gated, on input.relBundle
  },
  {
    id: "T7",
    label: "herlife",
    budget: 1_000,
    dropPriority: 5, // was 2 — +3 for the self layer
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
    // `manifest-sourcestatus` records that this field is checked by nothing and
    // reports "wired" for slots rendering zero bytes — an anti-signal. The type
    // is a closed union, and widening it would change the input to the NC4
    // control that DEMONSTRATES the field is worthless, so the value stays
    // legal and the falsifier goes here where a reader will actually meet it:
    //   node evals/run.mjs away   (incl. the no-script negative control)
    sourceStatus: "wired",
  },
  // ── self layer (Phase E2, docs/SPEC-SELF-LAYER.md §8) ──────────────────
  // These three take drop priorities 1-3: they are the FIRST things shed
  // under pressure, ahead of everything Phase C proved it needs. That is the
  // whole point of adding them at the bottom rather than the top — a
  // relationship without texture is thinner, a relationship without
  // recall.facts is amnesiac.
  {
    id: "T11",
    label: "rel.texture",
    budget: 600,
    dropPriority: 1, // first dropped
    sourceStatus: "wired", // renderTexture, gated on input.selfBundle.texture
  },
  {
    id: "T12",
    label: "self.arc",
    budget: 500,
    dropPriority: 2,
    sourceStatus: "wired", // renderSelfArc, moment-gated, on input.selfBundle.arc
  },
  {
    id: "T13",
    label: "life.untold",
    budget: 700,
    dropPriority: 3,
    sourceStatus: "wired", // renderUntold, G2 turn-gated, on input.selfBundle.untold
  },
  // ── WS-K, ROADMAP-100X item 1 ─────────────────────────────────────────
  {
    id: "T17",
    label: "rel.reciprocity",
    // header (~230) + one telegraphic row. The row set is CLOSED at two
    // possible strings (`reciprocityNote` has exactly two branches), so this
    // block cannot grow with the transcript the way a ledger can.
    budget: 260,
    // 0 = FIRST DROPPED, ahead of even the self layer. See DropPriority's own
    // note for why the number goes down rather than up: this is the cheapest
    // block in the tail, and it is the one thing here whose absence changes
    // nothing a reader could point at.
    dropPriority: 0,
    sourceStatus: "wired", // reciprocityNote(input.reciprocity) — gate: node evals/run.mjs reciprocity
  },
  {
    id: "T15",
    label: "session.activity",
    budget: 420,
    // "never", like T9 beside it, and for the same reason rather than by
    // analogy: if she is mid-game and the tail overflows, dropping the fact
    // that a game is happening does not thin her out — it makes her talk as
    // though nothing is going on, which is worse than any block this could
    // have been shed in favour of. It is also small enough that the
    // undroppable arithmetic barely moves.
    dropPriority: "never",
    sourceStatus: "wired", // renderActivity(activity.ts) — gate: node evals/run.mjs activity
  },
  {
    id: "T14",
    label: "rel.raised",
    budget: 400,
    // 11 = SECOND-LAST of the droppables (T16 `her.commitments` took 12 when
    // the commitment ledger landed; before that this row was the last), i.e.
    // more protected than everything except that row and the "never" set.
    // That looks aggressive for a nicety and is deliberate:
    // it is 400 bytes, and it is the correction for the defect the owner has
    // now reported twice (points 2 and 9). Dropping it under pressure
    // reintroduces the single most-reported behaviour, for a saving smaller
    // than one recall fact. The number only has to be UNIQUE (the validator
    // checks the set is a permutation, not that it is contiguous), so this
    // takes a fresh one rather than renumbering nine rows and desynchronising
    // check-prompt-budget's drop-order fixture again.
    dropPriority: 11,
    sourceStatus: "wired", // renderRaised(raisedRecently(input.recentTurns)) — gate: node evals/run.mjs repeat
  },
  {
    id: "T16",
    label: "her.commitments",
    // three telegraphic rows plus a header. The cap in honesty.ts
    // (HER_COMMITMENT_CAP = 3, HER_COMMITMENT_TERMS = 3) is what keeps this
    // number honest: the block cannot grow with the transcript.
    budget: 400,
    // 12 = last of the droppables, taking the position T14's note describes.
    // Same reasoning as T14's and for a defect of the same species: T14 stops
    // her re-raising what he already answered, T16 stops her forgetting what
    // she said she would do. Both are cheap, both fix something the owner can
    // see, and shedding either under pressure reintroduces it — for a saving
    // smaller than one recall fact. The number only has to be UNIQUE (the
    // validator checks the set is a permutation, never that it is
    // contiguous), so this takes a fresh one rather than renumbering.
    dropPriority: 12,
    sourceStatus: "wired", // renderHerCommitments(input.herCommitments) — gate: node evals/honesty/run.mjs §10
  },
  // ── multiparty v1 (PROPOSAL-MULTIPARTY-V1 §5.2) ────────────────────────
  // Declared at their real budgets and real drop priorities, rendering ZERO
  // bytes: no live writer exists yet (WS-MP owns src/engine/room.ts). Same
  // discipline as the rest of this engine — the slot exists, it is gated, and
  // it is byte-stable — so the group layer lands later as CONTENT, never as a
  // reshuffle of compile()'s assembly order.
  {
    id: "mp.roster",
    label: "group.roster",
    budget: 900,
    // undroppable, and not for symmetry: dropping the address strip means
    // addressing an elder wrongly in front of the family. Hindi kin address
    // encodes rank grammatically (R5/R6), and the Indian family-group norm is
    // that no one corrects someone higher in the hierarchy — so a dropped
    // roster is not a degraded answer, it is a public insult.
    dropPriority: "never",
    // GROUP CHANNELS ONLY. In a group channel T2 `rel.snapshot` renders empty
    // (there is no single dyad to snapshot — the per-member state is here);
    // in a 1:1 channel this renders empty and T2 is exactly as today. The two
    // are mutually exclusive by channel, which is what keeps the arithmetic
    // cheap. ≤6 active members, telegraphic k:v, ~150 chars/member — and the
    // ≤6 cap falls straight out of this budget.
    sourceStatus: "wired", // WS-TGBOT: room.ts renderMpRoster, gated on input.roomBundle
  },
  {
    id: "mp.bridge",
    label: "group.bridge",
    budget: 1_100,
    dropPriority: 4, // was 1 — the self layer now takes 1-3 as first-dropped
    // ≤2 disclosure-filtered cross-person rows AS SHAPES, NEVER LINES; ≤2 room
    // phrase-ledger hits; ≤1 open room plan row. Every row has already passed
    // the §2.3 predicate in the WHERE clause (api/_disclosure.js) — THIS BLOCK
    // RENDERS, IT NEVER DECIDES. Bridged content is doubly dangerous: a
    // phrase-bank risk (`recited-prompt`) and another person's words in her
    // mouth. What must never enter it — a quoted line, a sensitive row, a
    // negatively-valenced row, a row from another room, a row whose grant is
    // absent or invalidated, a row whose sole non-Meera speaker has left — is
    // each a WHERE clause in that module, never a bullet in a prompt.
    sourceStatus: "wired", // WS-TGBOT: room.ts renderMpBridge, gated on input.roomBundle
  },
  {
    id: "T10",
    label: "decision.rules",
    budget: 2_000,
    dropPriority: "never",
    sourceStatus: "wired", // SEARCH_DECISION (chat only) + FORGET_DECISION, appended last by compile()
  },
] as const;

// The owner's 2,000-char multiparty allowance, now REALLY spent rather than
// reserved: mp.roster 900 + mp.bridge 1,100. Kept as an exported constant
// because it is the number the direction was written as, and because the
// identity below is the cheapest possible guard against the two block budgets
// quietly drifting away from the allowance they were carved out of.
// (Formerly `T8_MULTIPARTY_RESERVED_CEILING`, against a T8 slot that turned
// out not to exist — see the TAIL_MANIFEST header.)
export const MP_ALLOWANCE = 2_000;

/** @deprecated the T8 multiparty slot was a propagated brief error (§0.2);
 *  the allowance lives in mp.roster + mp.bridge. Alias kept so the constant's
 *  history is visible rather than deleted. */
export const T8_MULTIPARTY_RESERVED_CEILING = MP_ALLOWANCE;

// Fixed compile-time order — T10 is PINNED LAST (shapelint enforces this;
// the appended-last set is capped at exactly two rules: SEARCH_DECISION and
// FORGET_DECISION, both folded into T10). mp.roster/mp.bridge sit at §5.2's
// insertion point, immediately after T6 and before T7, matching compile()'s
// actual assembly order — a manifest that ordered them anywhere else would be
// documenting a layout this file does not produce.
export const TAIL_ORDER: readonly string[] = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T11",
  // T17 sits with T11: how it sounds, then whether she is in it. Matches
  // compile()'s actual assembly order — a manifest that ordered it anywhere
  // else would be documenting a layout this file does not produce.
  "T17",
  "T5",
  "T6",
  "mp.roster",
  "mp.bridge",
  "T7",
  "T12",
  "T13",
  "T8",
  "T9",
  "T15",
  // T14 sits with T9 because both are SESSION facts — where this turn sits in
  // time, and what has already been said in it — not facts about him or her.
  "T14",
  // T16 last before T10: the appended-last set is closed at two, so this is
  // the strongest position `prompt-position` leaves available.
  "T16",
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
  // multiparty allowance, as a number rather than a comment: the two blocks
  // that replaced the non-existent T8 slot must still sum to the 2,000 chars
  // the owner's direction allowed, or one of them has drifted (§5.2).
  const mp = TAIL_MANIFEST.filter((b) => b.id === "mp.roster" || b.id === "mp.bridge");
  const mpTotal = mp.reduce((sum, b) => sum + b.budget, 0);
  if (mp.length !== 2 || mpTotal !== MP_ALLOWANCE) {
    throw new Error(
      `multiparty allowance broken: found ${mp.length} mp.* block(s) totalling ${mpTotal}, ` +
        `expected mp.roster + mp.bridge = MP_ALLOWANCE(${MP_ALLOWANCE})`,
    );
  }
  // drop priorities must stay a permutation with no duplicates — the renumber
  // below mp.bridge is the kind of edit where two blocks silently end up
  // sharing a priority and the declared drop order stops being an order.
  const prios = TAIL_MANIFEST.filter((b) => b.dropPriority !== "never").map((b) => b.dropPriority);
  if (new Set(prios).size !== prios.length) {
    throw new Error(`duplicate TAIL drop priorities: [${prios.join(", ")}] — drop order is ambiguous`);
  }
  // the manifest must describe the layout compile() actually assembles
  const ids = new Set(TAIL_MANIFEST.map((b) => b.id));
  const missing = TAIL_ORDER.filter((id) => !ids.has(id));
  if (missing.length || TAIL_ORDER.length !== TAIL_MANIFEST.length) {
    throw new Error(
      `TAIL_ORDER and TAIL_MANIFEST disagree: ${missing.length ? `unknown ids [${missing.join(", ")}]` : `${TAIL_ORDER.length} ordered vs ${TAIL_MANIFEST.length} declared`}`,
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

// ─────────────────────────────────────────────────────────────────────────
// 6. compile.manifest TELEMETRY — SPEC §3.3 ("per-turn core-hash logging ...
//    to meera_diag") / §7.3 ("Every turn logs {model, adapter_version,
//    core_hash, manifest_hash, snapshot_ver}"). This function is the only
//    new piece compiler.ts contributes toward that record: a structural
//    fingerprint, never prompt text, so it stays inside diag.ts's
//    content-free contract even though the actual diag() call is the call
//    site's job (brain.ts stays the I/O layer; compile() and this function
//    both stay pure — see the file header's two-jobs split).
// ─────────────────────────────────────────────────────────────────────────

/**
 * "hash of the section-manifest layout + budgets actually used" (§7.3).
 * Two halves, both structural, folded into one fingerprint:
 *   - LAYOUT: CORE_MANIFEST/TAIL_MANIFEST ids+budgets(+dropPriority) and the
 *     three cap constants — the deploy-time shape, changes only when this
 *     file's manifest declarations change (a real deploy, same cadence as
 *     core_hash's "changes rarely").
 *   - USAGE: which of THIS turn's tracked sections (`CompiledPrompt.sections`
 *     — see compile()) rendered nonzero bytes, order-independent (sorted by
 *     id) so two turns with the same set of live blocks hash equal even if
 *     object key insertion order differed. This is the "actually used" half:
 *     it moves when relBundle/watching/etc. flip a block from empty to
 *     present, independently of whether persona content (core_hash) changed
 *     at all.
 * Byte lengths themselves are deliberately NOT hashed in — that would make
 * manifest_hash re-derive core_hash's job with extra steps; presence
 * (0-or-nonzero) is the coarser, cheaper signal this fingerprint is for.
 */
export function hashManifest(sections: Record<string, number>): string {
  const layout = [
    ...CORE_MANIFEST.map((b) => `${b.id}:${b.budget}`),
    ...TAIL_MANIFEST.map((b) => `${b.id}:${b.budget}:${b.dropPriority}`),
    `CAP:${CORE_CAP}:${TAIL_CAP}:${SYSTEM_MAX}`,
  ];
  const usage = Object.keys(sections)
    .sort()
    .map((id) => `${id}=${sections[id] > 0 ? 1 : 0}`);
  return hashCore([...layout, ...usage].join("|"));
}

// Re-exported for call sites that import CRISIS_LINES from this file
// (src/engine/__fixtures__/.budget-entry.ts) — DEFAULT_AGENT's value, which
// is persona.ts's own CRISIS_LINES unchanged (agents/meera.ts re-exports it
// verbatim), so this is byte-identical to the prior direct re-export.
export const CRISIS_LINES = DEFAULT_AGENT.CRISIS_LINES;
