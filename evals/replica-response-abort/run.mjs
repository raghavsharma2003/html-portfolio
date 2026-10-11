import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sourcePath = join(root, 'src/studio/replicaApi.ts');
const oldPath = fileURLToPath(new URL('./old-replicaApi.ts.txt', import.meta.url));
const sha = value => createHash('sha256').update(value).digest('hex');
const oldBytes = readFileSync(oldPath);
// Git checkout line endings are not a transport behavior change.
assert.equal(sha(oldBytes.toString().replaceAll('\r\n', '\n')), '2ecabf28ffcd1c37865ff218a640cf8a045b0fffb5f1a5980b39fe1880797973');
const load = async (bytes, name) => import(`data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(bytes.toString(), { mode: 'strip' }) + `\n//# sourceURL=${name}`).toString('base64')}`);
const current = await load(readFileSync(sourcePath), 'current-replica-api');
const old = await load(oldBytes, 'old-replica-api');
const realFetch = globalThis.fetch;
const originalTimeout = AbortSignal.timeout;
const checks = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const capture = promise => promise.then(value => ({ value }), error => ({ error }));
const server = createServer((req, res) => {
  if (req.url === '/pending') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.flushHeaders();
    res.write('{"jobs":');
    return; // Deliberately hold the body until the client aborts, not a timer.
  }
  const status = Number(req.url.slice(1)) || 200;
  res.writeHead(status, { 'Content-Type': 'text/plain' });
  res.end(status === 200 ? '{"jobs":[]}' : 'upstream unavailable');
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const request = (api = current, init) => api.replicaRequest('synthetic-token', `${base}/pending`, init);

async function abortedBody(api, useDefault = false) {
  const controller = new AbortController();
  const reading = deferred();
  let bodyError;
  let passedSignal;
  if (useDefault) AbortSignal.timeout = ms => { assert.equal(ms, 20_000); return controller.signal; };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, `${base}/pending`);
    passedSignal = init.signal;
    const response = await realFetch(url, init);
    const json = response.json.bind(response);
    response.json = async () => {
      const pending = json();
      reading.resolve();
      try { return await pending; } catch (error) { bodyError = error; throw error; }
    };
    return response;
  };
  try {
    const pending = capture(request(api, useDefault ? undefined : { signal: controller.signal }));
    await reading.promise;
    controller.abort(new DOMException('synthetic cancellation', useDefault ? 'TimeoutError' : 'AbortError'));
    const outcome = await pending;
    assert.equal(passedSignal, controller.signal);
    assert.ok(bodyError, 'native body rejected after headers');
    return { outcome, bodyError };
  } finally { globalThis.fetch = realFetch; AbortSignal.timeout = originalTimeout; }
}

async function fakeFetch(fn, work) {
  globalThis.fetch = fn;
  try { await work(); } finally { globalThis.fetch = realFetch; AbortSignal.timeout = originalTimeout; }
}

try {
  await check('old native deferred-body AbortError becomes successful empty object', async () => {
    const { outcome } = await abortedBody(old);
    assert.deepEqual(outcome, { value: {} });
    assert.throws(() => outcome.value.jobs.map(x => x), TypeError);
  });
  await check('current native deferred-body abort preserves exact original body rejection', async () => {
    const { outcome, bodyError } = await abortedBody(current);
    assert.equal(outcome.error, bodyError);
    assert.equal(outcome.error.name, 'AbortError');
  });
  await check('default 20000ms signal reaches fetch and native body abort rejects', async () => {
    const { outcome, bodyError } = await abortedBody(current, true);
    assert.equal(outcome.error, bodyError);
  });
  await check('native valid success JSON remains usable', async () => {
    assert.deepEqual(await current.replicaRequest('synthetic-token', `${base}/200`), { jobs: [] });
  });
  for (const status of [401, 500]) await check(`native non-JSON ${status} retains HTTP fallback`, async () => {
    await assert.rejects(current.replicaRequest('synthetic-token', `${base}/${status}`), error =>
      error instanceof current.ReplicaApiError && error.status === status && error.message === `request failed (${status})` && Object.keys(error.data).length === 0);
  });
  await check('old malformed successful JSON becomes empty success', () => fakeFetch(async () => new Response('{'), async () => {
    assert.deepEqual(await request(old), {});
  }));
  await check('malformed successful JSON rejects its original parse error', () => fakeFetch(async () => new Response('{'), async () => {
    await assert.rejects(request(), SyntaxError);
  }));
  await check('fetch rejection identity preserved', () => {
    const abort = new DOMException('original fetch abort', 'AbortError');
    return fakeFetch(async () => { throw abort; }, async () => assert.equal((await capture(request())).error, abort));
  });
  await check('body AbortError without signalled abort still preserves identity', () => {
    const abort = new DOMException('original body abort', 'AbortError');
    return fakeFetch(async () => ({ ok: false, status: 500, json: async () => { throw abort; } }), async () => assert.equal((await capture(request())).error, abort));
  });
  for (const useDefault of [false, true]) await check(`${useDefault ? 'default' : 'supplied'} signal checked after successfully decoded body`, async () => {
    const controller = new AbortController();
    const reason = new DOMException('abort during decoded response', useDefault ? 'TimeoutError' : 'AbortError');
    if (useDefault) AbortSignal.timeout = ms => { assert.equal(ms, 20_000); return controller.signal; };
    await fakeFetch(async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      return { ok: true, json: async () => { controller.abort(reason); return { jobs: [] }; } };
    }, async () => assert.equal((await capture(request(current, useDefault ? undefined : { signal: controller.signal }))).error, reason));
  });
  await check('aborted signal cannot become HTTP fallback after a body parse failure', async () => {
    const controller = new AbortController();
    const reason = new DOMException('cancelled', 'AbortError');
    await fakeFetch(async () => ({ ok: false, status: 401, json: async () => { controller.abort(reason); throw new SyntaxError('incomplete'); } }), async () => {
      assert.equal((await capture(request(current, { signal: controller.signal }))).error, reason);
    });
  });
  await check('structured HTTP error and source rejection preserve status and normalization', async () => {
    for (const [data, message] of [[{ error: 'owner_changed' }, 'owner changed'], [{ source: { rejection_code: 'source_blocked' } }, 'Source rejected: source blocked']]) {
      await fakeFetch(async () => Response.json(data, { status: 409 }), async () => {
        await assert.rejects(request(), error => error instanceof current.ReplicaApiError && error.status === 409 && error.message === message && JSON.stringify(error.data) === JSON.stringify(data));
      });
    }
  });
  await check('supplied signal does not allocate timeout and headers remain compatible', async () => {
    const controller = new AbortController();
    AbortSignal.timeout = () => { throw new Error('unexpected timeout'); };
    await fakeFetch(async (_url, init) => {
      assert.equal(init.signal, controller.signal);
      assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
      assert.equal(init.headers['Content-Type'], 'application/json');
      assert.equal(init.headers['X-Test'], 'synthetic');
      return Response.json({ jobs: [] });
    }, async () => assert.deepEqual(await request(current, { signal: controller.signal, headers: { 'X-Test': 'synthetic' } }), { jobs: [] }));
  });
} finally {
  globalThis.fetch = realFetch;
  AbortSignal.timeout = originalTimeout;
  server.closeAllConnections();
  await new Promise(r => server.close(r));
}
const result = { at: new Date().toISOString(), method: 'Actual TS transport loaded with Node type stripping; native loopback HTTP and controlled Response objects; no external services', source_sha256: sha(readFileSync(sourcePath)), old_sha256: sha(oldBytes), checks, passed: checks.length };
if (process.argv.includes('--record')) {
  const output = join(root, 'scratchpad', 'replica-response-abort', `${Date.now()}.json`);
  mkdirSync(resolve(output, '..'), { recursive: true });
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
  result.artifact = output;
}
console.log(JSON.stringify(result, null, 2));
