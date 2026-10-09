// Explicit SQL stub, not a PostgreSQL parser or concurrency proof.
import * as store from '../../api/_text-publication-store.js';
import * as source from '../../api/_text-publication-source.js';
import {PUBLICATION_MEMORY_POLICY_HASH} from '../../api/_text-publication-memory.js';
import {sha256Hex} from '../../api/_provenance/contracts.js';
import {fixture,owner,rid,pid,visitor,env} from './fixtures.mjs';

export const personDraft=()=>({sheetKind:'person',name:'Asha',identityWho:'Independent ceramic artist',identityLife:'Works in a shared pottery studio',
 lifeTexture:'Morning sketchbook; evening walks',tasteTopics:'Handmade cups',curiosityTopics:'Glaze chemistry',personLine:'Ceramic artist and curious maker',
 personValues:['patience','plain speaking','care'],personNeverSay:['No promises about firing results'],personTalk:{register:'casual',scriptBaseline:'roman-hinglish',codeSwitchNote:'Everyday Hindi; technical terms in English'},
 credentialFacts:'UNRELEASED_CREDENTIAL',exGreeting:'UNRELEASED_SAMPLE',privateNotes:'UNRELEASED_NOTE',subjectDomain:'maths'});

export function personFixture({memory=false}={}){
 const f=fixture();f.row.sheet=personDraft();const captures=[];
 const db=async(sql,args)=>{
  captures.push({sql,args});
  if(sql===source.PRIVATE_TEXT_CHOICES_SQL){const rows=await f.db(sql,args);rows[0].drafts[0]={...rows[0].drafts[0],name:f.row.sheet.name,sheet_kind:'person'};return rows;}
  if(sql===store.TEXT_PUBLICATION_MEMORY_SCHEMA_SQL)return [{available:true}];
  if(sql===store.TEXT_PUBLICATION_JOIN_V2_SQL){
   const v={publication_id:pid,replica_id:rid,owner_user_id:owner,visitor_user_id:args[9],session_epoch:0,question_count:0,
    admission:JSON.parse(args[10]),admission_hash:args[11],expires_at:args[12],memory_enabled:args[14],memory_epoch:args[14]?'1':'0',memory_policy_hash:args[15]};
   f.visitors.set(args[9],v);return [structuredClone(v)];
  }
  if(sql===store.TEXT_PUBLICATION_MEMORY_HISTORY_SQL)return [{publication_id:pid,exchanges:[...f.requests.values()].filter(r=>r.visitor_user_id===args[9]&&r.state==='complete'&&r.memory_epoch===f.visitors.get(args[9])?.memory_epoch).slice(-3)}];
  const rows=await f.db(sql,args);
  if(sql===store.TEXT_PUBLICATION_PUBLISH_SQL&&rows.length)f.pubs.get(pid).version=[store.TEXT_PUBLICATION_V2_STATEMENT_SET,store.PERSON_PUBLICATION_V2_STATEMENT_SET].includes(JSON.parse(args[11]).scope)?2:1;
  if(sql===store.TEXT_PUBLICATION_ADMIT_SQL&&rows.length)Object.assign(f.requests.get(args[12]),{memory_epoch:args[16],memory_refs:JSON.parse(args[17]),memory_refs_hash:args[18]});
  return rows;
 };
 const readiness=()=>store.readTextPublicationReadiness(db,owner,{...f.selection,allow_memory:memory},{env});
 const publish=async()=>{const r=await readiness();return store.publishTextPublication(db,owner,{...f.selection,publication_id:pid,expected_review_hash:r.selected.review_hash,statement_set:r.statement_set,attestations:Object.fromEntries(r.statements.map(s=>[s.id,true]))},{env});};
 const join=async(remember=false)=>store.joinTextPublication(db,visitor,{public_id:pid,expected_disclosure_hash:sha256Hex(store.TEXT_PUBLICATION_DISCLOSURE),is_adult:true,accept_ai_disclosure:true,accept_retention:true,
  ...(memory?{remember,expected_memory_epoch:'0',expected_memory_policy_hash:PUBLICATION_MEMORY_POLICY_HASH}:{})},{env});
 return {...f,db,readiness,publish,join,captures};
}

export async function personPublicationSqlInventory(){
 const samples=[];
 for(const memory of [false,true]){
  const f=personFixture({memory});await f.readiness();await f.publish();await f.join(memory);
  for(const name of ['PRIVATE_TEXT_CHOICES_SQL','PRIVATE_TEXT_SELECTION_SQL','TEXT_PUBLICATION_PUBLISH_SQL']){
   const sql=source[name]||store[name],call=f.captures.find(c=>c.sql===sql);
   samples.push({name:name+(memory?'_PERSON_V2':'_PERSON_V1'),sha256:sha256Hex(sql),sql,params:call.args,scope:'synthetic parameters captured from real person publication calls; not SQL execution'});
  }
 }
 return samples;
}
