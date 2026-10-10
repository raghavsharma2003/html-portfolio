// errorCopy.ts — one place that turns a caught error into copy a teacher can
// act on, per the WS-P brief: "Replace with human copy that says what
// happened and the single next action, WITHOUT inventing a cause — if the
// server gave an opaque error, say so honestly and offer retry/contact."
//
// This never fabricates a reason the request failed. It classifies what is
// actually knowable (timeout vs. network vs. HTTP status class) and always
// surfaces the server's own message verbatim as a quoted detail, so nothing
// is hidden — it is just no longer the ONLY thing on screen.
import { ReplicaApiError } from "./replicaApi";

export interface FriendlyError {
  /** Short, human headline — what happened, in plain language. */
  headline: string;
  /** What to do about it — always ends in a concrete action. */
  detail: string;
  /** Whether a retry is a reasonable next step (false only for e.g. 401, handled elsewhere). */
  canRetry: boolean;
}

function quoted(message: string) {
  const trimmed = message.trim();
  return trimmed ? `The server said: "${trimmed}."` : "";
}

// NAMED REFUSALS. Everything else in this file deliberately refuses to invent
// a cause, because the server had not told us one. These codes are different:
// the server now names the exact precondition it is waiting on, so repeating
// the raw code at a person and telling them to "try again" would be throwing
// away an answer we were given.
//
// Two rules held here. Nothing is guessed: each entry corresponds to one
// precondition the API measured. And nothing blames a person for our work:
// where the wait is ours, the copy says so plainly and never asks them to
// retry, because retrying cannot make a pipeline finish sooner.
const REFUSAL_COPY: Record<string, { headline: string; detail: string; canRetry: boolean }> = {
  voice_preview_consent_missing: {
    headline: "One consent box is still unticked",
    detail: "Your voice cannot be used until you have granted all three permissions. Open the consent panel on the Feed step and complete it.",
    canRetry: false,
  },
  voice_preview_identity_incomplete: {
    headline: "Identity check is not finished",
    detail: "Age, identity and liveness all have to be verified, and the verification has to still be current. Finish it on the Feed step.",
    canRetry: false,
  },
  voice_preview_no_audio_yet: {
    headline: "There is no audio to work from yet",
    detail: "Upload a recording of yourself on the Feed step first. A few minutes of clear speech is enough.",
    canRetry: false,
  },
  voice_preview_source_has_other_speakers: {
    headline: "That recording has more than one person in it",
    detail: "A voice can only be built from audio you have marked as just you. Upload a recording without other speakers, or correct the marking on the Feed step.",
    canRetry: false,
  },
  voice_preview_audio_still_processing: {
    headline: "Your audio is still being processed",
    detail: "This is our side, not yours, and there is nothing for you to fix. Watch the Activity panel to see which step it is on.",
    canRetry: false,
  },
  voice_preview_voice_not_built_yet: {
    headline: "Your voice has not been built yet",
    detail: "The recording is in, and the voice itself is still being assembled. This is our side. The Activity panel shows the live position.",
    canRetry: false,
  },
  voice_preview_no_selected_audio: {
    headline: "No cleaned audio has been selected yet",
    detail: "The recording is still being separated and cleaned before a voice can be built from it. This is our side, and the Activity panel tracks it.",
    canRetry: false,
  },
  voice_preview_preconditions_unmet: {
    headline: "Something is not ready yet, and we cannot name which part",
    detail: "This is our side rather than yours. If it persists, contact support and mention the voice preview.",
    canRetry: true,
  },
};

export function friendlyError(cause: unknown, context: string): FriendlyError {
  if (cause instanceof ReplicaApiError) {
    const named = REFUSAL_COPY[cause.message.trim()];
    if (named) return named;
    if (cause.status === 429) {
      return {
        headline: `${context}: too many requests`,
        detail: "This is rate-limited to keep the service stable. Wait about a minute and try again.",
        canRetry: true,
      };
    }
    if (cause.status >= 500) {
      const detail = quoted(cause.message);
      return {
        headline: `${context}: something failed on our end`,
        detail: detail
          ? `${detail} This is our error, not something you did. Try again. If it keeps happening, contact support and include this message.`
          : "This is our error, not something you did. Try again. If it keeps happening, contact support.",
        canRetry: true,
      };
    }
    if (cause.status === 404) {
      return {
        headline: `${context}: not found`,
        detail: "This may have been removed, or hasn't been created yet. Refresh and try again.",
        canRetry: true,
      };
    }
    if (cause.status === 403) {
      return {
        headline: `${context}: not permitted`,
        detail: "The server declined this action for this account. If you believe this is wrong, contact support.",
        canRetry: false,
      };
    }
    const detail = quoted(cause.message);
    return {
      headline: context,
      detail: detail
        ? `${detail} Try again. If it keeps happening, contact support and include this message.`
        : "The server did not explain why. Try again. If it keeps happening, contact support.",
      canRetry: true,
    };
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return {
      headline: `${context}: timed out`,
      detail: "The request took too long, likely a slow connection. Check your connection and try again.",
      canRetry: true,
    };
  }
  if (cause instanceof TypeError) {
    return {
      headline: `${context}: could not reach the server`,
      detail: "This usually means a network problem on your end. Check your connection and try again.",
      canRetry: true,
    };
  }
  const detail = cause instanceof Error ? quoted(cause.message) : "";
  return {
    headline: context,
    detail: detail
      ? `${detail} Try again. If it keeps happening, contact support and include this message.`
      : "No further detail was reported. Try again. If it keeps happening, contact support.",
    canRetry: true,
  };
}
