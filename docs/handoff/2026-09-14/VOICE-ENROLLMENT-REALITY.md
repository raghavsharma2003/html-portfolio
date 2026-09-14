# Voice enrollment: implemented parts and actual blockers

Readback date: 2026-09-14. Source audited at `cd580a4f` and checked against
Microsoft's documented Face v1.2 response contract. This is a source and
documentation audit, not a successful live enrollment or likeness result.

The product remains an expert's own AI: feed knowledge, meet and correct it,
then publish an experience for other people. Azure access is working on the
sponsored subscription. Access alone does not make the voice journey ready.

## What can be reused

| Layer | Implemented | Still required |
| --- | --- | --- |
| Text | Azure Foundry conversation/correction and extraction; separately authorized private text rehearsal and material sharing | Walk the real fresh-account creator and visitor journey. Private text permission does not grant voice permission. |
| Official Face ceremony | Create, resume, result, delete and cleanup handlers in `services/azure-verifier/src/liveness.js` | Verify Microsoft access and real provider behavior. Fix the provider response nesting described below. |
| Recording ancestry | `services/voice-evidence/identity_audio.py` derives bounded canonical audio from one hash-bound video | Verify the deployed image supports that operation and align the recorder's duration ceiling with the decoder. |
| Audio evidence | `api/_liveness/azure-shared-audio.js` binds the issued reference, exact locale, spoken challenge, ASR bytes and two version-bound speaker measurements | These measurements do not by themselves prove that the visible person spoke the audio or owns the voice. |
| Processing | Source ingestion, purpose checks, tracked storage writers and erasure/abort controls exist | Deploy the reviewed worker image after a reproducible build and release acceptance. The current image already contains both historical bandwidth fixes but lacks newer controls. |
| Consent and settlement | Issued capture authority, current consent predicates and guarded settlement exist | The actual registry deliberately refuses while the composite evidence producer is missing. Do not turn on readiness to bypass it. |

## The actual missing capability

Azure's hosted Face ceremony captures its own visual evidence. The later
Studio video is a different recording. The documented Face result does not
attest to that later recording's speech, speaker or audiovisual continuity.
Combining the two as separate attributable evidence is valid; labeling them
one verified capture is not supported by this contract.

The current acceptance policy still needs a producer for the later capture's
visible-person binding, association between visible person and audible speech,
continuity/single-speaker evidence, and synthetic-risk decision. No implemented
producer was found. Adding `/v1/liveness/verify` without those measurements
would create a route, not complete verification.

The document review boundary is also incomplete: `services/azure-verifier/src/review.js`
is a signed client. The independent authenticity-review service and operating
process it calls were not found under `services/`. Do not set its approval
flag merely because credentials are available.

## Two immediate source repairs

1. **Face result parsing.** `liveness.js` reads `latest.verifyResult`, but
   Microsoft specifies `latest.result.verifyResult`. Two local fixtures repeat
   the incorrect shape. A provider-shaped regression test must accompany the
   parser correction. This fix does not enable the missing composite verifier.
2. **Capture duration.** `src/studio/LivenessCapture.tsx` stops recording at
   60 seconds; the identity audio decoder accepts at most 30 seconds. Align
   both sides before enabling capture, with a shared contract check.

## Voice models: code present is not measured quality

The ordinary open-voice path uses Chatterbox Multilingual V3, including general
and separate Hindi checkpoint arms and a LoRA loading seam. Separate evaluation
implementations exist for IndicF5 Hindi, Qwen3-TTS English, VoxCPM2 and MOSS-TTS.
Their presence does not establish that a current deployed endpoint is ready,
that a fine-tuned artifact is active, or that the owner's voice sounds similar.

Fresh-user likeness testing through `beginOwnedVoicePreview` still requires
accepted ownership evidence, current consent and a usable reference. Existing
separately authorized research scopes must be inspected individually; a
language-stress receipt is not an owner-likeness or publication certificate.

## External requirements versus engineering work

- Microsoft Face verification/liveness Limited Access approval is distinct
  from Azure sponsorship and ordinary Speech access.
- The independent review process and any deliberate change to enrollment
  acceptance policy need an operator decision with a real implementation.
- The later-capture evidence producer is unfinished engineering/research.
- Personal Voice approval is optional synthesis access. It does not resolve
  enrollment ownership, and an open-ended expert clone must not be assumed
  to fit Microsoft's approved application categories.

Sources checked:

- [Face v1.2 result schema](https://learn.microsoft.com/en-us/rest/api/face/liveness-session-operations/get-liveness-with-verify-session-result?view=rest-face-v1.2)
- [Hosted liveness quick-link ceremony](https://learn.microsoft.com/en-us/azure/ai-services/face/tutorials/liveness-quick-link)
- [Face Limited Access policy](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/computer-vision/limited-access-identity)
- [Speech application restrictions](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/speech-service/text-to-speech/transparency-note)

The next agent should fix and prove the concrete parser/duration defects,
finish the reachable text journey, and resolve the missing evidence design.
Do not spend another cycle searching for an absent Azure key as the sole cause.

## Repair checkpoint later on 2026-09-14

The Face parser repair is integrated in `5abc1773`; nine focused provider-shaped
tests pass. Capture now auto-stops at 25 seconds on both Studio surfaces,
leaving five seconds of scheduling headroom beneath the unchanged 30-second
decoder ceiling. A JavaScript timer is not a hard media-duration guarantee;
oversized captures still refuse on the backend. Ten contract tests pass;
the full native decoder suite was not run here without ffmpeg/ffprobe.

Microsoft's [current Face tutorial](https://learn.microsoft.com/en-us/azure/ai-services/face/tutorials/liveness)
documents model version `2025-05-20`, so that configured pin was retained.
The older REST example's `2024-11-15` alone was insufficient reason to change it.
None of these repairs enables the missing composite evidence producer or
establishes live Face approval, successful enrollment or voice likeness.
