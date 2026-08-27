// Provider-neutral server contract. Provider ids never cross the API boundary;
// adapters normalize audio to the existing cascade player's PCM format.
export const SYNTHETIC_AUDIO_DISCLOSURES = Object.freeze({
  en: "This is an AI-generated voice replica.",
  hi: "यह एआई से बनाई गई आवाज़ की प्रतिकृति है।",
});
export const SYNTHETIC_AUDIO_DISCLOSURE = SYNTHETIC_AUDIO_DISCLOSURES.en;
export const VOICE_PCM_FORMAT = Object.freeze({
  contentType: "audio/l16",
  encoding: "pcm_s16le",
  sampleRate: 24_000,
  channels: 1,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const requiredFn = ["createVoice", "getVoiceStatus", "synthesizeStream", "deleteVoice"];

export function assertVoiceProvider(provider) {
  if (!provider || typeof provider.name !== "string" || !provider.name) throw new Error("voice provider name required");
  for (const key of requiredFn) {
    if (typeof provider[key] !== "function") throw new Error(`voice provider missing ${key}`);
  }
  return provider;
}

export function assertCreateVoiceInput(input) {
  if (!UUID.test(String(input?.replicaId || ""))) throw new Error("valid replicaId required");
  if (!Number.isInteger(input?.genomeVersion) || input.genomeVersion < 1) throw new Error("valid genomeVersion required");
  if (!Array.isArray(input?.references) || !input.references.length) throw new Error("private voice references required");
  for (const ref of input.references) {
    if (!UUID.test(String(ref?.sourceId || ""))) throw new Error("valid sourceId required");
    if (typeof ref?.signedReadUrl !== "string" || !/^https:\/\//.test(ref.signedReadUrl))
      throw new Error("short-lived signed read URL required");
  }
  if (typeof input.idempotencyKey !== "string" || input.idempotencyKey.length < 16)
    throw new Error("idempotency key required");
  return input;
}

export function syntheticAudioDisclosure(languageId = "en") {
  const language = String(languageId || "en").toLowerCase();
  return SYNTHETIC_AUDIO_DISCLOSURES[language] || SYNTHETIC_AUDIO_DISCLOSURE;
}

export function isSyntheticAudioDisclosure(value) {
  return Object.values(SYNTHETIC_AUDIO_DISCLOSURES).includes(String(value || ""));
}

export function renderTextWithDisclosure(text, languageId = "en") {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean || clean.length > 4_000) throw new Error("synthesis text must be 1-4000 characters");
  return `${syntheticAudioDisclosure(languageId)} ${clean}`;
}

export function assertSynthesisResult(result) {
  if (!result || result.format?.contentType !== VOICE_PCM_FORMAT.contentType ||
      result.format?.encoding !== VOICE_PCM_FORMAT.encoding ||
      result.format?.sampleRate !== VOICE_PCM_FORMAT.sampleRate ||
      result.format?.channels !== VOICE_PCM_FORMAT.channels) {
    throw new Error("provider returned unsupported audio format");
  }
  if (!result.stream || typeof result.stream[Symbol.asyncIterator] !== "function")
    throw new Error("provider must return an async byte stream");
  const disclosureText = result.disclosureText == null
    ? SYNTHETIC_AUDIO_DISCLOSURE
    : String(result.disclosureText);
  if (!isSyntheticAudioDisclosure(disclosureText) ||
      typeof result.renderedText !== "string" ||
      !result.renderedText.startsWith(`${disclosureText} `) ||
      result.renderedText.length <= disclosureText.length + 1) {
    throw new Error("provider must render the exact synthetic-audio disclosure");
  }
  return result.disclosureText == null
    ? Object.freeze({ ...result, disclosureText })
    : result;
}

export function clientVoiceProfile(profile) {
  // Whitelist by construction. `provider`, `provider_ref`, model and deletion
  // details remain server-side even if a database row gains more fields.
  return {
    voice_profile_id: profile.voice_profile_id,
    replica_id: profile.replica_id,
    genome_version: profile.genome_version,
    status: profile.status,
    capabilities: profile.capabilities ?? {},
    created_at: profile.created_at,
    updated_at: profile.updated_at,
  };
}
