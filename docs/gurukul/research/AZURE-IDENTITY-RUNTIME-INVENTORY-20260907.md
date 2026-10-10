# Identity runtime inventory

7 September 2026. Read-only Azure Resource Manager GET requests using the
existing OS-protected sign-in. No deployment, provider inference, keys listing,
document upload, Face session or approval test ran.

The current default subscription contains 33 resources, including 17 Container
Apps/jobs and two `AIServices` accounts. The two accounts are
`raghavsharma1729-5391-resource` and `raghavsharma1729-compan-resource`, both in
eastus2 with provisioning state Succeeded. No `Microsoft.Web/sites` resource
was returned. The 17 application names identify the existing voice, evaluation,
processing and audio-protection services. None is named as the identity verifier
or document-review service. None of their current template containers has an
environment setting containing IDENTITY, LIVENESS, DOCUMENT, FACE, VERIFIER or
PRIVATE_SOURCE.

This is evidence that the audited subscription does not currently expose the
expected configured verifier application. It is not proof that no review service
exists elsewhere, that a generic application cannot contain one, or that Face
access was denied. The account metadata returned no relevant capability field
establishing a Face/liveness grant.

Microsoft documents that Face or Foundry Tools resources used for liveness need
the relevant limited-access approval. A general AIServices account or grant
balance does not establish that approval. See [Microsoft's liveness prerequisites](https://learn.microsoft.com/en-us/azure/ai-services/face/how-to/liveness-use-network-isolation)
and [Face limited-access features](https://learn.microsoft.com/en-us/azure/foundry/responsible-ai/computer-vision/limited-access-identity).

Document Intelligence's ID model extracts information using OCR and deep
learning. Its documented role does not establish the independent authenticity
decision required by the current Vyakti broker contract. See [Microsoft's ID model documentation](https://learn.microsoft.com/en-us/azure/ai-services/document-intelligence/prebuilt/id-document?preserve-view=true&view=doc-intel-3.0.0).

Retained machine-readable evidence: `azure-identity-readiness.json` alongside
this report, produced by `azure-identity-readiness.py`. Only safe names,
provisioning states and configuration-presence fields were retained. Source
inspection separately found that the app calls `/v1/liveness/verify`, which the
current verifier service route table does not implement. The source/runtime
contract audits must determine the next implementation before setting flags.

Decision: keep readiness unavailable while closing the actual service/caller
gaps. Reversal condition: a verified configured deployment and fresh-owner trace
demonstrate the independent review, liveness, provider deletion and settlement
path. Do not infer those results from resource names or fixture tests.
