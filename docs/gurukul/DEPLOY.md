# DEPLOY — turning the replica lab on

The runbook for SPEC-GURUKUL.md §4's "thoroughly built and thoroughly
un-turned-on" platform. Read `docs/gurukul/ENV-MANIFEST.md` first — every var
named below is documented there in full, with file:line proof of where it's
consumed. This file is the ORDER to do things in; that file is the CATALOG of
what to set. Run `node scripts/check-replica-env.mjs` before and after each
phase below — it tells you, without ever printing a value, whether the
subsystems that phase touches are DARK (expected, before), LIVE (expected,
after), or BROKEN-HALFWAY (stop and fix before continuing).

**This framing is now partially stale, and the section right below corrects
it.** When this file was written, nothing in it had been executed. As of
2026-09-03 the migrations in Phase 1's own range and beyond have been applied
live, in several sessions, well past "a plan" for that part. The phase-by-phase
Vercel env / standalone-service plan further down is still mostly unexecuted
and is left as written; **§"The Vercel reality" is the record of what has
actually happened, and where the two disagree, that section wins.**

---

## The Vercel reality (2026-09-03)

Two Vercel projects build from this one GitHub repo
(`raghavsharma2003/html-portfolio`), git-connected, each producing a preview
deployment per branch pushed, behind Vercel's own SSO/deployment protection —
so a preview URL is not public by default, unlike the production domains.
Neither project's env vars are visible to the other; §22-25's "not one
setting" rule applies across projects, not only across the five standalone
Azure services.

- **`html-portfolio`** — the original project. `.github/workflows/deploy-web.yml`
  pins it by id (`VERCEL_PROJECT_ID: prj_NZ4BT0Vr2BbkVrvWPcJNF68XCObp`, Phase 0
  item 2's own warning about why that pin exists). Serves Meera at `/chat` on
  its production domain, and Vyakti's own landing at `/` for builds off the
  Rooms platform branch (below).
- **`vyakti-replica-lab`** — the studio project, added later. Its build sets
  `STUDIO_ROOT=1` so `scripts/vercel-build.sh` serves the teacher/creator
  studio at `/` regardless of branch name — "one build, two products, the
  difference is a per-project env var, never a branch" (the script's own
  comment). Neither `OPENROUTER_KEY`/`OPENROUTER_API_KEY`, `GOOGLE_KEYS`,
  `AZURE_KEY` nor `AZURE_ENDPOINT` (ENV-MANIFEST.md §22, §25) has ever been set
  on this project, so every LLM-backed reply on it — `/api/chat` and, through
  the shared `think()`/`gatedReply()` door every other surface also uses, a
  Room's follower turn, a Mirror Call reply, a channel message — cannot
  produce a completion; see ENV-MANIFEST.md §25 for the two different failure
  shapes that produces.

**`scripts/vercel-build.sh`'s `site/vyakti.html`-at-`/` branch selection is a
literal string match, and the platform branch has been renamed since it was
written.** The script serves Vyakti's landing when `STUDIO_ROOT=1` OR
`VERCEL_GIT_COMMIT_REF = "claude/gurukul-platform"` (`scripts/vercel-build.sh`,
the `STUDIO_ROOT` check). `vyakti-replica-lab` is unaffected — it always sets
`STUDIO_ROOT=1` explicitly. But the `html-portfolio` project's own preview of
the Rooms platform branch depends on the SECOND half of that OR, and the
platform branch is `claude/vyakti-cloning-platform-aq05n4` now, not
`claude/gurukul-platform` (`context/decisions.md#ws-r10-worktree-wrong-base-commit`;
`git branch -a` in this tree shows both `remotes/origin/claude/gurukul-platform`
and `remotes/origin/claude/vyakti-cloning-platform-aq05n4` as distinct refs).
**Resolved 2026-09-03 by the main loop:** `scripts/vercel-build.sh` now
matches `claude/gurukul-platform` or any `claude/vyakti-cloning-platform-*`
ref as the platform branch (a `case` pattern, so the next branch rename in
that family needs no script change). Both Vercel projects build every push of
the platform branch as a preview (`target: null` on their latest deployments,
read from the Vercel API); neither has a production deployment from it, so
the mismatch was preview-only and never changed what any production domain
served. Checked after the change on the previews both projects built from
`4e80c30`: `/` serves the Vyakti landing (`<title>Vyakti</title>`) on both,
and `/chat` still answers 200 on `html-portfolio`
(`context/measurements.md#platform-branch-previews-serve-vyakti-2026-09-03`).

### Migrations actually applied to the live Neon database, in order

Per `context/decisions.md#first-live-apply` (015-054), `#ws-o-live-verified`
(056), the STATE.md LIVE table (015-062 as of 2026-08-27), the main-session
06:35Z log entry (064), and `context/decisions.md#rooms-migrations-applied-live-in-the-union-order`
(071-075, applied 2026-09-03 by the main loop in finish order 072, 074, 073,
075, 071, each `EXPLAIN`ed against the live database before its branch
merged): **015 through 065 and 071 through 075 are confirmed applied live.**
**066-070 are deliberately unused** — another agent applied migrations under
those numbers live without pushing the files, so the live database already
carries `vy_replica_voice_preview_intent`, `vy_replica_voice_build_intent`,
`vy_replica_voice_reference`, `vy_replica_claim_extraction_queue`,
`vy_replica_claim_extraction_queue_item` and `vy_replica_expression_observation`
— none of which any file in this tree creates — and leaving the numbers free
is what lets that tree merge later without a renumbering collision.

**076 (`vy_replica_drift_report`, WS-R9) is confirmed applied live.** The
docs workstream that wrote this section (WS-R13) found no `context/` record of
the apply and flagged it rather than assert it; the main loop then read the
table and its three indexes (`_latest_ix`, `_inputs_ix`, `_alerts_ix`) back
from the live database on 2026-09-03 and logged
`context/decisions.md#rooms-migration-076-confirmed-live`. **077 is the next
free migration number.**

### How to apply a migration

```bash
NEON_URL=<connection string> node db/migrations/apply.mjs          # every *.sql in db/migrations/, idempotent
NEON_URL=<connection string> node db/migrations/apply.mjs 076      # one file, by its numeric prefix
```

`apply.mjs` goes through `api/_db.js`'s `q()`, the same path everything else
uses, and Neon's SQL-over-HTTP endpoint accepts exactly one statement per
request — the runner splits each file and runs statements one by one, so every
statement in every migration must be independently idempotent (Phase 1's own
law, unchanged). Follow with `node scripts/relcheck.mjs` (the zero-orphan
sweep) while `NEON_URL` is still set; it is a hard gate in
`scripts/verify-release.mjs` whenever a URL is reachable and a skip, loudly
printed, when it is not.

### The one-gate-per-machine rule

`scripts/check-layout.mjs` (the layout readability gate inside
`verify-release.mjs`) binds `127.0.0.1:8931` to render the real signed-in
studio for measurement, and releases it when the check finishes. Only one
`verify-release.mjs` run — from any worktree, on this machine — can hold that
port at a time; a second one gets `EADDRINUSE`. That is a collision with
another gate run, not a defect: wait a minute for the first one to finish and
rerun, rather than changing the port or skipping the gate. This rule is local
only — GitHub's runner is a fresh machine per job, so the workflow below never
collides with a worktree running the gate by hand, or with another job in its
own Node-22/Node-24 matrix.

### CI runs the whole gate (WS-R77, 2026-09-05)

`.github/workflows/release-gate.yml` runs `node scripts/verify-release.mjs` on
every push to `main` or a `claude/**` branch (and on demand via
`workflow_dispatch`), in a Node 22 x Node 24 matrix, with a real headless
Chromium installed on the runner — the same 21 checks (23 only when
`NEON_URL` is set, which this job never is) that this file has always called
"the law," now run somewhere other than whichever machine a person or an
agent happened to run them on by hand. It needs no secret: `CI=1 node
scripts/write-config.mjs --stub` writes every key empty before the gate runs,
the same stub every offline check in this repo already uses, and a step in
the workflow statically asserts the file itself references no
`secrets.<NAME>` before the gate is allowed to run. The one thing it installs
beyond `npm ci` is the bundled `@expo-google-fonts/noto-sans-devanagari` face
as a user-local system font (via `fc-cache`, no `apt-get`, no root) so the
layout gate's Hindi glyph pass is proven against a real font on the runner
rather than however the runner's own default font set happens to substitute —
see that workflow file's own comments for why a "generous" local sandbox
cannot be trusted to represent a stock `ubuntu-latest` image here. It is a
separate workflow from `build-apk.yml` and `deploy-web.yml` on purpose: those
two build a debug APK and push a live deploy respectively, and either one
failing should not be confused with the release gate itself failing, or vice
versa. A local `verify-release.mjs` run is still the fast feedback loop and
still what a workstream commits against; this workflow is the backstop that
catches the push nobody ran it against by hand — see
`context/decisions.md#ws-r77-ci-runs-the-whole-gate` for the reversal
condition.

---

## Phase 0 — before touching anything

1. `node scripts/check-replica-env.mjs` in whatever shell/CI runner you're
   about to deploy from. In a clean checkout this reports every subsystem
   DARK — confirm that's what you see before assuming any later step's
   result means what it looks like.
2. Confirm which Neon project and which Vercel project you're pointed at.
   `.github/workflows/deploy-web.yml` pins `VERCEL_PROJECT_ID:
   prj_NZ4BT0Vr2BbkVrvWPcJNF68XCObp` — the comment above it records that on
   2026-08-22 an unpinned deploy auto-linked to a stale "html-portfolio"
   project by directory name and nobody noticed for a while. Do not skip this
   because "it's just env vars" — a migration or an env batch aimed at the
   wrong project is a much quieter failure than a bad deploy.
3. **A discrepancy worth fixing before Phase 2, not after:**
   `scripts/vercel-build.sh` pulls its full source tarball from
   `https://codeload.github.com/.../claude/ai-companion-app-rkt1lv` — the
   RelationalOS parent branch, not `claude/gurukul-platform`. A Vercel deploy
   run today would build the companion app, not Gurukul, regardless of which
   branch triggered it. This is a one-line branch-string change in that
   script, out of WS-G's scope to make unilaterally (it changes what every
   future Meera deploy ships), but it blocks Phase 2 being meaningful and
   should be an explicit owner decision alongside SPEC §6's open item #2
   (repo/branch strategy) — flag it before running Phase 2 for real.

## Phase 1 — database migrations (015-050)

Thirty-six files, `db/migrations/015_replica_core.sql` through
`db/migrations/050_replica_voice_delivery_holdout.sql`, none applied to live
Neon per SPEC §4. Two numbering tracks share the 015 prefix
(`015_push_tokens.sql` is a pre-existing Meera migration, `015_replica_core.sql`
is the first replica one) — `db/migrations/apply.mjs` sorts and runs every
`*.sql` file in the directory by filename, so both run in the same pass;
that's correct, not a collision, because the numeric prefix is a human
ordering aid, not a uniqueness key the runner depends on.

**The idempotence law**, from migration 009's header (`db/migrations/009_agents.sql`),
applies to every migration in this repo, including all 36 replica ones:

> Neon's SQL-over-HTTP endpoint accepts exactly ONE statement per request,
> and there are no transactions spanning `q()` calls. So this runner splits
> each file into statements and runs them one by one, and every statement in
> every migration file is REQUIRED to be independently idempotent: an apply
> interrupted between statements is recovered by running the same file
> again, never by manual repair.

Concretely: no migration here may assume it starts from a clean slate.
`add column` needs `if not exists`; a backfill `update` needs to be safe to
re-run against rows it already touched; a `create index` needs
`if not exists` or a `drop ... if exists` partner. If a replica migration was
authored without this property, that is a defect in the migration, not a
reason to add transactions or retries around `apply.mjs` — the runner's
simplicity (no `DO` blocks, no functions, a small quote-aware splitter) is
deliberate, per its own header, and migrations conform to it rather than the
other way round.

**Apply command:**

```bash
# dry read first — eyeball the plan
ls db/migrations/*.sql | sort -V

# apply everything (idempotent — safe to re-run in full after a partial failure)
node db/migrations/apply.mjs

# or apply only the replica range, by filename prefix
node db/migrations/apply.mjs 015 016 017 018 019 020 021 022 023 024 025 \
  026 027 028 029 030 031 032 033 034 035 036 037 038 039 040 041 042 043 \
  044 045 046 047 048 049 050
```

Needs `NEON_URL` pointed at the target database in the shell running it
(`apply.mjs` goes through `api/_db.js`'s `q()`, same as everything else) —
this is the one step in this whole runbook that touches production data
directly, so run it against a branch/staging Neon database first if one
exists, and confirm `node scripts/relcheck.mjs` (the zero-orphan sweep,
already wired into `verify-release.mjs`'s db-gated section) stays clean
after.

No down-migrations exist for this range, matching the rest of the repo's
migration convention — a bad migration is fixed by a forward migration, not
a rollback script.

## Phase 2 — Vercel env, in the manifest's three subsets

Set these as Vercel **Project → Environment Variables**, not through
`scripts/write-config.mjs` — per `docs/gurukul/ENV-MANIFEST.md` §15 and the
comment now in `scripts/write-config.mjs`, none of these consumers import
`api/_config.js`; they read `process.env` directly at request time, so
Vercel's own env store is the only place that reaches them. This also means
none of Phase 2 needs a redeploy to take effect on already-shipped API
routes — Vercel injects Project env vars into every invocation without a
rebuild, unlike `api/_config.js`'s bake-at-deploy-time keys.

Do this in the manifest's (a) → (b) → (c) order — each subset is runnable and
independently useful without the next one, and (c) is the only tier gated on
an external approval with unknown lead time (Phase 4).

### 2a. Foundry only (ENV-MANIFEST §23a)

```
AZURE_FOUNDRY_ENDPOINT
AZURE_FOUNDRY_API_KEY
AZURE_FOUNDRY_CLAIM_MODEL
AZURE_FOUNDRY_DIALOGUE_MODEL
AZURE_REPLICA_APP_BUDGET_USD
AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS
AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS
```

Verify: `node scripts/check-replica-env.mjs` shows `foundry_claim_extraction`,
`foundry_dialogue_generation`, and `foundry_spend_budget` all LIVE, everything
else still DARK.

### 2b. + Chatterbox voice lane (ENV-MANIFEST §23b)

Requires Phase 3's `open-voice-runtime` and `audio-protection` services
deployed first (their origins are inputs to this batch). Then set:

```
REPLICA_STORAGE_BUCKET            (optional — only if the bucket isn't the default name)
SUPABASE_URL                      (may already be set — pre-existing Meera var)
SUPABASE_SERVICE_ROLE_KEY
AZURE_OPEN_VOICE_ORIGIN
OPEN_VOICE_HMAC_SECRET
AZURE_AUDIO_PROTECTION_ORIGIN
AZURE_AUDIO_PROTECTION_HMAC_SECRET
REPLICA_WATERMARK_TOKEN_SECRET
REPLICA_COMMITMENT_SECRET
```

If the full evidence/processing pipeline (not just voice preview) should also
light up, also requires Phase 3's `voice-evidence` service and the
`processing-worker`'s own env, then:

```
AZURE_VOICE_EVIDENCE_ORIGIN
AZURE_VOICE_EVIDENCE_HMAC_SECRET
AZURE_SPEECH_FAST_TRANSCRIPTION_USD_PER_HOUR
```

Verify: `replica_storage`, `voice_chatterbox_preview`,
`provenance_protection_client` all LIVE; identity/liveness/personal-voice
subsystems still DARK (no Microsoft approval spent yet).

### 2c. + Azure Personal Voice + identity/liveness (ENV-MANIFEST §23c)

Blocked on Phase 4's two Microsoft Limited Access approvals. Once both are
granted, set the remaining `AZURE_COMPOSITE_IDENTITY_*`,
`AZURE_COMPOSITE_LIVENESS_*`, `AZURE_FACE_SESSION_BROKER_*`,
`AZURE_PERSONAL_VOICE_*`, `REPLICA_IDENTITY_VERIFIER`,
`REPLICA_LIVENESS_VERIFIER`, `REPLICA_FACE_SESSION_BROKER`, and the three KEK
pairs (`REPLICA_PROVIDER_CONSENT_KEK_*`, `REPLICA_FEEDBACK_KEK_*`,
`REPLICA_EVAL_KEK_*`) plus `REPLICA_ERASURE_RECEIPT_KEY_B64` /
`REPLICA_BACKUP_RETENTION_DAYS` — full list at ENV-MANIFEST §3, §4, §5, §7,
§8, §13, §14.

**Also set `CRON_SECRET` here** (ENV-MANIFEST §15), before or alongside 2a —
it gates all five replica cron sweeps and has no dependency on any other
subsystem, so there is no reason to leave it for last. Generate 32+ random
bytes, base64 or hex; the five sweep handlers only require it decode to at
least 24 bytes for the `timingSafeEqual` length check to have a chance of
passing. Re-verify with `node scripts/check-replica-env.mjs` that
`cron_auth_shared` flips DARK → LIVE, and confirm on the Vercel dashboard
that the five `vercel.json` cron entries stop returning 401 on their next
scheduled tick — this is the exact failure SPEC §4 named, and it is silent by
design (a 401 on a cron endpoint nobody is watching produces no alert).

**Leave `AZURE_IDENTITY_REVIEW_PATH_APPROVED` false** even after this phase,
per `services/azure-verifier/README.md`'s explicit release blocker, until the
independent document-review service (Phase 3, not yet built — see below)
exists and has been adversarially tested. Setting identity verification
"LIVE" per the checker without that service behind it is a `BROKEN-HALFWAY`
state the checker cannot see, because the review service is a Phase 3
dependency the env-var checker has no way to probe.

## Phase 3 — the five standalone services

Each has a `Dockerfile` and `infra/main.bicep` and **no CI/CD path** — SPEC
§4 flags this honestly and it remains true. This phase is manual until a
GitHub Actions workflow like the sketch below exists.

| service | deploy target | Dockerfile | Bicep | own env — see |
|---|---|---|---|---|
| `azure-verifier` | Azure Container Apps, scale-to-zero, max 1 replica | `services/azure-verifier/Dockerfile` | `services/azure-verifier/infra/main.bicep` | ENV-MANIFEST §16 |
| `voice-evidence` | Azure Container Apps, GPU, scale-to-zero | `services/voice-evidence/Dockerfile` | `services/voice-evidence/infra/main.bicep` | ENV-MANIFEST §17 |
| `audio-protection` | Azure Container Apps, GPU, scale-to-zero, no public ingress | `services/audio-protection/Dockerfile` | `services/audio-protection/infra/main.bicep` | ENV-MANIFEST §18 |
| `open-voice-runtime` | Azure Container Apps, two apps (public CPU broker + private GPU runtime) | `services/open-voice-runtime/Dockerfile` + `Dockerfile.broker` | `services/open-voice-runtime/infra/main.bicep` | ENV-MANIFEST §19 |
| `replica-processing-worker` | Azure Container Apps **Job** (not a server — scheduled/event-driven, zero idle cost) | `services/replica-processing-worker/Dockerfile` | `services/replica-processing-worker/infra/main.bicep` | ENV-MANIFEST §20 |

Manual deploy, per service, until CI exists:

```bash
# from repo root — every Dockerfile expects the repo root as build context
# (services/replica-processing-worker's README says this explicitly; the
# others import from api/_replica-processing/* the same way)
docker build -t <registry>/<service>:<tag> -f services/<service>/Dockerfile .
docker push <registry>/<service>:<tag>
az deployment group create --resource-group <rg> \
  --template-file services/<service>/infra/main.bicep \
  --parameters image=<registry>/<service>:<tag> ...
```

**A sixth dependency that is not a service in this repo at all:** the
"independently deployed, HMAC-authenticated review service" `azure-verifier`
calls via `AZURE_DOCUMENT_REVIEW_ENDPOINT` (`services/azure-verifier/README.md`,
`services/azure-verifier/src/config.js:60-65`) does not exist as a
`services/*` directory or an `api/*` route anywhere in this tree. It has to
be built or contracted before `AZURE_IDENTITY_REVIEW_PATH_APPROVED` can
honestly become `true` — this is not a deploy step, it is unbuilt product,
flagged rather than guessed at (ENV-MANIFEST §24).

### The GitHub Actions workflow that would build/push these (sketched, not written)

`.github/workflows/deploy-web.yml` is the existing pattern to mirror — same
"annotate loudly if unconfigured, never silently skip" shape it already
proves out for the Vercel deploy. A `deploy-services.yml` would need:

1. **Trigger**: `push` to `claude/gurukul-platform` (or `main`, once merged)
   filtered to `services/**` paths, plus `workflow_dispatch` for a manual
   redeploy of one service without touching the others.
2. **A `configured` gate job**, same shape as `deploy-web.yml`'s: check for
   `AZURE_CLIENT_ID`/`AZURE_TENANT_ID`/`AZURE_SUBSCRIPTION_ID` (federated
   OIDC credentials for `azure/login@v2`, the modern replacement for a
   long-lived service principal secret) and `ACR_LOGIN_SERVER`. Missing →
   `::warning::` annotation naming what's absent, `ready=false`, and the
   deploy job below is skipped (grey), never failed (red) — the same lesson
   `deploy-web.yml`'s own comments record from the nine-day silent-failure
   incident.
3. **A matrix job**, `strategy.matrix.service: [azure-verifier, voice-evidence,
   audio-protection, open-voice-runtime, replica-processing-worker]`, each
   step: `docker build -f services/${{ matrix.service }}/Dockerfile .` (repo
   root context, per the Dockerfiles' own expectation), `az acr login`, push
   tagged by commit SHA, then `az deployment group create` against that
   service's `infra/main.bicep` with the new image digest — **digest, not
   tag**, per every service README's "immutable container image digest in
   production" requirement.
4. **No secret ever printed** — the same discipline `write-config.mjs` and
   this workstream's other two files hold. Azure OIDC federated credentials
   mean no long-lived `AZURE_CREDENTIALS` JSON blob needs to exist as a
   GitHub secret at all, which is a stronger property than anything
   `deploy-web.yml` has today (that workflow still holds a bearer
   `VERCEL_TOKEN`).
5. **Env vars stay OUT of this workflow.** Unlike `deploy-web.yml`'s
   `Reconstruct api/_config.js` step, none of the five services' env
   (ENV-MANIFEST §16-20) should be piped through GitHub Actions secrets into
   a build step — they are Container Apps secrets set directly against each
   `az containerapp` resource (the Bicep templates already declare which
   settings are secret-backed), following exactly the same reasoning as
   Phase 2's "Vercel env, not `write-config.mjs`" split: these are
   runtime-read values for a specific deployed environment, not build-time
   config baked into an image.

This file sketches that workflow; it does not create it, per this
workstream's scope (WS-G is env vars and the deploy plan, not standing up
Azure OIDC federation, which needs an owner-held Azure AD app registration
this session cannot create).

## Phase 4 — the two Microsoft Limited Access applications

Both are manual, owner-initiated gates with unknown lead time (SPEC §6, open
decision #3). Neither has been requested as of this writing.

1. **Azure AI Speech — Personal Voice** (gates
   `AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED`, ENV-MANIFEST §7).
   Registration is required and, per Microsoft's docs, restricted to
   customers "managed by Microsoft" (working with a Microsoft account team).
   Docs: <https://learn.microsoft.com/en-us/azure/ai-foundry/responsible-ai/speech-service/text-to-speech/limited-access>.
   Registration form (verified live via web search, Microsoft's own
   `customervoice.microsoft.com` intake system):
   <https://customervoice.microsoft.com/Pages/ResponsePage.aspx?id=v4j5cvGGr0GRqy180BHbR7en2Ais5pxKtso_Pz4b1_xURFZNMk5NQzVHNFNQVzJIWDVWTDZVVVEzMSQlQCN0PWcu>.

2. **Azure AI Face — liveness detection** (gates
   `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED`, ENV-MANIFEST §4/§5/§16).
   Docs: <https://learn.microsoft.com/en-us/azure/ai-services/face/overview-identity>.
   Intake form (Microsoft's short link, verified live): <https://aka.ms/facerecognition>
   — when applying, the specific use case to request is "Facial
   Identification (1:N or 1:1 matching) with optional facial liveness
   detection," per Microsoft's own guidance for this scenario.

Both forms ask about the intended use case, data handling, and abuse
mitigations — the owner should have `docs/gurukul/safety-floor-teacher.md`
and `services/azure-verifier/README.md`'s existing consent/erasure/
minimization design on hand when filling them out, since both already answer
most of what Microsoft asks. Neither approval should be treated as fast; plan
Phase 2c and any teacher-facing "verified voice" marketing around an unknown
wait, not a target date.

## Phase 5 — go-live checklist

- [ ] `node scripts/check-replica-env.mjs --strict` exits 0 (no
      BROKEN-HALFWAY subsystem) in the Vercel deploy environment.
- [ ] The five `vercel.json` cron sweeps return 200, not 401/403, on their
      next scheduled tick (`CRON_SECRET` set — Phase 2c).
- [ ] `node scripts/relcheck.mjs` and `node scripts/check-citations.mjs`
      clean against the post-migration schema (Phase 1).
- [ ] `node scripts/verify-release.mjs` still all-green — this workstream's
      changes must not have moved that needle; replica config is
      deliberately not gated there (see `scripts/check-replica-env.mjs`'s own
      header for why).
- [ ] `scripts/vercel-build.sh`'s branch pointer fixed (Phase 0, item 3) —
      otherwise Phase 2/3 configuration lights up subsystems the DEPLOYED
      code doesn't contain yet.
- [ ] Both Microsoft Limited Access approvals confirmed in the Azure portal
      before flipping `AZURE_PERSONAL_VOICE_LIMITED_ACCESS_APPROVED` /
      `AZURE_FACE_LIVENESS_LIMITED_ACCESS_APPROVED` to `true` anywhere —
      the vars will accept the string without Microsoft's actual approval;
      only the provider call itself will fail, at whatever moment a real
      user hits it.
- [ ] `AZURE_IDENTITY_REVIEW_PATH_APPROVED` stays `false` until the
      not-yet-built document-review service (Phase 3 sixth dependency) is
      deployed and tested — do not flip this to unblock a demo.
- [ ] `node scripts/probe-live.mjs <base-url>` run against the deployment
      just pushed, and clean — see Phase 6 below.

## Phase 6 — after every deploy: probe what actually shipped (WS-R64)

`node scripts/verify-release.mjs --live <base-url>` exists and costs money
(it probes the model). Nothing else ever checked, for free, that a
deployment actually SERVES what the tree promised — WS-R57's security
headers, WS-R40's bot unfurl, WS-R55's og.png/story.png, WS-R59's
installable manifest and service worker, WS-R45's creator directory and
sitemap, WS-R48's `/suites`, and every API door's refusal shape. A push
that silently shipped a stale build, a dropped header, or a manifest byte
that drifted from `public/room.webmanifest` looked identical to a clean
deploy until a person went and clicked around by hand.

```bash
node scripts/probe-live.mjs <base-url>                              # unprotected prod domain
node scripts/probe-live.mjs <base-url> --share <link> --cookie-jar <file>   # protected preview
```

**Run this after every push that reaches a real deployment** — production
or a preview — as the last step of "push, then probe": push the branch,
let Vercel build it, then run this against the URL it produced. It is
**not** a gate in `scripts/verify-release.mjs` and never will be: a gate
must run offline, and this makes real GET/HEAD requests (plus two
harmless, always-refused `POST /api/room` bodies) against one live URL.
Its own logic — every expectation it checks, parsed from this repo's own
source rather than a second hand-typed copy — is proven offline instead,
in `evals/probe-live/run.mjs`, which IS part of `node
scripts/verify-release.mjs`'s eval suite.

**Every request costs nothing** — GET/HEAD, plus `POST /api/room` with an
unknown op and with no session, both refused by `api/room.js`/
`api/_room-surface.js` before either could ever reach a compiler or a
provider (the script's own static self-scan refuses to even start if its
own source ever grows a POST body outside those two). No sign-in, no paid
call, ever.

**A protected preview** (Vercel deployment protection, on by default for
every branch preview) answers every request with a redirect toward
`vercel.com/sso-api` until a bypass cookie is set. Visit the preview's
share link once with `--share <the link>` — the script follows its
redirects itself and stores whatever cookie it sets in the file named by
`--cookie-jar`, so later runs against the same preview do not need the
link again. **Never commit that file, and never paste the share link into
a `context/` entry or a commit message** — it is a bearer credential and
it expires in about a day; treat it exactly like any other secret named in
`docs/gurukul/ENV-MANIFEST.md`. A production domain (no deployment
protection) needs neither flag.

A finding names the surface, what the repo's own source promised, and what
came back — fix anything the finding says is this repo's fault (a missing
header on a route class, a wrong content type, a drifted manifest byte)
before calling the deploy done; a finding that is Vercel's own or the
owner's to fix (deployment protection itself, a DNS/CDN layer) gets logged
in `context/`, not silently worked around.
