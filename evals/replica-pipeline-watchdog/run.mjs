import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PIPELINE_STALE_MS,
  VOICE_BUILD_INTENT_DEFERRED_BLOCKERS,
  authorizedPipelineWatchdog,
  inspectReplicaPipeline,
  publicPipelineWatchdogReport,
} from "../../api/_replica-pipeline-watchdog.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
let checks = 0;
function ok(name, value) {
  checks++;
  assert.ok(value, name);
  console.log(`ok ${checks} - ${name}`);
}

const secret = "s".repeat(32);
ok("watchdog refuses a missing secret and accepts only the exact timing-safe bearer",
  !authorizedPipelineWatchdog({ headers: {} }, { CRON_SECRET: secret })
  && !authorizedPipelineWatchdog({ headers: { authorization: `Bearer ${secret}x` } }, { CRON_SECRET: secret })
  && authorizedPipelineWatchdog({ headers: { authorization: `Bearer ${secret}` } }, { CRON_SECRET: secret }));

const NOW = Date.parse("2026-08-29T23:00:00.000Z");
const old = "2026-08-29T22:30:00.000Z";
const recent = "2026-08-29T22:58:00.000Z";
let sql = "";
let timeout = 0;
const inspect = (row, options = {}) => inspectReplicaPipeline(async (statement, params, timeoutMs) => {
  sql = statement;
  timeout = timeoutMs;
  assert.deepEqual(params, [VOICE_BUILD_INTENT_DEFERRED_BLOCKERS]);
  return [row];
}, { nowMs: NOW, ...options });

const idle = await inspect({});
ok("an empty queue is healthy and reports no work", idle.ok && idle.status === "healthy"
  && idle.lanes.processing.due === 0 && idle.lanes.model_build.due === 0
  && idle.lanes.voice_build_intent.due === 0);
ok("the read is bounded and covers due, expired-lease and live-lease states",
  timeout === 30_000 && /next_attempt_at<=now\(\)/.test(sql)
  && /lease_expires_at<=now\(\)/.test(sql) && /lease_expires_at>now\(\)/.test(sql)
  && /not exists \([\s\S]*terminal\.state in \('failed','blocked'\)/.test(sql));
ok("an audio or video source cannot disappear between finalize and its first queue row",
  /processing_orphans as/.test(sql)
  && /s\.kind in \('audio','video'\)/.test(sql)
  && /not exists \([\s\S]*from vy_replica_processing_job j/.test(sql)
  && /\+ orphan_due/.test(sql));

const reviewSource = readFileSync(join(ROOT, "api/_replica-review.js"), "utf8");
const buildIntentSource = readFileSync(join(ROOT, "api/_replica-build-intent.js"), "utf8");
const readinessBlockers = [...reviewSource.matchAll(/blockers\.push\("([a-z0-9_]+)"\)/g)]
  .map((match) => match[1]);
ok("the deferred allowlist exactly mirrors every owner or evidence readiness blocker",
  JSON.stringify([...VOICE_BUILD_INTENT_DEFERRED_BLOCKERS].sort()) === JSON.stringify([
    "candidate_source_processing",
    ...readinessBlockers,
  ].sort())
  && /settleWaiting\([\s\S]*\["candidate_source_processing"\]/.test(buildIntentSource));
ok("the intent SQL excludes known owner waits but treats empty, errored and novel waits as actionable",
  /voice_build_intent_open as materialized/.test(sql)
  && /i\.state in \('waiting','queued'\) and i\.next_check_at<=now\(\)/.test(sql)
  && /last_error_code<>'' or cardinality\(blockers\)=0 or not \(blockers <@ \$1::text\[\]\)/.test(sql));
ok("active builds and scheduled retry backoff are excluded while due or expired technical work remains actionable",
  /build_state in \('queued','retry'\) and build_next_attempt_at<=now\(\)/.test(sql)
  && /build_state in \('leased','building'\)[\s\S]*build_lease_expires_at<=now\(\)/.test(sql)
  && /build_state in \('review','approved','failed','retired'\)/.test(sql)
  && /0::int as voice_build_intent_live_leases/.test(sql));

const ownerBlockedWait = await inspect({
  voice_build_intent_due: 0,
  voice_build_intent_live_leases: 0,
  voice_build_intent_last_transition_at: old,
});
ok("a genuine owner or upstream evidence wait never pages", ownerBlockedWait.ok
  && !ownerBlockedWait.lanes.voice_build_intent.stalled);

const intentStall = await inspect({
  voice_build_intent_due: 1,
  voice_build_intent_live_leases: 0,
  voice_build_intent_last_transition_at: old,
});
ok("a stale server-actionable waiting or queued intent raises its own lane",
  !intentStall.ok && intentStall.stalled_lanes.join() === "voice_build_intent"
  && intentStall.lanes.voice_build_intent.last_transition_age_ms === 30 * 60_000);

const recentIntent = await inspect({
  voice_build_intent_due: 1,
  voice_build_intent_live_leases: 0,
  voice_build_intent_last_transition_at: recent,
});
ok("a recently advancing actionable intent gets the same bounded grace window",
  recentIntent.ok && !recentIntent.lanes.voice_build_intent.stalled);

const startupDeath = await inspect({
  processing_due: 1,
  processing_live_leases: 0,
  processing_last_transition_at: old,
});
ok("due work with no lease or transition for three schedule windows is stalled",
  !startupDeath.ok && startupDeath.stalled_lanes.join() === "processing"
  && startupDeath.lanes.processing.last_transition_age_ms === 30 * 60_000);

const drainingBacklog = await inspect({
  processing_due: 9,
  processing_live_leases: 0,
  processing_last_transition_at: recent,
});
ok("a bounded worker draining a backlog is healthy while transitions are recent",
  drainingBacklog.ok && !drainingBacklog.lanes.processing.stalled);

const longLease = await inspect({
  processing_due: 4,
  processing_live_leases: 1,
  processing_last_transition_at: old,
});
ok("a valid long-media lease suppresses the watchdog and is never duplicated",
  longLease.ok && longLease.lanes.processing.live_leases === 1);

const buildStall = await inspect({
  model_build_due: 2,
  model_build_live_leases: 0,
  model_build_last_transition_at: old,
});
ok("the post-processing voice build lane is watched independently", !buildStall.ok
  && buildStall.stalled_lanes.join() === "model_build");

const bounded = await inspect({
  processing_due: 1,
  processing_live_leases: 0,
  processing_last_transition_at: old,
}, { staleMs: 1 });
ok("an unsafe threshold falls back to the reviewed fifteen-minute bound",
  bounded.stale_after_ms === PIPELINE_STALE_MS);

const publicReport = publicPipelineWatchdogReport(startupDeath);
ok("the alert payload contains counts and lane codes but no tenant or work identifiers",
  JSON.stringify(publicReport) === JSON.stringify({
    ok: false,
    status: "stalled",
    stalled_lanes: ["processing"],
    lanes: {
      processing: { due: 1, live_leases: 0, stalled: true },
      model_build: { due: 0, live_leases: 0, stalled: false },
      voice_build_intent: { due: 0, live_leases: 0, stalled: false },
    },
  }) && !/owner|replica|source|job_id|object|transcript/i.test(JSON.stringify(publicReport)));

const publicIntentReport = publicPipelineWatchdogReport({
  ...intentStall,
  stalled_lanes: [...intentStall.stalled_lanes, "private_future_lane"],
  lanes: { ...intentStall.lanes, private_future_lane: { due: 99, stalled: true } },
});
ok("the public allowlist exposes only aggregate known lanes and drops unknown internal fields",
  publicIntentReport.stalled_lanes.join() === "voice_build_intent"
  && publicIntentReport.lanes.voice_build_intent.due === 1
  && !Object.hasOwn(publicIntentReport.lanes, "private_future_lane")
  && !/last_transition|blocker|error_code|private_future_lane/.test(JSON.stringify(publicIntentReport)));

const vercel = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
const endpoint = readFileSync(join(ROOT, "api/replica-pipeline-watchdog.js"), "utf8");
const infra = readFileSync(join(ROOT, "services/replica-processing-worker/infra/main.bicep"), "utf8");
ok("the watchdog has a five-minute cron caller and makes a stall a 5xx signal",
  vercel.crons.some((entry) => entry.path === "/api/replica-pipeline-watchdog" && entry.schedule === "*/5 * * * *")
  && /status\(503\).*replica_pipeline_stalled/s.test(endpoint));
ok("Azure can page an action group on a failed scheduled execution",
  /Microsoft\.Insights\/metricAlerts@2018-03-01/.test(infra)
  && /metricName: 'Executions'/.test(infra) && /values: \['Failed'\]/.test(infra)
  && /actionGroupId: monitorActionGroupId/.test(infra));
ok("the watchdog is read-only and cannot lease, retry, settle or fabricate success",
  !/\b(update|insert|delete)\b/i.test(sql)
  && !/leaseNext|runNextProcessingJob|runVoiceGenomeBuildSweep|completeProcessing/i.test(endpoint));

console.log(`\n${checks} replica pipeline watchdog checks passed`);
