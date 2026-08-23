# Architecture — and which model serves which lane

Every model in the product, where it runs, and who pays. Keep this current: it
is the first thing anyone asks and the easiest thing to get quietly wrong.

## Model map (as of 2026-08-11)

| lane | model | provider | paid by | code |
|---|---|---|---|---|
| **chat brain** | `google/gemini-3.6-flash` | OpenRouter | cash | `api/chat.js`, `brain.ts` |
| **call brain** (cascade) | `google/gemini-3.6-flash` | OpenRouter | cash | same, `max_tokens: 400` |
| **live voice** (primary call) | `models/gemini-3.1-flash-live-preview` | Google direct | free tier | `api/live-token.js`, `liveCall.ts` |
| **screen share / vision** | `google/gemini-3.6-flash` | OpenRouter | cash | via `api/chat.js` |
| **TTS** (fallback voice) | `google/gemini-3.1-flash-tts-preview` | OpenRouter | cash | `api/speech.js` |
| **memory extraction** | `grok-4-1-fast-reasoning` | **Azure** | **credits** | `api/memory.js` |
| ↳ its fallback | `google/gemini-3.1-flash-lite` | OpenRouter | cash | same |
| **web search** | `google/gemini-3.6-flash` | OpenRouter | cash | `api/search.js` |
| **culture index** (daily job) | `google/gemini-3.6-flash` | OpenRouter | cash | `api/culture.js` |
| **photo description** | `google/gemini-3.1-flash-lite` | OpenRouter | cash | `api/memory.js` |
| user-key alternatives | `claude-opus-5`, ElevenLabs, Sarvam | direct | user | `brain.ts`, `speech.ts` |

**Deployed on Azure but NOT yet wired:**
`text-embedding-3-small` (for `semantic-recall`), `grok-4-20-non-reasoning`
(recommended for vision — see `decisions.md#vision-model`), `gpt-5.6-luna`,
`gpt-5.6-terra`, `grok-4.3`, `grok-4-20-reasoning`, `grok-4-1-fast-non-reasoning`,
`gpt-4o-mini-tts`.

**Azure resource:** East US 2. Endpoint and key in `api/_config.js` (gitignored).

**Why OpenRouter is still here:** her current brain and live voice are Google
models, which are **not on Azure Foundry at all**. Web search has no drop-in
equivalent on Azure either — Bing grounding exists but only inside the Agent
Service, a different API shape. OpenRouter is also kept deliberately as a
fallback: if Azure quota 429s mid-conversation she would otherwise go mute.

---

## Components

### `persona` — `src/engine/persona.ts` (~45k chars)
The product. Assembled per lane: `buildSystemPromptParts(user, count, medium)`
plus `buildSpeechStyle(engine)` on calls. `SEARCH_DECISION` and
`FORGET_DECISION` are appended **last** by `brain.ts` — position is mechanism
(see `decisions.md`). Protected by 138 invariant checks.

### `inner` — `src/engine/inner.ts`
Her interiority. One carried feeling ("thread") fused with its cause, retiring
once voiced; up to 3 wants; a stored `TASTE` table consulted deterministically;
and `weekShape()`, a mood arc that is a pure function of the clock (zero state,
so it can never accumulate into a sad period and never reads the user).

Taste is **pull-only**: `tasteNote(whatTheyJustSaid)` returns "" on most turns.
Suppressed on `watch` and on any turn she initiated.

### `audio-floor` — `src/voice/liveCall.ts` + `LiveWatchEngine.java` (twins)
The most delicate code here. Hold-ring, echo coefficient κ with an r²-gated
slope estimator, LISTEN vs BARGE bars, boundary-seeking fade, `genInFlight`
watchdog. **Load-bearing:** the silence heartbeat (`SILENCE_ENDPOINT_MS 700`,
`SILENCE_KEEP 3`) — silence is never shed to nothing or the server VAD stalls
and she never answers at all.

A simulator at `scratchpad/echosim/` drives the real file through a room impulse
response. Run it before and after any change here.

### `memory-graph` — `api/memory.js` + `meera_nodes`/`meera_edges`/`meera_log`
Ops: `log`, `recall`, `remember`, `forget`, `upload_photo`, `describe`.
**Forgetting is a hard delete** — no `deleted_at`, nothing for recall to filter.
The single exception is `meera_forget`, which stores the *word* so the extractor
cannot re-derive a forgotten fact from the client's own transcript.

### `scene` — `src/watch/scene.ts` + `SceneReader.java`
Pure geometry. Wakes on the **hold**, not the change ("dekh yeh" is the arrest
of movement). Show classes `settle`/`reshow`/`point` vs ambient
`start`/`along`/`idle`, with suppressors for scroll-as-translation, notification
overlays, video-vs-page and FLAG_SECURE blackouts.

### Data
Neon Postgres over SQL-over-HTTP (`api/_db.js`), schema in `db/schema.sql`.
Supabase for auth and photo storage only. `meera_diag` is the audit trail —
fail-soft by design, which is why `verify-release.mjs` probes it deliberately.

### `sound` — `src/sound/` (vocabulary + synth + one gated engine)
The app's second audio subsystem, and it is deliberately unable to reach the
first. `vocabulary.ts` is pure data: the closed cue set, each cue's haptic
level, mix and span, plus a `REFUSED` table of sounds decided against with the
argument next to each. `synth.ts` builds every cue from oscillators and shaped
noise (zero assets) and decides nothing. `index.ts` owns the single
`AudioContext` (built inside the first user gesture, `latencyHint:
"interactive"`), the master bus, and the only call into the synth in the
codebase — downstream of four gates: gesture, the `soundOn` toggle, the call
(read from BOTH `state/callStatus.ts` and a flag `Chat.tsx` publishes from
`inCall`), and page visibility. `feel(cue)` fires the cue and its haptic level
together so no call site picks an intensity.

Call sites: `Chat.tsx` (send, and ONE arrival per delivery), `ChessBoard.tsx`
and `TicTacToeBoard.tsx` (his move against his finger, hers when it lands),
`Celebration.tsx` (the moment), `MoreSheet.tsx` (the switch previews itself).
It imports nothing from `src/voice/` and the call's ringback is untouched:
anything emitted during a call would land in the echo coefficient
`evals/echosim/` measures the audio floor against. Gated by `evals/sound.mjs`
(in `run.mjs`, with its own negative control) and proved in a real browser by
`evals/sound-browser.mjs`.

### `movevoice` — one being, one timeline (the board's clock and her voice)
The hand and the mouth were separate agents; this is the seam that joins them.

`src/state/game.ts` owns the CLOCK. `THINK_BANDS` + `chessThinkMs`/`tttThinkMs`
are the held beat before her move lands — pure, deterministic on (position,
session seed), bounded [`THINK_FLOOR_MS`, `THINK_CEIL_MS`] = [300ms, 7s], with
bands for book/opening/middlegame/endgame/forced and modifiers for check,
recapture and position width. `turnPhase` is the choreography state; `gamePly`
is the staleness stamp; `noteVerdict` is the send seam's whole decision
(`send` / `stale` / `hold`). All of it pure, so `evals/movevoice.mjs` reaches
every branch without a browser.

`src/engine/chessTalk.ts` + `tttTalk.ts` own the TENSE. `settledClause` /
`tttSettledClause` state the CHOICE as closed; `chessMoveNote` / `tttMoveNote`
compose the move facts with it, so no call site can send one without the other.

`src/components/ChessActivity.tsx` and `TicTacToeActivity.tsx` hold her move for
the table's beat before committing it. The presence row already reads "thinking"
for exactly that window off `her.phase` — an existing idiom, not new UI.

`src/components/useCallEngine.ts`'s poke is the only consumer on the live lane:
it drafts a note, stamps it with the ply, and routes it through `sendGameNote`,
which asks `noteVerdict` at the last instant this file controls. `pokedPly`
advances only on a committed send, so a held note stays owed.

Gated by `evals/movevoice.mjs` (in `run.mjs`; offline, $0, carries the owner's
case as a fixture and its own negative control) and measured in a real browser
by `evals/movevoice-browser.mjs`, which times every one of her turns in a full
game against the same table the component reads.
