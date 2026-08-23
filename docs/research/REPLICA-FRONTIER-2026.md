# The human-replica frontier — research cutoff 2026-08-24

This is the research record for the `voice-cloning` branch. The target is not
"a chatbot with a cloned voice." It is a consented, versioned model of one
living person's acoustic identity, delivery, language, biography, behaviour,
and relationships, able to survive a change of the foundation models beneath
it. RelationalOS is the starting asset; the missing work is enrollment,
person-model extraction, voice generation, calibration, and provenance.

Numbers in vendor material are not comparable unless the workload and latency
boundary are identical. Every number below is labelled as a vendor or paper
claim until it is reproduced on our own consented corpus.

## 1. Competitive result

Fish Audio is a serious voice-foundation competitor, not yet a full human-
replica system. Its July 2026 announcement reports a $52M seed, $21M ARR, 8M+
users, 2M+ community voices, and a 22-person team. It says Audio LM and
speech-to-speech are next; its present centre is expressive TTS/STT and agent
infrastructure, not an evidence-backed person model that evolves separately in
each relationship. Source: [Fish Audio funding announcement](https://fish.audio/es/blog/fish-audio-52m-seed-funding/?articleLocale=en).

Fish S2 is nevertheless a mandatory baseline. The technical report describes
a Dual-AR 4B+400M stack, 44.1 kHz output, multi-speaker/multi-turn generation,
natural-language delivery controls, streaming RTF 0.195, and under-100 ms TTFA
on a single H200. The release describes rapid cloning from 10–30 seconds.
Sources: [S2 report](https://arxiv.org/abs/2603.08823),
[official repository](https://github.com/fishaudio/fish-speech), and
[S2 release](https://github.com/fishaudio/fish-speech/releases/tag/v2.0.0-beta).
The hosted product recommends at least ten seconds and, for better coverage,
2–3 clips of 15–20 seconds; it also explicitly recommends quiet input. Source:
[Fish cloning guidance](https://docs.fish.audio/developer-guide/best-practices/voice-cloning).

The immediate competitive set is:

| system | strength we must measure | important limit for this program |
|---|---|---|
| Fish S2.1 cloud / S2-Pro | expressive low-sample cloning, multilingual delivery, inline control | open weights use the Fish Audio Research License; commercial use needs permission; no first-class relational person model |
| ElevenLabs Flash/v3 + PVC | mature cloning and production ecosystem | durable customisation is primarily prompt, variables, KB and transcript history rather than relationship state |
| Cartesia Sonic 3.5 | low-latency streaming and 5–10 s instant-clone path | cloned input noise can survive into output; ZDR is not available for cloning/PVC |
| Resemble Chatterbox | permissive open baseline, fast zero-shot cloning, built-in PerTh watermark | Turbo and multilingual variants have different language/performance envelopes |
| Hume Octave/EVI | affect-aware speech-to-speech and interaction feel | persisted identity is not an evidence-backed, model-portable relationship substrate |
| MiniMax Speech 2.8 | noise controls, multilingual streaming, low-cost clone operation | no documented integrated long-horizon person/relationship model |
| Tavus CVI | strongest turnkey visual conversational-replica baseline | persona/context controls rather than durable, cited relational learning |
| Delphi | knowledge/style ingestion and calibration | expertise/sales clone rather than a high-fidelity, relationship-specific human model |

Primary references:
[ElevenLabs cloning](https://elevenlabs.io/docs/eleven-api/concepts/voice-cloning),
[Cartesia cloning](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices),
[Chatterbox](https://www.resemble.ai/learn/models/chatterbox-turbo),
[Hume cloning](https://dev.hume.ai/docs/voice/voice-cloning),
[MiniMax cloning](https://platform.minimax.io/docs/api-reference/voice-cloning-clone),
[Tavus CVI](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi).

## 2. Open technology — adopt, benchmark, reject

### Adopt as ownable candidates

These have permissive-enough code/model terms for serious evaluation and cover
different parts of the frontier. Adoption here means build an adapter and run
our battery; it does not mean promote one to production without evidence.

- **VoxCPM2** — Apache-2.0, large multilingual training base including Hindi,
  reference voice plus natural-language delivery direction, streaming path.
  [Repository](https://github.com/OpenBMB/VoxCPM).
- **MOSS-TTS** — Apache-2.0 family with multilingual,
  code-switching and controllable flagship work plus a realtime variant.
  [Repository](https://github.com/OpenMOSS/MOSS-TTS).
- **ZONOS2** — MIT, streaming multilingual foundation trained on more than six
  million hours. Hindi is presently a lower-support tier and its text
  normalizer does not establish Hinglish quality, so it is an owned-stack
  candidate rather than an India-first default.
  [Repository](https://github.com/Zyphra/ZONOS2).
- **OmniVoice** — Apache-2.0 omnilingual baseline useful for broad-language
  identity and offline throughput testing.
  [Repository](https://github.com/k2-fsa/OmniVoice).
- **Qwen3-ASR** — Apache-2.0 offline/streaming transcription and forced
  alignment base with Hindi coverage. It is the first ASR/alignment candidate
  for the ingest lab, subject to an owned natural-Hinglish and noise battery.
  [Repository](https://github.com/QwenLM/Qwen3-ASR).
- **Chatterbox** — MIT baseline with Hindi/multilingual variants and PerTh
  watermarking. It is the initial open safety/ownership baseline, not merely a
  voice-quality candidate.
  [Repository](https://github.com/resemble-ai/chatterbox).
- **Qwen3-TTS** and **CosyVoice 3** — Apache research bases for streaming,
  instruction following and evaluation design. Lack of Hindi coverage keeps
  them research candidates rather than the India-first default.
  [Qwen3-TTS](https://github.com/QwenLM/Qwen3-TTS),
  [CosyVoice](https://github.com/FunAudioLLM/CosyVoice).

### Buy and route before training a foundation

Run the same private consented corpus against Fish, Cartesia, ElevenLabs, Hume,
MiniMax, and the open candidates. The voice runtime must select a provider by
measured capability and fail over without changing the person's memory or
behaviour. Training a frontier foundation now is not the high-leverage move:
leaders report hundreds of thousands to millions of training hours. Our first
proprietary data should be noisy enrollment, Hinglish delivery, relationship-
conditioned behaviour, preference corrections, and whole-replica evaluation.

### Benchmark only or reject as the commercial core

- Fish S2 open weights: benchmark, but its research licence is not a default
  commercial foundation. [License](https://github.com/fishaudio/fish-speech/blob/main/LICENSE).
- F5-TTS pretrained weights: useful research lineage, but the common released
  weights' non-commercial terms block a default commercial path.
  [Repository](https://github.com/SWivid/F5-TTS).
- IndexTTS 2.x: technically relevant, but custom restrictions around using
  outputs to improve another commercial AI require counsel before use.
  [Repository](https://github.com/index-tts/index-tts).
- OpenVoice V2: permissive reference baseline, behind the current quality and
  streaming frontier. [Repository](https://github.com/myshell-ai/OpenVoice).
- Seed-VC: useful voice-conversion research, not the primary text-to-speech
  runtime; archived/GPL posture also makes it a poor core dependency.
  [Repository](https://github.com/Plachtaa/seed-vc).

## 3. Noisy enrollment is a research program, not one denoise call

Competitor enrollment flows largely request clean, single-speaker recordings.
Our product requirement is the opposite: voice notes, old videos, calls,
family recordings, WhatsApp exports, room re-recordings, and mixed languages.
The ingest contract is therefore:

```text
immutable encrypted raw source
  -> decode + segment + VAD
  -> diarize and identify candidate target segments
  -> source separation / dereverberation
  -> several enhancement candidates, never one destructive overwrite
  -> ASR + alignment + language/code-switch labels
  -> speaker-consistency and quality scoring
  -> human-auditable selected voice/style bank
```

Raw evidence is never replaced by an enhanced derivative. A process that makes
audio sound cleaner can also change speaker identity; the selector must compare
multiple candidates to the raw source and retain provenance for every segment.
Useful open components to benchmark include
[pyannote.audio](https://github.com/pyannote/pyannote-audio) for diarization,
[Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR) and
[WhisperX](https://github.com/m-bain/whisperX) for transcription/alignment,
[DeepFilterNet](https://github.com/Rikorose/DeepFilterNet) and
[ClearerVoice-Studio](https://github.com/modelscope/ClearerVoice-Studio) for
enhancement/separation, plus more than one speaker-embedding family so a single
encoder is never treated as ground truth.

The live randomized consent recording and noisy historical sources have
different jobs. The live recording proves control and supplies a clean anchor;
historical material expands accent, emotion, pacing, age, context, and style.
No amount of historical data substitutes for present consent and liveness.

## 4. The person model

A replica is seven separately versioned layers:

1. **Acoustic identity** — timbre, accent, age range, stable voice embedding
   ensemble, accepted reference segments.
2. **Delivery distribution** — pitch range, rhythm, pauses, energy, laughter,
   fillers, hesitation, emotion transitions, interruption and repair timing.
3. **Linguistic behaviour** — vocabulary, syntax, code-switching, discourse
   markers, humour shapes, answer length, question habits, topics and taboos.
4. **Autobiographical record** — cited events, facts, chronology, people,
   places, beliefs and uncertainty; source material remains distinguishable
   from inference.
5. **Values and behavioural policy** — choices and boundaries learned through
   evidence and calibration, never inferred from engagement metrics.
6. **Relational state** — a separate record for each person who interacts with
   the replica: shared episodes, register, trust, rupture/repair, phrases,
   rituals, texture and disclosure permissions. This is RelationalOS.
7. **Multimodal identity** — visual appearance/gesture/gaze and perception of
   shared media, all driven by the same identity and relationship state rather
   than by an unrelated avatar prompt.

These layers must not collapse into one prose persona. The existing repo has
already measured that sentence-shaped prompt material becomes a phrase bank,
and that a model swap moves personality. Each layer therefore needs structured
data, provenance, its own evaluator, and a versioned compiler adapter.

## 5. Evaluation — the whole replica, not a demo clip

The initial battery has six independent verdicts:

| family | measures |
|---|---|
| voice identity | human ABX/SMOS, multiple speaker encoders, identity stability across text/emotion/language/noise |
| speech quality | WER/CER/MER, intelligibility, naturalness, clipping/artifacts, p50/p95 TTFA, RTF |
| delivery | pitch/rhythm/pause distributions, emotion and instruction adherence, laughter/breath/filler behaviour |
| behaviour | idiolect/style distance, scenario choices, values/boundaries, correction preference, contradiction rate |
| memory/relationship | recall@k, citation precision, temporal consistency, appropriate-not-maximum recall, privacy leakage, rupture/repair and register |
| safety/provenance | enrollment spoofing, prohibited-use block rate, watermark robustness, disclosure presence, revocation and deletion completeness |

External suites are inputs, not acceptance criteria. Adopt pieces from
Seed-TTS evaluation, CV3-Eval, EmergentTTS-Eval, ASVspoof, LongMemEval/BEAM,
persona consistency batteries, and this repo's existing D-battery. The owned
suite must add Hinglish/code-switching, severe noise, multi-speaker sources,
relationship-conditioned delivery, long calls, and model/provider swaps.

### 5.1 Speech architecture we should reuse

Current frontier speech generators mostly fall into two useful families.

**Codec language models** compress audio into low-rate semantic/acoustic codes,
predict a semantic or first-codebook stream with a large causal model, expand
the remaining acoustic codebooks with smaller fast heads, and decode causally.
Fish S2, Qwen3-TTS, CosyVoice and MOSS provide variations of this recipe. It is
the likely owned architecture for hard realtime because the semantic plan and
acoustic detail can run at different rates.

**Flow/diffusion generators** such as F5-TTS and VoxCPM can produce excellent
high-quality speech and editing from an acoustic prompt. They are valuable for
batch rendering, calibration and dubbing; hard causal latency must be measured
rather than assumed. An eventual owned model should keep speaker/timbre,
linguistic content, prosody/style state and acoustic detail separable. Jointly
entangling them makes corrections and revocation harder.

The hosted launch adapter accepts one semantic request rather than provider
tags:

```text
text + word/span language ids + speech act + style vector
+ target duration + pronunciation overrides + prior acoustic context
+ VoiceGenome/profile version + latency/quality tier
```

Adapters translate that request into Fish inline controls, VoxCPM directions,
Chatterbox exaggeration or another provider's native representation. The
benchmark stores the translation version with the output so a provider change
cannot silently alter the person.

### 5.2 Full duplex: reuse the interaction research, keep our person model

The strongest open research bases for simultaneous listening and speaking are:

- [Moshi](https://github.com/kyutai-labs/moshi), a dual-stream spoken language
  model over a streaming codec with concurrent user/agent audio and a textual
  inner stream;
- [PersonaPlex](https://github.com/NVIDIA/personaplex), which adds text-role and
  audio-voice prompts and learns turn-taking, interruption, backchannel and
  pause behaviour, but is presently an English-centric research base;
- [MiniCPM-o](https://github.com/OpenBMB/MiniCPM-V), an Apache multimodal
  reference for simultaneous audio/video perception and speech output, with
  current speech-language limits that make it a benchmark rather than the
  Hinglish production lane;
- [NVIDIA VoiceChat](https://huggingface.co/nvidia/NVIDIA-NemotronLabs-VoiceChat-11B),
  a useful 2026 full-duplex/tool-use latency benchmark, not a personalized
  voice foundation.

The reusable insight is an acoustic floor controller that understands overlap,
backchannels, pauses and interruptions. We should not give it ownership of the
person. The target hybrid is:

```text
duplex acoustic listener / floor controller
  -> streaming ASR + affect/audio events
  -> cited person + relationship brain + tools
  -> incremental speech-act/prosody plan
  -> dedicated clone renderer
```

That preserves arbitrary voice identity, Hinglish, source citations, provider
portability and policy decisions. The current repository's measured cascade
audio floor remains the production baseline until a candidate passes the same
barge-in and continuity battery.

### 5.3 Memory and multimodal projects worth incorporating

The repository's existing RelationalOS is already richer than a generic vector
store: it separates people from agents and keeps relationship facts, episodes,
patterns, phrases, rituals, texture, trust and rupture/repair at
`(agent, person)`. Open projects contribute components, not a replacement:

- [Graphiti](https://github.com/getzep/graphiti) provides an Apache-2 temporal
  graph reference with episodic/entity/semantic structures, bi-temporal facts,
  incremental updates and entity resolution.
- [Mem0](https://github.com/mem0ai/mem0) is a useful extraction, entity-linking,
  hybrid retrieval and update-policy reference; hosted benchmark gains must be
  reproduced locally rather than imported as fact.
- [Letta/MemGPT](https://github.com/letta-ai/letta) provides a clean reference
  for bounded active memory plus explicit archival memory management.
- [BGE-M3](https://github.com/FlagOpen/FlagEmbedding) is a permissive 100+
  language dense+sparse+multi-vector text retriever suitable for Hinglish
  experiments.
- [Qwen3-VL-Embedding](https://github.com/QwenLM/Qwen3-VL-Embedding),
  [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni) and
  [PersonaVLM](https://github.com/MiG-NJU/PersonaVLM) are multimodal retrieval,
  long audio/video understanding and personalized-VLM references. Their listed
  language coverage does not make them sole Hindi truth; captions, lexical
  search and multilingual text retrieval remain parallel legs.

The merged schema is source-first:

```text
SourceAsset -> Observation/span -> Claim or Episode
                            \-> VoiceStylePrototype

Claim: subject/predicate/object + evidence + confidence
       + valid time + ingestion time + contradiction/supersession

TraitHypothesis: tendency + evidence + counterexamples
                 (never silently promoted to biography)
```

At inference we resolve the interlocutor and relationship, retrieve by time,
entity, lexical/dense similarity and relationship, traverse relevant event
edges, rerank source spans, distinguish fact/self-statement/third-party claim/
inference/unknown, then create separate content and delivery plans. This is the
mechanism that prevents a model interpretation from becoming autobiographical
truth on its second retrieval.

### 5.4 Personality and behaviour research worth incorporating

- [Generative Agents](https://github.com/StanfordHCI/genagents) contributes the
  memory-stream, reflection and planning pattern.
- [Character-LLM](https://github.com/choosewhatulike/trainable-agents)
  contributes a profile-to-scenes-to-training-data recipe; synthetic scenes are
  useful exercises but can never become facts about a real subject.
- [PersonaGym](https://personagym.com/) separates linguistic habits, action,
  action justification, consistency and toxicity control.
- [PersonaMem](https://github.com/bowen-upenn/PersonaMem),
  [LoCoMo](https://github.com/snap-research/LoCoMo) and
  [LongMemEval](https://github.com/xiaowu0162/LongMemEval) contribute evolving
  profiles, multi-session temporal tests and long-horizon recall batteries.

The adaptation order should be evidence-linked profile/retrieval, owner edits,
relationship calibration, situation-matched examples, blinded preference
pairs, and only then a behaviour LoRA/SFT when held-out interaction data proves
it helps. Voice and behaviour adapters remain separate: long audio provides
abundant timbre evidence but weak evidence about how the human would decide in
an unseen situation.

### 5.5 India-first benchmark

A language checkbox does not measure Hinglish. The owned corpus must include
Roman Hindi, Devanagari, Indian English and intra-sentence switches under clean
studio, mobile, WhatsApp compression, reverb, traffic, television and overlap.
The frontend preserves text, span-level language ids, pronunciation overrides,
names, numbers, currency and code-switch boundaries. Prefer one continuous
utterance; stitching Hindi and English renderers usually damages cadence and
identity.

Measure mixed error rate, several speaker encoders, native-speaker ABX/SMOS,
accent authenticity, delivery, identity across language switches, p50/p95/p99
India-region turn-to-first-audio and renderer TTFA separately. This repository
already learned the expensive lesson: better Hindi pronunciation can still
sound like the wrong person. Accent identity is a first-class verdict.

## 6. Consent, provenance, and launch boundary

Initial launch is restricted to a verified, living adult cloning themself.
Public figures, politicians, minors, deceased people, third-party cloning,
public voice libraries, downloadable weights, bulk generation, outbound calls,
financial/OTP/account-recovery use, election use, and sexual impersonation are
blocked until separate programs prove them safe and lawful.

This is not optional caution. India's amended IT Rules effective 2026-02-20
expressly cover voice cloning and require prominent synthetic labeling,
including an immediate audible disclosure for audio, plus durable provenance
to the extent feasible. Source: [MeitY amendment](https://www.meity.gov.in/static/uploads/2026/02/f55fe52418b03f58b0669f6a8bc03b6d.pdf).
EU AI Act Article 50 transparency duties have applied since 2026-08-02 and
require human disclosure and robust machine-readable marking. Source:
[EU AI Act](https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX%3A02024R1689-20260727).

Every generated artifact therefore carries:

- an immediate human disclosure appropriate to the surface;
- a robust audio watermark with a per-output token;
- a signed [C2PA 2.4](https://spec.c2pa.org/specifications/specifications/2.4/index.html)
  manifest containing provider/model version, pseudonymous replica id, output
  id, timestamp, consent authorization reference, policy version and allowed
  use;
- an immutable content-free generation audit record;
- a public verifier that reveals provenance without revealing the human's
  identity.

The first open watermark baseline is
[AudioSeal](https://github.com/facebookresearch/audioseal), which has a
streaming-compatible MIT implementation and localized detection. Chatterbox's
[PerTh](https://github.com/resemble-ai/Perth) is a second implementation to
attack-test. Neither replaces the signed generation ledger: a watermark token
is deliberately small, and absence of detection is not proof that media is
human.

Consent is granular across capture, transcription, biometric derivation,
training, inference, storage, sharing, API, telephony, and model improvement.
Model improvement is off by default. Revocation disables generation quickly;
deletion covers raw sources, derivatives, transcripts, embeddings, adapters,
memory, caches and every processor copy. Exported files cannot be recalled, so
provenance and complaint response remain necessary after deletion.

## 7. Research conclusion

The voice foundation is increasingly commoditized; a full person is not. The
defensible system is the consented dataset, noisy-source recovery, VoiceGenome,
behavioural preference history, evidence-backed autobiographical model,
RelationalOS state, provider portability, and the battery that can reject a
replica that sounds impressive but is not the person.

The first build therefore creates the data and evaluation spine before choosing
a permanent voice provider. A provider can be swapped. An uncited biography,
invalid consent chain, or baked-in person cannot.
