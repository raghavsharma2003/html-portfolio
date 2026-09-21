# Vyakti — Claude Code entry point

This repository builds Vyakti only. Read `AGENTS.md` first and follow its
reading order. `context/STATE.md`'s dated START HERE block wins over older
prose, followed by `context/rejected.md`, `context/decisions.md`,
`context/measurements.md`, and `context/graph.json`.

Vyakti turns a creator's own archive into an AI version of them. The studio is
**Feed it, Meet it, Deploy it**. A follower's Room lives at `/r/<slug>` and
must keep creator material, each follower's private words, and aggregate
creator insights in their separate scopes.

Before anything ships, run:

```text
node scripts/verify-release.mjs
node scripts/context.mjs --check
```

Trust `scripts/verify-release.mjs` for the current gate count. `npx vite build`
alone is insufficient because it can succeed with type errors. The relational
database checks run only when `NEON_URL` is available; say when they did not
run.

The deployment contract has one product: `vyakti-clone`. `/` serves the Vyakti
landing, `/studio` serves the creator studio, and `/r/<slug>` serves a Room.
The build has no branch-selected product and no `STUDIO_ROOT` switch. Preserve
all 23 verified Vercel cron entries and the API no-store and nosniff headers.
Automatic Git deployment is disabled for every branch; only the complete-gate
Vercel CLI workflow releases.
After a real deploy, probe the real URL with `scripts/probe-live.mjs` and
`scripts/verify-deploy.mjs`; a local build is not evidence of live state.

These laws bind every change:

- Never claim a command, measurement, deployment, or live state you did not
  observe.
- Offline mocks prove control flow only. Use `EXPLAIN` against the real
  database to validate SQL types and referential behavior.
- Trace every capability to a caller. A complete function without a caller or
  schedule is dead.
- Prefer a clear failure to a plausible fallback value.
- Separate blockers into waiting on the user and waiting on the platform.
- Keep the spoken AI disclosure, PerTh watermark, SQL consent predicates, and
  explicit human approval before persona updates.
- Write prompt shapes rather than recitable sentences. Position is mechanism;
  decision instructions that must win belong at the end.
- Keep user-visible copy free of em dashes, en dashes, and the AI tells enforced
  by `scripts/check-copy.mjs`.
- Never commit or print a secret. `api/_config.js` is gitignored and generated
  only from environment variables.
- Migrations are idempotent, one statement per request, free of DO blocks,
  explicit about `::uuid` casts, mirrored in `db/schema.sql`, and wired into
  erasure and relational checks. Read `AGENTS.md` for the current applied and
  unused number ranges before choosing a number.

The Room vocabulary gate forbids `clone`, `replica`, `model`, `fine-tune`,
`train`, `training`, `weights`, `embedding`, `LoRA`, and `genome` in the
user-visible Room and studio surfaces except the narrowly named legal-text
allowlist. An incomplete AI is an apprentice.

The measured open product problem remains voice likeness. Bandwidth repair is
not speaker similarity, and no owner-clone similarity score exists. The
processing Job rebuild, paid residential YouTube proxy, warm GPU spend, and key
rotation remain owner-controlled work described in `context/STATE.md` and
`AGENTS.md`.

Before the next phase, append a decision with a reversal condition, a
measurement with n/method/date, and a rejection with the specific failure.
Then run `node scripts/context.mjs --check`. Preserve superseded history with
graph edges rather than deleting it.
