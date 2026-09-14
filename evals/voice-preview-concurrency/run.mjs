import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
// Deterministic red-team fixtures for ordinary voice-preview concurrency.
//
// This is intentionally isolated from evals/run.mjs. It does not call a
// database, storage, Azure, Vercel, or the voice model. It proves the minimum
// state-machine properties a production canary must observe and reproduces
// the queue/cancellation hazards that an offline happy path cannot expose.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const source = (path) => readFileSync(join(ROOT, path), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

let passed = 0;
function check(name, condition, detail = "") {
  assert.ok(condition, `${name}${detail ? `: ${detail}` : ""}`);
  passed += 1;
  console.log(`ok ${passed} - ${name}`);
}

class IntentStore {
  constructor() {
    this.intents = new Map();
    this.now = 0;
    this.serial = 0;
  }

  key(input) {
    return JSON.stringify([
      input.owner, input.replica, input.genome, input.artifact, input.language,
      input.textHash, input.textPlanHash, input.modelCommitment, input.style,
      input.seed, input.regenerationKey || "",
    ]);
  }

  begin(input) {
    const key = this.key(input);
    let intent = this.intents.get(key);
    const recoverable = intent && (
      (intent.state === "warming" && intent.nextAttemptAt <= this.now) ||
      (intent.state === "retryable" && intent.nextAttemptAt <= this.now) ||
      (intent.state === "synthesizing" && intent.leaseExpiresAt <= this.now)
    );
    if (!intent) {
      intent = {
        id: `intent-${++this.serial}`,
        owner: input.owner,
        state: "synthesizing",
        attempt: 1,
        generation: `generation-${this.serial}-1`,
        lease: `lease-${this.serial}-1`,
        leaseExpiresAt: this.now + 290,
        nextAttemptAt: this.now,
        failureCount: 0,
        result: null,
      };
      this.intents.set(key, intent);
      return { role: "execute", intent: structuredClone(intent) };
    }
    if (recoverable) {
      intent.state = "synthesizing";
      intent.attempt += 1;
      intent.generation = `generation-${this.serial}-${intent.attempt}`;
      intent.lease = `lease-${this.serial}-${intent.attempt}`;
      intent.leaseExpiresAt = this.now + 290;
      return { role: "execute", intent: structuredClone(intent) };
    }
    return { role: intent.state === "sealed" ? "sealed" : "observe", intent: structuredClone(intent) };
  }

  retryable(claim) {
    const intent = [...this.intents.values()].find((value) => value.id === claim.intent.id);
    if (intent?.lease !== claim.intent.lease || intent?.attempt !== claim.intent.attempt) return false;
    intent.failureCount += 1;
    intent.state = intent.failureCount >= 3 ? "failed" : "retryable";
    intent.lease = "";
    intent.nextAttemptAt = this.now + 30;
    return true;
  }

  terminal(claim) {
    const intent = [...this.intents.values()].find((value) => value.id === claim.intent.id);
    if (intent?.lease !== claim.intent.lease || intent?.attempt !== claim.intent.attempt) return false;
    intent.failureCount = 3;
    intent.state = "failed";
    intent.lease = "";
    return true;
  }

  seal(claim, bytes) {
    const intent = [...this.intents.values()].find((value) => value.id === claim.intent.id);
    if (intent?.state !== "synthesizing" || intent?.lease !== claim.intent.lease ||
        intent?.attempt !== claim.intent.attempt || intent.leaseExpiresAt <= this.now) return false;
    intent.state = "sealed";
    intent.lease = "";
    intent.result = { bytes: Buffer.from(bytes), sha256: sha256(bytes), expiresAt: this.now + 604_800 };
    return true;
  }

  expire(owner, intentId) {
    const intent = [...this.intents.values()].find((value) => value.id === intentId);
    if (!intent || intent.owner !== owner || intent.state !== "sealed" || intent.result.expiresAt > this.now) return null;
    const deleted = intent.result.sha256;
    intent.result = null;
    intent.state = "retryable";
    intent.nextAttemptAt = this.now;
    return deleted;
  }

  read(owner, intentId) {
    const intent = [...this.intents.values()].find((value) => value.id === intentId);
    if (!intent || intent.owner !== owner || intent.state !== "sealed" || intent.result.expiresAt <= this.now) return null;
    return Buffer.from(intent.result.bytes);
  }
}

function fixture(owner, overrides = {}) {
  return {
    owner,
    replica: `replica-${owner}`,
    genome: 2,
    artifact: `artifact-${owner}`,
    language: "hi",
    textHash: sha256("Namaste, this is one immutable request."),
    textPlanHash: sha256("one immutable text plan"),
    modelCommitment: sha256("open chatterbox exact model"),
    style: "identity_anchor",
    seed: 1729,
    regenerationKey: "",
    ...overrides,
  };
}

console.log("\n# Durable intent arbitration");
{
  const store = new IntentStore();
  const same = Array.from({ length: 5 }, () => store.begin(fixture("owner-a")));
  check("five same-owner tabs elect exactly one executor",
    same.filter((value) => value.role === "execute").length === 1);
  check("the other four tabs only observe",
    same.filter((value) => value.role === "observe").length === 4);
  check("all five tabs share one intent and one generation",
    new Set(same.map((value) => value.intent.id)).size === 1 &&
    new Set(same.map((value) => value.intent.generation)).size === 1);

  const owners = Array.from({ length: 5 }, (_, index) => store.begin(fixture(`owner-${index}`)));
  check("five distinct owners create five isolated intents",
    owners.every((value) => value.role === "execute") &&
    new Set(owners.map((value) => value.intent.id)).size === 5);

  const first = same[0];
  const wav = Buffer.from("RIFF-protected-fixture");
  check("the lease holder can seal once", store.seal(first, wav));
  const replays = Array.from({ length: 5 }, () => store.begin(fixture("owner-a")));
  check("all retries observe one sealed result", replays.every((value) => value.role === "sealed"));
  check("the owner receives byte-identical protected output",
    replays.every((value) => store.read("owner-a", value.intent.id)?.equals(wav)));
  check("another owner cannot read the result", store.read("owner-b", first.intent.id) === null);

  const regenerate = fixture("owner-a", { regenerationKey: "regen_12345678" });
  const regenClaims = Array.from({ length: 5 }, () => store.begin(regenerate));
  check("explicit regeneration creates one new intent and deduplicates its retries",
    regenClaims.filter((value) => value.role === "execute").length === 1 &&
    new Set(regenClaims.map((value) => value.intent.id)).size === 1 &&
    regenClaims[0].intent.id !== first.intent.id);

  for (const [field, value] of [
    ["textPlanHash", sha256("changed text plan")],
    ["modelCommitment", sha256("changed model")],
  ]) {
    const changed = store.begin(fixture("owner-a", { [field]: value }));
    check(`${field} changes the durable identity`, changed.role === "execute" && changed.intent.id !== first.intent.id);
  }
}

console.log("\n# Lease recovery and fencing");
{
  const store = new IntentStore();
  const original = store.begin(fixture("owner-stale"));
  store.now = 291;
  const races = Array.from({ length: 5 }, () => store.begin(fixture("owner-stale")));
  const winner = races.find((value) => value.role === "execute");
  check("five recovery polls elect exactly one new executor",
    races.filter((value) => value.role === "execute").length === 1);
  check("lease recovery increments the attempt", winner.intent.attempt === 2);
  check("a stale worker cannot seal over the new attempt",
    store.seal(original, Buffer.from("stale protected bytes")) === false);
  check("the current lease can seal", store.seal(winner, Buffer.from("current protected bytes")));
}

console.log("\n# Failure cap, terminal state, and result expiry");
{
  const store = new IntentStore();
  let claim = store.begin(fixture("owner-failure-cap"));
  for (let failure = 1; failure <= 3; failure += 1) {
    check(`transient failure ${failure} settles exactly once`, store.retryable(claim));
    if (failure < 3) {
      store.now += 30;
      claim = store.begin(fixture("owner-failure-cap"));
      check(`transient failure ${failure} reclaims one lease`, claim.role === "execute");
    }
  }
  const exhausted = store.begin(fixture("owner-failure-cap"));
  check("three transient failures are terminal", exhausted.intent.state === "failed");
  check("a terminal failed intent cannot buy another provider start", exhausted.role === "observe");

  const deterministic = store.begin(fixture("owner-terminal"));
  check("a deterministic failure settles terminally", store.terminal(deterministic));
  check("a deterministic failure is never reclaimed", store.begin(fixture("owner-terminal")).intent.state === "failed");

  const sealed = store.begin(fixture("owner-expiry"));
  const bytes = Buffer.from("RIFF-protected-expiring-fixture");
  check("an expiry fixture seals", store.seal(sealed, bytes));
  store.now += 604_800;
  check("expired bytes are not served", store.read("owner-expiry", sealed.intent.id) === null);
  check("expiry is owner-scoped and returns the exact deletion commitment",
    store.expire("owner-other", sealed.intent.id) === null && store.expire("owner-expiry", sealed.intent.id) === sha256(bytes));
  check("an expired ordinary intent deliberately reclaims one new attempt",
    store.begin(fixture("owner-expiry")).role === "execute");
}

console.log("\n# Bounded two-GPU queue and client deadline");
{
  const serviceSeconds = 25;
  const browserDeadlineSeconds = 90;
  const replicas = 2;
  const completedAt = Array.from({ length: 5 }, (_, index) => (Math.floor(index / replicas) + 1) * serviceSeconds);
  const visibleSuccesses = completedAt.filter((time) => time <= browserDeadlineSeconds).length;
  const apparentFailures = completedAt.length - visibleSuccesses;
  check("the bounded max-two warm queue fits five short single-segment callers inside 90 seconds",
    apparentFailures === 0,
    JSON.stringify({ completedAt, browserDeadlineSeconds }));
  check("the queue still serializes one synthesis inside each GPU replica",
    completedAt.join(",") === "25,25,50,50,75");

  // A client deadline can still race a long synthesis. The lease, not the
  // browser connection, must remain the cost authority in that case.
  const longSynthesis = 110;
  check("a client timeout does not prove long CUDA work stopped", longSynthesis > browserDeadlineSeconds);
}

console.log("\n# Source contract findings");
{
  const route = source("api/voice-preview.js");
  const api = source("src/studio/voicePanelApi.ts");
  const panel = source("api/_voice/preview-panel.js");
  const store = source("api/_replica-voice-preview.js");
  const provider = source("api/_voice/providers/open-chatterbox-preview.js");
  const migration = readReconciledMigration("db/migrations/067_replica_voice_preview_intent.sql");
  const infra = source("services/open-voice-runtime/infra/main.bicep");
  const phone = source("src/studio/VoicePreviewPanel.tsx");
  const broker = source("services/open-voice-runtime/broker.py");
  const runtime = source("services/open-voice-runtime/app.py");

  check("the client still has a 90-second request deadline", /AbortSignal\.timeout\(90_000\)/.test(api));
  check("client disconnect is wired into the server abort signal",
    /req\.on\?\.\("aborted"/.test(route) && /signal:\s*aborter\.signal/.test(route));
  check("the runtime serializes synthesis with one process-local GPU lock",
    /gpu_lock\s*=\s*asyncio\.Lock\(\)/.test(runtime) && /async with app\.state\.gpu_lock/.test(runtime));
  check("the handler separates transient retry from terminal failure",
    /if \(retryable\) await deps\.markRetryable\(started, error\)/.test(panel) &&
    /else await deps\.markTerminal\(started, error\)/.test(panel));
  check("client abort preserves the active lease instead of opening an early retry",
    /transportMayStillBeRunning[\s\S]{0,240}client_aborted/.test(panel) &&
    /transportMayStillBeRunning[\s\S]{0,700}return intentProgress\(started, "synthesizing"/.test(panel));
  check("the provider preserves abort identity for the lease decision",
    /catch\s*\(error\)[\s\S]{0,400}(signal\?\.reason|AbortError|client_aborted|voice_preview_timeout)/.test(provider));
  check("an ambiguous synthesis transport loss keeps the active lease",
    /open_voice_execution_may_continue/.test(provider) &&
    /transportMayStillBeRunning[\s\S]{0,300}open_voice_execution_may_continue/.test(panel) &&
    /return intentProgress\(started, "synthesizing"/.test(panel));
  check("a readiness timeout or abort before synthesis is recoverable, not terminal",
    /readinessRetryable\s*=\s*!providerStarted/.test(panel) &&
    /open_voice_runtime_status_timeout/.test(panel) && /client_aborted/.test(panel) &&
    /readinessRetryable[\s\S]{0,300}await abortWarmup\(code\)/.test(panel));
  check("an ambiguous runtime failure invalidates process-local warm belief",
    /transportMayStillBeRunning[\s\S]{0,700}warmth\.note\(deps\.origin, "waking"/.test(panel));
  check("the executor renews its lease after synthesis and before protection",
    /export async function renewVoicePreviewIntentLease/.test(store) &&
    panel.indexOf("await deps.renewIntent") > panel.indexOf("assertSynthesisResult(raw)") &&
    panel.indexOf("await deps.renewIntent") < panel.indexOf("await deps.protect"));
  check("the schema gives protected results an explicit expiry",
    /result_expires_at\s+timestamptz/.test(migration));
  check("the seal transition supplies the expiry required by the schema",
    /set state='sealed'[\s\S]{0,500}result_expires_at\s*=/.test(store));
  const retryable = store.slice(store.indexOf("export async function markVoicePreviewIntentRetryable"),
    store.indexOf("export async function sealVoicePreviewIntent"));
  check("retry accounting increments a durable failure counter",
    /failure_count\s*=\s*least\(3,\s*i\.failure_count\s*\+\s*1\)/.test(retryable));
  check("retry exhaustion becomes a terminal failed state",
    /state\s*=\s*case[\s\S]{0,500}'failed'/.test(retryable));
  check("a failed intent is returned as terminal rather than runtime warming",
    /intent\?\.role\s*===\s*["']failed["']/.test(panel));
  check("a sealed result is not served after its expiry",
    /expiresAt/.test(panel) && /(expired|Date\.parse|now\(\))/.test(panel));
  check("the intent-generation relationship has a composite database foreign key",
    /foreign key\s*\(preview_intent_id,\s*replica_id,\s*owner_user_id\)/i.test(migration));
  check("the exact identity includes model and text-plan commitments",
    /constraint vy_replica_voice_preview_intent_exact_identity unique[\s\S]{0,400}text_plan_sha256[\s\S]{0,200}model_commitment/i.test(migration));
  check("the immutable result path is selected by SQL, not trusted from the browser",
    /preview_result_storage_bucket/.test(store) && /preview_result_object_path/.test(store) &&
    /started\.generation\.preview_result_object_path/.test(route));
  check("the runtime keeps zero idle replicas and bounds simultaneous T4s at two",
    /minReplicas:\s*0/.test(infra) && /param runtimeMaxReplicas int = 2/.test(infra) &&
    /maxReplicas:\s*runtimeMaxReplicas/.test(infra) && /concurrentRequests:\s*'1'/.test(infra));
  check("the phone does not promise background execution without a worker",
    /Closing this page pauses browser checks/.test(phone) && !/Your request continues on the server/.test(phone));
  check("broker replay memory is process-local while the broker can scale",
    /application\.state\.seen_nonces\s*=\s*\{\}/.test(broker) &&
    /nonce in app\.state\.seen_nonces/.test(broker));
}

console.log(`\n${passed} red-team assertions passed. No network, database, storage, or GPU calls were made.`);
