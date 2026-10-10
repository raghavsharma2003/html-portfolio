import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
import * as store from '../../api/_comparison-reference.js';
import {memoryFixture,authorize,uid} from './fixtures.mjs';
export async function prepareComparisonReferenceSql(){
 const f=memoryFixture(),input=await authorize(f);
 await store.readComparisonReference(f.db,uid(2),uid(1),uid(10));
 await store.auditionComparisonReference(f.db,uid(2),input,f.readPrivate);
 await store.confirmComparisonReference(f.db,uid(2),{...input,confirm_this_is_my_voice:true});
 await store.withdrawComparisonReference(f.db,uid(2),input);
 const names=new Map(Object.entries(store).filter(([name,value])=>name.endsWith('_SQL')&&typeof value==='string').map(([name,sql])=>[sql,name]));
 const seen=new Set(),cases=[];for(const {sql,p}of f.state.calls){if(seen.has(sql))continue;seen.add(sql);cases.push({name:names.get(sql),sql,params:p,sha256:sha256Hex(sql)});}
 if(cases.length!==7)throw Error('comparison_sql_inventory_incomplete');
 return {execution:'not-run',database_guard:'vyakti_expert_integration_20260906',cases,
  migration:{path:'db/migrations/145_private_comparison_reference.sql',sql:readFileSync(new URL('../../db/migrations/145_private_comparison_reference.sql',import.meta.url),'utf8')},
  limits:'Synthetic caller parameter capture only. Root must EXPLAIN, execute scoped fixtures, prove epoch refusal and cleanup. No database client or credentials are imported.'};
}
export function withoutComparisonConfirmationEpoch(sql){
 const old='and h.audition_response_at is not null and h.observed_epoch=c.observed_epoch and c.observed_epoch=$6::bigint';
 const current='and r.reference_authority_epoch=$6::bigint';
 if(sql.split(old).length!==2||sql.split(current).length!==2)throw Error('comparison_epoch_negative_target_invalid');
 return sql.replace(old,'and h.audition_response_at is not null and $6::bigint is not null').replace(current,'and $6::bigint is not null');
}
export async function prepareComparisonErasureSql(){
 const [{completeReplicaErasure},{scopedQuery}]=await Promise.all([import('../../api/_replica-full-erasure.js'),import('../../api/_creator-export.js')]);
 const cases=[],exported=scopedQuery({table:'vy_replica_comparison_reference',scope:'replica'},{replicaIds:[uid(1)],ownerUserId:uid(2)});
 cases.push({name:'comparison_owner_export',...exported,sha256:sha256Hex(exported.sql)});
 await completeReplicaErasure(async(sql,params)=>{cases.push({name:'comparison_owner_erasure',sql,params,sha256:sha256Hex(sql)});return[{receipt_id:uid(99)}];},
  {jobId:uid(90),replicaId:uid(1),ownerUserId:uid(2),leaseToken:'synthetic-comparison-erasure-lease'},
  {replicaIdHash:'a'.repeat(64),ownerUserHash:'b'.repeat(64),deletedClasses:['comparison_reference'],backupExpiresAt:'2099-01-01T00:00:00.000Z',nonce:'synthetic-comparison-erasure-nonce',erasureRequestHash:'c'.repeat(64)});
 if(cases.length!==2||!cases[1].sql.includes('comparison_references as (delete from vy_replica_comparison_reference'))throw Error('comparison_erasure_capture_invalid');
 return cases;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const v=await prepareComparisonReferenceSql();console.log(JSON.stringify({execution:v.execution,queries:v.cases.map(({name,sha256})=>({name,sha256})),migration_sha256:sha256Hex(v.migration.sql)},null,2));
}
