// Owner-approved relational memory for the owner-to-own-clone Mirror Call.
//
// This is deliberately narrower than general recall. Mirror Call is a
// calibration surface, so it receives only facts that were materialized from
// an explicitly accepted replica claim. The shared disclosure predicate still
// decides whether those rows may cross the exact agent/person dyad.
import { disclosurePredicate, NEGATIVE_AFFECT_TAGS } from "../_disclosure.js";

const MAX_FACTS = 8;
const MAX_FACT_CHARS = 600;
// Explicit shadow option only: ordinary Mirror calls retain their current rank.
// This is lexical retrieval, not translation or semantic understanding.
const QUERY_STOPWORDS = new Set("a an the is are was were what when where how which who do does did of to for in on at and or my me current please है हैं था थे क्या कब कहाँ कैसे कौन की के का को में से और मुझे मेरा मेरी अभी".split(" "));
export function mirrorRecallQueryTerms(query) {
  if (typeof query !== "string") return [];
  const words = query.slice(0, 500).normalize("NFKC").toLocaleLowerCase("en-IN")
    .match(/[\p{L}\p{N}][\p{L}\p{N}\p{M}]*/gu) || [];
  return [...new Set(words.filter(word => !QUERY_STOPWORDS.has(word)))].slice(0, 24);
}

const PREDICATE = disclosurePredicate("fact", {
  recipients: "array[scope.subject_person_id]",
  isGroup: "false",
  roomId: "null",
  negTags: "$3",
  agentId: "scope.agent_id",
});

export async function approvedMirrorRecall(db, ownerUserId, replicaId, options = {}) {
  const terms = options?.strategy === "lexical-shadow" ? mirrorRecallQueryTerms(options.query) : [];
  // Sum independent term matches rather than AND-ing the whole question.
  // Ranking stays after all authorization/citation predicates. Empty queries
  // and no-match rows retain need/recency order and never broaden eligibility.
  const relevance = terms.length ? `(select coalesce(sum(ts_rank_cd(
        to_tsvector('simple'::regconfig,coalesce(f.name,'')||' '||coalesce(f.body,'')),
        plainto_tsquery('simple'::regconfig,query_term))),0)
        from unnest($4::text[]) as query_terms(query_term)) desc,` : "";
  const rows = await db(
    `with scope as (
       select r.replica_id,r.owner_user_id,r.agent_id,r.subject_person_id
         from vy_replica r
        where r.replica_id=$1::uuid and r.owner_user_id=$2::uuid
          and r.subject_mode='self' and r.lifecycle not in ('revoked','purging')
          and r.agent_id is not null and r.subject_person_id is not null
          and exists (
            select 1 from vy_replica_consent consent
             where consent.replica_id=r.replica_id and consent.owner_user_id=r.owner_user_id
               and consent.scope='training' and consent.policy_version=r.policy_version
               and consent.revoked_at is null and (consent.expires_at is null or consent.expires_at>now())
          )
     )
     select f.id,f.name,f.body,f.created_at
       from scope
       join vy_fact f on f.agent_id=scope.agent_id and f.person_id=scope.subject_person_id
      where f.t_invalid is null and f.retracted_at is null
        and exists (
          select 1 from unnest(f.citations) cited(episode_id)
          join vy_episode approved on approved.id=cited.episode_id
           and approved.agent_id=scope.agent_id
           and approved.person_id=scope.subject_person_id
          join vy_replica_claim c on c.replica_id=scope.replica_id
           and c.owner_user_id=scope.owner_user_id and c.proposal_hash is not null
           and approved.boundary_reason like ('replica_claim:'||c.proposal_hash||':%')
         where c.status='approved' and exists (
           select 1 from vy_replica_claim_decision d
            where d.claim_id=c.claim_id and d.replica_id=c.replica_id
              and d.owner_user_id=c.owner_user_id and d.decision='accepted'
              and not exists (
                select 1 from vy_replica_claim_decision newer
                 where newer.claim_id=d.claim_id and newer.replica_id=d.replica_id
                   and newer.owner_user_id=d.owner_user_id
                   and (newer.created_at,newer.decision_id)>(d.created_at,d.decision_id)
              )
         )
        )
        ${PREDICATE}
      order by ${relevance} f.need_p desc,f.created_at desc
      limit ${MAX_FACTS}`,
    [replicaId, ownerUserId, NEGATIVE_AFFECT_TAGS, ...(terms.length ? [terms] : [])],
  );
  return (Array.isArray(rows) ? rows : []).map((row) => Object.freeze({
    id: row.id,
    name: String(row.name || "").slice(0, 120),
    body: String(row.body || "").trim().slice(0, MAX_FACT_CHARS),
    created_at: row.created_at ?? null,
  })).filter((row) => row.body);
}
