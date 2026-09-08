// Mounted product component + real API client, synthetic HTTP. Fixture CSS is not full-studio visual evidence.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const RID = '10000000-0000-4000-8000-000000000001';
const CID = '10000000-0000-4000-8000-000000000002', OTHER = '10000000-0000-4000-8000-000000000003';
const QID = '10000000-0000-4000-8000-000000000004';
const entry = join(root, '__qualification_ui_fixture__.tsx');
const fixture = `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import CandidateEvaluationLab from './src/studio/CandidateEvaluationLab';
function Fixture(){const[token,setToken]=useState('fixture-a');const[candidate,setCandidate]=useState('${CID}');
const[visible,setVisible]=useState(true);const language=new URLSearchParams(location.search).get('lang')==='hi'?'hi':'en';
return <main><button onClick={()=>setToken('fixture-b')}>Switch account</button>
<button onClick={()=>setCandidate('${OTHER}')}>Switch candidate</button><button onClick={()=>setVisible(false)}>Close review</button>
{visible&&<CandidateEvaluationLab token={token} replicaId="${RID}" candidateId={candidate} locale={language}
stopped={false} onAuthError={()=>{}}/>}</main>}createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } }, plugins: [{ name: 'qualification-fixture',
    resolveId(id) { if (id === entry) return entry; }, load(id) { if (id === entry) return fixture; } }] });
const assets = new Map(bundle.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]));
const server = createServer((req, res) => {
  const pathname = new URL(req.url, 'http://fixture.invalid').pathname;
  if (assets.has(pathname)) { res.writeHead(200, { 'content-type': extname(pathname) === '.css' ? 'text/css' : 'text/javascript' }); return res.end(assets.get(pathname)); }
  if (pathname !== '/') { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
  <style>body{margin:0;background:#f8f8f5;color:#253d31;font:16px/1.5 system-ui}main{max-width:760px;margin:auto;padding:20px}
  button{font:inherit;padding:10px 16px;min-height:44px;max-width:100%;margin:4px}h2{font-size:24px}p{overflow-wrap:anywhere}
  :focus-visible{outline:3px solid #225d3b;outline-offset:3px}</style></head><body><div id="root"></div>
  <script type="module" src="/fixture.js"></script></body></html>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const dir = join(root, 'scratchpad/candidate-qualification-ui', String(Date.now())); mkdirSync(dir, { recursive: true });
const checks = []; let browser;
const words = {
  en: { check: 'Check results', read: 'Read result status', more: 'More checks are needed. Your current AI is unchanged.',
    pass: 'Checks passed. Your current AI is unchanged.', fail: 'This change did not pass. Your current AI is unchanged.',
    error: 'Results are unconfirmed. Read the status before continuing.' },
  hi: { check: 'नतीजे जांचें', read: 'नतीजे की स्थिति देखें', more: 'अभी और जांच चाहिए। आपका मौजूदा AI नहीं बदला है।',
    pass: 'जांच पास हुई। आपका मौजूदा AI नहीं बदला है।', fail: 'यह बदलाव जांच पास नहीं कर पाया। आपका मौजूदा AI नहीं बदला है।',
    error: 'नतीजे की पुष्टि नहीं हुई। पहले स्थिति देखें।' },
};
async function bounded(promise, label) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label)), 15_000); })]); }
  finally { clearTimeout(timer); }
}
try {
  browser = await chromium.launch({ headless: true });
  for (const width of [390, 1440]) for (const language of ['en', 'hi']) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.addInitScript(() => {
      window.__qualificationAborts = [];
      const original = window.fetch.bind(window);
      window.fetch = (input, init) => {
        if (String(input).includes('/api/replica-candidate-eval') && init?.signal) {
          const body = JSON.parse(init.body);
          init.signal.addEventListener('abort', () => window.__qualificationAborts.push(body), { once: true });
        }
        return original(input, init);
      };
    });
    const requests = [], activationReads = [], errors = [], apiPaths = [], receipts = new Map();
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { const path=new URL(request.url()).pathname;if(path.startsWith('/api/'))apiPaths.push(path); });
    let mode = 'inconclusive', release, entered, settled, markEntered, markSettled;
    const unavailable = { available: false, active_changed: false };
    const result = verdict => ({ available: true, active_changed: false, qualification_id: QID, verdict,
      checks: { failures: verdict === 'fail' ? ['owner_preference_failed'] : [], inconclusive: verdict === 'inconclusive' ? ['safety_evidence_missing'] : [] } });
    const mutations = () => requests.filter(item => item.body.op === 'qualify');
    await page.route('**/api/replica-candidate-activation', async route => {
      const body=route.request().postDataJSON();
      assert.deepEqual(body,{op:'status',replica_id:RID,candidate_id:body.candidate_id});
      assert([CID,OTHER].includes(body.candidate_id));activationReads.push(body);
      return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({
        replica_id:RID,candidate_id:body.candidate_id,active_capability_id:null,current_candidate_id:null,
        qualification_id:null,can_activate:false,can_experiment:false,experimental_qualification_id:null,
        can_reset:false,reset_target_capability_id:null,
        selection_kind:null,rollback_target_capability_id:null,can_rollback:false,blockers:['qualification_required'],
      })});
    });
    await page.route('**/api/replica-candidate-eval', async route => {
      const body = route.request().postDataJSON(), auth = route.request().headers().authorization;
      assert.equal(route.request().method(), 'POST');
      assert.deepEqual(body, { op: body.op, replica_id: RID, candidate_id: body.candidate_id });
      assert([CID, OTHER].includes(body.candidate_id));
      assert(['status', 'qualification_status', 'qualify'].includes(body.op));
      assert(['Bearer fixture-a', 'Bearer fixture-b'].includes(auth));
      requests.push({ body, auth });
      const json = value => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
      if (body.op === 'status') return json({ evaluation: { available: true, replica_id: RID,
        state: 'complete', progress: { completed: 30, total: 30 }, assignment: null, dimensions: [] } });
      const key = `${auth}:${body.candidate_id}`;
      if (body.op === 'qualification_status') return json({ qualification: receipts.get(key) ?? unavailable });
      const receipt = mode === 'invalid' ? { ...result('pass'), active_changed: true } : result(mode === 'hold' ? 'pass' : ['pass', 'fail'].includes(mode) ? mode : 'inconclusive');
      receipts.set(key, receipt);
      try {
        if (mode === 'hold') await new Promise(resolve => { release = resolve; markEntered(); });
        if (mode === 'lost') { mode = 'inconclusive'; return await route.fulfill({ status: 200, contentType: 'application/json', body: '{' }); }
        return await json({ qualification: receipt });
      } catch (cause) {
        if (!String(cause).match(/closed|cancel|intercept|Invalid Interception/i)) throw cause;
      } finally { markSettled?.(); }
    });
    const copy = words[language];
    const check = page.getByRole('button', { name: copy.check, exact: true });
    const read = page.getByRole('button', { name: copy.read, exact: true });
    const reset = async nextMode => {
      mode = nextMode; receipts.clear(); requests.length = 0; activationReads.length = 0;
      entered = new Promise(resolve => { markEntered = resolve; }); settled = new Promise(resolve => { markSettled = resolve; });
      await page.goto(`${origin}/?lang=${language}`); await check.waitFor();
      await page.getByText('This version needs more checks before private use.',{exact:true}).waitFor();
      assert.deepEqual(requests.map(item => item.body.op), ['status', 'qualification_status']);
      assert.equal(mutations().length, 0);
    };

    await reset('inconclusive'); await check.focus(); assert(await check.evaluate(el => el === document.activeElement));
    await page.keyboard.press('Enter'); await page.getByText(copy.more, { exact: true }).waitFor();
    await page.waitForFunction(() => document.querySelector('.candidate-eval-results')?.getAttribute('aria-busy') === 'false');
    assert.equal(mutations().length, 1);
    await bounded((async()=>{while(activationReads.length<2)await new Promise(resolve=>setImmediate(resolve));})(), 'Successful explicit qualification did not refresh activation status');
    assert.equal(activationReads.length,2);
    assert.equal(await page.getByText('safety_evidence_missing', { exact: true }).count(), 0);
    checks.push(`${width}/${language}: completion reads status only; explicit keyboard qualification stays inconclusive with missing safety`);

    for (const verdict of ['fail', 'pass']) {
      await reset(verdict); await check.click(); await page.getByText(copy[verdict], { exact: true }).waitFor();
      assert.equal(mutations().length, 1);
    }
    checks.push(`${width}/${language}: synthetic pass/fail render unchanged-active state without activation requests`);
    await page.screenshot({ path: join(dir, `results-${width}-${language}.png`), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);

    await reset('invalid'); await check.click(); await page.getByText(copy.error, { exact: true }).waitFor();
    assert.equal(await check.count(), 0); assert.equal(await page.getByText(copy.pass, { exact: true }).count(), 0);
    checks.push(`${width}/${language}: active-change malformed receipt cannot render pass or invite immediate retry`);

    await reset('lost'); await check.click(); await page.getByText(copy.error, { exact: true }).waitFor();
    assert.equal(mutations().length, 1); assert.equal(await check.count(), 0);
    await read.click(); await check.waitFor(); assert.equal(mutations().length, 1);
    await page.getByText(copy.more, { exact: true }).waitFor();
    checks.push(`${width}/${language}: lost qualification response recovers through status only with no duplicate mutation`);

    for (const change of ['Switch account', 'Switch candidate', 'Close review']) {
      await reset('hold'); await check.evaluate(el => { el.click(); el.click(); });
      await bounded(entered, 'Qualification mutation did not reach held route'); assert.equal(mutations().length, 1);
      assert.equal(await check.isDisabled(), true);
      await page.getByRole('button', { name: change, exact: true }).click();
      await page.waitForFunction(() => window.__qualificationAborts.some(body => body.op === 'qualify'));
      if (change !== 'Close review') await check.waitFor();
      release(); release = null; await bounded(settled, 'Cancelled qualification receipt did not settle');
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      if (change !== 'Close review') {
        await page.getByText(copy.more, { exact: true }).waitFor();
        assert.equal(await page.getByText(copy.pass, { exact: true }).count(), 0);
        const statusCalls = requests.filter(item => item.body.op === 'qualification_status');
        const latest = statusCalls.at(-1);
        assert.equal(latest.auth, change === 'Switch account' ? 'Bearer fixture-b' : 'Bearer fixture-a');
        assert.equal(latest.body.candidate_id, change === 'Switch candidate' ? OTHER : CID);
      } else assert.equal(await page.locator('.candidate-eval-results').count(), 0);
      assert.equal(mutations().length, 1);
      checks.push(`${width}/${language}: ${change} aborts held mutation and rejects late receipt; duplicate click stays one request`);
    }
    assert.deepEqual(errors, []);
    assert(apiPaths.every(path => ['/api/replica-candidate-eval','/api/replica-candidate-activation'].includes(path)), 'Only comparison and activation status APIs are allowed');
    await page.close();
  }
  writeFileSync(join(dir, 'result.json'), JSON.stringify({ checks, scope: 'synthetic mounted qualification UI; minimal fixture CSS; no SQL/provider/safety proof' }, null, 2));
  console.log(JSON.stringify({ passed: checks.length, checks }, null, 2));
} catch (cause) {
  writeFileSync(join(dir, 'failure.json'), JSON.stringify({ checks, error: String(cause.message) }, null, 2)); throw cause;
} finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
