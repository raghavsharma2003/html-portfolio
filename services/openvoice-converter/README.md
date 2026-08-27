# OpenVoice V2 tone-color evaluation candidate

This isolated research arm separates two jobs that the current Chatterbox path
asks one model to solve:

1. IndicF5 or Sarvam produces native Hindi or Hinglish phonology, rhythm and
   the spoken AI disclosure.
2. OpenVoice V2 converts that base clip toward the verified owner's tone color.
3. The runtime applies and verifies PerTh after conversion. The app plane must
   still add its independent AudioSeal and provenance envelope before delivery.

It is not production routing and it has no quality claim. OpenVoice's own
maintainers describe the converter as tone-color conversion, not accent or
intonation transfer. The base model remains responsible for Indian delivery,
and conversion can still reduce intelligibility, naturalness or likeness.

## What is cryptographically bound

Every signed response contains a content-addressed conversion receipt binding:

- base provider, model, model commitment, generation receipt, transcript and
  exact PCM;
- owner and reference-subject equality, consent receipt and exact reference
  WAV;
- OpenVoice source commit, official model revision, checkpoint and config
  hashes, converter commitment and tau;
- pre-PerTh converted PCM and final PerTh-verified PCM.

The runtime accepts only a 3 through 15 second 24 kHz mono PCM16 owner reference.
The caller must identify the owner and reference subject with the same UUID.
Synthetic fixtures are contract-test inputs only and are disabled in the Azure
template. Do not use the third-party lecture as an identity reference.

## Supply chain and isolation

The source is pinned to `myshell-ai/OpenVoice` commit
`74a1d147b17a8c3092dd5430504bd83ef6c7eb23`. The public official
`myshell-ai/OpenVoiceV2` snapshot is pinned to
`fd981100305a0e4291f93a9ad169c6d9f7bed54a`; its converter checkpoint and
config hashes are rechecked during the remote build and again at startup.
Runtime Hugging Face access is offline. This public snapshot needs no owner
credential, so the Hugging Face password shared in chat is not used or stored.

`acr-task.yaml` is for an Azure remote build. It does not require or invoke the
laptop's Docker daemon. The Bicep resources have names distinct from production,
private GPU ingress, public signed admission, `minReplicas: 0`, `maxReplicas: 1`,
an explicit expiry and a USD 40 parameter ceiling. A stale external signature
is never forwarded after a cold start: the broker wakes the private health
endpoint first, then signs a fresh internal request only after it is ready.

## Qualification gate

Run the registered offline contract suite first:

```text
node evals/run.mjs openvoiceconverter
```

After IndicF5 access or an authorized Sarvam base is available, generate matched
base clips and convert only with verified owner audio. Promotion requires a
blinded owner ABX against the unconverted base and current best clone, plus
Hindi intelligibility, speaker similarity, naturalness, PerTh detection and
latency. A successful build or valid receipt is not evidence of likeness.
