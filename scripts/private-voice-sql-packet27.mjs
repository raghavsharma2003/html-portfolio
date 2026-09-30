// Offline packet only. Importing or running this file cannot contact a DB.
// The EXPLAIN packet is synthetic parameter data, never retained owner data.
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {splitSql} from '../db/migrations/apply.mjs';
import * as admission from '../api/_private-voice-store.js';
import {SQL as execution} from '../services/private-voice/store.mjs';
import {LIFE_SQL as lifecycle} from '../services/private-voice/lifecycle.mjs';
import {PRIVATE_LEDGER_SQL as ledger} from '../api/_provenance/private-voice-ledger.js';
import {revokeDeletingPrivateVoice} from '../api/_private-voice-erasure.js';
import {leaseNextSourceErasure,renewSourceErasureLease,completeSourceErasure} from '../api/_replica-source-erasure.js';
import {leaseNextReplicaErasure,completeReplicaErasure,prepareReplicaErasures,createReplicaErasureReceipt} from '../api/_replica-full-erasure.js';
const root=fileURLToPath(new URL('..',import.meta.url));
const id=n=>`${String(n).repeat(8)}-${String(n).repeat(4)}-4${String(n).repeat(3)}-8${String(n).repeat(3)}-${String(n).repeat(12)}`;
const [owner,replica,source,artifact,run,window,child]=[1,2,3,4,5,6,7].map(id);
const hash='a'.repeat(64),token='synthetic-private-voice-explain-token-over-thirty-two-bytes';
const authority=[replica,owner,source,artifact,run,hash];
const sha=v=>createHash('sha256').update(v).digest('hex');
export async function privateVoiceSqlPacket(){
 const statements=[];
 const add=(name,query,params=[])=>{const arity=Math.max(0,...[...query.matchAll(/\$(\d+)\b/g)].map(m=>Number(m[1])));
  if(arity!==params.length)throw Error(`SQL packet arity ${name}: ${arity}/${params.length}`);
  statements.push({name,query,params,sha256:sha(query)});};
 const config=admission.privateVoiceSampleConfig(),snapshot={owner_user_id:owner,replica_id:replica,source_id:source,artifact_id:artifact,
  artifact_sha256:hash,storage_bucket:'synthetic-private',object_path:`${owner}/${replica}/${source}/derived/reference.wav`,byte_size:240044,duration_ms:5000,mime:'audio/wav'};
 add('admission.candidates',admission.PRIVATE_VOICE_CANDIDATES_SQL,[replica,owner,source,artifact]);
 add('admission.recent',admission.PRIVATE_VOICE_RECENT_SQL,[replica,owner]);
 add('admission.read',admission.PRIVATE_VOICE_READ_SQL,[replica,owner,run]);
 add('admission.admit',admission.PRIVATE_VOICE_ADMIT_SQL,[replica,owner,source,artifact,run,hash,hash,JSON.stringify(snapshot),'{}',hash,JSON.stringify(config),hash,'2030-01-01T00:00:00Z']);
 add('admission.revoke',admission.PRIVATE_VOICE_REVOKE_SQL,[replica,owner,run]);
 const runtimeSource=readFileSync(resolve(root,'services/private-voice/runtime.mjs'),'utf8');
 const windowRead=runtimeSource.match(/db\('(select window_id from vy_private_voice_run[^']+)'/);
 if(!windowRead)throw Error('private_runtime_window_statement_changed');
 add('runtime.revokeWindow',windowRead[1],[replica,owner,run]);
 const params={claim:[replica,owner,run,hash],start:authority,check:authority,renew:authority,write:authority,
  settle:[...authority,hash,'{}','{}'],fail:[replica,owner,run,hash,'private_voice_synthetic'],stale:[replica,owner,run],
  rate:[replica,owner,source,artifact,run,'{}'],cleanup:[],deleted:[run,owner,`${owner}/${replica}/${source}/derived/private-voice/${run}.wav`]};
 for(const [name,sql] of Object.entries(execution))add(`execution.${name}`,sql,params[name]);
 const plan={app_id:'/synthetic',revision_name:'synthetic',configuration_sha256:hash,template_sha256:hash,contract_sha256:hash,
  broker_origin:'https://synthetic.azurecontainerapps.io',runtime_origin:'https://synthetic.internal.azurecontainerapps.io'};
 const lp={bind:[...authority,window,'gpu-synthetic',hash,JSON.stringify(plan),JSON.stringify([{child_id:child,ordinal:0,operation:'synthesize',body_sha256:hash,consumed_at:null}])],
  lookup:[window],activate:authority,dispatch:authority,consume:[...authority,child,'synthesize',hash,plan.broker_origin,plan.runtime_origin,hash],heartbeat:[plan.app_id,hash,hash,hash]};
 for(const [name,sql] of Object.entries(lifecycle))add(`lifecycle.${name}`,sql,lp[name]);
 const pp={manifest:[...authority,'{}'],open:[...authority,'{}'],append:[...authority,JSON.stringify({sequence:0})],seal:[...authority,'{}','{}',0],abort:authority};
 for(const [name,sql] of Object.entries(ledger))add(`protection.${name}`,sql,pp[name]);
 const capture=name=>async(sql,params=[])=>{add(name,sql,params);
  if(sql.includes("to_regclass('public.vy_private_voice_run')"))return [{private_voice_present:true}];
  if(name==='source.complete')return [{source_id:source}];
  if(name==='source.renew')return [{source_id:source}];
  if(name==='replica.complete')return [{receipt_id:run}];
  return [];};
 await revokeDeletingPrivateVoice(capture('private.revokeDeleting'));
 await leaseNextSourceErasure(capture('source.claim'),{token,leaseMs:240000});
 const sourceLease={source:{sourceId:source,replicaId:replica,ownerUserId:owner},leaseToken:token};
 await renewSourceErasureLease(capture('source.renew'),sourceLease,{leaseMs:240000});
 await completeSourceErasure(capture('source.complete'),sourceLease);
 await prepareReplicaErasures(capture('replica.prepare'),{limit:1});
 await leaseNextReplicaErasure(capture('replica.claim'),{token,leaseMs:180000});
 const receipt=createReplicaErasureReceipt(replica,owner,{REPLICA_ERASURE_RECEIPT_KEY_B64:Buffer.alloc(32,1).toString('base64'),REPLICA_BACKUP_RETENTION_DAYS:'30'},
  {nonce:hash,erasureRequestId:run,nowMs:Date.parse('2030-01-01T00:00:00Z')});
 await completeReplicaErasure(capture('replica.complete'),{jobId:run,replicaId:replica,ownerUserId:owner,leaseToken:token,attempt:1,agentId:null},receipt);
 const seen=new Set(),unique=statements.filter(row=>{const key=JSON.stringify([row.query,row.params]);if(seen.has(key))return false;seen.add(key);return true;});
 const path='db/migrations/172_private_voice_run.sql',raw=readFileSync(resolve(root,path),'utf8');
 const migration=splitSql(raw).map((query,index)=>({name:`172.${index+1}`,query:query.trim(),params:[],sha256:sha(query.trim())}));
 if(migration.length!==3||migration.some(s=>!/^(?:--[^\n]*\n\s*)*create (?:table|index) if not exists /i.test(s.query)))throw Error('private_voice_migration_packet_changed');
 return {schema:'private-voice-sql-packet27/v1',network_calls:0,statements_applied:0,migration:{path,sha256:sha(raw),statements:migration},
  explain:{mode:'EXPLAIN (FORMAT JSON), never ANALYZE',synthetic_parameters:true,requires_applied_migration:172,statements:unique}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const output=process.argv[2];if(!output||!resolve(output).split(/[\\/]/).includes('scratchpad'))throw Error('scratchpad_output_required');
 const packet=await privateVoiceSqlPacket();mkdirSync(dirname(resolve(output)),{recursive:true});writeFileSync(output,JSON.stringify(packet,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify({packet:resolve(output),migration_statements:packet.migration.statements.length,explain_statements:packet.explain.statements.length,network_calls:0,statements_applied:0}));
}
