import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";

export const PERSON_MODEL_SCHEMA = "vyakti.person-model.v1";
export const PERSON_MODEL_BUILDER = "person-model-builder/v1";

const DECISIONS = Object.freeze({
  accepted: new Set(["accurate", "representative", "current"]),
  rejected: new Set(["inaccurate", "not_me", "private_exclude", "wrong_context"]),
  superseded: new Set(["outdated", "replaced"]),
});
const CRITICAL_IDENTITY_KEYS = new Set(["self_name", "pronouns"]);

function fail(code, status = 400, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function clean(value, max = 1_000) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function normalize(value) {
  return clean(value).toLocaleLowerCase("en-IN").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function number(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? result : fallback;
}

function claimId(value) {
  const id = String(value || "");
  if (!/^[1-9]\d{0,18}$/.test(id)) fail("valid_claim_id_required");
  return id;
}

function splitList(value) {
  return clean(value, 500).split(/[,;|]/).map((item) => clean(item, 80)).filter(Boolean).slice(0, 16);
}

function rank(row) {
  const origin = { self_declared: 4, observed: 3, imported: 2, inferred: 1 }[row.origin] || 0;
  return origin * 10 + number(row.confidence) + Math.min(0.9, Date.parse(row.updated_at || 0) / 1e15);
}

function groupedClaims(claims) {
  const groups = new Map();
  for (const row of claims) {
    const key = `${row.domain}:${row.key}`;
    const values = groups.get(key) || [];
    values.push(row);
    groups.set(key, values);
  }
  for (const values of groups.values()) values.sort((left, right) => rank(right) - rank(left) || String(left.claim_id).localeCompare(String(right.claim_id)));
  return groups;
}

function groupValue(groups, domain, key) {
  const rows = groups.get(`${domain}:${key}`) || [];
  return rows[0] ? clean(rows[0].body) : "";
}

function eligibleClaims(claims, now = Date.now()) {
  return claims.filter((row) => row.decision === "accepted" && row.status !== "superseded" &&
    (!row.t_valid_to || Date.parse(row.t_valid_to) > now));
}

export function personModelReadiness(claims, now = Date.now()) {
  const accepted = eligibleClaims(claims, now);
  const groups = groupedClaims(accepted);
  const blockers = [];
  if (!groupValue(groups, "identity", "self_name")) blockers.push("self_name_required");
  if (!(groups.get("language:languages") || []).length) blockers.push("language_identity_required");
  if (![...(groups.get("habit:humor") || []), ...(groups.get("delivery:turn_shape") || []), ...(groups.get("relationship:repair") || [])].length)
    blockers.push("behavior_evidence_required");
  if (!accepted.some((row) => row.domain === "boundary")) blockers.push("boundary_evidence_required");
  const conflicts = [];
  for (const [key, rows] of groups) {
    const [domain, field] = key.split(":");
    if (domain !== "identity" || !CRITICAL_IDENTITY_KEYS.has(field)) continue;
    const distinct = new Set(rows.map((row) => normalize(row.body)).filter(Boolean));
    if (distinct.size > 1) conflicts.push(key);
  }
  if (conflicts.length) blockers.push("critical_identity_conflict");
  return { ready: blockers.length === 0, blockers, conflicts, accepted_claims: accepted.length };
}

export function buildPersonModelDefinition(claims, now = Date.now()) {
  const accepted = eligibleClaims(claims, now);
  const readiness = personModelReadiness(claims, now);
  if (!readiness.ready) fail("person_model_not_ready", 409, readiness);
  const groups = groupedClaims(accepted);
  const alternatives = [];
  for (const [group, rows] of groups) {
    const distinct = [...new Set(rows.map((row) => clean(row.body)).filter(Boolean))];
    if (distinct.length > 1) alternatives.push({ group, values: distinct.slice(0, 6), claim_ids: rows.map((row) => String(row.claim_id)) });
  }
  const languageRows = groups.get("language:languages") || [];
  const fillers = (groups.get("language:fillers") || []).flatMap((row) => splitList(row.body));
  const values = accepted.filter((row) => row.domain === "value").map((row) => clean(row.body, 180));
  const boundaries = accepted.filter((row) => row.domain === "boundary").map((row) => clean(row.body, 220));
  const autobiography = accepted.filter((row) => row.domain === "biography" || row.domain === "event").map((row) => ({
    claim_id: String(row.claim_id),
    kind: row.domain,
    key: row.key,
    summary: clean(row.body, 500),
    confidence: number(row.confidence),
    valid_from: row.t_valid_from || null,
    valid_to: row.t_valid_to || null,
  }));
  const definition = {
    schema: PERSON_MODEL_SCHEMA,
    identity: {
      self_name: groupValue(groups, "identity", "self_name"),
      pronouns: groupValue(groups, "identity", "pronouns"),
      home: groupValue(groups, "identity", "home"),
      culture: groupValue(groups, "identity", "culture"),
    },
    speech: {
      languages: [...new Set(languageRows.flatMap((row) => splitList(row.body)))].slice(0, 16),
      code_switching: groupValue(groups, "language", "code_switching"),
      register: groupValue(groups, "language", "register"),
      fillers: [...new Set(fillers)].slice(0, 16),
      pacing: groupValue(groups, "delivery", "pacing"),
    },
    behavior: {
      turn_shape: groupValue(groups, "delivery", "turn_shape"),
      humor: groupValue(groups, "habit", "humor"),
      disagreement: groupValue(groups, "habit", "disagreement"),
      repair: groupValue(groups, "relationship", "repair"),
      emotional_regulation: groupValue(groups, "habit", "emotional_regulation"),
    },
    values: [...new Set(values)].slice(0, 24),
    boundaries: [...new Set(boundaries)].slice(0, 24),
    autobiography: autobiography.slice(0, 200),
    relationship_modes: accepted.filter((row) => row.domain === "relationship" && row.key !== "repair").map((row) => ({
      claim_id: String(row.claim_id), key: row.key, description: clean(row.body, 300), confidence: number(row.confidence),
    })).slice(0, 60),
    uncertainty: { alternatives: alternatives.slice(0, 80) },
    provenance: {
      builder: PERSON_MODEL_BUILDER,
      claims: accepted.map((row) => ({
        claim_id: String(row.claim_id), domain: row.domain, key: row.key,
        confidence: number(row.confidence), origin: row.origin,
      })),
    },
  };
  return definition;
}

export function personModelSourceHash(claims, now = Date.now()) {
  const accepted = eligibleClaims(claims, now).map((row) => ({
    claim_id: String(row.claim_id), domain: row.domain, key: row.key,
    body_sha256: sha256Hex(clean(row.body)), confidence: number(row.confidence), origin: row.origin,
    t_valid_from: row.t_valid_from || null, t_valid_to: row.t_valid_to || null,
  })).sort((left, right) => left.claim_id.localeCompare(right.claim_id));
  return sha256Hex(canonicalJson({ schema: PERSON_MODEL_SCHEMA, accepted }));
}

export function clientClaim(row) {
  return {
    claim_id: String(row.claim_id),
    domain: row.domain,
    key: row.key,
    body: clean(row.body),
    origin: row.origin,
    confidence: number(row.confidence),
    status: row.status,
    sensitive: Boolean(row.sensitive),
    source_count: Array.isArray(row.source_ids) ? row.source_ids.length : number(row.source_count),
    decision: row.decision || null,
    reason_code: row.reason_code || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
  };
}

const CLAIMS_SQL = `select c.claim_id,c.domain,c.key,c.body,c.origin,c.confidence,c.status,c.sensitive,
  cardinality(c.source_ids) as source_count,c.t_valid_from,c.t_valid_to,c.created_at,c.updated_at,
  d.decision,d.reason_code,d.created_at as reviewed_at
from vy_replica_claim c
join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=$2
left join lateral (
  select x.decision,x.reason_code,x.created_at from vy_replica_claim_decision x
   where x.claim_id=c.claim_id and x.replica_id=c.replica_id and x.owner_user_id=c.owner_user_id
   order by x.created_at desc limit 1
) d on true
where c.replica_id=$1 and c.owner_user_id=$2
order by c.created_at desc limit 500`;

export async function ownedPersonModelStatus(db, ownerUserId, id) {
  const rid = replicaId(id);
  const [owned, rows, profiles] = await Promise.all([
    db(`select replica_id from vy_replica where replica_id=$1 and owner_user_id=$2 limit 1`, [rid, ownerUserId]),
    db(CLAIMS_SQL, [rid, ownerUserId]),
    db(`select p.version,p.source_set_hash,p.status,p.created_at
          from vy_replica_profile p join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=$2
         where p.replica_id=$1 order by p.version desc limit 20`, [rid, ownerUserId]),
  ]);
  if (!owned[0]) return null;
  const rawClaims = rows.map((row) => ({ ...row, claim_id: String(row.claim_id) }));
  return {
    replica_id: rid,
    claims: rawClaims.map(clientClaim),
    readiness: personModelReadiness(rawClaims),
    profiles: profiles.map((row) => ({ version: number(row.version), status: row.status, created_at: row.created_at })),
  };
}

export async function decideOwnedClaim(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const cid = claimId(input?.claim_id);
  const decision = String(input?.decision || "");
  const reason = String(input?.reason_code || "");
  if (!DECISIONS[decision]?.has(reason)) fail("invalid_claim_decision");
  const status = decision === "accepted" ? "approved" : decision;
  const rows = await db(
    `with owned as (
       select c.claim_id,c.replica_id,c.owner_user_id
         from vy_replica_claim c join vy_replica r on r.replica_id=c.replica_id
        where c.claim_id=$1 and c.replica_id=$2 and c.owner_user_id=$3 and r.owner_user_id=$3
     ), decision as (
       insert into vy_replica_claim_decision
         (claim_id,replica_id,owner_user_id,decision,reason_code,policy_version)
       select claim_id,replica_id,owner_user_id,$4,$5,$6 from owned
       returning decision_id,claim_id,decision,reason_code,created_at
     ), state as (
       update vy_replica_claim c set status=$7,updated_at=now()
        from owned o where c.claim_id=o.claim_id and c.replica_id=o.replica_id and c.owner_user_id=o.owner_user_id
     ) select * from decision`,
    [cid, rid, ownerUserId, decision, reason, REPLICA_POLICY_VERSION, status],
  );
  return rows[0] || null;
}

async function acceptedClaims(db, ownerUserId, rid) {
  const rows = await db(CLAIMS_SQL, [rid, ownerUserId]);
  return rows.map((row) => ({ ...row, claim_id: String(row.claim_id) })).filter((row) => row.decision === "accepted");
}

export async function buildOwnedPersonProfile(db, ownerUserId, id) {
  const rid = replicaId(id);
  const claims = await acceptedClaims(db, ownerUserId, rid);
  const now = Date.now();
  const definition = buildPersonModelDefinition(claims, now);
  const sourceSetHash = personModelSourceHash(claims, now);
  const rows = await db(
    `with owned as (
       select r.replica_id,pg_advisory_xact_lock(hashtextextended(r.replica_id::text||':person_profile',0))
         from vy_replica r where r.replica_id=$1 and r.owner_user_id=$2
          and r.lifecycle not in ('revoked','purging')
     ), candidate as (
       select o.replica_id,coalesce((select version from vy_replica_profile
         where replica_id=$1 and source_set_hash=$3 limit 1),
         (select coalesce(max(version)+1,1) from vy_replica_profile where replica_id=$1)) as version
       from owned o
     ), profile as (
       insert into vy_replica_profile(replica_id,version,source_set_hash,definition,status)
       select replica_id,version,$3,$4::jsonb,'draft' from candidate
       on conflict (replica_id,source_set_hash) do update set source_set_hash=excluded.source_set_hash
       returning replica_id,version,status,created_at
     ), build as (
       insert into vy_replica_model_build
         (replica_id,owner_user_id,build_kind,target_version,builder_version,source_set_hash,state,manifest_hash)
       select replica_id,$2,'person_profile',version,$5,$3,'review',$6 from profile
       on conflict (replica_id,build_kind,source_set_hash) do update
         set state=case when vy_replica_model_build.state='approved' then vy_replica_model_build.state else 'review' end,
             manifest_hash=excluded.manifest_hash,updated_at=now()
     ) select * from profile`,
    [rid, ownerUserId, sourceSetHash, JSON.stringify(definition), PERSON_MODEL_BUILDER, sha256Hex(canonicalJson(definition))],
  );
  return rows[0] ? { ...rows[0], version: number(rows[0].version) } : null;
}

export async function approveOwnedPersonProfile(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const version = Number(input?.version);
  if (!Number.isInteger(version) || version < 1) fail("valid_profile_version_required");
  const claims = await acceptedClaims(db, ownerUserId, rid);
  const now = Date.now();
  const readiness = personModelReadiness(claims, now);
  if (!readiness.ready) fail("person_model_not_ready", 409, readiness);
  const sourceSetHash = personModelSourceHash(claims, now);
  const rows = await db(
    `with owned as (
       select p.replica_id,p.version from vy_replica_profile p
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=$2
       where p.replica_id=$1 and p.version=$3 and p.status='draft' and p.source_set_hash=$4
       for update
     ), retired as (
       update vy_replica_profile p set status='retired'
        from owned o where p.replica_id=o.replica_id and p.status='approved'
          and not exists(select 1 from vy_replica_runtime_capability cap
            where cap.replica_id=p.replica_id and cap.profile_version=p.version and cap.state='active')
     ), approved as (
       update vy_replica_profile p set status='approved'
        from owned o where p.replica_id=o.replica_id and p.version=o.version
       returning p.replica_id,p.version,p.status,p.created_at
     ), build as (
       update vy_replica_model_build b set state='approved',updated_at=now()
        from approved a where b.replica_id=a.replica_id and b.build_kind='person_profile'
          and b.target_version=a.version and b.source_set_hash=$4
     ), lifecycle as (
       update vy_replica r set lifecycle=case when lifecycle='enrolling' then 'calibrating' else lifecycle end,updated_at=now()
        from approved a where r.replica_id=a.replica_id and r.owner_user_id=$2
     ) select * from approved`,
    [rid, ownerUserId, version, sourceSetHash],
  );
  return rows[0] ? { ...rows[0], version: number(rows[0].version) } : null;
}

export { DECISIONS as PERSON_MODEL_DECISIONS };
