import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import {
  materializeAcceptedClaimToRelationalOs,
  retractClaimRelationalMaterialization,
} from "./_experience-compiler/relational-materializer.js";

export const PERSON_MODEL_SCHEMA = "vyakti.person-model.v1";
export const PERSON_MODEL_BUILDER = "person-model-builder/v1";

const DECISIONS = Object.freeze({
  accepted: new Set(["accurate", "representative", "current"]),
  rejected: new Set(["inaccurate", "not_me", "private_exclude", "wrong_context"]),
  superseded: new Set(["outdated", "replaced"]),
});
const CRITICAL_IDENTITY_KEYS = new Set(["self_name", "pronouns"]);

// A profile is a compiled projection, not an authority of its own. Runtime
// consumers and the reconciler both use this predicate so an approved JSON
// snapshot cannot outlive a rejected, superseded, missing or unconsented claim
// set. Legacy profiles without the v1 claim manifest fail closed and must be
// rebuilt from the current owner-reviewed claims.
export function personProfileValiditySql(profileAlias = "p", replicaAlias = "r") {
  return `jsonb_typeof(${profileAlias}.definition#>'{provenance,claims}')='array'
    and jsonb_array_length(${profileAlias}.definition#>'{provenance,claims}')>0
    and exists (
      select 1 from vy_replica_consent profile_consent
       where profile_consent.replica_id=${replicaAlias}.replica_id
         and profile_consent.owner_user_id=${replicaAlias}.owner_user_id
         and profile_consent.scope='training'
         and profile_consent.policy_version=${replicaAlias}.policy_version
         and profile_consent.revoked_at is null
         and (profile_consent.expires_at is null or profile_consent.expires_at>now())
    )
    and not exists (
      select 1
        from jsonb_array_elements(${profileAlias}.definition#>'{provenance,claims}') claim_ref
        left join vy_replica_claim current_claim
          on current_claim.claim_id=case
               when claim_ref->>'claim_id' ~ '^[1-9][0-9]{0,18}$'
               then (claim_ref->>'claim_id')::int8
             end
         and current_claim.replica_id=${profileAlias}.replica_id
         and current_claim.owner_user_id=${replicaAlias}.owner_user_id
        left join lateral (
          select d.decision
            from vy_replica_claim_decision d
           where d.claim_id=current_claim.claim_id
             and d.replica_id=current_claim.replica_id
             and d.owner_user_id=current_claim.owner_user_id
           order by d.created_at desc,d.decision_id desc limit 1
        ) latest_profile_decision on true
       where current_claim.claim_id is null
          or current_claim.status<>'approved'
          or latest_profile_decision.decision is distinct from 'accepted'
    )`;
}

export const CURRENT_PERSON_PROFILE_SQL = personProfileValiditySql("p", "r");

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

/**
 * DIALOGUE REGISTER — WS-R5.
 *
 * An archive is a monologue. An uploaded lecture, a chat export, a saved
 * article: all of them are the person composing, none of them is the person in
 * a conversation being asked something they had not prepared for. The interview
 * (`api/_interview-gaps.js`, migration 075) is the only lane that produces the
 * second kind, and this is the block that makes it findable.
 *
 * It is deliberately NOT a new claim domain and NOT a new confidence weight. It
 * is a POINTER: which of the already-accepted claims came from a source with
 * `purpose = 'interview'`, so retrieval can prefer them for register. Nothing
 * here reweights, reranks or rewrites a claim, because an interview answer is
 * not more true than an uploaded one, only differently shaped.
 *
 * ── THE HONEST SHAPE, AND ITS NEGATIVE CONTROL ───────────────────────────
 * The block is ALWAYS present. `sources: 0, claims: []` is a positive statement
 * ("this person has never been interviewed") and an absent key is not. That
 * matters because the failure this could have had is
 * `plausible-return-hides-a-dead-pipeline`: a builder that silently ignored the
 * source ids would produce a definition indistinguishable from one built with
 * them, and the register lane downstream would read an empty list as "they talk
 * the same in conversation as in a lecture".
 *
 * So `evals/interview/run.mjs` drives it both ways: the same claims with the
 * interview ids produce a populated block, and WITHOUT them produce an empty
 * one. If the argument were ignored, the second assertion is the one that
 * fails.
 */
export function dialogueRegister(accepted, interviewSourceIds) {
  const ids = new Set(
    (Array.isArray(interviewSourceIds) ? interviewSourceIds : [])
      .map((id) => String(id || "").toLowerCase())
      .filter(Boolean),
  );
  const rows = ids.size
    ? accepted.filter((row) =>
      (Array.isArray(row.source_ids) ? row.source_ids : [])
        .some((id) => ids.has(String(id || "").toLowerCase())))
    : [];
  return {
    // How many interview sources this replica has at all. Zero with a non-empty
    // claim list would be impossible; zero with an empty one is the ordinary
    // pre-interview state and says so.
    sources: ids.size,
    claims: rows.map((row) => ({
      claim_id: String(row.claim_id),
      domain: row.domain,
      key: row.key,
      confidence: number(row.confidence),
    })).slice(0, 120),
    // The one sentence a consumer needs and cannot derive: what this block is
    // evidence OF. It is not a quality claim about the answers.
    means: "claims that came from a conversation rather than from uploaded material; prefer for register, never for truth",
  };
}

export function buildPersonModelDefinition(claims, now = Date.now(), options = {}) {
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
  const knowledge = accepted.filter((row) => row.domain === "knowledge").map((row) => ({
    claim_id: String(row.claim_id),
    key: clean(row.key, 80),
    // Extraction accepts 500 characters. Never remove an approved qualifier
    // to fit a shorter prompt field; over-budget records are omitted whole.
    statement: clean(row.body, 501),
    confidence: number(row.confidence),
  })).filter((row) => row.statement && row.statement.length <= 500);
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
      // WS-R5. Always present, empty when this person has never been
      // interviewed. See `dialogueRegister`.
      dialogue_register: dialogueRegister(accepted, options.interviewSourceIds),
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
    knowledge: knowledge.slice(0, 24),
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
  const citationPreviews = (Array.isArray(row.citation_previews) ? row.citation_previews : [])
    .map((citation) => ({
      excerpt: clean(citation?.excerpt, 500),
      entailment: number(citation?.entailment),
    }))
    .filter((citation) => citation.excerpt)
    .slice(0, 3);
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
    citation_previews: citationPreviews,
    decision: row.decision || null,
    reason_code: row.reason_code || "",
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at,
  };
}

// `source_ids` is selected alongside its own cardinality, and that is not
// redundancy. WS-R5's `dialogueRegister` decides whether a claim came from an
// interview by INTERSECTING this array with the replica's interview sources, so
// a select that returned only the count would have produced an empty register
// block on every real replica while every offline fixture passed — a dead
// pipeline with a plausible return, which is the defect class this repo has
// already paid for more than once. `clientClaim` still emits only the count.
const CLAIMS_SQL = `select c.claim_id,c.domain,c.key,c.body,c.origin,c.confidence,c.status,c.sensitive,
  c.source_ids,cardinality(c.source_ids) as source_count,c.t_valid_from,c.t_valid_to,c.created_at,c.updated_at,
  d.decision,d.reason_code,d.created_at as reviewed_at,citation.citation_previews
from vy_replica_claim c
join vy_replica r on r.replica_id=c.replica_id and r.owner_user_id=$2::uuid
left join lateral (
  select x.decision,x.reason_code,x.created_at from vy_replica_claim_decision x
   where x.claim_id=c.claim_id and x.replica_id=c.replica_id and x.owner_user_id=c.owner_user_id
   order by x.created_at desc,x.decision_id desc limit 1
) d on true
left join lateral (
  select coalesce(jsonb_agg(jsonb_build_object(
    'excerpt',preview.excerpt,'entailment',preview.entailment
  ) order by preview.created_at,preview.start_char),'[]'::jsonb) citation_previews
  from (
    select substring(e.value->>'text' from cc.start_char+1 for cc.end_char-cc.start_char) excerpt,
           cc.entailment,cc.created_at,cc.start_char
      from vy_replica_claim_citation cc
      join vy_replica_processing_evidence e
        on e.evidence_id=cc.evidence_id and e.source_id=cc.source_id
       and e.replica_id=cc.replica_id and e.owner_user_id=cc.owner_user_id
     where cc.claim_id=c.claim_id and cc.replica_id=c.replica_id and cc.owner_user_id=c.owner_user_id
       and e.evidence_type='transcript_span' and jsonb_typeof(e.value->'text')='string'
       and cc.end_char-cc.start_char between 1 and 500
       and encode(digest(convert_to(
         substring(e.value->>'text' from cc.start_char+1 for cc.end_char-cc.start_char),'UTF8'
       ),'sha256'),'hex')=cc.quote_hash
     order by cc.created_at,cc.start_char limit 3
  ) preview
) citation on true
where c.replica_id=$1::uuid and c.owner_user_id=$2::uuid
order by c.created_at desc limit 500`;

export async function ownedPersonModelStatus(db, ownerUserId, id) {
  const rid = replicaId(id);
  const [owned, rows, profiles] = await Promise.all([
    db(`select r.replica_id,exists (
          select 1 from vy_replica_consent c where c.replica_id=r.replica_id
           and c.owner_user_id=r.owner_user_id and c.scope='training'
           and c.policy_version=r.policy_version and c.revoked_at is null
           and (c.expires_at is null or c.expires_at>now())
        ) training_consent
        from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.lifecycle not in ('revoked','purging') limit 1`, [rid, ownerUserId]),
    db(CLAIMS_SQL, [rid, ownerUserId]),
    db(`select p.version,p.source_set_hash,p.status,p.created_at
          from vy_replica_profile p join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=$2::uuid
         where p.replica_id=$1::uuid order by p.version desc limit 20`, [rid, ownerUserId]),
  ]);
  if (!owned[0]) return null;
  const rawClaims = rows.map((row) => ({ ...row, claim_id: String(row.claim_id) }));
  const readiness = personModelReadiness(rawClaims);
  const trainingConsent = owned[0].training_consent === true || owned[0].training_consent === "true";
  if (!trainingConsent && !readiness.blockers.includes("training_consent_required")) {
    readiness.blockers.unshift("training_consent_required");
    readiness.ready = false;
  }
  return {
    replica_id: rid,
    claims: rawClaims.map(clientClaim),
    readiness,
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
    `with owned as materialized (
       select c.claim_id,c.replica_id,c.owner_user_id,
              pg_advisory_xact_lock(hashtextextended(c.replica_id::text||':'||c.claim_id::text||':claim_review',0)) locked
         from vy_replica_claim c join vy_replica r on r.replica_id=c.replica_id
        where c.claim_id=$1::int8 and c.replica_id=$2::uuid and c.owner_user_id=$3::uuid
          and r.owner_user_id=$3::uuid and r.lifecycle not in ('revoked','purging')
          and ($4<>'accepted' or (
            c.status<>'superseded'
            and exists (
              select 1 from vy_replica_consent consent
               where consent.replica_id=r.replica_id and consent.owner_user_id=r.owner_user_id
                 and consent.scope='training' and consent.policy_version=r.policy_version
                 and consent.revoked_at is null and (consent.expires_at is null or consent.expires_at>now())
            )
            and exists (
              select 1 from vy_replica_claim_citation cc
               where cc.claim_id=c.claim_id and cc.replica_id=c.replica_id
                 and cc.owner_user_id=c.owner_user_id
            )
            and not exists (
              select 1 from unnest(c.source_ids) wanted(source_id)
              left join vy_replica_source s on s.source_id=wanted.source_id
               and s.replica_id=c.replica_id and s.owner_user_id=c.owner_user_id
             where s.source_id is null or not (
               s.state='ready' or (
                 s.state='quarantined' and s.capture_mode='derived'
                 and s.contains_third_parties=false
                 and s.provenance->>'purpose'='mirror_window'
               )
             )
            )
            and not exists (
              select 1 from vy_replica_claim_citation cc
              left join vy_replica_processing_evidence e
                on e.evidence_id=cc.evidence_id and e.source_id=cc.source_id
               and e.replica_id=cc.replica_id and e.owner_user_id=cc.owner_user_id
              left join vy_replica_source s
                on s.source_id=cc.source_id and s.replica_id=cc.replica_id
               and s.owner_user_id=cc.owner_user_id
             where cc.claim_id=c.claim_id and cc.replica_id=c.replica_id
               and cc.owner_user_id=c.owner_user_id
               and (e.evidence_id is null or s.source_id is null
                 or not (cc.source_id=any(c.source_ids))
                 or not (s.state='ready' or (
                   s.state='quarantined' and s.capture_mode='derived'
                   and s.contains_third_parties=false
                   and s.provenance->>'purpose'='mirror_window'
                   and e.value#>>'{provenance,origin}'='mirror_call'
                   and e.value#>>'{provenance,source_id}'=s.source_id::text
                 )))
            )
          ))
     ), decision as (
       insert into vy_replica_claim_decision
         (claim_id,replica_id,owner_user_id,decision,reason_code,policy_version,created_at)
       select claim_id,replica_id,owner_user_id,$4,$5,$6,clock_timestamp() from owned
       returning decision_id,claim_id,decision,reason_code,created_at
     ), state as (
       update vy_replica_claim c set status=$7,updated_at=now()
        from owned o,decision d where c.claim_id=o.claim_id and c.replica_id=o.replica_id
          and c.owner_user_id=o.owner_user_id and d.claim_id=o.claim_id
       returning c.claim_id,c.replica_id,c.owner_user_id
     ), affected_profiles as materialized (
       select p.replica_id,p.version,st.owner_user_id
         from state st join vy_replica_profile p on p.replica_id=st.replica_id
        where $4 in ('rejected','superseded') and p.status<>'retired'
          and jsonb_typeof(p.definition#>'{provenance,claims}')='array'
          and exists (
            select 1 from jsonb_array_elements(p.definition#>'{provenance,claims}') claim_ref
             where claim_ref->>'claim_id'=st.claim_id::text
          )
     ), retired_profiles as (
       update vy_replica_profile p set status='retired'
        from affected_profiles a
       where p.replica_id=a.replica_id and p.version=a.version and p.status<>'retired'
       returning p.replica_id,p.version,a.owner_user_id
     ), retired_calibrations as (
       update vy_replica_calibration c set status='retired'
        from retired_profiles p
       where c.replica_id=p.replica_id and c.owner_user_id=p.owner_user_id
         and c.profile_version=p.version and c.status<>'retired'
     ), revoked_capabilities as (
       update vy_replica_runtime_capability c
          set state='revoked',revoked_at=coalesce(c.revoked_at,now())
        from retired_profiles p
       where c.replica_id=p.replica_id and c.owner_user_id=p.owner_user_id
         and c.profile_version=p.version and c.state in ('active','paused')
       returning c.capability_id,c.replica_id,c.owner_user_id,c.profile_version
     ), revoked_sessions as (
       update vy_replica_runtime_session s
          set state='revoked',ended_at=coalesce(s.ended_at,now()),updated_at=now()
        from revoked_capabilities c
       where s.capability_id=c.capability_id and s.replica_id=c.replica_id
         and s.owner_user_id=c.owner_user_id and s.state='active'
     ), aborted_generations as (
       update vy_replica_generation g
          set state='aborted',failure_code='person_profile_claim_invalidated',updated_at=now()
        from retired_profiles p
       where g.replica_id=p.replica_id and g.owner_user_id=p.owner_user_id
         and g.profile_version=p.version and g.state in ('authorized','streaming')
     ) select * from decision`,
    [cid, rid, ownerUserId, decision, reason, REPLICA_POLICY_VERSION, status],
  );
  return rows[0] || null;
}

/**
 * Repairs invalid Person Model projections created by non-review invalidation
 * paths such as source deletion, context re-attribution and consent expiry.
 * The scan is content-free and bounded. Every derived runtime surface tied to
 * an unsafe profile is closed in the same statement.
 */
export async function reconcileUnsafePersonProfiles(db, options = {}) {
  const limit = Math.max(1, Math.min(100, Number(options.limit || 20)));
  const rows = await db(
    `with unsafe_profiles as materialized (
       select p.replica_id,p.version,r.owner_user_id
         from vy_replica_profile p
         join vy_replica r on r.replica_id=p.replica_id
        where p.status<>'retired'
          and not (${personProfileValiditySql("p", "r")})
        order by p.created_at,p.replica_id,p.version
        limit $1::int4
     ), retired_profiles as (
       update vy_replica_profile p set status='retired'
        from unsafe_profiles u
       where p.replica_id=u.replica_id and p.version=u.version and p.status<>'retired'
       returning p.replica_id,p.version,u.owner_user_id
     ), retired_calibrations as (
       update vy_replica_calibration c set status='retired'
        from retired_profiles p
       where c.replica_id=p.replica_id and c.owner_user_id=p.owner_user_id
         and c.profile_version=p.version and c.status<>'retired'
     ), revoked_capabilities as (
       update vy_replica_runtime_capability c
          set state='revoked',revoked_at=coalesce(c.revoked_at,now())
        from retired_profiles p
       where c.replica_id=p.replica_id and c.owner_user_id=p.owner_user_id
         and c.profile_version=p.version and c.state in ('active','paused')
       returning c.capability_id,c.replica_id,c.owner_user_id,c.profile_version
     ), revoked_sessions as (
       update vy_replica_runtime_session s
          set state='revoked',ended_at=coalesce(s.ended_at,now()),updated_at=now()
        from revoked_capabilities c
       where s.capability_id=c.capability_id and s.replica_id=c.replica_id
         and s.owner_user_id=c.owner_user_id and s.state='active'
     ), aborted_generations as (
       update vy_replica_generation g
          set state='aborted',failure_code='person_profile_claim_invalidated',updated_at=now()
        from retired_profiles p
       where g.replica_id=p.replica_id and g.owner_user_id=p.owner_user_id
         and g.profile_version=p.version and g.state in ('authorized','streaming')
     )
     select count(*)::int retired from retired_profiles`,
    [limit],
  );
  return Object.freeze({ retired: number(rows[0]?.retired) });
}

/** The explicit owner review action is the only caller of accepted-claim
 * materialization. Acceptance re-reads strict current lineage. Rejection or
 * supersession retracts any exact fact created by an earlier acceptance; the
 * recall query independently rechecks the latest decision as a fail-safe. */
export async function decideAndMaterializeOwnedClaim(db, ownerUserId, input) {
  const decision = await decideOwnedClaim(db, ownerUserId, input);
  if (!decision) return null;
  const materialization = decision.decision === "accepted"
    ? await materializeAcceptedClaimToRelationalOs(db, ownerUserId, {
      replica_id: input?.replica_id,
      claim_id: input?.claim_id,
    })
    : null;
  const retraction = ["rejected", "superseded"].includes(decision.decision)
    ? await retractClaimRelationalMaterialization(db, ownerUserId, {
      replica_id: input?.replica_id,
      claim_id: input?.claim_id,
    })
    : null;
  return Object.freeze({ decision, materialization, retraction });
}

async function acceptedClaims(db, ownerUserId, rid) {
  const rows = await db(CLAIMS_SQL, [rid, ownerUserId]);
  return rows.map((row) => ({ ...row, claim_id: String(row.claim_id) })).filter((row) => row.decision === "accepted");
}

/** The replica's interview sources, for `dialogueRegister`.
 *
 *  Read HERE rather than imported from `api/_interview-store.js` so this module
 *  keeps its single dependency direction (nothing in the person-model lane
 *  imports the Mirror Call lane) and so a deployment without migration 075
 *  degrades to an empty register block instead of a 500. The catch is narrow on
 *  purpose: it swallows "the column does not exist yet", and an empty result
 *  from it is reported as `sources: 0`, which is the same thing a replica that
 *  has never been interviewed reports. Those two really are the same fact for
 *  this consumer — there is no interview material either way. */
async function interviewSourceIdsFor(db, ownerUserId, rid) {
  try {
    const rows = await db(
      `select s.source_id from vy_replica_source s
        where s.replica_id=$1::uuid and s.owner_user_id=$2::uuid and s.purpose='interview'
        order by s.created_at desc limit 500`,
      [rid, ownerUserId],
    );
    return rows.map((row) => String(row.source_id));
  } catch {
    return [];
  }
}

export async function buildOwnedPersonProfile(db, ownerUserId, id) {
  const rid = replicaId(id);
  const [claims, interviewSourceIds] = await Promise.all([
    acceptedClaims(db, ownerUserId, rid),
    interviewSourceIdsFor(db, ownerUserId, rid),
  ]);
  const now = Date.now();
  const definition = buildPersonModelDefinition(claims, now, { interviewSourceIds });
  const sourceSetHash = personModelSourceHash(claims, now);
  const rows = await db(
    `with owned as (
       select r.replica_id,pg_advisory_xact_lock(hashtextextended(r.replica_id::text||':person_profile',0))
         from vy_replica r where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.lifecycle not in ('revoked','purging')
          and exists (
            select 1 from vy_replica_consent c where c.replica_id=r.replica_id
             and c.owner_user_id=r.owner_user_id and c.scope='training'
             and c.policy_version=r.policy_version and c.revoked_at is null
             and (c.expires_at is null or c.expires_at>now())
          )
          and jsonb_typeof($4::jsonb#>'{provenance,claims}')='array'
          and jsonb_array_length($4::jsonb#>'{provenance,claims}')>0
          and not exists (
            select 1
              from jsonb_array_elements($4::jsonb#>'{provenance,claims}') claim_ref
              left join vy_replica_claim current_claim
                on current_claim.claim_id=case
                     when claim_ref->>'claim_id' ~ '^[1-9][0-9]{0,18}$'
                     then (claim_ref->>'claim_id')::int8
                   end
               and current_claim.replica_id=r.replica_id
               and current_claim.owner_user_id=r.owner_user_id
              left join lateral (
                select d.decision from vy_replica_claim_decision d
                 where d.claim_id=current_claim.claim_id and d.replica_id=current_claim.replica_id
                   and d.owner_user_id=current_claim.owner_user_id
                 order by d.created_at desc,d.decision_id desc limit 1
              ) latest_build_decision on true
             where current_claim.claim_id is null or current_claim.status<>'approved'
                or latest_build_decision.decision is distinct from 'accepted'
          )
     ), candidate as (
       select o.replica_id,coalesce((select version from vy_replica_profile
         where replica_id=$1::uuid and source_set_hash=$3 limit 1),
         (select coalesce(max(version)+1,1) from vy_replica_profile where replica_id=$1::uuid)) as version
       from owned o
     ), profile as (
       insert into vy_replica_profile(replica_id,version,source_set_hash,definition,status)
       select replica_id,version,$3,$4::jsonb,'draft' from candidate
       on conflict (replica_id,source_set_hash) do update set source_set_hash=excluded.source_set_hash
       returning replica_id,version,status,created_at
     ), build as (
       insert into vy_replica_model_build
         (replica_id,owner_user_id,build_kind,target_version,builder_version,source_set_hash,state,manifest_hash)
       select replica_id,$2::uuid,'person_profile',version,$5,$3,'review',$6 from profile
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
       join vy_replica r on r.replica_id=p.replica_id and r.owner_user_id=$2::uuid
       where p.replica_id=$1::uuid and p.version=$3::int4 and p.status='draft' and p.source_set_hash=$4
         and r.lifecycle not in ('revoked','purging')
         and (${personProfileValiditySql("p", "r")})
         and exists (
           select 1 from vy_replica_consent c where c.replica_id=r.replica_id
            and c.owner_user_id=r.owner_user_id and c.scope='training'
            and c.policy_version=r.policy_version and c.revoked_at is null
            and (c.expires_at is null or c.expires_at>now())
         )
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
        from approved a where r.replica_id=a.replica_id and r.owner_user_id=$2::uuid
     ) select * from approved`,
    [rid, ownerUserId, version, sourceSetHash],
  );
  return rows[0] ? { ...rows[0], version: number(rows[0].version) } : null;
}

export { DECISIONS as PERSON_MODEL_DECISIONS };
