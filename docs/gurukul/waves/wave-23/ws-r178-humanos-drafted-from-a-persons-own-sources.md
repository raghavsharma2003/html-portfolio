# WS-R178: HumanOS drafted from a person's own sources. The person sheet is drafted for the person from what they already gave (Describe me, files and links, the recording's transcript, the interview's answers) through the person model's cited claims, reviewed line by line before it is saved; nobody fills a long form by hand. Migration 174 only if needed.

Read scratchpad w23/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-three base 19a27bc (verify with `git log
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

WS-R151 built the person sheet and its screen; a person must type who they
are into fields. The product promise is frictionless: their AI is built
from their own context. The person model (`api/_person-model.js`, claims
with citations, profiles) already extracts who they are; nothing turns it
into the sheet.

Laws:
1. Read `src/studio/HumanOsStudio.tsx`, `humanOsCopy.ts`, `api/_teacher-sheet-draft.js`,
   `src/engine/agents/fromSheet.ts` (the person validator), `api/_person-model.js`
   and `api/replica-person-model.js` (claims, citations, profile versions),
   `api/_context-items.js`, `src/studio/PersonModelStudio.tsx`, and
   WS-R151's decisions FIRST.
2. `api/_person-sheet-draft.js`: a pure drafter that maps accepted claims
   and context items to the person sheet's fields (identity basics, the
   five material fields, values, never-say, how they talk) with a citation
   per drafted line; every line is a proposal until the person accepts it;
   nothing the person did not give enters; the model seam is the existing
   fake-able one and no paid call runs in the gate.
3. The HumanOS screen gains "Draft it from what I gave": proposals shown
   with their citations, accept or edit each, then save through the
   existing draft door; both locales through the registry.
4. Proof: 40 fixture persons (claims and items in English, Hindi and
   Hinglish) draft to sheets that pass the person validator; negative
   controls: a claim without a citation never drafts a line; a rejected
   claim never appears; a person with nothing given gets an honest empty
   draft.
5. The personal rehearsal drafts a sheet after Describe me.

## Build

- api/_person-sheet-draft.js (new), api/teacher-sheet.js (one op) or
  api/replica-person-model.js, src/studio/HumanOsStudio.tsx, humanOsCopy.ts
  (both locales), evals/person-sheet-draft/run.mjs (new), evals/person-sheet,
  evals/room-doors (the op), evals/rehearsal/personal.mjs, evals/run.mjs;
  db/migrations/174 only if a proposal must persist.
- context/: decision with reversal, measurements, rejections.
