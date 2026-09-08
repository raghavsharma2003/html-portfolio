// Source/client contract coverage. This is not a mounted-browser or live API test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const base = new URL('../', import.meta.url);
const source = readFileSync(new URL('src/studio/publication/publicationApi.ts', base), 'utf8');
const app = readFileSync(new URL('src/studio/publication/PublicationApp.tsx', base), 'utf8').replace(/\r\n/g, '\n');
const owner = readFileSync(new URL('src/studio/publication/MaterialSharePanel.tsx', base), 'utf8');
let response, lastRequest;
globalThis.__publicationContractRequest = async (...args) => { lastRequest = args; return response; };
const compiled = ts.transpileModule(source.replace('import { replicaRequest } from "../replicaApi";',
  'const replicaRequest = globalThis.__publicationContractRequest;'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const client = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const hash = 'a'.repeat(64);
const v1 = { public_id: 'p1', version: 1, state: 'active', title: 'Physics', disclosure: 'AI', disclosure_hash: hash, can_text: true, can_voice: false,
  terms: { audience: 'signed_in_adult_attestation', memory: false, voice: false, quota_policy: 'admission_counts', publication_days: 30,
    retention_days: 30, visitor_question_limit: 20, total_question_limit: 200, budget_microusd: 1000 } };
const v2 = { ...v1, version: 2, terms: { ...v1.terms, memory: 'optional_visitor_continuity_v1', memory_policy_hash: hash,
  memory_policy: 'Use up to three recent exchanges within thirty days.', memory_max_exchanges: 3, memory_max_units: 3000 } };
const settings = { available: true, enabled: false, epoch: '0', policy_hash: hash, policy: v2.terms.memory_policy };
let checks = 0;
function check(name, body) { body(); checks++; console.log(`PASS ${name}`); }
check('v1 remains accepted', () => assert.equal(client.validatePublication(v1), v1));
check('v2 bounded terms accepted', () => assert.equal(client.validatePublication(v2), v2));
for (const patch of [{ version: '2' }, { version: 3 }, { terms: { ...v2.terms, memory_max_exchanges: 4 } },
  { terms: { ...v2.terms, memory_max_units: 3001 } }, { terms: { ...v2.terms, memory_policy_hash: 'invalid' } },
  { terms: { ...v2.terms, memory_policy: '' } }, { terms: { ...v2.terms, memory: false } }]) {
  check('invalid v2 contract rejected', () => assert.throws(() => client.validatePublication({ ...v2, ...patch })));
}
check('new visitor is disabled', () => assert.equal(client.validatePublicationMemory(settings).enabled, false));
check('v1 unavailable setting accepted', () => client.validatePublicationMemory({ available: false, enabled: false, epoch: '0', policy_hash: null, policy: null }));
for (const patch of [{ enabled: 'false' }, { epoch: 0 }, { epoch: '-1' }, { available: false }, { policy_hash: null }]) {
  check('invalid settings rejected', () => assert.throws(() => client.validatePublicationMemory({ ...settings, ...patch })));
}
response = { memory: settings };
await client.publicationMemorySettings('token', 'p1');
check('settings use authenticated pre-session operation', () => {
  assert.equal(lastRequest[0], 'token'); assert.deepEqual(JSON.parse(lastRequest[2].body), { op: 'memory_settings', public_id: 'p1' });
});
const choice = { remember: false, expected_memory_epoch: '0', expected_memory_policy_hash: hash };
response = { publication: v2, session_token: 'session-token-123456789', remaining_questions: 20, memory: settings };
await client.joinPublication('token', 'p1', hash, choice);
check('join carries explicit epoch and choice', () => assert.deepEqual(JSON.parse(lastRequest[2].body), {
  op: 'join', public_id: 'p1', expected_disclosure_hash: hash, is_adult: true, accept_ai_disclosure: true, accept_retention: true, ...choice,
}));
response = { ...response, memory: { ...settings, enabled: true } };
await assert.rejects(client.joinPublication('token', 'p1', hash, choice)); checks++;
response = { memory: settings, rejoin_required: false };
await assert.rejects(client.setPublicationMemory('token', 'p1', 'session', choice)); checks++;
response = { memory: settings, rejoin_required: true };
assert.equal((await client.setPublicationMemory('token', 'p1', 'session', choice)).rejoin_required, true); checks++;
check('ask has no repeated memory consent payload', () => {
  const ask = source.slice(source.indexOf('export const askPublication'), source.indexOf('export const readPublicationAnswer'));
  assert.doesNotMatch(ask, /remember|expected_memory/);
});
check('memory settings default unchecked and scoped', () => {
  assert.match(app, /\[remember, setRemember\] = useState\(false\)/);
  assert.match(app, /readStoredSession\(\)\?\.userId !== userId/);
  assert.match(app, /controller\.abort\(\); memoryRevision\.current\+\+/);
  assert.match(app, /setAdmission\(null\); setRequest\(null\); setRejoinRequired\(true\)/);
  assert.match(app, /Rejoin conversation/);
});
check('owner v2 choice clears review and defaults off', () => {
  assert.match(owner, /\[allowMemory, setAllowMemory\] = useState\(false\)/);
  assert.match(owner, /setChecks\(\{\}\); setData\(null\); setAllowMemory/);
});
check('memory changes cannot strand a completed request receipt', () => {
  assert.match(app, /action === "memory" && \(!admission \|\| !memory\?\.policy_hash \|\| requestId && \(!request \|\| request\.state === "pending" \|\| request\.state === "uncertain"\)\)/);
  const change = app.slice(app.indexOf('} else if (action === "memory")'), app.indexOf('} else if (action === "forget")'));
  assert.match(change, /saveReceipt\(null\); setAdmission\(null\); setRequest\(null\); setRejoinRequired\(true\)/);
  const failure = app.slice(app.indexOf('} catch {\n      if (generation.current === revision && action === "memory")'));
  assert.match(failure, /setMemoryError\(true\); setAdmission\(null\); setRequest\(null\); setRejoinRequired\(true\)/);
  assert.doesNotMatch(failure.slice(0, failure.indexOf('const unresolved')), /saveReceipt\(null\)/);
});
delete globalThis.__publicationContractRequest;
console.log(`${checks} publication continuity client/source checks passed; no browser, database or model proof.`);
