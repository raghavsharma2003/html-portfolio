# Azure short-ASR duration audit

2026-09-07. Bounded read-only inspection of frozen integration checkpoint `3bf53790`. No integration edits, provider requests, cloud operations, database access or test execution. This draft records source behavior and a proposed regression battery, not observed Azure responses.

## Finding

`api/_asr/providers/azure-speech-short.js` has no authoritative maximum-duration check against decoded PCM frames. Its 60,000 ms guard at lines 125-126 reads `ref.durationMs` before loading audio. `resample24kPcm16To16kWav` then probes the source at line 60 and resamples it without comparing measured duration or frames against `MAX_DURATION_MS`. The caller dispatches that output at lines 134-156.

`probeEnrollmentWav` does not supply a hidden duration cap. In `api/_audio/wav.js:69-75`, it calculates frames from validated PCM data length, rounds duration to milliseconds and optionally requires agreement with `expectedDurationMs` within 2 ms. It then validates signal statistics and returns frames/sample rate/duration. No minimum or maximum duration constant exists in that module. A global cap in this probe would affect enrollment and voice-reference consumers that have different duration contracts; do not add the Azure-specific ceiling there.

The probe is still useful: format, RIFF length, frame alignment, nonempty data and signal-quality checks prevent arbitrary bytes from being treated as canonical audio. Those checks do not imply a valid Azure short-audio duration.

## Metadata cases

These follow from `asrInput` numeric coercion in `api/_asr/contracts.js:96-111`, the provider guard and the probe's optional expected duration. No network reproduction was run.

| Canonical source and supplied metadata | Current result before transport | Why |
|---|---|---|
| Actual 61 seconds, duration omitted | Can reach provider dispatch | Input defaults to zero; the pre-read guard skips it; `ref.durationMs || undefined` disables expected-duration comparison. |
| Actual 61 seconds, explicit zero/null/empty string | Can reach provider dispatch | Same effective zero/undefined path. |
| Actual 61 seconds, nonnumeric duration string | Can reach provider dispatch | `Number(...)` is NaN, falsy in the pre-read guard and converted to undefined for the probe. |
| Actual 61 seconds, negative infinity | Can reach provider dispatch | It is not greater than the cap; the probe ignores nonfinite expected duration. Positive infinity is already rejected by the pre-read guard. |
| Actual 61 seconds, declared 59 seconds | Already rejected | The probe sees finite expected duration and throws `wav_duration_mismatch`; this is not the missing bound. |
| Actual 60,001 ms, declared 59,999 ms | Can reach provider dispatch | Declared duration is below cap and the difference equals the permitted 2 ms. |
| Actual 60,002 ms, declared 60,000 ms | Can reach provider dispatch | Same 2 ms tolerance. |
| Actual 60 seconds plus one PCM frame, declared 60,000 ms | Can reach provider dispatch | At 24 kHz the measured source is about 60,000.0417 ms, but the probe's rounded `durationMs` is 60,000. The resampler produces 960,001 output frames, also over 60 seconds. A rounded-duration-only patch would miss this case. |
| Declared duration greater than 60,000 ms | Already rejected before private read | Existing fast metadata guard is useful and should stay. |

The audio SHA/byte-size checks still apply in every case. The finding requires valid, hash-matching PCM audio, not a malformed container. Byte-size ceilings bound memory, not the advertised audio duration.

## Reachability limit

The ordinary Mirror route calls `provider.transcribe({ ...ref, durationMs: input.durationMs }, ...)` at `api/mirror-call.js:746-750`; it already supplies bounded window metadata and performs an earlier PCM probe. Its ordinary window contract is 30 seconds. Consequently this audit does **not** establish that normal Mirror requests can currently transmit a 61-second object. It establishes that the provider boundary fails to enforce its own advertised `maxDurationMs=60_000` when called without reliable metadata or near the tolerance boundary.

The planned voice-identity integration is relevant because the existing verifier omits duration metadata. That verifier remains disabled in Azure-only mode at this checkpoint; do not describe this as a demonstrated live identity-provider call. A future caller should also apply its narrower 30-second challenge bound to measured audio.

## Exact minimal patch recommendation

Add a frame-based check inside the Azure-specific exported resampler, immediately after `probeEnrollmentWav` and before allocating/resampling the 16 kHz derivative:

```js
const probe = probeEnrollmentWav(bytes, { expectedDurationMs });
if (probe.frames * 1000 > probe.sampleRate * MAX_DURATION_MS) {
  fail("azure_asr_short_window_too_long", 413, {
    max_ms: MAX_DURATION_MS,
    duration_ms: probe.frames * 1000 / probe.sampleRate,
  });
}
```

The source is strictly validated as mono 24 kHz PCM16, so exact frame comparison is authoritative and stays within safe integer arithmetic for the current buffer limit. It accepts exactly 60 seconds and rejects one frame over. With the present deterministic 24-to-16 kHz resampler, a source no longer than 60 seconds produces no more than 960,000 output frames. A future transform changing duration must re-establish that invariant.

Keep the current pre-read metadata cap and the probe's 2 ms agreement check. They catch cheaply rejectable metadata and inconsistent recordings, respectively. The new measured ceiling is independent of both. Do not truncate the input, change the original SHA, clamp its duration, change the provider limit, or silently route to another provider.

Placing the check immediately after the probe avoids the expensive 33-tap resampling loop for an oversized valid file. A check only after the completed resample would stop dispatch but waste work. This change also protects direct consumers of the exported resampler; the bounded source search found only its provider caller in active API code.

Malformed nonfinite metadata can additionally be rejected by a separately versioned input-validation improvement, but that is not necessary to make the measured duration boundary correct. Avoid broad coercion changes in the same small patch unless all ASR consumers are reviewed.

## Meaningful regression tests after the freeze

Use synthetic non-silent canonical 24 kHz PCM WAV bytes, matching SHA and byte count, the actual provider and resampler, an injected `readAudio`, and an injected fetch recorder. Never contact Azure. Generating PCM fixtures is not a voice-recognition quality test.

1. **Positive transport:** valid 1.2-second audio with exact metadata, and valid exactly-60-second audio with omitted metadata, each dispatch once. Verify 16 kHz mono PCM16 headers, exact expected output frames, unchanged input bytes/hash, requested locale, and redirect refusal. A provider-shaped fake response lets the success path complete; it proves transport structure only.
2. **No metadata bypass:** valid 60 seconds plus one frame and valid 61 seconds, each with omitted duration, explicit zero and a nonnumeric value, reject with `azure_asr_short_window_too_long`; `fetchImpl` call count remains zero. At least one case must use the real `transcribe` function to cover its coercion/call ordering.
3. **Tolerance bypass:** valid 60,002 ms source with declared 60,000 ms rejects using the new measured-duration code despite passing the drift comparison. Include the one-frame-over source with declared 60,000 ms so a rounded-only check fails the battery.
4. **Existing mismatch guard:** 61-second source declared as 59 seconds still rejects with `wav_duration_mismatch`; zero provider dispatch. Do not replace this with a test expecting the new cap to override earlier contract validation.
5. **Fast metadata refusal:** declared 60,001 ms rejects before `readAudio` and before fetch; separate counters assert both are zero. Keep byte-hash mismatch and invalid-container controls so the new cap does not bypass integrity checks.
6. **Negative control:** evaluate a throwaway source copy outside the integration tree with exactly the new frame check removed, through injected transports. The omitted-duration oversize fixture must reach the fake transport, making the safety test fail. This demonstrates that the added check is load-bearing rather than an “always reject” assertion. A variant using only rounded `probe.durationMs` must fail the one-frame-over case.

Existing coverage inspected: `evals/mirrorcallapi.mjs:75-154` exercises a 1,200 ms successful resample/dispatch and a wrong-SHA refusal. `evals/azure-only-asr.mjs` exercises selection/origin policy. Neither inspected suite includes a decoded duration-ceiling boundary. The regression can be a small dedicated offline suite or a focused extension of the existing actual-adapter block, followed by affected ASR/Mirror suites and the required release gate.

## Evidence scope

Method: local source inspection of one provider, its shared PCM probe, input coercion, actual Mirror caller and existing focused tests. The numerical edge cases above are arithmetic over the documented source formulas, not measured provider behavior. This audit executes no new gate and makes no claim about Azure's eventual error response, latency, billing or recognition accuracy.
