# Vyakti deployment contract

This repository deploys one product, `vyakti-clone`. Its verified Vercel
project identity on 2026-09-14 is:

- project: `prj_rfW81HIge0vtG6nzIcO41OGB5fP9`
- team: `team_hQIoipGIvf1GHVj3878tDOR3`
- current production URL: `https://vyakti-replica-lab.vercel.app`

Treat these values as admission controls, not evidence that a particular
source commit is live. A deployment claim needs a source marker and a readback
from the deployed URL.

The Vercel project's verified `productionBranch` was still
`claude/gurukul-platform` at the start of 2026-09-14. The standalone workflow
targets `main` only. Do not claim that the live binding changed until its
post-gate update is read back.

`vercel.json` sets `git.deploymentEnabled` to `false` for every branch. A push
therefore preserves and reviews source without creating a Preview or Production
deployment. The `Deploy Vyakti web` workflow is the only release path: it runs
the complete offline gate first, then invokes the Vercel CLI with the exact
Vyakti project and team IDs. Keep the kill switch in source even after the
project's production branch moves to `main`.

## Routes

- `/` serves `site/vyakti.html` as the public landing page.
- `/studio` serves the creator studio.
- `/r/<slug>` serves a follower Room.
- `/privacy`, `/delete-account`, `/suites`, `/creators`, and `/robots.txt`
  serve the corresponding Vyakti public artifacts.
- `/api/*` keeps `Cache-Control: no-store` and
  `X-Content-Type-Options: nosniff`.

The build has no branch-selected product, no `STUDIO_ROOT` switch, and no
second application entry. `scripts/vercel-product.mjs` admits only
`vyakti-clone`. `scripts/vercel-build.sh` builds the studio bundle, selects the
studio native start page, creates the OTA bundle, and copies the Vyakti landing
to `dist/index.html`.

## Scheduled work

`vercel.json` is the schedule source of truth. It contains 23 verified
Vyakti/shared cron entries as of 2026-09-14. Preserve the complete list when
changing routing or build behavior. A count in an older handoff is not grounds
for deleting a scheduled caller.

Every scheduled API authenticates with `CRON_SECRET` at request time. Keep that
value in Vercel environment variables rather than baking it into
`api/_config.js`.

## Required deployment environment

The Room reply path is Azure-only. Every production build needs:

```text
NEON_URL
AZURE_FOUNDRY_ENDPOINT
AZURE_FOUNDRY_API_KEY
AZURE_FOUNDRY_DIALOGUE_MODEL
AZURE_REPLICA_APP_BUDGET_USD
AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS
AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS
```

`AZURE_REPLICA_BUDGET_ID` is optional and uses the ledger's existing default.
When `AZURE_FOUNDRY_DIALOGUE_MODEL=gpt-5.6-terra`, also set:

```text
AZURE_FOUNDRY_DIALOGUE_RATE_MODEL=gpt-5.6-terra
AZURE_FOUNDRY_DIALOGUE_EXPECTED_RESPONSE_MODEL=gpt-5.6-terra-2026-07-09
AZURE_FOUNDRY_DIALOGUE_INPUT_USD_PER_MTOKENS
AZURE_FOUNDRY_DIALOGUE_OUTPUT_USD_PER_MTOKENS
```

Prices and budget limits are operator-supplied values. Do not hardcode or infer
them from model names. Other capabilities have their own variables in
`docs/gurukul/ENV-MANIFEST.md`; absence must fail or surface as an honest
capability-specific state.

`scripts/write-config.mjs --vyakti-deploy` validates the Azure and Neon
deployment contract before it writes the gitignored `api/_config.js`. It never
prints values. `scripts/write-config.mjs --stub` is only for offline gates and
cannot authorize a deployment.

## Release sequence

1. Run `node scripts/verify-release.mjs` and
   `node scripts/context.mjs --check`. If `NEON_URL` is unavailable, report the
   relational skips exactly as the runner prints them.
2. Push the exact reviewed commit. Source-controlled
   `git.deploymentEnabled: false` prevents that push from deploying through the
   Vercel Git integration.
3. Deploy only through the gated GitHub workflow to the project identity above.
   The workflow passes `--product vyakti-clone` and exact project/team IDs to
   the Vercel CLI after the offline release gate passes.
4. Run `node scripts/probe-live.mjs <base-url>`.
5. Run
   `node scripts/verify-deploy.mjs <base-url> --product vyakti-clone`.
6. Match the deployed source marker to the intended commit before calling the
   release live.

The deploy verifier checks the source marker, Vyakti root landing, studio entry
graph, and refusal-shaped authentication boundaries on representative APIs.
Those probes do not spend model budget or write user data.

## Android

`.github/workflows/build-apk.yml` builds the single Vyakti Android app. It builds the
web bundle, selects `studio` as the native start page, stages
`capacitor.vyakti.config.ts`, syncs Capacitor, and runs the standard single-app
Gradle tasks. Release signing uses only the `VYAKTI_ANDROID_*` secrets.

## Rollback

Rollback means promoting a previously verified Vyakti deployment in the same
Vercel project, then repeating both live probes and source-marker readback. Do
not reuse an artifact whose marker cannot be tied to a reviewed commit. A
rollback does not waive database, consent, watermark, disclosure, or erasure
requirements.
