"""Bounded read-only source/readability checks. Never outputs secret material."""
import argparse
import importlib.util
import hashlib
import json
from pathlib import Path
from urllib.parse import urlsplit

AUTH_SHA = '6f2e85701f85ae1583e1b6d809624b03ce590a13c51ba90b9d371ca2c243efd9'
RG = '/subscriptions/c60a32f6-c812-4c0e-bc42-b6431ee90b8f/resourceGroups/vyakti-voice'
VAULT = 'https://vyakti-webpreview-kv1729.vault.azure.net'

def main(args):
    path = Path(args.auth_helper).resolve()
    if hashlib.sha256(path.read_bytes()).hexdigest() != AUTH_SHA:
        raise ValueError('helper_changed')
    spec = importlib.util.spec_from_file_location('private_voice_secret_read_auth', path)
    auth = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth)
    output = {'resource_writes': 0, 'secret_values_output': 0, 'secret_hashes_output': 0, 'requests': []}
    session, token, _ = auth.authenticate()
    values = {}
    try:
        for name, kind in [('vyakti-internal-voice25', 'containerApps'), ('vyakti-open-voice-hi-gate', 'containerApps'),
                           ('vyakti-open-voice-hi', 'containerApps'), ('vyakti-replica-processing', 'jobs')]:
            status, body = auth.bounded(session, token, 'POST', auth.ARM + RG + '/providers/Microsoft.App/' + kind + '/' + name + '/listSecrets?api-version=2025-07-01')
            output['requests'].append({'resource': name, 'operation': 'listSecrets', 'http_status': status})
            values[name] = {v['name']: v.get('value') for v in body.get('value', [])} if status == 200 else {}
        voice = [values['vyakti-internal-voice25'].get('open-voice-hmac'), values['vyakti-open-voice-hi-gate'].get('bench-hmac'), values['vyakti-open-voice-hi'].get('bench-hmac')]
        output['voice_hmac_cpu_broker_gpu_match'] = all(isinstance(v, str) and bool(v) for v in voice) and len(set(voice)) == 1
        storage = [values['vyakti-internal-voice25'].get('storage-key'), values['vyakti-replica-processing'].get('azure-replica-storage-key')]
        output['storage_key_cpu_processing_match'] = all(isinstance(v, str) and bool(v) for v in storage) and len(set(storage)) == 1
        neon = values['vyakti-replica-processing'].get('neon-url')
        parsed = urlsplit(neon or '')
        if parsed.scheme not in ('postgres', 'postgresql') or not (parsed.hostname or '').endswith('.neon.tech') or parsed.path != '/neondb':
            raise ValueError('expected_database_unavailable')
        query = "select budget_id,state,limit_microusd,spent_microusd,reserved_microusd from vy_provider_budget where budget_id like 'gpu-%' order by budget_id limit 50"
        for name, sql in [('gpu_budgets', query), ('private_schema', "select current_database() database,to_regclass('public.vy_private_voice_run') is not null private_voice_present")]:
            with session.request('POST', 'https://' + parsed.hostname + '/sql', headers={'Neon-Connection-String': neon, 'Content-Type': 'application/json'},
                                 json={'query': sql, 'params': []}, allow_redirects=False) as response:
                output['requests'].append({'resource': 'expected-neondb', 'operation': name, 'http_status': response.status_code})
                if response.status_code == 200:
                    output[name] = response.json().get('rows', [])
                else:
                    output[name] = None
        values.clear()
        neon = None
    finally:
        session.close()
    session, token, _ = auth.authenticate('https://vault.azure.net/.default')
    try:
        status, metadata = auth.bounded(session, token, 'GET', VAULT + '/secrets?api-version=7.4&maxresults=25')
        output['requests'].append({'resource': 'vyakti-webpreview-kv1729', 'operation': 'secret-metadata', 'http_status': status})
        if status != 200 or metadata.get('nextLink'):
            raise ValueError('vault_metadata_incomplete')
        selected = [v for v in metadata.get('value', []) if v.get('id', '').rsplit('/', 1)[-1] in
                    {'web-watermark-token-key', 'web-replica-commitment-key', 'web-cron-secret'}]
        output['vault_sources'] = []
        for item in selected:
            name = item['id'].rsplit('/', 1)[-1]
            status, body = auth.bounded(session, token, 'GET', VAULT + '/secrets/' + name + '?api-version=7.4')
            output['requests'].append({'resource': name, 'operation': 'secret-read', 'http_status': status})
            output['vault_sources'].append({'name': name, 'enabled': body.get('attributes', {}).get('enabled'),
                'readable': status == 200 and isinstance(body.get('value'), str) and bool(body['value']), 'versioned_reference': body.get('id')})
            body = None
        output['vault_cron_name_candidates'] = [v['id'].rsplit('/', 1)[-1] for v in metadata.get('value', []) if 'cron' in v.get('id', '').rsplit('/', 1)[-1]]
    finally:
        session.close()
    destination = Path(args.out).resolve()
    if 'scratchpad' not in destination.parts or destination.exists():
        raise ValueError('new_scratchpad_output_required')
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'state': 'complete', 'report': str(destination), 'requests': len(output['requests']), 'resource_writes': 0, 'secret_values_output': 0, 'secret_hashes_output': 0}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-helper', required=True)
    parser.add_argument('--out', required=True)
    try:
        main(parser.parse_args())
    except Exception as error:
        print(json.dumps({'state': 'incomplete', 'error_type': type(error).__name__, 'resource_writes': 0, 'secret_values_output': 0}))
        raise SystemExit(1)
