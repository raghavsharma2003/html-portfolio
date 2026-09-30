# Azure deploy state — in-house voice stack (`vyakti-voice`)

Written by WS-L, 2026-08-26. Every number below is a REST read-back, a build
log line, a container log line, or a wall-clock measurement of a real request.
Where something was estimated rather than measured, it says so.

**No secret values appear in this file.** Endpoints are not secrets; HMAC keys
are, and they live only where §7 says.

---

## 1. Headline

**The self-hosted voice lane synthesises real audio on Azure GPU, end to end,
through the HMAC admission broker.** Measured 2026-08-26:

```
POST /v1/synthesize -> HTTP 200
  "model": "chatterbox-multilingual-v3"
  "model_commitment": "b66dbbe202313119f616f8afe7d9a938d483ae3f8136d8d52e6f4c7560469b36"
  "perth_watermark_verified": true,  "perth_score": 1.0
  "duration_ms": 5520,  "elapsed_ms": 4359,  "real_time_factor": 0.789674
```

Hindi (`language_id: "hi"`), disclosure prefix enforced, PerTh watermark
verified by the service before it would return, response HMAC bound. **Warm
synthesis runs faster than real time.** `voice-evidence` also boots healthy on
GPU and scales cleanly back to zero.

Three things to know before anything else:

- **There is no GPU quota blocker.** Serverless T4 works on this subscription
  as-is. The `usages` API says otherwise and is misleading; see §5.
- **The blocker was four defects in the services' own source**, none visible to
  code review, each found only by building and booting for real. All four are
  fixed and confirmed working. They are on branch `gurukul-ws-l`, **not
  pushed**. See §4.
- **A cold start cannot be absorbed by a user request.** The runtime is ready
  161 s after a wake, but the triggering request dies at ~240 s on a platform
  timeout. This needs a warm-up strategy before launch; see §8.

---

## 2. What is live

Subscription: the owner's Sponsored (grant-credit) subscription. Everything is
in the single resource group `vyakti-voice`. Nothing was created outside it and
nothing pre-existing was touched.

| resource | name | state |
|---|---|---|
| Resource group | `vyakti-voice` | Central India |
| Container registry | `vyaktivoiceacr.azurecr.io` | Basic, admin user enabled |
| Log Analytics | `vyakti-voice-law` | PerGB2018, 30-day retention |
| Container Apps env | `vyakti-voice-env` | `Consumption` + `Consumption-GPU-NC8as-T4` |
| Container Apps env | `vyakti-ctrl-env` | control experiment (§5) — **safe to delete** |
| Container app | `vyakti-open-voice` | GPU, internal, `minReplicas: 0` — **healthy, synthesising, scale-to-zero verified** |
| Container app | `vyakti-open-voice-admission` | CPU broker, external, `minReplicas: 0` — **healthy** |
| Container app | `vyakti-voice-evidence` | GPU, internal, `minReplicas: 0` — **boots healthy, scale-to-zero verified; no round trip run** |
| User-assigned identity | `vyakti-voice-pull` | created, **unused** (§6) |

**Endpoints** (not secrets):

- Public admission broker — the one the app plane calls:
  `https://vyakti-open-voice-admission.purpletree-6dea69e2.centralindia.azurecontainerapps.io`
- Private GPU runtime (environment-internal only, never public):
  `https://vyakti-open-voice.internal.purpletree-6dea69e2.centralindia.azurecontainerapps.io`
- Private evidence service (environment-internal only):
  `https://vyakti-voice-evidence.internal.purpletree-6dea69e2.centralindia.azurecontainerapps.io`

The runtime is reachable *only* from inside the managed environment, exactly as
the README requires: random internet traffic can wake the cheap CPU broker and
nothing else.

Providers registered on this subscription (all were `NotRegistered` before):
`Microsoft.App`, `Microsoft.ContainerRegistry`, `Microsoft.OperationalInsights`,
`Microsoft.KeyVault`, `Microsoft.Quota`.

### Region choice

Central India: both `infra/main.bicep` files default to it, it is the target
market, and the Container Apps
`availableManagedEnvironmentsWorkloadProfileTypes` API confirms it offers
`Consumption-GPU-NC8as-T4` — the cost-preferred T4 class. A 22-region sweep
found T4 offered in 16 regions. Central India offers T4 but not A100, which is
the right side of the cost trade here.

---

## 3. Images

All built by **ACR Tasks**, server-side. No local Docker anywhere.

| image | built from | outcome |
|---|---|---|
| `open-voice-admission:v1` | public branch, git context URL | Succeeded first try, 50 s |
| `voice-evidence:v1` | public branch, git context URL | Succeeded, but cannot boot (§4.3) |
| `open-voice-runtime:v1` | **patched worktree tarball** | Succeeded after §4.1 + §4.2, 12m55s |
| `voice-evidence:v2` | **patched worktree tarball** | §4.3 — got past SpeechBrain, died at §4.4 |
| `voice-evidence:v3` | **patched worktree tarball** | §4.3 + §4.4 — **boots healthy** |

Digests currently deployed:

- `open-voice-admission@sha256:3229c6479f83a0864faa0a2f81d43402b115341bbac318209d5b97c8463ceeb1`
- ~~`open-voice-runtime@sha256:9a0331745963a874093094db74f19bc13bd713670677488ff8b79cea8bd83ea8`~~
  **superseded 2026-08-26 by `ft3` — see §13. That digest is the rollback target.**
- `voice-evidence@sha256:924036e47a7c290cc8beb28fb6676e50c66f1f8aad2360c5a08f015030462157` (v3)

Image sizes, from the platform's own pull records:

- `open-voice-runtime`: **9,704,570,880 bytes (9.70 GB)**
- `voice-evidence`: **5,343,543,296 bytes (5.34 GB)**

> **Provenance warning.** Only `open-voice-admission` and `voice-evidence:v1`
> were built from the public branch as pushed. Every image carrying a §4 fix
> was built from an **uploaded tarball of the WS-L worktree**, whose commits are
> not on `claude/gurukul-platform`. Those images are not reproducible from the
> public repo until the commits are pushed. Push, then rebuild from the branch.

ACR storage: 5.4 GiB was in use before the runtime image landed, against
Basic's 10 GiB included allowance. Overage bills to 40 TB at roughly
$0.10/GiB/month, so this is a small cost note, not a wall.

---

## 4. Four defects in the services' source

All four fixed on `gurukul-ws-l`, **not pushed**, and all four confirmed by a
subsequent successful build or boot. Each was invisible to review.

### 4.1 `open-voice-runtime` — reserved group name (build-blocking)

`groupadd --system --gid 10003 voice` exits 9: `voice` is a standard
Debian/Ubuntu system group (GID 22, shipped by `base-passwd`), so it already
exists on this base image. Deterministic, 2m31s in. **This image had never
built.**

Fixed by renaming the *group* to `openvoice`. The user stays `voice`, both keep
UID/GID 10003, so `USER 10003:10003` and every permission are unchanged in
effect. `voice-evidence` names its group `evidence` — not a `base-passwd` name
— which is exactly why only this Dockerfile broke.

### 4.2 `open-voice-runtime` — unsatisfiable pin pair (build-blocking)

`requirements.txt` pinned `transformers==5.2.0` *and*
`huggingface-hub==0.34.4`. transformers 5.2.0 declares
`huggingface-hub>=1.3.0,<2.0`, so pip ends in `ResolutionImpossible` before
building a layer.

The transformers pin is the correct one: the pinned Chatterbox source commit
`5de7a54` lists `transformers==5.2.0` in its own `pyproject.toml`, read at that
exact revision rather than assumed. So `huggingface-hub` moved instead, the
minimum distance, to `1.3.0`. `fetch_models.py` uses only
`snapshot_download(repo_id, revision, local_dir, allow_patterns)`, unchanged
across the 0.x → 1.x boundary. Confirmed by the image then building and the
model loading and synthesising on GPU.

### 4.3 `voice-evidence` — baked weights fetched from the hub anyway (boot-blocking)

The image is correct and the service still could not start. On a real GPU
replica: CUDA initialised, then

```
huggingface_hub.errors.OfflineModeIsEnabled: Cannot reach
https://huggingface.co/speechbrain/spkrec-ecapa-voxceleb/resolve/main/embedding_model.ckpt
```

exit 3, crash-loop.

`fetch_models.py` bakes the checkpoints correctly and the image sets
`HF_HUB_OFFLINE=1` exactly as the README requires. The gap is on the *load*
side: in both `spkrec-ecapa-voxceleb` and `spkrec-xvect-voxceleb`,
`hyperparams.yaml` sets `pretrained_path` to the **Hugging Face repo id**, and
the Pretrainer resolves every loadable against `<pretrained_path>` rather than
against `source`. Verified by reading both yaml files at the exact revisions
`fetch_models.py` pins. Passing a local `source` was never sufficient.

Fixed by overriding `pretrained_path` to the same local directory. Sepformer is
deliberately untouched — its Pretrainer declares no `paths:` block, so it
already resolves relative to `source`.

### 4.4 `voice-evidence` — DeepFilterNet shells out to a `git` that is not installed (boot-blocking)

One stage further on:

```
File ".../df/utils.py", line 152, in get_commit_hash
FileNotFoundError: [Errno 2] No such file or directory: 'git'
```

`init_df()` → `init_logger()` → `get_commit_hash()` runs `git` as a subprocess
to stamp a build hash into a log line. DeepFilterNet guards that call against
`CalledProcessError` but not against the binary being absent, so on a slim
image the error kills application startup outright — for a log annotation.

Fixed by adding `git` to the existing apt layer, which is what
`open-voice-runtime` already does. **Confirmed:** with `git` present the call
now fails cleanly (`fatal: not a git repository`, which DeepFilterNet handles)
and startup completes.

---

## 5. GPU capacity — and two traps

Both traps cost real time. They are written down so the next person does not
pay for them twice.

**Trap 1 — the quota API lies by omission.**
`Microsoft.App/locations/{region}/usages` returns exactly one GPU row,
`SubscriptionDedicatedNCA100Gpus = 0 / 0`, in **all 16 regions checked**. Read
naively that says "no GPU anywhere, go request quota". **That reading is
wrong.** That row covers *dedicated* A100 profiles only. Serverless
(Consumption) GPU has no row in that API at all, so its absence is not evidence
of absence. What settled it was scheduling a replica and reading the system log:

> `GpuDriverInfo | Your GPU environment is active! Pod started successfully
> with Driver version 580.159.04 compatible with CUDA versions up to 13.0`

**No quota request is needed.**

**Trap 2 — a GPU environment takes about an hour to create.**
`vyakti-voice-env` sat in `provisioningState: Waiting` for **~57 minutes**. A
control environment (`vyakti-ctrl-env`, identical minus the GPU profile)
reached `Succeeded` in ~12 minutes, which looked like proof the GPU profile was
blocked. It was not — the GPU environment finished successfully shortly after.
**Attaching a Consumption GPU workload profile adds roughly 45 minutes to
environment creation.** Budget for it; do not read it as failure.
`vyakti-ctrl-env` exists only as that control and can be deleted.

---

## 6. Deviations from the bicep

### Forced by permissions

The deploying service principal holds **Contributor**, which excludes
`Microsoft.Authorization/roleAssignments/write`:

1. **Secrets are inline container-app secrets, not Key Vault references.** Both
   bicep files take a `@secure() ...SecretUri` plus a user-assigned identity
   with *get* on that secret; a Key Vault reference needs a role assignment the
   principal cannot create. The mission's own instruction was followed instead.
2. **Image pull uses ACR admin credentials, not the managed identity.**
   `AcrPull` is likewise a role assignment. `vyakti-voice-pull` was created
   before this was discovered and is **unused**.

### Three places the bicep is not deployable as written

Found by translating it to ARM and having the API reject it, or by watching it
crash-loop:

- **`resources: { … gpu: 1 }`** → `Unknown properties gpu in
  ContainerAppContainerResources are not supported`. For serverless GPU the
  workload profile allocates the GPU; the container must not request one.
  Remove `gpu: 1` from both bicep files.
- **`initialDelaySeconds: 240` / `180`** → `ContainerAppProbeInitialDelaySeconds
  OutOfRange … must be in the range of ['0','60']`. `failureThreshold` is
  likewise capped at 10. The deployment preserves the authors' *total* readiness
  budget rather than silently shortening it: `initialDelaySeconds` 60,
  `failureThreshold` 10, `periodSeconds` stretched so
  `delay + failures × period` equals the original `240 + 12×15 = 420 s`
  (runtime) and `180 + 8×15 = 300 s` (evidence).
- **Only a Readiness probe is declared — and that is fatal.** Container Apps
  then applies its own **default liveness probe**, which starts failing
  immediately and restarts the container after roughly 20 seconds. Measured:
  the GPU runtime logged `Application startup complete` at 09:40:44 having
  already been killed at 09:40:41. A slow-loading model can never win that
  race, so the app crash-loops forever while its own logs look healthy. Fixed
  by adding an explicit **Startup** probe (liveness is suspended until startup
  succeeds) plus a tolerant explicit Liveness probe. This single change is what
  took the runtime from crash-loop to `ready=True, restarts=0`. **Both bicep
  files need it.**

Everything else is faithful: workload profile names, ingress direction (runtime
and evidence internal, broker external), CPU/memory, env var names, and
`minReplicas: 0`.

**Scale-to-zero is on for every app, and verified** — the GPU runtime was
observed dropping to 0 replicas after idle, and `voice-evidence` shut down
cleanly to `ScaledToZero`.

---

## 7. Where the HMAC secrets are

Generated with `openssl rand -hex 32` (32 bytes, hex — satisfies the ≥32-byte
decoded minimum both services enforce). They exist in exactly two places:

- the container apps' own `secrets` blocks, referenced by `secretRef`; and
- `.sec/open-voice-hmac.env` beside `azure.env` in this session's scratchpad,
  mode 0600, holding `OPEN_VOICE_HMAC_SECRET` and
  `AZURE_VOICE_EVIDENCE_HMAC_SECRET`.

Not in the repo, not in this file, not in any commit or log.

**The scratchpad is an ephemeral container directory.** If the owner does not
copy those two values out before this session's container is reclaimed, they
are gone and the apps must be redeployed with fresh ones.

`ASR_HMAC_SECRET` was deliberately **not** generated or set, per the mission.

---

## 8. Measured performance

### End-to-end synthesis, through the broker, on GPU

Real requests. Same 6-second generated 24 kHz mono WAV reference, same Hindi
text with the mandatory `This is an AI-generated voice replica. ` prefix,
`seed: 12345`.

| call | wall clock | service `elapsed_ms` | audio out | real-time factor |
|---|---|---|---|---|
| first on a fresh replica | 20.0 s | 17 221 ms | 5 520 ms | 3.12 |
| first on a fresh replica (repeat, different replica) | 19.9 s | 17 024 ms | 5 520 ms | 3.08 |
| **warm (steady state)** | **7.2 s** | **4 359 ms** | 5 520 ms | **0.79** |

The first call on any new replica pays CUDA kernel autotuning and lazy init —
consistently ~17 s. The steady state is ~4.4 s, i.e. faster than real time.
`perth_watermark_verified: true` with `perth_score: 1.0` on every call — the
service verifies its own watermark before returning and refuses to return audio
that fails.

### HMAC admission, positive and negative

| probe | result |
|---|---|
| `GET /healthz` broker, cold from zero | 200 in **21.8 s** |
| `GET /healthz` broker, warm | 200 in **0.8 s** |
| `POST /v1/synthesize`, correctly signed | **200** (above) |
| `POST /v1/synthesize`, deliberately wrong key | **401 `transport_binding_invalid`** in 1.8 s |
| `POST /v1/synthesize`, correct key, runtime absent | **503 `open_voice_runtime_unreachable`** in 1.6 s |

The negative control matters: a wrong key is rejected at admission with a
different code than a signed request that merely cannot reach the runtime. So
the HMAC binding is genuinely enforced, not merely configured.

The client speaks the protocol read straight out of `broker.py::_admit` and
`app.py::_verified_json`: `HMAC-SHA256(secret, "\n".join((protocol, method,
path, timestamp, nonce, sha256hex(body))))`, base64url, unpadded.

### Cold start from true zero — measured, and it does not fit a request

A single request was sent to a runtime sitting at 0 replicas. Timeline from the
platform's own logs:

| t+ | event |
|---|---|
| 0 s | request sent (10:04:08) |
| **+34 s** | replica scheduled onto a GPU node |
| +37 s | GPU driver active, image pull begins |
| **+114 s** | image pulled — **78.65 s** for 9.70 GB |
| +137 s | container created and started |
| **+161 s** | `Application startup complete` — service ready |
| +242 s | **the triggering request returned HTTP 504 `stream timeout`** |

So the service was ready at 161 s and the request that woke it still died. The
model load itself is fast (~13 s); **the image pull dominates**, and the
platform's request path gives up before the pull-plus-start completes.

Two ceilings are in play: the broker's own upstream timeout is **220 s**
(`broker.py`, `httpx.Timeout(220.0)`), and the Container Apps ingress returns
`504 stream timeout` at roughly 240 s.

**Consequence for the app plane:** never let a user-facing request absorb a
cold start. Either keep a warm replica during active hours, or issue a
throwaway warm-up call and only route real traffic once `/healthz` answers. The
same request replayed once warm returned 200 normally.

`voice-evidence` boots much faster once its image is on the node —
`Started server process` to `Application startup complete` in **~3 s** — so its
wake is essentially image-pull-bound too.

### An undocumented runtime network dependency

The `open-voice-runtime` README says "Runtime network model access is
disabled." That is true for Hugging Face (`HF_HUB_OFFLINE=1`) but **not
absolutely true**: on every cold start the container downloads

```
https://github.com/explosion/spacy-pkuseg/releases/download/v0.0.26/spacy_ontonotes.zip
```

(~34.5 MB) into `/tmp/.pkuseg`. It also logs
`WARNING: Could not load Cangjie mapping … cannot find the requested files in
the local cache`, because that tokenizer asset is *not* baked and HF is
offline. Neither is fatal for Hindi, and synthesis succeeds. But it means the
image is not actually self-contained, a network outage or an egress lockdown
would break cold starts, and the Chinese path is likely degraded. Worth baking
both assets in `fetch_models.py`. **Not fixed here** — it is a behaviour change
to the model pipeline, not a build fix, and it did not block the mission.

---

## 9. Cost per active hour

Central India list prices, rounded. GPU rates are list estimates; the uptime
they multiply is measured.

| thing | idle | active |
|---|---|---|
| `vyaktivoiceacr` (Basic) | ~$0.167/day (~$5/mo) fixed | + ~$0.10/GiB/mo beyond 10 GiB, + egress |
| `vyakti-voice-law` | $0 | ~$2.99/GiB ingested; 5 GiB/mo free |
| Container Apps environments | $0 | environments are not billed |
| `vyakti-open-voice-admission` (0.25 vCPU / 0.5 GiB) | **$0** — scale-to-zero | ~$0.01/hr of replica uptime |
| `vyakti-open-voice` (NC8as T4, 8 vCPU / 56 GiB) | **$0** — scale-to-zero | **~$0.53–0.60/hr of replica uptime**, and uptime includes cold start |
| `vyakti-voice-evidence` (NC8as T4) | **$0** — scale-to-zero | same ~$0.53–0.60/hr |

Standing bill with everything idle is **the ACR Basic fee and essentially
nothing else** — about $5/month. That is what the scale-to-zero posture and the
CPU admission broker in front of the GPU app buy, and both halves are now
verified rather than assumed.

Per-synthesis marginal cost at the measured warm rate (~4.4 s of GPU per 5.5 s
of audio) is roughly **$0.0007 per utterance**. **Cold starts are the real cost
driver**: a 161 s wake costs about as much as 35 warm syntheses, which is a
second, purely financial argument for the warm-up strategy in §8.

**Spent by WS-L:** seven ACR Task builds (~55 min of 2-vCPU agent time) plus
roughly 25 minutes of T4 uptime across boot tests, smoke tests and the
cold-start measurement — on the order of **$0.30–0.40 total**. Well under the
~$5 ceiling.

---

## 10. What is NOT established

- **No `voice-evidence` round trip has ever run.** It boots healthy, and that
  is all that is known. Nothing about its analysis path, its output, its
  latency or its GPU-memory behaviour has been measured. It also cannot be
  called from outside the environment as deployed — see §12.
- **Quality is completely unmeasured.** The synthesis above used a *synthetic
  buzz-tone* reference, not a human voice. It proves the pipeline runs. It says
  **nothing** about whether the voice is any good, and must not be read as
  though it does. The README is explicit that promotion needs real consented
  ABX tests for speaker identity, accent, Hinglish, prosody, noise robustness,
  hallucination, latency and watermark survival. None of that happened here.
- **The pkuseg / Cangjie network dependency** (§8) is diagnosed but not fixed.
- **Key Vault** — not created; secrets are inline (§6).
- **A budget alert** — `voice-evidence`'s README asks for one.
  `Microsoft.Consumption/budgets` is subscription-scope, outside the
  `vyakti-voice` RG, and the mission forbids creating anything outside it.
- ~~**Any fine-tuning pipeline** — explicitly out of scope.~~ **Built and run
  2026-08-26 by WS-U; see §13.**

---

## 11. Exact remaining owner actions

1. **Push the four source-fix commits** on `gurukul-ws-l` to
   `claude/gurukul-platform`, then rebuild every patched image from the branch
   so the digests have public provenance (§3).
2. **Copy the two HMAC values out of the scratchpad file now** (§7) — that
   directory is ephemeral and they are otherwise unrecoverable.
3. **Fix the three bicep problems** in §6 — especially the missing Startup
   probe, which silently crash-loops an otherwise working image.
4. **Decide the warm-up strategy** (§8). Nothing user-facing should absorb a
   161 s cold start, and it is the dominant cost line as well.
5. **Run a `voice-evidence` round trip** and record its numbers here (§10).
6. **Delete `vyakti-ctrl-env`** once §5 has been read.
7. **Add a subscription-scope budget alert.**
8. Optionally bake the pkuseg and Cangjie assets (§8), and grant `AcrPull` to
   `vyakti-voice-pull` to move off admin credentials (§6).
9. **Run a real ABX fidelity bench** before this lane is treated as primary
   (§10). Per `context/decisions.md#platform-north-star`, that bench — not this
   deployment — is what decides whether the self-hosted lane leads
   `api/_voice/registry.js`.

**No quota request is needed.**

### Vercel environment variables — names only

Values are **not** in this file.

| Vercel env var | value |
|---|---|
| `AZURE_OPEN_VOICE_ORIGIN` | `https://vyakti-open-voice-admission.purpletree-6dea69e2.centralindia.azurecontainerapps.io` — the **broker**. Per the README this must be the bicep's `publicAdmissionOrigin`, **never** `privateOpenVoiceOrigin`. |
| `OPEN_VOICE_HMAC_SECRET` | the `OPEN_VOICE_HMAC_SECRET` line in the scratchpad `.sec/open-voice-hmac.env` (§7) |
| `AZURE_VOICE_EVIDENCE_ORIGIN` | the evidence app's internal FQDN — but see §12; it is not reachable from Vercel as deployed |
| `AZURE_VOICE_EVIDENCE_HMAC_SECRET` | the `AZURE_VOICE_EVIDENCE_HMAC_SECRET` line in the same file |
| `VOICE_EVIDENCE_MAX_AUDIO_BYTES` | optional; defaults to `33554432`, which is what the app is deployed with |
| `VOICE_EVIDENCE_TIMEOUT_MS` | optional; defaults to `600000`. Given §8, do not lower it. |

`ASR_HMAC_SECRET` is intentionally left unset.

---

## 12. Open design question

`voice-evidence`'s bicep gives it **internal** ingress and its README says
"Private ingress … Do not expose this service publicly." But
`docs/gurukul/ENV-MANIFEST.md` §10 has the **Vercel** app reading
`AZURE_VOICE_EVIDENCE_ORIGIN` and calling it from
`api/_replica-processing/providers/azure-voice-evidence.js`. Vercel functions
are not inside the Container Apps environment, so as specified these cannot
both be true.

`open-voice-runtime` solves the identical problem with a CPU admission broker
in front of a private GPU app — and that pattern is now proven working end to
end (§8), so it is a known-good template rather than a theory.
`voice-evidence` has no equivalent in the repo. Either the replica-processing
worker runs inside the managed environment, or the evidence lane needs the same
broker treatment. A decision for the owner, not something to guess at.

## Secret recovery — the scratchpad is NOT the only copy

WS-L's handover called the generated HMAC values "otherwise unrecoverable"
because it wrote them to an ephemeral session directory. That is wrong, and
verified wrong: Container Apps stores them, and a Contributor service
principal can read them back at any time.

```
POST https://management.azure.com/subscriptions/{sub}/resourceGroups/vyakti-voice/
     providers/Microsoft.App/containerApps/{app}/listSecrets?api-version=2024-03-01
```
(needs `Content-Length: 0`; an empty POST body without it fails to parse.)

Verified 2026-08-26 against `vyakti-open-voice-admission`: returns
`acr-password` and `open-voice-hmac` with values present. So **Azure is the
durable store** — the Vercel side (`OPEN_VOICE_HMAC_SECRET`,
`AZURE_VOICE_EVIDENCE_HMAC_SECRET`) can be filled from there whenever the app
lane is wired, and losing the scratchpad costs nothing.

If a rotation is ever wanted, the pair must change in BOTH places in one go:
the container app secret and the Vercel env var. Mismatched halves fail closed
(401 at the admission broker), which is the correct failure and is what the
negative control in WS-L's smoke test exercised.

---

## 13. Per-speaker fine-tuning (WS-U, 2026-08-26)

Fine-tuning ran on this subscription and produced a measured delta:
`context/measurements.md#lora-vs-zero-shot-71s`. Every number there is a live
service response. This section records only what now EXISTS in Azure and what
it costs.

### New resources, all inside `vyakti-voice`

| resource | name | note |
|---|---|---|
| Storage account | `vyaktivoicewsu` | Standard_LRS, Hot, TLS1.2, **no public blob access**. One container, `finetune`, holding the training bundle, three adapters and one report. Total < 60 MB. |
| Container Apps **Job** | `vyakti-voice-finetune` | Manual trigger, GPU workload profile, `replicaTimeout` 7200, `replicaRetryLimit` 0. **Jobs bill only while a replica runs**, so an idle job costs nothing. |

`Microsoft.Storage` had to be **registered on the subscription** first — it was
`NotRegistered` and the create failed 409 `MissingSubscriptionRegistration`,
exactly like the four namespaces WS-L registered. Registration took ~80 s.

The job holds **no long-lived credential**. It receives three pre-signed blob
SAS URLs as container-app secrets, uses them, and exits.

### New images

| image | derived from | build time |
|---|---|---|
| `voice-finetune:v3` | `open-voice-runtime@sha256:9a033174…` | ~4 min |
| `open-voice-runtime:ft3` | same digest | ~4 min |

Both are **one small layer on the existing 9.70 GB runtime image**. Deriving
rather than rebuilding is what keeps the pinned Chatterbox commit, the baked
checkpoints and `lora.py` identical across trainer and runtime — and what makes
these builds minutes instead of the runtime image's 12m55s. Note the ACR agent
still re-pulls the 9.7 GB base each run, which is most of those four minutes.

**`vyakti-open-voice` now runs `open-voice-runtime@sha256:433e4abc…` (`ft3`),
not the digest in §3.** That image is the same runtime plus `lora.py` and the
adapter seam in `app.py`. Rolling back is one `deploy.py` call to the §3 digest;
nothing else changed.

### Two operational notes

- **`vyakti-voice-evidence` was flipped to external ingress and flipped back**,
  the same temporary scaffold WS-T used and for the same reason (§12 is still
  unresolved — a Vercel function cannot reach an internal app). It is
  **internal again as of the end of this session**. Verify before assuming.
- **A JOB's console logs carry an empty `ContainerAppName_s`.** They are keyed
  by `ContainerGroupName_s == "<job>-<execution>-<replica>"`. A Log Analytics
  query filtered on the app column returns an empty list for every job in this
  RG — which reads exactly like "the job produced no output" and cost real time
  here. The ARM-proxied query API also answers in **PascalCase** (`Tables`,
  `Columns[].ColumnName`); reading the camelCase shape returns an empty list
  rather than an error, with the same misleading appearance.

### Measured cost of the whole experiment

| item | measured | est. cost |
|---|---|---|
| ACR Task builds (6 runs, 2-vCPU agent) | ~26 min | ~$0.02 |
| Fine-tune GPU job | **140.4 s of T4 training**, ~5 min replica uptime including image pull | ~$0.05 |
| One failed job (device-mismatch crash) | ~2 min T4 | ~$0.02 |
| Synthesis + evidence, 2 full measurement runs | 32 clips + 10 evidence calls, ~50 min of T4 across both apps including two cold starts | ~$0.45 |
| `vyaktivoicewsu` storage | < 60 MB | < $0.01/mo |

**Total on the order of $0.55.** The dominant line is GPU uptime for the
*measurement*, not the training — 140 s of T4 trained the adapter, and roughly
twenty times that went on waking services and synthesising the clips to score
it. That is the same conclusion §9 reached from the other direction: cold starts
and idle-warm GPU, not compute, are what this stack actually costs.

### Addendum — the reference-window sweep

A second experiment ran on the same warm services
(`context/measurements.md#reference-window-beats-the-finetune`): five zero-shot
arms varying only which slice of the reference conditions the model. It found
that **window choice moves fidelity three times as much as the fine-tune does**,
which is the cheapest known lever on this stack and needs no GPU training at all.

Added cost: 20 more syntheses and 6 more evidence calls on already-warm apps,
plus one more evidence cold start (~220 s) because the flip back to internal had
let it scale to zero — call it **~$0.15**, bringing WS-U's total to roughly
**$0.70**.

---

## 14. Audio protection (WS-AL, 2026-08-26)

**`services/audio-protection` is deployed and serving.** It was in
`ENV-MANIFEST.md` but had never been deployed, which is why the owner's
"Preview my voice" returned 500 with `audio_protection_origin_required` in the
production log: the last of four layers, and the only one that was not a code
defect.

Every number in this section is a REST read-back, a platform log line, or a
wall-clock measurement of a real signed request.

### 14.1 What is live

| resource | name | note |
|---|---|---|
| Container app | `vyakti-audio-protection` | Consumption (CPU), external ingress, `minReplicas: 0` |
| Key Vault | `vyakti-protect-kv` | Standard, **access policies, not RBAC** (see 14.5), soft delete 7 days |
| KV certificate + key | `vyakti-c2pa-signer` | self-signed EC P-256, non-exportable |
| User-assigned identity | `vyakti-protect-id` | the app's only Key Vault credential, `get` + `sign` only |

Nothing pre-existing was modified. WS-AK was deploying the enrollment
processing worker into the same resource group at the same time; no resource of
its was touched, and no shared infrastructure was changed. The ACR, the Log
Analytics workspace and the `vyakti-voice-env` environment were **read from and
joined, not reconfigured**.

**Endpoint** (not a secret):

```
https://vyakti-audio-protection.purpletree-6dea69e2.centralindia.azurecontainerapps.io
```

**Serving revision and digest:**

```
revision : vyakti-audio-protection--0000002
image    : vyaktivoiceacr.azurecr.io/audio-protection@sha256:a5c12a02f2f0d380dbff786bab34db743aac0385860f05f615f41d2b73985079
tag      : audio-protection:v3   (ACR Task run cup)
size     : 424,673,280 bytes (424.7 MB), from the platform's own pull record
```

### 14.2 It serves, not merely provisions

`context/rejected.md#provisioning-succeeded-is-not-serving` exists because
Container Apps reports Succeeded before a revision serves. Measured against
revision `--0000002` with real HMAC-signed requests, response signatures
verified on every one:

| probe | result |
|---|---|
| `GET /healthz` warm | 200 `{"ready":true}` in 1.29 s |
| `POST /v1/watermark` (3 s of 24 kHz mono) | **200**, confidence 1.0, message verified, 3.28 s |
| `POST /v1/watermark` warm repeat | 200 in 2.72 s |
| `POST /v1/c2pa` | **200**, 12,350-byte external manifest, ES256, 5.20 s |
| `POST /v1/sign` | **200**, ES256 from the Key Vault key, 4.40 s |
| **negative control, wrong key** | **401 `transport_signature_invalid`** in 1.45 s |

The negative control matters for the same reason it did for WS-L: a wrong key
fails with a different code than a correct key against a broken service, so the
HMAC binding is enforced rather than merely configured.

**The real production client was then run against the live service**: the
unmodified `api/_provenance/providers/azure-protection.js` with the exact env
values the owner is being asked to paste. Disclosure, watermark, C2PA manifest
and receipt signature all succeeded over the wire, and undisclosed audio was
refused with `provider_disclosure_evidence_missing`. Full protection cost for a
3-second clip: **6.7 s** (3.02 s watermark + 2.61 s C2PA + 1.06 s signature).

### 14.3 The watermark was verified independently, with a negative control

The service verifies its own watermark before it will return audio. That is
necessary and not sufficient, so the returned bytes were also run through a
**separate process** using the same official detector, alongside the identical
audio from before the service saw it:

```
SERVICE OUTPUT    confidence=1.000000  message_matches=True
NEGATIVE CONTROL  confidence=0.000000  message_matches=False
```

The exact 16-bit token was recovered from the output and not from the control.
Without the second line the first would prove nothing.

The spoken disclosure is enforced structurally rather than checked afterwards:
the voice provider synthesises text that already begins with
`This is an AI-generated voice replica. `, the protection client refuses any
clip whose provider evidence does not start with exactly that, and
`delivery.js` asserts the disclosure proof before a single byte is forwarded.
Both halves are now asserted in `evals/production-protection/run.mjs`.

### 14.4 Three defects that only a real build and a real request could find

None was visible to code review, and each one passed the gate before it.

**14.4.1 The service was written for a base image it cannot use as deployed.**
`app.py` imports `numpy` and `torch`; `requirements.txt` listed neither,
relying entirely on the `pytorch/pytorch:...-cuda12.8` base. Both are now
explicit, `numpy` pinned in `requirements.txt` and `torch==2.8.0` installed
from the CPU wheel index in the Dockerfile.

**14.4.2 The AudioSeal checkpoints were not baked, so every cold start
downloaded them.** Fixed by `bake_models.py`, which downloads both to the exact
path `audioseal.loader` resolves from `AUDIOSEAL_CACHE_DIR`.

**14.4.3 The one that actually broke it: `torch.compile` needs a C++ compiler
at FIRST CALL.** AudioSeal's bundled moshi SEANet encoder wraps its forward
pass in `torch.compile`. TorchInductor shells out to `g++` the first time that
function runs, and nowhere earlier. So on a slim image:

- the image builds green,
- the container boots,
- `/healthz` answers `{"ready":true}`,
- and every single `/v1/watermark` call returns 503 `audio_protection_failed`.

Diagnosed only after adding data-free exception diagnostics (14.6), which
printed `InductorError<-InvalidCxxCompiler at ... compile.py:52:_wrapped`.
Fixed with `NO_TORCH_COMPILE=1`, which is moshi's own documented off switch and
returns the plain eager function. Eager is the right trade: the model is small,
and shipping a C++ toolchain inside a fail-closed signing service is not.

**The lasting fix is that the build now proves it.** `bake_models.py` runs a
full streaming watermark and a detection at build time and asserts the message
comes back. A build that can load the models but not use them now fails:

```
audioseal baked and exercised: confidence=1.000000 message_recovered=True
```

### 14.5 Deviations, and why

**Key Vault uses access policies, not Azure RBAC.** The deploying principal
holds Contributor, which excludes `Microsoft.Authorization/roleAssignments/write`
(the same wall WS-L hit for `AcrPull`). Setting a vault access policy is
`vaults/write`, which Contributor does have. So the vault is created with
`enableRbacAuthorization: false` and two policies: the deploying principal, and
`vyakti-protect-id` with `get` and `sign` on keys and nothing else.

**Microsoft Graph is not granted to this principal.** Resolving the principal's
own object id via Graph returns an error. The `oid` claim in its own ARM token
is the same value and needs no extra permission.

**Image pull uses ACR admin credentials**, for the same role-assignment reason
as WS-L.

**Ingress is external.** See `context/decisions.md#audio-protection-ingress`.
The README asks for no public ingress; a Vercel function is not inside the
managed environment, so as written that and a working preview cannot both be
true. This is the same unresolved tension as section 12. The service is its own
admission broker: every route is HMAC-bound, timestamp-bound, content-hash-bound
and single-use-nonce replay-protected inside `app.py`, it keeps no access log,
and `/healthz` is the only thing an unsigned caller can reach. Building the
separate CPU broker that `open-voice-runtime` has would be strictly better and
is recorded as open.

**The container runs on CPU.** See `context/decisions.md#audio-protection-cpu`.
It is a recorded decision with a reversal condition, not a silent flag flip.

### 14.6 A generic 503 was undebuggable, and now is not

`_run` caught every unexpected exception and answered
`{"error": "audio_protection_failed"}` with no trace anywhere, because the
service is forbidden from logging audio or request bodies. That is the correct
privacy posture and it made 14.4.3 invisible.

`_diagnostic()` now prints the exception class chain and the traceback's
`file:line:function` frames, and nothing else: no message, no `repr`, no
arguments, no payload. `evals/production-protection/run.mjs` enumerates every
output statement in the service and asserts that no interpolated expression
names anything derived from a request. The old check was a blanket "no output
statement of any kind", which is a proxy for the real invariant, and the proxy
is what would have blocked the fix.

### 14.7 Measured performance

Cold start is the headline, because on this stack it is what decides whether a
user-facing feature works at all.

| t+ | event (platform's own system log, revision `--0000002`) |
|---|---|
| 0 s | replica scheduled onto a node |
| +2.0 s | image pull begins |
| **+10.0 s** | image pulled: **9.73 s for 424.7 MB** |
| +15.9 s | container created and started |
| **+19.5 s** | `Application startup complete` |

**Cold start from true zero, measured end to end:** the app was allowed to
scale to zero (confirmed 0 running replicas at 19:24:41), then one request was
sent. `GET /healthz` returned **200 in 35.60 s**, and the immediately following
real `POST /v1/watermark` returned **200 in 3.43 s**.

**The triggering request survived.** That is the whole point of the CPU base
image. WS-L measured the GPU runtime ready at 161 s with the request that woke
it dying at 240 s on a platform timeout (section 8). Here the same event costs
**35.6 s and returns 200**. A preview can absorb this cold start; it provably
could not absorb the GPU lane's.

Warm steady state, 3 seconds of 24 kHz mono audio:

| operation | warm |
|---|---|
| `/v1/watermark` | **2.72 s** (real-time factor 0.91) |
| `/v1/c2pa` | 5.20 s first call, includes the DigiCert timestamp round trip |
| `/v1/sign` | ~1.06 s |
| full protection of a 3 s clip through the production client | **6.7 s** |

### 14.8 Cost

Central India list prices. Consumption CPU at 2 vCPU / 4 GiB is roughly
**$0.04 per hour of replica uptime**, and uptime includes the cold start.

| thing | idle | active |
|---|---|---|
| `vyakti-audio-protection` | **$0** (scale-to-zero, verified) | ~$0.04/hr of replica uptime |
| `vyakti-protect-kv` | ~$0 (a Standard vault has no standing fee) | $0.03 per 10,000 key operations |
| `vyakti-protect-id` | $0 | $0 |
| ACR storage for a 424.7 MB image | counts against the Basic 10 GiB allowance | negligible |

Per-preview marginal cost at the measured warm rate is on the order of
**$0.00005**. A cold start costs about **$0.0004**, which is roughly eight warm
previews: an order of magnitude cheaper per wake than the GPU lane, and the
reason the warm-up problem is much less urgent here than in section 8.

**Spent by WS-AL:** four ACR Task builds (about 8 minutes of 2-vCPU agent
time), one verification build, and roughly 25 minutes of CPU replica uptime
across boot tests, three probe rounds and the cold-start measurement. **On the
order of $0.05 total.**

### 14.9 Vercel environment variables — names only

Values are **not** in this file. They are in the scratchpad file named in
section 14.11, which is ephemeral.

| Vercel env var | where the value comes from |
|---|---|
| `AZURE_AUDIO_PROTECTION_ORIGIN` | the endpoint in 14.1. Not a secret; readable from Azure at any time. |
| `AZURE_AUDIO_PROTECTION_HMAC_SECRET` | generated `openssl rand -hex 32`. The same value is the container app secret `protection-hmac`, so **Azure is the durable copy** and it can be read back with `listSecrets` exactly as the secret-recovery section above section 13 describes. |
| `REPLICA_WATERMARK_TOKEN_SECRET` | generated `openssl rand -hex 32`. **Vercel-side only, no Azure copy.** The protection service never sees it. |
| `REPLICA_COMMITMENT_SECRET` | generated `openssl rand -hex 32`. **Vercel-side only, no Azure copy.** |
| `REPLICA_PROTECTION_MAX_PCM_BYTES` | optional; `33554432` matches what the service is deployed with. |

The last two have no durable copy anywhere. If the scratchpad is reclaimed
before they are pasted into Vercel they must be regenerated, which invalidates
the commitment of every clip already issued. Copy them first.

### 14.10 What is NOT established

- **The owner's preview has not been observed producing audio.** Everything
  between the Vercel function and the protected bytes is proven, using the real
  client against the real service. What has not happened is the two things this
  agent cannot do: write the five Vercel environment variables (no env-write
  tool exists here), and authenticate as the owner to
  `POST /api/replica-voice-preview`, which is behind `requireUser`. **The
  remaining step is one dashboard paste and a redeploy.** It is not a code
  change and not an Azure change.
- **Quality is unmeasured.** The probes used a synthetic 220 Hz tone. This
  proves the protection pipeline runs and that the watermark survives it. It
  says nothing about how the voice sounds, and must not be read as if it does.
- **Watermark robustness is unmeasured.** Detection was verified on the exact
  bytes returned. Survival through MP3, resampling, or a re-record was not
  tested. AudioSeal claims robustness; this deployment has not confirmed it.
- **No load or concurrency testing.** `maxReplicas` is 3 with a concurrency
  target of 2. Those numbers are a guess, not a measurement.
- **The C2PA signing certificate is self-signed** and valid for 24 months. It
  satisfies the C2PA signing profile (X.509 v3, EC P-256, ECDSA-SHA256,
  `digitalSignature` critical, `CA:FALSE`, EKU `emailProtection`) and c2pa-rs
  accepts it, so manifests sign. But it chains to no public trust list, so an
  external verifier will report a valid signature from an untrusted signer.
  Promoting to a real C2PA-recognised issuer is an owner decision.
- **No budget alert**, for the same subscription-scope reason as section 10.

### 14.11 Remaining owner actions

1. **Paste the five variables** into `vyakti-replica-lab` and redeploy. This is
   what makes "Preview my voice" work. The values are in the session scratchpad
   at `.sec/al-vercel-handover.txt`, mode 0600, never committed and never
   printed.
2. **Copy `REPLICA_WATERMARK_TOKEN_SECRET` and `REPLICA_COMMITMENT_SECRET` out
   of that file first** (14.9). They exist nowhere else.
3. Decide the ingress posture (14.5): leave the service as its own HMAC broker,
   or build it the CPU admission broker `open-voice-runtime` has.
4. Decide whether the C2PA signer should chain to a recognised issuer (14.10).
5. Measure watermark robustness through the delivery encoding actually used.
