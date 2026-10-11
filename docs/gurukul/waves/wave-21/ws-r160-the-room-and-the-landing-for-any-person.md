# WS-R160: the Room and the landing for any person. Every user-visible string of the Room, its transparency page, its cards and the site's landing that assumes a teacher or a creator with followers is rewritten for any person's AI ('Talk to <Name> AI', 'their AI'), the landing tells the owner's story in three screens (build your AI, test and tweak it, deploy it; HumanOS, RelationOS, EmotionOS as its three promises) in both languages, and the taste screen's three questions come from the person sheet's one line when no teacher sheet exists. No migration.

Read scratchpad w21/ws-common.md FIRST (the file the launcher names); every
rule there binds. Your worktree is checked out at the wave-twenty-one base
482e54b (verify with `git log --oneline -1`). The gate is 24 checks without
NEON_URL; run touched suites while you build and the full gate ONCE at the
end. Ten siblings build beside you on this machine: R151 HumanOS (the person
sheet, migration 163), R152 Deploy for a personal AI, R153 EmotionOS (vibe and
register, migration 164), R154 RelationOS in the Room (migration 165), R155
"Sounds like you" and the listening test (migration 166), R156 voice replies
that start fast, R157 the Vyakti mobile app, R158 the personal journey
rehearsed, R159 the personal studio in Hindi, R160 the Room and the landing
for any person. Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so
the main loop can merge mechanically. Do not spend money, do not touch the
live database, never print or commit a secret, never kill a process by
pattern, never `git stash`, never end a turn waiting on a monitor: gate in
the foreground with a timeout, commit, `git status` clean, full report in the
same turn.

## Product

The Room was built for creators and teachers ("your sheet", "doubts",
"students"). The landing (`site/vyakti.html`) sells "an AI version of a
creator to their followers". The owner's intent is broader: a person's AI
is their online identity. The words must say so before a stranger
decides whether to trust the product with their voice.

Laws:
1. Read `site/vyakti.html`, `site/suites.html`, `src/room/copy.ts`,
   `hiCopy.ts`, `hiTalkCopy.ts`, `api/_room-about.js`, `api/_room-page.js`
   (the crawler head), `api/_room-card.js`, `api/_creator-page.js`,
   `scripts/check-copy.mjs` (the vocabulary and dash rules), `docs/gurukul/
   DESIGN-LAW.md` (the copy purge, the landing composition rules), and
   `docs/gurukul/DESIGN-SYSTEM.md` FIRST. Grep every string with teacher,
   student, doubt, class, lesson, creator, follower, subject in the Room
   and site files; list them in the decision entry with the replacement.
2. The Room: "creator" becomes "the person" / "<Name>" where a stranger
   reads it; "follower" stays only where it names the paid relationship
   (the account page's subscription words); teacher-specific screens stay
   for teacher sheets (a sheet_kind-aware copy key once R151 lands; until
   then the person wording is the default and the teacher wording is
   selected by the presence of teacher fields). Both locales.
3. The landing: three screens in DESIGN-LAW's composition (one promise per
   screen, no filler, no fake numbers, the honest "apprentice" line), the
   three OS names as section names with one plain sentence each, the same
   consent and provenance strip, Hindi and English, the performance and
   headers gates (the landing is a target), the copy gate.
4. The transparency page and the crawler head say "<Name> AI, made by
   <Name>, on Vyakti"; the taste screen's questions fall back to the person
   sheet's one line.
5. Evals: the copy suites for the Room and the site, a NEGATIVE control that
   a teacher-sheet Room still shows the teacher wording, layout and
   accessibility gates for every touched screen in both locales.

## Build

- site/vyakti.html (+ its inline CSS), site/vyakti-privacy.html if a
  sentence changes, src/room/copy.ts, hiCopy.ts, hiTalkCopy.ts, src/room/*.tsx
  where a key changes, api/_room-about.js, api/_room-page.js, api/_room-card.js,
  api/_room-taste.js (the fallback), evals/room-copy (new or extended),
  evals/site-landing (new: the three screens are present, no banned word,
  both languages), fixtures.
- context/: decisions with reversal (the replacement table), measurements,
  rejections.
- No migration; no new env var.
