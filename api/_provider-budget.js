import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

const OPERATIONS = new Set(["claim_extraction", "dialogue", "transcription", "voice_training", "synthesis", "liveness", "watermarking"]);
const BUDGET_ID = /^[a-z][a-z0-9_-]{2,63}$/;

function fail(code, status = 503, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function positive(value, code, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0 || number > max) fail(code);
  return number;
}

function integer(value, code) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail(code);
  return number;
}

export function foundryBudgetConfig(env = process.env) {
  const budgetId = String(env.AZURE_REPLICA_BUDGET_ID || "azure-replica-grant-v1").trim();
  if (!BUDGET_ID.test(budgetId)) fail("provider_budget_id_invalid");
  const limitUsd = positive(env.AZURE_REPLICA_APP_BUDGET_USD, "provider_budget_limit_required", 2_000);
  const inputUsdPerMillion = positive(env.AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS, "provider_input_rate_required", 10_000);
  const outputUsdPerMillion = positive(env.AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS, "provider_output_rate_required", 10_000);
  return Object.freeze({
    budget_id: budgetId,
    limit_microusd: Math.floor(limitUsd * 1_000_000),
    input_usd_per_million: inputUsdPerMillion,
    output_usd_per_million: outputUsdPerMillion,
  });
}

export function speechBudgetConfig(env = process.env) {
  const budgetId = String(env.AZURE_REPLICA_BUDGET_ID || "azure-replica-grant-v1").trim();
  if (!BUDGET_ID.test(budgetId)) fail("provider_budget_id_invalid");
  const limitUsd = positive(env.AZURE_REPLICA_APP_BUDGET_USD, "provider_budget_limit_required", 2_000);
  const usdPerHour = positive(env.AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR, "provider_audio_rate_required", 10_000);
  return Object.freeze({ budget_id: budgetId, limit_microusd: Math.floor(limitUsd * 1_000_000), usd_per_hour: usdPerHour });
}

export function conservativeTokenEstimate(messages) {
  const bytes = Buffer.byteLength(JSON.stringify(Array.isArray(messages) ? messages : []), "utf8");
  // One token per UTF-8 byte is intentionally conservative for the supported
  // English/Hindi/Hinglish inputs and includes JSON framing overhead.
  return Math.max(1, bytes);
}

export function tokenReservationMicrousd(inputTokens, outputTokens, config) {
  const input = integer(inputTokens, "provider_input_units_invalid");
  const output = integer(outputTokens, "provider_output_units_invalid");
  const amount = Math.ceil(input * config.input_usd_per_million + output * config.output_usd_per_million);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("provider_reservation_invalid");
  return amount;
}

export function audioReservationMicrousd(audioMs, config) {
  const milliseconds = integer(audioMs, "provider_audio_units_invalid");
  if (milliseconds <= 0) fail("provider_audio_units_invalid");
  const amount = Math.ceil(milliseconds * config.usd_per_hour / 3.6);
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("provider_reservation_invalid");
  return amount;
}

export function azureSpeechBillableAudioMs(inputs) {
  const durations = Array.isArray(inputs) ? inputs : [];
  if (!durations.length) fail("provider_audio_units_invalid");
  const billable = durations.reduce((sum, input) => {
    const durationMs = integer(input?.duration_ms, "provider_audio_units_invalid");
    if (durationMs <= 0) fail("provider_audio_units_invalid");
    return sum + Math.ceil(durationMs / 1_000) * 1_000;
  }, 0);
  if (!Number.isSafeInteger(billable) || billable <= 0) fail("provider_audio_units_invalid");
  return billable;
}

export async function reserveFoundrySpend(db, { operation, requestKey, adapter, messages, env = process.env }) {
  if (typeof db !== "function") fail("provider_budget_db_required");
  if (!OPERATIONS.has(operation)) fail("provider_budget_operation_invalid");
  if (adapter?.billing?.meter !== "azure_foundry_tokens") return null;
  const config = foundryBudgetConfig(env);
  const inputUnits = conservativeTokenEstimate(messages);
  const outputUnits = integer(adapter.billing.max_output_tokens, "provider_output_units_invalid");
  const reservedMicrousd = tokenReservationMicrousd(inputUnits, outputUnits, config);
  const requestHash = sha256Hex(canonicalJson({
    operation,
    request_key: String(requestKey || ""),
    provider_family: adapter.family,
    provider_name: adapter.name,
    provider_version: adapter.version,
    model: adapter.model,
  }));
  const rows = await db(
    `with budget as (
       insert into vy_provider_budget (budget_id,limit_microusd,state)
       values ($1,$2,'active')
       on conflict (budget_id) do update set updated_at=vy_provider_budget.updated_at
         where vy_provider_budget.limit_microusd=excluded.limit_microusd
       returning budget_id,limit_microusd,reserved_microusd,spent_microusd,state
     ), candidate as (
       insert into vy_provider_spend
         (budget_id,operation,provider_family,provider_name,provider_version,model,request_hash,unit_kind,
          reserved_input_units,reserved_output_units,reserved_microusd,state)
       select budget_id,$3,$4,$5,$6,$7,$8,'tokens',$9,$10,$11,'pending' from budget
       on conflict (budget_id,operation,request_hash) do nothing
       returning *
     ), allocated as (
       update vy_provider_budget b
          set reserved_microusd=b.reserved_microusd+$11,updated_at=now()
         from candidate c
        where b.budget_id=c.budget_id and b.state='active'
          and b.spent_microusd+b.reserved_microusd+$11<=b.limit_microusd
       returning b.budget_id
     ), finalized as (
       update vy_provider_spend s set state='reserved',updated_at=now()
         from candidate c,allocated a
        where s.reservation_id=c.reservation_id and s.budget_id=a.budget_id
       returning s.*
     ), rejected as (
       delete from vy_provider_spend s using candidate c
        where s.reservation_id=c.reservation_id and not exists(select 1 from allocated)
       returning s.reservation_id
     ), existing as (
       select s.* from vy_provider_spend s
        where s.budget_id=$1 and s.operation=$3 and s.request_hash=$8 and s.state<>'pending'
     )
     select * from finalized union all select * from existing limit 1`,
    [config.budget_id, config.limit_microusd, operation, adapter.family, adapter.name, adapter.version,
      adapter.model, requestHash, inputUnits, outputUnits, reservedMicrousd],
  );
  const reservation = rows[0];
  if (!reservation) fail("provider_budget_reservation_denied", 402);
  if (reservation.state === "in_flight" || reservation.state === "reconcile_required")
    fail("provider_spend_reconciliation_required", 409);
  if (reservation.state === "settled") fail("provider_spend_already_settled", 409);
  if (reservation.state !== "reserved") fail("provider_budget_reservation_invalid");
  return Object.freeze({
    reservation_id: reservation.reservation_id,
    budget_id: reservation.budget_id,
    request_hash: reservation.request_hash,
    state: reservation.state,
    reserved_microusd: Number(reservation.reserved_microusd),
    config,
  });
}

export async function reserveAzureSpeechSpend(db, { requestKey, adapter, inputs, env = process.env }) {
  if (typeof db !== "function") fail("provider_budget_db_required");
  if (adapter?.billing?.meter !== "azure_speech_audio_ms") return null;
  const config = speechBudgetConfig(env);
  const normalizedInputs = (Array.isArray(inputs) ? inputs : []).map((input) => ({
    artifact_id: String(input?.artifact_id || ""),
    sha256: String(input?.sha256 || ""),
    duration_ms: integer(input?.duration_ms, "provider_audio_units_invalid"),
  }));
  if (!normalizedInputs.length || normalizedInputs.some((input) => input.duration_ms <= 0 || !/^[0-9a-f]{64}$/.test(input.sha256)))
    fail("provider_audio_units_invalid");
  const audioMs = azureSpeechBillableAudioMs(normalizedInputs);
  const reservedMicrousd = audioReservationMicrousd(audioMs, config);
  const requestHash = sha256Hex(canonicalJson({
    operation: "transcription",
    request_key: String(requestKey || ""),
    provider_family: adapter.family,
    provider_name: adapter.name,
    provider_version: adapter.version,
    meter: adapter.billing.meter,
    inputs: normalizedInputs,
  }));
  const rows = await db(
    `with budget as (
       insert into vy_provider_budget (budget_id,limit_microusd,state)
       values ($1,$2,'active')
       on conflict (budget_id) do update set updated_at=vy_provider_budget.updated_at
         where vy_provider_budget.limit_microusd=excluded.limit_microusd
       returning budget_id,limit_microusd,reserved_microusd,spent_microusd,state
     ), candidate as (
       insert into vy_provider_spend
         (budget_id,operation,provider_family,provider_name,provider_version,model,request_hash,unit_kind,
          reserved_input_units,reserved_output_units,reserved_microusd,state)
       select budget_id,'transcription',$3,$4,$5,$6,$7,'audio_ms',$8,0,$9,'pending' from budget
       on conflict (budget_id,operation,request_hash) do nothing
       returning *
     ), allocated as (
       update vy_provider_budget b set reserved_microusd=b.reserved_microusd+$9,updated_at=now()
         from candidate c where b.budget_id=c.budget_id and b.state='active'
          and b.spent_microusd+b.reserved_microusd+$9<=b.limit_microusd
       returning b.budget_id
     ), finalized as (
       update vy_provider_spend s set state='reserved',updated_at=now() from candidate c,allocated a
        where s.reservation_id=c.reservation_id and s.budget_id=a.budget_id returning s.*
     ), rejected as (
       delete from vy_provider_spend s using candidate c where s.reservation_id=c.reservation_id
         and not exists(select 1 from allocated) returning s.reservation_id
     ), existing as (
       select s.* from vy_provider_spend s where s.budget_id=$1 and s.operation='transcription'
         and s.request_hash=$7 and s.state<>'pending'
     ) select * from finalized union all select * from existing limit 1`,
    [config.budget_id, config.limit_microusd, adapter.family, adapter.name, adapter.version,
      String(adapter.model || "speech-fast-transcription"), requestHash, audioMs, reservedMicrousd],
  );
  const reservation = rows[0];
  if (!reservation) fail("provider_budget_reservation_denied", 402);
  if (reservation.state === "in_flight" || reservation.state === "reconcile_required") fail("provider_spend_reconciliation_required", 409);
  if (reservation.state === "settled") fail("provider_spend_already_settled", 409);
  if (reservation.state !== "reserved") fail("provider_budget_reservation_invalid");
  return Object.freeze({
    reservation_id: reservation.reservation_id,
    budget_id: reservation.budget_id,
    request_hash: reservation.request_hash,
    state: reservation.state,
    reserved_units: audioMs,
    reserved_microusd: Number(reservation.reserved_microusd),
    config,
  });
}

export async function beginFoundrySpend(db, reservation) {
  if (!reservation) return null;
  const rows = await db(
    `update vy_provider_spend set state='in_flight',updated_at=now()
      where reservation_id=$1 and budget_id=$2 and request_hash=$3 and state='reserved'
      returning reservation_id,state`,
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash],
  );
  if (!rows[0]) fail("provider_spend_start_failed");
  return rows[0];
}

export async function releaseFoundrySpendBeforeCall(db, reservation, code) {
  if (!reservation) return null;
  const failure = String(code?.code || code?.message || code || "provider_call_not_started").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
  const rows = await db(
    `with released as (
       update vy_provider_spend set state='released',failure_code=$4,settled_at=now(),updated_at=now()
        where reservation_id=$1 and budget_id=$2 and request_hash=$3
          and state in ('reserved','in_flight')
       returning budget_id,reserved_microusd
     ), returned as (
       update vy_provider_budget b
          set reserved_microusd=greatest(0,b.reserved_microusd-r.reserved_microusd),updated_at=now()
         from released r where b.budget_id=r.budget_id
       returning b.budget_id,b.spent_microusd,b.reserved_microusd,b.limit_microusd,b.state
     ) select * from returned`,
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash, failure],
  );
  return rows[0] || null;
}

export async function settleFoundrySpend(db, reservation, usage) {
  if (!reservation) return null;
  if (reservation.state === "settled") return reservation;
  const inputUnits = integer(usage?.input_tokens, "provider_usage_missing");
  const outputUnits = integer(usage?.output_tokens, "provider_usage_missing");
  if (inputUnits + outputUnits <= 0) fail("provider_usage_missing");
  const actualMicrousd = tokenReservationMicrousd(inputUnits, outputUnits, reservation.config);
  if (actualMicrousd > reservation.reserved_microusd) fail("provider_reservation_underestimated");
  const rows = await db(
    `with settled as (
       update vy_provider_spend set state='settled',actual_input_units=$4,actual_output_units=$5,
              actual_microusd=$6,failure_code='',settled_at=now(),updated_at=now()
        where reservation_id=$1 and budget_id=$2 and request_hash=$3
          and state in ('in_flight','reconcile_required')
       returning budget_id,reserved_microusd,actual_microusd
     ), charged as (
       update vy_provider_budget b
          set reserved_microusd=greatest(0,b.reserved_microusd-s.reserved_microusd),
              spent_microusd=b.spent_microusd+s.actual_microusd,
              state=case when b.spent_microusd+s.actual_microusd>=b.limit_microusd then 'exhausted' else b.state end,
              updated_at=now()
         from settled s where b.budget_id=s.budget_id
       returning b.budget_id,b.spent_microusd,b.reserved_microusd,b.limit_microusd,b.state
     ) select * from charged`,
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash, inputUnits, outputUnits, actualMicrousd],
  );
  if (!rows[0]) fail("provider_budget_settlement_failed");
  return rows[0];
}

export async function settleAzureSpeechSpend(db, reservation, usage) {
  if (!reservation) return null;
  const audioMs = integer(usage?.audio_ms, "provider_usage_missing");
  if (audioMs <= 0 || audioMs > reservation.reserved_units) fail("provider_usage_missing");
  const actualMicrousd = audioReservationMicrousd(audioMs, reservation.config);
  if (actualMicrousd > reservation.reserved_microusd) fail("provider_reservation_underestimated");
  const rows = await db(
    `with settled as (
       update vy_provider_spend set state='settled',actual_input_units=$4,actual_output_units=0,
              actual_microusd=$5,failure_code='',settled_at=now(),updated_at=now()
        where reservation_id=$1 and budget_id=$2 and request_hash=$3
          and state in ('in_flight','reconcile_required') and unit_kind='audio_ms'
       returning budget_id,reserved_microusd,actual_microusd
     ), charged as (
       update vy_provider_budget b
          set reserved_microusd=greatest(0,b.reserved_microusd-s.reserved_microusd),
              spent_microusd=b.spent_microusd+s.actual_microusd,
              state=case when b.spent_microusd+s.actual_microusd>=b.limit_microusd then 'exhausted' else b.state end,
              updated_at=now()
         from settled s where b.budget_id=s.budget_id
       returning b.budget_id,b.spent_microusd,b.reserved_microusd,b.limit_microusd,b.state
     ) select * from charged`,
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash, audioMs, actualMicrousd],
  );
  if (!rows[0]) fail("provider_budget_settlement_failed");
  return rows[0];
}

export async function markFoundrySpendUncertain(db, reservation, code) {
  if (!reservation || reservation.state !== "reserved") return;
  const failure = String(code?.code || code?.message || code || "provider_outcome_unknown").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
  await db(
    `update vy_provider_spend set state='reconcile_required',failure_code=$4,updated_at=now()
      where reservation_id=$1 and budget_id=$2 and request_hash=$3 and state='in_flight'`,
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash, failure],
  ).catch(() => []);
}

export const beginProviderSpend = beginFoundrySpend;
export const releaseProviderSpendBeforeCall = releaseFoundrySpendBeforeCall;
export const markProviderSpendUncertain = markFoundrySpendUncertain;
