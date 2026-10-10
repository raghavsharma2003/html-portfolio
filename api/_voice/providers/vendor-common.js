// Shared machinery for the VENDOR voice arms (ElevenLabs, Sarvam).
//
// WHY THIS FILE EXISTS, AND WHAT IT IS NOT
// ---------------------------------------------------------------------------
// `context/decisions.md#platform-north-star` makes the self-hosted lane primary
// and names the one thing that would reverse it: *"the self-hosted lane's
// fidelity bench stays materially below the vendor lane after fine-tuning
// effort"*. That sentence has never been testable, because no vendor arm has
// ever been benched. These modules exist so it becomes testable the moment a
// key is set, and for no other reason. They are BENCH arms by default; the
// shipped lane order in `registry.js` does not change.
//
// Two rules are carried here rather than repeated in each vendor module:
//
//  1. **An absent key is a named unavailability, never a clip.** Every arm can
//     be asked `describe(env)` and answers with a reason code. A vendor arm
//     that fabricates audio when it has no credential is the exact shape of
//     `AGENTS.md`'s "a plausible return hides a dead pipeline", and the offline
//     eval has a negative control that fails if one ever does.
//  2. **Bytes leave here as canonical 24 kHz mono PCM16 or they do not leave.**
//     Vendors return whatever they like. Anything that is not already the
//     platform's one format goes through the SAME ffmpeg seam the enrollment
//     pipeline uses (`_replica-processing/native-tools.js`), and a runtime with
//     no ffmpeg says so by name instead of shipping a rate the player will
//     silently mis-speed. `rejected.md` already has one 8 kHz reference wearing
//     a 24 kHz label; it does not need a second.
import { createHash } from "node:crypto";
import { createNativeToolRunners } from "../../_replica-processing/native-tools.js";
import { probeEnrollmentWav } from "../../_audio/wav.js";
import { VOICE_PCM_FORMAT, syntheticAudioDisclosure } from "../contracts.js";

/** Arm ids as they appear in `VOICE_VENDOR_ARMS` and in the bench plan. */
export const VENDOR_ARM_IDS = Object.freeze(["elevenlabs", "sarvam"]);

/** The one place the vendor-arm feature flag is read. */
export const VENDOR_ARMS_ENV = "VOICE_VENDOR_ARMS";

const MAX_VENDOR_AUDIO_BYTES = 24 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const RESAMPLE_CEILING_MS = 600_000;

export function vendorFail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}

/** Which vendor arms the operator has switched on. Empty by default. */
export function enabledVendorArms(env = process.env) {
  const raw = String(env[VENDOR_ARMS_ENV] || "").toLowerCase();
  const requested = raw.split(",").map((value) => value.trim()).filter(Boolean);
  return Object.freeze(VENDOR_ARM_IDS.filter((id) => requested.includes(id)));
}

/**
 * The honest-state helper. A vendor arm is one of exactly two things and never
 * a third: available, or unavailable WITH A NAMED REASON. `available: false`
 * plus an empty reason is not a state this function can produce.
 */
export function vendorArmState(armId, env = process.env, configure) {
  if (!VENDOR_ARM_IDS.includes(armId)) {
    return Object.freeze({ armId, available: false, reason: "vendor_arm_unknown", blocker: "waiting_on_us" });
  }
  if (!enabledVendorArms(env).includes(armId)) {
    return Object.freeze({
      armId,
      available: false,
      reason: `vendor_arm_not_enabled:${VENDOR_ARMS_ENV}`,
      blocker: "waiting_on_you",
    });
  }
  try {
    configure(env);
    return Object.freeze({ armId, available: true, reason: "", blocker: "" });
  } catch (error) {
    return Object.freeze({
      armId,
      available: false,
      reason: String(error?.code || error?.message || "vendor_arm_config_invalid"),
      // A missing key is the owner's to supply; anything else is ours to fix.
      blocker: /key_required|budget|enabled|approval/.test(String(error?.code || "")) ? "waiting_on_you" : "waiting_on_us",
    });
  }
}

/** A model id that says "latest" cannot anchor a measurement six weeks later. */
export function pinnedModelId(value, code) {
  const model = String(value || "").trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{1,62}$/.test(model) || /latest/i.test(model)) vendorFail(code);
  return model;
}

export function vendorApiKey(value, code) {
  const key = String(value || "").trim();
  if (key.length < 20 || /\s/.test(key)) vendorFail(code);
  return key;
}

export function vendorOrigin(value, fallback, suffixes, code) {
  let url;
  try { url = new URL(String(value || fallback)); } catch { vendorFail(code); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash ||
      url.pathname !== "/" || !suffixes.some((suffix) => url.hostname.toLowerCase().endsWith(suffix))) {
    vendorFail(code);
  }
  return url.origin;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Read one canonical 24 kHz mono PCM16 WAV and hand back its samples.
 *
 * `probeEnrollmentWav` is the authority on the format and it is strict on
 * purpose; this only walks the chunk list a second time to find where the
 * samples start, because the probe returns facts and not bytes.
 */
export function pcmFromCanonicalWav(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  probeEnrollmentWav(buffer);
  let cursor = 12;
  while (cursor + 8 <= buffer.length) {
    const kind = buffer.toString("ascii", cursor, cursor + 4);
    const size = buffer.readUInt32LE(cursor + 4);
    if (kind === "data") return buffer.subarray(cursor + 8, cursor + 8 + size);
    cursor += 8 + size + (size % 2);
  }
  vendorFail("vendor_wav_data_chunk_missing");
  return Buffer.alloc(0);
}

export function canonicalWavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  const rate = VOICE_PCM_FORMAT.sampleRate;
  const channels = VOICE_PCM_FORMAT.channels;
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22); header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * channels * 2, 28);
  header.writeUInt16LE(channels * 2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/** True when the bytes already are a canonical 24 kHz mono PCM16 WAV. */
export function isCanonicalWav(bytes) {
  try {
    probeEnrollmentWav(Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []));
    return true;
  } catch {
    return false;
  }
}

/**
 * Bring any vendor audio to the platform's one format.
 *
 * Raw `pcm_s16le` at 24 kHz is accepted as-is because that is what it already
 * is. Everything else — a WAV at 44.1 kHz, an MP3, a stereo file — goes to
 * ffmpeg through the same runner the enrollment pipeline uses. On a runtime
 * with no ffmpeg this THROWS `reference_window_tool_unavailable` rather than
 * returning the vendor's own rate under a 24 kHz label.
 */
export async function toCanonicalPcm24k(bytes, options = {}) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  if (!buffer.length || buffer.length > MAX_VENDOR_AUDIO_BYTES) vendorFail("vendor_audio_size_invalid", 413);
  if (options.encoding === "pcm_s16le_24000_mono") {
    if (buffer.length % 2) vendorFail("vendor_audio_alignment_invalid", 409);
    return Object.freeze({ pcm: buffer, resampled: false });
  }
  if (isCanonicalWav(buffer)) return Object.freeze({ pcm: pcmFromCanonicalWav(buffer), resampled: false });
  const runners = options.nativeTools || createNativeToolRunners({ env: options.env || process.env });
  const durationMs = Math.min(RESAMPLE_CEILING_MS, Math.max(1_000, Number(options.declaredDurationMs) || RESAMPLE_CEILING_MS));
  const wav = await runners.withMaterializedAudio(buffer, ({ extractWindow }) =>
    extractWindow(0, durationMs, { rate: VOICE_PCM_FORMAT.sampleRate }), { signal: options.signal });
  return Object.freeze({ pcm: pcmFromCanonicalWav(wav), resampled: true });
}

export function byteStream(bytes, size = 11_520) {
  return (async function* () {
    for (let offset = 0; offset < bytes.length; offset += size) {
      yield new Uint8Array(bytes.subarray(offset, Math.min(bytes.length, offset + size)));
    }
  })();
}

/**
 * The reference window the vendor is allowed to hear.
 *
 * `context/decisions.md#replica-provider-portable` keeps the VoiceGenome
 * provider-neutral: the genome owns the reference bytes and a vendor voice id
 * is a disposable server-only mapping of them. So a vendor arm never selects
 * its own audio — it is handed the genome's already-selected window and checks
 * that the bytes hash to what the caller said they would.
 */
export function assertReferenceBytes(reference) {
  const bytes = Buffer.from(reference?.bytes || []);
  if (!bytes.length || bytes.length > MAX_REFERENCE_BYTES) vendorFail("vendor_reference_size_invalid", 413);
  const sha256 = sha256Bytes(bytes);
  if (reference?.sha256 && reference.sha256 !== sha256) vendorFail("vendor_reference_hash_mismatch", 409);
  const probe = probeEnrollmentWav(bytes, { expectedDurationMs: reference?.durationMs });
  if (probe.durationMs < 5_000 || probe.durationMs > 90_000) vendorFail("vendor_reference_duration_invalid", 409);
  return Object.freeze({ bytes, sha256, durationMs: probe.durationMs, probe });
}

/**
 * The consent attestation a vendor clone requires before any byte is uploaded.
 *
 * The platform already runs the ceremony (`api/_replica-provider-consent.js`):
 * the owner reads a fixed statement aloud and that recording is the consent
 * artifact. A vendor arm does not re-run it and does not get the owner's legal
 * name — it gets the statement HASH and the consent artifact's own hash, both
 * of which go into the enrollment commitment. Nothing identifying crosses the
 * wire; what crosses is proof that the ceremony happened.
 */
export function assertVendorConsent(consent) {
  const statementSha256 = String(consent?.statementSha256 || "").toLowerCase();
  const audioSha256 = String(consent?.audioSha256 || "").toLowerCase();
  const templateVersion = String(consent?.templateVersion || "").trim();
  const providerConsentId = String(consent?.providerConsentId || "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(statementSha256) || !/^[0-9a-f]{64}$/.test(audioSha256) ||
      !templateVersion || templateVersion.length > 96 ||
      !/^[0-9a-f-]{36}$/.test(providerConsentId)) {
    vendorFail("vendor_consent_attestation_required", 409);
  }
  return Object.freeze({ statementSha256, audioSha256, templateVersion, providerConsentId });
}

/** The spoken disclosure prefix, identical in shape to every other lane. */
export function renderVendorText(text, languageId = "en") {
  const clean = typeof text === "string" ? text.trim() : "";
  if (!clean || clean.length > 4_000) vendorFail("vendor_synthesis_text_invalid", 400);
  const disclosureText = syntheticAudioDisclosure(languageId);
  return Object.freeze({ disclosureText, renderedText: `${disclosureText} ${clean}` });
}

/** Characters the vendor will bill for. Upper bound on purpose, for Devanagari. */
export function billableCharacters(text) {
  const value = String(text || "");
  if (!value) vendorFail("vendor_character_units_invalid");
  return Math.max(Array.from(value).length, Buffer.byteLength(value, "utf8"));
}

export function vendorSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/**
 * Encode/decode the server-only provider mapping.
 *
 * The vendor's voice id NEVER reaches a client response. `clientVoiceProfile`
 * in `../contracts.js` whitelists by construction and this string is not on the
 * list; keeping the id inside an opaque ref makes an accidental echo obvious in
 * review rather than invisible.
 */
export function encodeVendorRef(prefix, value) {
  return `${prefix}.${Buffer.from(JSON.stringify(value), "utf8").toString("base64url")}`;
}

export function decodeVendorRef(prefix, value, code) {
  const raw = String(value || "");
  if (!raw.startsWith(`${prefix}.`)) vendorFail(code, 400);
  try {
    return JSON.parse(Buffer.from(raw.slice(prefix.length + 1), "base64url").toString("utf8"));
  } catch {
    vendorFail(code, 400);
  }
  return null;
}
