// Development-only loopback caller for the existing publication expiry route.
// Production Azure jobs use services/azure-web/cron-runner.mjs directly and
// remain HTTPS-only. This file never logs the bearer or response body.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const enabled = process.env.VYAKTI_DEV_PUBLICATION_EXPIRY === '1';
if (!enabled) throw new Error('dev_publication_expiry_disabled');
const secret = process.env.CRON_SECRET;
if (typeof secret !== 'string' || secret.length < 32) throw new Error('dev_publication_expiry_auth_missing');
const port = Number(process.env.VYAKTI_DEV_PORT || 5177);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('dev_publication_expiry_port_invalid');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runner = resolve(root, 'services/azure-web/cron-runner.mjs');
const childEnv = {
  ...process.env,
  AZURE_WEB_CRON_PATH: '/api/text-publication-expire',
  AZURE_WEB_PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
  AZURE_WEB_CRON_LOOPBACK: '1',
  VYAKTI_DEV_LOOPBACK: '1',
  VYAKTI_DEV_PUBLICATION_EXPIRY: '1',
};
const once = process.argv.includes('--once');
const intervalMs = 10 * 60 * 1000;
let active = null;
let stopping = false;

function runOnce() {
  if (stopping || active) return Promise.resolve(false);
  const args = process.env.VYAKTI_DEV_EXPIRY_TEST_CHILD === '1'
    ? ['-e', "require('node:fs').writeFileSync(process.env.VYAKTI_TEST_CHILD_PID_FILE, String(process.pid)); setTimeout(() => {}, 300000)"]
    : [runner];
  const child = spawn(process.execPath, args, { cwd: root, env: childEnv, stdio: ['ignore', 'ignore', 'ignore'] });
  const entry = { child, promise: null };
  entry.promise = new Promise(resolveRun => {
    child.once('error', () => resolveRun(false));
    child.once('close', code => resolveRun(code === 0));
  });
  active = entry;
  entry.promise.then(() => { if (active === entry) active = null; }, () => { if (active === entry) active = null; });
  return entry.promise;
}

const timer = once ? null : setInterval(() => { void runOnce(); }, intervalMs);
async function stop(signal) {
  if (stopping) return;
  stopping = true;
  if (timer) clearInterval(timer);
  if (active) {
    const entry = active;
    entry.child.kill('SIGTERM');
    await Promise.race([entry.promise, new Promise(resolve => setTimeout(resolve, 1500))]);
    if (active === entry) entry.child.kill('SIGKILL');
    await Promise.race([entry.promise, new Promise(resolve => setTimeout(resolve, 500))]);
  }
  process.exit(signal ? 0 : 1);
}
process.once('SIGINT', () => void stop('SIGINT'));
process.once('SIGTERM', () => void stop('SIGTERM'));

if (once) {
  const ok = await runOnce();
  if (!ok) process.exitCode = 1;
} else {
  await new Promise(() => {});
}
