// Focused recovery proof: actual store/handler/client/component, synthetic DB and HTTP only.
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import { boundedWaitMs } from "../lib/bounded-wait.mjs";
import { createPrivateTextRehearsalHandler } from "../../api/_private-text-rehearsal.js";
import { PRIVATE_TEXT_LATEST_SQL, discoverLatestPrivateTextRehearsal, privateTextLatestParams } from "../../api/_private-text-rehearsal-store.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const RID = "10000000-0000-4000-8000-000000000001";
const OTHER_RID = "10000000-0000-4000-8000-000000000002";
const OWNER = "60000000-0000-4000-8000-000000000001";
const OTHER_OWNER = "60000000-0000-4000-8000-000000000002";
const PENDING = "70000000-0000-4000-8000-000000000001";
const COMPLETE = "70000000-0000-4000-8000-000000000002";
const BLOCKED = "70000000-0000-4000-8000-000000000003";
const EXPLICIT = "70000000-0000-4000-8000-000000000004";
const SHEET = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const CONSENT = "50000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const CREATED = "2026-10-09T08:00:00.000Z";
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); console.log(`ok ${checks.length} - ${name}`); };

await check("latest SQL is bounded to owner and replica, skips withdrawals, and exports typed params", async () => {
  assert.match(PRIVATE_TEXT_LATEST_SQL, /replica_id=\$1::uuid and h\.owner_user_id=\$2::uuid/);
  assert.match(PRIVATE_TEXT_LATEST_SQL, /state<>'withdrawn'/);
  assert.match(PRIVATE_TEXT_LATEST_SQL, /order by h\.created_at desc,h\.request_id desc limit 1/);
  assert(!/question_envelope|answer_envelope|raw_envelope/.test(PRIVATE_TEXT_LATEST_SQL));
  assert.deepEqual(privateTextLatestParams(OWNER.toUpperCase(), { replica_id: RID.toUpperCase() }), [RID, OWNER]);
});

await check("store discovery returns only the scoped newest non-withdrawn handle and preserves no-result", async () => {
  const rows = [
    { replica_id: RID, owner_user_id: OWNER, request_id: COMPLETE, state: "complete", created_at: CREATED },
    { replica_id: RID, owner_user_id: OTHER_OWNER, request_id: EXPLICIT, state: "complete", created_at: "2026-10-09T09:00:00.000Z" },
    { replica_id: RID, owner_user_id: OWNER, request_id: BLOCKED, state: "withdrawn", created_at: "2026-10-09T10:00:00.000Z" },
  ];
  const db = async (sql, params) => {
    assert.equal(sql, PRIVATE_TEXT_LATEST_SQL);
    return rows.filter(row => row.replica_id === params[0] && row.owner_user_id === params[1] && row.state !== "withdrawn")
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.request_id.localeCompare(a.request_id)).slice(0, 1);
  };
  assert.deepEqual(await discoverLatestPrivateTextRehearsal(db, OWNER, { replica_id: RID }), { replica_id: RID, request_id: COMPLETE, state: "complete", created_at: CREATED });
  assert.equal(await discoverLatestPrivateTextRehearsal(db, OTHER_OWNER, { replica_id: OTHER_RID }), null);
});

await check("GET latest authenticates and performs no admission, budget, or model work", async () => {
  const events = [];
  const req = new EventEmitter(); Object.assign(req, { method: "GET", query: { op: "latest", replica_id: RID }, body: {}, aborted: false });
  const res = new EventEmitter(); Object.assign(res, { destroyed: false, writableEnded: false, status(code) { this.code = code; return this; }, json(body) { this.body = body; this.writableEnded = true; return this; } });
  const store = { async discoverLatestPrivateTextRehearsal(_db, owner, input) { events.push(["discover", owner, input.replica_id]); return { replica_id: RID, request_id: COMPLETE, state: "complete", created_at: CREATED }; } };
  const refused = name => async () => { events.push([name]); throw new Error(`${name}_must_not_run`); };
  const handler = createPrivateTextRehearsalHandler({ db: refused("db"), requireUser: async () => { events.push(["auth"]); return { id: OWNER }; }, store,
    resolveGenerator: refused("generator"), engine: {}, gateReply: refused("gate"), hasGate: () => false, honestyContextFor: refused("honesty"), loadNeverRules: refused("rules"), compileNeverRules: refused("compile") });
  await handler(req, res);
  assert.equal(res.code, 200); assert.equal(res.body.latest.request_id, COMPLETE);
  assert.deepEqual(events, [["auth"], ["discover", OWNER, RID]]);
});

const apiSource = readFileSync(join(root, "src/studio/privateTextRehearsalApi.ts"), "utf8")
  .replace('import { replicaRequest } from "./replicaApi";', 'const replicaRequest = async () => { throw new Error("network forbidden"); };');
const apiJs = ts.transpileModule(apiSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
const api = await import("data:text/javascript;base64," + Buffer.from(apiJs).toString("base64"));
await check("public discovery validator rejects cross-replica, withdrawn, and malformed handles", async () => {
  const valid = { replica_id: RID, request_id: COMPLETE, state: "complete", created_at: CREATED };
  assert.equal(api.validatePrivateTextLatest(valid, RID).request_id, COMPLETE); assert.equal(api.validatePrivateTextLatest(null, RID), null);
  for (const mutate of [value => value.replica_id = OTHER_RID, value => value.request_id = "bad", value => value.state = "withdrawn", value => value.created_at = "invalid"])
    { const value = structuredClone(valid); mutate(value); assert.throws(() => api.validatePrivateTextLatest(value, RID)); }
});

const statements = [
  { id: "authorize_private_text_question", text: "Use this selected material to answer this one private question with AI." },
  { id: "understand_ai_text_only", text: "This is an AI text test. It does not authorize voice, identity verification, training or publication." },
  { id: "understand_private_retention_and_withdrawal", text: "Keep this private question and answer until I remove the test, its source or this AI. I can withdraw this permission." },
];
const readiness = replicaId => ({ replica_id: replicaId, state: "ready", blockers: [], drafts: [{ sheet_id: SHEET, name: "Owner profile", updated_at: CREATED, status: "draft" }],
  context_items: [{ item_id: ITEM, source_name: "owner.txt", status: "extracted", eligible: true }],
  selected: { sheet_id: SHEET, sheet_hash: HASH, context_item_id: ITEM, context_hash: HASH, source_id: SOURCE, source_hash: HASH, evidence_hash: HASH,
    authority_epoch: "1", snapshot_hash: HASH, material: { draft: { name: "Owner profile", identityWho: "A careful explainer", sheetKind: "person" }, context: { source_name: "owner.txt", format: "text", body: "Private source text." } } },
  statement_set: "private-text-rehearsal/v1", statements, grant_scope: "private_text_rehearsal", can_ask: true });
const result = (requestId, state) => ({ replica_id: RID, request_id: requestId, state,
  consent: { consent_id: CONSENT, receipt_hash: HASH, statement_set: "private-text-rehearsal/v1", expires_at: "2026-11-08T08:00:00.000Z" },
  source: { sheet_kind: "person", sheet_id: SHEET, sheet_hash: HASH, context_item_id: ITEM, source_id: SOURCE, source_hash: HASH, evidence_hash: HASH },
  billing_state: state === "pending" ? "in_flight" : state === "blocked" ? "not_started" : "settled", can_voice: false, created_at: CREATED,
  ...(state === "complete" ? { answer: "Recovered private answer." } : {}), ...(state === "blocked" ? { failure_code: "rehearsal_inputs_changed", can_review_teaching: true } : {}) });

let scenario = "none"; let requests = []; let delayed = [];
const latestForScenario = () => scenario === "pending" ? { replica_id: RID, request_id: PENDING, state: "pending", created_at: CREATED }
  : scenario === "complete" ? { replica_id: RID, request_id: COMPLETE, state: "complete", created_at: CREATED }
  : scenario === "blocked" ? { replica_id: RID, request_id: BLOCKED, state: "blocked", created_at: CREATED } : null;
const artifact = join(root, "scratchpad/private-text-recovery", String(Date.now())); mkdirSync(artifact, { recursive: true });
let browser, server;
try {
  const built = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true, rolldownOptions: { input: { recovery: join(root, "evals/private-text-recovery/scope.html") } } } });
  const assets = new Map(built.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost");
    const send = (status, body) => { if (res.destroyed || res.writableEnded) return; res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (url.pathname === "/api/replica-text-rehearsal") {
      let raw = ""; for await (const chunk of req) raw += chunk; const body = raw ? JSON.parse(raw) : {};
      const op = url.searchParams.get("op") || body.op; const replicaId = url.searchParams.get("replica_id") || body.replica_id;
      requests.push({ op, method: req.method, replicaId, auth: req.headers.authorization });
      if (op === "readiness") return send(200, { readiness: readiness(replicaId) });
      if (op === "latest") {
        if (scenario === "failure") return send(503, { error: "rehearsal_discovery_unavailable" });
        if (scenario === "auth") return send(401, { error: "auth_required" });
        if (scenario === "late") { delayed.push(() => send(200, { latest: { replica_id: RID, request_id: COMPLETE, state: "complete", created_at: CREATED } })); return; }
        return send(200, { latest: latestForScenario() });
      }
      if (op === "result") {
        const requestId = url.searchParams.get("request_id");
        const state = requestId === PENDING ? "pending" : requestId === BLOCKED ? "blocked" : "complete";
        return send(200, { rehearsal: result(requestId, state) });
      }
      if (op === "ask") return send(500, { error: "unexpected_automatic_post" });
      return send(400, { error: "unexpected_op" });
    }
    const path = url.pathname === "/recovery" ? "/evals/private-text-recovery/scope.html" : url.pathname;
    if (assets.has(path)) { res.writeHead(200, { "content-type": ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css" })[extname(path)] || "application/octet-stream" }); return res.end(assets.get(path)); }
    res.writeHead(404); res.end("missing");
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchSuiteBrowser("private-text-recovery");
  const page = await browser.newPage(); page.setDefaultTimeout(boundedWaitMs(15000));
  await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const open = async (nextScenario, query = "") => { scenario = nextScenario; requests = []; delayed = []; await page.goto(`${origin}/recovery?replica=${RID}&view=rehearsal${query}`); await page.locator("#ptr-title").waitFor(); };
  const latestCount = () => requests.filter(row => row.op === "latest").length;
  const postCount = () => requests.filter(row => row.method === "POST").length;

  for (const [name, requestId, visibleText] of [["pending", PENDING, "An answer is not confirmed yet"], ["complete", COMPLETE, "Recovered private answer."]]) {
    await check(`fresh browser restores the ${name} request with GET only`, async () => {
      await open(name); await page.getByText(visibleText, { exact: false }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get("rehearsal_request"), requestId); assert.equal(latestCount(), 1); assert.equal(postCount(), 0);
    });
  }
  await check("no scoped result leaves the explicit composer and performs no POST", async () => {
    await open("none"); await page.locator("#ptr-question").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("rehearsal_request"), false); assert.equal(latestCount(), 1); assert.equal(postCount(), 0);
  });
  await check("a valid request in the URL wins and skips discovery", async () => {
    await open("failure", `&rehearsal_request=${EXPLICIT}`); await page.getByText("Recovered private answer.").waitFor();
    assert.equal(latestCount(), 0); assert.equal(requests.filter(row => row.op === "result").length, 1); assert.equal(postCount(), 0);
  });
  await check("an older request from another owner is indistinguishable from no result", async () => {
    await open("foreign"); await page.locator("#ptr-question").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("rehearsal_request"), false); assert.equal(postCount(), 0);
  });
  await check("failed discovery blocks composition until one explicit successful retry", async () => {
    await open("failure"); await page.getByRole("heading", { name: "We could not check for an earlier private test." }).waitFor();
    assert.equal(await page.locator("#ptr-question").count(), 0); assert.equal(postCount(), 0);
    scenario = "none"; await page.getByRole("button", { name: "Try again" }).click(); await page.locator("#ptr-question").waitFor();
    assert.equal(latestCount(), 2); assert.equal(postCount(), 0);
  });
  await check("discovery authentication failure is reported to the owner shell and never posts", async () => {
    await open("auth"); await page.getByRole("heading", { name: "We could not check for an earlier private test." }).waitFor();
    assert.equal(await page.evaluate(() => window.privateTextRecoveryProbe.authErrors()), 1); assert.equal(postCount(), 0);
  });
  await check("Prepare another question does not immediately rediscover the closed request", async () => {
    await open("blocked"); await page.getByRole("button", { name: "Prepare another question" }).waitFor(); const before = latestCount();
    await page.getByRole("button", { name: "Prepare another question" }).click(); await page.locator("#ptr-question").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("rehearsal_request"), false); assert.equal(latestCount(), before); assert.equal(postCount(), 0);
  });
  for (const change of ["changeToken", "changeReplica", "logout"]) await check(`late discovery after ${change} cannot restore the old handle`, async () => {
    await open("late"); await page.getByRole("heading", { name: "Checking for your saved private test." }).waitFor();
    scenario = "none"; await page.evaluate(method => window.privateTextRecoveryProbe[method](), change);
    if (change !== "logout") await page.locator("#ptr-question").waitFor();
    delayed.splice(0).forEach(release => release()); await page.waitForTimeout(80);
    assert.equal(new URL(page.url()).searchParams.has("rehearsal_request"), false); assert.equal(postCount(), 0);
  });
  assert.equal(requests.some(row => row.auth && !row.auth.startsWith("Bearer ")), false);
  writeFileSync(join(artifact, "result.json"), JSON.stringify({ at: new Date().toISOString(), checks, requests, scope: "Actual store/handler/client/component with synthetic DB and HTTP. No provider, cloud, identity, or live PostgreSQL." }, null, 2));
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
console.log(`PASS ${checks.length} private text recovery groups; artifact ${artifact}`);
