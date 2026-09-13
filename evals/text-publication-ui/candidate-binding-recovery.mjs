import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { build } from 'vite';
import { chromium } from 'playwright';
import { readTextPublicationReadiness } from '../../api/_text-publication-store.js';
import { PRIVATE_TEXT_CHOICES_SQL, PRIVATE_TEXT_SELECTION_SQL } from '../../api/_text-publication-source.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const id = value => `10000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
const replicaId = id(1), ownerId = id(2);
const validEnv = { PRIVATE_TEXT_REHEARSAL_KEK_ID: 'fixture-key',
  PRIVATE_TEXT_REHEARSAL_KEK_B64: Buffer.alloc(32, 7).toString('base64'),
  TEXT_PUBLICATION_BUDGET_USD: '0.10', CRON_SECRET: 'fixture-secret-long-enough' };
const calls = [];
const dbFor = (mode, actor = ownerId) => async (sql, params) => {
  calls.push({ mode, sql, params });
  if (sql === PRIVATE_TEXT_CHOICES_SQL) {
    assert.deepEqual(params, [replicaId, actor]);
    if (actor !== ownerId) return [];
    return [{ replica_id: replicaId, lifecycle: 'active', active_candidate_binding_required: mode.startsWith('candidate'), drafts: [], context_items: [] }];
  }
  if (/^select \* from vy_text_publication where replica_id=/i.test(sql)) return [];
  throw new Error('UNEXPECTED_QUERY');
};
const read = (mode, actor = ownerId, selected = false) => readTextPublicationReadiness(dbFor(mode, actor), actor,
  { replica_id: replicaId, ...(selected ? { sheet_id: id(3), context_item_id: id(4) } : {}) },
  { env: mode === 'other' ? {} : validEnv });

calls.length = 0;
const candidate = await read('candidate-source', ownerId, true);
assert.deepEqual(candidate.blockers, [{ code: 'candidate_binding_required', responsibility: 'platform' }]);
assert.equal(candidate.can_publish, false);
assert.equal(calls.some(call => call.sql === PRIVATE_TEXT_SELECTION_SQL), false, 'candidate-bound source is never presented as publishable');
const ordinary = await read('ordinary');
assert.deepEqual(ordinary.blockers, [{ code: 'text_publication_selection_required', responsibility: 'owner' }]);
await assert.rejects(() => read('candidate-wrong-owner', id(99)), error => error?.code === 'text_publication_not_found' && error?.status === 404);
assert.match(readFileSync(join(root, 'src/studio/CloneExperience.tsx'), 'utf8'), /<ExpertSharePanel[^>]*onReview=\{\(\) => chooseRoom\("evolve"\)\}/);
if (process.argv.includes('--source-only')) {
  console.log(JSON.stringify({ status: 'PASS', checks: 4, browser: false,
    scope: 'Actual publication readiness reader with stateful SQL fixtures; no SQL parser, database, provider, or deployment calls.' }));
  process.exit(0);
}

const entry = join(root, '__candidate_binding_share_fixture__.tsx');
const source = `import React,{useState}from'react';import{createRoot}from'react-dom/client';
import MaterialSharePanel from './src/studio/publication/MaterialSharePanel';
function Fixture(){const[review,setReview]=useState(false),query=new URLSearchParams(location.search),mode=query.get('case')||'candidate-en';
return review?<h1>AI review opened</h1>:<MaterialSharePanel token={mode} replicaId="${replicaId}" onReview={()=>setReview(true)}/>}
createRoot(document.getElementById('root')!).render(<Fixture/>);`;
const bundle = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: true,
  rolldownOptions: { input: entry, output: { entryFileNames: 'fixture.js' } } },
  plugins: [{ name: 'candidate-binding-share-fixture', resolveId(value) { if (value === entry) return entry; },
    load(value) { if (value === entry) return source; } }] });
const assets = new Map(bundle.output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]));
const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://fixture.invalid');
  const send = (value, status = 200) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(value)); };
  if (url.pathname === '/api/replica-text-publication') {
    const mode = request.headers.authorization?.replace('Bearer ', '') || '';
    try { return send({ readiness: await read(mode) }); }
    catch (error) { return send({ error: error?.code || 'fixture_error' }, error?.status || 500); }
  }
  if (url.pathname.startsWith('/api/')) return send({ error: 'unexpected_fixture_request' }, 500);
  if (assets.has(url.pathname)) { response.writeHead(200, { 'content-type': url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript' }); return response.end(assets.get(url.pathname)); }
  response.writeHead(200, { 'content-type': 'text/html' });
  response.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/fixture.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await launchSuiteBrowser("candidate-binding-recovery");
  const other = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await other.goto(`${origin}/?case=other&lang=en`);
  await other.getByText('Sharing is waiting on our platform. Your material stays private.', { exact: true }).waitFor();
  assert.equal(await other.getByRole('button', { name: 'Review your AI', exact: true }).count(), 0);
  await other.close();

  for (const [language, width, copy, action] of [
    ['en', 390, 'A candidate version of your AI is active. Material cannot be shared from this version. Your material stays private.', 'Review your AI'],
    ['hi', 1440, 'आपके AI का उम्मीदवार संस्करण अभी सक्रिय है। इस संस्करण से सामग्री साझा नहीं की जा सकती। सामग्री निजी रहेगी।', 'अपने AI की समीक्षा करें'],
  ]) {
    const mode = `candidate-${language}`, page = await browser.newPage({ viewport: { width, height: 900 } });
    await page.goto(`${origin}/?case=${mode}&lang=${language}`);
    await page.getByText(copy, { exact: true }).waitFor();
    assert.equal(calls.some(call => call.mode === mode && call.sql === PRIVATE_TEXT_SELECTION_SQL), false);
    await page.getByRole('button', { name: action, exact: true }).click();
    await page.getByRole('heading', { name: 'AI review opened', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.close();
  }
  console.log(JSON.stringify({ status: 'PASS', checks: 7,
    scope: 'Actual publication readiness reader through mounted MaterialSharePanel with synthetic localhost HTTP; no SQL parser, database, provider, publication, or deployment calls.' }));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
