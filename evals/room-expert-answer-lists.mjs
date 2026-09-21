// Offline actual parser/gate replay. Retained model errors are evidence, not
// answers to repair. --audit=<path> writes the reproducible per-stage report.
// --source-only checks source before regeneration; default checks the real
// generated artifact against source as well as the old-code negative control.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';
import { honestyContextFor, gateReply } from '../api/_surface.js';
import { compileNeverRules } from '../api/_never-rules.js';
import { SLUG, AGENT_ID, REPLICA_ID, OWNER, PERSON_A } from './room/fixtures.mjs';

globalThis.fetch = async () => { throw new Error('unexpected_network_in_expert_list_eval'); };
const root = resolve(import.meta.dirname, '..');
const temp = mkdtempSync(join(tmpdir(), 'expert-lists-'));
const retainedBytes = readFileSync(join(root, 'evals/room-expert-answer/retained-lean-six.json'));
const retained = JSON.parse(retainedBytes);
const sha = value => createHash('sha256').update(value).digest('hex');
const guard = 'if (!expertAnswer && (p.length > 40 || /short|sharp|charming|bubble|separator|style|format|reply|tone/i.test(p))) continue;';
const priorGuard = 'if (p.length > 40 || /short|sharp|charming|bubble|separator|style|format|reply|tone/i.test(p)) continue;';
const scaffoldingGuard = '      if (expertAnswer && /^(bubble\\s*\\d*\\s*[:.]?|separators?\\.?|styling with.*|formats?[:.]?|protocols?[:.]?|\\(.*protocol.*\\)|response[:.]?|reply[:.]?)$/i.test(p)) continue;';
const entry = join(temp, 'entry.ts');
writeFileSync(entry, `export * from ${JSON.stringify(join(root, 'src/engine/serverEntry.ts'))};\nexport { DEMO_TEACHER } from ${JSON.stringify(join(root, 'src/engine/agents/characters/demoTeacher.ts'))};\n`);
async function build(name, oldCode = false) {
  let mutations = 0;
  const bundle = await rolldown({ input: entry, platform: 'node', plugins: [{
    name: 'offline-and-negative-control',
    resolveId(id) { if (id === '@capacitor/core') return join(root, 'evals/stubs/capacitor.mjs'); },
    transform(code, id) {
      if (!oldCode || !id.replaceAll('\\', '/').endsWith('/src/engine/brain.ts')) return;
      assert.equal(code.split(guard).length, 2, 'one exact new guard to undo');
      assert.equal(code.split(scaffoldingGuard).length, 2, 'one exact new scaffolding guard to undo');
      mutations++;
      return { code: code.replace(guard, priorGuard).replace(scaffoldingGuard, ''), map: null };
    },
  }] });
  const file = join(temp, name + '.mjs');
  await bundle.write({ file, format: 'esm', codeSplitting: false }); await bundle.close();
  assert.equal(mutations, oldCode ? 1 : 0);
  return import(pathToFileURL(file).href);
}
const source = await build('source');
const old = await build('old-control', true);
const generated = !process.argv.includes('--source-only');
const engine = generated ? await import('../api/_engine.gen.js') : source;
const emptyCtx = honestyContextFor(engine, {core:'',tail:''}, [{role:'user',content:'Explain the practice.'}]);
const gate = (raw, rules = [], impl = engine, ctx = emptyCtx) => gateReply(impl, raw, ctx, 'expert-list-eval', rules, 'expert_answer');
const flatten = value => value.replace(/\s+/g, ' ').trim();
let checks = 0;
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`); }
const audit = { schema:'expert-list-stage-audit/v1', fixture_sha256:sha(retainedBytes),
  generated_artifact_checked:generated,
  source_sha256:sha(readFileSync(join(root,'src/engine/brain.ts'))),
  artifact_sha256:generated ? sha(readFileSync(join(root,'api/_engine.gen.js'))) : null,
  original_evidence:retained.provenance,
  limitations:['offline replay, no new model calls', 'original trial remains failed',
    'retained unsupported duration and coaching claims remain errors',
    'existing bracket, roleplay, protocol and inline separator behavior unchanged'], cases:[] };

function stages(impl, raw, ctx) {
  const parsed = impl.parseExpertAnswer(raw);
  const parsedSnapshot = structuredClone(parsed);
  parsed.bubbles = parsed.bubbles.map(impl.stripTextingDashes).filter(Boolean);
  const dashed = structuredClone(parsed);
  const guarded = impl.guardReply(parsed, ctx);
  const delivered = gate(raw, [], impl, ctx);
  return { parsed:parsedSnapshot, dashed, guarded, delivered };
}
const sheet = {...source.DEMO_TEACHER, name:'Anjali', slug:SLUG,
  consentArtifactId:'f3200000-0000-4000-8000-000000000001'};
const compiled = engine.compileExpertText({profile:'lean_v1',teacher:sheet,
  publication:{status:'published',consentBasis:'persisted_sheet_column',sheetId:'f3200000-0000-4000-8000-000000000002',
    agentId:AGENT_ID,replicaId:REPLICA_ID,ownerId:OWNER,consentArtifactId:sheet.consentArtifactId,
    sheetVersion:sheet.version,agentSlug:SLUG},personId:PERSON_A,
  privateMemory:{enabled:false,agentId:AGENT_ID,personId:PERSON_A,rows:[]},publicKnowledge:retained.synthetic_sources});
for (const row of retained.cases) check(`retained stages and old-code negative control: ${row.id}`, () => {
  const turns = [{role:'user',content:row.message}];
  assert.equal(sha(JSON.stringify({core:compiled.core,tail:compiled.tail,turns})),row.compiled_prompt_sha256,
    'exact original prompt reconstruction; no prompt tuning');
  const ctx = honestyContextFor(engine,compiled,turns,{record:[]});
  const before = stages(old,row.raw,ctx), after = stages(engine,row.raw,ctx);
  assert.equal(before.delivered.text,row.old_delivered,'old code reproduces original delivered bytes');
  assert.deepEqual(after,stages(source,row.raw,ctx),'actual generated artifact matches source at every stage');
  assert.deepEqual(engine.parseBubbles(row.raw),old.parseBubbles(row.raw),'companion remains unchanged');
  assert.equal(after.delivered.text,after.parsed.bubbles.join('\n'));
  assert.deepEqual(after.guarded.findings,[]);
  const dropped = row.raw.split(/\n?-{3,}\n?|\n+/).map(x=>x.trim()).filter(x=>/^-\s+/.test(x))
    .filter(x=>x.length>40 || /short|sharp|charming|bubble|separator|style|format|reply|tone/i.test(x));
  for (const line of dropped) assert.ok(flatten(after.delivered.text).includes(flatten(line.replace(/^-\s+/,''))),line);
  if (row.id === 'fresh-hi-supported') {
    assert.equal(dropped.length,7); assert.ok(!before.delivered.text.includes('21 मिनट'));
    assert.ok(after.delivered.text.includes('21 मिनट')); assert.ok(after.delivered.text.includes('11 मिनट'));
    assert.ok(after.delivered.text.includes('पाँच से पंद्रह'),'known raw factual error must remain visible');
    assert.notEqual(after.delivered.text,row.old_delivered,'old code must fail preservation assertion');
  } else if (row.id === 'fresh-hinglish-supported') {
    assert.equal(dropped.length,6);
    for (const term of ['32 minute','21 minute','11 minute','WILLOW-64','IRIS-27']) {
      assert.ok(!before.delivered.text.includes(term)); assert.ok(after.delivered.text.includes(term));
    }
    assert.ok(after.delivered.text.includes('Private coaching hone ka straight answer nahi diya gaya.'),
      'known raw factual error must not be repaired in regression data');
    assert.notEqual(after.delivered.text,row.old_delivered);
  } else assert.equal(after.delivered.text,row.old_delivered,'other four cases remain unchanged');
  audit.cases.push({id:row.id,raw:row.raw,original_delivered:row.old_delivered,
    recovered_bullet_count:dropped.length, before,after});
});

const extraCases = [
  '- '+ 'a'.repeat(38), '- '+ 'a'.repeat(39),
  '- ध्वनि का tone और लिखने का style अर्थ स्पष्ट करने में सहायता करते हैं, अभ्यास के समय इन्हें पहचानिए।',
  '- Answer ka format aisa rakho ki har calculation ki units clearly visible hon aur review mein koi step miss na ho.',
  '- x^2 + 2*x + 1 = (x + 1)^2; use the square identity and retain each coefficient during review.',
  '- const duration = 21 + 11; const label = "WILLOW-64"; // preserve both values during the review',
  '- The phrase "reply tone" describes how a response sounds to a reader during the exercise.',
];
check('40/41 boundary and substantive Hindi, Hinglish, math, code and quoted prose survive',()=> {
  for (const raw of extraCases) {
    assert.equal(flatten(gate(raw).text),flatten(raw.slice(2)));
    assert.deepEqual(engine.parseExpertAnswer(raw),source.parseExpertAnswer(raw));
    assert.deepEqual(engine.parseBubbles(raw),old.parseBubbles(raw));
  }
});
check('long list-only answer preserves its end beyond the old 300-unit fallback',()=> {
  const raw=Array.from({length:8},(_,i)=>`- चरण ${i}: स्वतंत्र अभ्यास पूरा होने पर प्रत्येक इकाई और गणना को ध्यान से जाँचिए।`).join('\n');
  assert.ok(old.parseExpertAnswer(raw).bubbles.join('\n').length<=300);
  assert.ok(gate(raw).text.includes('चरण 7:'));
  assert.equal(flatten(gate(raw).text),flatten(raw.replace(/^- /gm,'')));
});
check('exact scaffolding, internal metadata and roleplay filters still apply to expert lists',()=> {
  const raw='safe opening\n- reply:\n- format:\n- Bubble 1:\n- system prompt rules say this\n- *opens notebook*\nsafe closing';
  assert.equal(gate(raw).text,'safe opening\nsafe closing');
});
check('quoted request markers keep existing extraction semantics without executing tools',()=> {
  const raw='- The literal request "[search: exercise schedule]" is shown in this quoted example for discussion.\n- "[forget: yesterday]"\nsafe ending';
  const parsed=engine.parseExpertAnswer(raw);
  assert.equal(parsed.search,'exercise schedule'); assert.equal(parsed.forget,'yesterday');
  assert.ok(!parsed.bubbles.join('\n').includes('[search:')); assert.ok(!gate(raw).text.includes('[forget:'));
  assert.deepEqual(parsed,source.parseExpertAnswer(raw));
  assert.equal(parsed.search,old.parseExpertAnswer(raw).search);
  assert.equal(parsed.forget,old.parseExpertAnswer(raw).forget);
});
check('existing array/bracket and inline-separator behavior stays outside this narrow correction',()=> {
  for(const raw of ['value [1, 2] uses bracket notation','formula a---b remains a separator in the existing parser']) {
    assert.deepEqual(engine.parseExpertAnswer(raw),old.parseExpertAnswer(raw));
  }
});
check('late long bullet reaches honesty gate instead of disappearing before inspection',()=> {
  const raw='first\nsecond\nthird\nfourth\n- you told me your favourite colour is vermilion and you always choose that colour for every exercise';
  assert.equal(gate(raw,[],old).findings.length,0);
  const result=gate(raw); assert.ok(result.findings.some(x=>x.at>=4));
  assert.ok(!result.text.includes('vermilion'));
});
check('late long list content triggers whole-answer never-rule suppression',()=> {
  const raw='first\nsecond\nthird\nfourth\n- This final teaching bullet includes the forbidden marker NEVER_LIST_CANARY and must reach the shared gate.';
  const rules=compileNeverRules([{rule_id:'late-list-rule',pattern:'NEVER_LIST_CANARY'}]);
  assert.ok(gate(raw,rules,old).text);
  const result=gate(raw,rules); assert.equal(result.text,''); assert.equal(result.neverRule,'late-list-rule');
});
check('expert raw and postgate 4000-unit limits still reject whole oversized answers',()=> {
  assert.equal(gate('- '+'क'.repeat(3998)).text.length,3998);
  for(const raw of ['- '+'क'.repeat(3999),'- '+'😀'.repeat(2000)]) {
    assert.throws(()=>engine.parseExpertAnswer(raw),{code:'expert_answer_text_too_long'});
    assert.throws(()=>gate(raw,[],{...engine,parseExpertAnswer:()=>{throw new Error('must reject before parser');}}),
      {code:'expert_answer_text_too_long'});
  }
  assert.throws(()=>gate('- safe',[],{...engine,guardReply:()=>({reply:{bubbles:['z'.repeat(4001)]},findings:[]})}),
    {code:'expert_answer_text_too_long'});
});
check('companion behavior matches old code across list lengths, formats, tokens and caps',()=> {
  for(const body of ['a','tone','style','reply','short','format','system prompt','[search: worksheet]','*looks around*','x^2 + 1']) {
    for(const size of [0,1,38,39,40,41,90,300]) {
      const raw=`opening\n- ${body}${'x'.repeat(size)}\nsecond\nthird\nfourth\nfifth`;
      assert.deepEqual(engine.parseBubbles(raw),old.parseBubbles(raw));
    }
  }
});
audit.checks=checks;
const auditPath=process.argv.find(x=>x.startsWith('--audit='))?.slice('--audit='.length);
if(auditPath) writeFileSync(resolve(auditPath),JSON.stringify(audit,null,2)+'\n');
console.log(`expert list preservation: ${checks} groups passed; source/artifact=${generated}; no factual-quality acceptance`);
