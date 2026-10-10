import assert from 'node:assert/strict';
import { readFile, mkdtemp, stat, rmdir, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { corpus, validateCorpus } from './corpus.mjs';
import { validateConfig, inspectWav, anonymizeWav, shuffled, prepare } from './prepare.mjs';

let passed = 0;
async function check(name, test) { await test(); passed++; console.log(`PASS ${name}`); }
const clone = value => JSON.parse(JSON.stringify(value));
const config = JSON.parse(await readFile(new URL('./config.example.json', import.meta.url), 'utf8'));

// Synthetic bytes test the parser only. Never emitted as benchmark speech,
// scored for quality, sent to a model, or used as speaker reference evidence.
function fixture({ silence = false, metadata = false } = {}) {
  const data = Buffer.alloc(3200);
  if (!silence) for (let i = 0; i < data.length; i += 2) data.writeInt16LE(i % 4 ? 250 : -250, i);
  const fmt = Buffer.alloc(24);
  fmt.write('fmt '); fmt.writeUInt32LE(16, 4); fmt.writeUInt16LE(1, 8); fmt.writeUInt16LE(1, 10);
  fmt.writeUInt32LE(8000, 12); fmt.writeUInt32LE(16000, 16); fmt.writeUInt16LE(2, 20); fmt.writeUInt16LE(16, 22);
  const audioHeader = Buffer.alloc(8); audioHeader.write('data'); audioHeader.writeUInt32LE(data.length, 4);
  const chunks = [fmt, audioHeader, data];
  if (metadata) { const tag = Buffer.from('PRIVATE-VENDOR'); const header = Buffer.alloc(8); header.write('LIST'); header.writeUInt32LE(tag.length, 4); chunks.push(header, tag); }
  const header = Buffer.alloc(12); header.write('RIFF'); header.writeUInt32LE(4 + chunks.reduce((n, chunk) => n + chunk.length, 0), 4); header.write('WAVE', 8);
  return Buffer.concat([header, ...chunks]);
}

await check('36 prompts and 9/27 development/heldout split', () => assert.deepEqual(validateCorpus(), { prompts: 36, development: 9, heldout: 27, language_counts: { English: 12, Hindi: 12, Hinglish: 12 } }));
await check('Hinglish has six Latin and six mixed-script items', () => {
  for (const script of ['Latin', 'Devanagari+Latin']) assert.equal(corpus.filter(x => x.language === 'Hinglish' && x.script === script).length, 6);
});
await check('duplicate corpus ID refused', () => { const bad = clone(corpus); bad[1].id = bad[0].id; assert.throws(() => validateCorpus(bad), /duplicate/); });
await check('heldout split erosion refused', () => { const bad = clone(corpus); bad[3].split = 'dev'; assert.throws(() => validateCorpus(bad), /3 dev/); });
await check('Hindi Latin-text mutation refused', () => { const bad = clone(corpus); bad[12].text += ' wrong'; assert.throws(() => validateCorpus(bad), /script mismatch/); });
await check('invalid length target refused', () => { const bad = clone(corpus); bad[0].target_duration_seconds = [9, 2]; assert.throws(() => validateCorpus(bad), /duration target/); });
await check('config template validates without claiming readiness', () => assert.deepEqual(validateConfig(config), { speakers: 3, arms: 3, repetitions: 2 }));
await check('unaffirmed run declarations refused', () => assert.throws(() => validateConfig(config, true), /not affirmed/));
await check('duplicate speaker refused', () => { const bad = clone(config); bad.speakers[1].id = bad.speakers[0].id; assert.throws(() => validateConfig(bad), /duplicate speaker/); });
await check('duplicate arm refused', () => { const bad = clone(config); bad.arms[1] = bad.arms[0]; assert.throws(() => validateConfig(bad), /duplicate arms/); });
await check('duplicate repetition refused', () => { const bad = clone(config); bad.repetitions = [1, 1]; assert.throws(() => validateConfig(bad), /repetition/); });
await check('reference traversal refused', () => { const bad = clone(config); bad.speakers[0].enrollment_audio = '../outside.wav'; assert.throws(() => validateConfig(bad), /invalid enrollment/); });
await check('enrollment copied as heldout path refused', () => { const bad = clone(config); bad.speakers[0].heldout_reference_audio = bad.speakers[0].enrollment_audio; assert.throws(() => validateConfig(bad), /must differ/); });
await check('PCM parser reads duration without quality inference', () => { const result = inspectWav(fixture()); assert.equal(result.duration_seconds, 0.2); assert.equal(result.sample_rate, 8000); assert.equal('speaker_likeness' in result, false); });
await check('non-WAV input refused', () => assert.throws(() => inspectWav(Buffer.from('not audio')), /RIFF/));
await check('truncated WAV refused', () => assert.throws(() => inspectWav(fixture().subarray(0, 100)), /length mismatch/));
await check('digital silence refused', () => assert.throws(() => inspectWav(fixture({ silence: true })), /silence/));
await check('inconsistent WAV sample geometry refused', () => { const bad = fixture(); bad.writeUInt16LE(4, 32); assert.throws(() => inspectWav(bad), /geometry/); });
await check('metadata removed without changing PCM bytes', () => { const clean = anonymizeWav(fixture({ metadata: true })); assert.deepEqual(clean, fixture()); assert.equal(clean.includes(Buffer.from('PRIVATE-VENDOR')), false); });
await check('random order preserves every item', () => { const values = ['a', 'b', 'c', 'd']; const order = shuffled(values, () => 0.17); assert.deepEqual([...order].sort(), values); assert.notDeepEqual(order, values); assert.deepEqual(shuffled(values, () => 0.17), order); });

const temp = await mkdtemp(path.join(os.tmpdir(), 'vyakti-voice-frontier27-empty-'));
const out = `${temp}-output`;
const ready = clone(config);
for (const speaker of ready.speakers) { speaker.consent_current = true; speaker.heldout_text_excluded_from_enrollment = true; }
try {
  await check('empty audio directory refuses before producing output', async () => {
    await assert.rejects(prepare({ input: temp, config: ready, out, seed: 27 }), /ENOENT/);
    await assert.rejects(stat(out), /ENOENT/);
  });
  await check('existing output refuses rather than overwriting', async () => {
    await assert.rejects(prepare({ input: path.dirname(temp), config: ready, out: temp, seed: 27 }), /separate|already exists/);
  });
  await check('invalid shuffle seed refuses', async () => {
    await assert.rejects(prepare({ input: temp, config: ready, out, seed: -1 }), /seed/);
  });
} finally {
  // This directory was created empty by this process; no recursive deletion.
  await rmdir(temp);
}

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'vyakti-voice-frontier27-format-'));
const audioRoot = path.join(sandbox, 'audio');
const outputA = path.join(sandbox, 'blind-a');
const outputB = path.join(sandbox, 'blind-b');
const small = clone(ready);
small.arms = ['baseline', 'candidate-b']; small.repetitions = [1];
let fixtureIndex = 1;
async function putFixture(relative) {
  const file = path.join(audioRoot, relative);
  await mkdir(path.dirname(file), { recursive: true });
  const bytes = fixture({ metadata: true });
  bytes.writeInt16LE(++fixtureIndex, 44); // unique format fixture, not speaker speech
  await writeFile(file, bytes);
}
try {
  for (const speaker of small.speakers) {
    await putFixture(speaker.enrollment_audio); await putFixture(speaker.heldout_reference_audio);
    for (const arm of small.arms) for (const item of corpus.filter(x => x.split === 'dev')) await putFixture(`${speaker.id}/${arm}/${item.id}_r1.wav`);
  }
  let summary;
  await check('format-only matrix prepares 54 clips with zero quality scores', async () => {
    summary = await prepare({ input: audioRoot, config: small, out: outputA, seed: 27, split: 'dev' });
    assert.equal(summary.prepared, 54); assert.equal(summary.comparisons, 27); assert.equal(summary.quality_scores_computed, 0);
  });
  await check('blind manifest and WAV metadata hide source arm identities', async () => {
    const json = await readFile(path.join(outputA, 'blind', 'manifest.json'), 'utf8');
    assert.equal(json.includes('candidate-b'), false); assert.equal(json.includes('baseline'), false); assert.equal(json.includes('speaker01'), false);
    const parsed = JSON.parse(json);
    for (const comparison of parsed.comparisons) for (const candidate of comparison.candidates) {
      const bytes = await readFile(path.join(outputA, 'blind', candidate.audio));
      assert.equal(bytes.includes(Buffer.from('PRIVATE-VENDOR')), false);
    }
  });
  await check('listener ratings stay blank and cost fields say unmeasured', async () => {
    const csv = await readFile(path.join(outputA, 'blind', 'listener-scores.csv'), 'utf8');
    const rows = csv.trim().split('\r\n').slice(1);
    assert.equal(rows.length, 54);
    for (const row of rows) assert.ok(row.endsWith(',"","","","","","","","",""'));
    const costs = await readFile(path.join(outputA, 'private', 'latency-cost.csv'), 'utf8');
    assert.ok(costs.includes('all latency and cost fields unmeasured'));
  });
  await check('same seed and inputs reproduce blind order', async () => {
    await prepare({ input: audioRoot, config: small, out: outputB, seed: 27, split: 'dev' });
    assert.equal(await readFile(path.join(outputA, 'blind', 'manifest.json'), 'utf8'), await readFile(path.join(outputB, 'blind', 'manifest.json'), 'utf8'));
  });
  await check('populated output cannot be overwritten', async () => {
    await assert.rejects(prepare({ input: audioRoot, config: small, out: outputA, seed: 27, split: 'dev' }), /already exists/);
  });
} finally {
  const resolvedTemp = await realpath(os.tmpdir());
  const resolvedSandbox = await realpath(sandbox);
  const relative = path.relative(resolvedTemp, resolvedSandbox);
  assert.ok(relative.startsWith('vyakti-voice-frontier27-format-') && !relative.includes(path.sep) && !path.isAbsolute(relative));
  await rm(resolvedSandbox, { recursive: true });
}
console.log(JSON.stringify({ offline_checks_passed: passed, corpus_items: 36, real_audio_files: 0, model_calls: 0, quality_scores_computed: 0 }));
