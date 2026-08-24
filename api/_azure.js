// ── The Azure grant lane (WS-RESILIENCE) ───────────────────────────────────
//
// A THIRD brain, funded by Microsoft-for-Startups credits, so it costs $0 cash.
// It exists for one reason: on 2026-08-24 the free Google pool aborted on a
// single 502 and the OpenRouter balance was spent, and with nothing below them
// she answered "yaar net kuch ajeeb kar rha" three times in ninety minutes. A
// worse brain that answers beats a perfect brain that is unreachable, every
// time — so this lane sits under the other two and above the canned line.
//
// IT IS ALSO THE FIRST LANE FOR IMAGES AND DOCUMENTS, by the owner's directive.
// That is not a guess about quality: `context/rejected.md` `realtime-azure`
// measured this Foundry deployment at 5/5 correct and 0 fabricated on a rebuild
// of the `vision-fab` case at the app's real 355×768 q68 fidelity — better than
// gpt-5.6-luna or terra managed, both of which this repo dropped for
// read-part-assert-the-rest. The order lives in api/_lanes.js as a named
// constant so it can be reversed in one place.
//
// WHAT IT IS NOT. It is not a candidate for the chat incumbent and this file
// does not pretend otherwise. `realtime-azure` declined the Azure realtime
// build on register — 41 then 53 words a turn against the incumbent's 20.5 —
// and `charm-*` says the prompt sets a ceiling while the model decides how
// close you get. On the LAST-RESORT lane that tradeoff is simply not close:
// the alternative is not a better reply, it is no reply.
//
// WHAT THE OWNER MUST SET FOR IT TO GO LIVE — exact names, nothing invented:
//
//   AZURE_ENDPOINT        api/_config.js or Vercel env. The openai/v1-compatible
//                         base, WITHOUT a trailing slash and INCLUDING the
//                         /openai/v1 suffix — the same value api/memory.js,
//                         api/consolidate.js and api/_embed.js already read.
//   AZURE_KEY             api/_config.js. Vercel env override: AZURE_API_KEY
//                         (that asymmetry is pre-existing, set by memory.js and
//                         _embed.js; it is mirrored here rather than invented,
//                         because a fourth spelling is a fourth thing to get
//                         wrong).
//   AZURE_CHAT_DEPLOYMENT   optional. Deployment name for the text last resort.
//   AZURE_VISION_DEPLOYMENT optional. Deployment name for images/documents.
//
// Both deployment names default to the one deployment on this resource that
// `config/models.json` records as gate-passed for the vision lane. Unset and
// unset-key are the SAME thing here: the lane reports itself unconfigured and
// the ladder skips it. Nothing in this file ever prints, logs or returns a key.

import * as CFG from "./_config.js";

const AZ_ENDPOINT = (process.env.AZURE_ENDPOINT || CFG.AZURE_ENDPOINT || "").replace(/\/+$/, "");
const AZ_KEY = process.env.AZURE_API_KEY || CFG.AZURE_KEY || "";

/**
 * The deployment names. `grok-4-20-non-reasoning` is the row
 * config/models.json marks `"gate": "passed"` for the vision lane (vy_gate_run
 * id 35, battery visiongate-confirm) and it is deployed on this same Foundry
 * resource — so it is the one name in this repo that is both multimodal and
 * evidenced, rather than assumed. Non-reasoning is deliberate: the extraction
 * lane's reasoning model is 81% behind on emotionally heavy beats
 * (context/decisions.md `extract-model`), and this lane answers the owner.
 */
export const AZURE_CHAT_DEPLOYMENT = process.env.AZURE_CHAT_DEPLOYMENT || "grok-4-20-non-reasoning";
export const AZURE_VISION_DEPLOYMENT =
  process.env.AZURE_VISION_DEPLOYMENT || AZURE_CHAT_DEPLOYMENT;

/** Configured means BOTH halves. One without the other is not a half-lane. */
export function azureConfigured() {
  return Boolean(AZ_ENDPOINT && AZ_KEY);
}

/**
 * Ask the grant lane. Returns the raw `fetch` Response so the caller can pipe
 * an SSE stream or read JSON exactly as it does for the other two lanes —
 * `realtime-azure`'s own lesson about second implementations applies here, and
 * the cheapest way not to write one is to hand back the same object type.
 *
 * Returns `null` when the lane is unconfigured, so the ladder can skip it
 * without a special case. Never throws.
 */
export async function azureChat(body, { signal, vision = false, timeoutMs = 30_000 } = {}) {
  if (!azureConfigured()) return null;
  const model = vision ? AZURE_VISION_DEPLOYMENT : AZURE_CHAT_DEPLOYMENT;
  // Azure's OpenAI-compatible surface takes the deployment name in `model` and
  // the key in an `api-key` header — the shape api/memory.js and api/_embed.js
  // both already use live against this resource.
  const payload = { ...body, model };
  // `reasoning`/`reasoning_effort` are provider-specific; the xAI deployments
  // on this resource reject unknown fields on some builds and cap max_tokens as
  // VISIBLE-only (context/measurements.md `reasoning-split`), so neither is
  // sent. Not carrying a field is the only way to be sure it is not wrong.
  delete payload.reasoning;
  delete payload.reasoning_effort;
  const signals = [AbortSignal.timeout(timeoutMs)];
  if (signal) signals.push(signal);
  try {
    return await fetch(`${AZ_ENDPOINT}/chat/completions`, {
      method: "POST",
      headers: { "api-key": AZ_KEY, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.any ? AbortSignal.any(signals) : signals[0],
    });
  } catch {
    // A dead Azure minute must cost a slower turn, never a lost one — the same
    // sentence api/consolidate.js's fallback carries, one lane over.
    return null;
  }
}

/** For the trace and for the report. Names only; never the key or endpoint. */
export function azureLaneInfo() {
  return {
    configured: azureConfigured(),
    chat_deployment: AZURE_CHAT_DEPLOYMENT,
    vision_deployment: AZURE_VISION_DEPLOYMENT,
  };
}
