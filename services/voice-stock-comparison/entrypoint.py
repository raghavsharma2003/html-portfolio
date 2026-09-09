"""Fixed synthetic workload inside an admitted Manual Job. No HTTP server/client.

Inputs are baked in the immutable overlay. The only execution input is the
existing supervisor's allocation-window marker. Output is a bounded, hashed
JSONL artifact stream, never an owner or transport-authorization receipt.
"""
from __future__ import annotations
import asyncio, base64, contextlib, hashlib, importlib, io, json, os, re, secrets, socket, sys, time, wave, zlib
from pathlib import Path

ROOT=Path('/opt/vyakti-stock')
STOCK_SHA='16636b6e06d0e7145fad3cab3ac5d85409f84e527c23a2189fb3c79b85738cf6'
PREFIX='VYAKTI_STOCK106 '
def sha(value): return hashlib.sha256(value).hexdigest()
def canonical(value): return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def refuse(code): raise ValueError(code)

def load_inputs(root=ROOT):
    manifest=json.loads((root/'manifest.json').read_text(encoding='utf8'))
    if manifest.get('contract')!='vyakti-stock-job106/v1' or manifest.get('arm') not in ('chatterbox','voxcpm2'): refuse('stock_manifest_invalid')
    if manifest.get('scope')!={'purpose':'synthetic_stock_comparison','humanOwner':False,'releaseEligible':False,'trainingAllowed':False,'identityClaimAllowed':False}: refuse('stock_scope_invalid')
    if manifest.get('entrypointSha256')!=sha((root/'entrypoint.py').read_bytes()): refuse('stock_entrypoint_changed')
    if sha(canonical(manifest.get('policy')))!=manifest.get('policySha256'): refuse('stock_policy_changed')
    if not re.fullmatch('[0-9a-f]{64}',manifest.get('planSha256','')): refuse('stock_plan_invalid')
    audio=(root/'stock.wav').read_bytes()
    if sha(audio)!=STOCK_SHA or len(audio)!=1277444: refuse('stock_reference_changed')
    with wave.open(io.BytesIO(audio),'rb') as w:
        if (w.getnchannels(),w.getsampwidth(),w.getframerate(),w.getnframes())!=(1,2,24000,638700): refuse('stock_reference_geometry')
    requests=json.loads((root/'requests.json').read_text(encoding='utf8'))
    if sha(canonical(requests))!=manifest.get('requestsSha256') or len(requests)!=6: refuse('stock_requests_changed')
    seen=set()
    for row in requests:
        p=row['payload']
        if row['cellId'] in seen or p.get('reference_sha256')!=STOCK_SHA or p.get('reference_audio_base64') is not None: refuse('stock_request_binding')
        if sha(p.get('text','').encode())!=row.get('textSha256') or any(k.startswith('adapter_') for k in p): refuse('stock_request_text_or_adapter')
        if manifest['arm']=='voxcpm2' and (p.get('clone_mode')!='reference_only' or p.get('reference_text') is not None): refuse('stock_reference_only_required')
        seen.add(row['cellId'])
    return manifest,requests,audio

def validate_result(manifest,row,result):
    p=row['payload']
    pcm=base64.b64decode(result.get('audio_base64',''),validate=True)
    if not pcm or len(pcm)>24000*2*30 or len(pcm)%2: refuse('stock_output_geometry')
    if result.get('output_sha256')!=sha(pcm) or result.get('request_id')!=p['request_id'] or result.get('reference_sha256')!=STOCK_SHA: refuse('stock_output_binding')
    if result.get('sample_rate')!=24000 or result.get('channels')!=1 or result.get('encoding')!='pcm_s16le': refuse('stock_output_format')
    if result.get('perth_watermark_verified') is not True or result.get('model_commitment')!=manifest['modelCommitment']: refuse('stock_output_model_or_protection')
    score=result.get('perth_score')
    if isinstance(score,bool) or not isinstance(score,(int,float)) or not 0.5<=score<=1.0: refuse('stock_output_perth_score')
    if result.get('reference_duration_ms')!=26612 or result.get('duration_ms')!=round(len(pcm)*1000/48000): refuse('stock_output_duration')
    if any(k.startswith('adapter_') for k in result): refuse('stock_output_adapter')
    if manifest['arm']=='voxcpm2':
        if result.get('consent_receipt_sha256') is not None or result.get('clone_mode')!='reference_only' or result.get('reference_text_sha256') is not None: refuse('stock_vox_owner_or_transcript')
        disclosure='यह एआई से बनाई गई आवाज़ की प्रतिकृति है।' if p['language_id']=='hi' else 'This is an AI-generated voice replica.'
        if result.get('spoken_disclosure')!=disclosure: refuse('stock_vox_disclosure')
        for key in ['text_sha256','generation_id','evaluation_scope','identity_scope','release_eligible','third_party_policy_receipt_sha256']:
            expected=row['textSha256'] if key=='text_sha256' else p[key]
            if result.get(key)!=expected: refuse('stock_vox_provenance')
    else:
        for key in ['text_plan_sha256','text_segment_index','text_segment_count','disclosure_text','disclosure_language_id']:
            if result.get(key)!=p[key]: refuse('stock_chatter_provenance')
    return {**result,'cell_id':row['cellId'],'source_text_sha256':row['textSha256'],
      'job_scope':manifest['scope'],'plan_sha256':manifest['planSha256'],
      'synthetic_policy_sha256':manifest['policySha256'],'transport':'admitted_manual_gpu_job_not_http',
      'browser_delivery_qualified':False}

def emit_result(result,stream=sys.stdout):
    packed=zlib.compress(canonical(result),9)
    encoded=base64.b64encode(packed).decode()
    chunks=[encoded[i:i+3000] for i in range(0,len(encoded),3000)]
    artifact=sha(packed)
    for i,part in enumerate(chunks):
        stream.write(PREFIX+json.dumps({'kind':'chunk','artifact':artifact,'index':i,'total':len(chunks),'data':part},separators=(',',':'))+'\n')
    stream.write(PREFIX+json.dumps({'kind':'complete','artifact':artifact,'cellId':result['cell_id'],'chunks':len(chunks)},separators=(',',':'))+'\n')
    stream.flush()
    return artifact

def forbid_network():
    def denied(*args,**kwargs): refuse('stock_job_network_forbidden')
    socket.socket.connect=denied
    socket.socket.connect_ex=denied
    socket.create_connection=denied

async def execute(manifest,requests,audio,window_id,load_runtime=None,stream=sys.stdout):
    if not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',window_id or ''): refuse('stock_job_window_missing')
    if manifest['arm']=='voxcpm2':
        os.environ['VOXCPM2_HMAC_SECRET']=secrets.token_hex(32)
        runtime_dir='/srv/voxcpm2'
    else:
        os.environ['OPEN_VOICE_HMAC_SECRET']=secrets.token_hex(32)
        os.environ['OPEN_VOICE_MODEL_ARM']='general'
        runtime_dir='/srv/open-voice'
    # Ephemeral internal secret satisfies unmodified app startup; no HMAC is
    # exposed or claimed as independent authorization. No network listener runs.
    os.environ['HF_HUB_OFFLINE']='1';os.environ['TRANSFORMERS_OFFLINE']='1'
    sys.path.insert(0,runtime_dir)
    if load_runtime is None:
        files=manifest.get('runtimeFiles',[])
        expected=['app.py','lora.py','hindi_pack.py','offline_assets.py'] if manifest['arm']=='chatterbox' else ['app.py','contract.py']
        if [f.get('path') for f in files]!=[runtime_dir+'/'+name for name in expected]: refuse('stock_runtime_manifest_invalid')
        if any(sha(Path(f['path']).read_bytes())!=f['sha256'] for f in files): refuse('stock_runtime_changed')
        forbid_network()
        runtime=importlib.import_module('app')
    else: runtime=load_runtime(manifest['arm'])  # CPU fixtures only.
    artifacts=[]
    async with runtime.lifespan(runtime.app):
        if runtime.app.state.model_commitment!=manifest['modelCommitment']: refuse('stock_loaded_model_changed')
        for row in requests:
            payload={**row['payload'],'reference_audio_base64':base64.b64encode(audio).decode()}
            value=runtime._request(payload) if manifest['arm']=='chatterbox' else runtime.validate_payload(payload)
            started=time.monotonic()
            async with runtime.app.state.gpu_lock:
                result=await asyncio.to_thread(runtime._synthesize_sync,value)
            result=validate_result(manifest,row,result)
            result.update(allocation_window_id=window_id,job_call_elapsed_ms=round((time.monotonic()-started)*1000))
            artifacts.append(emit_result(result,stream))
    stream.write(PREFIX+json.dumps({'kind':'job_complete','windowId':window_id,'planSha256':manifest['planSha256'],
      'arm':manifest['arm'],'artifacts':artifacts,'calls':len(artifacts),'retries':0,'ownerIdentityClaim':False},separators=(',',':'))+'\n')
    stream.flush()

if __name__=='__main__':
    try:
        m,r,a=load_inputs()
        asyncio.run(execute(m,r,a,os.environ.get('VYAKTI_GPU_WINDOW_ID','')))
    except Exception as error:
        # Never emit raw model exceptions, audio or secret values in errors.
        code=str(error) if re.fullmatch('stock_[a-z_]+',str(error)) else 'stock_job_failed'
        print(PREFIX+json.dumps({'kind':'failed','code':code}),flush=True)
        raise SystemExit(1)
