// Actual memory/consolidation dispatch, synthetic responses only. No model,
// storage or database request may leave this process.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.AZURE_ENDPOINT = 'https://fixture.services.ai.azure.com/models';
process.env.AZURE_API_KEY = 'fixture-key';
process.env.OPENROUTER_API_KEY = 'fixture-key';
process.env.SUPABASE_URL = 'https://fixture.supabase.co';
process.env.SUPABASE_KEY = 'fixture-key';
delete process.env.VYAKTI_MODEL_SERVING;
globalThis.fetch = async () => assert.fail('unexpected network');
const memory = await import('../api/memory.js');
const consolidate = await import('../api/consolidate.js');
const env = { VYAKTI_MODEL_SERVING: 'azure_only', AZURE_ENDPOINT: process.env.AZURE_ENDPOINT,
  AZURE_API_KEY: 'fixture-key', AZURE_PHOTO_MODEL: 'fixture-vision-deployment', AZURE_AUDIT_MODEL: 'fixture-audit-deployment' };
const messages = [{ role: 'user', content: 'synthetic fixture' }];
const photo = { device: 'no-memory-write', url: `${process.env.SUPABASE_URL}/storage/v1/object/public/meera-photos/fixture.png` };
const candidates = [{ id: '10000000-0000-4000-8000-000000000001', name: 'fixture', summary: 'synthetic fixture' }];
const response = (text = 'fixture answer', finish = 'stop') => new Response(JSON.stringify({
  choices: [{ finish_reason: finish, message: { content: text } }], usage: { prompt_tokens: 7, completion_tokens: 3 },
}));
let checks = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++checks} - ${name}`); }
const noFetch = async () => assert.fail('dispatch must not run');
const lanes = [
  ['memory', (options) => memory.extractChat(messages, 25, options)],
  ['consolidate', (options) => consolidate.llm(messages, 25, options)],
  ['photo', (options) => memory.opDescribe(photo, options)],
  ['audit', (options) => consolidate.auditJudge('fixture fact', [], ['fixture source'], options)],
];

await check('strict primary-origin guard blocks deceptive hosts before dispatch in all four lanes', async () => {
  for (const [, run] of lanes) for (const endpoint of ['https://openrouter.ai/api/v1', 'https://fixture.services.ai.azure.com.evil.test',
    'http://fixture.services.ai.azure.com', 'https://user:secret@fixture.services.ai.azure.com',
    'https://fixture.services.ai.azure.com:444', 'https://fixture.services.ai.azure.com/#fragment']) {
    await assert.rejects(run({ env: { ...env, AZURE_ENDPOINT: endpoint }, fetchImpl: noFetch }),
      { code: 'model_serving_origin_denied', message: 'model_serving_origin_denied' });
  }
});
await check('missing endpoint or key is a named configuration failure, never a foreign fallback', async () => {
  for (const [name, run] of lanes) for (const missing of ['AZURE_ENDPOINT', 'AZURE_API_KEY']) {
    const options = { ...env }; delete options[missing];
    await assert.rejects(run({ env: options, fetchImpl: noFetch }),
      { code: `${name === 'photo' || name === 'memory' ? 'memory' : 'consolidate'}_azure_unconfigured`, status: 503 });
  }
});
await check('strict failures make exactly one Azure attempt, reject redirects and never become empty or audit abstention', async () => {
  for (const [name, run] of lanes) for (const fail of [
    () => new Response('', { status: 500 }), () => new Response('', { status: 302 }),
    () => { throw new Error('private endpoint and credential details'); },
    () => response('', 'stop'), () => response('cut off', 'length'), () => response('blocked', 'content_filter'),
    () => new Response('not json'), () => response(null),
  ]) {
    const calls = [];
    await assert.rejects(run({ env, fetchImpl: async (url, init) => {
      calls.push(url); assert.equal(init.redirect, 'error'); return fail();
    } }), error => /^memory_azure_|^consolidate_azure_/.test(error.code) && !error.message.includes('private'));
    assert.deepEqual(calls, [`${env.AZURE_ENDPOINT}/chat/completions`], name);
  }
});
await check('Azure extraction succeeds through the actual helpers and retains consolidation usage', async () => {
  for (const [name, run] of lanes.slice(0, 2)) {
    const before = consolidate.costSnapshot();
    const got = await run({ env, fetchImpl: async (url, init) => {
      assert.equal(url, `${env.AZURE_ENDPOINT}/chat/completions`);
      assert.equal(init.redirect, 'error'); assert.equal(JSON.parse(init.body).model, 'grok-4-1-fast-reasoning');
      return response('fixture answer');
    } });
    assert.equal(got, 'fixture answer');
    if (name === 'consolidate') {
      const delta = consolidate.costDelta(before);
      assert.equal(delta.azure_attempts, 1); assert.equal(delta.azure_calls, 1);
      assert.equal(delta.azure_tokens_in, 7); assert.equal(delta.fallback_attempts, 0);
    }
  }
});
await check('photo requires explicit Azure vision deployment and preserves image input', async () => {
  for (const model of [undefined, '', ' ']) await assert.rejects(memory.opDescribe(photo, {
    env: { ...env, AZURE_PHOTO_MODEL: model }, fetchImpl: noFetch,
  }), { code: 'memory_azure_photo_model_unconfigured', status: 503 });
  const got = await memory.opDescribe(photo, { env, fetchImpl: async (url, init) => {
    assert.equal(url, `${env.AZURE_ENDPOINT}/chat/completions`);
    const body = JSON.parse(init.body);
    assert.equal(body.model, env.AZURE_PHOTO_MODEL);
    assert.deepEqual(body.messages[0].content[1], { type: 'image_url', image_url: { url: photo.url } });
    return response('a plain worksheet');
  } });
  assert.deepEqual(got, { desc: 'a plain worksheet' });
});
await check('photo provenance caller passes its actual configured model into the existing writer', () => {
  const src = readFileSync(new URL('../api/memory.js', import.meta.url), 'utf8');
  assert.ok(src.includes('recordPhotoMemory(device, url, desc, { extractorModel })'));
  assert.ok(src.includes('{ claim: desc, extractorModel, confidence: PHOTO_VISION_CONFIDENCE'));
  assert.ok(!src.includes('{ claim: desc, extractorModel: PHOTO_DESC_MODEL'));
});
await check('audit requires separate configured deployment and records only explicit verdicts', async () => {
  for (const model of [undefined, '', ' ', 'grok-4-1-fast-reasoning']) await assert.rejects(consolidate.auditJudge('fact', [], [], {
    env: { ...env, AZURE_AUDIT_MODEL: model }, fetchImpl: noFetch,
  }), { code: 'consolidate_azure_audit_model_unconfigured', status: 503 });
  for (const [text, verdict] of [['YES', 'entailed'], ['NO', 'refuted'], ['ABSTAIN', 'abstain']]) {
    assert.equal(await consolidate.auditJudge('fact', [], [], { env, fetchImpl: async (_url, init) => {
      assert.equal(JSON.parse(init.body).model, env.AZURE_AUDIT_MODEL); return response(text);
    } }), verdict);
  }
  await assert.rejects(consolidate.auditJudge('fact', [], [], { env, fetchImpl: async () => response('maybe yes') }),
    { code: 'consolidate_azure_audit_response_invalid' });
});
await check('forget resolver success retains identifier closure through Azure', async () => {
  let calls = 0;
  const got = await memory.askForgetHook('fixture', candidates, { env, fetchImpl: async (_url, init) => {
    calls++; assert.equal(init.redirect, 'error'); return response(JSON.stringify({ ids: [candidates[0].id] }));
  } });
  assert.deepEqual(got, { ids: [candidates[0].id] }); assert.equal(calls, 1);
});
await check('forget failures retain explicit failed state and never reach Google or another lane', async () => {
  for (const options of [
    { env: { ...env, AZURE_ENDPOINT: 'https://openrouter.ai' }, fetchImpl: noFetch },
    { env: { VYAKTI_MODEL_SERVING: 'azure_only' }, fetchImpl: noFetch },
    { env, fetchImpl: async () => { throw new Error('private details'); } },
    { env, fetchImpl: async () => response('not a resolver result') },
    { env, fetchImpl: async () => response('cut off', 'length') },
  ]) {
    const got = await memory.askForgetHook('fixture', candidates, options);
    assert.equal(got.failed, true); assert.ok(got.code); assert.equal(got.ids, undefined);
    assert.ok(!got.code.includes('private'));
  }
});
await check('nonstrict extraction and consolidation retain Azure-then-OpenRouter compatibility', async () => {
  for (const [, run] of lanes.slice(0, 2)) {
    const calls = [];
    globalThis.fetch = async (url) => { calls.push(url); return calls.length === 1 ? new Response('', { status: 500 }) : response('legacy answer'); };
    assert.equal(await run({ env: {} }), 'legacy answer');
    assert.deepEqual(calls, [`${env.AZURE_ENDPOINT}/chat/completions`, 'https://openrouter.ai/api/v1/chat/completions']);
  }
  globalThis.fetch = noFetch;
});
await check('nonstrict photo retains its original provider and empty-failure contract', async () => {
  const calls = [];
  globalThis.fetch = async url => { calls.push(url); return new Response('', { status: 500 }); };
  assert.deepEqual(await memory.opDescribe(photo, { env: {} }), { desc: '' });
  assert.deepEqual(calls, ['https://openrouter.ai/api/v1/chat/completions']);
  globalThis.fetch = noFetch;
});
await check('strict consolidation preflight fails before any query, write or dispatch without audit config', async () => {
  process.env.VYAKTI_MODEL_SERVING = 'azure_only'; delete process.env.AZURE_AUDIT_MODEL;
  await assert.rejects(consolidate.runConsolidation({ onlyPerson: candidates[0].id }),
    { code: 'consolidate_azure_audit_model_unconfigured', status: 503 });
});
function captureResponse() {
  return { statusCode: null, value: null, setHeader() {}, status(value) { this.statusCode = value; return this; }, json(value) { this.value = value; return this; } };
}
await check('actual memory handler returns named provider failures and makes no memory writes', async () => {
  globalThis.fetch = async () => { throw new Error('private transport detail'); };
  const res = captureResponse();
  await memory.default({ method: 'POST', headers: {}, body: { op: 'remember', device: candidates[0].id,
    recent: [{ role: 'me', content: 'a synthetic question' }, { role: 'her', content: 'a synthetic answer' }] } }, res);
  assert.equal(res.statusCode, 502); assert.deepEqual(res.value, { error: 'memory_azure_transport_failed' });
  globalThis.fetch = noFetch;
});
await check('actual consolidation handler exposes named preflight failure instead of a successful empty report', async () => {
  const res = captureResponse();
  await consolidate.default({ method: 'POST', headers: {}, body: { person: candidates[0].id } }, res);
  assert.equal(res.statusCode, 503); assert.deepEqual(res.value, { error: 'consolidate_azure_audit_model_unconfigured' });
});
await check('actual memory handler names malformed extraction and missing photo model without pretending to describe or remember', async () => {
  globalThis.fetch = async () => response('not extraction JSON');
  const extracted = captureResponse();
  await memory.default({ method: 'POST', headers: {}, body: { op: 'remember', device: candidates[0].id,
    recent: [{ role: 'me', content: 'synthetic question' }, { role: 'her', content: 'synthetic answer' }] } }, extracted);
  assert.equal(extracted.statusCode, 502); assert.deepEqual(extracted.value, { error: 'memory_azure_extraction_invalid' });
  globalThis.fetch = noFetch; delete process.env.AZURE_PHOTO_MODEL;
  const described = captureResponse();
  await memory.default({ method: 'POST', headers: {}, body: { op: 'describe', ...photo, device: candidates[0].id } }, described);
  assert.equal(described.statusCode, 503); assert.deepEqual(described.value, { error: 'memory_azure_photo_model_unconfigured' });
});
delete process.env.VYAKTI_MODEL_SERVING;
console.log(`Azure memory serving: ${checks} groups passed; mocked transport only, no model/database/cloud execution`);
