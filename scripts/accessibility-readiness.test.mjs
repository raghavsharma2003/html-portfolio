import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, relative, extname, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { awaitAccessibilityMount, MOUNT_TIMEOUT_MS } from './accessibility-readiness.mjs';

// An explicit immutable built fixture can be used without rebuilding the app.
const fixtureRoot = resolve(process.env.A11Y_FIXTURE_ROOT || resolve(import.meta.dirname, '..'));
const { chromium } = await import(pathToFileURL(join(fixtureRoot, 'node_modules/playwright/index.mjs')));
const dist = join(fixtureRoot, 'dist');
const axeSource = readFileSync(join(fixtureRoot, 'node_modules/axe-core/axe.min.js'), 'utf8');
const html = readFileSync(join(dist, 'room-layout-fixture.html'), 'utf8');
const match = html.match(/<script\b[^>]*type="module"[^>]*src="([^"]+)"[^>]*>[\s\S]*?<\/script>/);
assert.ok(match, 'actual fixture entry module exists');
const stripped = html.replace(match[0], '');
const out = resolve(import.meta.dirname, '../scratchpad/a11y-readiness', String(Date.now()));
mkdirSync(out, { recursive: true });
const report = { fixtureRoot, bound: MOUNT_TIMEOUT_MS, cases: [] };
const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const file = resolve(dist, '.' + url.pathname), rel = relative(dist, file);
  if (!rel || rel.startsWith('..') || isAbsolute(rel) || url.pathname.startsWith('/api/')) { res.writeHead(404); res.end(); return; }
  try {
    res.setHeader('content-type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[extname(file)] || 'application/octet-stream');
    if (url.pathname === '/room-layout-fixture.html') res.end(stripped);
    else res.end(readFileSync(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = 'http://127.0.0.1:' + server.address().port;
let browser, watchdog;
try {
  browser = await chromium.launch({ headless: true });
  watchdog = setTimeout(() => void browser.close(), 65_000);
  for (const name of ['delayed-entry', 'never-mount']) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage(), row = { name, errors: [] }; report.cases.push(row);
    page.on('pageerror', e => row.errors.push(e.message.slice(0, 160)));
    await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await page.goto(origin + '/room-layout-fixture.html?screen=join', { waitUntil: 'domcontentloaded' });
    // Old gate's exact snapshot must fail before the deliberately delayed entry.
    await page.waitForTimeout(1200);
    row.oldMounted = await page.evaluate(() => Boolean(document.querySelector('.room-shell')));
    assert.equal(row.oldMounted, false);
    if (name === 'delayed-entry') await page.evaluate(src => {
      setTimeout(() => { const entry = document.createElement('script'); entry.type = 'module'; entry.src = src; document.head.append(entry); }, 250);
    }, match[1]);
    const start = Date.now();
    row.mounted = await awaitAccessibilityMount(page, '.room-shell');
    row.waitMs = Date.now() - start;
    row.coverage = row.mounted ? 'covered' : 'critical';
    row.axeScanned = false;
    if (row.mounted) {
      await page.addScriptTag({ content: axeSource });
      row.violations = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] } })).violations.map(v => v.id));
      row.axeScanned = true;
      assert.deepEqual(row.errors, []);
      // A real violation inserted after mounting must be detected by real axe.
      await page.evaluate(() => { const img = document.createElement('img'); img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='; document.querySelector('.room-shell').append(img); });
      const negative = await page.evaluate(async () => (await window.axe.run(document, { runOnly: { type: 'rule', values: ['image-alt'] } })).violations.map(v => v.id));
      assert.ok(negative.includes('image-alt'));
      row.axeNegativeDetected = true;
    }
    if (name === 'delayed-entry') assert.equal(row.axeScanned, true);
    else { assert.equal(row.coverage, 'critical'); assert.equal(row.axeScanned, false); assert.ok(row.waitMs >= MOUNT_TIMEOUT_MS - 100); }
    await ctx.close();
  }
  await assert.rejects(awaitAccessibilityMount({ waitForSelector: async () => { throw new Error('closed-page-control'); } }, '.room-shell'), /closed-page-control/);
  report.nonTimeoutPropagated = true;
  report.state = 'passed';
} catch (error) { report.state = 'failed'; report.error = { name: error.name, message: error.message.slice(0, 300) }; process.exitCode = 1; }
finally {
  clearTimeout(watchdog);
  if (browser) await browser.close();
  await new Promise(r => server.close(r));
  writeFileSync(join(out, 'result.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, out }));
}
