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
