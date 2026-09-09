"""CPU contract/execution-control tests. Model generation is an explicit fake.
Chatterbox AST functions execute unchanged; only sf.info uses stdlib WAV
metadata when soundfile is unavailable. No model/GPU/HTTP imports or calls.
"""
import ast, asyncio, base64, contextlib, copy, hashlib, importlib.util, io, json, math, re, sys, types, uuid, wave
from pathlib import Path
root=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(root/'services/voice-stock-comparison'))
import entrypoint as job
from collect import collect

def chatter_contract():
    source=root/'services/open-voice-runtime/app.py'
    tree=ast.parse(source.read_text(encoding='utf8'))
    names={'ServiceError','_sha','_finite','_reference','_adapter','_script_mode','_language_conditioning','_request'}
    constants={'TEXT_FRONTEND_CONTRACT','CONDITIONING_CONTRACT','DISCLOSURES','DISCLOSURE_PREFIX','SUPPORTED_LANGUAGES','UUID_RE','SHA_RE','MAX_REFERENCE_BYTES','MAX_ADAPTER_BYTES','ADAPTER_ID_RE','LANGUAGE_MODES'}
    nodes=[n for n in tree.body if (isinstance(n,(ast.FunctionDef,ast.ClassDef)) and n.name in names)
      or (isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id in constants for t in n.targets))]
    def info(file):
        with wave.open(file,'rb') as w:return types.SimpleNamespace(duration=w.getnframes()/w.getframerate(),format='WAV',channels=w.getnchannels(),samplerate=w.getframerate())
    scope={'Any':object,'hashlib':hashlib,'re':re,'base64':base64,'io':io,'math':math,'uuid':uuid,
      'sf':types.SimpleNamespace(info=info),'app':types.SimpleNamespace(state=types.SimpleNamespace(model_arm='general'))}
    module=ast.Module(body=[ast.ImportFrom(module='__future__',names=[ast.alias(name='annotations')],level=0),*nodes],type_ignores=[])
    exec(compile(ast.fix_missing_locations(module),str(source),'exec'),scope)
    return scope

def vox_contract():
    spec=importlib.util.spec_from_file_location('stock_vox_contract',root/'services/voxcpm2-runtime/contract.py')
    module=importlib.util.module_from_spec(spec);sys.modules[spec.name]=module;spec.loader.exec_module(module);return module

contexts=Path(sys.argv[1]);checks=0
def check(name,fn):
    global checks
    fn();checks+=1;print('ok',checks,name)
ch=chatter_contract();vox=vox_contract()
all_data={arm:job.load_inputs(contexts/arm) for arm in ['chatterbox','voxcpm2']}
def wire(row,audio):return {**row['payload'],'reference_audio_base64':base64.b64encode(audio).decode()}
def validates():
    for arm,(manifest,rows,audio) in all_data.items():
        for row in rows:
            value=ch['_request'](wire(row,audio)) if arm=='chatterbox' else vox.validate_payload(wire(row,audio))
            assert (value['reference_duration_ms'] if arm=='chatterbox' else value['reference'].duration_ms)==26612
check('all12 exact payloads pass unchanged runtime contracts with full stock WAV',validates)
def refusals():
    m,rows,a=all_data['voxcpm2'];base=wire(rows[0],a)
    for patch in [{'release_eligible':True},{'training_allowed':True},{'identity_claim_allowed':True},
      {'consent_receipt_sha256':'a'*64},{'third_party_policy_receipt_sha256':None},
      {'text':vox.DISCLOSURES['hi']+' Namaste yeh Hindi hai.'}]:
        try:vox.validate_payload({**base,**patch})
        except vox.ServiceError:pass
        else:raise AssertionError('unsafe Vox payload accepted')
check('existing Vox scope, forged-owner, absent-policy and Roman-Hindi refusals',refusals)
def chatter_scope():
    m,rows,a=all_data['chatterbox'];p=wire(rows[0],a)
    first=ch['_request'](p);second=ch['_request']({**p,'release_eligible':True,'evaluation_scope':'verified_owner_identity'})
    assert first==second and 'evaluation_scope' not in first
check('Chatter runtime scope fields do not provide authority; Job envelope must carry it',chatter_scope)

def output(manifest,row):
    p=row['payload'];pcm=bytes(48000)
    value={'request_id':p['request_id'],'audio_base64':base64.b64encode(pcm).decode(),'output_sha256':job.sha(pcm),
      'sample_rate':24000,'channels':1,'encoding':'pcm_s16le','duration_ms':1000,'elapsed_ms':5,'reference_duration_ms':26612,
      'reference_sha256':job.STOCK_SHA,'model_commitment':manifest['modelCommitment'],'perth_watermark_verified':True,'perth_score':1.0}
    fields=['generation_id','evaluation_scope','identity_scope','release_eligible','third_party_policy_receipt_sha256'] if manifest['arm']=='voxcpm2' else ['text_plan_sha256','text_segment_index','text_segment_count','disclosure_text','disclosure_language_id']
    value.update({k:p[k] for k in fields})
    if manifest['arm']=='voxcpm2':value.update(text_sha256=row['textSha256'],clone_mode='reference_only',reference_text_sha256=None,
      consent_receipt_sha256=None,spoken_disclosure=vox.DISCLOSURES[p['language_id']])
    return value

def fake_runtime(manifest,rows,fail_at=None):
    calls=[]
    @contextlib.asynccontextmanager
    async def life(app):yield
    def validate(p):return p
    def synthesize(p):
        index=len(calls);calls.append(p)
        if index==fail_at:raise ValueError('stock_fixture_failure')
        return output(manifest,rows[index])
    runtime=types.SimpleNamespace(app=types.SimpleNamespace(state=types.SimpleNamespace(model_commitment=manifest['modelCommitment'],gpu_lock=asyncio.Lock())),
      lifespan=life,_request=validate,validate_payload=validate,_synthesize_sync=synthesize)
    return runtime,calls
window='00000106-0000-4000-a000-000000000002'
def execution_and_collection():
    for arm,(m,rows,a) in all_data.items():
        runtime,calls=fake_runtime(m,rows);stream=io.StringIO()
        asyncio.run(job.execute(m,rows,a,window,load_runtime=lambda _:runtime,stream=stream))
        log=stream.getvalue();results=collect(log,m,rows,window)
        (contexts/arm/'cpu-fixture.log').write_text(log,encoding='utf8')
        assert len(calls)==len(results)==6 and all(r['job_scope']['humanOwner'] is False for r in results)
        for bad in [log.rsplit(job.PREFIX,1)[0],log.replace('"index":0','"index":1',1),log.replace('"retries":0','"retries":1',1),log+log.splitlines()[0]+'\n']:
            try:collect(bad,m,rows,window)
            except (ValueError,KeyError):pass
            else:raise AssertionError('damaged output stream accepted')
check('two six-call CPU fixture executions and exact artifact collection; missing/duplicate/tampered logs refuse',execution_and_collection)
def failed_run():
    m,rows,a=all_data['chatterbox'];runtime,calls=fake_runtime(m,rows,fail_at=1)
    try:asyncio.run(job.execute(m,rows,a,window,load_runtime=lambda _:runtime,stream=io.StringIO()))
    except ValueError as e:assert str(e)=='stock_fixture_failure'
    else:raise AssertionError('failure hidden')
    assert len(calls)==2
check('generation failure stops batch without retry or later calls',failed_run)
def negatives():
    m,rows,a=all_data['chatterbox'];result=output(m,rows[0])
    for patch in [{'output_sha256':'a'*64},{'model_commitment':'b'*64},{'perth_watermark_verified':False},
      {'reference_duration_ms':26613},{'adapter_sha256':'c'*64},{'disclosure_text':'different'},
      {'audio_base64':base64.b64encode(bytes(48000*31)).decode()}]:
        try:job.validate_result(m,rows[0],{**result,**patch})
        except ValueError:pass
        else:raise AssertionError('bad receipt accepted')
check('wrong output/model/reference/disclosure/adapter/protection and over30s refuse',negatives)
print(json.dumps({'groups':checks,'runtimePayloadsValidated':12,'modelCalls':0,'GPUCalls':0,'scope':'CPU fixture synthesis; actual pure runtime validation, WAV metadata adapter for Chatterbox sf.info'}))
