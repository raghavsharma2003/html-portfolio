import { createHash, randomUUID } from "node:crypto";
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { readPrivateReplicaObject } from "./_replica-storage.js";
import { createProductionProtectionAdapters } from "./_provenance/registry.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { assertSynthesisResult } from "./_voice/contracts.js";
import { createOpenChatterboxPreviewProvider } from "./_voice/providers/open-chatterbox-preview.js";
import {
  beginOwnedVoicePreview,
  createNeonVoicePreviewLedger,
  markVoicePreviewFailed,
} from "./_replica-voice-preview.js";

const LANGUAGES = new Set(["en", "hi"]);

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Expose-Headers", "X-Vyakti-Generation, X-Vyakti-Disclosure, X-Vyakti-Model-Commitment");
  res.setHeader("Cache-Control", "no-store");
}

function cleanText(value) {
  const text = Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) throw Object.assign(new Error("voice_preview_text_required"), { status: 400 });
  if (Array.from(text).length > 600) throw Object.assign(new Error("voice_preview_text_too_large"), { status: 413 });
  return text;
}

function wavHeader(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcmBytes, 4); header.write("WAVE", 8);
  header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(24_000, 24); header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36);
  header.writeUInt32LE(pcmBytes, 40);
  return header;
}

function previewSeed(generationId) {
  return createHash("sha256").update(`vyakti:voice-preview-seed:v1:${generationId}`).digest().readUInt32BE(0) & 0x7fffffff;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "replica_voice_preview", 12)) return res.status(429).json({ error: "slow_down" });
  let ownerUserId = null;
  let started = null;
  const aborter = new AbortController();
  req.on?.("aborted", () => aborter.abort(new Error("client_aborted")));
  const deadline = setTimeout(() => aborter.abort(new Error("voice_preview_timeout")), 270_000);
  try {
    const user = await requireUser(req);
    ownerUserId = user.id;
    if (!allow(user.id, "replica_voice_preview_user", 8)) return res.status(429).json({ error: "slow_down" });
    const body = req.body || {};
    const languageId = String(body.language_id || "en").toLowerCase();
    if (!LANGUAGES.has(languageId)) return res.status(400).json({ error: "voice_preview_language_not_supported" });
    const text = cleanText(body.text);
    started = await beginOwnedVoicePreview(q, user.id, {
      replica_id: body.replica_id,
      genome_version: body.genome_version,
      trace_id: `preview_${randomUUID().replaceAll("-", "")}`,
    });
    const stored = await readPrivateReplicaObject(started.reference.objectPath, {
      maxBytes: 20 * 1024 * 1024,
      timeoutMs: 30_000,
    });
    if (stored.mime !== started.reference.mime || stored.byteSize !== started.reference.byteSize ||
        createHash("sha256").update(stored.body).digest("hex") !== started.reference.sha256) {
      throw Object.assign(new Error("voice_preview_reference_binding_failed"), { status: 409 });
    }
    const provider = createOpenChatterboxPreviewProvider();
    const synthesized = assertSynthesisResult(await provider.synthesizePreview({
      requestId: started.generation.generation_id,
      text,
      languageId,
      seed: previewSeed(started.generation.generation_id),
      reference: {
        bytes: stored.body,
        sha256: started.reference.sha256,
        durationMs: started.reference.durationMs,
      },
      style: {
        exaggeration: body.style?.exaggeration ?? 0.5,
        cfgWeight: body.style?.cfg_weight ?? 0.5,
        temperature: body.style?.temperature ?? 0.8,
      },
      signal: aborter.signal,
    }));
    const protection = createProductionProtectionAdapters({ db: q });
    const protectedAudio = await protectReplicaStream({
      authorization: started.authorizationInput,
      sourceStream: synthesized.stream,
      format: synthesized.format,
      adapters: Object.freeze({ ...protection, ledger: createNeonVoicePreviewLedger(q) }),
      disclosureEvidence: {
        renderedText: synthesized.renderedText,
        renderer: `${provider.name}@${provider.modelCommitment}`,
      },
      signal: aborter.signal,
    });
    const chunks = [];
    for await (const chunk of protectedAudio.stream) chunks.push(Buffer.from(chunk));
    const receipt = await protectedAudio.completion;
    const pcm = Buffer.concat(chunks);
    if (!pcm.length) throw new Error("voice_preview_audio_empty");
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Content-Length", String(44 + pcm.length));
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Vyakti-Generation", started.generation.generation_id);
    res.setHeader("X-Vyakti-Disclosure", "audible-prefix-v1");
    res.setHeader("X-Vyakti-Model-Commitment", provider.modelCommitment);
    if (receipt.generation_id !== started.generation.generation_id) throw new Error("voice_preview_receipt_binding_failed");
    return res.status(200).send(Buffer.concat([wavHeader(pcm.length), pcm]));
  } catch (error) {
    if (started && ownerUserId) await markVoicePreviewFailed(q, ownerUserId, started.generation.generation_id, error);
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "voice_preview_failed" : String(error.code || error.message) });
  } finally {
    clearTimeout(deadline);
  }
}

export const config = { maxDuration: 300 };
