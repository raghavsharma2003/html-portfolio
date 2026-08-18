// Shared fixture harness for the multiparty suites (evals/mp/).
//
// Builds the fixture corpus into a wsmpb_test_* namespace in the real
// database, so both Gate 0 (the disclosure predicate) and the withdraw suite
// (the multi-owner forget cascade) exercise the SHIPPING code against the REAL
// Postgres rather than against a JavaScript model of it. The failure modes
// that matter in both — three-valued logic on a null person_id, array
// containment over an empty set, a vacuously-true universal quantifier, an FK
// cascade that does or does not fire — are engine semantics.
//
// ── the namespace ─────────────────────────────────────────────────────────
//
// One mechanical identifier rewrite over the REAL DDL: `vy_episode` becomes
// `wsmpb_test_vy_episode`, and so do every index and constraint name derived
// from it. Nothing about clause structure, joins, casts or types changes.
// Teardown is therefore a table drop rather than a delete-where-you-hope, and
// residue is greppable rather than trusted.
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { PERSONS, ROOMS, EPISODES, FACTS, PHRASES, GRANTS, TAG } from "./fixtures.mjs";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;

export const PREFIX = "wsmpb_test_";

const NAMES = [
  "meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding",
  "vy_group", "vy_disclosure_grant", "vy_grant", "vy_tg_person",
];
const NS_RE = new RegExp(`(^|[^\\w.])(${NAMES.join("|")})`, "g");

/** Rewrite every known relation name into the fixture namespace. */
export const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);
/** The fixture name of one relation. */
export const T = (name) => PREFIX + name;

export const MIG_FILES = [
  "008a_speaker_participants.sql",
  "008b_rooms_grants_turns.sql",
  "008c_telegram_identity.sql",
];

export async function teardown() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  for (const r of rels) await q(`drop table if exists ${r.tablename} cascade`, [], 60_000);
  return rels.length;
}

/** No fixture relation may survive teardown, and no PRODUCTION table may carry
 *  a wsmpb-test- string. The second half is the one that matters: a harness
 *  that wrote into the real tables through a name-rewrite bug would otherwise
 *  leave no trace anyone thought to look for. */
export async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const probes = [
    ["meera_log", `content like '${TAG}%'`],
    ["vy_episode", `summary like '${TAG}%'`],
    ["vy_fact", `body like '${TAG}%'`],
    ["vy_phrase", `phrase like '${TAG}%'`],
  ];
  const hits = [];
  for (const [table, where] of probes) {
    const [row] = await q(`select count(*)::int n from ${table} where ${where}`).catch(() => [{ n: 0 }]);
    if (Number(row?.n || 0) > 0) hits.push(`${table}: ${row.n}`);
  }
  return { relations: rels.map((r) => r.tablename), productionRows: hits };
}

// The pre-008 base comes out of db/schema.sql itself rather than being
// restated here: a restated copy drifts, and the point of this harness is that
// 008 is applied to the shape production actually has.
const BASE_TABLES = new Set(["meera_log", "vy_episode", "vy_fact", "vy_phrase", "vy_embedding"]);
const targetOf = (stmt) => {
  const s = stmt.replace(/--[^\n]*\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  let m = /^create table if not exists ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^create (?:unique )?index if not exists [a-z_0-9]+ on ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^alter table ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^(?:insert into|update) ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  return null;
};

/** Apply the base tables + migration 008a/b/c into the fixture namespace, then
 *  apply 008 a second time — the house law is that every statement in every
 *  migration file is independently idempotent, because an interrupted apply is
 *  recovered by running the same file again (db/migrations/apply.mjs). */
export async function buildSchema() {
  // Cut schema.sql at the 008 marker: everything below it is this migration's
  // own DDL, transcribed into the honest record, and applying it here as
  // "base" would mean 008 was applied before the migration files ran — the
  // suite would then be proving that schema.sql agrees with itself rather than
  // that 008 applies cleanly to the PRE-008 shape production actually has.
  const full = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
  const cut = full.indexOf("-- 008a/008b/008c: multiparty v1");
  const pre008 = cut < 0 ? full : full.slice(0, cut);
  const baseStmts = splitSql(pre008).filter((s) => BASE_TABLES.has(targetOf(s)));
  const migStmts = MIG_FILES.flatMap((f) =>
    splitSql(readFileSync(join(ROOT, "db/migrations", f), "utf8")),
  );
  for (const s of [...baseStmts, ...migStmts]) await q(ns(s), [], 60_000);
  for (const s of migStmts) await q(ns(s), [], 60_000);
  return { base: baseStmts.length, migration: migStmts.length };
}

export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const uuidArr = (a) =>
  a.length ? `array[${a.map((x) => `${lit(x)}::uuid`).join(",")}]` : `'{}'::uuid[]`;
export const bigintArr = (a) => (a.length ? `array[${a.join(",")}]::bigint[]` : `'{}'::bigint[]`);

/** Seed the fixture corpus. Returns the key -> real id maps every suite needs.
 *  Fixture keys travel inside the row's own text column (summary / name /
 *  phrase), so one round trip per table maps them all back. */
export async function seed() {
  const roomId = {};
  for (const key of Object.keys(ROOMS)) {
    const [r] = await q(
      `insert into ${T("vy_group")} (name, kind, room_device_id)
       values ($1, 'friend_group', gen_random_uuid()) returning id`,
      [`${TAG}${key}`],
    );
    roomId[key] = r.id;
    for (const p of ROOMS[key].members) {
      await q(
        `insert into ${T("vy_group")}_member (group_id, person_id, linked_at, left_at)
         values ($1, $2, now(), $3)`,
        [r.id, p, ROOMS[key].departed.includes(p) ? new Date().toISOString() : null],
      );
    }
  }

  const epValues = EPISODES.map(
    (e) =>
      `(${e.owner ? lit(e.owner) + "::uuid" : "null"}, ${e.room ? roomId[e.room] : "null"},` +
      ` ${lit(e.scope)}, ${uuidArr(e.deny)}, now(), ${lit(`${e.key} :: ${e.summary}`)},` +
      ` ${lit(JSON.stringify(e.affect.map((a) => ({ ...a, intensity: 0.5 }))))}::jsonb,` +
      ` ${e.room ? "'group'" : "'user'"})`,
  ).join(",");
  const epRows = await q(
    `insert into ${T("vy_episode")}
       (person_id, group_id, disclosure_scope, disclosure_deny, started_at, summary, affect_tags, participation)
     values ${epValues} returning id, summary`,
    [],
    60_000,
  );
  const epId = Object.fromEntries(epRows.map((r) => [r.summary.split(" :: ")[0], r.id]));

  const partValues = EPISODES.flatMap((e) =>
    e.participants.map((p) => `(${epId[e.key]}, ${lit(p)}::uuid, 'participant')`),
  ).join(",");
  await q(
    `insert into ${T("vy_episode")}_participant (episode_id, person_id, role) values ${partValues}
     on conflict do nothing`,
    [],
    60_000,
  );

  const factValues = FACTS.map(
    (f) =>
      `(${lit(f.person)}::uuid, 'world', ${lit(f.key)}, ${lit(`${f.key} :: ${f.body}`)},` +
      ` ${lit(f.provenance)}, ${bigintArr(f.cites.map((c) => epId[c]))},` +
      ` ${f.sensitive}, ${f.room ? roomId[f.room] : "null"}, ${uuidArr(f.deny)})`,
  ).join(",");
  const factRows = await q(
    `insert into ${T("vy_fact")}
       (person_id, kind, name, body, provenance, citations, sensitive, group_id, disclosure_deny)
     values ${factValues} returning id, name`,
    [],
    60_000,
  );
  const factId = Object.fromEntries(factRows.map((r) => [r.name, r.id]));

  const phValues = PHRASES.map(
    (p) =>
      `(${lit(p.person)}::uuid, ${lit(p.phrase)}, ${p.origin ? epId[p.origin] : "null"},` +
      ` ${p.room ? roomId[p.room] : "null"}, ${uuidArr(p.deny)})`,
  ).join(",");
  const phRows = await q(
    `insert into ${T("vy_phrase")} (person_id, phrase, origin_episode, group_id, disclosure_deny)
     values ${phValues} returning id, phrase`,
    [],
    60_000,
  );
  const phId = Object.fromEntries(phRows.map((r) => [r.phrase, r.id]));

  const grantValues = GRANTS.map(
    (g) =>
      `('fact', ${factId[g.subject]}, ${lit(g.by)}::uuid, ${lit(g.to)}::uuid, ${roomId[g.room]},` +
      ` ${bigintArr(g.cites.map((c) => epId[c]))}, ${g.invalid ? "now()" : "null"})`,
  ).join(",");
  await q(
    `insert into ${T("vy_disclosure_grant")}
       (subject_kind, subject_id, granted_by, granted_to, group_id, citations, t_invalid)
     values ${grantValues}`,
    [],
    60_000,
  );

  return {
    roomId, epId, factId, phId,
    counts: {
      persons: PERSONS.length, rooms: Object.keys(roomId).length, episodes: EPISODES.length,
      facts: FACTS.length, phrases: PHRASES.length, grants: GRANTS.length,
    },
  };
}
