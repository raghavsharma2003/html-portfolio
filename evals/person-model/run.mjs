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
  personModelReadiness,
  personModelSourceHash,
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

function rowForSql(item) {
  return { ...item, source_count: item.source_ids.length, reviewed_at: "2026-08-24T01:00:00.000Z" };
}

const statusCalls = [];
const status = await ownedPersonModelStatus(async (sql, params) => {
  statusCalls.push({ sql, params });
  if (/select replica_id from vy_replica/i.test(sql)) return [{ replica_id: RID }];
  if (/from vy_replica_claim c/i.test(sql)) return claims.map(rowForSql);
  if (/from vy_replica_profile p/i.test(sql)) return [];
  throw new Error(`unexpected SQL ${sql.slice(0, 60)}`);
}, OWNER, RID);
ok("owner sees reviewed claims without source identifiers", status.readiness.ready && !/source_ids/.test(JSON.stringify(status)));
ok("all Person Model reads bind replica and authenticated owner", statusCalls.every((call) => call.params[0] === RID && call.params[1] === OWNER));
const absent = await ownedPersonModelStatus(async (sql) => /select replica_id from vy_replica/i.test(sql) ? [] : [], OWNER, RID);
ok("cross-owner Person Model resolves to not found", absent === null);

const decisionCalls = [];
const decision = await decideOwnedClaim(async (sql, params) => {
  decisionCalls.push({ sql, params });
  return [{ decision_id: RID, claim_id: "1", decision: params[3], reason_code: params[4], created_at: "2026-08-24T00:00:00.000Z" }];
}, OWNER, { replica_id: RID, claim_id: "1", decision: "accepted", reason_code: "representative" });
ok("claim review appends a controlled owner decision", decision.decision === "accepted");
ok("claim decision SQL binds claim, replica and owner before mutation", /c\.claim_id=\$1 and c\.replica_id=\$2 and c\.owner_user_id=\$3/i.test(decisionCalls[0].sql));
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

const migration = readFileSync(join(ROOT, "db/migrations/024_person_model.sql"), "utf8");
ok("Person Model migration is split-safe", splitSql(migration).length === 13);
ok("claim decisions have composite claim/replica/owner lineage", /foreign key \(claim_id,replica_id,owner_user_id\)/i.test(migration));
ok("profile source sets are database-idempotent", /unique index if not exists vy_replica_profile_source_set_ix/i.test(migration));
ok("calibration preferences gain owner tenancy", /vy_replica_preference_owner_fk/i.test(migration));

const route = readFileSync(join(ROOT, "api/replica-person-model.js"), "utf8");
ok("Person Model route derives authority from bearer auth", /const user = await requireUser\(req\)/.test(route) && !/body\.(?:owner|owner_user_id|user_id|device)/.test(route));
const studio = readFileSync(join(ROOT, "src/studio/PersonModelStudio.tsx"), "utf8");
ok("Studio makes uncertainty and raw-evidence withholding visible", /Conflicts stay visible/.test(studio) && /Raw transcripts, vectors, and storage paths remain withheld/.test(studio));

console.log(`\n${checks} Person Model checks passed`);
