#!/usr/bin/env node
// first-room.mjs — one command that takes a consented owner and walks the
// whole Room chain against the LIVE deployment: consent, upload, the
// processing DAG, Readiness, the review queue, publishing the Room, and then
// (with a second, follower, session) opening it, joining, saying one message,
// reading history back and leaving. Every response is printed verbatim.
//
//   BASE_URL=https://your-deploy.example VYAKTI_SESSION=<owner bearer> \
//   node scripts/first-room.mjs <audio.wav> --display-name "<name>"
//
// This is scripts/first-clone.mjs's sibling for Vyakti Rooms Phase 0
// ("hand-build one Room for one real creator"), same shape on purpose: env,
// base URL, bearer session, every stage printed with its REAL response, and
// the process stops at the first named refusal rather than degrading into a
// green run that proved nothing.
//
// ── the two rules it enforces on itself, unchanged from first-clone.mjs ────
// 1. NO STEP IS EVER SKIPPED SILENTLY. A missing credential is a printed SKIP
//    row naming the exact environment variable, and a locked Room is a
//    printed BLOCKED row naming every blocker, split waiting-on-you from
//    waiting-on-us (`context/decisions.md#a-step-is-never-silently-blocked`).
// 2. NOTHING IS INVENTED. A step is marked ok only after a real 2xx with a
//    real, parseable body. A 200 with an empty body is a FAILED step, never
//    a passed one — the same law `evals/first-room/run.mjs` pins with a
//    negative control.
//
// ── why the report variables are declared before anything can throw ───────
// `context/rejected.md#first-clone-reference-error-cannot-shadow-probe-failure`:
// a report built from `let`s declared AFTER the first stage that can throw is
// a temporal-dead-zone crash that replaces the real error with a ReferenceError
// the moment that stage fails. Every variable `summarize()` reads is a `var`,
// declared here, before stage 1.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { probeEnrollmentWav } from "../api/_audio/wav.js";

const [, , audioPathRaw, ...optionArgs] = process.argv;
const flags = new Map();
for (let i = 0; i < optionArgs.length; i += 1) {
  if (!optionArgs[i].startsWith("--")) continue;
  const key = optionArgs[i].slice(2);
  const next = optionArgs[i + 1];
  if (next === undefined || next.startsWith("--")) flags.set(key, true);
  else { flags.set(key, next); i += 1; }
}
const flag = (name, fallback = null) => (flags.has(name) ? flags.get(name) : fallback);
const DRY = flags.has("dry");
const SKIP_FOLLOWER = flags.has("skip-follower");

if (!audioPathRaw) {
  console.error(
    'usage: node scripts/first-room.mjs <audio.wav> [--replica-id <uuid> | --display-name "<name>"] ' +
    "[--room-slug <slug>] [--dry] [--skip-follower]",
  );
  process.exit(2);
}
const audioPath = resolve(audioPathRaw);
const replicaIdFlag = flag("replica-id");
const displayNameFlag = flag("display-name");
const roomSlugFlag = flag("room-slug");
if (!replicaIdFlag && !displayNameFlag && !DRY) {
  console.error("pass --replica-id <uuid> for an existing self replica, or --display-name \"<name>\" to create one");
  process.exit(2);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FOLLOWER_MESSAGE = "Hi, just saying hello and trying this out.";
// The floor under the SERVER's own decided interval (`next_poll_ms`), never a
// substitute for it. Defends against an absurdly small value in production;
// lowered in an eval so a fixture DAG does not sit through a real wait.
const POLL_MIN_MS = Number(process.env.FIRST_ROOM_POLL_MIN_MS || 1_000);
const POLL_MAX_WAIT_MS = Number(process.env.FIRST_ROOM_POLL_MAX_WAIT_MS || 30 * 60_000);

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

// ── the report, declared before stage 1 can throw ──────────────────────────
const stages = [];
const started = Date.now();
var replicaId = replicaIdFlag && UUID_RE.test(replicaIdFlag) ? replicaIdFlag.toLowerCase() : null;
var sourceId = null;
var roomSlug = null;
var roomLink = null;
var roomPublished = false;
var readinessOverall = null;
var readinessLocked = null;
var reviewQueueOpenCount = null;

function record(name, status, detail) {
  stages.push({ name, status, detail });
  const icon = { ok: "OK  ", skip: "SKIP", blocked: "BLKD", fail: "FAIL" }[status] || "?   ";
  console.log(`[${icon}] ${name.padEnd(16)} ${detail}`);
}

function summarize() {
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"─".repeat(78)}`);
  console.log("STEP              STATE   DETAIL");
  for (const stage of stages) {
    console.log(`${stage.name.padEnd(17)} ${stage.status.padEnd(7)} ${stage.detail}`);
  }
  console.log(`${"─".repeat(78)}`);
  const ok = stages.filter((s) => s.status === "ok").length;
  const skipped = stages.filter((s) => s.status === "skip").length;
  const blocked = stages.filter((s) => s.status === "blocked").length;
  const failed = stages.filter((s) => s.status === "fail").length;
  console.log(`STAGES    ${ok} ok, ${skipped} skipped, ${blocked} blocked, ${failed} failed, ${wall} s wall clock`);
  if (roomLink) console.log(`ROOM      ${roomLink} (${roomPublished ? "published" : "not published"})`);
}

function die(stage, error) {
  record(stage, "fail", `${error?.code || ""} ${error?.message || error}`.trim());
  summarize();
  process.exit(1);
}

function stop(stage, status, detail) {
  record(stage, status, detail);
  summarize();
  process.exit(1);
}

// ═════════════════════════════════════════════════════════════════════════
// --dry: print the plan and the payload shapes, call nothing.
// ═════════════════════════════════════════════════════════════════════════
if (DRY) {
  const plan = [
    ["probe", "local", "read the WAV, validate the canonical enrollment format"],
    ["replica", "POST /api/replica", '{op:"create", display_name} or a GET by --replica-id'],
    ["consent", "POST /api/replica-consent", '{op:"grant", replica_id, scopes:["capture","storage","transcription"], attestations:{...}}'],
    ["upload", "POST /api/replica-source (x2) + PUT", '{op:"create_upload", replica_id, kind:"audio", mime:"audio/wav", byte_size, sha256, contains_third_parties:false, purpose:"memory"} then a signed PUT then {op:"finalize", replica_id, source_id}'],
    ["processing", "GET /api/replica-activity (polled)", "?replica_id=... until the upload_processing job reaches a terminal state"],
    ["readiness", "GET /api/readiness", "?replica_id=... the five parts, the overall, the publish lock"],
    ["review-queue", "POST /api/review-queue", '{op:"generate", replica_id}, fills the queue, never decides a card'],
    ["room-create", "POST /api/room-publish", '{op:"create", replica_id, slug?}'],
    ["room-publish", "POST /api/room-publish", '{op:"publish", replica_id}, 409 with a blocker list if locked'],
    ["follower-open", "POST /api/room", '{op:"open", room:"<slug>"}'],
    ["follower-join", "POST /api/room", '{op:"join", room:"<slug>", age_18:true, remember:true}'],
    ["follower-say", "POST /api/room", '{op:"say", session, message:"<text>", thread:null}'],
    ["follower-history", "POST /api/room", '{op:"history", session, thread:null}'],
    ["follower-forget", "POST /api/room", '{op:"forget", session}'],
  ];
  console.log("PLAN (nothing below this line is called)\n");
  for (const [name, where, shape] of plan) {
    console.log(`${name.padEnd(16)} ${where}`);
    console.log(`${"".padEnd(16)} ${shape}\n`);
  }
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════
// env
// ═════════════════════════════════════════════════════════════════════════
const BASE_URL = String(process.env.BASE_URL || "").replace(/\/+$/, "");
const OWNER_TOKEN = String(process.env.VYAKTI_SESSION || "");
const FOLLOWER_TOKEN = String(process.env.VYAKTI_FOLLOWER_SESSION || "");
if (!BASE_URL || !OWNER_TOKEN) {
  console.error("set BASE_URL and VYAKTI_SESSION (the owner's bearer session token) before running this");
  process.exit(2);
}

/** One HTTP call. Marks a step "ok" only for a real 2xx with a real,
 *  parseable JSON body — a 200 with an empty or non-JSON body is a refusal,
 *  not a pass. This is the one place that rule lives, so every stage below
 *  inherits it rather than re-deciding it. */
async function request(method, path, { token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  if (!response.ok) {
    const code = parsed?.error || `http_${response.status}`;
    throw Object.assign(new Error(`${method} ${path} -> ${response.status} ${code}`), {
      code, status: response.status, details: parsed?.details, body: parsed,
    });
  }
  if (!text) {
    throw Object.assign(new Error(`${method} ${path} -> 200 with an empty body`), { code: "empty_response" });
  }
  if (parsed === null) {
    throw Object.assign(new Error(`${method} ${path} -> 200 with a body that is not JSON`), { code: "invalid_json_response" });
  }
  return parsed;
}

// ═════════════════════════════════════════════════════════════════════════
// 1. probe — local, always runs, before anything spends a network round trip.
// ═════════════════════════════════════════════════════════════════════════
let reference;
let probe;
try {
  reference = readFileSync(audioPath);
  probe = probeEnrollmentWav(reference);
  record("probe", "ok",
    `${(probe.durationMs / 1000).toFixed(1)} s, ${probe.sampleRate} Hz mono, rms ${probe.rms.toFixed(4)}, peak ${probe.peak.toFixed(3)}, voiced ${(probe.activeRatio * 100).toFixed(0)}%`);
} catch (error) {
  die("probe", Object.assign(error, {
    message: `${error?.code || error?.message}: expected canonical 24 kHz mono PCM16 WAV, convert with "ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le out.wav"`,
  }));
}
const referenceSha = sha(reference);

// ═════════════════════════════════════════════════════════════════════════
// 2. replica — resolve the one named in --replica-id, or create one.
// ═════════════════════════════════════════════════════════════════════════
try {
  if (replicaId) {
    const got = await request("GET", `/api/replica?replica_id=${encodeURIComponent(replicaId)}`, { token: OWNER_TOKEN });
    record("replica", "ok", `${got.replica.display_name} (${replicaId}) lifecycle=${got.replica.lifecycle}`);
  } else {
    const created = await request("POST", "/api/replica", { token: OWNER_TOKEN, body: { op: "create", display_name: displayNameFlag } });
    replicaId = created.replica.replica_id;
    record("replica", "ok", `created ${created.replica.display_name} (${replicaId})`);
  }
} catch (error) {
  die("replica", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 3. consent — the three scopes a lecture upload needs.
// ═════════════════════════════════════════════════════════════════════════
try {
  const granted = await request("POST", "/api/replica-consent", {
    token: OWNER_TOKEN,
    body: {
      op: "grant",
      replica_id: replicaId,
      scopes: ["capture", "storage", "transcription"],
      attestations: { is_self: true, is_adult: true, has_source_rights: true, understands_synthetic_disclosure: true },
    },
  });
  record("consent", "ok", `${granted.consents.length} scope(s) granted`);
} catch (error) {
  die("consent", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 4. upload — create the signed upload, PUT the bytes, finalize.
// ═════════════════════════════════════════════════════════════════════════
try {
  const created = await request("POST", "/api/replica-source", {
    token: OWNER_TOKEN,
    body: {
      op: "create_upload", replica_id: replicaId, kind: "audio", mime: "audio/wav",
      byte_size: reference.length, sha256: referenceSha, contains_third_parties: false, purpose: "memory",
    },
  });
  sourceId = created.source.source_id;
  const put = await fetch(created.upload.url, {
    method: created.upload.method, headers: created.upload.headers, body: reference,
    signal: AbortSignal.timeout(300_000),
  });
  if (!put.ok) throw Object.assign(new Error(`private upload PUT -> ${put.status}`), { code: "storage_put_failed" });
  const finalized = await request("POST", "/api/replica-source", {
    token: OWNER_TOKEN, body: { op: "finalize", replica_id: replicaId, source_id: sourceId },
  });
  record("upload", "ok", `source ${sourceId} state=${finalized.source.state}`);
} catch (error) {
  die("upload", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 5. processing — poll the activity read until the DAG job for this source
//    reaches a terminal state. The interval is the SERVER's own decision
//    (`next_poll_ms`); a stalled job (nothing in flight, this job still not
//    terminal) is reported rather than polled forever.
// ═════════════════════════════════════════════════════════════════════════
try {
  const jobRef = `upload_processing:${sourceId}`;
  let last = "";
  let unchanged = 0;
  const deadline = Date.now() + POLL_MAX_WAIT_MS;
  for (;;) {
    const view = await request("GET", `/api/replica-activity?replica_id=${encodeURIComponent(replicaId)}&unchanged=${unchanged}`, { token: OWNER_TOKEN });
    const job = view.jobs.find((entry) => entry.job_id === jobRef);
    if (!job) throw Object.assign(new Error("upload_processing job never appeared for this source"), { code: "processing_job_missing" });
    const line = `${job.state}${job.progress ? ` (${job.progress.done}/${job.progress.total} ${job.progress.unit})` : ""}: ${job.state_reason || ""}`;
    if (line !== last) {
      console.log(`       .. ${line}`);
      last = line;
      unchanged = 0;
    } else {
      unchanged += 1;
    }
    if (job.state === "done") {
      record("processing", "ok", line);
      break;
    }
    if (job.state === "failed" || job.state === "blocked") {
      throw Object.assign(new Error(job.state_reason || `processing ${job.state}`), { code: `processing_${job.state}` });
    }
    if (view.next_poll_ms == null) {
      throw Object.assign(new Error("nothing is in flight and this job never reached done"), { code: "processing_stalled" });
    }
    if (Date.now() > deadline) {
      throw Object.assign(new Error(`still ${job.state} after ${Math.round(POLL_MAX_WAIT_MS / 60_000)} minutes`), { code: "processing_timeout" });
    }
    await new Promise((r) => setTimeout(r, Math.max(view.next_poll_ms, POLL_MIN_MS)));
  }
} catch (error) {
  die("processing", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 6. readiness — the five parts, the overall, the lock verdict.
// ═════════════════════════════════════════════════════════════════════════
try {
  const { readiness } = await request("GET", `/api/readiness?replica_id=${encodeURIComponent(replicaId)}`, { token: OWNER_TOKEN });
  readinessOverall = readiness.overall;
  readinessLocked = readiness.publish_locked;
  for (const part of readiness.parts) {
    const value = part.measured ? `${part.value}` : "not measured yet";
    console.log(`       .. ${part.label.padEnd(22)} ${value.padEnd(16)} ${part.detail}`);
  }
  record("readiness", "ok",
    `overall ${readiness.overall ?? "undefined"}, publish_locked=${readiness.publish_locked}, weakest=${readiness.weakest_part}` +
    (readiness.suggested_action ? `, next: ${readiness.suggested_action.label}` : ""));
} catch (error) {
  die("readiness", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 7. review-queue — fill it. Deciding a card is the creator's own job, so
//    this script never calls {op:"decide"}.
// ═════════════════════════════════════════════════════════════════════════
try {
  const result = await request("POST", "/api/review-queue", {
    token: OWNER_TOKEN, body: { op: "generate", replica_id: replicaId },
  });
  reviewQueueOpenCount = result.queue?.open_count ?? null;
  record("review-queue", "ok",
    `${result.written} card(s) written, ${result.dropped ?? 0} dropped, ${reviewQueueOpenCount ?? "?"} open` +
    (result.questions_unavailable ? `, questions unavailable: ${result.questions_unavailable}` : ""));
} catch (error) {
  die("review-queue", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 8. room-create — set up the address, or hand back the one that exists.
// ═════════════════════════════════════════════════════════════════════════
try {
  const { room } = await request("POST", "/api/room-publish", {
    token: OWNER_TOKEN, body: { op: "create", replica_id: replicaId, slug: roomSlugFlag || undefined },
  });
  roomSlug = room.slug;
  roomLink = `${BASE_URL}/r/${roomSlug}`;
  record("room-create", "ok", `slug "${roomSlug}", ${roomLink}`);
} catch (error) {
  die("room-create", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 9. room-publish — set it live, or print exactly what is holding it back.
// ═════════════════════════════════════════════════════════════════════════
try {
  const { room } = await request("POST", "/api/room-publish", {
    token: OWNER_TOKEN, body: { op: "publish", replica_id: replicaId },
  });
  roomPublished = room.published === true;
  record("room-publish", "ok", `published_at=${room.published_at}`);
} catch (error) {
  if (error.code === "room_publish_locked" && error.details) {
    const { waiting_on_you = [], waiting_on_us = [] } = error.details;
    console.log("       .. waiting on you:");
    for (const row of waiting_on_you) console.log(`          - ${row.headline} ${row.next}`);
    console.log("       .. waiting on us:");
    for (const row of waiting_on_us) console.log(`          - ${row.headline} ${row.next}`);
    stop("room-publish", "blocked", `locked, ${waiting_on_you.length} waiting on you, ${waiting_on_us.length} waiting on us`);
  }
  die("room-publish", error);
}

// ═════════════════════════════════════════════════════════════════════════
// 10. the follower side — a SECOND session, never the owner's.
// ═════════════════════════════════════════════════════════════════════════
if (SKIP_FOLLOWER) {
  // Not part of this run at all: no row, no exit-code penalty. A deliberate
  // opt-out is not a stage that "did not run" in the sense the header means.
} else if (!FOLLOWER_TOKEN) {
  record("follower", "skip", "not run, set VYAKTI_FOLLOWER_SESSION to a second, follower, bearer session");
} else {
  let session = null;
  let followerStep = "follower-open";
  try {
    const opened = await request("POST", "/api/room", { token: FOLLOWER_TOKEN, body: { op: "open", room: roomSlug } });
    record("follower-open", "ok", `${opened.room.name}, joined=${opened.joined}`);

    followerStep = "follower-join";
    const joined = await request("POST", "/api/room", {
      token: FOLLOWER_TOKEN, body: { op: "join", room: roomSlug, age_18: true, remember: true },
    });
    session = joined.session;
    record("follower-join", "ok", `remembers=${joined.follower.remembers}, messages_left=${joined.follower.messages_left}`);

    followerStep = "follower-say";
    const said = await request("POST", "/api/room", {
      body: { op: "say", session, message: FOLLOWER_MESSAGE, thread: null, transcript: [] },
    });
    session = said.session;
    record("follower-say", "ok", `reply: "${said.reply || "(nothing said)"}", quota ${said.quota.messages_used}/${said.quota.messages_included}`);

    followerStep = "follower-history";
    const history = await request("POST", "/api/room", { body: { op: "history", session, thread: null } });
    record("follower-history", "ok", `remembers=${history.remembers}, ${history.turns?.length ?? 0} turn(s)`);

    followerStep = "follower-forget";
    const forgot = await request("POST", "/api/room", { token: FOLLOWER_TOKEN, body: { op: "forget", session } });
    record("follower-forget", "ok", `forgotten=${forgot.forgotten}, ${Object.keys(forgot.deleted || {}).length} table(s) touched`);
  } catch (error) {
    die(followerStep, error);
  }
}

summarize();
process.exit(stages.some((stage) => stage.status !== "ok") ? 1 : 0);
