// Real mounted conversation, entry dispatch and runtime gate; synthetic HTTP.
// Actual two-entry routing; creator authentication/shell is a delayed test host.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const TURN = "30000000-0000-4000-8000-000000000001";
const entry = join(root, "__conversation_setup_fixture__.tsx");
const meet = join(root, "__conversation_meet__.tsx");
const creatorApp = join(root, "src/creatorStudio/StudioApp.tsx");
const imports = `import React,{useEffect,useState} from 'react'; import {createRoot} from 'react-dom/client';
import '@fontsource-variable/instrument-sans'; import './src/studio/design/tokens.css'; import './src/studio/studio.css';
import './src/studio/design/honesty.css'; import './src/studio/design/mobile.css';`;
const meetCode = `${imports}
import ExpertConversation from './src/studio/ExpertConversation';
const authError=()=>{};
function Fixture(){const[rid,setRid]=useState('${RID}');const[stopped,setStopped]=useState(false);const[lifecycle,setLifecycle]=useState(undefined);const[runtime,setRuntime]=useState(null);
window.meetFixture={setRid,setStopped,setRuntime,setLifecycle};
return <main><p className="fixture-disclosure">Synthetic UI fixture. No model or owner data.</p>
<ExpertConversation token="synthetic-token" replicaId={rid} stopped={stopped} lifecycle={lifecycle} runtimeStatus={runtime} onAuthError={authError}/></main>}
createRoot(document.getElementById('studio-root')!).render(<Fixture/>);`;
// Absolute imports are required because this replaces the real main file.
const gateCode = `import React,{useCallback,useEffect,useState} from 'react';
import RuntimeGate from './RuntimeGate';import {StudioLocaleProvider} from './localeContext';
const authError=()=>{};const params=new URLSearchParams(location.search);
window.gateReceipts=[];
export default function Fixture(){const[show,setShow]=useState(false);const[rid,setRid]=useState(params.get('replica')!);const[token,setToken]=useState('synthetic-token');const[revision,setRevision]=useState(0);
const changed=useCallback(value=>window.gateReceipts.push(value.replica_id),[revision]);window.gateFixture={setRid,setToken,refresh:()=>setRevision(n=>n+1)};
useEffect(()=>{const t=setTimeout(()=>setShow(true),250);return()=>clearTimeout(t)},[]);
return <main data-fixture-destination="creator"><button id="destination-control">Fixture control</button><div style={{height:'1100px'}}>Synthetic asynchronous destination host</div>
{show&&<StudioLocaleProvider locale={params.get('lang')==='hi'?'hi':'en'}><RuntimeGate token={token} replicaId={rid} stopped={false} onAuthError={authError} onStatusChange={changed}/></StudioLocaleProvider>}</main>}`;
const result = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: "fixture.js" } } },
  plugins: [{ name: "actual-conversation-entry-fixture", resolveId(id) { if (id === "./__conversation_meet__") return meet; if (id === entry || id === meet) return id; },
    load(id) {
      if (id === entry) return `if(location.pathname==='/studio'){void import('./src/studio/main')}else{void import('./__conversation_meet__')}`;
      if (id === meet) return meetCode;
      if (id.replaceAll('\\','/') === creatorApp.replaceAll('\\','/')) return gateCode;
      if (id.endsWith('/creatorStudio/OpsBoard.tsx')) return `export default function OpsFixture(){return <main data-fixture-destination="ops">Synthetic OpsBoard boundary</main>}`;
      // Fail explicitly if the CTA reaches the original evolve/personal path.
      if (id.endsWith('/studio/personalMain.tsx')) return `throw new Error('fixture_wrong_personal_destination')`;
    } }] });
const assets = new Map(result.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
let runtimeMode = "inactive", holdNext = false, captured, writes = [], reads = 0, heldResponses = [], heldExpected = 1;
let heldResolve;
function holdRead(expected = 1) { holdNext = true; heldResponses = []; heldExpected = expected; return new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("fixture expected runtime read was not received")), 15_000);
  heldResolve = () => { clearTimeout(timeout); resolve(); };
}); }
function runtime(rid, mode = runtimeMode) { return { replica_id: mode === "foreign" ? OTHER : rid, lifecycle: "ready",
  active: mode === "active" || mode === "foreign", can_activate: mode === "can-activate", blockers: mode === "can-activate" ? [] : ["qualification_incomplete"],
  qualification: { passed: 0, required: 7 }, versions: { profile: 1, calibration: 1, voice_genome: 1 }, activated_at: null }; }
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/api/")) {
    assert(["Bearer synthetic-token", "Bearer synthetic-token-2"].includes(req.headers.authorization));
    if (req.method !== "GET") { let raw = ""; for await (const part of req) raw += part; writes.push({ path: url.pathname, body: JSON.parse(raw || "{}") }); }
    if (url.pathname === "/api/replica-runtime" && req.method === "GET") {
      reads++; const rid = url.searchParams.get("replica_id"), mode = runtimeMode;
      const finish = () => mode === "error" ? json(503, { error: "synthetic_read_failed" }) : json(200, { runtime: runtime(rid, mode) });
      if (holdNext) { heldResponses.push(finish); captured = () => { holdNext = false; for (const complete of heldResponses) complete(); };
        if (heldResponses.length >= heldExpected) heldResolve?.(); return; } return finish();
    }
    if (url.pathname === "/api/replica-feedback-dataset") return json(200, { review: {
      replica_id: url.searchParams.get("replica_id"), state: "inactive", can_build: false, binding: null, stats: null,
      source_set_hash: null, dataset: null, changed_since_saved: false, checked_at: "2026-09-07T00:00:00Z",
      readiness: { ready_for_candidate_dataset: false, blockers: ["active_runtime_required"] },
    } });
    if (url.pathname === "/api/replica-dialogue" && req.method === "GET") return json(200, { history: {
      replica_id: url.searchParams.get("replica_id"), session_id: null, exchanges: [], pending: false, billing_pending: false, latest_request: null,
    } });
    if (url.pathname === "/api/replica-dialogue" && writes.at(-1)?.body.op === "open_session") return json(201, { session: {
      replica_id: writes.at(-1).body.replica_id, session_id: writes.at(-1).body.session_id,
    } });
    if (url.pathname === "/api/replica-dialogue") return json(200, { turn: { turn_id: TURN, session_id: writes.at(-1).body.session_id,
      reply: "Synthetic reply retained while usage is reconciled.", can_voice: false, billing_state: "reconcile_required" } });
    return json(409, { error: "synthetic_mutation_refused" });
  }
  if (assets.has(url.pathname)) {
    res.writeHead(200, { "content-type": ({ ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2" })[extname(url.pathname)] || "application/octet-stream" });
    return res.end(assets.get(url.pathname));
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{margin:0;background:#f8f8f5;color:#253d31;font-family:'Instrument Sans Variable',sans-serif}main{padding:24px;max-width:860px;margin:auto}.fixture-disclosure{font-size:12px}</style></head>
<body><div id="studio-root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
async function releaseCaptured(page) {
  const response = page.waitForResponse(response => new URL(response.url()).pathname === "/api/replica-runtime");
  captured(); await (await response).finished();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}
const artifactDir = join(root, "scratchpad/meet-setup-ui", String(Date.now())); mkdirSync(artifactDir, { recursive: true });
const checks = [], observations = [], runtimeErrors = []; let browser, page, failure;
try {
  const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) {
    writes = []; runtimeMode = "inactive";
    page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: "reduce" });
    const errors = []; page.on("pageerror", error => { errors.push(error.message); runtimeErrors.push(error.message); });
    await page.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const setup = () => page.getByRole("link", { name: "Open conversation setup", exact: true });
    const ask = () => page.getByLabel("Ask your AI", { exact: true });
    const status = () => page.locator(".expert-conversation__readiness");
    const retry = () => status().getByRole("button", { name: "Check again", exact: true });
    const capturedInitial = holdRead();
    await page.goto(`${origin}/meet?lang=hi&replica=old&mode=replica&view=evolve&sample=1&panels=1`); await capturedInitial;
    await page.getByRole("heading", { name: "Checking your AI", exact: true }).waitFor();
    assert.equal(await setup().count(), 0); assert.equal(await ask().isDisabled(), true); captured();
    await setup().waitFor(); checks.push(`${width}: pending readiness offers no setup or generation`);
    const destination = new URL(await setup().getAttribute("href"), origin);
    const visitSetup = label => { const url = new URL(destination); url.searchParams.set("fixture-check", label); return page.goto(url.href); };
    assert.equal(destination.searchParams.get("replica"), RID); assert.equal(destination.searchParams.get("lang"), "hi");
    assert.equal(destination.searchParams.get("mode"), "setup"); assert.equal(destination.searchParams.get("step"), "deploy"); assert.equal(destination.hash, "#runtime-gate");
    for (const key of ["sample", "view", "panels"]) assert.equal(destination.searchParams.has(key), false);
    assert.equal(await ask().isDisabled(), true); assert.equal(writes.length, 0);
    await setup().focus(); assert.equal(await setup().evaluate(node => node === document.activeElement), true);
    assert.equal(await setup().evaluate(node => node.getBoundingClientRect().height >= 44), true);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: join(artifactDir, `meet-setup-${width}.png`), fullPage: true });
    checks.push(`${width}: real setup CTA carries replica and locale with keyboard target and no overflow`);
    // Changing readiness source while a request is pending must not unlock it.
    runtimeMode = "error"; const heldFailure = holdRead(); await retry().click(); await heldFailure;
    await page.evaluate(rid => window.meetFixture.setRuntime({ replica_id: rid, active: true }), RID);
    assert.equal(await ask().isDisabled(), true); captured();
    await page.getByRole("heading", { name: "Readiness is unavailable", exact: true }).waitFor();
    assert.equal(await setup().count(), 0); assert.equal(await ask().isDisabled(), true);
    checks.push(`${width}: failed current read cannot use an earlier parent success or blame owner setup`);
    runtimeMode = "foreign"; await retry().click(); await page.getByRole("heading", { name: "Readiness is unavailable", exact: true }).waitFor();
    assert.equal(await setup().count(), 0); assert.equal(await ask().isDisabled(), true);
    checks.push(`${width}: foreign active readiness is refused`);
    runtimeMode = "can-activate"; await retry().click(); await setup().waitFor(); assert.equal(writes.length, 0);
    checks.push(`${width}: eligible inactive state still requires explicit existing setup action`);
    for (const lifecycle of ["draft", "consent_pending", "enrolling", "calibrating"]) {
      await page.evaluate(value => { window.meetFixture.setStopped(true); window.meetFixture.setLifecycle(value); }, lifecycle);
      await setup().waitFor(); assert.equal(await ask().isDisabled(), true);
      assert.equal(await page.getByRole("heading", { name: "This AI is stopped", exact: true }).count(), 0);
    }
    checks.push(`${width}: unfinished lifecycle allows setup while the existing stopped generation lock remains closed`);
    for (const lifecycle of ["paused", "revoked", "purging"]) {
      await page.evaluate(value => window.meetFixture.setLifecycle(value), lifecycle);
      await page.getByRole("heading", { name: "This AI is stopped", exact: true }).waitFor();
      assert.equal(await setup().count(), 0); assert.equal(await ask().isDisabled(), true);
    }
    checks.push(`${width}: actual paused/revoked/purging states never suggest owner setup`);
    await page.evaluate(() => { window.meetFixture.setLifecycle(undefined); window.meetFixture.setStopped(false); }); await setup().waitFor();
    // Same mounted component, no React key reset, with old active read arriving last.
    runtimeMode = "active"; const heldOld = holdRead(); await retry().click(); await heldOld;
    holdNext = false; runtimeMode = "inactive"; await page.evaluate(rid => window.meetFixture.setRid(rid), OTHER); await setup().waitFor();
    await releaseCaptured(page); await page.getByRole("heading", { name: "Set up your first conversation", exact: true }).waitFor();
    assert.equal(new URL(await setup().getAttribute("href"), origin).searchParams.get("replica"), OTHER);
    assert.equal(await ask().isDisabled(), true);
    checks.push(`${width}: late old-replica active result cannot replace current setup`);
    await page.evaluate(() => window.meetFixture.setStopped(true));
    await page.getByRole("heading", { name: "This AI is stopped", exact: true }).waitFor();
    assert.equal(await setup().count(), 0); assert.equal(await status().getByRole("button").count(), 0);
    assert.equal(await ask().isDisabled(), true); checks.push(`${width}: stopped AI has no owner-setup instruction`);
    await page.evaluate(() => window.meetFixture.setStopped(false)); await setup().waitFor();
    runtimeMode = "active"; await retry().click(); await page.getByRole("heading", { name: "Try a real question.", exact: true }).waitFor();
    await ask().fill("Synthetic usage reconciliation question"); await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.getByRole("heading", { name: "Reply saved", exact: true }).waitFor();
    assert.equal(await setup().count(), 0); assert.equal(await status().getByRole("button").count(), 0); assert.equal(await ask().isDisabled(), true);
    assert.equal(await page.getByText("Synthetic reply retained while usage is reconciled.", { exact: true }).count(), 1);
    assert.equal(writes.length, 2); assert.equal(writes[0].body.op, "open_session");
    assert.equal(writes[1].path, "/api/replica-dialogue"); assert.equal(writes[1].body.session_id, writes[0].body.session_id);
    checks.push(`${width}: reconciliation preserves reply without setup or automatic retry`);
    // Follow the real link through actual src/studio/main entry routing.
    runtimeMode = "inactive"; await page.goto(`${origin}/meet?lang=hi`); await setup().waitFor();
    await setup().focus(); await page.keyboard.press("Enter"); await page.locator('[data-fixture-destination="creator"]').waitFor();
    const gate = page.locator("#runtime-gate"); await gate.locator(".runtime-action button").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("replica"), RID); assert.equal(new URL(page.url()).searchParams.get("lang"), "hi");
    assert.equal(await gate.locator(".runtime-action button").isDisabled(), true);
    assert.equal(writes.filter(write => write.path === "/api/replica-runtime").length, 0);
    const landing = await gate.evaluate(node => ({ top: node.getBoundingClientRect().top, actionBottom: node.querySelector('.runtime-action button').getBoundingClientRect().bottom,
      viewportHeight: innerHeight, focused: document.activeElement === node, active: document.activeElement?.tagName }));
    observations.push({ width, landing });
    await page.screenshot({ path: join(artifactDir, `setup-destination-${width}.png`), fullPage: true });
    assert(landing.top >= -1 && landing.actionBottom <= landing.viewportHeight, `async target/action missed viewport: ${JSON.stringify(landing)}`);
    assert.equal(landing.focused, true);
    checks.push(`${width}: actual entry dispatch lands on private gate with denied activation preserved`);
    const heldRefresh = holdRead(); await page.evaluate(() => window.gateFixture.refresh()); await heldRefresh;
    await page.locator("#destination-control").focus(); captured(); await gate.locator(".runtime-action button").waitFor();
    assert.equal(await page.locator("#destination-control").evaluate(node => node === document.activeElement), true);
    checks.push(`${width}: a later readiness refresh never repeats the hash focus handoff`);
    const heldInteracted = holdRead(); await visitSetup("interacted"); await heldInteracted;
    await page.locator("#destination-control").focus(); captured(); await gate.locator(".runtime-action button").waitFor();
    assert.equal(await page.locator("#destination-control").evaluate(node => node === document.activeElement), true);
    checks.push(`${width}: user focus before first receipt is respected`);
    runtimeMode = "active"; const heldOldGate = holdRead(); await visitSetup("old-replica"); await heldOldGate;
    holdNext = false; runtimeMode = "inactive"; await page.evaluate(rid => window.gateFixture.setRid(rid), OTHER); await gate.locator(".runtime-action button").waitFor();
    await releaseCaptured(page); assert.equal(await gate.locator(".runtime-action button").isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.gateReceipts), [OTHER]);
    checks.push(`${width}: late former-replica gate receipt cannot activate, focus or notify the current workspace`);
    runtimeMode = "active"; const heldOldToken = holdRead(); await visitSetup("old-token"); await heldOldToken;
    holdNext = false; runtimeMode = "inactive"; await page.evaluate(() => window.gateFixture.setToken('synthetic-token-2')); await gate.locator(".runtime-action button").waitFor();
    await releaseCaptured(page); assert.equal(await gate.locator(".runtime-action button").isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.gateReceipts), [RID]);
    checks.push(`${width}: late prior-session gate receipt is ignored`);
    const noHash = new URL(destination.href); noHash.hash = "";
    await page.goto(noHash.href); await gate.locator(".runtime-action button").waitFor();
    assert.equal(await gate.evaluate(node => node === document.activeElement), false);
    checks.push(`${width}: ordinary destination without exact hash never takes focus`);
    const ops = new URL(destination.href); ops.searchParams.set("mode", "ops");
    await page.goto(ops.href); await page.locator('[data-fixture-destination="ops"]').waitFor();
    assert.equal(await page.locator("#runtime-gate").count(), 0);
    checks.push(`${width}: actual nested router negative control sends old ops destination to OpsBoard`);
    assert.deepEqual(errors, []); await page.close(); page = null;
  }
} catch (error) { failure = error; if (page) await page.screenshot({ path: join(artifactDir, "failure.png"), fullPage: true }).catch(() => {}); }
finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  writeFileSync(join(artifactDir, "result.json"), JSON.stringify({ passed: checks.length, checks, observations, runtimeErrors, failure: failure?.message || null,
    scope: "Synthetic mounted components and entry routing. No real authentication, model, database or activation." }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, failed: !!failure, artifactDir }));
}
if (failure) throw failure;
