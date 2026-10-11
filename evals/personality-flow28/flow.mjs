// Existing person/calibration compiler -> actual owned dialogue orchestration.
// DB responses and generator are explicit fixtures, not SQL/provider acceptance.
import assert from 'node:assert/strict';
import { buildPersonModelDefinition } from '../../api/_person-model.js';
import { CALIBRATION_SCENARIOS, buildCalibrationDefinition, calibrationPairHash } from '../../api/_replica-calibration.js';
import { generateOwnedDialogue } from '../../api/_replica-dialogue.js';
import { REPLICA_POLICY_VERSION } from '../../api/_replica.js';
const id = n => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000001`;
const stamp = '2026-09-08T00:00:00Z';
const people = [0, 1].map(i => ({ replica: id(10 + i), owner: id(20 + i), person: id(30 + i), agent: id(40 + i), session: id(50 + i), turn: id(60 + i), name: `SyntheticOwner${i}`, habit: `OWNER_STYLE_${i}` }));
const claim = (i, domain, key, body, decision = 'accepted') => ({ claim_id: String(i), domain, key, body, decision, status: decision === 'accepted' ? 'approved' : 'rejected', origin: 'self_declared', confidence: .99, source_ids: [id(80 + i)], sensitive: false, created_at: stamp, updated_at: stamp });
const claimsFor = p => [claim(1, 'identity', 'self_name', p.name), claim(2, 'language', 'languages', 'Hindi, English'), claim(3, 'relationship', 'repair', 'Admit mistakes and correct them'), claim(4, 'boundary', 'privacy', 'Keep each private conversation separate'), claim(5, 'habit', 'humor', p.habit)];
const scenarioIds = ['delivery.turn_shape', 'language.code_switch', 'behaviour.support_entry', 'behaviour.disagreement', 'behaviour.repair', 'memory.uncertainty', 'relationship.affection'];
function calibration(choice = 'left') { return buildCalibrationDefinition(scenarioIds.map((name, i) => { const s = CALIBRATION_SCENARIOS.find(s => s.scenario_id === name); return { preference_id: id(100 + i), profile_version: 7, scenario_id: name, scenario_revision: s.revision, layer: s.layer, pair_hash: calibrationPairHash(s), revision: 1, choice, confidence: 1, created_at: stamp }; }), 7); }
const matrix = people.flatMap(p => people.map(conversant => ({ agent: p.agent, person: conversant.person, phrase: `RELATION_${p.agent}_${conversant.person}`, history: `HISTORY_${p.agent}_${conversant.person}` })));
let checks = 0, generated = 0;
const pass = name => console.log(`ok ${++checks} - ${name}`);
function fixture(p, { rejected = false, choice = 'left', revoked = false, relationalFailure = false } = {}) {
  const calls = [], claims = claimsFor(p).map(c => rejected && c.key === 'humor' ? { ...c, decision: 'rejected', status: 'rejected' } : c);
  const profile = buildPersonModelDefinition(claims), policy = calibration(choice);
  let prompt = null;
  const generator = { family: 'dialogue', name: 'explicit-offline-personality-fixture', version: '1', model: 'no-model-call', async generate(input) { generated++; prompt = input.prompt; return { output: { reply: 'Synthetic response for caller verification.', delivery: { mode: 'grounded', pace: 'natural', intensity: .3, language_hint: 'English', nonverbals: [] } } }; } };
  const db = async (sql, args) => {
    calls.push({ sql, args });
    if (/select r\.replica_id,r\.owner_user_id/.test(sql)) return args[0] !== p.replica || args[1] !== p.owner || revoked ? [] : [{ replica_id: p.replica, owner_user_id: p.owner, subject_person_id: p.person, agent_id: p.agent, subject_mode: 'self', lifecycle: 'active', policy_version: REPLICA_POLICY_VERSION, capability_id: id(200), capability_state: 'active', runtime_policy: 'replica-runtime-v1', profile_version: 7, profile_status: 'approved', profile_definition: profile, calibration_version: 2, calibration_status: 'approved', calibration_definition: policy, voice_profile_id: id(201), genome_version: 1, voice_status: 'ready', genome_status: 'approved', capabilities: {}, consent_id: id(202), consent_scope: 'inference', consent_policy: REPLICA_POLICY_VERSION }];
    // WS-R161 (wave twenty-two). `generateOwnedDialogue` now falls back to
    // the text-ready door (`ownedRuntimeStatus`'s own `RUNTIME_STATUS_SQL`)
    // whenever the voice-runtime query immediately above finds no row —
    // exactly the `foreign-owner`/`revoked` scenarios this file's own `mode`
    // loop drives, never the `relationship-down` one (a REAL, active voice
    // runtime exists there, so that scenario never reaches this query at
    // all). Same ownership predicate as the query above, so the SAME two
    // scenarios still resolve to no row, and `generateOwnedTextDialogue`
    // still fails with the SAME `dialogue_runtime_not_active` this suite's
    // own assertions already expect.
    if (/select r\.replica_id,r\.subject_mode,r\.lifecycle/.test(sql)) return args[0] !== p.replica || args[1] !== p.owner || revoked ? [] : assert.fail('personality-flow28: an active-voice scenario unexpectedly reached the text-ready status query');
    if (/insert into vy_replica_runtime_session/.test(sql)) return [{ session_id: p.session, channel: 'private_chat' }];
    if (/from vy_(?:rel_state|pattern|ritual|currency|phrase|kin)/.test(sql)) {
      assert(sql.includes('agent_id=$1::uuid and person_id=$2::uuid')); assert.deepEqual(args, [p.agent, p.person]);
      if (relationalFailure) throw new Error('synthetic_relationship_read_failure');
      const row = matrix.find(r => r.agent === args[0] && r.person === args[1]);
      return /from vy_phrase/.test(sql) ? [{ phrase: row.phrase, gloss: 'Synthetic pair marker' }] : [];
    }
    if (/select recent\.ordinal/.test(sql)) { assert.deepEqual(args, [p.session, p.replica, p.owner, p.agent, p.person]); const row = matrix.find(r => r.agent === args[3] && r.person === args[4]); return [{ ordinal: 1, user_content: row.history, assistant_content: 'Earlier synthetic answer' }]; }
    if (/insert into vy_replica_dialogue_turn/.test(sql)) return [{ turn_id: p.turn, session_id: p.session, ordinal: 2, created_at: stamp }];
    if (/assistant_log as/.test(sql)) return [{ turn_id: p.turn, session_id: p.session, ordinal: 2, created_at: stamp, completed_at: stamp }];
    if (/update vy_replica_dialogue_turn set state/.test(sql)) return [];
    assert.fail('Unexpected fixture query');
  };
  return { db, generator, calls, get prompt() { return prompt; } };
}
const run = (f, p, owner = p.owner) => generateOwnedDialogue(f.db, owner, { replica_id: p.replica, channel: 'private_chat', message: 'Continue our private conversation.', trace_id: 'personality_fixture_28', person_id: people.find(x => x !== p).person, agent_id: people.find(x => x !== p).agent, history: [{ role: 'user', content: 'FORGED_CLIENT_HISTORY' }] }, f.generator);
for (const p of people) {
  const f = fixture(p); await run(f, p); const text = JSON.stringify(f.prompt), own = matrix.find(r => r.agent === p.agent && r.person === p.person);
  assert(text.includes(p.name) && text.includes(p.habit)); pass(`${p.name}: actual Person Model builder reaches the existing dialogue prompt`);
  assert(text.includes('Owner-calibrated behavior') && text.includes('compact observation')); pass(`${p.name}: server-controlled calibration reaches that same prompt`);
  assert(text.includes(own.phrase) && text.includes(own.history)); for (const other of matrix.filter(x => x !== own)) assert(!text.includes(other.phrase) && !text.includes(other.history)); assert(!text.includes('FORGED_CLIENT_HISTORY')); pass(`${p.name}: exact agent/person bindings select only its pair from two-by-two fixture matrix`);
  const changed = fixture(p, { rejected: true, choice: 'right' }); await run(changed, p); const revised = JSON.stringify(changed.prompt); assert(!revised.includes(p.habit)); assert(revised.includes('reflective arc')); assert.notEqual(changed.prompt.prompt_hash, f.prompt.prompt_hash); pass(`${p.name}: rejected claim and revised controlled preference change compiled output input`);
  for (const mode of ['foreign-owner', 'revoked', 'relationship-down']) {
    const before = generated, blocked = fixture(p, { revoked: mode === 'revoked', relationalFailure: mode === 'relationship-down' });
    await assert.rejects(() => run(blocked, p, mode === 'foreign-owner' ? people.find(x => x !== p).owner : p.owner), mode === 'relationship-down' ? /synthetic_relationship_read_failure/ : /dialogue_runtime_not_active/);
    assert.equal(generated, before); assert(!blocked.calls.some(c => /insert into vy_replica_dialogue_turn/.test(c.sql))); pass(`${p.name}: ${mode} refuses before generator/turn insertion in actual orchestration`);
  }
}
console.log(`PASS ${checks}; actual compilers/dialogue caller with explicit fixtures, no real SQL or model. Owner-only private runtime, not arbitrary visitor support.`);
