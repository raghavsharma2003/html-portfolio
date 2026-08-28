# Azure identity verifier

This is the deployable, content-minimizing broker behind the platform's
`azure_identity_composite` adapter. It verifies the exact private source bytes,
uses pinned Azure APIs, and returns only bounded proof facts. It never returns
or logs a name, birth date, document number, address, OCR payload, portrait,
face embedding, provider handle, or signed source URL.

It is deliberately not an OCR-as-identity shortcut. A proof has three separate
inputs:

1. Azure Document Intelligence `prebuilt-idDocument` v4.0 extracts the date
   needed for the deterministic adult decision;
2. Azure Face Detect confirms that an image contains exactly one high-quality
   portrait usable by the later live comparison;
3. an independently deployed, HMAC-authenticated review service decides
   document authenticity and currency.

All three remain hard gates in the platform worker. Their scores are never
averaged over a failed boolean decision.

## Run and verify

Node 24 is the only runtime dependency.

```bash
npm test
npm run check
docker build -t vyakti-azure-verifier:local .
```

The tests exercise strict configuration, byte/hash binding, provider/version
binding, independent-review signatures, exact adult boundary dates, PDF and
portrait fail-closed behavior, response minimization, request tampering and
replay. They also exercise the official Azure liveness-with-verify session,
one-time quick-link exchange, sealed provider handles, highest-attempt result
selection, exact verify-image hash binding, model drift, tamper rejection and
explicit provider deletion.

## Production contract

Required environment variables:

```text
VERIFIER_VERSION=<pinned deployment manifest>
VYAKTI_PRIVATE_SOURCE_ORIGIN=https://<project>.supabase.co
VYAKTI_BROKER_HMAC_KEY_B64=<32 random bytes, canonical base64>
AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_DOCUMENT_INTELLIGENCE_KEY=<secret>
AZURE_FACE_ENDPOINT=https://<resource>.cognitiveservices.azure.com
AZURE_FACE_KEY=<secret>
AZURE_DOCUMENT_REVIEW_ENDPOINT=https://<service>.azurecontainerapps.io
AZURE_DOCUMENT_REVIEW_HMAC_KEY_B64=<32 random bytes, canonical base64>
AZURE_DOCUMENT_REVIEW_VERSION=<pinned review manifest>
AZURE_FACE_LIVENESS_ENABLED=false
AZURE_FACE_LIVENESS_ERASURE_ENABLED=false
AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED=false
AZURE_FACE_DEDICATED_RESOURCE=true
AZURE_FACE_LIVENESS_MODEL_VERSION=2025-05-20
AZURE_FACE_VERIFY_CONFIDENCE_THRESHOLD=0.9
AZURE_LIVENESS_SESSION_SEAL_KEY_B64=<separate 32 random bytes, canonical base64>
VYAKTI_PUBLIC_APP_ORIGIN=https://<application-origin>
```

The Bicep parameters `faceResourceDedicated` and
`faceLivenessErasureEnabled` default to `false`. Enabling new sessions fails
deployment unless the erasure plane is also enabled and an operator explicitly
asserts that the Face endpoint is dedicated to this verifier. The template
passes both controls to runtime instead of hardcoding them.

Emergency shutdown is two-phase. Disable `faceLivenessEnabled` to stop all new
sessions while keeping `faceLivenessErasureEnabled=true` until every database
fence and Azure session has reached a provider-confirmed deleted state. Turning
off the erasure plane first is an invalid runbook: it preserves safety by
blocking local finalization, but violates the deletion SLA.

`infra/main.bicep` deploys one scale-to-zero Container App with a maximum of one
replica. That is intentional: the in-memory ten-minute replay fence must not be
split across replicas. It uses a user-assigned identity to resolve secrets from
Key Vault, allows only HTTPS ingress, runs two identity jobs at a time, and
requires an immutable container image digest in production.

## Non-negotiable release blockers

- The review endpoint in this service is a signed boundary, not a built-in
  fraud detector. `AZURE_IDENTITY_REVIEW_PATH_APPROVED` must remain false until
  the independent service and meaningful human escalation path are deployed,
  access-controlled, adversarially tested, and approved.
- A PDF can be extracted but cannot currently produce a live-comparison face
  reference. It therefore returns `face_reference_ready=false` and cannot pass.
- Azure Face Detect accepts image binaries only from 1 KB through 6 MB. Larger
  source images are not silently transformed because the proof must stay bound
  to the exact source digest.
- The broker now implements Azure's official liveness-with-verify session,
  five-minute authorization, single-use quick-link exchange, result retrieval
  and explicit deletion. The platform consumes the contract through a signed,
  fresh, semantically idempotent broker protocol and will not unlock its own
  evidence capture until the Azure result passes and provider deletion is
  confirmed. The existing Studio video recording remains separate evidence
  capture and must never be relabeled as Azure liveness.
- A successful create response, including its one-time link, may exist only in
  this process's volatile retry cache until the earlier of authorization expiry
  or ten minutes. It is never written to logs, a database, blob storage, or a
  durable cache. The short-lived Azure authorization is held only inside the
  AES-GCM sealed provider handle so the broker can regenerate a lost link within
  the remaining session TTL without creating a second biometric session. The
  platform deletes that handle after provider deletion. A dedicated Face
  resource is mandatory so cleanup can enumerate and delete every expired
  orphan after a process crash.
- A handle-less ambiguous create is never retried into another provider session.
  The challenge stays fenced until its issuance lease and provider TTL expire,
  then a successful resource-wide cleanup is required before local erasure can
  advance. This keeps scale-to-zero or deployment restarts from creating an
  untracked duplicate session.
- Session creation and erasure are separate controls. Emergency shutdown can
  reject create, resume and result requests while delete and exhaustive
  dedicated-resource cleanup remain authenticated and available.
- Face liveness is limited access. No deployment may enable the platform flag
  until Microsoft has approved the resource and the end-to-end live session is
  verified in the deployment region.

Raw ID and live media deletion is owned by the platform's durable erasure
workers. Provider logs and Application Insights must keep request/response-body
capture disabled.

Primary API references are the official [quick-link
flow](https://learn.microsoft.com/en-us/azure/ai-services/face/tutorials/liveness-quick-link),
[liveness-with-verify create
operation](https://learn.microsoft.com/en-us/rest/api/face/liveness-session-operations/create-liveness-with-verify-session?view=rest-face-v1.2),
and [result
operation](https://learn.microsoft.com/en-us/rest/api/face/liveness-session-operations/get-liveness-with-verify-session-result?view=rest-face-v1.2).
