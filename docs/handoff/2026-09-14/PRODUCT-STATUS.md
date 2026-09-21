# Vyakti: product and release status

Updated 2026-09-14. Build and test privately first. Public rollout and enrollment
review are deferred. `context/STATE.md` records the exact latest release result;
this page describes the product and the remaining proof.

Accepted private preview: https://vyakti-replica-6uu749yfa-raghav-carbonsettles-projects.vercel.app/studio
Source3bc5857e passed25/25 under Node22/24 and Android debug APK. The actual
landing and sign-in screen are verified; the full signed-in journey is not.

Vyakti turns an expert's knowledge, communication style and voice into an AI
that helps their audience. Its first useful job is answering questions from the
expert's material, showing sources, accepting corrections and remembering each
visitor separately. Teaching is the first vertical. We are building one platform
with creator and visitor experiences, rather than three separate products.

## The journey

1. **Sign in.** Use the account that owns the expert's workspace.
2. **Feed it.** Add material and describe how the expert thinks and communicates.
3. **Meet it.** Ask questions, inspect sources, give corrections and compare voice.
4. **Deploy it.** Share the experience its actual readiness supports. Text-material
   publication and a full voice Room have different requirements.
5. **Improve it.** Review feedback and approve changes. Each visitor's memory
   stays separate and can be inspected or forgotten.

Feed, Meet and Deploy are the three main steps. A saved file, a configured model,
or a passing simulated test must never appear as a finished clone.

## What runs each part

| Job | Current implementation | What remains to prove |
| --- | --- | --- |
| Conversation and correction | Azure Foundry `gpt-5.6-terra`, expected response model `gpt-5.6-terra-2026-07-09` | Complete the real signed-in conversation on the accepted preview. |
| Extraction and memory consolidation | Azure Foundry `gpt-4.1-mini`, with the memory response bound to `gpt-4.1-mini-2025-04-14` | Test actual extraction, useful recall and forgetting against real material. |
| Selected voice lane | Chatterbox Multilingual V3 on Azure, with general and Hindi checkpoint arms | The private CPU service and Hindi broker are deployed, and the retained reference is primed. Connect the Preview configuration, then generate and listen to a real comparison. No fresh likeness measurement exists. |
| Other voice research | IndicF5, Qwen3-TTS, VoxCPM2 and MOSS-TTS code | These are experiments, not evidence of deployed or selected fine-tuned models. |
| HumanOS and EmotionOS | Approved person sheet, communication preferences and prompt compilation | Measure whether answers preserve the expert's style and judgment. These are application components, not separate foundation models or human consciousness. |
| RelationOS and memory | Per-person relationship state, retrieval, consolidation and erasure in the shared engine/database | The post-reply memory caller is implemented; live multi-turn recall and isolation still need verification. |
| Hosting and identity | Vercel web/API, Supabase sign-in, Neon data, Azure storage/model services | Verify the real owner callback and the complete creator-to-visitor journey. |

Azure serving uses the authorized startup-grant subscription. Remaining credit
balance is unknown. The shared text pilot has a configured USD1 cap; this is not
a cap on all Azure resources or proof of profitable unit economics. No permanent
GPU warming is selected.

## Implemented and verified so far

- Vyakti source is separated from Meera, which remains working separately.
- Azure text routing and provider-budget controls are implemented.
- The processing worker's immutable image is deployed and read back.
- Memory configuration is present in Preview and Development. The actual
  post-reply caller is connected in source; preview cron alone is insufficient.
- Private questions support bounded server-owned follow-up history. Two changed
  SQL statements passed live read-only EXPLAIN. Other memory SQL checks and
  database integrity checks are recorded in `context/measurements.md`.
- Browser fixtures cover setup, refresh, corrections, sharing and private voice
  playback at phone and desktop sizes. These use synthetic responses and do
  not prove live model quality.
- The accepted protected baseline is available; newer candidates require their
  own 25/25 Node22 and Node24 gates plus Android success before deployment.

The owner's uploads were not lost. Three saved replicas exist. The retained
voice replica has two audio sources, one ready28.075s and one quarantined, three
audio artifacts, and eight completed processing stages including transcription.
It currently has no Studio knowledge items, teacher sheet, approved person
profile or claims. Existing eligible media should be considered for reuse;
never invent an expert profile or require all material to be uploaded again.

## Remaining work

1. Finish the real signed-in creator/visitor journey on the protected preview.
   The accepted UI is deployed and its source verified. No public cutover is
   authorized for this private phase.
2. Connect the deployed private voice service to a fresh Preview deployment.
   The owner's narrow Hindi GPU grant, CPU service, broker and retained reference
   are verified. Compare a generated sample with the retained reference; collect
   separate likeness, naturalness, pronunciation and responsiveness evidence.
   The GPU remains dormant until the bounded sample run.
3. Complete and test fresh voice enrollment. The private retained-reference
   comparison is not proof that any new expert can finish voice enrollment.
   See `VOICE-ENROLLMENT-REALITY.md` for the evidence-producer gap.
4. Test real knowledge extraction, grounded answers, follow-ups, corrections,
   memory retrieval and forgetting through the product. Owner sign-in and
   genuine expert material are still needed for that live journey.
5. Resume the nine remaining preserved wave-24 patches against current code.
   R182 memory is reconciled and integrated; do not apply its old patch again.
   The others cover RelationOS, reply tuning, sources, sharing, visitor flow,
   voice diagnostics, data controls and mobile/Hindi verification.

No measured result yet establishes competitor superiority, product-market fit,
paid conversion or profitability. The value hypothesis is that experts can
serve more people without repeating the same explanations, while controlling
what their AI says and learns. Prove it with expert task success, blinded voice
comparisons, repeat use and observed serving costs.

## Owner-only inputs

- The personal-device Azure grant is complete and API-verified. No further
  Microsoft sign-in is requested. Never use a personal Microsoft account in a
  browser on this employer laptop; authorized service-principal API access remains
  allowed.
- Sign into the protected Vyakti preview with the account that owns the retained
  clone and supply or select genuine expert material for the Feed and Meet walk.
  Do not paste credentials, tokens or login codes into the handoff.
