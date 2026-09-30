"""Exact one existing versioned Speech key read into a captured process pipe."""
import hashlib,json,os,re,sys,threading
from pathlib import Path
HERE=Path(__file__).resolve().parent
WANTED={'AZURE_SPEECH_KEY'}
def need(ok):
    if not ok:raise ValueError('local_kv_refused')
def main():
    need(os.environ.get('VYAKTI_ASR106_PIPE')=='1' and not sys.stdout.isatty() and len(sys.argv)==1)
    session=None;output={}
    timer=threading.Timer(60,lambda:os._exit(124));timer.daemon=True;timer.start()
    try:
        refs={'AZURE_SPEECH_KEY':'https://vyakti-webpreview-kv1729.vault.azure.net/secrets/preview-speech-key/52d94b103abc47fc9f8f5a78e6bc885e'}
        for url in refs.values():need(re.fullmatch(r'https://vyakti-webpreview-kv1729\.vault\.azure\.net/secrets/[a-z0-9-]+/[a-f0-9]{32}',url))
        source=(HERE/'azure-web38-readback.py').read_bytes();need(hashlib.sha256(source).hexdigest()=='6f2e85701f85ae1583e1b6d809624b03ce590a13c51ba90b9d371ca2c243efd9')
        auth=type(sys)('processing204_storage_auth');auth.__file__=str(HERE/'azure-web38-readback.py');exec(compile(source,auth.__file__,'exec'),auth.__dict__)
        session,token,_=auth.authenticate('https://vault.azure.net/.default')
        for url in sorted(set(refs.values())):
            status,body=auth.bounded(session,token,'GET',url+'?api-version=7.4')
            try:
                need(status==200 and body.get('id')==url and isinstance(body.get('value'),str) and 0<len(body['value'])<=32768)
                for name,ref in refs.items():
                    if ref==url:output[name]=body['value']
            finally:body.clear()
        need(set(output)==WANTED)
        sys.stdout.write(json.dumps(output,separators=(',',':')));sys.stdout.flush()
    finally:
        output.clear()
        try:
            if session is not None:session.close()
        finally:timer.cancel()
if __name__=='__main__':
    try:main()
    except Exception:sys.exit(1)
