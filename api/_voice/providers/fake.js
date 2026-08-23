import { createHash } from "node:crypto";
import {
  VOICE_PCM_FORMAT,
  assertCreateVoiceInput,
  renderTextWithDisclosure,
} from "../contracts.js";

// Deterministic in-memory provider for lifecycle, cancellation and wire-format
// gates. It is not registered in production unless an explicit test caller
// passes allowFake to the registry.
export function createFakeVoiceProvider() {
  const voices = new Map();
  const idempotency = new Map();
  return {
    name: "fake",
    async createVoice(input) {
      assertCreateVoiceInput(input);
      if (idempotency.has(input.idempotencyKey)) return idempotency.get(input.idempotencyKey);
      const providerRef = `fake_${createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24)}`;
      voices.set(providerRef, { state: "ready", replicaId: input.replicaId });
      const result = { providerRef, state: "ready" };
      idempotency.set(input.idempotencyKey, result);
      return result;
    },
    async getVoiceStatus(providerRef) {
      return voices.get(providerRef)?.state ?? "missing";
    },
    async synthesizeStream({ providerRef, text, signal }) {
      if (voices.get(providerRef)?.state !== "ready") throw new Error("voice_not_ready");
      const renderedText = renderTextWithDisclosure(text);
      const stream = (async function* () {
        // PCM silence is sufficient to prove byte shape and abort behavior.
        for (let i = 0; i < 3; i++) {
          if (signal?.aborted) throw signal.reason ?? new Error("aborted");
          yield new Uint8Array(960);
          await Promise.resolve();
        }
      })();
      return {
        format: VOICE_PCM_FORMAT,
        renderedText,
        stream,
      };
    },
    async deleteVoice(providerRef) {
      voices.delete(providerRef);
      return { deleted: true };
    },
  };
}
