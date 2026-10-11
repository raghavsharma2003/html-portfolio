# WS-R187: share your AI. When a person's Room is published, Deploy shows a share kit made for a person: the link, a QR, a WhatsApp-ready line and a story card (WS-R173's card) in the person's own words and both languages, one tap to copy or share through the phone's own share sheet; the creator's share kit is reused, never forked. No migration.

Read scratchpad w24/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-four base e2da1f6 (verify with `git log
--oneline -1`). The gate is 25 checks without NEON_URL; run touched suites
while you build, EVERY suite that reads a file you change (grep evals/ for
the file name), and the full gate ONCE at the end, in the foreground, with a
timeout, when the load average is under 8. Ten siblings build beside you on
this machine: R182 memory that grows on its own (172 only if needed), R183
RelationOS for the person (174 only if needed), R184 EmotionOS test-and-tweak,
R185 sources at a glance, R186 the visitor's first minute on a phone, R187
share your AI, R188 the voice program's dry run, R189 my data in one place
(173 only if needed), R190 the evals' same-tick sweep, R191 the studio on a
phone in Hindi. Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so
the main loop can merge mechanically. Do not spend money, do not touch the
live database, never print or commit a secret, never kill a process by
pattern, never `git stash`, never end a turn waiting on a monitor: gate in
the foreground with a timeout, commit, `git status` clean, full report in the
same turn.

## Product

"Deploy it into the world with no friction." WS-R174 made a person's Room
publish through the real RoomStudio. What the person then gets is a URL. The
creator studio has a share kit (`evals/share-kit`, QR, poster, story card,
the WhatsApp line) written for a teacher with students. A person sharing
their AI with friends needs the same kit in their own voice: "This is my AI.
It knows how I think. Try it." in Hindi and English, and the phone's own
share sheet, not a copy button alone.

Laws:
1. Read `src/creatorStudio/ShareKit*.tsx` (or grep `share-kit`), `api/_room-card.js`
   (WS-R173's person card), `api/room-card.js`, `api/qr.js` (or the QR door;
   grep `qr`), `src/studio/DeployStudio.tsx`, `src/studio/ExpertSharePanel.tsx`,
   `src/creatorStudio/copy.ts`'s share section, `evals/share-kit/`,
   `evals/room-card/`, `evals/qr/`, `evals/deploy-studio/` FIRST.
2. The kit is the creator's kit component with a person-kind variant (a
   prop, never a copy of the component): the link, the QR (the existing
   door), the story card and the OG card from WS-R173's own read, and a
   WhatsApp line built from the person's own `personLine` in both locales
   through the copy tables (one closed block in `src/studio/copy.ts` and
   `hiCopy.ts`); teacher kits render byte-identical to before (a control
   over the rendered creator kit's text).
3. Sharing: `navigator.share` when the platform has it (the Android flavour,
   WS-R157 and WS-R169's WebView; prove in `evals/vyakti-app` that the share
   intent is wired), copy-to-clipboard otherwise, with an honest "Copied"
   state; the story card is a real PNG the phone can save (the existing
   card door renders it; never a data-URL rebuilt on the client).
4. The kit appears in Deploy only once the Room is published (the deploy
   banner's own `publishedRoom` state); before that Deploy says what is
   missing exactly as today. Negative controls: an unpublished Room shows no
   kit; a paused Room's kit says paused; a teacher's Deploy is unchanged.
5. The rehearsal (`evals/rehearsal/person-room.mjs` or `personal.mjs`,
   whichever holds the publish step) gains: after publishing, the kit shows
   the link, the QR image loads, the WhatsApp line contains the person's own
   line, in both locales.

## Build

- src/creatorStudio/ShareKit (the variant), src/studio/DeployStudio.tsx
  (mount, smallest hunk), src/studio/copy.ts and hiCopy.ts, the kit's css,
  scripts/check-layout.mjs and check-accessibility.mjs (one target: Deploy
  with a published person Room), evals/share-kit (the person cases and the
  teacher byte-identity control), evals/deploy-studio, evals/vyakti-app (the
  share intent), evals/rehearsal/person-room.mjs, evals/run.mjs.
- context/: decision with reversal, measurements, rejections.
