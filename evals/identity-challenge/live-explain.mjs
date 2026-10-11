// Parser/type check only. EXPLAIN without ANALYZE never executes these writes.
// Run only through an explicitly isolated development database binding.
import { q } from "../../api/_db.js";
import {
  issueOwnedVoiceChallenge, leaseNextVoiceChallenge, completeVoiceChallenge,
  decideVoiceChallenge, voiceChallengeSentenceHash,
} from "../../api/_replica-voice-identity.js";

const REPLICA = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const CHALLENGE = "30000000-0000-4000-8000-000000000003";
const CAPTURE = "40000000-0000-4000-8000-000000000004";
const TRANSCRIPT = "50000000-0000-4000-8000-000000000005";
const sentence = "The blue bus stopped near the market. Code 1 2 3 4 5 6.";
const nonce = "1 2 3 4 5 6";
const sentenceHash = voiceChallengeSentenceHash(sentence);
const capSha = "a".repeat(64);
const trSha = "b".repeat(64);
const vector = [1, 0, 0, 0, 0, 0, 0, 0];
let checks = 0;
async function explain(label, invoke, fixtureRows = []) {
  let statements = 0;
  const result = await invoke(async (sql, params) => {
    if (!/^\s*with\s/i.test(sql)) throw new Error("unexpected_identity_parser_statement");
    await q(`explain (format json) ${sql}`, params);
    statements++;
    return fixtureRows;
  });
  if (statements !== 1) throw new Error("identity_parser_statement_count_invalid");
  console.log(`ok ${++checks} - ${label}`);
  return result;
}

await explain("issue with latest-reference eligibility parses",
  db => issueOwnedVoiceChallenge(db, OWNER, REPLICA, { sentence, nonce, challengeId: CHALLENGE }));

const lease = await explain("exact issued-reference lease parses", db => leaseNextVoiceChallenge(db,
  { name: "parser-fixture", version: "parser-v1", verify() { throw new Error("parser_must_not_verify"); } },
  { leaseToken: "parser-only-lease-token-at-least-thirty-two-characters" }), [{
  challenge_id: CHALLENGE, replica_id: REPLICA, owner_user_id: OWNER,
  sentence, sentence_hash: sentenceHash, nonce,
  captured_source_id: CAPTURE, transcript_source_id: TRANSCRIPT, verification_attempt: 1,
  verification_lease_expires_at: "2026-09-07T00:05:00.000Z", reference_genome_version: 2, genome_version: 2,
  cap_kind: "video", cap_mime: "video/webm", cap_byte_size: 1000, cap_sha256: capSha,
  cap_bucket: "fixture-bucket", cap_path: `${OWNER}/${REPLICA}/${CAPTURE}/original`,
  tr_kind: "audio", tr_mime: "audio/wav", tr_byte_size: 1000, tr_sha256: trSha,
  tr_bucket: "fixture-bucket", tr_path: `${OWNER}/${REPLICA}/${TRANSCRIPT}/original`,
  embedding_families: { "speechbrain-ecapa-voxceleb": [{ vector }, { vector }] },
  reference_source_ids: [],
}]);

const verdict = decideVoiceChallenge({ sentence, sentenceHash, nonce,
  referenceEmbeddings: [vector, vector], candidateEmbeddings: [vector], recognizedText: sentence,
  inputSha256: capSha, transcriptInputSha256: trSha, referenceGenomeVersion: 2,
  verifier: lease.verifierName, verifierVersion: lease.verifierVersion,
});
await explain("reference-bound settlement parses without executing identity writes",
  db => completeVoiceChallenge(db, lease, verdict), [{ challenge_id: CHALLENGE, state: "verified", decision: "accept" }]);
console.log(`Identity reference SQL: ${checks} EXPLAIN checks; synthetic control-flow rows only, no identity acceptance or SQL mutation.`);
