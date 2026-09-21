# Handoff to Codex, 2026-09-14: wave twenty-four is half built and paused

Repo `raghavsharma2003/html-portfolio`, branch `claude/vyakti-cloning-platform-aq05n4`,
PR #6 (draft). Start from the tip of that branch; everything below is on it.

## Where things stand

- **Waves one to twenty-three are merged, gated and pushed.** The last close
  is `e2da1f6` (2026-09-13): the gate passed 25 of 25, CI green on both
  workflows, migrations 015 to 164, 166, 167 and 170 live on Neon (100, 103,
  117, 124, 131, 138, 157, 165, 168, 169 and 171 unused). `context/STATE.md`'s
  first block ("WAVE TWENTY-THREE MERGED") is the current state; read it
  first, then `context/rejected.md`, then `CLAUDE.md` and `AGENTS.md`.
- **Wave twenty-four (WS-R182 to WS-R191) was opened at `23d320f`** with ten
  briefs under `docs/gurukul/waves/wave-24/` (read `ws-common.md` first; its
  last three sections carry the merge lessons of waves twenty-one to
  twenty-three). Ten agents built in parallel for about thirty minutes and
  all ten died at the session's rate limit with uncommitted work. Their
  in-progress trees are preserved here as patches against `23d320f`:
  `docs/handoff/2026-09-14/wave-24-wip/<branch>.patch`, one per workstream,
  with `INDEX.txt` listing files per patch. Nothing in them is gated,
  reported or merged. Where each stopped is in the table below.
- **Nothing is configured live.** Neither Vercel project has `NEON_URL`, a
  Supabase key or an Azure key set; no Azure credential exists for the voice
  program (`docs/gurukul/ENV-MANIFEST.md`, `docs/gurukul/DAY-ONE.md`). These
  are the owner's steps and the real critical path.

## Where each wave-24 workstream stopped (from its last message)

| workstream | patch | last known state |
|---|---|---|
| WS-R182 memory that grows on its own | `ws-r182-memory-that-grows-on-its-own.patch` | code and suites written (dialogue, memory authority, metered consolidation, sweep, meet-continuity, text-ready, room-leak, rehearsal step); was appending its STATE paragraph. Gate not run. |
| WS-R183 RelationOS for the person | `ws-r183-relationos-for-the-person.patch` | screen, door ops, migration `174_room_quiet_hours_default.sql` (NOT applied live), leak world entry, layout and accessibility targets written; both accessibility targets passed; was retrying the Hindi layout target. |
| WS-R184 EmotionOS test-and-tweak | `ws-r184-emotionos-test-and-tweak.patch` | replay op, TweakReply component, copy blocks, `evals/tweak-reply` written; was registering the layout fixture scenario. |
| WS-R185 sources at a glance | `ws-r185-sources-at-a-glance.patch` | list read, remove flow, SourcesStudio, copy, suite and rehearsal step written; check-copy clean; was about to run `rehearsal-personal`. |
| WS-R186 the visitor's first minute | `ws-r186-the-visitors-first-minute-on-a-phone.patch` | `evals/rehearsal/visitor-first-minute.mjs` written and registered pre-pool, one css fix; was writing rejections (a margin-trimming arithmetic error it found, a forget rate-limit discovery). |
| WS-R187 share your AI | `ws-r187-share-your-ai.patch` | share-kit person variant, `api/_share-kit.js`, DeployStudio mount, copy, suites written; was running the layout target `studio` (deploy-picker). |
| WS-R188 the voice program's dry run | `ws-r188-the-voice-programs-dry-run.patch` | `evals/rehearsal/voice-dry-run.mjs`, `scripts/voice-day-one.mjs`, `docs/gurukul/VOICE-DAY-ONE.md`, `evals/voice-day-one` written; context graph clean; was writing its STATE paragraph. |
| WS-R189 my data in one place | `ws-r189-my-data-in-one-place.patch` | person export rendering, MyDataStudio, erasure walk in the rehearsal, `evals/person-export` (68 checks passing); was retrying layout and accessibility targets under load. |
| WS-R190 the evals' same-tick sweep | `ws-r190-the-evals-same-tick-sweep.patch` | shared poll in `bounded-wait.mjs`, sweep over ~12 suites, `same-tick-scan` suite, continuity suites touched; both new suites pass through the registry; was running each three times. |
| WS-R191 the studio on a phone in Hindi | `ws-r191-the-studio-on-a-phone-in-hindi.patch` | Hindi pass and `hi-checks.mjs` written, two css fixes; was fixing two "Voice sample" tab selectors in the rehearsal. |

## How to resume a workstream

```
git fetch origin claude/vyakti-cloning-platform-aq05n4
git checkout claude/vyakti-cloning-platform-aq05n4
git worktree add .claude/worktrees/ws-r182 -b ws-r182-memory-that-grows-on-its-own 23d320f
cd .claude/worktrees/ws-r182 && git apply --3way ../../../docs/handoff/2026-09-14/wave-24-wip/ws-r182-memory-that-grows-on-its-own.patch
npm ci --no-audit --no-fund
```

Then finish the brief (`docs/gurukul/waves/wave-24/ws-r182-*.md`): touched
suites, every suite that reads a changed file (`grep -rl "<file>" evals/`),
context entries, the full gate once when `cat /proc/loadavg` is under 8
(`scripts/merge-tools/quiet-gate.sh`), commit, report. Run at most FIVE
workstreams at once and have each commit its work every hour; ten at once
exhausted the session limit before any finished
(`context/rejected.md#ten-parallel-agents-exhausted-the-session-limit-before-any-finished`).

## How the main loop merges (the procedure that held for three waves)

1. `git merge --no-commit --no-ff <branch>`; for each conflicted `context/*.md`
   run `node scripts/merge-tools/context-union.mjs <merge-base> <branch> <file>`;
   if it prints "not a pure append over base", STOP and resolve that hunk by
   hand (the follow-up rewrote its own paragraph: theirs replaces ours' first
   paragraph, the rest of ours stays). `python3 scripts/merge-tools/graph-union.py <branch>`
   for `graph.json`; `python3 scripts/merge-tools/keep-both.py <file>` for
   `evals/run.mjs` and `db/schema.sql`. Then `grep -l '^<<<<<<<' context/*.md
   context/graph.json evals/run.mjs` MUST be empty before `git add`.
2. Fast checks: `npx tsc -b --force`, `node scripts/build-engine-bundle.mjs`
   (stage `api/_engine.gen.js`), `check-prompt-budget`, `check-copy`,
   `check-mirrors`, `check-schema-mirror`, `check-workflows`, `node scripts/context.mjs --check`.
3. Every suite that reads a changed file, one per process
   (`node evals/run.mjs <registry-name>`; `evals/run.mjs` takes ONE name).
4. Every new SQL statement planned live with `EXPLAIN (FORMAT JSON)` and no
   `ANALYZE`, parameters bound (the Neon SQL-over-HTTP door; the connection
   string comes from the owner, never from the repo).
5. Commit the merge with what and why; never a model name in a commit.
6. After the batch: `scripts/merge-tools/quiet-gate.sh` once on a quiet
   machine; the eval suite is the slow check (about 7 minutes quiet).
7. Migrations live: one statement per request, idempotent, receipts kept;
   then `CLAUDE.md` and `AGENTS.md`'s migration line, STATE's START HERE
   block, `decisions.md` (with a reversal), `measurements.md` (n, method,
   date), `rejected.md`, `graph.json`; push; update PR #6's body.

## Laws that bind (short form; the long form is `AGENTS.md`, `CLAUDE.md`, `ws-common.md`)

Never commit or print a secret (env var NAMES only). Never `git stash`. Never
kill a process by pattern. Never `playwright install`. Never spend money
(Azure only, no vendor calls, no GPU wakes). Never "clone", "model",
"fine-tune", "replica", "weights", "embedding", "LoRA", "genome" in a
user-visible string. Never claim what you did not run. Three scopes never
blur. Every decision logged with its reversal, every number with n, method
and date, every dead end as a rejection.

## The Codex prompt

Paste this as the first message:

> You are continuing Vyakti in `raghavsharma2003/html-portfolio` on branch
> `claude/vyakti-cloning-platform-aq05n4` (check out its tip; do not start
> from any other branch). Read, in order: `docs/handoff/2026-09-14/CODEX-HANDOFF.md`,
> `context/STATE.md`'s first block, `context/rejected.md`, `AGENTS.md`,
> `CLAUDE.md`, `docs/gurukul/waves/wave-24/ws-common.md`. Wave twenty-four
> (WS-R182 to WS-R191) is half built: ten patches under
> `docs/handoff/2026-09-14/wave-24-wip/` against commit `23d320f`, one per
> workstream, each described in the handoff's table. Resume them five at a
> time in worktrees as the handoff shows, finish each brief, merge each under
> the handoff's procedure, run the batch gate on a quiet machine, apply
> migration 174 live only if WS-R183 keeps it (one statement per request,
> never destructive), push, update PR #6, and close the wave in `context/`
> exactly as the wave-twenty-three close did (`decisions.md#wave-23-merged-as-a-batch-with-plan-only-explains-at-the-merge`
> is the model). Every rule in `ws-common.md` and `AGENTS.md` binds; never
> push to another branch, never spend money, never print a secret, never
> claim a pass you did not see.
