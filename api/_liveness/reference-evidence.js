import {canonicalJson,createEvidenceRecord,sha256Hex} from '../_replica-processing/contracts.js';
import {getIssuedVoiceProfile} from '../_voice-identity/issued-contract.js';
import {captureContractError} from './issued-contract.js';
const json=canonicalJson;
const fail=(part,status=409)=>{throw captureContractError(part,status);};
export function referenceFromAuthority(row) {
  const b=row?.binding, rows=row?.reference_rows;
  if (!b || !Array.isArray(rows) || rows.length!==3) fail('reference_unavailable',503);
  const pins=rows.map(e=>({evidence_id:e.evidence_id,record_hash:e.record_hash,decision_id:e.decision_id}))
    .sort((a,b)=>a.evidence_id.localeCompare(b.evidence_id));
  if (json(pins)!==json(b.evidence_pins) || new Set(rows.map(e=>e.created_by_job_id)).size!==1)
    fail('reference_record_mismatch');
  for (const e of rows) {
    const rebuilt=createEvidenceRecord({...e,adapter_stage:'voice_quality',
      span:e.span_start_ms==null?null:{start_ms:e.span_start_ms,end_ms:e.span_end_ms},
      adapter:{family:e.adapter_family,name:e.adapter_name,version:e.adapter_version,measure() {}}});
    if (rebuilt.record_hash!==e.record_hash || rebuilt.evidence_id!==e.evidence_id ||
        e.replica_id!==b.replica_id || e.owner_user_id!==b.owner_user_id || e.source_id!==b.primary_source_id)
      fail('reference_record_mismatch');
  }
  const measurements=rows.filter(e=>e.evidence_type==='voice_measurement');
  const embeddings=rows.filter(e=>e.evidence_type==='voice_embedding');
  const revisions=measurements[0]?.value?.measurements?.model_revisions;
  const expected=getIssuedVoiceProfile().speaker.expected_candidate_revisions;
  if (measurements.length!==1 || embeddings.length!==2 || !revisions ||
      Object.entries(expected).some(([name,revision])=>revisions[name]!==revision)) fail('reference_revision_unavailable',503);
  for (const [family,model] of Object.entries({'speechbrain-ecapa-voxceleb':'speechbrain-ecapa','speechbrain-xvector-voxceleb':'speechbrain-xvector'})) {
    const matches=embeddings.filter(e=>e.value.family===family);
    const e=matches[0], vector=e?.value?.vector;
    if (matches.length!==1 || e.value.model_revision!==expected[model] || e.artifact_id!==b.artifact_id ||
        e.input_sha256!==b.artifact_sha256 || !Array.isArray(vector) || vector.length<64 || vector.length>2048 ||
        vector.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>10) || !vector.some(n=>n!==0))
      fail('reference_revision_unavailable',503);
  }
  if (measurements[0].input_sha256!==sha256Hex({schema_version:'voice-analysis-input-set/v1',inputs:measurements[0].value.input_set}) ||
      !measurements[0].value.input_set.some(i=>i.artifact_id===b.artifact_id && i.sha256===b.artifact_sha256))
    fail('reference_input_mismatch');
  return {source_id:b.primary_source_id,source_sha256:b.primary_source_sha256,
    model_revisions:Object.fromEntries(Object.keys(expected).map(key=>[key,revisions[key]])),
    embeddings:embeddings.map(e=>({family:e.value.family,vector:e.value.vector})).sort((a,b)=>a.family.localeCompare(b.family))};
}

