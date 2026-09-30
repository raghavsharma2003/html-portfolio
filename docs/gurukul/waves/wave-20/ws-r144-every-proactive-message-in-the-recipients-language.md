# WS-R144: every proactive message in the recipient's language. Every push, Telegram, WhatsApp template, weekly note, monthly note, digest and reminder builder is audited for its locale source; the ones that are English-only take the recipient's locale (the follower row, the creator's replica locale, the Suite admin's own preference, the operator's) through the copy tables, proven by a static scan that every builder's strings come from a locale table and a dynamic proof per channel in both locales. No migration.

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

The Room speaks Hindi. Does the push at 07:00? The weekly note to a
creator who chose Hindi? The Suite admin's Monday note? A follower who
chose Hindi and gets an English reminder learns the product's Hindi is a
skin.

Laws:
1. Enumerate every proactive builder from source: grep `title:`/`body:`
   builders in `api/_push/*`, `api/_creator-weekly-push.js`,
   `api/_org-weekly-note.js`, `api/_room-month-note.js`,
   `api/_operator-digest.js`, `api/_renewals.js`, `api/_dormancy.js`,
   `api/_checkins.js`'s deliverers, `api/_room-telegram.js`'s cards,
   `api/_room-whatsapp.js`'s template params; list them in a table in the
   decision entry with each one's locale source today (a named column, a
   fixed English string, or none).
2. One server-side copy table for proactive messages (`api/_notify-copy.js`,
   both locales, the vocabulary law and the dash rule apply, scanned by
   `check-copy` through a new scope) and every builder takes a `locale`
   argument resolved from the recipient's own row; an unknown locale is
   English by name. The operator digest stays English unless
   `OPS_OWNER_LOCALE` names Hindi (an existing env pattern; if none
   exists, English, and say so).
3. A static scan (`evals/notify-copy`, new, using evals/lib/source-scan.mjs)
   asserts no proactive builder carries a string literal longer than three
   words outside the table; a dynamic proof per channel renders both
   locales through the real builder and the real fixture recipient rows.
4. WhatsApp templates are named per language by Meta; the template name
   carries a locale suffix from the same table and the fixture proves the
   Hindi template is chosen for a Hindi follower.

## Build

- api/_notify-copy.js (new), the builders named, scripts/check-copy.mjs
  (one new scope, the existing law), evals/notify-copy (new), the channel
  suites extended (room-push, room-telegram, room-whatsapp, creator-push,
  org-weekly-note, room-month-note, renewals, room-dormancy).
- context/: decisions with reversal (the table of builders), measurements,
  rejections.
- No migration; no new env var unless the operator locale needs one (then
  name it in the manifest, never its value).
