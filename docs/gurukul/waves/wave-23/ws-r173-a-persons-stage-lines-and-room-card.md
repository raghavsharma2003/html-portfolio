# WS-R173: a person's stage lines and Room card. The compiled prompt's stage lines stop saying "teacher" for a person, and the Room's picture (OG card, story card, poster) names the person and their own disclosure. No migration.

Read scratchpad w23/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-three base <WAVE23_BASE> (verify with `git log
--oneline -1`). The gate is 25 checks without NEON_URL; run touched suites
while you build, EVERY suite that reads a file you change (grep evals/ for
the file name), and the full gate ONCE at the end, in the foreground, with a
timeout, when the load average is under 8. Ten siblings build beside you on this machine: R172 continuity for a text-ready AI (172 only if needed), R173 a person's stage lines and Room card, R174 a personal AI's Room walked in Chromium, R175 the calibration erasure hazard verified and fixed (173 only if needed), R176 EmotionOS register in the reply and the voice, R177 the studio fast on a bad 4G day, R178 HumanOS drafted from a person's own sources (174 only if needed), R179 the listening test against the person's own voice, R180 how a person talks: the reply language policy from the person sheet, R181 the gate honest under load. Migration numbers are
ASSIGNED; never take another. Keep your edits inside the files your brief
names and append-only in shared files so the main loop can merge
mechanically. Do not spend money, do not touch the live database, never print
or commit a secret, never kill a process by pattern, never `git stash`, never
end a turn waiting on a monitor: gate in the foreground with a timeout,
commit, `git status` clean, full report in the same turn.

## Product

WS-R162 gave a person's prompt a person boundary but left
`PLATFORM_STAGE_EARLY/GETTING_CLOSE/ESTABLISHED` teacher-worded, and left
`api/_room-card.js` untouched because widening `publicRoomBySlug` trips its
own closed-select-list control (rejected.md#ws-r162-widening-publicroombyslug-would-trip-its-own-closed-select-list-control).
A person's AI still introduces itself as a teacher three sentences in, and
the picture a visitor shares says the wrong thing.

Laws:
1. Read `src/engine/compiler.ts` (the PLATFORM_STAGE_* constants and
   `personBoundaryFor`), `src/engine/agents/fromSheet.ts`, `api/_room-card.js`,
   `api/room-card.js`, `api/_room-page.js` (WS-R160's `roomAiTitleLine`),
   `api/_room-publish.js` (`publicRoomBySlug` and its control in
   evals/room-share), `api/_room-about.js`'s lateral join (WS-R162) FIRST.
2. Stage lines: `personStageFor(name, stage)` in the platform's words, never
   the person's sentences; `sheetToModule` picks person or teacher lines by
   `sheetKind`; the 83 byte-identity fixtures stay byte-identical; the
   engine bundle is rebuilt.
3. The card: `api/_room-card.js` gets the sheet kind and the person's line
   through its OWN read (the about page's precedent), never by widening
   `publicRoomBySlug`; a person's card says "<Name> AI, made by <Name>" and
   carries their disclosure; a teacher's card is byte-identical to today
   (evals/room-card's 83 checks prove it).
4. Both locales; the copy gate; evals/person-room extends to the card and
   the stage lines with negative controls (a teacher card never carries a
   person line; an unpublished person sheet shows no card text).

## Build

- src/engine/compiler.ts, src/engine/agents/fromSheet.ts, api/_engine.gen.js
  (rebuilt), api/_room-card.js, evals/person-room/run.mjs, evals/room-card
  (a case), evals/room-share (its control untouched).
- context/: decision with reversal, measurements, rejections.
