// Real mounted Meet and its HTTP client; synthetic loopback server only.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { build } from "vite";
const root = fileURLToPath(new URL("../", import.meta.url));
const old = process.argv.includes("--old-code");
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const SESSION = "20000000-0000-4000-8000-000000000001";
const entry = join(root, "__dialogue_history_fixture__.tsx");
const oldSource = old ? execFileSync("git", ["show", "68283658:src/studio/ExpertConversation.tsx"], { cwd: root, encoding: "utf8" }) : null;
const contents = `import React,{useState} from 'react';import{createRoot}from'react-dom/client';
import '@fontsource-variable/instrument-sans';import './src/studio/design/tokens.css';import './src/studio/studio.css';
import './src/studio/design/honesty.css';import './src/studio/design/mobile.css';import ExpertConversation from './src/studio/ExpertConversation';
const authError=()=>{};function Fixture(){const[rid,setRid]=useState('${RID}');const[token,setToken]=useState('synthetic-owner-a');const[visible,setVisible]=useState(true);const[stopped,setStopped]=useState(false);
window.dialogueFixture={setRid,setToken,setVisible,setStopped};return <main><p>Synthetic conversation fixture. No real owner or model.</p>
{visible&&<ExpertConversation token={token} replicaId={rid} stopped={stopped} lifecycle={stopped?'paused':'active'} onAuthError={authError}/>}</main>}
createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const result = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: "fixture.js" } } }, plugins: [{ name: "dialogue-history-fixture",
    resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return contents;
      if (oldSource && id.replaceAll("\\", "/") === join(root, "src/studio/ExpertConversation.tsx").replaceAll("\\", "/")) return oldSource; } }] });
const assets = new Map(result.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
const css = result.output.filter(item => item.fileName.endsWith(".css")).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join("");
const sessions = new Map(), requests = [], held = [];
let readFail = false, holdRead = false, uncertainReply = false, holdReply = false, releaseReply = null, uncertainOpen = false, privateMode = '';
const delivery = { mode: "grounded", pace: "natural", intensity: 0.2, language_hint: "English", nonverbals: [] };
function exchange(sid, question, reply, trace = "synthetic-earlier") { return { question, trace_id: trace, answer: { turn_id: randomUUID(), session_id: sid,
  reply, delivery, can_voice: false, billing_state: "not_metered", created_at: "2026-09-07T00:00:00Z" } }; }
function create(sid, rid, token, earlier = false) {
  const session = { replica_id: rid, token, session_id: sid, exchanges: earlier ? [exchange(sid, "Earlier synthetic question", "Earlier synthetic answer")] : [],
    pending: false, billing_pending: false, latest_request: null };
  sessions.set(sid, session); return session;
}
function snapshot(rid, token, sid) {
  const s = sid ? sessions.get(sid) : [...sessions.values()].filter(s => s.replica_id === rid && s.token === token).at(-1);
  if (s && s.replica_id === rid && s.token === token) { const { token: _, ...history } = s; return structuredClone(history); }
  if (sid) return null;
  return { replica_id: rid, session_id: null, exchanges: [], pending: false, billing_pending: false, latest_request: null };
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (code, value) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(value)); };
  if (url.pathname.startsWith("/api/")) {
    const token = req.headers.authorization?.replace("Bearer ", ""); assert(["synthetic-owner-a", "synthetic-owner-b"].includes(token));
    let raw = ""; for await (const part of req) raw += part; const body = raw ? JSON.parse(raw) : {};
    requests.push({ method: req.method, path: url.pathname, token, query: Object.fromEntries(url.searchParams), body });
    if (url.pathname === "/api/replica-runtime") return json(200, { runtime: { replica_id: url.searchParams.get("replica_id"), active: privateMode !== 'unavailable',
      ...(privateMode ? {private_selection:true,private_candidate:false,can_activate:false,exposure:'owner_private_text',
        capability_id:privateMode==='unavailable'?null:'10000000-0000-4000-8000-000000000009',
        blockers:privateMode==='unavailable'?['private_selection_unavailable']:[]} : {}) } });
    if (url.pathname === '/api/replica-candidate-activation') {
      assert.deepEqual(body,{op:'status',replica_id:RID});
      return json(200,{replica_id:RID,candidate_id:null,active_capability_id:'10000000-0000-4000-8000-000000000009',can_reset:false,reset_target_capability_id:null});
    }
    if (url.pathname === "/api/replica-feedback-dataset") return json(200, { review: { replica_id: url.searchParams.get("replica_id"), state: "inactive",
      can_build: false, binding: null, stats: null, source_set_hash: null, dataset: null, changed_since_saved: false, checked_at: "2026-09-07T00:00:00Z",
      readiness: { ready_for_candidate_dataset: false, blockers: ["synthetic_fixture"] } } });
    if (url.pathname !== "/api/replica-dialogue") return json(404, { error: "synthetic_unavailable" });
    if (req.method === "GET") {
      const h = snapshot(url.searchParams.get("replica_id"), token, url.searchParams.get("session_id"));
      const finish = () => readFail ? json(503, { error: "synthetic_read_unavailable" }) : h ? json(200, { history: h }) : json(409, { error: "dialogue_session_not_authorized" });
      if (holdRead) { holdRead = false; held.push(finish); return; } return finish();
    }
    if (body.op === "open_session") {
      if (!sessions.has(body.session_id)) create(body.session_id, body.replica_id, token);
      if (uncertainOpen) { uncertainOpen = false; res.writeHead(201, { "content-type": "application/json" }); return res.end("{"); }
      return json(201, { session: { replica_id: body.replica_id, session_id: body.session_id } });
    }
    const sid = body.session_id || randomUUID(); const session = sessions.get(sid) || create(sid, body.replica_id, token);
    assert.equal(session.replica_id, body.replica_id); assert.equal(session.token, token);
    session.pending = true; session.latest_request = { trace_id: body.trace_id || "old-no-trace", state: "generating" };
    const finish = () => {
      const item = exchange(sid, body.message, "Completed synthetic reply: " + body.message, body.trace_id || "old-no-trace");
      session.exchanges.push(item); session.pending = false; session.latest_request.state = "complete";
      if (uncertainReply) { uncertainReply = false; res.writeHead(200, { "content-type": "application/json" }); return res.end("{"); }
      json(200, { turn: item.answer });
    };
    if (holdReply) { holdReply = false; releaseReply = finish; return; } finish(); return;
  }
  if (assets.has(url.pathname)) { res.writeHead(200, { "content-type": ({ ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" })[extname(url.pathname)] || "application/octet-stream" }); return res.end(assets.get(url.pathname)); }
  res.writeHead(200, { "content-type": "text/html" }); res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">${css}
<style>body{margin:0;background:#f8f8f5;color:#253d31;font-family:'Instrument Sans Variable',sans-serif}main{padding:24px;max-width:860px;margin:auto}</style></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`, checks = [];
const artifact = join(root, "scratchpad/dialogue-history-ui", `${Date.now()}${old ? "-old" : ""}`); mkdirSync(artifact, { recursive: true });
let browser;
const generationRequests = () => requests.filter(x => x.path === "/api/replica-dialogue" && x.method === "POST" && !x.body.op);
try {
  const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true });
  for (const width of old ? [390] : [390, 1440]) {
    sessions.clear(); requests.length = 0; readFail = false; privateMode = ''; create(SESSION, RID, "synthetic-owner-a", true);
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" }); const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const ask = () => page.getByLabel("Ask your AI", { exact: true });
    const send = async text => { await ask().fill(text); await page.getByRole("button", { name: "Send", exact: true }).click(); };
    const check = () => page.getByRole("button", { name: "Check conversation", exact: true }).click();
    const remount = async () => { await page.evaluate(() => window.dialogueFixture.setVisible(false)); await page.locator(".expert-conversation").waitFor({ state: "detached" }); await page.evaluate(() => window.dialogueFixture.setVisible(true)); };
    await page.goto(origin);
    if (old) {
      await page.getByRole("heading", { name: "Try a real question.", exact: true }).waitFor();
      assert.equal(await page.getByText("Earlier synthetic answer", { exact: true }).count(), 0);
      assert.equal(requests.filter(r => r.path === "/api/replica-dialogue" && r.method === "GET").length, 0);
      await send("Old component loses session"); await page.getByText("Completed synthetic reply: Old component loses session", { exact: true }).waitFor();
      assert.equal(generationRequests()[0].body.session_id, undefined);
      checks.push("executed exact68283658component does not restore existing conversation and dispatches without its session"); await page.close(); continue;
    }
    await page.getByText("Earlier synthetic answer", { exact: true }).waitFor();
    assert.equal(generationRequests().length, 0); assert.equal(sessions.size, 1); checks.push(`${width}: prior completed pair restored without session or model write`);
    await send("Continue the prior plan"); await page.getByText("Completed synthetic reply: Continue the prior plan", { exact: true }).waitFor();
    assert.equal(generationRequests()[0].body.session_id, SESSION); assert.match(generationRequests()[0].body.trace_id, /^dialogue_/);
    await remount(); await page.getByText("Completed synthetic reply: Continue the prior plan", { exact: true }).waitFor();
    assert.equal(await page.getByText("Earlier synthetic answer", { exact: true }).count(), 1); assert.equal(generationRequests().length, 1);
    checks.push(`${width}: actual component remount retains session and completed pairs`);
    readFail = true; await remount(); await page.getByText("We could not restore this conversation. Check again before sending another message.", { exact: true }).waitFor();
    assert.equal(await ask().isDisabled(), true); readFail = false; await check(); await page.getByText("Earlier synthetic answer", { exact: true }).waitFor();
    checks.push(`${width}: failed history is visible and prevents send until successful explicit read`);
    await page.getByRole("button", { name: "New conversation", exact: true }).click(); await page.getByRole("heading", { name: "Try a real question.", exact: true }).waitFor();
    assert.equal(generationRequests().length, 1); assert.equal(sessions.size, 2);
    assert.equal(await page.getByText("Earlier synthetic answer", { exact: true }).count(), 0);
    const newId = [...sessions.keys()].at(-1); await send("New conversation question"); await page.getByText("Completed synthetic reply: New conversation question", { exact: true }).waitFor();
    assert.equal(generationRequests().at(-1).body.session_id, newId); checks.push(`${width}: explicit new session is empty before first send and keeps its stable ID`);
    uncertainReply = true; const before = generationRequests().length;
    await send("Recover committed reply"); await page.getByText("Your saved reply has been recovered.", { exact: true }).waitFor();
    assert.equal(await page.getByText("Completed synthetic reply: Recover committed reply", { exact: true }).count(), 1);
    assert.equal(generationRequests().length, before + 1); assert.equal(await ask().inputValue(), "");
    checks.push(`${width}: undecodable committed reply recovers by exact-session read without generation retry`);
    await page.reload(); await page.getByText("Completed synthetic reply: Recover committed reply", { exact: true }).waitFor();
    assert.equal(generationRequests().length, before + 1); checks.push(`${width}: browser reload restores last actual session without browser-stored conversation data`);
    const currentSession = sessions.get(newId); currentSession.billing_pending = true;
    currentSession.exchanges.at(-1).answer.billing_state = "reconcile_required";
    await check(); await page.getByRole("heading", { name: "Reply saved", exact: true }).waitFor();
    assert.equal(await ask().isDisabled(), true); assert.equal(await page.getByRole("button", { name: "New conversation", exact: true }).isDisabled(), true);
    currentSession.billing_pending = false; currentSession.exchanges.at(-1).answer.billing_state = "settled";
    await check(); await page.waitForFunction(() => document.querySelector('#expert-question')?.disabled === false);
    checks.push(`${width}: restored unsettled usage blocks send and new session until actual read changes`);
    holdReply = true; await send("Pending over navigation"); await page.waitForFunction(() => document.querySelector('.expert-conversation__working'));
    // Wait for the server request witness, not an elapsed delay.
    while (!releaseReply) await new Promise(resolve => setImmediate(resolve));
    await remount(); await page.getByText("We are checking the previous reply and its usage. Check the conversation before sending again.", { exact: true }).waitFor();
    assert.equal(await ask().isDisabled(), true); const pendingCount = generationRequests().length;
    releaseReply(); releaseReply = null; await check(); await page.getByText("Completed synthetic reply: Pending over navigation", { exact: true }).waitFor();
    assert.equal(generationRequests().length, pendingCount); checks.push(`${width}: pending request survives navigation without a second generation`);
    await page.screenshot({ path: join(artifact, `restored-${width}.png`), fullPage: true });
    uncertainOpen = true; const beforeOpen = sessions.size;
    await page.getByRole("button", { name: "New conversation", exact: true }).click();
    await page.getByRole("button", { name: "Retry opening conversation", exact: true }).waitFor(); assert.equal(await ask().isDisabled(), true);
    const openId = [...sessions.keys()].at(-1); await page.getByRole("button", { name: "Retry opening conversation", exact: true }).click();
    await page.getByRole("heading", { name: "Try a real question.", exact: true }).waitFor();
    assert.equal(sessions.size, beforeOpen + 1); assert.equal([...sessions.keys()].at(-1), openId);
    checks.push(`${width}: uncertain open retries the same UUID and cannot create a second session`);
    const runtimeReads = () => requests.filter(item => item.path === '/api/replica-runtime').length;
    const readsBeforeInvalidation = runtimeReads();
    await page.evaluate(other => {
      window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed', {detail: {replica_id: other, capability_id: '10000000-0000-4000-8000-000000000009'}}));
      window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed', {detail: {replica_id: '10000000-0000-4000-8000-000000000001', capability_id: 'invalid'}}));
    }, OTHER);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(runtimeReads(), readsBeforeInvalidation);
    holdReply = true; await send('Pending during version selection');
    while (!releaseReply) await new Promise(resolve => setImmediate(resolve));
    const generationBeforeSwitch = generationRequests().length, sessionsBeforeSwitch = sessions.size;
    privateMode = 'baseline';
    await page.evaluate(rid => window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed', {
      detail: {replica_id: rid, capability_id: '10000000-0000-4000-8000-000000000009'},
    })), RID);
    await page.getByText('We are checking the previous reply and its usage. Check the conversation before sending again.', {exact: true}).waitFor();
    assert.equal(await ask().isDisabled(), true);
    assert.equal(await page.getByRole('button', {name: 'New conversation', exact: true}).isDisabled(), true);
    assert.equal(generationRequests().length, generationBeforeSwitch); assert.equal(sessions.size, sessionsBeforeSwitch);
    const pendingPrior=sessions.get(openId);sessions.delete(openId);await check();
    await page.getByText('We could not restore this conversation. Check again before sending another message.',{exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'New conversation',exact:true}).isDisabled(),true);
    sessions.set(openId,pendingPrior);
    releaseReply(); releaseReply = null; await check();
    await page.getByText('Completed synthetic reply: Pending during version selection', {exact: true}).waitFor();
    assert.equal(await ask().isDisabled(), true);
    await remount();
    await page.getByText('Your private version changed. Start a new conversation after the previous reply is checked.', {exact: true}).waitFor();
    await page.waitForFunction(() => !document.querySelector('.expert-conversation__actions button')?.disabled);
    await page.getByRole('button', {name: 'New conversation', exact: true}).click();
    await page.getByRole('heading', {name: 'Try a real question.', exact: true}).waitFor();
    const switchedSession = [...sessions.keys()].at(-1); assert.notEqual(switchedSession, openId);
    await send('First question after version selection');
    await page.getByText('Completed synthetic reply: First question after version selection', {exact: true}).waitFor();
    assert.equal(generationRequests().at(-1).body.session_id, switchedSession);
    assert.equal(generationRequests().length, generationBeforeSwitch + 1);
    checks.push(`${width}: scoped runtime event preserves pending work across remount, requires explicit fresh session, next answer uses new session`);
    sessions.get(switchedSession).exchanges.at(-1).answer.can_voice = true;
    await check();
    assert.equal(await page.getByRole('button',{name:'Listen',exact:true}).isDisabled(),true);
    privateMode = 'unavailable'; await check();
    await page.getByRole('heading',{name:'Your private version is unavailable',exact:true}).waitFor();
    assert.equal(await ask().isDisabled(),true);
    assert.equal(await page.getByRole('link',{name:'Open conversation setup',exact:true}).count(),0);
    assert.equal(await page.getByText('private_selection_unavailable',{exact:true}).count(),0);
    privateMode = 'baseline'; await page.getByRole('button',{name:'Check again',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#expert-question')?.disabled===false);
    checks.push(`${width}: private baseline remains text only and unavailable selection is a platform issue without setup blame`);
    sessions.delete(switchedSession);
    await page.evaluate(rid=>window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed',{
      detail:{replica_id:rid,capability_id:'10000000-0000-4000-8000-000000000008'},
    })),RID);
    await page.getByText('The previous conversation is unavailable. You can explicitly start a new conversation.',{exact:true}).waitFor();
    assert.equal(await ask().isDisabled(),true);
    assert.equal(await page.getByText('Completed synthetic reply: First question after version selection',{exact:true}).count(),0);
    const beforeMissingRecovery=generationRequests().length;
    await page.getByRole('button',{name:'New conversation',exact:true}).click();
    await page.getByRole('heading',{name:'Try a real question.',exact:true}).waitFor();
    assert.equal(generationRequests().length,beforeMissingRecovery);
    assert.notEqual([...sessions.keys()].at(-1),switchedSession);
    checks.push(`${width}: erased history permits explicit fresh session only without known pending work; missing unsettled history stays blocked`);
    create(randomUUID(), OTHER, "synthetic-owner-a").exchanges.push(exchange([...sessions.keys()].at(-1), "Other question", "Other AI private answer"));
    holdRead = true; await remount(); while (!held.length) await new Promise(resolve => setImmediate(resolve));
    await page.evaluate(rid => window.dialogueFixture.setRid(rid), OTHER); await page.getByText("Other AI private answer", { exact: true }).waitFor();
    held.shift()(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText("Earlier synthetic answer", { exact: true }).count(), 0);
    assert.equal(await page.getByText("Other AI private answer", { exact: true }).count(), 1); checks.push(`${width}: delayed prior replica history cannot replace current scope`);
    create(randomUUID(), OTHER, "synthetic-owner-b").exchanges.push(exchange([...sessions.keys()].at(-1), "Owner B question", "Owner B private answer"));
    holdRead = true; await remount(); while (!held.length) await new Promise(resolve => setImmediate(resolve));
    await page.evaluate(() => window.dialogueFixture.setToken("synthetic-owner-b")); await page.getByText("Owner B private answer", { exact: true }).waitFor();
    held.shift()(); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.equal(await page.getByText("Other AI private answer", { exact: true }).count(), 0); checks.push(`${width}: delayed prior owner history cannot replace current scope`);
    await page.evaluate(() => window.dialogueFixture.setStopped(true)); await page.getByRole("heading", { name: "This AI is stopped", exact: true }).waitFor();
    assert.equal(await ask().isDisabled(), true); assert.equal(await page.getByRole("button", { name: "New conversation", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []);
    await page.screenshot({ path: join(artifact, `history-${width}.png`), fullPage: true }); checks.push(`${width}: stopped state preserves generation lock and layout fits`);
    await page.close();
  }
  writeFileSync(join(artifact, "result.json"), JSON.stringify({ passed: checks.length, oldCode: old, checks }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, oldCode: old, artifact, checks }, null, 2));
} catch (error) {
  writeFileSync(join(artifact, "result.json"), JSON.stringify({ passed: checks.length, failed: true, oldCode: old, checks,
    error: { name: error.name, message: error.message, frames: String(error.stack).split("\n").filter(line => line.includes("dialogue-history-ui.mjs:")) } }, null, 2));
  throw error;
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
