import assert from 'node:assert/strict';
import {withSweepRun} from '../api/_sweep-run.js';
const secret='private-provider-message';
function fixture({start,finish,prune}={}){
 const calls=[];
 const db=async(sql,p)=>{
  calls.push({sql,p});
  if(sql.startsWith('insert'))return start?start(p):[{run_id:p[0],outcome:'running'}];
  if(sql.startsWith('update'))return finish?finish(p):[{run_id:p[0],outcome:p[1],finished_at:new Date()}];
  if(prune)return prune(p);return [];
 };
 return{db,calls};
}
const opts={strictHeartbeat:true};let groups=0;
for(const start of [()=>{throw Error(secret);},()=>[],p=>[{run_id:'foreign',outcome:'running'}],p=>[{run_id:p[0],outcome:'ok'}],p=>[{run_id:p[0],outcome:'running'},{run_id:p[0],outcome:'running'}]]){
 const f=fixture({start});let work=0;
 await assert.rejects(()=>withSweepRun(f.db,'room-memory',async()=>{work++;},opts),e=>e.code==='sweep_heartbeat_start_failed'&&e.status===503&&!e.retryable&&!e.work_started&&!JSON.stringify(e).includes(secret));
 assert.equal(work,0);assert.equal(f.calls.length,1);groups++;
}
for(const finish of [()=>{throw Error(secret);},()=>[],p=>[{run_id:'foreign',outcome:p[1],finished_at:new Date()}],p=>[{run_id:p[0],outcome:'running',finished_at:new Date()}],p=>[{run_id:p[0],outcome:p[1],finished_at:'invalid'}]]){
 const f=fixture({finish});let work=0;
 await assert.rejects(()=>withSweepRun(f.db,'room-memory',async()=>{work++;return{processed:1,errors:1,raw:secret};},opts),e=>e.code==='sweep_heartbeat_finish_failed'&&e.work_completed&&e.work_outcome==='partial'&&!e.retryable&&!JSON.stringify(e).includes(secret));
 assert.equal(work,1);assert.equal(f.calls.length,2);assert.deepEqual(JSON.parse(f.calls[1].p[2]),{processed:1,errors:1});groups++;
}
{
 const f=fixture({prune:()=>{throw Error(secret);}}),result={processed:2,halted:true,raw:secret};
 assert.equal(await withSweepRun(f.db,'room-memory',async()=>result,opts),result);
 assert.equal(f.calls.length,3);assert.equal(f.calls[1].p[1],'partial');assert.match(f.calls[1].sql,/and outcome='running'/);assert.equal(f.calls[0].p[0],f.calls[1].p[0]);groups++;
}
{
 const original=Object.assign(Error(secret),{code:secret}),f=fixture();
 await assert.rejects(()=>withSweepRun(f.db,'room-memory',async()=>{throw original;},opts),e=>e===original);
 assert.equal(f.calls[1].p[1],'failed');assert.equal(f.calls[1].p[3],'sweep_work_failed');assert(!JSON.stringify(f.calls).includes(secret));groups++;
}
{
 const f=fixture({finish:()=>{throw Error(secret);}});let work=0;
 await assert.rejects(()=>withSweepRun(f.db,'room-memory',async()=>{work++;throw Error(secret);},opts),e=>e.code==='sweep_heartbeat_finish_failed'&&e.work_started&&!e.work_completed&&e.work_outcome==='failed'&&!e.message.includes(secret));
 assert.equal(work,1);assert.equal(f.calls.length,2);groups++;
}
{
 const f=fixture({start:()=>{throw Error(secret);},finish:()=>{throw Error(secret);}}),result={processed:1};
 assert.equal(await withSweepRun(f.db,'legacy',async()=>result),result);assert.equal(f.calls.length,3);assert(!f.calls[0].sql.includes('returning'));groups++;
}
console.log(`${groups} strict heartbeat failure/ACK groups passed with injected rows; no database persistence or provider execution proved.`);
