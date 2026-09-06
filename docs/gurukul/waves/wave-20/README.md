# Wave twenty: the briefs, unbuilt

Wave twenty was planned and its ten agents were launched on 2026-09-06 over
`77e0151`, then the owner ended the session before any agent had written a
file. Nothing from this wave exists in code. These briefs are the whole plan.

How the waves were run (nineteen waves, WS-R1 to WS-R140, all merged and
gated; see `context/STATE.md`'s wave-close paragraphs):

1. Read `ws-common.md` (the shared rules every workstream obeys), then one
   brief per workstream. Migration numbers are assigned in the briefs and
   in the brief header: **137 (R149) and 138 (R150)**; every other brief needs
   none. 137 is the next free number in the live database.
2. One worktree per workstream off the current head of
   `claude/vyakti-cloning-platform-aq05n4`:
   `git worktree add -q -b ws-r141-<slug> .claude/worktrees/ws-r141 <head>`.
   Ten agents in parallel, each confined to its own worktree, append-only in
   shared files (the eval registry, `context/*`, `db/schema.sql`,
   `vercel.json`, the copy tables).
3. Merge one at a time under the full gate: `git merge --no-commit --no-ff
   <branch>`; for a conflicted append-only context file run
   `node scripts/merge-tools/context-union.mjs <base> <branch> <file>` (one
   file per call; base = the wave's fork commit); `python3
   scripts/merge-tools/graph-union.py <branch>` for `context/graph.json`;
   `python3 scripts/merge-tools/keep-both.py <file>` for both-added hunks
   (registry entries, imports); `python3 scripts/merge-tools/keep-both-copy.py
   src/studio/copy.ts` for copy-table sections (it misses a closer when
   theirs starts with an indented comment; insert `  },` by hand). Reorder
   `db/schema.sql` blocks into numeric order by hand. When two siblings pick
   the same leak-battery layer number, renumber one. Then per-file
   `node --check`, `npx tsc -b`, `node scripts/check-copy.mjs`,
   `node scripts/check-mirrors.mjs`, the touched suites via
   `node evals/run.mjs <key>`, the whole registry (`node evals/run.mjs`, about
   150 s) after any merge that adds an import between two `api/` files, and
   `node scripts/verify-release.mjs` (21 checks without `NEON_URL`, 23 with).
   `scripts/merge-tools/gate-retry.sh` runs the gate and retries only on a
   port collision (ports 8931 to 8946 are the gates' fixed ports).
4. Apply each merged migration live one statement per request, read the
   catalog back, and `EXPLAIN` (never `EXPLAIN ANALYZE`) every new statement
   the module issues; log the plans in `context/measurements.md`.
5. Close the wave: a STATE paragraph, the measurement entry, graph nodes with
   `measured_by` edges, `node scripts/context.mjs --check`, commit, push, and
   the PR #6 body's wave section (the body is capped at 65,536 characters).

Open items wave twenty was built against are the last sentence of STATE's
wave-nineteen paragraph.
