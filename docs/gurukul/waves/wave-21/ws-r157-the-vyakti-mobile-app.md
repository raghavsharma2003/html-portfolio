# WS-R157: the Vyakti mobile app. A second Capacitor app target (app.vyakti.studio, name Vyakti) whose start page is the studio, with microphone and camera permissions, deep links for /r/* and /c/*, a PWA manifest and install card for the studio on desktop and mobile web, and a CI job that builds its debug APK beside Meera's; the studio's record flow proven under Android WebView constraints offline. No migration.

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

The only native shell is Meera's (`app.meera.companion`, "Maya"). The
owner wants the product on mobile and desktop. The Room already installs
as a PWA; the studio does not, and there is no Vyakti APK.

Laws:
1. Read `capacitor.config.ts`, `android/`, `.github/workflows/build-apk.yml`,
   `src/native/`, `api/room-manifest.js` and the Room's install card
   (`src/room/installPrompt.ts`), `scripts/check-performance.mjs`'s install
   check, and `docs/AUTOUPDATE.md` FIRST.
2. A second config `capacitor.vyakti.config.ts` (appId app.vyakti.studio,
   appName "Vyakti", webDir dist, start page /studio, backgroundColor from
   the studio tokens) selected by `CAPACITOR_CONFIG` env or a script flag;
   the Android project stays ONE project with a product flavour `vyakti`
   (applicationIdSuffix, its own launcher icon and name), never a copy of
   android/; RECORD_AUDIO, CAMERA, POST_NOTIFICATIONS declared; intent
   filters for https://<VYAKTI_PUBLIC_APP_ORIGIN>/r/* and /c/*.
3. A studio web manifest (`/studio.webmanifest`, name, icons, start_url
   /studio, display standalone) served by vercel.json, and an install card
   in the studio shell on the second visit (the Room's own pattern), under
   the performance gate's install check.
4. build-apk.yml gains a `vyakti-apk` job (assembleVyaktiDebug) uploading
   `vyakti-apk`; the workflow lint passes; no secret is needed for a debug
   build.
5. Offline proof: a Chromium run with a mobile UA and a fake MediaRecorder
   proves the studio's record flow reaches "Finish and build" and that the
   WAV capture path (`wavCapture.ts`) works without `MediaRecorder` webm
   support; the layout gate's 390 targets stay green.

## Build

- capacitor.vyakti.config.ts (new), android/app/build.gradle (flavours),
  android/app/src/vyakti/ (icon, name), AndroidManifest.xml (permissions,
  intent filters), public/studio.webmanifest (new), vercel.json (append a
  rewrite/header), src/studio/installPrompt.ts (new, reusing the Room's),
  StudioShell/CloneExperience (the card), .github/workflows/build-apk.yml,
  evals/vyakti-app (new).
- context/: decisions with reversal, measurements, rejections; ENV-MANIFEST
  row for any new name.
- No migration.
