import { createSarvamSaarasProvider } from "./providers/sarvam-saaras.js";
import { createSarvamSyncProvider } from "./providers/sarvam-sync.js";
import { createSelfHostedAsrProvider } from "./providers/self-hosted.js";

// api/_claim-extraction/registry.js's pattern: read the env, throw a coded
// 503 when it is incomplete, construct otherwise. No fixture fallback — see
// api/_channel/registry.js's note; `providers/fake.js` is imported by the
// eval and by nothing else.
//
// ── two lanes, and the order is an owner directive ───────────────────────
// SPEC-GURUKUL.md §8 item 1: "In-house replica stack, vendor-independent. The
// self-hosted lane ... is the PRIMARY voice path, not the fallback." That
// directive is about voice, and the same argument carries to ASR for the same
// reason — an ingestion pipeline that only works while a vendor contract
// holds is a product whose core loop a vendor can switch off. So when the
// self-hosted origin is configured it WINS, and Sarvam is the lane that runs
// while the in-house model is being fine-tuned.
//
// ── and the honest half of that ──────────────────────────────────────────
// docs/gurukul/ingestion-research.md §3 measured Sarvam Saaras as the
// best-evidenced Hinglish ASR available; nothing has yet measured the
// in-house lane against it on this corpus. Preferring self-hosted here is a
// STRATEGY decision (vendor independence), not a quality claim, and the
// moment there is a measurement it belongs in context/measurements.md with
// n, method and date — at which point this order is either confirmed or
// reversed by evidence rather than by directive.

export function createProductionAsrProvider(env = process.env) {
  if (env.ASR_SELF_HOSTED_ORIGIN && env.ASR_HMAC_SECRET) {
    return createSelfHostedAsrProvider({ env });
  }
  const apiKey = env.SARVAM_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("asr_provider_unavailable"), { code: "asr_provider_unavailable", status: 503 });
  }
  return createSarvamSaarasProvider({ apiKey, model: env.SARVAM_ASR_MODEL });
}

/** The sweep endpoint's spelling: absent config DISABLES the lane rather than
 *  500ing the cron every six hours. api/replica-liveness-sweep.js's shape. */
export function configuredAsrProvider(env = process.env) {
  try { return createProductionAsrProvider(env); }
  catch { return null; }
}

// ── the LIVE lane, and why it does not share the selection above ──────────
//
// `createProductionAsrProvider` picks the lane for INGESTION: a two-hour
// lecture, minutes of latency budget, diarization required. A Mirror Call has
// none of those properties — a ≤30 s window, a chip stream a human is watching,
// exactly one speaker. Measured 2026-08-26: the batch lane took 137 s on 71 s
// of audio and the sync lane 4 134 ms on 25 s.
//
// So the live lane is selected SEPARATELY rather than by adding a duration
// branch to the function above, because the two selections answer different
// questions and a shared one would make a change made for ingestion silently
// move what a live call uses.
//
// The self-hosted lane is preferred here for the same owner directive
// (SPEC-GURUKUL §8 item 1, vendor independence) — and with the same honest
// caveat: nothing has measured it against Sarvam on a ≤30 s Hinglish window,
// so this is a STRATEGY order, not a quality claim. The moment there is a
// measurement it belongs in context/measurements.md with n, method and date.
export function createLiveAsrProvider(env = process.env) {
  if (env.ASR_SELF_HOSTED_ORIGIN && env.ASR_HMAC_SECRET) {
    return createSelfHostedAsrProvider({ env });
  }
  const apiKey = env.SARVAM_API_KEY;
  if (!apiKey) {
    throw Object.assign(new Error("asr_provider_unavailable"), { code: "asr_provider_unavailable", status: 503 });
  }
  return createSarvamSyncProvider({ apiKey, model: env.SARVAM_SYNC_ASR_MODEL });
}

export function configuredLiveAsrProvider(env = process.env) {
  try { return createLiveAsrProvider(env); }
  catch { return null; }
}
