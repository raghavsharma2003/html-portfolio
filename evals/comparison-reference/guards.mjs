import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runComparisonReferenceLive,createComparisonLiveFixture,comparisonLiveManifest,COMPARISON_SQL_PIN_FILES} from './live.mjs';
import {prepareComparisonReferenceSql,prepareComparisonErasureSql,withoutComparisonConfirmationEpoch} from './sql-cases.mjs';
import {COMPARISON_CONFIRM_SQL} from '../../api/_comparison-reference.js';
import {referenceFromAuthority} from '../../api/_liveness/reference-evidence.js';
import {sha256Hex} from '../../api/_replica-processing/contracts.js';
let n=0;const check=async(name,work)=>{await work();console.log(`ok ${++n} - ${name}`);};
globalThis.fetch=()=>{throw Error('network_forbidden');};
await check('live runner cannot execute without all explicit protected dependencies',async()=>{await assert.rejects(()=>runComparisonReferenceLive(),/protected_arguments_required/);});
await check('missing any required source pin refuses before a database call',async()=>{
 for(const omitted of COMPARISON_SQL_PIN_FILES){let calls=0;await assert.rejects(()=>runComparisonReferenceLive({db:async()=>{calls++;return[];},onManifest:async()=>{},rollbackDb:async()=>{},expectedHead:'0'.repeat(40),expectedSourceHashes:Object.fromEntries(COMPARISON_SQL_PIN_FILES.filter(p=>p!==omitted).map(p=>[p,'0'.repeat(64)]))}),/protected_arguments_required/);assert.equal(calls,0);}
});
await check('wrong frozen HEAD refuses before any database or manifest mutation',async()=>{let calls=0;await assert.rejects(()=>runComparisonReferenceLive({db:async()=>{calls++;return[];},onManifest:async()=>{calls++;},rollbackDb:async()=>{},expectedHead:'0'.repeat(40),expectedSourceHashes:Object.fromEntries(COMPARISON_SQL_PIN_FILES.map(p=>[p,'0'.repeat(64)]))}));assert.equal(calls,0);});
await check('random isolated fixture preserves genuine signed-evidence record hashes and all predeclared scope IDs',()=>{
 const a=createComparisonLiveFixture(),b=createComparisonLiveFixture();assert.notEqual(a.c.binding.replica_id,b.c.binding.replica_id);referenceFromAuthority(a.c);
 const m=comparisonLiveManifest(a);assert.equal(m.reference_ids.length,4);assert.equal(m.evidence_ids.length,3);assert(m.scope_tables.includes('vy_replica_comparison_reference'));assert(!JSON.stringify(m).includes('vector'));assert(!JSON.stringify(m).includes('object_path'));
});
await check('seven store callers retain the exact actual SQL bytes and parameters',async()=>{const prep=await prepareComparisonReferenceSql();assert.equal(prep.cases.length,7);for(const c of prep.cases){assert.equal(sha256Hex(c.sql),c.sha256);assert(Array.isArray(c.params));}assert.equal(prep.execution,'not-run');});
await check('actual export and owner erasure are captured without executing either',async()=>{const cases=await prepareComparisonErasureSql();assert.equal(cases.length,2);assert(cases[0].sql.includes('owner_user_id'));assert(cases[1].sql.includes('delete from vy_replica_comparison_reference x using target t'));});
await check('removed epoch control preserves typed parameter usage and changes only eligibility checks',()=>{
 const old=withoutComparisonConfirmationEpoch(COMPARISON_CONFIRM_SQL);assert.notEqual(old,COMPARISON_CONFIRM_SQL);assert.equal((old.match(/\$6::bigint is not null/g)||[]).length,2);assert(old.includes('reference_authority_epoch=r.reference_authority_epoch+1'));assert(!old.includes('h.observed_epoch=c.observed_epoch'));
 assert.throws(()=>withoutComparisonConfirmationEpoch('select 1'),/negative_target_invalid/);
});
await check('live default is inert; guarded manifest precedes seed and cleanup directly recounts tombstones and attempts',()=>{
 const s=readFileSync(new URL('live.mjs',import.meta.url),'utf8');assert(!s.includes("import { q }"));assert(!s.includes('process.env'));assert(!s.includes('new Client'));assert(s.includes('await onManifest(comparisonLiveManifest(f));seeded=true;await seed(sql,f)'));
 assert(s.includes('await recount(db,f)'));assert(s.includes('vy_replica_processing_attempt where job_id=any'));assert(s.includes("assert.equal(guard[0]?.database,COMPARISON_DATABASE)"));
});
console.log(`${n} comparison SQL preparation/guard controls passed; no database execution`);
