# Voice clone product UX, 2026-08-30

## Question

How should a person create, test, and improve a private voice clone on a phone without learning our processing pipeline?

This review combines the current Vyakti source journey, focused browser tests, and public product documentation available on 2026-08-30. Competitor timings are their published guidance, not Vyakti measurements.

## What the market gets right

| Product | Useful pattern | Boundary |
| --- | --- | --- |
| Fish Audio | One compact creation surface. A short sample is enough to start and the user can add a description without leaving the flow. | Its public flow does not give Vyakti a measured queue or GPU promise. |
| ElevenLabs | Separates instant cloning from higher-effort professional cloning and gives different sample guidance for each. | Longer audio is useful for a different product tier. It does not justify making Vyakti's instant path longer. |
| Resemble AI | Treats recordings as manageable source material and keeps rapid cloning separate from professional recording. | Published speed claims are not evidence that Vyakti can meet the same time on its current infrastructure. |
| Cartesia | Places voice creation close to the agent that will use it, reducing the gap between creating a voice and trying a conversation. | Its stack and capacity are not Vyakti's measured stack. |

Primary references:

- Fish Audio, [voice cloning best practices](https://docs.fish.audio/developer-guide/best-practices/voice-cloning)
- ElevenLabs, [instant voice cloning](https://elevenlabs.io/docs/eleven-creative/voices/voice-cloning/instant-voice-cloning)
- Resemble AI, [voice clone overview](https://docs.resemble.ai/voice-creation/voices/clone-overview)
- Cartesia, [clone voices](https://docs.cartesia.ai/build-with-cartesia/capability-guides/clone-voices) and [agent builder](https://docs.cartesia.ai/line/start-building/agent-builder)

## What was wrong in Vyakti

The microphone path required four product actions after the user had already chosen to record: start, stop, accept the recording as primary, and upload. The same wait could then appear in the rail, overview, toast, activity panel, and destination panel. Meet placed preview, a blind experiment, call, review, and advanced verification on one long mobile page.

Reload also remembered the broad step but not the exact clone or Meet task. An older clone could therefore become the visible selection after a refresh. Technical source identifiers were displayed as the main label even though the person only needed to know which recording drives the voice.

These are information-architecture defects. More copy cannot fix them.

## Binding journey

### Create

The default path has two intentional actions:

1. Start recording.
2. After at least 12 seconds, tap **Finish and build**.

The person may say anything naturally. Thirty seconds is recommended, not required. The browser checks duration, clipping, and whether enough of the sample is audible. A clean sample uploads privately, becomes the primary voice, and opens Meet automatically. A weak sample stops for one clear retake. It must never be accepted merely to keep the funnel moving.

Existing audio or video remains an alternative. Documents, images, chats, links, YouTube sources, and future channels are context, not competing primary actions.

### Wait

One in-flow status beacon owns the wait. It shows:

- the current server-backed phase;
- elapsed time;
- an observed range, when one exists;
- the next automatic check;
- a useful return time;
- whether work is waiting on the person or on Vyakti.

It never shows a fabricated completion percentage or a finish countdown. Technical receipts remain available under details.

### Meet

Meet is a task switcher, not a stacked dashboard:

- **Hear your voice** for protected preview;
- **Voice chat** for turn-by-turn conversation;
- **Review** for cited learning proposals, activity, blind evaluation, and advanced proof.

Only the selected task is mounted. The URL commits the exact clone, wizard step, and Meet task so reload, history navigation, and a copied link preserve the user's place.

### Improve

Additional sources strengthen separate layers:

- the starred recording drives voice identity;
- other audio and video can provide language, delivery, and owner-reviewed context;
- documents, chats, images, and links provide cited context when their extraction is supported;
- calls create short-lived observations and cited learning proposals;
- durable facts, relationships, persona changes, and voice changes require owner review and remain reversible.

The interface must never imply that every uploaded minute is used directly by the voice model. It should show what each source became and which layer can use it.

## Interaction and visual rules

- Light theme only for this product pass: warm paper, dark ink, forest action color, restrained borders.
- One primary action per state.
- At least 44 by 44 CSS pixels for phone actions.
- Optional work is behind disclosure, but the current required action is never hidden.
- Plain labels lead; internal IDs, hashes, models, and receipts live under technical details.
- Motion confirms state changes and respects reduced motion. It never makes a wait appear shorter.
- Consent remains a server-side authority and one clear owner action. It is not removed to reduce clicks.

## Measured implementation evidence

Method: deterministic focused suites plus real Chromium against the signed-in Studio fixture on 2026-08-30.

- Clean microphone path: two intentional product actions after entering Create.
- Phone preview: 13 of 13 checks passed at 375 CSS pixels.
- Exact clone and Meet task survive URL serialization.
- Only one Meet task is visible at a time.
- No horizontal overflow or console error was observed in the inspected desktop and phone states.

These checks prove interface behavior, not voice similarity, live GPU capacity, or five-user concurrency.

## Reversal conditions

Reconsider the two-action automatic path if measured recordings show that auto-submission materially lowers accepted voice similarity versus a bounded review step. Reconsider the three Meet tasks if moderated mobile testing shows that people cannot find call or review without extra help. Do not reverse the single status owner unless an alternative reduces missed recovery actions without duplicating or contradicting server state.
