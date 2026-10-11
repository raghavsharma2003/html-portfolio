# ZONOS2 isolated evaluation runtime

This is Vyakti's third-ranked direct multilingual candidate. It is not wired
into production. The frozen official model lists English as Tier 1 and Hindi
as Tier 3. It does not provide Hindi text normalization: Devanagari Hindi and
mixed-script Hinglish therefore use the model's raw UTF-8 byte path, while
English uses the supported `en_us` normalizer. Those are capability facts, not
quality claims.

The image pins:

- ZONOS2 model revision
  `65f1e80f94b599d474bb6af9094a803dc52f60bd`, Apache-2.0 model metadata;
- official source commit
  `194c0a3ab67b90383a67646289f28d4ecb1c1f64`, MIT and unsigned;
- Qwen3 speaker encoder revision
  `7577f61c42737fc8064bba773e2a18602df92803`, Apache-2.0;
- Descript DAC 44.1 kHz 8 kbps release 0.0.1, MIT, SHA-256
  `a88eed82a7024ccc1facdb1e605c4c2f99281c8118c22c9895ffa846d8fb61aa`;
- PyTorch 2.9.1 CUDA 12.8 base image digest
  `sha256:7b324d212a4450795b49edba9949b7cdc72429148a64e974334bfe5774d51385`;
- NVIDIA's `cuda-nvcc-12-8=12.8.93-1` package, required because the official
  source JIT-compiles CUDA and NCCL kernels at inference time.

The exact model repository occupies 15,351,094,251 bytes. Its 15,336,390,655
byte checkpoint plus the 24,010,000 byte speaker encoder and 306,717,287 byte
DAC are hash checked during the Azure build. Runtime Hub access is disabled.
The upstream Python lock is used unchanged. The build also verifies that
NVCC 12.8, the C++ compiler and the lock-pinned NCCL library are available;
the exact kernels remain an A10 runtime gate. Never invoke Docker or Docker
Desktop locally; Azure ACR Build is the only build path.

Qualification uses one private `Standard_NV36ads_A10_v5` Spot VM in Southeast
Asia with no public IP and all inbound denied. The runtime binds only to
`127.0.0.1`. A NAT gateway supplies outbound boot access, and an Azure managed
Run Command plus private temporary blobs carries requests and results. The VM
uses a one-day ACR token restricted to `vyakti/zonos2-eval` content/read; no
ACR admin credential is used. The token is stored only in the dedicated eval
vault, removed from Docker after the immutable pull and revoked after the run.
The non-root runtime
gets only an ephemeral executable home and temporary compiler space for the
official JIT kernels; the image and baked model assets remain read-only.
The VM
uses one full 24 GB A10 ([Azure size record](https://learn.microsoft.com/en-us/azure/virtual-machines/sizes/gpu-accelerated/nvadsa10v5-series)) and the measured Southeast Asia Linux
Spot meter of USD 0.768768 per allocated hour; the four-hour GPU maximum is
therefore USD 3.075072 before disk, network, storage and build charges. The VM
has an Azure platform shutdown schedule set within four hours of deployment and
carries a USD 75 experiment ceiling. Deallocate it immediately after the blind
pack.

Only verified self-owner evidence may claim owner identity. Third-party audio
is restricted to `third_party_language_stress`, with training, release and
identity claims all denied by contract. Every output includes the localized
spoken disclosure, applies and detects PerTh after 44.1 to 24 kHz conversion,
and returns a signed receipt binding exact model, source, speaker encoder, DAC,
text, reference, consent or policy scope and measured GPU peak.

No model load, A10 fit, synthesis, latency, naturalness, pronunciation or
speaker likeness is established until the remote qualification actually runs.
