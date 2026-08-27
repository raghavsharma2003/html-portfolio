#!/usr/bin/env node
// first-clone.mjs — one command that takes a consented audio file and drives
// the whole clone chain against the LIVE services, printing each stage's real
// status and the fidelity number at the end.
//
//   node scripts/first-clone.mjs <audio.wav> "<display name>"
//
// ── what this is for ──────────────────────────────────────────────────────
// Every pipeline in this repo was BUILT and GATED long before any of them had
// processed a real human (context/STATE.md's pipeline table). This script is
// the thing that turns that from a claim into a run: it is the path the owner
// takes with their own voice, and it is deliberately written so that a stage
// which is not ready says WHICH stage and WHY, loudly, instead of degrading
// into a green run that measured nothing.
//
// ── the two rules it enforces on itself ──────────────────────────────────
// 1. NO STAGE IS EVER SKIPPED SILENTLY. A missing credential is a printed
//    `SKIP` row naming the exact environment variable, and the process exits
//    non-zero if any stage the caller asked for did not run. `verify-release`
//    learned this the hard way (`gates-that-live-nowhere`): a gate that
//    quietly does nothing reports a pass on a tree it never read.
// 2. NOTHING IS FABRICATED. Every number printed comes back from a live
//    service in this run. Where a stage cannot produce a number, the row says
//    so; it never carries a default forward as if it were measured.
//
// ── the input format ──────────────────────────────────────────────────────
// Canonical 24 kHz mono 16-bit PCM WAV — the one enrollment format the
// platform owns end to end (`api/_audio/wav.js`). Convert first:
//
//   ffmpeg -i whatever.m4a -ac 1 -ar 24000 -c:a pcm_s16le out.wav
//
// ── what it does NOT prove ────────────────────────────────────────────────
// The fidelity number is speaker-embedding similarity. It is one automated
// gate — `api/_fidelity.js` says so in its own header — and it is not the
// blind ABX bench in docs/gurukul/research/voice-stack.md. A high number here
// does not license any claim about how the clone SOUNDS.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { probeEnrollmentWav } from "../api/_audio/wav.js";
import { createOpenChatterboxPreviewProvider } from "../api/_voice/providers/open-chatterbox-preview.js";
import { createAzureVoiceEvidenceAdapters } from "../api/_replica-processing/providers/azure-voice-evidence.js";
import { createSarvamSaarasProvider } from "../api/_asr/providers/sarvam-saaras.js";
import { fidelityScore, fidelityVerdict, embeddingVectors, DEFAULT_FIDELITY_POLICY } from "../api/_fidelity.js";
import { transcriptStats, draftFromSignals } from "../api/_engine.gen.js";
import { measureScriptAwareHindiMarkerProxy } from "../evals/speech/hinglish-script-score.mjs";
import { explicitReferenceLanguageEvidence } from "../evals/earbench/cfg-conditioning.mjs";

const SAMPLE_RATE = 24_000;
const REFERENCE_WINDOWS = 4;
// The runtime rejects a conditioning reference outside 5–90 s
// (`services/open-voice-runtime/app.py::_reference`). Longer input is TRIMMED,
// never resampled: resampling would change the very timbre being measured.
const MAX_PROMPT_MS = 90_000;
// Sarvam's synchronous endpoint refuses audio over 30 s and says so
// ("Please use the batch API for longer audio files", measured 2026-08-26).
const SYNC_ASR_MAX_MS = 30_000;
const CLONE_LINES = [
  "Chaliye aaj hum ek aisa concept dekhte hain jo har exam mein poocha jaata hai, aur zyada tar log yahin galti karte hain.",
  "Dekhiye, agar aap basics clear rakhenge toh advanced questions bhi bahut easy lagenge, bas practice consistent honi chahiye.",
  "Main aapko ek short trick bataata hoon, lekin pehle derivation samajhna zaroori hai, warna trick kaam nahi karegi.",
  "Toh doston, aaj ke liye itna hi, next session mein hum numericals solve karenge, tab tak apna homework poora kar lijiye.",
];

const [, , audioPathRaw, displayNameRaw, ...optionArgs] = process.argv;
if (!audioPathRaw) {
  console.error('usage: node scripts/first-clone.mjs <audio.wav> "<display name>" --reference-language-mode <mode> --reference-language-evidence-scope <scope>');
  process.exit(2);
}
const flags = new Map();
for (let i = 0; i < optionArgs.length; i += 1) {
  if (!optionArgs[i].startsWith("--")) continue;
  const key = optionArgs[i].slice(2);
  const next = optionArgs[i + 1];
  if (next === undefined || next.startsWith("--")) flags.set(key, true);
  else { flags.set(key, next); i += 1; }
}
const flag = (name, fallback = null) => flags.has(name) ? flags.get(name) : fallback;
const audioPath = resolve(audioPathRaw);
const displayName = String(displayNameRaw || "").trim();
const outDir = process.env.FIRST_CLONE_OUT || resolve(process.cwd(), "first-clone-out");
mkdirSync(outDir, { recursive: true });

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const stages = [];
const started = Date.now();
const requestedCfgWeight = Number(flag("cfg-weight", process.env.FIRST_CLONE_CFG_WEIGHT || 0.5));
const referenceLanguageMode = flag("reference-language-mode", process.env.FIRST_CLONE_REFERENCE_LANGUAGE_MODE);
const referenceLanguageEvidenceScope = flag(
  "reference-language-evidence-scope",
  process.env.FIRST_CLONE_REFERENCE_LANGUAGE_EVIDENCE_SCOPE,
);
let voiceConditioning = {
  version: "vyakti-first-clone-conditioning/v1",
  languageId: "hi",
  requestedCfgWeight,
  referenceLanguageMode: referenceLanguageMode || null,
  referenceLanguageEvidenceScope: referenceLanguageEvidenceScope || null,
  state: "not_run",
  clips: [],
  claim: "not_listened",
};

function record(name, status, detail) {
  stages.push({ name, status, detail });
  const icon = { ok: "OK  ", skip: "SKIP", fail: "FAIL" }[status];
  console.log(`[${icon}] ${name.padEnd(22)} ${detail}`);
}

function requireEnv(stage, ...names) {
  const missing = names.filter((name) => !String(process.env[name] || "").trim());
  if (!missing.length) return true;
  record(stage, "skip", `not run — set ${missing.join(", ")}`);
  return false;
}

// ── canonical WAV helpers (see api/_audio/wav.js for the format contract) ──
function wrapWav(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(SAMPLE_RATE * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Walks the RIFF chunk list. ffmpeg writes a LIST/INFO chunk between `fmt `
// and `data`, so a fixed 44-byte offset silently returns 26 bytes of metadata
// as if it were audio — which is exactly the bug that produced a first run of
// four 6-byte "reference windows".
function wavPcm(bytes) {
  let cursor = 12;
  while (cursor + 8 <= bytes.length) {
    const kind = bytes.toString("ascii", cursor, cursor + 4);
    const size = bytes.readUInt32LE(cursor + 4);
    if (kind === "data") return bytes.subarray(cursor + 8, cursor + 8 + size);
    cursor += 8 + size + (size % 2);
  }
  throw new Error("wav_data_chunk_missing: not a RIFF/WAVE file with a data chunk");
}

async function drain(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

// Declared here, before anything can call `summarize()` from a failure path:
// a `let` read from `die()` earlier in the file is a TDZ crash that replaces
// the stage table with a stack trace, i.e. it loses the report at exactly the
// moment the report matters.
var score = null;
var verdict = null;
var ceiling = null;

function die(stage, error) {
  record(stage, "fail", `${error?.code || ""} ${error?.message || error}`.trim());
  summarize();
  process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. probe — local, always runs. A file that is not the canonical enrollment
//    format is rejected HERE, by the platform's own validator, rather than
//    three services later by a stack trace.
// ═══════════════════════════════════════════════════════════════════════════
let reference;
let probe;
let pcm;
try {
  reference = readFileSync(audioPath);
  probe = probeEnrollmentWav(reference);
  pcm = wavPcm(reference);
  record("probe", "ok",
    `${(probe.durationMs / 1000).toFixed(1)} s, ${probe.sampleRate} Hz mono, rms ${probe.rms.toFixed(4)}, peak ${probe.peak.toFixed(3)}, voiced ${(probe.activeRatio * 100).toFixed(0)}%`);
} catch (error) {
  record("probe", "fail",
    `${error?.code || error?.message}: expected canonical 24 kHz mono PCM16 WAV — convert with "ffmpeg -i in -ac 1 -ar 24000 -c:a pcm_s16le out.wav"`);
  summarize();
  process.exit(1);
}
const referenceSha = sha(reference);

// ═══════════════════════════════════════════════════════════════════════════
// 2. studio — the REAL HTTP endpoints: replica create, account consent,
//    signed private upload, finalize. Needs a signed-in owner session.
// ═══════════════════════════════════════════════════════════════════════════
let replicaId = null;
let sourceId = null;
if (requireEnv("studio", "VYAKTI_STUDIO_ORIGIN", "VYAKTI_ACCESS_TOKEN")) {
  const origin = String(process.env.VYAKTI_STUDIO_ORIGIN).replace(/\/+$/, "");
  const token = String(process.env.VYAKTI_ACCESS_TOKEN);
  const call = async (path, body) => {
    const response = await fetch(`${origin}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    });
    const text = await response.text();
    if (!response.ok) {
      throw Object.assign(new Error(`${path} ${body.op} -> ${response.status} ${text.slice(0, 200)}`), { code: "studio_rejected" });
    }
    return JSON.parse(text);
  };
  try {
    const { replica } = await call("/api/replica", { op: "create", display_name: displayName || "Self replica" });
    replicaId = replica.replica_id;
    await call("/api/replica-consent", {
      op: "grant",
      replica_id: replicaId,
      scopes: ["capture", "storage", "transcription"],
      attestations: { is_self: true, is_adult: true, has_source_rights: true, understands_synthetic_disclosure: true },
    });
    const created = await call("/api/replica-source", {
      op: "create_upload", replica_id: replicaId, kind: "audio", mime: "audio/wav",
      byte_size: reference.length, sha256: referenceSha, contains_third_parties: false, purpose: "memory",
    });
    sourceId = created.source.source_id;
    const put = await fetch(created.upload.url, {
      method: created.upload.method, headers: created.upload.headers, body: reference,
      signal: AbortSignal.timeout(300_000),
    });
    if (!put.ok) throw Object.assign(new Error(`private upload PUT -> ${put.status}`), { code: "storage_put_failed" });
    const finalized = await call("/api/replica-source", { op: "finalize", replica_id: replicaId, source_id: sourceId });
    record("studio", "ok", `replica ${replicaId} source ${sourceId} state=${finalized.source.state}`);
  } catch (error) {
    const hint = String(error?.message || "").includes("storage_metadata_incomplete")
      ? " — the deployment is running a build from before the object/info header fix in api/_replica-storage.js; redeploy the branch"
      : "";
    record("studio", "fail", `${`${error?.code || ""} ${error?.message || error}`.trim()}${hint}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. reference embeddings — the voice-evidence round trip.
//    Four equal windows: `voice_quality` takes at most 4 inputs per call and
//    `DEFAULT_FIDELITY_POLICY.minReference` is 2, so four is the most evidence
//    one call can carry and still leaves the p10/worst rails meaningful.
// ═══════════════════════════════════════════════════════════════════════════
let evidence = null;
let referenceEvidence = null;
const latency = {};

// A COLD START INVALIDATES THE SIGNATURE, and this is not a corner case.
// `services/voice-evidence/app.py` allows 60 s of clock skew on
// `X-Vyakti-Timestamp`; the service takes ~176 s to come up from zero replicas.
// So the request that WAKES the service is signed ~176 s before it is verified
// and comes back 401 `transport_signature_invalid` — an authentication error
// for what is really a latency problem, which is the most misleading shape a
// failure can take. Measured 2026-08-26. The fix is to wake the service on the
// unauthenticated `/healthz` first and sign nothing until it answers 200.
async function warmEvidence(origin) {
  const at = Date.now();
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${origin}/healthz`, { signal: AbortSignal.timeout(30_000) });
      if (response.ok) return Date.now() - at;
    } catch { /* a cold GPU app refuses the connection until it is scheduled */ }
    if (attempt === 0) console.log("       .. voice-evidence is cold; waking it on /healthz before signing anything (~176 s from zero)");
    await new Promise((r) => setTimeout(r, 5_000));
  }
  throw Object.assign(new Error("voice_evidence_never_became_ready"), { code: "voice_evidence_cold" });
}

async function measure(label, wavs) {
  const inputs = wavs.map((bytes) => ({
    sha256: sha(bytes), mime: "audio/wav",
    duration_ms: Math.round((bytes.length - 44) / 2 / SAMPLE_RATE * 1000),
    __bytes: bytes,
  }));
  const at = Date.now();
  const value = await evidence.voice_quality.measure({ source: label, inputs });
  latency[label] = Date.now() - at;
  return value;
}

const referenceWindows = [];
if (requireEnv("reference-embeddings", "AZURE_VOICE_EVIDENCE_ORIGIN", "AZURE_VOICE_EVIDENCE_HMAC_SECRET")) {
  const per = Math.floor(pcm.length / REFERENCE_WINDOWS / 2) * 2;
  for (let i = 0; i < REFERENCE_WINDOWS; i += 1) referenceWindows.push(wrapWav(pcm.subarray(i * per, (i + 1) * per)));
  try {
    const warmMs = await warmEvidence(String(process.env.AZURE_VOICE_EVIDENCE_ORIGIN).replace(/\/+$/, ""));
    latency.warmup = warmMs;
    evidence = createAzureVoiceEvidenceAdapters({
      resolveInput: async ({ input }) => ({ body: input.__bytes, mime: "audio/wav", byteSize: input.__bytes.length }),
    });
    referenceEvidence = await measure("reference", referenceWindows);
    const worstSnr = Math.min(...referenceEvidence.measurements.per_input.map((item) => item.estimated_snr_db));
    record("reference-embeddings", "ok",
      `${referenceEvidence.embeddings.length} embeddings from ${REFERENCE_WINDOWS} x ${(per / 2 / SAMPLE_RATE).toFixed(1)} s in ${latency.reference} ms (after ${(latency.warmup / 1000).toFixed(0)} s of warm-up), worst window SNR ${worstSnr.toFixed(1)} dB`);
  } catch (error) {
    die("reference-embeddings", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. clone — zero-shot Chatterbox conditioned on the consented reference.
//    NO per-speaker fine-tune runs here. What comes out is a FLOOR.
// ═══════════════════════════════════════════════════════════════════════════
const candidateWindows = [];
const receipts = [];
if (requireEnv("clone-synthesis", "AZURE_OPEN_VOICE_ORIGIN", "OPEN_VOICE_HMAC_SECRET")) {
  let referenceEvidence;
  try {
    if (!Number.isFinite(requestedCfgWeight) || requestedCfgWeight < 0 || requestedCfgWeight > 1) {
      throw Object.assign(new Error("first_clone_cfg_weight_invalid"), { code: "first_clone_cfg_weight_invalid" });
    }
    referenceEvidence = explicitReferenceLanguageEvidence({
      mode: referenceLanguageMode,
      scope: referenceLanguageEvidenceScope,
    });
  } catch (error) {
    die("clone-synthesis", Object.assign(error, {
      message: `${error?.message || error}; pass --reference-language-mode and --reference-language-evidence-scope so effective CFG cannot change silently`,
    }));
  }
  let prompt = wrapWav(pcm);
  let trimNote = "";
  if (probe.durationMs > MAX_PROMPT_MS) {
    prompt = wrapWav(pcm.subarray(0, Math.floor(MAX_PROMPT_MS / 1000 * SAMPLE_RATE) * 2));
    trimNote = `, reference trimmed to ${MAX_PROMPT_MS / 1000} s for the runtime's conditioning cap`;
  }
  const chatterbox = createOpenChatterboxPreviewProvider();
  try {
    for (let i = 0; i < CLONE_LINES.length; i += 1) {
      let result = null;
      for (let attempt = 0; ; attempt += 1) {
        try {
          result = await chatterbox.synthesizePreview({
            requestId: randomUUID(), text: CLONE_LINES[i], languageId: "hi", seed: 31_000 + i,
            reference: {
              bytes: prompt,
              languageMode: referenceEvidence.mode,
              languageEvidenceScope: referenceEvidence.scope,
            },
            style: { exaggeration: 0.45, cfgWeight: requestedCfgWeight, temperature: 0.8 },
          });
          break;
        } catch (error) {
          // A GPU app at zero replicas takes ~161 s to become ready and the
          // request that wakes it dies first (AZURE-DEPLOY-STATE.md §8). That
          // is a cold start, not a failure, and only retrying can tell them
          // apart — so this retries, loudly, and gives up after four tries.
          if (attempt >= 3) throw error;
          console.log(`       .. ${error?.code || error} — retrying (cold start takes ~161 s), attempt ${attempt + 2}/4`);
          await new Promise((r) => setTimeout(r, 15_000));
        }
      }
      const wav = wrapWav(await drain(result.stream));
      writeFileSync(`${outDir}/clone-${i + 1}.wav`, wav);
      candidateWindows.push(wav);
      receipts.push(result.receipt);
    }
    voiceConditioning = {
      ...voiceConditioning,
      referenceLanguageMode: referenceEvidence.mode,
      referenceLanguageEvidenceScope: referenceEvidence.scope,
      state: "observed",
      clips: receipts.map((receipt, index) => ({
        item: `clone-${index + 1}`,
        seed: 31_000 + index,
        requestedCfgWeight: receipt.requestedCfgWeight,
        effectiveCfgWeight: receipt.effectiveCfgWeight,
        referenceLanguageMode: receipt.referenceLanguageMode,
        referenceLanguageEvidenceScope: receipt.referenceLanguageEvidenceScope,
        textLanguageMode: receipt.textLanguageMode,
        conditioningContract: receipt.conditioningContract,
        modelArm: receipt.modelArm,
        modelPack: receipt.modelPack,
        modelCommitment: receipt.modelCommitment,
        synthesisCommitment: receipt.synthesisCommitment,
        referenceSha256: receipt.referenceSha256,
        outputSha256: receipt.outputSha256,
        qualityState: receipt.qualityState,
        qualityWarnings: receipt.qualityWarnings,
      })),
    };
    const effectiveCfg = [...new Set(receipts.map((receipt) => receipt.effectiveCfgWeight))].join(",");
    const contracts = [...new Set(receipts.map((receipt) => receipt.conditioningContract))].join(",");
    const rtf = receipts.map((r) => r.realTimeFactor);
    record("clone-synthesis", "ok",
      `${receipts.length} clips, ${(receipts.reduce((a, b) => a + b.durationMs, 0) / 1000).toFixed(1)} s audio, rtf ${Math.min(...rtf).toFixed(2)}–${Math.max(...rtf).toFixed(2)}, watermark verified on all${trimNote}`);
    record("voice-conditioning", "ok",
      `requested cfg ${requestedCfgWeight}, effective cfg ${effectiveCfg}, reference ${referenceEvidence.mode}/${referenceEvidence.scope}, contract ${contracts}; no listening verdict`);
  } catch (error) {
    die("clone-synthesis", error);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. candidate embeddings
// ═══════════════════════════════════════════════════════════════════════════
let candidateEvidence = null;
if (evidence && candidateWindows.length) {
  try {
    candidateEvidence = await measure("candidate", candidateWindows);
    record("candidate-embeddings", "ok",
      `${candidateEvidence.embeddings.length} embeddings from ${candidateWindows.length} clips in ${latency.candidate} ms`);
  } catch (error) {
    die("candidate-embeddings", error);
  }
} else if (evidence || candidateWindows.length) {
  record("candidate-embeddings", "skip", "needs both the evidence service and a clone");
}

// ═══════════════════════════════════════════════════════════════════════════
// 6. fidelity — the number, its verdict, and the CEILING control.
//    The ceiling is the owner's own voice scored against itself across
//    different windows of the same recording. Without it a clone score is a
//    decimal with no top: nothing on this scale can beat the ceiling, so the
//    clone number only means something as a fraction of it.
// ═══════════════════════════════════════════════════════════════════════════
if (referenceEvidence && candidateEvidence) {
  try {
    score = fidelityScore(referenceEvidence.embeddings, candidateEvidence.embeddings);
    verdict = fidelityVerdict(score);
    const refVectors = embeddingVectors(referenceEvidence.embeddings);
    ceiling = fidelityScore(refVectors.slice(0, Math.ceil(refVectors.length / 2)), refVectors.slice(Math.ceil(refVectors.length / 2)));
    record("fidelity", "ok",
      `mean ${score.mean} (p10 ${score.p10}, worst ${score.worst}, ${score.windows} windows vs ${score.references} references) — ${verdict.status}${verdict.reasons.length ? ` [${verdict.reasons.join(",")}]` : ""}; ceiling ${ceiling.mean}`);
  } catch (error) {
    die("fidelity", error);
  }
} else {
  record("fidelity", "skip", "needs both reference and candidate embeddings");
}

// ═══════════════════════════════════════════════════════════════════════════
// 7. activation gate — asked of the live runtime, never inferred. A clone that
//    scores well is still not activatable until every blocker clears, and
//    printing the real list is the only honest way to say how far off it is.
// ═══════════════════════════════════════════════════════════════════════════
if (replicaId && process.env.VYAKTI_STUDIO_ORIGIN && process.env.VYAKTI_ACCESS_TOKEN) {
  try {
    const origin = String(process.env.VYAKTI_STUDIO_ORIGIN).replace(/\/+$/, "");
    const response = await fetch(`${origin}/api/replica-runtime?replica_id=${encodeURIComponent(replicaId)}`, {
      headers: { Authorization: `Bearer ${process.env.VYAKTI_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(60_000),
    });
    const body = await response.json();
    const blockers = body?.runtime?.blockers || [];
    record("activation-gate", "ok",
      `can_activate=${body?.runtime?.can_activate} — ${blockers.length} blocker(s): ${blockers.join(", ") || "none"}`);
  } catch (error) {
    record("activation-gate", "fail", `${error?.code || ""} ${error?.message || error}`.trim());
  }
} else {
  record("activation-gate", "skip", "needs a studio session and a created replica");
}

// ═══════════════════════════════════════════════════════════════════════════
// 8. ASR + sheet draft. Sync under 30 s, batch above it — the provider's own
//    limit, measured, not assumed.
// ═══════════════════════════════════════════════════════════════════════════
if (requireEnv("asr", "SARVAM_API_KEY")) {
  try {
    let turns = null;
    let via = "";
    const at = Date.now();
    if (probe.durationMs <= SYNC_ASR_MAX_MS) {
      const form = new FormData();
      form.append("file", new Blob([reference], { type: "audio/wav" }), "audio.wav");
      form.append("model", process.env.SARVAM_SYNC_ASR_MODEL || "saarika:v2.5");
      form.append("language_code", "hi-IN");
      const response = await fetch("https://api.sarvam.ai/speech-to-text", {
        method: "POST", headers: { "api-subscription-key": process.env.SARVAM_API_KEY },
        body: form, signal: AbortSignal.timeout(180_000),
      });
      const body = await response.json();
      if (!response.ok) throw Object.assign(new Error(body?.error?.message || `sync ASR ${response.status}`), { code: "asr_sync_failed" });
      turns = [{ speaker: "SPEAKER_00", text: String(body.transcript || ""), t0: 0, t1: probe.durationMs }];
      via = `sync ${process.env.SARVAM_SYNC_ASR_MODEL || "saarika:v2.5"}`;
    } else {
      const provider = createSarvamSaarasProvider({
        apiKey: process.env.SARVAM_API_KEY,
        readAudio: async () => ({ body: reference, byteSize: reference.length }),
      });
      const result = await provider.transcribe(
        { storagePath: sourceId ? `${sourceId}/original` : "local/reference.wav", sha256: referenceSha, mime: "audio/wav", byteSize: reference.length },
        "hi-IN",
      );
      turns = result.turns;
      via = `batch ${provider.model}`;
    }
    const asrMs = Date.now() - at;
    const stats = transcriptStats(turns);
    // Keep the product-derived Roman-only statistic untouched. The additional
    // benchmark metric recognizes only reviewed Roman/Devanagari aliases and
    // labels itself a proxy, not language ID or Hindi percentage.
    const scriptAwareMarkerProxy = measureScriptAwareHindiMarkerProxy(turns, {
      speaker: stats.speaker.label,
    });
    const draft = draftFromSignals(stats, displayName ? { displayName } : {}, {});
    writeFileSync(`${outDir}/sheet-draft.json`, JSON.stringify({
      via,
      turns,
      stats,
      benchmarkMetrics: {
        rawRomanMarkerProxy: stats.codeSwitch,
        scriptAwareMarkerProxy,
      },
      draft: draft.draft,
      gaps: draft.gaps,
      candidates: draft.candidates,
    }, null, 2));
    record("asr", "ok", `${via} in ${asrMs} ms, ${turns.length} turn(s), ${stats.tokens} tokens`);
    record("sheet-draft", "ok",
      `${Object.keys(draft.draft).length} drafted field(s), ${draft.gaps.length} gap(s), ` +
      `raw Roman-marker proxy ${stats.codeSwitch.tokenRatio}, curated script-aware Hindi-marker proxy ` +
      `${scriptAwareMarkerProxy.tokenRatio.toFixed(3)}, ${draft.candidates.length} phrase candidate(s)`);
    if (stats.codeSwitch.tokenRatio === 0 && scriptAwareMarkerProxy.tokenRatio > 0) {
      console.log(
        "       .. raw Roman-marker proxy stayed 0; the separately labeled curated script-aware proxy recognized reviewed Devanagari aliases. Raw output is preserved in sheet-draft.json.",
      );
    } else if (
      stats.codeSwitch.tokenRatio === 0 &&
      scriptAwareMarkerProxy.devanagariScriptTokenRatio > 0 &&
      scriptAwareMarkerProxy.tokenRatio === 0
    ) {
      console.log(
        "       .. Devanagari was observed, but the curated alias table covered none of it. The benchmark leaves the proxy at 0 instead of guessing.",
      );
    }
  } catch (error) {
    record("asr", "fail", `${error?.code || ""} ${error?.message || error}`.trim());
  }
}

// ═══════════════════════════════════════════════════════════════════════════
function summarize() {
  const wall = ((Date.now() - started) / 1000).toFixed(1);
  console.log(`\n${"─".repeat(78)}`);
  const failed = stages.filter((stage) => stage.status === "fail");
  const skipped = stages.filter((stage) => stage.status === "skip");
  if (score) {
    console.log(`FIDELITY  mean ${score.mean}  verdict ${verdict.status}  activation floor ${DEFAULT_FIDELITY_POLICY.activationFloor}  ceiling (self-vs-self) ${ceiling.mean}`);
    console.log("          zero-shot, no per-speaker fine-tune: this is a FLOOR for this voice, not a ceiling.");
    console.log("          speaker-embedding similarity only. It is NOT the blind ABX bench and licenses no claim about how the clone sounds.");
  } else {
    console.log("FIDELITY  not measured in this run");
  }
  console.log(`STAGES    ${stages.filter((s) => s.status === "ok").length} ok, ${skipped.length} skipped, ${failed.length} failed, ${wall} s wall clock`);
  if (skipped.length) console.log(`SKIPPED   ${skipped.map((s) => s.name).join(", ")}`);
  if (failed.length) console.log(`FAILED    ${failed.map((s) => `${s.name} (${s.detail})`).join("; ")}`);
  console.log(`ARTIFACTS ${outDir}`);
  writeFileSync(`${outDir}/voice-conditioning-manifest.json`, JSON.stringify(voiceConditioning, null, 2));
  writeFileSync(`${outDir}/first-clone-run.json`, JSON.stringify({
    audio: audioPath, sha256: referenceSha, displayName, probe, stages,
    replica_id: replicaId, source_id: sourceId, evidenceLatencyMs: latency,
    receipts, voiceConditioning, score, verdict, ceiling, wallSeconds: Number(wall),
  }, null, 2));
}

summarize();
process.exit(stages.some((stage) => stage.status !== "ok") ? 1 : 0);
