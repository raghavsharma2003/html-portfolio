import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';

const source=readFileSync(new URL('../src/studio/wavCapture.ts',import.meta.url),'utf8');
function fixture(failAt='',input=source){
  const counts={tracks:[0,0],closed:0,nodes:[],revoked:0};
  let processor;
  const error=new Error('synthetic '+failAt);
  function node(name){
    if(failAt===name)throw error;
    const item={name,disconnected:0,gain:{value:0},onaudioprocess:null,
      connect(){if(failAt===name+'.connect')throw error;},
      disconnect(){item.disconnected++;if(failAt===name+'.disconnect')throw error;}};
    counts.nodes.push(item);return item;
  }
  class Context{
    sampleRate=24000;destination={};
    constructor(){if(failAt==='constructor')throw error;}
    createMediaStreamSource(){return node('source');}
    createScriptProcessor(){return processor=node('processor');}
    createGain(){return node('gain');}
    async close(){counts.closed++;if(failAt==='close')throw error;}
    async resume(){}
  }
  const exports={};const scope={exports,Blob,File,DOMException,Float32Array,ArrayBuffer,DataView,Math,AudioContext:Context,
    navigator:{mediaDevices:{getUserMedia:async()=>({getTracks:()=>[0,1].map(index=>({stop(){counts.tracks[index]++;}}))})}},
    URL:{createObjectURL:()=> 'blob:synthetic-wav'}};
  runInNewContext(ts.transpileModule(input,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,scope);
  return {counts,error,open:exports.openPrivateWavCapture,emit:()=>processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array([0,.5,-.5,0])}})};
}
let passed=0;
async function check(name,fn){await fn();console.log(`ok ${++passed} - ${name}`);}
for(const stage of ['constructor','source','processor','gain','source.connect','processor.connect','gain.connect']){
  await check(`actual ${stage} setup failure releases every acquired resource`,async()=>{
    const f=fixture(stage);await assert.rejects(f.open(),error=>error===f.error);
    assert.deepEqual(f.counts.tracks,[1,1]);assert.equal(f.counts.closed,stage==='constructor'?0:1);
    assert(f.counts.nodes.every(node=>node.disconnected===1));
  });
}
for(const stage of ['source.disconnect','processor.disconnect','gain.disconnect','close']){
  await check(`actual ${stage} cleanup failure still releases both microphone tracks`,async()=>{
    const f=fixture(stage);const capture=await f.open();await assert.rejects(capture.cancel(),error=>error===f.error);
    assert.deepEqual(f.counts.tracks,[1,1]);assert.equal(f.counts.closed,1);assert(f.counts.nodes.every(node=>node.disconnected===1));
    await capture.cancel();assert.deepEqual(f.counts.tracks,[1,1]);
  });
}
await check('normal capture retains actual PCM encoding and closes once',async()=>{
  const f=fixture();const capture=await f.open();capture.start();f.emit();const wav=await capture.stop();await capture.cancel();
  assert.deepEqual(f.counts.tracks,[1,1]);assert.equal(f.counts.closed,1);
  const view=new DataView(await wav.file.arrayBuffer());assert.equal(view.getUint32(24,true),24000);assert.equal(view.getUint32(40,true),8);
  assert.equal(view.getInt16(46,true),16383);assert.equal(view.getInt16(48,true),-16384);
});
await check('actual setup-cleanup removal control leaks the opened microphone',async()=>{
  const old=source.replace('await close().catch(() => {});','/* old setup behavior: no acquired-resource cleanup */');assert.notEqual(old,source);
  const f=fixture('processor',old);await assert.rejects(f.open());assert.deepEqual(f.counts.tracks,[0,0]);assert.equal(f.counts.closed,0);
});
console.log(`PASS ${passed} actual WAV helper groups; synthetic Web Audio/device APIs, no real microphone or resampling-quality claim.`);
