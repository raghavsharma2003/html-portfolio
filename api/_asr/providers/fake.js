// A deterministic fixture ASR (Gurukul WS-I).
//
// The other half of api/_channel/providers/fake.js's shared audio store: the
// channel fake writes turns against a storage path, this reads them back. Two
// fakes joined by a storage REFERENCE rather than by a closure, because that
// is the join the real lanes have — a worker that dropped the ref between
// fetchAudio and transcribe would fail here exactly as it would in
// production.
//
// Unreachable from production by construction: `api/_asr/registry.js` has no
// branch that returns this, and no environment variable can produce one.
import { asrInput, asrResult, langHint } from "../contracts.js";

export function createFakeAsrProvider(options = {}) {
  const store = options.audioStore;
  if (!store) throw new Error("fake asr requires the shared audioStore");
  const calls = { transcribe: 0 };
  const model = String(options.model || "fixture-asr-v1");

  return Object.freeze({
    name: "deterministic-fake-asr",
    model,
    calls,

    async transcribe(rawRef, hint = "hi-IN") {
      calls.transcribe++;
      const ref = asrInput(rawRef);
      langHint(hint);
      if (options.failOnce && calls.transcribe === 1) {
        throw Object.assign(new Error("fixture_asr_transient"), { code: "fixture_asr_transient", status: 503 });
      }
      const turns = store.get(ref.storagePath);
      if (!turns) throw Object.assign(new Error("fixture_asr_audio_missing"), { code: "fixture_asr_audio_missing", status: 404 });
      // Timings the contract will accept, derived from position rather than
      // invented per turn: the fixture corpus is authored as text and a fake
      // that made up plausible-looking durations would be asserting something
      // it does not know.
      let cursor = 0;
      const timed = turns.map((turn) => {
        const t0 = cursor;
        cursor += Math.max(1_000, String(turn.text || "").length * 60);
        return { speaker: turn.speaker, text: turn.text, t0, t1: cursor };
      });
      return asrResult({ turns: timed, provider: "deterministic-fake-asr", model }, { name: "deterministic-fake-asr", model });
    },
  });
}
