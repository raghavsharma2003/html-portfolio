// These execute real refusal callers against a DB that denies admission.
// They prove no JS fallback follows a refused row, not PostgreSQL semantics.
// Exact candidate-marker predicates require the separate actual-SQL proof.
import assert from 'node:assert/strict';
import {beginOwnedPrivateGeneration} from '../../api/_replica-generation.js';
import {loadOwnedDialogueSpeech} from '../../api/_replica-dialogue.js';
import {createNeonProvenanceLedger} from '../../api/_provenance/providers/neon-ledger.js';
import {resolveRoom} from '../../api/_room-surface.js';
import {resolveInboundClone} from '../../api/_clonechannel.js';
import {readOwnedDialogueHistory} from '../../api/_replica-dialogue-history.js';
const rid='10000000-0000-4000-8000-000000000001';
const owner='20000000-0000-4000-8000-000000000001';
const turn='30000000-0000-4000-8000-000000000001';
let queries=0,loads=0;
const deny=async()=>{queries++;return [];};
await assert.rejects(()=>beginOwnedPrivateGeneration(deny,owner,{replica_id:rid,channel:'private_chat',purpose:'private_conversation',trace_id:'candidate_deny_44',dialogue_turn_id:turn}),/generation_not_authorized/);
assert.equal(queries,1,'voice refusal cannot continue into runtime or provider');
await assert.rejects(()=>loadOwnedDialogueSpeech(deny,owner,{replica_id:rid,dialogue_turn_id:turn}),/dialogue_turn_not_speakable/);
const ledger=createNeonProvenanceLedger(deny);
await assert.rejects(()=>ledger.open({generationId:turn,replicaId:rid,ownerUserId:owner}),/generation_open_denied/);
await assert.rejects(()=>ledger.appendSegment({authorization:{generationId:turn,replicaId:rid,ownerUserId:owner},receipt:{}}),/generation_revoked_or_segment_replayed/);
await assert.rejects(()=>ledger.seal({authorization:{generationId:turn,replicaId:rid,ownerUserId:owner},receipt:{},envelopeCanonical:'x'.repeat(128)}),/generation_seal_denied/);
await assert.rejects(()=>resolveRoom(deny,'synthetic-expert',{loadAgent:async()=>{loads++;throw Error('FORBIDDEN_AGENT_LOAD');}}),/room_unavailable/);
assert.equal(loads,0,'denied room never loads fallback teacher or provider');
assert.equal(queries,6,'each denied caller attempts only its actual admission query');
await assert.rejects(()=>resolveInboundClone(deny,'telegram','synthetic-address',{loadAgent:async()=>{loads++;throw Error('FORBIDDEN_AGENT_LOAD');}}),/clone_unavailable/);
assert.equal(loads,0,'denied clone binding never invokes even an injected loader');
const historyRow={runtime_active:true,session_id:turn,text_only:true,pending:false,latest_request:null,billing_candidates:[],exchanges:[{
 turn_id:turn,trace_id:'synthetic_trace',question:'Hello',reply:'Hello again.',has_continuity:false,
 delivery:{mode:'warm',pace:'natural',intensity:0.5,language_hint:'English',nonverbals:[]}}]};
const historical=await readOwnedDialogueHistory(async()=>[historyRow],owner,{replica_id:rid,session_id:turn});
assert.equal(historical.exchanges[0].answer.can_voice,false,'historical/current candidate text cannot become speakable on reload');
await assert.rejects(()=>readOwnedDialogueHistory(async()=>[{...historyRow,runtime_active:false}],owner,{replica_id:rid,session_id:turn}),/dialogue_runtime_not_active/);
console.log('9 real caller/history control groups passed with synthetic denied/scoped DB rows; SQL marker semantics unproved here');
