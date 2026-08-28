// Production ledger adapter over the repository's parameterized Neon client.
// Every segment insert re-checks the active replica capability in the same SQL
// statement. Revocation therefore fences the next 240 ms segment before its
// bytes can be released by protectReplicaStream.
function one(rows, code) {
  if (!rows?.[0]) throw Object.assign(new Error(code), { code });
  return rows[0];
}

export function createNeonProvenanceLedger(db) {
  if (typeof db !== "function") throw new Error("provenance db required");
  return {
    name: "neon-provenance-ledger",
    async open(input) {
      return one(await db(
        `update vy_replica_generation g
            set state='streaming',streaming_at=coalesce(streaming_at,now()),
                disclosure_scheme=$4,watermark_algorithm=$5,provenance_standard=$6,
                watermark_token_hash=$7,updated_at=now()
           from vy_replica r,vy_replica_runtime_capability c
          where g.generation_id=$1 and g.replica_id=$2 and g.owner_user_id=$3
            and r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
            and r.lifecycle='active'
            and c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
            and c.agent_id=r.agent_id and c.state='active'
            and c.voice_profile_id=g.voice_profile_id and c.genome_version=g.genome_version
            and c.profile_version=g.profile_version and c.calibration_version=g.calibration_version
            and g.state='authorized'
          returning g.generation_id`,
        [input.generationId,input.replicaId,input.ownerUserId,input.disclosureScheme,
         input.watermarkAlgorithm,input.provenanceStandard,input.watermarkTokenHash],
      ), "generation_open_denied");
    },
    async appendSegment({ authorization, receipt }) {
      return one(await db(
        `insert into vy_replica_generation_segment_receipt
           (generation_id,sequence,byte_offset,byte_length,segment_sha256,
            previous_chain_sha256,chain_sha256,signature_algorithm,signer_key_id,
            chain_signature,issued_at)
         select $1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13
           from vy_replica_generation g
           join vy_replica r on r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
           join vy_replica_runtime_capability c
            on c.replica_id=r.replica_id and c.owner_user_id=r.owner_user_id
            and c.agent_id=r.agent_id and c.state='active'
            and c.voice_profile_id=g.voice_profile_id and c.genome_version=g.genome_version
            and c.profile_version=g.profile_version and c.calibration_version=g.calibration_version
          where g.generation_id=$1 and g.replica_id=$2 and g.owner_user_id=$3
            and g.state='streaming' and r.lifecycle='active'
         on conflict (generation_id,sequence) do update
           set issued_at=vy_replica_generation_segment_receipt.issued_at
         where vy_replica_generation_segment_receipt.byte_offset=excluded.byte_offset
           and vy_replica_generation_segment_receipt.byte_length=excluded.byte_length
           and vy_replica_generation_segment_receipt.segment_sha256=excluded.segment_sha256
           and vy_replica_generation_segment_receipt.previous_chain_sha256=excluded.previous_chain_sha256
           and vy_replica_generation_segment_receipt.chain_sha256=excluded.chain_sha256
           and vy_replica_generation_segment_receipt.signature_algorithm=excluded.signature_algorithm
           and vy_replica_generation_segment_receipt.signer_key_id=excluded.signer_key_id
           and vy_replica_generation_segment_receipt.chain_signature=excluded.chain_signature
         returning generation_id,sequence`,
        [authorization.generationId,authorization.replicaId,authorization.ownerUserId,
         receipt.sequence,receipt.byte_offset,receipt.byte_length,receipt.segment_sha256,
         receipt.previous_chain_sha256,receipt.chain_sha256,receipt.signature_algorithm,
         receipt.signer_key_id,receipt.chain_signature,receipt.issued_at],
      ), "generation_revoked_or_segment_replayed");
    },
    async seal({ authorization, receipt, envelopeCanonical, audioHash, watermarkTokenHash, manifestHash, segmentCount, finalChainSha256, sealedAt }) {
      if (typeof envelopeCanonical !== "string" || Buffer.byteLength(envelopeCanonical) < 128 ||
          Buffer.byteLength(envelopeCanonical) > 16_384) throw new Error("invalid_public_envelope");
      return one(await db(
        `with sealed as (
           update vy_replica_generation g
              set state='sealed',audio_sha256=$4,watermark_token_hash=$5,manifest_sha256=$6,
                  ledger_envelope_hash=$7,segment_count=$8,final_chain_sha256=$9,
                  sealed_at=$10,updated_at=now()
             from vy_replica r,vy_replica_runtime_capability c
            where g.generation_id=$1 and g.replica_id=$2 and g.owner_user_id=$3
              and r.replica_id=g.replica_id and r.owner_user_id=g.owner_user_id
              and r.lifecycle='active' and c.replica_id=r.replica_id
              and c.owner_user_id=r.owner_user_id and c.agent_id=r.agent_id and c.state='active'
              and c.voice_profile_id=g.voice_profile_id and c.genome_version=g.genome_version
              and c.profile_version=g.profile_version and c.calibration_version=g.calibration_version
              and g.state='streaming'
           returning g.generation_id
         ), public_receipt as (
           insert into vy_replica_generation_receipt
             (generation_id,replica_commitment,policy_version,channel,disclosure_scheme,
              disclosure_text_hash,watermark_algorithm,watermark_token_hash,detector_policy_hash,
              provenance_standard,manifest_location,manifest_sha256,audio_sha256,segment_count,
              final_chain_sha256,envelope_sha256,signature_algorithm,signer_key_id,envelope_signature,issued_at)
           select $1,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$6,$4,$8,$9,$7,$21,$22,$23,$24
             from sealed
           returning generation_id
         ), public_envelope as (
           insert into vy_replica_generation_receipt_envelope
             (generation_id,envelope_sha256,envelope_canonical)
           select generation_id,$7,decode($25,'base64') from public_receipt
           returning generation_id
         ) select generation_id from public_envelope`,
        [authorization.generationId,authorization.replicaId,authorization.ownerUserId,
         audioHash,watermarkTokenHash,manifestHash,receipt.envelope_sha256,segmentCount,
         finalChainSha256,sealedAt,receipt.replica_commitment,receipt.policy_version,
         receipt.channel,receipt.disclosure_scheme,receipt.disclosure_text_hash,
         receipt.watermark_algorithm,receipt.watermark_token_hash,receipt.detector_policy_hash,
         receipt.provenance_standard,receipt.manifest_location,receipt.signature_algorithm,
         receipt.signer_key_id,receipt.envelope_signature,receipt.issued_at,
         Buffer.from(envelopeCanonical).toString("base64")],
      ), "generation_seal_denied");
    },
    async abort(input) {
      await db(
        `update vy_replica_generation
            set state=case when state='sealed' then state else 'aborted' end,
                failure_code=case when state='sealed' then failure_code else $4 end,
                updated_at=now()
          where generation_id=$1 and replica_id=$2 and owner_user_id=$3`,
        [input.generationId,input.replicaId,input.ownerUserId,String(input.failureCode || "delivery_aborted").slice(0,120)],
      );
    },
  };
}
