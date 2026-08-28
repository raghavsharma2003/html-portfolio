# AGENTS.md — start here, whatever tool you are

This is the tool-neutral entry point for Vyakti. Codex, Cursor, Aider, a human,
or Claude Code: read this first. `CLAUDE.md` carries the same rules in Claude
Code's own format; if the two ever disagree, they are both wrong and the files
under `context/` win.

## Read in this order, and do not skip step 1

1. **`context/STATE.md`** — one page: what the product is, what is verifiably
   LIVE versus not, and the laws not to relearn. **Read its "START HERE" block
   first**; it is dated and it wins over anything below it in that file, which
   is older and partly superseded. It will save you hours.
2. **`context/rejected.md`** — read BEFORE proposing anything. Several
   obviously-good ideas here are obviously good and also measurably wrong, and
   the reasons are not guessable. This is the highest-value file in the repo.
3. **`context/decisions.md`** — what was decided, why, and what evidence would
   reverse it. A decision without a reversal condition is dogma; if you add
   one, give it a reversal condition.
4. **`context/measurements.md`** — every measured number, with n, method and
   date. A number without those cannot be compared to a future one.
5. **`context/graph.json`** — the machine-readable index of all of the above.
   Query it with `node scripts/context.mjs` (no args lists everything,
   `--node <id>` shows one with its edges, `--check` validates it).

Product specs live in `docs/gurukul/`: `SPEC-GURUKUL.md` is the map,
`ROADMAP-100X.md` the build order, `DESIGN-LAW.md` the binding UI standard,
`MIRROR-CALL-SPEC.md` and `PRODUCT-JOURNEY.md` the two live feature specs, and
`research/` the sweeps behind the decisions.

## What this product is, in three sentences

Anyone gives the platform their own context (files, links, a video, a call) and
gets an AI version of themselves: mind, voice, relation, long-term memory of
each person it talks to, plus a measured guarantee it still sounds like them.
The studio is a three-step wizard — **Feed it, Meet it, Deploy it** — and the
middle step is the product: interact with the clone, correct it, watch it
improve. Edtech (JEE teachers to students) is the first vertical, not the
boundary.

## The gates. Everything must pass before anything ships

```
node scripts/verify-release.mjs      # 16 checks; 14 without NEON_URL
node scripts/context.mjs --check     # the memory graph must stay consistent
```

The count grows as gates are added, so trust the runner rather than this
number. Recent additions worth knowing because they encode expensive lessons:
layout readability (renders the real signed-in studio, not a signed-out shell),
the enrollment sample-rate mirror (four files name that rate and must agree),
and enrollment bandwidth (a band-limited reference can never again reach the
voice model silently).

`npx vite build` alone is NOT a gate: it exits 0 with type errors.

Notes that will otherwise cost you an hour:
- The two relational DB gates only run when `NEON_URL` is in the environment.
  Without it they print a skip, and `relcheck` is a hard gate wherever a URL is
  reachable.
- `api/_config.js` is gitignored and holds every key. Without it the `eval
  suite` gate fails on an import error. That failure is environmental. Confirm
  any failure reproduces on the untouched tree before attributing it to your
  change.
- `evals/echosim/build.mjs` must have been run once or the `stuck-turn` gate
  fails on a missing artifact. Same rule: check the untouched tree first.

## The laws. These are not style preferences

- **Never claim what you did not run.** A truthful "did not run, here is the
  wall I hit" is a good outcome. A plausible number from a mock is not.
- **Offline mocks cannot type-check SQL.** A mocked database proves control
  flow, not types and not referential integrity. `EXPLAIN` against the real
  database is the only parser available; three shipped queries were once 0A000
  and had never executed.
- **A capability complete at both ends can still be dead.** Grep for a CALLER,
  not a definition. The owner's upload sat untouched for hours because a
  complete job runner had no caller and no cron.
- **A plausible return hides a dead pipeline.** Prefer an error to a believable
  value. A malware scan that cannot run must never report "clean".
- **Honest states everywhere.** Never blame the user for a platform failure:
  blockers split into "waiting on you" and "waiting on us", and that split is
  enforced by a test with a negative control.
- **Safety invariants never bend for a green screen.** Every generated clip
  carries a spoken AI disclosure and a PerTh watermark; consent is a SQL
  predicate, never a prompt instruction; a persona never self-updates without
  an explicit human tap.
- **Write shapes, never lines.** Anything sentence-shaped in a prompt gets
  recited verbatim. Position is mechanism: a rule appended last fired 8 times
  in 8; buried mid-brief, 0 in 8.
- **The copy gate bites.** No em-dash or en-dash in any user-visible string,
  plus a list of AI tells, enforced by `scripts/check-copy.mjs` with 14
  negative controls. Code comments and `context/` prose are unaffected.
- **Never commit or print a secret.** `api/_config.js` is deployed as part of
  the Vercel payload and must never be committed.

## Migrations

Idempotent, one statement per request (Neon SQL-over-HTTP allows only one),
no DO blocks, explicit `::uuid` casts on every comparison, mirrored into
`db/schema.sql`, and wired into the erasure cascade AND `scripts/relcheck.mjs`'s
owner-lane reach walk. **058 through 063 are applied live; 064 is the next free
number.** (063 is `replica_self_test_mode`, verified live 2026-08-27.) Five legacy tables key `device_id` as TEXT, so never assume a cast.

## Logging your work is not optional

Before your next phase starts, append to `context/`:
- a **decision** with its rationale AND what evidence would reverse it;
- a **measurement** with n, method and date;
- a **rejection** naming what was tried and what specifically broke. This is
  the highest-value entry type and the one most often skipped.
Then run `node scripts/context.mjs --check`. If it is not logged, it did not
happen, and the next agent pays for it again.

## The one open problem, as of 2026-08-27

**The clone does not sound like the owner.** Their words: "not even 0.05%
similar", and the base voice is "very western and not indian". Everything else
in this product now works. This does not, and it IS the product.

Read `context/STATE.md`'s "START HERE" block before touching any of it. The
short version, all measured rather than argued:

- **Cloning IS happening.** Three references, three different outputs. Do not go
  hunting for a disconnected wire; the fault was reference QUALITY.
- **The enrollment reference was 8 kHz audio wearing a 24 kHz label**, 0.000458%
  of energy above 8 kHz. Two causes: a 16 kHz speaker-SEPARATION model run
  unconditionally on recordings with nobody to separate, and the 16 kHz
  window-SCORING bytes being reused as the DELIVERED reference. Fixed in `api/`,
  merged, measured at 0.0224% after.
- **The fix is not live**: the processing Job has not been rebuilt.
- **No speaker-similarity number exists for the owner's clone.** Only bandwidth
  has been measured, and bandwidth is not likeness. The ceiling is 0.8869.
  Do NOT dress a proxy metric up as fidelity; report the wall instead.

## Owner decisions currently outstanding

These are the owner's to make; do not make them unilaterally and do not spend
their money without being asked.
1. **YouTube route.** Audio extraction from a datacenter IP is blocked and every
   free lever is measured out. A residential proxy (about $0.077 per 15-minute
   lecture) is recommended and unpurchased. One env var switches it on. The
   owner has said to skip YouTube for now.
2. **Keeping the GPU warm.** `vyakti-open-voice` has `minReplicas=0`. Warm it
   answers in about 54 s; cold it has exceeded 200 s, and the studio panel gives
   up at 180 s, which equals the top of its own advertised estimate. Raising
   `minReplicas` bills continuously for a GPU. Do not do it unasked.
3. **Key rotation** for everything ever pasted into a chat transcript, now also
   including an ACR pull password fragment and the `REPLICA_SELF_TEST_MODE`
   consent rows written on 2026-08-26. Those rows are tagged in `metadata` and
   `scripts/revoke-self-test-grants.mjs` reverses all of them; they MUST be
   revoked before any non-owner uses this product.

The two Vercel audio-protection vars that used to be listed here are DONE.
