// Real child pipes and bounded large payloads, no suites/provider/build calls.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const helper = new URL('./runner-output.mjs', import.meta.url).href;
const size = 4 * 1024 * 1024;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function pipeCase({legacy=false,asyncAdapter=false,code=1,breakOutput=false}={}) {
  const source=`import {exitWithFlushedOutput} from ${JSON.stringify(helper)};
    import {Writable} from 'node:stream';
    ${asyncAdapter ? `for(const name of ['stdout','stderr']) { const raw=process[name]; const queued=new Writable({write(chunk,encoding,callback){setImmediate(()=>raw.write(chunk,encoding,callback));}}); Object.defineProperty(process,name,{value:queued}); }` : ''}
    process.stdout.write('o'.repeat(${size})+'STDOUT_END');
    process.stderr.write('e'.repeat(${size})+'STDERR_END');
    ${legacy ? `process.exit(${code});` : `await exitWithFlushedOutput(${code});`}`;
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,['--input-type=module','-e',source],{stdio:['ignore','pipe','pipe'],windowsHide:true});
    const out=[],err=[]; let bytes=0;
    const timer=setTimeout(()=>{child.kill();reject(Error('pipe_case_timeout'));},15000);
    for(const [stream,parts] of [[child.stdout,out],[child.stderr,err]]) stream.on('data',data=>{
      bytes+=data.length;if(bytes>size*2+65536){child.kill();reject(Error('pipe_output_bound'));return;}parts.push(data);
    });
    if(breakOutput) child.stdout.destroy();
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('close',(status,signal)=>{clearTimeout(timer);resolve({status,signal,out:Buffer.concat(out),err:Buffer.concat(err)});});
  });
}
const expectedOut=Buffer.from('o'.repeat(size)+'STDOUT_END');
const expectedErr=Buffer.from('e'.repeat(size)+'STDERR_END');
// Windows native stdio pipes can be synchronous. Record their result without
// pretending it reproduces Linux's asynchronous stdio scheduling.
const nativeLegacy=await pipeCase({legacy:true});
console.log(JSON.stringify({case:'legacy_native_pipe',stdout_bytes:nativeLegacy.out.length,stderr_bytes:nativeLegacy.err.length,expected_each:expectedOut.length,status:nativeLegacy.status}));
const legacy=await pipeCase({legacy:true,asyncAdapter:true});
assert.equal(legacy.status,1);
assert(legacy.out.length<expectedOut.length||legacy.err.length<expectedErr.length,'negative control must exhibit queued-write loss');
console.log(JSON.stringify({case:'legacy_async_adapter_to_real_pipe',stdout_bytes:legacy.out.length,stderr_bytes:legacy.err.length,expected_each:expectedOut.length,status:legacy.status}));
for(const options of [{asyncAdapter:true,code:1},{asyncAdapter:true,code:0},{asyncAdapter:false,code:1}]) {
  const result=await pipeCase(options);assert.equal(result.status,options.code);assert.equal(result.signal,null);
  assert.equal(digest(result.out),digest(expectedOut));assert.equal(digest(result.err),digest(expectedErr));
  console.log(JSON.stringify({case:'drained_pipe',...options,stdout_bytes:result.out.length,stderr_bytes:result.err.length,status:result.status}));
}
const broken=await pipeCase({code:0,breakOutput:true});assert.notEqual(broken.status,0,'broken output cannot report success');
console.log(JSON.stringify({case:'broken_stdout',status:broken.status}));
const runner=readFileSync(new URL('./run.mjs',import.meta.url),'utf8');
assert.equal((runner.match(/await exitWithFlushedOutput\(/g)||[]).length,5);
assert(!/^\s*process\.exit\(/m.test(runner),'no undrained terminal path');
console.log('PASS: queued-write loss reproduced with explicit asynchronous adapter over child pipes; native behavior reported separately. Drained output exact, failure status retained, broken pipe refuses success, all five runner exits wired.');
