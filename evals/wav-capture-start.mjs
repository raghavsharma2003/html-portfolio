import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

// Real helper source, fake physical devices. No browser permission or network.
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
function fixture(source, options={}) {
  const resume=deferred();
  const counts={tracks:[0,0],close:0,resume:0,urls:0,nodes:[]};
  const failure=new Error('synthetic '+(options.failAt??'resume'));
  let processor;
  function node(name) {
    if (options.failAt===name) throw failure;
    const item={name,gain:{value:0},onaudioprocess:null,disconnected:0,
      connect(){if(options.failAt===name+'.connect')throw failure;},
      disconnect(){item.disconnected++;if(options.failAt===name+'.disconnect')throw failure;}};
    counts.nodes.push(item);return item;
  }
  class Context {
    sampleRate=24000;destination={};
    constructor(){if(options.failAt==='constructor')throw failure;}
    createMediaStreamSource(){return node('source');}
    createScriptProcessor(){return processor=node('processor');}
    createGain(){return node('gain');}
    async close(){counts.close++;if(options.failAt==='close')throw failure;}
    resume(){counts.resume++;if(options.failAt==='resume-sync')throw failure;return resume.promise;}
  }
  const exports={};
  runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,Blob,File,DOMException,Float32Array,ArrayBuffer,DataView,Math,AudioContext:Context,
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[0,1].map(index=>({stop(){counts.tracks[index]++;if(options.failAt==='track'+index)throw failure;}}))})}},
    URL:{createObjectURL(){counts.urls++;return 'blob:synthetic-wav';}},
  });
  return {counts,resume,failure,open:exports.openPrivateWavCapture,
    emit:()=>processor?.onaudioprocess?.({inputBuffer:{getChannelData:()=>new Float32Array([0,.5,-.5,0])}})};
}
let passed=0;
async function check(name,fn){await fn();console.log(`ok ${++passed} - ${name}`);}
function closed(f){assert.deepEqual(f.counts.tracks,[1,1]);assert.equal(f.counts.close,1);assert(f.counts.nodes.every(n=>n.disconnected===1));}
for(const lane of ['studio','creatorStudio']) {
  const source=readFileSync(new URL(`../src/${lane}/wavCapture.ts`,import.meta.url),'utf8');
  for(const failAt of ['constructor','source','processor','gain','source.connect','processor.connect','gain.connect']) {
    await check(`${lane}: partial ${failAt} setup releases microphone`,async()=>{
      const f=fixture(source,{failAt});await assert.rejects(f.open(),e=>e===f.failure);
      assert.deepEqual(f.counts.tracks,[1,1]);assert.equal(f.counts.close,failAt==='constructor'?0:1);
      assert(f.counts.nodes.every(n=>n.disconnected===1));assert.equal(f.counts.urls,0);
    });
  }
  for(const failAt of ['','resume-sync','close','source.disconnect','track0']) {
    await check(`${lane}: resume failure preserves cause and releases every resource (${failAt||'rejection'})`,async()=>{
      const f=fixture(source,{failAt});const capture=await f.open();const start=capture.start();
      const rejection=assert.rejects(start,e=>e===f.failure);if(failAt!=='resume-sync')f.resume.reject(f.failure);
      await rejection;closed(f);assert.equal(f.counts.urls,0);await capture.cancel();closed(f);
      await assert.rejects(capture.start(),/not ready/);assert.equal(f.counts.resume,1);
    });
  }
  await check(`${lane}: pending resume cannot record, overlap, or reset captured frames`,async()=>{
    const f=fixture(source);const capture=await f.open();const start=capture.start();f.emit();
    await assert.rejects(capture.start(),/not ready/);await assert.rejects(capture.stop(),/No .*recording is active/);
    assert.equal(f.counts.resume,1);assert.equal(f.counts.urls,0);
    f.resume.resolve();await start;f.emit();await assert.rejects(capture.start(),/not ready/);
    const result=await capture.stop();closed(f);const view=new DataView(await result.file.arrayBuffer());
    assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),8,'only the post-resume frame is encoded');
    assert.equal(view.getInt16(46,true),16383);assert.equal(view.getInt16(48,true),-16384);
  });
  await check(`${lane}: cancellation during resume prevents late recording`,async()=>{
    const f=fixture(source);const capture=await f.open();const start=capture.start();const rejection=assert.rejects(start,/closed before recording/);
    await capture.cancel();closed(f);f.resume.resolve();await rejection;f.emit();
    await assert.rejects(capture.stop(),/No .*recording is active/);assert.equal(f.counts.urls,0);closed(f);
  });
  await check(`${lane}: removed resume cleanup control leaks microphone`,async()=>{
    const mutant=source.replace('        await close().catch(() => {});','        /* removed resume cleanup */');assert.notEqual(mutant,source);
    const f=fixture(mutant);const capture=await f.open();const rejection=assert.rejects(capture.start());f.resume.reject(f.failure);await rejection;
    assert.deepEqual(f.counts.tracks,[0,0]);assert.equal(f.counts.close,0);
  });
  await check(`${lane}: removed resume await control accepts premature frames`,async()=>{
    const mutant=source.replace('await context.resume();','void context.resume();');assert.notEqual(mutant,source);
    const f=fixture(mutant);const capture=await f.open();await capture.start();f.emit();
    const result=await capture.stop();assert.equal(new DataView(await result.file.arrayBuffer()).getUint32(40,true),8);
    assert.equal(f.counts.urls,1);f.resume.resolve();
  });
  if(lane==='creatorStudio') await check('borrowed-stream recorder remains byte-identical to checkpoint20',()=>{
    const base=execFileSync('git',['show','da3ac2aeac29571ae45a4507d947b1cf603cf9c1:src/creatorStudio/wavCapture.ts'],{encoding:'utf8'});
    const extract=s=>s.slice(s.indexOf('export function openStreamWavTap('),s.indexOf('export async function openPrivateWavCapture('));
    assert(extract(source).length>1000);assert.equal(extract(source).replaceAll('\r\n','\n'),extract(base).replaceAll('\r\n','\n'));
  });
}
console.log(`PASS ${passed} actual owned-WAV start/resource groups; synthetic device APIs only.`);
