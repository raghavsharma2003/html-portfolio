// Default mode is hosted-only mounted verification. Local use: --source-only or --build-only.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourceControls } from './source-controls.mjs';
import { RID, OTHER_ITEM, ITEM, EXCERPT, SOURCE_NAME, CLAIM_TEXT, OTHER_TEXT, FIFTH_TEXT, claims, personStatus, extractionStatus, locker } from './fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const sourceGroups = await sourceControls(root);
// This return precedes even the HTTP/browser imports, fixture build or artifact writes.
if (process.argv.includes('--source-only')) {
  console.log(`${sourceGroups.length} source-aware review source groups passed; no server, browser, database or provider started`);
  process.exit(0);
}
const { build } = await import('vite');
const built = await build({ root, configFile: false, logLevel: 'silent', build: { write: false, minify: true,
  rolldownOptions: { input: join(root, 'evals/source-aware-review-ui/host.html') } } });
const assets = new Map(built.output.map(asset => ['/' + asset.fileName, asset.type === 'chunk' ? asset.code : asset.source]));
if (process.argv.includes('--build-only')) {
  assert([...assets.keys()].some(path => path.endsWith('.html')));
  console.log(`${sourceGroups.length} source groups and actual component fixture build passed; no server or browser started`);
  process.exit(0);
}
// Employer-laptop policy: mounted mode is only permitted on a hosted CI runner.
if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Mounted source review eval requires GitHub-hosted CI; use --source-only or --build-only locally.');
const { createServer } = await import('node:http');
const { chromium } = await import('playwright');
const artifactDir = join(root, 'scratchpad/source-aware-review-ui-synthetic', `node-${process.versions.node}`);
mkdirSync(artifactDir, { recursive: true });
const results = [], requests = [], errors = [], unknownRequests = [], pending = [];
let scenario = 'normal', reads = 0, acceptedClaim = null, browser, page;
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://synthetic-fixture');
    const send = (status, value) => { if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(value)); } };
    if (url.pathname.startsWith('/api/')) {
      let raw = ''; for await (const piece of req) raw += piece;
      const body = raw ? JSON.parse(raw) : {};
      const replicaId = url.searchParams.get('replica_id') || body.replica_id;
      requests.push({ path: url.pathname, method: req.method, replicaId, auth: req.headers.authorization, body });
      assert(['Bearer synthetic-review-a', 'Bearer synthetic-review-b'].includes(req.headers.authorization), 'synthetic-only authorization');
      if (url.pathname === '/api/context-items' && req.method === 'GET') return send(200, locker());
      if (url.pathname === '/api/replica-claims' && req.method === 'GET') return send(200, { extraction: extractionStatus(replicaId) });
      if (url.pathname === '/api/replica-person-model' && req.method === 'GET') {
        reads++;
        const value = personStatus(replicaId, scenario);
        if (acceptedClaim) value.claims = value.claims.map(row => row.claim_id === acceptedClaim ? { ...row, decision: 'accepted', reason_code: 'representative' } : row);
        if (scenario === 'error') return send(503, { error: 'synthetic_review_temporarily_unavailable' });
        if (scenario === 'late' && reads > 1) value.claims = [{ ...claims()[0], body: 'CURRENT_SCOPE_SYNTHETIC_PROPOSAL' }];
        const release = () => send(200, { person_model: value });
        if ((scenario === 'loading' || scenario === 'late') && reads === 1) { pending.push(release); return; }
        return release();
      }
      if (url.pathname === '/api/replica-person-model' && req.method === 'POST') {
        assert.equal(body.op, 'decide_claim'); assert.equal(body.decision, 'accepted');
        assert.equal(body.reason_code, 'representative'); assert.equal(replicaId, RID);
        acceptedClaim = body.claim_id;
        return send(200, { decision: { decision_id: 'synthetic-decision', claim_id: body.claim_id, decision: 'accepted', reason_code: 'representative', created_at: '2026-09-29T00:00:00Z' } });
      }
      unknownRequests.push({ path: url.pathname, method: req.method }); return send(500, { error: 'unexpected_synthetic_request' });
    }
    const path = url.pathname === '/' ? '/evals/source-aware-review-ui/host.html' : url.pathname;
    if (!assets.has(path)) { res.writeHead(404); res.end('synthetic fixture asset not found'); return; }
    const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' };
    res.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' }); res.end(assets.get(path));
  } catch (cause) { errors.push(String(cause)); res.writeHead(500); res.end('synthetic fixture error'); }
});
const check = async (name, fn) => { await fn(); results.push(name); console.log('PASS mounted ' + name); };
const releasePending = () => { while (pending.length) pending.shift()(); };
async function waitPending() {
  const deadline = Date.now() + 10000;
  while (!pending.length && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(pending.length, 1, 'one held real review response reached the synthetic server');
}
try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ reducedMotion: 'reduce' }); page.setDefaultTimeout(12000);
  page.on('pageerror', cause => errors.push(cause.message));
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  const flushRender = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  async function open(next = 'normal', query = '') {
    releasePending(); scenario = next; reads = 0; acceptedClaim = null; requests.length = 0;
    await page.goto(`${origin}/?view=enrich&replica=${RID}${query}`);
    await page.waitForFunction(() => !!window.sourceReviewProbe?.committed);
  }
  async function reachByTab(locator) {
    for (let count = 0; count < 80; count++) {
      if (await locator.evaluate(element => element === document.activeElement)) return;
      await page.keyboard.press('Tab');
    }
    assert.fail('control not reachable through the actual Tab order');
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await check(`${width}: actual locker Teach action carries selected item into real claim review`, async () => {
      await open(); await page.getByRole('button', { name: /Files, images, links/ }).click();
      const teach = page.locator(`[data-teach-source="${ITEM}"]`);
      await teach.waitFor({ state: 'visible' }); await reachByTab(teach); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Reviewing this source', exact: true }).waitFor();
      assert.equal(await page.locator('.claim-review-source-name').textContent(), SOURCE_NAME);
      assert.equal(await page.locator('.person-claim').count(), 4);
      assert.equal(await page.getByText(OTHER_TEXT, { exact: true }).count(), 0);
      assert.equal(await page.getByText(CLAIM_TEXT, { exact: true }).count(), 1);
      assert.equal(await page.getByText(FIFTH_TEXT, { exact: true }).count(), 1);
      assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'navigation cannot approve, build or extract');
    });
    await check(`${width}: exact excerpt, truthful source coordinate disclosure and inference label`, async () => {
      const card = page.locator('.person-claim').filter({ has: page.getByText(CLAIM_TEXT, { exact: true }) });
      assert.equal(await card.locator('blockquote').textContent(), EXCERPT);
      assert.equal(await card.getByText('Proposed interpretation', { exact: true }).count(), 1);
      const summary = card.locator('summary'); await reachByTab(summary); await page.keyboard.press('Enter');
      assert.equal(await card.locator('details').getAttribute('open'), '');
      assert.match(await card.locator('details').textContent(), /Canonical text offsets: 103 to/);
      assert.match(await card.locator('details').textContent(), /Quote offsets: 3 to/);
      assert.match(await card.locator('details').textContent(), /Page mapping is unavailable/);
      for (const [body, visual] of [['Audio evidence remains a fallible transcription.', false], ['Video audio is not an interpretation of the picture.', true]]) {
        const media = page.locator('.person-claim').filter({ has: page.getByText(body, { exact: true }) });
        await media.locator('summary').click();
        assert.match(await media.locator('details').textContent(), /Transcription input window: 1200 to 4800 milliseconds/);
        assert.match(await media.locator('details').textContent(), /Word timing and mapping to the original recording are unavailable/);
        assert.equal((await media.locator('details').textContent()).includes('Visual content was not interpreted.'), visual);
      }
    });
    await check(`${width}: actual mobile and desktop layout fits and keyboard controls remain visible`, async () => {
      const all = page.getByRole('button', { name: 'All sources', exact: true });
      await all.focus();
      await page.keyboard.press('Tab'); await page.keyboard.press('Shift+Tab');
      const measurements = await page.evaluate(() => {
        const bounds = [...document.querySelectorAll('.claim-review-scope, .person-claim, .claim-source-evidence')].map(element => {
          const box = element.getBoundingClientRect(); return { left: box.left, right: box.right, width: box.width, scroll: element.scrollWidth, client: element.clientWidth };
        });
        const focused = document.activeElement, css = getComputedStyle(focused), box = focused.getBoundingClientRect();
        return { viewport: innerWidth, documentWidth: document.documentElement.scrollWidth, bounds, focused: { height: box.height, left: box.left, right: box.right, outline: css.outlineStyle, outlineWidth: css.outlineWidth } };
      });
      assert(measurements.documentWidth <= width + 1, JSON.stringify(measurements));
      assert(measurements.bounds.every(box => box.left >= -1 && box.right <= width + 1 && box.scroll <= box.client + 1), JSON.stringify(measurements));
      assert(measurements.focused.height >= 44); assert(measurements.focused.left >= -1 && measurements.focused.right <= width + 1);
      assert.notEqual(measurements.focused.outline, 'none'); assert(parseFloat(measurements.focused.outlineWidth) >= 1);
      await page.screenshot({ path: join(artifactDir, `selected-source-${width}.png`), fullPage: true });
    });
    await check(`${width}: All sources restores unrelated and legacy claims without rendering malformed evidence`, async () => {
      const all = page.getByRole('button', { name: 'All sources', exact: true }); await all.focus(); await page.keyboard.press('Enter');
      await page.getByText(OTHER_TEXT, { exact: true }).waitFor();
      assert.equal(await page.locator('.person-claim').count(), 7);
      const legacy = page.locator('.person-claim').filter({ hasText: 'An older saved proposal has no typed source provenance.' });
      assert.equal(await legacy.getByText('Saved excerpt', { exact: true }).count(), 1);
      assert.match(await legacy.textContent(), /Source type and location are unavailable/);
      assert.equal(await legacy.locator('details').count(), 0);
      assert.equal(await page.getByText('MALFORMED_PREVIEW_MUST_NOT_RENDER', { exact: true }).count(), 0);
      const malformed = page.locator('.person-claim').filter({ hasText: 'Malformed metadata must not become an exact source preview.' });
      assert.match(await malformed.textContent(), /No source preview is available/);
      assert.equal(requests.filter(request => request.method !== 'GET').length, 0);
    });
    await check(`${width}: only explicit claim acceptance uses the real authenticated mutation transport`, async () => {
      const card = page.locator('.person-claim').filter({ has: page.getByText(CLAIM_TEXT, { exact: true }) });
      await card.getByRole('button', { name: 'This is me', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.person-claim.decision-accepted'));
      const mutations = requests.filter(request => request.method !== 'GET'); assert.equal(mutations.length, 1);
      assert.equal(mutations[0].body.claim_id, claims()[0].claim_id); assert.equal(mutations[0].body.op, 'decide_claim');
      assert.equal(mutations[0].auth, 'Bearer synthetic-review-a');
    });
    await check(`${width}: second saved item with the same filename selects its own evidence`, async () => {
      await page.getByRole('button', { name: 'Back to files', exact: true }).click();
      const second = page.locator(`[data-review-source="${OTHER_ITEM}"]`); await second.waitFor({ state: 'visible' });
      await reachByTab(second); await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'Reviewing this source', exact: true }).waitFor();
      assert.equal(await page.locator('.claim-review-source-name').textContent(), SOURCE_NAME);
      assert.equal(await page.locator('.person-claim').count(), 2);
      assert.equal(await page.getByText(CLAIM_TEXT, { exact: true }).count(), 0);
      assert.equal(await page.getByText(OTHER_TEXT, { exact: true }).count(), 1);
      assert.equal(await page.getByText(FIFTH_TEXT, { exact: true }).count(), 1);
    });
  }
  await check('loading has no stale claims and settles from the held actual response', async () => {
    await open('loading', '&direct=1'); await page.getByText('Loading reviewed claims…', { exact: true }).waitFor();
    assert.equal(await page.locator('.person-claim').count(), 0);
    await waitPending();
    releasePending(); await page.getByText(CLAIM_TEXT, { exact: true }).waitFor();
  });
  await check('selected-source empty state can return to all sources', async () => {
    await open('empty', '&direct=1&selected=1'); await page.getByText('No linked claims available for this source.', { exact: true }).waitFor();
    assert.equal(await page.locator('.person-claim').count(), 0); await page.getByRole('button', { name: 'All sources', exact: true }).click();
    assert.equal(await page.getByRole('heading', { name: 'Reviewing this source', exact: true }).count(), 0);
  });
  await check('read failure is explicit and Retry loads current review', async () => {
    await open('error', '&direct=1'); await page.getByRole('alert').filter({ hasText: 'synthetic review temporarily unavailable' }).waitFor();
    assert.equal(await page.locator('.person-claim').count(), 0); scenario = 'normal';
    await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByText(CLAIM_TEXT, { exact: true }).waitFor();
  });
  for (const change of ['owner', 'token', 'replica']) await check(`pending actual review read cannot survive ${change} replacement`, async () => {
    await open('late', '&direct=1'); await page.getByText('Loading reviewed claims…', { exact: true }).waitFor();
    await waitPending();
    await page.evaluate(kind => window.sourceReviewProbe.change(kind), change);
    await page.waitForFunction(kind => { const value = window.sourceReviewProbe.committed; return kind === 'owner' ? value.owner === 'synthetic-owner-b' : kind === 'token' ? value.token === 'synthetic-review-b' : value.replicaId === '10000000-0000-4000-8000-000000000002'; }, change);
    await page.getByText('CURRENT_SCOPE_SYNTHETIC_PROPOSAL', { exact: true }).waitFor();
    const received = page.waitForResponse(response => response.url().includes('/api/replica-person-model'));
    releasePending(); await received; await flushRender();
    assert.equal(await page.getByText(CLAIM_TEXT, { exact: true }).count(), 0);
    assert.equal(await page.getByText('CURRENT_SCOPE_SYNTHETIC_PROPOSAL', { exact: true }).count(), 1);
    assert.equal(requests.filter(request => request.method !== 'GET').length, 0);
  });
  for (const change of ['owner', 'token', 'replica']) await check(`actual parent clears source selection on ${change} replacement`, async () => {
    await open(); await page.getByRole('button', { name: /Files, images, links/ }).click();
    await page.locator(`[data-review-source="${ITEM}"]`).click();
    await page.getByRole('heading', { name: 'Reviewing this source', exact: true }).waitFor();
    await page.evaluate(kind => window.sourceReviewProbe.change(kind), change);
    await page.waitForFunction(kind => { const value = window.sourceReviewProbe.committed; return kind === 'owner' ? value.owner === 'synthetic-owner-b' : kind === 'token' ? value.token === 'synthetic-review-b' : value.replicaId === '10000000-0000-4000-8000-000000000002'; }, change);
    await page.waitForFunction(() => !document.querySelector('.claim-review-scope'));
    assert.equal(await page.locator('.claim-review-source-name').count(), 0);
    assert.equal(requests.filter(request => request.method !== 'GET').length, 0);
  });
  await check('unmounted actual review cannot display its late response', async () => {
    await open('late', '&direct=1'); await page.getByText('Loading reviewed claims…', { exact: true }).waitFor();
    await waitPending();
    await page.evaluate(() => window.sourceReviewProbe.unmount());
    const received = page.waitForResponse(response => response.url().includes('/api/replica-person-model'));
    releasePending(); await received; await flushRender(); assert.equal(await page.locator('#root').textContent(), '');
  });
  assert.deepEqual(unknownRequests, []); assert.deepEqual(errors, []);
  writeFileSync(join(artifactDir, 'result.json'), JSON.stringify({ syntheticOnly: true, at: new Date().toISOString(), node: process.versions.node, sourceGroups, mountedGroups: results, errors, unknownRequests }, null, 2));
  console.log(`${sourceGroups.length} source groups and ${results.length} mounted source-aware review groups passed; synthetic hosted evidence only`);
} catch (cause) {
  writeFileSync(join(artifactDir, 'failure.json'), JSON.stringify({ syntheticOnly: true, at: new Date().toISOString(), sourceGroups, completedMountedGroups: results, failure: String(cause), errors, unknownRequests }, null, 2));
  await page?.screenshot({ path: join(artifactDir, 'failure-synthetic.png'), fullPage: true }).catch(() => {});
  throw cause;
} finally {
  releasePending(); await browser?.close(); await new Promise(resolve => server.close(resolve));
}
