import type { ClaimExtractionStatus } from "./types";

export const EXTRACTION_STATUS_POLL_MS = 15_000;

export interface ClaimExtractionTiming {
  tone: "idle" | "active" | "waiting" | "complete" | "unknown";
  title: string;
  phase: string;
  observedRange: string;
  nextCheck: string;
  returnGuidance: string;
  shouldPoll: boolean;
}

function instant(value: string | null | undefined) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clock(at: number) {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(at));
}

function items(count: number) {
  return `${count} evidence ${count === 1 ? "item" : "items"}`;
}

export function presentClaimExtractionTiming(
  extraction: ClaimExtractionStatus | null,
  now = Date.now(),
  online = true,
): ClaimExtractionTiming {
  const nearline = extraction?.nearline;
  if (!extraction) return {
    tone: "unknown",
    title: "Extraction status unavailable",
    phase: "The Person Model loaded without a durable extraction status.",
    observedRange: "No completion range can be shown without server state.",
    nextCheck: "Use Check status now to ask the server again.",
    returnGuidance: "Nothing on this screen claims extraction is running.",
    shouldPoll: false,
  };
  if (!nearline) return {
    tone: "unknown",
    title: "Automatic extraction status not reported",
    phase: "This deployment returned readiness and prior runs, but no durable nearline state.",
    observedRange: "No completion range has been measured for this deployment.",
    nextCheck: "Use Extract cited claims when the readiness blockers are clear.",
    returnGuidance: "Do not wait for background extraction unless the server reports a queued job.",
    shouldPoll: false,
  };

  const dueAt = instant(nearline.next_attempt_at);
  const automaticCheck = online
    ? `This page checks the durable status about every ${EXTRACTION_STATUS_POLL_MS / 1000} seconds while work is pending.`
    : "This browser is offline, so page checks are paused. The server queue continues without it.";
  if (nearline.state === "queued") return {
    tone: "active",
    title: "Cited extraction is queued",
    phase: `${items(nearline.pending_items)} ${nearline.pending_items === 1 ? "is" : "are"} waiting for the private extraction worker.`,
    observedRange: "No production completion range has been measured for this queue, so no finish countdown is shown.",
    nextCheck: dueAt == null
      ? automaticCheck
      : `${dueAt > now ? `The server's next attempt is scheduled for ${clock(dueAt)}.` : "The server's next attempt is due now."} ${automaticCheck}`,
    returnGuidance: dueAt != null && dueAt > now
      ? `You may close this page. Return after ${clock(dueAt)} to check the result; that is a scheduled attempt, not a promised finish.`
      : "You may close this page. Return later to check the durable queue; no second extraction tap is needed.",
    shouldPoll: true,
  };
  if (nearline.state === "running") return {
    tone: "active",
    title: "Cited extraction is running",
    phase: `The private worker owns ${items(nearline.pending_items)}. Claims remain proposals until you review them.`,
    observedRange: "No production completion range has been measured for a running extraction.",
    nextCheck: automaticCheck,
    returnGuidance: "You may close this page. Server work continues, and the Person Model reads the durable result when you return.",
    shouldPoll: true,
  };
  if (nearline.state === "waiting") return {
    tone: "waiting",
    title: "Cited extraction is waiting to retry",
    phase: nearline.last_error_code
      ? `The last server attempt stopped with ${nearline.last_error_code.replaceAll("_", " ")}. The existing evidence stays queued.`
      : "The existing evidence is waiting for the next server attempt.",
    observedRange: "A retry time is not a completion estimate.",
    nextCheck: dueAt == null
      ? automaticCheck
      : `${dueAt > now ? `Next server attempt: ${clock(dueAt)}.` : "The next server attempt is due now."} ${automaticCheck}`,
    returnGuidance: dueAt != null && dueAt > now
      ? `You may leave and return after ${clock(dueAt)}. Do not submit the same evidence again.`
      : "You may leave. The durable retry does not depend on this page remaining open.",
    shouldPoll: true,
  };
  if (nearline.state === "complete") return {
    tone: "complete",
    title: "Automatic extraction is complete",
    phase: `${items(nearline.complete_items)} completed and no evidence item is waiting in this queue.`,
    observedRange: "The queue is complete, so an estimate is no longer needed.",
    nextCheck: "No automatic page check is pending.",
    returnGuidance: "Review each proposed claim below. Nothing was accepted automatically.",
    shouldPoll: false,
  };
  if (nearline.state === "ready_for_manual_extraction") return {
    tone: "idle",
    title: "Ready for your extraction request",
    phase: `${items(extraction.readiness.eligible_spans)} ${extraction.readiness.eligible_spans === 1 ? "is" : "are"} eligible for cited extraction. No automatic job is queued.`,
    observedRange: "No completion range has been measured for a manual extraction request.",
    nextCheck: "Extraction starts only after you press Extract cited claims.",
    returnGuidance: "You can start it whenever you are ready.",
    shouldPoll: false,
  };
  if (nearline.state === "waiting_for_readiness") return {
    tone: "idle",
    title: "Waiting for reviewed evidence",
    phase: "No extraction job is running. Resolve the listed readiness blockers first.",
    observedRange: "There is no processing estimate while extraction is blocked.",
    nextCheck: "The status changes after reviewed, verified transcript evidence becomes eligible.",
    returnGuidance: "Nothing is progressing silently in this lane.",
    shouldPoll: false,
  };
  return {
    tone: "unknown",
    title: "Extraction state needs review",
    phase: `The server reported ${nearline.state.replaceAll("_", " ") || "an unnamed state"}.`,
    observedRange: "No range is shown for an unrecognized server state.",
    nextCheck: "Use Check status now before starting another extraction.",
    returnGuidance: "The UI will not guess whether this work is running.",
    shouldPoll: false,
  };
}
