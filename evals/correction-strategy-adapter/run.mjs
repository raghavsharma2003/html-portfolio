import assert from 'node:assert/strict';
import { createAzureCorrectionStrategyAdapter } from '../../api/_correction/providers/azure-foundry.js';
import { CORRECTION_REQUEST_SCHEMA } from '../../api/_replica-correction-request.js';
import { canonicalJson, sha256Hex } from '../../api/_provenance/contracts.js';

// Transport fixtures prove adapter refusal and framing only, not Azure quality.
const request = { model: 'fixture-model', messages: [{ role: 'system', content: 'shape' }, { role: 'user', content: 'evidence' }],
  temperature: 0, max_tokens: 1200, response_format: { type: 'json_schema', json_schema: {
    name: 'vyakti_correction_shapes', strict: true, schema: { type: 'object' },
  } } };
const plan = () => ({ schema: CORRECTION_REQUEST_SCHEMA, dispatch_allowed: false,
  request: structuredClone(request), request_hash: sha256Hex(canonicalJson(request)) });
const payload = () => ({ choices: [{ finish_reason: 'stop', message: { content: '{"selections":[]}' } }],
  usage: { prompt_tokens: 23, completion_tokens: 7 } });
const config = { endpoint: 'https://fixture.services.ai.azure.com', model: request.model, apiKey: 'fixture-key-never-real' };
let calls = 0;
const adapter = (fetchImpl, extra = {}) => createAzureCorrectionStrategyAdapter({ ...config,
  fetchImpl: (...args) => { calls++; return fetchImpl(...args); }, ...extra });
const response = value => new Response(JSON.stringify(value));
const refuses = (operation, code) => assert.rejects(operation, { code });
let groups = 0;
async function group(name, run) { await run(); groups++; process.stdout.write(`PASS ${name}\n`); }

await group('Azure endpoint refuses arbitrary hosts, credentials, ports, paths and query', async () => {
  for (const endpoint of ['http://fixture.services.ai.azure.com', 'https://example.com',
    'https://fixture.services.ai.azure.com.evil.test', 'https://u:p@fixture.services.ai.azure.com',
    'https://fixture.services.ai.azure.com:444', 'https://fixture.services.ai.azure.com/proxy',
    'https://fixture.services.ai.azure.com?target=foo', 'https://fixture.services.ai.azure.com/#secret']) {
    assert.throws(() => createAzureCorrectionStrategyAdapter({ ...config, endpoint }), { code: 'correction_azure_endpoint_invalid' });
  }
});
await group('exact request, metadata, parsed proposal, measured usage, no plan mutation', async () => {
  const held = plan(), before = JSON.stringify(held);
  const instance = adapter(async (url, options) => {
    assert.equal(String(url), 'https://fixture.services.ai.azure.com/models/chat/completions?api-version=2024-05-01-preview');
    assert.equal(options.redirect, 'error'); assert.equal(options.method, 'POST');
    assert.deepEqual(JSON.parse(options.body), request); return response(payload());
  });
  assert.equal(instance.family, 'claim_extraction'); assert.equal(instance.name, 'azure-correction-strategy');
  assert.equal(instance.version, CORRECTION_REQUEST_SCHEMA); assert.equal(instance.billing.max_output_tokens, 1200);
  assert.deepEqual(await instance.generate({ plan: held }), { output: { selections: [] }, usage: { input_tokens: 23, output_tokens: 7 } });
  assert.equal(JSON.stringify(held), before);
});
await group('changed request, model, held flag and token limit refuse before dispatch', async () => {
  for (const mutate of [p => { p.request.messages[0].content = 'changed'; }, p => { p.request.model = 'other'; },
    p => { p.dispatch_allowed = true; }, p => { p.request.max_tokens = 10000; p.request_hash = sha256Hex(canonicalJson(p.request)); }]) {
    const held = plan(); mutate(held); const before = calls;
    await refuses(() => adapter(() => response(payload())).generate({ plan: held }), 'correction_azure_plan_invalid');
    assert.equal(calls, before);
  }
});
await group('usage must be measured nonnegative safe integers with positive safe sum', async () => {
  for (const usage of [undefined, { prompt_tokens: 0, completion_tokens: 0 }, { prompt_tokens: -1, completion_tokens: 2 },
    { prompt_tokens: '2', completion_tokens: 2 }, { prompt_tokens: 2, completion_tokens: 0.1 },
    { prompt_tokens: Number.MAX_SAFE_INTEGER, completion_tokens: 1 }]) {
    const value = payload(); value.usage = usage;
    await refuses(() => adapter(() => response(value)).generate({ plan: plan() }), 'correction_azure_usage_invalid');
  }
});
await group('incomplete, refusal, malformed JSON and nonobject output refused', async () => {
  for (const finish_reason of ['length', 'content_filter', null]) {
    const value = payload(); value.choices[0].finish_reason = finish_reason;
    await refuses(() => adapter(() => response(value)).generate({ plan: plan() }), 'correction_azure_response_incomplete');
  }
  for (const content of ['no JSON', '[]', 'null', '42']) {
    const value = payload(); value.choices[0].message.content = content;
    await refuses(() => adapter(() => response(value)).generate({ plan: plan() }), 'correction_azure_output_invalid');
  }
  const value = payload(); value.choices[0].message.refusal = 'refused';
  await refuses(() => adapter(() => response(value)).generate({ plan: plan() }), 'correction_azure_response_incomplete');
});
await group('redirect and HTTP error refused without retries', async () => {
  for (const status of [302, 429, 500]) {
    const before = calls;
    await refuses(() => adapter(() => new Response('', { status })).generate({ plan: plan() }),
      status === 302 ? 'correction_azure_redirect_refused' : 'correction_azure_http_error');
    assert.equal(calls, before + 1);
  }
});
await group('declared and streamed body bounds refuse', async () => {
  for (const result of [new Response('', { headers: { 'content-length': '512001' } }), new Response('x'.repeat(512001))])
    await refuses(() => adapter(() => result).generate({ plan: plan() }), 'correction_azure_response_too_large');
});
await group('pre-dispatch and after-response cancellation refuse', async () => {
  const aborted = new AbortController(); aborted.abort(); const before = calls;
  await refuses(() => adapter(() => response(payload())).generate({ plan: plan(), signal: aborted.signal }), 'correction_aborted');
  assert.equal(calls, before);
  const controller = new AbortController();
  await refuses(() => adapter(() => { controller.abort(); return response(payload()); })
    .generate({ plan: plan(), signal: controller.signal }), 'correction_aborted');
});
await group('deadline bounds ignored signal in fetch and stalled stream', async () => {
  await refuses(() => adapter(() => new Promise(() => {}), { timeoutMs: 10 }).generate({ plan: plan() }), 'correction_azure_timeout');
  let cancelled = false;
  const body = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
  await refuses(() => adapter(() => new Response(body), { timeoutMs: 10 }).generate({ plan: plan() }), 'correction_azure_timeout');
  assert.equal(cancelled, true);
});
await group('strict revision checks preserve measured spend on missing/mismatched model and fingerprint',async()=>{
  const strictRequest={...request,model:'gpt-4.1-mini'};
  const strictPlan={...plan(),request:strictRequest,request_hash:sha256Hex(canonicalJson(strictRequest))};
  const extra={endpoint:'https://raghavsharma1729-compan-resource.services.ai.azure.com',model:'gpt-4.1-mini',
    revisionBinding:{expected_response_model:'gpt-4.1-mini-2025-04-14',baseline_snapshot_hash:'a'.repeat(64)}};
  const valid={...payload(),model:'gpt-4.1-mini-2025-04-14',system_fingerprint:'fp_fixture47'};
  const result=await adapter(()=>response(valid),extra).generate({plan:strictPlan});
  assert.equal(result.provider_identity.response_model,valid.model);
  for(const changed of [{model:undefined},{model:'gpt-4.1-mini'},{model:'gpt-4.1-mini-2026-01-01'},
    {system_fingerprint:undefined},{system_fingerprint:'invalid'}]){
    await assert.rejects(()=>adapter(()=>response({...valid,...changed}),extra).generate({plan:strictPlan}),error=>{
      assert.match(error.code,/^provider_revision_/);assert.deepEqual(error.measured_usage,{input_tokens:23,output_tokens:7});return true;
    });
  }
  assert.throws(()=>adapter(()=>response(valid),{...extra,revisionBinding:{...extra.revisionBinding,expected_response_model:'alias'}}),
    {code:'provider_revision_expected_version_required'});
});
process.stdout.write(`${groups} correction strategy adapter groups passed; offline fixtures only.\n`);
