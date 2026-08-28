# Private cited claim extraction

Status: implemented control-plane slice on `voice-cloning`, 2026-08-24. The
first lane accepts reviewed target-speaker transcript evidence only. It is not
yet a general multimodal extractor, and no live Azure request has been made.

## Contract

```text
immutable transcript evidence
  -> accepted target-speaker overlap
  -> direct-identifier redaction
  -> strict structured extraction
  -> server-side citation verification
  -> proposed claims
  -> owner review
  -> deterministic Person Model
```

The route is owner-only and resolves the replica from the bearer session. A
source qualifies only when it declares no third parties, its transcript and
speaker evidence come from non-test adapters, the latest speaker decision is
accepted, target likelihood is at least `0.8`, transcript confidence is at
least `0.55`, and both transcription and training consent remain active.

At most 40 spans and 24,000 characters enter one run. Email addresses, URLs,
phone numbers, Aadhaar/PAN-like identifiers, payment-card-like strings and
credential patterns are replaced with character-preserving masks before the
provider request. The provider never receives owner ids, replica ids, source
ids, storage paths, raw audio or credentials.

## Azure Foundry adapter

The production adapter uses Azure Foundry Model Inference chat completions at
`/models/chat/completions?api-version=2024-05-01-preview` with strict JSON
schema output. The interface follows Microsoft's [Model Inference REST
reference](https://learn.microsoft.com/en-us/rest/api/microsoftfoundry/model-inference/get-chat-completions/get-chat-completions?view=rest-microsoftfoundry-model-inference-2024-05-01-preview)
and [structured outputs guidance](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/structured-outputs).

Configuration is fail-closed:

- `AZURE_FOUNDRY_ENDPOINT` must be HTTPS under `*.services.ai.azure.com`;
- `AZURE_FOUNDRY_CLAIM_MODEL` names the deployed model;
- exactly one credential path is allowed; the current production registry uses
  `AZURE_FOUNDRY_API_KEY`;
- request and response sizes are bounded, the deadline covers the full response
  body, and errors never include provider bodies, transcripts or secrets;
- there is no fake or offline fallback in the production route.

The actual model must support strict structured output for the chosen
deployment. The route now reserves the configured worst-case token cost under
migration 028 before provider I/O and settles only provider-reported usage.
Unknown outcomes retain their reserve and block duplicate charging. Before a
live call, deploy that migration, verify the current model rates and grant
coverage, add the independent Azure budget alerts and operator reconciliation
procedure, then run the consented noisy-Hinglish evaluation set. See
[the paid-provider budget](PROVIDER-BUDGET.md).

## Citation and review invariants

The model output is not trusted merely because it matches a JSON schema. The
server independently rejects unknown fields, unsupported claim domains,
direct identifiers, protected-trait/diagnosis inference, invalid time ranges,
weak entailment and citations that do not resolve to an exact unique quote in
the redacted span. Claim confidence is capped by source confidence and the
weakest citation entailment.

Persistent citation rows contain evidence/source ids, exact character offsets
and a quote hash, but not the quote. Composite foreign keys bind every run,
claim, citation, evidence item and source to one owner and replica. A run is
complete only when every expected citation is present. Repeated identical runs
are idempotent by provider, model, schema and immutable input-set commitment.

Every extracted claim enters as `proposed`. The model cannot create
`self_declared` provenance and cannot approve a claim or build an approved
profile. The owner can accept, reject, exclude or supersede each proposal in
Studio.

## Closed gates

- Verified training consent cannot yet be granted because independent
  liveness/identity verification is not live. Extraction therefore remains
  visibly blocked in production until that gate exists.
- Text, chat, document, image and video claim extraction are not implemented.
  They require modality-specific evidence, third-party/PII handling and the
  same exact citation contract.
- The Azure adapter has been exercised against mocked protocol responses only;
  no quality, privacy, latency or grant-cost claim is made.
- Extracted claims do not yet drive a production dialogue model. They become
  eligible only after owner review and a separately approved Person Model.

Run the offline gate with:

```bash
node evals/replica-claim-extraction/run.mjs
node evals/run.mjs replicaextract
```
