// WS-R170 ("data safety for the new tables"), law 4. `db/schema.sql`'s own
// header calls itself "transcribed from the live database", and the wave era
// already caught it drifting once: `context/rejected.md`'s own
// `046-replica-voice-preference` entry found that migration 046's preceding
// `create unique index if not exists vy_replica_generation_owner_tuple_ix`
// statement — added mid-file to fix a REAL live apply failure the migration's
// own header documents — never made it into the mirror; only the `create
// table` right after it did. Nothing caught that until a session went
// looking by hand. This gate is what makes "went looking by hand" this
// wave's problem for the LAST time.
//
//   node scripts/check-schema-mirror.mjs
//
// ── WHY NOT A LITERAL STATEMENT-TEXT COMPARE ────────────────────────────
// The first cut of this gate tried exactly that (`normalize()` a statement,
// require it as a substring of a normalized `db/schema.sql`) and it was
// WRONG for this repo's own established convention: `db/schema.sql` is a
// CANONICAL snapshot, not a transcript. A column a migration added with
// `alter table t add column if not exists c text` is correctly represented
// in the mirror as `c text` sitting INSIDE `create table t (...)`'s own
// column list — never as a second, literal `alter table add column`
// statement — and the same is true for a constraint added via a bare `alter
// table add constraint` versus one folded inline as `constraint name
// check(...)` in the table body. Grepped and confirmed against the real
// file (`vy_replica_voice_preference`, migration 046's own table): every
// constraint 046 adds with a separate `alter table ... add constraint`
// sits inline in `db/schema.sql`'s copy instead. A literal-text gate flagged
// 235 of 1,375 real statements this way — not one of them a real drift, all
// of them this exact, INTENTIONAL reshaping — which is precisely the
// "useless gate" trap `scripts/check-copy.mjs`'s own header warns a naive
// regex is. This gate checks the thing that actually matters instead: does
// every OBJECT a migration declares — a table, a column, a named index, a
// named trigger or function — exist SOMEWHERE in the mirror, under the
// identical name. That is exactly the shape of the one real gap this gate
// exists to catch: 046's own missing index was missing BY NAME, not merely
// reformatted.
//
// ── CONSTRAINTS ARE DELIBERATELY NOT A CHECKED DIMENSION ────────────────
// A first version of this gate also required every named `constraint <name>
// ...` to exist by that same name in the mirror, the identical reasoning
// applied to indexes. It produced 33 hits, and inspecting them one by one
// (`vy_org_name_shape`, `vy_replica_voice_trial_algorithm_check`,
// `vy_replica_identity_case_owner_fk`, and 30 more like them) found the SAME
// story every time: the check/unique/foreign-key ITSELF is present and
// correct in `db/schema.sql`, written as an UNNAMED inline clause (`text not
// null check (...)`, a bare `unique (...)`, a bare `foreign key (...)
// references ...`) rather than a named `constraint <name> ...` — and this
// repo's own `db/schema.sql` is INCONSISTENT about which style it uses even
// within one table (`vy_replica_voice_trial`'s own body names nine
// constraints and leaves its tenth, `algorithm`'s own check, unnamed).
// Postgres auto-assigns a name to an unnamed constraint, so there is no
// general, offline way to recover "the name a migration gave it" from an
// unnamed inline clause without parsing and semantically comparing
// expressions — real work, and a different gate's job. Zero of the 33 were a
// real drift; checking constraints by name here would make this gate cry
// wolf on every run, which is exactly how a real gate stops being watched.
// Columns and indexes have no such ambiguity (Postgres has no "anonymous
// index" syntax), which is why they stay hard-checked below.
//
// ── WHERE THE PARSING COMES FROM ────────────────────────────────────────
// `evals/sqlcast/schema.mjs`'s own `parseDDL()` already extracts a
// `{table: {column: type}}` map from arbitrary SQL text, handling `create
// table`, `alter table add column` and `alter table alter column type` —
// exactly the column-level view this gate needs, and a gate this repo
// already runs (`evals/sqlcast.mjs`, `evals/creator-export/run.mjs`'s own
// `loadSchema` import) on every push. Reused here rather than a second,
// competing SQL parser — the SAME lesson `scripts/check-schema-mirror.mjs`'s
// own first draft just relearned about statement splitting.
//
// ── WHAT "IN NUMERIC ORDER" MEANS ───────────────────────────────────────
// Migration files are walked 001, 002, 003… (this workstream's own brief).
// It is never a claim about BYTE ORDER inside `db/schema.sql`: that file is
// one of this wave's append-only shared files (`ws-common.md`, "never an
// edit in place"), so a LATER fix for an EARLIER migration's own mirror gap
// lands at the file's END, out of numeric order, by construction — the
// exact 046 case this gate exists to close, and the negative control below
// asserts that an out-of-order-but-present object is never flagged.
//
// ── SELF-TEST FIRST ──────────────────────────────────────────────────────
// `scripts/check-mirrors.mjs`'s own law: a gate nobody has watched fail is a
// gate nobody knows is wired. `selfTest()` runs on every invocation.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDDL } from "../evals/sqlcast/schema.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const MIGRATIONS_DIR = ROOT + "db/migrations/";
const SCHEMA_FILE = ROOT + "db/schema.sql";

function stripComments(sql) {
  return sql.replace(/--[^\n]*/g, "");
}

/** Every top-level migration file name, in NUMERIC order (the identical
 *  `.sort()` `db/migrations/apply.mjs`'s own runner already uses — the
 *  three-digit zero-padded prefix every migration carries makes lexical
 *  sort and numeric sort the same walk). Never the `reconciliation/`
 *  subdirectory: that holds archived, NOT-applied candidate SQL (every
 *  `db/migrations/reconciliation/` subdirectory's own `manifest.json`
 *  carries `"applyAuthorized": false` on every entry), and asking it to
 *  mirror into a file that describes what is actually LIVE would be exactly
 *  backwards. */
export function migrationFiles(dir = MIGRATIONS_DIR) {
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

/** Every `create [unique] index … <name>` this text declares, lower-cased,
 *  regardless of `if not exists`/`concurrently` — 046's own missing object
 *  was exactly one of these. */
export function declaredIndexNames(sql) {
  const src = stripComments(sql);
  const re = /create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(src))) out.add(m[1].toLowerCase());
  return out;
}

/** Every `create [or replace] function <name>` / `create trigger <name>`
 *  this text declares, lower-cased. */
export function declaredRoutineNames(sql) {
  const src = stripComments(sql);
  const out = new Set();
  const fn = /create\s+(?:or\s+replace\s+)?function\s+([a-z_][a-z0-9_]*)/gi;
  const tg = /create\s+trigger\s+([a-z_][a-z0-9_]*)/gi;
  let m;
  while ((m = fn.exec(src))) out.add(m[1].toLowerCase());
  while ((m = tg.exec(src))) out.add(m[1].toLowerCase());
  return out;
}

/**
 * Pure. `migrations` is `{filename: sourceText}`; `schemaText` is
 * `db/schema.sql`'s own text. Returns `{checked, missing}`.
 *
 *   `checked`  total object count examined (columns + indexes + routines,
 *              summed across every migration file).
 *   `missing`  `{file, kind, table?, name}` for every object a migration
 *              declares that the mirror does not, walked in migration-
 *              filename (numeric) order. `kind` is one of "column",
 *              "index", "routine".
 */
export function checkSchemaMirror(migrations, schemaText) {
  const schemaColumns = parseDDL(schemaText);
  const schemaIndexes = declaredIndexNames(schemaText);
  const schemaRoutines = declaredRoutineNames(schemaText);

  const missing = [];
  let checked = 0;

  for (const file of Object.keys(migrations).sort()) {
    const text = migrations[file];

    const cols = parseDDL(text);
    for (const [table, columns] of Object.entries(cols)) {
      for (const column of Object.keys(columns)) {
        checked++;
        if (!schemaColumns[table] || !(column in schemaColumns[table])) {
          missing.push({ file, kind: "column", table, name: column });
        }
      }
    }

    for (const name of declaredIndexNames(text)) {
      checked++;
      if (!schemaIndexes.has(name)) missing.push({ file, kind: "index", name });
    }

    for (const name of declaredRoutineNames(text)) {
      checked++;
      if (!schemaRoutines.has(name)) missing.push({ file, kind: "routine", name });
    }
  }

  return { checked, missing };
}

function selfTest() {
  const problems = [];
  // A named index genuinely absent from the mirror must be caught — the
  // exact 046 shape this gate exists to close.
  {
    const migrations = {
      "046_x.sql": "create unique index if not exists t_owner_ix on t(a,b);\ncreate table if not exists t (a uuid, b uuid);\n",
    };
    const schema = "create table if not exists t (a uuid, b uuid);\n";
    const { missing } = checkSchemaMirror(migrations, schema);
    const idx = missing.find((m) => m.kind === "index" && m.name === "t_owner_ix");
    if (!idx) problems.push("self-test: a real missing index was NOT caught");
    const tbl = missing.find((m) => m.kind === "column" && m.table === "t");
    if (tbl) problems.push("self-test: the table's own columns were wrongly flagged missing (false positive)");
  }
  // A column added by `alter table add column`, folded into the mirror's
  // `create table` column list instead of a literal second statement, must
  // NOT be flagged (the false-positive control this gate's own header
  // explains — db/schema.sql's real, intentional convention).
  {
    const migrations = {
      "002_y.sql": "create table if not exists u (id uuid);\n",
      "005_y2.sql": "alter table u add column if not exists note text;\n",
    };
    const schema = "create table if not exists u (id uuid, note text);\n";
    const { missing } = checkSchemaMirror(migrations, schema);
    if (missing.length !== 0) problems.push("self-test: an ADD COLUMN folded into the mirror's create table was wrongly flagged");
  }
  // A constraint added via a bare `alter table add constraint` — folded
  // inline as an UNNAMED `check(...)` in the mirror's own table body, this
  // repo's own real, inconsistent convention (this file's own header) —
  // must NOT be flagged: constraints are deliberately not a checked
  // dimension at all, so their presence or absence never affects `missing`.
  {
    const migrations = {
      "003_z.sql": "create table if not exists v (n integer);\nalter table v add constraint v_positive check (n > 0);\n",
    };
    const schema = "create table if not exists v (n integer check (n>0));\n";
    const { missing } = checkSchemaMirror(migrations, schema);
    if (missing.length !== 0) problems.push("self-test: an unnamed inline constraint was wrongly flagged (constraints must not be a checked dimension)");
  }
  // A routine genuinely absent from the mirror must be caught.
  {
    const migrations = { "004_w.sql": "create or replace function w_touch() returns trigger as $$ begin return new; end; $$ language plpgsql;\n" };
    const schema = "create table if not exists w (n integer);\n";
    const { missing } = checkSchemaMirror(migrations, schema);
    if (!missing.some((m) => m.kind === "routine" && m.name === "w_touch")) {
      problems.push("self-test: a genuinely missing routine was NOT caught");
    }
  }
  // An object present but appended OUT of migration-numeric order (046's
  // own real shape: a later fix for an earlier gap, appended at the mirror's
  // end) must still pass — this gate never checks byte position.
  {
    const migrations = {
      "001_first.sql": "create table if not exists early (id uuid);\n",
      "005_later.sql": "create index if not exists early_ix on early(id);\n",
    };
    const schema = "create index if not exists early_ix on early(id);\ncreate table if not exists early (id uuid);\n";
    const { missing } = checkSchemaMirror(migrations, schema);
    if (missing.length !== 0) problems.push("self-test: an out-of-numeric-order (but present) object was wrongly flagged");
  }
  // Migration files are walked in NUMERIC order, not insertion order.
  {
    const order = Object.keys({ "010_z.sql": "x", "002_a.sql": "y" }).sort();
    if (order[0] !== "002_a.sql") problems.push("self-test: numeric-prefix sort did not visit 002 before 010");
  }
  return problems;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dead = selfTest();
  if (dead.length) {
    console.log(`FAIL  check-schema-mirror self-test: the gate is not biting (${dead.length}):`);
    for (const d of dead) console.log("  " + d);
    process.exit(1);
  }

  const files = migrationFiles();
  const migrations = {};
  for (const f of files) migrations[f] = readFileSync(MIGRATIONS_DIR + f, "utf8");
  const schemaText = readFileSync(SCHEMA_FILE, "utf8");

  const { checked, missing } = checkSchemaMirror(migrations, schemaText);
  if (missing.length) {
    console.log(`FAIL  check-schema-mirror: ${missing.length} of ${checked} declared object(s) not found in db/schema.sql:`);
    for (const m of missing.slice(0, 40)) {
      console.log(`  ${m.file}  ${m.kind}  ${m.table ? `${m.table}.${m.name}` : m.name}`);
    }
    if (missing.length > 40) console.log(`  ...and ${missing.length - 40} more`);
    process.exit(1);
  }
  console.log(`  ok    schema mirror: ${checked} declared object(s) across ${files.length} migration file(s), 0 missing from db/schema.sql`);
  process.exit(0);
}
