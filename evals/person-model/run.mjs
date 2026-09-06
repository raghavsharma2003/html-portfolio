import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PERSON_MODEL_SCHEMA,
  approveOwnedPersonProfile,
  buildOwnedPersonProfile,
  buildPersonModelDefinition,
  clientClaim,
  decideOwnedClaim,
  ownedPersonModelStatus,
  personProfileValiditySql,
  personModelReadiness,
  personModelSourceHash,
  reconcileUnsafePersonProfiles,
} from "../../api/_person-model.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RID = "10000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

function claim(id, domain, key, body, extra = {}) {
  return {
    claim_id: String(id), replica_id: RID, owner_user_id: OWNER,
    domain, key, body, origin: "self_declared", confidence: 0.96,
    status: "approved", source_ids: [`${String(id).padStart(8, "0")}-0000-4000-8000-000000000000`],
    sensitive: false, t_valid_from: null, t_valid_to: null,
    decision: "accepted", reason_code: "representative",
    created_at: "2026-08-24T00:00:00.000Z", updated_at: "2026-08-24T00:00:00.000Z",
    ...extra,
  };
}

const claims = [
  claim(1, "identity", "self_name", "Asha"),
  claim(2, "identity", "pronouns", "she/her"),
  claim(3, "language", "languages", "Hinglish, Hindi, English"),
  claim(4, "language", "code_switching", "Hindi when emotionally direct; English for technical detail"),
  claim(5, "language", "fillers", "hmm, matlab, yaar"),
  claim(6, "delivery", "pacing", "Fast when excited, slower in repair"),
  claim(7, "delivery", "turn_shape", "Short observations, then one curious question"),
  claim(8, "habit", "humor", "Dry teasing, never humiliating"),
  claim(9, "relationship", "repair", "Names the miss, apologizes once, and changes course"),
  claim(10, "value", "honesty", "Prefer an uncomfortable truth over a soothing invention"),
  claim(11, "boundary", "privacy", "Never expose a private conversation to another person"),
  claim(12, "biography", "childhood_city", "Grew up in Pune"),
];

const ready = personModelReadiness(claims);
ok("typed identity, language, behavior and boundary evidence is build-ready", ready.ready && ready.accepted_claims === claims.length);
ok("a missing boundary fails closed", personModelReadiness(claims.filter((row) => row.domain !== "boundary")).blockers.includes("boundary_evidence_required"));
const conflict = [...claims, claim(13, "identity", "self_name", "Someone else", { confidence: 0.99 })];
ok("critical identity disagreement is preserved as a blocker", personModelReadiness(conflict).conflicts.includes("identity:self_name"));

const definition = buildPersonModelDefinition(claims);
ok("Person Model has a versioned typed schema", definition.schema === PERSON_MODEL_SCHEMA);
ok("language and behavioral style remain separate layers", definition.speech.languages.includes("Hinglish") && /Dry teasing/.test(definition.behavior.humor));
ok("values, boundaries and autobiography remain separate", definition.values.length === 1 && definition.boundaries.length === 1 && definition.autobiography[0].kind === "biography");
ok("definition provenance carries claim ids but no source ids", definition.provenance.claims.length === claims.length && !/source_ids|provider_ref|object_path|raw_transcript/.test(JSON.stringify(definition)));
ok("same accepted evidence has a stable source commitment", personModelSourceHash(claims) === personModelSourceHash([...claims].reverse()));
ok("changing claim content changes the source commitment", personModelSourceHash(claims) !== personModelSourceHash(claims.map((row) => row.claim_id === "8" ? { ...row, body: "Different humor" } : row)));
const clock = Date.parse("2026-08-24T12:00:00.000Z");
const expiredBoundary = claims.map((row) => row.domain === "boundary" ? { ...row, t_valid_to: "2026-08-24T11:59:59.000Z" } : row);
ok("expired evidence cannot satisfy readiness", personModelReadiness(expiredBoundary, clock).blockers.includes("boundary_evidence_required"));
ok("expired evidence is absent from the source commitment", personModelSourceHash(expiredBoundary, clock) === personModelSourceHash(claims.filter((row) => row.domain !== "boundary"), clock));

const exposed = clientClaim({ ...claims[0], provider_ref: "secret", transcript: "raw", input_sha256: "a".repeat(64) });
ok("client claim is whitelist-built", !/(provider_ref|transcript|input_sha256|source_ids)/.test(JSON.stringify(exposed)) && exposed.source_count === 1);
const cited = clientClaim({
  ...claims[0],
  citation_previews: [{ excerpt: "I am Asha.", entailment: 0.97, evidence_id: RID, source_id: RID }],
});
ok("owner review exposes only bounded citation text and confidence, never evidence identifiers",
  cited.citation_previews[0].excerpt === "I am Asha."
  && !/(evidence_id|source_id)/.test(JSON.stringify(cited.citation_previews)));

function rowForSql(item) {
  return { ...item, source_count: item.source_ids.length, reviewed_at: "2026-08-24T01:00:00.000Z" };
}

const statusCalls = [];
const status = await ownedPersonModelStatus(async (sql, params) => {
  statusCalls.push({ sql, params });
  if (/select r\.replica_id,exists/i.test(sql)) return [{ replica_id: RID, training_consent: true }];
  if (/from vy_replica_claim c/i.test(sql)) return claims.map(rowForSql);
  if (/from vy_replica_profile p/i.test(sql)) return [];
  throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
}, OWNER, RID);
ok("owner sees reviewed claims without source identifiers", status.readiness.ready && !/source_ids/.test(JSON.stringify(status)));
ok("all Person Model reads bind replica and authenticated owner", statusCalls.every((call) => call.params[0] === RID && call.params[1] === OWNER));
const claimReadSql = statusCalls.find((call) => /from vy_replica_claim c/i.test(call.sql)).sql;
ok("citation previews recheck exact quote hashes and reveal no evidence or source ids",
  /cc\.end_char-cc\.start_char between 1 and 500/.test(claimReadSql)
  && /encode\(digest\(convert_to/.test(claimReadSql)
  && /\),'sha256'\),'hex'\)=cc\.quote_hash/.test(claimReadSql)
  && !/jsonb_build_object\([\s\S]{0,160}(evidence_id|source_id)/.test(claimReadSql));
const absent = await ownedPersonModelStatus(async (sql) => /select r\.replica_id,exists/i.test(sql) ? [] : [], OWNER, RID);
ok("cross-owner Person Model resolves to not found", absent === null);
const noTraining = await ownedPersonModelStatus(async (sql) => {
  if (/select r\.replica_id,exists/i.test(sql)) return [{ replica_id: RID, training_consent: false }];
  if (/from vy_replica_claim c/i.test(sql)) return claims.map(rowForSql);
  if (/from vy_replica_profile p/i.test(sql)) return [];
  return [];
}, OWNER, RID);
ok("status names current training revocation even when the claim set is otherwise ready",
  !noTraining.readiness.ready && noTraining.readiness.blockers[0] === "training_consent_required");

const decisionCalls = [];
const decision = await decideOwnedClaim(async (sql, params) => {
  decisionCalls.push({ sql, params });
  return [{ decision_id: RID, claim_id: "1", decision: params[3], reason_code: params[4], created_at: "2026-08-24T00:00:00.000Z" }];
}, OWNER, { replica_id: RID, claim_id: "1", decision: "accepted", reason_code: "representative" });
ok("claim review appends a controlled owner decision", decision.decision === "accepted");
ok("claim decision SQL binds claim, replica and owner before mutation", // claim_id is bigint and the replica/owner ids are uuid, so the casts
// evals/sqlcast.mjs requires here differ per column; the property under test is
// the binding order, not the spelling.
/c\.claim_id=\$1(?:::\w+)? and c\.replica_id=\$2(?:::\w+)? and c\.owner_user_id=\$3(?:::\w+)?/i.test(decisionCalls[0].sql));
ok("concurrent reviews serialize by exact claim and order after the lock is acquired",
  /pg_advisory_xact_lock\(hashtextextended\(c\.replica_id::text\|\|':'\|\|c\.claim_id::text\|\|':claim_review'/.test(decisionCalls[0].sql)
  && /clock_timestamp\(\)/.test(decisionCalls[0].sql)
  && /from owned o,decision d/.test(decisionCalls[0].sql));
ok("stale acceptance fails closed after supersession, lineage loss, lifecycle stop or training revocation",
  /\$4<>'accepted' or \(/.test(decisionCalls[0].sql)
  && /c\.status<>'superseded'/.test(decisionCalls[0].sql)
  && /consent\.scope='training'/.test(decisionCalls[0].sql)
  && /vy_replica_claim_citation/.test(decisionCalls[0].sql)
  && /vy_replica_processing_evidence/.test(decisionCalls[0].sql));
ok("rejecting a cited claim atomically retires its profile and closes dependent runtime work",
  /affected_profiles as materialized/.test(decisionCalls[0].sql)
  && /update vy_replica_profile p set status='retired'/.test(decisionCalls[0].sql)
  && /update vy_replica_calibration c set status='retired'/.test(decisionCalls[0].sql)
  && /update vy_replica_runtime_capability c[\s\S]*state='revoked'/.test(decisionCalls[0].sql)
  && /person_profile_claim_invalidated/.test(decisionCalls[0].sql));
await assert.rejects(decideOwnedClaim(async () => [], OWNER, { replica_id: RID, claim_id: "1", decision: "accepted", reason_code: "inaccurate" }), /invalid_claim_decision/);
ok("decision and reason vocabularies cannot be mixed", true);

const buildCalls = [];
const buildDb = async (sql, params) => {
  buildCalls.push({ sql, params });
  if (/from vy_replica_claim c/i.test(sql)) return claims.map(rowForSql);
  if (/with owned as/i.test(sql) && /insert into vy_replica_profile/i.test(sql))
    return [{ replica_id: RID, version: 1, status: "draft", created_at: "2026-08-24T00:00:00.000Z" }];
  throw new Error(`unexpected build SQL ${sql.slice(0, 80)}`);
};
const draft = await buildOwnedPersonProfile(buildDb, OWNER, RID);
ok("deterministic builder creates only a review draft", draft.version === 1 && draft.status === "draft");
const buildCall = buildCalls.find((call) => /insert into vy_replica_profile/i.test(call.sql));
ok("profile build serializes by replica and is source-set idempotent", /pg_advisory_xact_lock/i.test(buildCall.sql) && /on conflict \(replica_id,source_set_hash\)/i.test(buildCall.sql));
ok("profile build requires a current policy training grant",
  /c\.scope='training'/.test(buildCall.sql) && /c\.policy_version=r\.policy_version/.test(buildCall.sql)
  && /c\.revoked_at is null/.test(buildCall.sql));
ok("profile build revalidates every accepted claim after the pre-build read",
  /jsonb_array_elements\(\$4::jsonb#>'\{provenance,claims\}'\)/.test(buildCall.sql)
  && /latest_build_decision\.decision is distinct from 'accepted'/.test(buildCall.sql)
  && /current_claim\.status<>'approved'/.test(buildCall.sql));
ok("profile definition is server-built rather than request supplied", JSON.parse(buildCall.params[3]).schema === PERSON_MODEL_SCHEMA);

const approveCalls = [];
const approveDb = async (sql, params) => {
  approveCalls.push({ sql, params });
  if (/from vy_replica_claim c/i.test(sql)) return claims.map(rowForSql);
  if (/with owned as/i.test(sql) && /update vy_replica_profile/i.test(sql))
    return [{ replica_id: RID, version: 1, status: "approved", created_at: "2026-08-24T00:00:00.000Z" }];
  throw new Error(`unexpected approve SQL ${sql.slice(0, 80)}`);
};
const approved = await approveOwnedPersonProfile(approveDb, OWNER, { replica_id: RID, version: 1 });
ok("owner approval promotes an exact current source-set version", approved.status === "approved" && approveCalls.at(-1).params[3] === personModelSourceHash(claims));
ok("approval retires the previous version atomically", /update vy_replica_profile p set status='retired'/i.test(approveCalls.at(-1).sql));
ok("approval preserves a profile frozen by an active capability", /not exists\(select 1 from vy_replica_runtime_capability cap[\s\S]*cap\.profile_version=p\.version and cap\.state='active'/i.test(approveCalls.at(-1).sql));
ok("profile approval rechecks lifecycle and the current policy training grant",
  /r\.lifecycle not in \('revoked','purging'\)/.test(approveCalls.at(-1).sql)
  && /c\.scope='training'/.test(approveCalls.at(-1).sql)
  && /c\.policy_version=r\.policy_version/.test(approveCalls.at(-1).sql));
ok("profile approval revalidates the exact compiled claim manifest at promotion time",
  /jsonb_array_elements\(p\.definition#>'\{provenance,claims\}'\)/.test(approveCalls.at(-1).sql)
  && /latest_profile_decision\.decision is distinct from 'accepted'/.test(approveCalls.at(-1).sql));

let reconcileCall;
const reconciled = await reconcileUnsafePersonProfiles(async (sql, params) => {
  reconcileCall = { sql, params };
  return [{ retired: 2 }];
}, { limit: 500 });
ok("bounded reconciliation retires invalid projections and every bound runtime surface",
  reconciled.retired === 2 && reconcileCall.params[0] === 100
  && /order by p\.created_at,p\.replica_id,p\.version[\s\S]*limit \$1::int4/.test(reconcileCall.sql)
  && /revoked_sessions/.test(reconcileCall.sql) && /aborted_generations/.test(reconcileCall.sql));
const validity = personProfileValiditySql("profile", "replica");
ok("runtime profile validity requires a current training grant and latest accepted claim decisions",
  /profile_consent\.scope='training'/.test(validity)
  && /jsonb_array_length/.test(validity)
  && /latest_profile_decision\.decision is distinct from 'accepted'/.test(validity)
  && /current_claim\.status<>'approved'/.test(validity));

const migration = readFileSync(join(ROOT, "db/migrations/024_person_model.sql"), "utf8");
ok("Person Model migration is split-safe", splitSql(migration).length === 13);
ok("claim decisions have composite claim/replica/owner lineage", /foreign key \(claim_id,replica_id,owner_user_id\)/i.test(migration));
ok("profile source sets are database-idempotent", /unique index if not exists vy_replica_profile_source_set_ix/i.test(migration));
ok("calibration preferences gain owner tenancy", /vy_replica_preference_owner_fk/i.test(migration));

const route = readFileSync(join(ROOT, "api/replica-person-model.js"), "utf8");
ok("Person Model route derives authority from bearer auth", /const user = await requireUser\(req\)/.test(route) && !/body\.(?:owner|owner_user_id|user_id|device)/.test(route));
const consent = readFileSync(join(ROOT, "api/_replica-consent.js"), "utf8");
ok("training consent revocation retires profiles and closes their active runtime work",
  /profiles as \([\s\S]*'training' = any\(\$3::text\[\]\)[\s\S]*returning replica_id,version/.test(consent)
  && /runtime_capabilities as \([\s\S]*c\.profile_version in \(select version from profiles\)/.test(consent)
  && /person_profile_consent_revoked/.test(consent));
const studio = readFileSync(join(ROOT, "src/studio/PersonModelStudio.tsx"), "utf8");
// WS-R61: this file's own literal strings moved into src/creatorStudio/copy.ts
// (the studio's locale table) -- `studio` alone no longer carries the
// rendered English text, only `c.<key>` references. Read together, the same
// pattern `evals/readiness/run.mjs` already established for this exact move
// (context/decisions.md#ws-r52-existing-evals-updated-for-the-copy-ts-move).
const copyTs = readFileSync(join(ROOT, "src/creatorStudio/copy.ts"), "utf8");
const studioWithCopy = `${studio}\n${copyTs}`;
ok("Studio makes uncertainty and raw-evidence withholding visible", /Conflicts stay visible/.test(studioWithCopy) && /Raw transcripts, vectors, and storage paths remain withheld/.test(studioWithCopy));

console.log(`\n${checks} Person Model checks passed`);
