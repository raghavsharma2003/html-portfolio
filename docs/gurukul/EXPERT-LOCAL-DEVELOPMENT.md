# Expert product: local development

The active integration combines the private clone workspace and the newer
creator/Rooms product. Start at `/studio`, then sign in, create a clone and
choose a recording or **Add knowledge first**. The shared voice sample panel
owns ordinary generation; the comparison lab owns issued listening trials.

## Run the actual APIs

`scripts/dev-expert.mjs` serves Vite and the repository's actual API handlers
on `127.0.0.1:5177`. It requires an isolated Neon database and checks
`current_database()` before listening. It does not provision services or seed
an authenticated user. Running Vite alone does not provide these APIs.

Provide these through the process environment or a private launcher:

- `NEON_URL`: the development database connection, never production.
- `VYAKTI_DEV_DATABASE`: matching `vyakti_expert_integration_YYYYMMDD` name.
- `SUPABASE_URL`, `SUPABASE_KEY`: the configured authentication project.
- `VYAKTI_DEV_PORT`: optional, defaults to `5177`.

Install dependencies and ensure ignored `api/_config.js` exists, following
`scripts/write-config.mjs` and `_config.example.js`. Do not commit this file,
put credentials in a browser bundle, or paste them into a transcript.

```sh
npm install
node scripts/dev-expert.mjs
```

The current development database is `vyakti_expert_integration_20260906`.
It was created on the existing compute and contains no copied production
data. Its schema bootstrap and reconciliation evidence live in
`docs/gurukul/research/` and `context/measurements.md`. Production migration
numbers are not a safe way to infer this database's applied schema.

## Azure replies

See `evals/azure-surface-reply/README.md` for opt-in Foundry routing, deployment
rates and durable spending limits. The shared reply adapter keeps the normal
persona compiler and memory/output guards. It is a model transport, not a
replacement for identity, knowledge ingestion, voice or storage services.

The development session verified `gpt-4.1-mini` on the existing GlobalStandard
deployment and used a $1 application ledger cap. Its rate evidence is recorded
in context. These are configured accounting rates, not a final Azure invoice.

## Verified scope and remaining dependencies

Real HTTP tests passed authentication, clone creation, idempotent creation
replay, owner reads, cross-owner refusal and source-use consent. A fresh clone
receives `voice_preview_identity_incomplete` before provider construction.
Temporary test authentication users were deleted. Synthetic clone revocation
is recorded separately from completion of its erasure jobs.

This does **not** claim a complete voice enrollment test. Identity verification,
private media storage, processing jobs and protected voice services require
their own server configuration. A text provider's successful reply does not
make those dependencies ready. No owner likeness or listening acceptance was
established by this development smoke test.

The local server is a development adapter, not Vercel infrastructure emulation.
It enforces a request size cap, rejects nonlocal browser origins, and blocks
HTTP access to internal API modules. It does not schedule crons or reproduce
production CDN behavior. Restart it after backend module edits.

Run `node scripts/verify-release.mjs` and `node scripts/context.mjs --check`
before release. See the current START HERE block for actual results; the
existence of this guide is not a release approval.
