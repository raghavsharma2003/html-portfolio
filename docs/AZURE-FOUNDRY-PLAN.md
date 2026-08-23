# Azure Foundry plan: $2,000 hard ceiling

Status: program constraint, researched 2026-08-24. Prices and model availability
must be rechecked in the Azure portal before each deployment. This assumes the
grant is Microsoft for Startups sponsorship credit; a different Azure offer can
have different coverage.

## The decision

Use the grant to build and measure the product, not to train a speech foundation
from scratch. Keep the person model, evidence graph, VoiceGenome, calibration
loop and eval harness owned by Vyakti. Route speech and reasoning through
replaceable providers and bounded self-hosted model experiments.

Startup sponsorship credit covers Foundry models in the **Direct from Azure**
collection. Partner, community and Marketplace models are excluded, including
Anthropic models offered through Azure. The portal's subscription meter is the
final authority.

Primary policy: [Microsoft for Startups Foundry sponsorship coverage](https://learn.microsoft.com/en-us/startups/benefits/technical-benefits/azure-credits/foundry-model-sponsorship-coverage).

## Deployment map

| Need | Initial choice | Region | Product role |
|---|---|---|---|
| Noisy and batch speech recognition | Azure Speech batch/fast STT plus a `gpt-transcribe` challenger | Central India | Diarization/transcript candidates, never the sole truth |
| Person-model reasoning | GPT-5.6 Sol/Terra/Luna, with 5.4 fallback | South India / approved Global Standard | Evidence extraction, structured profile compilation and judged evals |
| Embeddings | `text-embedding-3-large`, small as cost challenger | South India / Global Standard | Text evidence retrieval; never voice identity |
| Duplex benchmark | `gpt-realtime-2.1-mini` | Global Standard from South India | Turn-taking and emotional-interaction benchmark, not cloned output |
| Expressive non-cloned speech | Azure neural/HD/MAI voices | Central India | Studio/product fallback and prosody baseline |
| Low-sample Azure clone | Personal Voice, only after Limited Access approval | Southeast Asia | One voice provider behind the neutral VoiceIdentity contract |
| Open model lab | A10 spot/on-demand sessions | Southeast Asia | VoxCPM2, MOSS-TTS and Chatterbox comparisons; shut down after each run |
| Safety | Azure AI Content Safety plus owned policy classifiers | South India | One signal in a defense-in-depth gate |
| Private artifacts | Azure Blob with private endpoints/SAS, after the Supabase vertical slice | India region selected by data policy | Originals, derived artifacts and erasure lifecycle |

Official references: [Direct from Azure models](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure), [regional model availability](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure-region-availability), [Speech regions](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/regions), [Speech language support](https://learn.microsoft.com/en-us/azure/ai-services/Speech-Service/language-support), [Voice Live](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/voice-live), and [Content Safety](https://learn.microsoft.com/en-us/azure/ai-services/content-safety/overview).

## Budget envelope

| Workstream | Cap |
|---|---:|
| 120 on-demand A10 GPU hours for reproducible open-model inference tests | $500 |
| 500 batch plus 200 fast-transcription hours | $162 |
| Personal Voice profile and synthesis tests, only after approval | $300 |
| 200 full-utilization hours of `gpt-realtime-2.1-mini` evaluation | $360 |
| Person-model extraction, generation and judged evaluations | $169 |
| 100M evidence-embedding tokens | $13 |
| Initial Content Safety corpus | $25 |
| Blob Storage, logs and monitoring | $100 |
| Capacity and pricing reserve | $200 |
| **Maximum planned spend** | **$1,829** |

If Personal Voice access is denied, move its $300 cap to approximately 72 more
on-demand A10 hours. Never use the grant for Professional Custom Neural Voice:
its managed training and always-on hosting can consume or exceed the entire
grant before the product is validated.

Prices were checked with the official [Azure Retail Prices API](https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices). Budget alerts use actual subscription prices, not this planning table.

## Spend controls

Migration 028 and `api/_provider-budget.js` implement the hard application
ceiling for Azure Foundry token calls and Azure Speech fast transcription.
They reserve conservative tokens or per-input, per-second-rounded audio before network
I/O, settle measured usage and retain ambiguous outcomes for manual
reconciliation. The recommended initial application cap is `$1,500`, leaving
`$500` of the grant outside this paid-request ledger for infrastructure and
controlled GPU evaluation. See [the provider budget contract](PROVIDER-BUDGET.md).

1. Create one resource group for the replica lab and tag every resource with
   `program=replica`, `environment`, `experiment_id`, `owner` and `expiry_at`.
2. Set alerts at $250, $750, $1,250, $1,600 and $1,800. The $1,800 alert blocks
   new paid experiments; the reserve is not an experimentation budget.
3. Use pay-as-you-go serverless deployments only. No provisioned throughput,
   no always-on custom-voice endpoint and no Marketplace models.
4. GPU jobs require an `expiry_at`, auto-shutdown and an experiment manifest.
   Record region, image digest, model commit/license, input corpus hash, wall
   time and spend with every result.
5. Keep production and research deployments, keys and quotas separate. Never
   let an offline benchmark consume the live conversation quota.
6. Apply now for Personal Voice Limited Access, GPT-5.6 quota and A10 capacity.
   Lack of approval is a planned branch, not a reason to bypass consent or use
   an uncovered provider.
7. Keep Personal Voice, liveness, watermarking and GPU jobs off
   until each has a native-unit meter under the same atomic ceiling. Portal
   alerts remain an independent backstop, not the application control.
8. Keep Azure Speech live traffic off until migration 028 is deployed, the
   effective resource/SKU hourly rate is configured, the subscription confirms
   grant coverage, and the operator reconciliation drill passes.

## Model acceptance rule

No Azure model becomes the default because it is available or sounds good in a
demo. It must win the owned consented evaluation set on the relevant slice:

- noisy Hinglish/Indic recognition and diarization;
- speaker identity and cross-language retention;
- style, pause, interruption and emotional calibration;
- p50/p95 time to first audio and real-time factor;
- long-horizon autobiographical and relationship consistency;
- hallucination, privacy leakage and policy bypass;
- total cost per accepted conversation minute.

Personal Voice requires a recorded consent statement and Limited Access
approval. See [Personal Voice overview](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/personal-voice-overview) and [limited-access requirements](https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/limited-access).
