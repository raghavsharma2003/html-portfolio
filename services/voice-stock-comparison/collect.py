"""Offline artifact extraction from an operator-captured exact Job log.

Does not establish Azure log origin. The supervising run must retain its own
authenticated execution/log capture receipt. No browser qualification here.
"""
import base64, hashlib, json, sys, zlib
from pathlib import Path
from entrypoint import PREFIX, validate_result, load_inputs, sha

def collect(log,manifest,requests,window_id):
    if len(log.encode())>24*1024*1024: raise ValueError('stock_log_oversized')
    groups={};complete={};terminal=None
    for line in log.splitlines():
        if PREFIX not in line: continue
        row=json.loads(line.split(PREFIX,1)[1])
        if row['kind']=='failed': raise ValueError('stock_job_reported_failure')
        if row['kind']=='job_complete':
            if terminal is not None: raise ValueError('stock_duplicate_terminal')
            terminal=row;continue
        if row['kind']=='complete':
            if row['artifact'] in complete: raise ValueError('stock_duplicate_complete')
            complete[row['artifact']]=row;continue
        if row['kind']!='chunk': raise ValueError('stock_log_record_invalid')
        if not isinstance(row['total'],int) or not 1<=row['total']<=1500 or not isinstance(row['index'],int) or not 0<=row['index']<row['total'] or len(row['data'])>3000: raise ValueError('stock_chunk_invalid')
        group=groups.setdefault(row['artifact'],{'total':row['total'],'parts':{}})
        if group['total']!=row['total'] or row['index'] in group['parts']: raise ValueError('stock_chunk_conflict')
        group['parts'][row['index']]=row['data']
    if not terminal or terminal.get('windowId')!=window_id or terminal.get('arm')!=manifest['arm'] or terminal.get('planSha256')!=manifest['planSha256'] or terminal.get('calls')!=6 or terminal.get('retries')!=0 or terminal.get('ownerIdentityClaim') is not False: raise ValueError('stock_terminal_invalid')
    if len(terminal.get('artifacts',[]))!=6 or len(set(terminal['artifacts']))!=6 or set(terminal['artifacts'])!=set(groups) or set(groups)!=set(complete): raise ValueError('stock_artifact_set_invalid')
    results=[]
    for artifact,row in zip(terminal['artifacts'],requests):
        group=groups[artifact]
        if len(group['parts'])!=group['total'] or complete[artifact].get('chunks')!=group['total'] or complete[artifact].get('cellId')!=row['cellId']: raise ValueError('stock_chunks_incomplete')
        packed=base64.b64decode(''.join(group['parts'][i] for i in range(group['total'])),validate=True)
        if sha(packed)!=artifact: raise ValueError('stock_artifact_hash_changed')
        decoder=zlib.decompressobj();raw=decoder.decompress(packed,4*1024*1024+1)
        if len(raw)>4*1024*1024 or not decoder.eof or decoder.unused_data or decoder.unconsumed_tail: raise ValueError('stock_artifact_inflate_invalid')
        result=json.loads(raw)
        if result.get('cell_id')!=row['cellId'] or result.get('allocation_window_id')!=window_id or result.get('plan_sha256')!=manifest['planSha256'] or result.get('synthetic_policy_sha256')!=manifest['policySha256']: raise ValueError('stock_artifact_scope_changed')
        if result.get('job_scope')!=manifest['scope'] or result.get('source_text_sha256')!=row['textSha256'] or result.get('browser_delivery_qualified') is not False or result.get('transport')!='admitted_manual_gpu_job_not_http': raise ValueError('stock_artifact_scope_changed')
        validate_result(manifest,row,result)
        results.append(result)
    return results

if __name__=='__main__':
    # One output document keeps validation all-or-nothing and avoids partially
    # accepted WAVs after a late missing terminal/chunk failure.
    root,log_path,window_id,out=map(str,sys.argv[1:])
    manifest,requests,_=load_inputs(Path(root))
    results=collect(Path(log_path).read_text(encoding='utf8'),manifest,requests,window_id)
    with open(out,'x',encoding='utf8') as file:
        json.dump({'contract':'stock106-collected/v1','logSha256':sha(Path(log_path).read_bytes()),
          'azureCaptureAuthenticatedByThisTool':False,'browserDeliveryQualified':False,'results':results},file,separators=(',',':'))
