# Vyakti: product and release status

Updated 2026-09-14. This page separates the intended experience from what has
actually been verified. The current release has not been deployed.

Vyakti lets an expert turn their knowledge, communication style and voice into
an AI that helps their audience. The first useful outcome is answering real
questions from the expert's material, with sources, corrections and continuity
between conversations. Teaching is the first vertical. Creating separate
creator, consumer and business products is not the current release plan.

## The journey

1. **Sign in and agree.** Create an account and set the relevant permissions.
2. **Feed it.** Add knowledge and describe how you think and communicate.
3. **Meet it.** Ask questions, inspect sources, correct answers and test likeness.
4. **Deploy it.** Publish the experience that its actual permissions and readiness
   support. Text-material publication and a full voice Room are different capabilities.
5. **Improve it.** Review feedback and approve changes. Each visitor's memory
   stays separate, with controls to inspect and forget it.

The desired simplicity is three main steps: Feed, Meet, Deploy. Permission and
readiness checks remain behind those steps; they must not create false success.

## What runs each part

| Job | Current implementation | Evidence limit |
| --- | --- | --- |
| Conversation and correction | Azure Foundry `gpt-5.6-terra`, expected response model `gpt-5.6-terra-2026-07-09` | Azure deployment and bindings verified; new release's real user conversation still needs its live walk. |
| Extracting claims from material | Azure Foundry `gpt-4.1-mini` | Configuration exists; extraction quality is not established by configuration. |
| Voice synthesis | Chatterbox Multilingual V3 on Azure, with general and Hindi checkpoint arms | No new owner-likeness result in this wave. |
| Alternative voice experiments | IndicF5, Qwen3-TTS, VoxCPM2 and MOSS-TTS code | Not evidence that these are all deployed, fine-tuned or selected. |
| HumanOS and EmotionOS | Approved person sheet, communication preferences and prompt compilation | These are application components, not separately trained foundation models. |
| RelationOS and memory | Relationship state, per-person memory, retrieval and consolidation in the shared engine and database | Source tests and actual database integrity checks pass; automatic pre-voice memory still has preserved wave-24 work. |
| Product hosting and identity | Vercel web/API, Supabase sign-in, Neon relational data, Azure storage and model services | Email redirect configuration and real fresh-user journey still require verification. |

Azure's sponsored subscription is verified. Remaining credit balance is unknown.
The configured text pilot has a shared $1 cap; that is not a cap on all Azure
resources or a measured per-customer cost.

## What is done, and what remains

Standalone source separation, Azure text routing, memory integrity repairs,
several first-use fixes and reproducible worker packaging are implemented.
Meera remains deployed separately. Focused tests cover specific behaviors;
they are not proof of the full live product.

Before publishing: finish and merge the current first-use batch, pass the full
release gate on unchanged source, verify the Azure worker build, complete the
production cutover, and walk creator and visitor flows against real services.

Fresh voice enrollment has unfinished engineering beyond credentials. The
later Studio capture still lacks the complete evidence producer expected by
the enrollment contract. See `VOICE-ENROLLMENT-REALITY.md`. Face approval is
also unverified. Neither can be replaced with a readiness flag.

The ten wave-24 patches are preserved but not yet integrated. They include
automatic text memory, source management, owner data controls, reply correction,
Room experience, voice diagnostics and mobile/Hindi checks.

No measured basis yet supports competitor superiority, product-market fit,
paid conversion or profitable unit economics. Those require real expert and
visitor usage, blinded voice listening, task-success measurements and observed
serving costs. The value hypothesis is that experts can serve more people
without repeating the same explanation, while retaining control over what
their AI says and learns.
