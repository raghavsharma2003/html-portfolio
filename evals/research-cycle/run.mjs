import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { ROOT, REGISTRY_PATH, buildQueue, calendarDate, citationIdentity, validateRegistry } from '../../scripts/research-cycle.mjs';

const registry = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_PATH), 'utf8'));
const copy = value => structuredClone(value);
let checks = 0;
const check = (name, run) => { run(); console.log(`PASS ${++checks}: ${name}`); };
function fixture() {
  return {
    schemaVersion: 1, asOf: '2026-09-27',
    sources: [{
      id: 'source-one', title: 'Synthetic source metadata', url: 'https://example.com/source',
      kind: 'official_docs', publishedAt: null, retrievedAt: '2026-09-27', version: 'fixture-v1',
      evidence: 'documentation', decision: 'experiment', claim: 'Fixture metadata only.',
      limitations: ['Not a research result.'], relevance: ['evaluation'], experimentId: 'experiment-one',
    }],
    experiments: [{
      id: 'experiment-one', title: 'Synthetic experiment metadata', state: 'implemented', outcome: null,
      observedAt: null, hypothesis: 'Fixture references can be validated.', sourceIds: ['source-one'],
      artifactPaths: ['scripts/research-cycle.mjs'], runCommand: 'display-only command',
      successCriteria: ['Metadata remains separate from scientific evidence.'], evidenceScope: 'offline_contract', result: null,
    }],
  };
}
function invalid(mutate, expected) {
  const value = fixture(); mutate(value);
  const errors = validateRegistry(value);
  assert.ok(errors.length > 0, 'invalid metadata must fail');
  if (expected) assert.match(errors.join('\n'), expected);
}
function completed(value, outcome = 'fail') {
  Object.assign(value.experiments[0], {
    state: 'completed', outcome, observedAt: '2026-09-27',
    result: 'Fixture ran one synthetic case and recorded the requested outcome; no provider call occurred.',
  });
  return value;
}

check('active registry points to existing platform artifacts', () => {
  assert.deepEqual(validateRegistry(registry), []);
  assert.ok(registry.experiments.some(experiment => experiment.artifactPaths.includes('evals/multimodal-claim-evidence/run.mjs')));
});

check('date parser rejects impossible and noncanonical dates', () => {
  for (const value of ['2026-02-29', '2026-13-01', '0000-01-01', '2026-9-27', null, 20260927]) assert.equal(calendarDate(value), null);
  assert.notEqual(calendarDate('2024-02-29'), null);
  invalid(value => { value.sources[0].retrievedAt = '2026-09-28'; }, /retrievedAt/);
  invalid(value => { value.sources[0].publishedAt = '2026-09-28'; }, /publishedAt/);
  invalid(value => { value.asOf = '2026-02-30'; }, /asOf/);
});

check('review horizon rejects date overflow', () => {
  invalid(value => { value.asOf = '9999-12-31'; value.sources[0].retrievedAt = '9999-12-31'; }, /calendar range/);
});

check('public citations exclude secrets and local addresses without fetching', () => {
  for (const value of [
    'http://example.com/paper', 'https://name:password@example.com/paper',
    'https://example.com/paper?token=secret', 'https://127.0.0.1/paper',
    'https://[::1]/paper', 'https://127.1/paper', 'https://localhost/paper',
    'https://host.internal/paper', 'https://example.com:8443/paper',
  ]) assert.throws(() => citationIdentity(value));
  assert.equal(citationIdentity('https://EXAMPLE.com/%70aper/#section'), 'https://example.com/paper');
});

check('duplicate identities and canonical citations are rejected', () => {
  invalid(value => value.sources.push(copy(value.sources[0])), /duplicate/);
  invalid(value => value.sources.push({ ...copy(value.sources[0]), id: 'source-two', url: 'https://example.com/%73ource/#part' }), /duplicate canonical citation/);
  invalid(value => value.experiments.push(copy(value.experiments[0])), /duplicate identifier/);
});

check('source and experiment references must resolve both ways', () => {
  invalid(value => { value.sources[0].experimentId = 'missing'; }, /link back/);
  invalid(value => { value.experiments[0].sourceIds = ['missing']; }, /unknown source/);
  invalid(value => { value.sources[0].experimentId = null; }, /requires a target/);
});

check('artifacts cannot escape the checkout or name absent files', () => {
  for (const artifact of ['../outside.md', '/outside.md', 'C:/outside.md', 'scripts\\research-cycle.mjs', 'scripts/../package.json', 'scripts', 'missing-artifact.md']) {
    invalid(value => { value.experiments[0].artifactPaths = [artifact]; }, /artifactPaths/);
  }
});

check('states cannot imply results before execution', () => {
  invalid(value => { value.experiments[0].outcome = 'pass'; }, /unexecuted/);
  invalid(value => { value.experiments[0].result = 'Reported without execution.'; }, /unexecuted/);
  invalid(value => { value.experiments[0].state = 'validated'; }, /execution state/);
  invalid(value => { value.experiments[0].state = 'completed'; }, /outcome|observation|observedAt/);
});

check('completed results need an explicit outcome, date and concrete observation', () => {
  assert.deepEqual(validateRegistry(completed(fixture(), 'pass')), []);
  invalid(value => { completed(value); value.experiments[0].result = 'pass'; }, /concrete observation/);
  invalid(value => { completed(value); value.experiments[0].observedAt = '2026-09-28'; }, /observedAt/);
  invalid(value => { completed(value); value.experiments[0].outcome = 'probably'; }, /outcome/);
});

check('failed and inconclusive runs stay actionable; completed passes leave the open queue', () => {
  for (const outcome of ['fail', 'inconclusive']) {
    const queued = buildQueue(completed(fixture(), outcome)).experiments;
    assert.equal(queued.length, 1);
    assert.equal(queued[0].outcome, outcome);
    assert.equal(queued[0].nextAction, 'design_followup_from_recorded_outcome');
  }
  assert.equal(buildQueue(completed(fixture(), 'pass')).experiments.length, 0);
});

check('historical runtime failure has no replay command', () => {
  invalid(value => { completed(value); value.experiments[0].evidenceScope = 'historical_runtime'; }, /replay command/);
  const actual213 = registry.experiments.find(experiment => experiment.id === 'actual213-corrected-hindi');
  assert.equal(actual213.state, 'completed'); assert.equal(actual213.outcome, 'fail');
  assert.equal(actual213.evidenceScope, 'historical_runtime'); assert.equal(actual213.runCommand, null);
  assert.match(actual213.result, /entirely English/);
  assert.ok(buildQueue(registry).experiments.some(experiment => experiment.id === actual213.id));
});

check('review boundaries are explicit and repeatable', () => {
  const value = fixture();
  assert.equal(buildQueue(value, { asOf: '2026-10-10' }).sourceReviews[0].stale, false);
  assert.equal(buildQueue(value, { asOf: '2026-10-11' }).sourceReviews[0].stale, true);
  assert.equal(buildQueue(value, { asOf: '2026-10-12' }).sourceReviews[0].overdueDays, 1);
  assert.equal(buildQueue(value, { asOf: '2026-10-12' }).experiments[0].nextAction, 'refresh_sources');
  value.sources[0].kind = 'paper';
  assert.equal(buildQueue(value, { asOf: '2026-12-25' }).sourceReviews[0].stale, false);
  assert.equal(buildQueue(value, { asOf: '2026-12-26' }).sourceReviews[0].stale, true);
  assert.deepEqual(buildQueue(value), buildQueue(copy(value)));
  assert.throws(() => buildQueue(value, { asOf: '2026-09-26' }));
});

check('malformed shapes produce validation errors instead of plausible empty queues', () => {
  for (const value of [null, [], {}, { ...fixture(), sources: null }, { ...fixture(), experiments: [null] }]) assert.ok(validateRegistry(value).length);
  invalid(value => { value.extra = true; }, /fields/);
  invalid(value => { value.sources[0].kind = 'constructor'; }, /unknown source kind/);
  invalid(value => { value.experiments[0].artifactPaths = []; }, /artifactPaths/);
});

check('registry commands remain inert metadata', () => {
  const value = fixture();
  value.experiments[0].runCommand = 'THIS COMMAND MUST NEVER EXECUTE';
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = () => { calls++; throw new Error('unexpected network call'); };
  try {
    assert.deepEqual(validateRegistry(value), []);
    assert.equal(buildQueue(value).experiments[0].runCommand, value.experiments[0].runCommand);
    assert.equal(calls, 0);
  } finally { globalThis.fetch = originalFetch; }
});

check('CLI reports scoped evidence and rejects unsupported arguments', () => {
  const tool = path.join(ROOT, 'scripts/research-cycle.mjs');
  const call = args => spawnSync(process.execPath, [tool, ...args], { cwd: ROOT, encoding: 'utf8', timeout: 10_000 });
  const checked = call(['check']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Results were not re-executed/);
  const queued = call(['queue', '--as-of', '2026-10-12', '--json']);
  assert.equal(queued.status, 0, queued.stderr);
  const output = JSON.parse(queued.stdout);
  assert.equal(output.asOf, '2026-10-12');
  assert.match(output.notice, /No sources fetched/);
  assert.equal(output.mode, 'offline_snapshot');
  for (const args of [['execute'], ['check', '--json'], ['queue', '--json', '--json'], ['queue', '--as-of'], ['queue', '--as-of', '2026-09-26']]) assert.notEqual(call(args).status, 0);
});

console.log(`${checks} research-cycle groups passed; offline metadata and queue behavior only, no scientific reproduction or provider calls.`);
