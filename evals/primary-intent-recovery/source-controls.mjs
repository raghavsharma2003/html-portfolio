import assert from 'node:assert/strict';
import ts from 'typescript';

// Execute the current component's actual admission function without mounting a
// UI or opening a server. Mounted tests separately cover rendering and polling.
export async function checkRecoveryGuards(source) {
  const tree=ts.createSourceFile('CloneExperience.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  function namedFunction(name) {
    const matches=[];
    function visit(node) {
      if(ts.isFunctionDeclaration(node)&&node.name?.text===name)matches.push(node);
      ts.forEachChild(node,visit);
    }
    visit(tree);assert.equal(matches.length,1,`${name}: exact actual function`);
    return matches[0].getText(tree);
  }
  const helpers=['voiceSagaKey','readVoiceSaga','activeEnrollmentConsent'].map(namedFunction).join('\n');
  const actual=namedFunction('reissueSavedRecording');
  const handlerTree=ts.createSourceFile('handler.ts',actual,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const awaited=[];
  function collectAwaits(node) {
    if(ts.isAwaitExpression(node))awaited.push(node.expression.getText(handlerTree));
    ts.forEachChild(node,collectAwaits);
  }
  collectAwaits(handlerTree);
  assert.deepEqual(awaited,['onReadVoiceReissue()'],
    'mounted completion witness requires the admission branch after the fresh read to remain synchronous');
  const replicaId='10000000-0000-4000-8000-000000000001';
  const sourceId='30000000-0000-4000-8000-000000000003';
  const oldId='50000000-0000-4000-8000-000000000005';
  const nextId='60000000-0000-4000-8000-000000000006';
  const key=`vyakti:experience:voice-saga:v1:${replicaId}`;
  const seed={uploadIntentId:'40000000-0000-4000-8000-000000000004',buildIntentId:oldId,sourceId,language:'hinglish'};
  const frozenNow=Date.parse('2026-09-27T00:00:00.000Z');
  class FixtureDate extends Date {static now(){return frozenNow;}}

  async function execute(body,change) {
    const replica={replica_id:replicaId,lifecycle:'enrolling',policy_version:'replica-self-v1'};
    const rows=[{source_id:sourceId,replica_id:replicaId,kind:'audio',capture_mode:'upload',state:'ready',contains_third_parties:false}];
    const grants=['capture','transcription','storage'].map(scope=>({scope,replica_id:replicaId,policy_version:replica.policy_version,revoked_at:null,expires_at:'2027-09-01T00:00:00.000Z'}));
    const fresh={replica,sources:rows,consents:grants};
    let release;
    const response=new Promise(resolve=>{release=resolve;});
    const onReadVoiceReissue=()=>response;
    const current={identity:'owner@example.test',accessToken:'old-token',selected:replica,sources:rows,consents:grants,onReadVoiceReissue};
    const stored=new Map([[key,JSON.stringify(seed)]]);
    const writes=[];const sagas=[];let generatedIds=0;
    const refs={reissueMounted:{current:true},reissueOperation:{current:0},reissueCurrent:{current}};
    const deps={
      ...refs,identity:current.identity,accessToken:current.accessToken,selected:replica,
      reissueLocked:{current:false},selectionReissue:true,voiceSaga:seed,onReadVoiceReissue,
      retryRef:{current:null},setReissueBusy(){},setReissueError(){},setVoiceBuildIntent(){},
      setVoiceSaga(value){sagas.push(value);},crypto:{randomUUID(){generatedIds++;return nextId;}},Date:FixtureDate,
      window:{localStorage:{getItem:k=>stored.get(k)??null,setItem(k,v){writes.push([k,v]);stored.set(k,v);}}},
      VOICE_SAGA_KEY:'vyakti:experience:voice-saga:v1',REQUIRED_SCOPES:['capture','transcription','storage'],LANGUAGE_HINT:{hinglish:'hi-latn'},
    };
    const js=ts.transpileModule(`${helpers}\n${body}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
    const handler=new Function(...Object.keys(deps),`${js};return reissueSavedRecording;`)(...Object.values(deps));
    const pending=handler();
    change?.({current,refs,fresh});
    release(fresh);await pending;
    return {writes,sagas,generatedIds,saved:JSON.parse(stored.get(key))};
  }

  function assertPreserved(result,label) {
    assert.equal(result.generatedIds,0,`${label}: no fresh intent identifier`);
    assert.equal(result.writes.length,0,`${label}: no durable intent write`);
    assert.equal(result.sagas.length,0,`${label}: no new polling saga`);
    assert.deepEqual(result.saved,seed,`${label}: saved intent retained`);
  }
  const success=await execute(actual);
  assert.equal(success.generatedIds,1);
  assert.equal(success.writes.length,1);assert.equal(success.sagas.length,1);
  assert.equal(success.saved.buildIntentId,nextId);
  assert.equal(success.saved.sourceId,sourceId);
  let checks=1;
  const currentEligibility='!eligible(current.selected, current.sources, current.consents)';
  const freshEligibility='!eligible(fresh.replica, fresh.sources, fresh.consents)';
  const cases=[
    ['token',({current})=>{current.accessToken='changed';},'current.accessToken === accessToken','true'],
    ['identity',({current})=>{current.identity='another@example.test';},'current.identity === identity','true'],
    ['replica',({current})=>{current.selected={...current.selected,replica_id:'foreign'};},null,null],
    ['callback',({current})=>{current.onReadVoiceReissue=()=>Promise.resolve({});},'current.onReadVoiceReissue === onReadVoiceReissue','true'],
    ['operation',({refs})=>{refs.reissueOperation.current++;},'reissueOperation.current === operation','true'],
    ['unmount',({refs})=>{refs.reissueMounted.current=false;},'reissueMounted.current','true'],
    ['deleted',({current})=>{current.sources=[];},currentEligibility,'false'],
    ['consent',({current})=>{current.consents=[];},currentEligibility,'false'],
    ['fresh-deleted',({fresh})=>{fresh.sources=[];},freshEligibility,'false'],
    ['fresh-consent',({fresh})=>{fresh.consents=[];},freshEligibility,'false'],
  ];
  for(const [label,change,needle,replacement] of cases) {
    assertPreserved(await execute(actual,change),label);checks++;
    if(needle) {
      assert.equal(actual.split(needle).length,2,`${label}: mutation target is unique`);
      const mutant=await execute(actual.replace(needle,replacement),change);
      assert.equal(mutant.saved.buildIntentId,nextId,`${label}: removing actual guard admits stale intent`);
      assert.throws(()=>assertPreserved(mutant,label),assert.AssertionError);checks++;
    }
  }
  return checks;
}
