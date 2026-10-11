# Common brief for every Vyakti workstream, wave twenty-two (2026-09-13)

You are building one workstream of Vyakti inside the repo checked out in your
worktree: a copy of raghavsharma2003/html-portfolio at the tip of branch
claude/vyakti-cloning-platform-aq05n4. That tip is the merged union of four
lines of work: the wave-era Rooms platform (WS-R1 to WS-R140, waves one to
nineteen, `context/STATE.md`'s session log), Codex's expert-studio work of
2026-09-06 to 09-09 (branch codex/handoff206: the personal studio
`src/studio/CloneExperience.tsx`, the teacher studio `src/creatorStudio/`, Azure
processing, private text rehearsal, text publication, memory correction,
migrations 137 to 162), the main loop's repairs of 2026-09-13 (the tree
deploys again, the gate is green), and wave twenty-one (WS-R151 to WS-R160,
merged the same day: HumanOS, EmotionOS, RelationOS in the Room, the
listening test, sentence-by-sentence voice replies, Deploy for a personal AI,
the Vyakti Android flavour, the personal journey rehearsed, the personal
studio in Hindi, the Room and the landing for any person). The main loop (Fable) merges your branch,
runs the gates again, applies migrations to the live Neon database, pushes,
and updates the PR. You do NOT push and you do NOT touch the live database.
You commit on your worktree branch with clear messages.

## The product in one paragraph (owner intent, 2026-09-13, binding)

Any person comes to Vyakti and builds an AI version of themselves: their exact
voice, and everything human about them (personality, behaviour, emotion, vibe,
how they treat each person they talk to), from their own context (a recording,
files, links, a channel, calls). They test it, tweak it and deploy it into the
world with no friction, on a phone or a desktop, because a person's AI will be
their online identity. Internally the human layer has three named systems the
person can see, test and edit: **HumanOS** (who they are: identity, values,
style, knowledge, never-say rules, voice), **RelationOS** (how it treats each
person: private memory per relationship, trust, register, rituals, check-ins,
handoff to the human), and **EmotionOS** (how it feels and expresses: vibe,
warmth, energy, humour, directness, the register it reads in the other person
and how it responds, prosody in voice). The first market is India (Hindi,
Hinglish, English, all three first-class). Everything the wave era proved
stays law: three scopes never blur (creator material flows down; a person's
words stay in their private scope; the owner sees only counts, n>=5); the
one door (gatedReply) for every reply; never the word "clone" in a
user-visible string (say "your AI", "<Name> AI"); an incomplete AI is an
"apprentice"; Readiness gates publishing; consent, AI disclosure, watermark
and human approval are invariants. Voice quality is the most important
single thing: a measured likeness score is a product feature, and no
likeness claim is ever made from a fixture.

## Read first, in this order

1. AGENTS.md and CLAUDE.md (laws: never claim what you did not run; offline
   mocks cannot type-check SQL; grep for a CALLER not a definition; honest
   states; write shapes never lines; the copy gate; never commit a secret).
2. context/STATE.md: the FIRST block ("WAVE TWENTY-ONE MERGED"), then the
   "2026-09-13 base" block and the wave-era START HERE that follow it. Codex's stacked "START HERE" blocks below it
   are historical candidates, not the current state; the 2026-09-13 block says
   which of them still hold.
3. context/rejected.md: search it for every concept you touch. Cite the
   entries you build against in your commit message.
4. docs/gurukul/DESIGN-LAW.md (binding UI standard) and DESIGN-SYSTEM.md;
   docs/gurukul/PRODUCT-JOURNEY.md's START HERE; docs/gurukul/research/
   VOICE-CLONE-PRODUCT-UX-2026-08-30.md (the binding Create/Wait/Meet/Improve
   journey).
5. docs/SURFACES.md and api/_surface.js (the one door); api/_agentscope.js
   and api/_disclosure.js (the scope laws); api/_room-surface.js (the Room);
   src/engine/compiler.ts (the persona compiler; the material block; the
   relationship, texture, self-arc and reciprocity renderers it composes).
6. The files named in your own brief.

## The map (so you do not rebuild what exists)

- Personal studio: `studio.html` -> `src/studio/main.tsx` -> `personalMain.tsx`
  -> `PersonalStudioEntry` -> `StudioApp.tsx` -> `CloneExperience.tsx` (record
  voice, upload saga, Meet: conversation / voice sample / private draft test;
  Add more: describe me, files, video, improve voice; Evolve: PersonModelStudio;
  Talk: MirrorCallStudio; Share: ExpertSharePanel -> text publication).
- Teacher/creator studio: `?mode=teacher|ops|setup` -> `src/creatorStudio/`
  (RoomStudio, TeacherSheetStudio, ReviewQueue, Readiness, Payouts, Suites,
  OpsBoard) with copy tables `copy.ts`, `hiCopy.ts`, `hiAuthCopy.ts`.
- The consumer surface: `room.html` -> `src/room/` (RoomApp, AccountPage,
  CheckinsPanel, HandoffPanel, SubscriptionPanel, TasteScreen) over
  `api/room.js` -> `api/_room-surface.js`; Telegram `api/room-tg.js`; WhatsApp
  `api/room-wa.js`; publish gate `api/_room-publish.js` (today it requires a
  PUBLISHED TEACHER SHEET, which is why a personal clone cannot open a Room).
- Engine: `src/engine/compiler.ts` (assembly), `persona.ts`, `relstate.ts`
  (honorific, trust, rupture/repair, code-switch, stage), `texture.ts`,
  `selfarc.ts`, `life.ts`, `reciprocity.ts`, `moment.ts`, `honesty.ts`,
  `expertTextCompiler.ts`, `privateExpertRehearsal.ts`; the generated server
  bundle `api/_engine.gen.js` (rebuild with `node scripts/build-engine-bundle.mjs`
  after ANY src/engine change; the gate's "engine bundle fresh" check fails
  otherwise).
- Person model: `api/_person-model.js`, `api/replica-person-model.js`, claims
  and citations (`vy_replica_claim*`), profiles (`vy_replica_profile`); the
  experience compiler boundary `api/_experience-compiler/`.
- Memory per relationship: `api/_room-memory-authority.js`,
  `_room-memory-consolidation.js`, `_room-memory-reclassification.js`
  (migrations 159, 162); the follower's own controls (memory_facts, correct,
  forget, classify) on the Room door.
- Voice: `api/_voice/` (allocation, preview authority, language conditioning,
  Hindi text frontend, providers), `api/_replica-voice-*.js`, `api/_voice-identity/`,
  `api/_replica-processing/` (the Azure processing pipeline, GPU admission),
  `services/` (azure-voice-app, azure-gpu-job, audio-protection, azure-verifier,
  azure-web, replica-processing-worker). Serving policy is Azure-only
  (`VYAKTI_MODEL_SERVING=azure_only`); vendor providers exist as retained
  transports but are refused by policy. Twelve archived comparison clips
  (Chatterbox and VoxCPM2, Hindi/Hinglish/English) and a sealed listening
  harness exist under docs/handoff/2026-09-09/evidence and evals.
- The relational kernel: `api/_relational-core.js` (ported from
  Vyakti-GroupAI's relational-core: disclosure acts, grants bound to policy
  version, deny always wins); Handoff v1 on it (`api/_handoff.js`).
- Gates: `node scripts/verify-release.mjs` is 24 checks (typecheck, prompt
  budget, workflow lint, Vercel upload boundary, deploy verifier, motion lint,
  brand reveal sound, board legibility, chrome copy, mirrored constants,
  enrollment sample rate, enrollment bandwidth, engine bundle fresh, stuck-turn
  endpoint, one voice, web build, layout readability, performance budgets,
  eval suite (the whole registry, ~410 suites, ~6 min), room leak battery,
  room export completeness, room door battery, accessibility, security
  headers), 26 with NEON_URL. Ports: layout 8931, performance 8932 (+8935),
  accessibility 8933, headers 8934, probe-live 8940, room-push 8941, day-one
  8946. ONE full gate per machine at a time; ten agents share this machine,
  so run only your touched suites (`node evals/run.mjs <key>`) while you
  build and the full gate ONCE at the end, in the foreground, with a timeout,
  waiting for a busy port with a bounded until-loop (never kill a process by
  pattern). If the full gate collides on a port, wait and rerun that check
  alone; a port collision is never a pass and never a failure of yours.
- Chromium: `/opt/pw-browsers` carries the installed build and revision
  folders that satisfy the lockfile's Playwright (1234 mirrors 1194). Never
  run `playwright install`. A suite that needs a browser SERVICE launches by
  channel with a control (rejected.md#room-push-chromium-headless-shell-shows-no-notification).

## Repo mechanics (binding)

- Worktree: `git log --oneline -1` must show the wave-twenty-two base named in
  your brief or a descendant; if not, `git reset --hard <base>` (safe) and
  re-read. Run `npm ci --no-audit --no-fund` first (a fresh worktree has no
  node_modules). Node here is 22; Vercel builds on 24.
- NEVER `git stash` (the stash stack is shared by every worktree). Never
  `git commit --amend` after a commit the main loop may have read. Run every
  command from your worktree's absolute path.
- Migrations: idempotent, ONE statement per request (Neon SQL-over-HTTP), no
  DO blocks, explicit ::uuid casts, no foreign key on agent/replica/owner/
  person columns (FK on room_id with on delete cascade is allowed), mirrored
  into db/schema.sql in numeric order, wired into the erasure cascade
  (api/_replica-full-erasure.js, PERSON_TABLES in api/memory.js, or
  OWNER_LANE_TABLES / OWNER_LANE_DELIBERATE_GAPS in api/_creator-export.js)
  and scripts/relcheck.mjs. Use ONLY the number your brief assigns; **167 is
  the next free number** and the briefs assign from there. The live database
  today carries 015 to 164 and 166 (100, 103, 117, 124, 131, 138, 157 and 165
  unused, 066 to 070 reserved), 207 `vy_` tables. In your final report list every new SQL statement so the
  main loop can EXPLAIN it live.
- Handlers are thin: HTTP shape in api/<name>.js, every decision in
  api/_<name>.js where a fake db can reach it. Every new door is wrapped by
  withDoor (evals/incidents fails by name otherwise); every new op is cased in
  evals/room-doors OP_COVERAGE and OP_INVOKE (the battery derives ops from
  source and fails by name on an uncased one); every new person-lane table
  gets a TABLE_ROLES entry in evals/room-leak/world.mjs.
- Every workstream ships an offline eval with at least one NEGATIVE control,
  registered in evals/run.mjs (append-only). Every source scanner reads
  through evals/lib/source-scan.mjs, never a raw substring over a file with
  comments.
- Front end: React + TypeScript; tokens from src/studio/design/tokens.css or
  src/creatorStudio/design/tokens.css (the same tokens); Devanagari through
  the bundled Noto Sans Devanagari; mobile 390px first, desktop 1280 second;
  both locales through the copy tables (a Room copy section goes into
  src/room/copy.ts's English table AND the matching Hindi file; a creator
  studio section into src/creatorStudio/copy.ts and hiCopy.ts; the personal
  studio has its own registry since WS-R159: `src/studio/copy.ts` and
  `src/studio/hiCopy.ts` through `useStudioLocale()` from
  `src/studio/localeContext.tsx`; a brief that adds a screen there adds its
  strings to BOTH tables as one closed block). A new
  screen state joins the layout and accessibility gates' fixture lists
  (`node scripts/check-layout.mjs --only <target>` on it alone).
- Copy: plain, functional, survives a read-aloud test; no em-dash or
  en-dash in a user-visible string (scripts/check-copy.mjs); never "clone",
  "model", "fine-tune", "replica", "weights", "embedding", "LoRA", "genome" in
  a user-visible string; "HumanOS", "RelationOS", "EmotionOS" are product
  names the owner chose and may appear as section names.
- Azure-only, no money: no GPU wakes, no paid API calls, no vendor calls, no
  network beyond 127.0.0.1 and npm. Build behind the existing seams, prove the
  seam offline with a fake, and say exactly what remains unproven. Never
  print or commit a secret; env var NAMES only, never values.
- Shared files are append-only so the main loop can merge mechanically:
  evals/run.mjs, context/*, db/schema.sql, vercel.json, the copy tables. When
  you add a section to an object or interface in a copy file, add it as its
  OWN closed block at the end, never inside the last existing one. Context
  files are unioned as ONE side plus the other side's diff from the merge
  base (scripts/merge-tools/context-union.mjs); pure appends only, never an
  edit in place; supersede with a new entry.
- Logging is not optional: before your last commit append to
  context/decisions.md (decision, rationale, reversal condition),
  context/measurements.md (every number with n, method, date; if you measured
  nothing say so), context/rejected.md (what you tried that broke), and
  matching nodes/edges at the END of context/graph.json's arrays (node shape
  {id, kind, title, at}; kinds: component, constraint, decision, measurement,
  open, rejection; edge shape {src, dst, rel}; write it with python
  `json.dump(..., indent=2, ensure_ascii=True)` plus a trailing newline), then
  `node scripts/context.mjs --check`. Append one paragraph to the SESSION LOG
  at the bottom of context/STATE.md; never a "Last updated" line in its header.
- Commit messages: what and why, citing rejected.md entries. No model names
  or AI attribution lines.
- Never end a turn waiting on a background monitor. Run your gate in the
  foreground with a timeout, commit, confirm `git status` is clean, and send
  your full final report in the SAME turn.

## Your final report (the main loop reads only this)

1. What you built, file by file, and what you deliberately did not.
2. Gate results (the summary lines of the full gate at the end; touched-suite
   counts).
3. Every new SQL statement (for EXPLAIN) and every new env var (names).
4. What is proven offline, what needs the live DB, what needs Azure or a human.
5. The context entries you added.

## What the wave-twenty-one merge taught (binding for this wave)

- A workstream that WIDENS a door's response shape updates every fixture that
  answers for that door in the same commit (`src/studio/layoutFixture.tsx`,
  `src/creatorStudio/layoutFixture.tsx`, `evals/rehearsal/harness.mjs`), and
  the component reads the new field with a guard. The deploy picker threw on
  a missing field and took three gates with it
  (rejected.md#wave-21-merge-gate-found-four-cross-workstream-breaks).
- Run `node scripts/check-layout.mjs --only studio` and `--only room` after
  `npx vite build` even when you touched only one side; the layout gate reads
  dist/ as it is and a stale dist/ reports a false "rendered almost nothing".
- A merge control freezes a PROPERTY, never a whole file
  (rejected.md#frozen-file-merge-controls-break-on-the-next-change).
- A comment never names a follower or thread table by name; the leak battery's
  legacy scan reads comments.
- A browser suite launches through `launchSuiteBrowser("<registry name>")`
  from `evals/rehearsal/browser.mjs` FIRST, before it reads dist/ or opens a
  port, so it skips honestly on the browser-less build workflow
  (rejected.md#direct-chromium-launches-crashed-the-browserless-build-job).
- Both call sites of `engine.compile()` pass the identical field set
  (evals/room-taste's control); a new compile input goes to both.
- Every gate target has a `mounted` selector; a target appended behind another
  keeps the other's closing lines intact (check with `node --check` and a
  scan for targets without `mounted`).
- The main loop merges under the fast checks and runs the full gate on the
  batch when ten agents share the machine; your own full gate still runs
  ONCE at the end, and a port collision is rerun alone, never reported as a
  pass or a failure.
