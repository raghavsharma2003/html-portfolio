// Emits parameterized SQL from the real store with synthetic IDs, no DB calls.
// Root runs EXPLAIN (without ANALYZE) only after migration/dependency review.
import {createPrivateVoiceStore} from '../api/_private-voice-store.js';
import {fixture,OWNER,NOW} from '../evals/private-voice/fixtures.mjs';
const f=fixture(),store=createPrivateVoiceStore({db:f.db,now:()=>NOW});
await store.candidates(OWNER,{replica_id:f.input.replica_id});await store.admit(OWNER,f.input);await store.revoke(OWNER,f.input);
const seen=new Set(),statements=[];
for(const call of f.state.calls)if(!seen.has(call.sql)){seen.add(call.sql);statements.push({query:'EXPLAIN '+call.sql,params:call.params});}
process.stdout.write(JSON.stringify({schema:'private-voice-sql-parser-packet/v1',synthetic:true,executed:false,statements},null,2)+'\n');
