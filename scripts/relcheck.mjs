// relcheck — the zero-orphan integrity sweep (SPEC §4.1.11, §9.1 step 7).
//
//   node scripts/relcheck.mjs        → sweep the live database, exit 1 on any hit
//
// Read-only, one round trip per check, fast enough for CI. This is what
// makes "forget leaves no orphaned derivations" a regulator-showable
// assertion instead of a hope: after any §9.1 cascade, NOTHING may cite an
// episode that no longer exists, no lineage pointer may dangle, and no
// embedding may outlive its owner. Any probe ever recovering deleted-derived
// content is a design-falsifying, ship-blocking bug — not tunable.
//
// It also asserts MANIFEST COVERAGE: every person/device-keyed table in the
// database must appear in PERSON_TABLES (api/memory.js), the single list
// that forget's whole-wipe and api/export.js both iterate. A table someone
// adds without listing it there would be invisible to forget AND export —
// this check is where that omission fails loudly instead of silently.
import { q } from "../api/_db.js";
import { PERSON_TABLES } from "../api/memory.js";

const checks = [];
const check = (name, sql, params = []) => checks.push({ name, sql, params });

// ── orphaned citations: a row citing a vy_episode id that does not exist ──
const orphanCite = (table, extra = "") =>
  `select count(*)::int n from ${table} r
    where cardinality(r.citations) > 0 ${extra}
      and exists (select 1 from unnest(r.citations) c(id)
                  where not exists (select 1 from vy_episode e where e.id = c.id))`;

check("vy_fact citations resolve", orphanCite("vy_fact"));
check("vy_rel_event citations resolve", orphanCite("vy_rel_event"));
check("vy_pattern citations resolve", orphanCite("vy_pattern"));
check("vy_kin citations resolve", orphanCite("vy_kin"));
check("vy_ritual citations resolve", orphanCite("vy_ritual"));
check("vy_currency citations resolve", orphanCite("vy_currency"));

// ── the citation law itself, re-proven against data (the CHECK constraint
//    should make these unrepresentable; a zero here proves it held) ──
check(
  "no uncited non-authored fact",
  `select count(*)::int n from vy_fact
    where provenance not in ('authored','legacy') and cardinality(citations) < 1`,
);
check(
  "no pattern below 2 citations",
  `select count(*)::int n from vy_pattern where cardinality(citations) < 2`,
);

// ── dangling lineage: superseded_by chains must die in both directions on
//    forget (§9.1 step 4), so a pointer to a missing row is a cascade miss ──
check(
  "vy_episode superseded_by resolves",
  `select count(*)::int n from vy_episode r
    where r.superseded_by is not null
      and not exists (select 1 from vy_episode e where e.id = r.superseded_by)`,
);
check(
  "vy_fact superseded_by resolves",
  `select count(*)::int n from vy_fact r
    where r.superseded_by is not null
      and not exists (select 1 from vy_fact f where f.id = r.superseded_by)`,
);

// ── embeddings die with their owners (§9.1 step 6) ──
check(
  "no ownerless embedding",
  `select count(*)::int n from vy_embedding v
    where (v.owner_kind = 'episode' and not exists (select 1 from vy_episode e where e.id = v.owner_id))
       or (v.owner_kind = 'fact'    and not exists (select 1 from vy_fact f    where f.id = v.owner_id))
       or (v.owner_kind = 'pattern' and not exists (select 1 from vy_pattern p where p.id = v.owner_id))`,
);

// ── person layer: every person-keyed row must belong to a person that is
//    reachable through the device mapping OR be its own anonymous person ──
check(
  "no vy_person_device without person",
  `select count(*)::int n from vy_person_device d
    where not exists (select 1 from vy_person p where p.person_id = d.person_id)`,
);

// ── WS-CONSOLIDATE (M3) additions, per §13's ADD-only grant ──────────────
//
// meera_log.episode_id is the finalize cursor itself (api/consolidate.js,
// scripts/migrate/backfill-episodes.mjs): "unconsolidated" means null, so a
// dangling non-null value would silently hide log rows from every future
// finalize AND future backfill pass — a cursor that lies is worse than one
// that is merely slow.
check(
  "meera_log.episode_id resolves",
  `select count(*)::int n from meera_log l
    where l.episode_id is not null
      and not exists (select 1 from vy_episode e where e.id = l.episode_id)`,
);

// The writer-window law (SPEC §4.2 layer 2) is enforced AT WRITE TIME by
// api/consolidate.js and the backfill script (an out-of-window citation is
// rejected before insert, never salvaged) — this re-proves it held against
// the DATA every episode a derivation run actually wrote ever produced,
// the same "constraint, then prove it against data" pattern
// check-citations.mjs already uses for the schema CHECKs.
check(
  "vy_derivation episode writes stay inside their own input window",
  `select count(*)::int n from vy_derivation d
    cross join lateral jsonb_to_recordset(d.wrote) as w("table" text, id bigint)
    join vy_episode e on w."table" = 'vy_episode' and e.id = w.id
   where e.log_from is not null and e.log_to is not null
     and (e.log_from < d.input_from or e.log_to > d.input_to)`,
);

// The entailment audit's halt condition (SPEC §4.2 layer 3) only means
// something if a "refuted" verdict actually DID something: the fact it
// judged must be retracted, not left standing as if the audit never ran.
check(
  "refuted-audit facts are retracted",
  `select count(*)::int n from vy_derivation d
    cross join lateral jsonb_to_recordset(d.wrote) as w("table" text, id bigint)
    join vy_fact f on w."table" = 'vy_fact' and f.id = w.id
   where d.audit_status = 'refuted' and f.retracted_at is null`,
);

// ── WS-MPBUILD (multiparty v1, migration 008) ─────────────────────────────
//
// These run only once 008 is applied — the sweep is a gate, and a gate that
// red-lights on a migration the owner has not deployed yet reports a deploy
// state as a data defect. Which checks were skipped is printed, so "green"
// never quietly means "did not look".
const mpChecks = [];
const mpCheck = (name, sql, params = []) => mpChecks.push({ name, sql, params });

// The ACL join table is the security boundary (PROPOSAL-MULTIPARTY-V1 §2.1):
// a participant row pointing at an episode that no longer exists would be an
// ACL entry for nothing, and the FK's on-delete-cascade is what should make it
// unrepresentable. Proven against data, same as the citation CHECKs above.
mpCheck(
  "vy_episode_participant episodes resolve",
  `select count(*)::int n from vy_episode_participant p
    where not exists (select 1 from vy_episode e where e.id = p.episode_id)`,
);

// Every shared episode must have at least one participant. A room episode
// with an empty participant set is disclosable to NOBODY (the structural
// branch's universal quantifier fails for any recipient), so it is memory
// nobody can ever reach — which is exactly what "last one out closes the
// door" is supposed to have deleted (§3.1.2).
mpCheck(
  "no room episode without participants",
  `select count(*)::int n from vy_episode e
    where e.group_id is not null
      and not exists (select 1 from vy_episode_participant p where p.episode_id = e.id)`,
);

// The manifest's `key` is documented as selecting "exclusive rows (1:1)"
// (api/memory.js PERSON_TABLES), and forget's whole-wipe relies on it: an
// episode carrying BOTH a person_id and a group_id would be hard-deleted out
// from under its co-participants by that one person's wipe. The writer split
// is a law, so it is asserted rather than trusted.
mpCheck(
  "no episode is both 1:1-owned and room-owned",
  `select count(*)::int n from vy_episode
    where person_id is not null and group_id is not null`,
);

// THE CITATION LAW on the newest table that stores derived content. A grant
// that cannot point at the moment consent was given must not exist — the
// vy_grant_cited CHECK makes it unrepresentable, and this re-proves it held,
// plus that the episode it cites is still there.
mpCheck(
  "no uncited disclosure grant",
  `select count(*)::int n from vy_disclosure_grant where cardinality(citations) < 1`,
);
mpCheck("vy_disclosure_grant citations resolve", orphanCite("vy_disclosure_grant"));

// v1's two disabled tiers, asserted as DATA rather than as a claim about the
// predicate. Grants only ever fire INTO a room (§2.2/§2.4 clause 6), so a
// grant with no group_id is a DM->DM carry sitting in the table waiting for a
// predicate bug to find it.
mpCheck(
  "no roomless (DM->DM) disclosure grant",
  `select count(*)::int n from vy_disclosure_grant where group_id is null`,
);

// Room isolation (§2.4 clause 4) reads group_id as a hint on derived rows;
// a hint pointing at a room that no longer exists would make the clause
// compare against nothing. No FK on hint columns (house law), so sweep it.
mpCheck(
  "vy_fact.group_id resolves",
  `select count(*)::int n from vy_fact f
    where f.group_id is not null
      and not exists (select 1 from vy_group g where g.id = f.group_id)`,
);
mpCheck(
  "vy_phrase.group_id resolves",
  `select count(*)::int n from vy_phrase p
    where p.group_id is not null
      and not exists (select 1 from vy_group g where g.id = p.group_id)`,
);
mpCheck(
  "vy_episode.group_id resolves",
  `select count(*)::int n from vy_episode e
    where e.group_id is not null
      and not exists (select 1 from vy_group g where g.id = e.group_id)`,
);
mpCheck(
  "meera_log.group_id resolves",
  `select count(*)::int n from meera_log l
    where l.group_id is not null
      and not exists (select 1 from vy_group g where g.id = l.group_id)`,
);

// §6.4, "no person row, no persistence": a room turn that cannot be
// attributed to a speaker can never be row-level forgotten by its author, and
// speaker_person_id is UNBACKFILLABLE. One unattributed room row is a
// permanent hole in someone's forget, so it is a zero, not a rate.
mpCheck(
  "no unattributed room turn",
  `select count(*)::int n from meera_log
    where group_id is not null and speaker_person_id is null`,
);

let failed = 0;
const t0 = Date.now();

// ── manifest coverage ──────────────────────────────────────────────────────
//
// P2-1: THIS QUERY USED TO READ `table_name like 'vy\_%'`.
//
// The one guard whose entire job is "a user-data table nobody listed must fail
// loudly" enumerated a PREFIX, so it could only ever see half the database.
// `meera_state` — the server's copy of the whole conversation plus the user
// profile, the single most complete document about a person this system holds
// — sat outside the manifest, outside forget and outside export for as long as
// it has existed, and this check reported full coverage the entire time. Same
// class as `engine-bundle-check-uncalled` and worse in one way: that guard was
// merely uncalled, this one ran, printed "ok", and named a count.
//
// The generalisable rule is the one evals/teardown.mjs's walker rewrite states
// from the other side: A COVERAGE CHECK IS ONLY AS WIDE AS THE THING IT
// ENUMERATES, and enumerating a subset is how a gate reports full coverage of
// a part. So the enumeration is now every table in the schema carrying an
// owning column, and `user_id` joins the column list — meera_state is keyed on
// it, so a person/device-only scan would still have missed the row even after
// the prefix came off.
//
// EXEMPT is the escape hatch and it is deliberately a written reason per
// table, the same discipline as the FATE table's "exempt: …" verdicts: a table
// leaves this check by someone deciding it is not user data, in writing, not
// by not matching a pattern.
const EXEMPT = {
  meera_culture:
    "her recognition index, rebuilt daily by culture.yml — one row per day, " +
    "shared by every user, and its user_id-shaped columns are none.",
  meera_consolidate_lease:
    "a concurrency lease, not content: a person_id, two timestamps and a " +
    "run_id, self-expiring via LEASE_TTL whether or not forget ever touches " +
    "it. api/consolidate-sweep.js's own header argues this case in writing " +
    "and is where it is maintained; the exemption is recorded here because " +
    "this is the check it is an exemption FROM, and an argument that lives " +
    "only next to the table it excuses is an argument nobody reviewing this " +
    "gate will ever read.",
};
const keyed = await q(
  `select distinct table_name from information_schema.columns
    where table_schema = 'public'
      and (table_name like 'vy\\_%' or table_name like 'meera\\_%')
      and column_name in ('person_id','device_id','user_id')`,
);
const listed = new Set(PERSON_TABLES.map((t) => t.table));
const missing = keyed
  .map((r) => r.table_name)
  .filter((t) => !listed.has(t) && !EXEMPT[t]);
if (missing.length) {
  failed++;
  console.log(
    `FAIL  manifest coverage: ${missing.join(", ")} keyed by person/device/user but absent from ` +
      `PERSON_TABLES (api/memory.js). A table that is in neither the manifest nor the EXEMPT map ` +
      `in this file is invisible to BOTH forget and export.`,
  );
} else {
  const ex = Object.keys(EXEMPT).length;
  console.log(
    `  ok  manifest coverage (${keyed.length} owned tables across vy_ and meera_, ` +
      `${ex} exempted in writing, the rest all listed)`,
  );
}

// migration 008 lands in three parts and is deployed by the owner, not by
// this sweep; vy_episode_participant is 008a's table and stands in for all of
// them (008b/008c cannot be applied without it).
const [mpApplied] = await q(
  `select to_regclass('public.vy_episode_participant') is not null as present`,
);
const mpOn = mpApplied?.present === true;

for (const c of [...checks, ...(mpOn ? mpChecks : [])]) {
  const [row] = await q(c.sql, c.params, 30_000);
  const n = Number(row?.n ?? -1);
  if (n === 0) {
    console.log(`  ok  ${c.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}: ${n} row(s)`);
  }
}
if (!mpOn) {
  console.log(
    `SKIP  ${mpChecks.length} multiparty check(s): migration 008 is not applied to this database ` +
      `(vy_episode_participant absent). This is a deploy state, not a data defect — but the sweep ` +
      `says so out loud, because "green" must never quietly mean "did not look".`,
  );
}

const ran = checks.length + 1 + (mpOn ? mpChecks.length : 0);
console.log(
  failed
    ? `\n${failed} integrity check(s) FAILED in ${Date.now() - t0}ms — the store is not trustworthy`
    : `\nzero-orphan sweep green (${ran} checks${mpOn ? ", multiparty included" : ""}, ${Date.now() - t0}ms)`,
);
process.exit(failed ? 1 : 0);
