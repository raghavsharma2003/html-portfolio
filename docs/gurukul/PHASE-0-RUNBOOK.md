# PHASE-0-RUNBOOK — the first creator, start to finish

**WS-R15.** Phase 0 of the Rooms plan is "hand-build one Room for one real
creator." This is that runbook: the nine steps in the order the plan states
them, each one mapped to the exact studio panel or script step that performs
it, and what is still missing before it can be run for real. Every number
below is one already measured and cited in `context/`; nothing here is
invented, per `AGENTS.md`'s own law.

Two scripts do the mechanical half:

- `scripts/first-clone.mjs` — consent, upload, the voice-evidence round trip,
  zero-shot synthesis, the fidelity number and its ceiling, the activation
  gate, ASR and the sheet draft. Talks to the owner's studio session
  (`VYAKTI_STUDIO_ORIGIN` / `VYAKTI_ACCESS_TOKEN`) plus the voice services
  directly.
- `scripts/first-room.mjs` — consent, upload, the processing DAG, Readiness,
  the review queue (generate only, never decide), the Room's creation and
  publish, then a second, follower, session opening it, joining, saying one
  message, reading history back and leaving. Talks only to the deployed HTTP
  API (`BASE_URL`, `VYAKTI_SESSION`, `VYAKTI_FOLLOWER_SESSION`).

Neither script has been run against a live deployment as of this writing.
Both are proven offline: `first-clone.mjs` by hand against the real Azure
services (`context/measurements.md#first-real-clone`), `first-room.mjs` by
`evals/first-room/run.mjs` against a fake HTTP server. **Running
`first-room.mjs` against the real deployment, with a real owner session, is
the thing this document exists to make possible, and nobody has done it
yet.** Until that happens, "the Room is live" is a claim about code, not a
claim about a person.

---

## The nine steps

### 1. Application

**What it is.** Becoming a candidate for the platform at all.

**Performed by.** Nothing coded. There is no waitlist, no application form,
and no admissions flow anywhere in this repository — Phase 0 is explicitly
"hand-build one Room for **one** real creator," so the owner identifies and
personally invites that person. The first coded step is sign-in:
`src/studio/studioAuth.ts` (email OTP, phone OTP, or Google), which
`scripts/first-clone.mjs` and `scripts/first-room.mjs` both take as a
pre-obtained bearer token (`VYAKTI_ACCESS_TOKEN` / `VYAKTI_SESSION`) rather
than performing themselves — "the script takes a session token from the
environment, it never logs in for the owner."

**What is still missing.** The built-in Supabase mailer is capped at about
2 sign-in emails per hour until SMTP is configured
(`context/STATE.md` line 58, `context/decisions.md` line 3524: "Open, owner:
SMTP app password"). A creator who is invited and tries to sign in twice in
one hour, or whose OTP email is lost, currently has no recovery path other
than Google sign-in. Google sign-in itself has its own dependency for the
Room specifically: `googleSignIn()`'s `returnPath` must be on the Supabase
project's redirect allow list, and `/r/*` needs adding there before Google
sign-in works from inside a Room (`src/studio/studioAuth.ts`, the
`googleSignIn` doc comment).

---

### 2. Identity by voice

**What it is.** Proving the person signed in now is the person this replica
was built from — the law is self-cloning only
(`context/decisions.md#replica-self-only`), and this is how it is enforced
without the document-based path.

**Performed by.** The studio panel `src/studio/VoiceIdentityChallenge.tsx`
(rendered as `VoiceIdentityChallengeBand` in `StudioApp.tsx:1080`), backed by
`api/replica-voice-identity.js` over `api/_replica-voice-identity.js`
(migration 072). The owner speaks a server-issued sentence plus a numeric
nonce on camera; ECAPA cosine similarity against their own VoiceGenome
reference and a Sarvam transcript must both agree
(`context/decisions.md#ws-r2-voice-identity-challenge-decision`). Neither
`first-clone.mjs` nor `first-room.mjs` performs this step — it is a studio-only
flow, and both scripts assume it has already passed for the bearer token they
are given.

**What is still missing.** Two things, both already named in `context/`:

1. **The false-accept side of the accept/review/reject thresholds (0.78 /
   0.70) is unmeasured.** They come from the owner-vs-owner ceiling (0.8869,
   `context/measurements.md#first-real-clone`), which bounds the
   false-*reject* side only. "THE FALSE-ACCEPT SIDE DOES NOT
   [have a measured margin]. This repository contains no different-speaker
   control." (`context/decisions.md#ws-r2-voice-challenge-thresholds`). The
   reversal condition is stated: an impostor control set (N speakers against M
   other speakers' references) whose distribution overlaps 0.78.
2. **The sweep that completes a challenge** (`/api/replica-voice-identity-sweep`,
   every 5 minutes per `vercel.json`) **is wired in code and has no recorded
   live execution in `context/`.** Confirm it is actually running in
   production (Vercel's own cron logs) before relying on it for a real
   creator's first challenge.

---

### 3. The first ten minutes

**What it is.** What a creator can do with only a name, a subject, and one
upload, before any of the slower gates (identity, liveness, provider
consent, voice training, activation) have cleared — a REVIEWABLE, not yet
published or activated, draft.

**Performed by.** `src/studio/QuickStartPath.tsx` — its own header names it
"the 'first clone in 10 minutes' surface." It does not gate or skip anything
below it; it reads the same runtime blockers `RuntimeGate` uses
(`/api/replica-runtime`) and renders them as a plain "locked until X" list,
always naming who the next step is waiting on: `owner: "you"` or
`owner: "platform"` (`BLOCKER_META` in the same file).

**What is still missing.** Two of `BLOCKER_META`'s own platform-owned rows
are still open as of `context/STATE.md`'s START HERE block:
`voice_not_ready` / `production_voice_required` ("Voice synthesis
infrastructure is still being connected. Not something you can unblock
yet.") — the in-house voice runtime exists and synthesizes
(`vyakti-open-voice`, RTF 0.79 warm) but the deployment is on
`REPLICA_SELF_TEST_MODE`, and `AGENTS.md`'s "Owner decisions currently
outstanding," item 3 ("Key rotation") says those self-test consent rows
"MUST be revoked before any non-owner uses this product" via
`scripts/revoke-self-test-grants.mjs`. **A real second creator cannot pass
through the first ten minutes on the production voice path until that flag
is off for them and the grants are revoked.**

---

### 4. The voice moment

**What it is.** The first time a creator hears their own voice come back out
of the AI — the emotional core of the product, and the one place a real
number can still mislead if it is read as more than it is.

**Performed by.** The studio: `src/studio/VoiceEnrollmentLab.tsx` (recording
the matched reference) and `src/studio/VoicePreviewLab.tsx` /
`VoicePreviewPanel.tsx` (hearing the synthesized preview). Reproduced
end-to-end by `scripts/first-clone.mjs`'s `reference-embeddings`,
`clone-synthesis`, `candidate-embeddings` and `fidelity` stages, which print
the mean score, its p10/worst, and the self-vs-self ceiling in the same
breath so the number is never read without its denominator
(`api/_readiness.js` §2, `ground-truth-ceiling`).

**What is still missing, stated as loudly as the code states it.** The
speaker-embedding fidelity score (owner's own run: ECAPA mean 0.7753, p10
0.7479, against a 0.8869 ceiling, `context/measurements.md#first-real-clone`)
is **not** a claim about how the clone sounds. **No ABX listening bench has
ever been run on a human ear.** `docs/gurukul/EARBENCH.md`, verbatim: "the
instrument exists and has never been used on a human ear. Nothing in this
repository is evidence about how any cloned voice *sounds*." The command
exists (`node scripts/earbench.mjs stimuli|listen|score`) and has not been
run for any creator, including the owner. Readiness's own `sounds_like_you`
part is HALF an instrument for the same reason as above (fidelity is real;
nothing yet writes `self_similarity_ceiling` into a creator's own approved
voice genome, `api/_readiness.js` lines 95-99) — every creator after the
owner sees "your voice has not been measured against your own recordings
yet" until that write path exists.

---

### 5. Feed

**What it is.** Bringing in the creator's own material: files, links, and one
consented audio recording.

**Performed by.** `src/studio/ContextLockerPanel.tsx` (`#context-locker`) for
files and links; `scripts/first-room.mjs`'s `consent` and `upload` steps for
the audio recording specifically — `{op:"grant"}` on
`api/replica-consent.js`, then `{op:"create_upload"}` / a signed PUT /
`{op:"finalize"}` on `api/replica-source.js`.

**What is still missing.** YouTube channel ingestion is a real lane
(`api/_channel-ingest.js`, swept every 6 hours per `vercel.json`) but its
audio-extraction route is blocked from a datacenter IP, and the owner has
said to skip YouTube for now rather than pay for a residential proxy
(`AGENTS.md`, "Owner decisions currently outstanding," item 1, "YouTube
route"). A creator whose material lives mostly on YouTube cannot use that
lane today; everything else in the Locker (direct file upload, pasted links)
is live.

---

### 6. Correct

**What it is.** The creator reviewing what the AI mined from their own
material and from Mirror Call turns — "thirty seconds a card," per
`api/_review-queue.js`'s own header — never a second model grading a first
one.

**Performed by.** `src/studio/ReviewQueue.tsx` is where a creator actually
decides a card (`{op:"decide"}`). `scripts/first-room.mjs`'s `review-queue`
step only **fills** the queue (`{op:"generate"}`) and deliberately never
decides one: "Deciding a card is the creator's own job." Readiness's own
`review_claims` action (`api/_readiness.js`'s `READINESS_ACTIONS`) sends a
creator to `#person-model-studio` rather than the Review Queue panel, so a
creator reviewing claims may land on either surface depending on which part
of the screen sent them there — both write into the same claim ledger.

**What is still missing.** The synthetic question set that seeds an empty
queue before any follower conversations exist
(`api/_review-queue/questions.js`, item (d)) needs
`AZURE_FOUNDRY_ENDPOINT` / `AZURE_FOUNDRY_API_KEY` /
`AZURE_FOUNDRY_REVIEW_QUESTION_MODEL` (or `AZURE_FOUNDRY_CLAIM_MODEL` as a
fallback). Whether these are set in the live deployment is not recorded
anywhere in `context/` — check with `node scripts/check-replica-env.mjs`
before assuming it. Unset, `generate` still runs (claims and Mirror Call
deltas cost nothing and are not gated on this key) but reports
`questions_unavailable` by name rather than a shorter, silently emptier
queue — the "waiting on us" law
(`context/rejected.md`, `plausible-return-hides-a-dead-pipeline`) applied
here.

---

### 7. Bound

**What it is.** The lines the AI refuses to cross — never-say rules and the
escalation route for a distressed follower.

**Performed by.** `src/studio/PersonModelStudio.tsx` (`#person-model-studio`),
where boundary claims (`domain='boundary'`) are approved into
`vy_replica_profile`, and `src/studio/TeacherSheetStudio.tsx`
(`#teacher-sheet-studio`), where `escalationRoute` is set.
`scripts/first-room.mjs` does not touch this directly; it is read back by the
`readiness` step's `knows_what_not_to_say` part.

**What is still missing.** Nothing instrumentally — this is the one
readiness part that is fully LIVE with no half-built instrument
(`api/_readiness.js` §4: "LIVE. Approved boundary claims are the never-say
rules... the approved person model is what makes them final, and the
teacher sheet's `escalationRoute` is where a distressed person is sent.").
The crisis helplines and the spoken AI disclosure sit outside this part
entirely and are "always on," per the same file. What is still an open
question is procedural, not technical: a real creator has to actually write
three or more never-say rules and an escalation route before this part
counts as configured (`MIN_NEVER_SAY_RULES = 3`,
`api/_readiness.js`) — nobody has done that for anyone but the owner.

---

### 8. Gate

**What it is.** Readiness: one number, five parts, one suggested action,
locked below 70 overall or 55 on any part.

**Performed by.** `src/studio/ReadinessPanel.tsx` (`#readiness-title`) is the
screen; `scripts/first-room.mjs`'s `readiness` step is the same read,
printing all five parts, the overall, and the lock verdict for a script
run — `GET /api/readiness` over `api/_readiness.js`.

**What is still missing.** Two of the five parts have never had an
instrument, for anyone, ever — this is not creator-specific and will not
clear itself with more material:

- `knows_your_material` — **NO INSTRUMENT.** Needs a held-out recall run
  scored against questions built from the replica's own sources; the harness
  shape exists (`evals/recallbench`, offline) but "no per-replica run is
  stored anywhere and `measurements.md` carries no recall number for
  anyone." (`api/_readiness.js` §4)
- `sounds_like_you` — **HALF AN INSTRUMENT.** Covered above under The voice
  moment.

Both mean **`publish_locked` is true for every replica today, including the
owner's**, which is why `scripts/first-room.mjs`'s `room-publish` step is
written to print the blocker list rather than assume success — this is the
expected state for a first run, not a bug in the script.

---

### 9. Launch

**What it is.** Publishing the Room: an address at `/r/<slug>`, a follower
can reach it, and it stays reachable until paused.

**Performed by.** `src/studio/RoomStudio.tsx` for the studio panel;
`scripts/first-room.mjs`'s `room-create` and `room-publish` steps for the
script (`POST /api/room-publish {op:"create"}` then `{op:"publish"}`), then
the follower half (`follower-open` through `follower-forget`) against
`POST /api/room` — `api/_room-publish.js` and `api/_room-surface.js`. The
publish write itself checks three conditions inside one SQL `CASE`, never a
JS branch above it: an active runtime capability (`#runtime-gate`), the
readiness lock (`#readiness-title`, see Gate above), and an approved
disclosure (`#teacher-sheet-studio`) — `api/_room-publish.js`'s own header.

**What is still missing.** Everything upstream of this step (Gate, and the
production-voice half of The first ten minutes) is what actually blocks
`publish_locked` today. Once those clear, `publish` and the follower flow are
proven **offline only**: `evals/room/run.mjs`'s own header says "Offline,
deterministic, $0, no DB, no network and no model call," and `evals/run.mjs`
describes `room-publish` the same way. **No SQL statement in this lane, and
no HTTP call through `api/room-publish.js` or `api/room.js`, has been proven
to execute against the live database with a real owner and a real
follower.**
`scripts/first-room.mjs`, run against the real deployment with a real
`VYAKTI_SESSION` and (optionally) a real `VYAKTI_FOLLOWER_SESSION`, is the
first thing in this repository that can close that gap — and as of this
document, nobody has run it.

---

## Summary table

| # | Step | Studio panel | Script step | Still missing |
|---|---|---|---|---|
| 1 | Application | `studioAuth.ts` sign-in | n/a (bearer token supplied) | SMTP (email OTP capped ~2/hr); `/r/*` on the Google redirect allow list |
| 2 | Identity by voice | `VoiceIdentityChallenge.tsx` | n/a | False-accept side of 0.78/0.70 unmeasured; sweep's live execution unconfirmed |
| 3 | The first ten minutes | `QuickStartPath.tsx` | n/a | Production voice provider still self-test-only for anyone but the owner |
| 4 | The voice moment | `VoiceEnrollmentLab.tsx`, `VoicePreviewLab.tsx` | `first-clone.mjs`: reference-embeddings, clone-synthesis, fidelity | No ABX listening bench ever run on a human ear; owner-ceiling write path missing |
| 5 | Feed | `ContextLockerPanel.tsx` | `first-room.mjs`: consent, upload | YouTube extraction blocked from datacenter IP, owner said skip for now |
| 6 | Correct | `ReviewQueue.tsx` | `first-room.mjs`: review-queue (generate only) | `AZURE_FOUNDRY_*` keys for synthetic questions, live status unconfirmed |
| 7 | Bound | `PersonModelStudio.tsx`, `TeacherSheetStudio.tsx` | n/a (read by readiness) | Nothing instrumental; needs a real creator to actually write the rules |
| 8 | Gate | `ReadinessPanel.tsx` | `first-room.mjs`: readiness | `knows_your_material` has no instrument at all; `sounds_like_you` half an instrument |
| 9 | Launch | `RoomStudio.tsx` | `first-room.mjs`: room-create, room-publish, follower-* | Proven offline only; never run against the live database for a real person |
