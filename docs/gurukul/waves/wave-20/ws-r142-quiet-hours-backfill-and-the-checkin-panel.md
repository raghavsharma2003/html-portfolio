# WS-R142: the quiet-hours backfill and the check-in panel's inputs. Existing check-in windows are copied onto the follower's own row once, idempotently, by a sweep that never overwrites a value the follower set; the check-in panel's two native time inputs are replaced with the validated text fields WS-R131 proved keyboard-safe, and the check-in screen joins the accessibility gate's screens list so the Tab-stop trap cannot return unseen. No migration.

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

WS-R131 gave the follower one clock but left every existing schedule's
window where it was and named the panel that still carries the input
that ate Tab stops. A follower who set quiet hours on a check-in last
month should see them on their account page today, and a keyboard user
must reach every control on the check-in screen.

Laws:
1. Read `api/_checkins.js`, `api/_room-surface.js#roomSetQuietHours`,
   `src/room/CheckinsPanel.tsx`, `src/room/AccountPage.tsx`'s new control,
   `context/rejected.md#ws-r131-native-time-input-eats-tab-stops-in-headless-chromium`
   and `scripts/check-accessibility.mjs`'s screens list FIRST.
2. The backfill: one UPDATE over `vy_room_follower` from the follower's
   most recently updated active check-in that carries a window, only where
   the follower row's `quiet_from`, `quiet_to` and `timezone` are all null
   (never overwriting a value the follower set), as a named step inside
   the existing daily check-ins sweep with a heartbeat, idempotent by its
   own predicate; a static scan proves the statement carries the
   all-null guard; the fixture proves a second run changes zero rows and a
   follower who set their own window is untouched.
3. `CheckinsPanel.tsx`'s time inputs become the same validated text fields
   as the account page (one shared component, `src/room/TimeField.tsx`),
   both locales through the copy tables; the check-in screen (`room:checkins`
   and `room-hi:checkins`, the layout gate's existing fixture) joins the
   accessibility gate's screens list; the keyboard walk reaches every
   control; a NEGATIVE CONTROL reproduces the old native input on a fixture
   and asserts the walk strands, so the trap is pinned by name.
4. `evals/checkins`, `evals/quiet-hours`, `evals/room-account` extended; the
   door battery cases nothing new (no new op).

## Build

- api/_checkins.js (the backfill step), src/room/TimeField.tsx (new),
  src/room/CheckinsPanel.tsx, AccountPage.tsx (uses the shared field),
  copy tables (append-only), scripts/check-accessibility.mjs (screens
  list), evals/checkins, evals/quiet-hours, evals/room-account.
- context/: decisions with reversal, measurements, rejections.
- No migration; no new env var.
