# Personal clone onboarding and evolution UX frontier, 2026-09-01

## Decision this brief supports

Vyakti should present itself as a private clone-making service for any person,
not as a teacher dashboard. The first useful outcome is hearing a protected
voice draft. Everything before that outcome should feel like one continuous,
mobile-first creation ritual. Everything after it should feel like evolving a
living, versioned clone rather than administering a processing system.

This is a desk review of current official product documentation, public vendor
flows, primary regulations, and first-party research available on 2026-09-01.
No competitor account was created and no competitor was tested behind login.
The labels below are strict:

- **Observed** means the behavior is described by the vendor's own current
  documentation or policy.
- **Inference** means it follows from several official sources but was not
  verified in a signed-in product session.
- **Proposal** is a Vyakti product decision, not a competitor fact.

The existing Vyakti measurements remain the source of truth for Vyakti timing.
Vendor speed claims are not transferred to this product.

## Executive decision

The target journey is:

```text
Home -> Sign in -> One consent ledger -> Brand reveal -> Record -> Review
     -> Build -> Meet -> Try custom text -> Enrich -> Evolve -> Call -> Deploy
```

Each arrow changes one full-viewport state. The ordinary journey has no stacked
dashboard and no document scrolling at standard phone sizes. At 200 percent
zoom, with large text, a short device, or the keyboard open, content must still
reflow and scroll rather than clip.

The core product laws are:

1. One primary action in each state.
2. A person says anything naturally. Reading a script is optional guidance,
   never the default requirement.
3. One up-front consent surface writes every required, purpose-specific grant.
   Later services silently recheck those grants. They do not ask again unless
   the scope changes, consent was withdrawn, or identity evidence is genuinely
   insufficient.
4. A 20 to 30 second capture gives the selector enough material to find one
   excellent short reference. The UI never implies that every uploaded minute
   directly conditions the voice.
5. Server facts own every wait. A stage, elapsed time, observed range, useful
   return time, and next check replace invented percentages.
6. A clone never silently rewrites itself. Calls and uploads create cited
   proposals. The owner accepts or rejects changes, producing a new version
   that can be compared or rolled back.
7. Motion and sound communicate causality. They do not conceal latency,
   manufacture progress, or delay access to the product.

## What the market currently does

| Product | Observed official behavior | Pattern worth taking | Do not copy |
| --- | --- | --- | --- |
| Fish Audio | Recommends at least 10 seconds, preferably 2 to 3 clips of 15 to 20 seconds. It says processing usually takes seconds, offers upload in the dashboard, and tells people to clone only a voice they have permission to use. Fish Speech S2 supports rapid cloning from 10 to 30 seconds and inline expressive controls. | Very short time to a first test; clear recording advice; direct text-to-voice loop. | Its public guidance is not a Vyakti timing promise. Its open weights use the Fish Audio Research License, which requires a separate commercial license for commercial use. Do not treat the repository as drop-in commercial infrastructure. |
| ElevenLabs | Instant cloning accepts upload or recording, then asks for name, labels, and a rights-and-consent confirmation before saving. It recommends about 1 to 2 minutes of clean, consistent audio and says more than 3 minutes can be harmful. Professional cloning uses 30 to 180 minutes, voice verification, a training queue, status in My Voices, and an email when ready. | Clear split between instant and professional quality tiers; explicit ownership confirmation; a ready notification; a persistent voice library. | Do not front-load naming, tagging, folders, or plan concepts before the first useful result. Do not collapse an instant draft and a trained production voice into one vague promise. |
| Cartesia | Instant cloning accepts a recording or file from 10 seconds. For a less widely spoken accent it recommends up to 60 seconds and its current guide says only Sonic 3.6 uses reference audio beyond 10 seconds. Pro cloning requires at least 30 minutes, says 2 hours or more gives the best result, and can train for up to 3 hours. | State that useful source length is model-specific; ask for the target language; make the instant versus trained quality tier explicit. | Do not expose model names or length rules as first-run engineering controls. Do not imply that extra audio helps a backend that does not consume it. |
| PlayAI / PlayHT | Documents instant cross-language cloning from about 30 seconds, browser recording or file upload, immediate use, streaming synthesis, and deletion of saved clones. | Record or upload in one place, then use the clone immediately; make deletion discoverable; stream custom output. | Official documentation is inconsistent across old PlayHT and newer PlayAI surfaces. Do not copy legacy vocabulary or engine names into user-facing IA. |
| Resemble AI | Documents rapid cloning from 10 seconds to 3 minutes with training under a minute. Recordings are first-class manageable objects with transcript, emotion label, active state, and quality diagnostics. Resemble requires speaker consent, uses speaker verification, and watermarks generated speech. | Source-level management, callback completion, actionable bad-recording diagnostics, explicit revocation and provenance. | Do not force a separate consent recording after the person has already granted clear, purpose-specific consent unless a real identity check requires it. Do not turn provider quality metrics into a fake likeness score. |
| Hume | Voice cloning supports a guided live recording or file upload. The guided session streams one prompt at a time and normally takes under 30 seconds; upload presents legal agreements. Its voice and call stack reuses the clone across TTS and EVI. EVI exposes interruption, expression measures, conversation history, and optional no-retention behavior. | A short guided capture; immediate movement from clone to conversation; expression treated as perceived delivery rather than inner emotion; interruptible calls. | Do not force line-by-line reading for the default path. Do not label a person as feeling an emotion. Hume itself says expression scores describe how observers may interpret delivery, not the speaker's internal state. |
| Tavus | Separates Persona, Replica, and Conversation. A replica trains from a short video, has explicit status and callbacks, and enters a WebRTC call. The component library offers full and minimal responsive call surfaces. Memories use a stable per-user store ID and are optional. Tavus requires explicit informed consent and AI disclosure. | Separate identity, behavior, knowledge, and live conversation layers; minimal call UI; stable per-person memory scopes; callbacks instead of page-bound waiting. | Do not copy its video-training ceremony into a voice-only first run. Its greeting currently cannot be interrupted in the default Daily flow, which is a poor pattern for a human-feeling voice call. |
| Delphi | Official docs frame the product as a digital version of the creator. Its Mind can ingest files, websites, YouTube, podcasts, Notion, Slack, X, TikTok, Facebook, Instagram, and LinkedIn. It supports interview-mode capture, voice, calls, WhatsApp, embeds, conversation review, and revision. | One identity across mind, voice, channels, and continuing improvement; broad ingestion; review real conversations and turn corrections into training material. | Its documented setup and operation are an admin studio with many profile, Mind, action, integration, and launch tasks. Do not make that the first-run product. Put breadth after the first clone speaks. |
| HeyGen and Synthesia | Both require explicit subject consent for a personal likeness. They support live mobile capture, explain exact rejection causes, and allow re-recording. HeyGen can send a remote consent QR to the subject. Synthesia combines voice cloning with avatar capture and lets owners delete avatars. | Explain the exact reason a capture was rejected; keep subject consent bound to the subject; provide deletion and remote-owner recovery. | Do not make a person repeat a second scripted consent ceremony for every ordinary voice version. Their stricter video-avatar identity flows solve a different risk and would overwhelm Vyakti's first voice draft. |

Primary vendor evidence:

- Fish Audio, [voice cloning best practices](https://docs.fish.audio/developer-guide/best-practices/voice-cloning) and [Fish Speech S2 release](https://github.com/fishaudio/fish-speech/releases)
- Fish Audio, [Fish Speech license](https://github.com/fishaudio/fish-speech/blob/main/LICENSE)
- ElevenLabs, [Instant Voice Cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning), [voice cloning overview](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning), and [professional voice verification](https://elevenlabs.io/docs/eleven-api/guides/how-to/voices/professional-voice-cloning)
- Cartesia, [clone voices](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices), [clone endpoint](https://docs.cartesia.ai/api-reference/voices/clone), and [Pro Voice Cloning](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices-pro)
- PlayAI, [voice cloning](https://play.ht/voice-cloning/), [API quickstart](https://docs.play.ht/reference/api-getting-started), and [Node SDK clone flow](https://docs.play.ht/reference/nodejs-sdk)
- Resemble AI, [clone overview](https://docs.resemble.ai/voice-creation/voices/clone-overview), [recording resource](https://docs.resemble.ai/voice-creation/recordings), and [commitment to consent](https://www.resemble.ai/our-commitment-to-consent)
- Hume, [voice cloning](https://dev.hume.ai/docs/voice/voice-cloning), [EVI FAQ](https://dev.hume.ai/docs/speech-to-speech-evi/faq), and [interruptibility](https://dev.hume.ai/docs/speech-to-speech-evi/features/interruptibility)
- Tavus, [CVI overview](https://docs.tavus.io/sections/conversational-video-interface/overview-cvi), [conversation overview](https://docs.tavus.io/sections/conversational-video-interface/conversation/overview), [memory FAQ](https://docs.tavus.io/sections/conversational-video-interface/faq), and [acceptable use policy](https://www.tavus.io/acceptable-use-policy)
- Delphi, [welcome](https://docs.delphi.ai/using-delphi/mind/content-upload), [content table](https://docs.delphi.ai/build/content/mind/manage-content-table), [interview sprint](https://docs.delphi.ai/playbooks/build-your-delphi/interview-sprint-zero-to-one-content), and [integrations](https://docs.delphi.ai/advanced)
- HeyGen, [consent video](https://help.heygen.com/en/articles/12092609-recording-your-consent-video) and [creation errors](https://help.heygen.com/en/articles/9824740-digital-twin-creation-error-codes)
- Synthesia, [personal avatars](https://docs.synthesia.io/docs/personal-avatars)

### Evidence boundary for homepage, authentication, and mobile behavior

The public sources are strong on capture requirements, consent, training
states, synthesis, calls, and data controls. They are weak on the exact
signed-out-to-signed-in click path. No competitor account was created for this
review, so this brief does **not** claim that a vendor currently uses Google
first, a one-screen consent ledger, a latched recorder, or the proposed mobile
layout. Those are Vyakti proposals derived from the owner's observed failures,
the binding repository evidence, and platform guidance.

This boundary matters because a polished public demo can conceal a different
authenticated workflow. Before treating any competitor auth or mobile pattern
as observed, run a separate instrumented walkthrough on a fresh account and a
real phone, recording every action, permission prompt, interruption, and
recovery. Until then, the competitor matrix above is the supported observation
set and the state machine below is the decision.

## The market-level conclusions

### 1. Short capture is the right first run, but every vendor means something different

Published guidance ranges from 10 seconds at Fish, Cartesia, and Resemble to 1
to 2 minutes at ElevenLabs Instant Voice Cloning. Fish recommends multiple 15
to 20 second clips, Resemble says 10 seconds to 3 minutes, Hume says its guided
session is under 30 seconds, and PlayAI says about 30 seconds.

The useful commonality is not a universal magic duration. It is that clean,
single-speaker, representative delivery matters more than blindly uploading a
long file. Vyakti's current stack selects one bounded reference window. The
first-run UI should therefore collect 20 to 30 seconds, show whether it contains
enough usable speech, and say plainly that the clearest short section drives
the first voice.

### 2. Consent is not the problem. Repeated, contextless consent is the problem

Every serious likeness platform reviewed requires authorization. Resemble
binds consent to speaker verification. Tavus requires explicit informed consent
for a replica. ElevenLabs confirms rights and verifies professional voices.
Hume requires rights or consent. HeyGen and Synthesia require the represented
person to record consent.

The correct low-friction design is not to remove consent. It is to collect
specific grants once, store them as durable server authority, and silently
recheck them at each protected operation. The consent screen should explain
four required purposes in plain language:

1. capture and privately store this recording;
2. analyze it to create the owner's voice identity;
3. synthesize protected AI speech in that voice;
4. retain the source and derived voice until the owner deletes it or withdraws
   the grant.

Call-derived memory, relational learning, public deployment, and reuse of a
different person's voice are separate purposes. They cannot be bundled as
invisible required consent. Optional call learning starts off and is requested
when the person chooses that feature, or it is included as a clearly separate
choice on the same initial screen.

This follows primary law, not only vendor custom. India's DPDP Act requires
consent to be free, specific, informed, unconditional, unambiguous, and given
by clear affirmative action. GDPR Article 7 requires an intelligible,
distinguishable request and withdrawal to be as easy as granting consent. The
EU AI Act requires disclosure for generated or manipulated audio that could
appear authentic.

Primary legal references:

- India Code, [Digital Personal Data Protection Act, 2023, section 6](https://www.indiacode.nic.in/bitstream/123456789/22037/1/a2023-22.pdf)
- MeitY, [Digital Personal Data Protection Rules, 2025](https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa?hl=en-US)
- EUR-Lex, [GDPR Article 7](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32016R0679)
- EUR-Lex, [AI Act Article 50 and recital 134](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX%3A32024R1689)

### 3. The strongest products move from creation to use immediately

Fish, PlayAI, Resemble, Hume, and ElevenLabs all connect cloning to a direct
synthesis surface. Hume goes further by making the same saved voice usable in
its live EVI. Tavus makes Replica and Persona inputs to Conversation. The
important product pattern is that the first result is not a dashboard row. It
is the clone doing something.

Vyakti should reveal the draft with one short, language-matched protected
sample, then keep replay and custom text in the same viewport. Enrichment and
advanced controls come only after this proof of value.

### 4. Broad ingestion belongs after the first voice, with an honest layer map

Delphi has the broadest documented ingestion surface. Its weakness for this
journey is that breadth creates an admin product. Vyakti should expose the same
concept after the reveal as four human choices:

- **Speak more** for voice and delivery;
- **Add media** for owner speech, expression, and cited context;
- **Paste links** for supported public context;
- **Describe me** in natural language for owner-authored persona intent.

Every source must say what it actually became. A document can strengthen mind
and cited knowledge but not voice identity. An image may provide user-reviewed
context but cannot prove inner emotion. A call may propose a relationship fact
but cannot silently train the voice. A long video may yield one selected voice
window rather than condition the model for its full duration.

### 5. Clone evolution is still an open product space

The reviewed official docs contain voice libraries, source tables, status
tables, revisions, retraining, and candidate voices. I did not find a current
official flow that turns a person's evolving voice, mind, expression, and
relationships into a clear, reversible user-facing version history.

That is a credible Vyakti differentiation. It should be a version lineage, not
points or a streak. Each version shows:

- the sources and owner decisions that changed it;
- which layer changed: voice, expression, mind, relation, or behavior;
- a protected before-and-after sample or answer;
- measured quality evidence where a valid measure exists;
- restore, compare, and delete actions.

## Binding minimal-click state machine

The state machine is durable. URL state and server state restore the exact
clone and task after reload, another tab, or an authentication round trip.

| State | What is visible | One primary action | Exit condition | Recovery |
| --- | --- | --- | --- | --- |
| `home` | One sentence, one human visual, one create action, sign-in secondary | Create my clone | Auth begins | Return to same intent after auth |
| `auth` | Google first, email second, truthful link-or-code wording | Continue with Google or send email | Secure browser session exists | Preserve destination through magic-link return |
| `consent` | Four required purpose cards, one optional learning card, privacy and deletion links | Create my private clone | Purpose-specific server grants are committed | Name exactly which grant failed and retry the commit, not the whole journey |
| `reveal_brand` | Brief Vyakti mark and sonic signature | None; Skip remains available | 0.9 to 1.2 seconds or Skip | Reduced-motion uses a short fade; muted state persists |
| `capture_idle` | One large record control, current language guess only after speech, optional prompt hidden | Press, tap, or Space to start | Browser stream is live | Permission denial stays in the same state with exact browser recovery |
| `capture_live` | Reactive waveform, elapsed time, usable-speech ring, one changing label | Tap or Space to finish | Minimum viable speech captured or hard limit reached | Interruptions preserve a clear Retake action; no blank page |
| `sample_review` | Playback, duration, usable speech, clipping/noise summary, detected language | Build this voice | Person accepts sample and language | Retake returns directly to idle; no source or clone duplication |
| `build` | Current server phase, elapsed, observed range, upper bound, return time, next check | Notify me when ready | Source ready and first voice draft exists | Reload or another tab observes the same durable job; errors name user versus platform owner |
| `meet` | Full-screen reveal, clone name, one protected sample | Play or replay | First sample is available to the browser | If autoplay is blocked, the same control becomes Tap to meet your clone |
| `custom` | One text field, Hindi / Hinglish / English selector, history of this session's samples | Speak this | One protected intent settles | Retry observes the same intent; Regenerate is the only new generation authority |
| `enrich` | Four source choices and one natural-language description field | Evolve my clone | At least one supported source or description is accepted | Unsupported sources state the real alternative without entering fake processing |
| `evolve` | Version birth animation, delta summary, compare control | Meet version N | New reviewed materialization is ready | Old version remains usable and restorable |
| `call` | Clone presence, listening / thinking / speaking state, mic, captions, End | Talk | Session exists before mic access; media starts on Talk | Mic denial never hides an already-created session; End is durable and idempotent |
| `after_call` | Cited proposals grouped by mind, relation, expression, and voice | Review changes | Owner accepts or rejects every proposed durable change | Nothing auto-trains or becomes memory without a decision |
| `deploy` | Web, app, and later phone/channel destinations | Choose a destination | Destination-specific contract satisfied | Costs, disclosure, retention, and availability are shown before activation |

### Click budget

**Proposal:** instrument these budgets as product metrics, not design wishes.

| Journey | Maximum deliberate product actions before result |
| --- | ---: |
| Returning, signed-in, already consented user to recording started | 1 |
| Returning user to a submitted clean recording | 3: start, finish, build |
| First-time user using Google to recording started | 4 after the home CTA: Google, confirm required grants, create, record |
| First-time user using email to recording started | 5 to 6, depending on link versus optional code |
| Ready clone to first custom generation | 2: open custom, submit text |
| Ready clone to live call session | 2: open call, Talk |

Never add a mandatory clone name, avatar, use-case, occupation, or project name
before the first voice. Generate a private working name and let the person edit
it later.

## Recorder interaction contract

The requested gesture is not a conventional hold-to-record control, because
release does not stop capture. Name and implement it as a **latched recorder**:

1. A pointer down, keyboard Space, or ordinary tap starts recording.
2. The control immediately latches. Releasing the pointer does not stop it.
3. The center label becomes **Recording. Tap to finish**.
4. A second tap, click, Enter, or Space finishes.
5. If the person keeps holding, capture continues. On release it still remains
   active until the second action.
6. Pointer cancel, losing hover, or moving a finger off the control never
   silently discards the capture.

This preserves the owner's requested tap and hold behaviors without making a
release gesture destructive. The interface must use a real button with a
visible focus state, `aria-pressed`, and a separate polite live announcement
for state changes. The timer must not announce every second to a screen reader.

### Capture targets

- Minimum submitted recording: 12 seconds of usable speech.
- Visible sweet spot: 20 to 30 seconds.
- Soft recommendation: continue until the quality ring is complete.
- Hard first-run cap: 60 seconds, followed by automatic review.
- Speech: anything natural. An optional one-line idea appears only when asked.
- Background: local preview and quality analysis remain on device until Build.
- Microphone permission: request it only after the first explicit record action.

These durations are a product target for the current best-window architecture,
not a universal voice-cloning rule.

### Immediate sample analysis

Show only decision-useful facts:

- total recorded duration;
- usable voiced duration;
- clipping or volume imbalance;
- long silence or severe interruption;
- obvious background noise or overlap when measured;
- provisional Hindi, Hinglish, or English guess.

Do not show a single "voice quality 92" number. Source health, speaker
similarity, accent fidelity, pronunciation, naturalness, and emotional range
are different measurements. A clean-source score is not proof the clone sounds
like the owner.

The review state has exactly two choices: **Build this voice** and **Retake**.
Changing language is inline, not a third navigation step. The detected language
is selected by default, but the owner can change it before Build.

## Honest time design

### Current Vyakti evidence to display

Current measured production evidence includes:

- three recent short recordings reached ready and built reviewable drafts in
  about 4:02 to 5:40;
- one fresh 10-second production canary reached source ready and a draft in
  about 4:07;
- cold preview readiness has been observed between about 291 and 418 seconds;
- one zero-replica protected browser preview appeared after 342 seconds;
- after durable concurrency work, five distinct warm simultaneous preview
  intents sealed in about 29.7 to 41.2 seconds;
- a later warm Mirror Call reached ready in 18 seconds.

These samples are small and infrastructure-specific. The UI should therefore
show an observed range and upper bound, not a guaranteed exact completion time.

### Wait presentation

The build surface has one central time object:

```text
Preparing your voice
03:42 elapsed
Usually ready in 4 to 6 minutes
Observed upper bound: 8 minutes
Next check in 20 seconds
Safe to leave. We will keep working.
```

The visible countdown is an **upper-bound countdown**, not a finish countdown.
It starts from the durable server job or runtime wake timestamp and never
restarts when the tab reloads, another tab opens, or the person requests custom
text. If the result is ready early, the timer dissolves into the reveal. If the
upper bound expires, it changes to **Taking longer than usual** and shows the
actual phase and recovery owner. It never sits at zero while work continues.

Use determinate progress only when the server knows total work, such as 5 of 8
checks. Do not map 3 of 8 checks to 38 percent of elapsed time. Apple explicitly
warns that inaccurate progress feels deceptive; classic HCI research finds
that progress feedback lowers uncertainty, but that benefit depends on the
feedback being meaningful.

Primary references:

- Apple, [Progress indicators](https://developer.apple.com/design/human-interface-guidelines/progress-indicators)
- Brad Myers, [The Importance of Percent-Done Progress Indicators](https://www.cs.cmu.edu/~bam/papers/percentdoneCHI85.pdf)
- Harrison, Yeo, and Hudson, [Faster Progress Bars](https://www.figlab.com/research/2010/faster-progress-bars)

The Harrison paper demonstrates that visual treatment can alter perceived
duration. Vyakti should use that insight for calmness and legibility, never to
make a stalled process look active.

## Reveal and custom-text contract

### First reveal

The first protected sample uses a reviewed, 40 to 50 word passage in the
selected language. It should sound like a newly created personal clone, not a
teacher, salesperson, or generic assistant. The writing shape is:

1. a warm recognition that the voice belongs to the owner;
2. an everyday image from life or nature;
3. a restrained science-fiction thought about memory or time;
4. an invitation to shape what the clone becomes.

Maintain separate human-reviewed Hindi, Hinglish, and English passages. Do not
translate one English paragraph word for word. The Hinglish passage should use
ordinary Indian code-switching and avoid a dense demonstration of acronyms,
symbols, names, and numbers in the very first emotional moment.

### Autoplay reality

The owner wants the clone to begin speaking as soon as it is ready. This can be
attempted, but it cannot be the only cross-browser contract. Chrome suspends a
Web Audio context created before user interaction, and Apple recommends avoiding
uncontrolled autoplay. A result arriving four to eight minutes after the last
gesture may be blocked, especially on mobile.

The robust contract is:

1. the Build action explicitly offers **Play when ready** and unlocks audio
   where the browser permits;
2. the ready state attempts playback once;
3. if the browser blocks it, the same visual reveal settles with one large
   **Meet your clone** control;
4. no hidden looping audio, silent media hack, or repeated autoplay attempt;
5. mute and captions remain available.

Primary references:

- Chrome, [Web Audio autoplay policy](https://developer.chrome.com/blog/web-audio-autoplay)
- Apple, [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- Apple, [Playing audio](https://developer.apple.com/design/human-interface-guidelines/playing-audio)

### Custom text

- One expanding text field, not a form grid.
- Hindi, Hinglish, and English are adjacent segmented choices.
- Enter submits on desktop; Shift+Enter adds a line. The main button is always
  present for mobile.
- The result appears in the same audio stage and the previous result remains
  replayable.
- A retry observes the same durable generation intent. Only **Regenerate**
  authorizes another synthesis.
- Warm generations show the warm observed range; a cold runtime continues its
  existing upper-bound timer rather than starting a new 8-minute clock.

## Enrichment without an admin dashboard

After the person has heard the clone, show **Make it more you**. Four cards fit
inside one viewport; selecting one replaces the card grid with its focused task.

| Human choice | Accepted inputs | Intended layers | Required truth in the UI |
| --- | --- | --- | --- |
| Speak more | Browser recording, audio file | Voice candidates, delivery mechanics, language coverage | Name which recording is primary and which are supporting. Longer is not automatically better. |
| Add media | Audio, video, images, PDFs, Word documents, text, chat exports | Voice when owner speech is verified; otherwise expression evidence and cited mind context | Show what extraction succeeded, what was unreadable, and who the detected speaker is. |
| Paste links | Web pages, supported social links, one video or channel when extraction is actually available | Cited mind context and possible owner speech | Metadata-only checking is not ingestion. The current YouTube audio route is blocked, so offer upload of the owner's exported file until that route is live. |
| Describe me | Natural-language text or a short voice answer | Owner-authored persona intent, boundaries, humor, tone, goals | Vague input is accepted. The system may ask one focused follow-up, never present a schema or JSON. |

The current production limitation matters: YouTube metadata checking exists,
but datacenter media extraction remains blocked without the separately approved
route. A beautiful link box must not turn that into believable dead progress.

## Clone evolution and version history

### Product model

Call each owner-approved materialization an **Evolution**:

```text
Evolution 1  Voice born
Evolution 2  More expressive
Evolution 3  Knows my work
Evolution 4  Remembers this relationship
```

This language can feel alive without claiming autonomous learning. The desktop
uses a left edge drawer. Mobile uses a bottom sheet opened from one persistent
version glyph. The main flow never reserves permanent width for the drawer.

Each version card contains:

- date and short human label;
- changed layer badges;
- cited source count;
- one sentence explaining the change;
- Play, Compare, Restore, and Delete in progressive disclosure;
- status: Draft, Ready, Needs you, or Waiting on Vyakti.

### Version birth animation

The birth moment is reserved for a real committed version. A soft point field
coalesces into the clone mark, the old and new versions separate for comparison,
and the new version settles into the timeline. It must not run for a queued row
or a failed build.

Do not use points, streaks, scarcity, or daily rewards for consent, recording,
or accepting inferred facts. Gamification may celebrate evidence-backed growth;
it must not pressure a person into sharing more private data.

## Call experience and learning boundary

The strongest current call products agree on a few mechanics: visible call
state, interruption, device controls, bounded timeouts, stored conversation
history only under a retention policy, and post-call artifacts. Hume treats
expression as delivery context; ElevenLabs exposes turn eagerness, soft timeout,
retention, audio saving, and interruption; Tavus exposes Replica speaking events,
turn indices, memory stores, and responsive call blocks.

Vyakti's call surface should show only:

- the clone presence;
- Listening, Thinking, Speaking, Reconnecting, or Ended;
- elapsed call time;
- microphone toggle, captions, speaker, and End;
- an optional transcript drawer;
- one subtle latency signal only when a turn is unusually slow.

Create the durable call session before requesting the microphone. Ask for mic
access on **Talk**, show the server session immediately, and keep denial
recoverable. This matches the existing production lesson that a browser
permission prompt must never hide a successful HTTP 201.

After the call, use a four-lane review:

- **Things I said**: candidate facts and preferences with transcript citations;
- **People and relationships**: dyad-scoped candidate memories;
- **How I sounded**: temporary observable pacing, pause, emphasis, and delivery
  cues, explicitly not inner emotion;
- **Voice candidates**: verified clean windows that may enter a later matched
  evaluation, never automatic hot-path training.

The owner accepts, edits, rejects, or leaves each proposal temporary. An
accepted set creates a new Evolution. Every decision remains reversible and
source erasure reaches every derivative.

Primary call references:

- Hume, [EVI FAQ](https://dev.hume.ai/docs/speech-to-speech-evi/faq) and [audio handling](https://dev.hume.ai/docs/speech-to-speech-evi/guides/audio)
- ElevenLabs, [conversation flow](https://elevenlabs.io/docs/eleven-agents/customization/conversation-flow), [privacy](https://elevenlabs.io/docs/eleven-agents/customization/privacy), and [Expressive mode](https://elevenlabs.io/docs/eleven-agents/customization/voice/expressive-mode)
- Tavus, [Interactions Protocol](https://docs.tavus.io/sections/conversational-video-interface/interactions-protocols/overview) and [responsive call blocks](https://docs.tavus.io/sections/conversational-video-interface/component-library/blocks)

## Motion, sound, and visual behavior

### Brand reveal

- Duration: 0.9 to 1.2 seconds, skip available immediately.
- Trigger: the successful consent commit, which is a real state change.
- Sound: one 300 to 500 ms sonic signature initiated by that user action.
- Mute: visible on first use and persisted.
- Reduced motion: 180 ms opacity transition, no orbit, scale burst, blur tunnel,
  or parallax.
- Return visits: do not replay the full reveal. Use a 180 ms mark settle at most.

Apple's guidance is directly relevant: onboarding should be fast and teach
through interaction, a splash should be only long enough to absorb, motion must
have a purpose, and branding should not occupy product space repeatedly.

### Recording motion

- The record control depresses in 120 ms and latches with a tactile-looking
  spring, but the element never scales from zero.
- The waveform is driven by real amplitude, not a canned loop.
- A slower outer breath indicates duration; a separate arc indicates usable
  speech. One ring must not pretend to mean both.
- Clipping briefly warms the color and gives a text cue. Silence settles rather
  than continuing fake activity.
- Stop settles in 180 to 240 ms, then analysis appears in place.
- Haptics, where available, complement start, accepted stop, and ready. They are
  optional and never run while recording because vibration can contaminate the
  microphone.

### Stage transitions

- Small state feedback: 120 to 180 ms.
- Full-viewport stage transition: 240 to 320 ms.
- Drawer or bottom sheet: 280 to 420 ms, gesture-interruptible.
- Use transform and opacity; avoid layout animation in the recording hot path.
- Exit completes before entrance begins when the relationship would otherwise
  be ambiguous.
- No `transition: all`, infinite decorative motion, or animation that blocks an
  action.

Primary design references:

- Apple, [Onboarding](https://developer.apple.com/design/human-interface-guidelines/onboarding)
- Apple, [Motion](https://developer.apple.com/design/human-interface-guidelines/motion)
- Apple, [Playing haptics](https://developer.apple.com/design/human-interface-guidelines/playing-haptics)
- Apple, [Branding](https://developer.apple.com/design/human-interface-guidelines/branding)

## Mobile and accessibility contract

One-screen design is a normal-size target, not permission to clip content:

- zero body scroll for each ordinary core state at 360 by 780, 390 by 844,
  412 by 915, and 844 by 390;
- no horizontal overflow at 320 CSS pixels;
- allow vertical scroll under text zoom, browser UI compression, keyboard,
  translation expansion, and accessibility settings;
- use `100dvh`, safe-area insets, and a keyboard-aware action dock;
- every primary control at least 48 by 48 CSS pixels; no visible action below
  44 by 44;
- recording control at least 112 CSS pixels on phone;
- primary action remains reachable with one thumb and does not sit under the
  browser chrome or home indicator;
- all motion has a reduced-motion route and all sound has visual equivalence;
- waveform is decorative to assistive technology; recording state and duration
  are announced separately;
- color never owns success, warning, or failure alone;
- back navigation never deletes a recording or version.

W3C WCAG 2.2 sets a 24 by 24 CSS pixel AA floor with spacing exceptions and a
44 by 44 enhanced target. Vyakti should hold the stronger 44 pixel product
floor and use 48 pixels for recurring primary actions.

Primary references:

- W3C, [WCAG 2.2 target size minimum](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
- W3C, [44 by 44 enhanced target](https://www.w3.org/WAI/WCAG21/Understanding/target-size)
- Apple, [Privacy and permission timing](https://developer.apple.com/design/human-interface-guidelines/privacy)

## What not to copy

1. **A dashboard before delight.** Voice lists, source tables, tags, API keys,
   integrations, and model settings can exist, but not before the first clone
   speaks.
2. **A second consent trap.** Consolidate real grants up front and recheck them
   silently. Never remove the server predicate or restore a public self-test
   bypass.
3. **Scripted recording as the only path.** Hume's guided prompts and avatar
   scripts can improve phonetic coverage, but the owner explicitly wants natural
   speech. Keep prompts optional and measure whether guided capture helps before
   promoting it.
4. **A fake percentage.** Milestones are not elapsed time. A visually exciting
   38 percent that never moves is worse than a truthful phase and return time.
5. **Automatic sound with no control.** A sonic identity can follow a gesture.
   A delayed clone reveal must survive autoplay blocking.
6. **One giant clone profile.** Keep voice, observable expression, owner-authored
   persona, knowledge, and dyad-scoped relationship memory separate and cited.
7. **Hidden hot-path learning.** A call can generate proposals. It does not
   permanently infer emotion, rewrite identity, or train weights by itself.
8. **Long-file theatre.** Do not imply a two-hour upload produces a proportionally
   better instant voice when the active model conditions on one short window.
9. **A dead YouTube lane.** Metadata success is not audio extraction. Offer an
   honest file-export route until the production extractor is real.
10. **Teacher language in a horizontal product.** No teacher, lecture, class,
    student, or subject concept belongs in the generic first-run shell.
11. **Decorative sci-fi.** Glows, particles, sound, and type cannot compensate
    for a missing job, a failed clone, or wrong pronunciation. Futurism comes
    from coherent state change and the clone's presence.
12. **Gamified privacy extraction.** Never reward more uploads, wider consent,
    or approval of inferred facts with points or artificial scarcity.

## Measurable acceptance targets

These are product targets to validate, not claims of current performance.

### Funnel and comprehension

- At least 90 percent of moderated first-time participants can state what will
  happen to the recording before granting consent.
- At least 90 percent can start recording without instruction.
- At least 85 percent correctly predict that release does not stop the latched
  recorder after one observed demonstration. If this misses, use tap-to-start
  rather than preserving a clever gesture.
- Median returning-user time from page ready to recording start under 8 seconds.
- Median first-time time from completed auth to recording start under 45 seconds.
- Clean sample to Build requires no more than three deliberate actions.
- Zero teacher-specific strings in the generic shell.

### Recording and recovery

- Local post-stop analysis appears within 500 ms on target mid-range phones.
- A microphone denial produces a same-screen recovery in 100 percent of tested
  Chrome Android and Safari iOS cases.
- Refresh after upload returns to the exact clone and durable build state.
- Multiple tabs observe one source build and one preview intent.
- Delete and retake never leave the replacement source bound to the deleted
  clone or primary pointer.

### Waiting

- Every wait shows phase, elapsed, observed range, upper bound, next check, and
  who owns the next action.
- No user-visible percentage without server-backed completed and total work.
- Upper-bound timer never restarts across reload, tab, route, or custom text.
- At least 95 percent of short source builds complete within the displayed
  observed band before calling that band reliable.
- Ready notification delivery rate and tap-through are measured separately.

### Voice reveal and generation

- Ready-to-first-audio requires at most one action even when autoplay is blocked.
- Replay starts within 150 ms when protected audio is already cached locally.
- A duplicate Retry creates zero additional GPU generations.
- Language selection and text survive reload or auth recovery.
- Hindi, Hinglish, and English reveal passages each pass a native-speaker review.
- Code-switch pronunciation has its own switch-boundary error rate and listening
  test. Overall WER alone cannot certify it.

### Mobile quality

- Zero horizontal overflow at 320, 360, 390, 412, 834, 844 landscape, and 1355
  CSS pixel viewports.
- Zero visible interactive targets below 44 by 44 CSS pixels.
- No clipped primary action with the keyboard open.
- Core stage remains functional at 200 percent text zoom.
- Reduced-motion and mute choices persist.

### Evolution and trust

- Every durable clone change identifies exact source and owner decision.
- Restore produces the previous version without deleting the new one.
- Source deletion removes or retires every dependent version and memory edge.
- Calls create zero automatic durable emotion claims and zero automatic training
  jobs.
- Owners can reject a proposal in one action and see the effect immediately.

## Research-informed implementation order

This order prevents visual polish from hiding a dead path:

1. **Authority and identity:** fix Google and email session continuity, write the
   single consent ledger, preserve real server predicates, and make withdrawal
   and deletion reachable.
2. **Durable creation state:** same-account new clone, deleted-primary recovery,
   source idempotency, exact URL state, and one truthful status owner.
3. **Capture:** latched recorder, local analysis, review, language confirmation,
   private upload, and primary-source selection.
4. **Build and reveal:** observed upper-bound timer, leave-and-return behavior,
   notification, autoplay fallback, replay, custom text, and generation
   idempotency.
5. **Generic product shell:** remove teacher framing and replace rail/dashboard
   density with one full-viewport task at a time.
6. **Enrichment:** source chooser, natural-language persona description, honest
   source-to-layer receipts, and no fake YouTube processing.
7. **Evolution:** reversible version lineage, compare, restore, delete, and birth
   animation only on committed state.
8. **Call:** visible session before microphone, natural turn states, interruption,
   and post-call cited proposals.
9. **Motion and sonic polish:** brand reveal, causal transitions, waveform,
   haptics, reduced motion, and performance budgets.
10. **Moderated and production tests:** first-time phone, returning phone,
    same-account replacement, multi-tab, multi-account concurrency, offline and
    reload recovery, long text, mixed language, accessibility, and deletion.

## Reversal conditions

- Replace the latched recorder with ordinary tap-to-start if fewer than 85
  percent of moderated participants understand that release does not stop it.
- Remove the sample review action if measured recording acceptance and owner
  confidence do not improve versus the two-action automatic path.
- Lengthen the first capture only if matched listening shows a meaningful
  improvement over the 20 to 30 second best-window path.
- Split the consent screen only if legal review or measured comprehension shows
  the single surface prevents specific, informed choice.
- Drop the branded reveal if it adds more than 1.2 seconds to time-to-recorder or
  more than 5 percent of participants attempt to skip it before it completes.
- Use a determinate build bar only when the backend exposes monotonic work units
  whose completion correlates with remaining time. Otherwise retain phase and
  observed bounds.
- Promote a YouTube or social source to the primary flow only after authenticated
  production extraction succeeds over a representative corpus with named error
  recovery.
- Allow automatic clone evolution only if the system can provide citation,
  speaker attribution, owner preview, rollback, consent withdrawal, and source
  erasure for every change. Today it cannot, so owner approval remains binding.

## Bottom line

The best existing products each solve one part: Fish makes cloning feel short,
ElevenLabs makes quality tiers legible, Cartesia explains model-specific source
length, Hume connects expression to live conversation, Tavus separates
persona from replica and call, Resemble treats consent and provenance as real
infrastructure, and Delphi demonstrates the value of broad context and ongoing
review.

Vyakti's opportunity is to combine those strengths without importing their
admin surfaces. A person should grant clear authority once, make a clean sample
in seconds, understand the real wait, meet the clone in one focused moment,
then evolve it through cited, reversible versions. The futuristic feeling
comes from that continuity and trust, not from adding more controls or more
text.
