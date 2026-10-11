# Codex takeover, 2026-09-06

The continuation starts at `61385c57` on `codex/vyakti-completion`.

## Product boundaries

- Vyakti is the company/lab. Rooms is the current external product direction.
- RelationalOS owns the reusable identity, memory, relationship and disclosure rules. A channel is transport, not a separate memory owner.
- Maya/Meera is the earlier companion and the engine's first implementation. Its display rename does not authorize changing internal IDs or its production deployment.
- Replica Lab/Studio owns creator evidence, identity, voice, review and calibration. Gurukul specializes the wider platform for teachers and students.
- Suites organize Rooms and billing; they do not combine private follower conversations.
- `Vyakti-GroupAI` owns the richer private/group Common Friend Kernel. The Rooms Handoff port is a subset behind a flag, not the whole runtime.
- `vyakti-website` owns the public site and research publication presentation. Its current source positions Rooms as the product and Meera as engine evidence; it has no application backend.

Read `docs/RELATIONALOS.md`, `docs/SURFACES.md`, `SPEC-GURUKUL.md` section 8, `HANDOFF-KERNEL.md`, and the website's `PROJECT_CONTEXT.md` together before changing these boundaries. GroupAI's latest journal, not its older README snapshot, carries migration-019 evidence and remaining launch gates.

## Baseline and local setup

Node 24.13.0, Windows, `npm ci`, a keyless `CI=1 node scripts/write-config.mjs --stub`, and `node evals/echosim/build.mjs` were used. No live database credential was set. The first release run failed 7 of 21 gates. Its layout and performance subprocesses also skipped for missing Chromium, so their outer `ok` lines were not browser evidence.

The machine's Git default was `core.autocrlf=true`. LF-only source assertions and the committed engine-bundle comparison failed against its CRLF checkout. The local checkout was normalized with no logical diff; `.gitattributes` now preserves LF for source and documentation on fresh checkouts. The engine freshness check and monthly-note suite then passed unchanged.

Set `CHROMIUM_PATH` to an installed full Chromium binary when Playwright's expected browser revision is absent. The Linux `/opt/pw-browsers` references in historical briefs describe the former container, not a Windows prerequisite. Use the font setup in `.github/workflows/release-gate.yml` when reproducing glyph checks.

`scripts/check-headers.mjs` now invokes npm's JavaScript entry point where available. On Windows, `execFile("npm", ...)` cannot execute npm's `.cmd` wrapper; that error had been misreported as registry failure. This change preserves literal arguments and does not add a shell.

## First fixes

Codex branches now receive release/APK checks. Only `codex/vyakti-*` joins the platform landing-page branch family. The separate companion production-deploy workflow is unchanged.

The fake payments provider derives references from the local subscription ID. Retrying that row keeps its reference; a new row after a halted mandate gets a new reference. An unkeyed call gets a fresh random reference. All three subscription-start lanes pass the ID. Reconciliation now exercises the actual returned reference rather than mutating its fixture to hide the old collision. This is the provider-reference part of R141, not completion of its SQL-evaluator work.

## Work still open

The ten wave-twenty briefs remain the application backlog; no wave is declared complete by these takeover fixes. The supplied handover records missing application deployment configuration and unproven owner voice likeness. Those need separate verification. No migration, paid provider call, GPU change, live configuration change or deployment has been performed here.

The context files contain historical open entries with later closure evidence, stale top-level branch/migration summaries, and superseding product decisions. Graph validity proves links exist, not that every old status is current. Read the latest dated evidence for a topic rather than interpreting the first match as today's state.
