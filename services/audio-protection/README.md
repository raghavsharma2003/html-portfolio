# Private audio-protection service

This service is the only production path from disclosed replica PCM to
deliverable audio. It embeds the official AudioSeal 0.2 streaming watermark,
creates an external C2PA sidecar with the official Python SDK, and delegates
ES256 signatures to a non-exportable Azure Key Vault key.

It is intentionally fail-closed: startup fails without CUDA, a Key Vault key,
the public certificate chain, an HTTPS public manifest origin, or a 32-byte
transport secret. Requests and responses are content-hash-bound and HMAC
authenticated. Access logs are disabled and the service must have no public
ingress.

Required configuration:

- `AZURE_AUDIO_PROTECTION_HMAC_SECRET`
- `AZURE_KEY_VAULT_KEY_ID`
- `C2PA_SIGN_CERTIFICATE_B64`
- `PUBLIC_APP_ORIGIN`

Production deployment uses one GPU worker per replica, scale-to-zero, managed
identity with Key Vault `sign` permission only, and an internal origin accepted
only from the application service. This first corridor buffers one protected
owner preview per request so no bytes escape before every protection artifact
is complete. Duplex calls require a separately qualified streaming deployment.

