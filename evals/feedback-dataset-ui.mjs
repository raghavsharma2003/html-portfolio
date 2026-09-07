// Headless repository regression harness: real ExpertConversation, TurnFeedback
// and correction panel, synthetic loopback HTTP only. Not owner/model evidence.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { build } from "vite";
import { buildFeedbackDatasetDefinition } from "../api/_replica-feedback-dataset.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const CAP = "20000000-0000-4000-8000-000000000001", TURN = "30000000-0000-4000-8000-000000000001";
const now = "2026-09-07T00:00:00Z";
const entry = join(root, "__feedback_dataset_fixture__.tsx");
const contents = `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client';
import '@fontsource-variable/instrument-sans'; import './src/studio/design/tokens.css'; import './src/studio/studio.css';
import './src/studio/design/honesty.css'; import './src/studio/design/mobile.css';
import ExpertConversation from './src/studio/ExpertConversation';
const authError=()=>{};
function Fixture(){ const [rid,setRid]=useState('${RID}'); return <main>
<p className="fixture-disclosure">Synthetic UI fixture. No model or owner data.</p>
<button id="switch-replica" onClick={()=>setRid('${OTHER}')}>Switch synthetic AI</button>
<ExpertConversation key={rid} token="synthetic-token" replicaId={rid} stopped={false} onAuthError={authError}/></main>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const result = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: "fixture.js" } } },
  plugins: [{ name: "synthetic-correction-fixture", resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return contents; } }] });
const assets = new Map(result.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
const css = result.output.filter(item => item.fileName.endsWith(".css")).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join("");
let count = 0, saved = null, readCount = 0, posts = [], feedbackPending = null, heldRead = null;
let holdFeedback = false, holdRead = false, mode = "normal";
const rows = (n = count) => Array.from({ length: n }, (_, index) => ({ feedback_id: `30000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  turn_id: `40000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, session_id: TURN, revision: 1,
  profile_version: 1, calibration_version: 1, ratings: { wording: "exact" }, ratings_hash: "a".repeat(64), response_hash: "b".repeat(64) }));
function review(rid = RID) {
  const built = buildFeedbackDatasetDefinition(rows(rid === OTHER ? 7 : count), [], { replica_id: rid, capability_id: CAP, profile_version: 1, calibration_version: 1 });
  const dataset = rid === OTHER ? null : saved;
  const changed = !!dataset && dataset.source_set_hash !== built.source_set_hash;
  return { replica_id: rid, state: !built.definition.examples.length ? "empty" : changed ? "stale" : "collecting", can_build: built.definition.examples.length > 0,
    binding: { capability_id: CAP, profile_version: 1, calibration_version: 1 }, source_set_hash: built.source_set_hash,
    stats: built.definition.stats, readiness: built.readiness, dataset, changed_since_saved: changed, checked_at: now };
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/")) {
    assert.equal(req.headers.authorization, "Bearer synthetic-token");
    if (url.pathname === "/api/replica-runtime") return json(200, { runtime: { replica_id: url.searchParams.get("replica_id"), active: true } });
    let body = ""; for await (const part of req) body += part;
    const data = body ? JSON.parse(body) : {};
    if (url.pathname === "/api/replica-dialogue" && req.method === "GET") return json(200, { history: {
      replica_id: url.searchParams.get("replica_id"), session_id: null, exchanges: [], pending: false, billing_pending: false, latest_request: null,
    } });
    if (url.pathname === "/api/replica-dialogue" && data.op === "open_session") return json(201, { session: { replica_id: data.replica_id, session_id: data.session_id } });
    if (url.pathname === "/api/replica-dialogue") return json(200, { turn: { turn_id: TURN, session_id: data.session_id, reply: "Synthetic answer for the correction workflow.", can_voice: false } });
    if (url.pathname === "/api/replica-feedback" && req.method === "GET") return json(200, { current: { replica_id: url.searchParams.get("replica_id"), turn_id: url.searchParams.get("turn_id"), feedback: null, correction: "" } });
    if (url.pathname === "/api/replica-feedback") {
      const finish = () => { count++; json(200, { feedback: { feedback_id: TURN, turn_id: TURN, revision: count, ratings: data.ratings, reason_codes: [], has_correction: false, voice_generation_bound: false, created_at: now } }); };
      if (holdFeedback) { feedbackPending = finish; return; } return finish();
    }
    if (url.pathname === "/api/replica-feedback-dataset" && req.method === "GET") {
      readCount++; const body = { review: review(url.searchParams.get("replica_id")) };
      if (holdRead) { holdRead = false; heldRead = () => json(200, body); return; } return json(200, body);
    }
    if (url.pathname === "/api/replica-feedback-dataset" && req.method === "POST") {
      posts.push(data);
      if (mode === "stale") { mode = "normal"; count++; return json(409, { error: "feedback_dataset_review_changed" }); }
      assert.equal(data.expected_source_set_hash, review(data.replica_id).source_set_hash);
      saved = { dataset_id: TURN, version: 1, capability_id: CAP, profile_version: 1, calibration_version: 1,
        source_set_hash: data.expected_source_set_hash, status: "draft", created_at: now };
      // The write committed, but its success body cannot be decoded. A bare
      // socket close may be transparently retried by Chromium's HTTP stack,
      // so use a deterministic unreadable receipt for this UI recovery test.
      if (mode === "uncertain") { mode = "normal"; res.writeHead(201, { "content-type": "application/json" }); return res.end('{"incomplete":'); }
      return json(201, { dataset: saved, review: review(data.replica_id) });
    }
    return json(404, { error: "synthetic_route_not_available" });
  }
  if (assets.has(url.pathname)) {
    const mime = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" }[extname(url.pathname)] || "application/octet-stream";
    res.writeHead(200, { "content-type": mime }); return res.end(assets.get(url.pathname));
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1">${css}
<style>body{margin:0;background:#f8f8f5;color:#253d31;font-family:'Instrument Sans Variable',sans-serif}main{padding:24px;max-width:860px;margin:auto}.fixture-disclosure{font-size:12px}#switch-replica{min-height:44px;margin-bottom:20px}</style>
</head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const checks = [], artifactDir = join(root, "scratchpad/correction-ui"); mkdirSync(artifactDir, { recursive: true });
try {
  // Same isolated headless test infrastructure as other repository UI evals.
  const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) {
    count = 0; saved = null; posts = []; readCount = 0; mode = "normal"; holdRead = false; heldRead = null;
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", e => errors.push(e.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin); await page.getByText("No eligible feedback for this AI version", { exact: true }).first().waitFor();
    const summary = page.locator(".feedback-dataset > summary");
    await summary.focus(); await page.keyboard.press("Enter");
    assert.equal(await page.locator(".feedback-dataset").getAttribute("open"), "");
    assert.equal(await page.getByRole("button", { name: "Prepare correction set", exact: true }).count(), 0);
    checks.push(`${width}: keyboard opens honest empty state`);
    await page.getByLabel("Ask your AI", { exact: true }).fill("Synthetic correction question");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("button", { name: "Teach a correction", exact: true }).click();
    holdFeedback = true; const beforeFeedback = readCount;
    await page.getByRole("button", { name: "This is me", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".turn-feedback button")?.disabled === true);
    assert.equal(readCount, beforeFeedback, "pending feedback does not refresh or claim saved evidence");
    assert(feedbackPending); feedbackPending(); feedbackPending = null; holdFeedback = false;
    await page.getByText("1 saved example across 1 conversation.", { exact: true }).waitFor();
    assert.equal(readCount, beforeFeedback + 1); checks.push(`${width}: actual persisted TurnFeedback callback refreshes current counts`);
    mode = "stale";
    const prepare = page.getByRole("button", { name: "Prepare correction set", exact: true });
    await prepare.click();
    await page.getByText("2 saved examples across 1 conversation.", { exact: true }).waitFor();
    await page.getByText("The current corrections or AI version changed. Review the updated counts before preparing again.", { exact: true }).waitFor();
    assert.equal(posts.length, 1); assert.equal(saved, null);
    assert.equal(await prepare.evaluate(element => element === document.activeElement), true, "focus survives readback after 409");
    checks.push(`${width}: 409 refetches new counts without automatic POST retry`);
    await prepare.click(); await page.getByText("Set 1 saved for evaluation.", { exact: true }).waitFor();
    assert.equal(posts.length, 2); assert.equal(posts[1].expected_source_set_hash, saved.source_set_hash);
    await page.getByText("What is still needed", { exact: true }).click();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
    assert.equal(overflow, false); assert.equal(errors.length, 0);
    await page.screenshot({ path: join(artifactDir, `corrections-${width}.png`), fullPage: true });
    checks.push(`${width}: exact receipt, expanded requirements, no page overflow or runtime errors`);
    mode = "uncertain"; const beforeUncertain = readCount;
    await prepare.click(); await page.getByText("The save response could not be verified. Check the current saved status before preparing again.", { exact: true }).waitFor();
    await page.getByText("Set 1: Draft.", { exact: true }).waitFor();
    assert.equal(posts.length, 3); assert.equal(readCount, beforeUncertain + 1);
    assert.equal(await prepare.evaluate(element => element === document.activeElement), true, "focus survives uncertain save readback");
    assert.equal(await page.getByText("Set 1 saved for evaluation.", { exact: true }).count(), 0);
    checks.push(`${width}: unreadable POST success recovers stored receipt without a success notice or retry`);
    holdRead = true;
    await page.locator(".feedback-dataset").getByRole("button", { name: "Check again", exact: true }).click();
    await page.getByText("Checking current corrections", { exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Switch synthetic AI", exact: true }).click();
    await page.locator(".feedback-dataset > summary").click();
    await page.getByText("7 saved examples across 1 conversation.", { exact: true }).waitFor();
    assert(heldRead); heldRead(); heldRead = null;
    await page.getByLabel("Ask your AI", { exact: true }).fill("New replica remains selected");
    assert.equal(await page.getByText("7 saved examples across 1 conversation.", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Set 1: Draft.", { exact: true }).count(), 0);
    checks.push(`${width}: delayed former-replica read cannot replace new replica state`);
    await page.close();
  }
  const report = { passed: checks.length, checks, artifactDir, scope: "Real component and API caller code with synthetic loopback responses; no live auth, database or model." };
  writeFileSync(join(artifactDir, 'result.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
} catch (error) {
  writeFileSync(join(artifactDir, 'failure.json'), JSON.stringify({ checks, posts: posts.length, readCount, message: String(error.message) }, null, 2)); throw error;
} finally { heldRead?.(); feedbackPending?.(); await browser?.close(); await new Promise(resolve => server.close(resolve)); }
