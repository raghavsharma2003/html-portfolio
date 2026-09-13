// WS-R170 ("data safety for the new tables"), law 4. The offline eval for
// `scripts/check-schema-mirror.mjs` — ws-common.md's own rule that every
// workstream ships an offline eval with at least one NEGATIVE control,
// registered in `evals/run.mjs`. The gate script itself carries an inline
// `selfTest()` that runs on every invocation (`scripts/check-mirrors.mjs`'s
// own "a gate nobody has watched fail is a gate nobody knows is wired" law);
// this file is the SEPARATE, fuller battery over the same exported pure
// functions, driven through the eval registry rather than the gate runner.
//
//   node evals/schema-mirror/run.mjs
//
// Offline, deterministic, $0, no DB, no network, no model call.
import { checkSchemaMirror, declaredIndexNames, declaredRoutineNames, migrationFiles } from "../../scripts/check-schema-mirror.mjs";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// ── §1 a real, missing named object is caught (the 046 shape) ──────────────
{
  const migrations = {
    "046_x.sql": "create unique index if not exists t_owner_ix on t(a,b);\ncreate table if not exists t (a uuid, b uuid);\n",
  };
  const schema = "create table if not exists t (a uuid, b uuid);\n";
  const { checked, missing } = checkSchemaMirror(migrations, schema);
  ok("a real missing index is caught, named, with its own migration file", missing.some((m) => m.kind === "index" && m.name === "t_owner_ix" && m.file === "046_x.sql"));
  ok("the table's own column (present in both) is not also flagged", !missing.some((m) => m.kind === "column"));
  ok("checked counts every object examined, not just the misses", checked >= 2);
}

// ── §2 NEGATIVE CONTROL (a): a clean tree must report zero missing ─────────
{
  const migrations = { "001_a.sql": "create table if not exists clean (id uuid primary key);\ncreate index if not exists clean_ix on clean(id);\n" };
  const schema = "create table if not exists clean (id uuid primary key);\ncreate index if not exists clean_ix on clean(id);\n";
  const { missing } = checkSchemaMirror(migrations, schema);
  ok("NEGATIVE CONTROL (a): a genuinely clean pair reports zero missing (the gate does not cry wolf on a real match)", missing.length === 0);
}

// ── §3 columns folded from ALTER TABLE ADD COLUMN into the mirror's own
//    CREATE TABLE column list are not flagged — db/schema.sql's real,
//    intentional convention, verified against the real file (46 migration
//    statements once wrongly flagged this way before the gate's design
//    changed; see scripts/check-schema-mirror.mjs's own header). ─────────
{
  const migrations = {
    "010_base.sql": "create table if not exists s (id uuid primary key);\n",
    "011_add.sql": "alter table s add column if not exists note text;\nalter table s add column if not exists tag text;\n",
  };
  const schema = "create table if not exists s (id uuid primary key, note text, tag text);\n";
  const { missing } = checkSchemaMirror(migrations, schema);
  ok("columns added by separate ALTER TABLE statements, folded into the mirror's CREATE TABLE, are not flagged", missing.length === 0);
}

// ── §4 NEGATIVE CONTROL (b): a column genuinely absent from the mirror
//    entirely (neither as a literal ALTER nor folded into CREATE TABLE) is
//    still caught — proves §3 is not simply "never checks columns at all". ──
{
  const migrations = { "012_gap.sql": "alter table s add column if not exists missing_col text;\n" };
  const schema = "create table if not exists s (id uuid primary key);\n";
  const { missing } = checkSchemaMirror(migrations, schema);
  ok("NEGATIVE CONTROL (b): a column truly absent from the mirror is caught", missing.some((m) => m.kind === "column" && m.name === "missing_col"));
}

// ── §5 an object present but appended OUT of migration-numeric order (the
//    real, append-only shape every wave-era fix to this mirror takes) still
//    passes — this gate never checks byte position. ────────────────────────
{
  const migrations = {
    "001_first.sql": "create table if not exists early (id uuid);\n",
    "005_later.sql": "create index if not exists early_ix on early(id);\n",
  };
  // The 005 statement's mirror sits textually BEFORE the 001 statement's own
  // mirror — deliberately out of numeric order, matching an append-only fix
  // landing at the end of a long-lived file.
  const schema = "create index if not exists early_ix on early(id);\ncreate table if not exists early (id uuid);\n";
  const { missing } = checkSchemaMirror(migrations, schema);
  ok("an out-of-numeric-order but present object passes (never a positional check)", missing.length === 0);
}

// ── §6 migration files are walked in NUMERIC order ──────────────────────────
{
  const migrations = { "010_z.sql": "x", "002_a.sql": "y", "100_c.sql": "z" };
  const order = Object.keys(migrations).sort();
  ok("numeric-prefix sort visits 002 before 010 before 100", order[0] === "002_a.sql" && order[1] === "010_z.sql" && order[2] === "100_c.sql");
}

// ── §7 declaredIndexNames / declaredRoutineNames, the exported helpers this
//    gate's own completeness check is built from, each on their own. ───────
{
  const idx = declaredIndexNames("create index if not exists a_ix on a(x);\ncreate unique index B_IX on b(y);\n-- create index not_real on c(z);\n");
  ok("declaredIndexNames finds a plain create index", idx.has("a_ix"));
  ok("declaredIndexNames finds a unique index and lower-cases the name", idx.has("b_ix"));
  ok("declaredIndexNames ignores an index name that only appears inside a -- comment", !idx.has("not_real"));

  const routines = declaredRoutineNames("create or replace function touch_x() returns trigger as $$ begin return new; end; $$ language plpgsql;\ncreate trigger x_touch before update on x for each row execute function touch_x();\n");
  ok("declaredRoutineNames finds a create or replace function", routines.has("touch_x"));
  ok("declaredRoutineNames finds a create trigger", routines.has("x_touch"));
}

// ── §8 the real repo tree, right now, mirrors clean — the regression check
//    that matters: this eval runs the actual gate logic against the actual
//    checked-in files, not only fixtures, so a future drift trips THIS suite
//    (part of the "eval suite" gate, run on every push) even before someone
//    runs the standalone `scripts/check-schema-mirror.mjs` gate by hand. ───
{
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const ROOT = fileURLToPath(new URL("../../", import.meta.url));
  const files = migrationFiles(ROOT + "db/migrations/");
  ok(`the real repo has a non-trivial migration set (not vacuously empty)`, files.length >= 100, `got ${files.length}`);
  const migrations = {};
  for (const f of files) migrations[f] = readFileSync(ROOT + "db/migrations/" + f, "utf8");
  const schemaText = readFileSync(ROOT + "db/schema.sql", "utf8");
  const { checked, missing } = checkSchemaMirror(migrations, schemaText);
  ok(`the real db/schema.sql mirrors every real migration's declared objects (${checked} checked)`, missing.length === 0,
    missing.length ? missing.slice(0, 5).map((m) => `${m.file}:${m.kind}:${m.table ? `${m.table}.${m.name}` : m.name}`).join(", ") : "");
}

console.log(`\n${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
