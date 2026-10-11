# DESIGN SYSTEM — Vyakti

**WS-AA, 2026-08-26.** The implementation is `src/studio/design/tokens.css`
(studio) and the inline `:root` block of `site/vyakti.html` (landing). This
file is the description both are implementations of. Change this first.

Companion documents: `docs/DESIGN-STANDARDS.md` (the house animation and
typography rules, which bind here), `docs/gurukul/PRODUCT-JOURNEY.md` (what the
system is for).

---

## 1. The identity, in one paragraph

Vyakti's surface is **warm archival paper**, not the cold white of a dashboard,
because nothing here is a dashboard. A teacher is handing us their voice, their
face, and the way they explain a limit to a sixteen-year-old, and the room that
receives that should feel like a records office run by someone careful: a paper
ground, ink that is nearly black and never black, one deep forest green that
means *verified, recorded, yours*, and one marigold ember that means *your turn
to act*. Headings are set in a serif because the subject is teaching;
everything operational is set in Inter because the subject is also a machine,
and the two typefaces are how the product says which of the two is talking.
Numbered panels, receipt-shaped chips and visible version stamps are not
decoration: the whole proposition is that we can show our work, so the visual
language is a **ledger**, not a landing page. Motion is short, transform-only
and never celebratory, because a clone learning your voice is a chain of
custody, not a confetti moment.

## 2. What the audit kept, and why

The studio and the landing were audited together. Four things were already
right and are now load-bearing rather than incidental:

**The paper ground (`#f4f1e9`).** Every competitor in this category ships a dark
gradient and a neon accent. Paper is warmer, reads as a document rather than a
console, survives being printed or screenshotted into a WhatsApp group (which is
how anything spreads among Indian teachers), and does not fight the serif.

**Forest green (`#17493b`) as the authority colour.** Not tech blue, which is
generic; not saffron, which carries political weight this product should not
carry. Deep green reads as institutional and verified in this market, and
critically it is *not* the alarm colour, so it can mark "recorded" without
implying "warning".

**Serif headings over sans body.** Georgia against Inter. An academic pairing
for an academic product, and it does one job nothing else does: it separates the
voice of the *product* (serif, deliberate) from the voice of the *machine*
(sans, operational). Keep every heading serif and every control sans.

**The numbered-panel ledger motif** (`.panel-index`, the `01` / `02` blocks, the
version stamps, the receipt IDs). This is the visual argument for the entire
product and it should be *more* present, not less.

## 3. What the audit found broken

Not the palette. The **scale**, or rather its absence, across ten workstreams
that each picked a value that looked right next to the one beside it:

| | Shipped today | Consequence |
|---|---|---|
| Type | 9, 10, 11, 12, 13, 14, 18px chosen per component | Three components caption at three sizes on one screen. 9px and 10px are below a readable floor for consent labels. |
| Space | 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 32, 42, 46px | No vertical rhythm, so fourteen panels read as fourteen apps. |
| Radius | 9, 10, 11, 12, 16, 17, 20, 28, 99, 999px, while `--radius-sm/--radius/--radius-lg` sit defined and bypassed | 99px and 999px are the same shape spelled twice. |
| Weight | 400, 600, 700, 750, 800 | 750 and 800 are indistinguishable at 11px on this ground. |
| Motion | zero tokens, in a repo that gates motion with a lint | Nothing to enforce against; every duration is a literal. |
| Status | forest and danger only | "verified", "recorded", "in progress" and "waiting on you" all render forest. |

The last row is the one that mattered most and it is a product defect, not a
styling one. In a product whose claim is that it shows its work, a state
palette **is** the work being shown.

## 4. The system

### 4.1 Colour

**Ground and ink**

| Token | Value | Use |
|---|---|---|
| `--paper` | `#f4f1e9` | Page ground |
| `--paper-deep` | `#ebe6da` | Recessed wells, inactive chips |
| `--panel` / `--panel-solid` | `rgba(255,254,249,.9)` / `#fffef9` | Panels |
| `--ink` | `#171915` | Primary text |
| `--ink-soft` | `#52564e` | Body and secondary |
| `--ink-faint` | `#7a7e74` | Metadata, captions |
| `--line` / `--line-strong` | 12% / 22% ink | Hairlines and control borders |

Borders are load-bearing here: they are what makes a panel read as a record
rather than a card. Do not replace them with shadow.

**Brand**

| Token | Value | Meaning |
|---|---|---|
| `--forest` | `#17493b` | Verified, recorded, yours |
| `--forest-deep` | `#0e352a` | Text on `--forest-soft` |
| `--forest-soft` | `#e1eee7` | Affirmative panel ground |
| `--signal` | `#ed693d` | The ember, decorative use only |

**Status — the four states, and the rule**

| Token | Value | Means | Rule |
|---|---|---|---|
| `--state-done` | forest | Recorded, nothing owed | |
| `--state-waiting` | `#b4551f` | **Your turn** | At most one ember on screen at a time |
| `--state-running` | `#4c5a6b` | Platform is working | Deliberately the most neutral of the four |
| `--state-stopped` | `--danger` | Revoked, rejected, refused | |

`--state-waiting` is the ember darkened from `--signal` so it clears contrast on
paper at small sizes; `--signal` itself stays for decorative fills.

`--state-running` is neutral on purpose. A cold start in this system takes
176 seconds (`context/STATE.md`), and a colour that looked urgent for three
minutes would be a lie told in paint.

**One ember at a time** is the rule that makes the status palette worth having.
A rail with six things glowing is a rail nobody starts.

### 4.2 Type

Six sizes, roughly a 1.2 ratio, each named for its job.

| Token | Size | Job |
|---|---|---|
| `--text-micro` | 11px | Eyebrows, metadata, receipt stamps. **The floor.** |
| `--text-small` | 12px | Secondary body, help text, chip labels |
| `--text-body` | 14px | Default body and control text |
| `--text-lead` | 16px | The sentence that carries a step |
| `--text-title` | 20px | Panel title (h3) |
| `--text-heading` | 26px | Section heading (h2) |
| `--text-display` | `clamp(30px, 4.2vw, 42px)` | h1 only, once per screen |

11px is a **hard floor**. The studio currently ships 9px and 10px caption text
(`studio.css` `.artifact-title > span`, `.pipeline-step span`,
`.review-controls label span`, `.review-decision`). Below 11px on this ground is
below the size at which a teacher on a phone reads a consent label, and consent
labels are the last copy in this product that may be hard to read.

Leading: `--leading-tight` 1.25 (headings), `--leading-snug` 1.45 (dense rows),
`--leading-body` 1.6 (paragraphs).
Weight: 400 / 600 / 800 only.
Tracking: `--tracking-caps` 0.06em, used by eyebrows and nothing else.
Measure: `--measure` 68ch for prose, `--measure-tight` 52ch for help text.

**Families.** `--serif` (Georgia) for every heading. `--sans` (Inter) for
everything operational. `--mono` for identifiers a person might need to quote
back to us: receipt IDs, model commitments, version stamps, step numbers.

### 4.3 Space

4px base, six named steps, two page rhythms.

`--space-hair` 4 · `--space-tight` 8 · `--space-row` 12 · `--space-item` 16 ·
`--space-block` 24 · `--space-panel` 32

`--space-section` `clamp(40px, 6vw, 64px)` between top-level steps, and
`--space-pad` `clamp(20px, 4vw, 42px)` for panel padding. These two are what
decide whether the studio reads as one document or as ten stacked apps, and
every top-level `<section>` should use them.

### 4.4 Shape, elevation, focus

Radii: `--radius-control` 10px (buttons, inputs, selects), `--radius-sm` 12,
`--radius` 20, `--radius-lg` 28, `--radius-pill` 999.

Elevation: two shadows and no more. `--shadow` is the resting panel;
`--shadow-lift` is for the two things that genuinely float (a modal, a sticky
action bar). A third elevation would imply the page has a depth *order*, and it
does not. It is a document.

Focus: `--focus-ring` is the **opaque** forest, 3px, 3px offset. The studio's
current `rgba(23,73,59,.28)` composites to roughly 1.9:1 against paper, under
the 3:1 WCAG 2.2 asks of a focus indicator, on a product whose primary user is
filling in a long consent form on a laptop keyboard.

### 4.5 Motion

`scripts/check-motion.mjs` is the gate: transform and opacity only, 300ms cap on
a UI transition, `motion-lint: allow <reason>` as the documented escape hatch.
These four durations are the whole vocabulary and all clear the cap:

`--motion-instant` 90ms (hover, press, focus) · `--motion-quick` 160ms (a
control changing state) · `--motion-enter` 240ms (a panel or chip arriving) ·
`--motion-exit` 140ms (anything leaving).

Exit is faster than enter on purpose: a thing leaving should not make you wait
for it. `--ease-emphasis` is the only curve with overshoot and is reserved for a
state **changing** (a gate closing, a step ticking to done), never for something
merely appearing.

`prefers-reduced-motion: reduce` collapses all four to 1ms at the token level,
so components inherit the correct behaviour instead of each re-deriving a media
query.

**Nothing celebrates.** No confetti, no bounce on success, no rising chime. The
successes in this product are legal acts.

### 4.6 Voice and copy

The rules the studio's own best components already follow, written down:

1. **Say what is true, then what to do.** Never one without the other.
2. **Name whose turn it is.** `QuickStartPath`'s "waiting on you / waiting on
   the platform" split is the house pattern; every state and every error adopts
   it.
3. **Never invent a cause.** `errorCopy.ts`'s discipline is the standard: quote
   the server verbatim, classify only what is knowable, and say "the server did
   not explain why" when it did not.
4. **No em-dashes.** `docs/DESIGN-STANDARDS.md`'s ban binds on the whole
   product. `scripts/check-copy.mjs` does not yet scan `src/studio/`, which
   carries 73 of them; that is UX-Q-09, not a licence.
5. **Second person, present tense, active.** "You permitted", not "Permission
   was granted".
6. **Hinglish-friendly, not Hinglish-performing.** Short sentences, no idiom, no
   phrasal verbs a bilingual reader has to unpack ("switched off" over "disabled
   at the config layer"), and no cleverness in a consent string. The studio is
   English because the teacher is a professional operating in English; the
   *clone* is where the Hinglish lives. **[taste]**
7. **No superlatives, no fabricated proof.** No testimonials, no logos, no
   "trusted by". The measured numbers are the pitch, and they are printed with
   what they do not mean.

### 4.7 Component shapes

Six primitives cover the studio. Each has one shape and it does not vary by
panel.

- **Panel** — hairline border, `--radius-lg`, `--panel` ground, `--shadow`,
  `--space-pad` inside, optional `--space-panel`-wide `.panel-index` gutter.
- **Eyebrow** — `--text-micro`, 800, `--tracking-caps`, uppercase, forest.
- **Status chip** — pill, hairline, a status dot, `--text-micro` label. One of
  the four states. Never a bare colour with no word next to it.
- **Field** — `--radius-control`, hairline, 44px minimum target, label above,
  help text below at `--measure-tight`.
- **Button** — three ranks only: primary (forest fill), secondary (hairline),
  destructive (danger fill). `--radius-control`, 44px minimum. A destructive
  action always sits behind a typed confirmation, which the studio already does
  well.
- **Ledger row** — a monospace identifier, a human label, a status chip, and the
  actions. This is the product's signature object.

## 5. Rules that are not negotiable

1. **No dark mode.** `color-scheme: light` is a deliberate single-look
   commitment. A records office does not have a night mode, and shipping a
   second palette for a product with no coherent first one is how the first one
   never happens. Revisit only if a real teacher asks. **[taste]**
2. **No status without a word.** A colour alone is not a state, for colour-blind
   users and for everyone reading a screenshot.
3. **No literal in a status position.** `StudioApp.tsx:629-633` renders a
   hardcoded "Voice versions 0 / No model trained" that is wrong for any teacher
   who has built one. Every status must be derived from data or not shown.
4. **44px minimum touch target.** Non-negotiable, and currently violated by the
   34-38px controls in `studio.css` (`.review-refresh`, `.artifact-actions
   button`, `.review-controls select`).
5. **The gates bind.** `check-motion`, `check-copy` and `check-contrast` are
   part of this system, not adjacent to it. If a design trips one, the design is
   wrong.
