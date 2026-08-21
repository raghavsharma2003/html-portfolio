# Conversation defects — the register, and which layer owns each

A living register of defects felt in real use, each assigned to the layer that
must fix it. It exists because the owner's standing instruction is that a fix
belongs at the **fundamental** layer whenever a second personality on a second
surface would otherwise inherit the same defect — and that the ones which are
genuinely surface-local get written down here, so WhatsApp, Discord and
Telegram arrive knowing what the web app already learned.

Three layers, and the test for which one owns a defect:

| layer | owns | test |
|---|---|---|
| **RELATIONAL OS** | `src/engine/*`, the `vy_*` schema, the compiler, the gates | would a *different personality* on a *different surface* have this bug? |
| **SURFACE** | `Chat.tsx`, `useCallEngine.ts`, `api/_surface.js`, the adapters | is it about turn-taking, delivery, or transport? |
| **INFRA** | keys, quota, schedules, deploys | is the code correct and the environment wrong? |

An infra defect is worth naming separately because it is the one class where
changing the code is the wrong move — and two of the ten below are that class.

---

## The synthesis: four of these are one defect

Reports 1, 2, 9 and much of 7 are not four problems. They are one, and it is
measured: **`nine-dark-tail-slots`.** A real production compile on 2026-08-20
renders

```
T1 0b  T2 0b  T3 0b  T4 0b  T5 1,895b  T6 0b  T7 609b
T8 0b  T9 0b  T10 1,280b  T11 220b  T12 0b  T13 0b
```

Nine of thirteen tail slots are empty. That is her carried interior (T1), the
entire relational snapshot (T2/T3/T4/T6), and two thirds of the self layer
(T12/T13).

So when the owner reports that she repeats herself, does not notice he was gone
overnight, is not interesting, and fills gaps with things he never said — she
has **nothing to draw on**. The engine that would supply continuity, callbacks,
texture and her own interior is delivering zero bytes. Improvising over that
hole is the only thing left, and improvisation over a hole is exactly what
reads as making things up.

This matters for triage: fixing repetition with a prompt rule would be treating
the symptom of an empty table. `never-scheduled` was the binding constraint
and it was closed on 2026-08-21 by fast-forwarding `main` — the first time
`consolidate`, `culture` and `drift` have ever been registered with GitHub.

---

## The register

### 1 — She does not notice he was gone overnight
**Layer: RELATIONAL OS.** Not missing, dark. `timeline.ts` already computes
what has moved in his world since they last spoke, and the compiler already
carries `gapSinceLastMs` — but it is consumed **only** when `relBundle` is
present, and `vy_rel_state` has zero rows for every real user
(`relstate-zero-rows`, `selflayer-rows-zero`). So the greeting logic is
correct code with no data.
**Status:** unblocked, not fixed. Needs rel-state rows, which needs
consolidation to actually run. Verify by re-reading the slot bytes from the
trace after the first successful nightly run.

### 2 — She repeats the same thing, will not move on
**Layer: RELATIONAL OS.** There is no anti-repetition mechanism anywhere in
the engine. The precedent to copy already exists one module over:
`vy_agent_life_told` is rendered as an **anti-join** so she never re-narrates a
life beat she has already told. The same shape applied to topics is the fix.
The owner's refinement — that it must *modulate* rather than switch off, and
modulate on how he is responding — is a second, harder half and should be
built as a decayed weight, not a boolean.
**Do not** fix this with a persona sentence. `recited-prompt`.

### 3 — Multiple messages should be understood together, dynamically
**Layer: SURFACE (mechanism) + RELATIONAL OS (policy).** The mechanism exists
and its intent is already right: a burst wait, supersede anything in flight,
re-read the whole burst, reply once. It was never observed working because of
defect 4.
The **fixed 1300 ms** wait is the part that is wrong. The repo has already
solved this exact shape once, on the watch lane: `scene-hold-800` bounds the
hold at `HOLD_MULTIPLIER × that person's own rhythm` rather than a constant,
and the measurement showed a constant made slow people wait longer the slower
they were. A burst window should be derived from his own inter-message gap the
same way.
**Where it must not live:** in the adapter. Every surface will need it, so the
policy belongs in the engine and only the timer belongs in the surface.

### 4 — Multiple messages → she stops replying entirely
**Layer: SURFACE. FIXED 2026-08-21 (`d84000c`).**
`replyCycle` takes `busy` at the top and releases it in `deliver()`. The
superseded branch — the one that exists *for* bursts — recurses without
reaching `deliver()`, so `busy` was still held and the recursive call returned
at its own guard. Silently and **permanently**: the flag was never lowered
again, so every later reply died at the same guard and the chat was dead until
reload. The branch written to serve the burst was the only branch that could
not.

### 5 — "net dikkat kar rha lagta h, abhi aati hu", constantly
**Layer: INFRA. The code is correct and must not be changed.**
`brain.ts:1029` fires only when **every** brain is unreachable, and it is
deliberately honest rather than faking conversation. She is telling the truth.
The cause is `one-key-two-jobs` + `both-lanes-dry`: OpenRouter is hard-exhausted
(`limit 25, usage 25.021` — a total cap, not a daily one) and the free Google
pool has a measured ceiling of ~75 calls/day shared with every eval run.
**Fix:** separate research and production credentials (#89). Editing the
fallback text would only make the product lie about being down.

### 6 — She sends "— "
**Layer: RELATIONAL OS. FIXED 2026-08-21 for the text lane (`d84000c`).**
`persona.ts:148` already banned it and she did it anyway — `honesty-by-
instruction`, and `gate0-structural` measured why: instructions leak 57–98%,
a predicate leaked 0 of 31,122. So `persona.ts` is byte-unchanged and the ban
is now a predicate at the `gate()` choke point.
**Text lane only, deliberately:** three persona rules require dashing on a
call, and `device-says-arrow-not-dash` measured espeak reading the em-dash as a
**pause**, not a word — prosody, not a tell.
**Still open:** the live speech-to-speech lane, where no sanitiser can stand
because the model emits the characters it speaks (#97), and every non-web
surface (see the contract below).

### 7 — She made up things about him
**Layer: RELATIONAL OS. PARTLY FIXED 2026-08-21 — the attribution slice.**

A third honesty family now ships beside invented identifiers and false
receipts: **`false-attribution`**. When she says *"tune bola tha ki X"* she is
not inferring, she is quoting — and a quote is a claim about the record, which
is right there. An attributed claim whose content words are largely absent from
his own messages is not paraphrase, it is authorship.

Two calibrations the eval forced, neither guessable:
- **"any overlap counts as paraphrase" is too weak.** One shared Hinglish
  grammar word rescued an entirely invented claim, because his ordinary
  *"thak gaya hu"* and her fabricated *"interview clear ho gaya"* both contain
  *gaya*. It is a SHARE now (`SUPPORT_SHARE`), not a boolean.
- **The marker's own words are not the claim.** Counting them gave every bare
  fragment (*"tune bola tha na"*) two free unsupported tokens and flagged
  ordinary filler.

Fail-closed: no `hisVocab` means the family does not run, so an un-updated
caller gains no false positives. The replacement asserts only about HER
understanding — it never accuses him of not having said it.

**Still open, and this is the larger half:** claims about him that carry no
attribution at all. She may still be wrong about him; she may no longer say he
told her so. The general case remains undecidable, and a rule that tried would
gut the inference and teasing that are the product.
The honesty gate shipped on 2026-08-20 covers two families — invented
identifiers and false receipt claims — and this is a **third** it does not
cover: fabricated user-facts, asserted to facilitate conversation.
Partly this is the dark-slots hole (nothing real to reference, so she invents).
Partly it needs the same treatment the other two families got: a provenance
predicate, where a claim about *him* with no support in the transcript and no
cited fact behind it is invented. It is materially harder than the identifier
case, because legitimate paraphrase and inference are the product, and a naive
rule would gut her.
**Do not ship this on a prompt rule.** That has now failed twice on this exact
axis.

### 8 — The conversation stream dies mid-flow
**Layer: probably INFRA, possibly SURFACE — and now measurable.**
Most likely the same upstream exhaustion as defect 5, hitting mid-stream rather
than before the first token. This is precisely what the seven-leg turn trace
shipped for: a dying stream leaves a spine row with legs missing, and
`scripts/trace.mjs --turn` will say which leg. **Diagnose from a real trace row
before changing anything** — the last two times this class was reasoned about
instead of probed, the diagnosis was wrong twice.

### 9 — Not interesting, repeats, no depth
**Layer: RELATIONAL OS.** See the synthesis. Her interior, taste, callbacks and
texture are the four things that make a conversation feel like it has a person
behind it, and all four render zero bytes today. Treat any persona-level
"be more interesting" edit as forbidden until the slots carry bytes — otherwise
it is a prompt patch over an empty table, and `recited-prompt` says what
sentence-shaped patches do.

### 10 — Call: first-turn latency, a stuck listening loop, mid-sentence aborts under noise
**Layer: RELATIONAL OS (the audio floor is engine, not surface).**
Three distinct things reported as one, and they need separating before any
change:
- **first-turn latency** — `live-floor` measured 720 ms of untouchable prefill
  inside a ~1,370 ms floor. The available win is in *variance*, not median
  (`speech-stack` decision 4: target p90 at today's p50).
- **the stuck listening loop** — she never takes the floor back. Suspect the
  `genInFlight` watchdog and the silence heartbeat, which is load-bearing:
  `SILENCE_ENDPOINT_MS 700` / `SILENCE_KEEP 3` exist because silence shed to
  nothing stalls the server VAD and she never answers at all.
- **mid-sentence aborts under noise** — the barge-in arbiter is **level-based**
  by design (`speaker-id`: +16 dB near-field test), so at his coupling a noisy
  room is not separable from him speaking. `speaker-id` explains why the
  obvious fix is refused, and names the asymmetry: "someone else can take the
  floor" is an annoyance, "she stopped answering me" ends the product.
**Method is not optional here.** `liveCall.ts` may import nothing beyond
`./level` and `../engine/diag`, and `evals/echosim/` must be run before and
after with the tables diffed. It is the only thing that can prove the floor did
not move.

---

## The surface contract — what every new surface must implement

This is the part that must not be re-learned per surface. Verified against
`api/_surface.js` on 2026-08-21.

**`api/_surface.js` has its own `think()` that returns the model's raw string
and never calls `parseBubbles`.** Everything `parseBubbles` and `gate()` do is
therefore absent on Telegram today, and would be absent on Discord and
WhatsApp built the same way:

| guarantee | web/app | Telegram + future surfaces |
|---|---|---|
| honesty gate (invented identifiers, false receipts) | yes | **no** |
| texting dash predicate | yes | **no** |
| protocol extraction (`[gif:]`, `[voicenote:]`, `[search:]`) | yes | **no** — a marker goes out as literal text |
| bubble splitting and the 4-bubble cap | yes | **no** |
| crisis-line preservation under sanitising | yes | untested |

The rule this yields, and it is the generalisable one: **a surface may choose
how bytes reach the wire; it may not choose whether the engine's guarantees
apply.** The fix is not to copy the gates into each adapter — that is
`age-tier-never-realtime` waiting to happen, where a second assembler silently
misses every rule added after the fork. It is for `_surface.js:think()` to
return through the same parse-and-gate path the web lane uses, and for a test
to assert that every surface's outbound text passed through it.

Until that lands, no surface should be treated as carrying the honesty
guarantees, and this document is the reason nobody has to rediscover why.

---

## How to add to this register

One entry per felt defect, with a layer assignment and the evidence that
assigns it. A defect with no layer is a complaint; a layer with no evidence is
a guess. If the diagnosis is a hypothesis, say so in the entry — defect 8 is
written that way on purpose, because this session got two diagnoses wrong by
reasoning where it should have probed.
