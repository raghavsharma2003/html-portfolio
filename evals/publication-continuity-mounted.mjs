import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'vite';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = join(root, 'scratchpad', 'publication-continuity-mounted', String(Date.now())); mkdirSync(out, { recursive: true });
const paths = ['src/studio/publication/PublicationApp.tsx', 'src/studio/publication/MaterialSharePanel.tsx', 'src/studio/publication/publicationApi.ts'];
const sourceHashes = Object.fromEntries(paths.map(p => [p, createHash('sha256').update(readFileSync(join(root, p))).digest('hex')]));
const abs = p => JSON.stringify(join(root, p).replaceAll('\\', '/'));
writeFileSync(join(out, 'entry.tsx'), `import React,{useState}from'react';import{createRoot}from'react-dom/client';import'@fontsource-variable/geist';import'@fontsource-variable/instrument-sans';import App from ${abs(paths[0])};import Owner from ${abs(paths[1])};function Fixture(){const[id,setId]=useState('p1');window.fixturePublication=setId;return new URLSearchParams(location.search).has('owner')?<Owner token="synthetic-owner-token-0000" replicaId="replica-1"/>:<App publicId={id}/>;}createRoot(document.getElementById('root')).render(<Fixture/>);`);
const bundle = join(out, 'bundle');
await build({ root, configFile: false, logLevel: 'error', build: { outDir: bundle, emptyOutDir: true, lib: { entry: join(out, 'entry.tsx'), name: 'ContinuityFixture', formats: ['iife'], fileName: () => 'fixture.js' }, cssCodeSplit: false }, define: { 'process.env.NODE_ENV': JSON.stringify('production') } });
const js = readFileSync(join(bundle, 'fixture.js')), css = readFileSync(join(bundle, readdirSync(bundle).find(p => p.endsWith('.css'))));
const hash = 'a'.repeat(64), policy = 'With your permission, use up to 3 recent exchanges, up to 3000 characters, from the last 30 days. You can turn this off or delete your conversation.';
const terms = { audience: 'signed_in_adult_attestation', publication_days: 30, retention_days: 30, visitor_question_limit: 20, total_question_limit: 200, budget_microusd: 100000, quota_policy: 'admission_counts', memory: 'optional_visitor_continuity_v1', voice: false, memory_policy_hash: hash, memory_policy: policy, memory_max_exchanges: 3, memory_max_units: 3000 };
const publication = (id, version = 2) => ({ public_id: id, version, state: 'active', title: 'Physics with Mira', subject_domain: 'physics', disclosure: 'AI answers from published material.', disclosure_hash: hash, terms: version === 2 ? terms : { ...terms, memory: false }, created_at: '2026-09-08T00:00:00Z', expires_at: '2026-10-08T00:00:00Z', can_text: true, can_voice: false });
const token = user => `synthetic-visitor-token-${user}`;
const session = user => ({ userId: user, accessToken: token(user), refreshToken: 'synthetic-refresh', expiresAt: Date.now() + 3600000 });
let calls = [], settings = new Map(), receipts = new Map(), sessions = new Map(), lostSave = false, holdSettings = false, held = [], version = 2, pendingAnswer = false, blockMemory = false;
const errors = [], results = [];
const key = (user, id) => `${user}/${id}`;
function memory(user, id) { const k = key(user, id); if (!settings.has(k)) settings.set(k, { available: true, enabled: false, epoch: '0', policy_hash: hash, policy }); return { ...settings.get(k) }; }
const server = createServer(async (req, res) => {
  const send = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js); }
    if (url.pathname === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css); }
    if (!url.pathname.startsWith('/api/')) { res.setHeader('Content-Type', 'text/html'); return res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}</style><div id="root"></div><script src="/fixture.js"></script>'); }
    let raw = ''; for await (const part of req) raw += part;
    const input = raw ? JSON.parse(raw) : Object.fromEntries(url.searchParams), op = input.op;
    const user = (req.headers.authorization || '').replace('Bearer synthetic-visitor-token-', '');
    calls.push({ op, input, user });
    if (url.pathname === '/api/replica-text-publication') {
      const v2 = input.allow_memory === 'true';
      if (op === 'readiness') return send({ readiness: { replica_id: 'replica-1', state: 'ready', blockers: [], drafts: [{ sheet_id: 'sheet-1', name: 'Physics profile' }], context_items: [{ item_id: 'item-1', source_name: 'Physics notes', eligible: true }],
        selected: input.sheet_id && input.context_item_id ? { review_hash: (v2 ? 'b' : 'c').repeat(64), source_name: 'Physics notes', projection: { name: 'Mira', subjectDomain: 'physics' }, material_text: 'The period is time per oscillation.', terms: publication('p1', v2 ? 2 : 1).terms } : null,
        statement_set: `account-material-publication/v${v2 ? 2 : 1}`, statements: [{ id: 'publish', text: v2 ? 'I approve optional visitor memory.' : 'I approve publishing without memory.' }], can_publish: true, publications: [] } });
    }
    if (op === 'open') return send({ publication: publication(input.public_id, version) });
    assert(['A', 'B'].includes(user), 'synthetic authenticated visitor');
    if (op === 'memory_settings') { const value = memory(user, input.public_id); if (holdSettings) { holdSettings = false; held.push(() => send({ memory: value })); return; } return send({ memory: value }); }
    if (op === 'join') {
      if (version === 2) {
        const prior = memory(user, input.public_id); assert.equal(input.expected_memory_epoch, prior.epoch); assert.equal(input.expected_memory_policy_hash, hash);
        if (input.remember !== prior.enabled) { prior.enabled = input.remember; prior.epoch = String(Number(prior.epoch) + 1); settings.set(key(user, input.public_id), prior); }
      } else assert.equal(input.remember, undefined);
      const id = `synthetic-session-${sessions.size}`; sessions.set(id, { user, epoch: memory(user, input.public_id).epoch });
      return send({ publication: publication(input.public_id, version), session_token: id, remaining_questions: 20, expires_at: '2026-10-08T00:00:00Z', ...(version === 2 ? { memory: memory(user, input.public_id) } : {}) });
    }
    if (op === 'set_memory') {
      const current = memory(user, input.public_id); assert.equal(input.expected_memory_epoch, current.epoch);
      current.enabled = input.remember; current.epoch = String(Number(current.epoch) + 1); settings.set(key(user, input.public_id), current);
      if (lostSave) { lostSave = false; res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': '1024' }); res.flushHeaders(); res.write('{'); setTimeout(() => res.destroy(), 25); return; }
      return send({ memory: current, rejoin_required: true });
    }
    if (op === 'ask') {
      assert.equal(input.remember, undefined); assert.equal(input.expected_memory_epoch, undefined);
      const blocked = blockMemory && memory(user, input.public_id).enabled;
      const receipt = { public_id: input.public_id, request_id: input.request_id, state: blocked ? 'blocked' : pendingAnswer ? 'pending' : 'complete', billing_state: blocked ? 'released' : 'settled', can_voice: false, created_at: '2026-09-08T00:00:00Z', ...(blocked ? { failure_code: 'text_publication_memory_budget_exceeded' } : !pendingAnswer ? { answer: 'The period is two seconds.' } : {}) };
      receipts.set(input.request_id, { receipt, epoch: memory(user, input.public_id).epoch, user }); return send({ request: receipt });
    }
    if (op === 'result') { const previous = receipts.get(input.request_id); assert.equal(previous.user, user); const withdrawn = previous.epoch !== memory(user, input.public_id).epoch; return send({ request: withdrawn ? { ...previous.receipt, state: 'withdrawn', answer: undefined } : previous.receipt }); }
    if (op === 'forget') return send({ forgotten: true, private_payload_erased: true });
    throw Error(`Unexpected fixture operation ${op}`);
  } catch (error) { errors.push(error.message); send({ error: 'fixture_failure' }, 500); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
const check = name => { results.push(name); console.log(`PASS ${name}`); };
async function start(page) { await page.getByRole('checkbox', { name: /I am 18/ }).check(); await page.getByRole('button', { name: 'Start conversation', exact: true }).click(); await page.getByLabel('Your question', { exact: true }).or(page.getByRole('button', { name: 'Check answer status', exact: true })).waitFor(); }
async function ask(page) { await page.getByLabel('Your question', { exact: true }).fill('What is the period?'); await page.getByRole('button', { name: 'Ask', exact: true }).click(); await page.getByText('The period is two seconds.', { exact: true }).waitFor(); }
try {
  for (const width of [390, 1440]) {
    calls = []; settings.clear(); receipts.clear(); sessions.clear(); version = 2;
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(value => { if (!localStorage.getItem('meera.state.v1')) localStorage.setItem('meera.state.v1', JSON.stringify({ auth: value })); }, session('A'));
    await context.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(origin); const optional = page.getByRole('checkbox', { name: 'Remember my recent conversations (optional)', exact: true });
    await optional.waitFor(); assert.equal(await optional.isChecked(), false); assert.equal(await page.getByRole('button', { name: 'Start conversation', exact: true }).isDisabled(), true); check(`${width} initial memory off with separate adult admission`);
    await optional.check(); await start(page); await ask(page); assert.equal(calls.filter(c => c.op === 'join').at(-1).input.remember, true); check(`${width} opted-in join and real client ask without per-question consent`);
    await page.getByText('Your conversation', { exact: true }).click(); const saved = page.getByRole('checkbox', { name: 'Remember my recent conversations', exact: true });
    await saved.uncheck(); await page.getByRole('button', { name: 'Save memory choice', exact: true }).click(); await page.getByRole('button', { name: 'Rejoin conversation', exact: true }).waitFor();
    assert.equal(await optional.isChecked(), false); assert.equal(await page.evaluate(() => Object.keys(sessionStorage).some(k => k.startsWith('vyakti.publication.question.'))), false);
    await page.getByRole('button', { name: 'Rejoin conversation', exact: true }).click(); await page.getByLabel('Your question', { exact: true }).waitFor(); check(`${width} confirmed disable clears completed receipt and rejoins without deadlock`);
    await ask(page); await saved.check(); lostSave = true; const before = calls.filter(c => c.op === 'ask').length;
    await page.getByRole('button', { name: 'Save memory choice', exact: true }).click(); await page.getByText("We couldn't confirm your memory choice. Reload to check it before continuing.", { exact: true }).waitFor();
    assert.equal(calls.filter(c => c.op === 'ask').length, before); await page.getByRole('button', { name: 'Reload conversation', exact: true }).click(); await optional.waitFor(); assert.equal(await optional.isChecked(), true); await start(page);
    await page.getByRole('button', { name: 'Check answer status', exact: true }).click(); await page.getByText('This answer is no longer available.', { exact: true }).waitFor(); await page.getByLabel('Your question', { exact: true }).waitFor(); assert.equal(calls.filter(c => c.op === 'ask').length, before); check(`${width} ambiguous save reloads server choice and withdrawn receipt without replay`);
    blockMemory = true; await page.getByLabel('Your question', { exact: true }).fill('Use my previous long exchange.');
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
    await page.getByText('This exchange is too long to use as memory. Turn memory off to continue.', { exact: true }).waitFor();
    assert.equal(await page.locator('details.vp-data').evaluate(element => element.open), true); assert.equal(await saved.isChecked(), true);
    const blockedCall = calls.filter(c => c.op === 'ask').at(-1), blockedCount = calls.filter(c => c.op === 'ask').length;
    await saved.uncheck(); await page.getByRole('button', { name: 'Save memory choice', exact: true }).click();
    await page.getByRole('button', { name: 'Rejoin conversation', exact: true }).click(); await ask(page);
    assert.equal(calls.filter(c => c.op === 'ask').length, blockedCount + 1);
    assert.equal(calls.filter(c => c.op === 'ask' && c.input.request_id === blockedCall.input.request_id).length, 1);
    assert.equal(calls.filter(c => c.op === 'join').at(-1).input.remember, false); blockMemory = false;
    check(`${width} oversized memory exposes explicit opt-out, rejoin and fresh ask without replay`);
    await page.screenshot({ path: join(out, `visitor-${width}.png`), fullPage: true });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); check(`${width} no horizontal overflow`);
    await page.evaluate(value => { localStorage.setItem('meera.state.v1', JSON.stringify({ auth: value })); window.dispatchEvent(new Event('storage')); }, session('B'));
    await optional.waitFor(); assert.equal(await optional.isChecked(), false); assert.equal(await page.getByRole('checkbox', { name: /I am 18/ }).isChecked(), false); check(`${width} account switch resets consent and loads separate settings`);
    settings.set(key('B', 'p2'), { ...memory('B', 'p2'), enabled: true, epoch: '5' });
    holdSettings = true; await page.evaluate(() => window.fixturePublication('p2')); await page.getByText('Loading your memory choice', { exact: true }).waitFor();
    await page.evaluate(() => window.fixturePublication('p3')); await optional.waitFor(); held.splice(0).forEach(finish => finish()); assert.equal(await optional.isChecked(), false); check(`${width} late settings from previous publication are ignored`);
    version = 1; const settingsBefore = calls.filter(c => c.op === 'memory_settings').length; await page.evaluate(() => window.fixturePublication('p4')); await page.getByRole('heading', { name: 'Before your first question', exact: true }).waitFor();
    assert.equal(await optional.count(), 0); await start(page); assert.equal(calls.filter(c => c.op === 'memory_settings').length, settingsBefore); check(`${width} v1 remains connected without memory operations`);
    await page.goto(`${origin}/?owner`); await page.getByLabel('Teaching profile').selectOption('sheet-1'); await page.getByLabel('Material').selectOption('item-1');
    await page.getByRole('checkbox', { name: 'I approve publishing without memory.', exact: true }).check();
    await page.getByRole('checkbox', { name: 'Let visitors choose conversation memory', exact: true }).check();
    const ownerConsent = page.getByRole('checkbox', { name: 'I approve optional visitor memory.', exact: true }); await ownerConsent.waitFor(); assert.equal(await ownerConsent.isChecked(), false); assert.equal(await page.getByRole('button', { name: 'Publish link', exact: true }).isDisabled(), true);
    await page.screenshot({ path: join(out, `owner-${width}.png`), fullPage: true }); check(`${width} owner v2 switch requires fresh publication review`);
    await context.close();
  }
  assert.deepEqual(errors, []);
  for (const p of paths) assert.equal(createHash('sha256').update(readFileSync(join(root, p))).digest('hex'), sourceHashes[p], `source unchanged ${p}`);
  writeFileSync(join(out, 'receipt.json'), JSON.stringify({ completedAt: new Date().toISOString(), sourceHashes, results, fixtureErrors: errors, browserVersion: browser.version(), scope: 'Mounted production React/client with loopback fixture HTTP. No SQL, external model, cloud or semantic memory quality proof.' }, null, 2));
  console.log(`${results.length} mounted groups passed. ${out}`);
} catch (error) {
  const page = browser.contexts().flatMap(context => context.pages()).at(-1);
  const visible = page ? await page.locator('body').innerText().catch(() => '') : '';
  if (page) await page.screenshot({ path: join(out, 'failure.png'), fullPage: true }).catch(() => {});
  writeFileSync(join(out, 'failure.json'), JSON.stringify({ failedAt: new Date().toISOString(), message: error.message, stack: error.stack, results, errors, sourceHashes, calls, visible }, null, 2)); throw error;
}
finally { held.splice(0).forEach(finish => finish()); await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
