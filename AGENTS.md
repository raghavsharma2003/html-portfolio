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
node scripts/verify-release.mjs      # 21 checks without NEON_URL; 23 with it
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

**Deploying: push, then probe.** Push before you deploy (`CLAUDE.md`'s own
law — the Vercel build pulls the full source from the GitHub branch), and
after every deploy run `node scripts/probe-live.mjs <base-url>` against the
result (`docs/gurukul/DEPLOY.md` Phase 6) — it checks, for free, that the
deployment actually serves what the tree promised.

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
owner-lane reach walk. **015 through 065 and 071 through 097 are applied live.
066-070 are deliberately unused** — another agent applied migrations under
those numbers live without pushing the files, so the live database already
carries six tables (`vy_replica_voice_preview_intent`,
`vy_replica_voice_build_intent`, `vy_replica_voice_reference`,
`vy_replica_claim_extraction_queue`, `vy_replica_claim_extraction_queue_item`,
`vy_replica_expression_observation`) that no file in this tree creates, and
leaving the range free is what lets that tree merge later without a
renumbering collision (`context/decisions.md#rooms-migrations-applied-live-in-the-union-order`).
**Every migration from 076 to 107 except 100 and 103 was read back from the
live catalog at its merge; `context/measurements.md` carries a
`rooms-migration-0NN-live-verification` entry for each. 100 and 103 are
deliberately unused (WS-R38's door battery and WS-R41's provider contracts
needed no schema change); 108 is the next free number.** Five legacy tables key `device_id` as TEXT, so
never assume a cast.

## Vyakti Rooms v1 — the adopted product definition (2026-09-02)

A creator brings their archive; the platform turns it into an AI version of
them — **"your AI"** to the creator, **"`<Name>` AI"** to a follower, and
**never** the word "clone" in any user-visible string. Every follower gets a
private, continuing relationship with it: it remembers them, checks in on
them, and never reveals them to anyone else. Three scopes, and they never
blur: **creator material** flows down to everyone who talks to the AI; a
**follower's own words** stay in that follower's private scope, never write
back into the creator's persona, and never reach another follower; the
**creator's view of followers** is counts only, over an opt-in shared
subgraph, `n>=5`, never a verbatim quote. Readiness is one number, five parts,
one suggested action; publishing is locked below 70 overall or 55 on any part.
An incomplete AI is called an **"apprentice"**, never "broken". The Room lives
at `/r/<slug>` (`api/_room-surface.js`, migration 071); the leak battery
(`evals/room-leak/run.mjs`) is a release gate that proves the three scopes
hold — 16,080 retrieval checks and 441 boundary checks, zero leaks, and it
never ships broken.

## The gate count and the vocabulary rule that ships with it

`node scripts/verify-release.mjs` is **21 checks** as of WS-R57
(2026-09-04) without `NEON_URL` — up from 14 with the addition of the room
leak battery, the room export completeness battery, the room door
battery (`evals/room-doors/run.mjs`, every way into a Room attacked offline
through the real decision modules the thin HTTP doors call), the
accessibility gate (`scripts/check-accessibility.mjs`, axe-core WCAG 2.1 A/AA
plus a keyboard walk over every follower and creator screen in both locales,
on 127.0.0.1:8933), the performance budget gate
(`scripts/check-performance.mjs`, the four public entry points measured in
real Chromium under CDP throttling shaped like a bad Indian 4G day on
127.0.0.1:8932, failing on a named target and metric), the mirrored-
constant gate (`scripts/check-mirrors.mjs`, WS-R42: every `// mirror of
api/<file>.js#<NAME>` marker in `src/` and `site/suites.html` parsed on both
sides and asserted equal) and the security headers gate
(`scripts/check-headers.mjs`, WS-R57: the Room, the studio and the four
static marketing pages loaded in real Chromium on 127.0.0.1:8934 with
`vercel.json`'s own `headers` array applied exactly as Vercel would and CSP
violation reporting captured — fails on any violation, any missing header
per route class, or a CSP looser than the workstream's own law — plus the
supply-chain half in the same file: `npm ci --dry-run` lockfile integrity,
`npm audit --omit=dev --audit-level=high` which FAILS rather than passing
silently if the registry is unreachable, and an install-script scan against
the named, justified allowlist in `scripts/installScriptAllowlist.mjs`) as
named gates — and 23 with it, adding the zero-orphan sweep and citation
discipline.
Migrations 071 through 099, 101 through 116 are applied live,
except 100 and 103, which are unused (WS-R38 needed no new migration, every finding it
fixed was a missing check in existing JS, never a schema change; WS-R41's
provider contracts needed none either); 102 (WS-R40, share arrival) and 104
(the creator-tier charge ledger, WS-R42) were applied live at their merges
and read back from the catalog. **118 is the next free number.**
`scripts/check-copy.mjs` also gates a **Rooms
vocabulary rule**: no `clone`, `replica`, `model`, `fine-tune`/`train`/
`training`, `weights`, `embedding`, `LoRA` or `genome` in any user-visible
string across `src/studio/`, `src/room/`, `site/vyakti.html`, `site/suites.html`,
`studio.html` or `room.html`. The only escape hatch is `scripts/roomsVocabAllowlist.mjs`,
scoped by name to the two files carrying legal text a person already
consented to under the old vocabulary (`DisclosurePreview.tsx`'s two verbatim
safety-floor quotes, four of `ModelConsentGate.tsx`'s `STATEMENTS`) — never a
blanket exemption, and never a new file added to it without naming the exact
consent artifact it protects.

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
