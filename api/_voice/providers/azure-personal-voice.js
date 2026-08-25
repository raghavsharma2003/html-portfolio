import { createHash } from "node:crypto";
import { probeEnrollmentWav } from "../../_audio/wav.js";
import { canonicalJson, sha256Hex } from "../../_provenance/contracts.js";
import {
  beginProviderSpend,
  markProviderSpendUncertain,
  releaseProviderSpendBeforeCall,
  reserveAzurePersonalVoiceSpend,
  settleAzurePersonalVoiceSpend,
} from "../../_provider-budget.js";
import { stableUuid } from "../../_replica-processing/contracts.js";
import {
  VOICE_PCM_FORMAT,
  assertCreateVoiceInput,
  renderTextWithDisclosure,
} from "../contracts.js";

const API_VERSION = "2026-01-01";
const PROVIDER_VERSION = "azure-personal-voice/2026-01-01";
const PROVIDER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}[A-Za-z0-9]$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const AUDIO_MIMES = new Map([
  ["audio/wav", ".wav"],
  ["audio/x-wav", ".wav"],
]);
const MAX_AUDIO_BYTES = 30 * 1024 * 1024;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

function identifier(value, code) {
  const id = String(value || "").trim();
  if (!PROVIDER_ID.test(id)) fail(code, 400);
  return id;
}

function httpsEndpoint(value, suffixes, code) {
  let url;
  try { url = new URL(String(value || "")); } catch { fail(code); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      !suffixes.some((suffix) => url.hostname.toLowerCase().endsWith(suffix))) fail(code);
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

export function azurePersonalVoiceConfig(env = process.env) {
  if (String(env.AZURE_PERSONAL_VOICE_ENABLED || "").toLowerCase() !== "true")
    fail("azure_personal_voice_disabled");
  if (String(env.AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED || "").toLowerCase() !== "true")
    fail("azure_personal_voice_approval_required");
  const endpoint = httpsEndpoint(
    env.AZURE_PERSONAL_VOICE_ENDPOINT,
    [".cognitiveservices.azure.com", ".api.cognitive.microsoft.com"],
    "azure_personal_voice_endpoint_required",
  );
  const ttsEndpoint = httpsEndpoint(
    env.AZURE_PERSONAL_VOICE_TTS_ENDPOINT,
    [".tts.speech.microsoft.com", ".cognitiveservices.azure.com"],
    "azure_personal_voice_tts_endpoint_required",
  );
  const key = String(env.AZURE_PERSONAL_VOICE_KEY || "").trim();
  if (key.length < 20 || /\s/.test(key)) fail("azure_personal_voice_key_required");
  const projectId = identifier(env.AZURE_PERSONAL_VOICE_PROJECT_ID, "azure_personal_voice_project_required");
  const companyName = String(env.AZURE_PERSONAL_VOICE_COMPANY_NAME || "").trim();
  if (!companyName || Array.from(companyName).length > 80) fail("azure_personal_voice_company_required");
  const model = identifier(env.AZURE_PERSONAL_VOICE_BASE_MODEL, "azure_personal_voice_model_required");
  if (/latest/i.test(model)) fail("azure_personal_voice_model_must_be_version_pinned");
  let privateOrigin;
  try { privateOrigin = new URL(String(env.SUPABASE_URL || "")).origin; } catch { fail("private_storage_origin_required"); }
  if (!privateOrigin.startsWith("https://")) fail("private_storage_origin_required");
  return Object.freeze({ endpoint, ttsEndpoint, key, projectId, companyName, model, privateOrigin });
}

// Erasure deliberately has a smaller configuration surface than creation or
// synthesis. Turning off new cloning, losing limited-access approval, or
// misconfiguring a TTS/model setting must never prevent deletion of an
// already-created biometric voice at the provider.
export function azurePersonalVoiceErasureConfig(env = process.env) {
  const endpoint = httpsEndpoint(
    env.AZURE_PERSONAL_VOICE_ENDPOINT,
    [".cognitiveservices.azure.com", ".api.cognitive.microsoft.com"],
    "azure_personal_voice_endpoint_required",
  );
  const key = String(env.AZURE_PERSONAL_VOICE_KEY || "").trim();
  if (key.length < 20 || /\s/.test(key)) fail("azure_personal_voice_key_required");
  return Object.freeze({ endpoint, key });
}

function normalizedReference(value, role) {
  const sourceId = String(value?.sourceId || "").trim().toLowerCase();
  const sha256 = String(value?.sha256 || "").trim().toLowerCase();
  const mime = String(value?.mime || "").split(";", 1)[0].trim().toLowerCase();
  const durationMs = Number(value?.durationMs);
  if (!UUID.test(sourceId) || !SHA256.test(sha256) || !AUDIO_MIMES.has(mime))
    fail(`azure_personal_voice_${role}_invalid`, 400);
  if (!Number.isInteger(durationMs) || durationMs < 5_000 || durationMs > 90_000)
    fail(`azure_personal_voice_${role}_duration_invalid`, 400);
  return Object.freeze({
    sourceId,
    signedReadUrl: String(value?.signedReadUrl || ""),
    sha256,
    mime,
    durationMs,
  });
}

export function assertAzurePersonalVoiceInput(input) {
  assertCreateVoiceInput(input);
  if (!input.consent || typeof input.consent !== "object") fail("azure_personal_voice_consent_required", 400);
  const consent = normalizedReference(input.consent, "consent");
  const locale = String(input.consent.locale || "").trim();
  const voiceTalentName = String(input.consent.voiceTalentName || "").trim();
  if (!/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})+$/.test(locale) || !voiceTalentName || Array.from(voiceTalentName).length > 64)
    fail("azure_personal_voice_consent_metadata_invalid", 400);
  const references = input.references.map((reference) => normalizedReference(reference, "reference"));
  if (references.length > 10) fail("azure_personal_voice_reference_count_invalid", 400);
  const durationMs = references.reduce((total, reference) => total + reference.durationMs, 0);
  // Azure accepts 5-90 second prompts; this lane keeps a higher product floor
  // near the documented one-minute recommendation instead of optimizing demos.
  if (durationMs < 30_000 || durationMs > 90_000) fail("azure_personal_voice_training_duration_invalid", 400);
  if (new Set(references.map((reference) => reference.sourceId)).size !== references.length ||
      references.some((reference) => reference.sourceId === consent.sourceId))
    fail("azure_personal_voice_reference_duplicate", 400);
  return Object.freeze({
    ...input,
    consent: Object.freeze({ ...consent, locale, voiceTalentName }),
    references: Object.freeze(references),
  });
}

function encodedProviderRef(value) {
  return `azpv1.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

export function parseAzurePersonalVoiceRef(value) {
  const raw = String(value || "");
  if (!raw.startsWith("azpv1.")) fail("azure_personal_voice_ref_invalid", 400);
  let parsed;
  try { parsed = JSON.parse(Buffer.from(raw.slice(6), "base64url").toString("utf8")); }
  catch { fail("azure_personal_voice_ref_invalid", 400); }
  return Object.freeze({
    voiceId: identifier(parsed?.voiceId, "azure_personal_voice_ref_invalid"),
    consentId: identifier(parsed?.consentId, "azure_personal_voice_ref_invalid"),
  });
}

function signalFor(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function responseJson(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { fail("azure_personal_voice_response_invalid"); }
}

function providerState(status) {
  const value = String(status || "").toLowerCase();
  if (value === "succeeded") return "ready";
  if (["notstarted", "running"].includes(value)) return "creating";
  if (["failed", "disabling", "disabled"].includes(value)) return "failed";
  return "creating";
}

function xml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

export function createAzurePersonalVoiceProvider(options = {}) {
  const env = options.env || process.env;
  const config = azurePersonalVoiceConfig(env);
  const fetchImpl = options.fetchImpl || fetch;
  const sleep = options.sleep || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const db = options.db;
  if (typeof db !== "function") fail("provider_budget_db_required");
  const budget = options.budget || {
    reserve: reserveAzurePersonalVoiceSpend,
    begin: beginProviderSpend,
    settle: settleAzurePersonalVoiceSpend,
    release: releaseProviderSpendBeforeCall,
    uncertain: markProviderSpendUncertain,
  };
  const descriptor = Object.freeze({
    family: "azure_speech",
    name: "azure_personal_voice",
    version: PROVIDER_VERSION,
    model: config.model,
    billing: Object.freeze({
      voice_training: Object.freeze({ meter: "azure_personal_voice_profiles" }),
      synthesis: Object.freeze({ meter: "azure_personal_voice_characters" }),
    }),
  });

  async function azure(path, init = {}, allow = []) {
    let response;
    try {
      response = await fetchImpl(`${config.endpoint}${path}`, {
        ...init,
        headers: { "Ocp-Apim-Subscription-Key": config.key, ...(init.headers || {}) },
        signal: signalFor(init.signal, init.timeoutMs || 20_000),
      });
    } catch { fail("azure_personal_voice_unreachable"); }
    if (!response.ok && !allow.includes(response.status))
      fail(`azure_personal_voice_http_${response.status}`, response.status >= 500 ? 503 : 409);
    return response;
  }

  async function resource(kind, id, signal, allowMissing = false) {
    const response = await azure(`/customvoice/${kind}/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {
      method: "GET", signal,
    }, allowMissing ? [404] : []);
    if (response.status === 404) return null;
    return responseJson(response);
  }

  async function waitUntilReady(kind, id, initial, signal) {
    let row = initial;
    for (let attempt = 0; attempt < 20; attempt++) {
      const state = providerState(row?.status);
      if (state === "ready") return row;
      if (state === "failed") fail(`azure_personal_voice_${kind}_failed`, 409);
      await sleep(250);
      row = await resource(kind, id, signal);
    }
    fail(`azure_personal_voice_${kind}_timeout`);
  }

  async function privateAudio(reference, signal) {
    let url;
    try { url = new URL(reference.signedReadUrl); } catch { fail("azure_personal_voice_signed_url_invalid", 400); }
    if (url.protocol !== "https:" || url.origin !== config.privateOrigin || url.username || url.password)
      fail("azure_personal_voice_signed_url_invalid", 400);
    let response;
    try {
      response = await fetchImpl(url.toString(), { method: "GET", redirect: "error", signal: signalFor(signal, 20_000) });
    } catch { fail("azure_personal_voice_private_audio_unreachable"); }
    if (!response.ok) fail("azure_personal_voice_private_audio_unavailable", response.status >= 500 ? 503 : 409);
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > MAX_AUDIO_BYTES) fail("azure_personal_voice_audio_too_large", 413);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) fail("azure_personal_voice_audio_too_large", 413);
    if (createHash("sha256").update(bytes).digest("hex") !== reference.sha256)
      fail("azure_personal_voice_audio_hash_mismatch", 409);
    const probe = probeEnrollmentWav(bytes, { expectedDurationMs: reference.durationMs });
    if (probe.durationMs < 5_000 || probe.durationMs > 90_000)
      fail("azure_personal_voice_audio_duration_invalid", 409);
    return Object.freeze({
      bytes,
      mime: reference.mime,
      extension: AUDIO_MIMES.get(reference.mime),
      durationMs: probe.durationMs,
      probe,
    });
  }

  async function ensureConsent(id, input, audio, signal) {
    const form = new FormData();
    form.append("projectId", config.projectId);
    form.append("voiceTalentName", input.consent.voiceTalentName);
    form.append("companyName", config.companyName);
    form.append("locale", input.consent.locale);
    form.append("audiodata", new Blob([audio.bytes], { type: audio.mime }), `consent${audio.extension}`);
    const response = await azure(`/customvoice/consents/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "Operation-Id": stableUuid(`azure-personal-voice-consent/v1:${input.idempotencyKey}`) },
      body: form,
      signal,
    }, [409]);
    const row = response.status === 409 ? await resource("consents", id, signal) : await responseJson(response);
    const ready = await waitUntilReady("consents", id, row, signal);
    if (ready?.id !== id || ready?.projectId !== config.projectId)
      fail("azure_personal_voice_consent_response_mismatch");
    return ready;
  }

  async function createProfile(id, consentId, input, audios, signal) {
    const form = new FormData();
    form.append("projectId", config.projectId);
    form.append("consentId", consentId);
    audios.forEach((audio, index) => {
      form.append("audiodata", new Blob([audio.bytes], { type: audio.mime }), `prompt-${index + 1}${audio.extension}`);
    });
    const response = await azure(`/customvoice/personalvoices/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {
      method: "POST",
      headers: { "Operation-Id": stableUuid(`azure-personal-voice-profile/v1:${input.idempotencyKey}`) },
      body: form,
      signal,
    }, [409]);
    return response.status === 409 ? resource("personalvoices", id, signal) : responseJson(response);
  }

  return {
    ...descriptor,
    async createVoice(rawInput) {
      const input = assertAzurePersonalVoiceInput(rawInput);
      const signal = rawInput.signal;
      const consentAudio = await privateAudio(input.consent, signal);
      const audios = [];
      let totalBytes = consentAudio.bytes.length;
      for (const reference of input.references) {
        const audio = await privateAudio(reference, signal);
        totalBytes += audio.bytes.length;
        if (totalBytes > MAX_AUDIO_BYTES) fail("azure_personal_voice_audio_too_large", 413);
        audios.push(audio);
      }
      const actualTrainingDurationMs = audios.reduce((total, audio) => total + audio.durationMs, 0);
      if (actualTrainingDurationMs < 30_000 || actualTrainingDurationMs > 90_000)
        fail("azure_personal_voice_training_duration_invalid", 409);
      const commitment = sha256Hex(canonicalJson({
        protocol: PROVIDER_VERSION,
        replica_id: input.replicaId,
        genome_version: input.genomeVersion,
        project_id: config.projectId,
        company_name: config.companyName,
        consent: {
          source_id: input.consent.sourceId,
          sha256: input.consent.sha256,
          duration_ms: consentAudio.durationMs,
          locale: input.consent.locale,
          voice_talent_name: input.consent.voiceTalentName,
        },
        references: input.references.map((reference, index) => ({
          source_id: reference.sourceId, sha256: reference.sha256, duration_ms: audios[index].durationMs,
          format: `${audios[index].probe.sampleRate}/${audios[index].probe.bitsPerSample}/${audios[index].probe.channels}`,
        })).sort((left, right) => left.source_id.localeCompare(right.source_id)),
        model: config.model,
      }));
      const suffix = sha256Hex(`${input.idempotencyKey}:${commitment}`).slice(0, 32);
      const voiceId = `vy-${suffix}`;
      const consentId = `vyc-${suffix}`;
      const reservation = await budget.reserve(db, {
        operation: "voice_training", requestKey: input.idempotencyKey, inputCommitment: commitment,
        adapter: descriptor, env,
      });
      if (reservation.state === "settled") {
        const existing = await resource("personalvoices", voiceId, signal, true);
        if (!existing || existing.id !== voiceId || existing.consentId !== consentId || existing.projectId !== config.projectId)
          fail("azure_personal_voice_settled_profile_missing", 409);
        return Object.freeze({ providerRef: encodedProviderRef({ voiceId, consentId }), state: providerState(existing.status) });
      }
      let began = false;
      try {
        await budget.begin(db, reservation);
        began = true;
        await ensureConsent(consentId, input, consentAudio, signal);
        const profile = await createProfile(voiceId, consentId, input, audios, signal);
        if (!profile || profile.id !== voiceId || profile.consentId !== consentId || profile.projectId !== config.projectId)
          fail("azure_personal_voice_profile_response_mismatch");
        await budget.settle(db, reservation, { units: 1 });
        return Object.freeze({ providerRef: encodedProviderRef({ voiceId, consentId }), state: providerState(profile.status) });
      } catch (error) {
        if (!began) await budget.release(db, reservation, error);
        else await budget.uncertain(db, reservation, error);
        throw error;
      }
    },
    async getVoiceStatus(providerRef, options = {}) {
      const { voiceId } = parseAzurePersonalVoiceRef(providerRef);
      const row = await resource("personalvoices", voiceId, options.signal, true);
      return row ? providerState(row.status) : "missing";
    },
    async synthesizeStream({ providerRef, text, signal, requestKey }) {
      const { voiceId } = parseAzurePersonalVoiceRef(providerRef);
      if (typeof requestKey !== "string" || requestKey.length < 16) fail("azure_personal_voice_synthesis_request_key_required", 400);
      const profile = await resource("personalvoices", voiceId, signal, true);
      if (!profile || providerState(profile.status) !== "ready" || !UUID.test(String(profile.speakerProfileId || "")))
        fail("voice_not_ready", 409);
      const renderedText = renderTextWithDisclosure(text);
      const ssml = `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="http://www.w3.org/2001/mstts" xml:lang="en-US"><voice name="${xml(config.model)}"><mstts:ttsembedding speakerProfileId="${xml(profile.speakerProfileId)}">${xml(renderedText)}</mstts:ttsembedding></voice></speak>`;
      const commitment = sha256Hex(canonicalJson({ protocol: PROVIDER_VERSION, provider_ref: providerRef, model: config.model, ssml_sha256: sha256Hex(ssml) }));
      const reservation = await budget.reserve(db, {
        operation: "synthesis", requestKey, inputCommitment: commitment, adapter: descriptor,
        text: renderedText, env,
      });
      let began = false;
      try {
        await budget.begin(db, reservation);
        began = true;
        let response;
        try {
          response = await fetchImpl(`${config.ttsEndpoint}/cognitiveservices/v1`, {
            method: "POST",
            headers: {
              "Ocp-Apim-Subscription-Key": config.key,
              "Content-Type": "application/ssml+xml",
              "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
              "User-Agent": "vyakti-replica/1",
            },
            body: ssml,
            signal: signalFor(signal, 30_000),
          });
        } catch { fail("azure_personal_voice_synthesis_unreachable"); }
        if (!response.ok || !response.body) fail(`azure_personal_voice_synthesis_http_${response.status}`);
        await budget.settle(db, reservation, { units: reservation.reserved_units });
        return Object.freeze({ format: VOICE_PCM_FORMAT, renderedText, stream: response.body });
      } catch (error) {
        if (!began) await budget.release(db, reservation, error);
        else await budget.uncertain(db, reservation, error);
        throw error;
      }
    },
    async deleteVoice(providerRef, options = {}) {
      const { voiceId, consentId } = parseAzurePersonalVoiceRef(providerRef);
      for (const [kind, id] of [["personalvoices", voiceId], ["consents", consentId]]) {
        await azure(`/customvoice/${kind}/${encodeURIComponent(id)}?api-version=${API_VERSION}`, {
          method: "DELETE", signal: options.signal,
        }, [404]);
      }
      return Object.freeze({ deleted: true });
    },
  };
}

export function createAzurePersonalVoiceEraser(options = {}) {
  const env = options.env || process.env;
  const config = azurePersonalVoiceErasureConfig(env);
  const fetchImpl = options.fetchImpl || fetch;

  return Object.freeze({
    name: "azure_personal_voice",
    async deleteVoice(providerRef, deleteOptions = {}) {
      const { voiceId, consentId } = parseAzurePersonalVoiceRef(providerRef);
      for (const [kind, id] of [["personalvoices", voiceId], ["consents", consentId]]) {
        let response;
        try {
          response = await fetchImpl(
            `${config.endpoint}/customvoice/${kind}/${encodeURIComponent(id)}?api-version=${API_VERSION}`,
            {
              method: "DELETE",
              headers: { "Ocp-Apim-Subscription-Key": config.key },
              signal: signalFor(deleteOptions.signal, 20_000),
            },
          );
        } catch {
          fail("azure_personal_voice_unreachable");
        }
        // Azure deletion is retried after every ambiguous outcome. A 404 is a
        // successful idempotent observation: the biometric object is absent.
        if (!response.ok && response.status !== 404) {
          fail(`azure_personal_voice_http_${response.status}`, response.status >= 500 ? 503 : 409);
        }
      }
      return Object.freeze({ deleted: true });
    },
  });
}
