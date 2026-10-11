# WS-R141: the payments and renewals fixtures execute the real predicates. The fake databases under `evals/payments`, `evals/renewals`, `evals/org-billing` and `evals/payments-reconcile` re-implement writes in JS and so never exercise WS-R140's `NO_REGRESSION_MARKER` and `REMINDER_ELIGIBILITY_MARKER` guards, the mandate CASEs or the restart CTE; they now run the real SQL text through an in-process SQL evaluator over the fixture rows, so a predicate the module carries is a predicate the fixture proves. The fake provider's deterministic subscription ref becomes unique per call. No migration.

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

WS-R140 found the gap by name: the fixtures reimplement the write in JS
without the marker check. A guard that lives only in the SQL string is a
guard no offline suite has ever executed; the live database is the only
thing that has, and it has never had a row.

Laws:
1. Read the four fixtures' fake dbs, `evals/room-leak/world.mjs`'s
   matcher style, `evals/room-doors/fixtures.mjs`, and `context/rejected.md`'s
   `offline-mocks-cannot-type-check-sql` FIRST. Then read how the world
   layer routes SQL to handlers: the pattern is regex-per-statement, which
   is exactly why a predicate change never fails a fixture.
2. Build `evals/lib/sql-eval.mjs`: a small evaluator for the subset of SQL
   these modules use (select/insert/update/delete over one or two tables,
   where with and/or/not, comparisons, `in`, `is null`, `exists` over a
   single-table subquery, `coalesce`, `case when`, `now()`, `returning`,
   `on conflict do update/nothing` on a named unique key, `with ... as`
   CTEs chained in order). It does not need to be complete: it must refuse
   by name (throw with the statement) on anything it does not understand,
   so a fixture that hits an unsupported shape fails loudly rather than
   silently returning rows. Every statement `api/_payments.js` and
   `api/_renewals.js` issue must parse; a self-test suite
   (`evals/sql-eval`, new) proves each construct with a negative control.
3. The four fixtures route the real statements through the evaluator over
   their row arrays (the world layer's own arrays where one exists); the
   JS reimplementations are deleted, not kept beside. WS-R140's order
   battery's scenarios run again through the evaluator and the two guards
   are proven as executed SQL: a stale webhook's UPDATE matches zero rows;
   a reminder INSERT after a cancel matches zero rows; a struck guard (the
   marker removed from a copy of the text) matches, as the negative
   control.
4. `api/_payments.js`'s fake provider mints `provider_subscription_ref`
   from a counter or a uuid, never from `(label, ref, price)` alone
   (`rejected.md#ws-r132-fake-provider-deterministic-ref-collides-on-a-genuine-restart`);
   the restart scenario proves two refs differ.

## Build

- evals/lib/sql-eval.mjs (new), evals/sql-eval/run.mjs (new), the four
  fixtures named, evals/room-doors/order.mjs (route through the evaluator
  where it reimplements a write), api/_payments.js (the fake ref only),
  evals/run.mjs.
- context/: decisions with reversal, measurements (statements parsed,
  constructs supported, fixtures converted), rejections.
- No migration; no new env var.
