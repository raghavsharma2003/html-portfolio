// mirrorCallMachine.ts — the Mirror Call's state, with no React and no DOM in
// it, so the properties the spec cares about can be tested offline by
// `evals/mirrorcall.mjs` instead of by looking at a screen.
//
// The two properties that justify the file existing separately:
//
//  1. AN UNACCEPTED CHIP IS NEVER APPLIED. `MIRROR-CALL-SPEC.md` §laws: "the
//     owner being present and authenticated IS the approval channel, but
//     presence alone is not approval — the tap is." So `chipIsApplied` reads
//     ONE thing — a server acknowledgement that came back `applied: true` on
//     an accept — and no reducer path can set that flag from a tap, a
//     hover, an end-of-call sweep, or an optimistic update. The eval fuzzes
//     event sequences and asserts it.
//  2. THE CLONE NEVER SPEAKS FIRST. `clone-initiative-record-has-no-absence`:
//     a clone may speak first only on a citable reason, and silence is not
//     one. Here that means every clone caption is the result of an owner
//     window, and `WINDOW_RESULT` is the only event that can add one.
//
// Everything else here is the honest-states machinery: warming, dropped
// windows, backend absence, and the end-of-call sweep that turns un-actioned
// chips into "review later" rather than into anything on the sheet.
import type {
  MirrorCallDelta,
  MirrorCallDropReason,
  MirrorCallEnd,
  MirrorCallFidelity,
  MirrorCallSession,
  MirrorCallWindowResult,
} from "./mirrorCallApi";

export type CallPhase =
  | "idle"
  | "checking"
  | "backend_absent"
  | "connecting"
  | "warming"
  | "live"
  | "ending"
  | "ended"
  | "failed";

/** What the microphone/turn loop is doing while the call is live. Cascade
 *  (ASR → engine → TTS), never full-duplex — the research pinned that
 *  (`ROADMAP-100X.md` §Voice), so these are sequential by construction. */
export type TurnPhase = "idle" | "capturing" | "uploading" | "thinking" | "speaking";

export type ChipStatus =
  | "proposed"
  | "accepting"
  | "rejecting"
  | "accepted"
  | "rejected"
  | "deferred";

export interface ChipState {
  delta: MirrorCallDelta;
  status: ChipStatus;
  /** Set only by a server acknowledgement. Never by a tap. */
  serverApplied: boolean;
  /** A failed accept/reject leaves the chip actionable again and says why. */
  error: string | null;
  /** True when the per-minute chip budget, not the owner, kept this off the
   *  rail. It goes straight to review later and the review tab says why. */
  overflow: boolean;
}

/**
 * How many chips the rail may show per minute — adoption delta A5.
 *
 * `mirror-learning.md` §3: feature queries are the preferred kind of question
 * (Cakmak & Thomaz, HRI 2012), and the same line of work found people do not
 * enjoy a constant stream of them. So the rail is capped and the surplus falls
 * to the post-call review queue, which the spec already has as the landing
 * place for un-actioned chips. The number itself is a starting point, not a
 * measurement — nobody has run an acceptance-rate study on this UI, and the
 * research entry says so.
 */
export const CHIPS_PER_MINUTE = 3;
export const CHIP_BUDGET_WINDOW_MS = 60_000;

export type CaptionKind = "owner" | "clone" | "dropped" | "system";

export interface CaptionLine {
  id: string;
  kind: CaptionKind;
  text: string;
  /** Present on clone lines; the anchor for 👍/👎 and the re-record. */
  turnId?: string;
  /** Present on dropped lines so the copy can name what happened. */
  dropReason?: MirrorCallDropReason;
  at: number;
}

export interface CallState {
  phase: CallPhase;
  turnPhase: TurnPhase;
  session: MirrorCallSession | null;
  /** Why we are stuck, in the owner's language. Never a raw stack. */
  error: string | null;
  /** Set when the route itself is missing, which reads differently from an error. */
  absentDetail: string | null;
  captions: CaptionLine[];
  chips: ChipState[];
  fidelity: MirrorCallFidelity | null;
  reference: { consented_windows: number; total_seconds: number } | null;
  ownerWindows: number;
  droppedWindows: number;
  cloneTurns: number;
  /** Turns the owner rated, so the UI can stop re-asking. */
  ratedTurns: Record<string, "up" | "down">;
  /** Filled by END; the "here is what you did not action" summary. */
  ended: MirrorCallEnd | null;
  /** The rolling per-minute chip budget. Data, so it can be asserted. */
  chipBudget: { minuteStart: number; admitted: number; overflowed: number };
  /** Whether the deployment serves `turn_voice`. False ⇒ captions only, said out loud. */
  voiceAvailable: boolean;
}

export type CallEvent =
  | { type: "PROBE_START" }
  | { type: "PROBE_OK"; voiceAvailable: boolean }
  | { type: "PROBE_ABSENT"; detail: string }
  | { type: "CONNECT" }
  | { type: "SESSION_OPEN"; session: MirrorCallSession }
  | { type: "WARM" }
  | { type: "FAIL"; message: string }
  | { type: "CAPTURE_START" }
  | { type: "CAPTURE_CANCEL" }
  | { type: "WINDOW_SENDING" }
  | { type: "WINDOW_RESULT"; result: MirrorCallWindowResult; at?: number }
  | { type: "SPEAK_START"; turnId: string }
  | { type: "SPEAK_END" }
  | { type: "VOICE_UNAVAILABLE"; detail: string }
  | { type: "CHIP_ACTION"; deltaId: string; action: "accept" | "reject" }
  | { type: "CHIP_RESULT"; delta: MirrorCallDelta }
  | { type: "CHIP_FAILED"; deltaId: string; message: string }
  | { type: "DELTAS_SYNCED"; deltas: MirrorCallDelta[]; at?: number }
  | { type: "RATE_TURN"; turnId: string; rating: "up" | "down"; deltas?: MirrorCallDelta[]; at?: number }
  | { type: "END" }
  | { type: "ENDED"; end: MirrorCallEnd }
  | { type: "RESET" };

export const INITIAL_CALL_STATE: CallState = {
  phase: "idle",
  turnPhase: "idle",
  session: null,
  error: null,
  absentDetail: null,
  captions: [],
  chips: [],
  fidelity: null,
  reference: null,
  ownerWindows: 0,
  droppedWindows: 0,
  cloneTurns: 0,
  ratedTurns: {},
  ended: null,
  chipBudget: { minuteStart: 0, admitted: 0, overflowed: 0 },
  voiceAvailable: false,
};

/** Phases in which the microphone may legally open. */
export const LIVE_PHASES: readonly CallPhase[] = ["live"];

export function canCapture(state: CallState) {
  return LIVE_PHASES.includes(state.phase) && state.turnPhase === "idle";
}

export function canEnd(state: CallState) {
  return state.phase === "connecting" || state.phase === "warming" || state.phase === "live";
}

/**
 * THE property, as a function. A chip counts as applied to the sheet when, and
 * only when, the server said so on an accept. `status === "accepted"` alone is
 * not enough (the accept could have landed as a proposal on a queue), and
 * `serverApplied` alone is not enough (a server bug must not out-vote the
 * owner's own record of what they tapped).
 */
export function chipIsApplied(chip: ChipState) {
  return chip.status === "accepted" && chip.serverApplied === true;
}

export function appliedChips(state: CallState) {
  return state.chips.filter(chipIsApplied);
}

/** Chips that will roll into "review later" if the call ended right now. */
export function pendingChips(state: CallState) {
  return state.chips.filter((chip) => chip.status === "proposed" || chip.status === "accepting" || chip.status === "rejecting");
}

export function deferredChips(state: CallState) {
  return state.chips.filter((chip) => chip.status === "deferred");
}

let captionSeq = 0;
function caption(kind: CaptionKind, text: string, extra: Partial<CaptionLine> = {}): CaptionLine {
  captionSeq += 1;
  return { id: `c${captionSeq}`, kind, text, at: Date.now(), ...extra };
}

/** Copy for a dropped window. Named per reason, because "something went wrong"
 *  is the sentence that makes a person distrust the whole screen. */
export function dropCopy(reason: MirrorCallDropReason) {
  switch (reason) {
    case "too_short": return "Missed that. It was too short to hear. Say it again?";
    case "too_long": return "That window ran past the 30-second cap and was cut. Say the rest again?";
    case "asr_empty": return "Missed that. Nothing came through. Say it again?";
    case "asr_timeout": return "Missed that. Transcription timed out. Say it again?";
    case "audio_unusable": return "Missed that. The audio came through unusable. Say it again?";
    case "rate_limited": return "Missed that. The transcription lane is rate-limited right now. Give it a moment and say it again?";
    default: return "Missed that. Say it again?";
  }
}

type Budget = CallState["chipBudget"];

function mergeChips(
  existing: ChipState[],
  incoming: MirrorCallDelta[],
  budget: Budget,
  now: number,
): { chips: ChipState[]; budget: Budget } {
  if (!incoming.length) return { chips: existing, budget };
  const byId = new Map(existing.map((chip) => [chip.delta.delta_id, chip]));
  let next: Budget = budget.minuteStart === 0 || now - budget.minuteStart >= CHIP_BUDGET_WINDOW_MS
    ? { minuteStart: now, admitted: 0, overflowed: budget.overflowed }
    : budget;
  for (const delta of incoming) {
    const current = byId.get(delta.delta_id);
    if (current) {
      // An already-actioned chip is not re-opened by the stream re-proposing
      // it. Re-opening would let a late duplicate quietly un-reject something.
      byId.set(delta.delta_id, { ...current, delta: { ...delta, status: current.delta.status } });
      continue;
    }
    if (now - next.minuteStart >= CHIP_BUDGET_WINDOW_MS) next = { minuteStart: now, admitted: 0, overflowed: next.overflowed };
    // A chip that arrives already actioned by the server does not spend
    // budget: the budget caps how often the rail ASKS, and that one is not a
    // question.
    const asks = delta.status === "proposed";
    const overBudget = asks && next.admitted >= CHIPS_PER_MINUTE;
    if (asks && !overBudget) next = { ...next, admitted: next.admitted + 1 };
    if (overBudget) next = { ...next, overflowed: next.overflowed + 1 };
    byId.set(delta.delta_id, {
      delta,
      status: overBudget
        ? "deferred"
        : delta.status === "accepted"
          ? "accepted"
          : delta.status === "rejected"
            ? "rejected"
            : delta.status === "deferred"
              ? "deferred"
              : "proposed",
      // Note the AND: a chip that arrives already-accepted still only counts as
      // applied if the server also says it landed. An over-budget chip can
      // never be applied at all — it was never shown, so nobody tapped it.
      serverApplied: !overBudget && delta.status === "accepted" && delta.applied === true,
      error: null,
      overflow: overBudget,
    });
  }
  return { chips: [...byId.values()], budget: next };
}

export function callReducer(state: CallState, event: CallEvent): CallState {
  switch (event.type) {
    case "PROBE_START":
      return { ...INITIAL_CALL_STATE, phase: "checking" };

    case "PROBE_OK":
      // The handshake only tells us the route is there. It is not a call.
      return state.phase === "checking"
        ? { ...state, phase: "idle", voiceAvailable: event.voiceAvailable, error: null, absentDetail: null }
        : state;

    case "PROBE_ABSENT":
      return { ...INITIAL_CALL_STATE, phase: "backend_absent", absentDetail: event.detail };

    case "CONNECT":
      if (state.phase !== "idle" && state.phase !== "failed" && state.phase !== "ended") return state;
      return { ...INITIAL_CALL_STATE, phase: "connecting", voiceAvailable: state.voiceAvailable };

    case "SESSION_OPEN":
      if (state.phase !== "connecting") return state;
      return {
        ...state,
        phase: event.session.state === "live" ? "live" : "warming",
        session: event.session,
        fidelity: event.session.fidelity,
        captions: [
          ...state.captions,
          caption(
            "system",
            event.session.state === "live"
              ? "Connected. Talk normally. Your side is sent in windows of up to 30 seconds."
              : "Connected. The voice GPU is cold and usually takes two to three minutes to be ready.",
          ),
        ],
      };

    case "WARM":
      if (state.phase !== "warming") return state;
      return { ...state, phase: "live", captions: [...state.captions, caption("system", "The voice GPU is warm. Go ahead.")] };

    case "FAIL":
      return { ...state, phase: "failed", turnPhase: "idle", error: event.message };

    case "CAPTURE_START":
      return canCapture(state) ? { ...state, turnPhase: "capturing", error: null } : state;

    case "CAPTURE_CANCEL":
      return state.turnPhase === "capturing" ? { ...state, turnPhase: "idle" } : state;

    case "WINDOW_SENDING":
      return state.turnPhase === "capturing" ? { ...state, turnPhase: "uploading" } : state;

    case "WINDOW_RESULT": {
      // The ONLY event that can produce a clone caption. See the header.
      if (state.phase !== "live" && state.phase !== "ending") return state;
      const { result } = event;
      const lines: CaptionLine[] = [];
      if (result.dropped) {
        lines.push(caption("dropped", dropCopy(result.dropped.reason), { dropReason: result.dropped.reason }));
      } else {
        if (result.owner_transcript) lines.push(caption("owner", result.owner_transcript));
        if (result.turn) lines.push(caption("clone", result.turn.text, { turnId: result.turn.turn_id }));
      }
      const merged = mergeChips(state.chips, result.deltas, state.chipBudget, event.at ?? Date.now());
      return {
        ...state,
        turnPhase: result.turn ? "thinking" : "idle",
        captions: [...state.captions, ...lines],
        chips: merged.chips,
        chipBudget: merged.budget,
        fidelity: result.fidelity ?? state.fidelity,
        reference: result.reference ?? state.reference,
        ownerWindows: state.ownerWindows + (result.dropped ? 0 : 1),
        droppedWindows: state.droppedWindows + (result.dropped ? 1 : 0),
        cloneTurns: state.cloneTurns + (result.turn ? 1 : 0),
      };
    }

    case "SPEAK_START":
      return { ...state, turnPhase: "speaking" };

    case "SPEAK_END":
      return state.turnPhase === "speaking" || state.turnPhase === "thinking" ? { ...state, turnPhase: "idle" } : state;

    case "VOICE_UNAVAILABLE":
      return {
        ...state,
        voiceAvailable: false,
        turnPhase: state.turnPhase === "speaking" || state.turnPhase === "thinking" ? "idle" : state.turnPhase,
        captions: [
          ...state.captions,
          caption("system", "The clone's voice route is not deployed here, so this call is captions only."),
        ],
      };

    case "CHIP_ACTION": {
      // A tap moves the chip to a PENDING status and nothing else. It does not
      // touch serverApplied — that is the whole point of the property.
      if (state.phase === "ended") return state;
      return {
        ...state,
        chips: state.chips.map((chip) =>
          chip.delta.delta_id === event.deltaId && chip.status === "proposed"
            ? { ...chip, status: event.action === "accept" ? "accepting" : "rejecting", error: null }
            : chip
        ),
      };
    }

    case "CHIP_RESULT":
      return {
        ...state,
        chips: state.chips.map((chip) =>
          chip.delta.delta_id === event.delta.delta_id
            ? {
              delta: event.delta,
              status: event.delta.status === "accepted"
                ? "accepted"
                : event.delta.status === "rejected"
                  ? "rejected"
                  : event.delta.status === "deferred"
                    ? "deferred"
                    : "proposed",
              serverApplied: event.delta.status === "accepted" && event.delta.applied === true,
              error: null,
              overflow: chip.overflow,
            }
            : chip
        ),
      };

    case "CHIP_FAILED":
      return {
        ...state,
        chips: state.chips.map((chip) =>
          chip.delta.delta_id === event.deltaId
            // Back to actionable, never to applied: a failed accept is not an
            // accept, and leaving it "accepting" forever would be a chip that
            // looks landed and is not.
            ? { ...chip, status: "proposed", serverApplied: false, error: event.message }
            : chip
        ),
      };

    // A re-listed chip cannot re-open an actioned one — `mergeChips` keeps the
    // local status for ids it already knows, which is what stops a refresh
    // from un-rejecting something the owner dismissed.
    case "DELTAS_SYNCED": {
      const synced = mergeChips(state.chips, event.deltas, state.chipBudget, event.at ?? Date.now());
      return { ...state, chips: synced.chips, chipBudget: synced.budget };
    }

    case "RATE_TURN": {
      const rated = mergeChips(state.chips, event.deltas || [], state.chipBudget, event.at ?? Date.now());
      return {
        ...state,
        ratedTurns: { ...state.ratedTurns, [event.turnId]: event.rating },
        chips: rated.chips,
        chipBudget: rated.budget,
      };
    }

    case "END":
      return canEnd(state) ? { ...state, phase: "ending", turnPhase: "idle" } : state;

    case "ENDED": {
      // The end-of-call sweep. Anything the owner did not action becomes
      // "review later" — deferred, visibly, never accepted and never applied.
      const chips = state.chips.map((chip) => {
        if (chip.status === "accepted" || chip.status === "rejected") return chip;
        if (chip.status === "deferred") return chip;
        return {
          ...chip,
          status: "deferred" as ChipStatus,
          serverApplied: false,
          delta: { ...chip.delta, status: "deferred" as const, applied: false },
          error: null,
        };
      });
      // Deltas the server deferred that the client never saw (a chip mined
      // from the last window and never rendered) still belong in the rail.
      const known = new Set(chips.map((chip) => chip.delta.delta_id));
      for (const delta of event.end.deferred) {
        if (!known.has(delta.delta_id)) {
          chips.push({ delta, status: "deferred", serverApplied: false, error: null, overflow: false });
        }
      }
      return {
        ...state,
        phase: "ended",
        turnPhase: "idle",
        chips,
        ended: event.end,
        fidelity: event.end.fidelity ?? state.fidelity,
        captions: [
          ...state.captions,
          caption(
            "system",
            event.end.finetune.queued
              ? "Call ended. A fine-tune job is queued. It runs on GPU time after the call, not during it."
              : `Call ended. No fine-tune was queued${event.end.finetune.reason ? ` (${event.end.finetune.reason.replaceAll("_", " ")})` : ""}.`,
          ),
        ],
      };
    }

    case "RESET":
      return { ...INITIAL_CALL_STATE, phase: state.phase === "backend_absent" ? "backend_absent" : "idle", absentDetail: state.absentDetail, voiceAvailable: state.voiceAvailable };

    default:
      return state;
  }
}

// ── the fidelity meters, as arithmetic ────────────────────────────────────
// TWO meters, not one — adoption delta A2 of
// `docs/gurukul/research/mirror-learning.md`, which read Chatterbox's own
// `prepare_conditionals` and found it truncates the reference to 10 s (s3gen)
// and 6 s (T3). Pooled call audio past that is mechanically inert for
// synthesis, while `voice-evidence`'s ECAPA embedding consumes the whole pool.
// So one climbing number beside a clone that cannot have changed would be a
// display moving for a reason the owner will read as a different reason —
// the `disclosure-announces-the-clone` defect class.
//
//   MEASUREMENT   how well we can measure this speaker. Grows with pooled
//                 audio. Says NOTHING about the clone.
//   CONDITIONING  the score of the ~10 s window the next reply is built from.
//                 Moves only when a better window is selected.
//
// Kept out of the component so the honesty rules are testable: no code path
// through here produces a word about how the voice SOUNDS. The earbench owns
// ears (`docs/gurukul/EARBENCH.md`).

export type FidelityMeterKind = "measurement" | "conditioning";

export interface FidelityReading {
  kind: FidelityMeterKind;
  /** What the meter is called on screen. */
  label: string;
  /** Measured ECAPA cosine, or null before there is one. */
  score: number | null;
  /** Printed self-vs-self ceiling for this speaker, or null when none exists. */
  ceiling: number | null;
  /** score/ceiling in 0..1, or null when either is missing. Drives the bar. */
  ofCeiling: number | null;
  windows: number;
  /** Pooled owner audio (measurement) or the selected window length
   *  (conditioning), in seconds. */
  seconds: number;
  /** 0..1 confidence in the estimate. Measurement meter only. */
  confidence: number | null;
  /** When the conditioning window was last re-selected. Conditioning only. */
  selectedAt: string | null;
  selections: number;
  band: "unmeasured" | "single-window" | "no-ceiling" | "below-floor" | "measured";
  /** The line that must be on screen next to the number. */
  honesty: string;
  /** What the number cannot tell you. Always rendered. */
  caveat: string;
}

export const FIDELITY_HONESTY =
  "Speaker-embedding similarity (ECAPA cosine) against this speaker's printed self-vs-self ceiling.";
export const FIDELITY_CAVEAT =
  "It does not measure how the voice sounds. Only a blind listening pass decides that.";

/** The measurement meter's own caveat — the one the research says the UI has
 *  to carry or the number lies by adjacency. */
export const MEASUREMENT_CAVEAT =
  "This is how well we can measure you, not how good the clone is. It rises as your call audio pools; the clone does not change when it does.";
/** The conditioning meter's. */
export const CONDITIONING_CAVEAT =
  "This is the reference window the next reply is built from. The model reads about 10 seconds, so this moves only when a better window is chosen, never because more audio was collected.";

function band(score: number | null, ceiling: number | null, windows: number, activationFloor: number): FidelityReading["band"] {
  if (score === null) return "unmeasured";
  if (ceiling === null) return "no-ceiling";
  if (windows < 2) return "single-window";
  return score < activationFloor ? "below-floor" : "measured";
}

function ratio(score: number | null, ceiling: number | null) {
  return score !== null && ceiling !== null && ceiling > 0
    ? Math.max(0, Math.min(1, score / ceiling))
    : null;
}

/** Meter (a): how well we can measure this speaker. */
export function readMeasurementFidelity(fidelity: MirrorCallFidelity | null, activationFloor = 0.7): FidelityReading {
  const score = fidelity?.measurement_score ?? null;
  const ceiling = fidelity?.ceiling ?? null;
  const windows = fidelity?.windows ?? 0;
  return {
    kind: "measurement",
    label: "How well we can measure you",
    score,
    ceiling,
    ofCeiling: ratio(score, ceiling),
    windows,
    seconds: fidelity?.pooled_seconds ?? 0,
    confidence: fidelity?.measurement_confidence ?? null,
    selectedAt: null,
    selections: 0,
    band: band(score, ceiling, windows, activationFloor),
    honesty: FIDELITY_HONESTY,
    caveat: MEASUREMENT_CAVEAT,
  };
}

/** Meter (b): what the next reply is actually built from. */
export function readConditioningFidelity(fidelity: MirrorCallFidelity | null, activationFloor = 0.7): FidelityReading {
  const score = fidelity?.conditioning_window_score ?? null;
  const ceiling = fidelity?.ceiling ?? null;
  // A conditioning window is ONE window by construction, so the
  // single-window band would fire forever and say nothing. It is scored as a
  // window count of 2 for banding purposes and the copy carries the real
  // caveat instead.
  return {
    kind: "conditioning",
    label: "What the next reply is built from",
    score,
    ceiling,
    ofCeiling: ratio(score, ceiling),
    windows: score === null ? 0 : 1,
    seconds: fidelity?.conditioning_seconds ?? 0,
    confidence: null,
    selectedAt: fidelity?.window_selected_at ?? null,
    selections: fidelity?.window_selections ?? 0,
    band: band(score, ceiling, 2, activationFloor),
    honesty: FIDELITY_HONESTY,
    caveat: CONDITIONING_CAVEAT,
  };
}

/** The one-line status under a meter. Every branch names the LIMIT of the
 *  number rather than grading the voice. */
export function fidelityStatusLine(reading: FidelityReading) {
  switch (reading.band) {
    case "unmeasured":
      return reading.kind === "conditioning"
        ? "No conditioning window has been selected yet. The meter stays empty rather than showing a zero."
        : "No window has been scored yet. The meter stays empty rather than showing a zero.";
    case "no-ceiling":
      return "No self-vs-self ceiling has been printed for this speaker, so this number has no top to be read against.";
    case "single-window":
      return "One scored window is an anecdote, not a score. Keep talking.";
    case "below-floor":
      // Deliberately does not use the word "sound" even to disclaim it — the
      // eval's forbidden-word check is crude on purpose, and a status line
      // that has to argue its way past a lint is a status line one edit away
      // from grading the voice for real.
      return "Below the activation floor. This is a regression monitor, not a listening verdict.";
    default:
      return reading.kind === "conditioning"
        ? `Selected ${reading.selections === 0 ? "once" : `${reading.selections} time${reading.selections === 1 ? "" : "s"}`} this call. Compare it only to this speaker's own ceiling.`
        : "Measured over the windows of this call. Compare it only to this speaker's own ceiling.";
  }
}

/**
 * The sentence that goes between the two meters. It exists because the pair is
 * only honest if the owner is told WHY they differ — otherwise a rising left
 * meter and a flat right meter reads as one of them being broken.
 */
export const METER_PAIR_NOTE =
  "Two numbers, because they move for different reasons: the left one improves as we hear more of you, the right one only when a better reference window is picked.";

/**
 * Evidence strength for a chip — adoption delta A4. A 30-minute call yields
 * roughly 1,800-2,300 owner words, below every stylometric floor in the sweep
 * (2,000-5,000 words; under 3,000 gives over 60% false attribution). So an n=1
 * chip has to LOOK weaker than an n=9-across-three-calls chip, or the rail is
 * manufacturing confidence nobody measured.
 */
export type EvidenceStrength = "single" | "thin" | "repeated";

export function evidenceStrength(delta: MirrorCallDelta): EvidenceStrength {
  const total = Math.max(delta.evidence.occurrences_total, delta.evidence.occurrences_this_call);
  if (total <= 1) return "single";
  if (delta.evidence.calls <= 1 && total < 4) return "thin";
  return total >= 3 ? "repeated" : "thin";
}

/** The count line rendered on every chip. States what was heard and where the
 *  claim's floor is, without turning a hypothesis into a finding. */
export function evidenceLine(delta: MirrorCallDelta) {
  const here = delta.evidence.occurrences_this_call;
  const total = delta.evidence.occurrences_total;
  const calls = delta.evidence.calls;
  const parts = [`heard ${here}x this call`];
  if (total > here) parts.push(`${total}x across ${calls} call${calls === 1 ? "" : "s"}`);
  switch (evidenceStrength(delta)) {
    case "single":
      return `${parts.join(" · ")}. Once is a guess, not a habit.`;
    case "thin":
      return `${parts.join(" · ")}. One call is below the length where phrasing claims hold up.`;
    default:
      return `${parts.join(" · ")}. Repeated enough to be worth a look.`;
  }
}
