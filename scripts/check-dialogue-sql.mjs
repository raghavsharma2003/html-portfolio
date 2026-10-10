// Parse the actual composed private-dialogue queries in PostgreSQL.
// EXPLAIN without ANALYZE does not execute the embedded writes. This catches
// syntax/type errors that fake database adapters cannot detect.
import { q } from '../api/_db.js';
import { PRIVATE_SESSION_HISTORY_SQL, PRIVATE_DIALOGUE_BEGIN_SQL, PRIVATE_DIALOGUE_FINISH_SQL } from '../api/_replica-dialogue.js';
import { REPLICA_POLICY_VERSION } from '../api/_replica.js';
import { DIALOGUE_SCHEMA } from '../api/_dialogue/contracts.js';

const id='00000000-0000-4000-8000-000000000001', digest='0'.repeat(64);
const cases=[
  ['private session history',PRIVATE_SESSION_HISTORY_SQL,[id,id,id,id,id]],
  ['private dialogue admission',PRIVATE_DIALOGUE_BEGIN_SQL,[id,id,id,id,'SQL parser check','sql_parser_check',DIALOGUE_SCHEMA,'dialogue','parser-only','parser-only','parser-only',digest,REPLICA_POLICY_VERSION,'[]']],
  ['private dialogue completion',PRIVATE_DIALOGUE_FINISH_SQL,[id,id,id,'SQL parser check',digest,'{}',REPLICA_POLICY_VERSION]],
];
let failures=0;
for(const [name,sql,params]of cases){
  try{
    const rows=await q(`EXPLAIN (FORMAT JSON) ${sql}`,params,15000);
    if(!Array.isArray(rows)||rows.length!==1)throw Object.assign(new Error('missing_plan'),{code:'missing_plan'});
    console.log(`  ok  ${name}: PostgreSQL parsed actual query`);
  }catch(error){
    failures++;
    const code=/^[A-Za-z0-9_]{1,64}$/.test(error?.code||'')?error.code:'parser_check_failed';
    console.log(`FAIL  ${name}: ${code}`);
  }
}
console.log(`${cases.length-failures}/${cases.length} dialogue SQL checks passed; no statements executed by EXPLAIN`);
process.exitCode=failures?1:0;
