// ── THE RESILIENCE BATTERY (WS-RESILIENCE) ────────────────────────────────
//
// WHAT IT GATES, and why it is a gate rather than a note.
//
// On 2026-08-24 between 02:30 and 04:30Z the owner's "Hello" and his photos
// died on a SINGLE upstream 502 from Google. The trace is exact: error legs
// `{ms:6693,status:502}` and `{ms:9869,status:502}`, `retries:0`,
// `fallbacks:[]`, a nine-key pool with eight untried keys, and the same canned
// connectivity pair sent three times in ninety minutes with identical wording.
//
// Two independent defects, and neither was visible to any existing gate:
//
//   1. api/chat.js folded EVERY non-quota status into "every key would reject
//      it identically, so stop". True for 400/401/403/404. False for 5xx.
//   2. src/engine/brain.ts drew the canned pair uniformly at random with
//      nothing forbidding a repeat, so the error path recited itself — which is
//      `recited-prompt`'s outcome arriving through a door that law never
//      covered, because no model is involved.
//
// Every gate in this repo is offline and deterministic and asks "does the code
// do the right thing when invoked". None of them can invoke a 502. So this file
// invokes one: the upstream is a function, the clock is a function, and the
// randomness is a function, and each case asserts on the ladder's OBSERVABLE
// output — which lane served, how many attempts were spent, what the trace
// recorded — rather than on the shape of the code.
//
// NEGATIVE CONTROLS ARE FIRST-CLASS HERE. `bold-eats-words` and `sound.mjs`
// both make the point: an assertion whose evidence is an absence passes just as
// happily on a dead feature. So four of these cases re-run against a
// deliberately reverted classifier — the exact `isQuota`-only folding that
// shipped — and assert that it FAILS. A green battery that would also be green
// against the bug is not a battery.
//
// Offline, deterministic, no network, no model call, no database, $0, ~2s.

import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// ── the Azure lane is configured with FAKE values, before anything imports ──
// api/_azure.js reads its endpoint and key at module load. Setting them here
// means the lane is "configured" for the battery with no secret anywhere near
// it, and it means case (d) gates the SAME code in CI as on a laptop. The
// fake endpoint is never dialled: `globalThis.fetch` is replaced below.
process.env.AZURE_ENDPOINT = "https://resilience-battery.invalid/openai/v1";
process.env.AZURE_API_KEY = "battery-not-a-real-key-0000000000";
process.env.AZURE_CHAT_DEPLOYMENT = "battery-chat";
process.env.AZURE_VISION_DEPLOYMENT = "battery-vision";

// ── and so is EVERY other credential the ladder can see ─────────────────────
//
// The 2026-08-24 CI red: this battery passed against the developer's
// _config.js (nine pool keys, an OpenRouter key, a storage backend) and
// failed 23 assertions against CI's `write-config.mjs --stub` (none of the
// above) — the lane roster itself was ambient, so the battery gated the
// MACHINE, not the code. Now the whole roster is pinned here, before any
// module import binds it: nine fake pool keys (env-first seam in _gkeys.js;
// each must clear its >20-char filter), a fake OpenRouter key (chat.js reads
// env-first at call time), and a fake storage backend (memory.js reads
// env-first at module load; the storage mock below routes by path, so the
// host never matters). run.mjs executes each suite in its own subprocess, so
// none of this leaks into other suites. globalThis.fetch is replaced in every
// section that dials — no fake value is ever sent anywhere.
process.env.GOOGLE_KEYS = Array.from(
  { length: 9 },
  (_, i) => `battery-pool-key-${i}-000000000000`,
).join(",");
process.env.OPENROUTER_API_KEY = "battery-openrouter-not-a-real-key";
process.env.SUPABASE_URL = "https://resilience-battery-sb.invalid";
process.env.SUPABASE_KEY = "battery-supabase-not-a-real-key";

const {
  poolAttempt,
  newTransientBudget,
  classifyUpstream,
  normalizeImages,
  attachToLastTurn,
  laneOrder,
  LANE_ORDER_TEXT,
  LANE_ORDER_ATTACHMENT,
  QUOTA,
  TRANSIENT,
  DETERMINISTIC,
  MAX_IMAGES,
  TRANSIENT_DEADLINE_MS,
  TRANSIENT_BUDGET,
  SAME_KEY_RETRIES,
  BACKOFF_MIN_MS,
  BACKOFF_MAX_MS,
} = await import(join(ROOT, "api", "_lanes.js"));
const { walkKeys, poolSize } = await import(join(ROOT, "api", "_gkeys.js"));
const { normalizeDocs, extractPdfText } = await import(join(ROOT, "api", "_docs.js"));

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail = "") {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? ` — ${detail}` : ""}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}
const section = (s) => console.log(`\n${s}`);

// ── hermeticity guard: the modules must see the pinned roster, not the ──────
// machine's. If an import ever moves above the pins, or a seam stops reading
// env-first, this fails FIRST and names the reason, instead of 23 downstream
// assertions failing in CI only.
section("── 0. hermeticity: the battery's roster is the one the code sees ──");
ok("the pool is the battery's nine fake keys", poolSize() === 9, `poolSize=${poolSize()}`);
ok(
  "the OpenRouter key the handler will read is the battery's",
  process.env.OPENROUTER_API_KEY === "battery-openrouter-not-a-real-key",
);

// ── the harness ───────────────────────────────────────────────────────────
//
// A scripted upstream: `plan` maps a key to the list of statuses it returns, in
// order. `slept` records every backoff so the latency bound can be asserted
// rather than asserted-about.
// `errMs` is how long a failing upstream takes to answer, and it is a PARAMETER
// because it is the variable that decides the whole shape of the walk. In the
// real 2026-08-24 trace the two 502s took 6693ms and 9869ms; a sick region that
// answers in 150ms is a completely different situation from one that answers in
// 3s, and the ladder is supposed to treat them differently — rotate through the
// fast one, give up on the slow one and go to the next lane. A battery that
// fixed this number would only ever gate one of those.
function scriptedPool(plan, { errMs = 800, okMs = 40 } = {}) {
  const calls = [];
  const slept = [];
  let clock = 1_000_000;
  const budget = newTransientBudget(clock, TRANSIENT_DEADLINE_MS);
  const attempts = new Map();
  const attempt = poolAttempt(
    async (key) => {
      const i = attempts.get(key) ?? 0;
      attempts.set(key, i + 1);
      const seq = plan[key] ?? [500];
      const status = seq[Math.min(i, seq.length - 1)];
      calls.push({ key, status });
      clock += status >= 200 && status < 300 ? okMs : errMs;
      if (status === 0) throw new Error("network");
      return { ok: status >= 200 && status < 300, status, value: { status } };
    },
    {
      budget,
      sleep: async (ms) => {
        slept.push(ms);
        clock += ms;
      },
      rand: () => 0.5,
      now: () => clock,
    },
  );
  return { attempt, calls, slept, budget, clock: () => clock, start: 1_000_000 };
}

// The pre-fix classifier, verbatim in behaviour: quota, else deterministic.
// This is the negative control — every case that matters must FAIL against it.
const REVERTED = (status) => {
  const s = Number(status) || 0;
  if (s === 429 || s === 403) return QUOTA;
  if (s >= 200 && s < 300) return null;
  return DETERMINISTIC;
};

// `poolAttempt` takes its classifier from api/_lanes.js directly, so the
// negative control is expressed by re-implementing the ONE line that changed
// around the same real walk, rather than by a flag in production code.
function revertedAttempt(plan) {
  const calls = [];
  return {
    calls,
    attempt: async (key) => {
      const i = calls.filter((c) => c.key === key).length;
      const seq = plan[key] ?? [500];
      const status = seq[Math.min(i, seq.length - 1)];
      calls.push({ key, status });
      if (status >= 200 && status < 300) return { ok: true, value: { status } };
      const cls = REVERTED(status);
      if (cls === QUOTA) return { ok: false, exhausted: true };
      return { ok: false, error: `gemini ${status}` };
    },
  };
}

const K = ["kA", "kB", "kC", "kD"];

// ══════════════════════════════════════════════════════════════════════════
section("── classification ──");
// The table, stated once and asserted once. Every entry here is a decision the
// old code got wrong in exactly one direction.
const TABLE = [
  [200, null],
  [204, null],
  [400, DETERMINISTIC],
  [401, DETERMINISTIC],
  [404, DETERMINISTIC],
  [413, DETERMINISTIC],
  [415, DETERMINISTIC],
  [403, QUOTA],
  [429, QUOTA],
  [408, TRANSIENT],
  [500, TRANSIENT],
  [502, TRANSIENT],
  [503, TRANSIENT],
  [504, TRANSIENT],
  [529, TRANSIENT],
  [0, TRANSIENT],
];
for (const [status, want] of TABLE) {
  ok(`classify ${status} → ${want ?? "success"}`, classifyUpstream(status) === want);
}
ok(
  "the reverted classifier disagrees on exactly the 5xx family",
  TABLE.filter(([s, w]) => w === TRANSIENT && s !== 0).every(([s]) => REVERTED(s) === DETERMINISTIC),
  "negative control is genuinely different",
);

// ══════════════════════════════════════════════════════════════════════════
section("── (a) 502 then 200 on the SAME key ──");
{
  const s = scriptedPool({ kA: [502, 200] });
  const got = await walkKeys([...K], s.attempt, null);
  ok("the turn is served", Boolean(got.value), `value=${JSON.stringify(got.value)}`);
  ok("it was served by the FIRST key", s.calls.length === 2 && s.calls.every((c) => c.key === "kA"));
  ok("exactly one retry was spent", s.budget.retries === 1, `retries=${s.budget.retries}`);
  ok("no other key was burned", new Set(s.calls.map((c) => c.key)).size === 1);
  ok(
    "the retry slept a jittered backoff in range",
    s.slept.length === 1 && s.slept[0] >= BACKOFF_MIN_MS && s.slept[0] <= BACKOFF_MAX_MS,
    `slept=${JSON.stringify(s.slept)}`,
  );
}
{
  const r = revertedAttempt({ kA: [502, 200] });
  const got = await walkKeys([...K], r.attempt, null);
  ok(
    "NEGATIVE CONTROL: the pre-fix folding loses this turn",
    !got.value && got.triedAll === false && r.calls.length === 1,
    `calls=${r.calls.length} error=${got.error}`,
  );
}

// ══════════════════════════════════════════════════════════════════════════
section("── (b) two keys 502 → rotation → third key 200 ──");
{
  // Each of the first two keys 502s on every attempt, so each burns its one
  // same-key retry and then rotates. The third answers. A fast sick region
  // (150ms) is the case where rotation is affordable.
  const s = scriptedPool({ kA: [502], kB: [503], kC: [200] }, { errMs: 150 });
  const got = await walkKeys([...K], s.attempt, null);
  const keysTried = [...new Set(s.calls.map((c) => c.key))];
  ok("the turn is served", Boolean(got.value));
  ok("it rotated to the third key", keysTried.join(",") === "kA,kB,kC", keysTried.join(","));
  ok("the fourth key was never touched", !keysTried.includes("kD"));
  ok(
    "the transient attempt budget was respected",
    s.budget.retries <= TRANSIENT_BUDGET,
    `retries=${s.budget.retries} budget=${TRANSIENT_BUDGET}`,
  );
  ok(
    "no key was retried more than SAME_KEY_RETRIES times in place",
    ["kA", "kB", "kC"].every((k) => s.calls.filter((c) => c.key === k).length <= 1 + SAME_KEY_RETRIES),
  );
  ok(
    `added latency stayed inside the ${TRANSIENT_DEADLINE_MS}ms deadline`,
    s.clock() - s.start <= TRANSIENT_DEADLINE_MS,
    `elapsed=${s.clock() - s.start}ms`,
  );
}
{
  const r = revertedAttempt({ kA: [502], kB: [503], kC: [200] });
  const got = await walkKeys([...K], r.attempt, null);
  ok(
    "NEGATIVE CONTROL: the pre-fix folding never reaches the healthy key",
    !got.value && r.calls.length === 1,
    `calls=${r.calls.length}`,
  );
}
{
  // THE PRODUCTION SHAPE. A 502 that takes 6.7s to come back has already spent
  // the whole deadline, so the pool must STOP and let the next lane answer —
  // measured through the real handler, the pre-fix-of-the-fix version instead
  // started an attempt per remaining key and each was aborted at ~1ms: three
  // keys burned for no chance of a reply.
  const s = scriptedPool({ kA: [502], kB: [200], kC: [200] }, { errMs: 6_700 });
  const got = await walkKeys([...K], s.attempt, null);
  ok("a deadline-eating 502 does not retry", s.budget.retries === 0);
  ok("and burns exactly ONE key before giving the turn to the next lane", s.calls.length === 1, `calls=${s.calls.length}`);
  ok("the pool reports the give-up as an abort, not as exhaustion", !got.value && got.triedAll === false);
}
{
  // The deadline must bind on a whole slow-sick pool too, rather than walking
  // every key at 800ms a head.
  const s = scriptedPool({ kA: [502], kB: [502], kC: [502], kD: [502] });
  const got = await walkKeys([...K], s.attempt, null);
  ok("a fully sick pool gives up", !got.value);
  ok(
    "and it gave up because a BOUND bound it, not because it ran out of keys",
    s.budget.retries <= TRANSIENT_BUDGET &&
      s.slept.every((ms) => ms <= BACKOFF_MAX_MS) &&
      s.calls.length < 2 * K.length,
    `retries=${s.budget.retries}, sleeps=${s.slept.length}, calls=${s.calls.length}`,
  );
  ok(
    `it never spent more than ${TRANSIENT_DEADLINE_MS}ms of wall clock deciding`,
    s.clock() - s.start <= TRANSIENT_DEADLINE_MS + 800,
    `elapsed=${s.clock() - s.start}ms (the last in-flight answer lands after the deadline check)`,
  );
}

// ══════════════════════════════════════════════════════════════════════════
section("── (c) a 400 aborts without burning the pool ──");
for (const status of [400, 401, 404, 413]) {
  const s = scriptedPool({ kA: [status], kB: [200], kC: [200] });
  const got = await walkKeys([...K], s.attempt, null);
  ok(
    `${status} aborts the pool after ONE call`,
    !got.value && got.triedAll === false && s.calls.length === 1,
    `calls=${s.calls.length}`,
  );
  ok(`${status} never sleeps a backoff`, s.slept.length === 0);
}
{
  // Quota still rotates, and still cools. This is the branch that already
  // worked and must not have been broken by the change.
  const s = scriptedPool({ kA: [429], kB: [429], kC: [200] });
  const got = await walkKeys([...K], s.attempt, null);
  ok("429 still rotates to the next key", Boolean(got.value) && s.calls.length === 3);
  ok("429 does not spend the transient budget", s.budget.retries === 0);
}

// ══════════════════════════════════════════════════════════════════════════
section("── lane order ──");
ok("text order is free → openrouter → azure", LANE_ORDER_TEXT.join(">") === "gemini-free>openrouter>azure");
ok(
  "attachment order is azure FIRST (the owner's directive)",
  LANE_ORDER_ATTACHMENT[0] === "azure" && LANE_ORDER_ATTACHMENT.length === 3,
  LANE_ORDER_ATTACHMENT.join(">"),
);
ok("laneOrder picks by attachment presence", laneOrder({ hasAttachments: true })[0] === "azure" &&
  laneOrder({ hasAttachments: false })[0] === "gemini-free");
ok(
  "every lane appears in both orders — an order is a permutation, not a subset",
  [...LANE_ORDER_TEXT].sort().join() === [...LANE_ORDER_ATTACHMENT].sort().join(),
);
// WS-COST. The paid Google lane's whole safety property is "off by default",
// and the only way to state that as a fact rather than a hope is IDENTITY: with
// the flag unset `laneOrder` must hand back the very same array object it
// handed back before the lane existed, not an equal copy. A filtered copy would
// pass a deep-equality check today and start differing the first time someone
// edits the filter.
ok(
  "paid lane OFF by default — laneOrder returns the ORIGINAL constant, by identity",
  laneOrder({ hasAttachments: false }) === LANE_ORDER_TEXT &&
    laneOrder({ hasAttachments: true }) === LANE_ORDER_ATTACHMENT,
);
ok(
  "explicit paidLane:false is the same as omitting it",
  laneOrder({ hasAttachments: false, paidLane: false }) === LANE_ORDER_TEXT,
);
ok(
  "paid lane ON sits BELOW the free pool and ABOVE openrouter",
  laneOrder({ hasAttachments: false, paidLane: true }).join(">") ===
    "gemini-free>gemini-paid>openrouter>azure",
  laneOrder({ hasAttachments: false, paidLane: true }).join(">"),
);
ok(
  "paid lane ON keeps azure FIRST for attachments (the owner's directive is not a casualty of a cost flag)",
  laneOrder({ hasAttachments: true, paidLane: true })[0] === "azure",
  laneOrder({ hasAttachments: true, paidLane: true }).join(">"),
);

// ══════════════════════════════════════════════════════════════════════════
section("── (f) the payload contract ──");
const img = (n) => `data:image/jpeg;base64,${"A".repeat(n)}`;
{
  const six = normalizeImages(Array.from({ length: 6 }, () => img(100)));
  ok("6 images are REJECTED", !six.ok && six.status === 413, six.error);
  const five = normalizeImages(Array.from({ length: 5 }, () => img(100)));
  ok("5 images are accepted", five.ok && five.urls.length === 5);
  ok("MAX_IMAGES is 5", MAX_IMAGES === 5);
  const zero = normalizeImages(undefined);
  ok("no images field is not an error", zero.ok && zero.urls.length === 0);
  const obj = normalizeImages([{ data: "AAAA", mime: "image/png" }]);
  ok("{data,mime} is accepted and becomes a data URL", obj.ok && obj.urls[0] === "data:image/png;base64,AAAA");
  const https = normalizeImages(["https://example.com/a.jpg"]);
  ok("an https URL still works (storage-uploaded photos)", https.ok);
  const bad = normalizeImages(["javascript:alert(1)"]);
  ok("a non-image scheme is rejected", !bad.ok && bad.status === 400);
  const huge = normalizeImages([img(2_000_000)]);
  ok("a single oversized image is rejected 413", !huge.ok && huge.status === 413);
  const total = normalizeImages(Array.from({ length: 4 }, () => img(1_200_000)));
  ok("a set over the TOTAL cap is rejected 413", !total.ok && total.status === 413);
  ok("images must be an array", !normalizeImages("nope").ok);
}
{
  const messages = [
    { role: "user", content: "kal milte hain" },
    { role: "assistant", content: "haan" },
    { role: "user", content: "dekh ye" },
  ];
  const out = attachToLastTurn(messages, { caption: "ye dekh yaar", urls: [img(10), img(10)] });
  const last = out[out.length - 1];
  ok("the images land on the LAST user turn", last.role === "user" && Array.isArray(last.content));
  ok(
    "all images are in ONE turn — she reacts to the SET, not five times",
    last.content.filter((p) => p.type === "image_url").length === 2 && out.length === messages.length,
  );
  ok(
    "the caption is threaded through, before the pictures",
    last.content.some((p) => p.type === "text" && p.text === "ye dekh yaar"),
  );
  ok("the original message text survives", JSON.stringify(last.content).includes("dekh ye"));
  ok("the input array is not mutated", typeof messages[2].content === "string");
  const empty = attachToLastTurn([{ role: "assistant", content: "hm" }], { urls: [img(10)] });
  ok(
    "an attachment with no user turn to land on creates one rather than vanishing",
    empty.length === 2 && empty[1].role === "user",
  );
}

// ══════════════════════════════════════════════════════════════════════════
section("── documents ──");
{
  const d = normalizeDocs([{ name: "cv.txt", mime: "text/plain", text: "Raghav Sharma\nBackend engineer" }]);
  ok("a text document becomes one bounded block", d.ok && d.blocks.length === 1);
  ok("the block names the file", d.blocks[0].includes("cv.txt"));
  ok("the block carries the content", d.blocks[0].includes("Backend engineer"));
  const long = normalizeDocs([{ name: "big.txt", text: "x".repeat(50_000) }]);
  ok("a long document is CAPPED, not injected whole", long.ok && long.blocks[0].length < 5_000, `${long.blocks[0].length} chars`);
  const many = normalizeDocs([{ text: "a" }, { text: "b" }, { text: "c" }, { text: "d" }]);
  ok("too many documents are rejected 413", !many.ok && many.status === 413);
  const unreadable = normalizeDocs([{ name: "scan.pdf", mime: "application/pdf", data: "AAAA" }]);
  ok(
    "an unreadable document says so rather than fabricating contents",
    unreadable.ok && /can't read the inside/.test(unreadable.blocks[0]),
    "vision-fab: read-part-assert-the-rest is the failure this repo already paid for",
  );
  ok("docs must be an array", !normalizeDocs("nope").ok);
  ok("no docs field is not an error", normalizeDocs(undefined).ok);
  // A minimal, real, uncompressed PDF: the one producer shape that can be
  // asserted without shipping a binary fixture.
  const pdf = Buffer.from(
    "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n" +
      "4 0 obj<</Length 60>>stream\nBT /F1 12 Tf 72 700 Td (Meera resume draft) Tj ET\nendstream endobj\n" +
      "trailer<</Root 1 0 R>>\n%%EOF",
    "latin1",
  );
  ok("a plain PDF content stream is extracted", extractPdfText(pdf).includes("Meera resume draft"), extractPdfText(pdf));
}

// ══════════════════════════════════════════════════════════════════════════
section("── (d)+(e) the whole ladder, through the real handler ──");
{
  // The real api/chat.js handler, with `globalThis.fetch` replaced. Nothing
  // here touches the network: an unmatched URL is a hard failure, so a lane
  // reaching an unexpected host cannot pass quietly.
  const chat = await import(join(ROOT, "api", "chat.js"));
  const handler = chat.default;

  const realFetch = globalThis.fetch;
  let seen = [];
  const install = (route) => {
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(init.body) : null;
      const r = route(u, body, init);
      seen.push({ url: u, status: r.status, body });
      if (r.throws) throw new Error("network");
      return new Response(r.body ?? JSON.stringify({ choices: [{ message: { content: r.text ?? "" } }] }), {
        status: r.status,
        headers: { "Content-Type": "application/json" },
      });
    };
  };
  const lane = (u) =>
    u.includes("generativelanguage") ? "gemini-free" : u.includes("openrouter") ? "openrouter" : u.includes("resilience-battery.invalid") ? "azure" : "?";

  let ipN = 0;
  const call = async (body) => {
    seen = [];
    const req = {
      method: "POST",
      headers: { "x-forwarded-for": `10.9.0.${++ipN}` },
      socket: { remoteAddress: `10.9.0.${ipN}` },
      body,
      on: () => {},
    };
    let status = 0;
    let json = null;
    const res = {
      setHeader: () => {},
      status(s) {
        status = s;
        return this;
      },
      json(j) {
        json = j;
        return this;
      },
      end() {
        return this;
      },
    };
    await handler(req, res);
    return { status, json, seen };
  };

  const baseBody = {
    system: "you are a test harness",
    messages: [{ role: "user", content: "hello" }],
    model: "google/gemini-3.6-flash",
    max_tokens: 100,
  };

  // (d) free pool spent, OpenRouter dead, Azure configured → Azure serves.
  install((u) => {
    const l = lane(u);
    if (l === "gemini-free") return { status: 429 };
    if (l === "openrouter") return { status: 402 };
    if (l === "azure") return { status: 200, text: "arre haan bol" };
    return { status: 599 };
  });
  {
    const { status, json, seen: s } = await call({ ...baseBody });
    ok("(d) pool spent + openrouter dead → the turn is SERVED", status === 200, `http ${status}`);
    ok("(d) served_by names the grant lane", json?.trace?.served_by === "azure", String(json?.trace?.served_by));
    ok("(d) she actually says something", Boolean(json?.text), JSON.stringify(json?.text ?? "").slice(0, 40));
    ok("(d) the azure lane is traced as a named fallback", json?.trace?.azure?.used === true);
    ok(
      "(d) the lanes were tried in the text order",
      s.map((x) => lane(x.url)).join(">").startsWith("gemini-free"),
      s.map((x) => lane(x.url)).join(">"),
    );
    ok("(d) no key or key prefix appears anywhere in the trace",
      !/AIza|sk-or-|api[-_]?key["']?\s*[:=]/i.test(JSON.stringify(json?.trace ?? {})));
    // WS-COST C, stated where it can be seen rather than in a comment: with the
    // paid lane off — the default this process runs under — the cost path is
    // not merely unused, it is UNREACHABLE. No cache object, no native surface,
    // no second wire format. This is the byte-identical guarantee as an
    // assertion on the URLs actually dialled.
    ok(
      "(d) paid lane off → no cachedContents object is created",
      !s.some((x) => /cachedContents/.test(x.url)),
    );
    ok(
      "(d) paid lane off → the native generate surface is never dialled",
      !s.some((x) => /:generateContent|:streamGenerateContent/.test(x.url)),
      s.map((x) => x.url.replace(/^https:\/\//, "").slice(0, 48)).join(" "),
    );
  }

  // The headline case: ONE 502, everything else healthy. This is the exact
  // production shape, and the whole point is that it now costs a retry and not
  // a turn.
  {
    let n = 0;
    install((u) => {
      const l = lane(u);
      if (l === "gemini-free") return ++n === 1 ? { status: 502 } : { status: 200, text: "haan bol na" };
      return { status: 500 };
    });
    const { status, json } = await call({ ...baseBody });
    ok("THE DEFECT: one 502 no longer ends the turn", status === 200, `http ${status}`);
    ok("served by the free pool, not a paid lane", json?.trace?.served_by === "gemini-free");
    ok("the retry is RECORDED", (json?.trace?.retries ?? 0) >= 1, `retries=${json?.trace?.retries}`);
    ok(
      "the fallback legs say WHY, with a status",
      (json?.trace?.fallbacks ?? []).some((f) => /502/.test(f.why || "")),
      JSON.stringify(json?.trace?.fallbacks ?? []),
    );
    ok(
      "the whole turn stayed under the long-think indicator",
      (json?.trace?.ms ?? 0) < 4_000 + 1_500,
      `${json?.trace?.ms}ms`,
    );
  }

  // A genuine 400 must still abort the free pool — but must NOT end the turn
  // while lanes remain. Both halves in one case.
  {
    install((u) => {
      const l = lane(u);
      if (l === "gemini-free") return { status: 400 };
      if (l === "openrouter") return { status: 200, text: "theek h" };
      return { status: 500 };
    });
    const { status, json, seen: s } = await call({ ...baseBody });
    ok("(c) a 400 burns exactly one key", s.filter((x) => lane(x.url) === "gemini-free").length === 1);
    ok("(c) and the turn still lands on the next lane", status === 200 && json?.trace?.served_by === "openrouter");
    ok("(c) the abort is traced", (json?.trace?.fallbacks ?? []).some((f) => f.to === "abort"));
  }

  // (f) through the real handler: the caps are server-side, and the caption
  // reaches the model.
  {
    install((u) => (lane(u) === "azure" ? { status: 200, text: "cute" } : { status: 500 }));
    const six = await call({ ...baseBody, images: Array.from({ length: 6 }, () => img(50)), caption: "dekh" });
    ok("(f) six images are refused by the SERVER", six.status === 413, `http ${six.status}`);
    ok("(f) and nothing was sent upstream", six.seen.length === 0);

    const five = await call({ ...baseBody, images: Array.from({ length: 5 }, () => img(50)), caption: "ye dekh" });
    ok("(f) five images are accepted", five.status === 200, `http ${five.status}`);
    ok("(f) attachments go to AZURE first", five.json?.trace?.served_by === "azure", String(five.json?.trace?.served_by));
    ok("(f) the lane order flipped for attachments", five.json?.trace?.lane_order?.startsWith("azure"));
    const sent = five.seen[0]?.body;
    const lastTurn = sent?.messages?.[sent.messages.length - 1];
    const parts = Array.isArray(lastTurn?.content) ? lastTurn.content : [];
    ok("(f) all five images ride in ONE turn", parts.filter((p) => p.type === "image_url").length === 5);
    ok("(f) the caption is threaded through to the model", parts.some((p) => p.type === "text" && p.text === "ye dekh"));
    ok("(f) the trace counts the set", five.json?.trace?.attach?.images === 5 && five.json?.trace?.images_n === 5);
    ok("(f) the azure deployment used is the VISION one", five.json?.trace?.azure?.deployment === "battery-vision");

    // THE ORDINARY FLOW: pictures that were uploaded first and arrive as
    // image_url parts inside `messages`, with no `images` field at all. This is
    // the majority of picture turns, and if the lane order were decided from
    // the request field alone the owner's Azure-first directive would silently
    // never fire for it.
    const viaHistory = await call({
      ...baseBody,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "[they sent 2 photos: ye dekh]" },
            { type: "image_url", image_url: { url: "https://s/1.jpg" } },
            { type: "image_url", image_url: { url: "https://s/2.jpg" } },
          ],
        },
      ],
    });
    ok("(f) uploaded pictures in history also route AZURE first", viaHistory.json?.trace?.served_by === "azure",
      String(viaHistory.json?.trace?.served_by));
    ok("(f) …and use the vision deployment", viaHistory.json?.trace?.azure?.deployment === "battery-vision");

    const doc = await call({
      ...baseBody,
      docs: [{ name: "resume.txt", mime: "text/plain", text: "Raghav Sharma, backend engineer, 4 years" }],
      caption: "isko dekh",
    });
    ok("(f) a document turn is served", doc.status === 200);
    const dsent = doc.seen[0]?.body;
    const dparts = dsent?.messages?.[dsent.messages.length - 1]?.content ?? [];
    ok(
      "(f) the document text is in the TURN",
      JSON.stringify(dparts).includes("backend engineer"),
    );
    ok(
      "(f) and NOT in the system prompt — the budget cuts the END, where safety text lives",
      !JSON.stringify(dsent?.messages?.[0] ?? {}).includes("backend engineer"),
    );
  }

  // (e) everything dead.
  {
    install(() => ({ status: 503 }));
    const { status, json } = await call({ ...baseBody });
    ok("(e) every lane down → the handler reports failure honestly", status === 502, `http ${status}`);
    ok("(e) served_by says none", json?.trace?.served_by === "none");
    ok("(e) and it tried more than one lane before saying so", (json?.trace?.fallbacks ?? []).length > 1);
  }

  globalThis.fetch = realFetch;
}

// ══════════════════════════════════════════════════════════════════════════
section("── (e) the canned pair never repeats ──");
{
  // The REAL variants, bundled from the REAL source — same discipline as
  // evals/run.mjs itself, for `gates-that-live-nowhere`'s reason.
  const tmp = mkdtempSync(join(tmpdir(), "resil-"));
  const bundle = join(tmp, "brain.mjs");
  execSync(
    `npx esbuild ${join(ROOT, "evals", ".entry.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${bundle} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    { stdio: "inherit", cwd: ROOT },
  );
  const B = await import(bundle);

  for (const [modeName, pool] of [["chat", B.OOPS_CHAT], ["call", B.OOPS_CALL]]) {
    ok(`${modeName}: more than three variants exist to draw from`, pool.length >= 5, `${pool.length} variants`);
    const seen = [];
    let repeats = 0;
    for (let i = 0; i < 4_000; i++) {
      const v = B.drawNoRepeat(pool, `battery-${modeName}`);
      if (seen.length && JSON.stringify(seen[seen.length - 1]) === JSON.stringify(v)) repeats++;
      seen.push(v);
    }
    ok(`${modeName}: 4000 consecutive draws, ZERO identical back to back`, repeats === 0, `repeats=${repeats}`);
    const distinct = new Set(seen.map((v) => JSON.stringify(v)));
    ok(
      `${modeName}: every variant is still reachable`,
      distinct.size === pool.length,
      `${distinct.size}/${pool.length}`,
    );
    // A no-repeat rule implemented as "advance by one" would pass both
    // assertions above and be a fixed cycle. Assert it is not one.
    const cyclic = seen.slice(1).every((v, i) => {
      const prev = pool.findIndex((p) => JSON.stringify(p) === JSON.stringify(seen[i]));
      return JSON.stringify(v) === JSON.stringify(pool[(prev + 1) % pool.length]);
    });
    ok(`${modeName}: and it is not a fixed rotation either`, !cyclic);
    ok(
      `${modeName}: every variant is a real bubble list`,
      pool.every((v) => Array.isArray(v) && v.length >= 1 && v.every((s) => typeof s === "string" && s.trim())),
    );
  }
  // The two pools must not share a line: a call line on a text lane is the
  // absurdity the original comment was written about.
  const overlap = B.OOPS_CHAT.flat().filter((s) => B.OOPS_CALL.flat().includes(s));
  ok("no line is shared between the call and chat pools", overlap.length === 0, overlap.join("|"));

  // NEGATIVE CONTROL: the pre-fix uniform draw MUST produce repeats. Without
  // this the "zero repeats" assertion above would also pass on a pool of one.
  {
    let repeats = 0;
    let prev = null;
    for (let i = 0; i < 4_000; i++) {
      const v = B.OOPS_CHAT[Math.floor(Math.random() * B.OOPS_CHAT.length)];
      if (prev && JSON.stringify(prev) === JSON.stringify(v)) repeats++;
      prev = v;
    }
    ok(
      "NEGATIVE CONTROL: the pre-fix uniform draw repeats itself",
      repeats > 100,
      `${repeats} back-to-back repeats in 4000 — this is what shipped, and what the owner saw three times in 90 minutes`,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
section("── the batch upload (WS-COMPOSER handoff) ──");
{
  // api/memory.js's opUploadPhoto, driven through the real router with the
  // storage API mocked. Five pictures used to cost five round trips because the
  // batch shape had no `data` and fell into `{error:"empty"}`; the client's
  // fallback made that WORK, which is why nothing failed and nothing was fast.
  const mem = await import(join(ROOT, "api", "memory.js"));
  const realFetch2 = globalThis.fetch;
  let puts = [];
  let deletes = [];
  const installStore = ({ failAt = -1, have = 0 } = {}) => {
    puts = [];
    deletes = [];
    globalThis.fetch = async (url, init) => {
      const u = String(url);
      if (u.includes("/storage/v1/object/list/")) {
        return new Response(JSON.stringify(Array.from({ length: have }, (_, i) => ({ name: `p${i}` }))), { status: 200 });
      }
      if (init?.method === "DELETE") {
        const b = JSON.parse(init.body);
        deletes.push(...b.prefixes);
        return new Response(JSON.stringify(b.prefixes), { status: 200 });
      }
      if (u.includes("/storage/v1/object/meera-photos/")) {
        const path = u.split("/storage/v1/object/meera-photos/")[1];
        puts.push(path);
        return new Response("{}", { status: puts.length - 1 === failAt ? 500 : 200 });
      }
      return new Response("{}", { status: 404 });
    };
  };
  const DEV = "3f2b9c14-5a7e-4d3b-9f10-8c6e2a4b7d55";
  const dataUrl = (n) => `data:image/jpeg;base64,${Buffer.from("x".repeat(n)).toString("base64")}`;
  const up = async (body, opts) => {
    installStore(opts);
    let out = null;
    const res = { setHeader() {}, status() { return this; }, json(j) { out = j; return this; }, end() { return this; } };
    await mem.default(
      { method: "POST", headers: {}, socket: {}, body: { op: "upload_photo", device: DEV, ...body }, on() {} },
      res,
    );
    return out;
  };

  {
    const r = await up({ images: [dataUrl(20), dataUrl(20), dataUrl(20)], caption: "ye dekh", mime: "image/jpeg" });
    ok("a 3-image batch returns urls", Array.isArray(r?.urls), JSON.stringify(r).slice(0, 120));
    ok("…the same length as `images`", r?.urls?.length === 3, `${r?.urls?.length}`);
    ok("…in ONE call per image, not one call per round trip", puts.length === 3);
    ok("…and every url is distinct", new Set(r?.urls ?? []).size === 3);
    ok("…each url is public and points at the object just written", (r?.urls ?? []).every((u, i) => u.endsWith(puts[i])));
    ok(
      "…and every object name still parses back to a forget path",
      puts.every((p) => {
        const id = /\/([0-9]+-[a-z0-9]+)\.jpg$/.exec("/" + p)?.[1];
        return id && mem.photoPathsFromFactNames(DEV, [`photo:${id}`]).length === 1;
      }),
      "an index segment here would orphan the JPEG on an item-scope forget",
    );
    ok("…`url` is also present, so a mid-rollout client still works", typeof r?.url === "string");
  }
  {
    const r = await up({ data: Buffer.from("legacy").toString("base64"), mime: "image/jpeg" });
    ok("LEGACY: `{data,mime}` still returns `{url}`", typeof r?.url === "string" && !r?.error, JSON.stringify(r).slice(0, 100));
    ok("LEGACY: exactly one object written", puts.length === 1);
  }
  {
    const r = await up({ images: Array.from({ length: 6 }, () => dataUrl(20)) });
    ok("six images are refused", r?.error === "too many images", JSON.stringify(r));
    ok("…and nothing was written", puts.length === 0);
  }
  {
    const r = await up({ images: [dataUrl(20), "", dataUrl(20)] });
    ok("an empty entry fails the WHOLE batch", r?.error === "empty");
    ok("…rather than returning a shorter array that misaligns the thread", !r?.urls && puts.length === 0);
  }
  {
    const r = await up({ images: [dataUrl(20), dataUrl(20), dataUrl(20)] }, { failAt: 1 });
    ok("a partial storage failure fails the batch", r?.error === "upload failed");
    ok(
      "…and cleans up the objects that DID land, so no orphan JPEGs",
      deletes.length >= 1 && deletes.every((p) => puts.includes(p)),
      `deleted ${deletes.length}`,
    );
  }
  {
    const r = await up({ images: [dataUrl(20), dataUrl(20)] }, { have: 499 });
    ok("the per-device quota counts the whole batch, not one picture", r?.error === "photo limit reached");
  }
  {
    const r = await up({ images: [`data:image/jpeg;base64,${"A".repeat(2_300_000)}`] });
    ok("an oversized image is refused", r?.error === "too large");
    const many = await up({ images: Array.from({ length: 5 }, () => `data:image/jpeg;base64,${"A".repeat(1_600_000)}`) });
    ok("and a batch over the TOTAL byte cap is refused", many?.error === "too large");
  }
  globalThis.fetch = realFetch2;
}

// ══════════════════════════════════════════════════════════════════════════
section("── the history path: five pictures must still be five pictures ──");
{
  // The OTHER way images reach the model. `attachToLastTurn` handles the send;
  // `toTurns` handles every turn AFTER it, re-reading the stored message. Two
  // different files, two different code paths, one product rule — and the
  // second one read only the legacy single field, so a five-picture message
  // came back on the next turn as ONE picture. She would comment on the first
  // and ignore the rest, which reads as her not looking.
  const tmp2 = mkdtempSync(join(tmpdir(), "resil-tt-"));
  const b2 = join(tmp2, "brain.mjs");
  execSync(
    `npx esbuild ${join(ROOT, "evals", ".entry.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${b2} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    { stdio: "inherit", cwd: ROOT },
  );
  const T = await import(b2);
  const imgs5 = ["u1", "u2", "u3", "u4", "u5"];
  const countParts = (turns, type) =>
    turns.reduce(
      (n, t) => n + (Array.isArray(t.content) ? t.content.filter((p) => p.type === type).length : 0),
      0,
    );

  {
    const turns = T.toTurns(
      [{ from: "me", kind: "photo", text: "[5 photos] ye dekh", photoUrl: "u1", photoUrls: imgs5, at: Date.now() }],
      "kaisi lagi",
    );
    ok("all five stored pictures reach the model", countParts(turns, "image_url") === 5, `${countParts(turns, "image_url")} of 5`);
    ok("in ONE turn", turns.filter((t) => Array.isArray(t.content)).length === 1);
    const flat = JSON.stringify(turns);
    ok("the turn says there are five of them", /they sent 5 photos/.test(flat), flat.slice(0, 160));
    ok("the caption survives", /ye dekh/.test(flat));
    ok(
      "and the composer's transcript HEAD is not repeated as a caption",
      !/\[5 photos\] ye dekh/.test(flat),
      "the head is a count, not something he typed",
    );
  }
  {
    // The legacy shape, byte for byte as before.
    const turns = T.toTurns([{ from: "me", kind: "photo", text: "[photo]", photoUrl: "u1", at: Date.now() }], "?");
    ok("the legacy single-photo shape still sends one image", countParts(turns, "image_url") === 1);
    ok(
      "and still says 'a photo' with no caption",
      /they sent a photo\]/.test(JSON.stringify(turns)),
      JSON.stringify(turns).slice(0, 120),
    );
  }
  {
    // Precedence: the engine's rule must match components/attachments.ts's
    // `imagesOf`. Two readers of the same field is how they drift.
    const legacyOnly = T.toTurns([{ from: "me", kind: "photo", text: "[photo]", photoUrl: "u9", at: 1 }], "?");
    ok("an empty photoUrls array does not shadow the legacy field", countParts(legacyOnly, "image_url") === 1);
    const both = T.toTurns(
      [{ from: "me", kind: "photo", text: "[2 photos]", photoUrl: "u1", photoUrls: ["a", "b"], at: 1 }],
      "?",
    );
    ok("the new field wins when both are present", countParts(both, "image_url") === 2);
    const holes = T.toTurns(
      [{ from: "me", kind: "photo", text: "[3 photos]", photoUrl: "u1", photoUrls: ["a", null, "c"], at: 1 }],
      "?",
    );
    ok("holes are dropped, not sent as nulls", countParts(holes, "image_url") === 2);
    ok("no image part carries an empty url", !/"url":(null|"")/.test(JSON.stringify(holes)));
  }
  {
    // The budget. Six messages of five pictures is thirty images and real
    // money; the NEWEST set must always survive.
    const many = [];
    for (let i = 0; i < 6; i++) {
      many.push({
        from: "me",
        kind: "photo",
        text: `[5 photos] set${i}`,
        photoUrl: `s${i}-1`,
        photoUrls: [1, 2, 3, 4, 5].map((k) => `s${i}-${k}`),
        at: 1000 + i,
      });
      many.push({ from: "her", text: "cute", at: 1000 + i });
    }
    const turns = T.toTurns(many, "aur?");
    const n = countParts(turns, "image_url");
    ok("thirty candidate images are bounded", n <= 8 && n > 0, `${n} images sent`);
    ok(
      "and the NEWEST set is the one that survived whole",
      [1, 2, 3, 4, 5].every((k) => JSON.stringify(turns).includes(`s5-${k}`)),
    );
    ok(
      "an older set degrades to its description rather than half a set",
      !/s0-1/.test(JSON.stringify(turns)) || n === 8,
    );
  }
}

// ══════════════════════════════════════════════════════════════════════════
section("── the source itself: no caller may fold 5xx again ──");
{
  // A property of a FUTURE edit, which no test that runs today's code can see.
  // Same species as scripts/check-workflows.mjs and the notify lane's lint.
  const { readFileSync, readdirSync } = await import("node:fs");
  const apiDir = join(ROOT, "api");
  const offenders = [];
  for (const f of readdirSync(apiDir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(join(apiDir, f), "utf8");
    if (!/withGeminiKey|walkKeys/.test(src)) continue;
    const usesQuota = /isQuota\s*\(/.test(src);
    const usesTransient = /isTransient\s*\(|classifyUpstream\s*\(/.test(src);
    if (usesQuota && !usesTransient) offenders.push(f);
  }
  ok(
    "every pool caller that classifies quota also classifies transient",
    offenders.length === 0,
    offenders.length ? `folds 5xx into deterministic: ${offenders.join(", ")}` : "chat.js, live-token.js, speech.js, memory.js",
  );
}

// ══════════════════════════════════════════════════════════════════════════
section("── WS-COST C: the explicit-cache path, in its own process ──");
{
  // api/chat.js resolves PAID_LANE, GEMINI_PAID_KEY and PAID_CACHE at MODULE
  // LOAD, which is what makes "off by default" a property of the deploy rather
  // than a branch. THIS process has the lane off and every assertion above
  // gates that default; the sub-battery gets its own process with the lane on,
  // and gates the ladder inside it. Two processes because one cannot hold both
  // truths — not because the code has two modes.
  for (const [label, argv] of [
    ["paid lane ON", []],
    ["PAID_CACHE opt-out", ["--cache-off"]],
  ]) {
    try {
      const out = execSync(
        `node ${JSON.stringify(join(HERE, "paid-cache.mjs"))}${argv.length ? ` ${argv.join(" ")}` : ""}`,
        { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
      );
      process.stdout.write(out.replace(/^RESULT.*$/m, "").trimEnd() + "\n");
      const m = /RESULT (\d+) passed, (\d+) failed/.exec(out);
      if (!m) {
        ok(`${label}: the sub-battery reported a result`, false, "no RESULT line");
      } else {
        pass += Number(m[1]);
        fail += Number(m[2]);
        if (Number(m[2])) failures.push(`${label}: ${m[2]} sub-battery assertions`);
        ok(`${label}: ${m[1]} assertions ran in a process with the flag set at load`, Number(m[2]) === 0);
      }
    } catch (e) {
      process.stdout.write(`${e.stdout ?? ""}${e.stderr ?? ""}`);
      ok(`${label}: the sub-battery ran`, false, String(e.message).slice(0, 120));
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log(failures.map((f) => `  - ${f}`).join("\n"));
process.exit(fail ? 1 : 0);
