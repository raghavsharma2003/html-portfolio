// WS-AF. The activity surface's offline gate.
//
// Contract: the owner's ask, verbatim — "I should also see that have we
// received the YT video and that processing done or not, and all the other
// processing going on we should see, in a user view."
//
// ── what this suite can and cannot see ───────────────────────────────────
// It drives the REAL read (api/_replica-activity.js) against a fake database,
// the REAL normalisers against real row shapes, and reads the REAL SQL text of
// every statement the read issues. So it can see the shape, the state mapping,
// the ownership predicates, the progress rule, the deployment verdicts and the
// poll arithmetic.
//
// It CANNOT see SQL types or referential integrity —
// `offline-mocks-cannot-type-check-sql`, and a mock cannot even tell you the
// statement PARSES. Those are covered from the other side: every statement in
// this lane is on `evals/sqlcast`'s STRICT surface, and migration 060 has never
// been applied to a database. NO STATEMENT IN THIS LANE HAS EVER BEEN EXPLAINED
// — said out loud here rather than implied by a green line.
//
// ── the fake database routes on STATEMENT SHAPE, never on a table name ────
// `router-matched-a-table-instead-of-a-statement`. Each branch matches a phrase
// unique to ONE statement, and an unmatched statement THROWS rather than
// returning [], because an empty answer from a mock is indistinguishable from a
// correct empty answer from Postgres.
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const load = (rel) => import(pathToFileURL(join(REPO, rel)).href);
const read = (rel) => readFileSync(join(REPO, rel), "utf8");

const A = await load("api/_replica-activity.js");
const pipeline = await load("api/_replica-processing/pipeline.js");

let failed = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) return true;
  failed++;
  console.log(`  FAIL ${what}`);
  return false;
};
const eq = (a, b, what) => ok(Object.is(a, b), `${what} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const ts = (minutesAgo) => new Date(Date.now() - minutesAgo * 60_000).toISOString();

// ═════════════════════════════════════════════════════════════════════════
// the fake database
// ═════════════════════════════════════════════════════════════════════════

function fakeDb(rows = {}, options = {}) {
  const state = { statements: [], unmatched: [] };
  const db = async (sql, params = []) => {
    state.statements.push({ sql, params });
    const has = (phrase) => sql.includes(phrase);
    // The ownership gate. `owned` is answered ONLY when the owner parameter
    // matches, which is how a stranger's read returns null without any branch
    // in JavaScript doing the filtering.
    if (has("from vy_replica\n") || has("select replica_id, display_name from vy_replica")) {
      return params[1] === OWNER && params[0] === REPLICA ? [{ replica_id: REPLICA, display_name: "Test" }] : [];
    }
    if (has("from vy_replica_source s")) return options.owned === false ? [] : (rows.sources || []);
    if (has("from vy_ingest_run")) return rows.videos || [];
    if (has("from vy_channel_watch")) return rows.watches || [];
    if (has("from vy_context_item")) return rows.items || [];
    if (has("from vy_replica_model_build")) return rows.builds || [];
    if (has("from vy_mirror_finetune_job")) return rows.finetunes || [];
    if (has("from vy_replica_erasure_job")) return rows.erasures || [];
    if (has("from vy_replica_activity")) return rows.events || [];
    if (has("insert into vy_replica_activity")) {
      state.written = state.written || [];
      state.written.push(params);
      return [];
    }
    state.unmatched.push(sql.slice(0, 60));
    throw new Error(`fake db has no branch for: ${sql.slice(0, 60)}`);
  };
  db.state = state;
  return db;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. THE ONE SHAPE, ACROSS EVERY LANE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. one shape across every lane ──");

const SHAPE = ["job_id", "ref", "lane", "subject", "state", "state_reason",
  "started_at", "updated_at", "finished_at", "progress", "next_action", "in_flight"];

const SAMPLES = {
  upload_processing: A.normaliseUpload({
    source_id: "11111111-1111-4111-8111-111111111111", kind: "audio", mime: "audio/wav",
    byte_size: 4_400_000, duration_ms: 71_000, state: "processing", rejection_code: "",
    created_at: ts(9), updated_at: ts(3), steps_done: 3, last_job_at: ts(3),
    failed_step: null, failure_code: null, failure_state: null, active_step: "transcribe", attempts: 1,
  }),
  channel_video: A.normaliseChannelVideo({
    run_id: "22222222-2222-4222-8222-222222222222", video_ref: "dQw4w9WgXcQ",
    video_title: "Rotational Motion, Lecture 4", status: "proposed", failure_code: "",
    proposed_delta_count: 7, decided_at: null, created_at: ts(40), updated_at: ts(11),
  }),
  channel_watch: A.normaliseChannelWatch({
    watch_id: "33333333-3333-4333-8333-333333333333", channel_url: "https://www.youtube.com/@teacher",
    status: "active", last_checked_at: ts(6), last_sweep_state: "checked",
    last_sweep_reason: "", last_sweep_videos: 2, created_at: ts(9000),
  }),
  context_item: A.normaliseContextItem({
    item_id: "44444444-4444-4444-8444-444444444444", source_name: "notes.pdf", source_url: "",
    status: "mined", refusal_reason: "", routed_to: "", mine_skip_reason: "",
    run_id: "55555555-5555-4555-8555-555555555555", created_at: ts(30), updated_at: ts(29),
  }),
  voice_model_build: A.normaliseModelBuild({
    build_id: "66666666-6666-4666-8666-666666666666", build_kind: "voice_genome",
    state: "building", attempt: 1, failure_code: "", created_at: ts(20), updated_at: ts(2),
  }),
  mirror_finetune: A.normaliseFinetune({
    job_id: "77777777-7777-4777-8777-777777777777", state: "queued",
    reference_windows: 4, reference_ms: 41_000, requested_at: ts(120),
  }),
  erasure: A.normaliseErasure({
    job_id: "88888888-8888-4888-8888-888888888888", state: "running", attempts: 0,
    last_error_code: "", requested_at: ts(5), started_at: ts(4), completed_at: null, updated_at: ts(1),
  }),
};

for (const [lane, entry] of Object.entries(SAMPLES)) {
  eq(Object.keys(entry).sort().join(","), [...SHAPE].sort().join(","), `${lane} carries exactly the normalised shape`);
  eq(entry.lane, lane, `${lane} names its own lane`);
  ok(A.ACTIVITY_STATES.includes(entry.state), `${lane} reports one of the seven states (${entry.state})`);
  ok(entry.subject.length > 0, `${lane} names WHAT it is about`);
  ok(entry.state_reason.length > 0, `${lane} says why it is in that state`);
  ok(typeof entry.next_action?.kind === "string", `${lane} carries a next action kind`);
}

eq(Object.keys(SAMPLES).sort().join(","), Object.keys(A.ACTIVITY_LANES).sort().join(","),
  "every declared lane has a sample here (a lane added without one fails this)");

// ═════════════════════════════════════════════════════════════════════════
// 2. NO FAKE PROGRESS, WITH A NEGATIVE CONTROL
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. no fake progress ──");

for (const [lane, entry] of Object.entries(SAMPLES)) {
  if (lane === "upload_processing") continue;
  eq(entry.progress, null, `${lane} emits NO progress, because it has no real fraction`);
}

eq(SAMPLES.upload_processing.progress?.done, 3, "the one measurable lane reports its real numerator");
eq(SAMPLES.upload_processing.progress?.total, A.AUDIO_DAG_STEPS, "...and the DAG's length as the denominator");
eq(SAMPLES.upload_processing.progress?.unit, "steps", "...counted in steps, not percent");

// The denominator is a real property of the pipeline, not a number someone
// liked. If a ninth step is added to AUDIO_PROCESSING_DAG and this constant is
// not, every upload would silently report 8/8 while a step was still to run.
eq(Object.keys(pipeline.AUDIO_PROCESSING_DAG).length, A.AUDIO_DAG_STEPS,
  "the denominator equals the real length of AUDIO_PROCESSING_DAG");

{
  // NEGATIVE CONTROL. A lane that DID emit a fraction where none exists must be
  // caught by the property above rather than by inspection. Fabricate one and
  // confirm the check that guards it is real.
  const fabricated = { ...SAMPLES.channel_video, progress: { done: 2, total: 4, unit: "steps" } };
  const guard = (entry) => entry.lane === "upload_processing" || entry.progress === null;
  eq(guard(fabricated), false, "negative control: a fabricated fraction on the channel lane is REJECTED");
  eq(guard(SAMPLES.channel_video), true, "...and the real channel row passes the same guard");
}

{
  // A source that is not audio or video has no DAG at all
  // (initialProcessingSteps returns [] for it), so it must report blocked with
  // the reason, never `running` with a bar.
  const document = A.normaliseUpload({
    source_id: "99999999-9999-4999-8999-999999999999", kind: "document", mime: "application/pdf",
    byte_size: 90_000, duration_ms: null, state: "quarantined", rejection_code: "",
    created_at: ts(50), updated_at: ts(50), steps_done: 0, last_job_at: null,
    failed_step: null, failure_code: null, failure_state: null, active_step: null, attempts: 0,
  });
  eq(document.state, "blocked", "a document source is BLOCKED, not silently pending forever");
  eq(document.progress, null, "...and carries no progress");
  ok(/audio and video/.test(document.state_reason), "...and the reason names what is actually processed today");
  eq(pipeline.initialProcessingSteps({ state: "quarantined", kind: "document" }).length, 0,
    "...which is exactly what the real pipeline does with it");
}

// ═════════════════════════════════════════════════════════════════════════
// 3. A FAILURE REPORTS WHY, IN WORDS
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. failures say why ──");

{
  const botChecked = A.normaliseChannelWatch({
    watch_id: "33333333-3333-4333-8333-333333333333", channel_url: "https://www.youtube.com/@teacher",
    status: "active", last_checked_at: ts(2), last_sweep_state: "failed",
    last_sweep_reason: "channel_extract_extractor_bot_check", last_sweep_videos: 0, created_at: ts(900),
  });
  eq(botChecked.state, "failed", "a bot-checked sweep reports failed");
  ok(/robot/.test(botChecked.state_reason), "...in words, not as a code");
  ok(!/_/.test(botChecked.state_reason), "...with no underscored identifier left in the sentence");
  ok(/not caused by anything you did/.test(botChecked.state_reason),
    "...and it does not blame the owner for a datacentre IP problem");
}

{
  // An UNMAPPED code must still be legible and still be quotable. A generic
  // apology would be indistinguishable from a bug.
  const reason = A.reasonFor("some_new_provider_code");
  eq(reason, "Some new provider code.", "an unmapped failure code opens out rather than becoming a generic apology");
}

{
  const failedVideo = A.normaliseChannelVideo({
    run_id: "22222222-2222-4222-8222-222222222222", video_ref: "abc", video_title: "Lecture 9",
    status: "failed", failure_code: "asr_unavailable", proposed_delta_count: 0,
    decided_at: null, created_at: ts(60), updated_at: ts(55),
  });
  eq(failedVideo.state, "failed", "a failed video run reports failed");
  ok(failedVideo.finished_at !== null, "...and says when it stopped");
  eq(failedVideo.next_action.kind, "wait", "...and offers no button, because no retry op exists for it");
  ok(/next channel check/.test(failedVideo.next_action.label), "...it states what will happen on its own instead");
}

{
  // The one safe one-click retry in the platform.
  const stranded = A.normaliseUpload({
    source_id: "11111111-1111-4111-8111-111111111111", kind: "audio", mime: "audio/wav",
    byte_size: 4_400_000, duration_ms: 0, state: "pending_upload", rejection_code: "",
    created_at: ts(300), updated_at: ts(300), steps_done: 0, last_job_at: null,
    failed_step: null, failure_code: null, failure_state: null, active_step: null, attempts: 0,
  });
  eq(stranded.next_action.kind, "retry", "a stranded upload offers the ONE safe retry");
  eq(stranded.ref, "11111111-1111-4111-8111-111111111111", "...and carries the source id the retry has to send");
}

{
  // A rejected recording must NOT offer a one-click retry: nothing on the
  // server can re-run it, only the owner can supply different bytes.
  const rejected = A.normaliseUpload({
    source_id: "11111111-1111-4111-8111-111111111111", kind: "audio", mime: "audio/wav",
    byte_size: 10, duration_ms: 0, state: "rejected", rejection_code: "no_audio_stream",
    created_at: ts(300), updated_at: ts(299), steps_done: 0, last_job_at: null,
    failed_step: null, failure_code: null, failure_state: null, active_step: null, attempts: 0,
  });
  eq(rejected.next_action.kind, "fix_input", "a rejected recording asks the owner to act, it does not offer a fake retry");
  ok(/no audio track/.test(rejected.state_reason), "...and the reason is the actual problem with the file");
}

// ═════════════════════════════════════════════════════════════════════════
// 4. THE FINE-TUNE LANE SAYS NOBODY IS RUNNING IT
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. a lane with no runner says so ──");

eq(SAMPLES.mirror_finetune.state, "queued", "a queued fine-tune is queued");
eq(SAMPLES.mirror_finetune.in_flight, false,
  "...and is NOT in flight, because nothing in this repo runs it");
ok(/not connected/.test(SAMPLES.mirror_finetune.state_reason),
  "...and the reason says out loud that the training service is not connected");
eq(A.ACTIVITY_LANES.mirror_finetune.advances_on, "nobody", "the lane declares that nobody advances it");

// The corresponding truth on the schema side: migration 059 gave this table no
// lease columns and no attempt counter, which is what makes 'running' unsayable.
{
  const migration = read("db/migrations/059_mirror_call.sql");
  const table = migration.slice(migration.lastIndexOf("create table if not exists vy_mirror_finetune_job"));
  // Comments out first: 059's own body explains IN A COMMENT that nothing
  // leases one, so a naive scan for the word finds the explanation and reports
  // the opposite of what it says.
  const body = table.slice(0, table.indexOf("\n);")).replace(/--[^\n]*/g, "");
  ok(!/lease/.test(body), "vy_mirror_finetune_job still has no lease column to make 'running' true");
  ok(!/attempt/.test(body), "...and no attempt counter either");
}

// ═════════════════════════════════════════════════════════════════════════
// 5. DEPLOYMENT: AN ABSENT LANE IS NAMED, NOT RENDERED AS AN EMPTY SUCCESS
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. honest not-deployed ──");

{
  const bare = A.laneDeployment({});
  const byLane = new Map(bare.map((entry) => [entry.lane, entry]));
  eq(bare.length, Object.keys(A.ACTIVITY_LANES).length, "every lane gets a deployment verdict");
  eq(byLane.get("channel_video").deployed, false, "with no env, the YouTube lane is NOT deployed");
  ok(byLane.get("channel_video").missing.length > 0, "...and what is missing is NAMED");
  ok(byLane.get("channel_video").missing.some((m) => /SARVAM_API_KEY/.test(m)),
    "...including the transcription key by its real variable name");
  eq(byLane.get("mirror_finetune").deployed, false, "the fine-tune lane is not deployed");
  ok(/does not exist in this repo/.test(byLane.get("mirror_finetune").missing[0]),
    "...and its missing piece is a SERVICE, named as one, not an env var that would be a lie");
  for (const entry of bare) {
    if (!entry.deployed) ok(entry.missing.length > 0, `${entry.lane}: an undeployed lane never reports an empty reason`);
  }
}

{
  const configured = A.laneDeployment({
    YOUTUBE_API_KEY: "k", SARVAM_API_KEY: "k", CRON_SECRET: "s",
    // SUPABASE_SERVICE_ROLE_KEY is the name the rest of the repo actually uses.
    // This fixture carried the same typo as the requirement list it checks, so
    // the two agreed with each other and disagreed with production: the lane
    // was asserted deployed here while reporting "not connected yet" to a real
    // owner whose recording had just completed all eight steps. A fixture that
    // repeats the bug under test cannot catch it.
    SUPABASE_URL: "https://x", SUPABASE_SERVICE_ROLE_KEY: "k",
  });
  const byLane = new Map(configured.map((entry) => [entry.lane, entry]));
  eq(byLane.get("channel_video").deployed, true, "with the env set, the YouTube lane reports deployed");
  eq(byLane.get("channel_video").missing.length, 0, "...and names nothing missing");
  eq(byLane.get("upload_processing").deployed, true, "the upload lane reports deployed");
  // NEGATIVE CONTROL for the typo above: the OLD short name must NOT satisfy
  // the upload lane. Without this, someone can reintroduce SUPABASE_SERVICE_KEY
  // in both the requirement list and this fixture, watch them agree, and ship a
  // lane that tells every owner it is not connected while it is running.
  {
    const wrongName = new Map(A.laneDeployment({
      SUPABASE_URL: "https://x", SUPABASE_SERVICE_KEY: "k",
    }).map((entry) => [entry.lane, entry]));
    eq(wrongName.get("upload_processing").deployed, false,
      "...and the old SUPABASE_SERVICE_KEY name does not satisfy it");
    eq(wrongName.get("upload_processing").missing.includes("SUPABASE_SERVICE_ROLE_KEY"), true,
      "...naming the variable that is actually required");
  }
  // NEGATIVE CONTROL: the alternation must be a real OR, not a substring match
  // that any of the three keys satisfies by accident.
  const oauthOnly = A.laneDeployment({ YOUTUBE_OAUTH_CLIENT_ID: "id", SARVAM_API_KEY: "k", CRON_SECRET: "s" });
  eq(new Map(oauthOnly.map((e) => [e.lane, e])).get("channel_video").deployed, true,
    "either provider credential satisfies the channel lane");
  const neither = A.laneDeployment({ SARVAM_API_KEY: "k", CRON_SECRET: "s" });
  eq(new Map(neither.map((e) => [e.lane, e])).get("channel_video").deployed, false,
    "negative control: neither credential leaves the lane undeployed");
}

// ═════════════════════════════════════════════════════════════════════════
// 6. POLLING: BACKOFF, AND THE STOP RULE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. polling ──");

eq(A.nextPollMs({ inFlight: false }), null, "nothing in flight: polling STOPS");
eq(A.nextPollMs({ inFlight: false, unchangedPolls: 9 }), null, "...however many polls have gone by");
eq(A.nextPollMs({ inFlight: true, unchangedPolls: 0 }), A.POLL_FLOOR_MS, "in flight and just changed: the floor");
eq(A.nextPollMs({ inFlight: true, unchangedPolls: 1 }), A.POLL_FLOOR_MS * 2, "one quiet poll doubles it");
eq(A.nextPollMs({ inFlight: true, unchangedPolls: 2 }), A.POLL_FLOOR_MS * 4, "two quiet polls double it again");
eq(A.nextPollMs({ inFlight: true, unchangedPolls: 40 }), A.POLL_CEILING_MS, "and it is capped, never unbounded");
ok(A.POLL_FLOOR_MS >= 3_000, "the floor is not faster than any lane can change");

{
  // The client half of the same rule, read off the shipping source rather than
  // reimplemented here: `dead-writers` in the other direction, a property that
  // is only true in the test is not true.
  const panel = read("src/studio/ActivityPanel.tsx");
  ok(/delay === null\) return/.test(panel), "the panel returns rather than rescheduling on a null interval");
  ok(!/setInterval\(/.test(panel), "the panel uses a self-scheduling timeout, never a fixed setInterval");
  ok(/clearTimeout/.test(panel), "...and clears its pending timer on unmount");
  const api = read("src/studio/activityApi.ts");
  ok(/generated_at/.test(api) && /deliberately not compared/.test(api),
    "the sameness test excludes generated_at, which would otherwise reset the backoff every poll");
}

// ═════════════════════════════════════════════════════════════════════════
// 7. OWNERSHIP IS A SQL PREDICATE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. ownership ──");

{
  const db = fakeDb({});
  const view = await A.readReplicaActivity(db, OWNER, REPLICA, { env: {} });
  ok(view !== null, "the owner gets their own replica's activity");
  const laneReads = db.state.statements.filter((s) => s.sql.trim().startsWith("select") && s.sql.includes("where"));
  for (const statement of laneReads) {
    ok(/owner_user_id = \$2::uuid/.test(statement.sql) || /owner_user_id = \$1::uuid/.test(statement.sql) ||
       /o\.owner_user_id/.test(statement.sql),
      `every read carries an owner predicate: ${statement.sql.slice(0, 46).replace(/\s+/g, " ")}`);
    eq(statement.params[1], OWNER, "...bound to the authenticated owner, never to anything from the request");
  }
}

{
  const db = fakeDb({});
  const view = await A.readReplicaActivity(db, STRANGER, REPLICA, { env: {} });
  eq(view, null, "a stranger asking for someone else's replica gets nothing");
  eq(db.state.statements.length, 1, "...and no lane read runs at all after the gate refuses");
}

{
  const db = fakeDb({});
  let raised = "";
  try { await A.readReplicaActivity(db, OWNER, "not-a-uuid", { env: {} }); }
  catch (error) { raised = error.code || ""; }
  eq(raised, "replica_id_required", "a malformed replica id is refused before any statement runs");
}

{
  // The read module must never filter in JavaScript. Read the shipping source.
  const source = read("api/_replica-activity.js");
  const statements = [...source.matchAll(/`([^`]*\bfrom\s+vy_[^`]*)`/g)].map((m) => m[1]);
  ok(statements.length >= 8, `every lane read was found in the source (${statements.length})`);
  for (const sql of statements) {
    ok(/owner_user_id/.test(sql), `a statement without owner_user_id would fail here: ${sql.slice(0, 40).replace(/\s+/g, " ")}`);
  }
  ok(!/\.filter\([^)]*owner/i.test(source), "no ownership filter exists in JavaScript");
}

// ═════════════════════════════════════════════════════════════════════════
// 8. THE WHOLE READ, END TO END
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 8. the assembled view ──");

{
  const db = fakeDb({
    sources: [{
      source_id: "11111111-1111-4111-8111-111111111111", kind: "audio", mime: "audio/wav",
      byte_size: 4_400_000, duration_ms: 71_000, state: "processing", rejection_code: "",
      created_at: ts(9), updated_at: ts(3), steps_done: 3, last_job_at: ts(3),
      failed_step: null, failure_code: null, failure_state: null, active_step: "transcribe", attempts: 1,
    }],
    videos: [{
      run_id: "22222222-2222-4222-8222-222222222222", video_ref: "dQw4w9WgXcQ",
      video_title: "Rotational Motion, Lecture 4", status: "proposed", failure_code: "",
      proposed_delta_count: 7, decided_at: null, created_at: ts(40), updated_at: ts(11),
    }],
    watches: [{
      watch_id: "33333333-3333-4333-8333-333333333333", channel_url: "https://www.youtube.com/@teacher",
      status: "active", last_checked_at: ts(6), last_sweep_state: "checked",
      last_sweep_reason: "", last_sweep_videos: 2, created_at: ts(9000),
    }],
    events: [{
      lane: "channel_video", job_ref: "22222222-2222-4222-8222-222222222222",
      first_at: ts(39), last_at: ts(11), ended_at: null,
    }],
  });
  const view = await A.readReplicaActivity(db, OWNER, REPLICA, { env: {} });
  eq(view.jobs.length, 3, "one job per row, across three lanes");
  eq(view.in_flight, true, "the processing upload puts the view in flight");
  eq(view.next_poll_ms, A.POLL_FLOOR_MS, "...so a poll interval comes back");

  const video = view.jobs.find((j) => j.lane === "channel_video");
  eq(video.subject, "Rotational Motion, Lecture 4",
    "the YouTube row is named by the video's TITLE, which is the owner's actual question");
  eq(video.state, "waiting_on_you", "a proposed run is the owner's turn");
  ok(/7 suggestions/.test(video.state_reason), "...and says what came out of it");
  // The transition log is authoritative for the two timestamps no lane table
  // carries. `created_at` on the run row is ts(40); the log says ts(39).
  eq(video.started_at, ts(39).slice(0, 16) + video.started_at.slice(16),
    "started_at comes from the transition log where one exists");

  const watch = view.jobs.find((j) => j.lane === "channel_watch");
  eq(watch.in_flight, false, "a standing channel watch is never in flight between sweeps");

  // Sorted newest first, so the thing that just moved is the thing on top.
  const stamps = view.jobs.map((j) => j.updated_at);
  eq(stamps.join("|"), [...stamps].sort().reverse().join("|"), "jobs come back newest first");
}

{
  // A replica with nothing running must STOP the poll.
  const db = fakeDb({
    videos: [{
      run_id: "22222222-2222-4222-8222-222222222222", video_ref: "x", video_title: "Done",
      status: "applied", failure_code: "", proposed_delta_count: 3,
      decided_at: ts(100), created_at: ts(400), updated_at: ts(100),
    }],
  });
  const view = await A.readReplicaActivity(db, OWNER, REPLICA, { env: {} });
  eq(view.in_flight, false, "a finished-only replica is not in flight");
  eq(view.next_poll_ms, null, "...and the server tells the client to STOP polling");
}

{
  // A video row written before migration 060 has no title. It must degrade to
  // the id and never to a blank.
  const untitled = A.normaliseChannelVideo({
    run_id: "22222222-2222-4222-8222-222222222222", video_ref: "dQw4w9WgXcQ", video_title: "",
    status: "transcribed", failure_code: "", proposed_delta_count: 0,
    decided_at: null, created_at: ts(20), updated_at: ts(19),
  });
  eq(untitled.subject, "Video dQw4w9WgXcQ", "a pre-060 run degrades to its id, never to a blank row");
}

// ═════════════════════════════════════════════════════════════════════════
// 9. THE WRITE: FAIL-SOFT, AND THE FAILURE-NAMED RULE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 9. the activity write ──");

{
  const db = fakeDb({});
  eq(await A.recordActivity(db, {
    replicaId: REPLICA, ownerUserId: OWNER, lane: "channel_video",
    jobRef: "22222222-2222-4222-8222-222222222222", subject: "Lecture 4", state: "running", reason: "transcribed",
  }), true, "a well-formed event is written");
  eq(db.state.written.length, 1, "...as exactly one statement");
}

{
  const db = fakeDb({});
  eq(await A.recordActivity(db, {
    replicaId: REPLICA, ownerUserId: OWNER, lane: "channel_video",
    jobRef: "r", subject: "x", state: "failed", reason: "",
  }), false, "a failure with no reason is refused before it reaches the CHECK constraint");
  eq(db.state.written, undefined, "...and nothing is written");
}

{
  const db = fakeDb({});
  eq(await A.recordActivity(db, {
    replicaId: REPLICA, ownerUserId: OWNER, lane: "not_a_lane",
    jobRef: "r", subject: "x", state: "running",
  }), false, "an unknown lane is refused");
  eq(await A.recordActivity(db, {
    replicaId: REPLICA, ownerUserId: OWNER, lane: "channel_video",
    jobRef: "r", subject: "x", state: "halfway",
  }), false, "an invented state is refused");
}

{
  // FAIL-SOFT. A report must never be able to break the thing it reports on.
  const exploding = async () => { throw new Error("database on fire"); };
  eq(await A.recordActivity(exploding, {
    replicaId: REPLICA, ownerUserId: OWNER, lane: "channel_video",
    jobRef: "r", subject: "x", state: "running",
  }), false, "a throwing database does not propagate out of the writer");
}

{
  // And the caller must not branch on it. Read the shipping source.
  const ingest = read("api/_channel-ingest.js");
  ok(!/if\s*\(\s*await\s+recordActivity/.test(ingest), "the sweep never branches on the reporting write");
  ok(/last_sweep_state/.test(ingest), "the sweep records its own outcome on the watch row");
  ok(/video_title/.test(ingest), "...and persists the video title it was already handed");
}

// ═════════════════════════════════════════════════════════════════════════
// 10. THE MIGRATION, AND THE ERASURE REACH
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 10. migration 060 ──");

{
  const migration = read("db/migrations/062_replica_activity.sql");
  const schema = read("db/schema.sql");

  // The splitter in db/migrations/apply.mjs is small and takes one statement
  // per request. A DO block or a function would silently break an apply.
  ok(!/\bdo\s+\$\$/i.test(migration), "no DO blocks: the splitter does not handle them");
  ok(!/create\s+function/i.test(migration), "no functions, same reason");
  // Comments are stripped BEFORE the split, the way db/migrations/apply.mjs's
  // splitter does it: a semicolon inside a prose comment is not a statement
  // boundary, and treating it as one made this check fail on its own rationale.
  const statements = migration.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean);
  ok(statements.length >= 10, `every statement stands alone (${statements.length})`);
  for (const statement of statements) {
    ok(/^(create|alter)\b/i.test(statement),
      `each statement is idempotent DDL: ${statement.slice(0, 40).replace(/\s+/g, " ")}`);
  }
  for (const create of statements.filter((s) => /^create table/i.test(s))) {
    ok(/if not exists/i.test(create), "every create table is `if not exists`");
  }
  for (const idx of statements.filter((s) => /^create (unique )?index/i.test(s))) {
    ok(/if not exists/i.test(idx), "every create index is `if not exists`");
  }
  for (const add of statements.filter((s) => /^alter table .* add column/i.test(s))) {
    ok(/if not exists/i.test(add), "every add column is `if not exists`");
  }
  // Constraints use the drop-then-add pair, so a re-run cannot 42710.
  const added = statements.filter((s) => /add constraint/i.test(s))
    .map((s) => s.match(/add constraint (\w+)/i)[1]);
  for (const name of added) {
    ok(migration.includes(`drop constraint if exists ${name}`),
      `${name} is dropped before it is added, so the file re-runs`);
  }

  // Mirrored into the canonical schema, or a fresh deploy rebuilds a database
  // that is missing this table and every read here 500s.
  ok(schema.includes("create table if not exists vy_replica_activity"),
    "the table is mirrored into db/schema.sql");
  ok(schema.includes("add column if not exists video_title"), "video_title is mirrored");
  ok(schema.includes("add column if not exists last_sweep_state"), "last_sweep_state is mirrored");

  // The failure-named CHECK, which is what makes an unnamed failure impossible
  // rather than merely discouraged.
  ok(/state not in \('failed','blocked'\) or reason <> ''/.test(migration),
    "an unnamed failure is refused by Postgres, not by a code review");
  ok(/last_sweep_state <> 'failed' or last_sweep_reason <> ''/.test(migration),
    "...and the same rule holds on the channel watch");

  // No progress column, and there is not to be one.
  ok(!/\bprogress\b/.test(migration.split("create table if not exists vy_replica_activity")[1].split(");")[0]),
    "the table has no progress column, so no lane can be tempted to fill one");

  // Erasure reach, both layers.
  ok(/on delete cascade/i.test(migration), "the table cascades from vy_replica");
  const erasure = read("api/_replica-full-erasure.js");
  ok(/delete from vy_replica_activity/.test(erasure), "...and is ALSO deleted by name in the erasure cascade");
  ok(/owner_activity_trail/.test(erasure), "...and named as its own class on the deletion receipt");
}

// ═════════════════════════════════════════════════════════════════════════
// 11. THE UI'S OWN PROMISES, READ OFF THE SHIPPING SOURCE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 11. the surface ──");

{
  const panel = read("src/studio/ActivityPanel.tsx");
  const css = read("src/studio/activity.css");

  // Comments are stripped the way scripts/check-copy.mjs strips them, and
  // BEFORE anything is asserted. Every rule below is about what SHIPS to a
  // screen; a rule that reads the rationale above the code punishes writing the
  // rationale down, and the first version of this block did exactly that.
  const codeOnly = panel
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ""))
    .join("\n");

  ok(!/StudioApp/.test(codeOnly), "the panel does not reach into the wizard's file");
  ok(/vy-activity__skeleton/.test(codeOnly), "loading renders skeletons");
  ok(!/spinner|Spinner|<progress/.test(codeOnly), "...and never a spinner or a progress element");
  ok(/job\.progress \?/.test(codeOnly), "progress renders only when the server sent one");
  ok(!/%`|toFixed|percent/i.test(codeOnly), "no percentage is computed anywhere in the surface");
  ok(/NotConnected/.test(codeOnly) && /not connected yet/.test(codeOnly),
    "an undeployed lane renders a named notice rather than an empty list");
  ok(/lane\.missing\.join/.test(codeOnly), "...and names the missing piece");
  ok(/onPointerDown/.test(codeOnly), "press feedback fires on pointerdown, not on release");

  // WS-AE's slot asks for two MOODS, not one panel shown twice. The data is
  // identical; the order and the framing are not.
  ok(/MOODS/.test(codeOnly), "the panel carries the two moods WS-AE's mount asks for");
  ok(/processing-status-\$\{where\}/.test(codeOnly),
    "...and keeps the mount's own element id, so its anchors keep working");
  const moods = codeOnly.slice(codeOnly.indexOf("const MOODS"), codeOnly.indexOf("} as const;"));
  ok(/order: \["yours"/.test(moods), "on feed, the owner's turn leads");
  ok(/order: \["working"/.test(moods), "on meet, the UNFINISHED work leads, because that is the answer being asked for");
  ok(moods.indexOf("\"finished\"]") > 0, "...and finished work is last in both");
  ok(!codeOnly.includes("—") && !codeOnly.includes("–"), "no em-dash or en-dash in the panel's copy");
  ok(!/\bv\d+\.\d+|BETA|Build \d+|last sync/i.test(codeOnly), "no version stamp or sync strip in the copy");

  // Motion: transform and opacity only, and a reduced-motion branch.
  const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const transitions = [...cssCode.matchAll(/transition:([^;]+);/g)].map((m) => m[1]);
  ok(transitions.length > 0, "the stylesheet declares transitions at all");
  for (const t of transitions) {
    ok(!/\b(width|height|top|left|right|bottom|margin|padding|all)\b/.test(t),
      `a transition animates only transform or opacity: ${t.trim().slice(0, 40)}`);
  }
  ok(/prefers-reduced-motion/.test(cssCode), "the stylesheet answers prefers-reduced-motion");
  ok(/@keyframes vy-activity-sheen/.test(cssCode) && /animation: none/.test(cssCode),
    "...and the shimmer stops entirely under it, rather than merely speeding up");

  // Everything that can come from a token does. The exceptions are the physical
  // sizes a token scale does not have a name for: hairlines, the state dot and
  // the skeleton bones. Listed, so adding an eleventh ad-hoc value is a failing
  // check rather than a habit.
  const AD_HOC_ALLOWED = new Set(["1px", "2px", "3px", "4px", "6px", "10px", "12px", "13px", "14px", "5px", "64px", "260px", "400px"]);
  const strays = [...new Set([...cssCode.matchAll(/(\d+px)/g)].map((m) => m[1]))]
    .filter((value) => !AD_HOC_ALLOWED.has(value));
  eq(strays.join(","), "", "no ad-hoc sizes beyond the listed hairlines, dot and skeleton bones");
  ok(/var\(--space-/.test(cssCode) && /var\(--text-/.test(cssCode) && /var\(--motion-/.test(cssCode),
    "spacing, type and motion all come from design/tokens.css");
  ok(/vy-activity/.test(cssCode) && !/^\s*\.(?!vy-activity)[a-z]/m.test(cssCode.replace(/@[^{]*\{/g, "")),
    "every selector is namespaced, so the file cannot reach into studio.css's components");
}

// ═════════════════════════════════════════════════════════════════════════
// 12. THE HARNESS ITSELF
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 12. the harness ──");
{
  const db = fakeDb({});
  eq(db.state.unmatched.length, 0, "a fresh fake has no unmatched statements");
  let raised = "";
  try { await db("select 1 from somewhere_unknown", []); }
  catch (error) { raised = String(error.message).slice(0, 25); }
  eq(raised, "fake db has no branch for", "an unrecognised statement THROWS rather than answering []");
}

console.log(
  failed
    ? `\nreplicaactivity: ${failed} of ${checks} checks FAILED`
    : `\nreplicaactivity: ok (${checks} checks)`,
);
process.exit(failed ? 1 : 0);
