// Actual production contracts/service/readers; offline dependency seams only.
// No SQL validity, authorization, provider, or native-language quality claim.
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const api = new URL('api/', root);
const baseline = 'c56cadfe72a20ee02781485752d8d67fcfc6fb21';
const id = '11111111-1111-4111-8111-111111111111';
const delivery = { mode: 'warm', pace: 'natural', intensity: 0.3, language_hint: 'hi', nonverbals: [] };
const answer = (reply, hint = 'hi') => ({ reply, delivery: { ...delivery, language_hint: hint } });
let events = [], generated = answer('ठीक है 🙂'), captured, written, usageMeasured = true;
const turn = { turn_id: id, session_id: id, ordinal: 1, created_at: '2026-09-07T00:00:00Z' };
const runtime = { replica: { replica_id: id, agent_id: id, subject_person_id: id }, capability: { capability_id: id }, personProfile: { definition: {} }, calibration: { definition: {} }, candidateBinding: null };
globalThis.__dialogueUnicode = {
  runtime: () => { events.push('runtime'); return runtime; },
  session: () => { events.push('session'); return { session_id: id, channel: 'private_chat' }; },
  snapshot: () => { events.push('snapshot'); return {}; },
  budget: name => { events.push(name); return name === 'reserve' ? { id } : undefined; },
};
const stubs = new Map([
  ['_replica.js', `export const replicaId=x=>x; export const REPLICA_POLICY_VERSION='offline-test';`],
  ['_person-model.js', `export const personProfileValiditySql=()=> 'true';`],
  // WS-R161: `loadOwnedTextProfile`/`ownedRuntimeStatus` are new imports
  // `api/_replica-dialogue.js` now carries for the text-ready fallback
  // (`generateOwnedDialogue` calls them ONLY when `loadOwnedRuntimeContext`
  // returns null). Every scenario in THIS suite drives the voice path with
  // `runtime` always truthy (`globalThis.__dialogueUnicode.runtime()`
  // above), so that branch never fires here; these two exports exist only
  // so the static import resolves, matching this file's own established
  // shape for an export a given suite's scenarios never actually reach.
  // WS-R172 adds a third, `loadOwnedTextIdentity` (`ownedSelfRuntime`'s own
  // new fallback, `api/_replica-dialogue.js`), for the identical reason —
  // this suite never drives the owner-memory/relstate ops at all.
  ['_replica-runtime.js', `export const REPLICA_CORE_CAP=12000; export const OWNED_RUNTIME_CONTEXT_SQL='select 1'; export const compileReplicaRuntimeCore=()=> 'Synthetic approved persona'; export const compileRelationshipTail=()=> ''; export const loadOwnedRuntimeContext=(...a)=>globalThis.__dialogueUnicode.runtime(...a); export const loadOwnedPrivateRuntimeContext=loadOwnedRuntimeContext; export const openOwnedRuntimeSession=(...a)=>globalThis.__dialogueUnicode.session(...a); export const loadPrivateRelationshipSnapshot=(...a)=>globalThis.__dialogueUnicode.snapshot(...a); export const loadOwnedTextProfile=async()=>{ throw Object.assign(new Error('dialogue_unicode_suite_never_reaches_text_ready'), {code:'dialogue_unicode_suite_never_reaches_text_ready'}); }; export const ownedRuntimeStatus=async()=>{ throw Object.assign(new Error('dialogue_unicode_suite_never_reaches_text_ready'), {code:'dialogue_unicode_suite_never_reaches_text_ready'}); }; export const loadOwnedTextIdentity=async()=>{ throw Object.assign(new Error('dialogue_unicode_suite_never_reaches_text_ready'), {code:'dialogue_unicode_suite_never_reaches_text_ready'}); };`],
  ['_provider-budget.js', `export const conservativeTokenEstimate=()=>1; export const tokenReservationMicrousd=()=>1; export const foundryBudgetConfig=()=>({});\n` + ['reserveFoundrySpend:reserve','beginFoundrySpend:begin','settleFoundrySpend:settle','markFoundrySpendUncertain:uncertain','releaseFoundrySpendBeforeCall:release'].map(pair => { const [name,event]=pair.split(':'); return `export const ${name}=async(...a)=>globalThis.__dialogueUnicode.budget('${event}',...a);`; }).join('\n')],
].map(([path, source]) => [new URL(path, api).href, source]));
const hooks = registerHooks({ load(url, context, nextLoad) {
  if (stubs.has(url)) return { format: 'module', source: stubs.get(url), shortCircuit: true };
  return nextLoad(url, context);
} });
let groups = 0;
async function check(name, run) { await run(); groups++; console.log(`PASS ${name}`); }
const rejectsCode = (run, code) => assert.rejects(run, error => error.code === code);
const throwsCode = (run, code) => assert.throws(run, error => error.code === code);
const loadSource = source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const absoluteImports = source => source.replace(/(from\s+['"])(\.[^'"]+)(['"])/g, (_,a,path,b) => `${a}${new URL(path, new URL('_dialogue/contracts.js',api)).href}${b}`);
// blob from commit `baseline`, moved to a committed fixture
// (context/rejected.md#ci-shallow-checkout-starved-the-history-reading-suites).
const oldSource = readFileSync(new URL(`evals/dialogue-unicode/fixtures/${baseline.slice(0, 8)}/api___dialogue__contracts.js`, root), 'utf8');
try {
  const current = await import(new URL('_dialogue/contracts.js', api));
  const old = await loadSource(absoluteImports(oldSource));
  const { cleanDialogueText: clean, hasMalformedDialogueUnicode: malformed, validateDialogueOutput: validate, compileDialoguePrompt: compile } = current;
  const service = await import(new URL('_replica-dialogue.js', api));
  const history = await import(new URL('_replica-dialogue-history.js', api));
  const boundaryReply = 'x'.repeat(1599) + '🙂';
  await check('exact incumbent split-answer counterexample', () => {
    assert.equal(Array.from(boundaryReply).length, 1600);
    const result = old.validateDialogueOutput(answer(boundaryReply));
    assert.equal(result.reply.length, 1600); assert.equal(result.reply.charCodeAt(1599), 0xd83d);
    assert.equal(malformed(result.reply), true);
    throwsCode(() => validate(answer(boundaryReply)), 'dialogue_reply_too_large');
  });
  await check('exact incumbent split-hint and prompt counterexamples', () => {
    assert.equal(malformed(old.validateDialogueOutput(answer('ok', 'x'.repeat(31)+'🙂')).delivery.language_hint), true);
    assert.equal(malformed(old.cleanDialogueText('x'.repeat(1999)+'🙂',2000)), true);
    throwsCode(() => validate(answer('ok', 'x'.repeat(31)+'🙂')), 'dialogue_delivery_invalid');
  });
  await check('whole reply UTF16 limits and valid scalar preservation', () => {
    for (const reply of ['x'.repeat(1600), '🙂'.repeat(800), 'x'.repeat(1598)+'🙂']) assert.equal(validate(answer(reply)).reply, reply);
    for (const reply of ['x'.repeat(1601), '🙂'.repeat(801), boundaryReply]) throwsCode(() => validate(answer(reply)), 'dialogue_reply_too_large');
    assert.equal(validate(answer('ok','🙂'.repeat(16))).delivery.language_hint, '🙂'.repeat(16));
    throwsCode(() => validate(answer('ok','🙂'.repeat(17))), 'dialogue_delivery_invalid');
  });
  await check('malformed surrogate refusal including escaped JSON', () => {
    for (const text of ['\ud800', '\udc00', 'a\ud800b', 'a\udc00b', '🙂\ud800', '\udc00🙂']) {
      assert.equal(malformed(text), true);
      throwsCode(() => validate(answer(text)), 'dialogue_reply_invalid');
      throwsCode(() => validate(JSON.stringify(answer(text))), 'dialogue_reply_invalid');
      throwsCode(() => validate(answer('ok',text)), 'dialogue_delivery_invalid');
    }
    assert.equal(malformed('हिंदी 🙂 𐀀'), false);
  });
  await check('English Hindi Roman Hinglish normalization preserved with versioned prompt hash', () => {
    for (const reply of ['Let us review this 🙂', 'पहले सवाल हल करें, फिर उत्तर जाँचें।', 'Pehle solve karo, phir review 🙂', '<assistant>Hello</assistant>  friend\n\n\nOkay']) {
      assert.deepEqual(validate(answer(reply)), old.validateDialogueOutput(answer(reply)));
      const input = { core: 'Approved persona', relationship: 'Private context', history: [{role:'user',content:reply}], message: reply };
      const actualPrompt=compile(input), priorPrompt=old.compileDialoguePrompt(input);
      assert.deepEqual(actualPrompt.messages.slice(1),priorPrompt.messages.slice(1));
      // v2 adds two policy paragraphs; Unicode parity still covers all original bytes.
      const originalSystem=actualPrompt.messages[0].content.split('\n\n').filter(row=>!row.startsWith('Turn language precedence:')&&!row.startsWith('Learner diagnosis shape:')).join('\n\n');
      assert.equal(originalSystem,priorPrompt.messages[0].content);
      assert.notEqual(actualPrompt.prompt_hash,priorPrompt.prompt_hash);
    }
  });
  await check('intentional prompt prefixes preserve UTF16 budgets and pairs', () => {
    assert.equal(clean('🙂',0),''); assert.equal(clean('🙂',1),''); assert.equal(clean('🙂',2),'🙂');
    for (const cap of [2000,4000,6000]) {
      assert.equal(clean('x'.repeat(cap-1)+'🙂',cap), 'x'.repeat(cap-1));
      assert.equal(clean('x'.repeat(cap-2)+'🙂',cap), 'x'.repeat(cap-2)+'🙂');
    }
    assert.equal(clean('a\ud800b\udc00🙂'),'ab🙂');
    const prompt = compile({core:'x'.repeat(5999)+'🙂', relationship:'y'.repeat(3999)+'🙂',history:Array.from({length:20},()=>({role:'assistant',content:'🙂'.repeat(1000)})),message:'ठीक 🙂'});
    assert.equal(prompt.messages[0].role,'system');
    assert.equal(prompt.messages.slice(1,-1).reduce((sum,row)=>sum+row.content.length,0),16000);
    assert.equal(prompt.messages.every(row=>!malformed(row.content)),true);
    assert.deepEqual(prompt.messages.at(-1),{role:'user',content:'ठीक 🙂'});
  });
  await check('direct compiler rejects current question whole', () => {
    const incumbentQuestion='x'.repeat(3999)+'🙂';
    assert.equal(malformed(old.compileDialoguePrompt({core:'persona',message:incumbentQuestion}).messages.at(-1).content),true);
    for (const message of ['x'.repeat(4001),'x'.repeat(3999)+'🙂']) throwsCode(()=>compile({core:'persona',message}),'dialogue_message_too_large');
    throwsCode(()=>compile({core:'persona',message:'x\ud800'}),'dialogue_message_invalid');
    const message='x'.repeat(3998)+'🙂'; assert.equal(compile({core:'persona',message}).messages.at(-1).content,message);
  });
  const db = async (sql,args) => {
    if (sql.includes('select recent.ordinal')) {events.push('history'); return [];}
    if (sql.includes('insert into vy_replica_dialogue_turn')) {events.push('turn'); written=args[4]; return [turn];}
    if (sql.includes('assistant_log as')) {events.push('finish'); assert.equal(args[3],generated.reply); return [turn];}
    if (sql.includes('update vy_replica_dialogue_turn set state=case')) {events.push('fail'); return [];}
    throw new Error('unexpected SQL in offline fixture');
  };
  const generator={ family:'azure', name:'synthetic-offline', version:'1', model:'none', generate:async ({prompt})=>{events.push('generate');captured=prompt;return {output:generated,usage:usageMeasured?{input_tokens:1,output_tokens:1}:undefined};} };
  const generate = message => service.generateOwnedDialogue(db,id,{replica_id:id,message,trace_id:'unicode_test'},generator);
  await check('actual service rejects malformed/oversized question before any scoped IO', async () => {
    for (const [message,code,status] of [['x'.repeat(3999)+'🙂','dialogue_message_too_large',413],['x'.repeat(4001),'dialogue_message_too_large',413],['bad\ud800','dialogue_message_invalid',400],['\udc00','dialogue_message_invalid',400]]) {
      events=[]; await assert.rejects(()=>generate(message),e=>e.code===code&&e.status===status); assert.deepEqual(events,[]);
    }
  });
  await check('actual service preserves accepted question/output and spend order', async () => {
    events=[]; generated=answer('🙂'.repeat(800)); const message='x'.repeat(3998)+'🙂';
    const result=await generate(message); assert.equal(captured.messages.at(-1).content,message);assert.equal(written,message);assert.equal(result.reply,generated.reply);assert.equal(result.billing_state,'settled');
    assert.deepEqual(events,['runtime','session','snapshot','history','turn','reserve','begin','runtime','generate','runtime','finish','settle']);
  });
  await check('actual service invalid output settles measured usage and keeps unknown usage uncertain', async () => {
    for (const [output,code] of [[answer(boundaryReply),'dialogue_reply_too_large'],[answer('bad\ud800'),'dialogue_reply_invalid'],[answer('ok','x'.repeat(31)+'🙂'),'dialogue_delivery_invalid']]) {
      events=[]; generated=output; usageMeasured=true; await rejectsCode(()=>generate('hello'),code);
      assert.deepEqual(events,['runtime','session','snapshot','history','turn','reserve','begin','runtime','generate','runtime','settle','fail']);
      events=[]; usageMeasured=false; await rejectsCode(()=>generate('hello'),code);
      assert.deepEqual(events,['runtime','session','snapshot','history','turn','reserve','begin','runtime','generate','runtime','uncertain','fail']);
    }
    usageMeasured=true;
  });
  await check('actual stored speech reader refuses corrupt answers and hints', async () => {
    for (const [output,code] of [[answer(boundaryReply),'dialogue_reply_too_large'],[answer('bad\ud800'),'dialogue_reply_invalid'],[answer('ok','\udc00'),'dialogue_delivery_invalid']]) await rejectsCode(()=>service.loadOwnedDialogueSpeech(async()=>[{turn_id:id,content:output.reply,delivery_plan:output.delivery}],id,{replica_id:id,dialogue_turn_id:id}),code);
    const result=await service.loadOwnedDialogueSpeech(async()=>[{turn_id:id,content:'ठीक 🙂',delivery_plan:delivery}],id,{replica_id:id,dialogue_turn_id:id});assert.equal(result.text,'ठीक 🙂');
  });
  await check('actual stored history reader refuses corruption without prefix success', async () => {
    const read = output => history.readOwnedDialogueHistory(async()=>[{runtime_active:true,session_id:id,pending:false,billing_candidates:[],exchanges:[{...turn,question:'?',reply:output.reply,delivery:output.delivery}]}],id,{replica_id:id,session_id:id});
    for (const output of [answer(boundaryReply),answer('bad\ud800'),answer('ok','\udc00')]) await rejectsCode(()=>read(output),'dialogue_history_invalid');
    assert.equal((await read(answer('ठीक 🙂'))).exchanges[0].answer.reply,'ठीक 🙂');
  });
  await check('production spend and continuity authority controls stay wired', () => {
    const path='api/_replica-dialogue.js';
    const next=readFileSync(new URL(path,root),'utf8').replaceAll('\r\n','\n');
    const block=text=>{
      const tree=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
      const fn=tree.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text==='generateOwnedDialogue');
      assert.ok(fn?.body,'dialogue generator body exists');
      const body=fn.body.getText(tree),start=body.indexOf('  const turn = await beginDialogueTurn');
      assert.ok(start>=0,'turn creation precedes spend'); return body.slice(start);
    };
    const verify = text => {
    const current=block(text);
    for (const required of [
      'generator, input, prompt, evidence',
      'await beginFoundrySpend(db, reservation);',
      'assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);',
      'try { await settleFoundrySpend(db, reservation, error?.measured_usage || measuredUsage); settled = true;',
      'if (providerStarted || spendBeginState === "attempted_unknown") await markFoundrySpendUncertain(db, reservation, error);',
      'can_voice: evidence.length === 0 && !runtime.capability.private_selection && !runtime.candidateBinding,',
    ]) assert.ok(current.includes(required), `missing dialogue authority contract: ${required}`);
    const order = [
      'await beginFoundrySpend(db, reservation);',
      'assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);',
      'const generated = await generator.generate({ prompt, signal });',
      'const finished = await finishDialogueTurn(db, ownerUserId, runtime, turn, output);',
    ].map(value => current.indexOf(value));
    assert.ok(order.every((value, index) => index === 0 || value > order[index - 1]), 'dialogue spend, authority, provider and finish order changed');
    const authority='assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);';
    assert.equal(current.split(authority).length-1,2,'question-bound authority is rechecked before and after the provider');
    assert.ok(current.lastIndexOf(authority)>current.indexOf('const generated = await generator.generate({ prompt, signal });'));
    assert.ok(current.lastIndexOf(authority)<current.indexOf('const finished = await finishDialogueTurn(db, ownerUserId, runtime, turn, output);'));
    };
    verify(next);
    const authority='assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);';
    for(const offset of [next.indexOf(authority),next.lastIndexOf(authority)]) {
      assert.ok(offset>=0);assert.throws(()=>verify(next.slice(0,offset)+authority.replace(', input.message);',');')+next.slice(offset+authority.length)));
    }
    for(const [before,after] of [
      ['await beginFoundrySpend(db, reservation);','await settleFoundrySpend(db, reservation);'],
      ['if (providerStarted || spendBeginState === "attempted_unknown") await markFoundrySpendUncertain','if (false) await markFoundrySpendUncertain'],
      ['can_voice: evidence.length === 0 && !runtime.capability.private_selection && !runtime.candidateBinding,','can_voice: true,'],
      ['generator, input, prompt, evidence);','generator, input, prompt);'],
    ]) {
      // The text-only path also meters spend. Mutate the voice generator that
      // this authority check inspects, rather than the first match in the file.
      const target=block(next); assert.ok(target.includes(before));
      assert.throws(()=>verify(next.replace(target,target.replace(before,after))));
    }
  });
  console.log(`${groups} dialogue Unicode groups passed. Offline seams; no SQL/model calls.`);
} finally { hooks.deregister(); delete globalThis.__dialogueUnicode; }
