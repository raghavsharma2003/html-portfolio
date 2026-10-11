// Offline response and transport controls only. No SQL, mounted interaction or safety proof.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const uri = text => `data:text/javascript;base64,${Buffer.from(text).toString('base64')}`;
const transport = uri(compile('../src/studio/replicaApi.ts'));
const source = compile('../src/studio/candidateEvalApi.ts').replace('"./replicaApi"', JSON.stringify(transport));
const { parseCandidateQualification, requestCandidateQualification } = await import(uri(source));
const unavailable = { available: false, active_changed: false };
const row = { available: true, active_changed: false, qualification_id: '10000000-0000-4000-8000-000000000001',
  verdict: 'inconclusive', checks: { failures: [], inconclusive: ['safety_evidence_missing'] } };
assert.deepEqual(parseCandidateQualification(unavailable), unavailable);
assert.deepEqual(parseCandidateQualification(row), row);
for (const patch of [{ active_changed: true }, { qualification_id: undefined }, { qualification_id: 'bad' },
  { verdict: 'approved' }, { checks: undefined }, { checks: { failures: [], inconclusive: 'missing' } },
  { verdict: 'pass' }, { checks: { failures: [null], inconclusive: [] } },
  { available: false }, { checks: { failures: Array(101).fill('failure'), inconclusive: [] } }]) {
  assert.throws(() => parseCandidateQualification({ ...row, ...patch }));
}
assert.throws(() => parseCandidateQualification({ ...unavailable, checks: { failures: [], inconclusive: [] } }));
assert.equal(parseCandidateQualification({ ...row, verdict: 'pass', checks: { failures: [], inconclusive: [] } }).verdict, 'pass');
assert.equal(parseCandidateQualification({ ...row, verdict: 'fail', checks: { failures: ['preference_failed'], inconclusive: [] } }).verdict, 'fail');
const originalFetch = globalThis.fetch, calls = [];
try {
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ qualification: row })); };
  for (const op of ['qualification_status', 'qualify']) {
    const controller = new AbortController();
    assert.deepEqual(await requestCandidateQualification('fixture-token', 'replica', 'candidate', op, controller.signal), row);
    const request = calls.at(-1);
    assert.equal(request.url, '/api/replica-candidate-eval'); assert.equal(request.init.method, 'POST');
    assert.equal(request.init.signal, controller.signal);
    assert.deepEqual(JSON.parse(request.init.body), { op, replica_id: 'replica', candidate_id: 'candidate' });
  }
  let failedCalls = 0;
  globalThis.fetch = async () => { failedCalls++; throw new TypeError('Synthetic lost response'); };
  await assert.rejects(requestCandidateQualification('fixture-token', 'replica', 'candidate', 'qualify', new AbortController().signal));
  assert.equal(failedCalls, 1);
} finally { globalThis.fetch = originalFetch; }
console.log('Qualification UI contract controls passed (offline only)');
