# WS-R150: Handoff on Telegram for the creator. A creator who linked a Telegram chat gets each new Handoff request as a message with the follower's exact bytes and answers by replying to it; the reply travels the same hash-bound answer path the studio uses, never the conversation log, and the follower is told on their own channel. Migration 138.

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

Handoff v0 puts the follower's request in a studio queue the creator opens
when they open the studio. A creator lives on their phone; the request
waits days. The relational kernel (WS-R87) already decides what may be
disclosed; the transport is what is missing.

Laws:
1. Read `api/_handoff.js` (the payload hash law, the answer write's
   `payload_sha256` predicate, the kernel evaluation behind
   `ROOM_HANDOFF_KERNEL`), `api/_creator-push.js`, `api/_room-telegram.js`
   (the follower's pointer, the bot), `api/_operator-telegram.js` (an
   owner-side chat pointer's shape) FIRST.
2. Migration 138: `vy_creator_telegram_chat` (owner lane: owner_user_id,
   replica_id, chat_id, linked_at, stopped_at), one chat per creator per
   replica as a unique index, no FK on owner or replica columns; the
   creator links it with a one-time code from the studio typed into the
   bot (`/link <code>`), the code stored only as a hash with a ten-minute
   expiry; OWNER_LANE_TABLES entry, erasure, relcheck, schema mirror.
3. On a new Handoff request the creator's chat gets the follower's exact
   bytes (the same `payload_text` the studio shows, hashed the same way)
   as a message whose reply-to is the request; the bot's inbound handler
   matches a reply to its request by the stored Telegram message id, runs
   the reply through the EXISTING answer write (the `payload_sha256`
   predicate, the kernel evaluation, the cap), and tells the follower on
   the channel they used (the existing follower notify path). A reply to
   nothing, a reply from an unlinked chat, or a reply to a request already
   answered is refused by name and writes nothing.
4. The leak battery's layer 19 (or 20 if R145 took 19): two creators' chats
   never see each other's requests, byte-checked; the door battery cases
   `/link`, the reply, and the studio's link op (forged, cross-owner,
   expired code, redelivered update); `evals/handoff` and
   `evals/room-telegram` extended in both locales.

## Build

- db/migrations/138_creator_telegram_chat.sql, db/schema.sql,
  api/_handoff.js, api/_room-telegram.js (the inbound branch and the send),
  api/_creator-telegram.js (new, the pointer), api/handoff.js (the link
  op), api/_creator-export.js, the erasure module, scripts/relcheck.mjs,
  src/studio HandoffPanel and copy tables (append-only).
- evals/handoff, evals/room-telegram, evals/room-leak (a layer),
  evals/room-doors, evals/creator-export.
- context/: decisions with reversal, measurements, rejections.
- Migration 138 only. No new env var.
