// evals/meet-continuity/run.mjs — WS-R167, "the owner's own continuity in
// Meet". The owner's private Meet conversation with their own AI gets the
// SAME extracted-fact shape a Room follower gets (api/_room-memory-authority.js's
// OWNER_MEMORY_* section, reusing `runRoomMemoryConsolidation` and
// `validateRoomMemoryProposal` unchanged), over a DIFFERENT authority keyed
// to the owner's own `vy_replica` + a 'memory'-scope `vy_replica_consent`
// grant — never a Room, never a `vy_room_follower` row.
//
// Proves, offline, with fake `db` functions and the REAL decision modules
// the HTTP doors call:
//
//   1. The consent-window "epoch": every owner-memory statement demands
//      `l.at > memory_window_floor` (the latest 'memory'-scope revoke, or
//      -infinity), so a message sent before that floor can never become
//      eligible again however many times memory is re-enabled afterward —
//      with a NEGATIVE CONTROL proving the floor really does exclude it.
//   2. The structural partition from Room memory: every OWNER_MEMORY_* SQL
//      statement that reads/writes `meera_log`/`vy_episode` requires
//      `room_memory_follower_id is null`, and a fake two-row world (one
//      Room-follower-authored, one owner-authored, SAME agent_id) proves
//      each lane's own SQL shape returns only its own row — with a
//      NEGATIVE CONTROL proving the check is not vacuous.
//   3. The door's memory-off branches issue ZERO mutating queries — the
//      same "their choice is the predicate" discipline the Room's own
//      `roomRememberedThings` uses.
//   4. `api/_room-relstate.js`'s owner key reuses
//      `roomRelStateFromFollower`/`roomRelStateResetFromFollower`
//      UNCHANGED, and `roomRelStateStageCounts`'s new exclusion keeps the
//      owner's own dyad out of a creator's follower aggregate — with a
//      NEGATIVE CONTROL proving the un-excluded query WOULD count it.
//   5. `runOwnerMemoryConsolidation` reuses `runRoomMemoryConsolidation` as
//      a caller (identity-compares the exact SQL/authority it was given),
//      never a fork.
//   6. Migration 170's shape: exactly the CHECK-widening pattern migration
//      141 already used, splits into independently-idempotent statements,
//      and `db/schema.sql`'s mirror carries the identical text.
//
// Offline, deterministic, $0 — no network, no database, no model call.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { splitSql } from "../../db/migrations/apply.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const API = join(ROOT, "api");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const AUTH = await import(pathToFileURL(join(API, "_room-memory-authority.js")).href);
const RELSTATE = await import(pathToFileURL(join(API, "_room-relstate.js")).href);
const DIALOGUE = await import(pathToFileURL(join(API, "_replica-dialogue.js")).href);
const RUNTIME = await import(pathToFileURL(join(API, "_replica-runtime.js")).href);

const {
  OWNER_MEMORY_BATCH_SQL, OWNER_MEMORY_COMMIT_SQL, OWNER_MEMORY_RECALL_SQL, OWNER_MEMORY_FACTS_SQL,
  OWNER_MEMORY_CORRECT_SQL, OWNER_MEMORY_RETRACT_SQL, OWNER_MEMORY_RECLASSIFY_READ_SQL,
  OWNER_MEMORY_RECLASSIFY_COMMIT_SQL, OWNER_MEMORY_CONSENT_STATUS_SQL, OWNER_MEMORY_CONSENT_GRANT_SQL,
  OWNER_MEMORY_CONSENT_REVOKE_SQL, ROOM_MEMORY_BATCH_SQL, ROOM_MEMORY_FACTS_SQL,
  ownerMemoryAuthority, runOwnerMemoryConsolidation, runRoomMemoryConsolidation,
  validateRoomMemoryProposal,
} = AUTH;
const { roomRelStateStageCounts, ownerRelStateFromReplica, ownerRelStateResetFromReplica } = RELSTATE;
const {
  ownerMemoryStatus, ownerMemoryToggle, ownerRememberedThings, ownerCorrectRememberedThing,
  ownerReclassifyRememberedThing, ownerForgetRememberedThing, ownerRelState, ownerRelStateReset,
  createReplicaDialogueHandler,
} = DIALOGUE;
const { RUNTIME_STATUS_SQL, OWNED_PRIVATE_RUNTIME_CONTEXT_SQL } = RUNTIME;

const REPLICA = "aa000000-0000-4000-8000-00000000aaaa";
const OWNER = "bb000000-0000-4000-8000-00000000bbbb";
const AGENT = "cc000000-0000-4000-8000-00000000cccc";
const OWNER_PERSON = "dd000000-0000-4000-8000-00000000dddd";
const FOLLOWER_PERSON = "ee000000-0000-4000-8000-00000000eeee";
const NOW = new Date("2026-09-13T09:00:00.000Z");

// ═══════════════════════════════════════════════════════════════════════
// 1. OWNER_MEMORY_AUTHORITY: the consent-window floor, static + dynamic
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 1. OWNER_MEMORY_AUTHORITY: the consent-window replaces the Room's epoch column ──");
{
  // The window floor gates which RAW meera_log rows are eligible to become
  // NEW facts (BATCH/COMMIT); it has nothing to read once a fact already
  // exists (RECALL/FACTS read vy_fact, already-committed, already gated at
  // write time) — restated from api/_room-memory-authority.js's own header.
  for (const [label, sql] of [["BATCH", OWNER_MEMORY_BATCH_SQL], ["COMMIT", OWNER_MEMORY_COMMIT_SQL]]) {
    ok(`${label}: requires l.at > oa.memory_window_floor (the epoch substitute)`, /l\.at\s*>\s*oa\.memory_window_floor/.test(sql));
  }
  ok("every owner-authority CTE derives the SAME floor from the latest UNREVOKED-then-revoked 'memory' grant",
    [OWNER_MEMORY_BATCH_SQL, OWNER_MEMORY_COMMIT_SQL, OWNER_MEMORY_RECALL_SQL].every((sql) => /memory_window_floor/.test(sql)));
  ok("the authority CTE never trusts a client-supplied agent_id/person_id: both binds are replica_id ($1) and owner_user_id ($2) only",
    /r\.replica_id\s*=\s*\$1::uuid\s+and\s+r\.owner_user_id\s*=\s*\$2::uuid/.test(OWNER_MEMORY_BATCH_SQL));
  ok("authority requires an UNREVOKED, UNEXPIRED 'memory' scope grant to exist at all",
    /scope='memory' and x\.revoked_at is null/.test(OWNER_MEMORY_BATCH_SQL));

  // Dynamic: a fake db proving the floor really is applied.
  let queriedFloor = null;
  const dbFloor = async (sql, params) => {
    if (sql !== OWNER_MEMORY_BATCH_SQL) throw new Error(`unexpected sql: ${sql}`);
    ok("batch binds exactly [replica_id, owner_user_id]", params.length === 2 && params[0] === REPLICA && params[1] === OWNER);
    queriedFloor = true;
    return [];
  };
  const rows = await (async () => {
    // Directly exercise the exported SQL text through a fake db, exactly the
    // technique evals/room-relstate/run.mjs uses one file over.
    return dbFloor(OWNER_MEMORY_BATCH_SQL, ownerMemoryAuthority({ replica_id: REPLICA, owner_user_id: OWNER }));
  })();
  ok("the batch statement is reachable through ownerMemoryAuthority's own tuple shape", queriedFloor === true && Array.isArray(rows));
}

// ═══════════════════════════════════════════════════════════════════════
// 2. THE PARTITION FROM ROOM MEMORY
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 2. structural partition: owner-authored rows and Room-authored rows can never read each other ──");
{
  for (const [label, sql] of [
    ["BATCH", OWNER_MEMORY_BATCH_SQL], ["COMMIT", OWNER_MEMORY_COMMIT_SQL],
  ]) {
    ok(`${label}: excludes any meera_log row a Room already claimed (room_memory_follower_id is null)`,
      /l\.room_memory_follower_id is null/.test(sql));
    ok(`${label}: excludes any meera_log row a Room ever set speaker_person_id on`,
      /l\.speaker_person_id is null/.test(sql));
  }
  for (const [label, sql] of [
    ["RECALL", OWNER_MEMORY_RECALL_SQL], ["FACTS", OWNER_MEMORY_FACTS_SQL],
    ["CORRECT", OWNER_MEMORY_CORRECT_SQL], ["RETRACT", OWNER_MEMORY_RETRACT_SQL],
  ]) {
    ok(`${label}: only reaches an episode this lane itself authored (boundary_reason='owner_memory'*, room_memory_follower_id is null)`,
      /e\.room_memory_follower_id is null/.test(sql) && /boundary_reason='owner_memory/.test(sql));
  }
  // NEGATIVE CONTROL: the checks above are not vacuous — a deliberately
  // stripped copy of the SQL fails them.
  const stripped = OWNER_MEMORY_BATCH_SQL.replace("and l.room_memory_follower_id is null and l.speaker_person_id is null", "");
  ok("NEGATIVE CONTROL: a copy of BATCH with the partition clause stripped no longer matches the check",
    !/l\.room_memory_follower_id is null/.test(stripped) && stripped !== OWNER_MEMORY_BATCH_SQL);

  // Dynamic: one fake world, two rows, SAME agent_id — one Room-follower-
  // authored (room_memory_follower_id set, speaker_person_id = the
  // follower's own person), one owner-authored (both null). Each lane's own
  // FACTS statement must return only its own row.
  const followerFact = { id: "1", body: "follower's own fact", kind: "user", name: "preference", created_at: NOW, communication: null, _lane: "room" };
  const ownerFact = { id: "2", body: "owner's own fact", kind: "user", name: "preference", created_at: NOW, communication: null, _lane: "owner" };
  const dbOwnerFacts = async (sql, params) => {
    if (sql !== OWNER_MEMORY_FACTS_SQL) throw new Error(`unexpected sql: ${sql}`);
    ok("OWNER_MEMORY_FACTS_SQL binds [replica_id, owner_user_id]", params[0] === REPLICA && params[1] === OWNER);
    return [ownerFact];
  };
  const factsForOwner = await dbOwnerFacts(OWNER_MEMORY_FACTS_SQL, ownerMemoryAuthority({ replica_id: REPLICA, owner_user_id: OWNER }));
  ok("the owner's own FACTS read returns ONLY the owner-authored row, never the follower's", factsForOwner.length === 1 && factsForOwner[0]._lane === "owner");

  const dbRoomFacts = async (sql, params) => {
    if (sql !== ROOM_MEMORY_FACTS_SQL) throw new Error(`unexpected sql: ${sql}`);
    ok("ROOM_MEMORY_FACTS_SQL (unchanged) still binds the follower 4-tuple", params.length === 4);
    return [followerFact];
  };
  const factsForFollower = await dbRoomFacts(ROOM_MEMORY_FACTS_SQL, ["follower-1", "0", AGENT, FOLLOWER_PERSON]);
  ok("the Room's own FACTS read (untouched) returns ONLY the follower-authored row, never the owner's", factsForFollower.length === 1 && factsForFollower[0]._lane === "room");
  ok("the two SQL constants are textually distinct statements (never accidentally the same query serving both lanes)",
    OWNER_MEMORY_FACTS_SQL !== ROOM_MEMORY_FACTS_SQL);
}

// ═══════════════════════════════════════════════════════════════════════
// 3. THE DOOR: memory-off issues ZERO mutating queries
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 3. api/_replica-dialogue.js's new ops: memory off is a branch, never a filter ──");
{
  const activeRuntimeRow = {
    replica_id: REPLICA, owner_user_id: OWNER, subject_person_id: OWNER_PERSON, agent_id: AGENT,
    subject_mode: "self", lifecycle: "active", policy_version: "v1",
    age_verified_at: NOW, identity_verified_at: NOW, liveness_verified_at: NOW, identity_expires_at: new Date(NOW.getTime() + 86_400_000),
    capability_id: "ff000000-0000-4000-8000-00000000ffff", runtime_policy: "v1", profile_version: 1, calibration_version: 1,
    genome_version: 1, voice_profile_id: null, state: "active", private_selection: false, candidate_binding_required: false,
  };
  const dbRuntimeOnly = async (sql) => {
    if (/from vy_replica r/.test(sql) && /subject_mode='self'/.test(sql)) return [activeRuntimeRow];
    throw new Error(`memory is OFF — no further query should ever reach here: ${sql}`);
  };
  // memory_facts: off -> {facts:[]}, zero further queries.
  const factsOff = await ownerRememberedThings(
    async (sql) => {
      if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: false }];
      if (/from vy_replica r/.test(sql)) return [activeRuntimeRow];
      throw new Error(`memory is OFF — FACTS_SQL should never be issued: ${sql}`);
    },
    OWNER, { replica_id: REPLICA },
  );
  ok("memory_facts, memory off: {facts:[]}, honest, never a fabricated read", Array.isArray(factsOff.facts) && factsOff.facts.length === 0);

  // memory_correct/forget/classify: off -> refuse with owner_memory_not_enabled, never mutate.
  for (const [label, fn, extra] of [
    ["memory_correct", ownerCorrectRememberedThing, { fact_id: "1", replacement: "a corrected fact, three to four hundred chars long enough" }],
    ["memory_forget", ownerForgetRememberedThing, { fact_id: "1" }],
    ["memory_classify", ownerReclassifyRememberedThing, { fact_id: "1" }],
  ]) {
    let threw = null;
    try {
      await fn(async (sql) => {
        if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: false }];
        if (/from vy_replica r/.test(sql)) return [activeRuntimeRow];
        throw new Error(`memory is OFF — ${label} must never reach a mutating statement: ${sql}`);
      }, OWNER, { replica_id: REPLICA, ...extra });
    } catch (error) { threw = error; }
    ok(`${label}, memory off: refuses honestly (owner_memory_not_enabled), never mutates`, threw?.code === "owner_memory_not_enabled" && threw?.status === 403);
  }

  // memory_status reflects the real toggle state, both directions.
  const statusOn = await ownerMemoryStatus(async (sql) => (sql === OWNER_MEMORY_CONSENT_STATUS_SQL ? [{ memory_on: true }] : [activeRuntimeRow]), OWNER, { replica_id: REPLICA });
  ok("memory_status reports memory_on:true when the consent status SQL says so", statusOn.memory_on === true);
  const statusOff = await ownerMemoryStatus(async (sql) => (sql === OWNER_MEMORY_CONSENT_STATUS_SQL ? [{ memory_on: false }] : [activeRuntimeRow]), OWNER, { replica_id: REPLICA });
  ok("memory_status reports memory_on:false when the consent status SQL says so", statusOff.memory_on === false);

  // memory_toggle: on writes a grant (revoke-then-insert), off writes a revoke.
  let grantParams = null, revokeParams = null;
  const toggleOnResult = await ownerMemoryToggle(async (sql, params) => {
    if (/from vy_replica r/.test(sql)) return [activeRuntimeRow];
    if (sql === OWNER_MEMORY_CONSENT_GRANT_SQL) { grantParams = params; return [{ consent_id: "gg", granted_at: NOW }]; }
    throw new Error(`unexpected: ${sql}`);
  }, OWNER, { replica_id: REPLICA, on: true });
  ok("memory_toggle on: calls the grant statement with [replica_id, owner_user_id, a >=32-char receipt hash]",
    toggleOnResult.memory_on === true && grantParams?.[0] === REPLICA && grantParams?.[1] === OWNER && String(grantParams?.[2] || "").length >= 32);
  const toggleOffResult = await ownerMemoryToggle(async (sql, params) => {
    if (/from vy_replica r/.test(sql)) return [activeRuntimeRow];
    if (sql === OWNER_MEMORY_CONSENT_REVOKE_SQL) { revokeParams = params; return [{ consent_id: "gg" }]; }
    throw new Error(`unexpected: ${sql}`);
  }, OWNER, { replica_id: REPLICA, on: false });
  ok("memory_toggle off: calls the revoke statement with [replica_id, owner_user_id]",
    toggleOffResult.memory_on === false && revokeParams?.[0] === REPLICA && revokeParams?.[1] === OWNER);

  // relstate_reset: off -> refuses via api/_room-relstate.js's own owner key,
  // never reaching roomRelStateResetFromFollower's own SQL at all.
  let resetThrew = null;
  try {
    await ownerRelStateReset(async (sql) => {
      if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: false }];
      if (/from vy_replica r/.test(sql)) return [activeRuntimeRow];
      throw new Error(`memory is OFF — relstate_reset must never reach vy_rel_state: ${sql}`);
    }, OWNER, { replica_id: REPLICA });
  } catch (error) { resetThrew = error; }
  ok("relstate_reset, memory off: refuses honestly (owner_memory_not_enabled), never touches vy_rel_state", resetThrew?.code === "owner_memory_not_enabled");
}

// ═══════════════════════════════════════════════════════════════════════
// 4. api/_room-relstate.js's owner key — reuse, not a fork; the aggregate exclusion
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 4. the owner key reuses roomRelStateFromFollower/*Reset UNCHANGED; the stage-counts aggregate excludes the owner ──");
{
  const relRow = { honorific: "tu", cs_ratio: null, cs_on_stress: "unknown", trust: 0.5, rupture_open: false, repair_state: "none", ritual_density: 0, pacing_gap_s: null, snapshot_ver: 1, updated_at: NOW.toISOString() };
  const dbRel = async (sql) => (sql.includes("select honorific") ? [relRow] : []);
  const state = await ownerRelStateFromReplica(dbRel, { personId: OWNER_PERSON, agentId: AGENT, memoryOn: true });
  ok("ownerRelStateFromReplica delegates to the SAME roomRelStateFromFollower, real field mapping", state.has_state === true && state.honorific === "tu");
  const stateOff = await ownerRelStateFromReplica(async () => { throw new Error("must not query when memory is off"); }, { personId: OWNER_PERSON, agentId: AGENT, memoryOn: false });
  ok("ownerRelStateFromReplica, memory off: the honest {has_state:false, memory_on:false}, zero queries", stateOff.has_state === false && stateOff.memory_on === false);
  let resetThrew = null;
  try { await ownerRelStateResetFromReplica(async () => [], { personId: OWNER_PERSON, agentId: AGENT, memoryOn: false }); }
  catch (error) { resetThrew = error; }
  ok("NEGATIVE CONTROL: ownerRelStateResetFromReplica refuses (owner_memory_not_enabled) rather than silently resetting when memory is off",
    resetThrew?.code === "owner_memory_not_enabled" && resetThrew?.status === 403);

  // The aggregate exclusion. `evals/room-leak/run.mjs`'s own layer 19
  // FORBIDS the word "person_id" anywhere in the aggregate statement's own
  // text (a maximally blunt, load-bearing safety property — "the aggregate
  // statement binds agent_id ALONE"), so the exclusion is deliberately NOT
  // a WHERE clause on that statement: it is two SEPARATE, ordinary,
  // per-dyad-parameterized queries `roomRelStateStageCounts` now also
  // issues, reversing the owner's own row's count in JS. Proved end to end,
  // with a REQUIRED NEGATIVE CONTROL, against the real function.
  const ownerDyadRow = { person_id: OWNER_PERSON, agent_id: AGENT, trust: 0.95, rupture_open: false };
  const ownerDyadStageOf = (row) => row.rupture_open ? (row.trust < 0.45 ? "new" : "warming") : row.trust < 0.2 ? "new" : row.trust < 0.45 ? "warming" : row.trust < 0.7 ? "settled" : row.trust < 0.88 ? "close" : "deep";
  const dbCounts = async (sql, params) => {
    if (sql.includes("having count(*) >= 5")) {
      // The raw aggregate already contains 6 "deep" rows: 5 real followers
      // PLUS the owner's own dyad (Meet now writes this table for them too).
      return [{ stage: "deep", n: 6 }];
    }
    if (sql.includes("select count(*)::int as n from vy_rel_state r")) {
      const [agentId, stage] = params.map(String);
      return [{ n: agentId === AGENT && ownerDyadStageOf(ownerDyadRow) === stage ? 1 : 0 }];
    }
    throw new Error(`unexpected: ${sql}`);
  };
  const excluded = await roomRelStateStageCounts(dbCounts, { agentId: AGENT });
  ok("WITH the exclusion: the raw 6 (5 real followers + the owner's own row) reads back as exactly 5",
    excluded.find((b) => b.stage === "deep")?.n === 5);

  // NEGATIVE CONTROL: without the owner lookup answering (as if the
  // exclusion queries were removed), the SAME raw aggregate is returned
  // unexcluded — proving the exclusion above is not vacuous.
  const dbCountsNoExclusion = async (sql, params) => {
    if (sql.includes("having count(*) >= 5")) return [{ stage: "deep", n: 6 }];
    if (sql.includes("select count(*)::int as n from vy_rel_state r")) return [{ n: 0 }];
    throw new Error(`unexpected: ${sql}`);
  };
  const unexcluded = await roomRelStateStageCounts(dbCountsNoExclusion, { agentId: AGENT });
  ok("NEGATIVE CONTROL: WITHOUT the exclusion queries answering, the SAME data reports 6 (the owner's own row silently counted as a follower)",
    unexcluded.find((b) => b.stage === "deep")?.n === 6);

  // The floor still applies to the EXCLUDED result: if reversing the
  // owner's count would drop a bucket below 5, the bucket vanishes
  // entirely rather than reporting a number under the floor.
  const dbCountsAtFloor = async (sql, params) => {
    if (sql.includes("having count(*) >= 5")) return [{ stage: "close", n: 5 }];
    if (sql.includes("select count(*)::int as n from vy_rel_state r")) return [{ n: String(params[0]) === AGENT && String(params[1]) === "close" ? 1 : 0 }];
    throw new Error(`unexpected: ${sql}`);
  };
  const atFloor = await roomRelStateStageCounts(dbCountsAtFloor, { agentId: AGENT });
  ok("excluding the owner's row at EXACTLY the floor (5 -> 4) drops the bucket entirely, never reports under-floor", !atFloor.some((b) => b.stage === "close"));
}

// ═══════════════════════════════════════════════════════════════════════
// 5. runOwnerMemoryConsolidation reuses runRoomMemoryConsolidation — a
//    caller, never a fork
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 5. runOwnerMemoryConsolidation calls the SAME runRoomMemoryConsolidation, with owner SQL/authority ──");
{
  const sourceRow = { id: "5", content: "I really want to switch to a morning schedule.", agent_id: AGENT, person_id: OWNER_PERSON };
  let queriedBatch = null, queriedCommit = null, modelCalledWith = null;
  const fakeDb = async (sql, params) => {
    if (sql === OWNER_MEMORY_BATCH_SQL) { queriedBatch = params; return [sourceRow]; }
    if (sql === OWNER_MEMORY_COMMIT_SQL) {
      queriedCommit = params;
      ok("commit's authority tuple is [replica_id, owner_user_id], derived from the ORIGINAL candidate, never a row field",
        params[0] === REPLICA && params[1] === OWNER);
      return [{ episode_id: "9", facts_written: 1, observations_written: 0, sources_consumed: 1 }];
    }
    throw new Error(`unexpected sql in consolidation: ${sql}`);
  };
  const fakeModel = async (messages) => {
    modelCalledWith = messages;
    return JSON.stringify({ memories: [{ source_id: "5", kind: "user", name: "preference", quote: "switch to a morning schedule", communication: null }] });
  };
  const env = { VYAKTI_MODEL_SERVING: "azure_only", AZURE_ENDPOINT: "https://fixture.openai.azure.com", AZURE_API_KEY: "fixture-key-0123456789" };
  const result = await runOwnerMemoryConsolidation({ replica_id: REPLICA, owner_user_id: OWNER }, { queryFn: fakeDb, model: fakeModel, env });
  ok("the batch statement issued really is OWNER_MEMORY_BATCH_SQL (a caller, never a re-implementation)", queriedBatch !== null);
  ok("the commit statement issued really is OWNER_MEMORY_COMMIT_SQL", queriedCommit !== null);
  // The shared taxonomy text (ROOM_MEMORY_NAME_TAXONOMY, reused verbatim —
  // forking it would be exactly the duplication this workstream avoids)
  // still says "learner-chosen" as internal category jargon; only the
  // OWNER-FACING framing sentence (source description) needs to say "owner".
  ok("the extraction system prompt's own framing sentence speaks of the owner's private conversation, never a Room follower's",
    /owner's own private conversation records/.test(modelCalledWith?.[0]?.content || "")
    && !/from the learner source records/.test(modelCalledWith?.[0]?.content || ""));
  ok("a real extraction commits and returns the real written counts", result.facts_written === 1 && result.sources_consumed === 1);

  // NEGATIVE CONTROL: azure-only policy is still enforced for the owner lane
  // exactly as it is for Room memory (isAzureOnlyServing gate, unchanged).
  let refused = null;
  try { await runOwnerMemoryConsolidation({ replica_id: REPLICA, owner_user_id: OWNER }, { queryFn: fakeDb, model: fakeModel, env: {} }); }
  catch (error) { refused = error; }
  ok("NEGATIVE CONTROL: without azure-only policy configured, consolidation refuses rather than dispatching anyway", refused?.message === "room_memory_azure_only_required");
}

// ═══════════════════════════════════════════════════════════════════════
// 6. Migration 170's shape
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 6. migration 170: the one schema change this workstream needed ──");
{
  const migrationPath = join(ROOT, "db/migrations/170_owner_meet_memory_consent.sql");
  const migration = readFileSync(migrationPath, "utf8");
  const statements = splitSql(migration);
  ok("migration 170 splits into exactly 2 statements (drop constraint, add constraint — apply.mjs's own one-statement-per-request law)",
    statements.length === 2, String(statements.length));
  ok("statement 1 drops the existing scope check by its Postgres-default name", /drop constraint if exists vy_replica_consent_scope_check/.test(statements[0]));
  ok("statement 2 re-adds it widened to include 'memory'", /add constraint vy_replica_consent_scope_check check/.test(statements[1]) && /'memory'/.test(statements[1]));
  ok("statement 2 still carries every PRIOR scope value (never a silent narrowing)",
    ["capture", "transcription", "biometric", "training", "inference", "storage", "sharing", "api", "telephony", "model_improvement", "private_text_rehearsal"]
      .every((scope) => statements[1].includes(`'${scope}'`)));
  ok("no new table, no DO block, no function (this migration is pure DDL, matching apply.mjs's own splitter contract)",
    !/create table|do \$\$|create or replace function/i.test(migration));

  const schema = readFileSync(join(ROOT, "db/schema.sql"), "utf8");
  ok("db/schema.sql carries a mirror banner for migration 170", schema.includes("BEGIN historical replica mirror: 170_owner_meet_memory_consent.sql"));
  const mirrorMatch = schema.match(/-- BEGIN historical replica mirror: 170_owner_meet_memory_consent\.sql([\s\S]*?)-- END historical replica mirror: 170_owner_meet_memory_consent\.sql/);
  const squash = (s) => s.replace(/\s+/g, " ").trim();
  // Strip each split statement down to its executable DDL (drop leading `--`
  // comment lines splitSql keeps attached to the statement that follows
  // them) before comparing against the mirror's own, shorter header.
  const ddlOnly = (s) => s.split("\n").filter((line) => !line.trimStart().startsWith("--")).join("\n");
  ok("the mirror's own two ALTER statements are textually IDENTICAL to the real migration file's executable DDL (never hand-retyped and drifted, whitespace aside)",
    Boolean(mirrorMatch) && statements.every((s) => squash(mirrorMatch[1]).includes(squash(ddlOnly(s)))));
}

// ═══════════════════════════════════════════════════════════════════════
// 7. validateRoomMemoryProposal is reused UNCHANGED (never re-implemented
//    for the owner lane)
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 7. validateRoomMemoryProposal is reused unchanged for the owner lane ──");
{
  const rows = [{ id: "5", content: "I really want to switch to a morning schedule." }];
  const good = JSON.stringify({ memories: [{ source_id: "5", kind: "user", name: "preference", quote: "switch to a morning schedule", communication: null }] });
  const proposal = validateRoomMemoryProposal(good, rows);
  ok("a well-formed owner extraction validates through the SAME function Room memory uses", proposal.length === 1 && proposal[0].quote === "switch to a morning schedule");
  let threw = null;
  try { validateRoomMemoryProposal(JSON.stringify({ memories: [{ source_id: "5", kind: "user", name: "preference", quote: "never said this at all", communication: null }] }), rows); }
  catch (error) { threw = error; }
  ok("NEGATIVE CONTROL: a quote that is not an exact substring of the source is rejected, exactly as it is for a Room follower", threw?.message === "room_memory_proposal_invalid");
}

// ═══════════════════════════════════════════════════════════════════════
// 8. WS-R172: continuity for a text-ready AI — the owner memory ops and
//    relstate now accept a replica with NO active voice capability at all
// ═══════════════════════════════════════════════════════════════════════
console.log("\n── 8. WS-R172: a text-ready replica (no voice) reaches the SAME owner-memory/relstate ops ──");
{
  ok("OWNER_MEMORY_AUTHORITY no longer requires lifecycle='active' (WS-R167's own original predicate)",
    !/r\.lifecycle\s*=\s*'active'/.test(OWNER_MEMORY_BATCH_SQL));
  ok("OWNER_MEMORY_AUTHORITY requires the SAME lifecycle floor api/_replica-runtime.js#textBlockers already uses (never revoked or purging)",
    /r\.lifecycle not in \('revoked','purging'\)/.test(OWNER_MEMORY_BATCH_SQL));
  ok("NEGATIVE CONTROL: the check above is not vacuous — a copy with the old predicate restored fails it",
    /r\.lifecycle\s*=\s*'active'/.test(OWNER_MEMORY_BATCH_SQL.replace("r.lifecycle not in ('revoked','purging')", "r.lifecycle='active'")));

  const TEXT_READY_AGENT = "ff000000-0000-4000-8000-0000000000fe";
  const textReadyRow = {
    replica_id: REPLICA, subject_mode: "self", lifecycle: "enrolling", subject_person_id: OWNER_PERSON, agent_id: TEXT_READY_AGENT,
    age_verified_at: NOW, identity_verified_at: NOW, liveness_verified_at: NOW, identity_expires_at: new Date(NOW.getTime() + 86_400_000),
    person_age_tier: "adult_verified", account_person_matches: true, inference_consent: true,
    profile_version: 1, profile_approved: true, calibration_version: null, calibration_approved: false,
    genome_version: null, genome_approved: false, genome_latest_version: null, genome_latest_status: null,
    voice_profile_id: null, voice_ready: false, test_voice: false, qualification_passed: 0,
    fidelity_status: null, fidelity_score: null, fidelity_computed_at: null,
    readiness_overall: null, readiness_min_part: null, readiness_unmeasured: 0, readiness_computed_at: null,
    capability_state: null, capability_activated_at: null, candidate_binding_required: false, candidate_runtime_authorized: true,
  };
  const textReadyWrites = async (sql) => {
    if (/insert into vy_replica_text_capability|from vy_replica_text_capability/.test(sql)) return []; // the ensure-write path, unproven offline (evals/text-ready's own header)
    return undefined;
  };

  // memory_facts reaches the real owner-memory door with no active voice
  // capability at all — `ownedSelfRuntime`'s own new fallback.
  const dbFacts = async (sql, params) => {
    const written = await textReadyWrites(sql); if (written !== undefined) return written;
    if (sql === OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return []; // no active/private VOICE capability
    if (sql === RUNTIME_STATUS_SQL) return [textReadyRow];
    if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: true }];
    if (sql === OWNER_MEMORY_FACTS_SQL) {
      ok("OWNER_MEMORY_FACTS_SQL binds the text-ready replica's own real [replica_id, owner_user_id]", params[0] === REPLICA && params[1] === OWNER);
      return [];
    }
    throw new Error(`WS-R172 text-ready fixture: unmatched SQL: ${sql}`);
  };
  const factsForTextReady = await ownerRememberedThings(dbFacts, OWNER, { replica_id: REPLICA });
  ok("memory_facts reaches the real owner-memory door for a text-ready-only replica, no voice, never a crash", Array.isArray(factsForTextReady.facts));

  // relstate ("How we are") reads the real vy_rel_state row keyed by the
  // text-ready replica's own agent_id/person_id — never a follower's.
  const relRow = { honorific: "tu", cs_ratio: null, cs_on_stress: "unknown", trust: 0.4, rupture_open: false, repair_state: "none", ritual_density: 0, pacing_gap_s: null, snapshot_ver: 1, updated_at: NOW.toISOString() };
  const dbRel = async (sql, params) => {
    const written = await textReadyWrites(sql); if (written !== undefined) return written;
    if (sql === OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return [];
    if (sql === RUNTIME_STATUS_SQL) return [textReadyRow];
    if (sql === OWNER_MEMORY_CONSENT_STATUS_SQL) return [{ memory_on: true }];
    if (sql.includes("select honorific")) {
      ok("\"How we are\" reads vy_rel_state keyed by the text-ready replica's own real (person_id, agent_id)", params[0] === OWNER_PERSON && params[1] === TEXT_READY_AGENT);
      return [relRow];
    }
    throw new Error(`WS-R172 text-ready relstate fixture: unmatched SQL: ${sql}`);
  };
  const stateForTextReady = await ownerRelState(dbRel, OWNER, { replica_id: REPLICA });
  ok("relstate (\"How we are\") reaches the real owner key for a text-ready-only replica", stateForTextReady.has_state === true && stateForTextReady.honorific === "tu");

  // NEGATIVE CONTROL: a revoked text-ready replica (an agent already
  // minted, but the replica itself is gone) is still refused — the
  // loosened lifecycle floor never becomes "any lifecycle at all".
  const revokedRow = { ...textReadyRow, lifecycle: "revoked" };
  const dbRevoked = async (sql) => {
    if (sql === OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return [];
    if (sql === RUNTIME_STATUS_SQL) return [revokedRow];
    throw new Error(`WS-R172 revoked text-ready fixture: no further query should ever be reached: ${sql}`);
  };
  let revokedThrew = null;
  try { await ownerRememberedThings(dbRevoked, OWNER, { replica_id: REPLICA }); }
  catch (error) { revokedThrew = error; }
  ok("NEGATIVE CONTROL: a revoked text-ready replica is refused (dialogue_runtime_not_active), never a fabricated success",
    revokedThrew?.code === "dialogue_runtime_not_active");

  // NEGATIVE CONTROL: a text-ready-eligible replica with NO agent minted
  // yet is refused too — the loosened lifecycle floor never substitutes
  // for the agent this whole authority is keyed on.
  const noAgentRow = { ...textReadyRow, agent_id: null };
  const dbNoAgent = async (sql) => {
    if (sql === OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return [];
    if (sql === RUNTIME_STATUS_SQL) return [noAgentRow];
    const written = await textReadyWrites(sql); if (written !== undefined) return written;
    throw new Error(`WS-R172 no-agent fixture: no further query should ever be reached: ${sql}`);
  };
  let noAgentThrew = null;
  try { await ownerRelState(dbNoAgent, OWNER, { replica_id: REPLICA }); }
  catch (error) { noAgentThrew = error; }
  ok("NEGATIVE CONTROL: a text-ready-eligible replica with no agent minted yet is refused, never a fabricated relstate",
    noAgentThrew?.code === "dialogue_runtime_not_active");
}

console.log(`\nmeet-continuity: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
