// Source preparation only. Importing this module performs no database or provider work.
import {ELIGIBLE_TRANSCRIPTS_SQL,CLAIM_EXTRACTION_OPEN_SQL,CLAIM_EXTRACTION_PERSIST_SQL} from '../api/_replica-claims.js';
import {CLAIM_EXTRACTION_SCHEMA} from '../api/_claim-extraction/contracts.js';
import {REPLICA_POLICY_VERSION} from '../api/_replica.js';
import {CLAIMS_SQL,DECIDE_OWNED_CLAIM_SQL} from '../api/_person-model.js';

export function proofStatements({replicaId,ownerId,evidenceId,sourceId,runId,consentIds,
 inputSetHash,inputSha256,recordHash,leaseTokenHash,proposalHash}){
 const inputs=JSON.stringify([{evidence_id:evidenceId,source_id:sourceId,input_sha256:inputSha256,record_hash:recordHash}]);
 const proposals=JSON.stringify([{domain:'knowledge',key:'proof_fact',body:'A cited proof fact.',origin:'observed',confidence:0.9,
  sensitive:false,t_valid_from:null,t_valid_to:null,source_ids:[sourceId],proposal_hash:proposalHash,
  citations:[{evidence_id:evidenceId,source_id:sourceId,start_char:0,end_char:5,quote_hash:'f'.repeat(64),entailment:0.9}]}]);
 return[
  {name:'context_claim_eligibility',sql:ELIGIBLE_TRANSCRIPTS_SQL,params:[replicaId,ownerId,CLAIM_EXTRACTION_SCHEMA]},
  {name:'context_claim_open',sql:CLAIM_EXTRACTION_OPEN_SQL,params:[replicaId,ownerId,REPLICA_POLICY_VERSION,
   CLAIM_EXTRACTION_SCHEMA,'claim-extraction','proof-extractor','proof-v1','proof-model',inputSetHash,consentIds,
   leaseTokenHash,300000,inputs]},
  {name:'context_claim_persist',sql:CLAIM_EXTRACTION_PERSIST_SQL,params:[replicaId,ownerId,REPLICA_POLICY_VERSION,
   runId,inputSetHash,leaseTokenHash,proposals,1,0,1]},
  {name:'context_claim_owner_preview',sql:CLAIMS_SQL,params:[replicaId,ownerId]},
  {name:'context_claim_accept',sql:DECIDE_OWNED_CLAIM_SQL,params:[1,replicaId,ownerId,'accepted','accurate',
   REPLICA_POLICY_VERSION,'approved']},
 ];
}

export const actualProofRequirements=Object.freeze([
 'Run EXPLAIN only against the isolated development database. Do not execute a provider call or mutate production.',
 'Exercise the owner-authored own_context text_span positive with a ready context_item source and exact canonical hashes.',
 'Prove otherwise identical unknown authorship, not_mine authorship, WhatsApp format, third-party source, removed item, superseded item, changed source hash and non-ready source return no eligible row.',
 'Prove missing epistemic_status, observation_target, protected_trait_inference and inner_state_inference JSON fields cannot be accepted and make every bound current profile invalid.',
 'Preserve and separately prove the existing accepted target-speaker transcript branch.',
 'EXPLAIN proves parser and type acceptance only. A rollback-scoped concurrent clear-versus-acceptance control must separately prove that an erased claim cannot finish approved or pass current profile validity.',
 'Roll back all synthetic fixtures, confirm fixture absence and close every connection. Source fixtures do not establish SQL correctness.',
]);
