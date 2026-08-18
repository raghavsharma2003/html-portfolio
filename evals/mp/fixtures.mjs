// Gate 0's fixture corpus — PROPOSAL-MULTIPARTY-V1 §8.2.
//
// Synthetic multi-person data covering every disclosure tier in §2.2's policy
// table, plus the tiers that are DISABLED in v1 and must therefore never be
// reachable. Pure data + a pure policy oracle: no SQL, no database, no import
// of api/_disclosure.js. That separation is the whole point — the oracle is
// written from §2.2's table in plain JS, so when it and the predicate
// disagree, two independent readings of the design disagreed, rather than one
// implementation agreeing with itself.
//
// Every string value carries the wsmpb-test- prefix and every relation the
// harness creates carries the wsmpb_test_ prefix, so residue is greppable
// rather than trusted.

export const TAG = "wsmpb-test-";

/** Deterministic uuids, so a failing scenario id means the same thing on a
 *  re-run and can be quoted in a report. */
const uuid = (n) => {
  const h = String(n).padStart(12, "0");
  return `wsmpb000-0000-4000-8000-${h}`.replace("wsmpb000", "a5b9c0d1");
};

export const PERSONS = Array.from({ length: 8 }, (_, i) => uuid(i + 1));
export const [P1, P2, P3, P4, P5, P6, P7, P8] = PERSONS;

// Room ids are assigned by the identity column at insert time; the harness
// substitutes real ids for these placeholders. Kept symbolic here so the
// fixture reads as design rather than as bookkeeping.
export const ROOMS = {
  R1: { key: "R1", members: [P1, P2, P3, P4], departed: [P4] },
  R2: { key: "R2", members: [P1, P5, P6], departed: [] },
  R3: { key: "R3", members: [P2, P7], departed: [] },
};

const NEG = ["stressed", "sad", "anxious", "bored"];

/**
 * EPISODES. `scope` maps to vy_episode.disclosure_scope, `participants` is the
 * ACL (vy_episode_participant), `room` is null for a DM.
 *
 * The sharp cases are deliberate:
 *   - e_r1_partial  — two of the four were there. A row citing it must never
 *                     reach the other two, even though they are room members.
 *   - e_r1_private  — 'private' never leaves its owner, room or not.
 *   - e_p2_dm_neg   — negative affect: never crosses, grant or no grant.
 *   - e_r1_deny_p2  — P2 was there and still denies being surfaced to.
 *   - e_r1_p4solo   — P4 is the sole non-Meera speaker and has left the room.
 */
export const EPISODES = [
  // ── DM episodes, one per person, plus a second for P1 and P2 ────────────
  ...PERSONS.map((p, i) => ({
    key: `e_dm_${i + 1}`, owner: p, room: null, scope: "participants_1to1",
    participants: [p], deny: [], affect: [], summary: `${TAG}dm episode for person ${i + 1}`,
  })),
  { key: "e_dm_1b", owner: P1, room: null, scope: "participants_1to1",
    participants: [P1], deny: [], affect: [], summary: `${TAG}p1 second dm episode` },
  { key: "e_p2_dm_neg", owner: P2, room: null, scope: "participants_1to1",
    participants: [P2], deny: [], affect: [{ tag: NEG[0] }],
    summary: `${TAG}p2 dm episode carrying a negative affect tag` },
  { key: "e_p3_dm_private", owner: P3, room: null, scope: "private",
    participants: [P3], deny: [], affect: [], summary: `${TAG}p3 private dm episode` },

  // ── room R1 ────────────────────────────────────────────────────────────
  { key: "e_r1_full_a", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [], affect: [],
    summary: `${TAG}r1 everyone present, the goa plan` },
  { key: "e_r1_full_b", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [], affect: [],
    summary: `${TAG}r1 everyone present, the restaurant argument` },
  { key: "e_r1_partial", owner: null, room: "R1", scope: "participants",
    participants: [P1, P2], deny: [], affect: [],
    summary: `${TAG}r1 only two of four were in the room` },
  { key: "e_r1_deny_p2", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [P2], affect: [],
    summary: `${TAG}r1 everyone present but p2 denies being surfaced to` },
  { key: "e_r1_neg", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [], affect: [{ tag: NEG[1] }],
    summary: `${TAG}r1 negatively valenced room episode` },
  { key: "e_r1_private", owner: null, room: "R1", scope: "private",
    participants: ROOMS.R1.members, deny: [], affect: [],
    summary: `${TAG}r1 private-scoped room episode` },
  { key: "e_r1_p4solo", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [], affect: [],
    summary: `${TAG}r1 the departed member was the only speaker` },
  { key: "e_r1_consent", owner: null, room: "R1", scope: "participants",
    participants: ROOMS.R1.members, deny: [], affect: [],
    summary: `${TAG}r1 the consent tap that a grant cites` },

  // ── room R2 (P1 is in both R1 and R2 — the M7 cross-room case) ──────────
  { key: "e_r2_full", owner: null, room: "R2", scope: "participants",
    participants: ROOMS.R2.members, deny: [], affect: [],
    summary: `${TAG}r2 everyone present` },
  { key: "e_r2_partial", owner: null, room: "R2", scope: "participants",
    participants: [P1, P5], deny: [], affect: [],
    summary: `${TAG}r2 two of three present` },

  // ── room R3 ────────────────────────────────────────────────────────────
  { key: "e_r3_full", owner: null, room: "R3", scope: "participants",
    participants: ROOMS.R3.members, deny: [], affect: [],
    summary: `${TAG}r3 everyone present` },
];

/**
 * FACTS. `cites` is a list of episode keys.
 *
 *   f_mixed_*   — citations spanning DIFFERENT participant sets. §2.3's
 *                 write-time citation-homogeneity invariant is supposed to
 *                 make these unrepresentable by splitting the derivation, but
 *                 the predicate must be safe even when the consolidator is
 *                 wrong. "Every episode, not any episode" is what makes it so.
 *   f_uncited_* — provenance 'authored'/'legacy', citations '{}'. A universal
 *                 quantifier over an empty set is TRUE, which is the one way a
 *                 correct-looking structural branch fails open.
 */
export const FACTS = [
  // 1:1 facts, one per person
  ...PERSONS.map((p, i) => ({
    key: `f_dm_${i + 1}`, person: p, room: null, sensitive: false, deny: [],
    cites: [`e_dm_${i + 1}`], provenance: "extracted", body: `${TAG}dm fact for person ${i + 1}`,
  })),
  { key: "f_dm_1_sensitive", person: P1, room: null, sensitive: true, deny: [],
    cites: ["e_dm_1b"], provenance: "extracted", body: `${TAG}p1 sensitive dm fact` },
  { key: "f_dm_2_negative", person: P2, room: null, sensitive: false, deny: [],
    cites: ["e_p2_dm_neg"], provenance: "extracted", body: `${TAG}p2 negatively valenced fact` },
  { key: "f_dm_3_private", person: P3, room: null, sensitive: false, deny: [],
    cites: ["e_p3_dm_private"], provenance: "extracted", body: `${TAG}p3 private-scope fact` },
  { key: "f_dm_1_granted", person: P1, room: null, sensitive: false, deny: [],
    cites: ["e_dm_1b"], provenance: "extracted", body: `${TAG}p1 dm fact behind a real grant` },
  { key: "f_dm_1_grant_expired", person: P1, room: null, sensitive: false, deny: [],
    cites: ["e_dm_1b"], provenance: "extracted", body: `${TAG}p1 dm fact whose grant was revoked` },
  { key: "f_dm_1_grant_partial", person: P1, room: null, sensitive: false, deny: [],
    cites: ["e_dm_1b"], provenance: "extracted", body: `${TAG}p1 dm fact granted to only some members` },
  { key: "f_dm_1_grant_sensitive", person: P1, room: null, sensitive: true, deny: [],
    cites: ["e_dm_1b"], provenance: "extracted", body: `${TAG}p1 sensitive fact with a grant on it` },
  { key: "f_uncited_1", person: P1, room: null, sensitive: false, deny: [],
    cites: [], provenance: "legacy", body: `${TAG}p1 legacy fact with no citations` },
  { key: "f_uncited_2", person: P2, room: null, sensitive: false, deny: [],
    cites: [], provenance: "authored", body: `${TAG}p2 authored fact with no citations` },

  // room facts
  { key: "f_r1_full", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_full_a"], provenance: "derived", body: `${TAG}r1 fact everyone witnessed` },
  { key: "f_r1_full_b", person: P3, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_full_a", "e_r1_full_b"], provenance: "derived",
    body: `${TAG}r1 fact citing two full-room episodes` },
  { key: "f_r1_partial", person: P2, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_partial"], provenance: "derived", body: `${TAG}r1 fact only two members witnessed` },
  { key: "f_mixed_r1", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_full_a", "e_r1_partial"], provenance: "derived",
    body: `${TAG}r1 fact citing a heterogeneous participant set` },
  { key: "f_mixed_cross", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_full_a", "e_r2_full"], provenance: "derived",
    body: `${TAG}fact citing episodes from two different rooms` },
  { key: "f_mixed_dm_room", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_full_a", "e_dm_1"], provenance: "derived",
    body: `${TAG}fact citing a room episode and a dm episode` },
  { key: "f_r1_deny", person: P1, room: "R1", sensitive: false, deny: [P3],
    cites: ["e_r1_full_a"], provenance: "derived", body: `${TAG}r1 fact with a row-level deny on p3` },
  { key: "f_r1_deny_ep", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_deny_p2"], provenance: "derived", body: `${TAG}r1 fact citing an episode that denies p2` },
  { key: "f_r1_sensitive", person: P2, room: "R1", sensitive: true, deny: [],
    cites: ["e_r1_full_a"], provenance: "derived", body: `${TAG}r1 sensitive fact` },
  { key: "f_r1_negative", person: P2, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_neg"], provenance: "derived", body: `${TAG}r1 negatively valenced fact` },
  { key: "f_r1_private", person: P1, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_private"], provenance: "derived", body: `${TAG}r1 private-scoped fact` },
  { key: "f_r1_p4solo", person: P4, room: "R1", sensitive: false, deny: [],
    cites: ["e_r1_p4solo"], provenance: "derived", body: `${TAG}r1 fact whose speaker has left` },
  { key: "f_r2_full", person: P5, room: "R2", sensitive: false, deny: [],
    cites: ["e_r2_full"], provenance: "derived", body: `${TAG}r2 fact everyone witnessed` },
  { key: "f_r2_partial", person: P6, room: "R2", sensitive: false, deny: [],
    cites: ["e_r2_partial"], provenance: "derived", body: `${TAG}r2 fact two of three witnessed` },
  { key: "f_r3_full", person: P7, room: "R3", sensitive: false, deny: [],
    cites: ["e_r3_full"], provenance: "derived", body: `${TAG}r3 fact everyone witnessed` },
];

/** PHRASES — the safest memory class (§1 M3), and the one where the ACL is a
 *  single coining episode rather than a citation array. */
export const PHRASES = [
  { key: "ph_dm_1", person: P1, room: null, origin: "e_dm_1", deny: [], phrase: `${TAG}dm-joke-one` },
  { key: "ph_dm_2", person: P2, room: null, origin: "e_dm_2", deny: [], phrase: `${TAG}dm-joke-two` },
  { key: "ph_r1", person: P2, room: "R1", origin: "e_r1_full_a", deny: [], phrase: `${TAG}biriyanii` },
  { key: "ph_r1_partial", person: P1, room: "R1", origin: "e_r1_partial", deny: [],
    phrase: `${TAG}two-of-four-joke` },
  { key: "ph_r1_deny", person: P1, room: "R1", origin: "e_r1_full_a", deny: [P4],
    phrase: `${TAG}denied-to-p4` },
  { key: "ph_r1_neg", person: P1, room: "R1", origin: "e_r1_neg", deny: [], phrase: `${TAG}sour-joke` },
  { key: "ph_r2", person: P5, room: "R2", origin: "e_r2_full", deny: [], phrase: `${TAG}r2-joke` },
  { key: "ph_r3", person: P7, room: "R3", origin: "e_r3_full", deny: [], phrase: `${TAG}r3-joke` },
  { key: "ph_orphan", person: P8, room: null, origin: null, deny: [], phrase: `${TAG}uncoined-phrase` },
];

/**
 * GRANTS. One row per recipient — the grant branch is array containment over
 * granted_to, so a grant that names three of four members does not cover the
 * room, by construction rather than by a count check.
 */
export const GRANTS = [
  // the hero case (§1 M4): P1 consents to their DM fact opening in R1
  ...ROOMS.R1.members.filter((p) => p !== P1).map((to) => ({
    subjectKind: "fact", subject: "f_dm_1_granted", by: P1, to, room: "R1",
    cites: ["e_r1_consent"], invalid: false,
  })),
  { subjectKind: "fact", subject: "f_dm_1_granted", by: P1, to: P1, room: "R1",
    cites: ["e_r1_consent"], invalid: false },
  // revoked: t_invalid set. Already-said turns are history; future retrieval is not.
  ...ROOMS.R1.members.map((to) => ({
    subjectKind: "fact", subject: "f_dm_1_grant_expired", by: P1, to, room: "R1",
    cites: ["e_r1_consent"], invalid: true,
  })),
  // partial: covers P2 only, so it can never cover the room's recipient set
  { subjectKind: "fact", subject: "f_dm_1_grant_partial", by: P1, to: P2, room: "R1",
    cites: ["e_r1_consent"], invalid: false },
  // a grant on a SENSITIVE row: clause 5 sits above the grant branch, so
  // consent cannot buy it through
  ...ROOMS.R1.members.map((to) => ({
    subjectKind: "fact", subject: "f_dm_1_grant_sensitive", by: P1, to, room: "R1",
    cites: ["e_r1_consent"], invalid: false,
  })),
];

// ──────────────────────────────────────────────────────────────────────────
// THE POLICY ORACLE — §2.2's table, in plain JS, over the fixture's own
// ground truth. Written independently of api/_disclosure.js on purpose: the
// bugs that matter live in three-valued logic, array containment and join
// semantics, and an oracle that shared them would agree with the predicate
// while both were wrong.
// ──────────────────────────────────────────────────────────────────────────

const epByKey = Object.fromEntries(EPISODES.map((e) => [e.key, e]));
const isNeg = (e) => e.affect.some((a) => NEG.includes(a.tag));

/**
 * May recipient set R receive this row in this channel?
 *
 * @param {{person:string|null, room:string|null, sensitive:boolean, deny:string[], cites:string[], key:string}} row
 * @param {{recipients:string[], isGroup:boolean, room:string|null}} ctx
 * @param {{subjectKind:string}} opts
 */
export function policyAllows(row, ctx, { subjectKind }) {
  const R = ctx.recipients;
  // a recipient set of nobody receives nothing
  if (!R.length) return false;

  const eps = row.cites.map((k) => epByKey[k]);

  // (0) explicit deny beats everything, including a grant. Presence is not
  //     consent to be surfaced.
  if (R.some((r) => row.deny.includes(r))) return false;
  if (eps.some((e) => R.some((r) => e.deny.includes(r)))) return false;

  // (5) the hard floor, above the grant branch. Criticism never bridges, and
  //     consent cannot make it bridge.
  if (row.sensitive && ctx.isGroup) return false;
  if (row.sensitive && !R.every((r) => r === row.person)) return false;
  if (eps.some(isNeg)) return false;

  // (1) grant branch: a live grant covering EVERY recipient
  const live = GRANTS.filter(
    (g) => !g.invalid && g.subjectKind === subjectKind && g.subject === row.key,
  );
  const grantedTo = new Set(live.map((g) => g.to));
  const grantOk = R.every((r) => grantedTo.has(r));

  // (2) structural branch: every recipient at every cited episode
  let structuralOk = false;
  if (eps.length >= 1) {
    structuralOk = eps.every((e) => {
      if (e.scope === "private") return false;
      if (e.scope === "participants_1to1" && ctx.isGroup) return false;
      return R.every((r) => e.participants.includes(r));
    });
  }

  // (2b) an uncited row has no participant set and therefore no ACL: its owner
  //      alone, in their own 1:1 channel
  const uncitedOk =
    eps.length === 0 && !ctx.isGroup && row.person !== null && R.every((r) => r === row.person);

  if (!grantOk && !structuralOk && !uncitedOk) return false;

  // (4) room isolation
  if (ctx.isGroup && row.room !== null && row.room !== ctx.room) return false;

  // (6) DM->DM is off in v1: a DM-sourced row reaches only its own owner,
  //     or a room via a grant
  if (row.room === null) {
    const ownerPresent = row.person !== null && R.includes(row.person);
    const grantIntoRoom = ctx.isGroup && R.some((r) => grantedTo.has(r));
    if (!ownerPresent && !grantIntoRoom) return false;
  }

  return true;
}

/** Every scenario: (recipient set, channel, room). ≥300 by construction —
 *  every subset of persons up to size 4, evaluated in each room's channel and
 *  (for singletons) in that person's own DM. Subsets that are not a room's
 *  membership are not nonsense: membership changes over time and the predicate
 *  must be correct for any set it is handed, not only for the sets today's
 *  writer happens to produce. */
export function buildScenarios() {
  const subsets = [];
  const rec = (start, cur) => {
    if (cur.length >= 1 && cur.length <= 4) subsets.push([...cur]);
    if (cur.length === 4) return;
    for (let i = start; i < PERSONS.length; i++) {
      cur.push(PERSONS[i]);
      rec(i + 1, cur);
      cur.pop();
    }
  };
  rec(0, []);

  const out = [];
  let sid = 0;
  for (const s of subsets) {
    if (s.length === 1) out.push({ sid: sid++, recipients: s, isGroup: false, room: null });
    for (const r of Object.keys(ROOMS)) {
      out.push({ sid: sid++, recipients: s, isGroup: true, room: r });
    }
  }
  return out;
}
