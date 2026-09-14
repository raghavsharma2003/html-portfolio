// Real mounted component, synthetic HTTP only. No SQL, provider or billing evidence.
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const RID = '10000000-0000-4000-8000-000000000001', DATASET = '10000000-0000-4000-8000-000000000002';
const JOB = '10000000-0000-4000-8000-000000000003', CANDIDATE = '10000000-0000-4000-8000-000000000004';
const HASH = 'a'.repeat(64), TOTAL = 60;
const entry = join(root, '__candidate_materializer_fixture__.tsx');
const source = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import './src/studio/design/tokens.css';import './src/studio/feedback-dataset.css';
import CandidateMaterializeAction from './src/studio/CandidateMaterializeAction';
function Fixture(){const[token,setToken]=useState('fixture-a');const[mounted,setMounted]=useState(true);
return <main className="feedback-dataset"><h1>Private comparison fixture</h1>
<button onClick={()=>setToken('fixture-b')}>Switch account</button><button onClick={()=>setMounted(false)}>Close preparation</button>
{mounted&&<CandidateMaterializeAction token={token} replicaId="${RID}" datasetId="${DATASET}" candidateId="${CANDIDATE}"
sourceSetHash="${HASH}" onAuthError={()=>{}}/>}</main>;}createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } }, plugins: [{ name: 'materializer-fixture',
    resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return source; } }] });
const assets = new Map(bundle.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]));
const styles = bundle.output.filter(item => item.fileName.endsWith('.css')).map(item => `<link rel="stylesheet" href="/${item.fileName}">`).join('');
const server = createServer((req, res) => {
  const path = new URL(req.url, 'http://fixture.invalid').pathname;
  if (assets.has(path)) {
    res.writeHead(200, { 'content-type': extname(path) === '.css' ? 'text/css' : 'text/javascript' });
    return res.end(assets.get(path));
  }
  if (path !== '/') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
  <style>body{margin:0;color:#253d31;background:#f8f8f5;font:16px system-ui}main{padding:24px;max-width:760px;margin:auto}
  button{min-height:44px;padding:10px 16px;max-width:100%;font:inherit}progress{max-width:100%}</style></head>
  <body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const dir = join(root, 'scratchpad/candidate-materializer-ui', String(Date.now())); mkdirSync(dir, { recursive: true });
const checks = []; let browser;
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 15_000); })]); }
  finally { clearTimeout(timer); }
}
try {
  browser = await launchSuiteBrowser("candidate-materializer-ui");
  for (const width of [390, 1440]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [], requests = [], blind = [];
    page.on('pageerror', error => errors.push(error.message));
    let mode = 'normal', stored = null, release = null, inFlight = 0, peak = 0, advanced = 0;
    let entered, settled, markEntered, markSettled;
    const base = () => ({ job_id: JOB, replica_id: RID, dataset_id: DATASET, candidate_id: CANDIDATE,
      state: 'preparing', completed: 0, total: TOTAL, active_changed: false, can_advance: true });
    const mutations = () => requests.filter(item => item.op !== 'status');
    await page.route('**/api/replica-candidate-materialize', async route => {
      const body = route.request().postDataJSON(), auth = route.request().headers().authorization;
      assert.equal(route.request().method(), 'POST');
      assert.deepEqual(body, { op: body.op, replica_id: RID, dataset_id: DATASET, candidate_id: CANDIDATE, expected_source_set_hash: HASH });
      assert(['status', 'start', 'advance'].includes(body.op));
      requests.push(body);
      const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      if (body.op === 'status') return json({ job: auth === 'Bearer fixture-b' ? null : stored });
      assert.equal(auth, 'Bearer fixture-a'); inFlight++; peak = Math.max(peak, inFlight);
      try {
        if (body.op === 'start') stored = base();
        if (body.op === 'advance') { advanced++; stored = { ...stored, completed: Math.min(TOTAL, stored.completed + 1) }; }
        if (mode === 'hold') await new Promise(resolve => { release = resolve; markEntered(); });
        if (mode === 'lost' && body.op === 'advance') {
          mode = 'normal'; return route.fulfill({ status: 200, contentType: 'application/json', body: '{' });
        }
        if (mode === 'held' && body.op === 'advance') stored = { ...stored, state: 'held', can_advance: false };
        if (stored.completed === TOTAL) stored = { ...stored, state: 'ready', can_advance: false };
        return await json({ job: stored });
      } catch (cause) {
        // A pending mock can be cancelled by the component. Other route errors remain visible.
        if (!String(cause).match(/closed|cancel|intercept|Invalid Interception/i)) throw cause;
      } finally { inFlight--; markSettled?.(); }
    });
    await page.route('**/api/replica-candidate-eval', async route => {
      const body = route.request().postDataJSON();
      if (body.op === 'qualification_status') {
        assert.deepEqual(body, { op: 'qualification_status', replica_id: RID, candidate_id: CANDIDATE });
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ qualification: {
          available: false, active_changed: false,
        } }) });
      }
      blind.push(body);
      assert.deepEqual(body, { op: 'status', replica_id: RID, candidate_id: CANDIDATE });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ evaluation: {
        available: true, replica_id: RID, state: 'complete', progress: { completed: 30, total: 30 }, assignment: null, dimensions: [],
      } }) });
    });
    const start = page.getByRole('button', { name: 'Prepare blind comparison', exact: true });
    const status = page.getByRole('button', { name: 'Check comparison status', exact: true });
    const resume = page.getByRole('button', { name: 'Continue preparation', exact: true });
    const ready = page.getByText('Your blind comparison is ready.', { exact: true });
    const reset = async nextMode => {
      mode = nextMode; stored = null; requests.length = 0; blind.length = 0; advanced = 0; peak = 0;
      entered = new Promise(resolve => { markEntered = resolve; });
      settled = new Promise(resolve => { markSettled = resolve; });
      await page.goto(origin); await start.waitFor();
      assert.equal(mutations().length, 0);
    };

    await reset('normal');
    await start.focus(); assert(await start.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter'); await ready.waitFor({ timeout: 30_000 });
    assert.equal(mutations().filter(item => item.op === 'start').length, 1);
    assert.equal(advanced, TOTAL); assert.equal(peak, 1); assert.equal(blind.length, 0);
    assert.equal(await page.getByRole('progressbar').getAttribute('value'), String(TOTAL));
    await page.getByRole('button', { name: 'Review blind comparisons', exact: true }).click();
    await page.getByText('Blind review complete', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Which reply is more like you?', exact: true }).waitFor();
    assert.equal(blind.length, 1);
    checks.push(`${width}: initial status is read-only; keyboard start serially prepares 60 responses; explicit exact-candidate blind review`);
    await page.screenshot({ path: join(dir, `ready-${width}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await page.goto(origin + '/?lang=hi'); await ready.waitFor();
    await page.getByRole('button', { name: 'Review blind comparisons', exact: true }).click();
    await page.getByRole('heading', { name: 'कौन सा जवाब आपके जैसा है?', exact: true }).waitFor();
    await page.getByText('नाम छिपे रहेंगे', { exact: true }).waitFor();
    await page.getByText('30 तुलनाएं सहेजी गईं। आपका मौजूदा AI नहीं बदला है।', { exact: true }).waitFor();
    assert.equal(await page.getByText(/closer voice|identity stays sealed until/).count(), 0);
    await page.screenshot({ path: join(dir, `ready-hi-${width}.png`), fullPage: true });
    checks.push(`${width}: Hindi text comparison asks about written replies without voice or approval claims`);

    await reset('lost'); await start.click();
    await page.getByText('Completion is unconfirmed. Check status before continuing.', { exact: true }).waitFor();
    assert.equal(advanced, 1); assert.equal(mutations().length, 2); assert.equal(await resume.count(), 0);
    await status.click(); await resume.waitFor();
    assert.equal(mutations().length, 2); assert.equal(advanced, 1);
    await resume.click(); await ready.waitFor({ timeout: 30_000 });
    assert.equal(mutations().filter(item => item.op === 'start').length, 1); assert.equal(advanced, TOTAL);
    checks.push(`${width}: lost response stops mutations; status reads persisted progress; explicit resume avoids duplicate start`);

    await reset('held'); await start.click();
    await page.getByText('We are checking this comparison before it can continue.', { exact: true }).waitFor();
    assert.equal(advanced, 1); assert.equal(await resume.count(), 0); assert.equal(await start.count(), 0);
    checks.push(`${width}: held accounting state stops advances and explains platform responsibility`);

    mode = 'normal'; stored = { ...base(), completed: TOTAL }; await page.reload(); await resume.waitFor();
    const priorAdvances = advanced; await resume.click(); await ready.waitFor();
    assert.equal(advanced, priorAdvances + 1);
    checks.push(`${width}: final sealing response may become ready without increasing the completed response count`);

    await reset('hold'); await start.evaluate(el => { el.click(); el.click(); });
    // The route entering its held section, not a wall-clock sleep, establishes the pending mutation.
    await bounded(entered, 'Held start did not reach the endpoint');
    assert.equal(mutations().length, 1); assert.equal(await start.isDisabled(), true);
    await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await start.waitFor();
    release?.(); release = null;
    await bounded(settled, 'Cancelled account response did not settle');
    await status.click(); await start.waitFor();
    assert.equal(advanced, 0); assert.equal(mutations().length, 1); assert.equal(await ready.count(), 0);
    checks.push(`${width}: account scope abort rejects held response without advancing or exposing prior progress`);

    await reset('hold'); await start.click();
    await bounded(entered, 'Unmount start did not reach the endpoint');
    await page.getByRole('button', { name: 'Close preparation', exact: true }).click();
    await page.getByRole('region', { name: 'Prepare blind comparison' }).waitFor({ state: 'detached' });
    release?.(); release = null;
    await bounded(settled, 'Unmount response did not settle');
    assert.equal(advanced, 0); assert.equal(mutations().length, 1);
    assert.deepEqual(errors, []);
    checks.push(`${width}: unmount stops serial continuation; no page errors`);
    await page.close();
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ checks, scope: 'synthetic mounted UI only' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, artifact: join(dir, 'result.json'), checks }, null, 2));
} catch (cause) {
  writeFileSync(join(dir, 'failure.json'), JSON.stringify({ checks, error: String(cause.message) }, null, 2)); throw cause;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
