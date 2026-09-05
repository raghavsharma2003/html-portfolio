// WS-R70. THE CREATOR'S EXPORT COMPLETENESS BATTERY.
//
//   node evals/creator-export/run.mjs
//
// Two things this suite proves, offline, against the REAL modules:
//
//   1. COMPLETENESS. `api/_creator-export.js`'s `OWNER_LANE_TABLES` names
//      exactly the owner-lane subset of what `api/_replica-full-erasure.js`
//      reaches — every table that file deletes or updates BY NAME, minus
//      the follower-lane tables (`api/memory.js`'s `PERSON_TABLES`) and the
//      four deliberate, named gaps (erasure-process bookkeeping and
//      `vy_payment_event`, which carries no owning column at all). STATIC:
//      parses both real source files, never a hand-typed list of either.
//   2. THE BOUNDARY LAW. A real world with TWO owners, one of them also a
//      Room with a follower in it, driven through the real `creatorExport`.
//      Owner A's export carries Owner A's own rows in every scope, ZERO of
//      Owner B's, and — the law this whole workstream exists to prove —
//      ZERO follower-lane rows at all, even though the SAME room_id/
//      replica_id the export is scoped to also has a follower and a
//      conversation living right next to the data it does return.
//
// Offline, deterministic, $0, no DB, no network, no model call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadSchema } from "../sqlcast/schema.mjs";
import { PERSON_TABLES } from "../../api/memory.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const CE = await import(pathToFileURL(join(REPO, "api/_creator-export.js")).href);
const {
  OWNER_LANE_TABLES, OWNER_LANE_DELIBERATE_GAPS, MIXED_LANE_TABLES, creatorExport, creatorExportTableNames,
  followerLaneTableNames, scopedQuery,
} = CE;

// ═════════════════════════════════════════════════════════════════════════
// LAYER 1 — STATIC. Parse api/_replica-full-erasure.js's own source for
// every table it reaches by name; compute the owner-lane subset from the
// checked-in DDL (never a hand-typed list); assert OWNER_LANE_TABLES names
// exactly that set.
// ═════════════════════════════════════════════════════════════════════════
console.log("── layer 1: static (erasure reach vs OWNER_LANE_TABLES) ──");

const schema = loadSchema(REPO);
ok(`DDL parse found ${Object.keys(schema).length} tables (expected 100+)`, Object.keys(schema).length >= 100);

/** Every `vy_*`/`meera_*` table api/_replica-full-erasure.js's own source
 *  names in a `from`/`update` position, comments (both `//` and SQL `--`)
 *  stripped first so a comment quoting an old shape (ws-r32's own lesson:
 *  "a static check matched its own explanatory comment") cannot inflate
 *  the set. Pure function over TEXT, so the negative control below can run
 *  it against a deliberately altered copy without touching the real file. */
export function erasureReach(sourceText) {
  const stripped = sourceText.replace(/\/\/[^\n]*/g, "").replace(/--[^\n]*/g, "");
  const names = new Set();
  for (const m of stripped.matchAll(/\b(?:from|update)\s+(vy_[a-z_]+|meera_[a-z_]+)\b/g)) names.add(m[1]);
  return names;
}

/** The owner-lane subset of `reach`, computed from the checked-in DDL —
 *  carries `owner_user_id`, `replica_id` or `redeemed_by_user_id` (086's own
 *  migration header: "redeemed_by_user_id IS the replica owner's id once
 *  spent", `scripts/relcheck.mjs`'s own `OWNER_KEYS` restated) in
 *  `schemaMap`, OR is named in `aggExceptions` (the workstream brief's own
 *  carve-out for a content-free, never-verbatim aggregate scoped through a
 *  room/agent with no owning column of its own) — minus every
 *  `PERSON_TABLES` name (follower lane, however it is scoped in the erasure
 *  file's own WHERE clause) UNLESS it is in `mixedLane` (a table holding
 *  BOTH lanes behind a disjoint predicate, `api/_creator-export.js`'s own
 *  `MIXED_LANE_TABLES` header) — and minus `gaps` (the deliberate, named
 *  exclusions). Pure function so the negative controls below can drive it
 *  with a deliberately wrong input. */
export function ownerLaneSubset(reach, schemaMap, followerNames, gaps, aggExceptions, mixedLane) {
  const gapSet = new Set(gaps);
  const mixedSet = new Set(mixedLane);
  const out = new Set();
  for (const t of reach) {
    if ((followerNames.has(t) && !mixedSet.has(t)) || gapSet.has(t)) continue;
    const cols = schemaMap[t] || {};
    if ("owner_user_id" in cols || "replica_id" in cols || "redeemed_by_user_id" in cols || aggExceptions.has(t)) out.add(t);
  }
  return out;
}

// The workstream brief's own named exception ("Pulse counts and cohort
// counts are included because they are the creator's aggregate view") plus
// `vy_agent`, reached only by joining through this owner's own replicas'
// `agent_id` — neither carries an owning column of its own, and both are
// named once here rather than re-derived by the eval and by the module
// under test, which would just be two lists that could drift.
//
// The Room's per-day arrival-source counts (another table erasure reaches
// by name, content-free, no owning column) is DELIBERATELY absent from
// this set even though it would otherwise qualify on the identical
// "content-free aggregate" reasoning — api/_creator-export.js's own header
// explains why (a sibling gate, evals/room-leak/run.mjs, holds every reader
// of that table to a stricter "single rolled-up SQL aggregate, never a
// per-row dump" discipline that this export's generic `select *` shape
// cannot satisfy) — so it is correctly EXCLUDED from `expected` below by
// simply not being named here, on the same two-part test (no owning column,
// not in this exception set) every other correctly-excluded table fails.
const AGG_EXCEPTIONS = new Set([
  "vy_room_pulse_snapshot", "vy_room_pulse_combo", "vy_room_pulse_week",
  "vy_room_org_attachment", "vy_agent",
]);

const erasureSrc = readFileSync(join(REPO, "api/_replica-full-erasure.js"), "utf8");
const reach = erasureReach(erasureSrc);
ok(`erasure reach found a non-trivial set of tables (not vacuously empty)`, reach.size >= 40, `got ${reach.size}`);

const followerNames = followerLaneTableNames();
const expected = ownerLaneSubset(reach, schema, followerNames, OWNER_LANE_DELIBERATE_GAPS, AGG_EXCEPTIONS, MIXED_LANE_TABLES);
const manifestSet = new Set(creatorExportTableNames());

const missingFromManifest = [...expected].filter((t) => !manifestSet.has(t)).sort();
const extraInManifest = [...manifestSet].filter((t) => !expected.has(t)).sort();
ok("every owner-lane table the erasure file reaches is named by OWNER_LANE_TABLES",
  missingFromManifest.length === 0, missingFromManifest.join(","));
ok("OWNER_LANE_TABLES names nothing beyond what the erasure file's own owner-lane reach computes",
  extraInManifest.length === 0, extraInManifest.join(","));
ok("OWNER_LANE_TABLES carries no duplicate table name",
  manifestSet.size === OWNER_LANE_TABLES.length);

// A sanity floor against "the count matched by accident" — a handful of the
// workstream brief's own named examples, present by name.
const EXPECT_NAMED = [
  "vy_replica", "vy_replica_source", "vy_review_card", "vy_room_pulse_snapshot",
  "vy_creator_payout", "vy_org_member", "vy_creator_invite",
];
const missingNamed = EXPECT_NAMED.filter((t) => !manifestSet.has(t));
ok("every one of the workstream brief's own named examples is in OWNER_LANE_TABLES",
  missingNamed.length === 0, missingNamed.join(","));

// ═════════════════════════════════════════════════════════════════════════
// LAYER 1b — THE BOUNDARY LAW AS A STATIC SCAN. No follower-lane table
// (PERSON_TABLES) may ever appear in OWNER_LANE_TABLES.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 1b: static boundary scan (no follower-lane table in the manifest) ──");

/** The check itself, as a pure function over an arbitrary table-name array,
 *  so the negative control below can run it against a deliberately wrong
 *  input without touching a single real file. */
function boundaryViolations(tableNames, followerSet) {
  return tableNames.filter((t) => followerSet.has(t));
}

// `MIXED_LANE_TABLES` (vy_renewal_reminder) is the one sanctioned exception
// — see its own header in api/_creator-export.js — so it is excluded from
// THIS follower set, never from the one the negative control below uses.
const followerNamesExceptMixed = new Set([...followerNames].filter((t) => !MIXED_LANE_TABLES.includes(t)));
const realViolations = boundaryViolations(creatorExportTableNames(), followerNamesExceptMixed);
ok("the real OWNER_LANE_TABLES contains zero follower-lane tables (mixed-lane exceptions named and accounted for)",
  realViolations.length === 0, realViolations.join(","));

// Two tables that WOULD look owner-lane from api/_replica-full-erasure.js's
// WHERE clause alone (this file's own header explains why) — named
// explicitly, not merely swept up by the generic check above, since a
// regression here is exactly the mistake a careless read of that file's SQL
// would make.
ok("vy_room_thread is a follower-lane table (PERSON_TABLES), never owner-lane despite erasure's agent_id scoping",
  followerNames.has("vy_room_thread") && !manifestSet.has("vy_room_thread"));
ok("vy_room_follower is a follower-lane table (PERSON_TABLES), never owner-lane despite erasure's agent_id scoping",
  followerNames.has("vy_room_follower") && !manifestSet.has("vy_room_follower"));
ok("vy_room_subscription is a follower-lane table (PERSON_TABLES), never owner-lane despite erasure's room_id scoping",
  followerNames.has("vy_room_subscription") && !manifestSet.has("vy_room_subscription"));
ok("vy_room_handoff is excluded entirely (the one PERSON-lane table that holds a follower's own words)",
  followerNames.has("vy_room_handoff") && !manifestSet.has("vy_room_handoff"));

// NEGATIVE CONTROL (a): a follower-lane table named in a COPY of the
// manifest's table list must fail the static scan.
{
  const fakeList = [...creatorExportTableNames(), "vy_room_follower"];
  const violations = boundaryViolations(fakeList, followerNames);
  ok("NEGATIVE CONTROL (a): a follower-lane table added to a COPY of the manifest's table list is caught",
    violations.includes("vy_room_follower"),
    violations.includes("vy_room_follower") ? "" : "control did not fire - the boundary scan would have shipped a leak");
}

// NEGATIVE CONTROL (b): a table present in the erasure reach's owner-lane
// subset and ABSENT from a COPY of OWNER_LANE_TABLES must fail the
// completeness comparison — simulated by dropping a real entry from a copy
// of the expected set's own consumer, `missingFromManifest`'s own logic,
// rerun against a manifest missing one real table.
{
  const oneRealTable = [...expected][0];
  const shrunkManifest = new Set([...manifestSet].filter((t) => t !== oneRealTable));
  const missing = [...expected].filter((t) => !shrunkManifest.has(t));
  ok(`NEGATIVE CONTROL (b): a table (${oneRealTable}) present in erasure's owner-lane reach and absent from a COPY of the manifest is caught by the comparison`,
    missing.includes(oneRealTable),
    missing.includes(oneRealTable) ? "" : "control did not fire - the completeness comparison would have shipped a silent gap");
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 2 — DYNAMIC. Two owners, one of them a published Room with a real
// follower in it, through the REAL creatorExport.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 2: dynamic (two owners, a real follower, the real creatorExport) ──");

const OWNER_A = "a0000000-0000-4000-a000-00000000000a";
const OWNER_B = "b0000000-0000-4000-a000-00000000000b";
const REPLICA_A = "a0000000-0000-4000-a000-00000000001a";
const REPLICA_B = "b0000000-0000-4000-a000-00000000001b";
const AGENT_A = "a0000000-0000-4000-a000-00000000002a";
const AGENT_B = "b0000000-0000-4000-a000-00000000002b";
const ROOM_A = "a0000000-0000-4000-a000-00000000003a";
const ROOM_B = "b0000000-0000-4000-a000-00000000003b";
const FOLLOWER_TOKEN = "FOLLOWER_SECRET_ASK_zzzzzzzz";
const OWNER_TOKEN = "OWNER_SOURCE_zzzzzzzz";

/** A fully generic fake db over the exact seven WHERE shapes
 *  `scopedQuery()` ever produces, plus the two lookups `creatorExport`
 *  itself runs before the per-table loop. Generic rather than one matcher
 *  per table (44 of them) — the SEVEN shapes are the module's entire
 *  surface, and matching by shape rather than by table name is what lets
 *  this fixture cover every entry in `OWNER_LANE_TABLES` without hand
 *  writing 44 near-identical branches (ws-r27-unaliased-generic-export-
 *  select-untested-by-every-prior-suite's own lesson, taken the other way:
 *  a generic reader over the REAL statement shapes the module emits, not a
 *  stand-in that could silently diverge from what it actually sends). */
function fakeDb(state) {
  return async function db(sql, params) {
    if (/select replica_id, agent_id from vy_replica where owner_user_id = \$1::uuid/.test(sql)) {
      return (state.vy_replica || []).filter((r) => r.owner_user_id === params[0]);
    }
    if (/select room_id from vy_room where owner_user_id = \$1::uuid/.test(sql)) {
      return (state.vy_room || []).filter((r) => r.owner_user_id === params[0]).map((r) => ({ room_id: r.room_id }));
    }
    const m = sql.match(/^select \* from (\w+) where (.+?) limit 20000$/s);
    if (!m) throw new Error(`fakeDb: unrecognized query: ${sql}`);
    const [, table, clause] = m;
    const rows = state[table] || [];
    if (/^replica_id = any\(\$1::uuid\[\]\) and owner_user_id = \$2::uuid$/.test(clause)) {
      const [replicaIds, ownerUserId] = params;
      return rows.filter((r) => replicaIds.includes(r.replica_id) && r.owner_user_id === ownerUserId);
    }
    if (/^owner_user_id = \$1::uuid$/.test(clause)) {
      return rows.filter((r) => r.owner_user_id === params[0]);
    }
    if (/^redeemed_by_user_id = \$1::uuid$/.test(clause)) {
      return rows.filter((r) => r.redeemed_by_user_id === params[0]);
    }
    if (/^owner_user_id = \$1::uuid and room_id = any\(\$2::uuid\[\]\)$/.test(clause)) {
      const [ownerUserId, roomIds] = params;
      return rows.filter((r) => r.owner_user_id === ownerUserId && roomIds.includes(r.room_id));
    }
    if (/^room_id = any\(\$1::uuid\[\]\)$/.test(clause)) {
      const [roomIds] = params;
      return rows.filter((r) => roomIds.includes(r.room_id));
    }
    if (/^subject_kind = 'creator' and owner_user_id = \$1::uuid and replica_id = any\(\$2::uuid\[\]\)$/.test(clause)) {
      const [ownerUserId, replicaIds] = params;
      return rows.filter((r) => r.subject_kind === "creator" && r.owner_user_id === ownerUserId && replicaIds.includes(r.replica_id));
    }
    if (/^agent_id = any\(\$1::uuid\[\]\)$/.test(clause)) {
      const [agentIds] = params;
      return rows.filter((r) => agentIds.includes(r.agent_id));
    }
    throw new Error(`fakeDb: unrecognized WHERE shape for ${table}: ${clause}`);
  };
}

/** One representative row per scope shape `OWNER_LANE_TABLES` uses, for
 *  BOTH owners, plus one follower-lane row per PERSON_TABLES table this
 *  world touches — everything the boundary law exists to keep OUT. */
function seedWorld() {
  const state = {
    vy_replica: [
      { replica_id: REPLICA_A, owner_user_id: OWNER_A, agent_id: AGENT_A },
      { replica_id: REPLICA_B, owner_user_id: OWNER_B, agent_id: AGENT_B },
    ],
    vy_agent: [{ agent_id: AGENT_A, slug: "a" }, { agent_id: AGENT_B, slug: "b" }],
    vy_room: [
      { room_id: ROOM_A, replica_id: REPLICA_A, owner_user_id: OWNER_A },
      { room_id: ROOM_B, replica_id: REPLICA_B, owner_user_id: OWNER_B },
    ],
    // ── replica scope ──
    vy_replica_source: [
      { source_id: "s-a", replica_id: REPLICA_A, owner_user_id: OWNER_A, kind: "document",
        storage_bucket: "vyakti-private", object_path: "a/doc.pdf", byte_size: 4096, mime: "application/pdf",
        sha256: "a".repeat(64), body: OWNER_TOKEN },
      { source_id: "s-b", replica_id: REPLICA_B, owner_user_id: OWNER_B, kind: "document",
        storage_bucket: "vyakti-private", object_path: "b/doc.pdf", byte_size: 2048, mime: "application/pdf",
        sha256: "b".repeat(64) },
    ],
    vy_review_card: [
      { card_id: "rc-a", replica_id: REPLICA_A, owner_user_id: OWNER_A, prompt_text: "q" },
      { card_id: "rc-b", replica_id: REPLICA_B, owner_user_id: OWNER_B, prompt_text: "q" },
    ],
    // ── owner scope ──
    vy_creator_payout: [
      { payout_id: "p-a", owner_user_id: OWNER_A, gross_inr: 1000 },
      { payout_id: "p-b", owner_user_id: OWNER_B, gross_inr: 2000 },
    ],
    // ── invite_redeemed scope ──
    vy_creator_invite: [
      { invite_id: "i-a", redeemed_by_user_id: OWNER_A },
      { invite_id: "i-b", redeemed_by_user_id: OWNER_B },
    ],
    // ── room_owner scope ──
    vy_room_price: [
      { price_id: "pr-a", room_id: ROOM_A, owner_user_id: OWNER_A, follower_price_inr: 299 },
      { price_id: "pr-b", room_id: ROOM_B, owner_user_id: OWNER_B, follower_price_inr: 599 },
    ],
    // ── room_agg scope (no owner_user_id column at all) ──
    vy_room_pulse_snapshot: [
      { snapshot_id: "sn-a", room_id: ROOM_A, follower_count: 7 },
      { snapshot_id: "sn-b", room_id: ROOM_B, follower_count: 9 },
    ],
    // ── renewal_creator scope: BOTH lanes of the SAME table, same owner ──
    vy_renewal_reminder: [
      { reminder_id: "rr-a-creator", subject_kind: "creator", owner_user_id: OWNER_A, replica_id: REPLICA_A },
      { reminder_id: "rr-a-follower", subject_kind: "follower", room_id: ROOM_A, person_id: "person-a1" },
      { reminder_id: "rr-b-creator", subject_kind: "creator", owner_user_id: OWNER_B, replica_id: REPLICA_B },
    ],
    // ── follower-lane rows living right next to Owner A's own data, in the
    //    SAME room/replica the export above is scoped to — the exact shape
    //    the boundary law exists to keep out. ──
    vy_room_thread: [{ thread_id: "th-a", room_id: ROOM_A, person_id: "person-a1", agent_id: AGENT_A, title: "my own topic" }],
    vy_room_follower: [{ follower_id: "f-a", room_id: ROOM_A, person_id: "person-a1", agent_id: AGENT_A }],
    vy_room_subscription: [{ subscription_id: "sub-a", room_id: ROOM_A, person_id: "person-a1", follower_id: "f-a", state: "active" }],
    vy_fact: [{ id: 1, person_id: "person-a1", agent_id: AGENT_A, body: `note: ${FOLLOWER_TOKEN}` }],
    vy_room_handoff: [{ handoff_id: "h-a", room_id: ROOM_A, person_id: "person-a1", follower_id: "f-a", payload_text: FOLLOWER_TOKEN }],
  };
  return state;
}

const world = seedWorld();
const db = fakeDb(world);
const dump = await creatorExport(db, OWNER_A, { tableApplied: async () => true });

ok("format is the versioned creator-export shape", dump.format === "vyakti-creator-export/1");
ok("replicas names Owner A's own replica, never Owner B's", JSON.stringify(dump.replicas) === JSON.stringify([REPLICA_A]));
ok("owner_user_id is the caller's own id", dump.owner_user_id === OWNER_A);

ok("vy_replica_source carries Owner A's own row with the OWNER token",
  Array.isArray(dump.tables.vy_replica_source) && dump.tables.vy_replica_source.length === 1 &&
  dump.tables.vy_replica_source[0].body === OWNER_TOKEN);
ok("vy_review_card (replica scope) carries exactly Owner A's own row",
  dump.tables.vy_review_card?.length === 1 && dump.tables.vy_review_card[0].card_id === "rc-a");
ok("vy_creator_payout (owner scope) carries exactly Owner A's own row",
  dump.tables.vy_creator_payout?.length === 1 && dump.tables.vy_creator_payout[0].payout_id === "p-a");
ok("vy_creator_invite (invite_redeemed scope) carries exactly Owner A's own row",
  dump.tables.vy_creator_invite?.length === 1 && dump.tables.vy_creator_invite[0].invite_id === "i-a");
ok("vy_room_price (room_owner scope) carries exactly Owner A's own row",
  dump.tables.vy_room_price?.length === 1 && dump.tables.vy_room_price[0].price_id === "pr-a");
ok("vy_room_pulse_snapshot (room_agg scope) carries exactly Owner A's own row",
  dump.tables.vy_room_pulse_snapshot?.length === 1 && dump.tables.vy_room_pulse_snapshot[0].snapshot_id === "sn-a");
ok("vy_agent (agent scope, joined through this owner's own replica) carries exactly Owner A's own row",
  dump.tables.vy_agent?.length === 1 && dump.tables.vy_agent[0].agent_id === AGENT_A);

ok("vy_renewal_reminder carries ONLY the creator-subject row for this owner, never the follower-subject row in the SAME table",
  dump.tables.vy_renewal_reminder?.length === 1 && dump.tables.vy_renewal_reminder[0].reminder_id === "rr-a-creator");

ok("storage pointers are derived from vy_replica_source and carry a size, never a body",
  Array.isArray(dump.storage) && dump.storage.length === 1 &&
  dump.storage[0].byte_size === 4096 && !("body" in dump.storage[0]));

const dumpJson = JSON.stringify(dump);
ok("Owner B's payout amount never appears anywhere in Owner A's export", !dumpJson.includes("2000"));
ok("Owner B's replica id never appears anywhere in Owner A's export", !dumpJson.includes(REPLICA_B));
ok("Owner B's own source row id never appears anywhere in Owner A's export", !dumpJson.includes("s-b"));

// ── THE BOUNDARY LAW, dynamically. ──
const FOLLOWER_LANE_KEYS = ["vy_room_thread", "vy_room_follower", "vy_room_subscription", "vy_fact", "vy_room_handoff"];
const leaked = FOLLOWER_LANE_KEYS.filter((k) => k in dump.tables);
ok("ZERO follower-lane tables appear anywhere in the export's own tables object",
  leaked.length === 0, leaked.join(","));
ok("the follower's own secret ask never appears anywhere in the export, even serialized whole",
  !dumpJson.includes(FOLLOWER_TOKEN));
ok("the manifest itself names no follower-lane table (mixed-lane exceptions named and accounted for)",
  dump.manifest.every((m) => !followerNamesExceptMixed.has(m.table)));

// manifest counts are real, not phantom
const manifestByTable = Object.fromEntries(dump.manifest.map((m) => [m.table, m.rows]));
ok("the manifest's row count for vy_replica_source matches the real row count",
  manifestByTable.vy_replica_source === 1);
ok("the manifest's row count for a table with zero rows for this owner is honestly zero",
  manifestByTable.vy_replica_audit === 0);

// ═════════════════════════════════════════════════════════════════════════
// LAYER 3 — an owner with NO replica yet gets an honest, empty export, not
// a crash — `= any('{}'::uuid[])` over an empty array must match nothing.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 3: an owner with nothing yet ──");
{
  const emptyDump = await creatorExport(fakeDb({ vy_replica: [], vy_room: [] }), "c0000000-0000-4000-a000-00000000000c", {
    tableApplied: async () => true,
  });
  ok("an owner with no replica gets replicas: []", Array.isArray(emptyDump.replicas) && emptyDump.replicas.length === 0);
  ok("an owner with no replica gets an empty tables object, never a crash", Object.keys(emptyDump.tables).length === 0);
  ok("an owner with no replica gets zero storage pointers", emptyDump.storage.length === 0);
}

// ═════════════════════════════════════════════════════════════════════════
// LAYER 4 — the HTTP door is really wired: the op exists, gated by the
// rate scope this workstream adds, calling the real creatorExport with the
// authenticated user's OWN id, never a body-supplied one.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── layer 4: the door is wired (api/replica.js) ──");
{
  const src = readFileSync(join(REPO, "api/replica.js"), "utf8");
  ok('api/replica.js cases "export"', /body\.op === "export"/.test(src));
  ok("the export op is rate-limited through the creator_export_owner scope",
    /consume\(q, \{ scope: "creator_export_owner", key: user\.id \}\)/.test(src));
  ok("the export op calls the real creatorExport with the AUTHENTICATED user's own id, never a body field",
    /creatorExport\(q, user\.id\)/.test(src) && !/creatorExport\(q, body\./.test(src));
  const rateSrc = readFileSync(join(REPO, "api/_rate-limit.js"), "utf8");
  ok("the rate scope is one a day (24h window, limit 1)",
    /creator_export_owner:\s*\{\s*limit:\s*1,\s*windowMs:\s*24\s*\*\s*60\s*\*\s*60_000\s*\}/.test(rateSrc));
}

// ═════════════════════════════════════════════════════════════════════════
console.log(`\n── verdict ──`);
console.log(`  ${pass} passed, ${fail} failed`);
if (fail) {
  console.log("creator-export: FAILED");
  process.exit(1);
}
console.log("creator-export: ok");
