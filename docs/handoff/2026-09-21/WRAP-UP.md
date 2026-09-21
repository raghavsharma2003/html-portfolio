# Vyakti closeout, 2026-09-21

The product is incomplete. Latest live Preview remains accepted3bc5857e with
the old UI. The repaired interface needs a fresh full release gate and deploy.

## Saved work

- Integration: html-portfolio, claude/vyakti-cloning-platform-aq05n4,
  sibling Vyakti-platform-standalone25. Personal setup repair is2ba6445a;
  notification reading-state fix is1c0d7519.
- Private voice WIP f0246956 is committed and pushed separately on
  codex/private-voice-requests25. It provides request/store/erasure scaffolding,
  not a working voice service. Migration171 is reserved, not applied.

## Remaining

1. Pass the integrated release, deploy a protected preview, verify its exact
   source, browser policy and Azure upload CORS.
2. Complete per-account private voice CPU execution, shared GPU metering,
   shutdown supervision and Studio playback. Review migration171 and verify
   its dependencies and SQL against the real database before applying it.
3. Test a genuine account through sign-in, upload, knowledge, conversation,
   voice, corrections and memory across sessions.
4. Measure Hindi, Hinglish and English likeness, intelligibility, latency and
   cost. Competitor superiority has not been demonstrated.

Planning estimate: several focused working days for a usable private pilot,
assuming access and no further major integration failures. Quality leadership
has no defensible completion estimate before actual listening comparisons.

## Evidence and limits

September21 reruns: notice14/14 and private-first4/4 mounted Chromium checks;
private voice13/13 synthetic tests. Integrated TypeScript and copy checks pass.
Synthetic SQL tests do not establish PostgreSQL parsing or live synthesis.
The prior3b193bc4 CI failed three suites; corrections are integrated but still
need a new exact-head full release run.

September21 Vercel readback: latest READY deployment is
dpl_FNxsGdY4CvTEmi5ju4BbGr6MKrFY at
https://vyakti-replica-kefkrsmzn-raghav-carbonsettles-projects.vercel.app.
That is still the old interface. No repaired deployment is claimed.

The old retained-owner diagnostic grant expired September16. The unused
mobile-preview helper still pins an old head and fingerprint; it must be
reviewed for a newly accepted candidate before execution. Existing used
deployment, prime and infrastructure intents must not be replayed.
Personal Microsoft browser access remains prohibited on this employer laptop.
No cloud mutation, GPU activation, migration or model call occurred in this
closeout. Read context/STATE.md before resuming.
