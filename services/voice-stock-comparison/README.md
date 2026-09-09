# Synthetic stock comparison106

Source-only preparation for six held-out texts, each rendered once by Chatterbox general and VoxCPM2. Two Hindi, two mixed-script Hinglish, two English. Both arms submit the same complete 26.6125-second synthetic Ananya stock WAV. No guessed transcript, crop, owner grant, adapter, training, browser qualification or owner-likeness score. Model conditioning internals differ; equal submitted audio does not imply equal effective acoustic context.

The existing images contain the pinned weights. Offline preparation creates two overlays with the current wrappers, a fixed Python entrypoint, six exact requests, full stock WAV and a hashed manifest. Dockerfiles contain no package installation or model download. Runtime network is disabled through offline model settings and a Python socket guard; this is not a container network firewall. Building and loading these overlays has not been tested on a GPU.

## Prepare and inspect without spending

Run from this checkout, with the existing full stock file and a new output directory:

```powershell
node scripts/prepare-voice-comparison106.mjs --reference <stock.wav> --out <new-scoring-directory>
node scripts/prepare-stock-jobs106.mjs --reference <stock.wav> --out <new-context-directory>
node evals/voice-stock-comparison/run.mjs <stock.wav>
```

Preparation never builds or provisions. `provision-input.disabled.json` deliberately has null overlay digests and environment ID. The reviewer must bind each built overlay digest to its manifest and exact base digest, choose the existing GPU environment/profile, and retain actual build/configuration readbacks. `node scripts/stock-jobs106.mjs plan <completed-provision-input.json>` then prints the disabled plans and ARM deployment templates. No automatic deployment caller exists here.

## Authority and later execution

This is a separate synthetic Manual Job purpose. It does not use the processing161 waiver or relax owner preview routes. The reviewed envelope commits to both immutable Job configurations, manifests, six-text plan and budget admission. `provider_request_sha256` in the existing147 ledger binds that experiment commitment;149/150 bind configuration, allocation window, exact execution template and execution identity. There are no new tables. The fixed job receives only `VYAKTI_GPU_WINDOW_ID`; the baked synthetic policy is not an owner consent receipt. The ephemeral HMAC value satisfies the existing wrapper startup locally and never authorizes HTTP or escapes into receipts.

Later, with separate explicit approval for build/provision/one comparison, fill the disabled envelope with `enabled:true`, `expectedDatabase`, `logAnalyticsWorkspaceId`, exact `observerSourceSha256`, two existing-supervisor `policies`, and `admission` of kind `reviewed-stock-job-admission/v1` with plan hash, approval hash and maximum reservation. Policies require budget ID, current approved microusd/second rate, matching budget limit, approval/configuration hashes and360 seconds headroom. Bind the entire final envelope by the existing controller `commitment()` function. The budget row must already exist and agree with the policy. Source approval is not execution approval.

The CLI accepts `run <envelope.json> <approved-envelope-sha256> <new-journal.jsonl>`. It expects credentials only through `NEON_URL`, `AZURE_ARM_ACCESS_TOKEN`, and `AZURE_LOG_ANALYTICS_ACCESS_TOKEN`; the last token has the Log Analytics audience. Do not put tokens in plan files or command arguments. The runner opens a separate hidden CPU observer before dispatch. A fresh, live, source-bound observer is checked again at the actual ARM start POST. It independently discovers exact experiment windows, records a separate journal, observes/recover/stops through the existing supervisor, survives runner disconnect and retries observation only within one hour. It never retries generation or start. Terminal accounting remains held pending attributable usage.

The runner attempts exact-window cancellation after local failures when it knows a window. The observer handles start ambiguity through durable147/149/150 identity. ARM, database, credentials or the observer host can still become unavailable; unknown state remains unknown and funds remain held. This is bounded operational supervision, not an absolute invoice cap.

After the first Job reaches verified ARM success, the same CLI captures only its exact execution from Log Analytics, then verifies every bounded JSONL chunk, hash, six outputs, policy/model/reference/disclosure/PerTh fields and terminal receipt. Missing, truncated or duplicate artifacts fail closed before the second arm. Only log ingestion is polled (at most12 reads); model generation is never retried. Retained log delivery and the actual KQL query remain unproved until an authorized execution. Collected JSON contains PCM audio and truthful Job provenance, without claiming browser delivery qualification.

## Resource and cost request

Two dedicated Manual Jobs named `vyakti-stock106-chatterbox` and `vyakti-stock106-voxcpm2`, sequential only. Each: one T4,8 vCPU,56GiB, one replica, one completion, retry limit0,900-second runtime timeout. Each allocation reserves900+360=1260 planning seconds. Aggregate reservation is2520 times the freshly verified microusd/second rate, bounded by the reviewed admission and existing ledger limit. No current price was queried or invented. Overlay storage/build and Log Analytics costs need separate review; the script never purchases or provisions them.

## Evidence limits

Offline controls use actual pure runtime validators and explicit CPU fake synthesis. They do not prove GPU startup, image dependency compatibility, deployed KQL parsing, output quality or owner likeness. First actual experiment would produce12 n=1/cell synthetic outputs, to be scored blind descriptively with failures in the denominator. A later owner comparison needs fresh owner permission and independently prepared held-out speech; revoked historical grants remain unusable.
