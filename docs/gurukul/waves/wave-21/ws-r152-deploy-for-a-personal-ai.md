# WS-R152: Deploy for a personal AI. The personal studio's Share step becomes a real Deploy screen: the web Room link, the QR and poster, Telegram, WhatsApp, the embed snippet and the install card, each with its honest readiness state, reusing the creator studio's RoomStudio and share kit rather than a second implementation; a consumer preview opens the real Room. No migration.

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

`ExpertSharePanel` today shows a text-publication panel and a link "Review
readiness". The creator studio already has the whole Deploy surface
(`src/creatorStudio/RoomStudio.tsx`, `ShareKitCard.tsx`, the poster, the
embed snippet, Telegram and WhatsApp joins). A person who built a voice
should reach the same Deploy in one tap.

Laws:
1. Read `src/creatorStudio/RoomStudio.tsx`, `ShareKitCard.tsx`, `api/_room-publish.js`,
   `api/_share-kit.js`, `src/studio/ExpertSharePanel.tsx`, `workspaceNavigation.ts`,
   and `docs/gurukul/PRODUCT-JOURNEY.md` FIRST.
2. `src/studio/DeployStudio.tsx` mounts the creator studio's RoomStudio and
   ShareKitCard through their existing props (the SAME components, lazily
   loaded, no copy), inside the personal studio's shell and tokens, with the
   readiness gate's honest blockers named in the person's words: "Publish
   who you are first" (links to HumanOS, R151's screen; until R151 lands,
   the link goes to Meet's review), "Voice not verified yet" (links to the
   verification journey), "Ready to open". A published Room shows the link,
   a copy button, the QR, the poster download, Telegram and WhatsApp joins,
   the embed snippet and the install card, each already implemented.
3. A "See it as a visitor" action opens the real Room (`/r/<slug>`) in a
   new tab; nothing is simulated.
4. Both locales through the copy registry; 390 and 1280; layout and
   accessibility fixtures `studio:deploy` and `studio-hi:deploy`; the
   creator rehearsal's share steps keep passing; a NEGATIVE control proves
   an unpublished Room shows no link.

## Build

- src/studio/DeployStudio.tsx (+ css), ExpertSharePanel.tsx (replaced by the
  new screen behind the same export name), CloneExperience.tsx (the share
  room mounts DeployStudio), src/studio/layoutFixture.tsx, scripts/check-layout.mjs
  and check-accessibility.mjs targets, evals/deploy-studio (new).
- context/: decisions with reversal, measurements, rejections.
- No migration; no new env var.
