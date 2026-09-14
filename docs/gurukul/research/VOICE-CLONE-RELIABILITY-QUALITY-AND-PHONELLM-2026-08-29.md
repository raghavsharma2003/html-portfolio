# Voice clone reliability, likeness, and PhoneLLM review

**Date:** 2026-08-29  
**Scope:** production enrollment and preview failures, owner-reference binding, current TTS candidates, and PhoneLLM's role in Mirror Call  
**Claim boundary:** a protected clip and a speaker-embedding score do not prove that a human listener accepts the clone. Model promotion still requires locked owner and blinded listener ratings.

## Executive decision

Vyakti has two independent model decisions:

1. **Voice model:** the system that turns text plus an owner reference into the owner's speech. This is evaluated separately for Hindi, Hinglish, and Indian English.
2. **Call brain:** the system that decides what to say and which tools to call. PhoneLLM belongs here. It is not TTS and cannot improve speaker identity by itself.

The current owner default remains general Chatterbox Multilingual V3 with the `identity_anchor` preset. This is now a measured Hindi and Hinglish decision, not a generic model preference: general Chatterbox beat the Hindi-specific pack on two matched Hindi clips, while the two packs were effectively tied on one repaired Hinglish prompt. IndicF5, VoxCPM2, Qwen English, and the Hindi pack remain bounded evaluation arms. No model is promoted across all three language registers until one exact-reference listening pack passes.

## What was actually failing

### Routine cold starts were recorded as model failures

A read-only production audit of the previous 12 hours found 58 preview-generation rows: 13 sealed clips and 45 rows marked failed. All 45 failure codes were normal scale-to-zero states:

- `open_voice_runtime_warming`: 32
- `voice_preview_wake_in_flight`: 12
- `voice_preview_wake_dispatched`: 1

These were not synthesis failures. They were requests that correctly woke a cold GPU or found another request already waking it. They now settle as `aborted`, leaving `failed` for real model, receipt, reference, or protection faults.

### The clone reference is connected, but a valid file is not automatically a good identity sample

Recent successful previews bind different, selected, owner-scoped 10-second PCM references. The runtime returned distinct model/reference/output commitments and verified PerTh receipts. That rules out a disconnected or ignored reference wire.

It does not prove likeness. One recent selected reference contained only about 6.4 to 6.8 seconds of usable speech inside its 10-second window, and its two enhancement candidates had materially different signal-to-noise measurements. Chatterbox also truncates its own reference conditioning internally. A technically valid selected file can therefore remain a poor identity condition.

The enrollment worker now preserves an existing owner-selected primary source, excludes supporting sources from VoiceGenome settlement, admits a bounded continuous window for short owner-only microphone recordings fragmented by diarization, and streams large ASR inputs without a 64 MiB heap buffer.

### One Hindi evaluation gate was stale

The first current-reference comparison stopped before Hindi synthesis because the isolated Hindi gate still used broker digest `sha256:3229c647...` while the verifier required the newer signed text-plan receipt. The Hindi GPU model did not fail. The admission contract was stale.

Only the isolated Hindi gate was updated, to already-qualified broker digest `sha256:e6539e6975eff9dd90db570cdf735c2ad245ead8da74269d6b69d111e3cadde9`. Its HMAC secret reference, internal runtime origin, min replicas zero, max replicas two, and runtime image were preserved.

### Roman Hinglish was resetting the same voice reference too many times

The worst current-owner Hinglish output was not evidence that the selected reference was ignored. Token-level Hindi and English segmentation caused repeated acoustic model calls, each reconditioning on the same short reference and adding a join. The resulting clip lasted 25.98 seconds and scored 0.433967 on the same ECAPA speaker proxy used for the matched arms.

Latin-only Roman Hinglish now keeps the exact Hindi and English lexical audit, but coalesces into one Hindi-conditioned acoustic call when the lexical plan would exceed four synthesis calls. On the same reference, text, and seed, the repaired general clip lasted 7.72 seconds and scored 0.825082. The repaired Hindi-pack clip lasted 9.24 seconds and scored 0.826010. Azure Speech disagreement fell from 65.22% to 43.48% WER on both repaired clips. This is a large repair to identity conditioning and duration, but it is not a human naturalness or accent result.

## Reliability changes

- Preview warmups settle as aborted, not failed.
- Remote readiness comes from the signed admission broker instead of per-process Vercel memory.
- The default owner preview uses the identity-anchor style: exaggeration `0.2`, CFG `0.78`, temperature `0.6`.
- Long Roman Hinglish remains one audited register when token-level switching would exceed the provider-call limit.
- The processing worker uses a renewable ten-minute lease with a sixty-second heartbeat, source-affinity execution, twelve jobs per run, level-triggered VoiceGenome reconciliation, recoverable provider outages, and explicit stale-worker status.
- The primary voice pointer controls both artifact selection and final model-build evidence scope. Supporting audio remains useful context but cannot silently rotate the voice.
- Mirror Call uses signed runtime readiness, private source-handle uploads, inline integrity, session-bound derived call windows, and no imaginary fine-tune queue.
- Setup progress is milestone-based. Server phase, observed range, next check, and safe return time are rendered separately; no fake completion percentage is used for GPU startup.

## Azure deployment evidence

The combined worker was built remotely in ACR run `cu2x` with no local Docker. The accepted immutable image is:

`vyaktivoiceacr.azurecr.io/vyakti/replica-processing@sha256:1a72cbe44822743bde71893201d0b3dd046206d163dea054b82518874564ae25`

ACR reports 386,937,008 compressed bytes. The live Job preserved schedule `*/2 * * * *`, retry limit one, timeout 3,600 seconds, parallelism one, twelve jobs per run, all 21 environment bindings, seven secret references, and 1 CPU / 2 GiB. Manual execution `vyakti-replica-processing-6d022t6` ran the exact digest and succeeded in 26 seconds. The production queue read back 88 complete jobs and zero rows in every non-complete state.

The isolated Hindi runtime was rebuilt in ACR run `cu30` after a first build correctly failed because the shared Cangjie tokenizer asset was absent. The accepted immutable digest is `sha256:9dc374366a6ac9c1d2569e4e824faca12321679e24941e4e345319aca8576b83`, with 9,843,276,760 compressed bytes. The isolated Hindi revision is inactive at zero replicas after evaluation.

The production admission broker was rebuilt in ACR run `cu31` and deployed at immutable digest `sha256:b6786b4d3c99bf6731cc4d0059233f363a910c93406dfa54d3d26fbe4d47b64e`. Its signed `/v1/runtime-status` route checks the private GPU's actual readiness, so a fresh Vercel process cannot keep returning a stale local warming hint after the runtime is ready. The first authenticated status request returned a valid signed `ready:false` while waking a cold runtime. It did not request synthesis.

## Model choice by lane

| Candidate | What current evidence supports | Current decision |
|---|---|---|
| Chatterbox Multilingual V3, general | On the exact current reference, Hindi n=2 ECAPA mean 0.858449; repaired Hinglish n=1 0.825082 at 7.72 seconds | Current Hindi and Hinglish default with identity-anchor. Human listening is still required. |
| Chatterbox Hindi pack | Same reference: Hindi n=2 mean 0.832045; repaired Hinglish n=1 0.826010 at 9.24 seconds | Keep as an evaluation arm. It lost the matched Hindi proxy and did not materially beat repaired Hinglish. |
| IndicF5 normalized | Earlier sealed Hindi pack: ECAPA mean improved from 0.824822 to 0.827428; equation symbol and numeral errors improved; five unchanged controls were byte-identical | Strong Hindi shortlist. It is not an English model, and mixed Hinglish intelligibility remains the main gate. |
| VoxCPM2 | Commercially permissive multilingual candidate; prior ECAPA mean 0.766255 | Keep as a listening/research arm, below the current identity shortlist on the measured pack. |
| Qwen3-TTS 1.7B | Qualified protected English service and six owner-bound English clips | English candidate only. Official language support does not make it the Hindi answer. |
| OpenVoice tone conversion | Exact matched experiment regressed both ECAPA and script-aware WER | Rejected as the default two-stage path. |
| ZONOS2 | Exact 22.02 GiB image and regional pull were verified | Rejected for now: the A100 Container App started without a visible CUDA device, so no synthesis occurred. |

Embedding scores are identity proxies, not naturalness or accent scores. The owner listening pack remains the final choice mechanism.

## PhoneLLM: what to use, and what not to use

The exact audited [PhoneLLM Alpha 1 model card](https://huggingface.co/pipecat-ai/phonellm-alpha-1) revision is `8e76aaa6e8ce4765ac943ba3fb339494d4d48dca`. The public 34-file closure is 63,174,634,906 bytes. The official card describes:

- NVIDIA Nemotron 3 Nano 30B-A3B base;
- 30B total and 3.5B active parameters;
- 262,144-token context;
- full-parameter supervised fine-tuning;
- `temperature=0` and thinking disabled;
- vLLM or SGLang serving;
- English language support;
- BSD-2-Clause modifications plus the underlying NVIDIA Nemotron license and attribution obligations.

PhoneLLM's useful ideas are now part of the executable call research contract: tool-call accuracy, say/do consistency, authentication discipline, escalation discipline, caller outcome, and full-pipeline latency are mandatory metrics. A voice agent that says it completed an action without a valid tool receipt fails.

The official PhoneBench Alpha 1 page reports a 72.3% score, 331 ms P50 and about 600 ms P95 time to first answer token, and an estimated LLM cost of $0.0025 per conversation minute. That benchmark also scores telephone speaking style, factual grounding, conversation coherence, and caller outcome. These values are stored as vendor evidence in the executable manifest so they cannot quietly become Vyakti production claims.

The published sub-100 ms single-request TTFT, sub-600 ms concurrency target, and very low cost use an optimized B200 or Modal workload. They are vendor measurements, not Vyakti Azure measurements. The model card is English-only, the BF16 closure cannot fit the current 16 GiB T4, and the card lists no deployed inference provider. PhoneLLM is therefore an English shadow candidate for Mirror Call, not a production dependency and not a voice-cloning model. Hindi, Hinglish, Indian-English, tool, persona, honesty, latency, and cost gates must all pass on deployed infrastructure before promotion.

## What the owner should expect after release

- A short clean primary recording should progress without another upload if the worker or evidence service is temporarily unavailable.
- Source preparation and VoiceGenome build continue after the tab closes.
- A scale-to-zero preview or call can take roughly two to eight minutes from cold. The page shows the server phase and next check and can be left open or revisited.
- Routine cold starts no longer appear in the database or UI as model failures.
- A ready clip proves the protected delivery path worked. It does not by itself prove the clone sounds right; the owner rating is still required.

## Remaining release gates

1. Lock owner and blinded-listener ratings on the preserved general, Hindi-pack, IndicF5, VoxCPM2, and English samples before naming a perceptual winner.
2. The Vercel ownership gate is complete: owner-only personal membership and personal billing were read back before deployment. The combined release is live.
3. The authenticated production clone path is complete through create, private upload, eight source checks, VoiceGenome draft and protected preview. A real phone microphone journey and a deployed multi-turn Mirror Call canary remain required.
4. Run a direct current-reference Indian-English listening comparison between general Chatterbox and the qualified Qwen English arm.
5. Keep PhoneLLM in an English call-brain shadow lane until deployed multilingual, tool, persona, latency, and cost evidence exists.

## Production canary after release

One fresh production clone used a 480,044-byte, 10-second, 24 kHz mono PCM16 owner reference. The private upload progressed from quarantine to all eight source checks complete and VoiceGenome v1 draft in about 4 minutes 7 seconds without re-upload. The first GPU revision exposed an Azure startup-probe defect: the HTTP probe returned a blank-status failure after Uvicorn reported Chatterbox and PerTh ready. The live runtime now uses a delayed TCP startup/readiness gate on port 8080; the signed broker still checks private `/healthz` before synthesis.

After that infrastructure fix, Azure reported the exact immutable runtime `started=true`, `ready=true`, and zero restarts. The same authenticated preview returned HTTP 200 with a 337,964-byte, 7.04-second, 24 kHz mono protected WAV. The response bound the audible disclosure, general-model commitment, signed Hindi text plan and protected generation receipt. This proves the production path works; owner listening still decides whether likeness is acceptable.
