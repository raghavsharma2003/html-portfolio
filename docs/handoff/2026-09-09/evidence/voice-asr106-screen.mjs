import {readFileSync,openSync,writeSync,fsyncSync,closeSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const H=dirname(fileURLToPath(import.meta.url)),ROOT=resolve(H,'../..');
const sha=b=>createHash('sha256').update(b).digest('hex');
const need=x=>{if(!x)throw Error('asr106_refused');};
function save(name,value){const bytes=Buffer.from(JSON.stringify(value,null,2)+'\n'),fd=openSync(resolve(H,name),'wx');try{let n=0;while(n<bytes.length)n+=writeSync(fd,bytes,n,bytes.length-n);fsyncSync(fd);}finally{closeSync(fd);}return sha(bytes);}
export const tokens=s=>(String(s).normalize('NFC').toLocaleLowerCase('en').match(/[\p{L}\p{M}\p{N}]+/gu)||[]);
const script=s=>{const dev=/\p{Script=Devanagari}/u.test(s),latin=/\p{Script=Latin}/u.test(s);return dev&&latin?'mixed':dev?'devanagari':latin?'latin':'none';};
export function intelligibility(expected,actual,disclosure){
 const e=tokens(expected),a=tokens(actual),d=tokens(disclosure);const disclosed=d.length>0&&d.every((x,i)=>a[i]===x);
 const expectedScript=script(expected),actualScript=script(actual);
 if(expectedScript==='mixed'||actualScript!==expectedScript||expectedScript==='none')return {wer:null,reason:'mixed_or_different_scripts_require_linguistic_review',expected_script:expectedScript,asr_script:actualScript,disclosure_exact_normalized_prefix:disclosed,likeness_measured:false};
 let prev=Array.from({length:a.length+1},(_,i)=>i);for(let i=1;i<=e.length;i++){const row=[i];for(let j=1;j<=a.length;j++)row[j]=Math.min(row[j-1]+1,prev[j]+1,prev[j-1]+(e[i-1]===a[j-1]?0:1));prev=row;}
 return {wer:e.length?prev[a.length]/e.length:null,edit_count:prev[a.length],reference_tokens:e.length,normalization:'NFC lowercase Unicode-word tokens; punctuation removed; no transliteration or number expansion',scope:'full delivered text including disclosure',disclosure_exact_normalized_prefix:disclosed,likeness_measured:false,asr_error_and_synthesis_error_not_separated:true};
}
async function speechKey(){
 const allowed=new Set(['path','systemroot','windir','comspec','pathext','temp','tmp','userprofile','appdata','localappdata','programdata','programfiles','programfiles(x86)']);const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>allowed.has(k.toLowerCase())));
 return new Promise((ok,fail)=>{const c=spawn('python',[resolve(H,'voice-asr106-key.py')],{cwd:ROOT,windowsHide:true,env:{...env,VYAKTI_ASR106_PIPE:'1'},stdio:['ignore','pipe','pipe']});let size=0,bad=false;const chunks=[],timer=setTimeout(()=>{bad=true;c.kill();},65000);c.stdout.on('data',b=>{size+=b.length;if(size>65536){bad=true;c.kill();}else chunks.push(b);});c.stderr.on('data',()=>{});c.on('error',()=>{bad=true;});c.on('close',code=>{clearTimeout(timer);let all;try{need(!bad&&code===0);all=Buffer.concat(chunks);const v=JSON.parse(all);need(Object.keys(v).join('')==='AZURE_SPEECH_KEY'&&typeof v.AZURE_SPEECH_KEY==='string');ok(v.AZURE_SPEECH_KEY);}catch{fail(Error('asr106_key_unavailable'));}finally{all?.fill(0);chunks.forEach(b=>b.fill(0));}});});
}
async function main(){
 const [mode,name,pin]=process.argv.slice(2);need(['check','run'].includes(mode));const path=resolve(H,name);need(dirname(path)===H);const bytes=readFileSync(path);need(sha(bytes)===pin);const p=JSON.parse(bytes);
 need(p.kind==='voice-asr106-screen/v1'&&p.max_posts===12&&p.aggregate_cap_microusd===50000&&p.runtime_sha256===sha(readFileSync(fileURLToPath(import.meta.url))));
 for(const [file,hash]of Object.entries(p.helper_pins))need(sha(readFileSync(resolve(H,file)))===hash);
 for(const [file,hash]of Object.entries(p.input_artifact_pins))need(sha(readFileSync(resolve(H,file)))===hash);
 const source=resolve(ROOT,p.source_relative_path);for(const [file,hash]of Object.entries(p.source_pins))need(sha(readFileSync(resolve(source,file)))===hash);
 need(p.clips.length===12&&new Set(p.clips.map(c=>c.id)).size===12);let total=0;
 for(const c of p.clips){const wav=readFileSync(resolve(H,c.wav_path));need(sha(wav)===c.wav_sha256&&wav.toString('ascii',0,4)==='RIFF'&&wav.readUInt32LE(24)===24000&&wav.readUInt16LE(22)===1&&wav.readUInt16LE(34)===16&&sha(wav.subarray(44))===c.pcm_sha256&&wav.length===44+c.sample_count*2);need(c.duration_ms===c.sample_count/24&&c.reserved_microusd===Math.ceil(c.duration_ms/1000)*100&&sha(c.expected_text)===c.expected_text_sha256);total+=c.reserved_microusd;}
 need(total===p.total_reserved_microusd&&total<=p.aggregate_cap_microusd);
 const {createAzureFastTranscriptionAdapter}=await import(pathToFileURL(resolve(source,'api/_replica-processing/providers/azure-fast-transcription.js')));const meter=await import(pathToFileURL(resolve(source,'api/_provider-budget.js')));
 if(mode==='check'){console.log(JSON.stringify({state:'asr106_inputs_and_production_graph_checked',clips:p.clips.length,reserved_microusd:total,model_calls:0,sql_calls:0}));return;}
 need(p.run_allowed===true&&p.root_admitted===true);save('voice-asr106-screen.claim.json',{packet_sha256:pin,at:new Date().toISOString(),max_posts:12,estimated_reservation_microusd:total});
 const deadlineController=new AbortController(),deadlineTimer=setTimeout(()=>deadlineController.abort(),900000);
 const report={state:'started',posts:0,settled_microusd:0,clips:[],gpu_calls:0,synthesis_calls:0,likeness_measured:false};let apiKey;
 try{
  const {readNeonLiteral}=await import('./processing204-config-literal.mjs');const url=await readNeonLiteral(ROOT,p.neon_hostname_sha256,p.database);const {createNeonDb}=await import(pathToFileURL(resolve(source,'services/replica-processing-worker/db.js')));const db=createNeonDb({env:{NEON_URL:url,REPLICA_EXPECTED_DATABASE:p.database}});
  const ledger=await db('select budget_id,limit_microusd::text,reserved_microusd::text,spent_microusd::text,state from vy_provider_budget where budget_id=$1',[p.budget_id]);need(ledger.length===1&&ledger[0].state==='active'&&Number(ledger[0].limit_microusd)===1000000&&Number(ledger[0].reserved_microusd)+Number(ledger[0].spent_microusd)+total<=1000000);report.ledger_before=ledger[0];apiKey=await speechKey();
  const env={VYAKTI_MODEL_SERVING:'azure_only',AZURE_REPLICA_BUDGET_ID:p.budget_id,AZURE_REPLICA_APP_BUDGET_USD:'1',AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR:'0.36'};
  for(const c of p.clips){
   need(!deadlineController.signal.aborted);
   const input={artifact_id:c.id,sha256:c.wav_sha256,duration_ms:c.duration_ms,mime:'audio/wav',byte_size:44+c.sample_count*2,start_ms:0,end_ms:c.duration_ms};let called=false,reservation;const item={id:c.id,state:'started'};
   const adapter=createAzureFastTranscriptionAdapter({env,endpoint:p.endpoint,apiKey,locales:c.locales,maxInputs:1,maxInputBytes:2000000,maxResponseBytes:1048576,timeoutMs:60000,resolveInput:async()=>({body:readFileSync(resolve(H,c.wav_path)),mime:'audio/wav'}),fetchImpl:async(url,init)=>{
    need(called&&url===p.endpoint+'speechtotext/transcriptions:transcribe?api-version=2025-10-15'&&init.method==='POST'&&report.posts<12);report.posts++;
    const response=await fetch(url,init);const copy=response.clone();const reader=copy.body?.getReader(),chunks=[];let n=0;
    if(reader)try{while(true){const r=await reader.read();if(r.done)break;n+=r.value.length;if(n>1048576){await reader.cancel();throw Error('asr106_raw_response_too_large');}chunks.push(Buffer.from(r.value));}}finally{reader.releaseLock();}
    item.raw_receipt_sha256=save(`voice-asr106-${c.id}-raw.json`,{http_status:response.status,body_utf8:Buffer.concat(chunks).toString('utf8')});return response;
   }});
   try{
    reservation=await meter.reserveAzureSpeechSpend(db,{requestKey:'stock106-intelligibility-v1:'+c.id,adapter,inputs:[input],env});need(reservation.reserved_microusd===c.reserved_microusd);save(`voice-asr106-${c.id}-intent.json`,{reservation_id:reservation.reservation_id,request_hash:reservation.request_hash,reserved_microusd:reservation.reserved_microusd,wav_sha256:c.wav_sha256});
    const response=await adapter.transcribe({source:{},inputs:[input],signal:deadlineController.signal,billing:{beforeProviderRequest:async()=>{need(!called);await meter.beginProviderSpend(db,reservation);called=true;}}});
    await meter.settleAzureSpeechSpend(db,reservation,response.usage);report.settled_microusd+=c.reserved_microusd;
    const transcript=response.segments.map(s=>s.text).join(' ');Object.assign(item,{state:'settled',usage:response.usage,segments:response.segments,transcript,expected_text:c.expected_text,disclosure_text:c.disclosure_text,screen:intelligibility(c.expected_text,transcript,c.disclosure_text)});
   }catch{if(reservation){if(called)await meter.markProviderSpendUncertain(db,reservation,'asr106_outcome_unknown');else await meter.releaseProviderSpendBeforeCall(db,reservation,'asr106_not_dispatched');}item.state='failed_or_unknown_no_retry';throw Error('asr106_cell_failed');}
   finally{report.clips.push(item);save(`voice-asr106-${c.id}-result.json`,item);}
  }
  report.ledger_after=await db('select budget_id,limit_microusd::text,reserved_microusd::text,spent_microusd::text,state from vy_provider_budget where budget_id=$1',[p.budget_id]);report.state='twelve_asr_responses_measured';
 }catch{report.state='stopped_failed_or_unknown_no_retry';process.exitCode=1;}
 finally{clearTimeout(deadlineTimer);apiKey=null;save('voice-asr106-screen-result.json',report);console.log(JSON.stringify({state:report.state,posts:report.posts,settled_microusd:report.settled_microusd,likeness_measured:false}));}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(()=>{console.error('asr106_refused');process.exitCode=1;});
