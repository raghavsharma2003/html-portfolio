# STATE — read this first, then the graph

One page, kept current, so a new session spends zero tokens re-deriving where
the project stands. Deep history lives in `decisions.md` / `rejected.md` /
`measurements.md`; the index is `graph.json` (`node scripts/context.mjs`).
**If this file and any other disagree, the other files win — fix this one.**

Last updated: 2026-08-26 (WS-W: "Preview my voice" — the owner-facing panel, and the cold start told honestly)

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
| Neon Postgres | migrations 015–056 applied and verified live (113 tables). `verify-release` runs **13** checks when `NEON_URL` is set — the two relational DB gates that had never actually run — and 11 with a printed skip when it is absent |
| Supabase (new project, separate from Meera's) | auth working; `vyakti-replica-private` bucket created |
| Auth | Google OAuth live; email OTP live (6-digit); built-in mailer capped ~2/hr until SMTP |
| Studio | `vyakti-replica-lab.vercel.app` → teacher studio at `/`; replica create/list verified against live DB |
| Meera production | untouched; its deploy trigger no longer matches this branch |
| In-house voice | Azure RG `vyakti-voice`: Chatterbox GPU runtime + admission broker + voice evidence, scale-to-zero, synthesising (RTF 0.79 warm). `docs/gurukul/AZURE-DEPLOY-STATE.md` |

## The three ingestion/voice pipelines — status after the first real clone (2026-08-26)

**A real human voice has now been through the pipeline end to end.** The owner
supplied a 71 s consented Hinglish voice note; every stage below is a live
service response, not a claim.

| pipeline | status | evidence |
|---|---|---|
| **Voice cloning** | **WORKS, measured** | Zero-shot clone of the owner from their own 71 s reference. **ECAPA fidelity 0.7753** (p10 0.7479) against a **0.8869 self-vs-self ceiling**; verdict `warn`, so the activation gate correctly refuses (12 blockers). rtf 0.79–0.80 warm. n=2, spread 1e-6. **Zero-shot, no fine-tune — a floor, not a ceiling, and NOT a claim about how it sounds** (that needs the blind ABX bench). |
| **voice-evidence round trip** | **WORKS — first ever run** | 71 s → 4 windows → 8 embeddings in **4 977 ms** warm; **176 s** cold start from zero. |
| **ASR (Sarvam)** | **WORKS** | sync `saarika:v2.5` 25 s → 200 in 4 134 ms (**hard 30 s cap**); batch `saaras:v3` 71 s → **5 diarized turns in 137 s**. `saarika:v2` is deprecated. |
| **transcript → sheet draft** | **WORKS** | 5 turns, 127 tokens, **92 honest `gaps`**, 8 phrase candidates. |
| **upload → finalize** | **finalize was BROKEN; fixed in tree, deployment behind it** | `replicaObjectInfo` parsed a HEAD-style route as JSON, so EVERY finalize failed closed and **nothing downstream of storage had ever executed for anyone**. One redeploy away. |
| **YouTube extraction** | built, gate live, **never run against real YouTube** | Datacenter IPs (Azure included) get `LOGIN_REQUIRED`/bot-check before a stream URL is returned. Expect `channel_extract_extractor_bot_check` on first real sweep; levers: player-clients → cookies → proxy. |

**Known-open, deliberately not guessed at:**
- Code-switch ratio reads 0.000 on visibly bilingual speech — `HINDI_MARKER_WORDS` is romanised, Sarvam returns Devanagari. Needs a decision (transliterate / extend lexicon / different model), not a patch.
- Fidelity cannot be persisted or clear activation until a voice profile + biometric consent + human liveness challenge exist.
- HMAC skew window (60 s) is shorter than `voice-evidence`'s 176 s cold start, so the waking request returns 401 — an auth error for a latency problem. Worked around by pinging `/healthz` first. **The open-voice lane fails differently and this line used to blur the two:** its broker verifies the signature the moment the request lands and only then forwards it, so a cold *GPU runtime* is a **timeout**, not a 401. Owned as of WS-W by `api/_voice/warmup.js` for the studio panel; the processing worker's copy of the problem is still unassigned (`rejected.md#broker-healthz-is-a-front-door-not-a-readiness-check`).

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

## Open owner items

1. **Push `claude/gurukul-platform` and redeploy the studio.** The upload
   finalize fix is committed and the deployment is behind it, so today every
   real upload still dies at 409 `storage_metadata_incomplete`.
2. Google App Password → SMTP (removes the email rate cap).
3. Rotate everything pasted into a chat transcript: Neon password, Supabase
   keys + management token, Azure SP secret, Google OAuth secret, and the two
   keys flagged in `session-2026-08-25b-close`.
4. Azure GPU quota, if the deploy agent reports the subscription has none.
5. Apply migration 055 and set `CLONE_WIDGET_SESSION_SECRET` (≥32 chars,
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
