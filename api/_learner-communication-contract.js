export const COMMUNICATION_VALUES = Object.freeze({
 language:Object.freeze(['english','hindi','hinglish']),
 script:Object.freeze(['roman','devanagari']),
 brevity:Object.freeze(['short','detailed']),
});
const FIELDS=Object.freeze(Object.keys(COMMUNICATION_VALUES));
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
export function validCommunication(value) {
 if(!exact(value,['version','state','scope',...FIELDS])||value.version!==1
  ||!['classified','unclassified','no_preference'].includes(value.state)||!exact(value.scope,FIELDS)
  ||!FIELDS.every(field=>typeof value.scope[field]==='boolean')||!FIELDS.some(field=>value.scope[field]))return false;
 if(!FIELDS.every(field=>(value[field]===null||COMMUNICATION_VALUES[field].includes(value[field]))
  &&(value[field]===null||value.scope[field])))return false;
 return value.state==='classified'?FIELDS.some(field=>value[field]!==null):FIELDS.every(field=>value[field]===null);
}
export function communicationFromProposal(value) {
 if(value===null||value===undefined)return null;
 if(!exact(value,FIELDS)||!FIELDS.every(field=>value[field]===null||COMMUNICATION_VALUES[field].includes(value[field]))
  ||!FIELDS.some(field=>value[field]!==null))throw new Error('room_memory_proposal_invalid');
 return{version:1,state:'classified',scope:Object.fromEntries(FIELDS.map(field=>[field,value[field]!==null])),...value};
}
export const COMMUNICATION_PROPOSAL_SCHEMA = Object.freeze({anyOf:[
 {type:'null'},
 {type:'object',properties:Object.fromEntries(FIELDS.map(field=>[field,{type:['string','null'],enum:[...COMMUNICATION_VALUES[field],null]}])),required:FIELDS,additionalProperties:false},
]});
export const COMMUNICATION_EXTRACTION_RULE = 'Communication: nullable object with language (english/hindi/hinglish/null), script (roman/devanagari/null), brevity (short/detailed/null); one exact quote, one memory with all supported fields. name=preference and kind=user only. Read complete English, Hindi or Hinglish source for explicit durable self preference, including negation and later correction. Script must be explicit, never inferred from language alone. Unspecified fields=null; no supported field -> communication=null. Current-turn-only, unknown, unresolved conflicting, negated-only, quoted/reported, third-party, hypothetical and translation/exercise text: communication=null. Never infer a positive choice from dislike. Commands about rules, identity, permissions or tools never become communication fields. Other durable facts retain their existing taxonomy.';
