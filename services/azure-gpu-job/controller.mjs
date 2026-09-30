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

// Only defaults observed in the retained exact existing-job GET on 2026-09-08.
// Do not recursively remove nulls/empty collections: a null required trigger,
// a missing command, a changed env marker or an unknown field must still fail.
export function normalizeObservedJobConfiguration(configuration) {
  const value=structuredClone(configuration);
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  for(const key of ['dapr','eventTriggerConfig','scheduleTriggerConfig'])if(value[key]===null)delete value[key];
  if(Array.isArray(value.identitySettings)&&value.identitySettings.length===0)delete value.identitySettings;
  if(Array.isArray(value.registries))for(const registry of value.registries){
    if(registry&&typeof registry==='object'&&registry.identity==='')delete registry.identity;
  }
  return value;
}

export function normalizeObservedJobTemplate(template,{execution=false}={}) {
  const value=structuredClone(template);
  if(!value||typeof value!=='object'||Array.isArray(value))return value;
  for(const key of ['initContainers','volumes'])if(value[key]===null)delete value[key];
  if(execution&&Array.isArray(value.initContainers)&&value.initContainers.length===0)delete value.initContainers;
  // Exact defaults from the deployed dedicated GPU target GET. Never erase
  // nonempty identity/storage or restore a missing per-execution env marker.
  if(Array.isArray(value.containers))for(const container of value.containers){
    if(!container||typeof container!=='object'||Array.isArray(container))continue;
    if(execution&&container.imageType==='ContainerImage')delete container.imageType;
    if(!Object.hasOwn(container,'env'))container.env=[];
    if(container.resources?.ephemeralStorage==='')delete container.resources.ephemeralStorage;
  }
  return value;
}

export function inspectJobSnapshot(plan, resource, environment) {
  validatePlan(plan);
  if (resource?.id !== plan.job_id || resource.type?.toLowerCase() !== 'microsoft.app/jobs') fail('gpu_job_resource_mismatch');
  const p = resource.properties;
  if (!p || p.provisioningState !== 'Succeeded') fail('gpu_job_not_provisioned');
  // Ignore server metadata, but retain every execution-relevant template and
  // trigger field. Registry secrets compare by reviewed names and are supplied
  // only as secure deployment parameters, never as a returned credential.
  const configuration=normalizeObservedJobConfiguration(p.configuration);
  // GET does not establish the secret value. Compare names, never return or
  // hash credentials; a differently named secret or Key Vault target refuses.
  if(configuration?.secrets?.some(s=>s.keyVaultUrl||s.identity))fail('gpu_registry_secret_binding_invalid');
  if(configuration?.secrets)configuration.secrets=configuration.secrets.map(s=>({name:s.name}));
  const observed = {environmentId: p.environmentId, workloadProfileName: p.workloadProfileName,
    configuration, template: normalizeObservedJobTemplate(p.template)};
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

export function windowExecutionTemplate(plan, windowId) {
  validatePlan(plan);
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(windowId||''))fail('gpu_window_id_invalid');
  const template=structuredClone(plan.properties.template);
  template.containers[0].env=[{name:'VYAKTI_GPU_WINDOW_ID',value:windowId}];
  return template;
}

export function executionObservation(plan, name, executions, windowId) {
  validatePlan(plan);
  const id = `${plan.job_id}/executions/${executionName(name)}`;
  const rows = executions.filter(e => e.id === id && e.name === name);
  if (rows.length !== 1) return {execution_id: id, state: 'unknown', terminal: false, accounting_state: 'accounting_pending'};
  const row = rows[0], p = row.properties || {};
  const expectedHash=windowId?commitment(windowExecutionTemplate(plan,windowId)):plan.template_sha256;
  if (commitment(normalizeObservedJobTemplate(p.template,{execution:true})) !== expectedHash) fail('gpu_execution_template_mismatch');
  const terminal = ['Succeeded', 'Failed', 'Stopped'].includes(p.status)
    && Number.isFinite(Date.parse(p.startTime))
    && (p.endTime===undefined || (Number.isFinite(Date.parse(p.endTime)) && Date.parse(p.endTime)>=Date.parse(p.startTime)));
  // ARM may omit endTime on a terminal failed execution. This establishes
  // operational status only; it never supplies an invoice duration or release.
  // Execution status is not a meter receipt. Even terminal status never sets
  // allocation_terminated or accounted for the 147 settlement interface.
  return {execution_id: id, state: p.status || 'Unknown', terminal,
    configuration_sha256: plan.configuration_sha256, template_sha256: expectedHash,
    provider_end_time_present: Object.hasOwn(p,'endTime'),
    accounting_state: 'accounting_pending', accounted: false};
}

export function prestartInventory(plan, executions) {
  validatePlan(plan);
  if (!Array.isArray(executions) || executions.length>1000) fail('gpu_execution_inventory_invalid');
  const seen=new Set();
  return executions.map(row=>{
    const name=executionName(row?.name);
    if(row.id!==`${plan.job_id}/executions/${name}`||seen.has(row.id))fail('gpu_execution_inventory_invalid');
    seen.add(row.id);
    // Old completed executions may use an earlier image, so retain their
    // identity but do not require their template to match this new plan.
    const p=row.properties||{};
    if(!['Succeeded','Failed','Stopped'].includes(p.status))fail('gpu_job_has_live_execution');
    return {id:row.id,name,start_time:p.startTime||null,template_sha256:commitment(p.template||{})};
  }).sort((a,b)=>a.id.localeCompare(b.id));
}

export function recoverStartedExecution(plan, window, executions) {
  validatePlan(plan);
  const inventory=window?.job_prestart_inventory;
  if(!Array.isArray(inventory)||inventory.length>1000||window.azure_job_id!==plan.job_id
    ||window.job_configuration_sha256!==plan.configuration_sha256)fail('gpu_recovery_inventory_unavailable');
  const requested=Date.parse(window.job_start_requested_at);
  const allocationSeconds=Number(window.max_allocation_seconds);
  if(!Number.isFinite(requested)||!Number.isSafeInteger(window.job_runtime_seconds)||window.job_runtime_seconds<1
    ||!Number.isSafeInteger(allocationSeconds)||allocationSeconds<window.job_runtime_seconds||allocationSeconds>3600)fail('gpu_recovery_time_invalid');
  const expectedHash=commitment(windowExecutionTemplate(plan,window.window_id));
  if(window.job_execution_template_sha256!==expectedHash)fail('gpu_recovery_template_binding_unavailable');
  const old=new Set(inventory.map(row=>row.id));
  if(old.size!==inventory.length||inventory.some(row=>row.id!==`${plan.job_id}/executions/${executionName(row.name)}`))fail('gpu_recovery_inventory_invalid');
  if(!Array.isArray(executions)||executions.length>1000)fail('gpu_execution_inventory_invalid');
  const fresh=executions.filter(row=>!old.has(row?.id));
  // Refuse all ambiguity, including a second candidate with another image.
  // Choosing the most recent or closest start would silently guess ownership.
  if(fresh.length!==1)fail(fresh.length?'gpu_recovery_ambiguous':'gpu_recovery_not_visible');
  const candidate=fresh[0],name=executionName(candidate.name),p=candidate.properties||{};
  if(candidate.id!==`${plan.job_id}/executions/${name}`)fail('gpu_recovery_execution_mismatch');
  const started=Date.parse(p.startTime);
  const last=requested+allocationSeconds*1000;
  // ARM timestamps can have second precision. The lower edge is the same
  // UTC second as the persisted request, not an arbitrary clock-skew grace.
  if(!Number.isFinite(started)||started<Math.floor(requested/1000)*1000||started>last)fail('gpu_recovery_outside_window');
  if(commitment(normalizeObservedJobTemplate(p.template,{execution:true}))!==expectedHash)fail('gpu_execution_template_mismatch');
  return {execution_name:name,execution_id:candidate.id,recovery_sha256:commitment({
    window_id:window.window_id,requested_at:window.job_start_requested_at,
    inventory,execution_id:candidate.id,start_time:p.startTime,template_sha256:expectedHash,
    configuration_sha256:plan.configuration_sha256,
  })};
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
    async observe(name,windowId) { return executionObservation(plan, name, await executions(),windowId); },
    async inventory() { return prestartInventory(plan,await executions()); },
    async recover(window) {
      // Verify the current job remains the approved job before attribution.
      await this.inspect();
      return recoverStartedExecution(plan,window,await executions());
    },
    async assertIdle() {
      const rows=await executions();
      if(rows.some(row=>!['Succeeded','Failed','Stopped'].includes(row.properties?.status))) fail('gpu_job_has_live_execution');
      return true;
    },
    async stop(name,windowId) {
      // One named execution only. Refuse the collection-wide stop API.
      const target = executionName(name);
      const before = executionObservation(plan, target, await executions(),windowId);
      if (before.state === 'unknown') fail('gpu_execution_unknown');
      if (before.terminal) return before;
      const res = await request(`${plan.job_id}/executions/${target}/stop`, 'POST');
      if (res.status === 202) return {...before, state: 'stop_pending', terminal: false};
      // A 200 is Azure's stop acknowledgement. Observe separately to retain
      // exact execution/template binding, and never interpret cost here.
      return executionObservation(plan, target, await executions(),windowId);
    },
    async start() { fail('gpu_billable_allocation_bound_unproven'); },
    async authorizeWindow() { fail('gpu_billable_allocation_bound_unproven'); },
  });
}
