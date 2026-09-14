# Mirror Call — the calibration call where the clone learns from its own human

Owner ask (2026-08-26, verbatim intent): "you are on a call with your clone and
while calling the clone starts to get better and learn from you on the go with
your feedback and by noticing the personality and voice."

This spec is the judgment layer for that ask. It exists so the build agents do
not have to re-derive how "learns on the go" coexists with the platform's laws.

## What a Mirror Call is

An authenticated studio session where the OWNER talks to their own clone,
voice-to-voice, and three loops run simultaneously:

1. **Voice-observation loop** — the owner's bounded call windows are stored as
   session-bound private evidence. They do not enter voice conditioning unless
   a server-side speaker-verification measurement proves the window is the
   owner and the clone was not speaking over it. No deployed producer supplies
   that owner-similarity measurement yet, so the current live path must label
   every window `unverified` and leave the standing voice reference unchanged.
   The call may record a voice-learning request at end, but no fine-tune runner
   is deployed. A queue receipt is therefore not a training or completion
   claim.
2. **Personality loop** — the owner's turns stream through ASR into the
   existing ingestion statistical pass (the same one that mines a TeacherSheet
   draft from a transcript). What it mines surfaces DURING the call as
   **proposed delta chips** ("you say 'basically' a lot — add to phrase
   habits?", "register reads warmer than the sheet — update?"). Tapping accept
   applies it; ignoring or rejecting discards it.
3. **Feedback loop** — explicit owner feedback, spoken or tapped: a thumbs
   down on a clone turn, "say it again but more chill", "I'd never phrase it
   that way — I'd say X". Each becomes a calibration item bound to the turn it
   judged, feeding the same delta-chip queue.

## The laws this must not break, and how it doesn't

- **Never silent self-update of a live persona** (SPEC-GURUKUL §8 item 3).
  The Mirror Call does not create an exception — it makes approval AMBIENT.
  Every learned delta is a proposed chip the owner accepts or rejects in the
  moment; nothing lands on the sheet without a tap. The owner being present
  and authenticated IS the approval channel, but presence alone is not
  approval — the tap is. Un-actioned chips at call end go to the ordinary
  review queue, not onto the sheet.
- **Consent scopes.** Call audio can become a reference candidate only under
  the replica's existing voice-consent scope, on an authenticated owner session,
  after a server-measured owner-voice verdict. A Mirror Call cannot be run
  against a replica the caller does not own. Internal self-test mode can remove
  the consent ceremony for an authenticated self replica; it does not remove
  ownership, provenance, disclosure, or watermark checks.
- **The audio floor.** `liveCall.ts` may import nothing beyond `./level` and
  `../engine/diag`, and echosim gates any change to it. The Mirror Call
  therefore builds AROUND the call engine, never into it: capture and
  learning hang off the call's existing seams (transcript events, turn
  boundaries), and if a seam is missing, it is added in the surrounding layer.
  Run echosim before/after if `liveCall.ts` is touched at all; prefer not
  touching it.
- **Recited-prompt / prompt-position.** Mined phrase habits land as shapes
  and notes on the sheet, never as quotable lines.
- **Fidelity honesty.** The live meter shows the measured ECAPA number against
  the printed self-vs-self ceiling, states it is speaker-embedding similarity,
  and never claims perceptual quality — the earbench owns ears.
- **No silent truncation.** If ASR lags or a window drops, the chip stream
  says so; a quiet learning loop that dropped its input looks identical to a
  clone with nothing to learn.

## Build shape (WS-X)

- `api/mirror-call.js` — session orchestration: create/end a calibration
  session bound to (owner, replica); wake and probe the signed private voice
  runtime; ingest owner-turn audio chunks through session-bound private source
  handles (≤30s windows → configured live ASR); return cited phrase/slang
  proposals; record accept/reject; and record the exact reason a window cannot
  enter voice conditioning. The source handle lane is intentionally separate
  from the eight-step enrollment DAG.
- Delta mining reuses `api/_teachersheet.js`'s statistical pass on the rolling
  transcript — call-scoped, incremental, cited to the turns that produced it.
- Studio UI: a Call tab — connect, talk, live captions, the fidelity meter,
  the delta-chip rail, per-turn 👍/👎 with "I'd say it like this" re-record.
- Clone speech: synthesis through the existing admission broker (WS-W's route
  is the seam); cascade lane (ASR → engine → TTS), not full-duplex — the
  research already pinned that decision (`ROADMAP-100X.md` §Voice).
  **Built by WS-AC** (2026-08-26). `api/_mirrorcall-reply.js` is the engine
  half: `sheetToModule` over the owner's own sheet → `engine.compile` →
  `gatedReply`, with no fallback persona and a named `turn_absent_reason` for
  every way it can decline. `api/mirror-call.js`'s `opTurnVoice` is the TTS
  half and calls WS-W's `handleVoicePreviewPanel` unchanged, so the HMAC,
  the audible disclosure prefix, the watermark, the ledger and the 202-warming
  contract are the SAME code and not a second copy. `vy_mirror_turn`
  (migration 060) binds the two: `turn_voice` synthesises the text in the row,
  never the text in its query string. Where the replica has no published sheet
  the DRAFT one answers and `sheet_source` says so on every payload — an owner
  who cannot tell a published clone from a draft one cannot judge either.
- Everything gated: offline eval for the session state machine, delta
  proposal/approval (with a negative control proving an unapproved delta
  never lands), consent refusal, and the reference-set growth arithmetic.

## What "gets better on the go" honestly means in the current deployment

Within one call, the system can transcribe owner windows, preserve their source
citations, suggest phrase/slang patterns, show advisory delivery observations,
and apply only the proposals the owner explicitly accepts. It can use accepted
feedback on subsequent reply assembly where the existing sheet path supports
that field. It does not yet change the voice reference, run a fine-tune, write
searchable relational memory, infer human traits, or store a durable emotion
profile from the call. Those capabilities require their own measured producers,
review surfaces, retention rules, and rollback gates. A future implementation
must compile immutable call events into reviewable candidates; it must not train
or rewrite the persona on the hot path.
