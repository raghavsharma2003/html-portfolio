# One link, one clone — the single-video enrollment lane (WS-AD)

**Audience: the owner, deciding what to do next.** Written 2026-08-26. Every
number here is a live service response or an eval count; where something has
not been run, it says so in the same sentence.

The ask this answers, verbatim in intent:

> "I want to put a link to my 15-minute video where I'm teaching something and
> make the clone from it — and it's not necessary that the first 10 seconds
> will be clear, so handle it. Enable this for all accounts so my friends can
> also test it."

---

## 1. The headline, both halves

**The lane is built and gated. The one step it depends on is refused by
YouTube.**

`services/media-extract` is now **deployed and live** — container app
`vyakti-media-extract` in the existing `vyakti-voice` environment, CPU,
scale-to-zero, its own HMAC at the front door, yt-dlp `2026.08.19`. It was
pointed at a real, public-domain YouTube video from that egress. What came back:

| | result |
|---|---|
| `GET /healthz`, cold from zero | **200 in 47.9 s** |
| `POST /v1/enumerate` — list a channel's videos | **200 in 13.9 s, real ids** ✅ |
| `POST /v1/extract` — get the audio | **`extractor_bot_check` in 2–3 s** ❌ |

YouTube refuses our server at the *player API*, before it will hand over a
stream URL, on **all ten** player clients yt-dlp offers. It does **not** refuse
the channel listing. The full method, the egress IP and the negative control
that proves the levers were actually connected are in
`context/measurements.md#youtube-extraction-blocked-from-azure`.

So: **the back-catalogue lane works today. The "paste a link and get audio"
lane does not, and the reason is our IP, not your permission.**

---

## 2. What the owner clicks

On the replica page, the **"Make a clone from one video"** panel:

1. Paste a link to one of your own videos (`watch?v=`, `youtu.be/`, `/shorts/`,
   `/live/` — playlist and timestamp parameters are dropped, not rejected).
2. Paste your channel URL.
3. Tick five statements. All five, or the button stays disabled — the server
   requires all five and a screen that offered four would be a screen whose
   submit cannot work. They are WS-S's existing `vy_channel_attestation`
   statements, unchanged, including the uncomfortable one: *you can give us
   copyright permission for your own lecture, and that is separate from
   YouTube's terms about downloading, which nobody but YouTube can grant.*
4. Press the button.

What comes back, when extraction works: **which ten seconds of your video became
your voice reference**, what it scored, how much better it was than your opening
ten seconds, the other ranked candidates, and the transcript character count.

What comes back today, for most people: a named explanation that YouTube refused
our server, and the path that does work — download your own video from YouTube
Studio and hand us the file. The panel never says "failed".

---

## 3. How the first-ten-seconds problem is solved

Not by advice, and not by a heuristic about lectures. By construction.

`context/measurements.md#reference-window-beats-the-finetune` established that
Chatterbox truncates a voice reference to its **first 10 s**, and that *which*
ten seconds you pass moves fidelity **0.0625** on the owner's own voice — three
times the measured fine-tune delta, at zero training cost, with the best window
beating every fine-tuned arm. That measurement closed by noting there was no
selection *rule* yet.

`api/_video-enroll/windows.js` is the rule. It scores **every ~10 s window**
(5 s hop, so no good moment can fall across a boundary) on:

| signal | what it catches |
|---|---|
| voiced fraction | a reference that is half silence gives the model five seconds, not ten |
| SNR estimate | the fan, the classroom, the street |
| clipping | clipped speech is destroyed speech — a deduction, not a term |
| level stationarity | the speaker turned away, a door slammed, an edit landed |
| speaker purity | a student's question is not your voice |

Then it ranks them, **stores the whole ranking**, and conditions on the top one.
The head of the file competes on exactly the same terms and wins only when it
deserves to — and the result panel tells you which happened.

Two properties worth naming because they are easy to get wrong:

- **Absent diarization is `null`, never `1.0`.** A window whose single-speaker
  purity was never measured is not assumed clean. Defaulting it to perfect is
  how a student's question becomes the voice of the clone.
- **Every disqualification is named.** `multiple_speakers` and
  `mostly_silence`, on the row, so an operator can ask why a window lost.

**What the scores are NOT:** ECAPA fidelity. They are a WAV signal probe, and
`score_source: wav-signal-probe/v1` says so on every row and every payload. The
bench that would turn the proxy into a measurement — a reference-window sweep on
real lecture audio — has not been run.

---

## 4. All accounts, and the caps that make that survivable

| cap | default | why |
|---|---|---|
| per owner, per day | **2 videos** | enough to try, iterate and sleep on it; not enough to batch a back catalogue (that is the channel lane) |
| per video | **≤ 20 min**, ≤ 64 MB | covers the owner's 15-minute lecture with headroom |
| **platform, per day** | **10 videos** | the grant protector — a per-account cap bounds one friend, not twenty |

Every refusal is **named and carries its numbers and its reset**, and the global
cap is checked *before* the per-account one: when the platform is out of budget,
"the platform is at its daily limit" is actionable and "you have used your two"
is misleading. All four are overridable by env; all four are deliberately low,
because raising a cap is one variable and recovering a spent Azure grant is not
a thing that can be done at all.

Per-stage wall clock and outcome are written to a `receipts` column on every
run — **including failed stages**, because the cost of a bot check is a real
cost and a table that counted only successes would understate the lane exactly
where it is going wrong. That column is where a per-clone cost number comes
from instead of an estimate.

---

## 5. What is NOT true of this yet

Stated plainly, because implying coverage we do not have is the one thing this
repo treats as worse than a gap.

- **Migration 060 is UNAPPLIED**, and no statement in this lane has ever
  EXPLAINed against a database — this environment has no `NEON_URL`.
  `offline-mocks-cannot-type-check-sql` applies in full: the eval proves control
  flow, not SQL types or referential integrity. Every request to
  `/api/video-enroll` will 500 until 060 is applied.
- **`promoteReference` is a declared seam this deploy does not supply.** Making
  the chosen window the replica's *active* voice reference means writing an
  `enhance`-stage artifact, a `selected` decision and a genome reference entry —
  the three facts `beginOwnedVoicePreview`'s fence reads. Those writes belong to
  `api/_replica-processing`, which owns artifact identity, and inventing a second
  writer for them here would be a second source of truth for what a replica
  speaks from. So the fence is **not weakened**: the lane calls the seam when it
  is supplied, and until then `reference_promoted` is `false` on the response and
  the panel says so rather than letting an owner press "Preview my voice" and
  hear the wrong thing.
- **No 15-minute extraction has ever succeeded**, so its cost and its wall clock
  are unmeasured. See `measurements.md#media-extract-cost-per-video` for what IS
  measured and what is only bounded.
- **The studio mount rides on branch `gurukul-ws-ag`**, whose shell restructure
  owns `StudioApp.tsx` and left a labelled `VideoLinkMount` hole asking for
  exactly this panel.

---

## 6. Where the code is

| thing | file |
|---|---|
| the window ranking (pure) | `api/_video-enroll/windows.js` |
| the caps | `api/_video-enroll/quota.js` |
| the lane | `api/_video-enroll.js` |
| the endpoint | `api/video-enroll.js` |
| the schema | `db/migrations/060_video_enrollment.sql` |
| the studio | `src/studio/VideoEnrollPanel.tsx`, `src/studio/videoEnrollApi.ts` |
| the proof | `evals/videoenroll.mjs` (80 checks, in `evals/run.mjs`) |
| the decision | `context/decisions.md#best-window-not-first-window` |
| the YouTube verdict | `context/measurements.md#youtube-extraction-blocked-from-azure` |
| the deploy posture | `docs/gurukul/AZURE-DEPLOY-STATE.md`, `docs/gurukul/youtube-extraction-posture.md` |
