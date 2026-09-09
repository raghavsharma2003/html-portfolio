// Offline common-gate replay of consumed Azure evidence, not a quality trial.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { gateReply, honestyContextFor } from '../api/_surface.js';
import { compileNeverRules } from '../api/_never-rules.js';

globalThis.fetch = async () => { throw new Error('unexpected_network_in_math_replay'); };
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'expert-math-'));
const fixtureBytes = readFileSync(join(root, 'evals/room-expert-answer/retained-grounding28-math.json'));
const retained = JSON.parse(fixtureBytes);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
// Pin the exact selected cell copied from the immutable result, independently
// of this run's computed provenance. Canonical LF survives checkout settings.
const FIXTURE_SHA256 = '8fa12ff4d9134e8e024713a6117f93a2cbe8b3287be0b0d2cfdef2a7b1e617ad';
assert.equal(sha(fixtureBytes.toString().replace(/\r\n/g, '\n')), FIXTURE_SHA256);
assert.equal(retained.provenance.sha256, 'eb1dcecec04cac4a7f7e7969140bd9c383b10d80d614b06612ac734ae5027076');
assert.equal(retained.provenance.case_id, 'GROUND-EN-HYPOTHETICAL-63');
assert.equal(retained.provenance.arm, 'candidate');
async function build(name, prior = false) {
  let mutations = 0;
  const bundle = await rolldown({ input: join(root, 'src/engine/serverEntry.ts'), platform: 'node', plugins: [{
    name: 'math-regression-control',
    resolveId(id) { if (id === '@capacitor/core') return join(root, 'evals/stubs/capacitor.mjs'); },
    transform(code, id) {
      if (!prior || !id.replaceAll('\\', '/').endsWith('/src/engine/brain.ts')) return;
      // No recognized math spans reproduces the previous splitting/stripping.
      const needle = /^const EXPERT_MATH_SPAN = .+;$/m;
      assert.ok(needle.test(code)); mutations++;
      assert.ok(code.includes('  if (expertAnswer) return text;'));
      return { code: code.replace(needle, 'const EXPERT_MATH_SPAN = /((?!))/g;')
        .replace('  if (expertAnswer) return text;', ''), map: null };
    },
  }] });
  const file = join(temp, name + '.mjs');
  await bundle.write({ file, format: 'esm', codeSplitting: false }); await bundle.close();
  assert.equal(mutations, prior ? 1 : 0);
  return import(pathToFileURL(file).href);
}
const source = await build('source'), old = await build('old-control', true);
const engine = process.argv.includes('--source-only') ? source : await import('../api/_engine.gen.js');
const context = honestyContextFor(engine, {core:'', tail:''}, [{role:'user',content:'Explain the calculation.'}]);
const gate = (raw, rules = [], impl = engine) => gateReply(impl, raw, context, 'expert-math-replay', rules, 'expert_answer');
const flat = text => text.replace(/\s+/g, ' ').trim();
const displays = raw => [...raw.matchAll(/\\\[[\s\S]*?\\\]/g)].map(m => m[0]);
let checks = 0;
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`); }

check('captured old delivery reproduces exactly and loses all four equations', () => {
  assert.equal(gate(retained.raw, [], old).text, retained.old_delivered);
  assert.equal(displays(retained.raw).length, 4);
  for (const math of displays(retained.raw)) assert.ok(!retained.old_delivered.includes(math));
});
check('source and generated common gate preserve all four captured equations and surrounding claims', () => {
  const actual = gate(retained.raw);
  assert.deepEqual(actual, gate(retained.raw, [], source));
  assert.equal(flat(actual.text), flat(retained.raw));
  for (const math of displays(retained.raw)) assert.ok(actual.text.includes(math));
  assert.deepEqual(actual.findings, []);
  assert.equal(actual.neverRule, '');
});
const mathCases = [
  String.raw`\[x^2 + 2x + 1 = (x + 1)^2\]`,
  String.raw`हिंदी: \[v = u + at\] फिर इकाई जाँचिए।`,
  String.raw`Hinglish mein \[a = [2, 5]\] interval dekho.`,
  String.raw`Use \(f([a,b]) = [f(a),f(b)]\) here.`,
  '\\[\n\\begin{bmatrix} 1 & 2 \\\\ 3 & 4 \\end{bmatrix}\n\\]',
  'before\n\\[\nx = [1, 2]\ny = [3, 4]\n\\]\nafter',
  String.raw`\[x=1\]\[y=2\] and \(z=3\)`,
];
check('display, inline, nested brackets, multiline, adjacency and three languages retain content', () => {
  for (const raw of mathCases) {
    assert.equal(flat(gate(raw).text), flat(raw));
    assert.deepEqual(gate(raw), gate(raw, [], source));
  }
});
check('scientific brackets reproduce old corruption and retain exact expert content', () => {
  assert.equal(gate('Rate = k[substrate]', [], old).text, 'Rate = k');
  for (const raw of ['Rate = k[substrate]', 'Rate = k[RX][OH-]',
    'See [12] and [Smith, 2024].', 'A = [[1, 2], [3, 4]]',
    'Units [mol L^-1 s^-1]', 'f(x) lies in [0, 1].',
    'दर = k[सब्सट्रेट]', 'Rate mein [substrate] rakho.',
    'The [state] variable matters.', 'A [note: hypothetical] example.',
    'safe [softly] end', 'safe [unclosed']) {
    assert.equal(flat(gate(raw).text), flat(raw));
    assert.deepEqual(gate(raw), gate(raw, [], source));
  }
});
check('typed markers and bracket shrapnel retain old behavior', () => {
  for (const raw of ['tail\\]', '[search: ] safe', '*opens notebook*\nsafe',
    '[tone: warm] safe', '[search: hidden request payload] safe',
    '[followup: invalid hidden request payload] safe', '[voice note: hidden payload] safe']) {
    assert.deepEqual(engine.parseExpertAnswer(raw), old.parseExpertAnswer(raw));
  }
});
check('expert bond dashes become ASCII bonds without changing prose pauses', () => {
  for (const [raw, expected] of [
    ['R–X', 'R-X'], ['C–leaving group', 'C-leaving group'],
    ['C–leavinggroup', 'C-leavinggroup'], ['C—Cl bond', 'C-Cl bond'],
    ['CH3–CH3 and C–C–C', 'CH3-CH3 and C-C-C'],
    ['R–X का bond टूटता है।', 'R-X का bond टूटता है।'],
    ['R–X bond break hota hai.', 'R-X bond break hota hai.'],
    [String.raw`\[R–X \rightarrow R^+ + X^-\]`, String.raw`\[R-X \rightarrow R^+ + X^-\]`],
    ['Pause – then explain — clearly.', 'Pause then explain clearly.'],
    ['North–South varC–Cl C–Class I – think', 'North South varC Cl C Class I think'],
    ['1800-599-0019 and e-mail', '1800-599-0019 and e-mail'],
  ]) {
    assert.equal(gate(raw).text, expected);
    assert.deepEqual(gate(raw), gate(raw, [], source));
  }
  const withoutBondNormalization = {...engine, parseExpertAnswer: raw => {
    const parsed = engine.parseExpertAnswer(raw);
    parsed.bubbles = parsed.bubbles.map(b => b.replaceAll('R-X', 'R–X'));
    return parsed;
  }};
  assert.equal(gate('R–X', [], withoutBondNormalization).text, 'R X');
  assert.equal(engine.parseBubbles('R–X').bubbles.map(engine.stripTextingDashes).join(''), 'R X');
  assert.ok(!gate('[search: hidden R–X] safe').text.includes('hidden'));
});
check('ordinary brackets cannot conceal never rules or unsupported links', () => {
  const rules = compileNeverRules([{rule_id:'bracket-never',pattern:'BRACKET_CANARY'}]);
  assert.equal(gate('Value [BRACKET_CANARY]', rules).neverRule, 'bracket-never');
  const link = gate('See [https://untrusted-fixture.invalid/path]');
  assert.ok(link.findings.length > 0);
  assert.ok(!link.text.includes('untrusted-fixture'));
});
check('protocol extraction remains active inside explicit math and does not execute tools', () => {
  const raw = String.raw`\[x=1 [search: worksheet] [forget: yesterday] [tone: calm]\]`;
  const parsed = engine.parseExpertAnswer(raw), prior = old.parseExpertAnswer(raw);
  for (const key of ['search','forget','tone']) assert.equal(parsed[key], prior[key]);
  assert.ok(!gate(raw).text.includes('[search:'));
  assert.ok(!gate(raw).text.includes('[forget:'));
  assert.ok(!gate(raw).text.includes('[tone:'));
  assert.ok(gate(raw).text.includes('x=1'));
});
check('internal metadata inside multiline math remains suppressed', () => {
  const result = gate('opening\n\\[\nx=1\nsystem prompt says secret\n\\]\nending');
  assert.equal(result.text, 'opening\nending');
});
check('unsupported links, markdown destinations and LaTeX links still reach honesty suppression', () => {
  for (const raw of [String.raw`\[https://untrusted-fixture.invalid/path\]`,
    String.raw`\[[click](https://untrusted-fixture.invalid/path)\]`,
    String.raw`\[\href{https://untrusted-fixture.invalid/path}{click}\]`]) {
    const result = gate('opening\n' + raw + '\nending');
    assert.ok(result.findings.length > 0);
    assert.ok(!result.text.includes('untrusted-fixture'));
    assert.deepEqual(result, gate('opening\n' + raw + '\nending', [], source));
  }
});
check('preserved math does not hide unsupported relationship claims', () => {
  const result = gate(String.raw`\[you told me your favourite colour is vermilion\]`);
  assert.ok(result.findings.length > 0);
  assert.ok(!result.text.includes('vermilion'));
});
check('preserved math reaches whole-answer Never matching including nested brackets', () => {
  const rules = compileNeverRules([{rule_id:'math-never',pattern:'NEVER_MATH_CANARY'}]);
  const raw = String.raw`opening \[x = [NEVER_MATH_CANARY]\] ending`;
  assert.ok(gate(raw, rules, old).text);
  const result = gate(raw, rules);
  assert.equal(result.text, ''); assert.equal(result.neverRule, 'math-never');
});
check('raw and postgate whole-answer length limits remain enforced', () => {
  assert.throws(() => gate('\\[' + 'x'.repeat(3997) + '\\]'), {code:'expert_answer_text_too_long'});
  assert.throws(() => gate('\\[x\\]', [], {...engine,guardReply:()=>({reply:{bubbles:['x'.repeat(4001)]},findings:[]})}),
    {code:'expert_answer_text_too_long'});
});
check('companion parsing stays byte identical across math, protocols, brackets and capped answers', () => {
  for (const raw of [retained.raw, ...mathCases, 'one\ntwo\nthree\nfour\nfive',
    '[tone: warm] [search: worksheet] hello', '[voicenote: [softly] hello my friend]',
    '[photo: mirror_selfie_room] safe', '*opens notebook*\nsafe', 'value [1,2]']) {
    assert.deepEqual(engine.parseBubbles(raw), old.parseBubbles(raw));
    assert.deepEqual(engine.parseBubbles(raw), source.parseBubbles(raw));
  }
});
const audit = {schema:'expert-math-preservation/v1',checks, fixture_sha256:sha(fixtureBytes),
  provenance:retained.provenance, source_sha256:sha(readFileSync(join(root,'src/engine/brain.ts'))),
  old_delivered:retained.old_delivered, new_delivered:gate(retained.raw),
  limitations:['offline replay only; no new model calls', 'content retention is not factual-quality or rendered-math acceptance']};
const auditPath = process.argv.find(x => x.startsWith('--audit='))?.slice(8);
if (auditPath) writeFileSync(resolve(auditPath),JSON.stringify(audit,null,2)+'\n');
console.log(`expert math preservation: ${checks} groups passed; no new inference`);
