import {createHash} from 'node:crypto';

const ARM = 'https://management.azure.com';
const VERSION = '2025-07-01';
const ID = /^\/subscriptions\/[0-9a-f-]{36}\/resourceGroups\/[A-Za-z0-9_.()-]+\/providers\/Microsoft\.App\/containerApps\/[A-Za-z0-9_-]+$/i;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const instant = value => value instanceof Date ? value.getTime() : Date.parse(value);
const fail = code => { throw Object.assign(new Error(code), {code,status:503,blockerClass:'us'}); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const commitment = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function origin(value, internal) {
  try {
    const url = new URL(value);
    return value === url.origin && url.protocol === 'https:' && !url.port
      && !url.username && !url.password && /^[a-z0-9.-]+\.azurecontainerapps\.io$/.test(url.hostname)
      && url.hostname.includes('.internal.') === internal;
  } catch { return false; }
}
function validatePlan(plan, policy) {
  if (!origin(plan?.runtime_origin, true) || !origin(plan?.broker_origin, false)
    || plan?.kind !== 'azure-supervised-voice-app-plan/v1' || !ID.test(plan.app_id || '')
    || !/^[A-Za-z0-9_-]{1,128}$/.test(plan.revision_name || '')
    || !plan.revision_name.startsWith(`${plan.app_id.split('/').at(-1)}--`)
    || !/^[A-Za-z0-9_-]{8,100}$/.test(plan.isolation_tag || '')
    || !/^\/subscriptions\/[a-f0-9-]{36}\/resourceGroups\/[A-Za-z0-9_.()-]+\/providers\/Microsoft.App\/managedEnvironments\/[A-Za-z0-9_-]+$/i.test(plan.environment_id || '')
    || !/^[a-z0-9]+\.azurecr\.io\/[a-z0-9/_.-]+@sha256:[a-f0-9]{64}$/.test(plan.image || '')
    || !['configuration_sha256', 'template_sha256', 'contract_sha256'].every(key => HASH.test(plan[key] || '')))
    fail('voice_app_plan_invalid');
  // This is a supervised estimate, never an Azure invoice or hard replica bound.
  if (policy?.envelope_seconds !== 900 || policy.dispatch_seconds !== 420
    || !Number.isSafeInteger(policy.rate_microusd_per_second) || policy.rate_microusd_per_second<=0
    || !Number.isSafeInteger(policy.contingency_multiplier) || policy.contingency_multiplier<1 || policy.contingency_multiplier>10
    || !Number.isSafeInteger(policy.limit_microusd) || policy.limit_microusd<=0
    || !Number.isSafeInteger(policy.per_allocation_cap_microusd) || policy.per_allocation_cap_microusd<=0
    || policy.per_allocation_cap_microusd>policy.limit_microusd || policy.hard_invoice_cap !== false
    || !HASH.test(policy.supervisor_source_sha256 || ''))
    fail('voice_app_policy_invalid');
}

/** lifecycleStore is durable. claimClose atomically returns true only to the first
 * closer; revokeAdmission commits before any ARM mutation. A crashed closer is
 * observed again, never automatically repeated. Recovery requires explicit review.
 * No function creates, activates, scales, releases money, or schedules itself. */
export function createSupervisedVoiceAppController({plan: inputPlan, policy: inputPolicy,
  getToken, fetch: suppliedFetch, fetchImpl = suppliedFetch || globalThis.fetch,
  lifecycleStore, now = Date.now, sleep = ms => new Promise(resolve => setTimeout(resolve, ms))}) {
  const plan = structuredClone(inputPlan), policy = structuredClone(inputPolicy);
  validatePlan(plan, policy);
  for (const key of ['getWindow', 'revokeAdmission', 'claimClose', 'recordObservation', 'getSupervisorLease', 'claimActivation', 'recordActivation', 'authorizeActivationDispatch', 'authorizeDeactivationDispatch', 'recordDeactivation'])
    if (typeof lifecycleStore?.[key] !== 'function') fail('voice_app_durable_lifecycle_required');
  if (typeof getToken !== 'function' || typeof fetchImpl !== 'function') fail('voice_app_transport_required');
  const revisionPath = name => `${plan.app_id}/revisions/${name}`;
  const expectedReserve = policy.envelope_seconds * policy.rate_microusd_per_second * policy.contingency_multiplier;
  if(!Number.isSafeInteger(expectedReserve)||expectedReserve>policy.per_allocation_cap_microusd)fail('voice_app_allocation_cap_exceeded');
  const revisionHash = commitment({revision_name: plan.revision_name,
    configuration_sha256: plan.configuration_sha256, template_sha256: plan.template_sha256});
  async function assertSupervisorReady() {
    const lease = await lifecycleStore.getSupervisorLease({app_id: plan.app_id, contract_sha256: plan.contract_sha256});
    const heartbeat = instant(lease?.heartbeat_at), expires = instant(lease?.lease_expires_at), server = instant(lease?.server_now);
    if (lease?.app_id !== plan.app_id || lease?.contract_sha256 !== plan.contract_sha256
      || lease?.revision_sha256 !== revisionHash || lease?.source_sha256 !== policy.supervisor_source_sha256
      || ![heartbeat, expires, server].every(Number.isFinite) || expires - heartbeat !== 30000
      || heartbeat > server || server >= expires || Math.abs(now() - server) > 5000)
      fail('voice_app_supervisor_lease_unavailable');
    return {source_sha256: lease.source_sha256, heartbeat_at: new Date(heartbeat).toISOString(),
      lease_expires_at: new Date(expires).toISOString()};
  }
  async function request(path, method = 'GET', activation = false, beforeDispatch) {
    const token = await getToken();
    if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) fail('voice_app_token_unavailable');
    await beforeDispatch?.();
    let response;
    try {
      response = await fetchImpl(`${ARM}${path}?api-version=${VERSION}`, {
        method, headers: {Authorization: `Bearer ${token}`}, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
    } catch { fail('voice_app_arm_transport_unknown'); }
    if (!(method === 'GET' ? [200] : activation ? [200] : [200, 202, 204]).includes(response.status)) {
      await response.body?.cancel();
      fail(`voice_app_arm_http_${response.status}`);
    }
    if (method !== 'GET') { await response.body?.cancel(); return {accepted: true}; }
    const reader = response.body?.getReader();
    if (!reader) fail('voice_app_arm_body_unavailable');
    const chunks = []; let bytes = 0;
    try {
      for (;;) {
        const {done, value} = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) fail('voice_app_arm_body_oversized');
        chunks.push(Buffer.from(value));
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { fail('voice_app_arm_json_invalid'); }
    } finally { await reader.cancel().catch(() => {}); }
  }
  async function list(path) {
    const body = await request(path);
    if (!Array.isArray(body.value) || body.value.length > 1000 || body.nextLink) fail('voice_app_inventory_incomplete');
    return body.value;
  }
  function assertOwnedApp(app) {
    if (app?.id !== plan.app_id || app.type?.toLowerCase() !== 'microsoft.app/containerapps'
      || app.tags?.vyaktiIsolation !== plan.isolation_tag || app.properties?.environmentId !== plan.environment_id)
      fail('voice_app_cleanup_ownership_unknown');
  }
  async function assertCleanupIdentity() {
    assertOwnedApp(await request(plan.app_id));
    const revision = await request(revisionPath(plan.revision_name));
    if (revision?.id !== revisionPath(plan.revision_name) || revision.name !== plan.revision_name)
      fail('voice_app_cleanup_revision_identity_unknown');
  }
  async function inspect({requireIdle = false, cleanup = false} = {}) {
    const app = await request(plan.app_id), p = app.properties;
    assertOwnedApp(app);
    const actionable = [];
    if (!cleanup && (app.id !== plan.app_id || app.type?.toLowerCase() !== 'microsoft.app/containerapps'
      || app.tags?.vyaktiIsolation !== plan.isolation_tag || p?.environmentId !== plan.environment_id
      || p?.provisioningState !== 'Succeeded' || p?.latestRevisionName !== plan.revision_name
      || commitment(p.configuration) !== plan.configuration_sha256 || commitment(p.template) !== plan.template_sha256))
      fail('voice_app_target_drift');
    if (!cleanup && (p.configuration?.ingress?.external !== false
      || `https://${p.configuration.ingress.fqdn}` !== plan.runtime_origin
      || !p.configuration.ingress.fqdn.startsWith(`${plan.app_id.split('/').at(-1)}.internal.`)
      || p.template?.scale?.minReplicas !== 0 || p.template.scale.maxReplicas !== 1
      || p.template.containers?.length !== 1 || p.template.containers[0].image !== plan.image
      || p.configuration?.activeRevisionsMode !== 'Single')) fail('voice_app_target_not_isolated');
    if (cleanup && (commitment(p.configuration) !== plan.configuration_sha256 || commitment(p.template) !== plan.template_sha256))
      actionable.push('voice_app_configuration_changed_during_cleanup');
    const revisions = await list(`${plan.app_id}/revisions`), seen = new Set(), observations = [];
    for (const row of revisions) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(row?.name || '') || row.id !== revisionPath(row.name) || seen.has(row.id))
        fail('voice_app_revision_inventory_invalid');
      seen.add(row.id);
      if (typeof row.properties?.active !== 'boolean') fail('voice_app_revision_state_unknown');
      if (row.name === plan.revision_name && commitment(row.properties.template) !== plan.template_sha256) {
        if (!cleanup) fail('voice_app_revision_template_drift');
        actionable.push('voice_app_revision_template_drift');
      }
      if (row.name !== plan.revision_name && row.properties.active) {
        if (!cleanup) fail('voice_app_other_revision_active');
        actionable.push('voice_app_foreign_revision_requires_operator_cleanup');
      }
      const replicas = await list(`${revisionPath(row.name)}/replicas`), replicaIds = new Set();
      for (const replica of replicas) {
        if (typeof replica?.id !== 'string' || !replica.id.startsWith(`${revisionPath(row.name)}/replicas/`)
          || replicaIds.has(replica.id)) fail('voice_app_replica_inventory_invalid');
        replicaIds.add(replica.id);
      }
      observations.push({revision_name: row.name, active: row.properties.active, replicas: replicas.length});
    }
    if (!seen.has(revisionPath(plan.revision_name))) fail('voice_app_revision_missing');
    const zero = observations.every(row => row.replicas === 0);
    if (requireIdle && !zero) fail('voice_app_target_not_idle');
    return {app_id: plan.app_id, revision_name: plan.revision_name, observed_at: new Date(now()).toISOString(),
      actionable_codes: actionable, revisions: observations, all_replicas_zero: zero, all_revisions_inactive: observations.every(row => !row.active),
      accounting_state: 'accounting_pending', accounted: false, billing_bound_verified: false};
  }
  function validateWindow(window) {
    if (!UUID.test(window?.window_id || '') || window.resource_sha256 !== commitment(plan.app_id)
      || window.revision_sha256 !== revisionHash || window.app_id !== plan.app_id || window.revision_name !== plan.revision_name
      || !['configuration_sha256', 'template_sha256', 'contract_sha256'].every(key => window[key] === plan[key])
      || !['open', 'closing', 'close_claimed', 'observation_unknown', 'terminal_observed'].includes(window.state)
      || !Number.isFinite(instant(window.begun_at))
      || instant(window.dispatch_deadline_at) !== instant(window.begun_at) + policy.dispatch_seconds * 1000)
      fail('voice_app_window_binding_invalid');
    return window;
  }
  async function stored(windowId) {
    if (!UUID.test(windowId || '')) fail('voice_app_window_id_invalid');
    const row = validateWindow(await lifecycleStore.getWindow(windowId));
    if (row.window_id !== windowId) fail('voice_app_window_identity_mismatch');
    return row;
  }
  async function record(windowId, observation) {
    await lifecycleStore.recordObservation(windowId, observation);
    return observation;
  }
  async function read(windowId) {
    const window = await stored(windowId);
    const observation = await inspect({cleanup: window.state !== 'open'});
    const terminal = observation.all_replicas_zero && observation.all_revisions_inactive && ['not_started','acknowledged'].includes(window.activation_state) && window.deactivation_state==='acknowledged';
    return record(windowId, {...observation, terminal, operationally_closed: terminal});
  }
  async function close(windowId, reason = 'dispatch_deadline') {
    await stored(windowId);
    if (!['dispatch_deadline', 'completed', 'transaction_finished', 'cancelled', 'supervisor_failure'].includes(reason)) fail('voice_app_close_reason_invalid');
    // Commit admission revocation even when ARM is unavailable. Claim is a
    // durable at-most-once mutation intent, not evidence of a stopped revision.
    await lifecycleStore.revokeAdmission(windowId, reason);
    if (await lifecycleStore.claimClose(windowId) === true) {
      await record(windowId, {state: 'deactivate_intent', observed_at: new Date(now()).toISOString(), accounting_state: 'accounting_pending'});
      try {
        // Cleanup authority is narrower than admission: stop only the exact
        // owned revision even if deployment configuration drifted. Never let
        // a foreign active revision suppress cleanup of the known target.
        await assertCleanupIdentity();
        await request(`${revisionPath(plan.revision_name)}/deactivate`, 'POST', true, async()=>{
          if(await lifecycleStore.authorizeDeactivationDispatch(windowId)!==true)fail('voice_app_deactivation_dispatch_refused');
        });
        if(await lifecycleStore.recordDeactivation(windowId,'acknowledged')!==true)fail('voice_app_deactivation_ack_refused');
      } catch (error) {
        await lifecycleStore.recordDeactivation(windowId,'unknown').catch(()=>{});
        await record(windowId, {state: 'deactivate_unknown', code: error.code || 'voice_app_unknown', accounting_state: 'accounting_pending'});
        throw error;
      }
    }
    const observation = await read(windowId);
    return observation;
  }
  async function activate(windowId){
    const window=await stored(windowId);
    if(window.state!=='open'||window.activation_state!=='not_started'||now()>=instant(window.dispatch_deadline_at))fail('voice_app_activation_refused');
    await assertSupervisorReady();
    const before=await inspect({requireIdle:true});
    if(!before.all_revisions_inactive)fail('voice_app_activation_target_not_stopped');
    if(await lifecycleStore.claimActivation(windowId)!==true)fail('voice_app_activation_claim_refused');
    try{
      // The durable claim follows147 reservation and rechecks live owner/intent authority.
      // Only documented synchronous200 acknowledges activation. Unknown is never replayed.
      await request(`${revisionPath(plan.revision_name)}/activate`,'POST',true,async()=>{
        const latest=await stored(windowId);
        if(latest.state!=='open'||latest.activation_state!=='claimed'||now()>=instant(latest.dispatch_deadline_at))fail('voice_app_activation_deadline');
        await assertSupervisorReady();
        if(await lifecycleStore.authorizeActivationDispatch(windowId)!==true)fail('voice_app_activation_authority_changed');
      });
      const current=await stored(windowId);
      if(current.state!=='open'||now()>=instant(current.dispatch_deadline_at))fail('voice_app_activation_deadline');
      await assertSupervisorReady();
      const observation=await inspect();
      if(!observation.revisions.find(row=>row.revision_name===plan.revision_name)?.active)fail('voice_app_activation_not_observed');
      if(await lifecycleStore.recordActivation(windowId,'acknowledged')!==true)fail('voice_app_activation_ack_refused');
      return observation;
    }catch(error){
      await lifecycleStore.recordActivation(windowId,'unknown').catch(()=>{});
      throw error;
    }
  }
  async function authorizeWindow({request_sha256} = {}) {
    if (!HASH.test(request_sha256 || '')) fail('voice_app_request_hash_invalid');
    await assertSupervisorReady();
    // This grant describes a provisional reservation estimate only. The meter
    // reserves before the outer factory binds a durable lifecycle window and
    // permits any broker request. This function neither wakes nor activates.
    return Object.freeze({kind: 'azure-supervised-app/v1', request_sha256,
      resource_sha256: commitment(plan.app_id),
      revision_sha256: revisionHash,
      contract_sha256: plan.contract_sha256, reservation_estimate_microusd: expectedReserve,
      planning_allocation_seconds: policy.envelope_seconds, accounting_basis: 'planning_estimate',
      billing_bound_verified: false, hard_invoice_cap: false});
  }
  async function supervisorTick(windowId) {
    const window = await stored(windowId);
    if(window.state==='terminal_observed'){
      // Scheduled release-only recovery: shutdown is already immutable. No ARM read or stop.
      await lifecycleStore.recordObservation(windowId,window.observation);
      return {...window.observation,recovery:'resource_release_only',accounted:false};
    }
    const elapsed = now() - instant(window.begun_at);
    if (elapsed < 0) fail('voice_app_supervisor_clock_invalid');
    const observation = window.state !== 'open' || elapsed >= policy.dispatch_seconds * 1000
      ? await close(windowId, 'dispatch_deadline') : await read(windowId);
    if (!observation.operationally_closed && elapsed >= policy.envelope_seconds * 1000)
      fail('voice_app_cleanup_deadline_exceeded');
    return observation;
  }
  async function supervise(windowId, {pollMilliseconds = 5000, maxObservations = 181} = {}) {
    if (!Number.isInteger(pollMilliseconds) || pollMilliseconds < 1000 || pollMilliseconds > 15000
      || !Number.isInteger(maxObservations) || maxObservations < 1 || maxObservations > 901)
      fail('voice_app_supervisor_options_invalid');
    for (let index = 0; index < maxObservations; index++) {
      const window = await stored(windowId);
      const elapsed = now() - instant(window.begun_at);
      if (elapsed < 0) fail('voice_app_supervisor_clock_invalid');
      if (window.state !== 'open' || elapsed >= policy.dispatch_seconds * 1000) {
        const observation = await close(windowId, 'dispatch_deadline');
        if (observation.operationally_closed) return observation;
      } else {
        try { await read(windowId); }
        catch (error) { await close(windowId, 'supervisor_failure'); throw error; }
      }
      if (elapsed >= policy.envelope_seconds * 1000) fail('voice_app_cleanup_deadline_exceeded');
      await sleep(pollMilliseconds);
    }
    await close(windowId, 'supervisor_failure');
    fail('voice_app_supervisor_observation_limit');
  }
  return Object.freeze({kind: 'azure-supervised-app-controller/v1',
    assertExclusiveTarget: async () => {
      await assertSupervisorReady();
      const observation = await inspect({requireIdle: true});
      if (!observation.all_revisions_inactive)fail('voice_app_activation_target_not_stopped');
      return observation;
    }, activate, assertSupervisorReady, authorizeWindow, read, close, supervisorTick, supervise});
}
