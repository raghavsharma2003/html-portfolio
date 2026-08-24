import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  beginFoundrySpend,
  audioReservationMicrousd,
  azureSpeechBillableAudioMs,
  conservativeTokenEstimate,
  conservativeCharacterUnits,
  foundryBudgetConfig,
  markFoundrySpendUncertain,
  releaseFoundrySpendBeforeCall,
  reserveAzureSpeechSpend,
  reserveAzurePersonalVoiceSpend,
  reserveFoundrySpend,
  settleFoundrySpend,
  settleAzureSpeechSpend,
  settleAzurePersonalVoiceSpend,
  speechBudgetConfig,
  personalVoiceBudgetConfig,
  personalVoiceReservationMicrousd,
  tokenReservationMicrousd,
} from "../../api/_provider-budget.js";
import { splitSql } from "../../db/migrations/apply.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const RESERVATION = "10000000-0000-4000-8000-000000000001";
let checks = 0;

function ok(name, value) {
  assert.ok(value, name);
  console.log(`ok ${++checks} - ${name}`);
}

const env = {
  AZURE_REPLICA_BUDGET_ID: "azure-replica-grant-v1",
  AZURE_REPLICA_APP_BUDGET_USD: "1500",
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "1.25",
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: "5",
};
const config = foundryBudgetConfig(env);
ok("explicit application budget reserves infrastructure headroom below the grant", config.limit_microusd === 1_500_000_000);
assert.throws(() => foundryBudgetConfig({ ...env, AZURE_REPLICA_APP_BUDGET_USD: "2001" }), /provider_budget_limit_required/);
assert.throws(() => foundryBudgetConfig({ ...env, AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: "" }), /provider_input_rate_required/);
ok("missing or grant-exceeding budget configuration fails closed", true);
const estimated = conservativeTokenEstimate([{ role: "user", content: "नमस्ते, scene kya hai?" }]);
ok("token reservation conservatively counts UTF-8 request bytes", estimated === Buffer.byteLength(JSON.stringify([{ role: "user", content: "नमस्ते, scene kya hai?" }]), "utf8"));
ok("microusd math converts per-million-token rates without floating unit mistakes", tokenReservationMicrousd(1_000, 200, config) === 2_250);

const speechEnv = { ...env, AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR: "0.36" };
const speechConfig = speechBudgetConfig(speechEnv);
ok("audio billing converts exact milliseconds into microusd", audioReservationMicrousd(10_000, speechConfig) === 1_000);
ok("Azure Speech rounds every separately submitted input up to its billable second",
  azureSpeechBillableAudioMs([{ duration_ms: 10_001 }, { duration_ms: 1 }]) === 12_000);
assert.throws(() => speechBudgetConfig({ ...env }), /provider_audio_rate_required/);
ok("missing Azure Speech rate fails closed", true);

const voiceEnv = {
  ...env,
  AZURE_PERSONAL_VOICE_USD_PER_PROFILE: "0.25",
  AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS: "16",
};
const voiceConfig = personalVoiceBudgetConfig(voiceEnv);
ok("Personal Voice profile billing converts a configured native request rate to microusd",
  personalVoiceReservationMicrousd("voice_training", 1, voiceConfig) === 250_000);
ok("Personal Voice synthesis reserves UTF-8 bytes as a conservative multilingual character bound",
  conservativeCharacterUnits("hello à¤¨à¤®à¤¸à¥à¤¤à¥‡") === Buffer.byteLength("hello à¤¨à¤®à¤¸à¥à¤¤à¥‡", "utf8"));
assert.throws(() => personalVoiceBudgetConfig({ ...env }), /provider_voice_profile_rate_required/);
ok("missing Personal Voice native rates fail closed", true);

const adapter = {
  family: "dialogue",
  name: "azure-foundry-structured-output",
  version: "2024-05-01-preview:replica-dialogue/v1",
  model: "gpt-5-mini",
  billing: { meter: "azure_foundry_tokens", max_output_tokens: 700 },
};
const calls = [];
const reservation = await reserveFoundrySpend(async (sql, params) => {
  calls.push({ sql, params });
  return [{
    reservation_id: RESERVATION,
    budget_id: params[0],
    request_hash: params[7],
    state: "reserved",
    reserved_microusd: params[10],
  }];
}, { operation: "dialogue", requestKey: "turn-opaque-1", adapter, messages: [{ role: "user", content: "hello" }], env });
ok("reservation returns only content-free spend authority", reservation.reservation_id === RESERVATION && /^[0-9a-f]{64}$/.test(reservation.request_hash));
ok("atomic SQL creates a unique pending request before incrementing the budget", /on conflict \(budget_id,operation,request_hash\) do nothing/i.test(calls[0].sql) && /reserved_microusd=b\.reserved_microusd\+\$11/i.test(calls[0].sql));
ok("reservation checks spent plus outstanding reservations against the hard ceiling", /spent_microusd\+b\.reserved_microusd\+\$11<=b\.limit_microusd/i.test(calls[0].sql));
ok("budget ledger receives no prompt owner replica or raw request key", !calls[0].params.includes("hello") && !calls[0].params.includes("turn-opaque-1"));

const beginCalls = [];
await beginFoundrySpend(async (sql, params) => {
  beginCalls.push({ sql, params });
  return [{ reservation_id: RESERVATION, state: "in_flight" }];
}, reservation);
ok("paid call obtains a one-way in-flight marker before network I/O", /state='in_flight'/.test(beginCalls[0].sql) && /state='reserved'/.test(beginCalls[0].sql));

const releaseCalls = [];
await releaseFoundrySpendBeforeCall(async (sql, params) => {
  releaseCalls.push({ sql, params });
  return [{ budget_id: reservation.budget_id, spent_microusd: 0, reserved_microusd: 0, limit_microusd: config.limit_microusd, state: "active" }];
}, reservation, new Error("begin_ack_lost"));
ok("a failed begin acknowledgement releases only before provider I/O", /state in \('reserved','in_flight'\)/i.test(releaseCalls[0].sql) && /state='released'/i.test(releaseCalls[0].sql));
ok("pre-call release atomically returns the full reservation", /reserved_microusd=greatest\(0,b\.reserved_microusd-r\.reserved_microusd\)/i.test(releaseCalls[0].sql));

const settleCalls = [];
const settled = await settleFoundrySpend(async (sql, params) => {
  settleCalls.push({ sql, params });
  return [{ budget_id: reservation.budget_id, spent_microusd: params[5], reserved_microusd: 0, limit_microusd: config.limit_microusd, state: "active" }];
}, reservation, { input_tokens: 50, output_tokens: 25 });
ok("settlement atomically releases reserve and charges measured usage", settled.state === "active" && /reserved_microusd=greatest\(0,b\.reserved_microusd-s\.reserved_microusd\)/i.test(settleCalls[0].sql) && /spent_microusd=b\.spent_microusd\+s\.actual_microusd/i.test(settleCalls[0].sql));
ok("settlement accepts only in-flight or manually reconciled reservations", /state in \('in_flight','reconcile_required'\)/i.test(settleCalls[0].sql));
await assert.rejects(settleFoundrySpend(async () => [], { ...reservation, reserved_microusd: 1 }, { input_tokens: 100, output_tokens: 100 }), /provider_reservation_underestimated/);
ok("actual spend above the reserved maximum fails closed", true);

const uncertainCalls = [];
await markFoundrySpendUncertain(async (sql, params) => { uncertainCalls.push({ sql, params }); return []; }, reservation, new Error("network_unknown"));
ok("unknown provider outcomes retain their reserve for manual reconciliation", /state='reconcile_required'/.test(uncertainCalls[0].sql) && /state='in_flight'/.test(uncertainCalls[0].sql));
await assert.rejects(reserveFoundrySpend(async (_sql, params) => [{ reservation_id: RESERVATION, budget_id: params[0], request_hash: params[7], state: "reconcile_required", reserved_microusd: params[10] }], { operation: "dialogue", requestKey: "turn-opaque-1", adapter, messages: [], env }), /provider_spend_reconciliation_required/);
ok("an uncertain request can never be charged a second time automatically", true);

const speechAdapter = { family: "asr", name: "azure-speech-fast-transcription", version: "2025-10-15", model: "azure-speech-fast-transcription", billing: { meter: "azure_speech_audio_ms" } };
const audioSpendCalls = [];
const audioReservation = await reserveAzureSpeechSpend(async (sql, params) => {
  audioSpendCalls.push({ sql, params });
  return [{ reservation_id: RESERVATION, budget_id: params[0], request_hash: params[6], state: "reserved", reserved_microusd: params[8] }];
}, { requestKey: "job:1:1", adapter: speechAdapter, inputs: [{ artifact_id: "a", sha256: "d".repeat(64), duration_ms: 10_000 }], env: speechEnv });
ok("Azure Speech reserves conservatively billable audio duration under the shared grant ceiling", audioReservation.reserved_units === 10_000 && audioReservation.reserved_microusd === 1_000 && /'audio_ms'/.test(audioSpendCalls[0].sql));
ok("audio reservation commitment binds artifact digest duration and retry identity", !audioSpendCalls[0].params.includes("job:1:1") && /^[0-9a-f]{64}$/.test(audioReservation.request_hash));
const audioSettleCalls = [];
await settleAzureSpeechSpend(async (sql, params) => {
  audioSettleCalls.push({ sql, params });
  return [{ budget_id: audioReservation.budget_id, spent_microusd: params[4], reserved_microusd: 0, limit_microusd: speechConfig.limit_microusd, state: "active" }];
}, audioReservation, { audio_ms: 10_000 });
ok("Azure Speech settlement charges measured audio and releases the whole reservation atomically", /unit_kind='audio_ms'/.test(audioSettleCalls[0].sql) && /reserved_microusd=greatest/.test(audioSettleCalls[0].sql));
await assert.rejects(settleAzureSpeechSpend(async () => [], audioReservation, { audio_ms: 10_001 }), /provider_usage_missing/);
ok("audio usage cannot exceed the input duration reserved before upload", true);

const voiceAdapter = {
  family: "azure_speech",
  name: "azure_personal_voice",
  version: "azure-personal-voice/2026-01-01",
  model: "PhoenixV2Neural",
  billing: {
    voice_training: { meter: "azure_personal_voice_profiles" },
    synthesis: { meter: "azure_personal_voice_characters" },
  },
};
const voiceSpendCalls = [];
const voiceReservation = await reserveAzurePersonalVoiceSpend(async (sql, params) => {
  voiceSpendCalls.push({ sql, params });
  return [{ reservation_id: RESERVATION, budget_id: params[0], request_hash: params[7], state: "reserved", reserved_microusd: params[10] }];
}, {
  operation: "voice_training",
  requestKey: "opaque-voice-build",
  inputCommitment: "e".repeat(64),
  adapter: voiceAdapter,
  env: voiceEnv,
});
ok("Personal Voice training reserves one native profile request under the shared ceiling",
  voiceReservation.reserved_units === 1 && voiceReservation.unit_kind === "requests" && voiceReservation.reserved_microusd === 250_000);
const settledVoiceReservation = await reserveAzurePersonalVoiceSpend(async (_sql, params) => [{
  reservation_id: RESERVATION,
  budget_id: params[0],
  request_hash: params[7],
  state: "settled",
  reserved_microusd: params[10],
}], {
  operation: "voice_training",
  requestKey: "opaque-voice-build",
  inputCommitment: "e".repeat(64),
  adapter: voiceAdapter,
  env: voiceEnv,
});
ok("a settled Personal Voice build returns reusable authority without allocating again",
  settledVoiceReservation.state === "settled" && settledVoiceReservation.reserved_units === 1);
const synthesisReservation = await reserveAzurePersonalVoiceSpend(async (_sql, params) => [{
  reservation_id: RESERVATION,
  budget_id: params[0],
  request_hash: params[7],
  state: "reserved",
  reserved_microusd: params[10],
}], {
  operation: "synthesis",
  requestKey: "opaque-generation",
  inputCommitment: "f".repeat(64),
  adapter: voiceAdapter,
  text: "à¤¨à¤®à¤¸à¥à¤¤à¥‡",
  env: voiceEnv,
});
ok("Personal Voice synthesis reserves conservative multilingual characters without storing text",
  synthesisReservation.unit_kind === "characters" && synthesisReservation.reserved_units === Buffer.byteLength("à¤¨à¤®à¤¸à¥à¤¤à¥‡", "utf8") &&
  !voiceSpendCalls[0].params.includes("opaque-voice-build"));
const voiceSettleCalls = [];
await settleAzurePersonalVoiceSpend(async (sql, params) => {
  voiceSettleCalls.push({ sql, params });
  return [{ budget_id: voiceReservation.budget_id, spent_microusd: params[4], reserved_microusd: 0, limit_microusd: voiceConfig.limit_microusd, state: "active" }];
}, voiceReservation, { units: 1 });
ok("Personal Voice settlement releases reserve using the exact native unit kind",
  /unit_kind=\$6/.test(voiceSettleCalls[0].sql) && voiceSettleCalls[0].params[5] === "requests");
await assert.rejects(settleAzurePersonalVoiceSpend(async () => [], synthesisReservation, {
  units: synthesisReservation.reserved_units + 1,
}), /provider_usage_missing/);
ok("Personal Voice usage cannot exceed its conservative reservation", true);

const migration = readFileSync(join(ROOT, "db/migrations/028_provider_budget.sql"), "utf8");
ok("budget migration remains one-statement-runner safe", splitSql(migration).length === 4);
const executableMigration = migration.replace(/^--.*$/gm, "");
ok("budget and spend tables contain no user content or tenant identifier columns", !/^\s*(prompt|transcript|reply|owner_user_id|replica_id)\s+/im.test(executableMigration));
ok("database enforces a nonnegative bounded global spend counter", /spent_microusd \+ reserved_microusd <= limit_microusd/i.test(migration) && /reserved_microusd >= 0/i.test(migration));

const claims = readFileSync(join(ROOT, "api/_replica-claims.js"), "utf8");
const dialogue = readFileSync(join(ROOT, "api/_replica-dialogue.js"), "utf8");
ok("claim extraction reserves and starts spend before contacting Azure", /reservation = await reserveFoundrySpend[\s\S]*await beginFoundrySpend[\s\S]*extractor\.extract/.test(claims));
ok("dialogue reserves and starts spend before contacting Azure", /reservation = await reserveFoundrySpend[\s\S]*await beginFoundrySpend[\s\S]*generator\.generate/.test(dialogue));
ok("both paid paths release a failed begin before provider I/O", /releaseFoundrySpendBeforeCall[\s\S]*extractor\.extract/.test(claims) && /releaseFoundrySpendBeforeCall[\s\S]*generator\.generate/.test(dialogue));
ok("both paid paths preserve uncertain reservations instead of guessing no charge", /markFoundrySpendUncertain/.test(claims) && /markFoundrySpendUncertain/.test(dialogue));

console.log(`\n${checks} provider budget checks passed`);
