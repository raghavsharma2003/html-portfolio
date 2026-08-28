import assert from "node:assert/strict";
import { isCapabilityAbsence } from "../../api/_replica-processing/capability-codes.js";
import {
  CAPABILITY_ABSENCE_CODES,
  COMPOSED_STEPS,
  capabilitySummary,
  composeProcessingAdapters,
  requeueRecoveredProcessingJobs,
  unavailableAdapter,
} from "../../api/_replica-processing/composition.js";
import {
  createNativeToolRunners,
  readClamAvVerdict,
  readFfprobeFacts,
  resolveNativeTool,
} from "../../api/_replica-processing/native-tools.js";
import { createNativeMediaAdapters } from "../../api/_replica-processing/providers/native-media.js";
import { normaliseUpload } from "../../api/_replica-activity.js";
import { authorizedProcessingSweep, runProcessingSweep } from "../../api/_replica-processing/sweep.js";
import { sha256Hex, stableUuid } from "../../api/_replica-processing/contracts.js";

// WS-AH. The sweep that drains the enrollment processing queue.
//
// The defect this suite exists to keep fixed: `_replica-source.js` enqueued an
// `integrity` job for every uploaded audio source and NOTHING ever called
// `runNextProcessingJob`. One real 32.9 MB upload sat at `integrity/queued`,
// never leased, while every screen animated it as in progress.
//
// The property that matters most here is not "the sweep runs". It is that a
// sweep which CANNOT do a step says so, in a named way, and never manufactures
// the evidence it could not gather. A malware scanner that is not installed
// must not produce `{ safe: true }`, because downstream cannot tell a scan that
// happened from one that did not.

let checks = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AUDIO = Buffer.from("bounded private audio");
const STORAGE_ENV = { PATH: "", SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "role-key" };

/* ── 1. auth refusal ─────────────────────────────────────────────────────── */

const SECRET = "x".repeat(32);
ok("sweep refuses a request with no authorization header",
  authorizedProcessingSweep({ headers: {} }, { CRON_SECRET: SECRET }) === false);
ok("sweep refuses a wrong bearer of the same length",
  authorizedProcessingSweep({ headers: { authorization: `Bearer ${"y".repeat(32)}` } }, { CRON_SECRET: SECRET }) === false);
ok("sweep refuses a correct prefix of the wrong length",
  authorizedProcessingSweep({ headers: { authorization: `Bearer ${"x".repeat(31)}` } }, { CRON_SECRET: SECRET }) === false);
ok("sweep accepts the exact cron secret",
  authorizedProcessingSweep({ headers: { authorization: `Bearer ${SECRET}` } }, { CRON_SECRET: SECRET }) === true);
// A short or unset CRON_SECRET must not become an open endpoint. This is the
// failure mode where an unconfigured deploy silently exposes the drainer.
ok("sweep refuses everything when CRON_SECRET is unset",
  authorizedProcessingSweep({ headers: { authorization: "Bearer " } }, {}) === false &&
  authorizedProcessingSweep({ headers: {} }, {}) === false);
ok("sweep refuses a CRON_SECRET too short to be a secret",
  authorizedProcessingSweep({ headers: { authorization: "Bearer short" } }, { CRON_SECRET: "short" }) === false);

/* ── 2. no manufactured evidence, with a negative control ────────────────── */

const resolver = async () => ({ mime: "audio/wav", byteSize: AUDIO.length, body: AUDIO });
const request = {
  source: {
    source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER, kind: "audio", state: "quarantined",
    storage_bucket: "vyakti-replica-private", object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
    mime: "audio/wav", byte_size: AUDIO.length, duration_ms: 1800, sha256: sha256Hex(AUDIO),
  },
  inputs: [{ sha256: sha256Hex(AUDIO), mime: "audio/wav", object_path: `${OWNER}/${REPLICA}/${SOURCE}/original` }],
};

// THE NEGATIVE CONTROL. A scanner that cannot run must never yield a verdict.
const cannotScan = createNativeMediaAdapters({
  resolveInput: resolver,
  scanBytes: async () => { throw Object.assign(new Error("malware_scanner_unavailable"), { code: "malware_scanner_unavailable" }); },
  probeBytes: async () => { throw Object.assign(new Error("media_probe_tool_unavailable"), { code: "media_probe_tool_unavailable" }); },
});
await assert.rejects(cannotScan.malware_scan.scan(request), (error) => String(error?.code || error?.message).includes("malware_scanner_unavailable"));
ok("a scanner that cannot run throws its named code and returns no verdict", true);
await assert.rejects(cannotScan.media_probe.probe(request), (error) => String(error?.code || error?.message).includes("media_probe_tool_unavailable"));
ok("a probe tool that cannot run throws its named code and returns no facts", true);

// The same control one level down: the verdict READER must refuse an
// unreadable scanner run rather than defaulting it to clean.
assert.throws(() => readClamAvVerdict({ exitCode: 2, stdout: "", stderr: "cannot connect to clamd" }), /clamav_scan_failed/);
ok("an unreadable clamdscan run fails and is never read as clean", true);
assert.throws(() => readClamAvVerdict({ exitCode: 0, stdout: "nothing parseable" }), /clamav_scan_failed/);
ok("a zero exit with no OK line is still not a clean verdict", true);
ok("a real OK line is the only thing that produces safe:true",
  readClamAvVerdict({ exitCode: 0, stdout: "stream: OK" }).safe === true);
ok("a real FOUND line produces an unsafe verdict carrying the signature",
  readClamAvVerdict({ exitCode: 1, stdout: "stream: Eicar-Test-Signature FOUND" }).safe === false);
assert.throws(() => readFfprobeFacts({ exitCode: 0, stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "9" } }) }), /no_audio_stream/);
ok("a file with no audio stream is named as such, not given a duration", true);

// And the property stated positively over the whole composed set: every step
// that is not available is an adapter that THROWS, never one that resolves.
const degraded = composeProcessingAdapters({ env: STORAGE_ENV });
const METHOD = {
  integrity: "verify", malware_scan: "scan", media_probe: "probe", diarize: "diarize",
  separate: "separate", enhance: "enhance", transcribe: "transcribe", voice_quality: "measure",
};
let refusals = 0;
for (const step of COMPOSED_STEPS) {
  if (degraded.capabilities[step].available) continue;
  await assert.rejects(
    degraded.adapters[step][METHOD[step]](request),
    (error) => error?.code === degraded.capabilities[step].code && error?.retryable === false,
    `${step} must refuse with its own code`,
  );
  refusals++;
}
ok(`every unavailable step refuses terminally with its own named code (${refusals} steps)`, refusals === 7);

/* ── 3. legible degradation when credentials are absent ──────────────────── */

const noStorage = composeProcessingAdapters({ env: { PATH: "" } });
const noStorageSummary = capabilitySummary(noStorage.capabilities);
ok("with no storage role key, every step reports the storage absence and none is live",
  noStorageSummary.live.length === 0 &&
  COMPOSED_STEPS.every((step) => noStorageSummary.absent[step] === "private_storage_not_configured"));

const degradedSummary = capabilitySummary(degraded.capabilities);
ok("with storage but nothing else, integrity is the one live step",
  degradedSummary.live.join(",") === "integrity");
ok("every absence code is a canonical capability code the rest of the platform knows",
  Object.values(degradedSummary.absent).every(isCapabilityAbsence));
ok("every step always has an adapter, so no absence collapses into missing_processing_adapter",
  COMPOSED_STEPS.every((step) => typeof degraded.adapters[step]?.[METHOD[step]] === "function"));
ok("the capability report is content-free: step names and codes only",
  !JSON.stringify(degradedSummary).includes(OWNER) && !JSON.stringify(degradedSummary).includes(SOURCE));

// The owner-facing half. A capability absence must read as a plain reason plus
// a next action, and must NOT tell the owner to re-upload a file that is fine.
for (const code of CAPABILITY_ABSENCE_CODES) {
  const view = normaliseUpload({
    source_id: SOURCE, kind: "audio", state: "quarantined", byte_size: 32_908_934,
    created_at: "2026-08-26T15:28:50Z", updated_at: "2026-08-26T15:30:00Z",
    failure_code: code, failed_step: "malware_scan", steps_done: 1,
  });
  assert.equal(view.state, "blocked", `${code} must not read as a failed recording`);
  assert.equal(view.next_action.kind, "wait", `${code} must offer a wait, not a re-upload`);
  assert.ok(view.state_reason.length > 40 && /\.$/.test(view.state_reason.trim()), `${code} needs a real sentence`);
  assert.ok(!/upload this recording again/i.test(view.next_action.label), `${code} must never ask for a re-upload`);
  assert.ok(!view.in_flight, `${code} must not animate as in flight`);
  assert.ok(!/[—–]/.test(`${view.state_reason} ${view.next_action.label}`), `${code} copy must obey the dash law`);
}
ok(`every capability absence reads as a plain reason plus a next action (${CAPABILITY_ABSENCE_CODES.length} codes)`, true);

// The control on THAT: a genuine failure must still route to the owner.
const realFailure = normaliseUpload({
  source_id: SOURCE, kind: "audio", state: "quarantined", byte_size: 1024,
  created_at: "2026-08-26T15:28:50Z", updated_at: "2026-08-26T15:30:00Z",
  failure_code: "integrity_mismatch", failed_step: "integrity",
});
ok("a real failure still reports as failed and still asks for a new upload",
  realFailure.state === "failed" && realFailure.next_action.kind === "fix_input");

/* ── 4. bounded jobs, and the drain itself ──────────────────────────────── */

const jobRow = (step) => ({
  job_id: stableUuid(`sweep-eval-${step}`), replica_id: REPLICA, owner_user_id: OWNER, source_id: SOURCE,
  step, revision: 1, state: "leased", attempt: 1, lease_expires_at: "2099-01-01T00:00:00Z",
});
const sourceRow = {
  source_id: SOURCE, replica_id: REPLICA, owner_user_id: OWNER, kind: "audio", state: "quarantined",
  storage_bucket: "vyakti-replica-private", object_path: `${OWNER}/${REPLICA}/${SOURCE}/original`,
  mime: "audio/wav", byte_size: AUDIO.length, duration_ms: 1800, sha256: sha256Hex(AUDIO),
  contains_third_parties: false,
};

/** A database that always has another job to hand out, so "bounded" is a
 *  property of the sweep rather than of the queue running dry. */
function endlessQueue(counters = {}) {
  counters.leases = 0;
  counters.settles = 0;
  counters.requeues = 0;
  return async (sql) => {
    if (sql.includes("with recovered as")) { counters.requeues++; return []; }
    if (sql.includes("candidate as")) { counters.leases++; return [jobRow("malware_scan")]; }
    if (sql.includes("join vy_replica_source s")) return [sourceRow];
    if (sql.includes("select step from vy_replica_processing_job")) return [{ step: "integrity" }];
    if (sql.includes("set state = $3")) { counters.settles++; return [jobRow("malware_scan")]; }
    throw new Error(`unexpected query: ${sql.slice(0, 60)}`);
  };
}

const counters = {};
const bounded = await runProcessingSweep({
  db: endlessQueue(counters), env: STORAGE_ENV, composed: degraded, maxJobs: 3,
});
ok("the sweep stops at its job bound even when the queue never runs dry",
  counters.leases === 3 && bounded.processed === 3 && bounded.outcomes.length === 3);
ok("each bounded job settled exactly once", counters.settles === 3);
ok("the sweep asked the queue to recover capability-blocked jobs before draining", counters.requeues === 1);
ok("an unavailable step settles as a named terminal failure, not a retry loop",
  bounded.outcomes.every((entry) => entry.outcome === "failed" && entry.failure_code === "malware_scanner_unavailable"));
ok("the sweep report carries no tenant, job or object identifier",
  !JSON.stringify(bounded).includes(OWNER) && !JSON.stringify(bounded).includes(SOURCE) &&
  !JSON.stringify(bounded).includes(jobRow("malware_scan").job_id));

// The bound is clamped, not merely defaulted: a caller asking for 10_000 jobs
// in one 300s invocation gets the ceiling, not the request.
const clamped = {};
const overAsk = await runProcessingSweep({ db: endlessQueue(clamped), env: STORAGE_ENV, composed: degraded, maxJobs: 10_000 });
ok("an out-of-range job bound falls back to the default rather than being honoured",
  clamped.leases === 3 && overAsk.processed === 3);

// An idle queue stops the loop immediately instead of spending the whole budget.
let idleLeases = 0;
const idle = await runProcessingSweep({
  db: async (sql) => {
    if (sql.includes("with recovered as")) return [];
    if (sql.includes("candidate as")) { idleLeases++; return []; }
    throw new Error("idle queue should not be asked anything else");
  },
  env: STORAGE_ENV, composed: degraded, maxJobs: 5,
});
ok("an empty queue costs exactly one lease attempt", idleLeases === 1 && idle.processed === 0);

// A time budget already spent must stop the loop before it leases anything.
let budgetLeases = 0;
let clock = 0;
const spent = await runProcessingSweep({
  db: async (sql) => {
    if (sql.includes("with recovered as")) return [];
    if (sql.includes("candidate as")) { budgetLeases++; return []; }
    throw new Error("unexpected");
  },
  env: STORAGE_ENV, composed: degraded, maxJobs: 5, budgetMs: 10_000,
  now: () => (clock += 60_000),
});
ok("a spent time budget stops the sweep before it takes a lease", budgetLeases === 0 && spent.processed === 0);

// A requeue failure must not sink the drain. This is the ordering bug where one
// bad recovery query stops every healthy job in the queue from moving.
const resilient = {};
const stillDrains = await runProcessingSweep({
  db: (() => {
    const inner = endlessQueue(resilient);
    return async (sql) => {
      if (sql.includes("with recovered as")) throw new Error("recovery query exploded");
      return inner(sql);
    };
  })(),
  env: STORAGE_ENV, composed: degraded, maxJobs: 2,
});
ok("a failing recovery query does not stop the queue from draining", stillDrains.processed === 2);

/* ── 5. the requeue fence ────────────────────────────────────────────────── */

let requeueParams = null;
const requeueDb = async (sql, params) => { requeueParams = params; return [{ step: "malware_scan" }]; };
const recovered = await requeueRecoveredProcessingJobs(requeueDb, {
  integrity: { available: true, code: "" },
  malware_scan: { available: true, code: "" },
  media_probe: { available: false, code: "media_probe_tool_unavailable" },
  diarize: { available: false, code: "voice_evidence_unconfigured" },
  separate: { available: false, code: "voice_evidence_unconfigured" },
  enhance: { available: false, code: "voice_evidence_unconfigured" },
  transcribe: { available: false, code: "asr_unconfigured" },
  voice_quality: { available: false, code: "voice_evidence_unconfigured" },
});
ok("requeue only ever targets steps that are live in this process right now",
  requeueParams[0].join(",") === "integrity,malware_scan");
ok("requeue only ever matches capability-absence codes, never a real failure",
  requeueParams[1].every(isCapabilityAbsence) &&
  !requeueParams[1].includes("integrity_mismatch") && !requeueParams[1].includes("malware_detected"));
ok("requeue reports what it moved", recovered.requeued === 1 && recovered.steps.join(",") === "malware_scan");

const nothingLive = await requeueRecoveredProcessingJobs(
  async () => { throw new Error("must not query when nothing is live"); },
  Object.fromEntries(COMPOSED_STEPS.map((step) => [step, { available: false, code: "asr_unconfigured" }])),
);
ok("requeue does not touch the database when no step is live", nothingLive.requeued === 0);

/* ── 6. the composition covers the DAG, and the stub is contract-valid ──── */

ok("the composed step set is exactly the eight-step audio DAG",
  COMPOSED_STEPS.join(",") === "integrity,malware_scan,media_probe,diarize,separate,enhance,transcribe,voice_quality");
const stub = unavailableAdapter("transcribe", "asr_unconfigured");
ok("an unavailable stub still satisfies the adapter provenance contract",
  /^[a-z0-9][a-z0-9._-]{0,79}$/.test(stub.family) && /^[a-z0-9][a-z0-9._-]{0,79}$/.test(stub.name) &&
  /^[a-z0-9][a-z0-9._-]{0,79}$/.test(stub.version) && typeof stub.transcribe === "function");
ok("an unavailable stub declares no billing meter, so it can never reserve spend",
  stub.billing === undefined);
ok("an unavailable stub is marked as such for anything that introspects it",
  stub.unavailable === true && stub.unavailable_code === "asr_unconfigured");

// Tool resolution must not claim a tool from an override that is not executable.
ok("an override path that is not executable does not count as an available tool",
  resolveNativeTool("malware_scan", { CLAMDSCAN_PATH: "/nonexistent/clamdscan", PATH: "" }) === null);
ok("an empty PATH resolves no tools",
  resolveNativeTool("media_probe", { PATH: "" }) === null);
const runners = createNativeToolRunners({ env: { PATH: "" } });
await assert.rejects(runners.scanBytes(AUDIO), /malware_scanner_unavailable/);
await assert.rejects(runners.probeBytes(AUDIO), /media_probe_tool_unavailable/);
ok("the injected runners refuse by name when their binaries are absent", true);

console.log(`\n${checks} checks passed`);
