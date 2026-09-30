"""Read-only Azure metadata and optional secret readability, never values.

Uses the existing pinned operator API helper. No CLI/browser sign-in, resource
write, GPU runtime request, lifecycle action or migration exists in this tool.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import time

AUTH_SHA = '6f2e85701f85ae1583e1b6d809624b03ce590a13c51ba90b9d371ca2c243efd9'
VERCEL_HELPER_SHA = '4c81fc85a2fc1d45d6c4740705d23a615ba8e6657eb9ea46eec2e80a443cccf9'
SUB = 'c60a32f6-c812-4c0e-bc42-b6431ee90b8f'
RG = '/subscriptions/' + SUB + '/resourceGroups/vyakti-voice'
ARM = 'https://management.azure.com'
API = '2025-07-01'
CPU = RG + '/providers/Microsoft.App/containerApps/vyakti-internal-voice25'
GPU = RG + '/providers/Microsoft.App/containerApps/vyakti-open-voice-hi'
UMI = RG + '/providers/Microsoft.ManagedIdentity/userAssignedIdentities/vyakti-internal-voice25-id'
ROLE = '/subscriptions/' + SUB + '/providers/Microsoft.Authorization/roleDefinitions/b9ee16fd-4ff7-5d8d-825e-fe5c7593c1c6'
ASSIGNMENT = GPU + '/providers/Microsoft.Authorization/roleAssignments/8cb12aaa-d543-5276-90cb-199f8a535b5c'
REQUIRED = ['NEON_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'VYAKTI_PRIVATE_VOICE_MODE', 'VYAKTI_MODEL_SERVING',
 'AZURE_OPEN_VOICE_ORIGIN', 'OPEN_VOICE_MODEL_ARM', 'OPEN_VOICE_HMAC_SECRET', 'AZURE_VOICE_APP_ENABLED',
 'AZURE_VOICE_APP_PLAN_JSON', 'AZURE_VOICE_APP_POLICY_JSON', 'AZURE_VOICE_APP_APPROVAL_SHA256',
 'AZURE_VOICE_APP_BUDGET_ID', 'AZURE_VOICE_APP_IDENTITY_CLIENT_ID', 'AZURE_VOICE_APP_SUPERVISOR_ENABLED',
 'CRON_SECRET', 'AZURE_REPLICA_STORAGE_ACCOUNT', 'AZURE_REPLICA_STORAGE_ACCOUNT_KEY', 'AZURE_REPLICA_STORAGE_CONTAINER',
 'AZURE_AUDIO_PROTECTION_ORIGIN', 'AZURE_AUDIO_PROTECTION_HMAC_SECRET', 'REPLICA_WATERMARK_TOKEN_SECRET', 'REPLICA_COMMITMENT_SECRET']
SAFE_FLAGS = {'VYAKTI_PRIVATE_VOICE_MODE', 'VYAKTI_INTERNAL_VOICE_MODE', 'VYAKTI_MODEL_SERVING', 'OPEN_VOICE_MODEL_ARM',
 'AZURE_VOICE_APP_ENABLED', 'AZURE_VOICE_APP_SUPERVISOR_ENABLED', 'REPLICA_SELF_TEST_MODE'}

def require(value, code):
    if not value:
        raise ValueError(code)

def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()

def run(args):
    helper = Path(args.auth_helper).resolve()
    require(hashlib.sha256(helper.read_bytes()).hexdigest() == AUTH_SHA, 'auth_helper_changed')
    spec = importlib.util.spec_from_file_location('private_voice_readiness_auth', helper)
    auth = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(auth)
    session = None
    out = {'schema': 'private-voice-readiness27/v1', 'observed_at_epoch': time.time(), 'resource_writes': 0,
           'gpu_runtime_calls': 0, 'model_calls': 0, 'secret_values_output': 0, 'secret_list_reads': 0, 'requests': []}
    try:
        session, token, _ = auth.authenticate()
        def request(resource, version=API, method='GET'):
            require(method == 'GET' or (method == 'POST' and args.check_readable_secrets and resource.endswith('/listSecrets')), 'read_only_method_refused')
            status, value = auth.bounded(session, token, method, ARM + resource + '?api-version=' + version)
            out['requests'].append({'resource': resource, 'method': method, 'http_status': status})
            return status, value
        status, listed = request(RG + '/providers/Microsoft.App/containerApps')
        require(status == 200 and not listed.get('nextLink'), 'app_inventory_incomplete')
        # Full provider responses stay in memory; only narrow names/metadata are serialized.
        selected = [r for r in listed.get('value', []) if r.get('name') in
                    {'vyakti-internal-voice25', 'vyakti-open-voice-hi', 'vyakti-open-voice-hi-gate'}
                    or 'protection' in r.get('name', '')]
        status, job = request(RG + '/providers/Microsoft.App/jobs/vyakti-replica-processing')
        if status == 200:
            selected.append(job)
        rows = []
        available = {}
        cpu_env = {}
        for raw in selected:
            props = raw.get('properties', {})
            config, template = props.get('configuration', {}), props.get('template', {})
            secret_names = {r.get('name') for r in config.get('secrets', [])}
            readable = None
            if args.check_readable_secrets and raw.get('id') != GPU:
                status, secrets = request(raw['id'] + '/listSecrets', method='POST')
                out['secret_list_reads'] += 1
                readable = {s.get('name'): bool(s.get('value')) for s in secrets.get('value', [])} if status == 200 else {}
                secrets = None
            containers = []
            for container in template.get('containers', []):
                bindings = []
                for item in container.get('env', []):
                    name, ref = item.get('name'), item.get('secretRef')
                    binding = {'name': name, 'kind': 'secretRef' if ref else 'inline',
                               'configured': ref in secret_names if ref else bool(item.get('value'))}
                    if ref:
                        binding['secret_name'] = ref
                        binding['readable'] = readable.get(ref, False) if readable is not None else None
                    else:
                        binding['readable'] = bool(item.get('value'))
                    bindings.append(binding)
                    available.setdefault(name, []).append({'resource': raw.get('name'), 'configured': binding['configured'], 'readable': binding['readable']})
                    if raw.get('id', '').lower() == CPU.lower():
                        cpu_env[name] = binding
                        if name == 'AZURE_VOICE_APP_POLICY_JSON':
                            policy = json.loads(item.get('value', '{}'))
                            out['current_cpu_policy'] = {k: policy.get(k) for k in ['budget_id', 'envelope_seconds', 'dispatch_seconds', 'rate_microusd_per_second', 'contingency_multiplier', 'limit_microusd', 'per_allocation_cap_microusd', 'hard_invoice_cap', 'supervisor_source_sha256']}
                        if name == 'AZURE_VOICE_APP_PLAN_JSON':
                            plan = json.loads(item.get('value', '{}'))
                            out['current_cpu_plan'] = {k: plan.get(k) for k in ['kind', 'app_id', 'revision_name', 'environment_id', 'runtime_origin', 'broker_origin', 'image', 'isolation_tag', 'template_sha256', 'revision_template_sha256', 'configuration_sha256', 'contract_sha256']}
                containers.append({'name': container.get('name'), 'image': container.get('image'),
                    'command': container.get('command'), 'args': container.get('args'),
                    'resources': container.get('resources'), 'bindings': bindings,
                    'nonsecret_flags': {v['name']: v.get('value') for v in container.get('env', []) if v['name'] in SAFE_FLAGS}})
            rows.append({'name': raw.get('name'), 'id': raw.get('id'), 'location': raw.get('location'),
                'environment_id': props.get('environmentId') or props.get('managedEnvironmentId'),
                'latest_revision': props.get('latestRevisionName'), 'provisioning_state': props.get('provisioningState'),
                'running_status': props.get('runningStatus'), 'workload_profile': props.get('workloadProfileName'),
                'identity': raw.get('identity'), 'ingress': {k: config.get('ingress', {}).get(k) for k in ['fqdn', 'external', 'targetPort']},
                'scale': {k: template.get('scale', {}).get(k) for k in ['minReplicas', 'maxReplicas']},
                'isolation_tag': raw.get('tags', {}).get('vyaktiIsolation'), 'containers': containers,
                'configuration_sha256': digest(config), 'template_sha256': digest(template),
                'registry_servers': [r.get('server') for r in config.get('registries', [])]})
        out['resources'] = rows
        out['required_bindings'] = [{'name': name, 'cpu': cpu_env.get(name), 'existing_sources': available.get(name, [])} for name in REQUIRED]
        status, jobs = request(RG + '/providers/Microsoft.App/jobs')
        require(status == 200 and not jobs.get('nextLink'), 'job_inventory_incomplete')
        out['supervisor_jobs'] = [{'name': j.get('name'), 'trigger_type': j.get('properties', {}).get('configuration', {}).get('triggerType'),
            'containers': [{'name': c.get('name'), 'image': c.get('image'), 'command': c.get('command')} for c in j.get('properties', {}).get('template', {}).get('containers', [])]}
            for j in jobs.get('value', []) if any(w in j.get('name', '') for w in ['supervisor', 'watchdog', 'internal-voice'])]
        status, revisions = request(GPU + '/revisions')
        require(status == 200 and not revisions.get('nextLink'), 'gpu_revision_inventory_incomplete')
        out['gpu_revisions'] = []
        for revision in revisions.get('value', []):
            status, replicas = request(GPU + '/revisions/' + revision['name'] + '/replicas')
            require(status == 200 and not replicas.get('nextLink'), 'gpu_replica_inventory_incomplete')
            out['gpu_revisions'].append({'name': revision['name'], 'active': revision.get('properties', {}).get('active'),
                'replicas': len(replicas.get('value', [])), 'template_sha256': digest(revision.get('properties', {}).get('template'))})
        for name, resource, version in [('identity', UMI, '2023-01-31'), ('role', ROLE, '2022-04-01'), ('assignment', ASSIGNMENT, '2022-04-01')]:
            status, value = request(resource, version)
            out[name] = {'http_status': status, 'id': value.get('id'), 'properties': value.get('properties') if status == 200 else None}
        out['state'] = 'read_complete'
    finally:
        if session:
            session.close()
    if args.vercel_helper:
        vercel_path = Path(args.vercel_helper).resolve()
        require(hashlib.sha256(vercel_path.read_bytes()).hexdigest() == VERCEL_HELPER_SHA, 'vercel_helper_changed')
        spec = importlib.util.spec_from_file_location('private_voice_vercel_readiness', vercel_path)
        vercel = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(vercel)
        token = vercel.load_token()
        envs = vercel.request(token, '/v9/projects/' + vercel.PROJECT + '/env?decrypt=false').get('envs', [])
        selected = [e for e in envs if e.get('key') in set(REQUIRED + ['VYAKTI_PRIVATE_VOICE_ORIGIN']) and 'preview' in e.get('target', [])]
        out['vercel_preview'] = []
        for item in selected:
            readable = None
            if args.check_readable_secrets:
                try:
                    value = vercel.request(token, '/v9/projects/' + vercel.PROJECT + '/env/' + item['id'] + '?decrypt=true')
                    readable = isinstance(value.get('value'), str) and bool(value['value'])
                    value = None
                except RuntimeError:
                    readable = False
            out['vercel_preview'].append({'name': item.get('key'), 'type': item.get('type'), 'targets': item.get('target'),
                                         'git_branch': item.get('gitBranch'), 'readable': readable})
        token = None
    output = Path(args.out).resolve()
    require('scratchpad' in output.parts and not output.exists(), 'new_scratchpad_output_required')
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(out, indent=2) + '\n', encoding='utf8')
    print(json.dumps({'state': out['state'], 'report': str(output), 'requests': len(out['requests']),
                      'resource_writes': 0, 'model_calls': 0, 'secret_values_output': 0, 'secret_list_reads': out['secret_list_reads']}))

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--auth-helper', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--check-readable-secrets', action='store_true')
    parser.add_argument('--vercel-helper')
    try:
        run(parser.parse_args())
    except Exception as error:
        # Never render remote response/URL/exception text or credential objects.
        print(json.dumps({'state': 'read_incomplete', 'error_type': type(error).__name__, 'resource_writes': 0, 'secret_values_output': 0}))
        raise SystemExit(1)
