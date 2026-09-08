// Exact observed Azure deployment receipt contract for private comparisons.
// Source integration is not proof of a live call or immutable model weights.
import {createHash} from 'node:crypto';
export const PROVIDER_REVISION_CONTRACT='vyakti.azure-reported-revision.v1';
const canonical=value=>value===null||typeof value!=='object'?JSON.stringify(value):Array.isArray(value)?`[${value.map(canonical).join(',')}]`:`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
const fail=(code,usage)=>{throw Object.assign(new Error(code),{code,...(usage?{measured_usage:usage}:{})});};
export function prepareProviderRevisionBinding({expectedResponseModel,endpoint,deployment,baselineSnapshotHash}={}){
  if(expectedResponseModel!=='gpt-4.1-mini-2025-04-14')fail('provider_revision_expected_version_required');
  const url=new URL(endpoint);
  if(url.origin!=='https://raghavsharma1729-compan-resource.services.ai.azure.com'||url.pathname!=='/'||url.search||url.hash||url.username||url.password)fail('provider_revision_endpoint_required');
  if(deployment!=='gpt-4.1-mini'||!/^[a-f0-9]{64}$/.test(baselineSnapshotHash||''))fail('provider_revision_baseline_required');
  const binding={schema:PROVIDER_REVISION_CONTRACT,expected_response_model:expectedResponseModel,endpoint:url.origin,deployment,baseline_snapshot_hash:baselineSnapshotHash};
  return Object.freeze({...binding,binding_hash:digest(binding)});
}
export function verifyProviderRevision(payload,binding,measuredUsage){
  if(binding?.schema!==PROVIDER_REVISION_CONTRACT||typeof binding.binding_hash!=='string')fail('provider_revision_binding_required',measuredUsage);
  const {binding_hash,...shape}=binding;
  if(digest(shape)!==binding_hash)fail('provider_revision_binding_changed',measuredUsage);
  if(payload?.model!==binding.expected_response_model)fail('provider_revision_response_model_mismatch',measuredUsage);
  if(typeof payload.system_fingerprint!=='string'||!/^fp_[A-Za-z0-9]{1,80}$/.test(payload.system_fingerprint))fail('provider_revision_fingerprint_unavailable',measuredUsage);
  const receipt={schema:PROVIDER_REVISION_CONTRACT,binding_hash,response_model:payload.model,system_fingerprint:payload.system_fingerprint};
  return Object.freeze({...receipt,reported_revision_hash:digest(receipt)});
}
export function assertSameReportedRevision(left,right){
  for(const r of [left,right]){
    if(r?.schema!==PROVIDER_REVISION_CONTRACT)fail('provider_pair_revision_receipt_required');
    const {reported_revision_hash,...shape}=r;
    if(digest(shape)!==reported_revision_hash)fail('provider_pair_revision_receipt_changed');
  }
  if(left.binding_hash!==right.binding_hash||left.response_model!==right.response_model||left.system_fingerprint!==right.system_fingerprint||left.reported_revision_hash!==right.reported_revision_hash)fail('provider_pair_revision_mismatch');
  return left.reported_revision_hash;
}
