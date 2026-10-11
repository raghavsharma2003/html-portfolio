import {randomUUID} from 'node:crypto';
// Statement-specific model for creator source consent and immutable storage.
// The production handlers and writer token functions remain the callers.
export function contextStorageFixture(state, sql, p) {
 const has=s=>sql.includes(s);
 state.sourceConsents ||= []; state.canonicalSources ||= []; state.sourceWriters ||= [];
 const own=(rid,uid)=>state.replicas.find(r=>r.replica_id===rid&&r.owner_user_id===uid&&!['revoked','purging'].includes(r.lifecycle));
 const allowed=(rid,uid)=>{const r=own(rid,uid);return r&&['capture','storage'].every(scope=>state.sourceConsents.some(c=>c.replica_id===rid&&c.owner_user_id===uid&&c.scope===scope&&c.policy_version===r.policy_version&&!c.revoked_at&&(!c.expires_at||Date.parse(c.expires_at)>Date.now())));};
 if(has("'consent.grant'")&&has('insert into vy_replica_consent')){
  const [rid,uid,scopes,hash,metadata,at,policy]=p;const r=own(rid,uid);if(!r||r.policy_version!==policy)return [];
  state.sourceConsents.filter(c=>c.replica_id===rid&&c.owner_user_id===uid&&scopes.includes(c.scope)&&!c.revoked_at).forEach(c=>c.revoked_at=at);
  const rows=scopes.map(scope=>({consent_id:randomUUID(),replica_id:rid,owner_user_id:uid,scope,method:'account_attestation',policy_version:policy,receipt_hash:hash,metadata:JSON.parse(metadata),granted_at:at,expires_at:new Date(Date.parse(at)+365*86400000).toISOString(),revoked_at:null}));state.sourceConsents.push(...rows);return rows;
 }
 if(has('from vy_replica_consent')&&!has('insert into')&&has('order by')&&!has('vy_replica_source')&&!has('vy_replica r'))return state.sourceConsents.filter(c=>c.replica_id===p[0]&&c.owner_user_id===p[1]);
 if(has('insert into vy_replica_source\n')){
  const [rid,uid,sid,kind,bucket,path,mime,bytes,sha,third,provenance,capture]=p;
  if(!allowed(rid,uid)||state.canonicalSources.filter(s=>s.owner_user_id===uid&&s.state==='pending_upload').length>=8)return [];
  const row={source_id:sid,replica_id:rid,owner_user_id:uid,kind,storage_bucket:bucket,object_path:path,mime,byte_size:bytes,sha256:sha,contains_third_parties:third,provenance:JSON.parse(provenance),capture_mode:capture,state:'pending_upload',purpose:p[14],intent_replayed:false};state.canonicalSources.push(row);return [{...row}];
 }
 if(has('insert into vy_replica_source_storage_writer')&&has("'context_source'")){
  const [sid,rid,uid,wid,hash,horizon]=p;const s=state.canonicalSources.find(s=>s.source_id===sid&&s.replica_id===rid&&s.owner_user_id===uid&&s.state==='pending_upload'&&s.provenance.purpose==='context_item');if(!s||!own(rid,uid))return [];
  const row={writer_id:wid,source_id:sid,replica_id:rid,owner_user_id:uid,purpose:'context_source',token_hash:hash,state:'active',storage_write_not_after:new Date(Date.now()+horizon).toISOString()};state.sourceWriters.push(row);return [{...row}];
 }
 if(has('update vy_replica_source_storage_writer w')){
  const [wid,sid,rid,uid,purpose,hash]=p;const w=state.sourceWriters.find(w=>w.writer_id===wid&&w.source_id===sid&&w.replica_id===rid&&w.owner_user_id===uid&&w.purpose===purpose&&w.token_hash===hash&&w.state==='active');if(!w)return [];
  if(has("set state='released'")){w.state='released';return [{writer_id:wid}];}
  const s=state.canonicalSources.find(s=>s.source_id===sid&&s.replica_id===rid&&s.owner_user_id===uid&&s.state==='pending_upload');if(!s||!own(rid,uid)||Date.parse(w.storage_write_not_after)<=Date.now())return [];
  w.storage_write_not_after=new Date(Math.max(Date.parse(w.storage_write_not_after),Date.now()+p[6])).toISOString();return [{...w}];
 }
 if(has("'context_source.finalize'")){
  const [rid,uid,sid,status,reason,objectId,sha]=p;const s=state.canonicalSources.find(s=>s.source_id===sid&&s.replica_id===rid&&s.owner_user_id===uid&&s.state==='pending_upload'&&s.provenance.purpose==='context_item'&&s.sha256===sha);if(!s||!allowed(rid,uid))return [];
  Object.assign(s,{state:status,rejection_code:reason,provenance:{...s.provenance,storage_object_id:objectId,sha256_status:status==='ready'?'server_verified':'verification_failed'}});return [{...s}];
 }
 if(has('from vy_replica_source s')&&has("s.state = 'pending_upload'")&&has('left join vy_replica_voice_reference')){
  const [rid,uid,sid]=p;return allowed(rid,uid)?state.canonicalSources.filter(s=>s.replica_id===rid&&s.owner_user_id===uid&&s.source_id===sid&&s.state==='pending_upload').map(s=>({...s})):[];
 }
 return undefined;
}
