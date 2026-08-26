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

export function friendlyError(cause: unknown, context: string): FriendlyError {
  if (cause instanceof ReplicaApiError) {
    if (cause.status === 429) {
      return {
        headline: `${context} — too many requests`,
        detail: "This is rate-limited to keep the service stable. Wait about a minute and try again.",
        canRetry: true,
      };
    }
    if (cause.status >= 500) {
      const detail = quoted(cause.message);
      return {
        headline: `${context} — something failed on our end`,
        detail: detail
          ? `${detail} This is our error, not something you did. Try again — if it keeps happening, contact support and include this message.`
          : "This is our error, not something you did. Try again — if it keeps happening, contact support.",
        canRetry: true,
      };
    }
    if (cause.status === 404) {
      return {
        headline: `${context} — not found`,
        detail: "This may have been removed, or hasn't been created yet. Refresh and try again.",
        canRetry: true,
      };
    }
    if (cause.status === 403) {
      return {
        headline: `${context} — not permitted`,
        detail: "The server declined this action for this account. If you believe this is wrong, contact support.",
        canRetry: false,
      };
    }
    const detail = quoted(cause.message);
    return {
      headline: context,
      detail: detail
        ? `${detail} Try again — if it keeps happening, contact support and include this message.`
        : "The server did not explain why. Try again — if it keeps happening, contact support.",
      canRetry: true,
    };
  }
  if (cause instanceof DOMException && cause.name === "AbortError") {
    return {
      headline: `${context} — timed out`,
      detail: "The request took too long, likely a slow connection. Check your connection and try again.",
      canRetry: true,
    };
  }
  if (cause instanceof TypeError) {
    return {
      headline: `${context} — could not reach the server`,
      detail: "This usually means a network problem on your end. Check your connection and try again.",
      canRetry: true,
    };
  }
  const detail = cause instanceof Error ? quoted(cause.message) : "";
  return {
    headline: context,
    detail: detail
      ? `${detail} Try again — if it keeps happening, contact support and include this message.`
      : "No further detail was reported. Try again — if it keeps happening, contact support.",
    canRetry: true,
  };
}
