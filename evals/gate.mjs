// The password gate, end to end and offline. `node evals/gate.mjs`
//
// What it proves, in the order a bypass would try:
//   1. the token is derived the same way on the server and in the probe
//      scripts, and neither the password nor anything shaped like it is in it;
//   2. the password check forgives what a phone keyboard does (capital, space)
//      and nothing else;
//   3. EVERY cost-bearing endpoint closes the door, by reading the real handler
//      and calling it with no token (so a new route that forgets the gate is
//      caught here rather than in the bill), and an unprotected route list that
//      is deliberately short;
//   4. the preflight still passes with no token, and every endpoint's CORS
//      header allows the gate header (the native app is cross-origin);
//   5. the account ops: status, correct word, wrong word, the rate limit;
//   6. the client wrapper attaches the token to our own /api and to nothing
//      else, forgets it on a closed door, and reports results honestly.
//
// A gate that is off must be indistinguishable from no gate: that is asserted
// first, because it is what every other eval in this repo runs under.
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, writeFileSync, existsSync, copyFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
let failed = 0;
let n = 0;
const ok = (name, cond, detail = "") => {
  n++;
  if (!cond) failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${name}${!cond && detail ? `  -- ${detail}` : ""}`);
};

// handlers import named constants from a config that is gitignored; a fresh
// checkout has none. An empty one (the committed example) is enough here, and
// it is removed again if this run created it.
const CFG = join(ROOT, "api/_config.js");
const madeCfg = !existsSync(CFG);
if (madeCfg) copyFileSync(join(ROOT, "api/_config.example.js"), CFG);

const WORD = "mayahumai";
const mkRes = () => {
  const r = { code: 200, headers: {}, body: undefined, ended: false };
  r.setHeader = (k, v) => ((r.headers[k.toLowerCase()] = v), r);
  r.status = (c) => ((r.code = c), r);
  r.json = (b) => ((r.body = b), (r.ended = true), r);
  r.end = () => ((r.ended = true), r);
  return r;
};
const mkReq = (over = {}) => ({ method: "POST", headers: {}, body: {}, query: {}, socket: { remoteAddress: "10.0.0.1" }, ...over });

try {
  // ── 0. off means off ───────────────────────────────────────────────────
  console.log("\n── gate off is no gate ──");
  delete process.env.ACCESS_PASSWORD;
  const G = await import("../api/_gate.js");
  ok("disabled with no password configured", G.gateEnabled() === false);
  ok("no token is minted", G.gateToken() === "");
  ok("any password passes", G.passwordOk("anything") === true);
  {
    const res = mkRes();
    ok("gateOk lets a bare request through", G.gateOk(mkReq(), res) === true && !res.ended);
  }

  // ── 1. the token ────────────────────────────────────────────────────────
  console.log("\n── the token ──");
  process.env.ACCESS_PASSWORD = WORD;
  const tok = G.gateToken();
  ok("64 hex chars", /^[0-9a-f]{64}$/.test(tok), tok);
  ok("does not contain the password", !tok.includes(WORD));
  const { gateHeaders, isGated } = await import("../scripts/_gate-header.mjs");
  ok("server and probe-script derivations agree", gateHeaders()["X-Maya-Gate"] === tok);
  process.env.ACCESS_PASSWORD = "Mayahumai ";
  ok("derivation ignores case and padding (rotation by case is not a rotation)", G.gateToken() === tok);
  process.env.ACCESS_PASSWORD = "mayahumai2";
  ok("a different password is a different token (rotation revokes)", G.gateToken() !== tok);
  process.env.ACCESS_PASSWORD = WORD;

  // ── 2. the password ────────────────────────────────────────────────────
  console.log("\n── the password ──");
  ok("exact", G.passwordOk("mayahumai"));
  ok("capitalised first letter (mobile keyboard)", G.passwordOk("Mayahumai"));
  ok("trailing space (autocomplete)", G.passwordOk("mayahumai "));
  ok("wrong word", !G.passwordOk("mayahumaii"));
  ok("empty", !G.passwordOk(""));
  ok("undefined does not throw", !G.passwordOk(undefined));
  ok("a prefix is not enough", !G.passwordOk("mayahum"));

  // ── 3. the door, on the real handlers ───────────────────────────────────
  console.log("\n── every cost-bearing endpoint closes the door ──");
  const PROTECTED = ["chat", "speech", "live-token", "search", "gif", "memory", "route", "episodes", "life", "export"];
  const API = join(ROOT, "api");
  const files = readdirSync(API).filter((f) => f.endsWith(".js") && !f.startsWith("_"));
  const handlerNames = files.map((f) => f.replace(/\.js$/, ""));
  for (const name of PROTECTED) {
    ok(`api/${name}.js exists`, handlerNames.includes(name));
    const src = readFileSync(join(API, `${name}.js`), "utf8");
    const opt = src.indexOf('req.method === "OPTIONS"');
    const gate = src.indexOf("if (!gateOk(req, res)) return;");
    ok(`${name}: gateOk sits right after the preflight, before any work`, opt > 0 && gate > opt && gate - opt < 140);
    const mod = (await import(`../api/${name}.js`)).default;
    const res = mkRes();
    await mod(mkReq(), res);
    ok(`${name}: no token -> 401 + X-Maya-Gate`, res.code === 401 && res.headers["x-maya-gate"] === "required", `got ${res.code}`);
    const pre = mkRes();
    await mod(mkReq({ method: "OPTIONS" }), pre);
    ok(`${name}: preflight needs no token`, pre.code === 204);
    ok(`${name}: CORS allows the gate header`, /X-Maya-Gate/.test(String(pre.headers["access-control-allow-headers"])));
    const bad = mkRes();
    await mod(mkReq({ headers: { "x-maya-gate": "0".repeat(64) } }), bad);
    ok(`${name}: wrong token -> 401`, bad.code === 401);
    const short = mkRes();
    await mod(mkReq({ headers: { "x-maya-gate": "x" } }), short);
    ok(`${name}: short token -> 401, no throw`, short.code === 401);
  }
  // The deliberately open ones. Short on purpose: each is here because a
  // caller that cannot hold the token needs it (cron, CI, the page before it
  // has been let in) or because it carries no cost and no person.
  const OPEN = handlerNames.filter((x) => !PROTECTED.includes(x));
  console.log(`  note  open by design: ${OPEN.join(", ")}`);
  ok("the open list has not quietly grown", OPEN.length <= 20, String(OPEN.length));
  for (const name of files.map((f) => f.replace(/\.js$/, ""))) {
    const src = readFileSync(join(API, `${name}.js`), "utf8");
    if (/"Access-Control-Allow-Headers"/.test(src))
      ok(`${name}: preflight allows X-Maya-Gate`, /Content-Type, X-Maya-Gate/.test(src));
  }
  // a valid token passes the gate itself (the handler then does its own work)
  {
    const res = mkRes();
    ok("a correct token opens the door", G.gateOk(mkReq({ headers: { "x-maya-gate": tok } }), res) === true && !res.ended);
  }

  // ── 5. the account ops ──────────────────────────────────────────────────
  console.log("\n── account: status and exchange ──");
  const account = (await import("../api/account.js")).default;
  const call = async (body, ip) => {
    const res = mkRes();
    await account(mkReq({ body, headers: { "x-real-ip": ip } }), res);
    return res;
  };
  let r = await call({ op: "gate_status" }, "10.1.0.1");
  ok("status says required when a password is set", r.code === 200 && r.body.required === true);
  r = await call({ op: "gate", password: "nope" }, "10.1.0.2");
  ok("wrong word -> 401, no token", r.code === 401 && !r.body.token);
  r = await call({ op: "gate", password: "Mayahumai" }, "10.1.0.3");
  ok("right word -> the token", r.code === 200 && r.body.token === tok);
  {
    const ip = "10.1.0.9";
    let last;
    for (let i = 0; i < 10; i++) last = await call({ op: "gate", password: "x" + i }, ip);
    ok("guessing is rate limited (429 inside 10 tries)", last.code === 429, String(last.code));
  }
  delete process.env.ACCESS_PASSWORD;
  r = await call({ op: "gate_status" }, "10.1.0.4");
  ok("status says not required when no password is set", r.code === 200 && r.body.required === false);
  r = await call({ op: "gate", password: "anything" }, "10.1.0.5");
  ok("exchange with no password set hands back an empty token", r.code === 200 && r.body.token === "");
  process.env.ACCESS_PASSWORD = WORD;

  // ── 6. the client wrapper ───────────────────────────────────────────────
  console.log("\n── client wrapper ──");
  const out = join(HERE, ".gate-client.bundle.mjs");
  execSync(
    `npx esbuild ${join(ROOT, "src/engine/gate.ts")} --bundle --format=esm --platform=node --outfile=${out} ` +
      `--log-level=error --alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
    { cwd: ROOT, stdio: "inherit" },
  );
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  globalThis.location = { href: "https://meera-silk.vercel.app/chat", origin: "https://meera-silk.vercel.app" };
  const events = [];
  globalThis.window = globalThis;
  globalThis.dispatchEvent = (e) => (events.push(e.type), true);
  const seen = [];
  let nextResponse = () => new Response("{}", { status: 200 });
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input.url ?? String(input);
    seen.push({ url, headers: new Headers(init?.headers ?? (typeof input === "object" ? input.headers : undefined)) });
    return nextResponse(url, init);
  };
  const C = await import(`${out}?${Date.now()}`);
  C.installGateFetch();
  C.installGateFetch(); // idempotent: a second install must not wrap the wrapper
  seen.length = 0;

  await fetch("/api/chat", { method: "POST" });
  ok("no token yet -> no header", !seen.at(-1).headers.has("x-maya-gate"));

  nextResponse = (url, init) => {
    const b = JSON.parse(init?.body ?? "{}");
    if (b.op === "gate_status") return new Response(JSON.stringify({ required: true }), { status: 200 });
    if (b.op === "gate") {
      if (b.password === "limit") return new Response("{}", { status: 429 });
      if (b.password === "boom") return new Response("{}", { status: 500 });
      return b.password === WORD
        ? new Response(JSON.stringify({ ok: true, token: "TOK" }), { status: 200 })
        : new Response("{}", { status: 401 });
    }
    return new Response("{}", { status: 200 });
  };
  ok("required reported", (await C.fetchGateRequired()) === true);
  ok("wrong word -> 'wrong'", (await C.submitGatePassword("no")) === "wrong" && !C.hasGateToken());
  ok("429 -> 'slow'", (await C.submitGatePassword("limit")) === "slow");
  ok("5xx -> 'offline' (not 'wrong')", (await C.submitGatePassword("boom")) === "offline");
  ok("right word -> 'ok' and the token is kept", (await C.submitGatePassword(WORD)) === "ok" && C.getGateToken() === "TOK");

  seen.length = 0;
  await fetch("/api/memory", { method: "POST", headers: { "Content-Type": "application/json" } });
  ok("own relative /api gets the token", seen.at(-1).headers.get("x-maya-gate") === "TOK");
  ok("it keeps the caller's own headers", seen.at(-1).headers.get("content-type") === "application/json");
  await fetch("https://meera-silk.vercel.app/api/speech", { method: "POST" });
  ok("the production host's /api gets the token (native shell)", seen.at(-1).headers.get("x-maya-gate") === "TOK");
  await fetch("https://generativelanguage.googleapis.com/v1beta/x", { method: "POST" });
  ok("a third party NEVER gets the token", !seen.at(-1).headers.has("x-maya-gate"));
  await fetch("https://evil.example/api/chat", { method: "POST" });
  ok("a lookalike /api path on another host never gets it", !seen.at(-1).headers.has("x-maya-gate"));
  await fetch(new Request("https://meera-silk.vercel.app/api/gif", { method: "POST" }));
  ok("a Request object is handled too", seen.at(-1).headers.get("x-maya-gate") === "TOK");

  events.length = 0;
  nextResponse = () => new Response("{}", { status: 401, headers: { "X-Maya-Gate": "required" } });
  await fetch("/api/chat", { method: "POST" });
  ok("a closed door drops the token", C.getGateToken() === "");
  ok("and tells the app", events.includes(C.GATE_EVENT));
  events.length = 0;
  nextResponse = () => new Response("{}", { status: 401 });
  await C.submitGatePassword(WORD).catch(() => {});
  await fetch("/api/other", { method: "POST" });
  ok("an ordinary 401 (no gate header) is not mistaken for the gate", !events.includes(C.GATE_EVENT));

  globalThis.fetch = async () => {
    throw new Error("network");
  };
  // the wrapper replaced window.fetch, which is globalThis.fetch here; the
  // underlying stub is now the thrower, so both helpers must degrade
  ok("no network -> required is null (UI goes in, server still enforces)", (await C.fetchGateRequired()) === null);
  rmSync(out, { force: true });
} finally {
  if (madeCfg) rmSync(CFG, { force: true });
}

console.log(failed ? `\n${failed} of ${n} gate checks FAILED` : `\nall ${n} gate checks passed`);
process.exit(failed ? 1 : 0);
