// Offline response-boundary and transport controls. Does not prove mounted UI, SQL or Azure execution.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
const compile = (path) => ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
}).outputText;
const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const transport = dataUrl(compile('../src/studio/replicaApi.ts'));
const source = compile('../src/studio/candidateMaterializeApi.ts').replace("'./replicaApi'", JSON.stringify(transport));
const { parseMaterializeJob, requestMaterialization } = await import(dataUrl(source));
const scope = { replicaId: 'replica', datasetId: 'dataset', candidateId: 'candidate', sourceSetHash: 'a'.repeat(64) };
const row = { job_id: '10000000-0000-4000-8000-000000000003', replica_id: scope.replicaId, dataset_id: scope.datasetId,
  candidate_id: scope.candidateId, state: 'preparing', completed: 0, total: 2, active_changed: false, can_advance: true };
assert.equal(parseMaterializeJob(null, scope), null);
assert.deepEqual(parseMaterializeJob(row, scope), row);
for (const patch of [ { job_id: '' }, { replica_id: 'other' }, { dataset_id: 'other' }, { candidate_id: 'other' },
  { state: 'running' }, { completed: -1 }, { completed: 0.5 }, { completed: 3 }, { total: 0 }, { total: Infinity },
  { active_changed: true }, { can_advance: 'yes' }, { state: 'held' }, { state: 'ready', completed: 1, can_advance: false } ]) {
  assert.throws(() => parseMaterializeJob({ ...row, ...patch }, scope));
}
assert.equal(parseMaterializeJob({ ...row, state: 'ready', completed: 2, can_advance: false }, scope).state, 'ready');
const originalFetch = globalThis.fetch;
const calls = [];
try {
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return new Response(JSON.stringify({ job: row }), { status: 200 }); };
  for (const op of ['status', 'start', 'advance']) {
    const controller = new AbortController();
    await requestMaterialization('synthetic-token', scope, op, controller.signal);
    const { url, init } = calls.at(-1);
    assert.equal(url, '/api/replica-candidate-materialize');
    assert.equal(init.method, 'POST'); assert.equal(init.signal, controller.signal);
    assert.deepEqual(JSON.parse(init.body), { op, replica_id: scope.replicaId, dataset_id: scope.datasetId,
      candidate_id: scope.candidateId, expected_source_set_hash: scope.sourceSetHash });
  }
  globalThis.fetch = async () => { throw new TypeError('Synthetic lost response'); };
  await assert.rejects(requestMaterialization('synthetic-token', scope, 'advance', new AbortController().signal));
  assert.equal(calls.length, 3);
} finally { globalThis.fetch = originalFetch; }
console.log('Candidate materializer UI contract controls passed (offline only)');
