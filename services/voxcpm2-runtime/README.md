# VoxCPM2 isolated evaluation runtime

This is Vyakti's first direct multilingual frontier candidate. It is not wired
into production. The GPU runtime and CPU admission broker use isolated names,
scale from zero to one replica, expire explicitly, and carry a USD 75 hard
workstream tag.

The image pins Apache-2.0 source commit
`f5a1c6a6b901bc732e20f0d59a369f6829ad717a` and public model revision
`32279effe8c19989596f05d353d1447f51d9e915`. Weights are baked anonymously and
runtime access is offline. A Hugging Face token is neither required nor accepted
by the Docker build.

Requests require a body HMAC, timestamp, one-time nonce, localized spoken AI
disclosure, content-addressed reference, consent receipt, replica id and an
explicit identity scope. `verified_owner_identity` requires a self-owner binding.
The provided lecture may use only `third_party_language_stress`, which forces
`release_eligible=false`, `training_allowed=false` and
`identity_claim_allowed=false`.

VoxCPM2 outputs 48 kHz. The evaluation lane records that fact, resamples to the
platform's comparable 24 kHz delivery format, applies PerTh after synthesis and
verifies the detector before returning any bytes. Browser delivery still needs
the independent AudioSeal/C2PA protection envelope.

Build only with Azure ACR Build. Never invoke Docker or Docker Desktop locally.
