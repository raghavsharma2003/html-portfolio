// WS-R. PERSON_TABLES completeness, OFFLINE, against the checked-in DDL.
//
// WHY THIS EXISTS
//
// scripts/relcheck.mjs already asserts manifest coverage — and it is the right
// place for it, because it can see the database as it actually is. But it
// needs NEON_URL, and it SKIPS when there is none. Every CI run without
// credentials therefore printed nothing at all about the one list whose
// omission is a privacy failure: a table missing from PERSON_TABLES is
// invisible to BOTH the forget cascade and the DSAR export, so a person who
// asked to be forgotten keeps rows in it and an export of "everything we hold
// about you" quietly omits them.
//
// That is exactly the shape relcheck's own header warns about ("a coverage
// check is only as wide as the thing it enumerates") and evals/teardown.mjs
// warns about from the other side. A skipped gate is indistinguishable from a
// passing one, and this one was skipped by default.
//
// So the same question is asked a second time of the DDL, which is checked in
// and needs no credentials: db/schema.sql plus db/migrations/*.sql, parsed by
// the same loader evals/sqlcast uses. It cannot see a table someone created
// straight against the database — relcheck is what catches that — but it CAN
// see every table this repo ever wrote a migration for, which is all of them,
// and it sees them on a laptop with no secrets.
//
// The three tables WS-M's sweep found missing (vy_account_person,
// vy_replica_dialogue_turn, vy_replica_runtime_session) are all in the DDL.
// This check would have failed on the day each migration landed.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadSchema } from "./sqlcast/schema.mjs";
import { PERSON_TABLES, REPLICA_PERSON_TABLES, keysOf } from "../api/memory.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let failed = 0;
const problem = (msg) => {
  failed++;
  console.log("  FAIL " + msg);
};

const schema = loadSchema(ROOT);
const tables = Object.keys(schema);
// Same floor discipline as sqlcast: a DDL parser that quietly returns nothing
// makes this check pass while comparing the manifest against an empty set.
if (tables.length < 100) {
  problem(`DDL parse found only ${tables.length} tables — expected 100+`);
}

// Every column name that means "a natural person" in this schema. Kept in step
// with scripts/relcheck.mjs's PERSON_COLUMNS; the two lists are asserted equal
// below rather than merely intended to match.
const PERSON_COLUMNS = [
  "person_id",
  "device_id",
  "user_id",
  "auth_user_id",
  "subject_person_id",
  "speaker_person_id",
  "granted_by",
  "granted_to",
  "owner_user_id",
  // WS-R23 (086): joins relcheck's own list for the identical reason -
  // vy_creator_invite's redeemed_by_user_id IS the replica owner's id once a
  // code is spent, the owner-lane fact that keeps it off PERSON_TABLES.
  "redeemed_by_user_id",
];

// The owner lane. `owner_user_id` is the replica owner's Supabase auth id — a
// natural person — and deliberately absent from PERSON_TABLES because the
// replica lane is erased by docs/REPLICA-ERASURE.md's chain, which must delete
// the OUTSIDE-Postgres objects before the rows that point at them. The full
// argument is written where the manifest ends (api/memory.js). Its machine
// check is relcheck's FK walk, which needs the live graph; here we only assert
// that the exclusion is by this ONE stated rule and nothing else, so a table
// cannot leave the manifest for a reason nobody wrote down.
//
// A table is on the owner lane only if it is owner-keyed AND NOT person-keyed.
// The first draft of this rule said "owner-keyed", full stop, and it
// immediately failed on the three tables this workstream had just added —
// which was the check being RIGHT about the rule being wrong. A runtime
// capability, session or dialogue turn names TWO natural people: the teacher
// who owns the clone and the student who talked to it. Both have a claim, they
// are answered by different paths, and the row has to be in both:
//
//   the student's forget  -> the manifest loop, keyed on their person_id
//   the owner's erasure   -> the cascade from vy_replica (relcheck proves it)
//
// Nothing is stranded either way, because these three hold no pointer to any
// object outside Postgres — that is what separates them from vy_replica_source
// and vy_replica_voice_profile, which do, and which stay off the manifest.
const PERSON_SIDE = ["person_id", "device_id", "subject_person_id", "speaker_person_id"];
const ownerLane = (cols) => "owner_user_id" in cols && !PERSON_SIDE.some((c) => c in cols);

// Tables outside the two product prefixes are not user data by construction
// (there are none today; the filter states the scope rather than assuming it).
const inScope = (t) => /^(vy|meera)_/.test(t);

// The written exemptions, mirrored from scripts/relcheck.mjs's EXEMPT map.
const EXEMPT = {
  meera_culture: "shared recognition index, one row per day, not per person",
  meera_consolidate_lease: "a self-expiring concurrency lease, not content",
  // The ONE table carrying both an owner and a person that stays off the
  // manifest. vy_replica.subject_person_id is the person the replica is OF,
  // and their claim on it is real — but the row is the ROOT of the erasure
  // cascade, so a manifest loop deleting it would fire 44 cascading deletes
  // and strand every voice profile, source original and derived object the
  // erasure chain needs those rows to find. The person's claim is answered by
  // the DDL instead, and answered completely: 015 declares
  // `subject_person_id references vy_person(person_id) on delete set null`,
  // so the moment the wipe's guarded tail deletes vy_person, nothing in this
  // table points at them any more. Deleting the replica itself is the OWNER's
  // request, and it goes through docs/REPLICA-ERASURE.md.
  vy_replica:
    "the erasure cascade's root; the subject link is severed by 015's " +
    "on-delete-set-null when vy_person goes, and deleting the row is the " +
    "owner's request, not the subject's",
  // WS-R23 (086). `ownerLane()` above only recognizes the LITERAL column name
  // `owner_user_id`, by design (its own docstring), so a table on the owner
  // lane through a differently-named column falls to this map instead of that
  // function - redeemed_by_user_id IS the replica owner's id once a code is
  // spent, the identical fact scripts/relcheck.mjs's widened owner-lane check
  // (OWNER_KEYS) walks against the live FK graph. Reached by name in
  // api/_replica-full-erasure.js, never by this manifest.
  vy_creator_invite:
    "redeemed_by_user_id is the owner lane under a different column name; " +
    "erased by name in api/_replica-full-erasure.js, checked by relcheck's " +
    "FK walk rather than this offline manifest",
  // WS-R100 (migration 126). Mirrors scripts/relcheck.mjs's own EXEMPT
  // entry, verbatim reasoning: an account-wide forget NULLS person_id on
  // this table (api/memory.js's own explicit door) rather than deleting the
  // row, so PERSON_TABLES membership (which means "wiped by the generic
  // DELETE loop") would be the wrong mechanism for it. Reachable for forget
  // (that explicit door) and export (api/_room-surface.js's
  // ROOM_EXPORT_EXTRA) both, just not through this manifest.
  vy_receipt:
    "an account-wide forget NULLS person_id (api/memory.js's own explicit " +
    "door) rather than deleting the row, so the number and the amount " +
    "survive; PERSON_TABLES membership would mean the generic DELETE loop " +
    "instead",
};

const listed = new Set(PERSON_TABLES.map((t) => t.table));

let checked = 0;
let owner = 0;
const missing = [];
for (const [table, cols] of Object.entries(schema)) {
  if (!inScope(table)) continue;
  if (!PERSON_COLUMNS.some((c) => c in cols)) continue;
  checked++;
  if (ownerLane(cols)) {
    owner++;
    if (listed.has(table)) {
      problem(
        `${table} is keyed ONLY on owner_user_id and is in PERSON_TABLES. The manifest ` +
          `loop would delete replica-lane rows out from under the erasure job, stranding ` +
          `the objects they point at in storage — and it could not key the delete anyway, ` +
          `since wipeParams has no owner id to bind. Erase it through the chain.`,
      );
    }
    continue;
  }
  if (listed.has(table) || EXEMPT[table]) continue;
  missing.push(table);
}
for (const t of missing) {
  problem(
    `${t} carries a person-identifying column in the checked-in DDL but is in neither ` +
      `PERSON_TABLES (api/memory.js) nor this file's EXEMPT map — so it is invisible to ` +
      `BOTH the forget cascade and the DSAR export.`,
  );
}
console.log(
  `  ${checked} person-keyed tables in the DDL (${owner} owner lane, ` +
    `${Object.keys(EXEMPT).length} exempt in writing, ${checked - owner - Object.keys(EXEMPT).length} listed)`,
);

// ── the manifest may not name a table the DDL does not have ────────────────
// The mirror failure: a manifest entry for a table nobody ever created turns
// every whole wipe into a 500, because the wipe loop's delete is not
// .catch()-swallowed on purpose.
for (const t of PERSON_TABLES) {
  if (!schema[t.table]) {
    problem(`PERSON_TABLES names ${t.table}, which no migration in db/ creates.`);
  }
}

// ── every owning column a manifest entry names must exist on that table ────
// A typo'd key is worse than a missing entry: the table LOOKS covered, the
// delete throws at runtime, and the receipt is never sent.
for (const t of PERSON_TABLES) {
  const cols = schema[t.table];
  if (!cols) continue;
  for (const k of keysOf(t)) {
    if (!(k in cols)) {
      problem(`PERSON_TABLES entry ${t.table} is keyed on ${k}, which that table has no column for.`);
    }
  }
  if (t.wipeWhere) {
    // Quoted string literals are DATA, never identifiers - `state in
    // ('cancelled','expired')` (WS-R11's own entry) must not have its
    // literal's CONTENTS mistaken for a column name the way its identifiers
    // legitimately are. Stripped before the identifier scan rather than
    // excluded value-by-value, so any future literal is covered by
    // construction instead of by an ever-growing exception list.
    const withoutStringLiterals = t.wipeWhere.replace(/'[^']*'/g, "''");
    for (const c of withoutStringLiterals.match(/[a-z_][a-z0-9_]*/g) || []) {
      if (["is", "null", "not", "and", "or", "true", "false", "in"].includes(c)) continue;
      if (!(c in cols)) {
        problem(`PERSON_TABLES entry ${t.table} has wipeWhere naming ${c}, not a column of it.`);
      }
    }
  }
}

// ── the migration-gated entries are gated ──────────────────────────────────
// The replica-lane person tables arrive with 015/023/027. activePersonTables()
// drops any that this database has not got, exactly as meera_consent is gated
// on 016 — without that, a manifest ahead of the migrations turns "make her
// forget me" into a 500 for a deploy-ordering reason.
for (const name of REPLICA_PERSON_TABLES) {
  if (!listed.has(name)) {
    problem(`${name} is gated by REPLICA_PERSON_TABLES but is not in PERSON_TABLES.`);
  }
}
for (const t of PERSON_TABLES) {
  if (!/^vy_(replica|account)_/.test(t.table)) continue;
  if (!REPLICA_PERSON_TABLES.includes(t.table)) {
    problem(
      `${t.table} is a replica-lane manifest entry but is not in REPLICA_PERSON_TABLES, so ` +
        `activePersonTables() will not gate it on its migration — a pre-015 database gets a 500 ` +
        `on every whole wipe instead of a receipt.`,
    );
  }
}

// ── the column list may not drift from relcheck's ──────────────────────────
// Two lists asking the same question in two places is how a widening lands in
// one and not the other, which is the failure this whole file is about.
const relcheckSrc = await import("node:fs").then((fs) =>
  fs.readFileSync(path.join(ROOT, "scripts/relcheck.mjs"), "utf8"),
);
const block = relcheckSrc.match(/const PERSON_COLUMNS = \[([\s\S]*?)\];/);
if (!block) {
  problem("scripts/relcheck.mjs has no PERSON_COLUMNS list to compare against.");
} else {
  const theirs = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
  const mine = [...PERSON_COLUMNS].sort().join(",");
  if (theirs.slice().sort().join(",") !== mine) {
    problem(
      `PERSON_COLUMNS has drifted: relcheck has [${theirs.join(", ")}], this file has ` +
        `[${PERSON_COLUMNS.join(", ")}]. The narrower one silently under-reports coverage.`,
    );
  }
}

// ── negative controls: watch the check fail before trusting it ─────────────
const NEG = [
  {
    name: "a person-keyed table absent from the manifest",
    run: () => {
      const fake = { vy_probe_thing: { person_id: "uuid", note: "text" } };
      return Object.entries(fake).filter(
        ([t, c]) => PERSON_COLUMNS.some((k) => k in c) && !listed.has(t) && !EXEMPT[t],
      ).length;
    },
  },
  {
    name: "a manifest key that is not a column",
    run: () => (keysOf({ key: "no_such_column" }).some((k) => !(k in (schema.vy_person || {}))) ? 1 : 0),
  },
];
for (const c of NEG) {
  if (!c.run()) problem(`negative control NOT caught: ${c.name}`);
}
console.log(`  controls: ${NEG.length} negative caught`);

if (failed) {
  console.log(`\npersontables: ${failed} FAILED`);
  process.exit(1);
}
console.log(`persontables: ok (${PERSON_TABLES.length} manifest entries)`);
