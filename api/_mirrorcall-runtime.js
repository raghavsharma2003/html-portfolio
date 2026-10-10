import { WARMUP } from "./_voice/warmup.js";

function unavailable() {
  return Object.freeze({
    warm: false,
    state: "unconfigured",
    estimated_ready_seconds: null,
    eta_seconds_low: null,
    eta_seconds_high: null,
    retry_after_seconds: null,
  });
}

function observed(state, details = {}) {
  const warm = state === "warm";
  return Object.freeze({
    warm,
    state,
    estimated_ready_seconds: warm ? 0 : Math.round(WARMUP.coldStartEtaHighMs / 1000),
    eta_seconds_low: warm ? 0 : Math.round(WARMUP.coldStartEtaLowMs / 1000),
    eta_seconds_high: warm ? 0 : Math.round(WARMUP.coldStartEtaHighMs / 1000),
    retry_after_seconds: warm ? 0 : Math.round(WARMUP.retryAfterMs / 1000),
    ...details,
  });
}

/**
 * Observe the private voice runtime through the canonical signed broker probe.
 *
 * A Mirror Call cannot wait for `turn_voice` to wake the GPU: the Studio does
 * not enable capture until status says the runtime is live, so no turn can
 * exist before the wake. The provider's `probeRuntimeReadiness` is the same
 * HMAC-admitted `/v1/runtime-status` path used by the preview panel. Calling it
 * while the private Container App is at zero replicas both starts the wake and
 * returns false until the app is actually ready.
 *
 * This helper deliberately owns no transport, signature, origin or readiness
 * logic. Those stay in the provider. It only translates the measured result
 * into the Mirror Call status shape and updates the shared warmth hint.
 */
export async function observeMirrorCallVoiceRuntime(options = {}) {
  const origin = String(options.origin || "").replace(/\/+$/, "");
  const warmth = options.warmth;
  const provider = options.provider;
  const now = options.now || Date.now;
  if (!origin || !warmth || typeof warmth.read !== "function" ||
      !provider || typeof provider.probeRuntimeReadiness !== "function") {
    return unavailable();
  }

  const local = warmth.read(origin, now());
  if (local.state === "warm") return observed("warm", { observed_by: "shared_warmth" });

  try {
    const ready = await provider.probeRuntimeReadiness({ signal: options.signal });
    warmth.note(origin, ready ? "ready" : "waking", now());
    return observed(ready ? "warm" : "warming", { observed_by: "signed_runtime_status" });
  } catch (error) {
    // A failed probe is not proof that the GPU is cold or warm. Preserve an
    // already observed in-flight wake, otherwise name the uncertainty instead
    // of turning it into a fake countdown.
    const after = warmth.read(origin, now());
    if (after.state === "warming") {
      return observed("warming", {
        observed_by: "shared_warmth",
        probe_failure_code: String(error?.code || "runtime_probe_failed").slice(0, 80),
      });
    }
    return Object.freeze({
      ...unavailable(),
      state: "unreachable",
      observed_by: "signed_runtime_status",
      probe_failure_code: String(error?.code || "runtime_probe_failed").slice(0, 80),
    });
  }
}

