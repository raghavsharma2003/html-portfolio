// evals/first-room/run.mjs — drives the REAL scripts/first-room.mjs as a
// subprocess against a fake HTTP server (node:http, a random loopback port)
// that replays recorded response shapes. It never imports first-room.mjs's
// internals: the whole point is to prove what a human running the real
// command would see, spawn included.
//
// Four scenarios, matching the workstream's own list:
//   1. happy path, owner side and follower side, every step ok
//   2. refusal: room-publish locked by readiness (waiting_on_you/waiting_on_us)
//   3. refusal: room-create refused because the slug is taken
//   4. NEGATIVE CONTROL: a 200 with an empty body must FAIL the step, not
//      pass it, the exact rule first-room.mjs's own header names.
//
// Every assertion reads the script's own stdout, the same bytes a human
// running it would see, so a rewrite that keeps the words but breaks the
// contract is caught here.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(ROOT, "scripts", "first-room.mjs");
let checks = 0;

function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

// ── a fixture WAV that PASSES probeEnrollmentWav for real ─────────────────
// Canonical 24 kHz mono PCM16, one second of a 220 Hz tone well inside every
// signal/clipping/DC-offset bound `api/_audio/wav.js` checks. This is not a
// faked measurement: it is bytes a real recorder could have produced, used
// here only to get past local validation so the HTTP contract is what is
// under test.
function fixtureWav() {
  const sampleRate = 24_000;
  const frames = sampleRate; // 1.0 s
  const pcm = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i += 1) {
    const t = i / sampleRate;
    pcm.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 220 * t) * 6000), i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const workDir = mkdtempSync(join(tmpdir(), "first-room-eval-"));
const wavPath = join(workDir, "reference.wav");
writeFileSync(wavPath, fixtureWav());

// ── a tiny JSON router ──────────────────────────────────────────────────────
// A handler returning `undefined` is the negative control's own shape: the
// server answers 200 with NO body at all, which is exactly what a broken
// deploy can do and exactly what first-room.mjs must never call a pass.
function jsonServer(handlers) {
  return createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      let parsed = null;
      if (body) { try { parsed = JSON.parse(body); } catch { parsed = null; } }
      const key = `${req.method} ${url.pathname}`;
      const handler = handlers[key];
      if (!handler) {
        res.writeHead(404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: "not_found_in_fixture" }));
        return;
      }
      const result = handler({ query: Object.fromEntries(url.searchParams), body: parsed, req });
      if (result === undefined) { res.writeHead(200).end(); return; }
      const { status = 200, json } = result;
      res.writeHead(status, { "Content-Type": "application/json" }).end(JSON.stringify(json));
    });
  });
}

/** Runs the real script as a child process against `server`, returns its
 *  stdout/stderr/exit code. `execFile` rejects on a non-zero exit; the
 *  rejection still carries stdout/stderr/code, so both branches feed the
 *  same shape rather than needing two code paths. */
async function run(server, { skipFollower = false, followerToken = "follower-token-1", extraArgs = [] } = {}) {
  await new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  const args = [SCRIPT, wavPath, "--display-name", "Test Creator", ...extraArgs];
  if (skipFollower) args.push("--skip-follower");
  const env = {
    ...process.env,
    BASE_URL: base,
    VYAKTI_SESSION: "owner-token-1",
    ...(skipFollower ? {} : { VYAKTI_FOLLOWER_SESSION: followerToken }),
    FIRST_ROOM_POLL_MIN_MS: "5",
    FIRST_ROOM_POLL_MAX_WAIT_MS: "5000",
  };
  let result;
  try {
    result = await execFileAsync("node", args, { env, timeout: 30_000 });
  } catch (error) {
    result = error;
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  return { stdout: String(result.stdout || ""), stderr: String(result.stderr || ""), code: result.code ?? 0 };
}

// ═══════════════════════════════════════════════════════════════════════════
// SHARED FIXTURE PIECES — the owner-side lanes every scenario needs before it
// diverges: replica, consent, upload (including the storage PUT), the
// processing DAG, readiness, the review queue. `create` and `publish` are
// left to each scenario, since that is exactly where they diverge.
// ═══════════════════════════════════════════════════════════════════════════
function ownerLanesUpTo(createHandler, publishHandler) {
  const SOURCE_ID = "22222222-2222-4222-8222-222222222222";
  let activityCalls = 0;
  return {
    "POST /api/replica": () => ({
      status: 201,
      json: { replica: { replica_id: "11111111-1111-4111-8111-111111111111", display_name: "Test Creator", lifecycle: "active" } },
    }),
    "POST /api/replica-consent": () => ({ status: 201, json: { consents: [{ scope: "capture" }, { scope: "storage" }, { scope: "transcription" }] } }),
    "POST /api/replica-source": ({ body, req }) => {
      if (body.op === "create_upload") {
        return {
          status: 201,
          json: {
            source: { source_id: SOURCE_ID, state: "pending" },
            upload: { method: "PUT", url: `http://${req.headers.host}/fake-storage/obj`, headers: {}, expires_at: new Date(Date.now() + 3600_000).toISOString() },
          },
        };
      }
      return { status: 200, json: { source: { source_id: SOURCE_ID, state: "quarantined" } } }; // finalize
    },
    "PUT /fake-storage/obj": () => ({ status: 200, json: {} }),
    "GET /api/replica-activity": () => {
      activityCalls += 1;
      const jobId = `upload_processing:${SOURCE_ID}`;
      if (activityCalls === 1) {
        return { json: { jobs: [{ job_id: jobId, state: "queued", state_reason: "Received. Waiting for a worker to pick it up.", progress: null }], next_poll_ms: 5 } };
      }
      if (activityCalls === 2) {
        return { json: { jobs: [{ job_id: jobId, state: "running", state_reason: "Transcribed. Reading it for the way you speak.", progress: { done: 4, total: 8, unit: "steps" } }], next_poll_ms: 5 } };
      }
      return { json: { jobs: [{ job_id: jobId, state: "done", state_reason: "Built and approved.", progress: { done: 8, total: 8, unit: "steps" } }], next_poll_ms: null } };
    },
    "GET /api/readiness": () => ({
      status: 200,
      json: {
        readiness: {
          overall: 82,
          publish_locked: false,
          weakest_part: "up_to_date",
          suggested_action: { code: "add_sources", label: "Add sources" },
          parts: [
            { id: "knows_your_material", label: "Knows your material", value: 90, measured: true, detail: "12 claims mined, 10 reviewed." },
            { id: "sounds_like_you", label: "Sounds like you", value: 88, measured: true, detail: "88 of your own 100." },
            { id: "thinks_like_you", label: "Thinks like you", value: 91, measured: true, detail: "kept 20 of 22 turns." },
            { id: "knows_what_not_to_say", label: "Knows what not to say", value: 100, measured: true, detail: "3 protections in place." },
            { id: "up_to_date", label: "Up to date", value: 79, measured: true, detail: "your newest source is 12 days old." },
          ],
        },
      },
    }),
    "POST /api/review-queue": () => ({ status: 200, json: { written: 3, dropped: 0, room: {}, queue: { open_count: 3 } } }),
    "POST /api/room-publish": ({ body }) => (body.op === "create" ? createHandler(body) : publishHandler(body)),
  };
}

const ROOM_HANDLER = ({ body }) => {
  if (body.op === "open") return { status: 200, json: { room: { name: "Test Creator AI" }, joined: false } };
  if (body.op === "join") return { status: 200, json: { session: "room-session-1", follower: { remembers: true, messages_left: 20 } } };
  if (body.op === "say") return { status: 200, json: { session: "room-session-2", reply: "Hi there, welcome.", quota: { messages_used: 1, messages_included: 20 } } };
  if (body.op === "history") return { status: 200, json: { remembers: true, turns: [{ role: "user", content: "hi" }, { role: "assistant", content: "hello" }] } };
  if (body.op === "forget") return { status: 200, json: { forgotten: true, deleted: { vy_room_follower: 1, vy_room_thread: 1 } } };
  return { status: 400, json: { error: "unknown_op" } };
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. HAPPY PATH — owner side and follower side, every step ok.
// ═══════════════════════════════════════════════════════════════════════════
{
  const lanes = ownerLanesUpTo(
    () => ({ status: 201, json: { room: { slug: "test-creator-ai", published: false, published_at: null } } }),
    () => ({ status: 200, json: { room: { slug: "test-creator-ai", published: true, published_at: "2026-09-03T00:00:00.000Z" } } }),
  );
  const server = jsonServer({ ...lanes, "POST /api/room": ROOM_HANDLER });
  const { stdout, stderr, code } = await run(server, { skipFollower: false });

  ok(`happy path exits 0 (received ${code}): ${stderr || (code === 0 ? "" : stdout)}`, code === 0);
  for (const step of ["probe", "replica", "consent", "upload", "processing", "readiness", "review-queue", "room-create", "room-publish", "follower-open", "follower-join", "follower-say", "follower-history", "follower-forget"]) {
    ok(`happy path step "${step}" is printed OK`, new RegExp(`\\[OK  \\] ${step}\\b`).test(stdout));
  }
  ok("happy path never prints a FAIL or BLKD line", !/\[FAIL\]|\[BLKD\]/.test(stdout));
  ok("happy path polled the DAG through queued, running and done",
    /queued.*Received/.test(stdout) && /running.*4\/8 steps/.test(stdout) && /\[OK  \] processing\s+done/.test(stdout));
  ok("happy path prints all five readiness parts", ["Knows your material", "Sounds like you", "Thinks like you", "Knows what not to say", "Up to date"].every((label) => stdout.includes(label)));
  ok("happy path prints the room link", stdout.includes("/r/test-creator-ai"));
  ok("happy path never called {op:\"decide\"} on a review card", !/"op":"decide"|op:"decide"/.test(stdout));
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. REFUSAL — publish locked by readiness. The follower side must never run,
//    even though a follower token is present, because the room never opens.
// ═══════════════════════════════════════════════════════════════════════════
{
  const lanes = ownerLanesUpTo(
    () => ({ status: 201, json: { room: { slug: "test-creator-ai", published: false, published_at: null } } }),
    () => ({
      status: 409,
      json: {
        error: "room_publish_locked",
        details: {
          waiting_on_you: [{ code: "room_readiness_locked", headline: "Readiness has not cleared 70 overall and 55 on every part yet.", next: "Open the Readiness panel on Meet it to see what to fix." }],
          waiting_on_us: [],
        },
      },
    }),
  );
  const server = jsonServer(lanes);
  const { stdout, code } = await run(server, { skipFollower: false });

  ok("publish-locked scenario exits non-zero", code !== 0);
  ok("publish-locked scenario reaches room-create ok", /\[OK  \] room-create/.test(stdout));
  ok("publish-locked scenario marks room-publish BLKD, not FAIL and not OK", /\[BLKD\] room-publish/.test(stdout) && !/\[OK  \] room-publish/.test(stdout) && !/\[FAIL\] room-publish/.test(stdout));
  ok("publish-locked scenario prints the waiting-on-you headline", stdout.includes("Readiness has not cleared 70 overall"));
  ok("publish-locked scenario never invents a follower step it never reached", !/follower-open|follower-join|follower-say/.test(stdout));
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. REFUSAL — the slug is taken. Stops at room-create; room-publish and the
//    follower side must never appear.
// ═══════════════════════════════════════════════════════════════════════════
{
  const lanes = ownerLanesUpTo(
    () => ({ status: 409, json: { error: "room_slug_taken", details: { slug: "test-creator-ai" } } }),
    () => ({ status: 200, json: { room: { slug: "test-creator-ai", published: true, published_at: "2026-09-03T00:00:00.000Z" } } }),
  );
  const server = jsonServer(lanes);
  const { stdout, code } = await run(server, { skipFollower: true });

  ok("slug-taken scenario exits non-zero", code !== 0);
  ok("slug-taken scenario marks room-create FAIL with the real code", /\[FAIL\] room-create\s+room_slug_taken/.test(stdout));
  // Note: room-create's own request URL is POST /api/room-publish, so the
  // right check is that the room-publish STEP never appears as a step row,
  // not that the substring "room-publish" is absent from the output.
  ok("slug-taken scenario never runs the room-publish step", !/\[(OK  |FAIL|BLKD)\] room-publish/.test(stdout));
  ok("slug-taken scenario never reaches the follower side", !/follower-/.test(stdout));
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. NEGATIVE CONTROL — a 200 with an empty body must FAIL the step, not
//    pass it. Struck on the consent grant, mid-chain, so a false pass here
//    would otherwise be invisible: everything before it really did work.
// ═══════════════════════════════════════════════════════════════════════════
{
  const lanes = ownerLanesUpTo(
    () => ({ status: 201, json: { room: { slug: "test-creator-ai", published: false, published_at: null } } }),
    () => ({ status: 200, json: { room: { slug: "test-creator-ai", published: true, published_at: "2026-09-03T00:00:00.000Z" } } }),
  );
  const server = jsonServer({ ...lanes, "POST /api/replica-consent": () => undefined });
  const { stdout, code } = await run(server, { skipFollower: true });

  ok("empty-body negative control exits non-zero", code !== 0);
  ok("empty-body negative control marks consent FAIL, never OK", /\[FAIL\] consent/.test(stdout) && !/\[OK  \] consent/.test(stdout));
  ok("empty-body negative control names the empty-response code", stdout.includes("empty_response"));
  ok("empty-body negative control never invents the upload step that follows it", !/\[OK  \] upload/.test(stdout));
}

console.log(`\n${checks} first-room checks passed`);
