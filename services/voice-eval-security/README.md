# Voice evaluation security anchor

This evaluation-only Azure resource set gives isolated voice candidates one
shared transport boundary without putting an HMAC value in Container App
configuration. It creates a dedicated user-assigned identity, a dedicated Key
Vault and exactly one versioned secret. The identity and the explicitly named
bake-off operator can only `get` secrets from this vault; neither receives key,
certificate, storage or Azure RBAC permissions. Operator access exists only so
the signed blind requests can be generated autonomously and is revoked after
the evaluation window.

The current deployment service principal is Contributor and cannot create role
assignments. This template deliberately uses a Key Vault access policy instead
of weakening candidate templates to accept plaintext Container App secrets.
The HMAC value is a secure deployment parameter, is never an output and is not
written to the repository. Candidate templates receive only the identity
resource id and versioned secret URI. Operator scripts retrieve the value into
process memory and must never write or print it.

These resources are tagged `evaluation_only=true` and with an explicit UTC
expiry. They are not a production trust root. Production should use a
separately administered managed identity and RBAC-scoped Key Vault.
