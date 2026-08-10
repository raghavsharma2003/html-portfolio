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
//    and reasons only.
//  - a failure to log is never a failure of the app: everything is caught.

import { Capacitor } from "@capacitor/core";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
const FLUSH_MS = 4000;
const MAX_BUFFER = 60; // flush early rather than grow unbounded
const MAX_DETAIL = 600; // per-record ceiling once serialized

export type DiagScope = "call" | "watch" | "chat" | "app";

interface DiagRecord {
  at: number; // epoch ms
  t: number; // ms since this session started — the RCA timeline
  scope: DiagScope;
  event: string;
  detail: Record<string, unknown>;
}

let sessionId = "";
let startedAt = 0;
let device = "";
let buffer: DiagRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

/** Begin a diagnostic session (a call, a watch session, an app run). */
export function diagStart(scope: DiagScope, deviceId: string, detail: Record<string, unknown> = {}) {
  sessionId =
    scope +
    "-" +
    Date.now().toString(36) +
    "-" +
    Math.random().toString(36).slice(2, 8);
  startedAt = now();
  device = deviceId;
  diag(scope, "session_start", detail);
  return sessionId;
}

/** Record one event. Never throws, never awaits, never blocks the caller. */
export function diag(scope: DiagScope, event: string, detail: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    let d = detail;
    // a runaway detail object must not become the payload
    const s = JSON.stringify(detail);
    if (s && s.length > MAX_DETAIL) d = { truncated: true, head: s.slice(0, MAX_DETAIL) };
    buffer.push({
      at: Date.now(),
      t: Math.round(now() - (startedAt || now())),
      scope,
      event,
      detail: d,
    });
    if (buffer.length >= MAX_BUFFER) flushDiag();
    else if (!timer) timer = setTimeout(flushDiag, FLUSH_MS);
  } catch {
    /* logging must never break the app */
  }
}

/** Push what's buffered. Safe to call at any time (end of call, app pause). */
export function flushDiag() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buffer.length) return;
  // no device yet = nowhere to send it. DRAIN, don't retain: retaining meant
  // every subsequent record hit the MAX_BUFFER check, called flush, and
  // returned — an unbounded array plus a flush attempt on every single event.
  if (!device) {
    buffer = [];
    return;
  }
  const batch = buffer;
  buffer = [];
  try {
    const body = JSON.stringify({
      op: "diag",
      device,
      session: sessionId,
      records: batch,
    });
    // keepalive lets the last batch survive the page/app going away, which is
    // exactly when the interesting failures happen
    fetch(`${BASE}/api/diag`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
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

if (typeof document !== "undefined") {
  // the app going to the background is the most common end of a session
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushDiag();
  });
}
