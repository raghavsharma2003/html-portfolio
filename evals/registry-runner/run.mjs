// Exercises real child scheduling. Completion ordering uses an acknowledged
// handshake, not a difference between arbitrary sleep durations.
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,basename} from 'node:path';
import {createServer} from 'node:http';
import {randomUUID} from 'node:crypto';
import {runPool,runSuiteFile,pickWorkerCount} from '../runner-lib.mjs';

let fail=0,count=0;
function ok(name,condition,detail=''){count++;if(!condition){fail++;console.log(`FAIL ${name} ${detail}`);}else console.log(`  ok ${name}`);}
const dir=mkdtempSync(join(tmpdir(),'registry-runner-'));
const fixtureA=join(dir,'a.mjs'),fixtureB=join(dir,'b.mjs');
writeFileSync(fixtureA,'console.log("A start");console.log("A end");process.exit(0);');
writeFileSync(fixtureB,'console.log("B start");console.error("B failed on purpose");process.exit(1);');

async function witnessedPool(){
 const capability=randomUUID();let waitingA=null,waitingB=null,aStarted=false,bStarted=false,overlap=false,timedOut=false;
 const completion=[];
 const server=createServer((req,res)=>{
  if(timedOut){res.writeHead(503).end('deadline');return;}
  if(req.url===`/${capability}/a`){aStarted=true;waitingA=res;}
  else if(req.url===`/${capability}/b`){bStarted=true;waitingB=res;}
  else {res.writeHead(404).end();return;}
  if(aStarted&&bStarted&&waitingA&&!waitingA.writableEnded&&waitingB&&!waitingB.writableEnded){overlap=true;waitingB.end('release');}
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const endpoint=`http://127.0.0.1:${server.address().port}/${capability}`;
 const a=join(dir,'held-a.mjs'),b=join(dir,'held-b.mjs');
 for(const [file,letter,exitCode]of[[a,'a',0],[b,'b',1]]){
  writeFileSync(file,`import{get}from'node:http';
const deadline=setTimeout(()=>process.exit(2),20000);
console.log(${JSON.stringify(letter+' started')});
const req=get(${JSON.stringify(endpoint+'/'+letter)},res=>{let body='';res.setEncoding('utf8');res.on('data',chunk=>body+=chunk);res.on('end',()=>{clearTimeout(deadline);if(res.statusCode!==200||body!=='release')process.exit(2);${letter==='b'?'console.error("B failed on purpose");':''}process.exit(${exitCode});});});
req.on('error',()=>process.exit(2));`);
 }
 // A deadline detects a deadlocked/serial runner; elapsed time cannot make
 // the positive overlap assertion pass. Both started requests must coexist.
 const deadline=setTimeout(()=>{timedOut=true;if(waitingA&&!waitingA.writableEnded)waitingA.writeHead(503).end('deadline');if(waitingB&&!waitingB.writableEnded)waitingB.writeHead(503).end('deadline');},15000);
 try{
  const results=await runPool([{name:'held-first',file:a},{name:'released-second',file:b}],2,{onDone:r=>{
   completion.push(r.name);
   // Only the actual completion callback for B releases A. This observes
   // the scheduler callback, not the child's log or an elapsed delay.
   if(r.name==='released-second'&&waitingA&&!waitingA.writableEnded)waitingA.end('release');
  }});
  return{results,completion,overlap,timedOut};
 }finally{
  clearTimeout(deadline);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
 }
}

try{
 const passing=await runSuiteFile('fixture-pass',fixtureA);
 ok('a passing suite reports ok:true',passing.ok===true);
 ok('its output carries both of its own lines',passing.output.includes('A start')&&passing.output.includes('A end'));
 const failing=await runSuiteFile('fixture-fail',fixtureB);
 ok('a failing suite reports ok:false',failing.ok===false);
 ok('failing stderr is captured in the same buffer',failing.output.includes('B failed on purpose'));
 const parallel=await witnessedPool();
 ok('both real child requests overlap while the first child is held',parallel.overlap&&!parallel.timedOut);
 ok('actual second completion releases the first, independent of child startup timing',JSON.stringify(parallel.completion)==='["released-second","held-first"]',JSON.stringify(parallel.completion));
 ok('returned results preserve registry order despite reversed completion',parallel.results[0].name==='held-first'&&parallel.results[1].name==='released-second');
 ok('held first child succeeds',parallel.results[0].ok===true);
 ok('released second child preserves its failure',parallel.results[1].ok===false&&parallel.results[1].output.includes('B failed on purpose'));
 ok('one failure aggregates to failed',parallel.results.some(r=>!r.ok));
 const both=await runPool([{name:'p1',file:fixtureA},{name:'p2',file:fixtureA}],2);
 ok('two passing suites aggregate to all passed',both.every(r=>r.ok));
 const serialCompletion=[];
 await runPool([{name:'first',file:fixtureA},{name:'second',file:fixtureB}],1,{onDone:r=>serialCompletion.push(r.name)});
 ok('NEGATIVE CONTROL: serial concurrency keeps actual completion in entry order',JSON.stringify(serialCompletion)==='["first","second"]',JSON.stringify(serialCompletion));
 ok('EVALS_WORKERS overrides with a positive integer',pickWorkerCount({EVALS_WORKERS:'3'})===3);
 ok('nonnumeric EVALS_WORKERS is ignored',pickWorkerCount({EVALS_WORKERS:'nope'})>=2);
 ok('default floor is two workers',pickWorkerCount({})>=2);
}finally{
 // Confirm the exact fresh temporary directory before recursive removal.
 const target=realpathSync(dir);
 assert.equal(dirname(target),realpathSync(tmpdir()));assert.ok(basename(target).startsWith('registry-runner-'));
 rmSync(target,{recursive:true,force:true});
}
console.log(fail?`${fail} FAILURES of ${count}`:`ALL ${count} PASS`);
process.exitCode=fail?1:0;
