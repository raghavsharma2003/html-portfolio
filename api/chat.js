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
const SYSTEM_MAX = 64_000;
// Google's OpenAI-compatible surface: same request shape, same SSE stream.
const GEMINI_OPENAI_URL = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions";

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
    // `system` and the per-turn volatile part as `system_tail`. A
    // cache_control breakpoint after the core makes Google serve it from
    // cache — measured ~85% input-cost reduction (5473/5477 tokens cached,
    // $0.0085 → ~$0.0012 per call in testing).
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
    const systemContent = [
      {
        type: "text",
        text: sys.slice(0, SYSTEM_MAX),
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
    if (typeof system_tail === "string" && system_tail) {
      if (system_tail.length > TAIL_MAX) {
        console.warn(`[chat] system_tail truncated: ${system_tail.length} > ${TAIL_MAX}`);
      }
      systemContent.push({ type: "text", text: system_tail.slice(0, TAIL_MAX) });
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
    const order = laneOrder({ hasAttachments });
    trace.lane_order = order.join(">");
    trace.azure = { configured: azureConfigured(), used: false };

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
          if (r.ok && !wantStream) {
            const text = await r.clone().text();
            let empty = false;
            try {
              empty = !(JSON.parse(text)?.choices?.[0]?.message?.content || "").trim();
            } catch {
              empty = true;
            }
            if (empty) {
              trace.empty_guard_fired = (trace.empty_guard_fired || 0) + 1;
              return { ok: false, status: r.status, empty: true };
            }
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
      if (got.value) return got.value;
      trace.pool.aborted = !got.triedAll;
      trace.fallbacks.push({
        from: "gemini-free",
        to: "next-lane",
        why: got.triedAll ? "pool_exhausted" : "pool_aborted",
      });
      return null;
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

    const runners = { "gemini-free": runGeminiFree, openrouter: runOpenRouter, azure: runAzure };
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
    trace.finish_reason = String(data?.choices?.[0]?.finish_reason ?? "").slice(0, 24) || null;
    trace.out_chars = text.length;
    trace.empty_reply = !text.trim();
    return res.status(200).json({ text, trace: seal(trace, tStart) });
  } catch (e) {
    return res.status(500).json({ error: "proxy failure" });
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
