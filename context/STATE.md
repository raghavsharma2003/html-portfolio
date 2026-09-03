# STATE — read this first, then the graph

One page, kept current, so a new session spends zero tokens re-deriving where
the project stands. Deep history lives in `decisions.md` / `rejected.md` /
`measurements.md`; the index is `graph.json` (`node scripts/context.mjs`).
**If this file and any other disagree, the other files win — fix this one.**

Last updated: 2026-08-27, and this line is the ONLY one of its kind in this
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
- Gates: `node scripts/verify-release.mjs` is **16 checks** as of 2026-08-27
  (14 without `NEON_URL`, which skips the two relational db gates). The count
  has grown as gates were added: WS-AM's layout readability, WS-AR's enrollment
  sample-rate mirror, WS-AS's enrollment bandwidth. `relcheck` is a hard gate
  wherever a URL is reachable. `npx vite build` alone is NOT a gate: it exits 0
  with type errors.

## What is LIVE (verified, not assumed)

| thing | state |
|---|---|
| Neon Postgres | migrations 015–062 applied and verified live (**125 tables**, checked 19:00Z). `verify-release` runs **13** checks when `NEON_URL` is set — the two relational DB gates that had never actually run — and 11 with a printed skip when it is absent |
| Supabase (new project, separate from Meera's) | auth working; `vyakti-replica-private` bucket created |
| Auth | Google OAuth live; email OTP live (6-digit); built-in mailer capped ~2/hr until SMTP |
| Studio | `vyakti-replica-lab.vercel.app` → teacher studio at `/`; replica create/list verified against live DB |
| Meera production | untouched; its deploy trigger no longer matches this branch |
| In-house voice | Azure RG `vyakti-voice`: Chatterbox GPU runtime + admission broker + voice evidence, scale-to-zero, synthesising (RTF 0.79 warm). `docs/gurukul/AZURE-DEPLOY-STATE.md` |
| Enrollment processing queue | **LIVE on the corrected long-media worker** (2026-08-27 06:33Z). `vyakti-replica-processing` runs immutable image digest `sha256:192e7372...91a1`, every five minutes, with a 3,600 s replica timeout and 3,300,000 ms work budget. The owner's current source is `ready`, all eight jobs are `complete`, and VoiceGenome v2 is a `draft` over one 10 s / 24 kHz DeepFilterNet3 reference. A manual execution of the deployed digest succeeded in 29 s. Signed TUS, disk-streamed verification/ClamAV/Sarvam and overlapping long diarization are live in the worker and web runtime. The remaining large-file ceiling is the Supabase project's global Storage setting: the API refused a 1 GiB bucket limit while the bucket remains private with no per-bucket override. |
| Vyakti Rooms v1 database (WS-R1..R10, 2026-09-03) | Migrations **071-076 applied live** and every new statement `EXPLAIN`ed against the live database before merge (`decisions.md#rooms-migrations-applied-live-in-the-union-order`, `#rooms-migration-076-confirmed-live`): `vy_room`/`vy_room_follower`/`vy_room_thread` (071), `vy_replica_voice_challenge` + its attempt ledger (072), `vy_replica_readiness` (073), `vy_review_card`/`vy_review_never_rule` (074), `vy_interview_session`/`vy_interview_answer` (075). **Migration 076** (`vy_replica_drift_report`, drift watch) was read back from the live database on 2026-09-03: table plus three indexes present. **No real row has been written to any of these six tables outside a fake `db` in an offline eval** — WS-R7 says this of `vy_room` directly ("no real `vy_room` row has ever been inserted anywhere outside a fake `db`"), and nothing in any WS-R1..R10 or main-loop session log entry claims otherwise for the other five. **One Room preview smoke test is recorded** (`measurements.md#rooms-preview-smoke-2026-09-03`): `/r/` serves on the studio project's preview of this branch, an unknown slug returns a named `room_unavailable` 404, an unknown op returns 400, owner endpoints demand a bearer token; no real `vy_room` row was inserted. |
| Vyakti Rooms v1 gates | `node scripts/verify-release.mjs`: **15/15** without `NEON_URL` as of the Rooms merge (14 plus the room leak battery, `evals/room-leak/run.mjs`, now a named release gate: 16,080 retrieval checks + 441 boundary checks, 0 leaks, offline, deterministic, ~6s). `node scripts/check-copy.mjs`'s Rooms vocabulary rule (bans `clone`/`replica`/`model`/`fine-tune`/`train`/`weights`/`embedding`/`LoRA`/`genome` in user-visible strings) is live and clean on the committed tree (117 real hits found and fixed by WS-R10, 0 remaining). Both reconfirmed by this workstream on the untouched tree, 2026-09-03: 15/15 and clean. |

## START HERE: WHERE THIS ACTUALLY STANDS (2026-08-27 03:45Z)

Everything below this block is older and some of it is superseded. Read this
first; where it disagrees with anything further down, this wins.

**THE ONE OPEN PROBLEM: the clone does not sound like the owner.** Their
verdict, verbatim: "not even 0.05% similar", and the base voice is "very
western and not indian". Everything else in this product now works; this does
not, and it IS the product.

What is settled about it, measured rather than argued:
- **Cloning IS happening.** Three different enrollment references, same replica,
  text and seed, produced three different outputs (`b4ff277d88`, `65219c4f38`,
  `c7ba0591f8`). A model ignoring its reference is byte identical across arms.
  So do not go looking for a disconnected wire; the fault was reference QUALITY.
- **The reference was 8 kHz audio wearing a 24 kHz label.** Measured by FFT:
  0.000458% of energy at or above 8 kHz. Two causes, and the second one is the
  one three sessions walked past: `separate` runs `sepformer-whamr16k` at 16 kHz
  UNCONDITIONALLY, including on a recording with one speaker and nothing to
  separate; and the 16 kHz bytes cut for window SCORING were being reused as the
  DELIVERED reference bytes, so skipping separation alone would not have helped.
- Both are fixed in `api/` and merged. After the fix, 0.0224% (about 49x).

**What is now done, and what remains:**
1. **The 24 kHz reference fix is live.** The Container Apps Job was rebuilt,
   pinned by digest and read back from Azure. The owner's real pipeline is at
   one ready source, eight complete jobs and VoiceGenome v2 draft. A fresh
   same-text Hindi preview from v2 returned 263,084 bytes of 24 kHz mono WAV,
   with PerTh verified. This proves the deployed v2 path runs; it does not
   prove acceptable likeness.
2. **There is still no authoritative speaker-similarity verdict for v2.**
   Nobody has measured likeness, only bandwidth, and bandwidth is not likeness.
   `vyakti-voice-evidence` has `ingress.external=false` so a session cannot
   reach it. The repo's known ceiling is 0.8869. **Do not report a proxy metric
   as fidelity.** An invented number here is the worst possible outcome.
3. DeepFilterNet3 on versus off is unmeasured. The owner's audio has real
   background noise, so it is a genuine trade, not an obvious call.
4. Browser upload is resumable and multi-file, but the account-level Supabase
   global Storage limit still refuses a 1 GiB bucket setting. Do not advertise
   1 GiB as live until that account setting is raised and a real >50 MiB TUS
   upload is completed.
5. **Vyakti Rooms v1 landed on top of all of the above, and does not change
   any of it (2026-09-03, WS-R1..R10).** The voice problem above is
   completely unchanged — **no human has listened** through a real earbench
   run, still (`no-human-has-listened`). What Rooms adds: an **identity path
   now exists behind a flag** (`VOICE_IDENTITY_CHALLENGE` +
   `VITE_VOICE_IDENTITY_CHALLENGE`, both default off, `docs/gurukul/ENV-MANIFEST.md`
   §25) as an alternative to the still-undeployed Azure identity/liveness
   stack — it has never been exercised end to end and has no different-speaker
   control, so its 0.70 reject floor is inherited, not earned. The **follower
   Room now exists** at `/r/<slug>` (migration 071, applied live) with a leak
   battery proving its three scopes hold offline, but no real Room has ever
   been published or joined outside a fake `db` — see the LIVE table above.
   **Model keys are still absent** on the studio Vercel project — not new,
   not fixed by Rooms, and it means every LLM-backed reply on that project,
   Room included, cannot produce a completion regardless of how much of the
   above is wired correctly (`docs/gurukul/ENV-MANIFEST.md` §25).

**Two live operational facts a new agent will otherwise rediscover painfully:**
- `vyakti-open-voice` (the GPU) has `minReplicas=0`. A warm GPU answers in about
  54 s; from cold it has exceeded 200 s and returned `wake_in_flight` ten polls
  running. The studio panel gives up at 180 s, which EQUALS the top of its own
  advertised "2 to 3 minutes". Same defect shape as the 60 s signature meeting a
  100-160 s cold start. Keeping a GPU warm bills continuously and is the owner's
  money: do not set `minReplicas` without being asked.
- The preview ledger (`neon-ledger.js`) structurally cannot open for ANY preview
  generation without an active runtime capability, because a preview's
  `voice_profile_id` is always NULL while the capability table's matching column
  is NOT NULL. Unrelated to reference quality. See
  `rejected.md#preview-ledger-requires-activation-this-replica-does-not-have`.

**What DOES work now, verified, so you do not re-audit it:** journey 15/15;
16/16 gates; CI green on PR #5; all eight DAG steps complete on the owner's real
822.7 s upload; voice genome v1 draft exists; `REPLICA_SELF_TEST_MODE=true` is
live on the job so enrollment gates no longer block; `SARVAM_API_KEY` is on the
job; the five audio-protection vars are in Vercel; a real preview returns real
watermarked audio with the spoken disclosure.

---

## WHERE THE PRODUCT ACTUALLY STANDS (2026-08-26 19:15Z, measured)

**Superseded in part by the block above.** Kept because the technique and the
failure analysis below are still the best record of how this was established.

The single most useful section for a new agent: this was established by driving
the REAL deployed frontend in a real mobile browser against the REAL backend,
not by reading code. The harness lives in the session scratchpad, and the
technique is reusable and worth rebuilding if it is gone:
**the container's egress policy resets the browser's HTTPS, so a loopback
bridge serves production bytes fetched with node and relays `/api/*` back to
production.** Real rendering, real API, real signed-in user.

**Journey score at the time: 12 of 15. It is now 15/15** (2026-08-27 00:05Z); the two remaining failures were the product CORRECTLY refusing a brand new replica with no identity, which the journey was scoring as a bug. The assertion now accepts a NAMED refusal from the known set and still fails on an unnamed one, an unrecognised code, or any 5xx. Original note follows.

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
| separate | **complete** (WS-AO, 2026-08-26 21:38Z) | Windows to the owner's own best-scoring ~10 s (`api/_replica-processing/reference-window.js`), never the whole file. Real production artifacts: two 320,044-byte (10 s @ 16 kHz mono) Sepformer candidates, not the 822.7 s original. Succeeded on attempt 1 of the requeued job, on the SAME real upload that failed 5/5 before the fix. Was NOT a capability absence and had nothing to do with `transcribe`'s adapter family, which is why WS-AN (2026-08-26, concurrent) correctly left it uninvestigated |
| enhance | **complete** (same run) | Four 960,044-byte (10 s @ 48 kHz mono) DeepFilterNet3 candidates over the windowed reference, chained automatically the moment `separate` committed |
| transcribe | blocked, `sarvam_asr_config_missing` → reported as `asr_unconfigured` | WS-AN (2026-08-26, concurrent) rewired this step onto the Sarvam Saaras batch adapter, replacing the unreachable Azure Speech path, and proved the new code path runs. `SARVAM_API_KEY` is not yet on the job's env — it lives in Vercel's `vyakti-replica-lab` per the owner, and no session yet has a route to read Vercel env values back. Auto-recovers via `requeueRecoveredProcessingJobs` the moment the key lands; no manual requeue needed. Deliberately reads the FULL original source, not the windowed clip (`runtime.js`'s `INPUT_STAGE`) |
| voice_quality | blocked behind `transcribe` | DAG dependency; nothing to do until the Sarvam key is set |

**A second, DATA-layer collision, found but not caused by this session and NOT
fully explained.** The table above is what production measured at 21:38Z, with
real row-level evidence (job IDs, byte sizes) captured at that moment. By
21:50Z, querying the SAME database found `vy_replica_processing_job`,
`vy_replica_processing_evidence`, `vy_replica_processing_artifact` and
`vy_replica_source` all cleared to near-empty (2 rows, 0, 0, 1 row respectively)
-- the owner's real source and every job against it, including the ones this
session had just fixed, gone; replaced by one small unrelated test source
(`source_id efc3c9b5…`, first row at 21:50:19Z) that reads like WS-AN
restarting their own Sarvam testing against a fresh fixture. Every query this
session ran against Neon in that window was a plain `select`
(`scripts/relcheck.mjs`/`check-citations.mjs`, confirmed read-only by source
inspection, and this session's own `nq.sh` helper) -- **this session did not
delete the data**, but it did not confirm who or what did either. Treat the
DAG-position table above as "true as measured with real production evidence at
21:38Z, on a job that itself no longer exists to re-query" rather than as
"true right now" -- the fix is proven and the CODE remains deployed; the
specific PROOF ROW is gone. Worth a person asking WS-AN's session about
directly, since this session has no route to another session's actions.

**A deployment collision, caught and corrected within this session.** WS-AO's
first production deploy (image `@sha256:b1cfc1…`) was built from a worktree
branched BEFORE WS-AN's Sarvam merge landed on `claude/gurukul-platform`, and
overwrote WS-AN's already-deployed image (`@sha256:3e6c50…`) on the SAME
Container Apps Job — the two sessions never touched the same file, but they did
target the same live resource. Caught during the post-work rebase, before
either session's context log claimed a final state. Fixed by rebuilding from
the REBASED, merged tree (both changesets) and redeploying once more; see the
session log for the final image digest actually left running. **The lesson for
whoever reads this next:** two workstreams sharing a DAG can still collide on
the SERVICE even when their diffs never touch the same line — check the live
resource's current image/config before deploying, not just the git diff.

**The real cause of `separate`'s failure was confirmed structurally, not from a traceback** -- `services/voice-evidence/app.py`'s `/v1/analyze` ends in a bare `except Exception` with NO logging, so nothing about the failure ever reached Log Analytics across all 5 production attempts. What WAS confirmed: every OTHER exception path in that file raises a NAMED error (so every named validation, including the duration cap, provably passed); the replica's `restartCount` stayed 0 across all 5 attempts (rules out a container-level OOM kill, consistent with an in-process, catchable `torch.cuda.OutOfMemoryError`); and the only GPU-bound call in `_separate()` is one unchunked forward pass over the whole 822.72 s / 13.16M-sample waveform. Full reasoning: `context/measurements.md#separate-underlying-error-confirmed-structurally`.

A 30-minute lecture would still have failed here even with a raised cap: 1200 s
was a hard ceiling compiled into `app.py`, and raising it only moved the wall
from `diarize` to `separate`. `best-window-not-first-window` was the decided
fix and it is now LIVE for `separate`: never send a whole recording to the
embedder, send the best-scoring ~10 s window drawn from the owner's own
diarized cluster (never a second speaker's). WS-U measured window choice
moving fidelity more than fine-tuning does (0.7433-0.8058 spread versus a
0.0206 fine-tune delta), so windowing is both correct and higher quality.

One fact a new agent must not re-derive:
- **`vy_replica_source.duration_ms` propagation was ALREADY FIXED** by the time
  WS-AO checked (verified live: `duration_ms=822720`, not NULL, on the owner's
  real row). `repository.js`'s `commitProcessingOutput` reads it straight out
  of `desired_evidence` on the `media_probe` commit -- a previous session (the
  `commitProcessingOutput` rewrite credited in this file's LIVE table) already
  closed this trap. Confirm before re-fixing a trap that is gone; this file
  used to say it was still open and that was stale.

### "Preview my voice" was broken in FIVE stacked layers

Each hid the next; all five are worth knowing because the pattern recurs.
1. The panel sends no `style`; the validator refused an ABSENT style with the
   same 400 as a typo, so every preview from the default path failed.
2. The route flattened that named 400 into an opaque 500 **and logged nothing**,
   which is why nobody could see layer 1.
3. The route only mapped errors carrying a `code`; sixteen validators in `api/`
   throw a bare `{status:400}`. Fixed as a class, not an instance.
4. **The audio-protection service was never deployed.** Every clip must
   carry the spoken disclosure and the PerTh watermark before delivery, so NO
   replica audio can leave for anyone.
   **Never stub or bypass this to get a green screen.**
5. **Root, found by WS-AR after 1-4 and the env pastes were all done and the
   owner still got `wav format unsupported` after a ten minute wait:** the
   enrollment reference the enhance stage PRODUCES and the rate
   `probeEnrollmentWav` DEMANDS before synthesis disagreed — 48 kHz emitted,
   24 kHz required, no test ever exercised both sides of that boundary
   together. 23 real dated `vy_replica_generation` rows on the owner's own
   replica prove this failed in production, repeatedly, before the fix.

Layers 1 to 3 are fixed in code. Layer 4 is fixed in infrastructure (WS-AL
deployed `vyakti-audio-protection`) and the five Vercel env vars are pasted
(session log, 22:20Z). Layer 5 is fixed in `services/voice-evidence/app.py`
(`enrollment-artifact-resamples-to-24k-inside-enhance`) and **this is the
layer that made the owner's most recent report** — the first four were
already closed by the time they hit it. **All five layers are now proven
closed together, on the owner's own replica, with real audio bytes coming
back** (`measurements.md#wav-format-unsupported-fixed-and-proven-end-to-end`).
A cross-boundary gate (`scripts/check-enrollment-sample-rate.mjs`) now asserts
the rate that produced layer 5 can never silently drift from the rate that
gates it again.

The lesson, now encoded: a refusal that chose its own 4xx keeps it, a
configuration absence answers 503 BY SHAPE rather than by a list of names, the
code is always logged, and a value emitted by one service and demanded by
another needs an assertion that they agree — because "the format gate exists"
and "the two sides of it agree" are different claims, and only testing the
whole path together catches when they do not.

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
- ~~**"Preview my voice"** (WS-W): ... **Nothing has been synthesised through
  it.**~~ **STALE as of WS-AR, 2026-08-27 — real audio now synthesised through
  the real deployed path.** `AZURE_OPEN_VOICE_ORIGIN` + `OPEN_VOICE_HMAC_SECRET`
  are set (session log, 22:20Z), and the fifth stacked blocker (the enrollment
  sample-rate mismatch, see above) is fixed and proven end to end on the
  owner's real replica: `handleVoicePreviewPanel` returned real audio, 24 kHz
  mono PCM16, `state='sealed'` (`measurements.md#wav-format-unsupported-fixed-
  and-proven-end-to-end`). The 12 s flush window / cold-start assumption is
  now measured too: the cold start this session hit was ~3.5 min end to end
  (dispatch to audio), consistent with the ~161 s GPU-ready figure elsewhere in
  this file. What is NOT yet proven: the actual browser panel UI driving this
  same call — this session called `handleVoicePreviewPanel` directly with real
  collaborators, not through a browser hitting `/api/voice-preview`, so the
  request/response wiring at the HTTP layer (auth via `requireUser`, body
  parsing, CORS) remains `evals/voicepanel.mjs`-gated-offline rather than
  browser-verified.
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
- **WS-AN** — `transcribe` rewired onto Sarvam (owner directive, no Azure Speech account) and shipped to production via a real ACR build + Container Apps Job patch; DAG position re-measured on the owner's real upload and it now stops at `separate` (terminal, pre-existing, unrelated to ASR), with `SARVAM_API_KEY` still needing a paste from Vercel to Azure
- **WS-AM** the studio made readable: nine track-list rules that reserved a column for a child that no longer exists, and a layout gate that can finally see the signed-in screen
- **WS-AO** — `separate` windows to the owner's own diarized speech instead of the whole recording — proven on the owner's real 822.7 s upload, which now clears `separate` and `enhance` and stops at `transcribe`, still `asr_unconfigured` pending `SARVAM_API_KEY`; also caught and corrected a same-resource deploy collision with WS-AN's concurrent image push
- **main-session 22:20Z** — the Sarvam key is ON the Azure job (verified by GET: `SARVAM_API_KEY` -> `secretRef=sarvam-key`, five secrets intact, ten sibling env vars untouched, provisioningState Succeeded). Every owner paste is now done. The pipeline has no known configuration blocker left, and steps 5 to 8 have still never run against a real file.
- **WS-AP** — one honest next action, and the sticky pager that was deleted rather than fixed a third time. `goStep` no longer changes step unconditionally; `WizardRail`/`CompactRail` (always visible, never pushing) are now the ONLY forward navigation in the studio, after the owner directive to delete `.wizard-pager`/`StepPager` outright rather than shrink or gate it — its two prior fixes (stop it covering content; gate its Next button on step readiness, `wizardModel.pagerAction`) were each correct against their own diagnosis and each drew the same complaint back, which is `context/rejected.md#the-sticky-pager-was-deleted-not-shrunk`. A `PlatformWorkBanner` now sits under every step's head so processing state is visible with no scroll at 390/834/1355px; `jumpTo` moves real DOM focus (`tabindex="-1"`, `.focus()`, an `aria-live` announcer) rather than only scrolling, for blocker "Go there" links and the top-level error banner. Reclassified `voice_genome_not_approved` from `platform` to `you` (`context/decisions.md#voice-genome-approval-is-the-owners-turn-not-the-platforms`) after a production run showed "Preview my voice" saying "waiting on us" while the true blocker was the owner's own unreviewed evidence; `VoicePreviewPanel` now reads `wizardModel.voicePreviewBlockReason` instead of hardcoding its class. Fixed three more measured production defects: the Voice-versions counter reading "0 / Not built yet" against a real draft genome (query was approved-only scoped; added an unscoped `vg_latest` join, EXPLAINed and executed live — and caught its own backtick-inside-template-literal syntax bug before any gate ran, `context/measurements.md#replica-runtime-genome-latest-query-explained-live`); the Activity panel's "Look at the build" tap doing nothing (`onAct` was never wired; now navigates to Processing Review); and the GPU cold-start wait resetting on a tab switch/reload (now persisted to `sessionStorage` and re-attached on remount instead of restarted). Also fixed: the duplicate "Where each upload is right now" heading (`ActivityPanel`'s own `<h2>` plus its host `Band`'s identical title; added a `showHeading` prop) and "Sent to the channel lane lane" (`routed_to` already carries `_lane`, `api/_replica-activity.js` appended the word again). `node scripts/verify-release.mjs` 14/14 with `NEON_URL` set; negative controls proven both ways (reintroducing the sticky pager markup produces 18 `pager-returned` findings in `scripts/check-layout.mjs`; the pre-fix unconditional-advance shape is still asserted failing in `evals/studiowizard.mjs`). No approve-a-genome endpoint exists anywhere in `api/` — noted, not built, out of scope for a UX workstream.
- **WS-AR** — the "Preview my voice" `wav format unsupported` bug, confirmed and fixed at its real source: `services/voice-evidence/app.py`'s `_enhance` always emitted 48 kHz while `probeEnrollmentWav` always required 24 kHz, and 23 real dated `vy_replica_generation` rows on the owner's replica prove this failed for real, repeatedly, before this session. Fixed by resampling with `torchaudio.functional.resample` inside the service (never a hand-rolled decimator in the API layer), deployed to production (`voice-evidence@sha256:b2e2b74349ee8d1e2f3d346ea5bf070a5dcf4808ca8b4cd39845ae20dbd83914`), and **proven end to end**: a real 24 kHz enrollment artifact regenerated through the real Container Apps Job, and a real call through the real `handleVoicePreviewPanel` returned **200, 266,924 bytes, 24 kHz mono PCM16, 5,560 ms, `state='sealed'`** (disclosure + watermark intact) — the first real audio this call path has ever returned. Added `scripts/check-enrollment-sample-rate.mjs`, a new `verify-release.mjs` gate that mirrors the enrollment rate across all four sites that name it and fails if they disagree, with a negative control (`measurements.md#wav-format-unsupported-fixed-and-proven-end-to-end`, `decisions.md#enrollment-artifact-resamples-to-24k-inside-enhance`, `rejected.md#revision-bump-cannot-be-partial-across-the-dag`). `voice_quality` on this one replica is left `failed` (`voice_evidence_input_count_invalid`, a side effect of this session's verification method, not a product defect — see `rejected.md#voice-quality-cannot-see-a-partial-artifact-generation`); it does not block preview, which never reads `voice_quality`'s output. **Adjacent finding, NOT fixed here, flagged for a separate workstream**: `api/_replica-voice-profile.js`'s `selectAzureEnrollmentArtifacts` requires ≥30 s of enrollment audio (a real Azure Personal Voice vendor minimum, also enforced independently in `api/_voice/providers/azure-personal-voice.js`), but WS-AO's best-window fix now produces exactly one ~10 s window per source. This is real but unreached today: the whole Azure Personal Voice lane sits behind identity/liveness verification, which is still DARK pending Microsoft approval, and it is a DIFFERENT code path from the one this session fixed (`beginOwnedVoicePreview` never calls `selectAzureEnrollmentArtifacts`). The selector also structurally caps at ONE artifact per source_id, so even multiple ranked windows from the SAME recording would not combine to reach 30 s without a second change to that dedup logic — not a one-line fix.

- **WS-AQ** — `REPLICA_SELF_TEST_MODE` (default off): a self-mode replica's identity/liveness/consent and evidence/artifact review are auto-granted through the real `acceptAllOwnedEvidenceForSelfTest`/`selectOwnedVoiceArtifact`/`queueOwnedVoiceGenome` code paths as its sources reach `ready`, tagged in `metadata` for one-query revocation (`scripts/revoke-self-test-grants.mjs`), proven live both ways (flag on clears all 4 gates and queues a draft build; flag off/absent leaves all 8 blockers and a 409, unchanged) — `docs/gurukul/REPLICA-SELF-TEST-MODE.md`
- **WS-AS** — confirmed the owner's exact diagnosis: `separate` (`sepformer-whamr16k`, 16 kHz Nyquist) ran on EVERY recording and destroyed 4-10 kHz before `enhance` ever saw a sample; measured 0.000458% energy at/above 8 kHz on the real broken reference. Fixed by skipping `separate`'s GPU model when diarize shows one dominant speaker (>=90% share) and cutting the reference window fresh from the ORIGINAL recording at 24 kHz instead — measured 0.0224% after (~49x), real FFT, real owner source (`measurements.md#enrollment-reference-bandwidth-before-after`, `decisions.md#separate-skips-below-16khz-when-diarize-shows-one-dominant-speaker`). Also answered the coordinator's escalated Q1 ("is any cloning happening at all") directly against the real deployed Chatterbox broker: same text/seed/style, three different references, three different outputs (byte length AND hash all differ) — the reference DOES condition synthesis. Added `scripts/check-enrollment-bandwidth.mjs` (real radix-2 FFT, no dependency) as a new `verify-release.mjs` gate with a negative control, recalibrated once against real measurements after a clean-speech-intuition guess (1.5%) failed the real fix (`rejected.md#bandwidth-threshold-first-guess-was-miscalibrated`). Did NOT get a real ECAPA fidelity number — `voice-evidence` has no external ingress from this session (confirmed 404) and no image rebuild was done, so this session cannot claim a cosine similarity, only the bandwidth measurement above. Found but explicitly did NOT fix, flagged for whoever owns it: the production preview ledger (`neon-ledger.js`) structurally cannot open for ANY preview generation on a replica without an active runtime capability, because a preview's `voice_profile_id` is always NULL while the capability table's matching column is NOT NULL — unrelated to reference quality (`rejected.md#preview-ledger-requires-activation-this-replica-does-not-have`). DeepFilterNet3 on-vs-off was NOT measured (`rejected.md#deepfilternet3-on-vs-off-not-measured-this-session`) — the fix lives entirely in `api/_replica-processing/*`, so the deployed `vyakti-replica-processing` job has NOT picked it up (no ACR rebuild done this session); a real end-to-end pipeline run through the deployed container is still needed before this is proven beyond the locally-run code path. Generated clip at `scratchpad/q1-direct-AFTER.wav`.
- **main-session 03:45Z** — merged WS-AM/AN/AO/AP/AQ/AR/AS; journey 15/15; 16 gates; REPLICA_SELF_TEST_MODE turned ON live on the Azure job; the owner heard their clone and rejected it as not sounding like them, which opened the reference-quality investigation now recorded at the top of this file. WS-AT dispatched to deploy the fix and get a real similarity number.
- **main-session 06:35Z** — shipped signed TUS/multi-file enrollment, 1-2 h disk/chunk processing, the corrected 24 kHz reference worker (`sha256:192e7372...91a1`), Vyakti legal/landing fixes and agent-scoped DM/room memory. Vercel production is `READY`; migration 064 is live; real Postgres relcheck 34/34, binding 62/62 and Telegram handler 101/101 passed; the deployed worker smoke succeeded in 29 s. The owner's real source remains ready with 8/8 jobs complete and VoiceGenome v2 draft. A fresh v2 same-text Hindi preview is 263,084 bytes, 24 kHz mono and PerTh-verified. Supabase refused the 1 GiB per-bucket setting because it exceeds the project global limit; no plan purchase was made.
- **self-test-guard workstream** — replaced the late global one-boolean ceremony bypass with an owner-bound three-part guard, added pre-upload bootstrap for all six private source/model scopes, preserved the real technical processing gates, wired the worker Bicep opt-in and added 15 fail-closed checks. **LIVE for the allowlisted owner**: Vercel deployment `dpl_5j6gAQ8mxs8FsJHLhZq2QGnBoSWy` is `READY`, Azure ACR run `cu18` produced worker digest `sha256:51663ce8...9200a8`, and the scheduled 13:00Z execution pulled that digest and succeeded. The Studio is the two-step Add sources / Test your clone surface; the five source types are choices, not gates. No voice-genome approval endpoint exists, so private draft preview is the end of the automatic path.
- **owner Meet preview workstream** — refined the exact self-test voice path into three script-truthful Hindi, Hinglish and English choices over the two real runtime ids, one honest 202 warm-up surface and one protected result/correction loop. Verified the real signed-in fixture at 1440 by 1000 and 390 by 844 with zero mobile horizontal overflow; focused UI gate 9/9, typecheck, lint and build passed. Frontend and fixture only; no deploy, model-quality claim, backend, infrastructure, secret or Docker change.
- **main-session 05:27 IST** — shipped the offline OpenVoice runtime, multilingual text-plan runtime/broker/web release and migration 065. All 16 release checks passed; the live named Neon constraint is validated at 2,048 bytes. The exact authenticated owner Hinglish journey crossed a real scale-to-zero start and sealed generation `cf3be95e...` with 33 protected segments, empty failure code and audio/watermark/manifest hashes; the production browser has one controlled audio element. This proves delivery and provenance, not acceptable likeness or Hindi quality. Local Docker remained untouched.
- **IndicF5 normalized qualification workstream** — temporarily activated immutable eval digest `sha256:367927...6729` only on the isolated private min0/max1 lane, sealed one canary plus six owner-bound matched Hindi/Hinglish clips, and restored the eval template to r7 with every Indic revision and gate inactive at zero. Five controls were byte-identical; the changed equation improved private Azure Speech symbol errors 4/4 to 2/4 and numerals 3/5 to 0/5, aggregate raw WER 0.327586 to 0.321839, and ECAPA mean 0.824822 to 0.827428 with p10/worst unchanged. Exact model commitment, HMAC and PerTh passed; no listening, unsealing, production routing, local Docker or quality-win claim.
- **Exact-text matched owner pack workstream** - sealed six protected owner clips across Chatterbox, Qwen, VoxCPM2 and IndicF5 r7 using one reference, consent, seed and per-language text. Eight bounded attempts reserved USD 4.00; six succeeded and two named warm-up attempts produced no audio. The strengthened receipt verifier, 18/18 seal checks and private-route isolation passed; all related apps returned to zero. Mapping remains sealed, no audio was played and no quality winner exists.
- **VoxCPM2 owner-adapter preflight** - stopped before spend: the 109-minute source hash matches the named Alakh Pandey lecture, while all six live consent scopes and evidence approvals are self-test account auto-grants with no speaker evidence binding. The runtime contract already marks this lecture third-party stress data with training denied. USD 0 spent; no split, build, GPU, synthesis, route change, local Docker, listening or unsealing. Owner action is 5-10 clean transcript-aligned minutes of the owner's own speech with verified training consent and a server-verified hash.
- **India-native base to OpenVoice conversion workstream** - the fresh receipt-canonicalization run remotely built exact runtime digest `sha256:ba777...eb64`, verified live source/model commitments, and completed exactly two signed IndicF5-to-OpenVoice conversions with PerTh 2/2. Objective n=2 comparison rejected the converter: mean ECAPA fell 0.726677 to 0.680976 and script-aware WER worsened 0.303571 to 0.375. Four opaque base/converted stimuli are sealed only for later blinded diagnosis; no listening, unseal, winner, production route or local Docker. This run reserved USD 22 of its USD 30 ceiling, combined USD 42 across both runs, and converter, gate and evidence apps are min zero, inactive and at zero replicas. The checked-in remote-build wrapper now derives the exact four-file source manifest and executable-tests Windows `.cmd` shim handling without `shell: true`; focused checks pass 22/22. The path remains unqualified.
- **WS-R3** - Readiness: one number, five parts (knows your material, sounds like you, thinks like you, knows what not to say, up to date), one suggested action, publish lock at 70 overall / 55 per part, overall undefined while any part is unmeasured. Found the prior session's work already essentially complete and uncommitted (a server outage had cut it off before it could commit): `api/_readiness.js` (pure `readinessScreen`, the six-read gatherer, the guarded snapshot writer), `api/readiness.js`, migration 073 (`vy_replica_readiness`, paired CHECK constraints making the no-fake-numbers law a database invariant), the lock wired as a peer of `FIDELITY_BLOCKER` into `api/_replica-runtime.js`'s activation join and `api/_clonechannel.js`'s connect/resume CASE, the erasure line, `src/studio/ReadinessPanel.tsx`/`readiness.css`/`readinessApi.ts` mounted on the Meet step in place of the old `ReadinessStrip`, and `evals/readiness/run.mjs`'s 120-check suite (including a negative control that removes the overall-undefined guard from a copy of the module and requires every assertion resting on it to fail) plus the matching updates to `evals/{run,fidelity/run,replica-runtime/run,sqlcast/surface,clonechannel,voice-preview-ui}.mjs`. Verified rather than rebuilt: reviewed every diff against the brief (parameter ordering in both `_clonechannel.js` writers, the four action-table anchors all existing in their real studio components), ran `node evals/readiness/run.mjs` (120/120), `node scripts/verify-release.mjs` (14/14, no `NEON_URL` in this environment so the two relational DB gates skipped), and `node scripts/check-copy.mjs` (5 scopes clean, 14 controls bit) — all clean on the first run, nothing needed fixing. `node scripts/relcheck.mjs` (the owner-lane erasure reach walk migration 073's own header names as the layer that actually re-checks the no-FK convention) failed with `ENOTFOUND sql`: it requires a live database this sandbox cannot reach, so that check and migration 073 itself remain unproven against real Postgres — see `context/measurements.md#ws-r3-readiness-eval-suite-120-checks-offline-only`. No rejections to log this session: nothing tried here broke. Committed in six pieces (migration, api core, gate wiring, studio, evals, this context update); did not push. Decisions and a measurement logged at `context/decisions.md#ws-r3-readiness-lock-is-sql-predicate-peer-gate`, `#ws-r3-readiness-overall-undefined-while-any-part-unmeasured`, and the measurement above; graph nodes/edges appended with the `ws-r3-` prefix.
- **WS-R5** — the interview: the Mirror Call re-pointed at the gaps in the archive. `api/_interview-gaps.js` ranks what the archive cannot answer (contradictions across time via `src/engine/validity.ts`'s injected overlap predicate, sheet fields with no evidence, thinly covered topics, the readiness snapshot's weakest part) into question SHAPES only, never quotable text (`rejected.md#recited-prompt`); migration 075 adds `vy_interview_session`/`vy_interview_answer` plus a closed `purpose` enum on `vy_replica_source`, wired into the erasure cascade and the deletion receipt's `owner_interview_answers` class; `api/mirror-call.js` opens the interview as `mode=interview` on the existing `create` op rather than a second call, and `api/_mirrorcall-reply.js::spliceInterviewAsk` splices the ask into the compiled tail immediately before the appended-last set (`FORGET_DECISION`) or refuses outright with `interview_ask_unplaceable` rather than appending after it; an answer only stamps `purpose='interview'` on an existing consented source and writes no sheet, persona or conditioning selection (`rejected.md#mirror-reference-accumulation-was-inert`); `api/_person-model.js::dialogueRegister` adds a pointer, not a reweight, at which accepted claims came from that material; the studio gets a gap preview before any call opens and an honest end-of-call "nothing about your AI changed" block; `evals/interview/run.mjs` passes 173/173 offline with two negative controls (contradiction detector disabled must report `detectors.contradiction===false`, not an empty list; register builder without interview ids must differ from with). Gates run clean on the untouched six-commit tree: `verify-release` 14/14 (no `NEON_URL` in this worktree, so `relcheck` and the binding gate print a skip rather than a pass), `check-copy` 5 scopes / 14 negative controls. No code change was needed this session. NOT PROVEN: migration 075 has never executed against a database; `relcheck`'s owner-lane reach walk for the two new tables has never run live; no real call has ever asked a real question. Nothing was tried and abandoned this session — none recorded in `rejected.md`.
- **WS-R1** — the Room, the follower's side of Vyakti Rooms v1: `/r/<slug>` as its own Vite entry (`room.html` → `src/room/`) and Vercel rewrite, `api/room.js` over `api/_room-surface.js` with `open/join/say/history/thread/citations/stats/export/forget`, migration 071 (`vy_room`, `vy_room_follower`, `vy_room_thread`), and `evals/room/run.mjs` (54/54, one required negative control). Finished this session, which resumed after an outage found two of the prior session's three uncommitted pieces already essentially complete (`check-copy.mjs`'s `src/room/` scope, `check-layout.mjs`'s generalization to a per-target `TARGETS` array measuring both the studio and the Room fixtures at 390/834/1355px) and fixed two real defects the gates surfaced: a JS syntax error in `api/_replica-full-erasure.js` from markdown-style backticks inside a SQL comment inside a template literal (silently un-caught by every gate ahead of `evals/run.mjs`'s dynamic import, since neither `tsc` nor `vite build` parses a plain `api/*.js` file), and two missing `evals/recall/run.mjs` FATE-table verdicts for the new `vy_room_thread`/`vy_room_follower` `PERSON_TABLES` rows (both now `"forget-only"`). `node scripts/verify-release.mjs`: **14/14** (2 relational DB gates skipped, no `NEON_URL` in this environment). Everything is proven offline against a fake `db`; nothing here has touched the live Neon database, and the two things that need it before this ships are `db/migrations/071_room.sql` actually applied and `scripts/relcheck.mjs`'s owner-lane reach walk run for real against it. See `context/decisions.md` (`ws-r1-*`, six entries), `context/rejected.md` (`ws-r1-*`, two entries) and `context/measurements.md#ws-r1-room-gate-results-2026-09-03`.

- **WS-R2 (voice identity challenge)** — built the identity path that ships without Azure, because there is currently no identity path at all: the Document Intelligence + Face Liveness stack (039-041, `services/azure-verifier`) is complete at both ends and has never been deployed pending two Microsoft Limited Access approvals, and `REPLICA_SELF_TEST_MODE` is a flag rather than a product route. An owner now proves they are the voice in their own enrolment by reading a server-issued 8-to-12 word sentence, plus a spoken six-digit nonce, on camera. Two independent measurements must agree: ECAPA cosine against the owner's own VoiceGenome reference (`api/_fidelity.js`'s `fidelityScore` imported, never reimplemented) at accept >= 0.78 / review 0.70-0.78 / reject < 0.70, every rail citing `measurements.md#first-real-clone`; and a Sarvam transcript containing the sentence above a word-overlap threshold AND the nonce, which is the anti-replay half, since a replayed recording of the owner passes the speaker check by construction and can only be caught by digits generated after it was made. **The decision is a row and the gate reads the row**: `completeVoiceChallenge` writes the same three `vy_replica` columns under the same `age_verified_at` guard that `completeLivenessVerification` writes, so `runtimeBlockers`/`activateOwnedRuntime` are untouched and no second bypass exists to audit; `REPLICA_SELF_TEST_MODE`'s owner-bound guard was not weakened. New: migration 072 (`vy_replica_voice_challenge` + attempt ledger + the `identity_challenge` capture mode), `api/_replica-voice-identity.js` (all decisions, fake-db reachable), `api/_voice-identity/verifier.js` (the only thing that touches a network), a thin handler, a 5-minute cron sweep, and a studio band behind `VITE_VOICE_IDENTITY_CHALLENGE` that captures one `getUserMedia` stream into two artifacts using `wavCapture.ts`'s own exported encoder. `evals/identity-challenge/run.mjs` is 68 checks wired into the suite, including the negative control that removes the transcript gate and watches the identical replay be ACCEPTED. Gate 14/14 before and after; nothing live was called, no GPU woken, USD 0 spent. **Three things a live run must settle, and the first is the important one: (1) there is NO different-speaker control anywhere in this repo, so this gate's false-ACCEPT rate is unmeasured and 0.70 is inherited from `api/_fidelity.js` rather than earned — `review` exists as the honest landing place until an impostor set exists; (2) whether Sarvam returns Latin or Devanagari for this bank is unknown (`rejected.md#romanised-lexicon-meets-devanagari-asr`), which is why the nonce is a separate mandatory check that survives a total script mismatch and why the 0.60 overlap threshold is marked provisional; (3) `voice-evidence` on a browser `video/webm` and Sarvam sync on a browser WAV are both code-proven and never executed.** Both env flags default off, so the deployed tree is unchanged until the main loop turns them on.
- **WS-R6 vendor voice arms** - built the two arms that make `platform-north-star`'s reversal condition testable, and spent nothing doing it. `api/_voice/providers/elevenlabs-pvc.js` (instant and professional clone modes, endpoints pinned with the 2026-09-03 date they were read) and `api/_voice/providers/sarvam-bulbul.js` are env-gated behind `VOICE_VENDOR_ARMS` plus their own keys; an absent key is a named unavailability split into waiting-on-you and waiting-on-us, never a clip. Sarvam is implemented as the Indian-accent BASE arm and says so on every receipt, because their public API documents preset speakers and no custom-speaker endpoint, and because `rejected.md#azure-tts` requires accent identity to be a first-class axis rather than a byproduct of a likeness score. Vendor audio reaches the platform as canonical 24 kHz mono PCM16 through the enrollment pipeline's own ffmpeg seam, or the call fails by name. `api/_provider-budget.js` gained a per-UTC-day character cap expressed as a budget row so the atomic reserve/settle/reconcile already proven there applies unchanged. `VOICE_LANE_ORDER` is untouched: the arms are BENCH arms and only `VOICE_PRIMARY_LANE` moves the primary lane, refusing rather than falling back. The matched pack now records transport and protection path per arm and refuses both directions of the evidence mistake - a self-hosted result that lost its watermark, and a vendor result that claims a PerTh it cannot have - and `seal --trim-disclosure` removes the spoken disclosure that would otherwise unblind a cross-arm pack, failing closed and writing the removed prefixes to `private/trim-check.wav`. Offline: 45/45 new vendor checks and 74/74 matched-pack checks, up from 51, both with zero network calls. NOT DONE and stated plainly: no vendor has ever been contacted from this repository, there is no ElevenLabs key anywhere this session could reach, no vendor audio exists, and there is still no listening result or similarity number for any vendor arm. One pack costs about USD 0.048 on ElevenLabs and INR 0.81 on Sarvam at list prices read on 2026-09-03.
- **WS-R4, the review queue** — the Meet step's thirty-second card: one question, the answer the AI gave, and Sounds right / Close, fix it / Never say this. Migration 074 adds `vy_review_card` and `vy_review_never_rule` (FK-shaped, no FK, both deleted by name in the erasure job, `owner_review_queue` on the receipt) plus `purpose` on `vy_replica_source` so a correction is a first-class source. `api/_review-queue.js` holds a PURE generator (mined claims, Mirror Call chips, follower questions the AI declined as an accepted EVENT SHAPE rather than an import of WS-R1's Room, and a synthetic question set behind the existing provider seam), deduplicated and capped at 30 open, plus one statement per decision. Three laws are enforced structurally rather than argued: a correction is a CITED SOURCE and never a prompt line (`recited-prompt`, and 059 says the same one table over about `rephrase_text`); the card's state flip is gated on its own write having landed in the SAME statement, upstream of the flip, with `vy_review_card_fixed_gate` as the CHECK that makes the half-landed row unrepresentable (`mirror-call-approval-is-one-sql-clause`); and "Never say this" is a PREDICATE applied inside `gateReply`, the one door, from a dependency-free `api/_never-rules.js`, never a sentence in a brief (`gate0-structural`: prompt instructions leaked 57-98%, the SQL predicate leaked 0 of 31,122). A fix retires the draft person profile and the in-flight `person_profile` build and writes the same `derived_models_invalidated` audit fact source deletion writes, so derived material is rebuilt and never patched. `src/studio/ReviewQueue.tsx` is mobile-390-first, pointerdown-only, keys 1/2/3, a real SQL-counted "Card 14 of 30", and the honest empty state. `evals/review-queue/run.mjs` is 117 offline checks with five negative controls including the one the brief names (remove the predicate and the forbidden reply travels); `evals/clonechannel.mjs` grew a 4b section proving the rule reaches the follower-facing wire end to end. Two things were tried and rejected, both logged: `sounds_right` cannot write a `vy_replica_turn_exemplar` row without fabricating a dialogue turn that never happened (its FK chain requires a completed turn and an active runtime capability), and one dedupe key over the prompt collapsed fifty mined claims into a single card. **Not proven**: migration 074 has never been applied to any database and no statement in this lane has ever been EXPLAINed; `relcheck` did not run here (no `NEON_URL`); the never-rule matcher has no false-positive rate against real traffic; the question generator has only ever been driven by an injected fixture; and "thirty seconds a card" is the brief's design target, not a measurement.
- **main loop, Rooms merge (2026-09-03)** - adopted the Vyakti Rooms v1 product definition and merged six workstreams built in parallel worktrees: WS-R1 the Room (`/r/<slug>`, migration 071), WS-R2 owner identity by voice challenge (072, behind `VOICE_IDENTITY_CHALLENGE`), WS-R3 Readiness and the publish lock (073), WS-R4 the review queue and never-say rules as a predicate at the one door (074), WS-R5 the interview mode of the Mirror Call (075), WS-R6 vendor bench arms (no migration, behind `VOICE_VENDOR_ARMS`). All five migrations are applied live; every new statement was EXPLAINed against the live database; the merged tree passes 14/14. Two integration defects were caught and fixed in the merge (`rooms-merge-live-verification-2026-09-03`). The live database also carries six tables from an unpushed tree (066-070 territory); see `rooms-migrations-applied-live-in-the-union-order`. Still owner-gated: model keys on the studio Vercel project (its chat API answers "no key configured"), the all-authenticated self-test grant, the $7 proxy, SMTP, and pushing that unpushed tree.
- **WS-R8, the leak battery** — Phase 1's hard gate for Vyakti Rooms: "the leak battery runs clean before a second follower joins any Room. No exception for a launch date." Built `evals/room-leak/run.mjs` to `evals/mp/gate0.mjs`'s shape: a scenario generator (N followers in {2, 5, 20} x 4 turns each, every follower seeded with unique tokens) driven through the REAL, unmodified follower lane (`api/_room-surface.js`) and the REAL compiler (`src/engine/compiler.ts` via `api/_engine.gen.js`), scanning every compiled prompt, every retrieved fact set, every export and every reply for cross-follower leakage — 16,080 retrieval checks + 441 boundary checks, 0 leaks, two required negative controls both firing (a struck person clause; a "helpful" reply that pastes another follower's real token in as an example, routed through the real `roomSay`, not a standalone string — the first draft of that control was tautological and could not fail, `rejected.md#ws-r8-negative-control-2-was-tautological-in-its-first-draft`). A static layer separately derives, from source, every creator-material writer symbol reachable in seven files (`_replica-claims.js`, `_replica-consent.js`, `_review-queue.js`, `_replica-source.js`, `_teacher-sheet-draft.js`, `_mirrorcall-store.js`, `_person-model.js`) by propagating write-reachability through each file's own call graph, and confirms none is imported anywhere the follower lane's 27-file import graph reaches — a file-level version of this check false-positived on a pure reader (`_clonechat.js`'s `loadNeverRules`) and was replaced, `rejected.md#ws-r8-file-level-import-ban-flagged-a-pure-reader`. `dmRecall`'s own SQL was never executed (no `NEON_URL` in this environment, and it is deliberately not seam-injectable the way `roomSay`'s memory functions are); this suite instead calls the REAL `disclosurePredicate()` with the REAL bind read out of `api/_room.js`'s own source and checks the resulting text for the required clauses, and connects to `gate0-structural`'s existing live proof (0/31,122) rather than re-deriving a weaker offline copy. Extracted WS-R1's inline fake `db` into `evals/room/fixtures.mjs` so both suites share one fake rather than reading migration 071's laws twice; `evals/room/run.mjs` re-verified 54/54 unchanged after the refactor. Registered as the `room-leak` suite in `evals/run.mjs` and as the named gate `"room leak battery"` in `scripts/verify-release.mjs`. `node scripts/verify-release.mjs`: 14/14 on the untouched tree, **15/15** after. Offline, deterministic, $0, ~6s. **Not proven**: `dmRecall`'s real SQL executing (needs `NEON_URL`); the retrieval layer drives `roomSay` with a compliant FAKE recall rather than the real predicate, for the reason above.
- **WS-R7, the Room's creator side** — WS-R1 built `/r/<slug>` and the tables it reads (migration 071) but nothing anywhere ever INSERTED a `vy_room` row, so no Room could be opened by anyone until this landed: `dead-writers` in its purest form. `api/_room-publish.js` over a thin `api/room-publish.js` (`api/replica.js`'s own auth shape) holds every decision: `get` (the owner's Room, or a named `not_created` reason, always carrying a proactive `can_publish`/classed blocker list, never only after a failed click); `create` (a slug proposed from the replica's display name, idempotent on the replica, a taken slug a NAMED `room_slug_taken` refusal via the real `23505` on `vy_room_slug_ix`, never a 500); `rename` (same collision rule); `publish` (sets `published_at` ONLY inside the UPDATE's own `CASE`, gated on three conditions evaluated by Postgres and none of them by this file — an active `vy_replica_runtime_capability`, the readiness lock via `readinessPasses` IMPORTED verbatim from `api/_clonechannel.js` rather than retyped so "same three conditions" is true by construction, and an approved disclosure, `vy_teacher_sheet.status='published'` with a `consent_artifact_id`, the exact gate `resolveRoom` already requires of every follower); `pause`/`resume` (pause unconditional, resume gated the same as publish, `api/_clonechannel.js`'s own precedent one field over); `set_free_cap` (bounded 0-100000, validated before it ever reaches the CHECK); and `stats` (real counts only — followers total, active in 24h, messages this month — `count`/`sum` over an empty room read as real zeros, never a placeholder). `src/studio/RoomStudio.tsx` mounts in the Deploy step ABOVE `ChannelsStudio`'s band, `mode==='teacher'`-gated to match it (`rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-pathway`: a generic self-replica's agent never gets a `vy_teacher_sheet` row, so the disclosure gate can never pass there and the card would point at a screen that mode never shows); the link, a slug editor with inline validation, the publish/pause/resume switch with its blocker list split `waiting_on_you`/`waiting_on_us`, three free-cap presets plus a custom value, and the three real stats. `src/studio/wizardModel.ts`'s `deployDone` now also reads done on a published Room (`roomPublished === true`), `null` (unknown) wherever a build never mounts the panel, reducing to the exact old behavior — asserted directly in `evals/studiowizard.mjs`'s new §11. `evals/room-publish/run.mjs` is 37 offline checks against a fake `db`, including the required negative control (the readiness `EXISTS` clause struck out of the REAL statement text captured off the fake's own call log, which then leaks the write) and a check that a runtime blocked ONLY by platform-owned gates (`qualification_incomplete` and its three siblings) classes `waiting_on_us` while anything else classes `waiting_on_you`. Wired into `evals/run.mjs`, `evals/sqlcast/surface.mjs`'s strict-cast list (0 uncast sites across both new files), and `src/studio/layoutFixture.tsx` (`/api/room-publish` mocked to the real `not_created` empty-state shape rather than the generic `{}`, since that state carries this panel's longest prose). `node scripts/verify-release.mjs`: **14/14** (2 relational DB gates skipped, no `NEON_URL` in this environment; `relcheck.mjs` run standalone fails with `getaddrinfo ENOTFOUND sql`, the same environmental wall every prior WS-R session records). `scripts/relcheck.mjs`'s owner-lane reach walk needed no new wiring: `vy_room` was already deleted by name in `api/_replica-full-erasure.js` by WS-R1 (confirmed by grep, not assumed), and it is picked up by that script's own live-catalog introspection rather than a hardcoded list. No migration: `vy_room` already carries every column this workstream needed. See `context/decisions.md` (`ws-r7-*`, four entries), `context/rejected.md#ws-r7-room-for-generic-mode-with-no-disclosure-pathway`, and `context/measurements.md#ws-r7-room-publish-gate-results-2026-09-03`. NOT PROVEN: no statement in `api/_room-publish.js` has ever been `EXPLAIN`ed against a live Postgres and no real `vy_room` row has ever been inserted anywhere outside a fake `db`.
- **WS-R9, drift watch** — "it notices drift", the Rooms plan's own line. `api/_drift-watch.js` is a pure `driftWatchReport(inputs)` over rows: two independent signals decide `steady` / `moved` / `not_measured` — a swap walked off `vy_replica_generation.preview_model_commitment` across one fixed lane (`purpose='voice_preview', channel='studio_preview'`), and a score drop over 0.02 between two `vy_voice_fidelity` rows sharing the SAME `genome_version` only, cited to three measurements (6e-6 run-to-run noise, 0.0625 reference-window spread, 0.0206 a real 60-epoch LoRA delta) with a stated reversal condition. The prosody anchor's staleness is read from `scripts/prosody-baseline.mjs`'s own committed log (`evals/dbattery/prosody-baseline-log.json`) rather than re-derived a third time (`cache-outlives-the-voice`'s exact hazard, avoided). Migration 076 (`vy_replica_drift_report`; FK-shaped not FK, deleted by name in the erasure cascade, mirrored into `db/schema.sql`, one statement per request, 22 statements, no DO blocks). `api/drift-watch.js` is READ-ONLY — deliberately unlike readiness's "read that writes", because drift watch gates nothing and an alert must not depend on a creator opening the studio that day; `api/drift-watch-sweep.js` (new `vercel.json` cron, every six hours, `CRON_SECRET`) is the sole writer, guarded on `inputs_hash` and stamping `alerted_at` in the same insert whenever state lands on `moved`. `DriftWatchCard.tsx` mounts directly under `ReadinessPanel` on the Meet step: the score as a percent of the owner's own ceiling (the identical `CEILING_SQL`/`FIDELITY_SQL` shape readiness reads, so the two screens can never disagree), a real-points-only inline SVG sparkline, the last voice-engine change date, and the honest not-measured state with readiness's own `record_reference` action reused rather than a second one invented. `evals/drift-watch/run.mjs`: 89/89 offline, including the negative control the brief asks for by name (a patched copy of the module that folds the swap check out of the state decision reads `steady` across an actual swap; the real module reads `moved` on the identical input). All three new API files added to `evals/sqlcast/surface.mjs`'s strict list from their first commit; `evals/sqlcast.mjs` 0 violations. `node scripts/verify-release.mjs`: **14/14** (2 relational DB gates skipped, no `NEON_URL` in this environment). **Found, not fixed, and logged as an open gap** (`ws-r9-fidelity-recorder-has-zero-live-callers`): `recordOwnedFidelity` has exactly one caller in the whole tree — its own offline eval — so the score-drop half of this feature will read `not_measured` for every real replica in production today; the swap-detection half is unaffected because it reads the generation ledger, which every real preview does write. **Also found and fixed before any of the above**: this session's assigned worktree was provisioned from a stale base commit (the pre-Vyakti Meera-only tree, no `context/STATE.md`, 16 migrations, 38 `api/` files) rather than the platform tip every sibling worktree and the main checkout were on; `git reset --hard` to the correct commit fixed it (the stale branch was a strict ancestor with zero unique commits, so nothing was lost) before any of this workstream's own files were written. NOT PROVEN: migration 076 has never executed against a database; `scripts/relcheck.mjs` could not run at all in this environment (no `NEON_URL`, and a direct invocation outside `verify-release.mjs` throws on DNS resolution rather than printing a skip); whether Vercel's function bundler actually includes `evals/dbattery/prosody-baseline-log.json` in the deployed sweep's filesystem is unverified — the reader fails toward `stale: true` on any read error for exactly this reason.
- **WS-R10, the vocabulary and the gate that keeps it** — enforced the Rooms plan's naming rule structurally rather than as a style note: added a `rooms-vocabulary` rule to `scripts/check-copy.mjs` (banning `clone`, `replica`, `model`, `fine-tune`, `train`/`training`, `weights`, `embedding`, `LoRA`, `genome` in user-visible strings across `src/studio/`, `src/room/`, `site/vyakti.html`, `studio.html`, `room.html`) with `scripts/roomsVocabAllowlist.mjs` as the only escape hatch, scoped to two files: `DisclosurePreview.tsx`'s two verbatim safety-floor quotes and four of `ModelConsentGate.tsx`'s `STATEMENTS`, both legal text a person already consented to and may not have moved under them (`demo-teacher-is-not-a-placeholder`, generalized). Ran the new gate against the untouched tree (117 hits, all real) and fixed every one by hand across 30 studio/room files plus a full rewrite of `site/vyakti.html` (the old JEE-teacher fidelity-metrics pitch replaced with the Rooms story: the one line, for the creator, for the follower, the boundary in plain words, "Apply for one of the first Rooms" as a mailto CTA with the three named questions, no invented numbers). Found and fixed 24 further real hits the gate's own heuristic missed on the first pass (camelCase keys like `introTitle`/`workspaceNoun` do not match `VISIBLE_KEY`'s word-boundary regex; `Record<string,string>` blocker/label maps whose property name is not itself `label`) by a manual grep sweep; see `measurements.md#ws-r10-vocabulary-hits-before-after`. One eval assertion (`evals/voice-delivery-policy/run.mjs`) hardcoded the old "Voice Delivery Genome" string and was updated to match the renamed, compliant copy, preserving what it actually proves. Discovered and logged, not fixed (out of scope for a rule-addition task): `check-copy.mjs`'s whole-file quote blanking cannot tell a JSX-text apostrophe from a JS string delimiter, producing both false negatives and two phantom hits this session traced by hand rather than "fixed" (`rejected.md#ws-r10-check-copy-apostrophe-parity`). Before touching any code, this session's worktree was found checked out at the wrong base commit entirely (an unrelated product's history) and was reset to the Rooms platform tip and renamed to `ws-r10-vocabulary`; see `decisions.md#ws-r10-worktree-wrong-base-commit`. `node scripts/check-copy.mjs`: 117 to 0 rooms-vocabulary offences, 6/6 scopes clean, 17/17 negative controls (14 original plus 3 new). `node scripts/verify-release.mjs`: 14/14 on the untouched tree (baseline, via `git stash`) and 14/14 after every fix. No SQL, no migration, no new env var; nothing here needed the live database.
- **WS-R13, the docs that a new agent and the owner read, made true again** — reconciled `docs/gurukul/ENV-MANIFEST.md` (new §25 for WS-R1..R10's env vars: `VOICE_IDENTITY_CHALLENGE` + `VITE_VOICE_IDENTITY_CHALLENGE` as two independent flags on two sides of the HTTP boundary, `VOICE_VENDOR_ARMS` + `ELEVENLABS_API_KEY`/`ELEVENLABS_MODEL_ID`/`ELEVENLABS_CLONE_MODE`/`SARVAM_TTS_MODEL`/`SARVAM_TTS_SPEAKER` + `VOICE_PRIMARY_LANE`, the two new `CRON_SECRET` consumers, and a closing note that the studio Vercel project still has none of `OPENROUTER_KEY`/`GOOGLE_KEYS`/`AZURE_KEY`/`AZURE_ENDPOINT`, with the two DIFFERENT failure shapes that produces on `/api/chat` versus every other surface's shared `think()`), `docs/gurukul/DEPLOY.md` (a new "Vercel reality" section: the two git-connected Vercel projects, migrations actually applied in order, `db/migrations/apply.mjs` usage, and the one-gate-per-machine port-8931 rule), `AGENTS.md` and `CLAUDE.md` (the migration counter, the 15/17-check gate count, the Rooms vocabulary rule, and one paragraph adopting Vyakti Rooms v1 as the product definition in each file, kept in agreement per the repo's own rule), `context/STATE.md` (a new LIVE-table row for the six Rooms tables and the gates, and a fifth "what remains" bullet in the START HERE block: the voice problem unchanged, the identity path behind a flag, the follower Room existing, model keys still absent), and `docs/gurukul/PRODUCT-JOURNEY.md`/`UX-QUEUE.md` (a new Part 5 mapping the six Rooms surfaces onto the five-phase spine with honest per-surface status, and seven new UX-Q-R items for what each WS-R1..R10 session log entry flagged as open rather than fixed). Found and did NOT silently repeat: the task brief's own claim that migrations 071-076 are applied live is only five-sixths supported by `context/decisions.md#rooms-migrations-applied-live-in-the-union-order`, which predates migration 076 entirely — every doc above says 071-075 confirmed, 076 built-but-unconfirmed (`decisions.md#ws-r13-migration-076-status-not-asserted-without-corroboration`); and `scripts/vercel-build.sh` still matches the retired `claude/gurukul-platform` branch name rather than the current `claude/vyakti-cloning-platform-aq05n4`, flagged in `DEPLOY.md` rather than fixed, out of scope for a docs task (`decisions.md#ws-r13-vercel-build-branch-name-flagged-not-fixed`). No "Room preview smoke test" is recorded anywhere in `context/`, so the LIVE table says so rather than inventing one, per this workstream's own brief. `node scripts/verify-release.mjs`: **15/15** before any edit and **15/15** after (doc-only change, no gate should move and none did); `node scripts/context.mjs --check`: clean before (820 nodes, 1013 edges) and after this session's own append (823 nodes, 1016 edges); `node scripts/check-copy.mjs`: 6/6 scopes clean, 17/17 negative controls, unchanged (none of the seven touched files are inside its scanned scopes, and `context/`/`docs/` prose is explicitly exempt from the em-dash rule). No code, API, migration, eval or env var was touched or added by this session; the env vars documented were all built by WS-R1..R10 already merged into this tree. See `context/measurements.md#ws-r13-doc-sync-gate-results-2026-09-03` and the two decisions above.
- **Main loop, WS-R13 merge (2026-09-03, later)** — fast-forwarded `ws-r13-docs` (five commits, docs and context only, gate 15/15 in its worktree). Two of its flags were resolved with facts rather than left standing: migration 076 was read back from the live catalog (table, primary key, three indexes; `decisions.md#rooms-migration-076-confirmed-live`, superseding the WS-R13 flag by its own reversal condition) and every doc now says 071-076; `scripts/vercel-build.sh` now matches the platform branch family by pattern (`decisions.md#vercel-build-platform-branch-pattern`), with the Vercel API confirming both projects build this branch as previews only. Found while checking the 076 record: `context/measurements.md` had been doubled at the WS-R10 merge (7,297 + 7,260 lines concatenated, 214 duplicated headings); rebuilt as the true union at 7,360 lines and the failure logged as `rejected.md#context-union-by-concatenation` so the remaining wave-three merges (R11 payments, R12 cohorts, R15 first-room runbook) use one-side-plus-diff, never concatenation. The unlogged preview smoke test from the wave-two merge is now `measurements.md#rooms-preview-smoke-2026-09-03`.
- **WS-R15, the first Room in one command** — `scripts/first-room.mjs`, `scripts/first-clone.mjs`'s sibling for Phase 0 ("hand-build one Room for one real creator"): consent, upload, the processing DAG polled to done via `replica-activity`'s `next_poll_ms`, Readiness's five parts and lock verdict, the review queue filled but never decided, the Room created and published (printing the classed `waiting_on_you`/`waiting_on_us` blocker list on a lock, a new `blocked` status distinct from `fail`), then a SECOND, follower, bearer session opening it, joining with age attestation and memory consent, saying one message, reading history back and leaving — every response printed verbatim, every step stopping the script on the first named refusal, no em dash and never "clone" in anything it prints. Flags `--dry` (prints the plan and payload shapes, calls nothing) and `--skip-follower`. `evals/first-room/run.mjs` drives the REAL script as a subprocess against a fake `node:http` server: the happy path (14/14 steps ok, owner and follower), two named refusals (publish locked by readiness, with the follower side proven never to run even with a follower token supplied; the slug taken, stopping at room-create), and the required negative control (a 200 with an empty body on the consent grant must fail that step by name and never let `upload` run after it) — 33/33 checks, wired into `evals/run.mjs` as the `firstroom` suite. Two real mistakes were made and fixed while building the eval, both logged because neither was guessable in advance: a substring check for "the room-publish step never ran" false-failed because `room-create` and `room-publish` are the SAME endpoint URL (`rejected.md#ws-r15-refusal-absence-cannot-be-a-substring-check`), and a `globalThis` port for the fake storage PUT would have gone stale across the four sequential scenarios (`rejected.md#ws-r15-eval-fixture-port-via-global`, fixed by reading `req.headers.host` per request). `docs/gurukul/PHASE-0-RUNBOOK.md` maps all nine plan steps (application, identity by voice, the first ten minutes, the voice moment, feed, correct, bound, gate, launch) to the exact studio panel or script step that performs each one and what is still missing, citing only numbers already in `context/` (SMTP capping sign-in email at ~2/hr; the voice-identity challenge's false-accept side unmeasured, `decisions.md#ws-r2-voice-challenge-thresholds`; no ABX listening bench ever run on a human ear, `docs/gurukul/EARBENCH.md`; `AZURE_FOUNDRY_*` keys for the synthetic review-question generator with no recorded live status; `knows_your_material` having no instrument at all and `sounds_like_you` half of one, `api/_readiness.js` §4; and the room-publish/room-surface lanes proven offline only, never against the live database). `node scripts/verify-release.mjs`: **15/15** both on the untouched tree and after (this workstream added zero migrations and zero live-touching code — `first-room.mjs` and its eval both talk to a deployment or a fixture, never the database directly). `node scripts/context.mjs --check`: clean, 824 nodes / 1019 edges. **Not proven, stated as plainly as the runbook states it**: `scripts/first-room.mjs` has never been run against the real deployment — no real `VYAKTI_SESSION`, no real `BASE_URL`, no real audio file, no real follower. This is proven offline exactly as far as `evals/first-room/run.mjs` can prove it, and no further; running it for real, with the owner's consent and a real second creator's session, is Phase 0's actual remaining step. **Also found and logged, not touched**: this worktree's underlying repository shares its `git stash` namespace with sibling worktrees for OTHER concurrent workstreams (WS-R11, WS-R12 were both seen mid-session, each stashed and untouched by this one) — `git stash` is repository-global, not per-worktree, so any future session that needs to stash must resolve its own entry by exact commit SHA (`git log -g refs/stash`) rather than by index or by `git stash pop`, since another agent's push or pop between a list and an apply/drop shifts every index.
- **WS-R12, the number that decides the company** — built the instrument for the Rooms plan's own gate: "week-six retention of followers who arrived in week one... below 25% this product does not work... above 40% it is a category." Nothing measured this before today. Migration 077 adds `vy_room_follower_day` (room_id, person_id, day, turns; primary key on all three; the ONLY FK is `room_id references vy_room on delete cascade`, matching 071's convention exactly, no `agent_id` column), mirrored into `db/schema.sql`, in `PERSON_TABLES` (`api/memory.js`, no `agent` flag since there is no `agent_id` column to carry the generic per-room manifest loop's unconditional filter) with a `"forget-only"` FATE verdict (`evals/recall/run.mjs`), and in `REPLICA_PERSON_TABLES`'s deploy-ordering gate. `api/_room-surface.js`'s `roomSay` upserts one row per accepted turn (`turns = turns + 1`, an increment, never a message, at the SAME point the free cap is already spent so the two counts agree by construction) and `roomForget` deletes it explicitly by room_id+person_id (mirroring `vy_room_thread`/`vy_room_follower`'s own pattern); both are gated on `isTableAppliedFor(deps)("vy_room_follower_day")`, injectable so an offline eval can prove the gated write AND the gated skip without a live database — needed because this table and the code touching it ship in the same change, unlike its two 071 siblings (`decisions.md#ws-r12-new-migration-write-gated-on-tableapplied`). `api/_room-cohorts.js` holds the pure math (`cohortRow`, `isoWeekStart`/`isoWeekLabel`, `verdictFor`, banding below_25/between_25_and_40/above_40 against the OLDEST measurable cohort — week one's arrivals, never a later, better-looking one, `decisions.md#ws-r12-verdict-is-the-oldest-measurable-cohort`) and the one function that talks to Postgres (`roomFollowerCohorts`, one or two strictly aggregate statements per ISO week from the Room's `published_at`, retention answered via an `exists(...)` clause in the WHERE, never the SELECT — a first draft put that subquery inside the SELECT list instead and broke `evals/room-leak/run.mjs`'s own parser, `rejected.md#ws-r12-retention-exists-in-select-broke-the-leak-batterys-parser`), plus `readOwnedRoomCohorts` for owner scoping. `api/room-cohorts.js` is the thin bearer-auth GET (`api/readiness.js`'s own shape). `RoomStudio.tsx` gained a "Week six" card under the stats card: one row per cohort (a percentage once measurable, "Not measurable until <date>" while young), the verdict sentence naming which cohort and why, and the plan's two thresholds in plain words — no em-dash, never "clone", mobile 390 first (`roomStudio.css`). `evals/room-cohorts/run.mjs` is 60 offline checks in five sections (the write, the forget, the pure math against the brief's own fixture numbers — 2 weeks not measurable, 7 weeks 3/10=30%, 8 weeks 5/10=50% — the read against a fixture-backed fake db, and a content-free negative control on the migration's own column list that must catch an injected text column), registered in `evals/run.mjs`; `api/_room-cohorts.js` and `api/room-cohorts.js` added to `evals/sqlcast/surface.mjs`'s strict-cast list; `api/_room-cohorts.js` added to `evals/room-leak/run.mjs`'s AGGREGATE_ONLY set (62/62 unchanged, 16,080 retrieval + 441 boundary checks). `node scripts/verify-release.mjs`: **15/15 on the untouched tree** (confirmed via `git stash -u`, one 127.0.0.1:8931 port collision on the first post-stash run resolved by waiting) and **15/15 after**; `node scripts/check-copy.mjs` unchanged at 6/17; `npx tsc` found and fixed one real type error (`RoomStudio`'s `onAuthError` prop needed widening to accept the new error class). See `context/decisions.md` (`ws-r12-*`, three entries), `context/rejected.md#ws-r12-retention-exists-in-select-broke-the-leak-batterys-parser`, and `context/measurements.md#ws-r12-cohorts-gate-results-2026-09-03`. NOT PROVEN: migration 077 has never executed against a database, no statement in `api/_room-cohorts.js` or the new lines in `api/_room-surface.js` has ever been `EXPLAIN`ed, `scripts/relcheck.mjs` did not run (no `NEON_URL`), and every retention percentage this session ever produced came from fixture counts chosen to match the brief's own examples, never from an observed follower.
- **Main loop, WS-R15 and WS-R12 merges (2026-09-03, later)** — merged `ws-r15-first-room` (`378a9c4`: `scripts/first-room.mjs`, `evals/first-room` 33 checks, `docs/gurukul/PHASE-0-RUNBOOK.md`; no SQL) and `ws-r12-week-six-retention` (migration 077 `vy_room_follower_day`, `api/_room-cohorts.js` + `api/room-cohorts.js`, the Week six card, `evals/room-cohorts` 60 checks). Both context unions were one side plus the other side's diff from `9525e30` (0 duplicated headings after each), graph by structural union. Migration 077 applied live and all six new statements `EXPLAIN`ed on their indexes (`measurements.md#rooms-migration-077-live-verification-2026-09-03`). Gate 15/15 after each merge; the `evals/run.mjs` registry conflict (both workstreams appended a suite) resolved by keeping both. 078 (payments, WS-R11) is the last wave-three workstream still building.
