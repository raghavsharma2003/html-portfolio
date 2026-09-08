import {createHash} from 'node:crypto';

export const API_VERSION = '2025-07-01';
// Fixed non-personal experiment. A caller cannot supply arbitrary commands.
// This proves GPU execution/control only, not model or owner voice quality.
export const GPU_PROBE = 'import json, torch; assert torch.cuda.is_available(), "cuda_unavailable"; x=torch.ones((256,256),device="cuda"); y=x@x; torch.cuda.synchronize(); assert y[0,0].item()==256; print(json.dumps({"kind":"vyakti-gpu-control-probe/v1","cuda":True,"tensor_check":True}))';
const ARM = 'https://management.azure.com';
const ID = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[a-zA-Z0-9_.()-]+\/providers\/Microsoft\.App\/jobs\/[a-zA-Z0-9_-]+$/;
const HASH = /^[0-9a-f]{64}$/;
const fail = code => { throw Object.assign(new Error(code), {code}); };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const commitment = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function isolatedJobPlan(input) {
  if (!ID.test(input?.jobId || '')) fail('gpu_job_id_invalid');
  const environmentPrefix = input.jobId.split('/providers/')[0] + '/providers/Microsoft.App/managedEnvironments/';
  if (!input.environmentId?.startsWith(environmentPrefix) || !/^[a-zA-Z0-9_-]+$/.test(input.environmentId.slice(environmentPrefix.length))) fail('gpu_environment_invalid');
  if (!/^[a-z0-9]+\.azurecr\.io\/[a-z0-9/_.-]+@sha256:[0-9a-f]{64}$/.test(input.image || '')) fail('gpu_immutable_image_required');
  if (!/^[a-zA-Z0-9_-]+$/.test(input.workloadProfileName || '')) fail('gpu_workload_profile_required');
  if (!Number.isSafeInteger(input.replicaTimeout) || input.replicaTimeout < 1 || input.replicaTimeout > 3600) fail('gpu_replica_timeout_invalid');
  // No ingress, external evidence origin, arbitrary startup arguments, env
  // overrides or private payloads are admitted to this deployment proposal.
  const properties = {
    environmentId: input.environmentId,
    workloadProfileName: input.workloadProfileName,
    configuration: {triggerType: 'Manual', replicaTimeout: input.replicaTimeout,
      replicaRetryLimit: 0, manualTriggerConfig: {parallelism: 1, replicaCompletionCount: 1},
      registries: [{server:input.image.split('/')[0],username:input.image.split('.')[0],passwordSecretRef:'registry-pull'}],
      secrets: [{name:'registry-pull'}]},
    template: {containers: [{name: 'comparison', image: input.image,
      command: ['python', '-c', GPU_PROBE],
      resources: {cpu: 8, memory: '56Gi'}, env: []}]},
  };
  return Object.freeze({kind: 'azure-isolated-gpu-job-plan/v1', job_id: input.jobId,
    location: 'centralindia', properties, template_sha256: commitment(properties.template),
    configuration_sha256: commitment(properties), activation_available: false,
    blocking_codes: ['gpu_experiment_budget_not_approved', 'gpu_private_registry_auth_not_deployed',
      'gpu_exclusive_start_authority_unproven', 'gpu_attributable_usage_unavailable']});
}

export function deploymentTemplate(plan) {
  validatePlan(plan);
  const properties=structuredClone(plan.properties);
  properties.configuration.secrets=[{name:'registry-pull',value:"[parameters('registryPassword')]"}];
  return {$schema: 'https://schema.management.azure.com/schemas/2019-04-01/deploymentTemplate.json#',
    contentVersion: '1.0.0.0',parameters:{registryPassword:{type:'secureString'}},
    resources: [{type: 'Microsoft.App/jobs', apiVersion: API_VERSION,
      name: plan.job_id.split('/').at(-1), location: plan.location, properties}]};
}

function validatePlan(plan) {
  if (plan?.kind !== 'azure-isolated-gpu-job-plan/v1' || !ID.test(plan.job_id || '')
    || plan.configuration_sha256 !== commitment(plan.properties)
    || plan.template_sha256 !== commitment(plan.properties?.template)) fail('gpu_job_plan_invalid');
  // Reconstruct the accepted configuration rather than accepting recomputed
  // hashes on an arbitrary ARM resource or changed command/parallelism.
  const expected = isolatedJobPlan({jobId: plan.job_id, environmentId: plan.properties.environmentId,
    workloadProfileName: plan.properties.workloadProfileName, image: plan.properties.template?.containers?.[0]?.image,
    replicaTimeout: plan.properties.configuration?.replicaTimeout});
  if (expected.configuration_sha256 !== plan.configuration_sha256 || plan.location !== expected.location) fail('gpu_job_plan_invalid');
}

export function inspectJobSnapshot(plan, resource, environment) {
  validatePlan(plan);
  if (resource?.id !== plan.job_id || resource.type?.toLowerCase() !== 'microsoft.app/jobs') fail('gpu_job_resource_mismatch');
  const p = resource.properties;
  if (!p || p.provisioningState !== 'Succeeded') fail('gpu_job_not_provisioned');
  // Ignore server metadata, but retain every execution-relevant template and
  // trigger field. Registry secrets compare by reviewed names and are supplied
  // only as secure deployment parameters, never as a returned credential.
  const configuration=structuredClone(p.configuration);
  // GET does not establish the secret value. Compare names, never return or
  // hash credentials; a differently named secret or Key Vault target refuses.
  if(configuration?.secrets?.some(s=>s.keyVaultUrl||s.identity))fail('gpu_registry_secret_binding_invalid');
  if(configuration?.secrets)configuration.secrets=configuration.secrets.map(s=>({name:s.name}));
  const observed = {environmentId: p.environmentId, workloadProfileName: p.workloadProfileName,
    configuration, template: p.template};
  if (commitment(observed) !== plan.configuration_sha256) fail('gpu_job_configuration_drift');
  if (environment?.id !== p.environmentId) fail('gpu_environment_mismatch');
  const profiles = environment.properties?.workloadProfiles || [];
  const matched = profiles.filter(v => v.name === p.workloadProfileName);
  if (matched.length !== 1 || matched[0].workloadProfileType !== 'Consumption-GPU-NC8as-T4') fail('gpu_consumption_t4_required');
  return {job_id: plan.job_id, configuration_sha256: plan.configuration_sha256,
    template_sha256: plan.template_sha256, runtime_timeout_seconds: p.configuration.replicaTimeout,
    activation_available: false, billing_bound_verified: false};
}

function executionName(name) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(name || '')) fail('gpu_execution_name_invalid');
  return name;
}

export function executionObservation(plan, name, executions) {
  validatePlan(plan);
  const id = `${plan.job_id}/executions/${executionName(name)}`;
  const rows = executions.filter(e => e.id === id && e.name === name);
  if (rows.length !== 1) return {execution_id: id, state: 'unknown', terminal: false, accounting_state: 'accounting_pending'};
  const row = rows[0], p = row.properties || {};
  if (commitment(p.template) !== plan.template_sha256) fail('gpu_execution_template_mismatch');
  const terminal = ['Succeeded', 'Failed', 'Stopped'].includes(p.status)
    && Number.isFinite(Date.parse(p.startTime)) && Number.isFinite(Date.parse(p.endTime))
    && Date.parse(p.endTime) >= Date.parse(p.startTime);
  // Execution status is not a meter receipt. Even terminal status never sets
  // allocation_terminated or accounted for the 147 settlement interface.
  return {execution_id: id, state: p.status || 'Unknown', terminal,
    configuration_sha256: plan.configuration_sha256, template_sha256: plan.template_sha256,
    accounting_state: 'accounting_pending', accounted: false};
}

export function createAzureJobInspector({plan, getToken, fetchImpl = globalThis.fetch}) {
  validatePlan(plan);
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') fail('gpu_arm_transport_required');
  async function request(path, method = 'GET') {
    // Only constructed resource paths are accepted. No ARM Location or
    // nextLink is followed automatically; no bearer crosses an origin.
    const token = await getToken();
    if (!token || /[\r\n]/.test(token)) fail('gpu_arm_token_unavailable');
    const res = await fetchImpl(`${ARM}${path}?api-version=${API_VERSION}`, {
      method, headers: {Authorization: `Bearer ${token}`}, redirect: 'error',
      signal: AbortSignal.timeout(15000),
    });
    if (![200,202].includes(res.status)) fail(`gpu_arm_http_${res.status}`);
    return res;
  }
  async function executions() {
    const response = await request(`${plan.job_id}/executions`);
    if (response.status !== 200) fail('gpu_execution_list_pending');
    const body = await response.json();
    if (!Array.isArray(body.value) || body.nextLink) fail('gpu_execution_list_incomplete');
    return body.value;
  }
  return Object.freeze({kind: 'azure-job-inspection/v1',
    async inspect() {
      const resource = await (await request(plan.job_id)).json();
      const environment = await (await request(plan.properties.environmentId)).json();
      return inspectJobSnapshot(plan, resource, environment);
    },
    async observe(name) { return executionObservation(plan, name, await executions()); },
    async assertIdle() {
      const rows=await executions();
      if(rows.some(row=>!['Succeeded','Failed','Stopped'].includes(row.properties?.status))) fail('gpu_job_has_live_execution');
      return true;
    },
    async stop(name) {
      // One named execution only. Refuse the collection-wide stop API.
      const target = executionName(name);
      const before = executionObservation(plan, target, await executions());
      if (before.state === 'unknown') fail('gpu_execution_unknown');
      if (before.terminal) return before;
      const res = await request(`${plan.job_id}/executions/${target}/stop`, 'POST');
      if (res.status === 202) return {...before, state: 'stop_pending', terminal: false};
      // A 200 is Azure's stop acknowledgement. Observe separately to retain
      // exact execution/template binding, and never interpret cost here.
      return executionObservation(plan, target, await executions());
    },
    async start() { fail('gpu_billable_allocation_bound_unproven'); },
    async authorizeWindow() { fail('gpu_billable_allocation_bound_unproven'); },
  });
}
