import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {primarySelectionQuery} from '../../api/_replica-primary-selection.js';
import {advanceOwnedVoiceBuildIntent,requestOwnedVoiceGenomeBuild} from '../../api/_replica-build-intent.js';
import {splitSql} from '../../db/migrations/apply.mjs';
import {capturePrimarySelectionSql,IDS,intentRow} from './capture.mjs';

let checks=0;const ok=(name)=>console.log(`ok ${++checks} - ${name}`);
globalThis.fetch=()=>{throw Error('network forbidden in offline primary selection suite');};
const captured=await capturePrimarySelectionSql();
for(const [name,{sql}] of Object.entries(captured)) {
  assert.match(sql,/for update of (?:s|r) nowait/i);assert.match(sql,/for update of r nowait/i);
  assert.ok(sql.indexOf('for update of s nowait')<sql.indexOf('for update of r nowait'));
  ok(`${name}: actual SQL uses source then owner-scoped replica NOWAIT lock`);
}
assert.match(captured.promote.sql,/i\.expected_primary_selection_id=r\.primary_selection_id/);
assert.match(captured.promote.sql,/from intent_lock i/);assert.match(captured.promote.sql,/for update of i nowait/);
assert.match(captured.promote.sql,/gen_random_uuid\(\)/);ok('promotion checks current epoch and current queued intent before mutation');
assert.match(captured.create.sql,/source_id,'waiting',primary_selection_id from candidate/);
assert.doesNotMatch(captured.create.sql,/set\s+expected_primary_selection_id/i);
ok('new intent captures epoch exactly once; replay and supersession do not infer or rewrite it');
for(const name of ['withdraw','complete']){
  assert.match(captured[name].sql,/where snapshot_current/);
  assert.match(captured[name].sql,/primary_selection_snapshot_stale/);
  assert.equal((captured[name].sql.match(/update vy_replica r\b/g)||[]).length,1);
  ok(`${name}: stale snapshot refuses before mutation; one replica effect update`);
}
const busy=e=>e.code==='primary_voice_selection_busy'&&e.status===409&&e.retryable===true;
await assert.rejects(primarySelectionQuery(async()=>{throw{code:'55P03'};},'',[]),busy);
await assert.rejects(primarySelectionQuery(async()=>[{primary_selection_snapshot_stale:true,primary_selection_rows:[]}],'',[]),busy);
assert.deepEqual(await primarySelectionQuery(async()=>[{primary_selection_snapshot_stale:false,primary_selection_rows:[{source_id:IDS.source}]}],'',[]),[{source_id:IDS.source}]);
await assert.rejects(primarySelectionQuery(async()=>{throw{code:'08006'};},'',[]),e=>e.code==='08006');
ok('lock and stale-snapshot conflicts are named retryable409; unrelated failures remain failures');
let queued=0,sqls=[];
const legacy=await advanceOwnedVoiceBuildIntent(async(sql)=>{sqls.push(sql);
  if(sql.startsWith('select'))return[intentRow({expected_primary_selection_id:null})];
  return[intentRow({state:'failed',last_error_code:'primary_selection_snapshot_missing'})];
},IDS.owner,{replica_id:IDS.replica,build_intent_id:IDS.intent},{queue:async()=>{queued++;}});
assert.equal(legacy.last_error_code,'primary_selection_snapshot_missing');assert.equal(queued,0);
assert.equal(sqls.length,2);assert.doesNotMatch(sqls.join('\n'),/promote_after_build/);
ok('historical intent refuses with named reissue reason before queue or promotion');
await assert.rejects(advanceOwnedVoiceBuildIntent(async(sql)=>{
  if(sql.startsWith('select'))return[intentRow()];throw{code:'55P03'};
},IDS.owner,{replica_id:IDS.replica,build_intent_id:IDS.intent}),busy);
ok('busy promotion preserves queued intent instead of demoting it to unbound waiting');
const migration=await readFile(new URL('../../db/migrations/140_primary_voice_selection_epoch.sql',import.meta.url),'utf8');
assert.equal(splitSql(migration).length,2);assert.doesNotMatch(migration,/\bDO\s+\$|update vy_replica_voice_build_intent/i);
assert.match(migration,/primary_selection_id uuid not null default gen_random_uuid\(\)/);
assert.match(migration,/expected_primary_selection_id uuid;/);
const schema=await readFile(new URL('../../db/schema.sql',import.meta.url),'utf8');
for(const statement of splitSql(migration))assert.ok(schema.includes(statement.replace(/^--[^\n]*\n/gm,'' ).trim()) || schema.includes(statement.match(/alter table[\s\S]*/i)?.[0]));
ok('two idempotent mirrored statements; absent primaries have an epoch, legacy intents stay NULL');
const old=JSON.parse(await readFile(new URL('./fixtures/old-promotion.json',import.meta.url),'utf8'));
assert.doesNotMatch(old.sql,/expected_primary_selection_id|primary_selection_id|for update/i);
assert.match(old.sql,/on conflict \(replica_id\) do update/);
assert.notEqual(old.sql,captured.promote.sql);ok('retained exact base query is a real unconditional-overwrite negative control');
console.log(`${checks} primary selection CAS checks passed; SQL execution is a separate opt-in proof.`);
