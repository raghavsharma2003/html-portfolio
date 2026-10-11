import { randomUUID } from 'node:crypto';
import {canonicalJson} from './_provenance/contracts.js';
import {validCommunication} from './_learner-communication-contract.js';
import {roomMemoryAuthority,ROOM_MEMORY_RECLASSIFY_READ_SQL,ROOM_MEMORY_RECLASSIFY_COMMIT_SQL,
 ROOM_MEMORY_EXTRACTION_SYSTEM,ROOM_MEMORY_RESPONSE_FORMAT,ROOM_MEMORY_MAX_OUTPUT_TOKENS,
 validateRoomMemoryProposal} from './_room-memory-authority.js';
import {runMeteredRoomMemoryReclassification} from './_room-memory-consolidation.js';

export function correctedCommunication(output,snapshot) {
 if(!validCommunication(snapshot.fact_communication)||snapshot.fact_communication.state!=='unclassified')
  throw new Error('room_memory_reclassification_source_invalid');
 const proposal=validateRoomMemoryProposal(output,[{id:snapshot.source_id,content:snapshot.source_content}]);
 const fields={language:null,script:null,brevity:null};
 for(const fact of proposal)if(fact.communication)for(const field of Object.keys(fields)) {
  if(fact.communication[field]!==null)fields[field]=fact.communication[field];
 }
 const scope=Object.fromEntries(Object.keys(fields).map(field=>[field,snapshot.fact_communication.scope[field]||fields[field]!==null]));
 const communication={version:1,state:Object.values(fields).some(value=>value!==null)?'classified':'no_preference',scope,...fields};
 if(!validCommunication(communication))throw new Error('room_memory_proposal_invalid');
 return communication;
}

/** One synchronous, metered classification attempt for an already stored
 * correction. No queue claim, duplicate source log, new episode or retry loop. */
export async function reclassifyRoomMemory(db,follower,factId,{env=process.env,llm,fetchImpl=globalThis.fetch,runId=randomUUID()}={}) {
 const fact=String(factId??'');
 if(!/^[1-9][0-9]{0,18}$/.test(fact)||BigInt(fact)>9223372036854775807n)
  throw new Error('room_memory_fact_unavailable');
 const authority=roomMemoryAuthority(follower);
 const candidate={follower_id:authority[0],memory_epoch:authority[1],agent_id:authority[2],person_id:authority[3],fact_id:fact};
 const countedLlm=llm??(await import('./consolidate.js')).llm;
 return runMeteredRoomMemoryReclassification(candidate,{
  queryFn:db,llm:countedLlm,runId,env,fetchImpl,
  readSnapshot:(query,current)=>query(ROOM_MEMORY_RECLASSIFY_READ_SQL,[...roomMemoryAuthority(current),current.fact_id]),
  prepareRequest:snapshot=>({
   messages:[{role:'system',content:ROOM_MEMORY_EXTRACTION_SYSTEM},
    {role:'user',content:JSON.stringify([{id:snapshot.source_id,content:snapshot.source_content}])}],
   responseFormat:ROOM_MEMORY_RESPONSE_FORMAT,maxTokens:ROOM_MEMORY_MAX_OUTPUT_TOKENS,
  }),
  validateProposal:correctedCommunication,
  commitProposal:async(communication,snapshot)=>{
   const rows=await db(ROOM_MEMORY_RECLASSIFY_COMMIT_SQL,[...authority,snapshot.fact_id,snapshot.fact_body,
    JSON.stringify(snapshot.fact_communication),snapshot.episode_id,snapshot.source_id,JSON.stringify(communication)]);
   if(rows.length!==1)return{classification:'unconfirmed',skipped:'source_changed'};
   if(!validCommunication(rows[0].communication)||rows[0].communication.state==='unclassified')
    throw new Error('room_memory_reclassification_ack_invalid');
   if(String(rows[0].fact_id)!==snapshot.fact_id||rows[0].body!==snapshot.fact_body
     ||canonicalJson(rows[0].communication)!==canonicalJson(communication))
    throw new Error('room_memory_reclassification_ack_invalid');
   return{classification:rows[0].communication.state,fact:{id:String(rows[0].fact_id),body:String(rows[0].body)}};
  },
 });
}
