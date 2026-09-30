# Common brief for every Vyakti workstream (2026-09-03)

You are building one workstream of Vyakti Rooms inside the repo checked out in
your worktree (a copy of raghavsharma2003/html-portfolio at the tip of branch
claude/vyakti-cloning-platform-aq05n4, which is the platform branch plus the
merged Rooms workstreams WS-R1..R140 (waves one to nineteen; read context/STATE.md's
session log for what each added): the Room at /r/<slug> (api/_room-surface.js,
migration 071), owner identity by voice (072), Readiness and the publish lock
(api/_readiness.js, 073), the review queue and never-rules (074), the interview
(075), vendor bench arms, publish-your-Room (api/_room-publish.js), the leak
battery (evals/room-leak, a release gate), drift watch (076), and the Rooms
vocabulary copy gate in scripts/check-copy.mjs which bans clone/replica/model/
fine-tune/train/weights/embedding/LoRA/genome in user-visible strings). The main loop (Fable)
merges your branch, runs the gates again, applies migrations to the live Neon
database, pushes, and opens the PR. You do NOT push and you do NOT touch the
live database. You commit on your worktree branch with clear messages.

## The product in one paragraph (Vyakti Rooms v1, 2026-09-02, adopted)

A creator brings their archive; the platform turns it into an AI version of
them ("your AI" to the creator, "<Name> AI" to a follower; NEVER the word
"clone" in any user-visible string). Every follower gets a private, continuing
relationship with it: it remembers them, checks in on them, and never reveals
them to anyone. Three scopes: creator material flows down to everyone; a
follower's words stay in their own private scope and never write to the
creator's persona and never reach another follower; the creator sees only
counts over an opt-in shared subgraph (n>=5, never verbatim). Readiness is one
number, five parts, one suggested action; publishing is locked below 70 overall
or 55 on any part. Free followers get 20 messages a month, no voice, no
check-ins. The word we use for an incomplete AI is "apprentice", never "broken".

## Read first, in this order, before writing code (30 minutes well spent)

1. AGENTS.md (whole file). Its laws are binding: never claim what you did not
   run; offline mocks cannot type-check SQL; grep for a CALLER not a definition;
   a plausible return hides a dead pipeline; honest states everywhere (blockers
   split into "waiting on you" / "waiting on us"); safety invariants never bend;
   write shapes never lines; the copy gate (no em-dash or en-dash in any
   user-visible string, scripts/check-copy.mjs); never commit a secret.
2. context/STATE.md, the START HERE block (lines 64-125).
3. context/rejected.md: search it for every concept you touch before you build.
   Obvious-good ideas in this repo are measurably wrong and the reasons are not
   guessable. Cite the entry you read in your commit message when relevant.
4. docs/gurukul/DESIGN-LAW.md (binding UI standard) and docs/gurukul/DESIGN-SYSTEM.md
   (tokens in src/studio/design/tokens.css). Feedback on pointerdown, springs
   not durations, interruptible motion, transform/opacity only, honour
   reduced-motion; no fake numbers, no filler, plain functional copy that
   survives a read-aloud test.
5. docs/SURFACES.md and api/_surface.js: every reply from any surface leaves by
   gatedReply(), the one door. A surface is a transport, never a tenant. Never
   add a second reply assembler.
6. api/_agentscope.js and api/_disclosure.js: the agent scopes the relationship;
   disclosure is a WHERE clause. db/migrations/009_* and 055_* state the laws.
7. The files named in your own workstream section.

## Repo mechanics you must follow

- Gates: `npm install --no-audit --no-fund`, then `CI=1 node scripts/write-config.mjs --stub`
  (creates the gitignored api/_config.js stub), then `node evals/echosim/build.mjs`
  once, then `node scripts/verify-release.mjs`. Run it on the UNTOUCHED tree
  first and record the result; any failure that reproduces untouched is
  environmental, not yours. Run it again at the end. Also `node scripts/context.mjs --check`
  and `node scripts/check-copy.mjs` if it is not already inside the gate.
- Node here is 22; Vercel builds on 24. Avoid Node-24-only APIs.
- Migrations: idempotent, ONE statement per request (Neon SQL-over-HTTP), no DO
  blocks, no functions, explicit ::uuid casts on every comparison, no foreign
  key constraints on agent/replica/owner columns (WHERE-clause binding, per
  009), mirrored into db/schema.sql, wired into the erasure cascade
  (api/_replica-full-erasure.js / PERSON_TABLES manifest as appropriate) AND
  scripts/relcheck.mjs's owner-lane reach walk. Use the migration number given
  in your workstream section; 066-070 are reserved for work another agent
  applied live but has not pushed, and 071-086 are taken and applied live
  (087 to 136 are live and merged, except 100, 103, 117, 124 and 131, which are unused; 137 is the next free number; wave seventeen briefs name the number each workstream may use, and a workstream never takes a number its brief did not give it. The gate is 21 checks without NEON_URL, 23 with it (layout on 127.0.0.1:8931, performance and the install check on 8932 and 8935, accessibility on 8933, security headers on 8934)). In your final report list every new SQL
  statement your API runs so the main loop can EXPLAIN it against the live DB.
- Handlers are thin: HTTP shape in api/<name>.js, every decision in
  api/_<name>.js where a fake db can reach it (see api/clone-chat.js over
  api/_clonechat.js). Add an offline eval under evals/ that drives the module
  with a fake db, with at least one NEGATIVE control that must fail.
- Front end: React + TypeScript under src/studio (creator) or the surface you
  are told; design tokens from src/studio/design/tokens.css; Devanagari via the
  existing Noto Sans Devanagari face; mobile 390px first. The layout gate
  (scripts/check-layout.mjs) renders the real signed-in studio; do not break it.
- Copy: "your AI", "<Name> AI", "apprentice", "Readiness", "Sounds right / Close,
  fix it / Never say this". Never "clone", "model", "fine-tune", "replica" in a
  user-visible string you add. Existing strings you do not touch can stay.
- Logging is not optional: before your last commit append to context/decisions.md
  (decision + rationale + reversal condition), context/measurements.md (every
  number with n, method, date; if you measured nothing say so), context/rejected.md
  (anything you tried that broke), and add matching nodes/edges to
  context/graph.json (append at the END of the arrays, ids prefixed with your
  workstream tag, e.g. "ws-r1-..."), then `node scripts/context.mjs --check`.
  Append one paragraph to the SESSION LOG at the bottom of context/STATE.md.
  Never add a "Last updated" line to STATE.md's header.
- Commit messages: what and why, cite rejected.md entries you built against.
  No model names or AI attribution lines in commit messages.
- Some worktrees get provisioned at the OLD commit 3a92179 (Meera main). Before anything else run `git log --oneline -1`; if it is not 77e0151 or a descendant, run `git reset --hard 77e0151` (safe: the stale base has no unique commits) and `git branch -m <your-tag>-<short-name>`, then re-read your files on that base.
- One release gate per machine at a time: the layout gate binds 127.0.0.1:8931; an EADDRINUSE there is a collision, wait a minute and rerun.
- Do not spend money: no GPU wakes, no paid API calls. If a step needs a live
  service you cannot reach, build it behind the existing seam, prove the seam
  offline with a fake, and say exactly what remains unproven.

- Context files are unioned at merge time by the main loop as ONE side plus the
  other side's diff from the merge base (scratchpad/context-union.mjs), never by
  concatenating both files (rejected.md#context-union-by-concatenation). Keep
  your context additions as pure appends at the END of each file so that union
  is mechanical; never edit an existing entry in place, add a superseding one.

## Your final report (the main loop reads only this)

1. What you built, file by file, and what you deliberately did not.
2. Gate results before and after (paste the summary lines).
3. Every new SQL statement (for EXPLAIN) and every new env var.
4. What is proven offline, what needs the live DB, what needs a human.
5. The context entries you added.

## Git in a worktree (binding, added 2026-09-04)

- NEVER run `git stash` in your worktree: the stash stack is shared by every
  worktree of this clone and two agents have already had their entries popped
  by a sibling (rejected.md#ws-r21-git-stash-is-shared-across-concurrent-worktree-sessions).
  For the untouched-tree baseline gate, run it BEFORE you change anything; if
  you must set work aside, commit a WIP commit and `git reset --soft HEAD~1`
  afterwards.
- Run every shell command from your worktree's absolute path; the shell's
  working directory does not persist between commands.
- Run `npm install --no-audit --no-fund` in your worktree first: a fresh
  worktree has no node_modules and the gate's typecheck fails with
  MODULE_NOT_FOUND until it does.

## Chromium in a gate (law since the CI run on 04395e2)

Chromium lives at `/opt/pw-browsers` on the build container (never run
`playwright install`). On a GitHub runner none of those paths exist and
Playwright's default headless launch is `chromium-headless-shell`, a build
with no notification or permission service. A gate that only renders may
fall through to the default; a gate that needs a browser SERVICE
(notifications, permissions, push, install prompts) must launch
`{ channel: "chromium" }` when no binary is named AND carry a control that
proves the service is present, failing by name. See
`context/rejected.md#room-push-chromium-headless-shell-shows-no-notification`.

## Never kill a process by pattern (law since wave fifteen)

`pkill -f verify-release`, `pkill -f chrome`, `pkill -f worktrees/ws-rNN`
and every other pattern kill reaches EVERY worktree's gate and the main
loop's release gate on this shared machine (wave fifteen: three agents'
pattern kills terminated the main tree's gate twice, EXIT 143). To stop
your own gate: run it in the foreground with a timeout so it dies with the
command, or record its PID (`node scripts/verify-release.mjs & echo $!`)
and `kill <pid>` that one. Port collisions on 8931-8935/8940/8941 are
sibling gates in flight: wait for the port to free (an until-loop on
`/dev/tcp/127.0.0.1/<port>`), never kill the holder.

## Never end a turn waiting on a monitor (law since wave sixteen)

Three wave-sixteen agents ended their turn to "wait for a Monitor or a
background task to notify" and never reported until the main loop nudged
them. Run every gate and check in the FOREGROUND with a timeout, then
commit, confirm the tree is clean, and send the full final report in the
SAME turn. A merge that adds an import between two `api/` files runs the
whole eval registry (`node evals/run.mjs` with no argument) before it is
called clean: a suite passing alone proves nothing about load order
(`context/rejected.md#ops-importing-self-check-closed-a-load-order-cycle-on-the-incident-kinds`).

## Copy-table hunks that start with a comment (law since wave eighteen)

When you append a section to `src/studio/copy.ts`, `hiCopy.ts`, `hiAuthCopy.ts`
or `src/room/copy.ts`, put the section's OWN closing `  },` on the line
before your leading comment is NOT enough: the merge tool inserts closers
for a both-appended hunk only when the hunk's first line is the section
key, so a hunk that begins with `  // WS-R...` or `  /** ...` loses the
previous section's closer at the merge (four times in wave eighteen). Begin
your appended block with the key line and put the comment INSIDE the
section (after the opening brace), never above it.
