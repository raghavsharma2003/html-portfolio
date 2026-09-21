# DESIGN LAW — the binding UI/UX standard for every surface

Owner directive, 2026-08-26: "revamp the whole ui and product design, and there
is also so much nonsense written on it", pointing at two external skills as the
standard to build against:

- Apple-design engineering discipline (emilkowalski/skills, `apple-design`)
- Taste / anti-slop frontend discipline (Leonxlnx/taste-skill)

This file is the distilled, binding version for THIS product. Where it and a
prior UI decision disagree, this wins. Where it and a SAFETY law disagree
(disclosure prefix, consent gates, honest states, never-silent-update), the
safety law wins and the design bends around it.

**Scope note.** The taste-skill's layout chapter targets landing pages and
explicitly excludes dashboards and multi-step forms; the studio IS a multi-step
form. So: its COPY bans, AI-tell bans, contrast rules and motion rules apply
EVERYWHERE without exception. Its hero/section-composition rules apply to
`site/` (the landing). The Apple-design discipline applies everywhere,
especially in the studio, because it is about how an interface FEELS under the
hand rather than how a page is composed.

---

## 1. The copy purge — this is the "nonsense written on it" fix

**The em-dash is banned outright.** No `—`, no `–`, anywhere a user can read it:
headings, labels, buttons, chips, captions, empty states, error text, tooltips,
receipts. Restructure with a period, comma, colon, parentheses or a line break.
The house prose in `context/` and code comments is UNAFFECTED — this is a
user-visible-string rule. WS-AA counted 73 in `src/studio/` alone; they all go.

Also banned in user-visible strings:

- Version stamps and build labels: `v1.4.2`, `BETA`, `Build 0048`, `last sync 4s ago`.
- Section-numbering eyebrows: `01 / INDEX`, `003 · Capabilities`, `06 · how it works`.
- Decorative middle dots as a default separator. At most one `·` per line.
- Poetic filler labels: "From the field", "Field notes", "Quietly trusted by".
- Filler verbs: elevate, seamless, unleash, next-gen, revolutionize, supercharge.
- Micro-meta sentences that explain the label above them.
- Scroll cues ("Scroll", "↓ scroll", animated mouse wheels).
- Locale/time/weather strips.
- Generic placeholder identities: John Doe, Acme, Nexus, SmartFlow.
- Fake-perfect numbers: 99.99%, exactly 50%, 1234567.

**Every user-visible string must survive a read-aloud test**: is it grammatical,
is its referent clear, does it say a true thing about THIS product, and would a
person say it out loud? Plain and functional beats clever every time. A teacher
handing us their voice needs to be told what is happening, not charmed.

**Our own recurring offenders**, found in the audit and to be eliminated:
copy referencing the internal codename "Meera" on a teacher-facing screen; a
demo teacher's name rendered on a real teacher's consent screen; status text
that states a hardcoded value rather than the real one.

---

## 2. Feel: the Apple-design discipline (the studio's core)

**Latency is the enemy.** Feedback fires on `pointerdown`, never on release. No
debounce, no artificial timer on the input path. Press feedback:
`transform: scale(0.97)` at `100ms ease-out`, or a 1px translate.

**Motion is a spring, not a duration.** Use damping ratio + response, not
mass/stiffness triplets:

| interaction | damping | response |
|---|---|---|
| default UI move | 1.0 | 0.3–0.4 |
| momentum / after a flick or drag | ~0.8 | 0.3–0.4 |
| drawer, sheet | 0.8 | 0.3 |

Bounce ONLY where the user's own gesture carried momentum. A panel fading in
does not overshoot.

**Interruptibility is not optional.** Every animation must be grabbable and
reversible mid-flight, and must animate from the PRESENTATION value (what is on
screen right now), never from the logical target. Never lock input during a
transition. Gesture-driven motion does not use CSS transitions or keyframes,
which cannot be grabbed.

**Spatial consistency.** Whatever slides in from a side leaves to that side. A
popover's `transform-origin` is its trigger. Reversible transitions mirror their
easing.

**Only animate `transform` and `opacity`.** Never `top`/`left`/`width`/`height`.
`will-change` sparingly, `requestAnimationFrame` for anything hand-driven.

**Boundaries rubber-band**, they do not hard-stop.

**Materials carry hierarchy.** Floating chrome is translucent with content
scrolling beneath (`backdrop-filter: blur(20px) saturate(180%)`), not an opaque
bar. Bigger surfaces read thicker: more blur, deeper shadow. Never stack two
light translucent surfaces. Never flat grey text over a blurred surface. Use a
scroll-edge fade where content meets chrome, not a hard divider. Modal tasks dim
and push back what is behind; non-blocking panels do not.

**Typography is size-specific.** Tracking and leading change with size: display
type gets negative tracking (about `-0.02em`) and tight leading (about `1.05`);
body sits near `0` tracking with leading `1.5`+. One `letter-spacing` value
across all sizes is always wrong somewhere. Build hierarchy from weight + size +
leading together, never size alone. Scale spacing in `rem`/`em` so a user's
larger text setting does not break the layout.

**Accessibility is part of the feel, not a checkbox.** Honour
`prefers-reduced-motion` (cross-fade instead of slide/spring; drop overshoot),
`prefers-reduced-transparency` (raise opacity, drop blur) and `prefers-contrast`
(near-solid backgrounds, defined borders). No full-viewport moving backgrounds,
no slow looping oscillation, no abrupt brightness jumps.

**Feedback has four kinds** and each screen owes them: status, completion,
warning, error. Validate inline, never only on submit. Every screen answers:
where am I, where can I go, what is here, how do I leave.

---

## 3. Look: colour, shape, density

- **One theme per page.** A dark page stays dark all the way down. Section tints
  within the same family are fine; flipping to a cream section mid-page is broken.
- **One accent colour**, used identically everywhere on the page. Saturation
  under 80%. Neutral base (zinc/slate/stone family), one high-contrast accent.
- **No AI-purple/blue glow, no neon outer glows, no gradient text on large
  headings, no pure `#000000`.** Depth comes from inner borders and tinted
  shadows.
- **One corner-radius system**, applied consistently. One icon family, one
  stroke width.
- **Dark mode is designed, not derived**, and tested in both modes. WCAG AA
  minimum on body text and every CTA and form control (4.5:1; 3:1 at 18px+).
  A CTA whose label does not read against its own background is a shipping
  defect.
- **States are designed, all four**: loading uses skeletons shaped like the real
  content, not a generic spinner; empty states say how to fill them; errors are
  inline and specific; success is confirmed.

Our existing palette identity stands (WS-AA's "warm archival paper / ledger"),
and it satisfies the above: paper ground, near-black ink, one forest green for
verified/recorded, one marigold for your-turn-to-act. What it lacked was a
SCALE. Use `src/studio/design/tokens.css`: type sizes, spacing, radii, motion
and the four status states all come from tokens. Ad-hoc values are the defect
this replaces.

---

## 4. Structure

The studio is the three-step wizard (`context/decisions.md#three-step-wizard-ia`):
**Feed → Meet → Deploy**, with Meet as the heart. Progressive disclosure applies
to what is OPTIONAL, never to what is required-but-later.

Landing (`site/`) obeys the taste-skill's composition rules: hero fits the
viewport (headline at most two lines, subtext at most 20 words, CTA visible
without scrolling, top padding no more than about 6rem, at most four stacked
elements); no three-equal-column feature cards; at most one eyebrow per three
sections; no layout family used twice; no duplicate-intent CTAs; real images or
honestly-labelled placeholders, never `div`-built fake screenshots.

---

## 5. Enforcement

`scripts/check-copy.mjs` is extended to scan `src/studio/`, `src/student/` and
`site/` and to fail on: any em-dash or en-dash in a user-visible string, the
banned label patterns above, and the internal codename appearing in
teacher-facing copy. `scripts/check-motion.mjs` keeps its transform/opacity
rule. Both run inside `verify-release`.

A rule here without a check is a wish. When adding a rule, add its check.
