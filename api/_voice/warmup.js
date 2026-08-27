// Cold-start honesty for the in-house voice lane.
//
// WHY THIS FILE EXISTS. `docs/gurukul/AZURE-DEPLOY-STATE.md` §8 measured the
// two facts that make a naive "Preview my voice" button a lie:
//
//   - The public CPU admission broker answers `/healthz` in 21.8 s from zero
//     and 0.8 s warm. It verifies the HMAC signature the moment the request
//     lands, so a request signed while the BROKER is asleep is verified
//     ~22 s later — inside `broker.py`'s 60 s skew window, but only just.
//   - The private GPU runtime behind it is ready 161 s after a wake, and the
//     request that woke it died at 242 s on a Container Apps `504 stream
//     timeout`. The broker's own upstream ceiling is 220 s.
//
// So the two cold starts fail in DIFFERENT shapes and must not be conflated:
// a cold broker risks `context/rejected.md#hmac-skew-shorter-than-cold-start`
// (a 401 wearing the mask of a wrong key), and a cold runtime is a timeout
// arriving after four minutes of a spinner. The fix WS-T established for the
// first is reused verbatim here: wake the broker on the UNAUTHENTICATED
// `/healthz` and sign nothing until it answers 200. Nothing below widens a
// skew window or makes a 401 retryable — both were rejected there, and for
// reasons that have not changed.
//
// The second cannot be fixed from the app plane at all: the broker exposes no
// route that wakes the GPU app without synthesising, so the only thing that
// wakes the runtime is a real `POST /v1/synthesize`. What CAN be fixed is the
// SHAPE OF THE WAIT — dispatch that request, stop waiting on it after a short
// flush window, and tell the owner the truth ("warming up, about 2-5 minutes")
// instead of holding a connection open until the platform kills it.
//
// The warmth record below is per-process, exactly like `api/_ratelimit.js`,
// and it is deliberately allowed to be wrong. Both directions fail into an
// honest state: a false "cold" costs one extra `flushMs` probe, and a false
// "warm" costs one long request that ends in the same `warming` answer. It is
// a latency hint, never an authorization input — nothing in this file decides
// who may synthesise.

export const WARMUP = Object.freeze({
  // One `/healthz` attempt. The measured cold answer is 21.8 s.
  healthAttemptMs: 30_000,
  // Total unauthenticated wake budget for one request. Kept under the 60 s
  // skew window so that whatever we sign AFTER this is signed against a broker
  // already proven awake.
  healthBudgetMs: 45_000,
  healthIntervalMs: 3_000,
  // How long one successful synthesis lets us believe the GPU replica is still
  // up. Container Apps scales to zero on idle; this is a hint, not a contract.
  warmTtlMs: 240_000,
  // The first wake crossed 200 s live and still needed a fresh warm-runtime
  // synthesis. Report a 2-5 minute range rather than the disproved 3 minute
  // ceiling or a false-precision countdown.
  coldStartEtaLowMs: 120_000,
  coldStartEtaHighMs: 300_000,
  // How long a dispatched wake is believed to still be in flight.
  wakeInFlightMs: 200_000,
  // How long we stay on a cold synthesis before abandoning the WAIT (never the
  // request — see dispatchWake). Long enough that the body is on the wire and
  // the broker has forwarded it, short enough that nobody watches a spinner.
  flushMs: 12_000,
  retryAfterMs: 30_000,
});

export const WARM_STATES = Object.freeze(["warm", "warming", "cold"]);

function originKey(value) {
  return String(value || "").replace(/\/+$/, "");
}

/** Per-process warmth memory. Injectable so the eval can drive its clock. */
export function createWarmthRegistry(limit = 64) {
  const records = new Map();
  return Object.freeze({
    note(origin, event, now = Date.now()) {
      const key = originKey(origin);
      if (!key) return;
      const record = records.get(key) || { lastReadyAt: 0, lastWakeAt: 0 };
      if (event === "ready") { record.lastReadyAt = now; record.lastWakeAt = 0; }
      // A wake CLEARS the ready belief rather than sitting beside it. The
      // alternative was tried and is wrong in the silent direction: a 504 out
      // of a runtime we still believed warm would leave `read` answering
      // "warm", so the next click would take the blocking path against a
      // service that had just told us it was booting.
      else if (event === "waking") { record.lastWakeAt = now; record.lastReadyAt = 0; }
      else if (event === "unreachable") { record.lastReadyAt = 0; record.lastWakeAt = 0; }
      else return;
      records.delete(key);
      records.set(key, record);
      // Bounded like _ratelimit.js's map: evict the oldest, never clear all —
      // a full reset would hand every origin a simultaneous false "cold".
      while (records.size > limit) records.delete(records.keys().next().value);
    },
    read(origin, now = Date.now()) {
      const record = records.get(originKey(origin));
      if (!record) return Object.freeze({ state: "cold", ageMs: null });
      if (record.lastReadyAt && now - record.lastReadyAt < WARMUP.warmTtlMs) {
        return Object.freeze({ state: "warm", ageMs: now - record.lastReadyAt });
      }
      if (record.lastWakeAt && now - record.lastWakeAt < WARMUP.wakeInFlightMs) {
        return Object.freeze({ state: "warming", ageMs: now - record.lastWakeAt });
      }
      return Object.freeze({ state: "cold", ageMs: null });
    },
  });
}

export const voiceWarmth = createWarmthRegistry();

/**
 * Wake the PUBLIC admission broker on its unauthenticated health route and
 * sign nothing until it answers 200. This is `scripts/first-clone.mjs`'s
 * warmEvidence applied to the broker: it is the only thing standing between a
 * scale-to-zero wake and a 401 that reads as a wrong key.
 */
export async function probeAdmissionHealth(options = {}) {
  const origin = originKey(options.origin);
  if (!/^https:\/\/[^/]+$/.test(origin)) {
    return Object.freeze({ ok: false, code: "voice_origin_invalid", attempts: 0, elapsedMs: 0, status: null });
  }
  const fetchImpl = options.fetchImpl || fetch;
  const now = options.now || (() => Date.now());
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const budget = Number.isFinite(options.budgetMs) ? options.budgetMs : WARMUP.healthBudgetMs;
  const attemptMs = Number.isFinite(options.attemptMs) ? options.attemptMs : WARMUP.healthAttemptMs;
  const intervalMs = Number.isFinite(options.intervalMs) ? options.intervalMs : WARMUP.healthIntervalMs;
  const startedAt = now();
  let attempts = 0;
  let status = null;
  while (now() - startedAt < budget) {
    attempts += 1;
    try {
      const response = await fetchImpl(`${origin}/healthz`, {
        method: "GET",
        cache: "no-store",
        signal: AbortSignal.timeout(attemptMs),
      });
      status = Number(response?.status) || null;
      if (response?.ok) {
        return Object.freeze({ ok: true, code: null, attempts, elapsedMs: now() - startedAt, status });
      }
    } catch {
      // A container app at zero replicas refuses the connection until the
      // platform schedules it. Not an error yet — that is what the budget is.
      status = null;
    }
    if (now() - startedAt + intervalMs >= budget) break;
    await sleep(intervalMs);
  }
  return Object.freeze({
    ok: false,
    code: "voice_admission_cold",
    attempts,
    elapsedMs: now() - startedAt,
    status,
  });
}

/**
 * Map a synthesis failure onto what the owner should be told. The distinction
 * this draws is the whole point: an admission REFUSAL is a real error and must
 * never be dressed up as latency, while a runtime that is still booting is not
 * an error at all.
 */
export function classifyPreviewFailure(error) {
  const code = String(error?.code || error?.message || "voice_preview_failed");
  if (code === "voice_preview_wake_dispatched") return Object.freeze({ state: "warming", code, stage: "runtime_cold" });
  if (/^(open_voice_unreachable|open_voice_http_5\d\d|open_voice_runtime_unreachable|voice_preview_timeout)$/.test(code)) {
    return Object.freeze({ state: "warming", code, stage: "runtime_cold" });
  }
  // `transport_binding_invalid` is a wrong key or a replayed nonce. WS-L's
  // negative control exists to keep it distinguishable from a cold start, and
  // folding it into "warming" would undo that on the client side instead.
  return Object.freeze({ state: "error", code, stage: null });
}

/** The body the studio renders. One shape for every non-audio outcome. */
export function warmingBody(stage, extra = {}) {
  return Object.freeze({
    state: "warming",
    stage,
    message: stage === "admission_cold"
      ? "The voice lab's front door is still waking up. This takes about a minute from cold."
      : "Your voice runtime is starting on a GPU. From a cold start this takes about 2 to 5 minutes.",
    eta_seconds_low: Math.round(WARMUP.coldStartEtaLowMs / 1000),
    eta_seconds_high: Math.round(WARMUP.coldStartEtaHighMs / 1000),
    retry_after_ms: WARMUP.retryAfterMs,
    ...extra,
  });
}

/**
 * Dispatch a synthesis and stop WAITING after `flushMs` without cancelling it.
 *
 * The distinction matters and is easy to get backwards: aborting our own
 * signal would cancel the request at the broker, and the GPU replica would
 * never be scheduled — the wake would be undone by the very timeout meant to
 * survive it. So the promise is left running with its own timeout and its
 * rejection swallowed. By the time `flushMs` elapses the body is on the wire
 * and Container Apps has already begun scaling the runtime out.
 */
export async function dispatchWake(run, options = {}) {
  const flushMs = Number.isFinite(options.flushMs) ? options.flushMs : WARMUP.flushMs;
  const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const pending = Promise.resolve().then(run);
  let settled = false;
  pending.then(() => { settled = true; }, () => { settled = true; });
  const outcome = await Promise.race([
    pending.then((value) => ({ kind: "resolved", value }), (error) => ({ kind: "rejected", error })),
    sleep(flushMs).then(() => ({ kind: "flushed" })),
  ]);
  if (outcome.kind === "flushed" && !settled) pending.catch(() => {});
  return outcome;
}

export const PANEL_TEXT_MAX = 280;

/**
 * The panel's own text cap, tighter than the lab's 600. GPU seconds scale with
 * characters, this button is one click from a studio's landing view, and the
 * thing an owner needs to hear is a greeting, not an essay.
 */
export function capPanelText(value, max = PANEL_TEXT_MAX) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) throw Object.assign(new Error("voice_preview_text_required"), { code: "voice_preview_text_required", status: 400 });
  if (Array.from(text).length > max) {
    throw Object.assign(new Error("voice_preview_text_too_large"), { code: "voice_preview_text_too_large", status: 413 });
  }
  return text;
}
