import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performanceGateResult } from '../scripts/check-performance.mjs';
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'vyakti-performance-prerequisites-'));
let checks = 0;
function refused(result, detail) { assert.equal(result.exitCode, 1); assert.equal(result.status, 'failed'); assert(result.findings.some(f => f.detail.includes(detail))); checks++; }
try {
  mkdirSync(join(temporary, 'scripts'));
  copyFileSync(join(root, 'scripts/check-performance.mjs'), join(temporary, 'scripts/check-performance.mjs'));
  copyFileSync(join(root, 'scripts/performance-hindi-interface.mjs'), join(temporary, 'scripts/performance-hindi-interface.mjs'));
  copyFileSync(join(root, 'scripts/performance-network-accounting.mjs'), join(temporary, 'scripts/performance-network-accounting.mjs'));
  writeFileSync(join(temporary, 'scripts/check-install.mjs'), 'export async function runInstallCheck(){throw new Error("must not reach installation without prerequisites")}');
  writeFileSync(join(temporary, 'scripts/build-suites-about-fixture.mjs'), 'export async function buildSuitesAboutFixture(){}');
  const run = (...args) => {
    const child = spawnSync(process.execPath, [join(temporary, 'scripts/check-performance.mjs'), '--diagnostics', ...args], { encoding: 'utf8', timeout: 15000 });
    assert.equal(child.status, 1, child.stderr); return JSON.parse(child.stdout);
  };
  refused(run(), 'dist/ absent');
  refused(run('--target', 'nonexistent-route'), 'unknown --target');
  mkdirSync(join(temporary, 'dist')); mkdirSync(join(temporary, 'site'));
  refused(run(), 'missing');
  for (const name of ['room-layout-fixture.html', 'studio.html', 'creator-page-fixture.html', 'room-about-fixture.html', 'suites-about-fixture.html']) writeFileSync(join(temporary, 'dist', name), '<html></html>');
  for (const name of ['index.html', 'vyakti.html']) writeFileSync(join(temporary, 'site', name), '<html></html>');
  refused(run(), 'playwright not installed');
  for (const cause of ['no chromium binary available', 'playwright not installed', 'dist absent']) refused(performanceGateResult({ install: { skipped: cause } }), cause);
  const failed = performanceGateResult({ budgetFindings: [{ target: '/studio', metric: 'LCP', detail: 'late paint' }], install: { findings: [{ check: 'no /api/ caching', detail: 'private API cached' }] }, staticFindings: [{ target: 'studio.html (static)', metric: 'Hindi preload', detail: 'unconditional preload' }] });
  assert.equal(failed.findings.length, 3); assert.equal(JSON.parse(JSON.stringify(failed)).exitCode, 1); checks++;
  assert.deepEqual(performanceGateResult({ install: { findings: [] } }), { status: 'passed', exitCode: 0, findings: [] }); checks++;
  console.log(`performance prerequisite/result checks passed: ${checks}; no browser launched`);
} finally {
  // This is only the exact fresh directory created above, never a repository path.
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert(temporary.includes('vyakti-performance-prerequisites-'));
  rmSync(temporary, { recursive: true, force: true });
}
