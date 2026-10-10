# WS-R143: the Room's budgets from measurement. Every performance target's budget (LCP, TBT, JS bytes, the Hindi chunk wait, the first Hindi paint) is set from three idle-machine batches with its reversal named, the measurement method is one shared script that refuses to run above load 2, and the gate prints each target's margin so a regression is visible before it fails. No migration.

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

Budgets in `scripts/check-performance.mjs` were copied, raised under
contention, and once lowered from a measurement; the Room's own targets
got a per-target JS budget in WS-R139 but never an idle measurement. A
budget nobody measured is a number that fails on the wrong day.

Laws:
1. Read `scripts/check-performance.mjs` end to end, every budget constant
   and its comment, `context/decisions.md`'s `first-hindi-paint-*`,
   `ws-r113-*` and `ws-r139-*` entries, and `measurements.md`'s paint
   entries FIRST.
2. `scripts/measure-performance.mjs` (new): the same Chromium and CDP
   throttle as the gate, three batches of three runs per target, refusing
   to start unless the one-minute load average is under 2 (an until-loop
   with a bound, then a named refusal, never a silent run), writing a JSON
   table (target, metric, median per batch, min, max) the gate can read.
   Run it with the machine idle; log the whole table with n, load and date.
3. Every budget in `check-performance.mjs` becomes `max(measured p95 across
   batches) x 1.25`, rounded, with a dated comment naming the measurement
   entry, unless that would loosen a budget below its current value, in
   which case the tighter number stays and the entry says so; the JS byte
   budgets are `measured x 1.10`. The gate prints margin per target and
   metric ("LCP 1208 of 1500, 19 percent margin") on every run.
4. Never raise a budget the measurement does not justify; if a target
   cannot be measured under load 2 in this session, say so and leave its
   budget, with the reversal condition named.

## Build

- scripts/measure-performance.mjs (new), scripts/check-performance.mjs
  (budgets and margins), docs/gurukul or context for the table.
- evals/performance-budgets (new, small: the budget table parses, every
  budget names a measurement entry, the margin printer is pure).
- context/: decisions with reversal per budget, measurements (the table),
  rejections.
- No migration; no new env var.
