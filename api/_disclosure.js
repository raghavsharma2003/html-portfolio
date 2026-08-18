// The disclosure predicate — docs/design/PROPOSAL-MULTIPARTY-V1.md §2.3/§2.4,
// accepted as context/decisions.md `multiparty-v1-design`.
//
// THIS FILE IS THE PRIVACY BOUNDARY. Every disclosure rule in multiparty v1
// is a WHERE clause here. None of them is a sentence in a prompt, and that is
// not a stylistic preference: `structural-disclosure` is a measured decision.
// ConfAIde Tier-3 leaks at 93% for ChatGPT; PiSAs measures single-agent V_vis
// at 100%, 33.5% partitioned, and 63-90% once memory is added back; every
// behavioural mitigation ever measured leaves a 9-90% residual
// (context/measurements.md#disclosure-leak-rates). A model asked to decline
// while holding the answer leaks. A row that was never retrieved cannot.
//
// It runs in the WHERE clause of the batched T2-T7 union-all round trip
// (SPEC §3.3), BEFORE the rank computation — never as a post-hoc filter. A
// disqualified high-salience row that reaches the ranker can still consume
// slot budget, be partially rendered, or escape through a ranking bug; that
// failure class (`recited-prompt`, `silent-truncation`) has already cost this
// repo twice.
//
// ── the primitive (§2.1, adopted verbatim from the research) ───────────────
//
//   The disclosure ACL of a derived row is the participant set of the
//   episodes it cites. Not a permissions table. Not a flag anyone sets. A
//   fact about who was in the room, computed by join, unforgeable by a
//   generated-text step.
//
// ── what is IMPOSSIBLE here, not merely filtered ───────────────────────────
//
// Two tiers are off in v1 (§2.2, §7) and they are off structurally — there is
// no binding, flag, or config value in this module that turns them on:
//
//   - DM -> DM. Clause 6 admits a DM-sourced row (group_id is null) only when
//     the row's own owner is in the recipient set, or through a grant that
//     itself requires `isGroup` to be true. There is no third disjunct and no
//     parameter that adds one. Carrying A's DM to B's DM requires editing this
//     SQL, which is a reviewable diff, not a runtime state.
//   - room A -> room B. The current-room binding is a SCALAR bigint. The
//     predicate cannot express "any of these rooms" because there is nowhere
//     to put a second room id. Cross-room isolation is therefore a property of
//     the predicate's SHAPE, not of a value it was called with.
//
// ── binding contract ───────────────────────────────────────────────────────
//
//   $1 uuid[]   recipients   — the recipient set R
//   $2 boolean  isGroup      — is this a group channel
//   $3 bigint   roomId       — current room id (null in a 1:1 channel)
//   $4 text[]   negTags      — the negatively-valenced affect-tag set
//
// The recipient set is derived in exactly one place (membership governs the
// LIVE CHANNEL, never history) — see RECIPIENT_SET_SQL below.

/** Affect tags that may never cross a disclosure boundary (§2.4 clause 5).
 *
 *  R2's basis is narrow on purpose: the relay evidence covers *accurate,
 *  selective, reputation-positive* information only (Feinberg/Willer/Schultz
 *  2014). Criticism and complaint never bridge. The first eight entries are
 *  api/consolidate.js's actual extractor vocabulary; the rest are defensive —
 *  the extractor does not emit them today, and a tag nobody thought to
 *  register must fail CLOSED rather than sail through. Over-blocking is the
 *  safe direction here in the same way "patterns are deleted whole, never
 *  trimmed" is the safe direction in the forget cascade. */
export const NEGATIVE_AFFECT_TAGS = [
  // api/consolidate.js:244 vocabulary, negative half
  "stressed",
  "sad",
  "anxious",
  "bored",
  // defensive superset — never emitted today, blocked anyway
  "angry",
  "upset",
  "hurt",
  "frustrated",
  "annoyed",
  "irritated",
  "resentful",
  "jealous",
  "ashamed",
  "embarrassed",
  "guilty",
  "lonely",
  "scared",
  "afraid",
  "disgusted",
  "contempt",
  "grief",
  "humiliated",
  "betrayed",
  "disappointed",
];

/** The ONLY place membership is read. Membership governs the live channel;
 *  it never governs history — a member who joins today does not become a
 *  participant of last month's episodes (§1 M10), because the ACL is read
 *  from vy_episode_participant, not from here. Bind $1 = group id. */
export const RECIPIENT_SET_SQL = `
select coalesce(array_agg(m.person_id), '{}'::uuid[]) as recipients
  from vy_group_member m
 where m.group_id = $1 and m.left_at is null and m.linked_at is not null`;

/**
 * Per-subject column mapping. "The same predicate, with subject_kind swapped"
 * (§2.3) is literally true here: one clause text, three column bindings.
 *
 * `citations` is the ACL input for every subject kind, normalised to a
 * bigint[] of vy_episode ids:
 *   - fact    — its own citations column (the citation law's own column)
 *   - phrase  — its coining episode, the one episode it can be attributed to
 *   - episode — itself; an episode's ACL is its own participant set
 *
 * `sensitive` is a literal false for phrase and episode because neither table
 * carries the flag. That is not a gap: the sensitive floor is enforced for
 * those kinds through their cited episodes' affect tags (clause 5b) and
 * through clause 3's `private` / `participants_1to1` scopes.
 */
export const SUBJECT_BINDINGS = {
  fact: {
    kind: "fact",
    table: "vy_fact",
    id: "f.id",
    person: "f.person_id",
    groupId: "f.group_id",
    sensitive: "f.sensitive",
    deny: "f.disclosure_deny",
    citations: "f.citations",
  },
  phrase: {
    kind: "phrase",
    table: "vy_phrase",
    id: "f.id",
    person: "f.person_id",
    groupId: "f.group_id",
    sensitive: "false",
    deny: "f.disclosure_deny",
    citations:
      "(case when f.origin_episode is null then '{}'::bigint[] else array[f.origin_episode] end)",
  },
  episode: {
    kind: "episode",
    table: "vy_episode",
    id: "f.id",
    person: "f.person_id",
    groupId: "f.group_id",
    sensitive: "false",
    deny: "f.disclosure_deny",
    citations: "array[f.id]",
  },
};

const DEFAULT_BIND = {
  recipients: "$1",
  isGroup: "$2",
  roomId: "$3",
  negTags: "$4",
};

/**
 * The predicate, as a SQL fragment that begins with `and` and is dropped into
 * the WHERE clause of a query over `<subject table> f`.
 *
 * @param {"fact"|"phrase"|"episode"} subjectKind
 * @param {{recipients?:string,isGroup?:string,roomId?:string,negTags?:string,alias?:string}} [bind]
 *        SQL expressions to substitute for the four bindings. Defaults are the
 *        positional parameters $1-$4. A caller that evaluates many recipient
 *        sets in one round trip (evals/mp/gate0.mjs) passes column references
 *        instead — same clause text, which is the whole point of this module
 *        existing: the predicate that ships is the predicate that was tested.
 * @returns {string} SQL
 */
export function disclosurePredicate(subjectKind, bind = {}) {
  const s = SUBJECT_BINDINGS[subjectKind];
  if (!s) throw new Error(`unknown disclosure subject kind: ${subjectKind}`);
  const B = { ...DEFAULT_BIND, ...bind };
  const R = B.recipients;
  const G = B.isGroup;
  const M = B.roomId;
  const N = B.negTags;
  const CIT = s.citations;
  const PERSON = s.person;
  const GRP = s.groupId;
  const SENS = s.sensitive;
  const DENY = s.deny;
  const KIND = `'${s.kind}'`;

  return `
-- ── disclosure predicate (PROPOSAL-MULTIPARTY-V1 §2.3), subject: ${s.kind} ──

-- a recipient set of nobody is not a licence to return everything: the grant
-- branch's array containment and the structural branch's universal quantifier
-- are both vacuously true over an empty set, so the empty set is refused here
-- rather than left to be discovered by whichever clause is evaluated first.
and cardinality(${R}) >= 1

-- (0) explicit deny always wins; presence is not consent to be surfaced.
--     Read on BOTH the row and every episode it cites — see 008b's resolution
--     note: the contract writes clause 0 over the subject row while §4.1 puts
--     the column on the episode. Deny is the one clause where over-blocking is
--     unambiguously right, so both readings are enforced.
and not (${DENY} && ${R})
and not exists (
      select 1 from unnest(${CIT}) as c(ep)
       join vy_episode de on de.id = c.ep
      where de.disclosure_deny && ${R})

-- (5) hard floor: sensitive / negatively-valenced rows never cross a
--     boundary, grant or no grant. This sits ABOVE the grant branch on
--     purpose: R2's relay evidence covers accurate, selective,
--     reputation-positive information only. Criticism never bridges, and
--     consent cannot make it bridge.
and not (${SENS} and ${G})
and coalesce(not ${SENS} or ${PERSON} = any(${R}), false)
and not exists (
      select 1 from unnest(${CIT}) as c(ep)
       join vy_episode ae on ae.id = c.ep
       cross join lateral jsonb_array_elements(ae.affect_tags) atag
      where (atag->>'tag') = any(${N}))

-- (1) grant branch OR (2) structural branch
and (
      -- (1) an explicit, cited, still-valid grant covering EVERY recipient.
      --     CPM's negotiated rule made literal: she may ASK whether B can
      --     know; she may never decide it alone. vy_grant_cited means a grant
      --     that cannot point at the moment consent was given cannot exist.
      (select coalesce(array_agg(g.granted_to), '{}'::uuid[])
         from vy_disclosure_grant g
        where g.subject_kind = ${KIND} and g.subject_id = ${s.id}
          and g.t_invalid is null) @> ${R}
   or
      -- (2) the structural branch — the only layer with a measured floor of
      --     ZERO. EVERY recipient was a participant at EVERY cited episode.
      --     "every", not "any", deliberately, matching the forget cascade's
      --     stated principle: taking too much is the safe direction.
      (
        cardinality(${CIT}) >= 1
        and not exists (
          select 1 from unnest(${CIT}) as c(ep)
           where exists (select 1 from vy_episode se
                          where se.id = c.ep
                            and (se.disclosure_scope = 'private'
                                 -- (3) a DM is not a room, even between the
                                 --     same two people
                                 or (se.disclosure_scope = 'participants_1to1'
                                     and ${G})))
              or exists (select 1 from unnest(${R}) as r(pid)
                          where not exists (
                            select 1 from vy_episode_participant p
                             where p.episode_id = c.ep
                               and p.person_id = r.pid))
        )
      )
   or
      -- (2b) an UNCITED row has no participant set, so it has no ACL to
      --      compute. The primitive gives exactly one safe reading: it
      --      discloses to its own owner, in that owner's own 1:1 channel, and
      --      to nobody else. Without this branch the universal quantifier
      --      above would be vacuously TRUE for citations = '{}' and every
      --      legacy/authored row would be disclosable to everyone — the one
      --      way a correct-looking "for all" clause can fail open.
      (cardinality(${CIT}) = 0 and not ${G} and ${PERSON} is not null
       and ${R} <@ array[${PERSON}]::uuid[])
)

-- (4) room isolation: a room-sourced row never renders into another room.
--     ${M} is a SCALAR — there is no way to express "any of these rooms".
and (not ${G} or ${GRP} is null or ${GRP} = ${M})

-- (6) v1 kill-switch on the untested tier: no DM->DM carry, ever. A grant can
--     only ever fire INTO a room in v1, which is why the grant disjunct here
--     carries ${G} rather than standing alone.
and (${GRP} is not null
     or coalesce(${PERSON} = any(${R}), false)
     or exists (select 1 from vy_disclosure_grant g6
                 where g6.subject_kind = ${KIND} and g6.subject_id = ${s.id}
                   and g6.t_invalid is null and g6.granted_to = any(${R})
                   and ${G}))
`;
}

/**
 * §3.2 ruling A, and ONLY for the mp.bridge slot.
 *
 * A departed member's participation in PAST episodes is immutable history and
 * their co-participants keep recall of it — they were there. What they lose is
 * PROACTIVE eligibility: she will answer if asked by someone who was present;
 * she will not raise it herself when the person is no longer in the room to be
 * asked. The research's tentative alternative (downgrade the whole episode to
 * participants_1to1 once anyone leaves) was declined because it silently
 * amputates the room's memory for everyone who stayed, which reads as the
 * product breaking rather than as a privacy feature.
 *
 * This is NOT part of the base predicate: retrieval for a direct question must
 * still find the row. Concatenate it only when compiling mp.bridge.
 */
export function bridgeEligibilityClause(subjectKind, bind = {}) {
  const s = SUBJECT_BINDINGS[subjectKind];
  if (!s) throw new Error(`unknown disclosure subject kind: ${subjectKind}`);
  const M = { ...DEFAULT_BIND, ...bind }.roomId;
  return `
-- (§3.2 ruling A) proactive-bridge eligibility only — never base retrieval
and not exists (
  select 1 from vy_group_member gm
   where gm.group_id = ${M} and gm.left_at is not null
     and gm.person_id = ${s.person})
`;
}
