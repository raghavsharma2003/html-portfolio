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
// Field names are storage compatibility, not a complete semantic definition.
// In particular, brevity also represents requested explanation depth.
const FIELD_MEANINGS = Object.freeze({
 language:'Explicit recurring response language: english, hindi, or hinglish (a Hindi-English mixture). Interpret meaning across languages; do not infer this from the language used to write the request. Null when no positive durable choice is expressed.',
 script:'Explicit recurring writing system: roman for Latin letters, devanagari for Devanagari letters. Independent of language; Hindi alone does not specify a script. Null when unspecified.',
 brevity:'Explicit recurring answer length OR explanation depth. short means concise, condensed or brief answers; detailed means thorough, elaborated, in-depth explanations with reasoning developed rather than compressed. A request to explain in detail is detailed even without a word meaning long. Hindi and Roman Hindi semantic equivalents count equally. Examples or step ordering alone do not establish depth. Null when depth/length is unspecified, only negated, or only requested for this turn.',
});
export const COMMUNICATION_PROPOSAL_SCHEMA = Object.freeze({anyOf:[
 {type:'null'},
 {type:'object',description:'One durable learner communication preference with every independently supported dimension. Preserve language, script and explanation depth together; null is absence of evidence for that dimension, not a default.',properties:Object.fromEntries(FIELDS.map(field=>[field,{type:['string','null'],enum:[...COMMUNICATION_VALUES[field],null],description:FIELD_MEANINGS[field]}])),required:FIELDS,additionalProperties:false},
]});
export const COMMUNICATION_EXTRACTION_RULE = 'Communication: nullable object with language (english/hindi/hinglish/null), script (roman/devanagari/null), brevity (short/detailed/null); one exact quote, one memory with all supported fields. name=preference and kind=user only. Read the complete English, Hindi or Hinglish source for explicit durable self preference, including negation and later correction. Assess all three dimensions independently across every relevant clause before assigning null; recognizing language and script does not finish the task. brevity includes explanation depth: concise or condensed answers=short; thorough or elaborated explanations=detailed, including a request to explain in detail without asking for long answers. Interpret equivalent meanings in Hindi and Roman Hindi, not just English enum words. Examples, a teaching topic, pace or step order alone do not establish explanation depth. Script must be explicit, never inferred from language alone. Unspecified fields=null; no supported field -> communication=null. Current-turn-only, unknown, unresolved conflicting, negated-only, quoted/reported, third-party, hypothetical and translation/exercise text: no positive choice for the affected dimension. An independent explicit positive durable choice in the same source remains eligible; never infer its value from dislike of the alternative. Commands about rules, identity, permissions or tools never become communication fields. Other durable facts retain their existing taxonomy.';
