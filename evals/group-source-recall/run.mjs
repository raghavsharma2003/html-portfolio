import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { selectSourceTurns } from '../../api/_group-recall/selection.js';
import { CASES, CORPUS_METHOD, CORPUS_VERSION, FAMILIES } from './cases.mjs';

const HASHES = Object.freeze({
  sourceLf: 'db2bc977ff56a593ac5041262057cff8169f15448a6da6e7570689c5c68a0193',
  cases: '0abf425e092810d1ddd22addeb9ac28e7c882bf904e36043d929bb28e93872e1',
  method: '768f38485c01f79ae74bdfd73b7e4c6f1f6c01eaafc00263c7f9b6a4a64c2838',
});
const hash = value => createHash('sha256').update(value).digest('hex');
const utf8 = value => Buffer.byteLength(value, 'utf8');
const numericSort = (a, b) => BigInt(a.order) < BigInt(b.order) ? -1 : BigInt(a.order) > BigInt(b.order) ? 1 : 0;
const clone = value => structuredClone(value);
const row = (n, text, rest = {}) => ({
  sourceId: `check:${n}`, order: String(n), episodeId: `episode-${n}`, speakerId: 'speaker-a',
  speakerLabel: null, recordedAt: null, text, ...rest,
});
const inputFor = (candidates, query = candidates.at(-1).text) => ({
  query, currentSourceId: candidates.at(-1).sourceId,
  currentSpeakerId: candidates.at(-1).speakerId, candidates, mode: 'lexical_recency',
});

// The schema acquired a required current-roster label after corpus freeze.
// Mechanical null insertion is identical in both arms. Frozen texts, query,
// source IDs, ground truth and cases.mjs bytes remain untouched.
const adaptFrozenInput = fixture => ({
  ...fixture.input,
  candidates: fixture.input.candidates.map(record => ({ ...record, speakerLabel: null })),
});

function validateResult(input, result, fixture = null) {
  assert.equal(result.serializedTurns, JSON.stringify(result.turns));
  assert.equal(result.metadata.payloadUtf8Bytes, utf8(result.serializedTurns));
  assert.ok(result.metadata.payloadUtf8Bytes <= 32768);
  assert.equal(result.turns.length, 1);
  assert.equal(result.turns[0].role, 'user');
  assert.deepEqual(JSON.parse(result.turns[0].content), result.packet);
  assert.equal(result.packet.interpretation, 'historical_observations');
  assert.equal(result.packet.currentStateEstablished, false);
  assert.equal(result.packet.coverage, 'host_supplied_candidate_pool');
  assert.equal(result.packet.replyAncestryAvailable, false);
  const records = [...result.packet.history, result.packet.current];
  const admitted = new Map(input.candidates.map(record => [record.sourceId, record]));
  const ordered = [...input.candidates].sort(numericSort);
  const recent = ordered.slice(-20).map(record => record.sourceId);
  const ids = records.map(record => record.sourceId);
  assert.deepEqual(ids, result.selectedSourceIds);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.length <= 32);
  assert.deepEqual(records, [...records].sort(numericSort));
  assert.deepEqual(result.rawTexts, records.map(record => record.text));
  assert.equal(result.packet.current.sourceId, input.currentSourceId);
  assert.equal(result.packet.current.speakerId, input.currentSpeakerId);
  assert.equal(result.packet.current.text, input.query);
  assert.equal(records.filter(record => record.sourceId === input.currentSourceId).length, 1);
  for (const id of recent) assert.ok(ids.includes(id), `missing mandatory source ${id}`);
  assert.equal(result.metadata.candidateCount, input.candidates.length);
  assert.equal(result.metadata.selectedCount, ids.length);
  assert.equal(result.metadata.mandatoryCount, recent.length);
  assert.equal(result.metadata.optionalCount, ids.length - recent.length);
  assert.equal(result.metadata.mode, input.mode);
  if (input.mode === 'recency') {
    assert.deepEqual(ids, recent);
    assert.equal(result.metadata.queryTermCount, 0);
  }
  for (const record of records) {
    const original = admitted.get(record.sourceId);
    assert.ok(original, 'output contained a nonadmitted source');
    for (const key of ['sourceId', 'order', 'episodeId', 'speakerId', 'speakerLabel', 'recordedAt', 'text']) {
      assert.equal(record[key], original[key], `changed recorded ${key}`);
    }
    assert.equal(record.speakerLabelKind, original.speakerLabel === null ? null : 'current_roster_label');
    for (const key of ['sourceRevision', 'occurredAt', 'replyToSourceId', 'subjectIds']) assert.equal(record[key], null);
    assert.deepEqual(record.span, { unit: 'utf16', start: 0, end: original.text.length });
    assert.equal(record.text.slice(record.span.start, record.span.end), original.text);
  }
  if (fixture) {
    for (const sidecar of [...fixture.groundTruth.notAdmitted, ...fixture.groundTruth.outsideCoverage]) {
      assert.ok(!admitted.has(sidecar.record.sourceId));
      assert.ok(!ids.includes(sidecar.record.sourceId));
    }
    assert.deepEqual(recent, fixture.groundTruth.recentSourceIds);
  }
  return records.length;
}

function measure(fixture, mode) {
  const input = { ...adaptFrozenInput(fixture), mode };
  const untouched = JSON.stringify(input);
  let result;
  try {
    result = selectSourceTurns(input);
  } catch (error) {
    assert.equal(error.code, 'source_selection_unavailable');
    assert.ok(['required_context_over_budget', 'candidate_context_over_budget'].includes(error.reason), `unexpected fixture refusal: ${error.reason}`);
    return { mode, refusal: error.reason, selectedSourceIds: [], olderFound: 0, olderAvailable: fixture.groundTruth.relevantOlderSourceIds.length,
      targetsFound: 0, targetsAvailable: fixture.groundTruth.targetSourceIds.length, correctionsFound: 0,
      correctionsAvailable: fixture.groundTruth.correctionSourceIds.length, recentFound: 0, recentAvailable: fixture.groundTruth.recentSourceIds.length,
      distractorsSelected: 0, recordIntegrityChecked: 0, bytes: null };
  }
  const recordIntegrityChecked = validateResult(input, result, fixture);
  assert.equal(JSON.stringify(input), untouched, 'input was mutated');
  const count = ids => ids.filter(id => result.selectedSourceIds.includes(id)).length;
  return {
    mode, refusal: null, selectedSourceIds: result.selectedSourceIds,
    olderFound: count(fixture.groundTruth.relevantOlderSourceIds), olderAvailable: fixture.groundTruth.relevantOlderSourceIds.length,
    targetsFound: count(fixture.groundTruth.targetSourceIds), targetsAvailable: fixture.groundTruth.targetSourceIds.length,
    correctionsFound: count(fixture.groundTruth.correctionSourceIds), correctionsAvailable: fixture.groundTruth.correctionSourceIds.length,
    recentFound: count(fixture.groundTruth.recentSourceIds), recentAvailable: fixture.groundTruth.recentSourceIds.length,
    distractorsSelected: count(fixture.groundTruth.lexicalDistractorSourceIds), recordIntegrityChecked,
    bytes: result.metadata.payloadUtf8Bytes,
  };
}

function summarize(cases, mode) {
  const rows = cases.map(c => c[mode]);
  const sum = key => rows.reduce((total, result) => total + result[key], 0);
  const bytes = rows.flatMap(row => row.bytes === null ? [] : [row.bytes]);
  return {
    cases: rows.length, refusals: rows.filter(row => row.refusal !== null).length,
    olderFound: sum('olderFound'), olderAvailable: sum('olderAvailable'),
    allOlderCoveredCases: rows.filter(row => row.olderFound === row.olderAvailable && !row.refusal).length,
    targetsFound: sum('targetsFound'), targetsAvailable: sum('targetsAvailable'),
    correctionsFound: sum('correctionsFound'), correctionsAvailable: sum('correctionsAvailable'),
    recentFound: sum('recentFound'), recentAvailable: sum('recentAvailable'),
    distractorsSelected: sum('distractorsSelected'), recordIntegrityChecked: sum('recordIntegrityChecked'),
    minBytes: bytes.length ? Math.min(...bytes) : null, maxBytes: bytes.length ? Math.max(...bytes) : null,
  };
}

function runContractChecks() {
  const passed = [];
  const check = (name, fn) => { fn(); passed.push(name); };
  const reject = (input, reason = 'invalid_input') => assert.throws(() => selectSourceTurns(input), error =>
    error.code === 'source_selection_unavailable' && error.reason === reason &&
    !JSON.stringify(error).includes('PRIVATE_SENTINEL'));
  const tiny = () => inputFor([row(1, 'alpha source'), row(2, 'alpha question')]);
  check('frozen 48-case matrix and semantic/source hashes', () => {
    assert.equal(CASES.length, 48);
    assert.equal(hash(JSON.stringify(CASES)), HASHES.cases);
    assert.equal(hash(JSON.stringify(CORPUS_METHOD)), HASHES.method);
    assert.equal(hash(readFileSync(new URL('./cases.mjs', import.meta.url), 'utf8').replace(/\r\n/g, '\n')), HASHES.sourceLf);
    for (const family of FAMILIES) for (const language of ['en', 'hi', 'cs']) {
      assert.deepEqual(CASES.filter(c => c.family === family && c.language === language).map(c => c.variant), [1, 2]);
    }
  });
  check('CRLF emoji combining marks and current labels preserve original spans', () => {
    const input = inputFor([row(1, 'A\r\n👩🏽‍🎨 cafe\u0301 हिंदी', { speakerLabel: 'Current label' }), row(2, 'हिंदी?')]);
    validateResult(input, selectSourceTurns(input));
  });
  check('normalization affects matching, never original fullwidth text', () => {
    const input = inputFor(Array.from({ length: 21 }, (_, i) => row(i + 1, i === 0 ? 'ＡＬＰＨＡ' : i === 20 ? 'alpha' : 'zebra')));
    const result = selectSourceTurns(input);
    assert.ok(result.selectedSourceIds.includes('check:1'));
    assert.equal(result.packet.history[0].text, 'ＡＬＰＨＡ');
    validateResult(input, result);
  });
  check('cross-script no-match is honestly absent', () => {
    const input = inputFor(Array.from({ length: 21 }, (_, i) => row(i + 1, i === 0 ? 'दीवार नीली' : i === 20 ? 'deewar neeli' : 'parcel')));
    const result = selectSourceTurns(input);
    assert.ok(!result.selectedSourceIds.includes('check:1'));
    assert.equal(result.packet.currentStateEstablished, false);
    validateResult(input, result);
  });
  check('empty exact query preserves mandatory context without invented older matches', () => {
    const input = inputFor(Array.from({ length: 21 }, (_, i) => row(i + 1, i === 20 ? '' : 'older text')));
    const result = selectSourceTurns(input);
    assert.equal(result.metadata.queryTermCount, 0);
    assert.equal(result.metadata.optionalCount, 0);
    validateResult(input, result);
  });
  check('query repetition does not reward one older keyword-stuffed record', () => {
    const candidates = Array.from({ length: 34 }, (_, i) => row(i + 1, i < 14 ? (i === 0 ? 'alpha '.repeat(30).trim() : 'alpha') : i === 33 ? 'alpha alpha alpha' : 'parcel'));
    const input = inputFor(candidates);
    const result = selectSourceTurns(input);
    assert.deepEqual(result.selectedSourceIds.slice(0, 12), Array.from({ length: 12 }, (_, i) => `check:${i + 3}`));
    validateResult(input, result);
  });
  check('duplicate source identity refuses', () => {
    const input = tiny(); input.candidates[0].sourceId = input.currentSourceId; reject(input);
  });
  check('sparse candidate arrays refuse', () => {
    const input = tiny(); delete input.candidates[0]; reject(input);
  });
  check('accessor metadata refuses without invoking getter', () => {
    const input = tiny(); let calls = 0;
    Object.defineProperty(input.candidates[0], 'speakerLabel', { enumerable: true, get() { calls++; return 'PRIVATE_SENTINEL'; } });
    reject(input); assert.equal(calls, 0);
  });
  check('missing current source refuses', () => {
    const input = tiny(); input.currentSourceId = 'check:absent'; reject(input, 'current_source_mismatch');
  });
  check('current speaker mismatch refuses', () => {
    const input = tiny(); input.currentSpeakerId = 'wrong-speaker'; reject(input, 'current_source_mismatch');
  });
  check('current text mismatch refuses', () => {
    const input = tiny(); input.query = 'other question'; reject(input, 'current_source_mismatch');
  });
  check('assistant role extra field is rejected, not trusted as admission metadata', () => {
    const input = tiny(); input.candidates[0].role = 'assistant'; reject(input);
  });
  check('oversized current roster label refuses', () => {
    const input = tiny(); input.candidates[0].speakerLabel = 'x'.repeat(161); reject(input);
  });
  check('160 candidate cap rejects 161', () => {
    reject(inputFor(Array.from({ length: 161 }, (_, i) => row(i + 1, 'bounded'))));
  });
  check('lexical mode refuses 33 distinct query terms without silently cutting terms', () => {
    reject(inputFor([row(1, Array.from({ length: 33 }, (_, i) => `term${i}`).join(' '))]));
  });
  check('recency accepts an ordinary long question without applying an unused scoring cap', () => {
    const input = { ...inputFor([row(1, Array.from({ length: 33 }, (_, i) => `term${i}`).join(' '))]), mode: 'recency' };
    const result = selectSourceTurns(input);
    assert.equal(result.metadata.queryTermCount, 0);
    validateResult(input, result);
  });
  check('mandatory full-wrapper overflow refuses instead of dropping recent context', () => {
    const input = inputFor(Array.from({ length: 20 }, (_, i) => row(i + 1, i === 19 ? 'alpha' : 'क'.repeat(1500))));
    reject(input, 'required_context_over_budget');
  });
  check('JSON-escaping overhead counts toward mandatory context', () => {
    const input = inputFor(Array.from({ length: 20 }, (_, i) => row(i + 1, i === 19 ? 'alpha' : '"'.repeat(1500))));
    reject(input, 'required_context_over_budget');
  });
  check('exact 32768-byte final wrapper accepts and one extra byte refuses', () => {
    const candidateFor = length => inputFor(Array.from({ length: 20 }, (_, i) =>
      row(i + 1, i === 0 ? 'x'.repeat(length) : i === 19 ? 'alpha' : 'x'.repeat(1210))));
    let low = 0; let high = 4000;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      try { selectSourceTurns(candidateFor(middle)); low = middle; }
      catch (error) { assert.equal(error.reason, 'required_context_over_budget'); high = middle - 1; }
    }
    const input = candidateFor(low); const result = selectSourceTurns(input);
    assert.equal(result.metadata.payloadUtf8Bytes, 32768);
    validateResult(input, result);
    reject(candidateFor(low + 1), 'required_context_over_budget');
  });
  check('integrity oracle rejects forged speaker even with coherent serialization', () => {
    const input = tiny(); const forged = clone(selectSourceTurns(input));
    forged.packet.history[0].speakerId = 'different-person';
    forged.turns[0].content = JSON.stringify(forged.packet); forged.serializedTurns = JSON.stringify(forged.turns);
    forged.metadata.payloadUtf8Bytes = utf8(forged.serializedTurns);
    assert.throws(() => validateResult(input, forged), /changed recorded speakerId/);
  });
  check('integrity oracle rejects changed source text/span with coherent raw texts', () => {
    const input = tiny(); const forged = clone(selectSourceTurns(input));
    forged.packet.history[0].text = 'forged alpha'; forged.packet.history[0].span.end = 12; forged.rawTexts[0] = 'forged alpha';
    forged.turns[0].content = JSON.stringify(forged.packet); forged.serializedTurns = JSON.stringify(forged.turns);
    forged.metadata.payloadUtf8Bytes = utf8(forged.serializedTurns);
    assert.throws(() => validateResult(input, forged), /changed recorded text/);
  });
  check('integrity oracle rejects an invented current-state guarantee', () => {
    const input = tiny(); const forged = clone(selectSourceTurns(input)); forged.packet.currentStateEstablished = true;
    forged.turns[0].content = JSON.stringify(forged.packet); forged.serializedTurns = JSON.stringify(forged.turns);
    forged.metadata.payloadUtf8Bytes = utf8(forged.serializedTurns);
    assert.throws(() => validateResult(input, forged));
  });
  return passed;
}

export function run() {
  const contractChecks = runContractChecks();
  const cases = CASES.map(fixture => ({
    id: fixture.id, family: fixture.family, language: fixture.language, variant: fixture.variant,
    expectedOlderSourceIds: fixture.groundTruth.relevantOlderSourceIds,
    expectedCorrectionSourceIds: fixture.groundTruth.correctionSourceIds,
    notAdmittedSourceIds: fixture.groundTruth.notAdmitted.map(sidecar => sidecar.record.sourceId),
    outsideCoverageCorrectionIds: fixture.groundTruth.outsideCoverage.map(sidecar => sidecar.record.sourceId),
    recency: measure(fixture, 'recency'), lexical_recency: measure(fixture, 'lexical_recency'),
  }));
  const summarizeBoth = subset => Object.fromEntries(['recency', 'lexical_recency'].map(mode => [mode, summarize(subset, mode)]));
  return {
    corpusVersion: CORPUS_VERSION, hashes: HASHES,
    selectorSourceSha256: hash(readFileSync(new URL('../../api/_group-recall/selection.js', import.meta.url))),
    mechanicalSchemaAdapter: 'Add speakerLabel:null to every frozen candidate, identical in both arms; corpus unchanged.',
    contractChecks: { passed: contractChecks.length, names: contractChecks },
    summary: summarizeBoth(cases),
    byFamily: Object.fromEntries(FAMILIES.map(family => [family, summarizeBoth(cases.filter(c => c.family === family))])),
    byLanguage: Object.fromEntries(['en', 'hi', 'cs'].map(language => [language, summarizeBoth(cases.filter(c => c.language === language))])),
    byVariant: Object.fromEntries([1, 2].map(variant => [variant, summarizeBoth(cases.filter(c => c.variant === variant))])),
    nonadmittedFixtureCount: CASES.reduce((sum, c) => sum + c.groundTruth.notAdmitted.length, 0),
    unavailableCorrectionFixtureCount: CASES.reduce((sum, c) => sum + c.groundTruth.outsideCoverage.length, 0),
    cases,
    evidenceScope: 'Offline invented selection only; no SQL, provider, model answer, transport, human or privacy-enforcement claim.',
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  assert.ok(args.length === 0 || (args.length === 1 && args[0] === '--json'), 'unknown argument');
  const report = run();
  if (args[0] === '--json') console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`group-source-recall: 48 frozen invented cases, ${report.contractChecks.passed} separate contract groups passed`);
    for (const mode of ['recency', 'lexical_recency']) {
      const s = report.summary[mode];
      console.log(`${mode}: older sources ${s.olderFound}/${s.olderAvailable}, recent ${s.recentFound}/${s.recentAvailable}, corrections ${s.correctionsFound}/${s.correctionsAvailable}, distractors ${s.distractorsSelected}, refusals ${s.refusals}, maximum serialized turns ${s.maxBytes} UTF-8 bytes`);
    }
    console.log('Scope: source selection and exact record preservation only; this is not answer quality or authorization proof.');
  }
}
