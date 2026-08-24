import { randomUUID } from "node:crypto";
import { beginOwnedPrivateGeneration, markGenerationFailed } from "./_replica-generation.js";
import { protectReplicaStream } from "./_provenance/delivery.js";
import { assertSynthesisResult } from "./_voice/contracts.js";
import { loadOwnedDialogueSpeech } from "./_replica-dialogue.js";

function cleanText(value, max) {
  return Array.from(String(value || ""))
    .filter((character) => {
      const code = character.codePointAt(0);
      return code === 10 || (code >= 32 && code !== 127);
    })
    .join("")
    .replace(/<\/?(?:system|assistant|developer|tool)[^>]*>/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function wavHeader(pcmBytes) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcmBytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24_000, 24);
  header.writeUInt32LE(48_000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcmBytes, 40);
  return header;
}

function failureCode(error) {
  return String(error?.code || error?.message || "replica_speech_failed").slice(0, 120);
}

export function createReplicaSpeechHandler({ db, requireUser, resolveVoiceProvider, resolveProtectionAdapters, allowTestAdapters = false }) {
  if (![db, requireUser, resolveVoiceProvider, resolveProtectionAdapters].every((fn) => typeof fn === "function"))
    throw new Error("replica speech dependencies required");
  return async function replicaSpeech(req, res) {
    let committed = false;
    let generation = null;
    let ownerUserId = null;
    const aborter = new AbortController();
    req.on?.("close", () => aborter.abort(new Error("client_closed")));
    const deadline = setTimeout(() => aborter.abort(new Error("speech_timeout")), 120_000);
    try {
      const user = await requireUser(req);
      ownerUserId = user.id;
      const body = req.body || {};
      const purpose = body.purpose || "private_conversation";
      let text;
      let style;
      let dialogueTurnId = null;
      if (purpose === "private_conversation") {
        if (typeof body.text === "string" && body.text.trim()) return res.status(400).json({ error: "client_text_not_allowed" });
        const dialogue = await loadOwnedDialogueSpeech(db, user.id, {
          replica_id: body.replica_id,
          dialogue_turn_id: body.dialogue_turn_id,
        });
        text = dialogue.text;
        style = dialogue.style;
        dialogueTurnId = dialogue.dialogue_turn_id;
      } else {
        if (typeof body.text !== "string" || !body.text.trim()) return res.status(400).json({ error: "text_required" });
        if (Array.from(body.text).length > 4_000) return res.status(413).json({ error: "text_too_large" });
        text = cleanText(body.text, 4_000);
        if (!text) return res.status(422).json({ error: "nothing_speakable" });
        style = cleanText(body.style, 240);
      }
      const stream = body.stream === true;
      const started = await beginOwnedPrivateGeneration(db, user.id, {
        replica_id: body.replica_id,
        channel: body.channel || "private_call",
        purpose,
        trace_id: body.trace_id || `voice_${randomUUID().replaceAll("-", "")}`,
        dialogue_turn_id: dialogueTurnId,
      });
      generation = started.generation;

      // Resolve all provider/protection credentials server-side. The client
      // receives neither provider name nor provider_ref.
      const provider = await resolveVoiceProvider(started.runtime.voiceProfile);
      const adapters = await resolveProtectionAdapters({ generation: started, db });
      const synthesized = assertSynthesisResult(await provider.synthesizeStream({
        providerRef: started.runtime.voiceProfile.provider_ref,
        text,
        style,
        signal: aborter.signal,
        requestKey: generation.generation_id,
      }));
      const protectedAudio = await protectReplicaStream({
        authorization: started.authorizationInput,
        sourceStream: synthesized.stream,
        format: synthesized.format,
        adapters,
        disclosureEvidence: {
          renderedText: synthesized.renderedText,
          renderer: `${provider.name}@server-controlled`,
        },
        signal: aborter.signal,
        allowTestAdapters,
      });
      const commonHeaders = {
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Vyakti-Generation": generation.generation_id,
        "X-Vyakti-Disclosure": "audible-prefix-v1",
        "Access-Control-Expose-Headers": "X-Vyakti-Generation, X-Vyakti-Disclosure",
      };
      if (stream) {
        // Do not spend the 200 status line until one protected segment has
        // passed disclosure, watermark, signing, persistence and revocation
        // fencing. An adapter that fails before audio remains a real 5xx.
        const iterator = protectedAudio.stream[Symbol.asyncIterator]();
        const first = await iterator.next();
        if (first.done || !first.value?.byteLength) throw new Error("protected_stream_empty");
        committed = true;
        res.writeHead(200, {
          ...commonHeaders,
          "Content-Type": "audio/l16; rate=24000; channels=1",
        });
        res.write(Buffer.from(first.value));
        for (;;) {
          const next = await iterator.next();
          if (next.done) break;
          res.write(Buffer.from(next.value));
        }
        await protectedAudio.completion;
        return res.end();
      }
      const chunks = [];
      for await (const chunk of protectedAudio.stream) chunks.push(Buffer.from(chunk));
      await protectedAudio.completion;
      const pcm = Buffer.concat(chunks);
      for (const [key, value] of Object.entries(commonHeaders)) res.setHeader(key, value);
      res.setHeader("Content-Type", "audio/wav");
      return res.status(200).send(Buffer.concat([wavHeader(pcm.length), pcm]));
    } catch (error) {
      if (generation && ownerUserId) await markGenerationFailed(db, ownerUserId, generation.generation_id, failureCode(error));
      if (committed) return res.end();
      const status = Number.isInteger(error?.status) ? error.status :
        new Set(["voice_provider_unavailable", "protection_adapters_unavailable"]).has(failureCode(error)) ? 503 : 500;
      return res.status(status).json({ error: status === 500 ? "replica_speech_failed" : failureCode(error) });
    } finally {
      clearTimeout(deadline);
    }
  };
}
