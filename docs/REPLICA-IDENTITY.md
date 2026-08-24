# Replica identity and adult evidence

Status: the owner control plane, private evidence ledger, crash-safe verifier,
Azure broker boundary, erasure path and Studio workflow are implemented. The
production Azure composite verifier, document-fraud review path and Azure Face
liveness client are still release blockers. No deployment may set the approval
flags merely to bypass those dependencies.

## Trust sequence

Identity proofing is deliberately split into two independent stages:

1. a current government ID is checked for document authenticity, adult age and
   a usable face reference;
2. an official live-face flow compares the present user to that exact reference
   while the randomized voice challenge is spoken.

The first stage sets only adult evidence. It does not set identity or liveness.
Only a pass across the second composite stage can set `identity_verified_at` and
`liveness_verified_at` together. This removes the previous circular dependency
where identity was required before the identity comparison could run.

OCR output is extraction, not proof. Facial age estimation is never used. The
identity verifier must return independent document-authenticity evidence, a
deterministic 18+ decision from the document date of birth, current document
validity, and a high-quality portrait/reference decision. Every gate is
mandatory; scores are never averaged over a failed decision.

## Data minimization

The raw JPEG, PNG or PDF enters the private source vault under an opaque
server-selected path only for verification. After the live comparison passes,
both the document and live capture are queued for durable erasure and the proof
row is detached from the source. The surviving proof contains only its SHA-256,
bounded booleans, scores, expiry, policy/model versions and an evidence digest.
It never keeps the person's name, date of birth, document number, address, OCR
text, portrait bytes, face embedding, provider handle or signed media URL.
Rejected documents are queued for erasure immediately. Submitted, retrying,
failed, or evidence-ready cases that do not complete their live binding within
24 hours expire and enter the same durable erasure path.

The owner must affirm five exact statements: the ID is theirs, contains only
them, is used only for identity/adult proofing, is excluded from training, and
will be erased after verification or withdrawal. The stored receipt is a
randomized one-way commitment. It is not a substitute for the later biometric
consent bound to a live pass.

Deleting the ID, deleting its live challenge, withdrawing capture/storage or
biometric permission, or revoking the identity case immediately clears the
derived gates. Private source deletion then runs through the durable erasure
worker. Identity rows are removed before the restrictive source foreign key is
unlinked, and any linked challenge source is independently queued for erasure.

## Azure deployment boundary

The platform adapter sends a two-minute signed read capability and exact source
hash to one allowlisted Azure Container Apps or App Service endpoint. Request
and response bodies are HMAC-authenticated; wrong request IDs, hashes, model
versions, signatures, origins, oversized responses or redirects fail closed.

The Azure-hosted verifier should use Document Intelligence `prebuilt-idDocument`
v4.0 (`2024-11-30`) for extraction, but it must not translate OCR confidence
into authenticity. It needs an approved document-fraud/manual-review path and a
usable ID portrait for Azure Face liveness-with-verify. Microsoft recommends
meaningful human review for face-recognition decisions and explicitly advises
against facial age inference. India support must be reviewed against applicable
ID-specific retention rules before any document type is enabled.

Required configuration:

```text
REPLICA_IDENTITY_VERIFIER=azure_identity_composite
AZURE_COMPOSITE_IDENTITY_ENABLED=true
AZURE_IDENTITY_REVIEW_PATH_APPROVED=true
AZURE_COMPOSITE_IDENTITY_ENDPOINT=https://<service>.azurecontainerapps.io/v1/identity/verify
AZURE_COMPOSITE_IDENTITY_HMAC_KEY_B64=<32 random bytes, base64>
AZURE_COMPOSITE_IDENTITY_VERSION=<pinned extraction+fraud+review manifest>
CRON_SECRET=<strong scheduler bearer secret>
```

Primary references:

- [Azure Document Intelligence identity-document model](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/id-document?view=doc-intel-4.0.0)
- [Document Intelligence Analyze Document REST API](https://learn.microsoft.com/en-us/rest/api/aiservices/document-models/analyze-document?view=rest-aiservices-v4.0+%282024-11-30%29)
- [Azure Face liveness with verification](https://learn.microsoft.com/en-us/azure/ai-services/face/tutorials/liveness)
- [Azure Face characteristics and human-review guidance](https://learn.microsoft.com/en-in/azure/foundry/responsible-ai/face/characteristics-and-limitations?view=foundry-classic)
- [Microsoft Face transparency note](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/face/transparency-note)

Offline gate:

```bash
node evals/run.mjs identityproof
```
