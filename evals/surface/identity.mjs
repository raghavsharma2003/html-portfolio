// Identity resolution across surfaces — WS-SURFACE, SPEC-AGENT-LAYER §4.
//
//   node evals/surface/identity.mjs
//   node evals/surface/identity.mjs --cleanup
//
// The property under test is the one §1 calls load-bearing: **person is
// shared, agent scopes the relationship, SURFACE SCOPES NOTHING.** A user who
// talks to her on Telegram and then on the web is the same relationship. So
// resolution must be:
//
//   idempotent  — linking twice binds once, and re-resolving is stable
//   convergent  — the same human on two surfaces is ONE vy_person row
//   isolating   — two different surface users are never the same person, and
//                 the same NUMBER on two surfaces is never the same person
//                 (telegram 9001 and discord 9001 are strangers)
//   transitional— vy_tg_person still answers where vy_surface_identity has no
//                 row, and the read backfills the general table on the way past
//
// Same namespace mechanism as evals/mp/harness.mjs: one mechanical identifier
// rewrite over the REAL DDL into a `wssf_test_` schema, so the SHIPPING
// functions run against real Postgres semantics. Teardown is a table drop and
// residue is greppable rather than trusted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { q } from "../../api/_db.js";
import { splitSql } from "../../db/migrations/apply.mjs";
import {
  personForSurfaceUser,
  linkSurfacePerson,
  personForTgUser,
  linkTgPerson,
  surfaceDmDeviceId,
  surfaceRoomDeviceId,
} from "../../api/_room.js";

const ROOT = new URL("../..", import.meta.url).pathname;
const PREFIX = "wssf_test_";
const TAG = "wssf-test-";
const T = (n) => PREFIX + n;
const t = (n) => PREFIX + n;
const CLEANUP_ONLY = process.argv.includes("--cleanup");

let pass = 0;
const failures = [];
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? `  ${detail}` : ""}`);
  } else {
    failures.push(name);
    console.log(`  FAIL ${name}  ${detail}`);
  }
};

const WANTED = new Set(["vy_person", "vy_person_device", "vy_tg_person", "vy_surface_identity"]);
const NS_RE = new RegExp(`(^|[^\\w.])(${[...WANTED].join("|")})`, "g");
const ns = (sql) => sql.replace(NS_RE, (_m, pre, id) => `${pre}${PREFIX}${id}`);

const targetOf = (stmt) => {
  const s = stmt.replace(/--[^\n]*\n/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  let m = /^create table if not exists ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  m = /^create (?:unique )?index if not exists [a-z_0-9]+ on ([a-z_0-9]+)/.exec(s);
  if (m) return m[1];
  return null;
};

async function teardown() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  for (const r of rels) await q(`drop table if exists ${r.tablename} cascade`, [], 60_000);
  return rels.length;
}

/** No fixture relation may survive, and NO PRODUCTION TABLE may carry a
 *  wssf-test- string. The second half is the one that matters: a run that
 *  wrote into the real tables through a resolver bug would otherwise leave no
 *  trace anyone thought to look for. */
async function proveNoResidue() {
  const rels = await q(
    `select tablename from pg_tables where schemaname = 'public' and tablename like $1`,
    [`${PREFIX}%`],
  );
  const hits = [];
  for (const [table, where] of [
    ["vy_tg_person", `username like '${TAG}%'`],
    ["vy_surface_identity", `handle like '${TAG}%'`],
  ]) {
    const [row] = await q(`select count(*)::int n from ${table} where ${where}`).catch(() => [{ n: 0 }]);
    if (Number(row?.n || 0) > 0) hits.push(`${table}: ${row.n}`);
  }
  return { relations: rels.map((r) => r.tablename), productionRows: hits };
}

if (CLEANUP_ONLY) {
  const n = await teardown();
  const res = await proveNoResidue();
  console.log(`dropped ${n} fixture relation(s); residue: ${JSON.stringify(res)}`);
  process.exit(res.relations.length || res.productionRows.length ? 1 : 0);
}

// ── the schema, from the REAL files ───────────────────────────────────────
console.log("── fixture namespace ──");
await teardown();
const sources = [
  readFileSync(join(ROOT, "db/schema.sql"), "utf8"),
  readFileSync(join(ROOT, "db/migrations/008c_telegram_identity.sql"), "utf8"),
  readFileSync(join(ROOT, "db/migrations/009_agents.sql"), "utf8"),
];
const stmts = sources.flatMap((s) => splitSql(s)).filter((s) => WANTED.has(targetOf(s)));
for (const s of stmts) await q(ns(s), [], 60_000);
console.log(`  ok   ${stmts.length} DDL statements -> ${PREFIX}*`);

// ── 0. the structural claim, against the LIVE table ───────────────────────
//
// §4: "Note what is ABSENT: no agent_id." That is not a style note — a
// per-agent identity table would make "she remembers me from Telegram" false
// on the web for a reason no user could ever be told. It is asserted against
// production's own catalog, not against the migration file, because the file
// is what we intended and the catalog is what is true.
console.log("\n── vy_surface_identity is AGENT-INDEPENDENT (§4) ──");
const cols = await q(
  `select column_name from information_schema.columns
    where table_schema = 'public' and table_name = 'vy_surface_identity'`,
).catch(() => []);
const names = cols.map((c) => c.column_name).sort();
ok("the live table exists", names.length > 0, names.join(","));
ok("it has NO agent_id column, and must never gain one", !names.includes("agent_id"), names.join(","));
ok(
  "it is keyed (surface, surface_user_id) and points at a person",
  ["surface", "surface_user_id", "person_id", "handle", "linked_at"].every((c) => names.includes(c)),
);

// ── 1. link, and link again ───────────────────────────────────────────────
console.log("\n── linking is idempotent ──");
ok("an unknown surface user resolves to nothing",
  (await personForSurfaceUser("telegram", "9001", t)) === null);

const first = await linkSurfacePerson("telegram", "9001", { handle: `${TAG}rhea` }, t);
ok("a first link creates the person", first?.created === true && Boolean(first.personId));
const again = await linkSurfacePerson("telegram", "9001", { handle: `${TAG}rhea` }, t);
ok("a second link binds nothing new", again?.created === false && again.personId === first.personId);
const third = await linkTgPerson(9001, { username: `${TAG}rhea` }, t);
ok("the legacy spelling reaches the same binding", third.personId === first.personId && third.created === false);

const personRows = await q(`select count(*)::int n from ${T("vy_person")}`);
ok("exactly ONE vy_person row exists after three links", personRows[0].n === 1, `${personRows[0].n}`);
const siRows = await q(`select surface, surface_user_id, person_id, handle from ${T("vy_surface_identity")}`);
ok("exactly one vy_surface_identity row", siRows.length === 1, JSON.stringify(siRows));
ok("…on the telegram surface", siRows[0].surface === "telegram" && siRows[0].surface_user_id === "9001");
const tgRows = await q(`select tg_user_id, person_id from ${T("vy_tg_person")}`);
ok("the legacy vy_tg_person row was written too (transition)", tgRows.length === 1);
ok("both tables name the SAME person", String(tgRows[0].person_id) === String(siRows[0].person_id));

// ── 2. resolution never crosses persons ───────────────────────────────────
console.log("\n── resolution never crosses persons ──");
const vikram = await linkSurfacePerson("telegram", "9002", { handle: `${TAG}vikram` }, t);
ok("a second surface user gets a DIFFERENT person", vikram.personId !== first.personId);
const r1 = await personForSurfaceUser("telegram", "9001", t);
const r2 = await personForSurfaceUser("telegram", "9002", t);
ok("9001 resolves to 9001's person", r1.person_id === first.personId);
ok("9002 resolves to 9002's person", r2.person_id === vikram.personId);
ok("and they are not the same person", r1.person_id !== r2.person_id);

// THE SAME NUMBER ON TWO WIRES IS TWO STRANGERS. This is the assertion that
// makes `surface` part of the key rather than decoration: a Discord snowflake
// and a Telegram user id live in the same integer space and mean nothing to
// each other.
ok("discord user 9001 is NOT telegram user 9001",
  (await personForSurfaceUser("discord", "9001", t)) === null);
const dcSame = await linkSurfacePerson("discord", "9001", { handle: `${TAG}someone-else` }, t);
ok("…and linking it makes a THIRD person, not a merge",
  dcSame.personId !== first.personId && dcSame.personId !== vikram.personId);

// ── 3. one human, two surfaces, ONE relationship ──────────────────────────
//
// §1's load-bearing clause. The mechanism is that a caller may pass the
// person_id it already knows: the surface is a phone line, not a different
// friend, and nothing about the relationship is re-keyed by which wire it
// arrived on.
console.log("\n── one human on two surfaces is one relationship ──");
const rheaOnWeb = await linkSurfacePerson("web", "web-rhea", { handle: `${TAG}rhea`, personId: first.personId }, t);
ok("binding a second surface to a known person creates NO new person",
  rheaOnWeb.personId === first.personId);
const stillOne = await q(`select count(*)::int n from ${T("vy_person")} where person_id = $1`, [first.personId]);
ok("still one vy_person row for her", stillOne[0].n === 1);
const hers = await q(
  `select surface from ${T("vy_surface_identity")} where person_id = $1 order by surface`,
  [first.personId],
);
ok("two identity rows, one person", hers.map((h) => h.surface).join(",") === "telegram,web",
  hers.map((h) => h.surface).join(","));
ok("resolving her on the web reaches the SAME person as Telegram",
  (await personForSurfaceUser("web", "web-rhea", t)).person_id ===
    (await personForSurfaceUser("telegram", "9001", t)).person_id);

// ── 4. the transition: vy_tg_person still answers, and drains ─────────────
//
// 009 backfilled vy_surface_identity from vy_tg_person and did NOT drop it.
// Both exist, so both must work — and the read must heal the gap rather than
// leave two tables to drift.
console.log("\n── the transition: legacy fallback, and the backfill on read ──");
await q(`delete from ${T("vy_surface_identity")} where surface_user_id = $1`, ["9002"]);
const gone = await q(`select count(*)::int n from ${T("vy_surface_identity")} where surface_user_id = $1`, ["9002"]);
ok("vy_surface_identity has no row for 9002 now", gone[0].n === 0);
const viaLegacy = await personForSurfaceUser("telegram", "9002", t);
ok("…but vy_tg_person still resolves them", viaLegacy?.person_id === vikram.personId, viaLegacy?.via);
ok("…and says so, so a caller can tell which table answered", viaLegacy.via === "vy_tg_person");
const healed = await q(
  `select person_id, handle from ${T("vy_surface_identity")} where surface = 'telegram' and surface_user_id = $1`,
  ["9002"],
);
ok("the read BACKFILLED the general table (the legacy one drains itself)",
  healed.length === 1 && String(healed[0].person_id) === String(vikram.personId));
const nowGeneral = await personForSurfaceUser("telegram", "9002", t);
ok("the next read comes from vy_surface_identity", nowGeneral.via === "vy_surface_identity");
ok("…and it is still the same person — the fallback did not fork anyone",
  nowGeneral.person_id === vikram.personId);

// a person on a surface with no legacy table has no second chance, by design
ok("a whatsapp user with no identity row resolves to nothing, never to a guess",
  (await personForSurfaceUser("whatsapp", "919000000001", t)) === null);

// ── 5. the adult gate survives the generalization ─────────────────────────
console.log("\n── the adult gate is structural on every surface (§6.4) ──");
const minorId = "c0000000-0000-4000-8000-000000000001";
await q(`insert into ${T("vy_person")} (person_id, age_tier) values ($1,'minor')`, [minorId]);
for (const s of ["telegram", "discord", "whatsapp", "web"]) {
  const refused = await linkSurfacePerson(s, `minor-${s}`, { handle: `${TAG}m`, personId: minorId }, t);
  ok(`${s}: a known minor is refused a binding`, refused === null);
}
const minorRows = await q(
  `select count(*)::int n from ${T("vy_surface_identity")} where person_id = $1`, [minorId],
);
ok("no identity row exists for them anywhere — no row, no persistence", minorRows[0].n === 0);

// ── 6. device ids are surface-qualified ───────────────────────────────────
//
// The synthetic devices are uuid-v5 over a surface-qualified seed, so the same
// user NUMBER on two wires can never collide into one device — which would
// merge two strangers' whole 1:1 histories.
console.log("\n── synthetic device ids cannot collide across surfaces ──");
const seeds = ["telegram", "discord", "whatsapp", "web"];
const dms = seeds.map((s) => surfaceDmDeviceId(s, "9001"));
ok("four surfaces, four DIFFERENT DM devices for user 9001", new Set(dms).size === 4, dms.join(" "));
const rooms = seeds.map((s) => surfaceRoomDeviceId(s, "-100777001"));
ok("four surfaces, four DIFFERENT room devices", new Set(rooms).size === 4);
ok("a DM device and a room device for the same key differ",
  surfaceDmDeviceId("telegram", "42") !== surfaceRoomDeviceId("telegram", "42"));
ok("the telegram seed is UNCHANGED (every device id already written depends on it)",
  surfaceRoomDeviceId("telegram", "-100777001") === (await import("../../api/_room.js")).roomDeviceId(-100777001));
ok("device ids are deterministic across calls",
  surfaceDmDeviceId("discord", "9001") === surfaceDmDeviceId("discord", "9001"));
ok("personForTgUser is the telegram spelling of the same resolve",
  (await personForTgUser(9001, t)).person_id === first.personId);

// ── teardown ──────────────────────────────────────────────────────────────
console.log("\n── teardown ──");
const dropped = await teardown();
console.log(`  dropped ${dropped} fixture relation(s)`);
const residue = await proveNoResidue();
ok("zero residue: no fixture relation survives, no production row carries the tag",
  residue.relations.length === 0 && residue.productionRows.length === 0,
  JSON.stringify(residue));

console.log(
  failures.length
    ? `\n${failures.length} of ${pass + failures.length} checks FAILED:\n` +
        failures.map((f) => `  - ${f}`).join("\n")
    : `\nall ${pass} checks passed`,
);
process.exit(failures.length ? 1 : 0);
