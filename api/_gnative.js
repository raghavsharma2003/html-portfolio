// ── WS-COST Phase C: the OpenAI-shape ⇄ Google-native bridge ───────────────
//
// `cachedContents` is not on Google's OpenAI-compatible endpoint. It exists
// only on the native `generateContent` / `streamGenerateContent` surface. So a
// paid turn that wants the measured −79% has to speak native — and everything
// on either side of api/chat.js's ladder speaks OpenAI shape: the request the
// client builds, the empty-200 guard, the usage reader, the SSE the browser
// parses (`choices[0].delta.content`, src/engine/brain.ts:1149).
//
// THE BRIDGE IS THEREFORE TWO-WAY AND ENDS AT A `Response`. Every function
// here maps native → OpenAI shape, and the caller hands back a real `Response`
// object, so the whole downstream half of api/chat.js — the empty-200 guard,
// the stream pipe, the usage sniff, the trace frame — runs UNCHANGED and the
// client cannot tell which surface answered. That is the point: one wire
// format, one streaming path, one place where the reply is written.
//
// WE SHIP REAL STREAMING, not a synthesized single chunk. The fallback was
// allowed but it would have cost her first-word latency on every cached turn,
// and latency is the one thing this repo never trades. `streamGenerateContent`
// with `?alt=sse` emits the same frame-per-token cadence the compat endpoint
// does; the translation below is a per-frame `JSON.parse` and re-emit, and
// nothing is ever buffered.
//
// THINKING IS OFF, EXPLICITLY, AND THE TIER STILL COMES FROM THE REQUEST.
// Measured 2026-08-25: `reasoning_effort:"low"` on the compat surface bills
// ZERO hidden thinking tokens (4/4), while the NATIVE surface with no thinking
// config billed ~190 per call — ~7× the whole output bill at a 26-token reply,
// which is most of what the cache saves.
//
// The native spelling is `generationConfig.thinkingConfig.thinkingLevel`, and
// it is NOT `thinkingBudget`: measured live against gemini-3.6-flash on
// 2026-08-25, `{thinkingBudget: 0}` is rejected outright (400, "Request
// contains an invalid argument") — a config error that, because it fails the
// whole call, is indistinguishable from an outage from the outside. The tier
// table, same probe, one call each on a warm explicit cache:
//
//   thinkingLevel  minimal   200, 0 thinking tokens, non-empty
//   thinkingLevel  low       200, 0 thinking tokens, non-empty
//   thinkingLevel  medium    200, 188 thinking tokens
//   thinkingLevel  high      200, 188 thinking tokens
//   thinkingLevel  off/none  400 — the field has no "disabled" value
//   (no thinkingConfig at all)  200, 193 thinking tokens
//
// So the request's OWN effort is passed straight through, exactly as the compat
// lanes do. api/chat.js's table is unambiguous that the tiers are INVERTED
// between chat ("low") and calls ("minimal") and that any fixed value is
// catastrophic on one of them — she simply says nothing — and the two tiers
// this file can be asked for both bill zero thinking, so there is nothing to
// trade here and no reason to substitute a tier nobody asked for.

/** The thinking tiers this surface accepts and that bill ZERO hidden thinking
 *  tokens — measured, see the header. api/chat.js only ever asks for these two. */
const NATIVE_TIERS = new Set(["minimal", "low"]);

/** Native finish reasons → the OpenAI names every consumer here already reads. */
const FINISH = {
  STOP: "stop",
  MAX_TOKENS: "length",
  SAFETY: "content_filter",
  RECITATION: "content_filter",
  PROHIBITED_CONTENT: "content_filter",
  BLOCKLIST: "content_filter",
};

/** OpenAI `messages` → native `contents`.
 *
 *  Returns null rather than guessing. A shape this function does not
 *  understand must send the turn down the compat lane instead of quietly
 *  dropping part of what he said — `vision-fab`'s read-part-assert-the-rest is
 *  a mistake this repo has already paid for once. */
export function toNativeContents(messages) {
  if (!Array.isArray(messages) || !messages.length) return null;
  const contents = [];
  for (const m of messages) {
    if (!m || typeof m !== "object") return null;
    // Only user/assistant reach here: api/chat.js builds the system half
    // separately and it rides in the CACHE, not in contents.
    if (m.role !== "user" && m.role !== "assistant") return null;
    const role = m.role === "assistant" ? "model" : "user";
    const parts = [];
    const c = m.content;
    if (typeof c === "string") {
      if (c) parts.push({ text: c });
    } else if (Array.isArray(c)) {
      for (const p of c) {
        if (p?.type === "text") {
          if (typeof p.text === "string" && p.text) parts.push({ text: p.text });
        } else if (p?.type === "image_url") {
          // Native takes bytes inline or a Files API URI — it will not fetch an
          // arbitrary https URL, and the ordinary photo flow sends exactly
          // those. So a remote image is a hard "not this lane".
          const url = String(p?.image_url?.url || "");
          const m2 = /^data:([^;,]+);base64,([\s\S]+)$/.exec(url);
          if (!m2) return null;
          parts.push({ inlineData: { mimeType: m2[1], data: m2[2] } });
        } else {
          return null;
        }
      }
    } else {
      return null;
    }
    if (parts.length) contents.push({ role, parts });
  }
  return contents.length ? contents : null;
}

/** The generate body for a cached turn.
 *
 *  WHERE THE TAIL GOES, and why it is not a second system block. With
 *  `cachedContent` set, Google rejects a request that also carries
 *  `systemInstruction` — the cache owns the system half. The volatile tail
 *  therefore has to ride inside `contents`, and it goes FIRST, immediately
 *  after the cached core and before the history, so the assembled order the
 *  compiler intends (core → tail → turns) is preserved exactly. What changes is
 *  the ROLE LABEL on the tail (system → user), which is the one thing this
 *  bridge cannot make identical.
 *
 *  That is an unmeasured difference and it is stated here as one: nothing in
 *  `context/` prices a tail delivered as a leading user content, and the thing
 *  that would settle it is a paired dual-judge equivalence run of the kind
 *  SPEC §0.3 already requires for persona cuts. It is not synthesized as a fake
 *  `model` acknowledgement — inventing a line she never said, to sit in her own
 *  history, is `recited-prompt`'s failure with the model removed. */
export function buildNativeBody({ cacheName, tail, contents, maxTokens, effort }) {
  const body = {
    contents: [...(tail ? [{ role: "user", parts: [{ text: tail }] }] : []), ...contents],
    generationConfig: {
      ...(Number.isFinite(maxTokens) ? { maxOutputTokens: maxTokens } : {}),
      // see the header: ~190 hidden thinking tokens per call without it, and a
      // 400 for the `thinkingBudget` spelling. An effort this surface does not
      // accept falls to "low", which is the chat tier and the safe half of the
      // inversion — never to a silently different tier.
      thinkingConfig: { thinkingLevel: NATIVE_TIERS.has(effort) ? effort : "low" },
    },
  };
  if (cacheName) body.cachedContent = cacheName;
  return body;
}

/** Native `usageMetadata` → an OpenAI `usage` object, so api/chat.js's existing
 *  `readUsageObject` fills `tokens_in/out/cached/reasoning` with no change.
 *  `cachedContentTokenCount` is THE number this workstream exists to move. */
export function nativeUsageToOpenAI(um) {
  if (!um || typeof um !== "object") return null;
  const n = (v) => (Number.isFinite(v) ? v : undefined);
  const usage = {
    prompt_tokens: n(um.promptTokenCount) ?? null,
    completion_tokens: n(um.candidatesTokenCount) ?? null,
    total_tokens: n(um.totalTokenCount) ?? null,
  };
  if (Number.isFinite(um.cachedContentTokenCount)) {
    usage.prompt_tokens_details = { cached_tokens: um.cachedContentTokenCount };
  }
  if (Number.isFinite(um.thoughtsTokenCount)) {
    usage.completion_tokens_details = { reasoning_tokens: um.thoughtsTokenCount };
  }
  return usage;
}

function partsText(parts) {
  if (!Array.isArray(parts)) return "";
  let out = "";
  for (const p of parts) if (typeof p?.text === "string") out += p.text;
  return out;
}

/** A native `generateContent` body → the OpenAI chat-completion object the
 *  non-streaming half of api/chat.js already reads. */
export function nativeJsonToOpenAI(j, model) {
  const cand = j?.candidates?.[0];
  return {
    id: "meera-native",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: partsText(cand?.content?.parts) },
        finish_reason: FINISH[cand?.finishReason] ?? (cand?.finishReason ? "stop" : null),
      },
    ],
    ...(nativeUsageToOpenAI(j?.usageMetadata) ? { usage: nativeUsageToOpenAI(j.usageMetadata) } : {}),
  };
}

/** Native SSE (`?alt=sse`) → OpenAI-shaped SSE, frame by frame, nothing buffered.
 *
 *  The trailing usage frame is emitted with an EMPTY `choices` array, which is
 *  the same shape the compat endpoint sends and which every SSE consumer in
 *  this repo already skips (brain.ts reads `choices[0].delta.content` and gets
 *  undefined). api/chat.js's `readUsage` sniffs it off the last 4000 bytes. */
export function nativeSseToOpenAiStream(body, model) {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  let buf = "";
  let usage = null;
  const frame = (o) => enc.encode(`data: ${JSON.stringify(o)}\n\n`);
  const chunk = (delta, finish = null) => ({
    id: "meera-native",
    object: "chat.completion.chunk",
    model,
    choices: [{ index: 0, delta, finish_reason: finish }],
  });
  return new ReadableStream({
    async pull(ctrl) {
      let got;
      try {
        got = await reader.read();
      } catch {
        // upstream dropped mid-stream: end what we have rather than throwing
        // into the response writer, which would abort the bytes already sent
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
        return;
      }
      if (got.done) {
        if (usage) {
          ctrl.enqueue(frame({ id: "meera-native", object: "chat.completion.chunk", model, choices: [], usage }));
        }
        ctrl.enqueue(enc.encode("data: [DONE]\n\n"));
        ctrl.close();
        return;
      }
      buf += dec.decode(got.value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        let j;
        try {
          j = JSON.parse(payload);
        } catch {
          continue; // a keep-alive or a frame split across reads
        }
        if (j?.usageMetadata) usage = nativeUsageToOpenAI(j.usageMetadata) ?? usage;
        const cand = j?.candidates?.[0];
        const text = partsText(cand?.content?.parts);
        if (text) ctrl.enqueue(frame(chunk({ content: text })));
        const fin = FINISH[cand?.finishReason];
        if (fin) ctrl.enqueue(frame(chunk({}, fin)));
      }
    },
    cancel(reason) {
      // api/chat.js cancels the reader in its finally to stop upstream
      // generation billing. That has to reach the REAL upstream, not just this
      // wrapper, or the cost of a dropped client is a full generation.
      reader.cancel(reason).catch(() => {});
    },
  });
}
