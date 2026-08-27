# MOSS-TTS Local v1.5 isolated evaluation runtime

This is Vyakti's second-ranked direct multilingual candidate. It is not wired
into production. It accepts Hindi, mixed-script Hinglish and English, binds the
exact owner or third-party evaluation scope, generates with the upstream
language tag and zero-shot reference path, then applies and verifies PerTh
before returning signed PCM.

The image pins:

- MOSS-TTS Local v1.5 model revision
  `be7766a6735b98bd793f7c79fb720b4d0f5d13b8`;
- MOSS Audio Tokenizer v2 revision
  `f6e20e543b33d2c252a7ef71bdf8aa71e5ff9169`;
- verified upstream source commit
  `58b20a0d5fcc6766658d50967a90a9d890009a46`;
- PyTorch 2.9.1 CUDA 12.8 base image digest
  `sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385`.

Both Hugging Face repositories are public and ungated. A Hugging Face token is
not needed for this candidate and must not be baked into the image. The pinned
repositories contain 17,615,117,536 bytes before the CUDA base and Python
dependencies. The preflight checks every large-file SHA-256, both repository
sizes, the signed source commit, the base image digest and a 30 GiB compressed
build ceiling.

The existing 16 GiB T4 is rejected at startup. The qualification definition is
one private `Standard_NV36ads_A10_v5` Spot VM, no public IP, all inbound denied,
one local-only runtime, a four-hour self-deallocation backstop and daily Azure
shutdown. The transport secret is read from Key Vault into a read-only file and
never appears in cloud-init, an image layer or a container environment value.

Build only with Azure ACR Build. Never invoke Docker or Docker Desktop locally.
Do not build or create the A10 until VoxCPM2's first blind screen closes. Before
that gate, this workstream's permitted spend is USD 0; afterward the Bicep cap
is USD 25. Invoke the private endpoint only through Azure VM Run Command to
`127.0.0.1:8080`, and deallocate the VM immediately after the blind pack.

The Alakh Pandey lecture may enter only as
`third_party_language_stress`. That contract forces `release_eligible=false`,
`training_allowed=false` and `identity_claim_allowed=false`. Owner identity
qualification requires verified self-owner evidence and its consent receipt.

This lane has not built an image, loaded a model, synthesized audio or measured
VRAM, latency, naturalness, pronunciation or likeness. Its 24 GiB fit remains
an explicit qualification question.
