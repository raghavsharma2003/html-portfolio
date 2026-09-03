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

export function personalVoiceBudgetConfig(env = process.env) {
  const budgetId = String(env.AZURE_REPLICA_BUDGET_ID || "azure-replica-grant-v1").trim();
  if (!BUDGET_ID.test(budgetId)) fail("provider_budget_id_invalid");
  const limitUsd = positive(env.AZURE_REPLICA_APP_BUDGET_USD, "provider_budget_limit_required", 2_000);
  const profileUsd = positive(env.AZURE_PERSONAL_VOICE_USD_PER_PROFILE, "provider_voice_profile_rate_required", 10_000);
  const synthesisUsdPerMillion = positive(
    env.AZURE_PERSONAL_VOICE_SYNTHESIS_USD_PER_MCHARACTERS,
    "provider_voice_synthesis_rate_required",
    10_000,
  );
  return Object.freeze({
    budget_id: budgetId,
    limit_microusd: Math.floor(limitUsd * 1_000_000),
    profile_usd: profileUsd,
    synthesis_usd_per_million: synthesisUsdPerMillion,
  });
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

export function conservativeCharacterUnits(text) {
  const value = String(text || "");
  if (!value) fail("provider_character_units_invalid");
  // Azure bills text to speech by character. UTF-8 bytes are an intentional
  // upper bound for Indic and other multibyte scripts, while code points keep
  // the bound meaningful for ASCII.
  return Math.max(Array.from(value).length, Buffer.byteLength(value, "utf8"));
}

export function personalVoiceReservationMicrousd(operation, units, config) {
  const count = integer(units, "provider_voice_units_invalid");
  if (count <= 0) fail("provider_voice_units_invalid");
  const amount = operation === "voice_training"
    ? Math.ceil(config.profile_usd * 1_000_000 * count)
    : operation === "synthesis"
      ? Math.ceil(count * config.synthesis_usd_per_million)
      : 0;
  if (!Number.isSafeInteger(amount) || amount <= 0) fail("provider_reservation_invalid");
  return amount;
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

/**
 * The one reservation body for every character/profile metered voice lane.
 *
 * Azure Personal Voice and the vendor bench arms differ in their METER NAMES
 * and their rate cards, and in nothing else that this ledger cares about: both
 * reserve conservatively before a paid call, settle on measured units, and
 * leave a reconcilable row if the outcome is unknown. Two copies of this
 * statement would drift, and the copy that drifted would be the one deciding
 * whether the owner's money gets spent twice.
 */
async function reserveMeteredVoiceSpend(
  db,
  { operation, requestKey, inputCommitment, adapter, expectedMeter, units, unitKind, config },
) {
  if (typeof db !== "function") fail("provider_budget_db_required");
  if (!new Set(["voice_training", "synthesis"]).has(operation)) fail("provider_budget_operation_invalid");
  if (adapter?.billing?.[operation]?.meter !== expectedMeter) return null;
  const commitment = String(inputCommitment || "").trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(commitment)) fail("provider_voice_input_commitment_invalid");
  const reservedMicrousd = personalVoiceReservationMicrousd(operation, units, config);
  const requestHash = sha256Hex(canonicalJson({
    operation,
    request_key: String(requestKey || ""),
    input_commitment: commitment,
    provider_family: adapter.family,
    provider_name: adapter.name,
    provider_version: adapter.version,
    model: adapter.model,
    meter: expectedMeter,
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
       select budget_id,$3,$4,$5,$6,$7,$8,$9,$10,0,$11,'pending' from budget
       on conflict (budget_id,operation,request_hash) do nothing returning *
     ), allocated as (
       update vy_provider_budget b set reserved_microusd=b.reserved_microusd+$11,updated_at=now()
         from candidate c where b.budget_id=c.budget_id and b.state='active'
          and b.spent_microusd+b.reserved_microusd+$11<=b.limit_microusd
       returning b.budget_id
     ), finalized as (
       update vy_provider_spend s set state='reserved',updated_at=now() from candidate c,allocated a
        where s.reservation_id=c.reservation_id and s.budget_id=a.budget_id returning s.*
     ), rejected as (
       delete from vy_provider_spend s using candidate c where s.reservation_id=c.reservation_id
         and not exists(select 1 from allocated) returning s.reservation_id
     ), existing as (
       select s.* from vy_provider_spend s where s.budget_id=$1 and s.operation=$3
         and s.request_hash=$8 and s.state<>'pending'
     ) select * from finalized union all select * from existing limit 1`,
    [config.budget_id, config.limit_microusd, operation, adapter.family, adapter.name, adapter.version,
      adapter.model, requestHash, unitKind, units, reservedMicrousd],
  );
  const reservation = rows[0];
  if (!reservation) fail("provider_budget_reservation_denied", 402);
  if (reservation.state === "in_flight" || reservation.state === "reconcile_required")
    fail("provider_spend_reconciliation_required", 409);
  if (reservation.state === "settled" && operation !== "voice_training")
    fail("provider_spend_already_settled", 409);
  if (!new Set(["reserved", "settled"]).has(reservation.state)) fail("provider_budget_reservation_invalid");
  return Object.freeze({
    reservation_id: reservation.reservation_id,
    budget_id: reservation.budget_id,
    request_hash: reservation.request_hash,
    state: reservation.state,
    operation,
    unit_kind: unitKind,
    reserved_units: units,
    reserved_microusd: Number(reservation.reserved_microusd),
    config,
  });
}

export async function reserveAzurePersonalVoiceSpend(
  db,
  { operation, requestKey, inputCommitment, adapter, text = "", env = process.env },
) {
  if (!new Set(["voice_training", "synthesis"]).has(operation)) fail("provider_budget_operation_invalid");
  const expectedMeter = operation === "voice_training"
    ? "azure_personal_voice_profiles"
    : "azure_personal_voice_characters";
  if (adapter?.billing?.[operation]?.meter !== expectedMeter) return null;
  return reserveMeteredVoiceSpend(db, {
    operation,
    requestKey,
    inputCommitment,
    adapter,
    expectedMeter,
    units: operation === "voice_training" ? 1 : conservativeCharacterUnits(text),
    unitKind: operation === "voice_training" ? "requests" : "characters",
    config: personalVoiceBudgetConfig(env),
  });
}

// ── vendor bench arms: a PER-DAY character cap ───────────────────────────────
// The vendor arms exist to answer one question (`decisions.md#platform-north-star`
// names its reversal condition) and a bench that can run away with the owner's
// money answers a different one. The guard is a character budget per UTC day,
// and it is expressed as a budget ROW rather than as a counter in code so the
// same atomic reserve/settle/reconcile the rest of this file already proves
// applies to it unchanged. The budget id carries the date, so yesterday's spend
// cannot fund today's and today's cap cannot be raised by restarting a process.
export const VENDOR_VOICE_METERS = Object.freeze({
  elevenlabs: Object.freeze({
    voice_training: "elevenlabs_voice_clones",
    synthesis: "elevenlabs_characters",
    dailyCharactersEnv: "ELEVENLABS_DAILY_CHARACTERS",
    usdPerMillionEnv: "ELEVENLABS_USD_PER_MCHARACTERS",
    usdPerCloneEnv: "ELEVENLABS_USD_PER_VOICE_CLONE",
    // elevenlabs.io/pricing, read 2026-09-03: Creator tier is USD 11 for
    // 121,000 credits and one V2 multilingual character is one credit, so
    // USD 0.18 per 1,000 characters = USD 180 per million. Instant Voice
    // Cloning carries no separate per-clone list charge on a paid tier.
    defaultUsdPerMillion: 180,
  }),
  sarvam: Object.freeze({
    voice_training: "sarvam_voice_clones",
    synthesis: "sarvam_characters",
    dailyCharactersEnv: "SARVAM_DAILY_CHARACTERS",
    usdPerMillionEnv: "SARVAM_USD_PER_MCHARACTERS",
    usdPerCloneEnv: "SARVAM_USD_PER_VOICE_CLONE",
    // docs.sarvam.ai/api/getting-started/pricing, read 2026-09-03:
    // bulbul:v3 is INR 30 per 10,000 characters. Converted at INR 88 to the
    // dollar that is about USD 34 per million; the env var is the authority
    // and this default is only a floor so an unset rate cannot read as free.
    defaultUsdPerMillion: 34,
  }),
});

const DEFAULT_VENDOR_DAILY_CHARACTERS = 20_000;
const MAX_VENDOR_DAILY_CHARACTERS = 2_000_000;

export function vendorVoiceBudgetConfig(vendor, env = process.env, now = new Date()) {
  const meters = VENDOR_VOICE_METERS[vendor];
  if (!meters) fail("provider_vendor_voice_unknown");
  const day = new Date(now).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) fail("provider_vendor_voice_day_invalid");
  const budgetId = `vendor-voice-${vendor}-${day}`;
  if (!BUDGET_ID.test(budgetId)) fail("provider_budget_id_invalid");
  const dailyCharacters = Number(env[meters.dailyCharactersEnv] || DEFAULT_VENDOR_DAILY_CHARACTERS);
  if (!Number.isSafeInteger(dailyCharacters) || dailyCharacters <= 0 || dailyCharacters > MAX_VENDOR_DAILY_CHARACTERS) {
    fail("provider_vendor_daily_characters_invalid");
  }
  const usdPerMillion = positive(
    env[meters.usdPerMillionEnv] || meters.defaultUsdPerMillion,
    "provider_voice_synthesis_rate_required",
    10_000,
  );
  // A voice clone is included in the vendor's plan rather than billed per call.
  // The reservation is still at least one microusd so the create takes a real
  // ledger row: an operation with no row is an operation with no reconciliation.
  const cloneUsd = Number(env[meters.usdPerCloneEnv] || 0);
  if (!Number.isFinite(cloneUsd) || cloneUsd < 0 || cloneUsd > 1_000) fail("provider_voice_profile_rate_required");
  return Object.freeze({
    budget_id: budgetId,
    vendor,
    day,
    daily_characters: dailyCharacters,
    limit_microusd: Math.max(1, Math.ceil(dailyCharacters * usdPerMillion)),
    profile_usd: Math.max(cloneUsd, 1e-6),
    synthesis_usd_per_million: usdPerMillion,
  });
}

export async function reserveVendorVoiceSpend(
  db,
  { vendor, operation, requestKey, inputCommitment, adapter, text = "", env = process.env, now = new Date() },
) {
  const meters = VENDOR_VOICE_METERS[vendor];
  if (!meters) fail("provider_vendor_voice_unknown");
  if (!new Set(["voice_training", "synthesis"]).has(operation)) fail("provider_budget_operation_invalid");
  const expectedMeter = meters[operation];
  if (adapter?.billing?.[operation]?.meter !== expectedMeter) return null;
  return reserveMeteredVoiceSpend(db, {
    operation,
    requestKey,
    inputCommitment,
    adapter,
    expectedMeter,
    units: operation === "voice_training" ? 1 : conservativeCharacterUnits(text),
    unitKind: operation === "voice_training" ? "requests" : "characters",
    config: vendorVoiceBudgetConfig(vendor, env, now),
  });
}

// Settlement is meter-neutral: it charges measured units at the reservation's
// own config, so the vendor arms reuse the Azure settlement unchanged.
export const settleVendorVoiceSpend = settleAzurePersonalVoiceSpend;

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

export async function settleAzurePersonalVoiceSpend(db, reservation, usage) {
  if (!reservation) return null;
  const units = integer(usage?.units, "provider_usage_missing");
  if (units <= 0 || units > reservation.reserved_units) fail("provider_usage_missing");
  const actualMicrousd = personalVoiceReservationMicrousd(reservation.operation, units, reservation.config);
  if (actualMicrousd > reservation.reserved_microusd) fail("provider_reservation_underestimated");
  const rows = await db(
    `with settled as (
       update vy_provider_spend set state='settled',actual_input_units=$4,actual_output_units=0,
              actual_microusd=$5,failure_code='',settled_at=now(),updated_at=now()
        where reservation_id=$1 and budget_id=$2 and request_hash=$3
          and state in ('in_flight','reconcile_required') and unit_kind=$6
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
    [reservation.reservation_id, reservation.budget_id, reservation.request_hash, units, actualMicrousd, reservation.unit_kind],
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
