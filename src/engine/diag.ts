// Audit trail. Every event carries a session id, a monotonic offset and a
// free-form detail object, so any complaint ("she lied", "she was slow",
// "she went quiet") can be reconstructed from data instead of guessed at.
//
// Rules that keep this honest and cheap:
//  - it NEVER blocks or slows the thing it observes: records are buffered in
//    memory and flushed on a timer / at natural boundaries, fire-and-forget
//  - it NEVER logs what she or the user actually SAID; conversation content
//    lives in the message log already, and duplicating it here would turn a
//    debug trail into a transcript store. Lengths, counts, timings, decisions
//    and reasons only. (The ONE exception in the whole system is draft text,
//    which exists nowhere else — see compose.* in telemetry.ts.)
//  - a failure to log is never a failure of the app: everything is caught.
//
// ── this file is now an adapter, not a transport ──
// It kept its own buffer, its own /api/diag POST and its own session id, which
// meant a call produced two independent streams that could not be ordered
// against each other: the diag timeline said the lane changed, the telemetry
// timeline said the user tapped, and nothing could say which came first.
// docs/TELEMETRY.md settles it — call.* and watch.* are "the existing diag
// events, same sink". So every diag() forwards into telemetry.ts as
// `<scope>.<event>` and there is exactly one buffer, one seq and one clock.
//
// The API is unchanged on purpose: this has many callers across brain.ts,
// inner.ts, culture.ts, memory.ts, liveCall.ts, liveLookup.ts and the call
// engine, and none of them should have to care where the record lands.
//
// Session semantics DID change, and deliberately. diagStart("call") used to
// mint a new top-level session, so a call was a separate stream from the app
// run that contained it. It now mints a call_id that rides in props: a call is
// a filter over one app session, which is what makes "what did they tap right
// before the lane swapped" answerable at all.

import { tel, telFlush, telIdentify, telSubId } from "./telemetry";

export type DiagScope = "call" | "watch" | "chat" | "app";

// the handful of names docs/TELEMETRY.md pins down. Everything else forwards
// verbatim — "unknown events are accepted and stored", and renaming a decade
// of call-lane events to fit a table would lose more than it buys.
const RENAME: Record<string, string> = {
  "call.session_start": "call.start",
  "call.call_ended": "call.end",
  "call.live_connect": "call.connect",
  "watch.session_start": "watch.start",
};

let enabled = true;
const subId: Partial<Record<DiagScope, string>> = {};

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

/** Begin a diagnostic session (a call, a watch session, an app run). */
export function diagStart(scope: DiagScope, deviceId: string, detail: Record<string, unknown> = {}) {
  telIdentify(deviceId);
  if (scope === "app" || scope === "chat") {
    // the app session already exists — this is where its identity arrives
    return "";
  }
  const id = telSubId(scope);
  subId[scope] = id;
  diag(scope, "session_start", detail);
  return id;
}

/** Record one event. Never throws, never awaits, never blocks the caller. */
export function diag(scope: DiagScope, event: string, detail: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    const name = `${scope}.${event}`;
    const id = subId[scope];
    tel(RENAME[name] ?? name, id ? { ...detail, [`${scope}_id`]: id } : detail);
  } catch {
    /* logging must never break the app */
  }
}

/** Push what's buffered. Safe to call at any time (end of call, app pause). */
export function flushDiag() {
  telFlush();
}

/** A timer that reports its own duration when stopped — for latency budgets. */
export function diagTimer(scope: DiagScope, event: string, detail: Record<string, unknown> = {}) {
  const t0 = now();
  let done = false;
  return (extra: Record<string, unknown> = {}) => {
    if (done) return 0;
    done = true;
    const ms = Math.round(now() - t0);
    diag(scope, event, { ...detail, ...extra, ms });
    return ms;
  };
}

export function diagEnabled(on: boolean) {
  enabled = on;
}

/** Close a nested call/watch session so later events stop carrying its id. */
export function diagEnd(scope: DiagScope) {
  delete subId[scope];
}
