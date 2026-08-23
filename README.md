# Meera — an AI companion who feels like a person

Some nights are quieter than they should be. Meera is for those.

She texts in Hinglish like a real person, remembers what you tell her, and
takes voice calls in a genuinely human, expressive voice. Everything runs in
the browser — no install, no account, no settings.

## 💬 Use her now

**[meera-silk.vercel.app](https://meera-silk.vercel.app)** — the site *is* the
app. Land, press **Start chatting**, done. Her brain is a hosted serverless
proxy in front of OpenRouter open-source models, so a fresh visit already
thinks for real — no API key needed.

| Onboarding | Chat | Voice call |
| --- | --- | --- |
| ![](site/assets/onboarding.png) | ![](site/assets/chat.png) | ![](site/assets/voice.png) |

## What she does

- **Chat that feels human** — research-calibrated rhythm: she reads your message
  (~4 words/sec) before the typing indicator appears, types at a human pace,
  splits thoughts across multiple bubbles, uses emojis sparingly, and shares
  real photos from her day (beach evenings, the novel she's rereading, her
  sketchbook).
- **Nothing scripted** — her openers, nudges, and the texture of her day are
  improvised by the model every time; there are no canned lines to catch.
- **Memory** — she learns your name, city, work, and loves, and brings them up
  later. One header button clears the chat for a fresh start.
- **Voice calls** — a human, expressive voice (laughs, pauses, whispers) with
  no captions — a call is a call. On-device speech recognition where
  available, typed fallback everywhere else.
- **Presence** — she has her own life and days worth sharing; she matches your
  energy instead of clinging.

## The backend

Supabase (Postgres) behind the same Vercel proxy — the app never holds a
database key:

- **Full conversation log** (`meera_log`): every chat and call turn, per
  anonymous device id.
- **Graph memory** (`meera_nodes` + `meera_edges`): a cheap LLM distills
  conversations into entities (people, places, plans, preferences, events)
  and relationships, with salience that grows on repeat mentions. Before
  every reply, `/api/memory` recalls the relevant subgraph and injects it as
  "what you know about them" — so context survives cleared chats, new
  devices... nothing she learns is ever lost.

## The brain and the voice

- **Brain**: the Vercel function `api/chat.js` holds an OpenRouter key
  server-side (default model `google/gemini-3.6-flash`); the repo and the
  client never contain it. If every brain is unreachable she sends an honest
  "net dikkat kar rha" text — never fake conversation. Crisis and AI-honesty
  replies always work, even offline.
- **Voice**: `api/speech.js` speaks through Gemini expressive TTS (via the
  same OpenRouter key) — audio tags like [laughs] and [whispers], wrapped
  server-side into WAV. Device TTS is only the offline fallback.

## Care & honesty

Built on research into companionship psychology and current companion-chatbot
law (California SB 243, New York AI Companion law, EU AI Act art. 50):

- Clear AI disclosure at onboarding; she answers honestly if sincerely asked.
- Crisis-aware: expressions of self-harm drop all playfulness and surface real
  helplines (Tele-MANAS 14416 / iCall — India, 988 — US, Samaritans — UK).
- No dark patterns: no guilt-trips, no paywalled affection, no dependency
  farming. She encourages your real-world life and lets you leave gracefully.

## Development

```bash
npm install
npm run dev                   # web dev server
bash scripts/vercel-build.sh  # what Vercel runs: app at /chat, landing at /
```

Deployed on Vercel: static landing (`site/`) + the React app (`/chat`) + the
`api/chat.js` proxy. The proxy key lives in `api/_config.js` (gitignored —
copy `api/_config.example.js`) or the `OPENROUTER_API_KEY` env var.

An Android APK build still exists (`npx cap sync android && cd android &&
./gradlew assembleDebug`, last shipped: `release/Meera-v1.6.apk`) but the
website is the product.

Stack: React 19 + TypeScript + Vite, framer-motion, Capacitor 8 (Android
shell), Anthropic SDK. Rename her in `src/engine/persona.ts` (`HER_NAME`) —
everything follows from there.

## Replica Lab (`voice-cloning` branch)

This branch also contains the first product slice of Vyakti Replica Lab at
`/studio`: an authenticated, private self-replica workspace. It is separate
from Meera and does not change her current chat or call lanes.

Implemented now:

- owner-derived replica lifecycle and immediate revoke/erasure queue;
- granular source capture, transcription and storage consent;
- browser-side incremental SHA-256 and direct signed upload to a verified
  private bucket, followed by quarantine and a retryable processing queue;
- randomized, expiring microphone/video challenge capture that an owner cannot
  self-pass, with an explicit pending-verifier boundary;
- immutable integrity, diarization, separation, enhancement, ASR and
  multi-embedding adapter contracts that build only reviewable VoiceGenome
  drafts, plus a real Azure Speech fast-transcription HTTP adapter that has
  been tested against mocked responses but not live quality data;
- owner-only processing review with privacy-safe evidence summaries,
  append-only accept/reject/supersede decisions, and an idempotent draft-only
  VoiceGenome build queue;
- an evidence-backed Person Model that turns cited, owner-reviewed claims into
  deterministic versioned identity, speech, behaviour, values, boundaries,
  autobiography and relationship-mode profiles while retaining uncertainty;
- a private cited-claim extraction lane for accepted target-speaker
  transcripts: direct identifiers are masked before a strict Azure Foundry
  structured-output request, citations are independently revalidated, and all
  results remain owner-review proposals; the adapter is protocol-tested only
  and stays blocked until verified training consent is live;
- a typed owner calibration lab with safe server-owned contrasts,
  append-only revisions, deterministic policy builds and exact runtime/eval/
  generation version binding instead of free-text prompt accretion;
- hard `agent_id` isolation for raw logs, graph memory, suppressions and
  consolidation cursors, plus strict default-removal/natural-key migrations
  gated for a second agent; production migrations remain unapplied;
- provider-neutral VoiceGenome and streamed PCM synthesis contracts;
- a non-bypassable output-protection contract: audible prefix, streaming
  watermark proof, signed 240 ms segment hash chain, final C2PA-bound asset
  receipt, revocation-aware authorization, and production refusal of fake
  adapters;
- an immutable private runtime capability that freezes the exact approved
  Person Model, calibration policy, VoiceGenome, provider voice and
  seven-suite qualification set; it resolves agent/person ownership server-side, scopes every
  RelationalOS read to that pair, and routes cloned speech only through the
  protected cascade endpoint with no wrong-voice fallback;
- a private replica dialogue path that actually compiles that frozen Person
  Model, typed calibration, isolated relationship state and recent session
  history into strict Azure Foundry structured output; conversation text is
  stored once in the erasable raw log, and protected voice accepts only the
  exact server-issued turn rather than arbitrary client text;
- an exact-version owner feedback loop that grades wording, behavior,
  relationship, memory, delivery and heard voice separately; optional owner
  corrections use per-exemplar envelope encryption and become auditable
  preference evidence rather than automatic prompt mutations;
- a production Neon provenance ledger that rechecks active replica capability
  before each signed PCM segment is released, making revocation a streaming
  delivery fence rather than only a UI state;
- offline enrollment, IDOR, lifecycle, disclosure and provider-contract gates;
- a researched Azure Foundry spend plan below the $2,000 grant ceiling;
- an atomic, content-free paid-provider ledger that reserves conservative
  Azure Foundry token cost before network I/O, settles measured usage, and
  locks ambiguous outcomes for reconciliation instead of risking double spend.

Biometric consent, identity/age verification, anti-replay, real voice training
and synthesis, production watermark/C2PA/signing adapters, and live runtime
activation remain closed until their explicit live gates pass. The full architecture is in
[`docs/SPEC-REPLICA-PLATFORM.md`](docs/SPEC-REPLICA-PLATFORM.md), frontier
research in [`docs/research/REPLICA-FRONTIER-2026.md`](docs/research/REPLICA-FRONTIER-2026.md),
provenance in [`docs/REPLICA-PROVENANCE.md`](docs/REPLICA-PROVENANCE.md), and
runtime isolation in [`docs/REPLICA-RUNTIME.md`](docs/REPLICA-RUNTIME.md).
Dialogue serving is in [`docs/REPLICA-DIALOGUE.md`](docs/REPLICA-DIALOGUE.md).
The Person Model contract is in [`docs/PERSON-MODEL.md`](docs/PERSON-MODEL.md).
Private cited extraction is in [`docs/CLAIM-EXTRACTION.md`](docs/CLAIM-EXTRACTION.md).
Calibration is specified in [`docs/CALIBRATION.md`](docs/CALIBRATION.md).
Turn-level fidelity learning is in [`docs/TURN-FEEDBACK.md`](docs/TURN-FEEDBACK.md).
Azure allocation is in [`docs/AZURE-FOUNDRY-PLAN.md`](docs/AZURE-FOUNDRY-PLAN.md).
The enforced application ceiling is in [`docs/PROVIDER-BUDGET.md`](docs/PROVIDER-BUDGET.md).
