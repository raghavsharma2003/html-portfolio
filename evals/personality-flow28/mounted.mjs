import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../', import.meta.url));
const sha = b => createHash('sha256').update(b).digest('hex'), base = 'c3cae7ddbb6992ed9311d46f88d89b31f3fee8b0';
const canonical = bytes => Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'));
const files = { person: 'PersonModelStudio.tsx', calibration: 'CalibrationStudio.tsx' }, oldFiles = { person: 'old-person-model.tsx.txt', calibration: 'old-calibration.tsx.txt' };
// Historical Git blobs were verified at the base commit above and recorded in the
// original PERSONALITY-REVIEW28-FREEZE-20260908.json productionPrerequisites.
// Pin canonical bytes directly so depth-one CI checkouts need no Git history.
const historicalSha = {
  person: '9873db908df42a221e2cf5bf56a823aa175f8432f9f7d26938ba23109b59deb0',
  calibration: '24405694f841c8fb3ff6b36fca7545b8368d3c619764edea1b05e4d838327df1',
};
const verifyHistorical = (lane, bytes) => assert.equal(sha(canonical(bytes)), historicalSha[lane], 'retained original source, pinned canonical LF SHA');
for (const lane of Object.keys(files)) verifyHistorical(lane, readFileSync(new URL(oldFiles[lane], import.meta.url)));
if (process.argv.includes('--verify-fixtures')) {
  let controls = 0;
  for (const lane of Object.keys(files)) {
    const bytes = canonical(readFileSync(new URL(oldFiles[lane], import.meta.url)));
    verifyHistorical(lane, bytes); controls++;
    verifyHistorical(lane, Buffer.from(bytes.toString('utf8').replaceAll('\n', '\r\n'))); controls++;
    assert.throws(() => verifyHistorical(lane, Buffer.concat([bytes, Buffer.from('// changed historical source')]))); controls++;
  }
  console.log(JSON.stringify({ controls, base, historicalSha, gitHistoryRequired: false }));
  process.exit(0);
}
const { build } = await import('vite');
const out = join(root, 'scratchpad', 'personality-scope28', String(Date.now())); mkdirSync(out, { recursive: true });
const hashes = {}, oldHashes = {};
for (const [lane, name] of Object.entries(files)) {
  const current = readFileSync(join(root, 'src/studio', name)), old = readFileSync(new URL(oldFiles[lane], import.meta.url));
  verifyHistorical(lane, old);
  hashes[name] = sha(current); oldHashes[name] = sha(old);
  writeFileSync(join(out, 'old-' + lane + '.tsx'), old.toString('utf8').replaceAll('from "./', 'from "' + join(root, 'src/studio/').replaceAll('\\', '/') ));
}
const A = '10000000-0000-4000-8000-000000000001', B = '10000000-0000-4000-8000-000000000002';
const pathFor = lane => '/api/replica-' + (lane === 'person' ? 'person-model' : 'calibration');
const marker = (rid, token) => `Reviewed ${rid === A ? 'A' : 'B'} ${token.includes('fresh') ? 'fresh' : token.includes('other') ? 'other' : 'initial'}`;
const clock = '2026-09-08T00:00:00Z';
function dataFor(lane, rid, token) {
  const text = marker(rid, token), version = { replica_id: rid, version: 7, profile_version: 3, status: 'draft', created_at: clock };
  if (lane === 'person') return { person_model: { replica_id: rid, claims: [{ claim_id: rid === A ? '1' : '2', domain: 'boundary', key: 'privacy', body: text, origin: 'self_declared', confidence: .96, status: 'proposed', sensitive: false, source_count: 1, citation_previews: [{ excerpt: `Exact synthetic evidence ${text}`, entailment: .99 }], decision: null, reason_code: '', reviewed_at: null, created_at: clock }], readiness: { ready: true, blockers: [], conflicts: [], accepted_claims: 4 }, profiles: [version] } };
  return { calibration: { replica_id: rid, profile_version: 3, scenarios: [{ scenario_id: 'behaviour.repair', revision: 1, layer: 'behaviour', axis: 'repair', context: text, left: { id: 'brief', label: 'Own the mistake', description: 'Acknowledge and correct it.' }, right: { id: 'space', label: 'Offer space', description: 'Ask what would help.' }, preference: null }], readiness: { ready: true, blockers: [], reviewed: 7, resolved: 7, required: 7, covered_layers: ['delivery', 'language', 'behaviour', 'memory', 'relationship'] }, versions: [version] } };
}
const absolute = file => join(root, file).replaceAll('\\', '/');
writeFileSync(join(out, 'entry.tsx'), `import React,{useState,useCallback}from'react';import{createRoot}from'react-dom/client';import Person from ${JSON.stringify(absolute('src/studio/PersonModelStudio.tsx'))};import Calibration from ${JSON.stringify(absolute('src/studio/CalibrationStudio.tsx'))};import OldPerson from './old-person';import OldCalibration from './old-calibration';function Fixture(){const[rid,setRid]=useState(${JSON.stringify(A)}),[token,setToken]=useState('synthetic-initial'),[shown,setShown]=useState(true);const auth=useCallback(()=>{window.__authErrors++;},[]);const p=new URLSearchParams(location.search),Component=p.get('lane')==='person'?(p.has('old')?OldPerson:Person):(p.has('old')?OldCalibration:Calibration);return <><nav><button onClick={()=>setRid(${JSON.stringify(B)})}>Switch replica</button><button onClick={()=>setToken('synthetic-fresh')}>Refresh token</button><button onClick={()=>{setRid(${JSON.stringify(B)});setToken('synthetic-other');}}>Switch account</button><button onClick={()=>setShown(false)}>Leave review</button></nav>{shown?<Component token={token} replicaId={rid} onAuthError={auth}/>:<h1>Another page</h1>}</>};window.__authErrors=0;window.__settled=0;const native=window.fetch.bind(window);window.fetch=async(...args)=>{const r=await native(...args);await r.clone().json();window.__settled++;return r;};createRoot(document.getElementById('root')).render(<Fixture/>);`);
const bundle = join(out, 'bundle');
await build({ root, configFile: false, logLevel: 'error', build: { outDir: bundle, emptyOutDir: true, lib: { entry: join(out, 'entry.tsx'), name: 'ReviewScope', formats: ['iife'], fileName: () => 'fixture.js' } }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } });
const js = readFileSync(join(bundle, 'fixture.js'));
let hold = null, held = [], requests = [], errors = [], wrongScope = false;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js); }
    if (!url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:16px;font:16px sans-serif;max-width:850px}button{min-height:44px;margin:4px;padding:8px}nav{position:sticky;top:0;background:white;z-index:10}.person-claim,.calibration-card{border:1px solid #aaa;padding:12px}.claim-actions{display:flex;flex-wrap:wrap}strong,small{display:block}</style><div id="root"></div><script src="/fixture.js"></script>'); }
    let body = ''; for await (const part of req) body += part;
    const input = body ? JSON.parse(body) : Object.fromEntries(url.searchParams), token = String(req.headers.authorization || '').replace('Bearer ', '');
    requests.push({ path: url.pathname, method: req.method, token, input });
    const rid = input.replica_id, lane = url.pathname === pathFor('person') ? 'person' : 'calibration';
    const value = req.method === 'GET' ? url.pathname === '/api/replica-claims'
      ? { extraction: { replica_id: rid, readiness: { ready: false, blockers: ['training_consent_required'], eligible_spans: 0 }, runs: [] } }
      : dataFor(lane, wrongScope ? (rid === A ? B : A) : rid, token)
      : { profile: { replica_id: rid, version: 7, status: 'approved', created_at: clock }, calibration: { replica_id: rid, version: 7, status: 'approved', created_at: clock }, preference: { scenario_id: 'behaviour.repair', choice: input.choice }, decision: { claim_id: input.claim_id, decision: input.decision } };
    const send = (status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(status === 401 ? { error: 'expired_token' } : value)); };
    if (hold && hold.path === url.pathname && hold.method === req.method && rid === A) { const status = hold.status || 200; hold = null; held.push(() => send(status)); return; }
    send();
  } catch (error) { errors.push(error.message); res.writeHead(500, { 'Content-Type': 'application/json' }); res.end('{"error":"fixture_failure"}'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await launchSuiteBrowser("personality-review-scope-ui");
const results = [], pageErrors = []; let page;
const affectedOnly = process.argv.includes('--affected');
const pass = name => { results.push(name); console.log(`ok ${results.length} - ${name}`); };
const until = async predicate => { const deadline = Date.now() + 10000; while (!predicate()) { assert(Date.now() < deadline, 'explicit HTTP dispatch barrier timed out'); await new Promise(resolve => setTimeout(resolve, 10)); } };
const release = async () => { assert.equal(held.length, 1); const settled = await page.evaluate(() => window.__settled); held.shift()(); await page.waitForFunction(n => window.__settled > n, settled); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))); };
const reset = () => { assert.equal(held.length, 0); hold = null; requests = []; wrongScope = false; };
const show = (rid, token = 'synthetic-initial') => page.getByText(marker(rid, token), { exact: true }).waitFor();
const posts = () => requests.filter(row => row.method === 'POST');
const approve = lane => page.getByRole('button', { name: lane === 'person' ? 'Approve profile v7' : 'Approve calibration v7', exact: true });
try {
  for (const width of [390, 1440]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }); page = await context.newPage(); page.setDefaultTimeout(10000);
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort()); page.on('pageerror', error => pageErrors.push(error.message));
    for (const lane of ['person', 'calibration']) {
      const open = old => page.goto(`${origin}/?lane=${lane}${old ? '&old=1' : ''}`), prefix = `${width}/${lane}`;
      if (!affectedOnly) {
      reset(); hold = { path: pathFor(lane), method: 'GET' }; await open(true); await until(() => held.length === 1); await page.getByRole('button', { name: 'Switch replica', exact: true }).click(); await show(B); await release(); await show(A); await approve(lane).click(); await until(() => posts().length === 1); assert.equal(posts()[0].input.replica_id, B); assert.equal(posts()[0].input.version, 7); await approve(lane).waitFor(); pass(prefix + ' exact old late A read displays A while explicit approve writes B version7');
      reset(); hold = { path: pathFor(lane), method: 'GET' }; await open(false); await until(() => held.length === 1); await page.getByRole('button', { name: 'Switch replica', exact: true }).click(); await show(B); await release(); assert.equal(await page.getByText(marker(A, 'synthetic-initial'), { exact: true }).count(), 0); await approve(lane).click(); await until(() => posts().length === 1); assert.equal(posts()[0].input.replica_id, B); await approve(lane).waitFor(); pass(prefix + ' late replica read is discarded and reviewed B can still explicitly approve');
      reset(); hold = { path: pathFor(lane), method: 'GET' }; await open(false); await until(() => held.length === 1); await page.getByRole('button', { name: 'Refresh token', exact: true }).click(); await show(A, 'synthetic-fresh'); await release(); assert.equal(await page.getByText(marker(A, 'synthetic-initial'), { exact: true }).count(), 0); assert.equal(posts().length, 0); pass(prefix + ' token refresh replaces review scope without a write');
      reset(); hold = { path: pathFor(lane), method: 'GET', status: 401 }; await open(false); await until(() => held.length === 1); await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await show(B, 'synthetic-other'); await release(); assert.equal(await page.evaluate(() => window.__authErrors), 0); pass(prefix + ' late read401 cannot sign out the new account');
      for (const status of [200, 401]) {
        reset(); await open(false); await show(A); hold = { path: pathFor(lane), method: 'POST', status }; await approve(lane).click(); await until(() => held.length === 1); await page.getByRole('button', { name: 'Switch account', exact: true }).click(); await show(B, 'synthetic-other'); const before = requests.length; await release(); assert.equal(await page.evaluate(() => window.__authErrors), 0); assert.equal(posts().length, 1); assert.equal(requests.slice(before).filter(r => r.token === 'synthetic-initial').length, 0); assert.equal(await page.getByText(marker(A, 'synthetic-initial'), { exact: true }).count(), 0); pass(prefix + ` late write${status} neither reads old scope nor changes current account`);
      }
      reset(); await open(false); await show(A); hold = { path: pathFor(lane), method: 'GET' }; await approve(lane).click(); await until(() => held.length === 1); await page.getByRole('button', { name: 'Switch replica', exact: true }).click(); await show(B); await release(); assert.equal(await page.getByText(marker(A, 'synthetic-initial'), { exact: true }).count(), 0); assert.equal(posts().length, 1); pass(prefix + ' late successful mutation readback cannot replace the next replica');
      reset(); await open(false); await show(A); hold = { path: pathFor(lane), method: 'POST', status: 401 }; await approve(lane).click(); await until(() => held.length === 1); await page.getByRole('button', { name: 'Leave review', exact: true }).click(); await page.getByRole('heading', { name: 'Another page' }).waitFor(); await release(); assert.equal(await page.evaluate(() => window.__authErrors), 0); assert.equal(posts().length, 1); pass(prefix + ' unmounted pending approval has no late auth or page effects');
      reset(); wrongScope = true; await open(false); await page.getByRole('button', { name: 'Retry', exact: true }).waitFor(); assert.equal(await approve(lane).count(), 0); assert.equal(posts().length, 0); wrongScope = false; await page.getByRole('button', { name: 'Retry', exact: true }).click(); await show(A); pass(prefix + ' mismatched response replica is refused and explicit read retry recovers');
      }
      reset(); await open(false); await show(A); hold = { path: pathFor(lane), method: 'POST', status: 503 }; await approve(lane).click(); await until(() => held.length === 1); await release(); await page.getByRole('button', { name: 'Retry', exact: true }).waitFor(); assert.equal(posts().length, 1); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await show(A); assert.equal(posts().length, 1); pass(prefix + ' uncertain approval allows explicit status read without repeating POST');
      reset(); await open(false); await show(A); hold = { path: pathFor(lane), method: 'POST' }; await page.getByRole('button', { name: lane === 'person' ? 'This is me' : 'A Own the mistake Acknowledge and correct it.', exact: true }).click(); await until(() => held.length === 1); await page.getByRole('button', { name: 'Refresh token', exact: true }).click(); await show(A, 'synthetic-fresh'); const requestCount = requests.length; await release(); assert.equal(posts().length, 1); assert.equal(posts()[0].input.op, lane === 'person' ? 'decide_claim' : 'choose'); assert.equal(requests.slice(requestCount).filter(r => r.token === 'synthetic-initial').length, 0); assert.equal(await page.evaluate(() => window.__authErrors), 0); pass(prefix + ' pending explicit claim or contrast write survives token refresh without stale readback or retry');
      await page.screenshot({ path: join(out, `${lane}-${width}.png`), fullPage: true });
    }
    await context.close();
  }
  assert.deepEqual(pageErrors, []); assert.deepEqual(errors, []);
  writeFileSync(join(out, 'result.json'), JSON.stringify({ at: new Date().toISOString(), groups: results.length, affectedOnly, results, base, hashes, oldHashes, limits: 'Actual mounted components and existing API clients with synthetic HTTP. Two replica IDs and account tokens; no SQL/model/auth provider/identity or whole Studio journey acceptance.' }, null, 2)); console.log(`PASS ${results.length}; ${out}`);
} catch (error) { writeFileSync(join(out, 'failure.json'), JSON.stringify({ at: new Date().toISOString(), error: error.stack, results, hashes, requests, pageErrors, errors, body: page && !page.isClosed() ? await page.locator('body').innerText().catch(() => '') : '' }, null, 2)); throw error; }
finally { held.splice(0).forEach(finish => finish()); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
