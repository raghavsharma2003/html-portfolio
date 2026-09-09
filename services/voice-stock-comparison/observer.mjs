import {fork} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const fail=code=>{throw Error(code);};
export function assertStockObserver(message,{pid,sourceSha,approvedSha,now=Date.now(),minimumRemainingMs=30000,isAlive=id=>process.kill(id,0)}={}){
  if(message?.kind!=='watching'||message.pid!==pid||message.sourceSha!==sourceSha||message.approvedSha!==approvedSha
    ||!Number.isSafeInteger(message.at)||!Number.isSafeInteger(message.expires)||message.at>now||now-message.at>15000||message.expires-now<minimumRemainingMs)fail('stock_observer_not_ready');
  try{isAlive(pid);}catch{fail('stock_observer_not_alive');}
}
export function guardStockDispatch(fetchImpl,assertObserver){
  return async(url,options)=>{
    if(options?.method==='POST'&&/^https:\/\/management\.azure\.com\/.*\/start\?/.test(String(url)))await assertObserver(1500000);
    return fetchImpl(url,options);
  };
}
export async function startStockObserver({file,approvedSha,sourceSha,journalPath}){
  const path=fileURLToPath(new URL('../../scripts/stock-jobs106-observer.mjs',import.meta.url));
  const actual=createHash('sha256').update(await readFile(path)).digest('hex');
  if(sourceSha!==actual)fail('stock_observer_source_changed');
  const child=fork(path,[file,approvedSha,journalPath],{windowsHide:true,detached:true,stdio:['ignore','ignore','ignore','ipc']});
  let latest,closed=false;
  child.on('message',message=>{latest=message;});child.on('exit',()=>{closed=true;});
  child.on('error',()=>{closed=true;});
  const assertObserver=async(minimumRemainingMs=30000)=>{if(closed)fail('stock_observer_not_alive');assertStockObserver(latest,{pid:child.pid,sourceSha,approvedSha,minimumRemainingMs});};
  try{
    const deadline=Date.now()+45000;
    while(Date.now()<deadline){if(closed)fail('stock_observer_not_alive');if(latest?.kind==='watching'){await assertObserver();return {assertObserver,
      finish:()=>{if(child.connected)child.send({kind:'runner_finished'});child.disconnect();child.unref();},
      leaveRunning:()=>{if(child.connected)child.disconnect();child.unref();}};}
      await new Promise(r=>setTimeout(r,100));}
    fail('stock_observer_not_ready');
  }catch(error){if(child.connected)child.disconnect();child.unref();throw error;}
}
