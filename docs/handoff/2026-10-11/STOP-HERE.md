# Vyakti checkpoint: October 11

Canonical repository: `raghavsharma2003/html-portfolio`.
Canonical branch: `claude/vyakti-cloning-platform-aq05n4`.

The accepted application source is
`323405659eeb717f6ff9d032c07a75d0fb884452` with source commitment
`sha256:c02fe734cdd27d26f1693f073e41d8d0222d466f29486e09b0a56deede380185`.
The next commit is documentation only. Do not run release helpers from its head:
they intentionally require a clean checkout of the exact accepted application
commit until deliberately rebound and revalidated.

## What is verified

- Node22 and Node24 release gates: 25/25 each. Android workflow: passed.
- The private CPU voice image is now
  `vyaktivoiceacr.azurecr.io/vyakti/internal-voice@sha256:d6ba0f1e2a70c8f8276097812b3a61296d705e0809898b14b9bb64aa449034ed`.
  The post-update health endpoint returned 200, with GPU, scale, ingress,
  identity, configuration and budget metadata unchanged.
- Migration173 passed actual development EXPLAIN and concurrency proof. The
  development database is not production.
- The old October9 protected preview remains the only deployed web release.

## What did not ship

- Production migration173: preflight was absent; its sole guarded apply rolled
  back before COMMIT after a post-DDL catalog mismatch. Independent readback is
  absent. Do not replay its consumed intent.
- No October10/11 Vercel preview exists.
- Voice likeness, fresh voice output, human sign-in completion, arbitrary-email
  delivery, paid conversion, PMF and competitor superiority are unmeasured.

## Isolated work to preserve

`codex/vyakti-azure-authmail-oct10` is pushed at
`f7781cc3b64df3fb96d4e445580b84104f680a39`, with its recovery checkpoint at
`9a8ac6b36fb0d4b9e0f1887f5167dc96c756c393`. It contains the native Azure email
WIP and the bilingual publication design pass. Azure Email and Communication
resources exist, but no resource key or Vercel binding has been written, no
shared Supabase SMTP/hook has changed and no email has been sent. The code
remains dark by a server flag. It needs migration174 development proof, full
release checks and a bounded real delivery test before activation.

## Non-negotiable scope

Vyakti only. Do not alter Maya, Meera or another product. Keep Azure-only
serving, existing pilot budgets, no personal Microsoft login on this laptop and
no reuse of expired owner voice grants. The global database check still reports
36 external legacy Meera pointers; it is not globally green.

Read `context/STATE.md`, `context/rejected.md`, `context/decisions.md` and
`context/measurements.md` before any resume. The immediate safe work is
read-only diagnosis of the migration173 catalog mismatch, not a retry.
