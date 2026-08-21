# Design standards — the rules, and which ones a machine can hold

The owner asked for four skills to be applied to this app's design: Apple's
interaction principles, `impeccable`'s anti-patterns, a taste skill, and the
animation build/review pair. This file records what they actually say, because
a fetched URL is not a standard — the next session cannot re-derive a rule it
never saw, and `logged-but-unindexed` is this repo's own name for knowledge that
exists and is unreachable.

Sources, fetched 2026-08-21:
`emilkowalski/skills` — `apple-design`, `animate`, `review-animations`;
`pbakaus/impeccable`; `Leonxlnx/taste-skill`.

---

## 1. What is MECHANISED

`scripts/check-motion.mjs`, wired into `verify-release` (11 gates now). It
enforces only the auto-blocks — the failures that are wrong regardless of what
is being animated:

| rule | why |
|---|---|
| no `transition: all` | animates properties nobody chose, including ones added later by someone else |
| no `scale(0)` entrance | a thing growing from nothing has no size to grow FROM; it pops rather than arrives. 0.9–0.97 |
| no bare `ease-in` on UI | it delays the first movement, which is the moment attention is highest |
| no layout-property animation | `width`/`height`/`margin`/`padding`/`top`/`left` cost layout every frame |
| UI transitions ≤ 300ms | responsive beats polished; over budget needs a reason |
| `@keyframes` ⇒ a `prefers-reduced-motion` answer | reduced motion means gentler, never absent |

**Exceptions are written next to the code**, as `motion-lint: allow <reason>`,
and the reason is not optional — an allow with no reason is how a checklist rots
into a formality. Three exist today, all on ambient motion rather than feedback:
the 7px onboarding dot (a pill cannot widen from a circle via transform), and
her presence glow's hue and bloom, which breathe at 400ms and 600ms because a
300ms version would strobe every time she starts and stops speaking.

Negative-tested: five injected violations, one per rule, all caught.

## 2. What is NOT mechanised, and cannot be

The lint has no taste and does not claim any. It cannot tell you the board's
browns are wrong against a warm-rose accent, or that a transition feels
sluggish. Everything below is judgment, and it belongs to eyes.

### From `apple-design` — the throughline is interruptibility

- **Animate from the PRESENTATION value, never the target.** On interrupt, read
  the live on-screen transform and start from there. Starting from the logical
  value causes a visible jump.
- **Never lock input during a transition.** Every animation should be graspable
  and reversible mid-flight.
- **Springs for anything the user can touch.** Damping `1.0` (no overshoot) by
  default; bounce (~`0.8`) ONLY when the gesture itself carried momentum — a
  flick or a throw. Overshoot on a faded-in menu is wrong; on a flicked card it
  is right. Apple's own values: move `1.0/0.4`, rotate `0.8/0.4`, drawer
  `0.8/0.3`.
- **Velocity handoff.** A gesture that ends must hand its release velocity to
  the animation, or there is a visible seam.
- **Momentum projection.** Do not snap to the nearest boundary from the release
  point; project where the flick was going (`v/1000 · d/(1−d)`, `d ≈ 0.998`) and
  snap to the target nearest that.
- **Respond on `pointerdown`, not release.** Feedback is continuous during the
  interaction, not only at its end.
- **Respect the grab offset** — a piece dragged from its edge stays offset, it
  does not snap to centre.
- **Rubber-band at boundaries.** A hard stop reads as frozen.
- **Spatial consistency.** What enters one way exits the same way; anchor
  popovers to their trigger via `transform-origin`.
- **Typography:** tracking is size-specific — tighten large text (≈`-0.02em`),
  body near `0`. A single `letter-spacing` for all sizes is wrong somewhere.

### From `impeccable` — anti-patterns

No overused fonts (Arial, Inter, system defaults as a *choice*). No gray text on
coloured backgrounds. No pure black or gray — always tinted. No cards inside
cards. **No bounce/elastic easing as decoration.**

> **The one real conflict, and how it is resolved here.** `impeccable` says
> bounce feels dated; `apple-design` prescribes bounce when a gesture carried
> momentum. Both are right about different things. The rule this repo takes:
> **bounce is earned by momentum, never applied as decoration.** A flicked piece
> may overshoot. A menu fading in may not.

### From the taste skill

Three dials — design variance, motion intensity, visual density — set
deliberately rather than by default. Layout strength, typographic clarity,
purposeful motion, intentional spacing. Plus a hard em-dash ban in UI copy,
which this repo independently arrived at for her texting register and enforces
as a predicate (`stripTextingDashes`).

### From `animate` — the gate before building

**Frequency decides eligibility.** 100+ daily uses (keyboard shortcuts): no
animation at all. Tens daily (hover, nav): near-imperceptible only. Occasional
(modals, drawers): standard. Rare or first-run: a delight budget applies.

**Name the purpose or reject the request** — feedback, spatial consistency,
state indication, preventing a jarring shift, explanation, or delight. *"It
looks cool"* fails the gate.

**Cheapest tool first:** CSS transition → `@starting-style` → CSS animation →
WAAPI → a motion library. CSS animation runs off the main thread; JS drops
frames during load.

**Curves:** entrance/exit `ease-out`; on-screen movement `ease-in-out`; hover
and colour `ease`; constant motion `linear`. This app's tokens already encode
these (`--ease-out`, `--ease-in-out`) and nothing should invent a curve.

**Durations:** button feedback 100–160ms, tooltips 125–200ms, dropdowns
150–250ms, modals/drawers 200–500ms. This app's `--d-press` 140ms, `--d-tap`
180ms, `--d-state` 220ms sit inside that.

**Stagger grouped entrances 30–80ms** rather than firing them together.

---

## 3. How this applies to the games work

- The board is **touch-first**, so every rule about direct manipulation binds:
  1:1 tracking, grab offset respected, drop resolved on the square under the
  pointer, an illegal drop walking the piece home rather than teleporting it.
- A piece moving is **on-screen movement**, so `--ease-in-out`, not `ease-out`.
- A capture is **feedback for a deliberate act**, so it may be felt.
- Her thinking is **ambient**, so it breathes rather than blinks — and it is the
  one place a >300ms duration is defensible, on the same grounds as her presence
  glow.
- The board must never animate `width`/`height`; it sizes to its container and
  moves pieces with `transform`.
