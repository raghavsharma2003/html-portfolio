// ── WS-COST C: the explicit-cache path and its fallback ladder ────────────
//
// A SUB-BATTERY WITH ITS OWN PROCESS, and that is the point rather than an
// inconvenience. api/chat.js reads PAID_LANE, GEMINI_PAID_KEY and PAID_CACHE at
// MODULE LOAD — that is what makes "off by default" a property of the deploy
// instead of a branch someone can reach — so the only honest way to gate the
// lane's ON behaviour is a process where it was on before the module was
// imported. The parent battery keeps its own process with the lane OFF, which
// is what lets it assert that today's default behaviour is byte-identical: no
// cachedContents object, no native URL, no second surface, at all.
//
// WHAT IT GATES. The cost path can only ever lose a turn's COST, never a turn:
//   - cold instance → create, generate with the cache, serve
//   - warm instance → REUSE (no second create), TTL extended once, not per turn
//   - a name Google no longer knows → re-create inside the same turn and serve
//   - re-create also fails → the plain paid compat call serves
//   - cache create fails → the plain paid compat call serves, native never dialled
//   - a real upstream error → plain paid, one native attempt only
//   - the whole paid lane dead → the pre-existing ladder underneath, unchanged
//   - streaming → the client sees the SAME OpenAI-shaped wire format
//
// Offline, deterministic, no network, no model call, no database, $0.
// Every key here is a fake string and `globalThis.fetch` is replaced before
// anything dials.

import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CACHE_OFF = process.argv.includes("--cache-off");

// ── the roster, pinned BEFORE any import binds it (same law as the parent) ──
process.env.PAID_LANE = "1";
process.env.GEMINI_PAID_KEY = "battery-paid-key-not-a-real-key-0000";
process.env.PAID_CACHE = CACHE_OFF ? "0" : "1";
process.env.GOOGLE_KEYS = Array.from(
  { length: 9 },
  (_, i) => `battery-pool-key-${i}-000000000000`,
).join(",");
process.env.OPENROUTER_API_KEY = "battery-openrouter-not-a-real-key";
process.env.AZURE_ENDPOINT = "https://resilience-battery.invalid/openai/v1";
process.env.AZURE_API_KEY = "battery-not-a-real-key-0000000000";
process.env.AZURE_CHAT_DEPLOYMENT = "battery-chat";
process.env.AZURE_VISION_DEPLOYMENT = "battery-vision";
process.env.SUPABASE_URL = "https://resilience-battery-sb.invalid";
process.env.SUPABASE_KEY = "battery-supabase-not-a-real-key";

const chat = await import(pathToFileURL(join(ROOT, "api", "chat.js")).href);
const handler = chat.default;
const { resetCacheStore, cacheStoreSize, coreHash, CACHE_TTL_S, CACHE_TTL_MAX_MS, isCacheMissStatus } =
  await import(pathToFileURL(join(ROOT, "api", "_gcache.js")).href);
const { toNativeContents, buildNativeBody, nativeUsageToOpenAI, nativeJsonToOpenAI } = await import(
  pathToFileURL(join(ROOT, "api", "_gnative.js")).href
);

let pass = 0;
let fail = 0;
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (s) => console.log(`\n${s}`);

// ── the scripted upstream ─────────────────────────────────────────────────
// Routed by URL and, for the two Google surfaces that share a host, by which
// KEY is presented — the free pool's fake keys and the paid fake key are
// different strings, which is exactly the distinction production makes. No
// value is ever printed and nothing is ever dialled.
const POOL_MARK = "battery-pool-key";
const PAID_MARK = "battery-paid-key";

let seen = [];
const surfaceOf = (url, init) => {
  const u = String(url);
  const auth = String(init?.headers?.Authorization || "");
  const gkey = String(init?.headers?.["x-goog-api-key"] || "");
  if (u.includes("/cachedContents") && (init?.method || "GET") === "PATCH") return "cache-patch";
  if (u.endsWith("/cachedContents")) return "cache-create";
  if (/:streamGenerateContent/.test(u)) return "native-stream";
  if (/:generateContent/.test(u)) return "native";
  if (u.includes("/openai/chat/completions")) {
    if (auth.includes(POOL_MARK)) return "gemini-free";
    if (auth.includes(PAID_MARK) || gkey.includes(PAID_MARK)) return "gemini-paid";
    return "gemini-unknown";
  }
  if (u.includes("openrouter")) return "openrouter";
  if (u.includes("resilience-battery.invalid")) return "azure";
  return "?";
};

const realFetch = globalThis.fetch;
const install = (route) => {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    const surface = surfaceOf(u, init);
    const body = init?.body ? JSON.parse(init.body) : null;
    const r = (await route(surface, body, u, init)) ?? { status: 599 };
    seen.push({ surface, url: u, body, method: init?.method || "GET", status: r.status });
    if (r.throws) throw new Error("network");
    if (r.response) return r.response;
    return new Response(
      r.body ?? JSON.stringify(r.json ?? { choices: [{ message: { content: r.text ?? "" } }] }),
      { status: r.status, headers: { "Content-Type": "application/json" } },
    );
  };
};

// A native answer, in Google's real shape.
const CACHED_TOKENS = 12_097;
const nativeJson = (text, { cached = CACHED_TOKENS, out = 26, prompt = 13_400 } = {}) => ({
  status: 200,
  json: {
    candidates: [{ content: { parts: [{ text }], role: "model" }, finishReason: "STOP", index: 0 }],
    usageMetadata: {
      promptTokenCount: prompt,
      cachedContentTokenCount: cached,
      candidatesTokenCount: out,
      totalTokenCount: prompt + out,
    },
  },
});
const cacheCreated = (id, tokens = CACHED_TOKENS) => ({
  status: 200,
  json: {
    name: `cachedContents/${id}`,
    expireTime: new Date(Date.now() + CACHE_TTL_S * 1000).toISOString(),
    usageMetadata: { totalTokenCount: tokens },
  },
});
// Google's shape for a name that is gone.
const cacheGone = {
  status: 404,
  json: { error: { code: 404, status: "NOT_FOUND", message: "CachedContent not found (or permission denied)" } },
};

// ── the handler harness ───────────────────────────────────────────────────
const CORE = "MEERA CORE — the byte-stable half.\n" + "x".repeat(48_000);
const TAIL = "RIGHT NOW: 4:12pm, Thursday.\nSEARCH_DECISION: ...";
let ipN = 0;
const call = async (body, { stream = false } = {}) => {
  seen = [];
  const req = {
    method: "POST",
    headers: { "x-forwarded-for": `10.7.0.${++ipN}` },
    socket: { remoteAddress: `10.7.0.${ipN}` },
    body,
    on: () => {},
  };
  let status = 0;
  let json = null;
  const written = [];
  const res = {
    statusCode: 0,
    setHeader: () => {},
    status(s) {
      status = s;
      return this;
    },
    json(j) {
      json = j;
      return this;
    },
    write(chunk) {
      written.push(Buffer.from(chunk).toString("utf8"));
      return true;
    },
    end() {
      return this;
    },
  };
  await handler(req, res);
  const wire = written.join("");
  if (!status && res.statusCode) status = res.statusCode;
  // the streamed lane returns its trace on a trailing SSE frame
  if (!json && wire) {
    for (const line of wire.split("\n")) {
      if (!line.startsWith("data: ")) continue;
      try {
        const j = JSON.parse(line.slice(6));
        if (j?.meera_trace) json = { trace: j.meera_trace };
      } catch {
        /* not the trace frame */
      }
    }
  }
  return { status, json, wire, seen, stream };
};
const baseBody = {
  system: CORE,
  system_tail: TAIL,
  messages: [{ role: "user", content: "hello" }],
  model: "google/gemini-3.6-flash",
  max_tokens: 100,
};
const count = (s, surface) => s.filter((x) => x.surface === surface).length;

if (CACHE_OFF) {
  // ── the opt-out, in a process where it was off before the import ────────
  section("── WS-COST C: PAID_CACHE=0 puts the paid lane back on the plain call ──");
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "gemini-paid") return { status: 200, text: "haan bol" };
    return { status: 500 };
  });
  const { status, json, seen: s } = await call({ ...baseBody });
  ok("the turn is served", status === 200, `http ${status}`);
  ok("by the paid lane", json?.trace?.served_by === "gemini-paid", String(json?.trace?.served_by));
  ok("no cache object is ever created", count(s, "cache-create") === 0);
  ok("the native surface is never dialled", count(s, "native") + count(s, "native-stream") === 0);
  ok("and the paid compat call is the one that answered", count(s, "gemini-paid") === 1);
  ok("the label is not 'explicit'", json?.trace?.paid?.cache !== "explicit", String(json?.trace?.paid?.cache));
  globalThis.fetch = realFetch;
  console.log(`\nRESULT ${pass} passed, ${fail} failed`);
  process.exit(0);
}

// ══════════════════════════════════════════════════════════════════════════
section("── the pure bridge: OpenAI shape ⇄ native ──");
{
  const c = toNativeContents([
    { role: "user", content: "hi" },
    { role: "assistant", content: "arre" },
    { role: "user", content: [{ type: "text", text: "dekh" }] },
  ]);
  ok("roles map user→user and assistant→model", c?.map((x) => x.role).join(">") === "user>model>user", JSON.stringify(c?.map((x) => x.role)));
  ok("string content becomes one text part", c?.[0]?.parts?.[0]?.text === "hi");
  ok(
    "a REMOTE image is refused rather than dropped — native cannot fetch a URL",
    toNativeContents([{ role: "user", content: [{ type: "image_url", image_url: { url: "https://s/1.jpg" } }] }]) === null,
  );
  ok(
    "an inline data URL maps to inlineData",
    toNativeContents([{ role: "user", content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } }] }])?.[0]
      ?.parts?.[0]?.inlineData?.mimeType === "image/png",
  );
  ok("an unknown part type is refused, not guessed", toNativeContents([{ role: "user", content: [{ type: "video", v: 1 }] }]) === null);
  ok("a system role never reaches contents — it lives in the cache", toNativeContents([{ role: "system", content: "x" }]) === null);

  const nb = buildNativeBody({ cacheName: "cachedContents/c1", tail: "TAIL-TEXT", contents: c, maxTokens: 100, effort: "low" });
  ok(
    "the thinking tier is thinkingLevel, not thinkingBudget — the budget spelling is a 400 on this model",
    nb.generationConfig.thinkingConfig.thinkingLevel === "low" && !("thinkingBudget" in nb.generationConfig.thinkingConfig),
    JSON.stringify(nb.generationConfig.thinkingConfig),
  );
  ok(
    "the CALL tier rides through unchanged — the tiers are inverted between chat and calls",
    buildNativeBody({ contents: c, effort: "minimal" }).generationConfig.thinkingConfig.thinkingLevel === "minimal",
  );
  ok(
    "a tier this surface does not accept falls to 'low', never to a silently different one",
    buildNativeBody({ contents: c, effort: "high" }).generationConfig.thinkingConfig.thinkingLevel === "low" &&
      buildNativeBody({ contents: c }).generationConfig.thinkingConfig.thinkingLevel === "low",
  );
  ok("maxOutputTokens carries the request's budget", nb.generationConfig.maxOutputTokens === 100);
  ok("the cache is named on the request", nb.cachedContent === "cachedContents/c1");
  ok("systemInstruction is ABSENT — Google rejects it alongside cachedContent", !("systemInstruction" in nb));
  ok("the tail is FIRST, before the history (core → tail → turns is preserved)", nb.contents[0].parts[0].text === "TAIL-TEXT");
  ok("…and the history follows it in order", nb.contents.slice(1).map((x) => x.role).join(">") === "user>model>user");
  ok("no fake model turn is synthesized to carry the tail", nb.contents.filter((x) => x.role === "model").length === 1);

  const u = nativeUsageToOpenAI({ promptTokenCount: 13_400, cachedContentTokenCount: 12_097, candidatesTokenCount: 26, totalTokenCount: 13_426, thoughtsTokenCount: 0 });
  ok("cachedContentTokenCount becomes prompt_tokens_details.cached_tokens", u.prompt_tokens_details.cached_tokens === 12_097);
  ok("prompt/completion counts map straight across", u.prompt_tokens === 13_400 && u.completion_tokens === 26);
  const oa = nativeJsonToOpenAI(nativeJson("haan bol").json, "google/gemini-3.6-flash");
  ok("a native answer becomes an OpenAI chat completion", oa.choices[0].message.content === "haan bol" && oa.choices[0].finish_reason === "stop");

  ok("404 and 403 are both read as 'that name is gone'", isCacheMissStatus(404) && isCacheMissStatus(403));
  ok("a 400 naming the field is too", isCacheMissStatus(400, "CachedContent not found"));
  ok("a 500 is NOT a cache miss — it must not trigger a re-create loop", !isCacheMissStatus(500, "internal"));
  ok("the key is the SHA-256 of the exact core bytes", coreHash("abc") === "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  ok("one byte of persona drift is a different cache", coreHash(CORE) !== coreHash(CORE + " "));
  ok("the TTL ceiling is 15 minutes, as the fleet-cost note requires", CACHE_TTL_MAX_MS === 15 * 60 * 1000 && CACHE_TTL_S <= 900);
}

// ══════════════════════════════════════════════════════════════════════════
section("── a cold instance: create, serve, and REUSE ──");
{
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated("c1");
    if (surface === "cache-patch") return { status: 200, json: { name: "cachedContents/c1" } };
    if (surface === "native") return nativeJson("haan bol na");
    return { status: 500 };
  });

  const t1 = await call({ ...baseBody });
  ok("turn 1 is served", t1.status === 200, `http ${t1.status}`);
  ok("by the paid lane", t1.json?.trace?.served_by === "gemini-paid", String(t1.json?.trace?.served_by));
  ok("she actually says something", t1.json?.text === "haan bol na", JSON.stringify(t1.json?.text ?? "").slice(0, 40));
  ok("the cache was created exactly once", count(t1.seen, "cache-create") === 1);
  ok("the turn ran on the NATIVE surface", count(t1.seen, "native") === 1);
  ok("…and never on the paid compat surface", count(t1.seen, "gemini-paid") === 0);
  ok("the trace labels it explicit", t1.json?.trace?.paid?.cache === "explicit", String(t1.json?.trace?.paid?.cache));
  ok("with the cache's id, not its contents", t1.json?.trace?.paid?.cache_id === "c1", String(t1.json?.trace?.paid?.cache_id));
  ok("turn 1 is marked as the one that CREATED it", t1.json?.trace?.paid?.cache_created === true);
  ok("no TTL extension on the turn that created it", count(t1.seen, "cache-patch") === 0);
  ok(
    "the cached token count reaches the trace — the number the whole workstream moves",
    t1.json?.trace?.tokens_cached === CACHED_TOKENS,
    String(t1.json?.trace?.tokens_cached),
  );

  const created = t1.seen.find((x) => x.surface === "cache-create");
  ok("the cache holds the CORE as systemInstruction", created?.body?.systemInstruction?.parts?.[0]?.text === CORE);
  ok("…and NOT the volatile tail — it changes every turn", !JSON.stringify(created?.body ?? {}).includes("RIGHT NOW"));
  ok("…with a 10-minute TTL", created?.body?.ttl === "600s");
  ok("…bound to the model", created?.body?.model === "models/gemini-3.6-flash");

  const gen = t1.seen.find((x) => x.surface === "native");
  ok("the generate request names the cache", gen?.body?.cachedContent === "cachedContents/c1");
  ok("the 48KB core is NOT re-sent in the generate body — that is the whole saving", !JSON.stringify(gen?.body ?? {}).includes(CORE));
  ok("the tail IS sent, uncached, first", gen?.body?.contents?.[0]?.parts?.[0]?.text === TAIL);
  ok("the chat tier is on the wire, and it is the zero-thinking one", gen?.body?.generationConfig?.thinkingConfig?.thinkingLevel === "low");

  // turns 2..6 — a real session shape.
  let creates = 0;
  let patches = 0;
  for (let i = 2; i <= 6; i++) {
    const t = await call({
      ...baseBody,
      messages: [{ role: "user", content: `turn ${i}` }],
    });
    creates += count(t.seen, "cache-create");
    patches += count(t.seen, "cache-patch");
    if (i === 2) {
      ok("turn 2 REUSES the cache — no second create", count(t.seen, "cache-create") === 0);
      ok("…and says so", t.json?.trace?.paid?.cache_created === false);
      ok("…and extends the TTL, because a turn actually read it", count(t.seen, "cache-patch") === 1);
      const p = t.seen.find((x) => x.surface === "cache-patch");
      ok("the extension is a PATCH of ttl only", p?.method === "PATCH" && /updateMask=ttl/.test(p.url) && p.body?.ttl === "600s");
    }
    ok(`turn ${i} is served, explicit, on one native call`, t.status === 200 && t.json?.trace?.paid?.cache === "explicit" && count(t.seen, "native") === 1);
  }
  ok("turns 2–6 created ZERO further caches", creates === 0, `creates=${creates}`);
  ok(
    "and extended the TTL ONCE, not once per turn — a refresh per turn buys nothing",
    patches === 1,
    `patches=${patches}`,
  );
  ok("the instance map holds one entry for one core", cacheStoreSize() === 1, `size=${cacheStoreSize()}`);
}

// ══════════════════════════════════════════════════════════════════════════
section("── THE FALLBACK LADDER: a bad cacheName must never cost a turn ──");
{
  // (1) the name is gone → re-create inside the same turn and serve.
  resetCacheStore();
  let ids = 0;
  // c1 is healthy for the turn that creates it and is COLLECTED by Google
  // afterwards — the real shape of an expiry between two turns of one session.
  let collected = false;
  install((surface, body) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated(`c${++ids}`);
    if (surface === "cache-patch") return { status: 200, json: {} };
    if (surface === "native") {
      return collected && body?.cachedContent === "cachedContents/c1" ? cacheGone : nativeJson("dobara bol");
    }
    return { status: 500 };
  });
  const warm = await call({ ...baseBody }); // creates c1
  ok("(1) the first turn warmed the map", warm.json?.trace?.paid?.cache_id === "c1", String(warm.json?.trace?.paid?.cache_id));
  collected = true;
  // c1 is now stale from Google's point of view; the map still believes in it.
  const t = await call({ ...baseBody, messages: [{ role: "user", content: "again" }] });
  ok("(1) a stale cacheName still SERVES the turn", t.status === 200, `http ${t.status}`);
  ok("(1) …on the paid lane", t.json?.trace?.served_by === "gemini-paid");
  ok("(1) …by re-creating the cache once", count(t.seen, "cache-create") === 1 && t.json?.trace?.paid?.cache_id === "c2");
  ok("(1) …inside the same turn, on the second native attempt", count(t.seen, "native") === 2);
  ok("(1) …and it is still an explicit-cache turn", t.json?.trace?.paid?.cache === "explicit");
  ok("(1) the re-create is recorded", t.json?.trace?.paid?.cache_recreated === true);
  ok(
    "(1) the trace says WHY, with the cache leg named",
    (t.json?.trace?.fallbacks ?? []).some((f) => f.from === "gemini-paid-cached" && f.why === "cache_missing"),
    JSON.stringify(t.json?.trace?.fallbacks ?? []),
  );

  // (2) the name is gone AND every replacement is gone too → plain paid.
  resetCacheStore();
  ids = 0;
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated(`z${++ids}`);
    if (surface === "cache-patch") return { status: 200, json: {} };
    if (surface === "native") return cacheGone;
    if (surface === "gemini-paid") return { status: 200, text: "phir bhi bol" };
    return { status: 500 };
  });
  const t2 = await call({ ...baseBody });
  ok("(2) an unrecoverable cache still SERVES the turn", t2.status === 200, `http ${t2.status}`);
  ok("(2) on the plain paid compat call", count(t2.seen, "gemini-paid") === 1 && t2.json?.text === "phir bhi bol");
  ok("(2) after exactly two native attempts, then stop", count(t2.seen, "native") === 2);
  ok("(2) the turn is NOT labelled explicit", t2.json?.trace?.paid?.cache !== "explicit", String(t2.json?.trace?.paid?.cache));
  ok(
    "(2) the fallback is named, cached → plain paid",
    (t2.json?.trace?.fallbacks ?? []).some((f) => f.from === "gemini-paid-cached" && f.to === "gemini-paid"),
    JSON.stringify(t2.json?.trace?.fallbacks ?? []),
  );

  // (3) the cache API itself is down → plain paid, native never dialled.
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return { status: 503 };
    if (surface === "gemini-paid") return { status: 200, text: "bina cache ke" };
    return { status: 500 };
  });
  const t3 = await call({ ...baseBody });
  ok("(3) a caching outage costs the SAVING, not the turn", t3.status === 200 && t3.json?.text === "bina cache ke");
  ok("(3) the native surface is never dialled without a cache", count(t3.seen, "native") === 0);
  ok("(3) the plain paid call served", count(t3.seen, "gemini-paid") === 1);
  ok(
    "(3) and the reason is recorded",
    (t3.json?.trace?.fallbacks ?? []).some((f) => f.why === "cache_unavailable"),
    JSON.stringify(t3.json?.trace?.fallbacks ?? []),
  );

  // (4) a REAL upstream error on the native call is not a cache miss.
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated("c9");
    if (surface === "native") return { status: 500 };
    if (surface === "gemini-paid") return { status: 200, text: "theek h" };
    return { status: 500 };
  });
  const t4 = await call({ ...baseBody });
  ok("(4) a 500 on the native call falls to the plain paid call", t4.status === 200 && t4.json?.text === "theek h");
  ok("(4) …with ONE native attempt, not a re-create loop", count(t4.seen, "native") === 1);
  ok("(4) …and no second cache object", count(t4.seen, "cache-create") === 1);

  // (5) an EMPTY 200 from the cached path — the guard that already covers the
  //     compat lanes must cover this one too, or the flag's first day is silence.
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated("c8");
    if (surface === "native") return nativeJson("");
    if (surface === "gemini-paid") return { status: 200, text: "bol rahi hu" };
    return { status: 500 };
  });
  const t5 = await call({ ...baseBody });
  ok("(5) an empty 200 from the cached path does not become silence", t5.status === 200 && t5.json?.text === "bol rahi hu");
  ok("(5) the empty guard fired", (t5.json?.trace?.empty_guard_fired ?? 0) >= 1);

  // (6) the whole paid lane dead → the pre-existing ladder underneath, untouched.
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return { status: 500 };
    if (surface === "gemini-paid") return { status: 500 };
    if (surface === "openrouter") return { status: 200, text: "openrouter bol raha" };
    return { status: 500 };
  });
  const t6 = await call({ ...baseBody });
  ok("(6) both paid paths dead → the ladder below still serves", t6.status === 200 && t6.json?.trace?.served_by === "openrouter");
  ok("(6) the lane order is the paid one, in the documented sequence", t6.json?.trace?.lane_order === "gemini-free>gemini-paid>openrouter>azure", String(t6.json?.trace?.lane_order));

  // (7) attachments never take the native path (native cannot fetch a URL).
  resetCacheStore();
  install((surface) => {
    if (surface === "azure") return { status: 200, text: "cute lag rahe ho" };
    if (surface === "cache-create") return cacheCreated("c7");
    return { status: 500 };
  });
  const t7 = await call({
    ...baseBody,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: "[they sent a photo]" },
          { type: "image_url", image_url: { url: "https://s/1.jpg" } },
        ],
      },
    ],
  });
  ok("(7) a picture turn still goes AZURE first (the owner's directive)", t7.json?.trace?.served_by === "azure", String(t7.json?.trace?.served_by));
  ok("(7) and never builds a cache", count(t7.seen, "cache-create") === 0);

  // (8) a CALL turn (`no_think`) must carry the call tier onto the native
  //     surface. The tiers are inverted between the two lanes and the failure
  //     mode of the wrong one is that she says nothing at all.
  resetCacheStore();
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated("c6");
    if (surface === "native") return nativeJson("haan bol");
    return { status: 500 };
  });
  const t8 = await call({ ...baseBody, no_think: true });
  ok("(8) a call turn is served on the cached path", t8.status === 200 && t8.json?.trace?.paid?.cache === "explicit");
  ok(
    "(8) …carrying the CALL tier, not the chat one",
    t8.seen.find((x) => x.surface === "native")?.body?.generationConfig?.thinkingConfig?.thinkingLevel === "minimal",
    JSON.stringify(t8.seen.find((x) => x.surface === "native")?.body?.generationConfig ?? {}),
  );
  ok("(8) …and the trace still says which tier was asked for", t8.json?.trace?.effort === "minimal");
}

// ══════════════════════════════════════════════════════════════════════════
section("── streaming: the client cannot tell which surface answered ──");
{
  resetCacheStore();
  const nativeSse =
    [
      { candidates: [{ content: { parts: [{ text: "arre " }], role: "model" }, index: 0 }] },
      { candidates: [{ content: { parts: [{ text: "haan " }], role: "model" }, index: 0 }] },
      {
        candidates: [{ content: { parts: [{ text: "bol na" }], role: "model" }, finishReason: "STOP", index: 0 }],
        usageMetadata: {
          promptTokenCount: 13_400,
          cachedContentTokenCount: CACHED_TOKENS,
          candidatesTokenCount: 12,
          totalTokenCount: 13_412,
        },
      },
    ]
      .map((f) => `data: ${JSON.stringify(f)}\n\n`)
      .join("") + "\n";
  install((surface) => {
    if (surface === "gemini-free") return { status: 429 };
    if (surface === "cache-create") return cacheCreated("s1");
    if (surface === "native-stream") {
      return {
        status: 200,
        response: new Response(nativeSse, { status: 200, headers: { "Content-Type": "text/event-stream" } }),
      };
    }
    return { status: 500 };
  });
  const st = await call({ ...baseBody, stream: true });
  ok("the stream used streamGenerateContent with alt=sse", st.seen.some((x) => x.surface === "native-stream" && /alt=sse/.test(x.url)));
  const deltas = st.wire
    .split("\n")
    .filter((l) => l.startsWith("data: ") && !l.includes("[DONE]"))
    .map((l) => {
      try {
        return JSON.parse(l.slice(6))?.choices?.[0]?.delta?.content;
      } catch {
        return undefined;
      }
    })
    .filter((x) => typeof x === "string");
  ok("the client sees OpenAI-shaped deltas — the wire format is unchanged", deltas.join("") === "arre haan bol na", JSON.stringify(deltas));
  ok("it is REAL streaming: three frames, not one synthesized chunk", deltas.length === 3, `${deltas.length} frames`);
  ok("the stream terminates with [DONE]", st.wire.includes("data: [DONE]"));
  ok("the usage frame carries the cached count through to the trace", st.json?.trace?.tokens_cached === CACHED_TOKENS, String(st.json?.trace?.tokens_cached));
  ok("the streamed turn is labelled explicit", st.json?.trace?.paid?.cache === "explicit");
  ok("the trace still rides the trailing frame", Boolean(st.json?.trace?.turn_id === null && st.json?.trace?.ms >= 0));
  ok(
    "no key, no cache CONTENTS, nothing but counts and labels in the trace",
    !/AIza|battery-paid-key|battery-pool-key|MEERA CORE|RIGHT NOW/.test(JSON.stringify(st.json?.trace ?? {})),
  );
}

globalThis.fetch = realFetch;
console.log(`\nRESULT ${pass} passed, ${fail} failed`);
process.exit(0);
