// Fixture harness for the agent-isolation gate (evals/agent/).
//
// Builds a TWO-AGENT corpus into a `wsagent_test_*` namespace in the real
// database, so G-E1 exercises the SHIPPING predicate against the REAL Postgres
// rather than against a JavaScript model of it. This is evals/mp/harness.mjs's
// design, adopted deliberately and for its stated reason: the failure modes
// that matter here are ENGINE semantics, not JavaScript. `agent_id = null`
// yielding NULL rather than TRUE, a NOT NULL column with a DEFAULT filling a
// value an INSERT never named, an ON CONFLICT arbiter that does or does not
// resolve against a composite primary key — a JS re-implementation would pass
// this gate and ship a different predicate.
//
// ── the namespace ─────────────────────────────────────────────────────────
//
// One mechanical identifier rewrite over the REAL DDL in db/schema.sql:
// `vy_episode` becomes `wsagent_test_vy_episode`, and so does every index and
// constraint name derived from it. Nothing about clause structure, joins, casts
// or types changes. Teardown is a table drop rather than a delete-where-you-
// hope, and residue is greppable rather than trusted.
//
// db/schema.sql is used rather than db/migrations/009_agents.sql because 009 is
// a set of ALTERs against tables 001-008 already created — the schema file is
// the one place that carries the pre-009 CREATEs and 009's ALTERs in the order
// production actually applied them. Migration 009 is not re-applied on top for
// the same reason evals/mp re-applies 008 and this file does not: 009 is
// already IN the transcript below, and applying it twice would prove schema.sql
// agrees with itself rather than that the fixture matches production.
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import { MEERA_AGENT_ID } from "../../api/_agentscope.js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname;

export const PREFIX = "wsagent_test_";
export const TAG = "wsagent-test-";

// ── the two agents ────────────────────────────────────────────────────────
//
// A1 is Meera's REAL id, on purpose: the gate should prove the predicate holds
// for the uuid production actually writes, not for a synthetic stand-in that
// might differ in some way nobody thought about. A2 is unmistakably a fixture
// id — it is not v4-shaped in its node field by accident, it reads `...a9e27`
// ("agent") and its slug carries the house test prefix, so a row of it turning
// up anywhere outside this namespace is self-identifying.
export const A1 = MEERA_AGENT_ID;
export const A2 = "a9e27000-0000-4000-8000-00000000a9e2";
export const AGENTS = [A1, A2];
export const A2_SLUG = `${TAG}testagent`;

/** Eight fixture persons, deterministic so a failing scenario id means the same
 *  thing on a re-run and can be quoted in a report. Every one of them has rows
 *  under BOTH agents — a fixture where the two agents talk to disjoint people
 *  cannot detect a cross-agent leak, which is the only thing this gate is for. */
export const PERSONS = Array.from(
  { length: 8 },
  (_, i) => `a9e27001-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
);

// Every relation the rewrite knows about. `vy_grant` is here for the same
// reason evals/mp/harness.mjs carries it: 008b names three indexes
// `vy_grant_*` on vy_disclosure_grant, and an index name left unprefixed
// collides with the REAL index, whereupon `if not exists` turns the statement
// into a silent no-op and the fixture table quietly lacks it.
const NAMES = [
  "vy_agent",
  "vy_episode_participant",
  "vy_episode",
  "vy_fact",
  "vy_rel_state",
  "vy_rel_event",
  "vy_pattern",
  "vy_phrase",
  "vy_ritual",
  "vy_currency",
  "vy_kin",
  "vy_india_profile",
  "vy_taste_candidate",
  "vy_shared_moment",
  "vy_visual_assertion",
  "vy_embedding",
  "vy_derivation",
  "vy_session",
  "vy_group_member",
  "vy_group_turn",
  "vy_group",
  "vy_disclosure_grant",
  "vy_grant",
];
const NS_RE = new RegExp(`(^|[^\\w.])(${NAMES.join("|")})`, "g");

/** Rewrite every known relation name into the fixture namespace. Prefixing at
 *  the FRONT of the token is why alternation order does not have to be
 *  longest-first: `vy_group_member` matches the `vy_group` alternative and
 *  still comes out as `wsagent_test_vy_group_member`. */
export const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);
/** The fixture name of one relation. */
export const T = (name) => PREFIX + name;

/** The tables the gate builds and sweeps — every agent-scoped table in §2 that
 *  db/schema.sql creates, with the column the gate reads it by and the text
 *  column it tags (null where the table carries no free text; those are
 *  identified by their fixture person/agent ids instead). */
export const FIXTURE_TABLES = [
  { table: "vy_episode", person: "person_id", tag: "summary" },
  { table: "vy_fact", person: "person_id", tag: "body" },
  { table: "vy_rel_state", person: "person_id", tag: null },
  { table: "vy_rel_event", person: "person_id", tag: "note" },
  { table: "vy_pattern", person: "person_id", tag: "if_shape" },
  { table: "vy_phrase", person: "person_id", tag: "phrase" },
  { table: "vy_ritual", person: "person_id", tag: "key" },
  { table: "vy_currency", person: "person_id", tag: "topic" },
  { table: "vy_kin", person: "person_id", tag: "name" },
  { table: "vy_india_profile", person: "person_id", tag: "home_region" },
  { table: "vy_taste_candidate", person: "person_id", tag: "take" },
  { table: "vy_shared_moment", person: "person_id", tag: "reaction" },
  { table: "vy_visual_assertion", person: "person_id", tag: "claim" },
  { table: "vy_embedding", person: "person_id", tag: null },
  { table: "vy_derivation", person: "person_id", tag: "model" },
  { table: "vy_session", person: "person_id", tag: "session_id" },
  { table: "vy_group_member", person: "person_id", tag: null },
  { table: "vy_group", person: null, tag: "name" },
  { table: "vy_group_turn", person: null, tag: "reason" },
  { table: "vy_disclosure_grant", person: null, tag: null },
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
 *  a fixture row. The second half is the one that matters: a harness that wrote
 *  into the real tables through a name-rewrite bug would otherwise leave no
 *  trace anyone thought to look for. Probed two ways — by the wsagent-test-
 *  string where the table has free text, and by the fixture PERSON and AGENT
 *  ids where it does not, because the tables with no text column are exactly
 *  the ones a string grep cannot see. */
export async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const hits = [];
  for (const t of FIXTURE_TABLES) {
    const preds = [];
    if (t.tag) preds.push(`${t.tag}::text like '${TAG}%'`);
    if (t.person) preds.push(`${t.person} = any($1::uuid[])`);
    preds.push(`agent_id = $2::uuid`);
    const [row] = await q(
      `select count(*)::int n from ${t.table} where ${preds.join(" or ")}`,
      [PERSONS, A2],
    ).catch(() => [{ n: 0 }]);
    if (Number(row?.n || 0) > 0) hits.push(`${t.table}: ${row.n}`);
  }
  const [agentRow] = await q(
    `select count(*)::int n from vy_agent where agent_id = $1::uuid or slug like $2`,
    [A2, `${TAG}%`],
  ).catch(() => [{ n: 0 }]);
  if (Number(agentRow?.n || 0) > 0) hits.push(`vy_agent: ${agentRow.n}`);
  return { relations: rels.map((r) => r.tablename), productionRows: hits };
}

const BUILD_TABLES = new Set([...FIXTURE_TABLES.map((t) => t.table), "vy_agent", "vy_episode_participant"]);

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

/** Apply db/schema.sql's statements for the fixture tables into the namespace,
 *  in file order — which is CREATE (001-008), then 009's ALTER/UPDATE/INDEX
 *  sequence, then the composite-PK swap and its compat indexes. The whole
 *  point is that the fixture carries 009's real shape: the agent_id DEFAULT
 *  that migration 010 will remove, the NOT NULL, the four composite primary
 *  keys, and the four `*_person_compat_ix` transitional unique indexes. */
export async function buildSchema() {
  const full = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
  const stmts = splitSql(full).filter((s) => BUILD_TABLES.has(targetOf(s)));
  let applied = 0;
  for (const s of stmts) {
    await q(ns(s), [], 60_000);
    applied++;
  }
  return { applied, considered: stmts.length };
}

export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const uuid = (s) => `${lit(s)}::uuid`;
/** A 1536-dim halfvec built in SQL rather than as a 20KB literal. */
const VEC = `('[' || array_to_string(array_fill(0.1::real, array[1536]), ',') || ']')::halfvec`;

/**
 * Seed the two-agent corpus: for EVERY (agent, person) pair, one row in every
 * agent-scoped table. Both agents hold rows about the same eight people, which
 * is the only fixture shape in which a cross-agent leak is detectable at all.
 *
 * Every row names agent_id EXPLICITLY. Leaning on 009's column DEFAULT here
 * would make the fixture a test of the default rather than of the predicate,
 * and would file every A2 row under Meera — the gate would then pass by
 * having no cross-agent rows to leak.
 */
export async function seed() {
  const counts = {};
  const groupId = {}; // `${agent}|${person}` -> fixture room id
  const epId = {};

  // vy_agent — Meera is already seeded by 009's own INSERT in the transcript;
  // the second agent is this gate's own row.
  await q(
    `insert into ${T("vy_agent")} (agent_id, slug, display_name, register, status)
     values (${uuid(A2)}, ${lit(A2_SLUG)}, ${lit(`${TAG}Test Agent`)}, '{}'::jsonb, 'active')
     on conflict (agent_id) do nothing`,
  );

  for (const agent of AGENTS) {
    for (const person of PERSONS) {
      const key = `${agent}|${person}`;
      const label = `${TAG}${agent === A1 ? "a1" : "a2"}-${person.slice(-4)}`;

      const [ep] = await q(
        `insert into ${T("vy_episode")}
           (agent_id, person_id, channel, participation, started_at, ended_at, summary, provisional)
         values (${uuid(agent)}, ${uuid(person)}, 'chat', 'we', now() - interval '2 hours',
                 now() - interval '1 hour', ${lit(`${label} episode`)}, false)
         returning id`,
      );
      epId[key] = ep.id;

      const [grp] = await q(
        `insert into ${T("vy_group")} (agent_id, name, kind, room_device_id)
         values (${uuid(agent)}, ${lit(`${label} room`)}, 'friend_group', gen_random_uuid())
         returning id`,
      );
      groupId[key] = grp.id;

      const [va] = await q(
        `insert into ${T("vy_visual_assertion")}
           (agent_id, episode_id, person_id, claim, extractor_model, confidence)
         values (${uuid(agent)}, ${ep.id}, ${uuid(person)}, ${lit(`${label} claim`)}, 'fixture', 0.9)
         returning id`,
      );

      const rows = [
        `insert into ${T("vy_fact")}
           (agent_id, person_id, kind, name, body, provenance, citations)
         values (${uuid(agent)}, ${uuid(person)}, 'user', ${lit(`${label}-name`)},
                 ${lit(`${label} fact body`)}, 'extracted', array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_rel_state")} (agent_id, person_id, honorific, trust)
         values (${uuid(agent)}, ${uuid(person)}, 'tum', 0.4)`,
        `insert into ${T("vy_rel_event")}
           (agent_id, person_id, dim, to_v, direction, note, citations)
         values (${uuid(agent)}, ${uuid(person)}, 'honorific', 'tum', 'advance',
                 ${lit(`${label} note`)}, array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_pattern")}
           (agent_id, person_id, moment, if_shape, then_note, citations)
         values (${uuid(agent)}, ${uuid(person)}, 'stress', ${lit(`${label} if`)},
                 ${lit(`${label} then`)}, array[${ep.id},${ep.id}]::bigint[])`,
        `insert into ${T("vy_phrase")} (agent_id, person_id, phrase, origin_episode)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label} phrase`)}, ${ep.id})`,
        `insert into ${T("vy_ritual")} (agent_id, person_id, key, last_at, count, citations)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label}-ritual`)}, now(), 3,
                 array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_currency")} (agent_id, person_id, topic, kind, last_used, uses, citations)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label}-topic`)}, 'food', now(), 1,
                 array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_kin")} (agent_id, person_id, name, relation, citations)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label}-kin`)}, 'mausi',
                 array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_india_profile")} (agent_id, person_id, home_region)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label} region`)})`,
        `insert into ${T("vy_taste_candidate")}
           (agent_id, person_id, take, source, source_id, citations)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label} take`)}, 'pattern', ${ep.id},
                 array[${ep.id}]::bigint[])`,
        `insert into ${T("vy_shared_moment")} (agent_id, episode_id, person_id, assertion_id, reaction)
         values (${uuid(agent)}, ${ep.id}, ${uuid(person)}, ${va.id}, ${lit(`${label} reaction`)})`,
        `insert into ${T("vy_embedding")} (agent_id, owner_kind, owner_id, person_id, v)
         values (${uuid(agent)}, 'episode', ${ep.id}, ${uuid(person)}, ${VEC})`,
        `insert into ${T("vy_derivation")}
           (agent_id, person_id, model, prompt_hash, input_from, input_to, wrote)
         values (${uuid(agent)}, ${uuid(person)}, ${lit(`${label}-model`)}, 'fixture', 1, 2, '[]'::jsonb)`,
        `insert into ${T("vy_session")} (agent_id, session_id, person_id)
         values (${uuid(agent)}, ${lit(`${label}-session`)}, ${uuid(person)})`,
        `insert into ${T("vy_group_member")} (agent_id, group_id, person_id, linked_at)
         values (${uuid(agent)}, ${grp.id}, ${uuid(person)}, now())`,
        `insert into ${T("vy_group_turn")} (agent_id, group_id, episode_id, action, reason)
         values (${uuid(agent)}, ${grp.id}, ${ep.id}, 'speak', ${lit(`${label} reason`)})`,
        `insert into ${T("vy_disclosure_grant")}
           (agent_id, subject_kind, subject_id, granted_by, granted_to, group_id, citations)
         values (${uuid(agent)}, 'episode', ${ep.id}, ${uuid(person)}, ${uuid(PERSONS[0])},
                 ${grp.id}, array[${ep.id}]::bigint[])`,
      ];
      for (const sql of rows) await q(sql, [], 30_000);
    }
  }

  for (const t of FIXTURE_TABLES) {
    const [row] = await q(`select count(*)::int n from ${T(t.table)}`);
    counts[t.table] = Number(row.n);
  }
  return { epId, groupId, counts };
}
