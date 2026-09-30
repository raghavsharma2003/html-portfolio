# Vyakti: the next quality frontier

Founder decision brief. 7 September 2026. India-first expert AI; Hindi, Indian English and Hinglish. This supplements the existing product-direction brief; it is not a market-size study or a comparative acceptance report.

## Direct answer

Keep the expert-first product: the expert supplies knowledge and their manner of explaining, tries the AI, corrects it, then shares a controlled experience with clients. The useful outcome is trusted help in the expert's absence. Voice likeness strengthens that outcome; it cannot compensate for an incorrect answer.

The strongest next investment is closing the loop between source, complete answer, owner correction and measured voice. The present software is not accepted as an end-to-end clone, and there is no evidence yet that it beats any named competitor. A defensible advantage is a hypothesis: reviewed expert knowledge plus reliable bilingual conversation and private client continuity. Validate it with paying expert pilots after the core journey works.

## Three independent acceptance tracks

| Track | What must be demonstrated | Current evidence |
| --- | --- | --- |
| Useful mind | Complete supported answers, honest unknowns, correct language and identifiers | Eighteen real Azure development answers retained. The paired language change failed and stays disabled. |
| Recognizable voice | Owner identity, pronunciation, naturalness and expressive control in each language | Existing models and historical experiments are reusable assets. No current matched owner listening acceptance. |
| Usable product | First-time creator reaches a working, correctable and shareable clone | Phone/desktop phrase-review checks pass. Identity runtime, applied corrections and publication remain incomplete. |

These tracks are complementary. Software gates, embedding similarity and a polished screen are different kinds of evidence.

## What the primary sources change

- **Qwen3-TTS:** the official Base model list includes English but not Hindi. Base cloning consumes reference audio and transcript; embedding-only mode may reduce cloning quality. Keep Qwen as an English evaluation candidate. Hindi and Hinglish remain unsupported experiments. [Qwen official repository](https://github.com/QwenLM/Qwen3-TTS), released 22 January 2026; accessed 7 September.
- **IndicF5:** the card lists eleven Indian languages including Hindi, but not English. Its reference-conditioned path is a useful Hindi candidate; code-switch quality is unproven. [AI4Bharat model card](https://huggingface.co/ai4bharat/IndicF5), 2025; accessed 7 September 2026.
- **Chatterbox:** the current multilingual model lists Hindi and English. Different variants have different language coverage, and reference-language mismatch can affect accent. Evaluate the exact multilingual revision rather than treating all variants alike. [Resemble official README](https://github.com/resemble-ai/chatterbox/blob/master/README.md), living source; accessed 7 September 2026.
- **Fish S2:** its author-run Hindi benchmark reports better speaker similarity than ElevenLabs while reporting worse word error rate. Its naturalness experiment uses an automated evaluator, not the native bilingual owner-listening panel needed here. Those results are informative, not a universal winner. [Fish S2 technical report](https://arxiv.org/html/2603.08823v1), 9 March 2026.
- **Fish S2-Pro:** released weights do not establish T4 deployment performance. The documented serving hardware and commercial licensing need separate checks before adoption. No Fish deployment was attempted here. [Fish model card](https://huggingface.co/fishaudio/s2-pro), March 2026; accessed 7 September.
- **ElevenLabs:** its documented models support Hindi and English. Instant cloning conditions on references; professional cloning fine-tunes. Compare those mechanisms separately with matched speaker data. No ElevenLabs serving path was established within the Azure-only constraint. [Models](https://elevenlabs.io/docs/overview/models) and [cloning overview](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning), living sources; accessed 7 September 2026.

## Azure serving and cost

Azure Container Apps supports A100/T4 serverless GPU profiles with scaling to zero and per-second billing; quota and environment support still matter. Microsoft describes artifact streaming and storage mounts as cold-start improvements. These are engineering options, not measured latency gains for Vyakti. Existing warm/cold failures require an actual trial on the pinned image and model revision. [Microsoft serverless GPU guidance](https://learn.microsoft.com/en-us/azure/container-apps/gpu-serverless-overview), updated 2 May 2026.

Azure Personal Voice and Professional Voice require approved API access and recorded speaker consent. An existing Foundry resource does not establish either approval. Personal Voice documentation describes sentence-level automatic language detection; that alone does not certify natural within-sentence Hinglish. [Microsoft Personal Voice overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview), updated 3 September 2026.

Instrument first-audio client latency, completed-audio latency, network time and service time separately. Streaming and connection reuse can reduce perceived waiting, subject to existing complete-clip disclosure and protection guarantees. [Microsoft latency guidance](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/how-to-lower-speech-synthesis-latency), living source; accessed 7 September 2026.

Cost per accepted session = text inference + transcription + voice compute + cold starts + storage/egress + retries + operational review. Divide by accepted sessions, not generated clips. Measure the cold/warm mix and failure rate before promising margin. The eighteen local Azure answer experiments cost an estimated $0.098317 in the development ledger at configured rates; this excludes voice and infrastructure and is not an invoice or production unit cost.

## The next comparison

Freeze authorized reference recordings, transcripts, exact model/image revisions, held-out text and protection processing. Include Hindi, Indian English, and both directions of within-sentence switching; names, numbers, technical terms and expressive emphasis. Separate reference-conditioned and fine-tuned arms. Retain every output and failure.

Use native bilingual blinded listening for identity, accent, naturalness and intended emphasis; report transcription error and windowed identity similarity separately. Record time to first protected playable audio, completion latency, cold/warm state and cost per accepted minute. No listening sample size or success threshold has been accepted yet: define those before running a final comparison, with a statistical plan appropriate to the decision.

Build order: complete-answer delivery and grounded uncertainty; durable owner correction with source-removal reversal; working identity/enrollment; matched protected voice trials; then a real creator-to-client pilot. The pilot should measure expert time saved, unsupported-answer rate, correction effort, repeat client use and willingness to pay. Pricing and PMF remain hypotheses until observed.

## Limitations and stopping rule

Primary-source review covered two independent lanes: voice mechanisms/evaluations and Azure deployment/latency. Root spot-checked the highest-impact Qwen, Fish and Microsoft claims. No new voice samples, cloud deployments, paid vendor calls or native listening panel ran. Published leaderboards do not answer owner-specific Hinglish quality; more broad searching will not fill that gap. Region-specific prices, subscription access, actual hardware throughput and paying-customer outcomes remain unmeasured. Model cards are living documents; pin versions again before deployment.
