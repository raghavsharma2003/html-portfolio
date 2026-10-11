// Real development SQL lifecycle checks; no provider, object or identity writes.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { issueOwnedVoiceChallenge, voiceChallengeSentenceHash } from "../../api/_replica-voice-identity.js";
import { REPLICA_POLICY_VERSION } from "../../api/_replica.js";

export async function runSupersessionChecks(db) {
  assert.equal((await db("select current_database() as name"))[0]?.name,
    "vyakti_expert_integration_20260906", "exact development database required");
  const results = [];
  const sentence = "The blue bus stopped near the market. Code 0 1 2 3 4 5.";
  const nonce = "0 1 2 3 4 5";
  for (const scenario of ["eligible", "retired-latest", "missing-genome", "daily-limit", "duplicate-id", "missing-consent"]) {
    const owner = randomUUID(), replica = randomUUID(), previous = randomUUID();
    const capture = randomUUID(), transcript = randomUUID();
    const next = scenario === "duplicate-id" ? previous : randomUUID();
    try {
      await db(`insert into vy_replica (replica_id,owner_user_id,display_name,policy_version)
        values ($1::uuid,$2::uuid,'Synthetic supersession fixture',$3)`, [replica,owner,REPLICA_POLICY_VERSION]);
      if (scenario !== "missing-consent") {
        await db(`insert into vy_replica_consent (replica_id,owner_user_id,scope,method,policy_version,receipt_hash)
          select $1::uuid,$2::uuid,scope,'account_attestation',$3,$4
          from unnest(array['capture','storage']::text[]) scopes(scope)`, [replica,owner,REPLICA_POLICY_VERSION,"a".repeat(64)]);
      }
      if (scenario !== "missing-genome") {
        await db(`insert into vy_replica_voice_genome (replica_id,version,source_set_hash,definition,status)
          values ($1::uuid,1,$2,'{}'::jsonb,'draft')`, [replica,"b".repeat(64)]);
        if (scenario === "retired-latest") await db(`insert into vy_replica_voice_genome
          (replica_id,version,source_set_hash,definition,status) values ($1::uuid,2,$2,'{}'::jsonb,'retired')`,
          [replica,"c".repeat(64)]);
      }
      // These are SQL manifests only. No SAS, file, upload or storage access exists.
      for (const [id,kind,mime] of [[capture,"video","video/webm"],[transcript,"audio","audio/wav"]]) {
        await db(`insert into vy_replica_source
          (source_id,replica_id,owner_user_id,kind,capture_mode,storage_bucket,object_path,mime,sha256)
          values ($1::uuid,$2::uuid,$3::uuid,$4,'identity_challenge','fixture-no-object',$5,$6,$7)`,
          [id,replica,owner,kind,`${owner}/${replica}/${id}/original`,mime,"d".repeat(64)]);
      }
      await db(`insert into vy_replica_voice_challenge
        (challenge_id,replica_id,owner_user_id,sentence,sentence_hash,nonce,policy_version,challenge_policy,
         reference_genome_version,captured_source_id,transcript_source_id,expires_at)
        values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,'voice-identity-challenge/v1',1,$8::uuid,$9::uuid,now()+interval '3 minutes')`,
        [previous,replica,owner,sentence,voiceChallengeSentenceHash(sentence),nonce,REPLICA_POLICY_VERSION,capture,transcript]);
      if (scenario === "daily-limit") await db(`insert into vy_replica_voice_challenge
        (replica_id,owner_user_id,sentence,sentence_hash,nonce,policy_version,challenge_policy,state,expires_at)
        select $1::uuid,$2::uuid,$3,$4,$5,$6,'voice-identity-challenge/v1','expired',now()-interval '1 minute'
        from generate_series(1,9)`, [replica,owner,sentence,voiceChallengeSentenceHash(sentence),nonce,REPLICA_POLICY_VERSION]);
      const replacement = await issueOwnedVoiceChallenge(db,owner,replica,{sentence,nonce,challengeId:next});
      const old = (await db(`select state,failure_code from vy_replica_voice_challenge
        where challenge_id=$1::uuid and replica_id=$2::uuid and owner_user_id=$3::uuid`, [previous,replica,owner]))[0];
      const sources = await db(`select source_id,state from vy_replica_source
        where replica_id=$1::uuid and owner_user_id=$2::uuid and source_id=any($3::uuid[])`, [replica,owner,[capture,transcript]]);
      assert.equal(sources.length,2);
      if (scenario === "eligible") {
        assert.equal(replacement?.challenge_id,next);
        assert.equal(old.state,"expired"); assert.equal(old.failure_code,"challenge_superseded");
        assert.ok(sources.every(s=>s.state === "deleting"));
      } else {
        assert.equal(replacement,null, `${scenario}: replacement must not issue`);
        assert.equal(old.state,"issued", `${scenario}: prior challenge must remain speakable`);
        assert.equal(old.failure_code,"");
        assert.ok(sources.every(s=>s.state === "pending_upload"), `${scenario}: source state must remain unchanged`);
      }
      results.push({scenario,passed:true});
    } finally {
      // Exact generated tuple only; no full-erasure worker or external deletion.
      await db(`delete from vy_replica_voice_challenge_attempt where replica_id=$1::uuid and owner_user_id=$2::uuid`, [replica,owner]);
      await db(`delete from vy_replica_voice_challenge where replica_id=$1::uuid and owner_user_id=$2::uuid`, [replica,owner]);
      await db(`delete from vy_replica_audit where replica_id=$1::uuid and owner_user_id=$2::uuid`, [replica,owner]);
      await db(`delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid`, [replica,owner]);
      const remaining = await db(`select
        (select count(*) from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid)+
        (select count(*) from vy_replica_source where replica_id=$1::uuid and owner_user_id=$2::uuid)+
        (select count(*) from vy_replica_voice_challenge where replica_id=$1::uuid and owner_user_id=$2::uuid)+
        (select count(*) from vy_replica_audit where replica_id=$1::uuid and owner_user_id=$2::uuid)+
        (select count(*) from vy_replica_consent where replica_id=$1::uuid and owner_user_id=$2::uuid)+
        (select count(*) from vy_replica_voice_genome where replica_id=$1::uuid) as n`, [replica,owner]);
      assert.equal(Number(remaining[0].n),0,"synthetic supersession cleanup required");
    }
  }
  return {scenarios:results,passed:results.length,exactFixtureCleanup:true,
    limitation:"Sequential SQL lifecycle proof only; no concurrent serialization or voice identity acceptance"};
}
