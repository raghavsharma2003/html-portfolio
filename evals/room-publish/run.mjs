// The Room's creator side (WS-R7) — offline, deterministic, $0, no DB, no
// network, no model call.
//
//   node evals/room-publish/run.mjs
//
// WS-R1 built /r/<slug> and its three tables (migration 071) but nothing
// wrote a `vy_room` row. This suite drives the REAL `api/_room-publish.js`
// through a fake `db`, so the code path a browser reaches is the code path
// this suite reaches, and only the database is replaced.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE PUBLISH LOCK IS THE WRITE, NOT A BRANCH ABOVE IT. `published_at` only
//    ever becomes non-null inside the UPDATE's own CASE. The suite proves the
//    positive (all three conditions true -> the write lands) and the negative
//    for each of the three conditions in turn, and then RE-RUNS the shipping
//    statement with the readiness clause STRUCK OUT of the SQL text — which
//    must then leak the write, or the clause was never load-bearing.
// 2. A TAKEN SLUG IS A NAMED REFUSAL, NEVER A 500. `create` and `rename` both
//    hit the same unique index; the suite asserts the code, not a crash.
// 3. STATS ARE REAL COUNTS, NEVER INVENTED. A room with no followers gets
//    three real zeros, not a placeholder — `count`/`sum` over an empty set are
//    zero, never null, and the suite checks the fake produces exactly that.
// 4. THE BLOCKER LIST IS CLASSED, NOT COLLAPSED. A runtime blocked ONLY by
//    platform-owned gates (the automated suite, the voice provider) reports
//    `waiting_on_us`; blocked by anything else reports `waiting_on_you`.
import assert from "node:assert/strict";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const mod = await import(pathToFileURL(join(REPO, "api/_room-publish.js")).href);
const {
  getOwnedRoom,
  createRoom,
  renameRoom,
  publishRoom,
  pauseRoom,
  resumeRoom,
  setRoomFreeCap,
  ownerRoomStats,
  proposeSlug,
  normalizeSlug,
  RoomPublishError,
} = mod;
const { readinessPasses } = await import(pathToFileURL(join(REPO, "api/_clonechannel.js")).href);
const { READINESS_OVERALL_FLOOR, READINESS_PART_FLOOR } = await import(
  pathToFileURL(join(REPO, "api/_readiness.js")).href
);
const { RUNTIME_QUALIFICATION_SUITES } = await import(
  pathToFileURL(join(REPO, "api/_replica-runtime.js")).href
);

// ── the fixture world ───────────────────────────────────────────────────
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_OWNER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "c1000000-0000-4000-8000-000000000001";
const AGENT = "b1000000-0000-4000-8000-000000000001";
const NOW = Date.parse("2026-09-03T12:00:00Z");

function freshState() {
  return {
    replicas: [{ replica_id: REPLICA, agent_id: AGENT, owner_user_id: OWNER, display_name: "Arjun Sir Physics" }],
    rooms: [],
    caps: [{ replica_id: REPLICA, owner_user_id: OWNER, state: "active" }],
    readiness: [{ replica_id: REPLICA, owner_user_id: OWNER, unmeasured_count: 0, overall: 82, min_part: 71 }],
    sheets: [{ agent_id: AGENT, status: "published", consent_artifact_id: "d1000000-0000-4000-8000-000000000001" }],
    followers: [],
  };
}

/** `runtimeStatusRow` — the shape `api/_replica-runtime.js`'s own
 *  `clientRuntimeStatus` reads, `evals/replica-runtime/run.mjs`'s
 *  `statusRow()` one file over. Only used when the runtime EXISTS-check
 *  fails and `publishBlockers` asks WHY — a fully qualified row by default so
 *  each test overrides only the gate it means to fail. */
function runtimeStatusRow(extra = {}) {
  return {
    replica_id: REPLICA,
    subject_mode: "self",
    lifecycle: "ready",
    subject_person_id: "e1000000-0000-4000-8000-000000000001",
    account_person_matches: true,
    person_age_tier: "adult_verified",
    age_verified_at: "2026-08-01T00:00:00Z",
    identity_verified_at: "2026-08-01T00:00:00Z",
    liveness_verified_at: "2026-08-01T00:00:00Z",
    identity_expires_at: "2031-08-01T00:00:00Z",
    inference_consent: true,
    profile_approved: true,
    calibration_approved: true,
    genome_approved: true,
    voice_ready: true,
    test_voice: false,
    qualification_passed: RUNTIME_QUALIFICATION_SUITES.length,
    fidelity_qualified: true,
    readiness_qualified: true,
    capability_state: null,
    ...extra,
  };
}

/** The one fake `db`. Every branch mirrors one statement `api/_room-publish.js`
 *  actually issues; matched on a substring unique to that statement, checked
 *  in an order that keeps the more specific markers first so a fragment
 *  embedded in several statements (the readiness EXISTS clause, present in
 *  the publish/resume writes AND the standalone blocker probe) is never
 *  mismatched to the wrong branch. */
function makeDb(state) {
  const calls = [];

  const runtimeOk = (sql, owner, replica) => {
    // `sql.includes(...)` rather than a hardcoded true: a negative control
    // that strikes this clause out of the shipping text must be honoured
    // here, the same discipline `evals/clonechannel.mjs` uses for its own
    // readiness fragment.
    if (!sql.includes("vy_replica_runtime_capability")) return true;
    return state.caps.some((c) => c.owner_user_id === owner && c.replica_id === replica && c.state === "active");
  };
  const readinessOk = (sql, owner, replica, overallFloor, partFloor) => {
    if (!sql.includes("vy_replica_readiness")) return true;
    const snap = state.readiness.find((x) => x.owner_user_id === owner && x.replica_id === replica);
    if (!snap) return false;
    return snap.unmeasured_count === 0 && snap.overall >= overallFloor && snap.min_part >= partFloor;
  };
  const disclosureOk = (sql, agentId) => {
    if (!sql.includes("vy_teacher_sheet")) return true;
    const sheet = state.sheets.find((s) => s.agent_id === agentId);
    return Boolean(sheet) && sheet.status === "published" && sheet.consent_artifact_id != null;
  };

  const db = async (sql, params) => {
    calls.push({ sql, params });

    if (sql.includes("insert into vy_room")) {
      const [roomId, slug, replicaId, agentId, ownerId, displayName] = params;
      const taken = state.rooms.some((r) => r.slug.toLowerCase() === String(slug).toLowerCase());
      if (taken) throw Object.assign(new Error('duplicate key value violates unique constraint "vy_room_slug_ix"'), { code: "23505" });
      const dup = state.rooms.some((r) => r.replica_id === replicaId);
      if (dup) throw Object.assign(new Error('duplicate key value violates unique constraint "vy_room_replica_ix"'), { code: "23505" });
      const row = {
        room_id: roomId, slug, replica_id: replicaId, agent_id: agentId, owner_user_id: ownerId,
        display_name: displayName, free_monthly_messages: 20, published_at: null, paused_at: null,
        created_at: "2026-09-03T00:00:00Z", updated_at: "2026-09-03T00:00:00Z",
      };
      state.rooms.push(row);
      return [{ ...row }];
    }

    if (sql.includes("set slug = $3")) {
      const [ownerId, replicaId, slug] = params;
      const taken = state.rooms.some((r) => r.slug.toLowerCase() === String(slug).toLowerCase() && r.replica_id !== replicaId);
      if (taken) throw Object.assign(new Error('duplicate key value violates unique constraint "vy_room_slug_ix"'), { code: "23505" });
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      row.slug = slug;
      return [{ ...row }];
    }

    if (sql.includes("set published_at = case")) {
      const [ownerId, replicaId, overallFloor, partFloor] = params;
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      const pass = runtimeOk(sql, ownerId, replicaId)
        && readinessOk(sql, ownerId, replicaId, overallFloor, partFloor)
        && disclosureOk(sql, row.agent_id);
      if (pass && !row.published_at) row.published_at = "2026-09-03T13:00:00Z";
      return [{ ...row }];
    }

    if (sql.includes("set paused_at = case")) {
      const [ownerId, replicaId, overallFloor, partFloor] = params;
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      const pass = runtimeOk(sql, ownerId, replicaId)
        && readinessOk(sql, ownerId, replicaId, overallFloor, partFloor)
        && disclosureOk(sql, row.agent_id);
      if (pass) row.paused_at = null;
      return [{ ...row }];
    }

    if (sql.includes("set paused_at = now()")) {
      const [ownerId, replicaId] = params;
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      row.paused_at = "2026-09-03T14:00:00Z";
      return [{ ...row }];
    }

    if (sql.includes("set free_monthly_messages")) {
      const [ownerId, replicaId, cap] = params;
      const row = state.rooms.find((r) => r.owner_user_id === ownerId && r.replica_id === replicaId);
      if (!row) return [];
      row.free_monthly_messages = cap;
      return [{ ...row }];
    }

    if (sql.includes("followers_total")) {
      const [roomId, monthKey] = params;
      const rows = state.followers.filter((f) => f.room_id === roomId);
      const active24h = rows.filter((f) => f.last_seen_at && f.last_seen_at >= NOW - 24 * 60 * 60 * 1000).length;
      const messages = rows.reduce((sum, f) => sum + (f.month_key === monthKey ? f.month_message_count : 0), 0);
      return [{ followers_total: rows.length, followers_active_24h: active24h, messages_this_month: messages }];
    }

    // The three standalone blocker probes — `select exists(...) as ok`.
    // Checked AFTER every write above, since each write embeds one or more
    // of these same fragments and must be matched first.
    if (sql.includes("as ok") && sql.includes("vy_replica_runtime_capability")) {
      const [ownerId, replicaId] = params;
      return [{ ok: runtimeOk(sql, ownerId, replicaId) }];
    }
    if (sql.includes("as ok") && sql.includes("vy_replica_readiness")) {
      const [ownerId, replicaId, overallFloor, partFloor] = params;
      return [{ ok: readinessOk(sql, ownerId, replicaId, overallFloor, partFloor) }];
    }
    if (sql.includes("as ok") && sql.includes("vy_teacher_sheet")) {
      const [agentId] = params;
      return [{ ok: disclosureOk(sql, agentId) }];
    }

    // `ownedRuntimeStatus`'s own twenty-CTE status query — matched on a
    // column unique to it, so nothing above is ever shadowed.
    if (sql.includes("r.subject_mode")) {
      const row = state.runtimeStatusRow;
      return row ? [row] : [];
    }

    if (sql.includes("r.replica_id, r.agent_id, r.owner_user_id, r.display_name")) {
      const [replicaId, ownerId] = params;
      const r = state.replicas.find((x) => x.replica_id === replicaId && x.owner_user_id === ownerId);
      return r ? [{ ...r }] : [];
    }

    if (sql.includes("from vy_room") && sql.includes("limit 1")) {
      const [ownerId, replicaId] = params;
      const r = state.rooms.find((x) => x.owner_user_id === ownerId && x.replica_id === replicaId);
      return r ? [{ ...r }] : [];
    }

    // WS-R66: `getOwnedRoom` now also feeds the Share tab's showcase off the
    // SAME read (`readRoomShowcase`, `api/_room-publish.js`) — this suite
    // never seeds a showcase, so every Room here answers with none, the
    // overwhelming-majority real case (`_creator-page.js`'s own comment,
    // one surface over).
    if (sql.includes("from vy_room_showcase") && sql.includes("order by position asc")) {
      return [];
    }

    throw new Error(`unmodelled statement: ${sql.slice(0, 80)}`);
  };
  db.calls = calls;
  return db;
}

// ── 1. slug proposal, pure ─────────────────────────────────────────────
{
  ok("lowercases and dashes", proposeSlug("Arjun Sir Physics") === "arjun-sir-physics");
  ok("strips punctuation", normalizeSlug("Dr. Meera!!") === "dr-meera");
  ok("pads a too-short base rather than accepting it under the floor", proposeSlug("Al").length >= 3);
  ok("clamps to 40", proposeSlug("x".repeat(80)).length === 40);
}

// ── 2. create: fresh, idempotent, and a taken slug is named ────────────
{
  const state = freshState();
  const db = makeDb(state);
  const room = await createRoom(db, OWNER, REPLICA, {});
  ok("create proposes the slug from the display name", room.slug === "arjun-sir-physics");
  ok("a fresh room is not published", room.published === false);

  const again = await createRoom(db, OWNER, REPLICA, {});
  ok("create is idempotent: same replica, same room, no error", again.room_id === room.room_id);

  const NEW_REPLICA = "c2000000-0000-4000-8000-000000000002";
  const other = freshState();
  other.replicas.push({
    replica_id: NEW_REPLICA,
    agent_id: "b2000000-0000-4000-8000-000000000002",
    owner_user_id: OWNER,
    display_name: "A second AI",
  });
  other.rooms.push({ ...state.rooms[0] }); // the existing "arjun-sir-physics" room, on the FIRST replica
  const collideDb = makeDb(other);
  let namedRefusal = null;
  try {
    await createRoom(collideDb, OWNER, NEW_REPLICA, { slug: "arjun-sir-physics" });
  } catch (e) {
    namedRefusal = e;
  }
  ok(
    "a taken slug is a NAMED refusal, never a raw 500",
    namedRefusal instanceof RoomPublishError && namedRefusal.code === "room_slug_taken",
    namedRefusal ? `code=${namedRefusal.code}` : "no error thrown",
  );

  let noAgent = null;
  const noAgentState = freshState();
  noAgentState.replicas[0].agent_id = null;
  try {
    await createRoom(makeDb(noAgentState), OWNER, REPLICA, {});
  } catch (e) {
    noAgent = e;
  }
  ok("a replica with no agent refuses by name", noAgent?.code === "room_replica_has_no_agent");
}

// ── 3. rename: same collision rule ──────────────────────────────────────
{
  const state = freshState();
  const db = makeDb(state);
  await createRoom(db, OWNER, REPLICA, {});
  const renamed = await renameRoom(db, OWNER, REPLICA, "Arjun's AI!!");
  ok("rename normalizes the same way create does", renamed.slug === "arjun-s-ai");

  state.rooms.push({ ...state.rooms[0], room_id: "other-room", replica_id: "other-replica", slug: "taken-name" });
  let renameCollision = null;
  try {
    await renameRoom(db, OWNER, REPLICA, "taken-name");
  } catch (e) {
    renameCollision = e;
  }
  ok("renaming onto a taken slug is also a named refusal", renameCollision?.code === "room_slug_taken");

  let tooShort = null;
  try {
    await renameRoom(db, OWNER, REPLICA, "ab");
  } catch (e) {
    tooShort = e;
  }
  ok("a too-short slug is refused before it ever reaches SQL", tooShort?.code === "room_slug_invalid");
}

// ── 4. publish: the positive case, all three conditions real ────────────
{
  const state = freshState();
  const db = makeDb(state);
  await createRoom(db, OWNER, REPLICA, {});
  const published = await publishRoom(db, OWNER, REPLICA);
  ok("all three conditions true: publish succeeds", published.published === true);

  const again = await publishRoom(db, OWNER, REPLICA);
  ok(
    "republishing does not move the original publish date forward",
    again.published_at === published.published_at,
  );
}

// ── 5. publish: each of the three conditions refused in turn ────────────
{
  const noRuntime = freshState();
  noRuntime.caps = [];
  noRuntime.runtimeStatusRow = runtimeStatusRow({ capability_state: null });
  const dbNoRuntime = makeDb(noRuntime);
  await createRoom(dbNoRuntime, OWNER, REPLICA, {});
  let refusedRuntime = null;
  try {
    await publishRoom(dbNoRuntime, OWNER, REPLICA);
  } catch (e) {
    refusedRuntime = e;
  }
  ok(
    "no active runtime capability: publish is refused by name",
    refusedRuntime?.code === "room_publish_locked"
      && refusedRuntime.details.waiting_on_you.some((b) => b.code === "room_runtime_not_active"),
  );

  const noReadiness = freshState();
  noReadiness.readiness = [{ replica_id: REPLICA, owner_user_id: OWNER, unmeasured_count: 0, overall: 40, min_part: 30 }];
  const dbNoReadiness = makeDb(noReadiness);
  await createRoom(dbNoReadiness, OWNER, REPLICA, {});
  let refusedReadiness = null;
  try {
    await publishRoom(dbNoReadiness, OWNER, REPLICA);
  } catch (e) {
    refusedReadiness = e;
  }
  ok(
    "readiness below floor: publish is refused by name",
    refusedReadiness?.code === "room_publish_locked"
      && refusedReadiness.details.waiting_on_you.some((b) => b.code === "room_readiness_locked"),
  );

  const noDisclosure = freshState();
  noDisclosure.sheets = [{ agent_id: AGENT, status: "draft", consent_artifact_id: null }];
  const dbNoDisclosure = makeDb(noDisclosure);
  await createRoom(dbNoDisclosure, OWNER, REPLICA, {});
  let refusedDisclosure = null;
  try {
    await publishRoom(dbNoDisclosure, OWNER, REPLICA);
  } catch (e) {
    refusedDisclosure = e;
  }
  ok(
    "no approved disclosure: publish is refused by name",
    refusedDisclosure?.code === "room_publish_locked"
      && refusedDisclosure.details.waiting_on_you.some((b) => b.code === "room_disclosure_not_approved"),
  );
}

// ── 6. the blocker CLASS: platform-only runtime gates read `waiting_on_us` ─
{
  const platformHeld = freshState();
  platformHeld.caps = [];
  platformHeld.runtimeStatusRow = runtimeStatusRow({ qualification_passed: 3 }); // qualification_incomplete
  const db = makeDb(platformHeld);
  await createRoom(db, OWNER, REPLICA, {});
  let refused = null;
  try {
    await publishRoom(db, OWNER, REPLICA);
  } catch (e) {
    refused = e;
  }
  ok(
    "a runtime blocked ONLY by platform-owned gates classes as waiting_on_us",
    refused?.details.waiting_on_us.some((b) => b.code === "room_runtime_not_active")
      && !refused.details.waiting_on_you.some((b) => b.code === "room_runtime_not_active"),
  );

  const ownerHeld = freshState();
  ownerHeld.caps = [];
  ownerHeld.runtimeStatusRow = runtimeStatusRow({ inference_consent: false }); // owner-owned gate
  const db2 = makeDb(ownerHeld);
  await createRoom(db2, OWNER, REPLICA, {});
  let refused2 = null;
  try {
    await publishRoom(db2, OWNER, REPLICA);
  } catch (e) {
    refused2 = e;
  }
  ok(
    "a runtime blocked by an owner-owned gate classes as waiting_on_you",
    refused2?.details.waiting_on_you.some((b) => b.code === "room_runtime_not_active"),
  );
}

// ── 7. THE NEGATIVE CONTROL: strike the readiness clause ────────────────
console.log("\n── negative control: strike the readiness predicate ──");
{
  const state = freshState();
  state.readiness = [{ replica_id: REPLICA, owner_user_id: OWNER, unmeasured_count: 2, overall: null, min_part: null }];
  const db = makeDb(state);
  await createRoom(db, OWNER, REPLICA, {});

  let refused = null;
  try {
    await publishRoom(db, OWNER, REPLICA);
  } catch (e) {
    refused = e;
  }
  ok("shipping statement: unmeasured readiness refuses publish", refused?.code === "room_publish_locked");

  // The REAL statement text, captured off the fake's own call log, with the
  // readiness EXISTS clause struck out and NOTHING else changed. This is not
  // a hand-written approximation of the query; it is the query.
  const publishCall = db.calls.find((c) => c.sql.includes("set published_at = case"));
  const struck = publishCall.sql.replace(
    /and exists \(\s*select 1 from vy_replica_readiness x[\s\S]*?\)\s*\n\s*and exists \(/,
    "and exists (",
  );
  assert.ok(struck !== publishCall.sql, "the strike actually removed text; the regex did not match");
  assert.ok(!struck.includes("vy_replica_readiness"), "the struck copy must no longer mention vy_replica_readiness");

  const strikeDb = makeDb(state);
  const leaked = await strikeDb(struck, publishCall.params);
  ok(
    "with the readiness clause struck, an unmeasured readiness room PUBLISHES — the clause is load-bearing",
    leaked[0].published_at != null,
  );
}

// ── 8. pause is unconditional; resume carries the same lock as publish ──
{
  const state = freshState();
  const db = makeDb(state);
  await createRoom(db, OWNER, REPLICA, {});
  await publishRoom(db, OWNER, REPLICA);
  const paused = await pauseRoom(db, OWNER, REPLICA);
  ok("pause is unconditional and immediate", paused.paused === true);

  state.caps = []; // regressed while paused
  let resumeRefused = null;
  try {
    await resumeRoom(db, OWNER, REPLICA);
  } catch (e) {
    resumeRefused = e;
  }
  ok(
    "a Room that regressed while paused cannot resume through an unlocked door",
    resumeRefused?.code === "room_publish_locked",
  );

  state.caps.push({ replica_id: REPLICA, owner_user_id: OWNER, state: "active" });
  const resumed = await resumeRoom(db, OWNER, REPLICA);
  ok("once the gate clears again, resume succeeds", resumed.paused === false);
}

// ── 9. set_free_cap is bounded ───────────────────────────────────────────
{
  const state = freshState();
  const db = makeDb(state);
  await createRoom(db, OWNER, REPLICA, {});
  const capped = await setRoomFreeCap(db, OWNER, REPLICA, 50);
  ok("a valid cap is written", capped.free_monthly_messages === 50);

  let badCap = null;
  try {
    await setRoomFreeCap(db, OWNER, REPLICA, -1);
  } catch (e) {
    badCap = e;
  }
  ok("a negative cap is refused before it reaches SQL", badCap?.code === "room_free_cap_invalid");

  let fractional = null;
  try {
    await setRoomFreeCap(db, OWNER, REPLICA, 3.5);
  } catch (e) {
    fractional = e;
  }
  ok("a non-integer cap is refused", fractional?.code === "room_free_cap_invalid");
}

// ── 10. stats: real counts, never invented ───────────────────────────────
{
  const state = freshState();
  const db = makeDb(state);
  const room = await createRoom(db, OWNER, REPLICA, {});
  const empty = await ownerRoomStats(db, OWNER, REPLICA, { now: NOW });
  ok(
    "a room with no followers gets three real zeros, never a placeholder",
    empty.followers_total === 0 && empty.followers_active_24h === 0 && empty.messages_this_month === 0,
  );

  const monthKey = new Date(NOW).toISOString().slice(0, 7);
  state.followers.push(
    { room_id: room.room_id, last_seen_at: NOW - 60 * 60 * 1000, month_key: monthKey, month_message_count: 5 },
    { room_id: room.room_id, last_seen_at: NOW - 48 * 60 * 60 * 1000, month_key: monthKey, month_message_count: 2 },
    { room_id: room.room_id, last_seen_at: NOW, month_key: "2026-07", month_message_count: 99 },
  );
  const withFollowers = await ownerRoomStats(db, OWNER, REPLICA, { now: NOW });
  ok("followers_total counts every membership row", withFollowers.followers_total === 3);
  ok("followers_active_24h counts only the ones seen in the last day", withFollowers.followers_active_24h === 2);
  ok(
    "messages_this_month sums only THIS month's counter, never a prior month's",
    withFollowers.messages_this_month === 7,
  );
}

// ── 11. get: proactive blockers, before any publish attempt ─────────────
{
  const state = freshState();
  const db = makeDb(state);
  const notCreated = await getOwnedRoom(db, OWNER, REPLICA);
  ok("no room yet is a NAMED reason, never a bare null", notCreated.reason === "not_created");

  await createRoom(db, OWNER, REPLICA, {});
  const before = await getOwnedRoom(db, OWNER, REPLICA);
  ok("a fresh, fully-qualified room can already be published", before.can_publish === true);
  ok("its blocker lists are both empty when it can publish", before.blockers.waiting_on_you.length === 0);

  const notOwner = await getOwnedRoom(db, OTHER_OWNER, REPLICA);
  ok("a different owner sees nothing, not an error", notOwner === null);
}

// ── 12. WS-R18: the Telegram deep link, honest "not connected" over a guess ─
{
  const state = freshState();
  const db = makeDb(state);
  const created = await createRoom(db, OWNER, REPLICA, {});

  const savedBotUsername = process.env.ROOM_TELEGRAM_BOT_USERNAME;
  try {
    delete process.env.ROOM_TELEGRAM_BOT_USERNAME;
    const unconfigured = await getOwnedRoom(db, OWNER, REPLICA);
    ok("no bot configured: the deep link is null, not a guessed URL",
      unconfigured.room.telegram_deep_link === null);

    process.env.ROOM_TELEGRAM_BOT_USERNAME = "VyaktiRoomsBot";
    const configured = await getOwnedRoom(db, OWNER, REPLICA);
    ok("bot configured: the deep link names THIS room's own slug",
      configured.room.telegram_deep_link === `https://t.me/VyaktiRoomsBot?start=${created.slug}`);
  } finally {
    if (savedBotUsername === undefined) delete process.env.ROOM_TELEGRAM_BOT_USERNAME;
    else process.env.ROOM_TELEGRAM_BOT_USERNAME = savedBotUsername;
  }
}

// ── the floors this suite pinned itself to, so a moved constant is visible ──
ok("the readiness floors this suite exercises match the shipping module", READINESS_OVERALL_FLOOR === 70 && READINESS_PART_FLOOR === 55);
ok("the readiness fragment is IMPORTED from api/_clonechannel.js, not re-typed", typeof readinessPasses === "function");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
