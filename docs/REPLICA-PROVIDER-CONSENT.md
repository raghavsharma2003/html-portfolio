# Provider voice-talent consent

Vyakti platform consent and a speech provider's voice-talent consent are two
different capabilities. An account attestation never authorizes Azure Personal
Voice enrollment. The Azure lane requires a second, provider-specific spoken
statement tied to the exact owner, replica, provider, company, locale and
statement hash.

Microsoft's current Personal Voice documentation requires every voice talent to
record the prescribed statement. The spoken first and last name, company and
locale must match the provider request, and the statement language must match
the training language:

- <https://learn.microsoft.com/azure/ai-services/speech-service/personal-voice-create-consent>
- <https://github.com/MicrosoftDocs/azure-ai-docs/blob/main/articles/ai-services/speech-service/personal-voice-create-consent.md>

## Shipping boundary

- Only verified adult self-replicas can issue a challenge.
- Active `capture`, `storage`, `biometric` and `training` receipts under the
  current platform policy are required.
- `AZURE_PERSONAL_VOICE_ENABLED=true` and
  `AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED=true` are both required.
- The first lane pins Microsoft's documented `en-US` statement. Other locales
  fail closed until their official statement is versioned and tested.
- The full name is envelope-encrypted with a dedicated key. Neither the name
  nor statement is persisted as plaintext or written to the audit log.
- The recording accepts only Azure-supported WAV/MP3 media, contains only the
  owner, lives in the private replica bucket and is bound to a ten-minute
  server challenge.
- Provider consent recordings use `capture_mode=provider_consent`; they cannot
  enter either generic source finalization or the normal evidence processing
  DAG.
- Object size and MIME are checked on finalize. Content SHA-256, duration,
  media safety and speaker/statement verification remain pending until the
  enrollment verifier re-downloads and probes the private artifact. An
  `uploaded` row is evidence awaiting verification, not provider approval.

## Secrets

Use an independently rotatable 32-byte key-encryption key:

```text
REPLICA_PROVIDER_CONSENT_KEK_ID=provider-consent-kek-v1
REPLICA_PROVIDER_CONSENT_KEK_B64=<base64 of exactly 32 random bytes>
```

The server also needs the Azure Personal Voice configuration documented in
`docs/AZURE-PERSONAL-VOICE.md`. Never reuse an auth, database, feedback or
candidate-evaluation key for this vault.
