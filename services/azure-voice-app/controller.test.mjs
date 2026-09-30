import test from 'node:test';
import assert from 'node:assert/strict';
import {commitment, createSupervisedVoiceAppController} from './controller.mjs';

export function fixture() {
  const appId = '/subscriptions/11111111-1111-1111-1111-111111111111/resourceGroups/test/providers/Microsoft.App/containerApps/isolated-voice';
  const revision = 'isolated-voice--baseline';
  const template = {scale: {minReplicas: 0, maxReplicas: 1}, containers: [{image: `test.azurecr.io/voice@sha256:${'a'.repeat(64)}`} ]};
  const configuration = {activeRevisionsMode: 'Single', ingress: {external: false,
    fqdn: 'isolated-voice.internal.test.centralindia.azurecontainerapps.io'}};
  const plan = {kind: 'azure-supervised-voice-app-plan/v1', app_id: appId, revision_name: revision,
    environment_id: appId.split('/providers/')[0] + '/providers/Microsoft.App/managedEnvironments/test',
    runtime_origin: `https://${configuration.ingress.fqdn}`, broker_origin: 'https://isolated-broker.test.centralindia.azurecontainerapps.io',
    image: template.containers[0].image, isolation_tag: 'baseline-isolated-158',
    template_sha256: commitment(template), configuration_sha256: commitment(configuration), contract_sha256: 'b'.repeat(64)};
  const policy = {envelope_seconds: 900, dispatch_seconds: 420, rate_microusd_per_second: 462,
    contingency_multiplier: 2, limit_microusd: 1000000, per_allocation_cap_microusd:900000, hard_invoice_cap: false, supervisor_source_sha256: 'e'.repeat(64)};
  let clock = Date.parse('2026-09-08T00:00:00Z'), active = false, replicas = [], claimed = false;
  const calls = [], records = [], ordering = [];
  const window = {window_id: '22222222-2222-2222-2222-222222222222', app_id: appId, revision_name: revision,
    configuration_sha256: plan.configuration_sha256, template_sha256: plan.template_sha256,
    contract_sha256: plan.contract_sha256, resource_sha256: commitment(appId),
    revision_sha256: commitment({revision_name: revision, configuration_sha256: plan.configuration_sha256, template_sha256: plan.template_sha256}), begun_at: new Date(clock).toISOString(),
    dispatch_deadline_at: new Date(clock + 420000).toISOString(), state: 'open',activation_state:'acknowledged',deactivation_state:'not_started'};
  const app = {id: appId, type: 'Microsoft.App/containerApps', tags: {vyaktiIsolation: plan.isolation_tag},
    properties: {environmentId: plan.environment_id, provisioningState: 'Succeeded', latestRevisionName: revision, template, configuration}};
  const options = {plan, policy, now: () => clock, sleep: async ms => { clock += ms; }, getToken: async () => 'test-only',
    fetch: async (url, init) => {
      calls.push({url, method: init.method});
      assert.equal(init.redirect, 'error');
      const path = new URL(url).pathname;
      if (init.method === 'POST') { const activating=path.endsWith('/activate');ordering.push(activating?'activate':'deactivate');active=activating;return new Response(null,{status:200}); }
      let body;
      if (path === appId) body = app;
      else if (path === `${appId}/revisions/${revision}`) body = {id: path, name: revision, properties: {active, template}};
      else if (path.endsWith('/replicas')) body = {value: replicas};
      else body = {value: [{id: `${appId}/revisions/${revision}`, name: revision, properties: {active, template}}]};
      return Response.json(body);
    }, lifecycleStore: {
      getSupervisorLease: async () => ({app_id: appId, contract_sha256: plan.contract_sha256,
        revision_sha256: commitment({revision_name: revision, configuration_sha256: plan.configuration_sha256, template_sha256: plan.template_sha256}),
        source_sha256: policy.supervisor_source_sha256, heartbeat_at: new Date(clock),
        lease_expires_at: new Date(clock + 30000), server_now: new Date(clock)}),
      authorizeActivationDispatch:async()=>window.activation_state==='claimed'&&window.state==='open',
      claimActivation:async()=>{if(window.activation_state!=='not_started'||window.state!=='open')return false;ordering.push('activation_claim');window.activation_state='claimed';return true;},
      recordActivation:async(id,state)=>{if(window.activation_state!=='claimed')return false;window.activation_state=state;return true;},
      getWindow: async () => window,
      revokeAdmission: async () => { ordering.push('revoke'); if (window.state === 'open') window.state = 'closing'; },
      claimClose: async () => { ordering.push('claim'); if (claimed) return false; claimed = true; window.deactivation_state='claimed';return true; },
      authorizeDeactivationDispatch:async()=>window.deactivation_state==='claimed',
      recordDeactivation:async(id,state)=>{window.deactivation_state=state;return true;},
      recordObservation: async (id, value) => { records.push(value); },
    }};
  return {options, app, window, calls, records, ordering, plan,
    active:value=>{active=value;},resetWindow:()=>{claimed=false;window.state='open';window.activation_state='not_started';window.deactivation_state='not_started';window.window_id='33333333-3333-4333-8333-333333333333';},
    replicas: value => { replicas = value; }, time: value => { clock += value; }, controller: () => createSupervisedVoiceAppController(options)};
}

test('planning grant needs no network or persisted window and never claims invoice bound', async () => {
  const f = fixture(); f.options.lifecycleStore.getWindow = () => { throw new Error('must not read'); };
  const grant = await f.controller().authorizeWindow({request_sha256: 'c'.repeat(64)});
  assert.equal(grant.kind, 'azure-supervised-app/v1');
  assert.equal(grant.reservation_estimate_microusd, 831600);
  assert.equal(grant.planning_allocation_seconds, 900);
  assert.equal(grant.hard_invoice_cap, false);
  assert.equal(f.calls.length, 0);
});

test('separately pinned revision template admits Azure app defaults without normalizing either document', async () => {
  const f=fixture(), revisionTemplate=structuredClone(f.app.properties.template);
  const appTemplate={...structuredClone(revisionTemplate),revisionSuffix:'',scale:{...revisionTemplate.scale,cooldownPeriod:300,pollingInterval:30}};
  appTemplate.containers[0].resources={ephemeralStorage:''};
  f.app.properties.template=appTemplate;
  f.plan.template_sha256=commitment(appTemplate);
  await assert.rejects(f.controller().assertExclusiveTarget(),/revision_template_drift/);
  f.plan.revision_template_sha256=commitment(revisionTemplate);
  assert.equal((await f.controller().assertExclusiveTarget()).all_replicas_zero,true);
  f.app.properties.template.scale.cooldownPeriod=301;
  await assert.rejects(f.controller().assertExclusiveTarget(),/target_drift/);
  f.app.properties.template.scale.cooldownPeriod=300;
  f.plan.revision_template_sha256='f'.repeat(64);
  await assert.rejects(f.controller().assertExclusiveTarget(),/revision_template_drift/);
  f.plan.revision_template_sha256='invalid';assert.throws(f.controller,/plan_invalid/);
});

test('stored lifecycle window cannot omit its separately pinned revision template', async () => {
  const f=fixture();f.plan.revision_template_sha256=f.plan.template_sha256;
  await assert.rejects(f.controller().read(f.window.window_id),/window_binding_invalid/);
  f.window.revision_template_sha256=f.plan.revision_template_sha256;
  assert.equal((await f.controller().read(f.window.window_id)).all_replicas_zero,true);
});
test('isolated preflight lists every revision replica without runtime endpoint calls', async () => {
  const f = fixture(); assert.equal((await f.controller().assertExclusiveTarget()).all_replicas_zero, true);
  assert.equal(f.calls.length, 3);
  assert.ok(f.calls.every(call => call.url.startsWith('https://management.azure.com/') && call.method === 'GET'));
});
test('drift and any existing replica refuse readiness', async () => {
  const f = fixture(); f.app.tags.vyaktiIsolation = 'shared';
  await assert.rejects(f.controller().assertExclusiveTarget(), /cleanup_ownership_unknown/);
  const g = fixture(); g.replicas([{id: `${g.plan.app_id}/revisions/${g.plan.revision_name}/replicas/one`}]);
  await assert.rejects(g.controller().assertExclusiveTarget(), /not_idle/);
});
test('close revokes admission before exactly one deactivate and preserves accounting pending', async () => {
  const f = fixture(), controller = f.controller();
  const result = await controller.close(f.window.window_id, 'completed');
  assert.deepEqual(f.ordering, ['revoke', 'claim', 'deactivate']);
  assert.equal(result.operationally_closed, true); assert.equal(result.accounted, false);
  assert.equal(result.accounting_state, 'accounting_pending');
  await controller.close(f.window.window_id);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
test('failed durable revocation prevents any ARM request', async () => {
  const f = fixture(); f.options.lifecycleStore.revokeAdmission = async () => { throw new Error('db unavailable'); };
  await assert.rejects(f.controller().close(f.window.window_id), /db unavailable/);
  assert.equal(f.calls.length, 0);
});
test('ambiguous deactivate is recorded and not retried on recovery', async () => {
  const f = fixture(); f.active(true); const original = f.options.fetch;
  f.options.fetch = (url, init) => { if (init.method === 'POST') { f.calls.push({method: 'POST'}); throw new Error('private transport detail'); } return original(url, init); };
  const controller = f.controller();
  await assert.rejects(controller.close(f.window.window_id), /transport_unknown/);
  assert.ok(f.records.some(record => record.state === 'deactivate_unknown'));
  assert.equal((await controller.close(f.window.window_id)).operationally_closed, false);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
test('deadline supervisor stops admission and observes deactivation', async () => {
  const f = fixture(); f.time(420000);
  assert.equal((await f.controller().supervise(f.window.window_id)).operationally_closed, true);
  assert.equal(f.window.state, 'closing');
});
test('window target mismatch prevents cloud mutation', async () => {
  const f = fixture(); f.window.contract_sha256 = 'd'.repeat(64);
  await assert.rejects(f.controller().close(f.window.window_id), /window_binding_invalid/);
  assert.equal(f.calls.length, 0);
});
test('incomplete pagination is rejected without following nextLink', async () => {
  const f = fixture(), original = f.options.fetch;
  f.options.fetch = (url, init) => url.includes('/revisions?')
    ? Response.json({value: [], nextLink: 'https://attacker.invalid/token'}) : original(url, init);
  await assert.rejects(f.controller().assertExclusiveTarget(), /inventory_incomplete/);
});
test('planning policy cannot be relabelled as a hard invoice cap', () => {
  const f = fixture(); f.options.policy.hard_invoice_cap = true;
  assert.throws(f.controller, /policy_invalid/);
});
test('planning grant refuses a missing independent supervisor heartbeat', async () => {
  const f = fixture(); f.options.lifecycleStore.getSupervisorLease = async () => undefined;
  await assert.rejects(f.controller().authorizeWindow({request_sha256: 'c'.repeat(64)}), /supervisor_lease_unavailable/);
  assert.equal(f.calls.length, 0);
});
test('readiness refuses stale, wrong-source and wrong-revision supervisor leases', async () => {
  for (const mutation of [
    row => { row.server_now = row.lease_expires_at; },
    row => { row.source_sha256 = 'f'.repeat(64); },
    row => { row.revision_sha256 = 'f'.repeat(64); },
    row => { row.lease_expires_at = new Date(row.heartbeat_at.getTime() + 60000); },
  ]) {
    const f = fixture(), source = f.options.lifecycleStore.getSupervisorLease;
    f.options.lifecycleStore.getSupervisorLease = async () => { const row = await source(); mutation(row); return row; };
    await assert.rejects(f.controller().assertExclusiveTarget(), /supervisor_lease_unavailable/);
    assert.equal(f.calls.length, 0);
  }
});
test('transaction_finished is accepted and terminal observation is durably recorded', async () => {
  const f = fixture();
  await f.controller().close(f.window.window_id, 'transaction_finished');
  assert.equal(f.records.at(-1).terminal, true);
  assert.equal(f.records.at(-1).accounted, false);
});
test('a closing lifecycle row triggers cleanup before deadline without a legacy boolean', async () => {
  const f = fixture(); f.window.state = 'closing';
  const result = await f.controller().supervisorTick(f.window.window_id);
  assert.equal(result.operationally_closed, true);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
});
test('mixed SQL text and Date timestamps retain milliseconds', async () => {
  const f = fixture(); f.active(true); f.time(123);
  f.window.begun_at = '2026-09-08T00:00:00.123Z';
  f.window.dispatch_deadline_at = new Date('2026-09-08T00:07:00.123Z');
  assert.equal((await f.controller().supervisorTick(f.window.window_id)).terminal, false);
});
test('cleanup does not require a healthy supervisor lease', async () => {
  const f = fixture(); f.options.lifecycleStore.getSupervisorLease = async () => undefined;
  assert.equal((await f.controller().close(f.window.window_id)).terminal, true);
});
test('even a recomputed configuration commitment cannot admit public GPU ingress', async () => {
  const f = fixture(); f.app.properties.configuration.ingress.external = true;
  f.plan.configuration_sha256 = commitment(f.app.properties.configuration);
  await assert.rejects(f.controller().assertExclusiveTarget(), /target_not_isolated/);
});
test('private runtime origin must match exact inspected ingress', async () => {
  const f = fixture(); f.plan.runtime_origin = 'https://other.internal.test.centralindia.azurecontainerapps.io';
  await assert.rejects(f.controller().assertExclusiveTarget(), /target_not_isolated/);
});
test('broker cannot point straight at private GPU or include path, query or credentials', () => {
  for (const value of ['https://runtime.internal.test.centralindia.azurecontainerapps.io',
    'https://broker.test.centralindia.azurecontainerapps.io/path', 'https://user:pass@broker.test.centralindia.azurecontainerapps.io']) {
    const f = fixture(); f.plan.broker_origin = value;
    assert.throws(f.controller, /plan_invalid/);
  }
});
test('configuration drift does not suppress exact owned revision cleanup', async () => {
  const f = fixture(); f.app.properties.configuration.activeRevisionsMode = 'Multiple';
  f.app.properties.template.scale.maxReplicas = 2;
  f.app.properties.latestRevisionName = 'unexpected-new-revision';
  const result = await f.controller().close(f.window.window_id);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 1);
  assert.equal(result.terminal, true);
  assert.ok(result.actionable_codes.includes('voice_app_configuration_changed_during_cleanup'));
  assert.equal(result.accounted, false);
});
test('foreign active revision remains actionable nonterminal while known target is deactivated', async () => {
  const f = fixture(), original = f.options.fetch;
  f.options.fetch = async (url, init) => {
    const response = await original(url, init);
    if (init.method !== 'GET' || !url.includes('/revisions?')) return response;
    const data = await response.json();
    data.value.push({id: `${f.plan.app_id}/revisions/foreign-revision`, name: 'foreign-revision',
      properties: {active: true, template: {}}});
    return Response.json(data);
  };
  const result = await f.controller().close(f.window.window_id);
  assert.equal(result.terminal, false);
  assert.ok(result.actionable_codes.includes('voice_app_foreign_revision_requires_operator_cleanup'));
  const writes = f.calls.filter(call => call.method === 'POST');
  assert.equal(writes.length, 1);
  assert.ok(writes[0].url.includes(`/revisions/${f.plan.revision_name}/deactivate?`));
});
test('changed ownership or exact revision identity still refuses cleanup mutation', async () => {
  const f = fixture(); f.app.tags.vyaktiIsolation = 'foreign-owner';
  await assert.rejects(f.controller().close(f.window.window_id), /cleanup_ownership_unknown/);
  assert.equal(f.calls.filter(call => call.method === 'POST').length, 0);
  const g = fixture(), original = g.options.fetch;
  g.options.fetch = (url, init) => url.includes(`/revisions/${g.plan.revision_name}?`)
    ? Response.json({id: 'wrong', name: g.plan.revision_name}) : original(url, init);
  await assert.rejects(g.controller().close(g.window.window_id), /cleanup_revision_identity_unknown/);
  assert.equal(g.calls.filter(call => call.method === 'POST').length, 0);
});

test('reserved activation acknowledges exact stopped revision and second window can activate after shutdown',async()=>{
 const f=fixture();f.window.activation_state='not_started';const c=f.controller();
 await c.activate(f.window.window_id);assert.equal(f.window.activation_state,'acknowledged');
 assert.deepEqual(f.ordering,['activation_claim','activate']);
 assert.equal((await c.close(f.window.window_id)).operationally_closed,true);
 f.resetWindow();await c.assertExclusiveTarget();await c.activate(f.window.window_id);
 assert.equal(f.ordering.filter(x=>x==='activate').length,2);
});
test('refused durable activation claim and expired window cannot send activation',async()=>{
 for(const mode of ['refuse','expired']){
  const f=fixture();f.window.activation_state='not_started';
  if(mode==='refuse')f.options.lifecycleStore.claimActivation=async()=>false;else f.time(420001);
  await assert.rejects(f.controller().activate(f.window.window_id),/activation_(claim_refused|refused)/);
  assert.equal(f.calls.filter(x=>x.method==='POST').length,0);
 }
});
test('unknown activation never replays or becomes terminal from an inactive readback',async()=>{
 const f=fixture();f.window.activation_state='not_started';const fetch=f.options.fetch;
 f.options.fetch=async(url,init)=>{if(new URL(url).pathname.endsWith('/activate'))throw Error('transport lost');return fetch(url,init);};
 const c=f.controller();await assert.rejects(c.activate(f.window.window_id),/transport_unknown/);
 assert.equal(f.window.activation_state,'unknown');await assert.rejects(c.activate(f.window.window_id),/activation_refused/);
 assert.equal((await c.close(f.window.window_id)).operationally_closed,false);
});
test('configured pricing and per-allocation cap validated without hardcoded canary dollars',async()=>{
 const f=fixture();f.options.policy.rate_microusd_per_second=100;f.options.policy.limit_microusd=500000;f.options.policy.per_allocation_cap_microusd=200000;
 assert.equal((await f.controller().authorizeWindow({request_sha256:'c'.repeat(64)})).reservation_estimate_microusd,180000);
 f.options.policy.per_allocation_cap_microusd=179999;assert.throws(f.controller,/allocation_cap_exceeded/);
 f.options.policy.rate_microusd_per_second=-1;assert.throws(f.controller,/policy_invalid/);
});

test('token acquisition cannot carry activation beyond its durable deadline',async()=>{
 const f=fixture();f.window.activation_state='not_started';const token=f.options.getToken;
 f.options.getToken=async()=>{if(f.window.activation_state==='claimed')f.time(420001);return token();};
 await assert.rejects(f.controller().activate(f.window.window_id),/activation_deadline/);
 assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
});

test('post-token withdrawn consent or replaced intent lease refuses activation',async()=>{
 for(const reason of ['withdrawn-consent','replaced-lease']){
  const f=fixture();f.window.activation_state='not_started';let current=true;const token=f.options.getToken;
  f.options.getToken=async()=>{if(f.window.activation_state==='claimed')current=false;return token();};
  f.options.lifecycleStore.authorizeActivationDispatch=async()=>current;
  await assert.rejects(f.controller().activate(f.window.window_id),/activation_authority_changed/,reason);
  assert.equal(f.calls.filter(call=>call.method==='POST').length,0);
 }
});
