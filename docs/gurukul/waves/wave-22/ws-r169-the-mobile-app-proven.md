# WS-R169: the mobile app proven. The Vyakti flavour's deep links verified by a served assetlinks file, the studio start page and the WebView record flow proven under an Android-shaped Chromium, the iOS shell scaffolded, release signing for the flavour behind env NAMES, and the install flow rehearsed on 390 px. No migration.

Read scratchpad w22/ws-common.md FIRST (the file the launcher names); every
rule there binds, including the merge lessons at its end. Your worktree is
checked out at the wave-twenty-two base d2b3f6d (verify with `git log
--oneline -1`). The gate is 24 checks without NEON_URL; run touched suites
while you build and the full gate ONCE at the end, in the foreground, with a
timeout. Ten siblings build beside you on this machine: R161 Meet opens for any person (text first, migration 167), R162 a personal AI's Room publishes (migration 168 only if needed), R163 the voice activation guard wired and sealed audio served (169 only if needed), R164 the first five minutes, R165 the evals made durable, R166 the personal studio in Hindi, tier two, R167 the owner's own continuity in Meet (170 only if needed), R168 EmotionOS in the voice, R169 the mobile app proven, R170 data safety for the new tables (171 only if needed). Migration numbers are ASSIGNED; never take another. Keep your
edits inside the files your brief names and append-only in shared files so the
main loop can merge mechanically. Do not spend money, do not touch the live
database, never print or commit a secret, never kill a process by pattern,
never `git stash`, never end a turn waiting on a monitor: gate in the
foreground with a timeout, commit, `git status` clean, full report in the same
turn.

## Product

WS-R157 gave Vyakti its own Android flavour, a PWA manifest and an install
card, and said what only CI or a device can prove. This workstream proves
everything that can be proven without a device and prepares the two things
that need one.

Laws:
1. Read `android/app/build.gradle`, `android/app/src/vyakti/`,
   `capacitor.vyakti.config.ts`, `scripts/select-capacitor-config.mjs`,
   `scripts/select-native-start-page.mjs`, `public/studio.webmanifest`,
   `src/studio/installPrompt.ts`, `evals/vyakti-app/run.mjs`, `.github/
   workflows/build-apk.yml` and WS-R157's decisions FIRST.
2. Deep links: `/.well-known/assetlinks.json` served by vercel.json for the
   Vyakti package with the certificate fingerprint read from an env NAME
   (never a value), an honest empty file when unset; a suite proves the
   route, the shape and the unset behaviour.
3. iOS: `npx cap add ios` scaffold committed (no Xcode here; say so),
   `capacitor.vyakti.config.ts` covers it, the same start page; a suite
   proves the scaffold's identity fields; nothing claims a build.
4. Release signing for the vyakti flavour behind `VYAKTI_ANDROID_KEYSTORE_*`
   env NAMES in build.gradle and a CI step gated exactly like Meera's; the
   env manifest gains the names.
5. The install flow rehearsed: the install card appears on the second visit
   only, `beforeinstallprompt` captured, the PWA start URL loads the studio
   signed-in state; the WebView record flow (WS-R157's Chromium proof) is
   extended to the upload and the wait; all at 390 px, both locales.

## Build

- vercel.json (one route), api/well-known-assetlinks.js (thin) or a static
  file with a build step, android/app/build.gradle, ios/ (scaffold),
  capacitor.vyakti.config.ts, .github/workflows/build-apk.yml, docs/gurukul/
  ENV-MANIFEST.md (names), evals/vyakti-app/run.mjs, evals/run.mjs.
- context/: decisions, measurements, rejections.
