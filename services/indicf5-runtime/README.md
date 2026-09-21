# IndicF5 evaluation runtime

This is an isolated Hindi candidate for Vyakti's blinded owner bake-off. It is
not wired into production routing. The two Azure Container Apps have fixed
names separate from the Chatterbox apps, scale from zero to one replica, carry
an explicit expiry, and require an approved ceiling of USD 40 or less.

The image pins AI4Bharat source commit
`13f7c4d627cc10111aea8fe9c0039462cacacdc7`, gated model revision
`ba85abedf18dc479a447eaa0eccbd76ab78a47d5`, and Vocos revision
`0feb3fdd929bcd6649e0e7c5a688cf7dd012ef21`. Runtime model access is offline.
The Vocos config and weights are baked into `/models/vocos`; startup replaces
the model's default Hub-backed loader with a fail-closed local loader before
the gated model module is imported.

The first remote image predated that explicit local directory. Its immutable
digest already contains both exact snapshots, so `Dockerfile.repair` derives
from that digest, copies the two Vocos files out of the pinned baked cache and
recomputes the manifest commitment. It performs no network fetch and needs no
Hugging Face token. Future clean builds use the primary Dockerfile.
The same startup fence binds the gated model's Hub-style
`checkpoints/vocab.txt` lookup to that file inside `/models/indicf5`; every
other runtime Hub request fails closed.

The pinned upstream inference code estimates duration from UTF-8 byte counts,
which makes Devanagari look roughly three times longer than Latin text. The
runtime binds a receipt-bearing speed normalization to relative bytes per
codepoint, caps predicted generated audio at 30 seconds and restores the model
configuration after every serialized request. This corrects script encoding
inflation; it is not a human-quality claim.
The gated weights are fetched only during an Azure ACR Task with a BuildKit
secret mount. Run `acr-task.yaml` with `--set-secret hfToken=...`; never use a
Docker `ARG`, `ENV`, `--build-arg`, or ACR `--secret-build-arg` for this token.
Docker documents that ARG values may survive in history or provenance, whereas
secret mounts do not persist in the image or its metadata.

Run the task with `services/indicf5-runtime` as its source context. The task's
Dockerfile and every copied path are relative to that bounded directory; using
the repository root is invalid and would also upload unrelated source.

The service refuses a request unless it has all of the following:

- the exact Hindi spoken AI disclosure at the start of the synthesis text;
- the SHA-256 of the exact caller-owned source text;
- the exact `vyakti-indicf5-pronunciation-normalizer/v1` request contract for
  the bounded `chemistry`, `hi-IN`, required-normalization lane;
- a content-addressed 24 kHz, mono, PCM16, 3 through 15 second reference;
- the exact reference transcript and its SHA-256;
- a consent-receipt SHA-256;
- a valid HMAC, timestamp and one-time nonce.

The runtime preserves that source text and hash, then derives a separately
hashed synthesis text with the deterministic pronunciation normalizer before
duration planning and inference. The signed response carries a reconstructable
normalization receipt: exact source spans, per-span hashes, replacements,
coverage counts, synthesis hash and canonical audit hash. A caller can prove
exactly what the model received without the response duplicating either whole
text. A missing contract, mismatched source hash, unsupported rule request or
failed receipt invariant stops the request; there is no silent fallback.

IndicF5 does not produce a native PerTh watermark. This runtime applies PerTh
after synthesis and verifies it before returning audio. The app plane must
still apply Vyakti's independent AudioSeal and provenance envelope before any
browser delivery.

## Qualification prerequisites

The official model is MIT licensed but gated with contact-sharing acceptance.
Anonymous access to the pinned `config.json` remains an expected HTTP 401. The
owner accepted the model conditions and a credentialed exact-revision preflight
printed `INDICF5_ACCESS_READY`. The token is required only as an ephemeral ACR
BuildKit secret and is not a runtime setting.

The Azure service principal is Contributor and cannot create role assignments.
The shared evaluation security anchor at `services/voice-eval-security` instead
creates a dedicated identity and a dedicated access-policy Key Vault containing
one versioned HMAC secret. The identity has only secret `get`; candidate
deployments receive the identity resource id and secret URI. This template
still refuses a plaintext Container App secret fallback.
