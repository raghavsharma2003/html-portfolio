// Exact observed Azure deployment receipt contract for private comparisons.
// Source integration is not proof of a live call or immutable model weights.
import {createHash} from 'node:crypto';
export const PROVIDER_REVISION_CONTRACT='vyakti.azure-reported-revision.v1';
export const PROVIDER_REVISION_CONTRACT_V2='vyakti.azure-reported-revision.v2';
const MODEL_CONTRACTS=Object.freeze({
  'gpt-4.1-mini':Object.freeze({schema:PROVIDER_REVISION_CONTRACT,expectedResponseModel:'gpt-4.1-mini-2025-04-14',fingerprint:'required'}),
  'gpt-5.6-terra':Object.freeze({schema:PROVIDER_REVISION_CONTRACT_V2,expectedResponseModel:'gpt-5.6-terra-2026-07-09',fingerprint:'reported_or_explicitly_absent'}),
});
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,usage)=>{throw Object.assign(new Error(code),{code,...(usage?{measured_usage:usage}:{})});};
function modelContract(deployment,expectedResponseModel,usage){
  const contract=MODEL_CONTRACTS[deployment];
  if(!contract)fail('provider_revision_deployment_required',usage);
  if(expectedResponseModel!==contract.expectedResponseModel)fail('provider_revision_expected_version_required',usage);
  return contract;
}
export function providerRevisionDeployment(expectedResponseModel,schema){
  const match=Object.entries(MODEL_CONTRACTS).find(([,contract])=>contract.expectedResponseModel===expectedResponseModel&&contract.schema===schema);
  if(!match)fail('provider_revision_expected_version_required');
  return match[0];
}
export function prepareProviderRevisionBinding({expectedResponseModel,endpoint,deployment,baselineSnapshotHash}={}){
  const contract=modelContract(deployment,expectedResponseModel);
  const url=new URL(endpoint);
  if(url.origin!=='https://raghavsharma1729-compan-resource.services.ai.azure.com'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)fail('provider_revision_endpoint_required');
  if(!/^[a-f0-9]{64}$/.test(baselineSnapshotHash||''))fail('provider_revision_baseline_required');
  const binding={schema:contract.schema,expected_response_model:expectedResponseModel,endpoint:url.origin,deployment,baseline_snapshot_hash:baselineSnapshotHash};
  return Object.freeze({...binding,binding_hash:digest(binding)});
}
export function verifyProviderRevision(payload,binding,measuredUsage){
  if(typeof binding?.binding_hash!=='string')fail('provider_revision_binding_required',measuredUsage);
  const {binding_hash,...shape}=binding;
  if(digest(shape)!==binding_hash)fail('provider_revision_binding_changed',measuredUsage);
  const contract=modelContract(binding.deployment,binding.expected_response_model,measuredUsage);
  if(binding.schema!==contract.schema)fail('provider_revision_binding_required',measuredUsage);
  if(payload?.model!==binding.expected_response_model)fail('provider_revision_response_model_mismatch',measuredUsage);
  const fingerprint=payload?.system_fingerprint;
  const provided=typeof fingerprint==='string'&&/^fp_[A-Za-z0-9]{1,80}$/.test(fingerprint);
  if(contract.fingerprint==='required'&&!provided)fail('provider_revision_fingerprint_unavailable',measuredUsage);
  if(contract.fingerprint!=='required'&&!provided&&
    (!Object.prototype.hasOwnProperty.call(payload||{},'system_fingerprint')||fingerprint!==null))
    fail('provider_revision_fingerprint_unavailable',measuredUsage);
  const receipt=contract.schema===PROVIDER_REVISION_CONTRACT
    ?{schema:contract.schema,binding_hash,response_model:payload.model,system_fingerprint:fingerprint}
    :{schema:contract.schema,binding_hash,response_model:payload.model,
      fingerprint_status:provided?'provided':'not_provided',system_fingerprint:provided?fingerprint:null};
  return Object.freeze({...receipt,reported_revision_hash:digest(receipt)});
}
export function assertSameReportedRevision(left,right){
  for(const r of [left,right]){
    if(!r||typeof r.reported_revision_hash!=='string')fail('provider_pair_revision_receipt_required');
    const {reported_revision_hash,...shape}=r;
    if(digest(shape)!==reported_revision_hash)fail('provider_pair_revision_receipt_changed');
    const deployment=providerRevisionDeployment(r?.response_model,r?.schema);
    const contract=MODEL_CONTRACTS[deployment];
    if(contract.schema===PROVIDER_REVISION_CONTRACT){
      if(typeof r.system_fingerprint!=='string'||!/^fp_[A-Za-z0-9]{1,80}$/.test(r.system_fingerprint))fail('provider_pair_revision_receipt_required');
    }else if(!((r.fingerprint_status==='provided'&&typeof r.system_fingerprint==='string'&&/^fp_[A-Za-z0-9]{1,80}$/.test(r.system_fingerprint))
      ||(r.fingerprint_status==='not_provided'&&r.system_fingerprint===null)))fail('provider_pair_revision_receipt_required');
  }
  if(left.schema!==right.schema||left.binding_hash!==right.binding_hash||left.response_model!==right.response_model
    ||left.fingerprint_status!==right.fingerprint_status||left.system_fingerprint!==right.system_fingerprint
    ||left.reported_revision_hash!==right.reported_revision_hash)fail('provider_pair_revision_mismatch');
  return left.reported_revision_hash;
}
