// Independent deadline. Starts only the explicitly requested paired child.
import { spawn, execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const [baseline,candidate,output]=process.argv.slice(2);assert.ok(baseline&&candidate&&output);
const dir=resolve(output);await mkdir(dir,{recursive:false});
const runner=resolve(candidate,'scripts/run-hindi-observer-pair.mjs');
const runnerHash=createHash('sha256').update(await readFile(runner)).digest('hex');
const sourcePins={};for(const file of ['run-hindi-observer-pair.mjs','supervise-hindi-observer-pair.mjs','loading-font-collector.mjs','performance-hindi-interface.mjs'])sourcePins[file]=createHash('sha256').update(await readFile(resolve(candidate,'scripts',file))).digest('hex');
const stdout=createWriteStream(join(dir,'stdout.log')),stderr=createWriteStream(join(dir,'stderr.log'));
const startedAt=new Date().toISOString();let expired=false,forced=false,terminal=false,killTimer;
const child=spawn(process.execPath,[runner,resolve(baseline),resolve(candidate),join(dir,'experiment')],{cwd:resolve(candidate),windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
child.stdout.pipe(stdout);child.stderr.pipe(stderr);
const receipt={acceptance:false,startedAt,pid:child.pid,runner,runnerHash,sourcePins,deadlineMs:900000,cleanupGraceMs:30000};
await writeFile(join(dir,'running.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
const deadline=setTimeout(async()=>{
  if(terminal)return;expired=true;
  killTimer=setTimeout(()=>{if(terminal)return;forced=true;if(process.platform==='win32')execFile('taskkill',['/PID',String(child.pid),'/T','/F'],{windowsHide:true},()=>{});else child.kill('SIGKILL');},30000);
  await writeFile(join(dir,'deadline.json'),JSON.stringify({...receipt,state:'unknown-until-child-terminal',at:new Date().toISOString(),progressPreserved:'experiment/progress.json'},null,2)).catch(()=>{});
  if(child.connected)child.send({type:'loading47-deadline'},()=>{});
},900000);
const result=await new Promise(resolveDone=>{child.once('error',error=>resolveDone({code:null,error:String(error)}));child.once('exit',(code,signal)=>resolveDone({code,signal}));});
terminal=true;clearTimeout(deadline);clearTimeout(killTimer);
const finished={...receipt,...result,finishedAt:new Date().toISOString(),expired,forced,state:expired||result.code!==0?'failed':'completed-comparison-not-acceptance'};
await writeFile(join(dir,'completion.json'),JSON.stringify(finished,null,2));console.log(JSON.stringify(finished));
process.exitCode=expired||result.code!==0?1:0;

