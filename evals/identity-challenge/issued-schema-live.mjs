// Opt-in real development SQL test. Never included in the offline pool.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildIssuedVoiceContract } from "../../api/_voice-identity/issued-contract.js";

const TARGET = "vyakti_expert_integration_20260906";
const INSERT = `insert into vy_replica_voice_challenge
 (challenge_id,replica_id,owner_user_id,sentence,sentence_hash,nonce,policy_version,
  challenge_policy,reference_genome_version,expires_at,issued_locale,sentence_bank_version,
  verifier_profile,issued_contract,issued_contract_sha256)
 values ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9::integer,now()+interval '3 minutes',
  $10,$11,$12,$13::jsonb,$14) returning challenge_id`;

export async function runIssuedSchemaChecks(db) {
  assert.equal((await db("select current_database() as name"))[0]?.name, TARGET, "exact development database required");
  const owner = randomUUID(), replica = randomUUID(), ids = [], results = [];
  function row(locale = "hi-IN") {
    const challengeId = randomUUID(); ids.push(challengeId);
    const built = buildIssuedVoiceContract({ challengeId, replicaId: replica, ownerUserId: owner,
      locale, sentenceItemId: "item-1", nonce: "0 1 2 3 4 5", referenceGenomeVersion: 2 });
    return { id: challengeId, replica, owner, sentence: built.sentence, sentenceHash: built.contract.sentence_hash,
      nonce: built.nonce, policy: "replica-policy-fixture/v1", challengePolicy: "voice-identity-challenge/v2",
      reference: 2, locale, bank: built.contract.sentence_bank_version, profile: built.contract.verifier_profile,
      contract: JSON.parse(JSON.stringify(built.contract)), hash: built.contractSha256 };
  }
  async function exercise(name, mutate, accepted = false, locale = "hi-IN") {
    const r = row(locale); mutate(r);
    const params = [r.id,r.replica,r.owner,r.sentence,r.sentenceHash,r.nonce,r.policy,r.challengePolicy,
      r.reference,r.locale,r.bank,r.profile,r.rawContract ?? (r.contract === undefined ? null : JSON.stringify(r.contract)),r.hash];
    let error;
    try { await db(INSERT, params); } catch (e) { error = e; }
    if (accepted) assert.equal(error, undefined, `${name}: valid row rejected (${error?.code})`);
    else {
      assert.equal(error?.code, "23514", `${name}: expected CHECK rejection`);
      assert.match(error.constraint || "", /issued_contract/, `${name}: wrong constraint rejected fixture`);
    }
    results.push({ name, accepted });
  }
  try {
    await db(`explain (format json) ${INSERT}`, (() => {
      const r = row(); return [r.id,r.replica,r.owner,r.sentence,r.sentenceHash,r.nonce,r.policy,
        r.challengePolicy,r.reference,r.locale,r.bank,r.profile,JSON.stringify(r.contract),r.hash];
    })());
    await exercise("complete Hindi contract", () => {}, true);
    await exercise("complete English contract", () => {}, true, "en-IN");
    const legacy = (r) => { r.locale = r.bank = r.profile = r.hash = null; r.contract = undefined; r.reference = null; };
    await exercise("legacy v1 stays null", r => { legacy(r); r.challengePolicy = "voice-identity-challenge/v1"; }, true);
    await exercise("unknown historical policy is preserved only as legacy", r => { legacy(r); r.challengePolicy = "historical-fixture/v0"; }, true);
    await exercise("v2 cannot omit contract", legacy);
    for (const key of ["locale","bank","profile","hash","contract"]) {
      await exercise(`partial SQL null ${key}`, r => { r[key] = key === "contract" ? undefined : null; });
    }
    const template = row();
    for (const key of Object.keys(template.contract)) {
      await exercise(`missing JSON key ${key}`, r => { delete r.contract[key]; });
      await exercise(`JSON null ${key}`, r => { r.contract[key] = null; });
    }
    const cases = [
      ["extra JSON field", r => { r.contract.extra = "not permitted"; }],
      ["JSON array", r => { r.contract = []; }],
      ["JSON scalar", r => { r.contract = "not an object"; }],
      ["JSON null document", r => { r.contract = null; }],
      ["unknown locale", r => { r.locale = r.contract.issued_locale = "auto"; }],
      ["locale bank mismatch", r => { r.locale = r.contract.issued_locale = "en-IN"; }],
      ["unknown profile", r => { r.profile = r.contract.verifier_profile = "external/v1"; }],
      ["policy mismatch", r => { r.challengePolicy = "voice-identity-challenge/v1"; }],
      ["owner mismatch", r => { r.contract.owner_user_id = randomUUID(); }],
      ["replica mismatch", r => { r.contract.replica_id = randomUUID(); }],
      ["challenge mismatch", r => { r.contract.challenge_id = randomUUID(); }],
      ["sentence hash mismatch", r => { r.contract.sentence_hash = "f".repeat(64); }],
      ["null reference", r => { r.reference = null; }],
      ["zero reference", r => { r.reference = r.contract.reference_genome_version = 0; }],
      ["reference mismatch", r => { r.contract.reference_genome_version = 3; }],
      ["string reference", r => { r.contract.reference_genome_version = "2"; }],
      ["numeric locale", r => { r.contract.issued_locale = 4; }],
      ["invalid contract hash", r => { r.hash = "bad"; }],
      ["oversized document", r => { r.contract.sentence_item_id = "x".repeat(5000); }],
    ];
    for (const [name, mutate] of cases) await exercise(name, mutate);
    const numericHash = await db(`select length(($1::jsonb)->>'hash')::int as width,
      (($1::jsonb)->>'hash') ~ '^[0-9a-f]{64}$' as looks_like_hash`, [JSON.stringify({hash: 1e63})]);
    assert.equal(Number(numericHash[0].width), 64);
    assert.equal(numericHash[0].looks_like_hash, true);
    for (const key of ["sentence_bank_sha256", "nonce_sha256", "verifier_profile_sha256"]) {
      await exercise(`numeric hash bypasses text shape but fails JSON type ${key}`, r => { r.contract[key] = 1e63; });
    }
    const expandedReference = '2.' + '0'.repeat(5000);
    const numericProbe = await db(`select ($1::jsonb)=to_jsonb(2::integer) as equal_reference,
      octet_length(($1::jsonb)::text)::int as bytes`, [expandedReference]);
    assert.equal(numericProbe[0].equal_reference, true);
    assert.ok(Number(numericProbe[0].bytes) > 4096);
    await exercise("oversized valid numeric reference isolates document limit", r => {
      r.rawContract = JSON.stringify(r.contract).replace('"reference_genome_version":2',
        '"reference_genome_version":' + expandedReference);
    });
    return { database: TARGET, checks: results.length, passed: results.length, realExplain: 1,
      cases: results, limitation: "SQL shape and row constraints only; no issuance, provider or identity acceptance" };
  } finally {
    await db(`delete from vy_replica_voice_challenge where owner_user_id=$1::uuid and replica_id=$2::uuid
      and challenge_id=any($3::uuid[]) returning challenge_id`, [owner, replica, ids]);
    const remaining = await db(`select count(*)::int as n from vy_replica_voice_challenge
      where owner_user_id=$1::uuid and replica_id=$2::uuid and challenge_id=any($3::uuid[])`, [owner, replica, ids]);
    assert.equal(Number(remaining[0]?.n), 0, "exact synthetic challenge cleanup must complete");
  }
}
