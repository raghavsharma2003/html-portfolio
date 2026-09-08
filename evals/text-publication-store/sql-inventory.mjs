// Builds SQL and synthetic typed parameters only. Never opens a connection,
// executes SQL or imports the production DB/config module.
import * as store from '../../api/_text-publication-store.js';
import * as source from '../../api/_text-publication-source.js';
import {fixture,id,owner,rid,pid,visitor,requestId,h,env} from './fixtures.mjs';
import {sha256Hex} from '../../api/_provenance/contracts.js';
import {PUBLICATION_MEMORY_POLICY_HASH} from '../../api/_text-publication-memory.js';

export async function textPublicationSqlInventory(){
 const f=fixture();await f.publish();const joined=await f.join(),input={public_id:pid,session_token:joined.session_token,request_id:requestId,question:'What is the period?'};
 await store.admitTextPublicationRequest(f.db,visitor,input,{env});
 const provider={family:'azure',name:'azure-foundry-structured-output',version:'fixture-v1',model:'offline-fixture',prompt_hash:'a'.repeat(64)};
 const reservation={reservation_id:id(40),budget_id:'publication-offline-fixture',state:'reserved',reserved_microusd:500,request_hash:h({operation:'dialogue',request_key:'text-publication:'+requestId,provider_family:provider.family,provider_name:provider.name,provider_version:provider.version,model:provider.model})};
 const claim=await store.claimTextPublicationRequest(f.db,visitor,{...input,provider,reservation},{env});
 await store.completeTextPublicationRequest(f.db,visitor,{...input,dispatch_token:claim.dispatch_token,answer:'2 seconds.',raw_output:{reply:'2 seconds.'},gate:{gated:true,finding_count:0},billing_state:'settled'},{env});
 const explicit={TEXT_PUBLICATION_ACCOUNT_FORGET_SQL:[visitor],TEXT_PUBLICATION_CLEANUP_SQL:[[pid],null],TEXT_PUBLICATION_EXPIRE_SQL:[50],TEXT_PUBLICATION_FAIL_SQL:[pid,visitor,requestId,null,'blocked','not_started','text_publication_fixture'],TEXT_PUBLICATION_FORGET_SQL:[pid,visitor],TEXT_PUBLICATION_UNPUBLISH_SQL:[rid,owner,pid],TEXT_PUBLICATION_WITHDRAWN_ACCOUNT_SQL:[rid,owner]};
 const auth=f.calls.find(c=>c.sql===store.TEXT_PUBLICATION_AUTHORIZED_READ_SQL).args.slice(0,12);
 Object.assign(explicit,{
  TEXT_PUBLICATION_MEMORY_SCHEMA_SQL:[],
  TEXT_PUBLICATION_MEMORY_SETTINGS_SQL:[pid,visitor],
  TEXT_PUBLICATION_JOIN_V2_SQL:[...f.calls.find(c=>c.sql===store.TEXT_PUBLICATION_JOIN_SQL).args,'0',true,PUBLICATION_MEMORY_POLICY_HASH],
  TEXT_PUBLICATION_SET_MEMORY_SQL:[...auth,'0',false,PUBLICATION_MEMORY_POLICY_HASH],
  TEXT_PUBLICATION_MEMORY_HISTORY_SQL:auth,
 });
 return Object.entries({...store,...source}).filter(([name,sql])=>name.endsWith('_SQL')&&typeof sql==='string').map(([name,sql])=>{
  const params=explicit[name]||f.calls.find(c=>c.sql===sql)?.args;if(!params)throw Error('SQL parameter sample missing: '+name);
  return {name,sha256:sha256Hex(sql),sql,params,scope:'synthetic parameters; never executed against SQL'};
 });
}
