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

let failed = 0;
const t0 = Date.now();

// manifest coverage (local, no extra round trip beyond one catalog query)
const keyed = await q(
  `select distinct table_name from information_schema.columns
    where table_schema = 'public'
      and table_name like 'vy\\_%'
      and column_name in ('person_id','device_id')`,
);
const listed = new Set(PERSON_TABLES.map((t) => t.table));
const missing = keyed.map((r) => r.table_name).filter((t) => !listed.has(t));
if (missing.length) {
  failed++;
  console.log(`FAIL  manifest coverage: ${missing.join(", ")} keyed by person/device but absent from PERSON_TABLES`);
} else {
  console.log(`  ok  manifest coverage (${keyed.length} person-keyed tables all listed)`);
}

for (const c of checks) {
  const [row] = await q(c.sql, c.params, 30_000);
  const n = Number(row?.n ?? -1);
  if (n === 0) {
    console.log(`  ok  ${c.name}`);
  } else {
    failed++;
    console.log(`FAIL  ${c.name}: ${n} row(s)`);
  }
}

console.log(
  failed
    ? `\n${failed} integrity check(s) FAILED in ${Date.now() - t0}ms — the store is not trustworthy`
    : `\nzero-orphan sweep green (${checks.length + 1} checks, ${Date.now() - t0}ms)`,
);
process.exit(failed ? 1 : 0);
