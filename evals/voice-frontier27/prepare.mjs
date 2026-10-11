import { readFile, realpath, stat, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { corpus, validateCorpus } from './corpus.mjs';

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const inside = (root, file) => { const rel = path.relative(root, file); return rel && !rel.startsWith(`..${path.sep}`) && rel !== '..' && !path.isAbsolute(rel); };
const idPattern = /^[a-z][a-z0-9-]{1,35}$/;

export function validateConfig(config, requireReady = false) {
  assert(config.schema_version === 1, 'unsupported config schema');
  assert(Array.isArray(config.arms) && config.arms.length >= 2 && config.arms.length <= 4, 'require 2-4 arms');
  assert(config.arms.every(x => typeof x === 'string' && idPattern.test(x)) && new Set(config.arms).size === config.arms.length, 'invalid or duplicate arms');
  assert(Array.isArray(config.repetitions) && config.repetitions.length >= 1 && config.repetitions.length <= 3 && config.repetitions.every(x => Number.isInteger(x) && x >= 1 && x <= 3) && new Set(config.repetitions).size === config.repetitions.length, 'require distinct repetition numbers 1-3');
  assert(Array.isArray(config.speakers) && config.speakers.length === 3, 'require exactly three independent speakers');
  assert(new Set(config.speakers.map(x => x.id)).size === 3, 'duplicate speaker IDs');
  for (const speaker of config.speakers) {
    assert(idPattern.test(speaker.id), 'invalid speaker ID');
    for (const key of ['enrollment_audio', 'heldout_reference_audio']) {
      const value = speaker[key];
      assert(typeof value === 'string' && value.endsWith('.wav') && !path.isAbsolute(value) && !value.split(/[\\/]/).includes('..'), `${speaker.id}: invalid ${key}`);
    }
    assert(speaker.enrollment_audio !== speaker.heldout_reference_audio, `${speaker.id}: enrollment and heldout reference must differ`);
    for (const key of ['consent_current', 'heldout_text_excluded_from_enrollment']) {
      assert(typeof speaker[key] === 'boolean', `${speaker.id}: missing ${key} declaration`);
      if (requireReady) assert(speaker[key] === true, `${speaker.id}: ${key} is not affirmed in the run config`);
    }
  }
  return { speakers: 3, arms: config.arms.length, repetitions: config.repetitions.length };
}

// Narrow, dependency-free WAV validation. This validates playable PCM structure,
// not identity, speech quality, disclosure, watermark, or the truth of consent.
export function inspectWav(buffer) {
  assert(buffer.length >= 44 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WAVE', 'not a RIFF/WAVE file');
  const end = buffer.readUInt32LE(4) + 8;
  assert(end === buffer.length, 'WAV RIFF length mismatch');
  let format;
  let data;
  let offset = 12;
  for (; offset + 8 <= end;) {
    const kind = buffer.toString('ascii', offset, offset + 4);
    const length = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    assert(start + length <= end, 'truncated WAV chunk');
    if (kind === 'fmt ') {
      assert(!format && length >= 16, 'duplicate or short WAV format');
      format = { encoding: buffer.readUInt16LE(start), channels: buffer.readUInt16LE(start + 2), rate: buffer.readUInt32LE(start + 4), byteRate: buffer.readUInt32LE(start + 8), align: buffer.readUInt16LE(start + 12), bits: buffer.readUInt16LE(start + 14) };
    }
    if (kind === 'data') { assert(!data, 'multiple WAV data chunks unsupported'); data = buffer.subarray(start, start + length); }
    offset = start + length + (length % 2);
    assert(offset <= end, 'missing WAV chunk pad');
  }
  assert(offset === end, 'incomplete WAV chunk header');
  assert(format && data && data.length, 'missing WAV format or audio');
  assert((format.encoding === 1 && [16, 24, 32].includes(format.bits)) || (format.encoding === 3 && format.bits === 32), 'only PCM16/24/32 or float32 WAV supported');
  assert([1, 2].includes(format.channels) && format.rate >= 8000 && format.rate <= 192000, 'unsupported channels or sample rate');
  assert(format.align === format.channels * format.bits / 8 && format.byteRate === format.align * format.rate && data.length % format.align === 0, 'inconsistent WAV frame geometry');
  const duration = data.length / format.byteRate;
  assert(duration >= 0.1 && duration <= 300, 'WAV duration must be 0.1-300 seconds');
  let peak = 0;
  const step = format.bits / 8;
  for (let at = 0; at < data.length; at += step) {
    const sample = format.encoding === 3 ? data.readFloatLE(at) : data.readIntLE(at, step) / (2 ** (format.bits - 1));
    assert(Number.isFinite(sample), 'WAV contains non-finite samples');
    peak = Math.max(peak, Math.abs(sample));
  }
  assert(peak > 0, 'WAV contains only digital silence');
  return { duration_seconds: duration, sample_rate: format.rate, channels: format.channels, bits_per_sample: format.bits, peak };
}

export function anonymizeWav(buffer) {
  inspectWav(buffer);
  const chunks = [];
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const kind = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const next = offset + 8 + size + (size % 2);
    if (kind === 'fmt ' || kind === 'data') chunks.push(buffer.subarray(offset, next));
    offset = next;
  }
  const header = Buffer.alloc(12);
  header.write('RIFF'); header.writeUInt32LE(4 + chunks.reduce((sum, x) => sum + x.length, 0), 4); header.write('WAVE', 8);
  return Buffer.concat([header, ...chunks]);
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => { state += 0x6D2B79F5; let t = Math.imul(state ^ state >>> 15, 1 | state); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
export function shuffled(values, random) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
  return copy;
}

function csv(columns, rows) {
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns, ...rows.map(row => columns.map(column => row[column] ?? ''))].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
}

async function readAudio(root, relative) {
  const full = await realpath(path.resolve(root, relative));
  assert(inside(root, full), `audio escapes input root: ${relative}`);
  const info = await stat(full);
  assert(info.isFile() && info.size <= 50 * 1024 * 1024, `audio must be a regular WAV at most 50 MiB: ${relative}`);
  const bytes = await readFile(full);
  let wave;
  try { wave = inspectWav(bytes); } catch (error) { throw new Error(`${relative}: ${error.message}`); }
  return { full, source_relative: relative.replaceAll('\\', '/'), sha256: sha256(bytes), ...wave };
}

export async function prepare({ input, config, out, seed, split = 'heldout' }) {
  validateCorpus();
  validateConfig(config, true);
  assert(Number.isSafeInteger(seed) && seed >= 0 && seed <= 0xffffffff, 'seed must be a uint32 integer');
  assert(['dev', 'heldout', 'all'].includes(split), 'split must be dev, heldout or all');
  const root = await realpath(input);
  const output = path.resolve(out);
  assert(output !== root && !inside(root, output) && !inside(output, root), 'output and input roots must be separate');
  try { await stat(output); throw new Error('output already exists; choose a fresh directory'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const prompts = corpus.filter(x => split === 'all' || x.split === split);
  const references = [];
  for (const speaker of config.speakers) {
    const enrollment = await readAudio(root, speaker.enrollment_audio);
    const heldout = await readAudio(root, speaker.heldout_reference_audio);
    references.push({ speaker: speaker.id, enrollment, heldout });
  }
  assert(new Set(references.flatMap(x => [x.enrollment.sha256, x.heldout.sha256])).size === 6, 'six reference files must have distinct bytes across speakers and enrollment/heldout');
  const referenceHashes = new Set(references.flatMap(x => [x.enrollment.sha256, x.heldout.sha256]));
  const recordings = [];
  for (const speaker of config.speakers) for (const prompt of prompts) for (const repetition of config.repetitions) for (const arm of config.arms) {
    const relative = `${speaker.id}/${arm}/${prompt.id}_r${repetition}.wav`;
    const audio = await readAudio(root, relative);
    assert(!referenceHashes.has(audio.sha256), `candidate is a copied enrollment/heldout reference: ${relative}`);
    recordings.push({ speaker: speaker.id, prompt_id: prompt.id, repetition, arm, ...audio });
  }
  // All input files pass before output creation. No generated/silence fixtures or
  // quality scores are substituted for missing audio.
  const random = randomGenerator(seed);
  const speakerAliases = new Map(shuffled(config.speakers.map(x => x.id), random).map((id, index) => [id, `S${index + 1}`]));
  const groups = shuffled(config.speakers.flatMap(speaker => prompts.flatMap(prompt => config.repetitions.map(repetition => ({ speaker: speaker.id, prompt, repetition })))), random);
  const blind = { schema_version: 1, split, corpus_sha256: sha256(JSON.stringify(corpus)), note: 'Human listening only. No automated quality score. Share only this blind directory.', speakers: [], comparisons: [] };
  const key = { schema_version: 1, seed, config, corpus_sha256: blind.corpus_sha256, source_root: root, split, references, samples: [] };
  const scores = [];
  const preferences = [];
  let serial = 0;
  for (let index = 0; index < groups.length; index++) {
    const group = groups[index];
    const comparison_id = `C${String(index + 1).padStart(3, '0')}`;
    const samples = shuffled(recordings.filter(x => x.speaker === group.speaker && x.prompt_id === group.prompt.id && x.repetition === group.repetition), random);
    const candidates = samples.map(sample => {
      const sample_id = `V${String(++serial).padStart(4, '0')}`;
      const audio = `audio/${sample_id}.wav`;
      key.samples.push({ sample_id, comparison_id, blind_audio: audio, ...sample });
      scores.push({ comparison_id, sample_id, speaker_alias: speakerAliases.get(group.speaker), prompt_id: group.prompt.id });
      return { sample_id, audio };
    });
    blind.comparisons.push({ comparison_id, speaker_alias: speakerAliases.get(group.speaker), prompt: group.prompt, candidates });
    preferences.push({ comparison_id, available_sample_ids: candidates.map(x => x.sample_id).join('|') });
  }
  await mkdir(path.join(output, 'blind', 'audio'), { recursive: true });
  await mkdir(path.join(output, 'private'), { recursive: true });
  for (const ref of references) {
    const speaker_alias = speakerAliases.get(ref.speaker);
    const audio = `audio/reference-${speaker_alias}.wav`;
    blind.speakers.push({ speaker_alias, reference_audio: audio });
    const source = await readFile(ref.heldout.full);
    assert(sha256(source) === ref.heldout.sha256, 'heldout reference changed during preparation');
    await writeFile(path.join(output, 'blind', audio), anonymizeWav(source));
  }
  for (const sample of key.samples) {
    const source = await readFile(sample.full);
    assert(sha256(source) === sample.sha256, 'input audio changed during preparation');
    const blinded = anonymizeWav(source);
    sample.blind_audio_sha256 = sha256(blinded);
    await writeFile(path.join(output, 'blind', sample.blind_audio), blinded);
  }
  await writeFile(path.join(output, 'blind', 'manifest.json'), JSON.stringify(blind, null, 2) + '\n');
  await writeFile(path.join(output, 'private', 'unblinding-key.json'), JSON.stringify(key, null, 2) + '\n');
  await writeFile(path.join(output, 'blind', 'listener-scores.csv'), csv(['rater_id', 'comparison_id', 'sample_id', 'speaker_alias', 'prompt_id', 'familiar_with_speaker', 'naturalness_1to5', 'speaker_likeness_1to5_or_NA', 'intelligibility_1to5', 'prosody_fit_1to5', 'code_switch_quality_1to5_or_NA', 'human_transcript', 'wrong_or_missing_numbers_names', 'notes'], scores));
  await writeFile(path.join(output, 'blind', 'preferences.csv'), csv(['rater_id', 'comparison_id', 'available_sample_ids', 'preferred_sample_id_or_TIE_or_NONE', 'preference_reason'], preferences));
  const metrics = key.samples.map(x => ({ sample_id: x.sample_id, speaker_id: x.speaker, arm_id: x.arm, prompt_id: x.prompt_id, repetition: x.repetition, audio_sha256: x.sha256, output_audio_seconds: x.duration_seconds, measurement_source: 'WAV structure only; all latency and cost fields unmeasured' }));
  await writeFile(path.join(output, 'private', 'latency-cost.csv'), csv(['sample_id', 'speaker_id', 'arm_id', 'prompt_id', 'repetition', 'audio_sha256', 'run_id', 'provider_model_snapshot', 'image_digest', 'reference_sha256', 'generation_seed', 'request_started_utc', 'cold_or_warm', 'cache_status', 'concurrency', 'gpu_sku', 'region', 'ready_text_to_first_byte_ms', 'ready_text_to_first_playable_audio_ms', 'user_end_to_audible_reply_ms', 'interruption_to_silence_ms', 'generation_ms', 'output_audio_seconds', 'allocated_gpu_seconds_including_idle', 'provider_billable_quantity', 'provider_billable_unit', 'cached_billable_quantity', 'cached_billable_unit', 'provider_reported_cost', 'allocated_compute_cost', 'cpu_storage_egress_cost', 'license_cost_allocated', 'currency', 'gross_cost', 'credits_applied', 'cash_payable', 'status', 'retry_count', 'accepted_by_human', 'measurement_source'], metrics));
  const uniqueHashes = new Set(recordings.map(x => x.sha256)).size;
  const summary = { prepared: recordings.length, comparisons: groups.length, speakers: 3, prompts: prompts.length, split, seed, duplicate_audio_hash_count: recordings.length - uniqueHashes, quality_scores_computed: 0, output };
  await writeFile(path.join(output, 'private', 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const command = args.shift();
  const options = {};
  while (args.length) {
    const flag = args.shift();
    assert(['--config', '--input', '--out', '--seed', '--split'].includes(flag) && args.length, `unknown or missing option: ${flag}`);
    assert(!(flag.slice(2) in options), `duplicate option: ${flag}`);
    options[flag.slice(2)] = args.shift();
  }
  if (command === 'validate') {
    const result = validateCorpus();
    if (options.config) result.config = validateConfig(JSON.parse(await readFile(options.config, 'utf8')));
    console.log(JSON.stringify({ ...result, audio_checked: 0, quality_scores_computed: 0 }, null, 2));
    return;
  }
  assert(command === 'prepare', 'usage: node prepare.mjs validate [--config path] | prepare --input audio-root --config run.json --out fresh-output --seed 27 [--split heldout|dev|all]');
  assert(options.input && options.out && options.config && /^\d+$/.test(options.seed ?? ''), 'prepare requires input, config, out and numeric seed');
  const config = JSON.parse(await readFile(options.config, 'utf8'));
  console.log(JSON.stringify(await prepare({ ...options, config, seed: Number(options.seed) }), null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`voice-frontier27: ${error.message}`); process.exitCode = 1; });
}
