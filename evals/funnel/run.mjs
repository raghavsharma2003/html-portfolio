// WS-R25. The creator funnel's offline suite: `api/_funnel.js` (markStep,
// replicaFunnel, funnelSummary, opsFunnel) and `api/_sweep-run.js`'s new
// retention delete (migration 088 / `vy_replica_funnel_mark`).
//
//   node evals/funnel/run.mjs
//
// Offline, deterministic, $0, no network, no real Postgres. A dedicated fake
// `db` rather than a reuse of `evals/room/fixtures.mjs` - this file's own
// tables (vy_replica, vy_replica_source, vy_replica_processing_job,
// vy_replica_generation, vy_replica_readiness, vy_teacher_sheet,
// vy_replica_funnel_mark) are disjoint from the follower/thread world that
// fixture exists to model, and the one table it DOES share (vy_room /
// vy_room_follower) is small enough here to model directly rather than pull
// in `loadFixtureAgent`'s esbuild bundling step for two fields.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const { markStep, replicaFunnel, funnelSummary, opsFunnel, FUNNEL_STEPS } = await import(
  pathToFileURL(join(REPO, "api/_funnel.js")).href
);
const { withSweepRun, SWEEP_RUN_RETENTION_DAYS } = await import(
  pathToFileURL(join(REPO, "api/_sweep-run.js")).href
);

// ═════════════════════════════════════════════════════════════════════════
// THE FIXTURE
// ═════════════════════════════════════════════════════════════════════════
const OWNER_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OWNER_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA_PUBLISHED = "c1000000-0000-4000-8000-000000000001"; // published in 23 minutes
const REPLICA_STALLED = "c1000000-0000-4000-8000-000000000002"; // stalled at readiness
const AGENT_PUBLISHED = "b1000000-0000-4000-8000-000000000001";
const ROOM_PUBLISHED = "d1000000-0000-4000-8000-000000000001";

function freshState() {
  return {
    replicas: [],
    sources: [],
    processingJobs: [],
    generations: [],
    readiness: [],
    teacherSheets: [],
    rooms: [],
    followers: [],
    marks: [],
    sweepRuns: [],
  };
}

/** Every field this fixture needs on the "published in 23 minutes" replica,
 *  reused by more than one section below so the shape is written once. */
function seedPublishedReplica(state) {
  const t0 = "2026-09-01T00:00:00.000Z"; // account_created
  state.replicas.push({
    replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, agent_id: AGENT_PUBLISHED,
    created_at: t0, lifecycle: "active",
  });
  state.sources.push({ replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, created_at: "2026-09-01T00:03:00.000Z" });
  state.processingJobs.push({
    replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, step: "voice_quality", state: "complete",
    updated_at: "2026-09-01T00:08:00.000Z",
  });
  state.generations.push({
    replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, purpose: "voice_preview",
    channel: "studio_preview", state: "sealed", sealed_at: "2026-09-01T00:10:00.000Z",
  });
  state.readiness.push(
    { replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, computed_at: "2026-09-01T00:12:00.000Z", overall: 40, min_part: 20 },
    { replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, computed_at: "2026-09-01T00:15:00.000Z", overall: 82, min_part: 61 },
  );
  state.teacherSheets.push({ agent_id: AGENT_PUBLISHED, status: "published", published_at: "2026-09-01T00:18:00.000Z" });
  state.rooms.push({
    room_id: ROOM_PUBLISHED, replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A,
    created_at: "2026-09-01T00:19:00.000Z", published_at: "2026-09-01T00:23:00.000Z",
  });
  state.followers.push({ room_id: ROOM_PUBLISHED, joined_at: "2026-09-01T01:00:00.000Z" });
  state.marks.push(
    { replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, step: "studio_opened", at: "2026-09-01T00:01:00.000Z" },
    { replica_id: REPLICA_PUBLISHED, owner_user_id: OWNER_A, step: "publish_clicked", at: "2026-09-01T00:22:00.000Z" },
  );
}

/** A replica created 10 days ago (older than the 7-day stall window) whose
 *  last reached step is readiness_first_measured - it opened the studio,
 *  uploaded a source, finished processing, heard a preview, and readiness
 *  was measured once, but never passed the lock and no Room exists. */
function seedStalledReplica(state, now) {
  const t0 = new Date(now - 10 * 86_400_000).toISOString();
  state.replicas.push({
    replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, agent_id: null,
    created_at: t0, lifecycle: "active",
  });
  state.sources.push({ replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, created_at: t0 });
  state.processingJobs.push({
    replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, step: "voice_quality", state: "complete", updated_at: t0,
  });
  state.generations.push({
    replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, purpose: "voice_preview",
    channel: "studio_preview", state: "sealed", sealed_at: t0,
  });
  state.readiness.push({ replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, computed_at: t0, overall: 55, min_part: 30 });
  state.marks.push({ replica_id: REPLICA_STALLED, owner_user_id: OWNER_A, step: "studio_opened", at: t0 });
}

function funnelDb(state) {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    const has = (s) => sql.includes(s);

    // ── markStep's one combined statement ──────────────────────────────────
    if (has("with owned as") && has("insert into vy_replica_funnel_mark")) {
      const [replicaId, ownerUserId, step] = params;
      const owns = state.replicas.some((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId);
      if (owns) {
        const already = state.marks.find(
          (m) => m.replica_id === replicaId && m.owner_user_id === ownerUserId && m.step === step,
        );
        if (!already) {
          state.marks.push({ replica_id: replicaId, owner_user_id: ownerUserId, step, at: new Date().toISOString() });
        }
      }
      const stored = state.marks.find(
        (m) => m.replica_id === replicaId && m.owner_user_id === ownerUserId && m.step === step,
      );
      return [{ owned: owns ? 1 : 0, at: stored ? stored.at : null }];
    }

    // ── replicaFunnel's base row (before the general vy_replica list below,
    // which this substring would also match if checked first) ─────────────
    if (has("select replica_id, owner_user_id, agent_id, created_at")) {
      const [replicaId, ownerUserId] = params;
      const r = state.replicas.find((x) => x.replica_id === replicaId && x.owner_user_id === ownerUserId);
      return r ? [r] : [];
    }

    if (has("min(created_at) as at from vy_replica_source")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.sources.filter((s) => s.replica_id === replicaId && s.owner_user_id === ownerUserId);
      return [{ at: rows.length ? rows.map((s) => s.created_at).sort()[0] : null }];
    }

    if (has("from vy_replica_processing_job")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.processingJobs.filter(
        (j) => j.replica_id === replicaId && j.owner_user_id === ownerUserId && j.step === "voice_quality" && j.state === "complete",
      );
      return [{ at: rows.length ? rows.map((j) => j.updated_at).sort()[0] : null }];
    }

    if (has("from vy_replica_generation")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.generations.filter(
        (g) => g.replica_id === replicaId && g.owner_user_id === ownerUserId &&
          g.purpose === "voice_preview" && g.channel === "studio_preview" && g.state === "sealed",
      );
      return [{ at: rows.length ? rows.map((g) => g.sealed_at).sort()[0] : null }];
    }

    // The passed-lock read (checked BEFORE the general readiness read below,
    // which its own substring is a strict subset of).
    if (has("from vy_replica_readiness") && has("overall >= 70")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.readiness.filter(
        (x) => x.replica_id === replicaId && x.owner_user_id === ownerUserId && x.overall >= 70 && x.min_part >= 55,
      );
      return [{ at: rows.length ? rows.map((x) => x.computed_at).sort()[0] : null }];
    }
    if (has("from vy_replica_readiness")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.readiness.filter((x) => x.replica_id === replicaId && x.owner_user_id === ownerUserId);
      return [{ at: rows.length ? rows.map((x) => x.computed_at).sort()[0] : null }];
    }

    if (has("from vy_teacher_sheet")) {
      const [agentId] = params;
      const rows = state.teacherSheets.filter((s) => s.agent_id === agentId && s.status === "published");
      return [{ at: rows.length ? rows.map((s) => s.published_at).sort()[0] : null }];
    }

    if (has("select step, at from vy_replica_funnel_mark")) {
      const [replicaId, ownerUserId] = params;
      return state.marks
        .filter((m) => m.replica_id === replicaId && m.owner_user_id === ownerUserId)
        .map((m) => ({ step: m.step, at: m.at }));
    }

    if (has("select room_id, created_at, published_at from vy_room")) {
      const [replicaId, ownerUserId] = params;
      const rows = state.rooms
        .filter((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return rows.length ? [rows[0]] : [];
    }

    if (has("min(joined_at) as at from vy_room_follower")) {
      const [roomId] = params;
      const rows = state.followers.filter((f) => f.room_id === roomId);
      return [{ at: rows.length ? rows.map((f) => f.joined_at).sort()[0] : null }];
    }

    // opsFunnel's own list, checked AFTER the more specific base-row select
    // above (whose text this one is a strict prefix of).
    if (has("select replica_id, owner_user_id from vy_replica") && has("lifecycle")) {
      return state.replicas
        .filter((r) => r.lifecycle !== "purging")
        .map((r) => ({ replica_id: r.replica_id, owner_user_id: r.owner_user_id }));
    }

    // ── api/_sweep-run.js's three statements ────────────────────────────────
    if (has("insert into vy_sweep_run")) {
      const [runId, sweep, startedAt] = params;
      state.sweepRuns.push({ run_id: runId, sweep, started_at: startedAt, finished_at: null, outcome: "running", counts: {}, error_code: "" });
      return [];
    }
    if (has("update vy_sweep_run")) {
      const [runId, outcome, counts, errorCode] = params;
      const row = state.sweepRuns.find((r) => r.run_id === runId);
      if (row) { row.finished_at = new Date().toISOString(); row.outcome = outcome; row.counts = counts; row.error_code = errorCode; }
      return [];
    }
    if (has("delete from vy_sweep_run")) {
      const [sweep, days] = params;
      const cutoffMs = Date.now() - Number(days) * 86_400_000;
      const before = state.sweepRuns.length;
      state.sweepRuns = state.sweepRuns.filter(
        (r) => !(r.sweep === sweep && new Date(r.started_at).getTime() < cutoffMs),
      );
      return [{ deleted: before - state.sweepRuns.length }];
    }

    throw new Error("funnelDb: unhandled statement: " + sql.slice(0, 120));
  };
  return { db, calls };
}

// ═════════════════════════════════════════════════════════════════════════
// §1 — markStep: owner-authenticated, first write wins, refused before any
// write.
// ═════════════════════════════════════════════════════════════════════════
console.log("── §1: markStep ──");

{
  const state = freshState();
  seedPublishedReplica(state); // seeds two marks already, but on a FRESH replica id below
  const otherReplica = "c1000000-0000-4000-8000-000000000009";
  state.replicas.push({ replica_id: otherReplica, owner_user_id: OWNER_A, agent_id: null, created_at: "2026-09-02T00:00:00.000Z", lifecycle: "active" });
  const { db } = funnelDb(state);

  const first = await markStep(db, OWNER_A, otherReplica, "studio_opened");
  ok("markStep writes a real timestamp", Boolean(first.at));
  const stored1 = state.marks.find((m) => m.replica_id === otherReplica && m.step === "studio_opened").at;

  await new Promise((r) => setTimeout(r, 5));
  const second = await markStep(db, OWNER_A, otherReplica, "studio_opened");
  ok("first-write-wins: a second mark of the SAME step returns the SAME timestamp, not a new one",
    second.at === stored1);
  ok("first-write-wins: only one row exists for (replica, step)",
    state.marks.filter((m) => m.replica_id === otherReplica && m.step === "studio_opened").length === 1);

  await markStep(db, OWNER_A, otherReplica, "publish_clicked");
  ok("a different step writes its OWN row", state.marks.filter((m) => m.replica_id === otherReplica).length === 2);

  let threw = null;
  try {
    await markStep(db, OWNER_A, otherReplica, "not_a_real_step");
  } catch (e) { threw = e; }
  ok("an unknown step is refused by name, before any db call",
    threw?.code === "unknown_funnel_step" && threw?.status === 400);
}

// NEGATIVE CONTROL (a): a mark from another owner is refused BEFORE any write.
{
  const state = freshState();
  seedPublishedReplica(state);
  const { db } = funnelDb(state);
  const before = state.marks.length;

  let threw = null;
  try {
    await markStep(db, OWNER_B, REPLICA_PUBLISHED, "studio_opened");
  } catch (e) { threw = e; }
  ok("NEGATIVE CONTROL (a): a mark from an owner who does not own this replica throws replica_not_found",
    threw?.code === "replica_not_found" && threw?.status === 404);
  ok("NEGATIVE CONTROL (a): NO row was written for this attempt (the write's own row source is ownership-gated)",
    state.marks.length === before &&
    !state.marks.some((m) => m.replica_id === REPLICA_PUBLISHED && m.owner_user_id === OWNER_B));
  // The legitimate owner's own already-seeded mark is untouched by the attempt.
  ok("the real owner's own existing mark is unchanged",
    state.marks.some((m) => m.replica_id === REPLICA_PUBLISHED && m.owner_user_id === OWNER_A && m.step === "studio_opened"));
}

// ═════════════════════════════════════════════════════════════════════════
// §2 — replicaFunnel: the ordered timestamps, each from its own table.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §2: replicaFunnel (the ordered funnel) ──");

{
  const state = freshState();
  seedPublishedReplica(state);
  const { db } = funnelDb(state);
  const funnel = await replicaFunnel(db, REPLICA_PUBLISHED, OWNER_A);

  ok("replicaFunnel returns the right replica/owner", funnel.replica_id === REPLICA_PUBLISHED && funnel.owner_user_id === OWNER_A);
  for (const step of FUNNEL_STEPS) {
    ok(`step '${step}' is populated for a fully-published replica`, Boolean(funnel.steps[step]));
  }
  // Each timestamp lands within the fixture's own minute-by-minute schedule,
  // in the SAME order FUNNEL_STEPS declares - proves the read reaches the
  // right table, not merely that it returns SOME value.
  const order = FUNNEL_STEPS.map((s) => Date.parse(funnel.steps[s]));
  ok("every step's timestamp is >= the previous step's (the fixture is monotonic and every read landed on the right table)",
    order.every((t, i) => i === 0 || t >= order[i - 1]));

  const unowned = await replicaFunnel(db, REPLICA_PUBLISHED, OWNER_B);
  ok("replicaFunnel returns null for a replica this caller does not own", unowned === null);
}

{
  const state = freshState();
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  seedStalledReplica(state, now);
  const { db } = funnelDb(state);
  const funnel = await replicaFunnel(db, REPLICA_STALLED, OWNER_A);

  ok("the stalled replica's readiness_first_measured is set", Boolean(funnel.steps.readiness_first_measured));
  ok("the stalled replica NEVER passed the lock", funnel.steps.readiness_passed_lock === null);
  ok("the stalled replica has no disclosure, no Room, no follower",
    funnel.steps.disclosure_approved === null && funnel.steps.room_created === null &&
    funnel.steps.room_published === null && funnel.steps.first_follower_joined === null);
}

// ═════════════════════════════════════════════════════════════════════════
// §3 — funnelSummary: pure median/p90 math and stall counts.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §3: funnelSummary (pure) ──");

{
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const published = { steps: { account_created: "2026-09-01T00:00:00.000Z", room_published: "2026-09-01T00:23:00.000Z" } };
  const summary = funnelSummary([published], now);
  ok("a single published replica: median and p90 both equal its own minutes (23)",
    summary.minutes_to_first_room.median === 23 && summary.minutes_to_first_room.p90 === 23);
  ok("n reflects the published count", summary.minutes_to_first_room.n === 1);
}

{
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const stalled = { steps: { account_created: "2026-09-01T00:00:00.000Z", readiness_first_measured: "2026-09-01T00:12:00.000Z" } };
  const summary = funnelSummary([stalled], now);
  ok("a stalled replica (10 days old, never published) is NOT counted toward minutes_to_first_room",
    summary.minutes_to_first_room.n === 0 && summary.minutes_to_first_room.median === null);
  ok("its last-reached step (readiness_first_measured) is counted in stalled_at",
    summary.stalled_at.length === 1 && summary.stalled_at[0].step === "readiness_first_measured" && summary.stalled_at[0].count === 1);
}

{
  // A replica created only 2 days ago with no Room yet is NOT a stall - it
  // is simply in progress, and must never be counted as a defect on day one.
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const young = { steps: { account_created: "2026-09-09T00:00:00.000Z", first_source_uploaded: "2026-09-09T00:05:00.000Z" } };
  const summary = funnelSummary([young], now);
  ok("a replica less than 7 days old with no Room is not counted as stalled",
    summary.stalled_at.length === 0);
}

{
  // Median/p90 over more than one published replica, standard nearest-rank
  // interpolation.
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const mk = (mins) => ({ steps: { account_created: "2026-09-01T00:00:00.000Z", room_published: new Date(Date.parse("2026-09-01T00:00:00.000Z") + mins * 60_000).toISOString() } });
  const rows = [mk(10), mk(20), mk(30), mk(40)];
  const summary = funnelSummary(rows, now);
  ok("median over [10,20,30,40] is 25", summary.minutes_to_first_room.median === 25);
  ok("p90 over [10,20,30,40] is 37", summary.minutes_to_first_room.p90 === 37);
  ok("n is 4", summary.minutes_to_first_room.n === 4);
}

// ═════════════════════════════════════════════════════════════════════════
// §4 — opsFunnel: the board's own read, driving both replicas at once.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §4: opsFunnel ──");

{
  const state = freshState();
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  seedPublishedReplica(state);
  seedStalledReplica(state, now);
  const { db } = funnelDb(state);
  const summary = await opsFunnel(db, now);

  ok("opsFunnel counts the one published replica", summary.minutes_to_first_room.n === 1);
  ok("opsFunnel's median is that replica's own 23 minutes", summary.minutes_to_first_room.median === 23);
  ok("opsFunnel counts the stalled replica under readiness_first_measured",
    summary.stalled_at.some((s) => s.step === "readiness_first_measured" && s.count === 1));

  // A purging replica is excluded entirely - a revoked replica is not a
  // "stalled" creator, it is gone.
  state.replicas.push({ replica_id: "c1000000-0000-4000-8000-000000000099", owner_user_id: OWNER_A, agent_id: null, created_at: "2026-08-01T00:00:00.000Z", lifecycle: "purging" });
  const summary2 = await opsFunnel(db, now);
  ok("a purging replica is excluded from the board's own funnel",
    summary2.stalled_at.reduce((n, s) => n + s.count, 0) === summary.stalled_at.reduce((n, s) => n + s.count, 0));
}

// ═════════════════════════════════════════════════════════════════════════
// §5 — NEGATIVE CONTROL (b): a select list that adds a follower column fails
// the SAME aggregate-only parser evals/room-leak/run.mjs runs.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §5: the aggregate-only parser catches a leaking select list ──");

function aggregateOnlyVerdict(statementText) {
  const selectList = (statementText.match(/select([\s\S]*?)\sfrom\s/i) || [, ""])[1];
  const items = [];
  let depth = 0, cur = "";
  for (const ch of selectList) {
    if (ch === "(") depth++; else if (ch === ")") depth--;
    if (ch === "," && depth === 0) { items.push(cur); cur = ""; } else cur += ch;
  }
  if (cur.trim()) items.push(cur);
  const aggregateOnly = items.length > 0 && items.every((c) => /\b(count|sum|min)\s*\(/i.test(c));
  const touchesPerson = /person_id|thread_id|\btitle\b|\bf\.\*|content|message_text/i.test(selectList);
  return { aggregateOnly, touchesPerson, leaks: !aggregateOnly || touchesPerson };
}

const funnelSrc = fs.readFileSync(join(REPO, "api/_funnel.js"), "utf8");
const followerStmtMatch = funnelSrc.match(/`select min\(joined_at\) as at from vy_room_follower[\s\S]*?`/);
ok("the real vy_room_follower statement is found in api/_funnel.js (not moved/renamed)", Boolean(followerStmtMatch));
const realStmt = followerStmtMatch ? followerStmtMatch[0] : "";
const realVerdict = aggregateOnlyVerdict(realStmt);
ok("the REAL shipping statement passes the aggregate-only parser (min() is now admitted)",
  realVerdict.aggregateOnly && !realVerdict.touchesPerson);

// NEGATIVE CONTROL (b): a copy of that exact statement with a bare follower
// column ("a source's text column" the brief names - any non-aggregate
// identifier proves the same point) appended to the select list.
const leakingStmt = realStmt.replace("select min(joined_at) as at", "select person_id, min(joined_at) as at");
ok("the mutation actually changed the text (the control is not vacuous)", leakingStmt !== realStmt);
const leakingVerdict = aggregateOnlyVerdict(leakingStmt);
ok("NEGATIVE CONTROL (b): a select list with a bare follower column (person_id) FAILS the aggregate-only parser",
  leakingVerdict.leaks);

const leakingStmt2 = realStmt.replace("select min(joined_at) as at", "select message_text, min(joined_at) as at");
ok("NEGATIVE CONTROL (b), second shape: a select list with message_text also FAILS",
  aggregateOnlyVerdict(leakingStmt2).leaks);

// ═════════════════════════════════════════════════════════════════════════
// §6 — the retention delete: bounded by sweep AND age, closing WS-R21's own
// open item.
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── §6: withSweepRun's retention delete ──");

ok("the retention window is 30 days", SWEEP_RUN_RETENTION_DAYS === 30);

{
  const state = freshState();
  const { db } = funnelDb(state);
  const oldMs = Date.now() - (SWEEP_RUN_RETENTION_DAYS + 5) * 86_400_000;
  const freshMs = Date.now() - 1 * 86_400_000;
  // Two sweeps, each with an old row and a fresh row - proves the delete is
  // bounded by BOTH sweep name and age, never one alone.
  state.sweepRuns.push(
    { run_id: "old-a", sweep: "drift-watch", started_at: new Date(oldMs).toISOString(), finished_at: new Date(oldMs).toISOString(), outcome: "ok", counts: {}, error_code: "" },
    { run_id: "fresh-a", sweep: "drift-watch", started_at: new Date(freshMs).toISOString(), finished_at: new Date(freshMs).toISOString(), outcome: "ok", counts: {}, error_code: "" },
    { run_id: "old-b", sweep: "checkins", started_at: new Date(oldMs).toISOString(), finished_at: new Date(oldMs).toISOString(), outcome: "ok", counts: {}, error_code: "" },
  );

  await withSweepRun(db, "drift-watch", async () => ({ checked: 1 }));

  ok("the old row for THIS sweep (drift-watch) is gone", !state.sweepRuns.some((r) => r.run_id === "old-a"));
  ok("the fresh row for THIS sweep survives", state.sweepRuns.some((r) => r.run_id === "fresh-a"));
  ok("NEGATIVE CONTROL (c): an old row belonging to ANOTHER sweep (checkins) is untouched",
    state.sweepRuns.some((r) => r.run_id === "old-b"));
  // The run this call itself just wrote is present and not swept (it is
  // brand new, started_at = now()).
  ok("the just-written run for this sweep survives its own retention pass",
    state.sweepRuns.some((r) => r.sweep === "drift-watch" && r.outcome === "ok" && r.run_id !== "old-a" && r.run_id !== "fresh-a"));
}

{
  // The delete also fires on the FAILURE path (a thrown sweep still gets its
  // own retention pass, not only the success path).
  const state = freshState();
  const { db } = funnelDb(state);
  const oldMs = Date.now() - (SWEEP_RUN_RETENTION_DAYS + 1) * 86_400_000;
  state.sweepRuns.push({ run_id: "old-c", sweep: "pulse", started_at: new Date(oldMs).toISOString(), finished_at: new Date(oldMs).toISOString(), outcome: "failed", counts: {}, error_code: "x" });
  try {
    await withSweepRun(db, "pulse", async () => { throw new Error("boom"); });
  } catch { /* expected */ }
  ok("retention also runs on the FAILURE path", !state.sweepRuns.some((r) => r.run_id === "old-c"));
}

console.log(`\nfunnel: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
