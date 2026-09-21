// Emits exact production statements and synthetic parameters. Never connects.
import {writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PRIVATE_CONTINUITY_SQL,PRIVATE_CONTINUITY_SOURCES_SQL} from '../../api/_private-dialogue-continuity.js';
import {PRIVATE_SESSION_HISTORY_SQL,PRIVATE_DIALOGUE_BEGIN_SQL,PRIVATE_DIALOGUE_FINISH_SQL,PRIVATE_DIALOGUE_SPEECH_SQL} from '../../api/_replica-dialogue.js';
import {DIALOGUE_HISTORY_SQL} from '../../api/_replica-dialogue-history.js';
import {REPLICA_POLICY_VERSION} from '../../api/_replica.js';
const root=resolve(import.meta.dirname,'../..'),id=n=>`${n}0000000-0000-4000-8000-00000000000${n}`;
const hash=v=>createHash('sha256').update(v).digest('hex');
const [replica,owner,session,capability,agent,person,turn,prior]=[1,2,3,4,5,6,7,8].map(id);
const refs=JSON.stringify([{turn_id:prior,question_sha256:'a'.repeat(64),reply_sha256:'b'.repeat(64)}]);
const delivery=JSON.stringify({mode:'warm',pace:'natural',intensity:0.5,language_hint:'hi-IN',nonverbals:[]});
const shapes=[
 ['recall',PRIVATE_CONTINUITY_SQL,[replica,owner,session,REPLICA_POLICY_VERSION,['pendulum']]],
 ['sources',PRIVATE_CONTINUITY_SOURCES_SQL,[replica,owner,turn,REPLICA_POLICY_VERSION]],
 ['session-history',PRIVATE_SESSION_HISTORY_SQL,[session,replica,owner,agent,person]],
 ['admit',PRIVATE_DIALOGUE_BEGIN_SQL,[session,replica,owner,capability,'Synthetic question','continuity_sql_fixture','vyakti.replica-dialogue.v1','fixture','fixture','1','fixture','c'.repeat(64),REPLICA_POLICY_VERSION,refs]],
 ['complete',PRIVATE_DIALOGUE_FINISH_SQL,[turn,replica,owner,'Synthetic reply','d'.repeat(64),delivery,REPLICA_POLICY_VERSION]],
 ['speech-refusal',PRIVATE_DIALOGUE_SPEECH_SQL,[turn,replica,owner,REPLICA_POLICY_VERSION]],
 ['history',DIALOGUE_HISTORY_SQL,[replica,owner,session,REPLICA_POLICY_VERSION]],
].map(([name,sql,params])=>({name,sql,params,sha256:hash(sql)}));
const migration=readFileSync(resolve(root,'db/migrations/148_private_dialogue_continuity.sql'));
const output=resolve(root,'scratchpad/private-continuity-sql-'+Date.now()+'.json');mkdirSync(resolve(root,'scratchpad'),{recursive:true});
writeFileSync(output,JSON.stringify({state:'prepared_not_run',migration_sha256:hash(migration),queries:shapes,provider_calls:0,sql_calls:0,
 required_runtime_cases:['owned positive across sessions','foreign owner/replica/agent/person/capability denied','same session excluded','inactive/expired source and current authority denied','changed or missing raw bytes denied','latest corrected or off/unsafe text review excluded','latest exact or close-only review retained','voice or delivery-only review retained','foreign owner or response feedback inert','null refs legacy accepted without recall','nonarray refs CHECK refused','delete source before/during completion leaves no derived raw reply','delete derived turn never deletes its source','foreign references do not erase foreign logs','full-person and full-replica cascade ordering','source deletion GIN EXPLAIN plan with representative rows','public publication unchanged']},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:'prepared_not_run',artifact:output,queries:shapes.length,sql_calls:0,provider_calls:0}));
