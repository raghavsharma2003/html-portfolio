# WS-R147: the flake ledger. Every suite that failed on a re-run-passes basis this build (rehearsal-creator, registry-runner's timing self-test, day-one's fixed port, probe-live's fixed port) is made deterministic at its cause or moved off a fixed port; a weekly CI job runs the whole registry three times and writes a flake ledger the release gate reads, failing by name on any suite that flaked twice in a row without an entry in `context/rejected.md`. No migration.

Read scratchpad ws-common.md FIRST; every rule there binds, including the laws
at its end (never kill a process by pattern; a Chromium gate that needs a
browser service launches the full build by channel and carries a control;
never end a turn waiting on a monitor, report in the same turn; never run
git stash). Your worktree is already checked out at the wave-twenty base
named there, 77e0151 (verify with `git log --oneline -1`). The gate is 21
checks without NEON_URL (23 with it); do not change the gate-count
paragraphs of CLAUDE.md or AGENTS.md unless your section says you add a
gate. The wave-twenty siblings building beside you: R141 the payments and
renewals fixtures execute the real predicates, R142 the quiet-hours
backfill and the check-in panel's inputs, R143 the Room's budgets from
measurement, R144 every proactive message in the recipient's language,
R145 the personal link on every channel, R146 rate-limit coverage as a
property, R147 the flake ledger, R148 the review queue at scale, R149 Suite
seat invites (migration 137), R150 Handoff on Telegram for the creator
(migration 138). Migration numbers are ASSIGNED; never take another. Keep
your edits inside the files your section names, and append-only in shared
files (evals/run.mjs registry, context/*, db/schema.sql, vercel.json, the
copy tables) so the main loop can merge mechanically; when you add a
section to an object or an interface in a copy file, add it as its OWN
closed block at the end, never inside the last existing one. The studio's
Hindi table is two files (`hiAuthCopy.ts`, `hiCopy.ts`); the Room's is two
files too since WS-R139 (`src/room/hiTalkCopy.ts` for the talk screens,
`src/room/hiCopy.ts` for the rest), each throwing by section until the
loader installs it, so a Room copy section you add goes into `copy.ts`'s
English table AND the matching Hindi file. The leak battery's layers run 1
to 18, add yours as 19; the door battery derives doors by a two-hop import
walk, fuzzes every op's body shapes and orders every scenario, and fails by
name on any op, format or door without coverage, so case every op you add
in OP_COVERAGE and OP_INVOKE; every door is wrapped by withDoor and
evals/incidents fails by name on one that is not; every source scanner
reads through evals/lib/source-scan.mjs's tokenizer, never a raw substring
over a file with comments. Every Room reply lane hands gatedReply the
creator's never-rules through roomNeverRules(); the compiler wraps creator
material in the material block; the push contract is {t, title, body,
url}; every cron and owner door reads its secret from a header only; the
follower's own time zone and quiet hours live on vy_room_follower and
`api/_quiet-hours.js` is the ONE fragment every proactive due-select
splices. A MODULE-SCOPE read of another api module's export inside an
import cycle is a crash only some entry points see: never add an import
between two `api/` files without running the whole registry (`node
evals/run.mjs` with no argument) afterwards. No money: no GPU wakes, no paid
API calls, no network beyond 127.0.0.1 and npm unless your section says
otherwise. Every new person-lane table needs a TABLE_ROLES entry in
evals/room-leak/world.mjs, a PERSON_TABLES entry with its lane in
api/memory.js, a roomForgetCore delete and a ROOM_EXPORT manifest entry
with a readable sentence in both locales, or an OWNER_LANE_TABLES or
deliberate-gap entry in api/_creator-export.js if it is owner-lane; a
migration is one statement per request, idempotent, no DO blocks, explicit
::uuid casts, no FK on agent/replica/owner/person columns (an FK on room_id
with on delete cascade is allowed), mirrored into db/schema.sql in numeric
order, wired into the erasure cascade and scripts/relcheck.mjs. A scenario
that reaches a screen state no fixture reached before is a NEW SCREEN: run
`node scripts/check-layout.mjs --only <target>` on it alone and read every
finding. Chromium is pre-installed at /opt/pw-browsers; never run
`playwright install`; a suite that launches it uses
evals/rehearsal/browser.mjs's launcher. Run your gate in the FOREGROUND
with a timeout, never kill anything by pattern, wait for a busy port with
an until-loop, COMMIT on your branch, confirm with `git status` that the
tree is clean, and send your full final report in the SAME turn.

## Product

Under a loaded machine, four suites failed on timing or a fixed port and
passed on retry. A gate that is retried is a gate that will be ignored.

Laws:
1. Read `evals/run.mjs` (the pool, `PORT_LANE_SUITES`), `evals/runner-lib.mjs`,
   `evals/registry-runner/run.mjs`, `evals/day-one/run.mjs` and
   `evals/probe-live/*` (port 8945/8940), `evals/rehearsal/creator.mjs`'s
   readiness wait, and every `rejected.md` entry naming a flake FIRST.
2. Fixed ports go: `day-one`, `probe-live` and `room-push` bind port 0 and
   pass the bound port to their fixture servers (the layout, performance,
   accessibility and headers gates keep their ports, they are gates not
   suites, and their runner already waits); `PORT_LANE_SUITES` becomes
   empty or names only what truly must be serial, with the reason.
   `registry-runner`'s timing self-test asserts ordering, never wall-clock
   deltas.
3. `.github/workflows/flake-ledger.yml`: weekly and on demand, runs
   `node evals/run.mjs --serial` three times and the parallel mode three
   times on the runner, writes `evals/flake-ledger.json` (suite, mode,
   pass count of six, the failing assertion's name) as a workflow artifact
   and a commit-free summary; `scripts/verify-release.mjs` gains no new
   named gate; instead `evals/run.mjs` reads a committed
   `evals/flake-allowlist.json` (suite, rejected.md anchor, expiry date)
   and fails by name on a suite that failed twice in one run without an
   entry, so an unexplained flake is a failure.
4. Measure: run the whole registry six times on this machine (three each
   mode) with load logged; the ledger for this session is the measurement.

## Build

- evals/run.mjs, evals/runner-lib.mjs, the three suites named, evals/rehearsal/creator.mjs
  only if its wait is the cause, .github/workflows/flake-ledger.yml (new),
  evals/flake-allowlist.json (new), scripts/check-workflows.mjs if the lint
  needs the new job's shape.
- context/: decisions with reversal, measurements (the six runs),
  rejections.
- No migration; no new env var.
