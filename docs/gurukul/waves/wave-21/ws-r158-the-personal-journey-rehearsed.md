# WS-R158: the personal journey rehearsed. Real Chromium drives the real built personal studio through the real API handlers over a fixture database and fake Azure: sign in, record (a fake microphone), upload, the wait, Meet (conversation and voice sample), Describe me, Evolve (accept one claim), Talk (one mirror-call turn), Deploy; at 390 and 1280; the first real break found and fixed at its cause. No migration.

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

The creator and follower journeys have rehearsals (`evals/rehearsal/
creator.mjs`, `follower.mjs`) that found real crashes. The personal
studio, the product's front door for any person, has none. Codex's
handover says the complete signed-in journey was never verified.

Laws:
1. Read `evals/rehearsal/creator.mjs`, `follower.mjs`, `browser.mjs`, the
   module-resolution hook that redirects the database, the model call and
   Supabase auth, `scripts/dev-expert.mjs`, `src/studio/studioTestMode.ts`,
   and `evals/primary-intent-recovery/host.tsx` (a mounted fixture of
   CloneExperience) FIRST.
2. `evals/rehearsal/personal.mjs`: the same harness contract; the fake
   microphone is a 15-second synthetic WAV injected through the existing
   capture seam (`wavCapture.ts` accepts an injected stream in test mode,
   or a Playwright fake device); the upload goes to a fake signed-upload
   server on 127.0.0.1; processing is a fake worker that marks the source
   ready and writes a fixture VoiceGenome; the conversation and mirror call
   use the fake Azure reply seam; nothing reaches a network.
3. Steps and assertions per locale-independent step: sign in (real
   AuthGate over fake Supabase), record >= 12 s and "Finish and build", the
   status beacon shows a real phase and no percentage, Meet opens
   automatically, one conversation turn returns the fake reply with the
   disclosure prefix, the voice sample plays a fixture clip, Describe me
   saves, Evolve shows one claim and accepting it changes the profile
   version, Talk completes one turn, Deploy shows the honest blocker or the
   link. Three negative controls (a too-short recording is refused; a
   revoked replica shows the erased state; a signed-out call is refused).
4. Registered in evals/run.mjs in the rehearsal lane; the first real
   failure it finds is fixed at its cause with a frozen-shape regression
   control (WS-R122's pattern), logged as a rejection.

## Build

- evals/rehearsal/personal.mjs (new) and fixtures, src/studio/wavCapture.ts
  and studioTestMode.ts (the injection seam only), evals/run.mjs, any
  component fixed by the first real failure.
- context/: decisions with reversal, measurements (step timings, n=3),
  rejections.
- No migration; no new env var.
