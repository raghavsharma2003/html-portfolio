// WS-W. The "Preview my voice" panel's server logic, offline.
//
// Four things this suite exists to hold, each of which fails SILENTLY:
//
//  - THE OWNERSHIP REFUSAL, COUNTED AS AN ABSENCE. A caller who does not own
//    the replica must not merely get a 4xx — the private bucket must not be
//    read and the GPU must not be touched. Those are asserted as ZEROS, with a
//    positive control (the real owner) proving the counters can move at all,
//    and a negative control (the owner predicate struck out of the SQL) proving
//    the refusal comes from the owner binding rather than from something
//    incidental about the fixture.
//  - THE COLD-START STATE MACHINE. `docs/gurukul/AZURE-DEPLOY-STATE.md` §8
//    measured a runtime that is ready at 161 s while the request that woke it
//    dies at 242 s. Every honest way of surfacing that is a THIRD outcome
//    alongside audio and error, and a third outcome is exactly the kind of
//    thing a later refactor folds back into one of the other two.
//  - THE 401 THAT IS NOT A 401. `context/rejected.md#hmac-skew-shorter-than-cold-start`
//    is the whole reason the broker is woken on an unauthenticated `/healthz`
//    before anything is signed. The suite asserts no signed byte leaves before
//    that answers 200, and its negative control is a classifier that treats a
//    wrong key as a cold start — which must fail, because WS-L's negative
//    control at the broker exists precisely to keep those apart.
//  - THE DISCLOSURE AND THE WATERMARK. A clip whose rendered text does not
//    carry the spoken disclosure must not become audio, on this path as on
//    every other. Asserted through the REAL `assertSynthesisResult`.
//
// Offline, deterministic, $0, no database and no network: the real
// `beginOwnedVoicePreview`, the real warm-up module and the real handler,
// driven through a fake db, a fake bucket, a fake broker and a virtual clock.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  WARMUP,
  capPanelText,
  classifyPreviewFailure,
  createWarmthRegistry,
  probeAdmissionHealth,
} from "../api/_voice/warmup.js";
import { handleVoicePreviewPanel } from "../api/_voice/preview-panel.js";
import { beginOwnedVoicePreview } from "../api/_replica-voice-preview.js";
import { VOICE_PCM_FORMAT } from "../api/_voice/contracts.js";
import { buildVoiceTextPlan, voiceTextPlanAudit } from "../api/_voice/hindi-text-frontend.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://broker.example.invalid";

let passed = 0;
const failures = [];
function check(name, condition, detail = "") {
  if (condition) { passed += 1; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
function section(name) { console.log(`\n  ${name}`); }

// ── fixtures ────────────────────────────────────────────────────────────────

const OWNER = randomUUID();
const INTRUDER = randomUUID();
const REPLICA = randomUUID();
const ARTIFACT = randomUUID();
const SOURCE = randomUUID();
const GENOME_VERSION = 3;

function wav(seconds = 8) {
  const samples = VOICE_PCM_FORMAT.sampleRate * seconds;
  const pcm = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) pcm.writeInt16LE(Math.round(Math.sin(i / 40) * 8000), i * 2);
  const head = Buffer.alloc(44);
  head.write("RIFF", 0); head.writeUInt32LE(36 + pcm.length, 4); head.write("WAVE", 8);
  head.write("fmt ", 12); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22); head.writeUInt32LE(24_000, 24); head.writeUInt32LE(48_000, 28);
  head.writeUInt16LE(2, 32); head.writeUInt16LE(16, 34); head.write("data", 36);
  head.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([head, pcm]);
}
const REFERENCE = wav();
const REFERENCE_SHA = createHash("sha256").update(REFERENCE).digest("hex");
const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

function generationRow(ownerUserId, traceId) {
  return {
    generation_id: randomUUID(),
    replica_id: REPLICA,
    owner_user_id: ownerUserId,
    channel: "studio_preview",
    purpose: "voice_preview",
    policy_version: "vyakti-replica-output-v1",
    trace_id: traceId,
    genome_version: GENOME_VERSION,
    genome_status: "draft",
    subject_mode: "self",
    lifecycle: "calibrating",
    replica_policy_version: "replica-self-v1",
    age_verified_at: PAST,
    identity_verified_at: PAST,
    liveness_verified_at: PAST,
    identity_expires_at: FUTURE,
    artifact_id: ARTIFACT,
    source_id: SOURCE,
    object_path: `replica/${REPLICA}/enhance/${ARTIFACT}.wav`,
    mime: "audio/wav",
    byte_size: REFERENCE.length,
    duration_ms: 8_000,
    sha256: REFERENCE_SHA,
    stage: "enhance",
    selection_decision: "selected",
    source_state: "ready",
    contains_third_parties: false,
    consent_id: randomUUID(),
    consent_scope: "inference",
    consent_policy_version: "replica-self-v1",
    consent_granted_at: PAST,
    consent_expires_at: null,
    consent_revoked_at: null,
    preview_model_commitment: "x".repeat(64),
  };
}

/**
 * A fake db that refuses to answer a statement whose owner predicate has been
 * removed. `rejected.md#router-matched-a-table-instead-of-a-statement`: a mock
 * keyed on a table name will one day answer a different query than the one it
 * was written for, and one that OVER-RETURNS hides the defect it exists to
 * catch.
 */
function fakeDb({ owner = OWNER, requireOwnerPredicate = true } = {}) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push({ sql, params });
    if (/^\s*update vy_replica_generation set state=/i.test(sql)) return [];
    if (requireOwnerPredicate && !sql.includes("r.owner_user_id=$2::uuid")) {
      throw new Error("fake db refused a statement with no owner predicate");
    }
    if (params[0] !== REPLICA) return [];
    if (requireOwnerPredicate && params[1] !== owner) return [];
    return [generationRow(params[1], params[4])];
  };
  db.calls = calls;
  return db;
}

function fakeProvider(options = {}) {
  const seen = [];
  return {
    name: "open_chatterbox_multilingual_v3",
    modelCommitment: "a".repeat(64),
    calls: seen,
    async synthesizePreview(input) {
      seen.push(input);
      if (options.throws) throw options.throws;
      if (options.gate) await options.gate;
      if (options.hangMs) await new Promise((resolve) => setTimeout(resolve, options.hangMs));
      const pcm = Buffer.alloc(4_800, 1);
      const plan = buildVoiceTextPlan({ text: input.text, languageId: input.languageId });
      return {
        renderedText: options.skipDisclosure ? input.text : plan.targetText,
        disclosureText: plan.disclosureText,
        format: VOICE_PCM_FORMAT,
        stream: (async function* () { yield new Uint8Array(pcm); })(),
        receipt: { textFrontend: voiceTextPlanAudit(plan) },
      };
    },
  };
}

function fakeProtect(generationIdRef) {
  return async ({ sourceStream }) => {
    const chunks = [];
    for await (const chunk of sourceStream) chunks.push(Buffer.from(chunk));
    return {
      stream: (async function* () { yield new Uint8Array(Buffer.concat(chunks)); })(),
      completion: Promise.resolve({ generation_id: generationIdRef.value }),
    };
  };
}

function harness(options = {}) {
  const clock = { t: options.startAt ?? 1_000_000 };
  const warmth = options.warmth || createWarmthRegistry();
  const provider = options.provider || fakeProvider();
  const db = options.db || fakeDb();
  const generationIdRef = { value: null };
  const state = { reads: 0, healthFetches: [], failures: [], protections: 0, slept: 0 };
  const deps = {
    origin: ORIGIN,
    warmth,
    provider,
    traceId: `panel_${"a".repeat(24)}`,
    now: () => clock.t,
    sleep: async (ms) => { state.slept += ms; clock.t += ms; },
    flushMs: options.flushMs ?? 12_000,
    healthBudgetMs: options.healthBudgetMs,
    fetchImpl: options.fetchImpl || (async (url, init) => {
      state.healthFetches.push({ url, init });
      clock.t += 800;
      return { ok: true, status: 200 };
    }),
    authorize: async (input) => {
      const started = await beginOwnedVoicePreview(db, options.callerId ?? OWNER, input);
      generationIdRef.value = started.generation.generation_id;
      return started;
    },
    markFailed: async (generationId, error) => {
      state.failures.push({ generationId, code: String(error?.code || error?.message || "") });
    },
    readObject: async () => {
      state.reads += 1;
      return { body: REFERENCE, byteSize: REFERENCE.length, mime: "audio/wav" };
    },
    protect: options.protect || (async (input) => {
      state.protections += 1;
      return fakeProtect(generationIdRef)(input);
    }),
  };
  return { clock, deps, state, provider, db, warmth };
}

const PREVIEW = Object.freeze({
  op: "preview",
  replica_id: REPLICA,
  genome_version: GENOME_VERSION,
  language_id: "hi",
  text: "Namaste! Main aapka apna AI version hoon.",
});

// ── 1. the text cap ─────────────────────────────────────────────────────────

section("text cap");
{
  check("empty text is refused", (() => {
    try { capPanelText("   "); return false; } catch (e) { return e.code === "voice_preview_text_required" && e.status === 400; }
  })());
  check("280 characters is accepted", capPanelText("क".repeat(280)).length === 280);
  check("281 characters is refused with 413", (() => {
    try { capPanelText("क".repeat(281)); return false; } catch (e) { return e.code === "voice_preview_text_too_large" && e.status === 413; }
  })());
  // The lab's cap is 600. If the panel ever inherits it instead of imposing its
  // own, this is the assertion that notices — the panel is one click from a
  // landing view and every character is GPU seconds.
  check("the lab's 600-character text is refused by the panel", (() => {
    try { capPanelText("a".repeat(600)); return false; } catch (e) { return e.code === "voice_preview_text_too_large"; }
  })());
  check("whitespace is collapsed, not counted", capPanelText("  a\n\n   b  ") === "a b");
  // Negative control: a cap that measures UTF-16 units instead of code points
  // would let 280 astral characters through as 140. Assert the real one counts
  // code points.
  check("code points, not UTF-16 units", (() => {
    try { capPanelText("😀".repeat(281)); return false; } catch (e) { return e.code === "voice_preview_text_too_large"; }
  })());
}

// ── 2. the warmth state machine ─────────────────────────────────────────────

section("warmth state machine");
{
  const warmth = createWarmthRegistry();
  let t = 5_000_000;
  check("an unknown origin reads cold", warmth.read(ORIGIN, t).state === "cold");
  warmth.note(ORIGIN, "waking", t);
  check("a dispatched wake reads warming", warmth.read(ORIGIN, t + 1_000).state === "warming");
  check("a wake still reads warming just inside its window",
    warmth.read(ORIGIN, t + WARMUP.wakeInFlightMs - 1).state === "warming");
  check("a wake that never landed decays back to cold",
    warmth.read(ORIGIN, t + WARMUP.wakeInFlightMs + 1).state === "cold");
  warmth.note(ORIGIN, "ready", t);
  check("a success reads warm", warmth.read(ORIGIN, t + 1_000).state === "warm");
  check("warmth expires at the ttl", warmth.read(ORIGIN, t + WARMUP.warmTtlMs + 1).state === "cold");
  warmth.note(ORIGIN, "unreachable", t + 10);
  check("an unreachable runtime clears warmth", warmth.read(ORIGIN, t + 20).state === "cold");
  check("warmth is scoped to its origin", warmth.read("https://other.invalid", t + 20).state === "cold");
  // Negative control: a registry with no expiry passes every "is it warm"
  // assertion above and fails this one. Warmth that never decays is a
  // guaranteed four-minute hang the first time the runtime scales to zero.
  const neverExpires = { read: () => ({ state: "warm", ageMs: 0 }) };
  check("NEGATIVE CONTROL: a never-expiring registry is caught",
    neverExpires.read().state === "warm" && warmth.read(ORIGIN, t + WARMUP.warmTtlMs + 1).state !== "warm");
}

// ── 3. the unauthenticated wake ─────────────────────────────────────────────

section("admission wake (nothing is signed until /healthz answers)");
{
  const clock = { t: 0 };
  const seen = [];
  let attempt = 0;
  const health = await probeAdmissionHealth({
    origin: ORIGIN,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      clock.t += 700;
      attempt += 1;
      if (attempt < 3) throw new Error("ECONNREFUSED");
      return { ok: true, status: 200 };
    },
  });
  check("the broker is woken and answers", health.ok && health.attempts === 3, JSON.stringify(health));
  check("only /healthz is called", seen.every((call) => call.url === `${ORIGIN}/healthz`));
  check("the wake is a GET", seen.every((call) => call.init.method === "GET"));
  // The whole point of rejected.md#hmac-skew-shorter-than-cold-start: a
  // signature minted before a wake is verified after it, ~3x outside the
  // window, and comes back wearing the mask of a wrong key.
  check("NOTHING is signed during the wake", seen.every((call) => {
    const headers = call.init.headers || {};
    return !Object.keys(headers).some((name) => /^x-vyakti-(signature|timestamp|nonce)$/i.test(name));
  }));

  const cold = await probeAdmissionHealth({
    origin: ORIGIN,
    budgetMs: 9_000,
    intervalMs: 3_000,
    now: () => clock.t,
    sleep: async (ms) => { clock.t += ms; },
    fetchImpl: async () => { clock.t += 100; throw new Error("ECONNREFUSED"); },
  });
  check("a broker that never answers is reported, not retried forever",
    !cold.ok && cold.code === "voice_admission_cold", JSON.stringify(cold));

  const bad = await probeAdmissionHealth({ origin: "http://plain.invalid", fetchImpl: async () => ({ ok: true }) });
  check("a non-https origin is refused before any request", !bad.ok && bad.code === "voice_origin_invalid" && bad.attempts === 0);
  const missing = await probeAdmissionHealth({ origin: "", fetchImpl: async () => ({ ok: true }) });
  check("an absent origin is refused", !missing.ok && missing.code === "voice_origin_invalid");
}

// ── 4. failure classification ───────────────────────────────────────────────

section("failure classification");
{
  for (const code of ["open_voice_unreachable", "open_voice_http_504", "open_voice_http_503", "voice_preview_timeout"]) {
    check(`${code} reads as warming`, classifyPreviewFailure({ code }).state === "warming");
  }
  for (const code of ["transport_binding_invalid", "transport_replay_denied", "open_voice_response_binding_invalid",
    "voice_preview_reference_binding_failed", "open_voice_http_401", "open_voice_http_409"]) {
    check(`${code} stays an error`, classifyPreviewFailure({ code }).state === "error", code);
  }
  // Negative control. WS-L's smoke test proved a wrong key and an unreachable
  // runtime are distinguishable AT THE BROKER; a lenient classifier throws that
  // away on the client side instead, and would tell an owner with a rotated
  // secret to wait two minutes, forever.
  const lenient = () => ({ state: "warming" });
  check("NEGATIVE CONTROL: a classifier that calls a wrong key a cold start is caught",
    lenient().state === "warming" && classifyPreviewFailure({ code: "transport_binding_invalid" }).state === "error");
}

// ── 5. ownership ────────────────────────────────────────────────────────────

section("ownership");
{
  const intruder = harness({ callerId: INTRUDER });
  const refused = await handleVoicePreviewPanel({ ...PREVIEW }, intruder.deps);
  check("a caller who does not own the replica is refused",
    refused.kind === "json" && refused.status === 409 && refused.body.error === "voice_preview_not_authorized",
    JSON.stringify(refused.body));
  // Counted as absences. A refusal that still read the private bucket or woke a
  // GPU would pass a status-code-only assertion.
  check("the refusal reads NOTHING from the private bucket", intruder.state.reads === 0);
  check("the refusal touches NO synthesis", intruder.provider.calls.length === 0);
  check("the refusal does not even wake the broker", intruder.state.healthFetches.length === 0);

  const wrongReplica = harness();
  const other = await handleVoicePreviewPanel({ ...PREVIEW, replica_id: randomUUID() }, wrongReplica.deps);
  check("an owner previewing somebody else's replica is refused",
    other.kind === "json" && other.status === 409, JSON.stringify(other.body));
  check("that refusal spends nothing either",
    wrongReplica.state.reads === 0 && wrongReplica.provider.calls.length === 0);

  // POSITIVE CONTROL: the same fixture with the real owner must get through, or
  // the three zeros above prove nothing but a broken fixture.
  const owner = harness();
  owner.warmth.note(ORIGIN, "ready", owner.clock.t);
  const allowed = await handleVoicePreviewPanel({ ...PREVIEW }, owner.deps);
  check("POSITIVE CONTROL: the real owner does get audio",
    allowed.kind === "audio" && allowed.status === 200, JSON.stringify(allowed.body || {}));
  check("POSITIVE CONTROL: the counters can move", owner.state.reads === 1 && owner.provider.calls.length === 1);

  // NEGATIVE CONTROL: strike the owner predicate out of the fence and the
  // intruder gets through. This is what makes the refusal above evidence about
  // the owner binding rather than about the fixture.
  const struck = harness({ callerId: INTRUDER, db: fakeDb({ requireOwnerPredicate: false }) });
  struck.warmth.note(ORIGIN, "ready", struck.clock.t);
  const leaked = await handleVoicePreviewPanel({ ...PREVIEW }, struck.deps);
  check("NEGATIVE CONTROL: without the owner predicate the intruder DOES get through",
    leaked.kind === "audio", JSON.stringify(leaked.body || {}));

  // Identity is never read from the body. A request that tries to name its own
  // owner must be treated exactly like one that does not.
  const spoof = harness({ callerId: INTRUDER });
  const spoofed = await handleVoicePreviewPanel(
    { ...PREVIEW, owner_user_id: OWNER, user_id: OWNER, ownerUserId: OWNER }, spoof.deps);
  check("an owner id in the request body buys nothing",
    spoofed.kind === "json" && spoofed.status === 409, JSON.stringify(spoofed.body));
  check("the db was bound to the SESSION owner, not the body's",
    spoof.db.calls.every((call) => call.params[1] === INTRUDER));
}

// ── 6. the cold-start state machine, end to end ─────────────────────────────

section("cold start");
{
  // A cold runtime: the synthesis is dispatched and hangs past the flush window.
  const cold = harness({ provider: fakeProvider({ hangMs: 5_000 }), flushMs: 40 });
  const first = await handleVoicePreviewPanel({ ...PREVIEW }, cold.deps);
  check("a cold runtime answers 202 warming, not a hung request",
    first.kind === "json" && first.status === 202 && first.body.state === "warming", JSON.stringify(first.body));
  check("the warming answer names the runtime as the reason", first.body.stage === "runtime_cold");
  check("the warming answer carries the live-corrected 2-5 minute eta",
    first.body.eta_seconds_low === 120 && first.body.eta_seconds_high === 300 &&
      /2 to 5 minutes/.test(first.body.message), JSON.stringify(first.body));
  check("the warming answer carries a retry hint", first.body.retry_after_ms > 0);
  check("it sets Retry-After", Number(first.headers["Retry-After"]) > 0);
  check("the wake was actually DISPATCHED, not skipped", cold.provider.calls.length === 1);
  check("the wake is recorded so the next click does not pay again",
    cold.warmth.read(ORIGIN, cold.clock.t).state === "warming");
  check("the abandoned generation is marked, not left authorized",
    cold.state.failures.some((f) => f.code === "voice_preview_wake_dispatched"), JSON.stringify(cold.state.failures));

  // A second click while that wake is in flight must not buy a second GPU boot.
  const second = await handleVoicePreviewPanel({ ...PREVIEW }, cold.deps);
  check("a second click during the wake returns warming", second.status === 202 && second.body.stage === "wake_in_flight");
  check("a second click does NOT start a second synthesis", cold.provider.calls.length === 1);
  check("a second click does not re-read the reference", cold.state.reads === 1);

  // The first HTTP response is already gone when a cold provider resolves.
  // That late success must still clear the per-process warming belief, while
  // the discarded generation remains failed and never reaches protection.
  let releaseLateWake;
  const lateWakeGate = new Promise((resolve) => { releaseLateWake = resolve; });
  const late = harness({ provider: fakeProvider({ gate: lateWakeGate }), flushMs: 40 });
  const dispatched = await handleVoicePreviewPanel({ ...PREVIEW }, late.deps);
  check("a late wake first answers with the non-blocking warming response",
    dispatched.status === 202 && dispatched.body.wake_dispatched === true, JSON.stringify(dispatched.body));
  check("the late wake is still warming before the provider answers",
    late.warmth.read(ORIGIN, late.clock.t).state === "warming");
  releaseLateWake();
  await new Promise((resolve) => setImmediate(resolve));
  check("a provider success after the flush marks the runtime ready",
    late.warmth.read(ORIGIN, late.clock.t).state === "warm");
  check("the discarded generation stays failed and is never protected or sealed",
    late.state.failures.some((f) => f.code === "voice_preview_wake_dispatched") && late.state.protections === 0,
    JSON.stringify({ failures: late.state.failures, protections: late.state.protections }));

  // Once warm, the same request returns audio.
  cold.warmth.note(ORIGIN, "ready", cold.clock.t);
  const warmProvider = fakeProvider();
  const warm = harness({ provider: warmProvider, warmth: cold.warmth });
  const third = await handleVoicePreviewPanel({ ...PREVIEW }, warm.deps);
  check("once warm the same request returns audio", third.kind === "audio", JSON.stringify(third.body || {}));
  check("the warm path waits for the synthesis rather than dispatching it", warmProvider.calls.length === 1);
  check("the audio is a RIFF/WAVE container",
    third.body.subarray(0, 4).toString() === "RIFF" && third.body.subarray(8, 12).toString() === "WAVE");
  check("the receipt headers are present",
    third.headers["X-Vyakti-Disclosure"] === "audible-prefix-v1" &&
    /^[0-9a-f-]{36}$/.test(third.headers["X-Vyakti-Generation"]) &&
    /^[0-9a-f]{64}$/.test(third.headers["X-Vyakti-Model-Commitment"]));

  // A broker that never answers: warming, and nothing signed or read.
  const noBroker = harness({
    healthBudgetMs: 6_000,
    fetchImpl: async () => { throw new Error("ECONNREFUSED"); },
  });
  const brokerCold = await handleVoicePreviewPanel({ ...PREVIEW }, noBroker.deps);
  check("an unreachable broker answers warming, not 401",
    brokerCold.status === 202 && brokerCold.body.stage === "admission_cold", JSON.stringify(brokerCold.body));
  check("an unreachable broker means no bucket read", noBroker.state.reads === 0);
  check("an unreachable broker means no synthesis", noBroker.provider.calls.length === 0);

  // A 504 out of the broker is a cold runtime, not a failure to show the owner.
  const timedOut = harness({ provider: fakeProvider({ throws: Object.assign(new Error("open_voice_http_504"), { code: "open_voice_http_504", status: 503 }) }) });
  timedOut.warmth.note(ORIGIN, "ready", timedOut.clock.t);
  const gateway = await handleVoicePreviewPanel({ ...PREVIEW }, timedOut.deps);
  check("a 504 from the runtime becomes warming", gateway.status === 202 && gateway.body.state === "warming",
    JSON.stringify(gateway.body));
  check("a 504 clears the warm belief so the next click waits properly",
    timedOut.warmth.read(ORIGIN, timedOut.clock.t).state === "warming");

  // A wrong key must NOT be dressed as a cold start.
  const wrongKey = harness({ provider: fakeProvider({ throws: Object.assign(new Error("transport_binding_invalid"), { code: "transport_binding_invalid", status: 401 }) }) });
  wrongKey.warmth.note(ORIGIN, "ready", wrongKey.clock.t);
  const rejected = await handleVoicePreviewPanel({ ...PREVIEW }, wrongKey.deps);
  check("an admission refusal stays an error",
    rejected.kind === "json" && rejected.status === 401 && rejected.body.state === "error" &&
    rejected.body.error === "transport_binding_invalid", JSON.stringify(rejected.body));
}

// ── 7. status, and what it must not spend ───────────────────────────────────

section("status");
{
  const h = harness();
  const cold = await handleVoicePreviewPanel({ op: "status" }, h.deps);
  check("status answers cold before anything has run", cold.status === 200 && cold.body.state === "cold");
  check("status spends no db, no bucket, no GPU, no broker",
    h.db.calls.length === 0 && h.state.reads === 0 && h.provider.calls.length === 0 && h.state.healthFetches.length === 0);
  h.warmth.note(ORIGIN, "ready", h.clock.t);
  const warm = await handleVoicePreviewPanel({ op: "status" }, h.deps);
  check("status answers warm after a success", warm.body.state === "warm" && warm.body.retry_after_ms === 0);
  const bad = await handleVoicePreviewPanel({ op: "delete-everything" }, h.deps);
  check("an unknown op is refused", bad.status === 400 && bad.body.error === "voice_preview_op_invalid");
  const lang = await handleVoicePreviewPanel({ ...PREVIEW, language_id: "fr" }, h.deps);
  check("an unsupported language is refused before authorization",
    lang.status === 400 && lang.body.error === "voice_preview_language_not_supported" && h.db.calls.length === 0);
}

// ── 8. the invariants that must not weaken ──────────────────────────────────

section("disclosure and watermark");
{
  // The provider renders the disclosure and the runtime verifies its own PerTh
  // watermark before it will return audio. The panel asserts the first through
  // the REAL contract; there is deliberately no branch that skips it.
  const naked = harness({ provider: fakeProvider({ skipDisclosure: true }) });
  naked.warmth.note(ORIGIN, "ready", naked.clock.t);
  const refused = await handleVoicePreviewPanel({ ...PREVIEW }, naked.deps);
  check("a clip with no spoken disclosure never becomes audio", refused.kind === "json" && refused.status === 500,
    JSON.stringify(refused.body));

  const withIt = harness();
  withIt.warmth.note(ORIGIN, "ready", withIt.clock.t);
  const ok = await handleVoicePreviewPanel({ ...PREVIEW }, withIt.deps);
  check("POSITIVE CONTROL: the same clip WITH the disclosure is audio", ok.kind === "audio");

  const panel = readFileSync(join(ROOT, "api/_voice/preview-panel.js"), "utf8");
  const route = readFileSync(join(ROOT, "api/voice-preview.js"), "utf8");
  const provider = readFileSync(join(ROOT, "api/_voice/providers/open-chatterbox-preview.js"), "utf8");
  check("the panel asserts the real synthesis contract", /assertSynthesisResult\(/.test(panel));
  check("the panel adds no disclosure bypass",
    !/(skip|no|without)[_-]?disclosure/i.test(panel) && !/allowTestAdapters/.test(panel) && !/allowTestAdapters/.test(route));
  check("the runtime's PerTh check is still mandatory in the provider",
    /perth_watermark_verified\s*!==\s*true/.test(provider));
  check("the panel reaches the runtime through that provider only",
    /createOpenChatterboxPreviewProvider/.test(route) && !/fetch\(/.test(panel));

  // The activation gate is a separate lane and this one may not touch it.
  check("the panel does not touch the activation gate",
    !/activat/i.test(panel) && !/can_activate|vy_replica_activation/.test(panel) && !/activat/i.test(route));
}

// ── 9. the route's identity boundary ────────────────────────────────────────

section("route identity boundary");
{
  const route = readFileSync(join(ROOT, "api/voice-preview.js"), "utf8");
  check("identity comes from requireUser", /const user = await requireUser\(req\)/.test(route));
  check("ownership is bound to the session user", /beginOwnedVoicePreview\(q, user\.id,/.test(route));
  check("the body never supplies an owner",
    !/body\.(owner_user_id|user_id|ownerUserId)/.test(route) && !/req\.body\.owner/.test(route));
  check("an auth failure answers with its own status", /error instanceof AuthError/.test(route));
  check("the route is rate limited per IP and per user",
    /allow\(ipOf\(req\)/.test(route) && /allow\(user\.id/.test(route));
  check("the preview bucket is tighter than the status bucket",
    /voice_preview_panel_run/.test(route) && /voice_preview_panel_status/.test(route));
  check("the HMAC secret never crosses to the client",
    !/OPEN_VOICE_HMAC_SECRET/.test(route) &&
    !readFileSync(join(ROOT, "src/studio/voicePanelApi.ts"), "utf8").includes("HMAC") &&
    !readFileSync(join(ROOT, "src/studio/VoicePreviewPanel.tsx"), "utf8").includes("AZURE_OPEN_VOICE_ORIGIN"));
  check("the client never calls the broker directly",
    !/azurecontainerapps\.io/.test(readFileSync(join(ROOT, "src/studio/voicePanelApi.ts"), "utf8")));
}

// ── report ──────────────────────────────────────────────────────────────────

section("client warmup budget");
{
  const client = readFileSync(join(ROOT, "src/studio/VoicePreviewPanel.tsx"), "utf8");
  const clientApi = readFileSync(join(ROOT, "src/studio/voicePanelApi.ts"), "utf8");
  // WS-R71: VoicePreviewPanel.tsx's own literal strings moved into
  // src/studio/copy.ts; the two English-wording checks below now read this
  // concatenation, `evals/readiness/run.mjs`'s own `panelWithCopy` shape.
  const clientWithCopy = `${client}\n${readFileSync(join(ROOT, "src/studio/copy.ts"), "utf8")}`;
  const retries = Number(client.match(/const MAX_AUTO_RETRIES\s*=\s*(\d+)/)?.[1]);
  // Once the 200 s wake belief expires, the next 30 s poll dispatches the
  // necessary second synthesis. Allow one minute for that warm synthesis and
  // one more polling interval for the fresh protected request to begin.
  const secondSynthesisMs = 60_000;
  const requiredBudgetMs = WARMUP.wakeInFlightMs + secondSynthesisMs + WARMUP.retryAfterMs;
  const pollTimes = Array.from({ length: retries }, (_, index) => (index + 1) * WARMUP.retryAfterMs);
  const secondDispatchAt = pollTimes.find((at) => at > WARMUP.wakeInFlightMs);
  const secondReadyAt = secondDispatchAt + secondSynthesisMs;
  const protectedRequestAt = pollTimes.find((at) => at > secondReadyAt);
  check("the client's automatic retry budget covers wake, second synthesis, and a later protected request",
    Number.isFinite(retries) && retries === 10 && retries * WARMUP.retryAfterMs >= requiredBudgetMs &&
      secondDispatchAt === 210_000 && protectedRequestAt === 300_000,
    JSON.stringify({ retries, retryAfterMs: WARMUP.retryAfterMs, wakeInFlightMs: WARMUP.wakeInFlightMs,
      requiredBudgetMs, secondDispatchAt, secondReadyAt, protectedRequestAt }));
  // Negative controls: six polls stop inside the original wake window; seven
  // cross it but stop on the response that dispatches the second synthesis.
  check("NEGATIVE CONTROL: the former six-poll budget is caught",
    6 * WARMUP.retryAfterMs <= WARMUP.wakeInFlightMs);
  check("NEGATIVE CONTROL: the former seven-poll budget cannot finish the second synthesis",
    7 * WARMUP.retryAfterMs < requiredBudgetMs);
  check("the panel and its API fallback both tell the owner the five-minute ceiling",
    /two to five minutes/.test(clientWithCopy) && /2 to 5 minutes/.test(clientApi) &&
      (clientApi.match(/etaSecondsHigh:\s*Number\([^\n]+\) \|\| 300/g) || []).length === 2);
  check("the warm-runtime copy promises only a relative improvement, not seconds",
    /after that it is usually much faster/i.test(clientWithCopy) && !/after that it is seconds/i.test(clientWithCopy));
  check("NEGATIVE CONTROL: no voice-panel path retains the disproved three-minute ceiling",
    !/(?:two|2) to (?:three|3) minutes|2-3 minutes|etaSecondsHigh:[^\n]+\|\| 180/.test(`${clientWithCopy}\n${clientApi}`));
}

console.log(`\n  ${passed} checks passed, ${failures.length} failed`);
for (const failure of failures) console.log(`  FAIL  ${failure}`);
process.exit(failures.length ? 1 : 0);
