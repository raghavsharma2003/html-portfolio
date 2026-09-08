import { canonicalJson, sha256Hex } from './_provenance/contracts.js';
import { CALIBRATION_SCENARIOS } from './_replica-calibration.js';
import { compileReplicaRuntimeCore, REPLICA_CORE_CAP } from './_replica-runtime.js';
const hash = value => sha256Hex(canonicalJson(value));
const fail = code => { throw Object.assign(new Error(code), { code, status:409 }); };
export const CORRECTION_ARTIFACT_SCHEMA = 'vyakti.private-correction-policy.v1';

export function buildPrivateCorrectionArtifact(runtime, proposal) {
  if (proposal?.status !== 'proposed' || proposal.owner_approved !== false || proposal.runtime_eligible !== false
    || !proposal.selections?.length) fail('correction_candidate_proposal_required');
  const artifact = { schema:CORRECTION_ARTIFACT_SCHEMA, purpose:'private_candidate_evaluation',
    replica_id:runtime.replica.replica_id, capability_id:runtime.capability.capability_id,
    profile_hash:hash(runtime.personProfile.definition), calibration_hash:hash(runtime.calibration.definition),
    source_set_hash:proposal.source_set_hash, proposal, owner_approved:false };
  // Exercise the same renderer used by the future blind materializer before
  // registering an artifact, without generating an answer or storing core text.
  renderPrivateCorrectionCandidate(runtime,artifact);
  return {artifact,artifact_sha256:hash(artifact)};
}

export function renderPrivateCorrectionCandidate(runtime, artifact) {
  if (artifact?.schema !== CORRECTION_ARTIFACT_SCHEMA || artifact.purpose !== 'private_candidate_evaluation'
    || artifact.owner_approved !== false || artifact.replica_id !== runtime.replica.replica_id
    || artifact.capability_id !== runtime.capability.capability_id || artifact.profile_hash !== hash(runtime.personProfile.definition)
    || artifact.calibration_hash !== hash(runtime.calibration.definition)) fail('correction_candidate_baseline_changed');
  const selections=artifact.proposal?.selections;
  if (!Array.isArray(selections) || !selections.length || selections.length>CALIBRATION_SCENARIOS.length)
    fail('correction_candidate_selection_invalid');
  const axes=new Set(), directives=[];
  for (const selection of selections) {
    const scenario=CALIBRATION_SCENARIOS.find(row=>row.scenario_id===selection.scenario_id);
    const option=scenario && [scenario.left,scenario.right].find(row=>row.id===selection.strategy_id);
    if(!option || axes.has(`${scenario.layer}.${scenario.axis}`)) fail('correction_candidate_selection_invalid');
    axes.add(`${scenario.layer}.${scenario.axis}`);
    directives.push(`${scenario.layer}.${scenario.axis}: ${option.directive}`);
  }
  // Preserve unmodified approved strategies under their accurate existing
  // label. The changed experimental axes are not forged owner preferences.
  const calibration={...runtime.calibration.definition,
    strategies:(runtime.calibration.definition.strategies || []).filter(row=>!axes.has(`${row.layer}.${row.axis}`))};
  const core=compileReplicaRuntimeCore(runtime.personProfile.definition,calibration)
    + '\nExperimental candidate behavior shapes (inferred from private corrections, not owner-approved):\n'
    + directives.join('\n');
  if(core.length>REPLICA_CORE_CAP) fail('correction_candidate_core_too_large');
  return {core,artifact_sha256:hash(artifact),purpose:'private_candidate_evaluation',runtime_eligible:false};
}
