# STATE — read this first, then the graph

One page, kept current, so a new session spends zero tokens re-deriving where
the project stands. Deep history lives in `decisions.md` / `rejected.md` /
`measurements.md`; the index is `graph.json` (`node scripts/context.mjs`).
**If this file and any other disagree, the other files win — fix this one.**

Last updated: 2026-08-26, and this line is the ONLY one of its kind in this
file. **Do not add a "Last updated" line here.** Put what your session did in
the SESSION LOG at the bottom of this page instead.

Why that rule exists, so it is not undone as fussiness: this header is not
append-only, but the merge helper that resolves `context/` conflicts unions
append-only files line by line. Every agent that added its own header line here
therefore survived the union, and eight of them stacked up twice. The bottom of
the file IS append-only, so a line placed there merges correctly by
construction rather than by anyone remembering to tidy up.

**Other agents:** `AGENTS.md` at the repo root is the tool-neutral entry point
and points back here. `CLAUDE.md` carries the same rules for Claude Code.

## What the product is

Vyakti: a self-serve platform where ANYONE builds an exact AI version of
themselves — mind, voice, relation, long-term continuity — from their own
context (files, links, channels, calls), iterates on it frictionlessly, and
deploys it anywhere. It **remembers each person it talks to** and carries a
**measured guarantee it still sounds like them**. Edtech (JEE teachers →
student app) is the first vertical and wedge, not the boundary
(`horizontal-platform-reweight`, 2026-08-26). North star and binding consequences:
`docs/gurukul/SPEC-GURUKUL.md` §8 (owner reweight, 2026-08-26).

Standing owner directives: in-house replica stack (self-hosted open weights
primary, vendors optional); Maya/Meera deprioritized as a product (its engine
gates stay); Fable runs the main loop, Opus 5 / Sonnet 5 run subagents.

## Where the code is

- Branch `claude/gurukul-platform`, PR #5 (draft, CI green).
- The union of the companion line (RelationalOS engine) and the voice-cloning
  line (Replica Lab studio). `docs/gurukul/SPEC-GURUKUL.md` is the map;
  `docs/gurukul/ROADMAP-100X.md` is the build order;
  `docs/gurukul/research/` holds the competitor / memory-science / voice-stack
  sweeps behind those decisions.
- Gates: `node scripts/verify-release.mjs` (11 checks, all green; **13 with
  `NEON_URL` in the environment** — the relational db gates used to be skipped
  even when the env var was set, because the switch read `api/_config.js`
  alone. `relcheck` is a hard gate wherever a URL is reachable).

## What is LIVE (verified, not assumed)

| thing | state |
|---|---|
| Neon Postgres | migrations 015–062 applied and verified live (**125 tables**, checked 19:00Z). `verify-release` runs **13** checks when `NEON_URL` is set — the two relational DB gates that had never actually run — and 11 with a printed skip when it is absent |
| Supabase (new project, separate from Meera's) | auth working; `vyakti-replica-private` bucket created |
| Auth | Google OAuth live; email OTP live (6-digit); built-in mailer capped ~2/hr until SMTP |
| Studio | `vyakti-replica-lab.vercel.app` → teacher studio at `/`; replica create/list verified against live DB |
| Meera production | untouched; its deploy trigger no longer matches this branch |
| In-house voice | Azure RG `vyakti-voice`: Chatterbox GPU runtime + admission broker + voice evidence, scale-to-zero, synthesising (RTF 0.79 warm). `docs/gurukul/AZURE-DEPLOY-STATE.md` |
| Enrollment processing queue | **LIVE and draining.** `vyakti-replica-processing`, an Azure Container Apps **Job** (Consumption, `*/5`, no ingress, scale-to-zero by construction), image `replica-processing-worker@sha256:52df98…`. It owns all eight DAG steps; the Vercel sweep's cron entry is removed and that endpoint is now the manual fallback. The owner's real 32.9 MB upload has `integrity`, `malware_scan`, `media_probe` and **`diarize` COMPLETE** (278 speaker segments, mean confidence 0.877, the first voice evidence this system has ever written) and stops at `separate`, which throws on the GPU for a whole 822.7 s recording. **A voice genome is NOT yet buildable:** it needs sources at `state='ready'`, only `voice_quality` sets that, and `transcribe` sits between them needing an Azure Speech resource that does not exist on this subscription (zero Cognitive Services accounts). **`commitProcessingOutput` had never once written an artifact or a piece of evidence** — its guard validated by re-reading the tables it was writing, which a data-modifying CTE cannot see — so no upload could ever have passed `media_probe`. Fixed and proven on production. |

## WHERE THE PRODUCT ACTUALLY STANDS (2026-08-26 19:15Z, measured)

The single most useful section for a new agent: this was established by driving
the REAL deployed frontend in a real mobile browser against the REAL backend,
not by reading code. The harness lives in the session scratchpad, and the
technique is reusable and worth rebuilding if it is gone:
**the container's egress policy resets the browser's HTTPS, so a loopback
bridge serves production bytes fetched with node and relays `/api/*` back to
production.** Real rendering, real API, real signed-in user.

**Journey score: 12 of 15 steps pass.** Passing: landing, no horizontal
overflow at 390pt, real signed-in session, studio renders, primary action above
the fold (632px), create workspace, the three-step wizard visible, reaching the
Meet step, no blame text, every disabled control carries a reason, the activity
surface answers 200, the Mirror Call contract answers 200. Failing: three
symptoms of ONE cause, the audio-protection service being undeployed.

### The owner's real 32.9 MB upload, live pipeline position

| step | state | note |
|---|---|---|
| integrity | complete | byte verification passed |
| malware_scan | complete | the deployed scanner works |
| media_probe | complete | measured 822 720 ms (13.7 min), mp3, 2ch, 48 kHz |
| diarize | **complete** | 278 speaker segments, mean confidence 0.877. Cluster 1 is the owner (663.5 s over 231 segments); cluster 2 is 25.9 s of someone else. The first voice evidence this system has ever written. Unblocked by WS-AK: the service is scale-to-zero, its cold start is 100-160 s, and the request signature only lives 60 s, so every cold request was guaranteed to fail. Wake it, THEN sign |
| separate | leased | throws on the GPU for a whole 822.7 s recording |
| transcribe | blocked | needs `AZURE_SPEECH_ENDPOINT` / `AZURE_SPEECH_KEY`, and the subscription has **zero** Cognitive Services accounts. Sarvam ASR adapters already exist and are proven on Hinglish (`api/_asr/providers/sarvam-saaras.js`, `sarvam-sync.js`); pointing `transcribe` at them avoids a new vendor and a new bill. Owner's call |

A 30-minute lecture would still fail here even with a raised cap: 1200 s is a
hard ceiling compiled into `app.py`. That is why `best-window-not-first-window`
is the decided fix and a cap raise is only an unblock.

Two facts a new agent must not re-derive:
- **`vy_replica_source.duration_ms` is NULL** even though `media_probe` wrote
  the duration into `vy_replica_processing_evidence`. Nothing propagates it to
  the row later steps read. A trap for the next file.
- **Raising the cap is an unblock, not a fix.** A 30-minute lecture is squarely
  the product's use case and would still fail. The decided fix is
  `best-window-not-first-window`: never send a whole recording to the embedder,
  send the best-scoring ~10 s windows. WS-U measured window choice moving
  fidelity more than fine-tuning does (0.7433-0.8058 spread versus a 0.0206
  fine-tune delta), so windowing is both correct and higher quality.

### "Preview my voice" was broken in FOUR stacked layers

Each hid the next; all four are worth knowing because the pattern recurs.
1. The panel sends no `style`; the validator refused an ABSENT style with the
   same 400 as a typo, so every preview from the default path failed.
2. The route flattened that named 400 into an opaque 500 **and logged nothing**,
   which is why nobody could see layer 1.
3. The route only mapped errors carrying a `code`; sixteen validators in `api/`
   throw a bare `{status:400}`. Fixed as a class, not an instance.
4. **Root: the audio-protection service was never deployed.** Every clip must
   carry the spoken disclosure and the PerTh watermark before delivery, so NO
   replica audio can leave for anyone.
   **Never stub or bypass this to get a green screen.**

Layers 1 to 3 are fixed in code. Layer 4 is fixed in infrastructure: WS-AL
deployed `vyakti-audio-protection` to the `vyakti-voice` resource group and it
is serving, with the build now proving the watermark model actually runs rather
than only that the image builds. What remains is **not code**: five environment
variables have to be pasted into the Vercel project `vyakti-replica-lab` before
any replica audio can reach a person. This session has no tool that can write a
Vercel environment variable, so it is an owner action, and Preview stays
correctly refused until it is done. The values and where each one comes from
are in the credentials handover file the owner already holds.

The lesson, now encoded: a refusal that chose its own 4xx keeps it, a
configuration absence answers 503 BY SHAPE rather than by a list of names, and
the code is always logged. One line of logging turned an unfindable crash into
a one-line answer from production.

### YouTube: measured to the end, and it needs a credential

- Audio extraction from a datacenter IP is **blocked** and every free lever is
  exhausted (all ten yt-dlp player clients; the PO-token provider moved the
  metadata check 5/6 versus 1/6 but yielded 0/12 audio bytes and the benefit
  vanished after ~40 requests).
- The transcript half does NOT rescue it. The sanctioned Data API answers a
  datacenter IP normally, but `captions.download` returns only manually
  uploaded tracks, which lecture channels do not have. Every auto-caption route
  goes through the same blocked player surface. There is no free transcript
  route hiding behind the audio problem.
- Recommendation on the table for the owner, **not purchased**: IPRoyal
  residential pay-as-you-go, about $0.077 per 15-minute lecture, $7 minimum,
  traffic does not expire. Switching it on is one env var
  (`MEDIA_EXTRACT_ROUTE=proxy` plus the URL); absent credentials refuse by name
  rather than falling back silently.

## The three ingestion/voice pipelines — status after the first real clone (2026-08-26)

**A real human voice has now been through the pipeline end to end.** The owner
supplied a 71 s consented Hinglish voice note; every stage below is a live
service response, not a claim.

| pipeline | status | evidence |
|---|---|---|
| **Voice cloning** | **WORKS, measured** | Zero-shot clone of the owner from their own 71 s reference. **ECAPA fidelity 0.7753** (p10 0.7479) against a **0.8869 self-vs-self ceiling**; verdict `warn`, so the activation gate correctly refuses (12 blockers). rtf 0.79–0.80 warm. n=2, spread 1e-6. **Zero-shot floor — NOT a claim about how it sounds** (that needs the blind ABX bench). |
| **Reference-window choice** | **measured, and it is the bigger lever** | Chatterbox truncates a reference to its **first 10 s** (s3gen) / **6 s** (T3 prompt); only the speaker embedding sees the rest. Which 10 s you pass spans **0.7433–0.8058** on the owner's voice — **0.0625, three times the fine-tune delta, at zero training cost** — and the best window beats every fine-tuned arm. Zero-shot; interaction with the adapter unmeasured. `reference-window-beats-the-finetune`. |
| **Per-speaker fine-tuning** | **BUILT and measured** | `services/voice-finetune` trains a LoRA adapter on a GPU job; the runtime loads it per request inside the same HMAC, disclosure and watermark path. On the owner's 71 s (62.1 s transcribed): **0.7753 → 0.7959, +0.0206, 18.4% of the gap to the ceiling, `warn` → `pass`**, n=2 spread 1e-5. Costs ~26% of synthesis speed (rtf 0.79 → 0.99). **A 71 s smoke test against a ≥30 min recommendation** — `lora-vs-zero-shot-71s`. |
| **voice-evidence round trip** | **WORKS — first ever run** | 71 s → 4 windows → 8 embeddings in **4 977 ms** warm; **176 s** cold start from zero. |
| **ASR (Sarvam)** | **WORKS** | sync `saarika:v2.5` 25 s → 200 in 4 134 ms (**hard 30 s cap**); batch `saaras:v3` 71 s → **5 diarized turns in 137 s**. `saarika:v2` is deprecated. |
| **transcript → sheet draft** | **WORKS** | 5 turns, 127 tokens, **92 honest `gaps`**, 8 phrase candidates. |
| **upload → finalize** | **finalize was BROKEN; fixed in tree, deployment behind it** | `replicaObjectInfo` parsed a HEAD-style route as JSON, so EVERY finalize failed closed and **nothing downstream of storage had ever executed for anyone**. One redeploy away. |
| **YouTube extraction** | **RUN, and the answer is split** | `services/media-extract` is DEPLOYED (`vyakti-media-extract`, Azure Container Apps, CPU, scale-to-zero, yt-dlp 2026.08.19, `/healthz` 200 in 47.9 s cold). Against real YouTube from that egress: **`/v1/enumerate` WORKS** (200 in 13.9 s, real ids — first ever live run of the channel lane) and **`/v1/extract` is BLOCKED** — `extractor_bot_check` in 2–3 s at the metadata probe, on **all 10** player clients yt-dlp offers. Lever 1 is exhausted; levers 2 (cookies) and 3 (proxy) need credentials nobody has yet and were NOT guessed at. `youtube-extraction-blocked-from-azure`. |
| **One link → one clone** (WS-AD) | code-complete, gated offline, **extraction step blocked upstream** | `/api/video-enroll`, `api/_video-enroll{.js,/windows.js,/quota.js}`, migration **060**, `src/studio/VideoEnrollPanel.tsx`. Paste one video URL → attest the channel (WS-S's table, reused) → extract → **score every ~10 s window and condition on the best one anywhere in the video** → ASR → sheet draft. `evals/videoenroll.mjs`, 80 checks, wired into `evals/run.mjs`. Migration 060 UNAPPLIED; `promoteReference` is a declared seam this deploy does not supply, so `reference_promoted` is false and says so. |

**Known-open, deliberately not guessed at:**
- Code-switch ratio reads 0.000 on visibly bilingual speech — `HINDI_MARKER_WORDS` is romanised, Sarvam returns Devanagari. Needs a decision (transliterate / extend lexicon / different model), not a patch.
- Fidelity cannot be persisted or clear activation until a voice profile + biometric consent + human liveness challenge exist.
- HMAC skew window (60 s) is shorter than `voice-evidence`'s 176 s cold start, so the waking request returns 401 — an auth error for a latency problem. Worked around by pinging `/healthz` first. **The open-voice lane fails differently and this line used to blur the two:** its broker verifies the signature the moment the request lands and only then forwards it, so a cold *GPU runtime* is a **timeout**, not a 401. Owned as of WS-W by `api/_voice/warmup.js` for the studio panel. **WS-AK has now measured the processing worker's copy of it on production and it is exactly this:** the deployed job's first `diarize` against a cold replica returned 401 `transport_signature_invalid`, the same code from a warm replica authenticated in 20 s, and the two HMAC secrets were confirmed identical by digest first so the obvious wrong fix (rotate the key) was not taken. Still unowned, now with numbers (`measurements.md#voice-evidence-round-trip-first-ever`, `rejected.md#signing-before-a-cold-start-cannot-authenticate`).

**The command, once env is set:** `node scripts/first-clone.mjs /path/to/voice.wav "Name"`
(input must be 24 kHz mono PCM16: `ffmpeg -i in.m4a -ac 1 -ar 24000 -c:a pcm_s16le out.wav`).

## What is NOT live

- **Voice QUALITY**: a consented reference HAS now been cloned and scored
  (`first-real-clone`), but that is speaker-embedding similarity — **no ABX
  bench has run**, and nothing may be claimed about how a clone sounds until
  the bench in `docs/gurukul/research/voice-stack.md` does. The INSTRUMENT for
  that bench now exists and is verified mechanically (WS-V,
  `earbench-is-the-listening-instrument`, run instructions in
  `docs/gurukul/EARBENCH.md`, one command: `node scripts/earbench.mjs stimuli`
  → `listen` → `score`). **No human has listened through it**
  (`no-human-has-listened`), and its two network reads — the Supabase reference
  and the Azure synthesis — have never run for want of credentials. Note the
  defect it surfaced: every synthesised clip SPEAKS the disclosure sentence and
  so unblinds any listening test unless trimmed
  (`disclosure-announces-the-clone`). Cold start (161 s
  ready, 504 at 242 s for the runtime; 176 s for `voice-evidence`) still needs
  a warm-up before any user-facing use — and the two lanes fail differently:
  the GPU RUNTIME times out behind its broker, while `voice-evidence`, which
  has no broker, is rejected **401** because the HMAC window is 60 s
  (`hmac-skew-shorter-than-cold-start`,
  `broker-healthz-is-a-front-door-not-a-readiness-check`). The studio panel now
  owns the first of those (`preview-cold-start-is-a-state`); the processing
  worker does not yet own the second.
- **Ingestion**: the statistical half now runs on a real transcript and
  produces a real sheet draft with 92 real gaps. Two things it does NOT do:
  the LLM qualitative pass is still a seam, and the code-switch signal reads
  **0.000** on visibly bilingual speech because `HINDI_MARKER_WORDS` is
  romanised while Sarvam returns Devanagari
  (`romanised-lexicon-meets-devanagari-asr` — deliberately unpatched, it is a
  choice between three options and needs a bench, not a guess).
- **"Preview my voice"** (WS-W): the studio panel, its route
  (`/api/voice-preview`) and its cold-start state machine are code-complete and
  gated offline (`evals/voicepanel.mjs`, 85 checks with negative controls).
  **Nothing has been synthesised through it.** The only live thing measured is
  the unauthenticated admission probe (`measurements.md#voice-panel-admission-probe`);
  the signed half needs `AZURE_OPEN_VOICE_ORIGIN` + `OPEN_VOICE_HMAC_SECRET`,
  which this environment does not have. Its central assumption — that a 12 s
  flush window is long enough for the platform to begin scheduling the GPU
  replica — is **untested** (`voice-panel-has-never-synthesised`).
- **The audio protection service** (WS-AL): `services/audio-protection` is
  **DEPLOYED AND SERVING** on Azure, which it had never been despite appearing
  in `ENV-MANIFEST.md`. That absence was the root cause of the owner's "Preview
  my voice" 500 (`audio_protection_origin_required`), under three code defects
  that were fixed the same day. All three endpoints answer on the serving
  revision `vyakti-audio-protection--0000002`, the watermark is
  **independently** detectable at confidence 1.000000 against a 0.000000
  negative control, and a cold start from true zero is **35.6 s with the
  triggering request returning 200** — where the GPU voice lane's is 161 s with
  the triggering request dying at 240 s. Numbers, method and n:
  `measurements.md#audio-protection-cpu-serving`. Full deployment state:
  `docs/gurukul/AZURE-DEPLOY-STATE.md` section 14.
  **The one remaining step is an owner dashboard paste**: five environment
  variables on `vyakti-replica-lab` and a redeploy
  (`audio-protection-vercel-env-not-written`). This session has no Vercel
  env-write tool and the preview route is behind `requireUser`, so the last
  link could not be closed here and is not claimed to be. Two decisions carry
  reversal conditions rather than being silent flag flips:
  `decisions.md#audio-protection-cpu` and `decisions.md#audio-protection-ingress`.
  The costly lesson is `rejected.md#a-green-build-and-a-green-healthz-can-both-lie-about-a-model`.
- **The Context Locker** (WS-AB, the universal "bring your context" lane):
  `/api/context-items`, `api/_context-locker.js`, `api/_context/*`, migration
  058, `src/studio/ContextLockerPanel.tsx` (MOUNTED in StudioApp.tsx, both
  modes, after EnrollmentWorkspace). Code-complete and gated offline
  (`evals/contextlocker.mjs`, 77 checks with three negative controls: a
  fabricated citation, an uncited addition, and a wrong-speaker chat export).
  **Nothing is live.** Migration 058 is unapplied and no statement in it or in
  the lane has ever been EXPLAINed — this environment has no `NEON_URL` and no
  `api/_config.js`, so the relational gates were skipped
  (`offline-mocks-cannot-type-check-sql` applies in full), so every request to
  `/api/context-items` will 500 until 058 is applied. The matrix of what is
  accepted, refused and routed is `docs/gurukul/context-locker.md`.
- **The Activity surface** (WS-AF, the owner's "we should see all the other
  processing going on, in a user view"): `/api/replica-activity`,
  `api/_replica-activity.js`, migration **060**, `src/studio/ActivityPanel.tsx`
  + `activity.css` + `activityApi.ts`. Code-complete and gated offline
  (`evals/replicaactivity.mjs`, 221 checks, wired into `evals/run.mjs`, with a
  negative control for the no-fake-progress rule and one for the deployment
  alternation). It normalises all seven async lanes to one job shape and emits
  `progress` for exactly ONE of them (the 8-step enrollment DAG); the other six
  return null and words. **Nothing is live.** Migration 060 is UNAPPLIED and no
  statement in it or in the read has ever been EXPLAINed — this environment has
  no `NEON_URL` and no `api/_config.js`, so the relational gates were skipped
  (`offline-mocks-cannot-type-check-sql` applies in full) and every request to
  `/api/replica-activity` will 500 until 060 is applied. It is NOT mounted:
  WS-AE owns `StudioApp.tsx` and left a named slot
  (`ProcessingStatusMount.tsx`, `where="feed"|"meet"`); the five-line swap is in
  `docs/gurukul/UX-QUEUE.md`. Two lanes that reported nothing at all now do:
  `vy_channel_watch` records its sweep outcome and reason
  (`a-fresh-timestamp-is-what-success-looks-like`) and `vy_ingest_run` keeps the
  video TITLE (`a-video-id-is-not-a-name`).
- **Student app**: built behind `VITE_PRODUCT_SURFACE=gurukul-student`, not
  deployed as its own project.
- **Channels** (WS-N, "deploy the clone anywhere"): the binding layer, the
  embeddable widget (`/embed.js` + `/api/clone-chat`) and the studio Channels
  step are code-complete and gated offline (`evals/clonechannel.mjs`, 64
  checks). Nothing is LIVE: migration 055 is unapplied, the widget refuses
  without `CLONE_WIDGET_SESSION_SECRET`, and no credentialed channel can be
  connected until a secret store is configured (`CHANNEL_SECRET_BACKEND`
  defaults to `none` and refuses). No byte has left this process on any wire.
  Instagram DM is deliberately NOT built — `docs/gurukul/INSTAGRAM-DM-GAP.md`.
- **Mirror Call** (WS-Y, the Call tab): the studio surface is code-complete and
  gated offline (`evals/mirrorcall.mjs`, 63 checks, wired into `evals/run.mjs`)
  — connect/end, ≤30s cascade windows, live captions, TWO labelled fidelity
  meters (measurement vs the ~10s conditioning window, per WS-Z's Chatterbox
  code read), a delta-chip rail capped at three chips a minute with each chip
  carrying its evidence count, per-turn 👍/👎 with an "I'd say it like this"
  re-record, and
  honest states for GPU warming / dropped ASR windows / an absent backend. What
  is NOT true of it: it has never spoken to a running `api/mirror-call.js` —
  WS-X's branch was not on origin when it landed
  (`mirror-call-contract-unverified`) — and the microphone, the multipart
  ingest and the audio playback have never run in a browser here. The screen
  renders its own "backend not deployed" state rather than a mock, so the
  untested half fails visibly rather than convincingly. Contract to satisfy:
  `src/studio/mirrorCallApi.ts`, which is the only file in the UI that knows a
  route or a JSON key.
- **A production-grade fine-tune**: the lane is built and works, but the only
  number is from **62.1 s** of speech against a **≥30 min** community
  recommendation, on **n=1 speaker**, with no held-out set and no ABX
  (`finetune-30min-corpus-unmeasured`). Note also that p10 PEAKS at 15 epochs
  and falls by 60 while the mean keeps rising — 60 epochs is not established as
  the right stopping point.
- **Fidelity thresholds**: still provisional and nothing is benched against
  ElevenLabs — but they now have one real anchor. On the owner's own voice the
  self-vs-self ceiling is 0.8869, so the 0.85 `target` sits just under the best
  the scale reaches for that speaker (`fidelity-needs-its-ceiling-printed`).
  The x-vector family cannot serve as a second opinion at all: raw cosine over
  it returns 0.997 and is saturated.
- **A persistable fidelity row**: `recordOwnedFidelity` needs a voice profile
  ref, which needs `biometric` consent, which `consentScopes` grants only
  through a live challenge. A score can be computed today; it cannot be stored
  or clear the activation gate without a human doing liveness.
- **The Mirror Call backend** (WS-X, `api/mirror-call.js` + `_mirrorcall*.js`,
  migration 058, `mirror-call/v1`): code-complete and gated offline
  (`evals/mirrorcall.mjs`, 452 checks, wired into `evals/run.mjs`). NOTHING is
  live. Migration 058 is UNAPPLIED and no statement in this lane has ever
  executed against a database — the offline cover is `evals/sqlcast`'s strict
  surface (types, statement shapes) and a DDL walk for erasure reach;
  `scripts/relcheck.mjs` has not run. Three lanes inside it are deliberately
  dark and say so on every response:
  - the **voice loop** withholds every window with
    `consent_scope_missing:training` (the modelling scope needs the liveness
    challenge nobody has passed) and then, even with consent, with
    `own_voice_unverified` — admission requires a MEASURED ECAPA cosine to an
    enrolled profile and no scorer produces one yet. So the candidate pool is
    empty, no conditioning window is ever selected, and the fine-tune queue
    stays empty. All four states are named on the wire.
  - ~~the **clone's reply** is not built~~ — **BUILT by WS-AC** (see below).
  - the **conditioning score** is a server-side WAV probe, not ECAPA, and
    `score_source` says so on every row and every payload.
- **The clone's reply inside a Mirror Call** (WS-AC, `api/_mirrorcall-reply.js`,
  migration **060**, `vy_mirror_turn`): the owner speaks and the clone answers
  back, in text and in the owner's own cloned voice. Code-complete and gated
  offline (`evals/mirrorcallreply.mjs`, 110 checks with four negative controls:
  a sheetless replica that a cooperative reply function cannot coax a turn out
  of, a struck owner clause that DOES leak the sheet, a disclosure-stripped clip
  that is refused, and a FORKED synthesis path whose watermark proof does not
  bind and is refused). What it does:
  - `ingest_window` assembles the reply from the owner's own TeacherSheet
    through `gatedReply` — the one door — and returns it as the `turn` object
    the studio captions. No fallback persona exists in the file; a replica with
    no sheet gets `turn: null` and `clone_sheet_absent`
    (`mirror-call-reply-is-the-one-door`).
  - no PUBLISHED sheet means the DRAFT sheet replies, with `sheet_source` on
    the row and on every payload
    (`mirror-call-answers-from-the-draft-sheet-and-says-so`).
  - `turn_voice` is **served** (it answered 501 in WS-X's tree) and synthesises
    through WS-W's `handleVoicePreviewPanel` unforked — same HMAC, same audible
    disclosure prefix, same watermark, same ledger, same 202-warming contract
    passed through byte for byte (`mirror-call-synthesis-is-reused-not-forked`).
    `MIRROR_CALL_UNSERVED_OPS` is now empty.
  - `status` was already served by WS-X and remains so.
  **NOTHING IS LIVE.** Migration 060 is UNAPPLIED, no statement in this lane has
  ever executed against a database (`NEON_URL` and `api/_config.js` are absent
  here, so the relational gates were skipped and `offline-mocks-cannot-type-
  check-sql` applies in full), and **no clone has ever spoken a Mirror Call turn
  aloud** — the synthesis half inherits every blocker on §"Preview my voice"
  above, including `AZURE_OPEN_VOICE_ORIGIN` / `OPEN_VOICE_HMAC_SECRET`
  (`mirror-call-reply-never-ran`). Without them `turn_voice` answers **503
  `open_voice_origin_required`**, and `can_voice` is false on every turn with
  `voice_absent_reason: "voice_route_unconfigured"` so the studio says why.

## Open owner items

1. **Push `claude/gurukul-platform` and redeploy the studio.** The upload
   finalize fix is committed and the deployment is behind it, so today every
   real upload still dies at 409 `storage_metadata_incomplete`.
2. Google App Password → SMTP (removes the email rate cap).
3. Rotate everything pasted into a chat transcript: Neon password, Supabase
   keys + management token, Azure SP secret, Google OAuth secret, and the two
   keys flagged in `session-2026-08-25b-close`.
4. Azure GPU quota, if the deploy agent reports the subscription has none.
5. Apply migrations 055, **058** (the context locker), **059** (the Mirror Call)
   and **060** (the Mirror Call's clone turns — without it every
   `ingest_window` returns `turn: null` with `clone_reply_failed` and
   `turn_voice` 404s), and set
5. Apply migrations 055, **058**, **059** (the Mirror Call) and **060** (the
   Activity surface: `vy_replica_activity`, `vy_ingest_run.video_title`, the
   three `vy_channel_watch` sweep columns), and set
   `CLONE_WIDGET_SESSION_SECRET` (≥32 chars,
   `openssl rand -base64 48`) — without it the embeddable widget is off.
6. Decide the channel secret store: set `CHANNEL_SECRET_BACKEND=azure-keyvault`
   plus `AZURE_KEY_VAULT_URL` / `AZURE_TENANT_ID` / `AZURE_CLIENT_ID` /
   `AZURE_CLIENT_SECRET`, or accept that Telegram and WhatsApp channels cannot
   be connected. Web widget and embed need none of it.
   (`docs/gurukul/ENV-MANIFEST.md` §15c.)
7. **Set `AZURE_OPEN_VOICE_ORIGIN` and `OPEN_VOICE_HMAC_SECRET` on Vercel** —
   both recoverable from the container app's `listSecrets` (see this file's
   own §"Secret recovery"). Until they exist, `/api/voice-preview` answers
   `503 open_voice_origin_required` and the studio panel can never produce
   audio. This is the single blocker on the first owner ever hearing their own
   clone in a browser.

8. **Decide whether the broker gets a cheap readiness route.** Today nothing in
   the app plane can wake or observe the private GPU runtime except a real
   `POST /v1/synthesize`, so every cold start costs a wasted synthesis. A
   `POST /v1/warm` on `services/open-voice-runtime/broker.py` would remove
   that; it is a service change, not an app-plane one, and was deliberately not
   guessed at (`rejected.md#broker-healthz-is-a-front-door-not-a-readiness-check`).

9. **Decide the YouTube lever** — the one blocker on "paste a link and get a
   clone" working for anybody. Extraction from Azure is refused at the bot
   check and lever 1 is measured dead
   (`measurements.md#youtube-extraction-blocked-from-azure`). The remaining
   two both cost something and are the owner's call, not an engineer's:
   **cookies** (a YouTube account's cookie jar — and the sources warn the
   account itself tends to get banned when used from a datacenter IP), or a
   **residential proxy** subscription. A third option nobody has costed: a
   PO-token provider plugin. Until one lands, the honest product answer is the
   one the studio already gives — download your own video from YouTube Studio
   and upload the file — and the CHANNEL LISTING lane works today regardless.
10. **Apply migration 060** (single-video enrollment) alongside 055 and 058.
11. **Set `AZURE_MEDIA_EXTRACT_ORIGIN` and `MEDIA_EXTRACT_HMAC_SECRET` on
    Vercel.** The service is live and the app plane cannot reach it without
    them; both are recoverable from the container app's `listSecrets`, the same
    way §"Secret recovery" describes for the voice pair.
## The laws a new session must not relearn

- `offline-mocks-cannot-type-check-sql` — a mocked DB proves control flow, not
  types or referential integrity. Smoke-test every lane against the real
  database before calling it done.
- `aliveness-was-unreachable-not-meera-bound` — a seam can be complete at both
  ends and still be dead because nothing passes the argument between them.
  Before calling a capability "wired", grep for a CALLER, not a definition.
  database before calling it done. A mock cannot even tell you the statement
  PARSES: three shipped queries were 0A000 and had never executed once
  (`statement-shapes-postgres-will-not-parse`). EXPLAIN it — one round trip,
  no write (`explain-is-the-only-parser-we-have`).
- `coverage-lists-that-enumerate-a-subset` — a coverage check is only as wide
  as the thing it enumerates, and fixing ONE enumeration teaches you nothing
  about the others in the same query. When you widen one, list every other
  enumeration alongside it and widen or justify each.
- `gurukul-no-production-glob` — a feature branch must never match another
  product's deploy trigger.
- `track-lists-must-not-assume-a-child-exists` — a grid or flex track reserved
  for a child collapses the column the moment that child is deleted, and NO
  overflow check can see it, because a collapsed column overflows nothing. Nine
  such rules were found in `src/studio/`. Guard the rail with `:has()`, or pin
  the children to their columns explicitly. `scripts/check-layout.mjs` holds it
  and its negative control is written in its header.
- `a-check-must-be-able-to-reach-the-screen-it-judges` — the layout gate pointed
  at signed-out `/studio` measured six blocks of sign-in copy and reported OK
  against the exact bug that shipped. Assert COVERAGE in every gate, and pair
  the assertion with a way to satisfy it that needs no secret: the answer here
  was `studio-layout-fixture.html`, the real components against fixture props.
- `a-media-query-cannot-see-a-narrow-container` — the studio's content column is
  276px narrower than the viewport because the rail is beside it. Breakpoints
  written against the viewport fire in the wrong place. Use
  `repeat(auto-fit, minmax(min(100%, N), 1fr))`, which asks the container.
- `layer-order-must-survive-the-minifier` — LightningCSS strips a standalone
  `@layer a, b, c;` statement. That inverted the studio's cascade and shipped
  every primary CTA at 1.73:1 contrast. The order is declared in an inline
  `<style>` in `studio.html`'s head; if you change the layer names, change it
  there too.
- `recited-prompt` / `prompt-position` — write shapes, never lines; position is
  mechanism.
- Isolation is a SQL predicate, never a prompt instruction.
- Every claim is measured or it is marked unverified. No offline numbers in
  `measurements.md`.
- `aliveness-was-unreachable-not-meera-bound` — "is this module generic" is the
  wrong question. Name the CALL SITE that reaches it with a non-default agent;
  a grep with no hits means the feature does not exist for that agent.
- `clone-initiative-record-has-no-absence` — a clone may speak first only on a
  citable reason. Silence, gaps and streaks are not inputs the predicate HAS.
  Do not re-add a silence-triggered ping in any form, on any surface.
  `measurements.md` — with one narrow exception added 2026-08-26: a measurement
  OF A PROMPT'S OWN TEXT (`exdialog-surface`) is exact rather than a proxy, and
  is admitted with its scope line stated before the numbers. A number produced
  against a MOCKED DATABASE is still not admissible as a product measurement,
  and `surface-switch-recall` says so in its own entry.
- **Memory is never keyed by surface** (`api/_surface.js` §4). Retrieval
  violated this until 2026-08-26 and lost 89.2% of recall on a surface switch;
  the legacy FORGET lane violated it until later the same day
  (`forget-follows-the-person` closed `legacy-forget-is-device-scoped`; live
  eval `evals/forget/crosssurface.mjs --live`, 39/39 with negative controls).
- A mock branch keyed on a TABLE NAME will one day answer a different query
  than it was written for, and a mock that OVER-RETURNS hides real defects while
  every assertion stays green
  (`router-matched-a-table-instead-of-a-statement`).

## Session log

Append-only. One line per workstream, newest at the bottom. This lives at the
END of the file on purpose: the merge helper unions append-only regions, so a
line added here by two agents at once merges cleanly, while a line added to the
header stacks up. See the header for the full reason.

- **WS-W** — "Preview my voice" — the owner-facing panel, and the cold start told honestly
- **WS-AL** — the audio protection service deployed and serving; "Preview my voice" is one dashboard paste from real audio
- **WS-U** — per-speaker fine-tuning built, and its delta measured
- **WS-X** — the Mirror Call backend — approval as one SQL clause, and a voice loop that selects rather than accumulates
- **WS-AC** — the clone answers back — the Mirror Call reply lane, and a synthesis path reused rather than forked
- **WS-AD** — media-extract deployed to Azure and run against real YouTube — the bot check is REAL and measured; the one-link enrollment lane built around it
- **WS-AF** — the Activity surface — every async lane in one honest shape, and the two lanes that were reporting nothing
- **WS-AK** — the processing worker deployed as an Azure Container Apps Job — and the commit statement that had never once written a piece of evidence
- **WS-AM** the studio made readable: nine track-list rules that reserved a column for a child that no longer exists, and a layout gate that can finally see the signed-in screen
