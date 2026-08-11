# Decisions

Each entry says what was decided, why, and **what would reverse it**. A decision
without a reversal condition outlives its reason.

---

## `brain-model` — her brain stays on `google/gemini-3.6-flash`

Two credit-funded candidates were evaluated properly and both were declined.

- **grok-4-20-non-reasoning lost 38–2** on blind, counterbalanced charm judging
  across 48 conversations. Warmth 35–3, humour 31–2, personhood 34–4. It also
  ran 36.1 words/turn against 20.5 (≈13.9 s spoken, worse than the 12.3 s we had
  just cut down from), with 63% of turns ending in a question.
- **gpt-5.6-luna tied** (17–18, p=1.00) and *won* specificity 9–25 (p=0.009),
  but used the photo/gif/voicenote tags **zero times in 144 replies** against the
  incumbent's 11 — a loved feature switching itself off.

**The inference that matters:** an earlier reading of the luna tie suggested the
47k persona did all the work and model choice barely affected charm. Grok
disproved it — same prompt, same beats, same judge, 38–2. **The prompt sets a
ceiling; the model decides how close you get.** Fast, cached, credit-funded and
excellent at vision predicts nothing about whether she survives on it.

**Reverses if:** a candidate wins or ties blind charm judging AND keeps the media
tags AND holds ≤20.5 words/turn. Cost is not a reason — see `cost-per-turn`.

---

## `voice-model` — her voice stays on Gemini TTS

Rejected Azure by ear despite better numbers on every measured axis. See
`rejected.md#azure-tts`. **Reverses if:** a candidate is judged by ear to sound
like an Indian woman in her twenties, tested on her real register lines.

---

## `vision-model` — screen share should move to `grok-4-20-non-reasoning`

**Recommended, not yet wired.** 0 fabrications in 32 assertions against luna's 1,
terra's 2 and maverick's 3; reads a chat thread completely and correctly where
both OpenAI models read a third and invented the rest; **428 ms median** against
the incumbent's 2,136 ms (≈4 frames behind at our 600 ms cadence); **288 image
tokens against 1,078**; credit-funded.

**Conditional on `grok-quiet`:** it returned `NO_COMMENT` on 15 of 16 frames.
That is our directive's gate, not model reticence — but when pushed to engage it
fabricated on a small probe. Retune the directive, then re-measure fabrication.
Do not ship on n=6.

**Reverses if:** engagement cannot be raised without fabrication rising with it.

---

## `extract-model` — memory extraction uses `grok-4-1-fast-reasoning` (live)

Deciding what is worth remembering, and which of two contradictory things is now
true, is judgement work — and nobody waits on it, so the +3.3–4.6 s that
disqualifies reasoning for speech costs nothing. Azure first (credits, better
model), OpenRouter as fallback: a bad Azure minute must cost a slower
extraction, never a lost memory. Azure returned `DeploymentNotFound` on 7.5% of
40 calls in a separate battery, so the fallback is a measured need.

**Reverses if:** extraction quality measurably drops, or the fallback proves
unreliable under real load.

---

## `reasoning-live` — reasoning is banned from her live replies

See `reasoning-split`. Three grounds: +3.3–4.6 s to first spoken token; the
failure concentrates on heavy beats where duty of care is highest; and helpline
over-triggering at 16.7% vs 0%, once immediately before the user clarified he
was not talking about self-harm.

**Beat-routing was considered and rejected:** you must classify *before*
generating, and a misclassification puts reasoning on the crisis turn — exactly
the case being routed away from.

**Much of the light-beat gain is promptable anyway** — the baselines ask 1.67
questions/turn against a stated one-in-three ceiling and write 29-word bubbles
in a 15-word lane. Fixing that captures the gain at zero latency.

**Reverses if:** first-token latency with reasoning drops under ~1 s AND the
heavy-beat regression is shown to be fixed.

---

## `light-only` — the app is light-themed, unconditionally (2026-08-11)

An OS-following dark theme shipped and was removed the same day at the owner's
request: *"the ui should be light theme, this dark theme can be avoided. previous
light theme was fine."*

Removed rather than made a toggle, because a toggle is state that can get stuck
and a preference the user has to find. One look, always.

**Reverses if:** the owner asks for night reading. The palette below is the one
that was built — a warm-dark room rather than an inversion, her bubble lifted
off the ground instead of punched into it, the accent brightened to hold 5.2:1
on the ground with a deeper one carrying white text inside the bubble. Choosing
these was the expensive part; re-deriving them would be waste.

```css
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #15100f;
    --surface: #1e1817;
    --surface-2: #2a2321;
    --surface-3: #362d2b;
    --ink: #f4eeea;
    --ink-dim: #a99e98;
    --ink-faint: #7d726d;
    --accent: #e0596e;
    --accent-deep: #ef7085;
    --accent-soft: rgba(224, 89, 110, 0.16);
    --accent-warm: #f2895f;
    --bubble-me: #b03a4c;   /* white on it 5.91:1 */
    --tick-read: #a9e9ff;
    --ok: #45c96c;
    --danger: #ff6b5a;
    --hairline: rgba(255, 240, 235, 0.09);
    --hairline-strong: rgba(255, 240, 235, 0.17);
    --scrim: rgba(0, 0, 0, 0.58);
    --chrome: rgba(28, 22, 21, 0.82);
    --shadow-card: 0 1px 2px rgba(0, 0, 0, 0.3), 0 8px 24px -12px rgba(0, 0, 0, 0.6);
    --shadow-float: 0 12px 40px -12px rgba(0, 0, 0, 0.75);
  }
}
```

Bring back `index.html`'s media-scoped `theme-color` pair at the same time, or
the browser chrome sits dark above a light app.

**A trap worth recording:** the first attempt COMMENTED the block out. The
palette contains its own inline comments, and a nested `*/` closes the wrapper
early — which left half a dark theme live in the stylesheet and passing every
build. Commenting out CSS that contains comments does not work.

## Standing constraints that shape everything

- `credits-partner` — Microsoft for Startups credits cover only models **sold
  and billed directly by Azure**. Anthropic and Hugging Face are excluded
  outright; Meta, Mistral and Cohere are "(select models)". **With a card on
  file, an ineligible model bills the card rather than failing.**
- `cache-9x` — prompt caching matters ~9× more than sticker price on our
  workload. A model 5× cheaper per token with no prefix cache costs us *more*.
- `silent-truncation` — prompt truncation is silent and eats the END, where the
  newest and most safety-relevant text sits. It has already cost the crisis
  helplines once. `scripts/check-prompt-budget.mjs` is the guard.
- `prompt-position` — a rule buried mid-brief fired 0/8; the identical rule
  appended last fired 8/8.

---

## `scene-hold-800` — the landing hold is capped at 800 ms, not 4000 (2026-08-11)

The hold before she reacts to a settled screen is `HOLD_MULTIPLIER x that
person's own landing rhythm`, bounded by `HOLD_REPLACE_MAX`. At 4000 the bound
did not bind, so **the slower someone moved between screens the longer she made
them wait on each landing** — backwards for the one lane that is the deliberate
"dekh yeh". It was also silencing stops outright: a 4080 ms hold demands 4000 ms
of stillness, the screen moved on at 3720 ms, nothing fired.

See `wake-hold-curve`. Stop → her voice p50 2.66 s → 1.70 s, and 215/300 stops
get a reaction instead of 180, with fabrication flat.

It lands at 800 rather than the 260 floor for a reason worth keeping: a show
wake may only ride behind a frame captured while the screen was HELD, and a
still-settling screen has moving cells, so it is not held. That was checked
directly down to a 120 ms hold — the picture she answered on was captured after
the arrest every time, minimum lead 120 ms. But the margin is one detect tick,
and replayed sessions settle in one tick where a real fling does not.

`scene.ts` and `SceneReader.java` are twins; the constant is measured in the
TypeScript harness, so both move together or the Android lane silently keeps the
old behaviour.

**Reverses if:** fabrication rises on the landing lane, or she speaks during
flick-storm glances. If she is merely heard getting chatty while browsing, 3000
is the conservative fallback and buys about half the win.
