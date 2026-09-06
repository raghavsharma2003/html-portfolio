# WS-R149: Suite seat invites. A Suite admin issues an invite link per seat; a creator who opens it while signed in accepts membership and attaches one of their published Rooms in one flow, with the seat counted inside the same statement that attaches; the invite is stored only as a hash, expires, and is spent once; the admin's board shows open invites and the Monday note counts them. Migration 137.

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

A Suite admin today buys seats and then has no way to bring a creator in
except by the creator finding the Suite themselves. The institute's
onboarding is a link in a WhatsApp group.

Laws:
1. Read `api/_org.js` (`attachRoom`'s predicate, membership writes,
   `orgBoard`), WS-R23's invite table and its sha256-only law, WS-R47's
   creator invites, and `api/_org-weekly-note.js` FIRST.
2. Migration 137: `vy_org_seat_invite` (invite_id, org_id, code_hash
   unique, created_by_user_id, expires_at, redeemed_at, redeemed_by_user_id,
   room_id nullable, created_at); no FK on org_id or user columns; owner
   lane (OWNER_LANE_TABLES or a deliberate-gap entry); wired into the
   org's erasure path and relcheck; mirrored into db/schema.sql.
3. Issue: an admin op that mints a code shown once and stores the hash,
   expiring in fourteen days, at most as many open invites as free seats
   (the count inside the INSERT's own CTE, WS-R47's shape). Redeem: a
   signed-in creator posts the code and a Room id; one statement family
   marks the invite redeemed, inserts the accepted membership and attaches
   the Room through the EXISTING `attachRoom` predicate (seat cap, admin
   exists, creator membership) so a full Suite refuses by name and spends
   nothing; a second redeem is a no-op by the WHERE; an expired code
   refuses by name.
4. The Suite board lists open invites with expiry and a revoke op; the
   Monday note (WS-R127) counts open invites; the `/suites` page mentions
   the flow in both locales; the door battery cases issue, redeem and
   revoke (forged, cross-org, expired, spent, oversized); `evals/org`
   proves the seat count inside the redeem and the negative controls.

## Build

- db/migrations/137_org_seat_invite.sql, db/schema.sql, api/_org.js,
  api/org.js, api/_org-weekly-note.js, api/_creator-export.js, the erasure
  module and scripts/relcheck.mjs, src/studio SuiteCard and the copy
  tables (append-only), site/suites.html (a sentence in both locales).
- evals/org, evals/org-weekly-note, evals/room-doors, evals/suites-self-serve.
- context/: decisions with reversal, measurements, rejections.
- Migration 137 only. No new env var.
