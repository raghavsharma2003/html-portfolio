// ── The upstream failure ladder, as a testable object (WS-RESILIENCE) ──────
//
// WHY THIS FILE EXISTS. On 2026-08-24, between 02:30 and 04:30Z, three of the
// owner's turns — a "Hello" and two photos — died on a SINGLE upstream 502 from
// Google. The production trace is unambiguous: error legs `{ms:6693,status:502}`
// and `{ms:9869,status:502}`, `retries:0`, `fallbacks:[]`, and she answered with
// the canned connectivity pair three times in ninety minutes, identical wording
// each time.
//
// The cause was one line of folding in `api/chat.js`:
//
//     if (isQuota(r.status)) return { ok: false, exhausted: true };
//     // every key would reject it identically, so stop rather than burning the pool
//     return { ok: false, error: `gemini ${r.status}` };
//
// The comment is TRUE for 400/401/403/404 — a malformed request is malformed
// against every key in the pool, and retrying it seven times only makes the user
// wait seven times longer for the same error. It is FALSE for 5xx. A 502 is the
// upstream having a moment, and it says nothing whatsoever about the other eight
// keys, which were healthy the entire time. So a nine-key pool aborted without a
// single retry, and the paid lane below it was never even reached.
//
// `api/_gkeys.js` already knew this — `isTransient` exists there, and
// `api/speech.js` and `api/memory.js` both classify correctly. Only the two
// callers that imported `isQuota` alone (`chat.js`, `live-token.js`) folded 5xx
// into "deterministic". That is `age-tier-never-realtime`'s shape one more time:
// a second implementation that was simply never updated when the first one was.
// The answer is to have exactly ONE classifier and ONE ladder, here, and to make
// every caller name it rather than re-derive it.
//
// THE LADDER, in the order the code applies it:
//
//   quota (429/403)                → the key is spent. Cool it, next key.
//   400/401/404 (+ 402/405/413/415)→ deterministic. Every key rejects it
//                                    identically; abort the pool.
//   5xx / 408 / network throw /    → TRANSIENT. Retry ONCE on the SAME key
//   an aborted attempt                after a short jittered backoff, then
//                                    rotate to the next key.
//   2xx carrying an empty reply    → treat as spent (pre-existing behaviour,
//                                    see api/chat.js's empty-200 guard).
//
// WHY THE BOUND IS A WALL CLOCK AND NOT ONLY A COUNT. The two 502s in the trace
// took 6.7s and 9.9s to come back. A retry budget expressed purely as a count
// would therefore have allowed ~20s of dead air, and Chat.tsx raises its
// long-think indicator at 4s — past which the turn stops feeling alive, which is
// the one thing this repo never trades. So the ladder carries BOTH bounds: at
// most `TRANSIENT_BUDGET` extra attempts, AND a hard deadline
// `TRANSIENT_DEADLINE_MS` after the pool walk starts. No retry is STARTED after
// the deadline, and every attempt after the first is aborted AT the deadline.
// Added latency from the whole ladder is therefore ≤ TRANSIENT_DEADLINE_MS by
// construction, not by hoping the upstream is quick.
//
// Pure and dependency-free on purpose: `evals/resilience/run.mjs` drives every
// branch of it with a fake clock and a fake upstream, so the classification is
// gated by the tree that ships rather than by a comment claiming it is right.

/** The key is spent. Cool it and move on. */
export const QUOTA = "quota";
/** The upstream is sick, not spent. Retry, then rotate. */
export const TRANSIENT = "transient";
/** Our request is bad. Every key rejects it identically — stop. */
export const DETERMINISTIC = "deterministic";
/** A 200 carrying nothing. Handled as spent; see api/chat.js's empty guard. */
export const EMPTY = "empty_200";

// Deterministic statuses, listed rather than inferred. Anything a server
// returns to say "this request is wrong" belongs here; anything it returns to
// say "I am having a problem" does not. 403 is deliberately absent — Google
// uses it for quota, which is why `isQuota` in _gkeys.js claims it.
const DETERMINISTIC_STATUS = new Set([400, 401, 402, 404, 405, 406, 409, 410, 413, 414, 415, 422, 426, 431, 451]);

/**
 * One classifier, used by every lane. `status` 0 means the fetch threw (DNS,
 * TLS, socket reset, abort) — a network flake is transient by definition.
 */
export function classifyUpstream(status) {
  const s = Number(status) || 0;
  if (s === 429 || s === 403) return QUOTA;
  if (s >= 200 && s < 300) return null; // not a failure at all
  if (DETERMINISTIC_STATUS.has(s)) return DETERMINISTIC;
  // 0 (threw), 408, every 5xx, and any status nobody has classified yet. An
  // unknown status is treated as transient on purpose: the cost of a wrong
  // guess in this direction is one extra round trip, and in the other
  // direction it is the defect this file exists to fix.
  return TRANSIENT;
}

/** How many EXTRA attempts (beyond the first per key) one request may spend. */
export const TRANSIENT_BUDGET = 3;
/** Extra attempts allowed on the SAME key before rotating away from it. */
export const SAME_KEY_RETRIES = 1;
/**
 * The hard ceiling on latency this ladder is allowed to add to a turn.
 * Chat.tsx shows its long-think indicator at 4s; a resilience mechanism that
 * pushes a turn past the point where it stops feeling alive has traded the
 * product for an availability number.
 */
export const TRANSIENT_DEADLINE_MS = 4_000;
/** Jittered backoff window. Jitter matters because a pool of keys hitting the
 *  same sick region would otherwise retry in lockstep. */
export const BACKOFF_MIN_MS = 350;
export const BACKOFF_MAX_MS = 700;

export function backoffMs(rand = Math.random) {
  return Math.round(BACKOFF_MIN_MS + rand() * (BACKOFF_MAX_MS - BACKOFF_MIN_MS));
}

/** A fresh per-request budget. `deadline` is absolute epoch ms. */
export function newTransientBudget(now = Date.now(), deadlineMs = TRANSIENT_DEADLINE_MS) {
  return { left: TRANSIENT_BUDGET, deadline: now + deadlineMs, attempts: 0, retries: 0 };
}

/**
 * Wrap a raw upstream call into the `fn(key)` contract `withGeminiKey` expects,
 * adding the bounded same-key retry.
 *
 * `doFetch(key, ctx)` must resolve to `{ ok, status, value?, empty? }` or throw.
 * `ctx` carries `{ first, deadline }` so the caller can attach an abort signal
 * to every attempt after the first — that is what makes the deadline real
 * rather than advisory.
 *
 * `onAttempt({ status, outcome, sameKeyRetry, network })` is the trace hook. It
 * is handed COUNTS AND STATUSES ONLY: no key, no key prefix, no hash of a key.
 * See api/chat.js's trace comment — a hash of a secret is still a
 * secret-shaped identifier and carries no diagnostic value the count does not.
 */
export function poolAttempt(doFetch, { budget, sleep, rand = Math.random, now = Date.now, onAttempt = () => {} }) {
  const nap = sleep || ((ms) => new Promise((r) => setTimeout(r, ms)));
  return async function attempt(key) {
    for (let sameKeyRetry = 0; ; sameKeyRetry++) {
      const first = budget.attempts === 0;
      // THE DEADLINE HAS ALREADY GONE. Measured through the real handler with
      // the real 2026-08-24 shape — a 502 that takes 6.7s to come back — the
      // walk then started an attempt per remaining key and each was aborted at
      // ~1ms by the deadline signal: three keys burned, three trace legs, no
      // chance of an answer. Stop the walk instead. The turn is already past
      // the point where it feels alive, and the fastest remaining route to an
      // actual reply is the NEXT LANE, not two more keys that cannot be given
      // any time to answer. Shaped as a pool abort for that reason.
      if (!first && now() >= budget.deadline) {
        onAttempt({ status: 0, outcome: "deadline", sameKeyRetry, network: false });
        return { ok: false, error: "free-lane deadline" };
      }
      budget.attempts++;
      let res = null;
      let threw = false;
      try {
        res = await doFetch(key, { first, deadline: budget.deadline });
      } catch {
        threw = true;
      }
      const status = threw ? 0 : Number(res?.status) || 0;

      if (!threw && res?.ok && !res?.empty) {
        onAttempt({ status, outcome: "ok", sameKeyRetry, network: false });
        return { ok: true, value: res.value };
      }
      if (!threw && res?.ok && res?.empty) {
        onAttempt({ status, outcome: EMPTY, sameKeyRetry, network: false });
        return { ok: false, exhausted: true };
      }

      const cls = threw ? TRANSIENT : classifyUpstream(status);
      if (cls === QUOTA) {
        onAttempt({ status, outcome: QUOTA, sameKeyRetry, network: false });
        return { ok: false, exhausted: true };
      }
      if (cls === DETERMINISTIC) {
        onAttempt({ status, outcome: DETERMINISTIC, sameKeyRetry, network: false });
        // The ONLY branch that still aborts the pool, and now it is the branch
        // whose comment was always true.
        return { ok: false, error: `gemini ${status}` };
      }

      // TRANSIENT. Both bounds are checked before a retry is started: the
      // count, and the wall clock including the backoff we are about to sleep.
      const wait = backoffMs(rand);
      const canRetryHere =
        sameKeyRetry < SAME_KEY_RETRIES && budget.left > 0 && now() + wait < budget.deadline;
      onAttempt({
        status,
        outcome: canRetryHere ? "transient_retry" : "transient_rotate",
        sameKeyRetry,
        network: threw,
      });
      if (!canRetryHere) {
        // Rotate. `retry: true` is _gkeys.js's "sick, not spent" signal: the
        // key is cooled for SICK_MS rather than the full quota window.
        return { ok: false, retry: true, error: threw ? "network" : `gemini ${status}` };
      }
      budget.left--;
      budget.retries++;
      await nap(wait);
    }
  };
}

// ── The attachment payload contract (WS-RESILIENCE / WS-COMPOSER seam) ─────
//
// The composer now sends up to five images and a caption in ONE message. The
// server validates and caps the set here rather than trusting the client,
// because the client is a phone the owner can reinstall and the caps protect
// real money (vision cost per call) and the platform's request ceiling.
//
// The legacy single-photo shape — an `image_url` part already inside
// `messages`, which is what src/engine/brain.ts's `toTurns` has always built —
// keeps working untouched. This is additive.

/** Hard count cap. Five is the owner's number; the server enforces it. */
export const MAX_IMAGES = 5;
/** Per image, measured on the data URL as sent. ~1.1MB of binary at base64. */
export const MAX_IMAGE_CHARS = 1_500_000;
/** All images together. Five at the per-image cap would be 7.5MB, which is
 *  past what the platform will accept alongside a 3MB message history. */
export const MAX_IMAGES_CHARS = 4_000_000;
/** Unchanged from the pre-existing 413 guard in api/chat.js. */
export const MAX_MESSAGES_CHARS = 3_000_000;

const DATA_URL = /^data:(image\/(?:png|jpe?g|webp|gif|heic|heif));base64,([A-Za-z0-9+/=\s]+)$/i;

/**
 * Validate and normalise the image set.
 *
 * Accepts `"data:image/png;base64,…"` strings, `{ data, mime }` objects (where
 * `data` may itself be a data URL or bare base64), and https URLs — the last
 * because photos that DID reach storage ride as URLs today and must not
 * regress.
 *
 * Returns `{ ok: true, urls }` or `{ ok: false, status, error }` — `status` is
 * 413 for a cap and 400 for a shape, so the caller does not have to guess.
 */
export function normalizeImages(images) {
  if (images === undefined || images === null) return { ok: true, urls: [] };
  if (!Array.isArray(images)) return { ok: false, status: 400, error: "images must be an array" };
  if (images.length > MAX_IMAGES) {
    return { ok: false, status: 413, error: `too many images (${images.length} > ${MAX_IMAGES})` };
  }
  const urls = [];
  let total = 0;
  for (const raw of images) {
    let url = null;
    if (typeof raw === "string") {
      url = raw;
    } else if (raw && typeof raw === "object" && typeof raw.data === "string") {
      const mime = typeof raw.mime === "string" && /^image\//i.test(raw.mime) ? raw.mime : "image/jpeg";
      url = raw.data.startsWith("data:") ? raw.data : `data:${mime};base64,${raw.data}`;
    }
    if (typeof url !== "string" || !url) {
      return { ok: false, status: 400, error: "each image must be a data URL, an https URL, or { data, mime }" };
    }
    const isHttps = /^https:\/\//i.test(url);
    if (!isHttps && !DATA_URL.test(url)) {
      return { ok: false, status: 400, error: "unsupported image encoding" };
    }
    if (url.length > MAX_IMAGE_CHARS) {
      return { ok: false, status: 413, error: `image too large (${url.length} > ${MAX_IMAGE_CHARS})` };
    }
    total += url.length;
    if (total > MAX_IMAGES_CHARS) {
      return { ok: false, status: 413, error: `images too large (${total} > ${MAX_IMAGES_CHARS})` };
    }
    urls.push(url);
  }
  return { ok: true, urls };
}

/**
 * Fold the caption, the images and any extracted document text into the LAST
 * user turn — ONE turn, not five.
 *
 * That is the whole point and it is a product requirement, not an efficiency
 * one: five images handed over as five turns produce five separate reactions,
 * and a person who is shown five photos at once reacts to the SET. The order
 * (caption first, then the pictures, then the documents) is the order a person
 * receives them in a chat app.
 *
 * Returns a NEW messages array; the input is not mutated.
 */
export function attachToLastTurn(messages, { caption = "", urls = [], docBlocks = [] } = {}) {
  const out = Array.isArray(messages) ? messages.slice() : [];
  if (!urls.length && !docBlocks.length && !String(caption || "").trim()) return out;

  const parts = [];
  const cap = String(caption || "").trim();
  if (cap) parts.push({ type: "text", text: cap });
  for (const url of urls) parts.push({ type: "image_url", image_url: { url } });
  for (const b of docBlocks) parts.push({ type: "text", text: b });

  // Find the last user turn. If the tail is not a user turn (a directive turn,
  // or an empty history), the attachment becomes its own user turn rather than
  // being silently dropped — an attachment that reaches no turn is
  // `dead-writers` with the owner's photo in it.
  let i = out.length - 1;
  while (i >= 0 && out[i]?.role !== "user") i--;
  if (i < 0) {
    out.push({ role: "user", content: parts });
    return out;
  }
  const turn = out[i];
  const content = turn.content;
  out[i] = {
    ...turn,
    content: typeof content === "string"
      ? [{ type: "text", text: content }, ...parts]
      : [...(Array.isArray(content) ? content : []), ...parts],
  };
  return out;
}

// ── THE LANE ORDER ─────────────────────────────────────────────────────────
//
// One visible constant per case, because the owner's stated wish (Azure first
// for images and documents, since the credits are $0 cash and the Foundry
// multimodal deployment is the one measured at 5/5 correct / 0 fabricated on
// the app's real frame shape — context/rejected.md `realtime-azure`) is a
// PREFERENCE, and a preference written as an if-statement three files deep is a
// preference nobody can find or reverse.
//
// Left to right. A lane that is not configured is skipped, not failed.
//
//   gemini-free  the free Google AI Studio pool (api/_gkeys.js) — free, fast,
//                streams, and the incumbent for text.
//   openrouter   paid. Currently the owner's OpenRouter balance is spent, which
//                is exactly why the lane below it now exists.
//   azure        Microsoft-for-Startups credits: $0 cash. Last resort for text,
//                FIRST for images and documents.
export const LANE_ORDER_TEXT = ["gemini-free", "openrouter", "azure"];
export const LANE_ORDER_ATTACHMENT = ["azure", "gemini-free", "openrouter"];

/** Which order this request uses. One call site, so the rule is one line. */
export function laneOrder({ hasAttachments }) {
  return hasAttachments ? LANE_ORDER_ATTACHMENT : LANE_ORDER_TEXT;
}
