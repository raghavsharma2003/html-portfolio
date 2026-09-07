// Real parser, shared gate and Room callers; fixture authority and replies.
// --source verifies source before the committed engine bundle is rebuilt.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadFixtureAgent, freshState, fakeDb, fakeMemory, SLUG, USER_A, ROOM_ID } from './room/fixtures.mjs';
import { gateReply, gatedReply, honestyContextFor, roomReplyTextProfile } from '../api/_surface.js';
import { compileNeverRules } from '../api/_never-rules.js';
import { PUBLIC_ROOM_KNOWLEDGE_SQL } from '../api/_room-knowledge.js';

globalThis.fetch = async () => { throw new Error('unexpected_network_in_expert_answer_eval'); };
process.env.ROOM_SESSION_SECRET = 'expert-answer-fixture-'.repeat(4);
const { roomSay, joinRoom, readRoomSession, ROOM_TEXT_LIMIT } = await import('../api/_room-surface.js');
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await loadFixtureAgent(root);
let engine = fixture.engine;
if (process.argv.includes('--source')) {
  const outfile = join(mkdtempSync(join(tmpdir(), 'expert-answer-source-')), 'engine.mjs');
  // Same cached compiler as the repository bundle builder; no package install.
  execFileSync('npx', ['--no-install', 'esbuild', join(root, 'src/engine/serverEntry.ts'), '--bundle', '--format=esm', '--platform=node',
    `--outfile=${outfile}`, '--log-level=error', `--alias:@capacitor/core=${join(root, 'evals/stubs/capacitor.mjs')}`],
    { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
  engine = await import(pathToFileURL(outfile).href);
}
const PROFILE = 'expert_answer';
const sha = text => createHash('sha256').update(text).digest('hex');
const context = honestyContextFor(engine, { core: '', tail: '' }, [{ role: 'user', content: 'Explain the exercise labels and duration.' }]);
const gate = (raw, rules = [], implementation = engine) => gateReply(implementation, raw, context, 'expert-answer-eval', rules, PROFILE);
let checks = 0;
async function check(name, fn) { await fn(); console.log(`ok ${++checks} - ${name}`); }

// Exact retained synthetic Azure responses, already exposed regression data.
// The baseline's last sentence is unsupported by its reference. Recovering it
// proves transport retention only, and must never be scored as factual success.
const rawBaseline = "r83 ka ek session 23 minute ka hota hai  \nisme pehle 19 minute exercise solve karne hain  \nphir 4 minute apne answers check karne ke hain  \nis sequence ko follow karo  \n\n---\n\nab jo wo exercise h jisko dobara dekhna hai, uske upar 'birch-28' label lagana hai  \nmatlab wo exercise abhi review hone wali hai, complete nahi hai  ";
const rawPolicy = "r83 me do phase hote hain ek toh 19 minutes ke practice question solve karne ke liye  \n\n----\n\nfir 4 minutes hote hain apne likhe answers ko check karne ke liye  \n\n----\n\njo exercise abhi review ki demand karti h, uske liye label hai birch-28  — matlab usme abhi bhi dekhna baki hai, complete hone ka matlab sahi hona nahi hota  \n\n----\n\nachha, tumne kis exercise pe abhi tak kaam kiya h?";
const five = 'first step\nsecond step\nthird step\nfourth step\nfinal birch-28 label';
const source = { id: 'd1000000-0000-4000-8000-000000000001', room_id: ROOM_ID,
  question: 'Which exercise needs review?', answer: 'BIRCH-28 needs review.', position: 1, removed_at: null };

async function setup({ profile, remembers = false, raw = five, implementation = engine, neverRules = [] } = {}) {
  const state = freshState({ publishedQA: [source] }), db = fakeDb(state), memlog = [];
  const env = { ROOM_SESSION_SECRET: process.env.ROOM_SESSION_SECRET };
  if (profile !== undefined) env.ROOM_REPLY_TEXT_PROFILE = profile;
  let calls = 0;
  const deps = { env, engine: implementation, loadAgent: fixture.loadAgent, memory: fakeMemory(memlog), neverRules,
    tableApplied: async () => false, reply: async () => { calls++; return raw; } };
  const joined = await joinRoom(db, { slug: SLUG, authUserId: USER_A, ageAttested: true, memoryConsent: remembers }, deps);
  const say = extra => roomSay(db, { session: joined.session, message: 'Explain the exercise labels.', transcript: [], ...extra }, deps);
  return { state, db, memlog, env, deps, joined, say, calls: () => calls };
}

await check('only exact server configuration selects the profile', () => {
  assert.equal(roomReplyTextProfile({}), undefined);
  assert.equal(roomReplyTextProfile({ ROOM_REPLY_TEXT_PROFILE: PROFILE }), PROFILE);
  for (const value of ['', null, false, 1, 'expert', 'EXPERT_ANSWER', 'expert_answer ', {}, [PROFILE]]) {
    assert.throws(() => roomReplyTextProfile({ ROOM_REPLY_TEXT_PROFILE: value }), { code: 'room_reply_text_profile_invalid', status: 503 });
  }
});
await check('default parser remains capped; expert parser retains fifth segment', () => {
  assert.equal(engine.parseBubbles(five).bubbles.length, 4);
  assert.equal(engine.parseExpertAnswer(five).bubbles.length, 5);
  assert.ok(gate(five).text.endsWith('final birch-28 label'));
});
await check('long paragraph sentence splitting does not consume an expert answer budget', () => {
  const raw = Array.from({ length: 7 }, (_, i) => `step ${i}: ${'use the worksheet carefully '.repeat(3)}.`).join(' ');
  assert.ok(engine.parseExpertAnswer(raw).bubbles.length > 4);
  assert.ok(gate(raw).text.includes('step 6:'));
  assert.ok(!engine.parseBubbles(raw).bubbles.join('\n').includes('step 6:'));
});
await check('retained baseline label and unsupported final claim are both retained, without a truth claim', () => {
  assert.ok(!engine.parseBubbles(rawBaseline).bubbles.join('\n').includes('birch-28'));
  assert.ok(gate(rawBaseline).text.includes('birch-28'));
  assert.ok(gate(rawBaseline).text.includes('complete nahi hai'));
});
await check('retained policy has both timing parts, label and no ghost separator', () => {
  const output = gate(rawPolicy).text;
  for (const value of ['19 minutes', '4 minutes', 'birch-28']) assert.ok(output.includes(value));
  assert.ok(!output.split('\n').some(x => /^-+$/.test(x)));
});
await check('format cleanup and protocol extraction remain byte-identical below the default cap', () => {
  for (const raw of ['[tone: calm]one\n----\ntwo', 'PINE-63 and BIRCH-28', 'call 1800-599-0019 pe',
    'hello [stage direction] there', '- a long bullet that currently exceeds the parser presentation threshold\nhello',
    '[search: exercise]\nhello', '*looks around*\nhello', '']) {
    assert.deepEqual(engine.parseExpertAnswer(raw), engine.parseBubbles(raw));
  }
});
await check('real honesty predicates inspect a fabricated attribution after segment four', () => {
  const raw = 'first\nsecond\nthird\nfourth\nyou told me your favourite colour is vermilion';
  assert.equal(gateReply(engine, raw, context).findings.length, 0);
  const output = gate(raw);
  assert.ok(output.findings.some(f => f.at >= 4));
  assert.ok(!output.text.includes('vermilion'));
});
await check('never rules inspect the assembled late segment and suppress the whole answer', () => {
  const rules = compileNeverRules([{ rule_id: 'late-label', pattern: 'final birch-28 label' }]);
  const output = gate(five, rules);
  assert.equal(output.text, '');
  assert.equal(output.neverRule, 'late-label');
});
await check('4000 string units accepted, 4001 rejected before parsing, with no byte or codepoint substitution', () => {
  assert.equal(ROOM_TEXT_LIMIT, 4000);
  assert.equal(gate('z'.repeat(4000)).text.length, 4000);
  for (const raw of ['z'.repeat(4001), 'क'.repeat(4001), '😀'.repeat(2001)]) {
    assert.throws(() => engine.parseExpertAnswer(raw), { code: 'expert_answer_text_too_long', status: 502 });
    assert.throws(() => gate(raw, [], { ...engine, parseExpertAnswer: () => { throw new Error('parser must not run'); } }),
      { code: 'expert_answer_text_too_long', status: 502 });
  }
});
await check('post-gate expansion is rejected rather than delivered as a prefix', () => {
  assert.throws(() => gate('small', [], { ...engine, guardReply: () => ({ reply: { bubbles: ['z'.repeat(4001)] }, findings: [] }) }),
    { code: 'expert_answer_text_too_long', status: 502 });
});
await check('invalid internal profile and stale parser fail before provider dispatch', async () => {
  for (const [textProfile, implementation, code] of [['bad', engine, 'reply_text_profile_invalid'],
    [PROFILE, { ...engine, parseExpertAnswer: undefined }, 'expert_answer_parser_unavailable']]) {
    let calls = 0;
    await assert.rejects(gatedReply({ engine: implementation, reply: async () => { calls++; return five; } },
      { core: '', tail: '' }, [], { textProfile }), { code, status: 503 });
    assert.equal(calls, 0);
  }
});
await check('actual Room ignores client profile and leaves default four-segment behavior', async () => {
  const world = await setup();
  const turn = await world.say({ textProfile: PROFILE, replyTextProfile: PROFILE });
  assert.ok(!turn.reply.includes('birch-28'));
  assert.equal(world.calls(), 1);
});
await check('actual Room invalid configuration rejects before quota and model work', async () => {
  for (const profile of ['', 'bad']) {
    const world = await setup({ profile });
    await assert.rejects(world.say(), { code: 'room_reply_text_profile_invalid', status: 503 });
    assert.equal(world.calls(), 0);
    assert.ok(!world.db.calls.some(sql => /update vy_room_follower f\s+set month_key/.test(sql)));
  }
});
await check('actual Room delivers the late label, hashes delivered bytes and retains source revalidation', async () => {
  const world = await setup({ profile: PROFILE });
  const turn = await world.say();
  assert.ok(turn.reply.endsWith('final birch-28 label'));
  assert.deepEqual(turn.bubbles, [turn.reply]);
  assert.equal(turn.knowledge.reply_sha256, sha(turn.reply));
  assert.equal(turn.knowledge.relation, 'provided_to_model');
  assert.equal(turn.knowledge.exact, false);
  assert.equal(world.db.calls.filter(sql => sql === PUBLIC_ROOM_KNOWLEDGE_SQL).length, 3);
  assert.equal(world.memlog.length, 0);
  const payload = readRoomSession(turn.session, world.env);
  assert.equal(payload.lr, createHash('sha256').update(turn.reply).digest('base64url').slice(0, 32));
});
await check('memory-free next turn accepts the complete 4000-unit answer transcript', async () => {
  const world = await setup({ profile: PROFILE, raw: 'z'.repeat(4000) });
  const first = await world.say();
  const second = await world.say({ session: first.session, message: 'Continue.', transcript: [
    { role: 'user', content: 'Explain the exercise labels.' }, { role: 'assistant', content: first.reply }] });
  assert.equal(first.reply.length, 4000);
  assert.equal(second.reply.length, 4000);
  assert.equal(world.calls(), 2);
});
await check('remembering Room logs the complete accepted answer', async () => {
  const world = await setup({ profile: PROFILE, remembers: true });
  const turn = await world.say();
  assert.deepEqual(world.memlog.filter(x => x.call === 'logTurn' && x.role === 'her').map(x => x.content), [turn.reply]);
  assert.ok(turn.reply.endsWith('final birch-28 label'));
});
await check('raw and post-gate overflows abort Room before delivery or assistant memory', async () => {
  for (const options of [{ raw: 'z'.repeat(4001) }, { raw: 'small', implementation: {
    ...engine, guardReply: () => ({ reply: { bubbles: ['z'.repeat(4001)] }, findings: [] }) } }]) {
    const world = await setup({ profile: PROFILE, remembers: true, ...options });
    await assert.rejects(world.say(), { code: 'expert_answer_text_too_long', status: 502 });
    assert.equal(world.calls(), 1);
    assert.ok(!world.memlog.some(x => x.call === 'logTurn' && x.role === 'her'));
    // The delivery-time source revalidation is downstream of the rejection.
    assert.equal(world.db.calls.filter(sql => sql === PUBLIC_ROOM_KNOWLEDGE_SQL).length, 2);
  }
});
await check('late never-rule suppression produces neither answer nor source sidecar in actual Room', async () => {
  const world = await setup({ profile: PROFILE, remembers: true,
    neverRules: [{ rule_id: 'late-label', pattern: 'final birch-28 label' }] });
  const turn = await world.say();
  assert.equal(turn.reply, ''); assert.deepEqual(turn.bubbles, []); assert.equal(turn.knowledge, null);
  assert.ok(!world.memlog.some(x => x.call === 'logTurn' && x.role === 'her'));
});
console.log(`expert answer: ${checks} checks passed; fixture control flow only, no model, SQL or factual-quality proof`);
