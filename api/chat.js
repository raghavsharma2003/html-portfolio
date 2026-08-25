// Meera brain proxy — keeps the OpenRouter key server-side so the app and
// public repo never contain it. POST { system, messages, model? } → reply text.

import { allow, ipOf } from "./_ratelimit.js";
import { withGeminiKey, poolSize } from "./_gkeys.js";
// ONE classifier and ONE ladder, shared by every lane — see api/_lanes.js's
// header for the 2026-08-24 production trace this file's old folding produced.
// `isQuota` is no longer imported here on purpose: importing only the quota
// half is what made 5xx look deterministic in the first place.
import {
  poolAttempt,
  newTransientBudget,
  normalizeImages,
  attachToLastTurn,
  laneOrder,
  MAX_IMAGES,
  MAX_MESSAGES_CHARS,
  TRANSIENT_DEADLINE_MS,
} from "./_lanes.js";
import { normalizeDocs } from "./_docs.js";
import { azureChat, azureConfigured, AZURE_CHAT_DEPLOYMENT, AZURE_VISION_DEPLOYMENT } from "./_azure.js";
// WS-COST B2: the paid lane's token counts go to the server ops stream, which
// is counts-and-labels only. obsBestEffort never throws and never blocks the
// reply path — see api/_obs.js's contract.
import { obsBestEffort } from "./_obs.js";
// WS-COST C: explicit `cachedContents` over the byte-stable core, and the
// OpenAI⇄native bridge that surface requires. Both are reachable ONLY from
// inside `runGeminiPaid` below — no free-lane path imports or calls either.
import {
  getCache,
  refreshCache,
  dropCache,
  coreHash,
  cacheableCore,
  cacheId,
  isCacheMissStatus,
} from "./_gcache.js";
import {
  toNativeContents,
  buildNativeBody,
  nativeJsonToOpenAI,
  nativeSseToOpenAiStream,
} from "./_gnative.js";

// WS-COST. Namespace import, not named: `GEMINI_PAID_KEY` and `PAID_LANE` are
// both OPTIONAL, and a named import of something a deploy's _config.js does not
// export is a module-load crash that takes the whole chat endpoint with it —
// the same reason api/_gkeys.js imports its config this way.
import * as CFG from "./_config.js";
import { OPENROUTER_KEY } from "./_config.js";

// SPEC §7.3 chat-lane call-site adoption: the router decision now happens
// UPSTREAM of this file, in brain.ts's routeChatLane() (src/engine/router.ts
// mirror, kept in sync with config/models.json's chat lane — see that
// function's own doc, proven equal to this constant by
// scripts/verify-chat-lane-route.mjs). This proxy stays a dumb pass-through
// on purpose: it never imports src/ (this file's own long-standing rule,
// see OPERATIONAL_CORE_CAP below) and never imports config/models.json
// either, so it keeps working even if router.ts or the seed file is broken —
// it just accepts whatever `model` the caller sends, same as before this
// seam existed. `DEFAULT_MODEL` below is this file's OWN fallback for a
// request that omits `model` entirely (or sends something ALLOWED_MODEL
// rejects), not a second router — it must equal brain.ts's
// OPENROUTER_DEFAULT_MODEL / routeChatLane() default by construction (both
// mirror config/models.json's chat incumbent), and the same verify script
// checks that value at the source of truth.
const DEFAULT_MODEL = "google/gemini-3.6-flash";
const ALLOWED_MODEL = /^[a-z0-9-]+\/[a-z0-9.:-]+$/i;
// Headroom over the current core, so her personality can keep growing without
// quietly losing its tail again. It is a sanity bound against a malformed
// request, not a cost lever: the whole core is prompt-cached, so a higher
// ceiling costs nothing until the text is actually there. Raised 48k -> 64k
// because the live voice lane measured 45,042 — 93.8% of the old cap, i.e. one
// good paragraph away from silently truncating her again.
//
// THIS IS THE OPERATIONAL CORE CAP, mirrored (not imported — a Vercel
// serverless function here stays plain JS with zero cross-imports from
// src/, and this proxy is the outer guard that must survive even if the
// bundler that builds src/ is unavailable) in
// src/engine/compiler.ts's OPERATIONAL_CORE_CAP. It deliberately does NOT
// equal the SPEC's target CORE_CAP (40,000): no content cut has happened at
// persona extraction (SPEC §0.3 "Persona factoring charm risk" — that
// requires a paired n≥300 dual-judge equivalence run before it can shrink),
// so lowering this number today would truncate real, unchanged production
// traffic — the exact silent-truncation failure this guard exists to
// prevent. scripts/check-prompt-budget.mjs asserts this literal value
// equals compiler.ts's OPERATIONAL_CORE_CAP on every run, so guard and
// guarded cannot drift even without a runtime import.
// Raised 64k -> 72k 2026-08-25: measured heavy-dyad cores reached 62,026 B
// (3.1% headroom) in a 2,304-row corpus scan. See compiler.ts's cap comment.
const SYSTEM_MAX = 72_000;
// Google's OpenAI-compatible surface: same request shape, same SSE stream.
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";
// Google's NATIVE surface. The ONLY one that has `cachedContents` — the compat
// endpoint above simply has no field for it. Used by the paid lane's cached
// path and by nothing else in this file.
const GEMINI_NATIVE_BASE = "https://generativelanguage.googleapis.com/v1beta";

// ── WS-COST: the paid Google lane ────────────────────────────────────────
//
// OFF BY DEFAULT AND OFF UNLESS SAID TWICE. The lane runs only when the flag
// is explicitly enabled AND a paid key exists; either one missing and
// `laneOrder` is handed `paidLane: false`, which returns the exact frozen
// array it returned before this lane existed. There is no third way in.
//
// The flag is read from the environment FIRST so it can be flipped in Vercel
// without a redeploy of the gitignored config, mirroring how every other key
// in this repo resolves. Only the literal strings "1" and "true" enable it: a
// flag that turns on for "0" or "false" is a flag that turns on by accident.
const PAID_LANE_ON = (() => {
  const raw = process.env.PAID_LANE ?? CFG.PAID_LANE ?? "";
  return raw === true || String(raw).toLowerCase() === "1" || String(raw).toLowerCase() === "true";
})();
const PAID_KEY = process.env.GEMINI_PAID_KEY || CFG.GEMINI_PAID_KEY || "";
/** Is the billed Google lane both permitted and reachable on this deploy? */
function paidLaneReady() {
  return Boolean(PAID_LANE_ON && PAID_KEY);
}
// WS-COST C: explicit caching is ON inside the paid lane, and is the whole
// reason the lane is worth turning on (−79.2% per turn vs −45.7% for the
// implicit cache Google gives away free — measurements.md#cache-plateau). It
// is nonetheless a SEPARATE, OPT-OUT switch, because it is the only thing here
// that speaks a different upstream surface: if the native path ever misbehaves
// in production the fix must be a flag flip, not a deploy. Note the polarity is
// the opposite of PAID_LANE and deliberately so — this flag cannot cause spend
// (the paid lane gates that), it can only change WHICH shape the spend takes,
// so its safe default is on.
const PAID_CACHE_ON = (() => {
  const raw = process.env.PAID_CACHE ?? CFG.PAID_CACHE ?? "";
  const s = String(raw).toLowerCase();
  return !(s === "0" || s === "false" || s === "off");
})();

// voice calls stream tokens so she can start speaking on the first sentence
export const config = { supportsResponseStreaming: true };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  // the native app is cross-origin: cache the preflight so every call turn
  // doesn't pay an extra RTT before the request even starts
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "chat", 40)) return res.status(429).json({ error: "slow down" });

  const key = process.env.OPENROUTER_API_KEY || OPENROUTER_KEY;
  // This used to refuse the request outright when OpenRouter was unset, which
  // was correct while OpenRouter was the only lane that always existed. There
  // are three now, and the OpenRouter balance being spent is precisely the
  // condition the Azure grant lane was added for — so the guard asks the only
  // question that still matters: is there ANY brain to reach?
  if (!key && poolSize() === 0 && !azureConfigured()) {
    return res.status(500).json({ error: "no key configured" });
  }

  // ── WS-TRACE (docs/TRACE.md §3.5): the model leg ──────────────────────────
  // This proxy is the only place that knows which upstream ACTUALLY answered.
  // It walks the free Gemini pool first and falls through to paid OpenRouter,
  // and today a turn that tastes different because the pool was exhausted is
  // indistinguishable from one that is not — Chat.tsx's own telemetry comment
  // says so: "which brain actually answered is decided inside brain.ts and is
  // not returned".
  //
  // The leg is RETURNED, never written. A DB write here would sit on the reply
  // path (`live-floor` 1.4-1.5s, this file's own 720ms text floor) and a
  // fire-and-forget one after the response silently disappears when the
  // function freezes — api/telemetry.js's measured lesson. So it rides the body
  // that was already going back: ~250 bytes on a response in flight, zero added
  // latency, and the client folds it into its own off-path batch.
  //
  // A reader that does not know about `trace` is unaffected: it is one more
  // field on a JSON object, and on the streaming lane one more `data:` frame
  // whose payload has no `choices` — which every SSE consumer in this repo
  // already skips. See the WS-TRACE report for the three-line brain.ts hook
  // that reads it.
  const tStart = Date.now();
  const trace = {
    turn_id: null,
    lane: null,
    served_by: null,
    model: null,
    stream: false,
    fallbacks: [],
    retries: 0,
  };
  try {
    const { system, system_tail, messages, model, max_tokens, stream, no_think, turn_id, lane,
      // WS-COMPOSER seam: up to five images and one caption in ONE message,
      // plus documents. Validated and capped below rather than trusted — see
      // api/_lanes.js. The legacy shape (image_url parts already inside
      // `messages`, which is what src/engine/brain.ts's toTurns has always
      // built) is untouched and keeps working.
      images, caption, docs } = req.body || {};
    if (!system || !Array.isArray(messages) || !messages.length) {
      return res.status(400).json({ error: "system + messages required" });
    }
    // Validated to the same shape api/_trace.js accepts; anything else is
    // dropped rather than stored, so a malformed id cannot become a turn.
    trace.turn_id = /^[A-Za-z0-9_-]{8,64}$/.test(String(turn_id || "")) ? String(turn_id) : null;
    trace.lane = typeof lane === "string" ? lane.slice(0, 24) : null;
    // Prompt caching: the client sends the byte-stable persona core as
    // `system` and the per-turn volatile part as `system_tail`. The
    // cache_control breakpoint is honoured by the OPENROUTER lane (Anthropic-
    // style, where the ~85% figure below was measured) and is a measured
    // NO-OP on Google's endpoint (WS-COST 2026-08-25, n=4: identical cached
    // tokens with and without it). Google caches implicitly regardless, and
    // plateaus at ~61% of input tokens (8,165 of 13,400) no matter what the
    // request says; the deterministic path past that is explicit
    // cachedContents. See context/measurements.md#cache-plateau.
    //   (historic, OpenRouter lane: ~85% input-cost reduction, 5473/5477
    //   tokens cached, $0.0085 → ~$0.0012 per call.)
    // The cap is a payload guard, NOT a budget. It sat at 20000 while the
    // text core grew to ~29800, so for an unknown stretch every chat message
    // silently lost its last ~9800 characters — which is where the crisis
    // helplines, the never-deny-being-an-AI rule, the banned-phrase list and
    // the [search:]/[followup:] protocols all live. She could not look
    // anything up because she was never told the protocol existed, and she
    // had no helpline to give someone who needed one. Silent truncation of a
    // system prompt is the worst kind of bug: everything still "works".
    const sys = String(system);
    // WS-TRACE: the byte counts AS SENT, and whether the cap bit. A warn line
    // in a serverless log is not an observation — nothing queries it, nobody
    // reads it, and it is the exact shape of `startup-failure-is-invisible`.
    // These two booleans are the same fact, in a table, joined to the turn.
    trace.core_bytes_sent = sys.length;
    trace.core_truncated = sys.length > SYSTEM_MAX;
    if (sys.length > SYSTEM_MAX) {
      // never silent again — a prompt that outgrows the cap must be visible
      console.warn(`[chat] system prompt truncated: ${sys.length} > ${SYSTEM_MAX}`);
    }
    // THE CORE AS SENT — after the cap, before anything else. WS-COST C keys
    // the explicit cache on the SHA-256 of exactly these bytes, so the hash has
    // to be taken from the same string the upstream sees; hashing `sys` before
    // the slice would mean a truncated prompt and a cache built from it
    // disagreeing about what is in the cache.
    const coreSent = sys.slice(0, SYSTEM_MAX);
    const systemContent = [
      {
        type: "text",
        text: coreSent,
        cache_control: { type: "ephemeral" },
      },
    ];
    // The tail is the uncached half, so it is kept bounded — but the bound has
    // to clear the real worst case, not the common one. A watch-mode turn
    // carries the persona tail + her carried feeling + graph recall + her own
    // life ledger + what she owes + the ~3.5k watch block (screen discretion
    // and the honest answer about what is retained): measured ~11k. At 8000
    // that was silently cut from the END, which is where the newest and most
    // safety-relevant text sits. Same failure shape as the system-prompt
    // truncation that once dropped the crisis helplines — so: raise it, and
    // make any future overflow loud instead of silent.
    // Raised 14_000 -> 24_000 after scripts/check-prompt-budget.mjs measured the
    // real worst case for the first time: a live watch turn assembles ~10.4k of
    // static blocks and the dynamic blocks are bounded, by the code that builds
    // them, at ~11.4k (12 recall lines — 8 matched + 4 background — each with a
    // 160-char summary cap, 12 herLife items, her carried feeling and wants).
    // That is ~21.8k against a 14k cap. Worse, brain.ts appends SEARCH_DECISION
    // LAST on the chat lane, so the first casualty of the overflow is her ability
    // to look anything up — the exact failure that the system-prompt truncation
    // caused before, reappearing one field over. The tail is the uncached half,
    // but a ceiling costs nothing when the content isn't there: the typical tail
    // measures ~11k and is unaffected.
    //
    // OPERATIONAL TAIL CAP — mirrors src/engine/compiler.ts's
    // OPERATIONAL_TAIL_CAP (same reasoning as SYSTEM_MAX above: it happens
    // to equal the SPEC's target TAIL_CAP already, but is tracked separately
    // and asserted equal by scripts/check-prompt-budget.mjs rather than
    // assumed, since the two numbers matching today is not a guarantee they
    // stay in sync tomorrow).
    const TAIL_MAX = 24_000;
    trace.tail_bytes_sent = typeof system_tail === "string" ? system_tail.length : 0;
    trace.tail_truncated = trace.tail_bytes_sent > TAIL_MAX;
    let tailSent = "";
    if (typeof system_tail === "string" && system_tail) {
      if (system_tail.length > TAIL_MAX) {
        console.warn(`[chat] system_tail truncated: ${system_tail.length} > ${TAIL_MAX}`);
      }
      tailSent = system_tail.slice(0, TAIL_MAX);
      systemContent.push({ type: "text", text: tailSent });
    }
    // payload cap: recent user photos legitimately ride as data URLs when a
    // storage upload failed, but the total request must stay bounded —
    // vision-model cost per call is real money
    if (JSON.stringify(messages).length > MAX_MESSAGES_CHARS) {
      return res.status(413).json({ error: "payload too large" });
    }

    // ── the attachment set, validated server-side ─────────────────────────
    // Count, per-image bytes and total bytes are all decided here. A client is
    // a phone the owner can reinstall; a cap that only exists in the composer
    // is a cap that does not exist. `gate0-structural` generalised: if a
    // property is decidable from the bytes, decide it on the bytes.
    const imgs = normalizeImages(images);
    if (!imgs.ok) return res.status(imgs.status).json({ error: imgs.error });
    const documents = normalizeDocs(docs);
    if (!documents.ok) return res.status(documents.status).json({ error: documents.error });
    const cap = typeof caption === "string" ? caption.slice(0, 2_000) : "";
    // ONE turn, not five. A person shown five photos at once reacts to the SET;
    // five turns produce five separate reactions, which is the tell.
    const turns = attachToLastTurn(messages, {
      caption: cap,
      urls: imgs.urls,
      docBlocks: documents.blocks,
    });
    // Documents ride in the TURN, never in `system`/`system_tail`. The prompt
    // budget cuts the END of the prompt, which is where the newest and most
    // safety-relevant text sits, and it has cost this repo the crisis helplines
    // once already. Attachment text is something HE said, so it belongs in his
    // message and the budget is untouched by construction.
    trace.attach = {
      images: imgs.urls.length,
      images_max: MAX_IMAGES,
      caption_chars: cap.length,
      docs: documents.stats.n,
      docs_extracted: documents.stats.extracted,
      doc_chars: documents.stats.chars,
    };
    // WHAT COUNTS AS "this turn has pictures in it" — and it is not only the
    // new `images` field. The composer uploads first and the pictures reach the
    // model as `image_url` parts inside `messages` on the NEXT turn, via
    // brain.ts's `toTurns`. Deciding the lane order from the request field
    // alone would mean the owner's "Azure first for images" directive fired for
    // a fresh data-URL send and silently never fired for the ordinary flow,
    // which is the majority of picture turns. So the question asked is the
    // honest one: does the prompt going upstream contain an image at all?
    const hasAttachments =
      imgs.urls.length > 0 || documents.stats.n > 0 || countImages(turns) > 0;
    const wantStream = stream === true;
    // a stalled upstream (or vanished client) must never hold the function
    // open until the platform kills it
    const aborter = new AbortController();
    const kill = setTimeout(() => aborter.abort(), wantStream ? 120_000 : 60_000);
    req.on?.("close", () => aborter.abort());
    // one notch of planning for chat, the floor for calls — see the table below
    const effort = no_think === true ? "minimal" : "low";
    const body = {
      model: typeof model === "string" && ALLOWED_MODEL.test(model) ? model : DEFAULT_MODEL,
      messages: [{ role: "system", content: systemContent }, ...turns.slice(-120)],
      max_tokens: Number.isFinite(max_tokens) ? Math.min(800, Math.max(50, max_tokens)) : 800,
      ...(wantStream ? { stream: true } : {}),
    };
    // WS-TRACE: the request half. `model_requested` vs the DEFAULT_MODEL
    // fallback is a real branch — a caller that sends a slug ALLOWED_MODEL
    // rejects gets a different brain than it asked for, silently, today.
    trace.model = body.model;
    trace.model_requested = typeof model === "string" ? model.slice(0, 64) : null;
    trace.model_substituted = trace.model_requested !== null && trace.model_requested !== body.model;
    trace.effort = effort;
    trace.max_tokens = body.max_tokens;
    trace.stream = wantStream;
    trace.messages_n = turns.length;
    trace.images_n = countImages(turns);

    // ── free tier first ──────────────────────────────────────────────────
    // Google's OpenAI-compatible endpoint speaks the same request and the same
    // SSE our client already parses, so this is a swap of host and key rather
    // than a second code path to keep in sync.
    //
    // THE EFFORT TIER MUST MATCH THE LANE, and the failure is silent and total.
    // Measured with the real persona, n=5 per cell:
    //
    //   chat  + low      21.0 -> 22.8 words, 0 empty   <- correct
    //   chat  + minimal   2.2 words, 4 of 5 EMPTY      <- she says nothing
    //   call  + minimal  23.8 -> 22.8 words, 0 empty   <- correct
    //   call  + low       5.2 words, 4 of 5 EMPTY      <- she says nothing
    //
    // The tiers are INVERTED between the two lanes, so any fixed value is
    // catastrophic on one of them. The right rule is therefore the simplest
    // one: send exactly the effort this request already asked for. `no_think`
    // is the client saying "this is a call", which is the same signal the paid
    // lane uses below.
    //
    // At the matching tier the free lane is at parity or better: chat 2540ms
    // vs 2485ms, and calls 1324ms vs 1578ms — 254ms FASTER than paid.
    // The free lane is Google's own endpoint, so it only accepts Google models
    // and only by their bare name — the OpenRouter slug "google/gemini-3.6-flash"
    // 404s there. Anything else (a user's own model choice) skips the pool
    // entirely rather than being silently rewritten into something they did not
    // ask for.
    const freeModel = body.model.startsWith("google/") ? body.model.slice("google/".length) : null;
    let upstream = null;
    let servedBy = null;
    // WS-TRACE: the pool as a COUNT. No key, no key prefix, no hash of a key —
    // a hash of a secret is still a secret-shaped identifier and it carries no
    // diagnostic value the count does not. `free-pool-capacity` measured the
    // ceiling at ~75 calls/day; `one-key-two-jobs` is what happens when it runs
    // out mid-build. Both are answerable from these two numbers.
    trace.pool = { size: poolSize(), tried: 0, eligible: Boolean(freeModel) };

    // ── the ladder ────────────────────────────────────────────────────────
    // The order is a NAMED CONSTANT in api/_lanes.js, one for text and one for
    // attachments, because "Azure first for images and documents" is the
    // owner's preference and a preference written as an if-statement three
    // files deep is a preference nobody can find or reverse.
    //
    // WS-COST: `paidLane` is the ONLY thing that puts a billed Google key in
    // the ladder, and it is false unless the flag is set AND a key exists. The
    // model gate is the same one the free pool uses (`freeModel`): Google's own
    // endpoint takes bare model names, so a request asking for something that
    // is not a `google/...` slug skips this lane rather than being silently
    // rewritten into a model nobody asked for — and, here, rather than being
    // billed for one.
    const paidLane = paidLaneReady() && Boolean(freeModel);
    const order = laneOrder({ hasAttachments, paidLane });
    trace.lane_order = order.join(">");
    trace.azure = { configured: azureConfigured(), used: false };
    // Flag state as a BOOLEAN, never the key and never a prefix of it. This is
    // the field that answers "was that turn billed on purpose or by accident".
    // `cache` starts at "none" and is upgraded by the path that actually
    // served: "explicit" is set by the cachedContents path below, "implicit" is
    // inferred at emit time from the token counts Google returns. Three states,
    // one field, so a dashboard can price a turn without joining anything.
    trace.paid = { enabled: PAID_LANE_ON, eligible: paidLane, used: false, cache: "none" };

    /** Free Google pool, with the bounded transient ladder. */
    const runGeminiFree = async () => {
      if (!freeModel || poolSize() === 0) return null;
      const budget = newTransientBudget(Date.now(), TRANSIENT_DEADLINE_MS);
      const attempt = poolAttempt(
        async (gkey, ctx) => {
          trace.pool.tried++;
          // Every attempt AFTER the first is bounded by the ladder's deadline.
          // Without this the bound would be advisory: the two 502s in the
          // 2026-08-24 trace took 6.7s and 9.9s to come back, so a retry that
          // is only counted and not clocked can add twenty seconds of dead air.
          let signal = aborter.signal;
          if (!ctx.first && AbortSignal.any) {
            const left = Math.max(1, ctx.deadline - Date.now());
            signal = AbortSignal.any([aborter.signal, AbortSignal.timeout(left)]);
          }
          const r = await fetch(GEMINI_OPENAI_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${gkey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, model: freeModel, reasoning_effort: effort }),
            signal,
          });
          // A 200 carrying an EMPTY reply is the worst outcome available: she
          // simply says nothing, and every status code says it worked. It is
          // what a mismatched reasoning tier produces, and it is exactly the
          // failure that must never depend on my having picked the right one.
          // Streaming cannot be inspected without buffering (that would cost
          // her first-word latency, which is not for sale), so this guards the
          // non-streaming lane and the stream keeps its measured tier.
          if (await emptyOn200(r, wantStream)) {
            trace.empty_guard_fired = (trace.empty_guard_fired || 0) + 1;
            return { ok: false, status: r.status, empty: true };
          }
          return { ok: r.ok, status: r.status, value: r };
        },
        {
          budget,
          // WS-TRACE: counts and statuses ONLY. No key, no key prefix, no hash
          // — a hash of a secret is still a secret-shaped identifier and it
          // carries no diagnostic value the count does not.
          onAttempt: ({ status, outcome, sameKeyRetry, network }) => {
            if (outcome === "ok") return;
            trace.fallbacks.push({
              from: "gemini-free",
              to:
                outcome === "transient_retry"
                  ? "same-key"
                  : outcome === "deterministic" || outcome === "deadline"
                    ? "abort"
                    : "next-key",
              why:
                outcome === "deadline"
                  ? "deadline"
                  : network
                    ? "network"
                    : outcome === "quota"
                      ? "quota"
                      : outcome === "empty_200"
                        ? "empty_200"
                        : `http_${status}`,
              n: sameKeyRetry,
            });
          },
        },
      );
      const got = await withGeminiKey(attempt);
      // `retries` was flat 0 in the production trace because nothing ever
      // retried. It is now the count of extra attempts this ladder actually
      // spent, which is the number that says whether the fix is doing anything.
      trace.retries += budget.retries;
      trace.pool.transient_attempts = budget.attempts;
      trace.pool.deadline_ms = TRANSIENT_DEADLINE_MS;
      // RCA: WHICH account served this turn — the owner-label, never the key.
      // Pairs with pool.aborted / fallbacks so a day of meera_turn answers
      // "which key is carrying the load and which one dies at noon".
      if (got.label) trace.pool.served_label = got.label;
      if (got.value) return got.value;
      trace.pool.aborted = !got.triedAll;
      trace.fallbacks.push({
        from: "gemini-free",
        to: "next-lane",
        why: got.triedAll ? "pool_exhausted" : "pool_aborted",
      });
      return null;
    };

    /** WS-COST — the BILLED Google key, same host, same body, same SSE.
     *
     *  Deliberately NOT a second implementation of anything. It is
     *  `runGeminiFree`'s fetch with one key instead of a pool walk: same
     *  `GEMINI_OPENAI_URL`, same `{...body, model: freeModel, reasoning_effort}`
     *  (the tiers are INVERTED between chat and call and any fixed value is
     *  catastrophic on one of them — see the table above), same empty-200
     *  guard, and the streaming/usage handling below is the shared code every
     *  lane already returns into. There is no pool ladder here because there is
     *  no second key to walk to: one key, one attempt, fall through on failure.
     *
     *  It carries no retry of its own on purpose. A retry on a billed key is a
     *  second charge for the same turn, and OpenRouter and Azure are both still
     *  underneath it. */
    /** WS-COST C — the same billed key, with the CORE in an explicit
     *  `cachedContents` object and only the tail + turns billed at full rate.
     *
     *  MEASURED, not reasoned (measurements.md#cache-plateau, 2026-08-25): the
     *  core is 48,730 B ≈ 12,097 tokens = 90.0% of the input, it is byte-stable
     *  across a session, an explicit cache over it hit 12,097 tokens 4/4
     *  deterministically, and the per-turn bill including storage falls 79.2%.
     *  Google's free implicit cache plateaus at 60.7% no matter what the
     *  request says, which is where the other −33 points are.
     *
     *  THIS PATH CAN ONLY LOSE A TURN'S COST, NEVER A TURN. Every failure —
     *  create, PATCH, a name Google no longer knows, an unmappable message
     *  shape, an empty 200 — returns null, and `runGeminiPaid` below then makes
     *  the ordinary compat-surface paid call it has always made, inside the
     *  same turn. Under that sits the rest of the ladder, unchanged.
     *
     *  Returns a real `Response` (streaming or not) in OpenAI shape, so every
     *  line downstream of the ladder is untouched and the client cannot tell
     *  which surface answered. */
    const runGeminiPaidCached = async () => {
      if (!paidLane || !PAID_CACHE_ON) return null;
      // Pictures stay on the compat surface: native wants bytes inline or a
      // Files API URI and the ordinary photo flow sends https URLs. Attachment
      // turns go to Azure first anyway (the owner's directive).
      if (hasAttachments) return null;
      if (!cacheableCore(coreSent)) return null;
      const contents = toNativeContents(turns.slice(-120));
      if (!contents) return null;

      const hash = coreHash(coreSent);
      let entry = null;
      try {
        entry = await getCache({
          key: PAID_KEY,
          model: freeModel,
          core: coreSent,
          hash,
          signal: aborter.signal,
        });
      } catch {
        entry = null;
      }
      if (!entry) {
        trace.fallbacks.push({ from: "gemini-paid-cached", to: "gemini-paid", why: "cache_unavailable" });
        return null;
      }

      const url =
        `${GEMINI_NATIVE_BASE}/models/${freeModel}:` +
        (wantStream ? "streamGenerateContent?alt=sse" : "generateContent");
      // At most two attempts, and the second one exists for exactly ONE reason:
      // a name this instance believes in that Google has already collected. It
      // is not a retry of a billed generation — a not-found generates nothing
      // and bills nothing, so the law "no retry on a billed key" (see
      // `runGeminiPaid`) is not in tension with it. Anything else fails to the
      // plain paid call rather than being tried twice.
      for (let attempt = 0; attempt < 2; attempt++) {
        if (entry.reused) {
          // Extend only what a turn is actually reusing, and start the PATCH
          // BEFORE the generate so it resolves inside it — see refreshCache's
          // note on frozen serverless promises.
          refreshCache({ key: PAID_KEY, model: freeModel, hash, name: entry.name }).catch(() => {});
        }
        let r;
        try {
          r = await fetch(url, {
            method: "POST",
            headers: { "x-goog-api-key": PAID_KEY, "Content-Type": "application/json" },
            body: JSON.stringify(
              buildNativeBody({
                cacheName: entry.name,
                tail: tailSent,
                contents,
                maxTokens: body.max_tokens,
                // the SAME tier the compat lanes send. The tiers are inverted
                // between chat and calls and any fixed value is catastrophic on
                // one of them — see the table above `runGeminiFree`.
                effort,
              }),
            ),
            signal: aborter.signal,
          });
        } catch {
          trace.fallbacks.push({ from: "gemini-paid-cached", to: "gemini-paid", why: "network" });
          return null;
        }
        if (!r.ok) {
          const detail = await r.text().catch(() => "");
          const miss = isCacheMissStatus(r.status, detail);
          trace.fallbacks.push({
            from: "gemini-paid-cached",
            to: miss && attempt === 0 ? "cache-recreate" : "gemini-paid",
            why: miss ? "cache_missing" : `http_${r.status}`,
          });
          if (!miss || attempt > 0) return null;
          // The name is gone (expired, or made by an instance that has since
          // died). Forget it, build a new one, and try this turn once more.
          dropCache(freeModel, hash);
          try {
            entry = await getCache({
              key: PAID_KEY,
              model: freeModel,
              core: coreSent,
              hash,
              signal: aborter.signal,
            });
          } catch {
            entry = null;
          }
          if (!entry) return null;
          continue;
        }
        // ── the bridge back to OpenAI shape ──────────────────────────────
        let out;
        try {
          out = wantStream
            ? new Response(nativeSseToOpenAiStream(r.body, body.model), {
                status: 200,
                headers: { "Content-Type": "text/event-stream; charset=utf-8" },
              })
            : new Response(JSON.stringify(nativeJsonToOpenAI(await r.json(), body.model)), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              });
        } catch {
          trace.fallbacks.push({ from: "gemini-paid-cached", to: "gemini-paid", why: "bridge" });
          return null;
        }
        if (await emptyOn200(out, wantStream)) {
          trace.empty_guard_fired = (trace.empty_guard_fired || 0) + 1;
          trace.fallbacks.push({ from: "gemini-paid-cached", to: "gemini-paid", why: "empty_200" });
          return null;
        }
        // Counts, labels and one id. The cache NAME is a label — it says which
        // cache, and carries none of the text inside it (api/_obs.js's law).
        trace.paid.cache = "explicit";
        trace.paid.cache_id = cacheId(entry.name);
        trace.paid.cache_created = !entry.reused;
        trace.paid.cache_tokens = entry.tokens ?? null;
        trace.paid.cache_recreated = attempt > 0;
        return out;
      }
      return null;
    };

    const runGeminiPaid = async () => {
      if (!paidLane) return null;
      // The cached path first, and it returns null on every failure it can
      // have, so this is a fallback ladder inside one lane rather than a branch.
      const cached = await runGeminiPaidCached();
      if (cached) return cached;
      try {
        const r = await fetch(GEMINI_OPENAI_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${PAID_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, model: freeModel, reasoning_effort: effort }),
          signal: aborter.signal,
        });
        if (await emptyOn200(r, wantStream)) {
          trace.empty_guard_fired = (trace.empty_guard_fired || 0) + 1;
          trace.fallbacks.push({ from: "gemini-paid", to: "next-lane", why: "empty_200" });
          return null;
        }
        return r;
      } catch {
        trace.fallbacks.push({ from: "gemini-paid", to: "next-lane", why: "network" });
        return null;
      }
    };

    /** Paid OpenRouter. Unchanged request shape. */
    const runOpenRouter = async () => {
      if (!key) return null;
      try {
        return await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
            "X-Title": "Meera",
          },
          body: JSON.stringify({
            ...body,
            // Bounded hidden thinking. Default (unbounded) reasoning grows with
            // context, eats the max_tokens budget, and truncates/leaks — but the
            // "minimal" floor costs conversational coherence (non-sequiturs,
            // context-free media sends). So: calls (no_think, latency-critical)
            // stay at the floor; chat gets one notch of planning ("low"), still
            // bounded far below the 700-token reply budget.
            reasoning: { effort },
          }),
          signal: aborter.signal,
        });
      } catch {
        trace.fallbacks.push({ from: "openrouter", to: "next-lane", why: "network" });
        return null;
      }
    };

    /** The grant lane. $0 cash; no-ops cleanly when unconfigured. */
    const runAzure = async () => {
      if (!azureConfigured()) return null;
      const r = await azureChat(body, {
        signal: aborter.signal,
        vision: hasAttachments,
        timeoutMs: wantStream ? 90_000 : 30_000,
      });
      if (!r) {
        trace.fallbacks.push({ from: "azure", to: "next-lane", why: "network" });
        return null;
      }
      trace.azure.used = true;
      trace.azure.deployment = hasAttachments ? AZURE_VISION_DEPLOYMENT : AZURE_CHAT_DEPLOYMENT;
      return r;
    };

    const runners = {
      "gemini-free": runGeminiFree,
      "gemini-paid": runGeminiPaid,
      openrouter: runOpenRouter,
      azure: runAzure,
    };
    for (const name of order) {
      const r = await runners[name]();
      if (!r) continue;
      if (!r.ok) {
        // A lane that answered with a failure is still a lane that failed. Fall
        // to the next one instead of ending the turn — the whole defect this
        // workstream exists for was one upstream error ending a turn while
        // other lanes sat untried. Only the LAST lane's status reaches the user.
        trace.fallbacks.push({ from: name, to: "next-lane", why: `http_${r.status}` });
        trace.upstream_status = r.status;
        continue;
      }
      upstream = r;
      servedBy = name;
      break;
    }
    if (!upstream) {
      clearTimeout(kill);
      trace.served_by = "none";
      trace.error = trace.upstream_status ? `upstream_${trace.upstream_status}` : "all_lanes_down";
      return res
        .status(502)
        .json({ error: "upstream " + (trace.upstream_status ?? "unavailable"), trace: seal(trace, tStart) });
    }
    trace.served_by = servedBy;
    trace.upstream_status = upstream.status;
    if (servedBy === "gemini-paid") trace.paid.used = true;
    // Belt and braces: the ladder above only ever assigns an `ok` response, so
    // this cannot fire today. It is kept because "the loop always assigns an ok
    // response" is a property of the loop, and the next edit to the loop is the
    // one that would break it silently.
    if (!upstream.ok) {
      clearTimeout(kill);
      trace.error = `upstream_${upstream.status}`;
      return res.status(502).json({ error: "upstream " + upstream.status, trace: seal(trace, tStart) });
    }
    if (wantStream) {
      // pipe the served lane's SSE straight through — the client parses deltas
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      const reader = upstream.body.getReader();
      // WS-TRACE: the usage frame. OpenAI-compatible SSE carries `usage` on the
      // LAST data frame (or on a trailing frame with an empty `choices` array),
      // and it is the only place a streamed turn's token counts and cache hits
      // exist at all. Sniffed off the bytes already flowing past — the stream is
      // never buffered, never delayed, and a parse failure costs the counts and
      // nothing else.
      let tail = "";
      let bytes = 0;
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(Buffer.from(value));
          bytes += value.length;
          tail = (tail + Buffer.from(value).toString("utf8")).slice(-4000);
        }
      } catch {
        /* client or upstream dropped — end what we have */
      } finally {
        clearTimeout(kill);
        reader.cancel().catch(() => {}); // stop upstream generation billing
      }
      readUsage(tail, trace);
      emitPaidTurn(servedBy, trace, tStart);
      trace.stream_bytes = bytes;
      // One extra SSE frame, AFTER the stream the client was reading. Its
      // payload has no `choices`, so every SSE consumer in this repo skips it:
      // brain.ts's parser reads `choices[0].delta.content` and gets undefined.
      // It is therefore additive for a reader that does not know about it, and
      // the whole model leg for one that does.
      try {
        res.write(`data: ${JSON.stringify({ meera_trace: seal(trace, tStart) })}\n\n`);
      } catch {
        /* the client already went away — the leg is the least of it */
      }
      return res.end();
    }
    const data = await upstream.json();
    clearTimeout(kill);
    const text = data?.choices?.[0]?.message?.content ?? "";
    readUsageObject(data?.usage, trace);
    emitPaidTurn(servedBy, trace, tStart);
    trace.finish_reason = String(data?.choices?.[0]?.finish_reason ?? "").slice(0, 24) || null;
    trace.out_chars = text.length;
    trace.empty_reply = !text.trim();
    return res.status(200).json({ text, trace: seal(trace, tStart) });
  } catch (e) {
    return res.status(500).json({ error: "proxy failure" });
  }
}

/** WS-COST B2 — one ops row per BILLED turn: `paid_turn {cached, input,
 *  output}`.
 *
 *  It exists because the cache-hit rate is the whole cost story and it is the
 *  one number that cannot be reasoned about from here. Measured 2026-08-25 on
 *  the paid key, n=31 calls: an implicit-cache hit caches 8,165 of ~13,400
 *  input tokens (60.7%) and 16 of 19 follow-up calls hit — but both of those
 *  are Google's numbers, not ours, and they can move under us without any
 *  deploy on our side. A dashboard that reads these rows is how we would find
 *  out; arithmetic in a report is not.
 *
 *  COUNTS ONLY. No prompt text, no reply text, no key, no key prefix — the
 *  same law api/_obs.js states and api/diag.js states one layer up. `null`
 *  when the upstream sent no usage frame, which is itself the signal that the
 *  counts are missing rather than zero.
 *
 *  Fire-and-forget: `obsBestEffort` per _obs.js's own contract for callers on
 *  a response path — "a lost ops row is priced in; a slowed reply is not." */
function emitPaidTurn(servedBy, trace, tStart) {
  if (servedBy !== "gemini-paid") return;
  // WS-COST C: WHICH cache paid for this turn, as a label, next to the counts
  // that price it. The three states are not interchangeable and the difference
  // between them is the whole workstream: "explicit" is the deterministic
  // 12,097-token hit this path builds, "implicit" is Google's free 60.7%
  // plateau, "none" is full rate. Realized savings is then arithmetic on rows
  // — `cached/input` per label — rather than a claim in a report.
  const cache = paidCacheLabel(trace);
  if (trace.paid) trace.paid.cache = cache;
  obsBestEffort(
    "paid_turn",
    {
      cache,
      // the cache's NAME id, never its contents — it says which cache, and a
      // dashboard needs it to tell one user's cache from another's
      cache_id: trace.paid?.cache_id ?? null,
      cached: trace.tokens_cached,
      input: trace.tokens_in,
      output: trace.tokens_out,
      model: trace.model,
      lane: trace.lane,
      stream: trace.stream,
    },
    Date.now() - tStart,
  );
}

/** "explicit" only if the cachedContents path actually served this turn;
 *  otherwise whatever Google's implicit cache did, read off the counts. A turn
 *  with no usage frame reports "none" and `cached: null` — the null is the
 *  signal that the counts are missing rather than zero. */
export function paidCacheLabel(trace) {
  if (trace?.paid?.cache === "explicit") return "explicit";
  return Number(trace?.tokens_cached) > 0 ? "implicit" : "none";
}

/** A 200 carrying an EMPTY reply is the worst outcome available: she simply
 *  says nothing, and every status code says it worked. It is what a mismatched
 *  reasoning tier produces. Streaming cannot be inspected without buffering
 *  (that would cost her first-word latency, which is not for sale), so this
 *  answers `false` for a stream and the stream keeps its measured tier.
 *
 *  Extracted from `runGeminiFree` rather than copied into the paid lane: the
 *  two lanes speak to the same endpoint with the same body, so a guard that
 *  existed in only one of them would be a guard that silently stops covering
 *  half the traffic the first time the flag is turned on. */
async function emptyOn200(r, wantStream) {
  if (!r.ok || wantStream) return false;
  try {
    return !(JSON.parse(await r.clone().text())?.choices?.[0]?.message?.content || "").trim();
  } catch {
    return true;
  }
}

/** How many multimodal image parts this request carries. A watch turn that
 *  reports zero images is `visiongate-interim`'s `had_frame:false` one layer
 *  up — a fabrication risk that is invisible without the count. */
function countImages(messages) {
  let n = 0;
  for (const m of messages) {
    if (!Array.isArray(m?.content)) continue;
    for (const p of m.content) if (p?.type === "image_url") n++;
  }
  return n;
}

/** Token counts from an OpenAI-compatible `usage` object. `cache-9x` says the
 *  prompt cache makes a turn 9.2x cheaper; `tokens_cached` is the only field
 *  that can say whether it actually hit on any given turn. */
function readUsageObject(u, trace) {
  if (!u || typeof u !== "object") return;
  const cached =
    u.prompt_tokens_details?.cached_tokens ?? u.cached_tokens ?? u.cache_read_input_tokens ?? null;
  trace.tokens_in = Number.isFinite(u.prompt_tokens) ? u.prompt_tokens : null;
  trace.tokens_out = Number.isFinite(u.completion_tokens) ? u.completion_tokens : null;
  trace.tokens_cached = Number.isFinite(cached) ? cached : null;
  const reasoning = u.completion_tokens_details?.reasoning_tokens;
  if (Number.isFinite(reasoning)) trace.tokens_reasoning = reasoning;
}

/** Same, dug out of the trailing SSE frames of a streamed response. */
function readUsage(tail, trace) {
  try {
    const lines = tail.split("\n").filter((l) => l.startsWith("data: "));
    for (let i = lines.length - 1; i >= 0; i--) {
      const payload = lines[i].slice(6).trim();
      if (!payload || payload === "[DONE]") continue;
      const j = JSON.parse(payload);
      if (j?.usage) {
        readUsageObject(j.usage, trace);
        return;
      }
    }
  } catch {
    /* a partial frame at the 4000-char boundary — the counts are optional */
  }
}

/** Stamp the wall time and drop anything that is not a trace-shaped value.
 *  api/_trace.js sanitises again on the way in; this is the near end of the
 *  same rule, so a bug here cannot put content on the wire in the first place. */
function seal(trace, tStart) {
  trace.ms = Date.now() - tStart;
  return trace;
}
