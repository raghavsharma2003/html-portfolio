# DAY-ONE — the ordered path from a stub config to the first Room

**WS-R96.** Every owner action Vyakti still needs is named somewhere —
`docs/gurukul/ENV-MANIFEST.md` catalogs 106 individual env var settings across
six deployment targets, `docs/gurukul/DEPLOY.md` sequences them into phases,
`docs/gurukul/PHASE-0-RUNBOOK.md` maps the creator's own nine steps to the
studio panel or script that performs each one — but nobody had put the two
halves (infrastructure, then product) into ONE ordered path with an exact
proving command per step, and nothing checked that path against a real
deployment. This file is that path. `scripts/day-one.mjs <base-url>` is the
script that checks it, for free, reading its own checklist from this file's
own table so the two can never silently disagree
(`scripts/dayOneRunbook.mjs` is the shared parser both files import).

**Read this alongside, never instead of:** `docs/gurukul/ENV-MANIFEST.md` (the
catalog — every var's exact file:line and required/optional shape),
`docs/gurukul/DEPLOY.md` (the phase-by-phase Vercel/service order, and "The
Vercel reality" section on the two Vercel projects), `docs/gurukul/
PHASE-0-RUNBOOK.md` (the nine product steps in full, with everything each one
is still missing), `context/STATE.md`'s START HERE block and "Open owner
items" (the live, current state — this file is the ORDER to work through
those items in, not a second copy of them).

## The two Vercel projects, restated because every step below depends on it

Two Vercel projects build from this one GitHub repo (`docs/gurukul/DEPLOY.md`
§"The Vercel reality"). Neither project's env vars are visible to the other —
setting a name on one never sets it on the other, even though both build the
identical `api/` directory:

- **`html-portfolio`** — the original project. Serves Meera at `/chat` and,
  on a build of the Rooms platform branch, Vyakti's own landing at `/`. This
  is where `vercel.json`'s cron schedule actually runs (it is the project
  with a production domain and deployment).
- **`vyakti-replica-lab`** — the studio project, `STUDIO_ROOT=1`, serves the
  creator/teacher studio and the Room's own backend.

A step below whose "Vercel project / target" cell says `both` means: the SAME
name, set separately, on both projects' own dashboards — not one setting
shared by reference. `NEON_URL`/`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are
the recurring examples: the same DATABASE and the same STORAGE BUCKET, but two
independent env var settings pointing at them.

## The two gaps this file exists to name loudly

### 1. Self-check only ever reports two names, out of about a hundred

`api/_self-check.js` (WS-R76) is the deployment's own "which env values are
missing, by name" instrument, read through the ops door
(`GET /api/ops`, operator bearer, `OPS_OWNER_USER_IDS`). Its `REQUIRED_ENV`
and `OPTIONAL_ENV` lists were checked against the file directly (not assumed)
while writing this runbook, and they mirror exactly one thing:
`scripts/write-config.mjs`'s pre-Rooms Meera surface —

```
REQUIRED_ENV: OPENROUTER_KEY, NEON_URL
OPTIONAL_ENV: OPENROUTER_RESEARCH_KEY, GOOGLE_KEY, GOOGLE_PAID_KEY,
              SUPABASE_URL, SUPABASE_KEY, SUPABASE_SERVICE_ROLE_KEY,
              AZURE_KEY, AZURE_ENDPOINT, TELEGRAM_BOT_TOKEN,
              TELEGRAM_WEBHOOK_SECRET, TELEGRAM_BOT_USERNAME,
              FCM_PROJECT_ID, FCM_CLIENT_EMAIL, FCM_PRIVATE_KEY, GOOGLE_KEYS
```

**None of the ~90 replica/Rooms-specific names `ENV-MANIFEST.md` catalogs are
on either list** — not `CRON_SECRET`, not `OPS_OWNER_USER_IDS` itself, not any
`AZURE_FOUNDRY_*`/`AZURE_OPEN_VOICE_*`/`AZURE_AUDIO_PROTECTION_*`/
`AZURE_VOICE_EVIDENCE_*`/`SARVAM_*`/`REPLICA_SELF_TEST_*`/
`REPLICA_STORAGE_BUCKET`. **And even the `OPTIONAL_ENV` list above never
produces a finding at all**, checked directly in `runSelfCheck()`'s own body:

```js
for (const entry of envPresence(env)) {
  if (entry.required) checks.push({ door: `env: ${entry.name} missing`, ok: entry.present });
}
```

Only `entry.required` entries are ever pushed into `checks` — `OPTIONAL_ENV`
is computed by `envPresence()` and then simply never read again in this
function. So `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_URL`, `AZURE_KEY` and
every other optional name can be completely unset and self-check reports
exactly the same clean line it would with all of them set. A capability
complete at both ends and still dead, per `AGENTS.md`'s own law, found here
rather than assumed. **In practice self-check's env check is useful for
exactly two names in this whole runbook: `OPENROUTER_KEY` and `NEON_URL`.**
Every other step below is `manual:` for this reason, not because nobody
thought to wire it.

### 2. The one name that IS checked is not the one the product actually calls

One specific instance of gap 1 is worth naming by itself, because it can pass
self-check's one useful check while the product stays fully dark:
`api/_surface.js`'s `think()` — the ONE completion call every Room reply,
every Mirror Call reply, and every channel message routes through — reads
**only** `process.env.OPENROUTER_API_KEY`, a name self-check does not check
at all, with no fallback to `OPENROUTER_KEY`. (`api/chat.js` is the one
caller that DOES fall back to `OPENROUTER_KEY`, which is why Meera's direct
chat and a Room's `say` can fail in two different, easy-to-conflate ways —
see `docs/gurukul/ENV-MANIFEST.md` §25's own two-failure-shape note.) Set
`OPENROUTER_KEY` alone, and self-check reports **clean** while every follower
in every Room still gets back an empty reply from `think()`, silently,
because the honesty gate downstream of an empty completion has no way to know
the empty string came from a missing key rather than a real, considered
silence. Step 6 below names this explicitly; do not treat step 7's clean
self-check line as proof step 6 is also done.

## How `scripts/day-one.mjs` proves each step

```
node scripts/day-one.mjs <base-url> [--json]
    [--cookie-jar <file>] [--share <link>]     # forwarded to probe-live.mjs, protected previews
```

Env (never printed, never logged):

- `VYAKTI_OPERATOR_SESSION` — optional. A bearer session token for an account
  listed in `OPS_OWNER_USER_IDS` on the deployment being checked. Given, every
  `self-check:` row is read via one `GET /api/ops` call. Absent, every
  `self-check:` row is reported `unknown: no operator bearer given (set
  VYAKTI_OPERATOR_SESSION)` — the script never attempts the call without one,
  since an unauthenticated `GET /api/ops` on a configured board answers the
  same courtesy 404 as an unconfigured one and would teach nothing.

Every network call this script makes is a `GET`, through `scripts/
probe-live.mjs` (same static self-scan, same same-origin guard, same
retry-once, described in that script's own header) plus the one `GET
/api/ops` above. **No POST, no PUT, no write, no paid call, ever** — the same
law `probe-live.mjs` already holds, extended rather than loosened.

For every row this file's own table names:

- `probe-live` / `probe-live:<substring>` rows: the script runs `probe-live.mjs`
  once per base URL and checks whether the WHOLE run is clean (`probe-live`)
  or whether no reported finding's `surface` field contains the given
  substring (`probe-live:<substring>`).
- `self-check:env:<NAME>` / `self-check:door:<substring>` rows: read from the
  one `GET /api/ops` call's `self_check.failing_checks` array, matched by
  exact string (`env: <NAME> missing`) or substring.
- `manual:<instruction>` rows: never checked automatically. Printed as
  `unknown: run by hand — <instruction>`.

Output is a table: step number, name, `done` / `blocked: <reason>` /
`unknown: <reason>`, one line each — plus a final line naming how many of each.
Exit code is `0` only when every row is `done` or an explicitly-accepted
`manual:` row (a `manual:` row never fails the run; it is unproven by this
script by design, not a defect the script found).

---

## The path

<!-- DAY-ONE-TABLE:START -->
| # | Step | Env vars | Vercel project / target | Cost | Proving command | Expected output | Failure if skipped |
|---|---|---|---|---|---|---|---|
| 1 | Confirm the stub baseline on both projects | none | both | $0 | probe-live | `probe-live.mjs` reports 0 findings against each project's own URL — every static route, the cron refusal shapes, the two safe `POST /api/room` refusals | every later step's "did this env batch break something" question has no baseline to compare against, and a pre-existing defect gets blamed on the wrong change |
| 2 | `NEON_URL` | `NEON_URL` | both | $0 (Neon free tier covers Phase 0's single database) | self-check:env:NEON_URL | ops door reports no `env: NEON_URL missing` finding | every replica/Room API 500s on its first query; self-check itself reports `db: neon_url_missing` and skips step 3's own migration check entirely, not merely failing it |
| 3 | Migrations 015 through 125 applied | none (schema, not env) | the Neon database step 2 points at | $0 | self-check:door:vy_room missing | ops door reports no `migration 071: vy_room missing` finding (`node db/migrations/apply.mjs` plus `node scripts/relcheck.mjs`, per `docs/gurukul/DEPLOY.md` Phase 1); this door only appears at all once step 2's own database answers `select 1` | every Room-specific API 500s even though generic ones (auth, Meera) work; the exact half-migrated state `relcheck.mjs` exists to catch |
| 4 | `CRON_SECRET` | `CRON_SECRET` | html-portfolio (where the cron schedule actually runs, per this file's own Vercel-projects section) | $0 | manual: open the Vercel dashboard's Cron Jobs tab for html-portfolio (self-check's REQUIRED_ENV/OPTIONAL_ENV lists deliberately exclude CRON_SECRET, ENV-MANIFEST §15, and probe-live's cron section proves only the REFUSAL SHAPE, never that a secret is configured, since it never sends one) | the last invocation of each of the twelve `vercel.json` cron entries reads 200, not 401/403 | all five replica sweeps, the self-check sweep itself, and every other cron 401 forever, on schedule, with nothing surfaced anywhere but a Vercel invocation log nobody is watching (the exact failure `SPEC-GURUKUL.md` §4 named) |
| 5 | `OPS_OWNER_USER_IDS`, plus a real sign-in for that account | `OPS_OWNER_USER_IDS` | html-portfolio (or wherever the operator actually signs in and calls `/api/ops`) | $0 | manual: sign in as the allowlisted account, then call `GET /api/ops` with that session's bearer | the response is 200 rather than the courtesy 404 an unconfigured or non-allowlisted caller gets | every `self-check:` row below this one stays `unknown: no operator bearer given` forever, and the ops board itself (funnel, incidents, sweeps) has no reader |
| 6 | `OPENROUTER_API_KEY` — the completion door every Room reply actually uses | `OPENROUTER_API_KEY` | vyakti-replica-lab | $0 to configure; per-token spend once real traffic runs, no budget fence on this specific path today | manual: NAMED SELF-CHECK BLIND SPOT, see this file's own section 2 above — run `node scripts/first-room.mjs` through to `follower-say` | the follower-say stage's `reply` field is non-empty | `api/_surface.js`'s `think()` returns an empty string on every call; a Room, a Mirror Call reply and every channel message all go silent with no named error anywhere, and step 7 below can report clean at the same time |
| 7 | `OPENROUTER_KEY` — the name self-check actually checks, and `api/chat.js`'s own fallback | `OPENROUTER_KEY` | vyakti-replica-lab | same budget as step 6 | self-check:env:OPENROUTER_KEY | ops door reports no `env: OPENROUTER_KEY missing` finding | `api/chat.js`'s direct chat endpoint answers `500 {"error":"no key configured"}` by name; unrelated to step 6's failure mode, and both are real gaps at once until both names are set |
| 8 | Replica private storage: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REPLICA_STORAGE_BUCKET` | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `REPLICA_STORAGE_BUCKET` (optional, defaults to `vyakti-replica-private`) | vyakti-replica-lab | $0 on the existing Supabase project's free storage tier for Phase 0's volumes | manual: NAMED SELF-CHECK BLIND SPOT, see this file's own section 1 above — run `node scripts/first-room.mjs`'s `upload` stage through to a real signed PUT, or `node scripts/check-replica-env.mjs` | the `upload` stage reports `ok`, or `check-replica-env.mjs` shows `replica_storage` LIVE | enrollment, evidence and voice-preview uploads all fail at the signed-upload step; `first-room.mjs`'s own `upload` stage is the first thing that would show this, since self-check never will |
| 9 | The Chatterbox voice preview lane: `AZURE_OPEN_VOICE_ORIGIN`, `OPEN_VOICE_HMAC_SECRET`, `AZURE_AUDIO_PROTECTION_ORIGIN`, `AZURE_AUDIO_PROTECTION_HMAC_SECRET`, `REPLICA_WATERMARK_TOKEN_SECRET`, `REPLICA_COMMITMENT_SECRET` | same six names | vyakti-replica-lab, plus deploying the `open-voice-runtime` and `audio-protection` standalone services first (`docs/gurukul/DEPLOY.md` Phase 3) | Azure Container Apps GPU compute, scale-to-zero (near $0 idle; real $ per warm synthesis) | manual: `node scripts/check-replica-env.mjs`, per `docs/gurukul/DEPLOY.md` Phase 2b's own verify step — self-check does not list any of these six names | `voice_chatterbox_preview` shows LIVE | `/api/replica-voice-preview` answers `503 open_voice_origin_required`; the studio's voice panel can never produce audio, which `context/STATE.md`'s START HERE block already names as the single blocker on the first owner ever hearing their own clone in a browser |
| 10 | Voice evidence and transcription: `AZURE_VOICE_EVIDENCE_ORIGIN`, `AZURE_VOICE_EVIDENCE_HMAC_SECRET`, `SARVAM_API_KEY` | same three names | vyakti-replica-lab, plus the `voice-evidence` standalone GPU service deployed | `voice-evidence` GPU compute, scale-to-zero; Sarvam per-hour ASR spend, rate unresolved (ENV-MANIFEST §15b names a 3x conflict in the source figures) | manual: `node scripts/check-replica-env.mjs` for `voice_evidence_client` | the processing DAG's `transcribe` stage stops naming `sarvam_asr_config_missing` | the processing DAG stalls at `transcribe`; `voice_quality` never runs, so `sounds_like_you` in Readiness stays unmeasured for every replica behind this gap |
| 11 | The owner-only bypass: `REPLICA_SELF_TEST_MODE`, `REPLICA_SELF_TEST_ENVIRONMENT`, `REPLICA_SELF_TEST_OWNER_USER_ID` | same three names, ALL required together | vyakti-replica-lab and the `processing-worker` service | $0 | manual: `GET /api/replica-runtime` for the named owner — self-check does not list any of these three names | `voice_not_ready`/`production_voice_required` blockers are cleared | a second real creator (not the allowlisted owner id) cannot pass the production voice path in "the first ten minutes" at all, per `docs/gurukul/PHASE-0-RUNBOOK.md` step 3 |
| 12 | `AZURE_FOUNDRY_ENDPOINT`, `AZURE_FOUNDRY_API_KEY`, `AZURE_FOUNDRY_CLAIM_MODEL`, `AZURE_FOUNDRY_DIALOGUE_MODEL`, `AZURE_REPLICA_APP_BUDGET_USD`, `AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS`, `AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS` | same seven names | vyakti-replica-lab | Azure AI Foundry token spend, fenced by `AZURE_REPLICA_APP_BUDGET_USD` | manual: `node scripts/check-replica-env.mjs` | `foundry_claim_extraction`/`foundry_dialogue_generation`/`foundry_spend_budget` all show LIVE | optional — the review queue's `generate` op still runs without these and reports `questions_unavailable` by name, an honest empty rather than a silent one, per `docs/gurukul/PHASE-0-RUNBOOK.md` step 6; claim extraction and the dialogue-authoring assist are simply off |
| 13 | Supabase Auth SMTP (a Google Workspace app password) | none — a Supabase project dashboard setting, not a repo env var read by any file in this tree | Supabase project (shared by both Vercel projects) | $0, a Google Workspace account the owner already has | manual: send two sign-in OTP emails inside one hour | the second email is not rate-limited | the built-in Supabase mailer caps at about 2 sign-in emails per hour; a creator who is invited and loses the first OTP has no recovery path other than Google sign-in |
| 14 | `/r/*` on the Supabase OAuth redirect allow list | none — a Supabase Auth dashboard setting | Supabase project | $0 | manual: sign in with Google from inside a Room via `googleSignIn()` (`src/studio/studioAuth.ts`) | sign-in completes without a redirect_uri_mismatch error | Google sign-in from inside a Room fails; email OTP and the studio's own Google sign-in, whose return path is already allow-listed, are unaffected |
| 15 | Application: the creator signs in | none (uses steps 2, 13, 14 above) | vyakti-replica-lab | $0 | manual: complete `src/studio/studioAuth.ts`'s own sign-in flow; `docs/gurukul/PHASE-0-RUNBOOK.md` step 1 has the full detail | a bearer session token is returned | no `VYAKTI_SESSION` exists for `scripts/first-room.mjs` to use, and nothing downstream of this step can run |
| 16 | Identity by voice | none new (uses step 9's lane) | vyakti-replica-lab | $0 per attempt | manual: complete `src/studio/VoiceIdentityChallenge.tsx` for the signed-in creator; `docs/gurukul/PHASE-0-RUNBOOK.md` step 2's own caveat applies | the challenge passes — but the false-accept side of the 0.78/0.70 thresholds is unmeasured, and no different-speaker control exists in this repo | a creator cannot be told apart from an impostor with any measured confidence; today this only matters once a second real creator exists, since the owner's own bearer token is trusted directly for Phase 0 |
| 17 | The first ten minutes | none new (uses step 11's bypass, or the full stack of steps 4, 5, 9, 10) | vyakti-replica-lab | $0 | manual: open `src/studio/QuickStartPath.tsx`; `docs/gurukul/PHASE-0-RUNBOOK.md` step 3 | no `platform`-owned blocker is left in the panel's own list | a creator sees a locked studio with no path forward, correctly labelled "waiting on us" rather than blamed on them |
| 18 | The voice moment | none new (uses step 9's lane) | vyakti-replica-lab | $0 per preview once step 9 is live | manual: `scripts/first-clone.mjs`'s `reference-embeddings`/`clone-synthesis`/`fidelity` stages; `docs/gurukul/PHASE-0-RUNBOOK.md` step 4's own caveat applies | a real score prints against the real ceiling — but no ABX listening bench has ever been run on a human ear for any creator, and a fidelity number is not a likeness claim | the creator never hears their own clone at all; the emotional core of the product never happens |
| 19 | Feed: consent plus one audio upload | none new (uses step 8's storage) | vyakti-replica-lab | $0 | manual: `node scripts/first-room.mjs <audio.wav> --display-name "<name>"` through its `consent` and `upload` stages | both stages report `ok` | no source exists for the processing DAG to run against, and every step after this one has nothing to gate on |
| 20 | Correct: fill the review queue | none new (optionally uses step 12's Foundry keys for synthetic questions) | vyakti-replica-lab | $0 without step 12; Foundry token spend with it | manual: `node scripts/first-room.mjs`'s `review-queue` stage (`generate` only — deciding a card is the creator's own job, per `docs/gurukul/PHASE-0-RUNBOOK.md` step 6, and this script never calls `{op:"decide"}`) | the stage reports `ok` with a non-zero card count | the queue stays empty; a creator has nothing to review even once material exists |
| 21 | Bound: never-say rules and an escalation route | none | vyakti-replica-lab | $0 | manual: open `src/studio/PersonModelStudio.tsx` and `src/studio/TeacherSheetStudio.tsx` | at least `MIN_NEVER_SAY_RULES` (3) approved boundary claims exist, and `escalationRoute` is set | Readiness's `knows_what_not_to_say` part stays unmeasured for this creator; per `docs/gurukul/PHASE-0-RUNBOOK.md` step 7 this is the one part with no missing instrument, only a missing creator action |
| 22 | Gate: Readiness clears the publish lock | none new | vyakti-replica-lab | $0 | manual: `node scripts/first-room.mjs`'s `readiness` stage; `docs/gurukul/PHASE-0-RUNBOOK.md` step 8's own caveat applies | all five parts print and `publish_locked=false` — but `knows_your_material` has NO instrument for anyone, ever, and `sounds_like_you` is half of one, so `publish_locked` is true for every replica today, including the owner's | `room-publish`'s own `{op:"publish"}` refuses with `room_publish_locked` and the classed `waiting_on_you`/`waiting_on_us` blocker list — the expected state for a first run, not a bug |
| 23 | Launch: publish the Room and prove a follower can join | none new | vyakti-replica-lab | $0 | manual: `node scripts/first-room.mjs`'s `room-create`, `room-publish`, and (with a SECOND, follower, `VYAKTI_FOLLOWER_SESSION`) `follower-open` through `follower-forget` stages | every stage reports `ok` | this is Phase 0's own remaining step as of this writing — no SQL statement in the Room's publish or follower lane has ever executed against the live database with a real owner and a real follower, per `docs/gurukul/PHASE-0-RUNBOOK.md` step 9 |
<!-- DAY-ONE-TABLE:END -->

## What `day-one.mjs` can and cannot tell you

**Provable for free, today, against a real deployment:** steps 1, 2, 3 and 7
(via `probe-live` and, with an operator bearer, the ops door's self-check
line — only `REQUIRED_ENV` names ever surface there, see this file's own
section 1 above). Every `manual:` row (4, 5, 6, 8 through 23) is printed as
`unknown` by design — this script never makes a paid call, never signs in,
never uploads a file, and never runs `scripts/first-room.mjs` itself. Running
that script for real, with a real owner session and a real audio file,
remains the only thing that can close steps 15 through 23, exactly as
`docs/gurukul/PHASE-0-RUNBOOK.md` already states.

**Not proven by anything in this repository, named here because forgetting it
would defeat the point of a runbook that tries to be honest:** the false-accept
side of the voice identity thresholds (step 16), the ABX listening bench
(step 18), and `knows_your_material` (step 22) are all unmeasured for every
creator including the owner, and no automated check anywhere can measure them
— they need a human ear, an impostor control set, and a held-out recall run,
respectively, none of which exist yet.
