import assert from 'node:assert/strict';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';

const root = fileURLToPath(new URL('../../', import.meta.url));
const runner = readFileSync(join(root, 'services/azure-web/cron-runner.mjs'), 'utf8');
const loop = readFileSync(join(root, 'scripts/dev-publication-expiry-loop.mjs'), 'utf8');
const bicep = readFileSync(join(root, 'services/azure-web/infra/main.bicep'), 'utf8');
assert.match(runner, /AZURE_WEB_CRON_LOOPBACK === '1'/);
assert.match(runner, /VYAKTI_DEV_LOOPBACK === '1'/);
assert.match(runner, /VYAKTI_DEV_PUBLICATION_EXPIRY === '1'/);
assert.match(runner, /origin\.protocol === 'http:'/);
assert.match(runner, /origin\.hostname === '127\.0\.0\.1' \|\| origin\.hostname === 'localhost'/);
assert.match(loop, /AZURE_WEB_CRON_PATH: '\/api\/text-publication-expire'/);
assert.match(loop, /const intervalMs = 10 \* 60 \* 1000/);
assert.match(loop, /if \(stopping \|\| active\) return/);
assert.match(loop, /clearInterval\(timer\)/);
assert.match(loop, /entry\.child\.kill\('SIGTERM'\)/);
assert.match(loop, /entry\.child\.kill\('SIGKILL'\)/);
assert.match(bicep, /param enableSchedules bool = false/);
assert.doesNotMatch(loop, /console\.log\([^\n]*(secret|body|response)/i);
const pidFile = join(tmpdir(), `vyakti-expiry-child-${process.pid}.txt`);
try { unlinkSync(pidFile); } catch {}
const child = spawn(process.execPath, [join(root, 'scripts/dev-publication-expiry-loop.mjs'), '--once'], {
  cwd: root,
  env: { ...process.env, VYAKTI_DEV_PUBLICATION_EXPIRY: '1', VYAKTI_DEV_EXPIRY_TEST_CHILD: '1', VYAKTI_TEST_CHILD_PID_FILE: pidFile, CRON_SECRET: 'x'.repeat(32) },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const deadline = Date.now() + 2000;
while (!existsSync(pidFile) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 20));
assert.ok(existsSync(pidFile), 'owned child must start');
const ownedPid = Number(readFileSync(pidFile, 'utf8'));
assert.ok(Number.isInteger(ownedPid) && ownedPid > 0);
const started = Date.now();
child.kill('SIGTERM');
await Promise.race([once(child, 'exit'), new Promise((_, reject) => setTimeout(() => reject(new Error('wrapper_shutdown_timeout')), 2500))]);
const childDeadline = Date.now() + 2000;
let childAlive = true;
while (childAlive && Date.now() < childDeadline) {
  try { process.kill(ownedPid, 0); } catch { childAlive = false; }
  if (childAlive) await new Promise(resolve => setTimeout(resolve, 25));
}
try { unlinkSync(pidFile); } catch {}
assert.equal(childAlive, false, 'owned child must terminate with wrapper');
assert.ok(Date.now() - started < 2200, 'shutdown must not wait for the 300s HTTP child timeout');
console.log('dev publication expiry loopback: 12 source and spawned-child controls passed');
