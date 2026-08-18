# Vyakti — Brand & Design System Forensics

Reverse-engineered from production (`https://vyakti.ai`, canonical `https://www.vyakti.ai`) by fetching raw HTML and CSS with `curl`. No source repo was available. Everything below is either **observed** directly in shipped bytes or explicitly flagged **INFERRED**.

Fetched: 2026-08-18. Raw artifacts saved to `docs/website-research/brand/raw/` (HTML for all 4 real routes + the 3 confirmed-404 anchors, both CSS bundles, all JS chunks, extracted plain-text copy per page).

---

## 1. Framework / router / styling — build constraints

| Question | Verdict | Evidence |
|---|---|---|
| Framework | **Next.js**, App Router | `vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch` response headers; `x-nextjs-prerender: 1`, `x-nextjs-stale-time: 300` (ISR-style prerendered route) |
| Bundler | **Turbopack** production build | chunk path `/_next/static/immutable/chunks/turbopack-*.js`; `/_next/static/immutable/...` path shape (not the classic `/_next/static/<buildId>/...` webpack shape) |
| Hosting | Vercel | `server: Vercel`, `x-vercel-id`, `x-vercel-cache: HIT` headers |
| Styling | **Tailwind CSS v4** (CSS-first `@theme`, lightningcss-compiled) **+ CSS Modules** for bespoke/animated components | `--text-4xl--line-height`, `--tw-*` `@property` registrations, `lab()`/`oklab()` fallback blocks are Tailwind v4 signatures; class names like `home-module__06co2W__storyRunway` and `meera-portrait-module__qSUO5q__root` are Next.js CSS Modules (Turbopack content-hash naming) |
| Fonts | `next/font` self-hosted (local), **not** Google Fonts CDN | woff2 served from `/_next/static/immutable/media/*.woff2`, `@font-face` blocks embedded directly in the CSS bundle with `ascent-override`/`size-adjust` fallback faces — the fingerprint of `next/font/google` or `next/font/local` at build time |
| Smooth scroll | **Lenis** | `.lenis` class present in CSS; a script chunk literal-named `SmoothScroll` referenced in the RSC payload |
| 3D/WebGL | Custom **three.js**-based scene for the homepage hero ("story runway") | footer credits `three.js` (mrdoob) and `Google GNM Head` (Apache 2.0) for "3D geometry"; homepage has a `590svh`-tall scroll-driven `<canvas>` stage (`storyRunway` → `storyStage` sticky → `storyCanvasLayer`) |
| Route split | **Two authoring patterns coexist** | `/research` and `/company` load **only** the shared global bundle (`3intbjzc3zwnz.css`) and are built entirely from Tailwind utility classes on plain semantic markup (`<section>`, `<article>`, `<dl>`) — no page-specific CSS Module. `/` and `/meera` additionally load a second bundle (`0wx-z7y741wpk.css`) containing bespoke CSS-Modules components (`home-module__*`, `meera-portrait-module__*`) for the scrollytelling hero and the interactive portrait. |

**What this means for a new page/route:** A new `/research` page (or any content-driven page) should be authored the way `/research` and `/company` currently are — App Router page, semantic HTML, Tailwind utility classes only, referencing the existing design tokens (`bg-ink`, `text-bone`, `text-ash`, `border-hairline`, etc.) and the shared utility classes below (`.shell`, `.eyebrow`, `.measure`, `.rule`, `data-reveal`). Do **not** invent a bespoke CSS Module unless the page needs a genuinely new interactive/animated component (WebGL, custom scroll rig) on the order of the homepage hero — that is the one place the codebase reaches for page-specific CSS Modules instead of Tailwind alone.

**CONFIDENCE:** framework/router/styling verdicts are directly observed. The claim that authorship happens in `src/app/research/page.tsx`-style App Router files is **INFERRED** from response headers and route behavior (no repo access to confirm exact file layout).

---

## 2. Design tokens

### 2.1 Colors (from `:root` in `3intbjzc3zwnz.css` — the brand's actual custom tokens; NOT the unused Tailwind default palette also present in the bundle)

`color-scheme:light` is set explicitly on `:root`. These are the only colors with real usage weight on the pages fetched:

| Token | Hex | Inferred role | Notes |
|---|---|---|---|
| `--c-ink` | `#f8f8f5` | **Primary background** (warm off-white) | Confusingly named "ink" but is the lightest surface — used as `bg-ink` for most section backgrounds |
| `--c-void` | `#efefea` | Secondary/alternating section background | Slightly darker warm-grey, used to alternate section rhythm (`bg-void` sections interleave with `bg-ink` ones) |
| `--c-surface` | `#fff` | Card/panel background | Used for raised elements like the transcript figure card |
| `--c-raised` | `#f3f3ef` | Raised surface variant | Defined; observed 0 direct usages in fetched pages — likely used in components not covered (e.g. hover states, `/meera` interactive widgets) |
| `--c-hairline` | `#d7d7d0` | Border / rule color | Used everywhere for `border-hairline`, the `.rule` gradient divider, `decoration-hairline` |
| `--c-bone` | `#0c0e0d` | **Primary ink/text** (near-black, warm) | Named "bone" but is the dark text color — used as `text-bone` for headings and body-strong text. (Yes, `--c-ink` = light bg, `--c-bone` = dark text; the names are inverted from intuition — verified twice against usage.) |
| `--c-ash` | `#50524f` | Secondary/body text | Warm dark grey, used for paragraph copy (`text-ash`) |
| `--c-slate` | `#666862` | Muted/tertiary text | Labels, eyebrows, captions, figure credits (`text-slate`) |
| `--c-ember` | `#c83f2d` | **Primary accent** | Terracotta/brick red — CTA buttons (`bg-ember`), active nav underline, links on hover, Meera's dialogue color in transcripts, timeline dot |
| `--c-on-ember` | `#fff` | Text-on-accent | White text on ember-colored buttons/surfaces |
| `--c-meera` | `#6f2342` | **Secondary/character accent** | Deep wine/maroon — reserved specifically for the word "Meera" wherever it appears as a proper noun in copy, and for the portrait's color-signature underline gradient. Distinct from ember; used sparingly and intentionally as a "this is her" marker. |
| `--c-sage` | `#1f6b54` | Defined, unused in fetched pages | Deep green — 0 usages found; reserve/future accent (e.g. a "success"/"consent" state) |

Tailwind's stock palette (`--color-amber-500`, `--color-gray-900`, `--color-indigo-500`, `--color-pink-500`, `--color-red-900`, `--color-teal-500`, `--color-zinc-*`, etc.) is present in the compiled CSS (Tailwind v4 always emits the full theme) but each appears **exactly once** in the bundle (its own definition) and **zero times** as an applied class on any fetched page — treat it as dead/unused scaffolding, not brand palette. Only the `--c-*` tokens above are the real palette.

### 2.2 Typography

**Families** (self-hosted via `next/font`, variable font files, weight range 100–900 where noted):
- `--font-sans`: `var(--font-geist), ui-sans-serif, system-ui, sans-serif` → **Geist** (Vercel's typeface) — body/UI default
- `--font-mono`: `var(--font-geist-mono), ui-monospace, "SF Mono", monospace` → **Geist Mono** — used for eyebrows, pill tags, nav-adjacent micro-labels, footer column headers, the `.ai` in the wordmark
- Devanagari glyph font: **Noto Sans Devanagari**, weights 500/600 — used *only* for the "व्य" glyph in the wordmark (`lang="hi"` span, `font-family:var(--font-devanagari), sans-serif`), not for body copy
- Fallback metric-matched faces (`Geist Fallback`, `Geist Mono Fallback`, `Noto Sans Devanagari Fallback`) with `ascent-override`/`descent-override`/`size-adjust` are generated by `next/font` to prevent layout shift — a signal to replicate if hand-rolling `@font-face` later.

**Type scale** (Tailwind v4 custom `--text-*` tokens, several are fluid `clamp()` — this is a fluid/responsive type system, not fixed breakpoint steps):

| Token | Value | Used for |
|---|---|---|
| `--text-h1` | `clamp(3.35rem, 1.65rem + 6.5vw, 8.7rem)` | Page-level `<h1>` (global tag rule, `letter-spacing:-.068em; line-height:.89`) |
| `--text-h2` | `clamp(2.2rem, 1.42rem + 3vw, 4.8rem)` | Section `<h2>` (`letter-spacing:-.052em; line-height:.96`) |
| `--text-h3` | `clamp(1.35rem, 1.16rem + .7vw, 1.85rem)` | Sub-headings, footer wordmark size on some contexts (`letter-spacing:-.035em; line-height:1.08`) |
| `--text-lead` | `clamp(1.125rem, 1.01rem + .5vw, 1.45rem)` | Lede/intro paragraphs directly under a heading |
| `--text-body` | `clamp(.975rem, .93rem + .2vw, 1.1rem)` | Standard paragraph copy |
| `--text-small` | `.875rem` (fixed) | Secondary copy, nav links, `dd` descriptions |
| `--text-micro` | `.75rem` | Captions, pill-tag labels, footnote credits |
| `--text-eyebrow` | `.6875rem` | The all-caps mono kicker label above section headings |
| `--text-4xl` … `--text-7xl`, `--text-xl`, `--text-base` | Standard Tailwind fixed rem steps (2.25rem → 4.5rem) | Present in theme but section-level headings mostly use the custom fluid tokens above instead |

Global heading defaults (applied to bare tags, not just utility classes — meaning any `<h1>`/`<h2>`/`<h3>` gets this by default):
```
h1 { font-size: var(--text-h1); letter-spacing: -.068em; line-height: .89 }
h2 { font-size: var(--text-h2); letter-spacing: -.052em; line-height: .96 }
h3 { font-size: var(--text-h3); letter-spacing: -.035em; line-height: 1.08 }
h4 { text-wrap: balance; font-weight: 530 }
@media (max-width: 767px) { h1 { letter-spacing: -.055em; line-height: .94 } h2 { line-height: 1 } }
```
Note the very tight, negative letter-spacing at large sizes (as low as `-.068em`, and `-.12em` on the wordmark glyph) — this is a deliberate, consistent "tight display type" signature across the whole site, not a one-off.

Font weights used: `400` (normal), `500` (medium), `540/550/560` (odd intermediate weights — variable-font fine-tuning, appear on hero/story headings and eyebrows), `600` (semibold), `700` (bold, defined but rarely seen applied).

### 2.3 Spacing, radii, shadows, motion

- **Spacing base unit**: `--spacing: .25rem` (standard Tailwind 4px-multiple scale — no custom spacing scale beyond Tailwind defaults observed)
- **Radii**: `--radius-lg: .5rem`, `--radius-xl: .75rem`, `--radius-2xl: 1rem`. Buttons and pills use `rounded-full`, not the token radii. Cards (e.g. the transcript figure) use `rounded-[var(--radius-lg)]`.
- **Shadow**: exactly one custom shadow token is defined: `--shadow-lift: 0 1px 2px #11120f0a, 0 24px 70px #11120f14` (a soft, large-radius "lift" shadow — near-black at ~4–8% opacity, not a colored/brand shadow). Tailwind's stock `--tw-shadow` utilities are also present but this is the one bespoke one.
- **Blur**: `--blur-sm: 8px`, `--blur-xl: 24px` (used for backdrop blur, e.g. sticky header on scroll — **INFERRED** usage location, defined but not directly observed applied in the static HTML fetched since header blur likely toggles via JS scroll-state class).
- **Motion / easing** (this is a precisely-tuned system, worth copying exactly):
  - `--duration-fast: .14s`, `--duration-base: .26s`, `--duration-reveal: .76s`
  - `--ease-out-quint: cubic-bezier(.23, 1, .32, 1)` — the signature easing for scroll-reveals and hero transitions
  - `--ease-out: cubic-bezier(0, 0, .2, 1)`, `--ease-in: cubic-bezier(.4, 0, 1, 1)`, `--ease-in-out: cubic-bezier(.4, 0, .2, 1)`
  - Scroll-reveal system: every content block that should animate in carries `data-reveal="N"` (N = stagger index, likely mapped to a delay via `--reveal-delay`), starts `opacity:0; transform:translateY(22px)`, and gets `.is-revealed` added (presumably via IntersectionObserver, JS not fully traced) which resolves to `opacity:1; transform:none` over `--duration-reveal` (.76s) with `--ease-out-quint`.
  - `prefers-reduced-motion: reduce` is explicitly respected: disables `scroll-behavior`, kills the marquee animation, and forces all `[data-reveal]` elements to their resolved state immediately. This is a real accessibility investment, not an afterthought.
  - `prefers-reduced-transparency: reduce` also has a dedicated override (flattens a gradient mask to solid ink) — an unusually thorough motion/accessibility posture worth matching.

### 2.4 Breakpoints
Only three explicit breakpoints observed in the compiled CSS: **680px**, **767px** (mobile heading override only), and **980px**. Tailwind's default `md:`/`sm:` utility breakpoints (640/768/1024/1280) are also compiled in and used throughout the utility classes (`md:grid-cols-...`, `sm:flex-row`), so treat 767/980/680 as *custom* breakpoints layered on top of stock Tailwind breakpoints for the bespoke homepage/portrait components specifically.

---

## 3. Dark mode

**Verdict: there is no dark mode on this site.** `color-scheme: light` is hard-set on `:root`, no `data-theme` attribute or `.dark` class appears anywhere in any fetched page's `<html>` tag, and `grep`ing all four pages for `dark:` utility classes or `data-theme` returns zero matches in the actual markup.

The compiled CSS *does* contain two dead classes — `.dark\:bg-zinc-950` and `.dark\:text-gray-100` inside a `@media (prefers-color-scheme:dark)` block — but these are Tailwind v4's mechanical output for the `dark:` variant (likely triggered by a scanned but unused class somewhere in a shared component library import) and are never applied to any element on any of the four routes. Treat them as noise, not as evidence of an intended dark mode.

**If a new page needs to match the system exactly: author it light-only, using the `--c-*` tokens directly. Do not add a `dark:` variant strategy — it would be inconsistent with the rest of the shipped site.**

**CONFIDENCE: high.** This is a directly observed absence across all fetched HTML, confirmed by the explicit `color-scheme:light` declaration.

---

## 4. Layout system

- **Container**: `.shell { width:100%; max-width:1480px; margin-inline:auto; padding-inline:clamp(1.25rem,4vw,4.5rem) }` — the standard page container, used on every section.
- **Narrow container**: `.shell-narrow { max-width:850px; ... same padding }` — used for centered CTA sections (e.g. "Work on this with us.").
- **Prose measure**: `.measure { max-width:62ch }` — applied to paragraph text to cap line length regardless of container width.
- **Section rhythm**: sections alternate `bg-ink` (`#f8f8f5`) and `bg-void` (`#efefea`) backgrounds as you scroll down a page, each separated by a 1px `border-hairline` (or the gradient `.rule` fade-out variant). Vertical padding on sections is consistently `py-20 md:py-28` for standard content sections, scaling up to `py-24 md:py-32` for hero/CTA-weight sections and `clamp(7rem,13vw,12rem)` for the largest homepage story sections.
- **Content grid pattern** (the dominant repeated layout on `/research` and `/company`): a two-column CSS grid, `grid-cols-[minmax(0,22rem)_minmax(0,1fr)]` on desktop (label/heading column ~22rem fixed-min, content column flexible), collapsing to a single column below `md`. This is the workhorse layout for every "topic block" (Identity, Memory, Perception… on /research; Careers list items on /company).
- **12-column grid** used specifically for the Evaluation section on `/research` (`md:grid-cols-12`, heading in `col-span-4`, body starting at `col-start-6 col-span-7` — an offset two-column relationship rather than a literal 12-up grid of cards).
- **Homepage-only patterns** (CSS-Module driven, not reusable via Tailwind alone): the 590svh scroll-hijacked "story runway" hero; a `continuityMap` 5-column grid (`.82fr 3rem 1.2fr 3rem .72fr` — content/arrow/content/arrow/content, used for a "before → engine → after" diagram); a `researchGrid` 12-col asymmetric card grid (7/5/5/7 spans) previewing research areas *on the homepage* (separate from the full `/research` page).

---

## 5. Component inventory

Precise enough to rebuild each from Tailwind utilities alone (all confirmed in raw HTML in `raw/*.html`):

1. **Header/nav** (`raw/research.html` lines near `<header class="site-header ...">`): fixed, `h-[68px]`, transparent border that presumably solidifies on scroll (JS-driven, not visible statically). Wordmark = Devanagari "व्य" glyph (Noto Sans Devanagari, `text-[1.55rem]`, `tracking-[-0.12em]`) + "vyakti" (Geist, lowercase, `tracking-[-0.045em]`) + ".ai" suffix in Geist Mono at 0.56em, ember-colored. Nav links are pill-shaped (`rounded-full px-3.5 py-2`), current page gets a `text-bone` state plus a `bg-ember` underline bar (`absolute inset-x-3.5 bottom-1 h-px`) animated in via `scale-x` transform; other links are `text-ash` with `hover:text-ember`. A secondary CTA button "Meet Meera" (outline pill, `border-bone`, `hover:bg-bone hover:text-ink`) sits right of the nav, hidden below `sm`. Mobile: hamburger → full-height `role="dialog"` panel with `text-h3` stacked links and a solid ember CTA pill.

2. **Buttons** — two variants, both `rounded-full px-5 py-2.5 text-small font-medium`, `active:scale-[0.98]` press feedback, transition on `background-color,border-color,color,transform` at `--duration-fast`/`--ease-out-quint`:
   - **Primary**: `bg-ember text-on-ember hover:bg-ember/90`
   - **Secondary/outline**: `border border-hairline text-bone hover:border-ash hover:bg-surface`

3. **Eyebrow label** (`.eyebrow` utility class): mono font, `.6875rem`, `0.16em` letter-spacing, uppercase, `text-slate`, with a small horizontal rule (`::before`, `1.35rem × 1px`, `currentColor`) preceding the text as an inline flex item. Used as the kicker above nearly every section heading ("Evaluation", "Careers", etc.).

4. **Pill tag list**: `rounded-full border border-hairline px-3 py-1 font-mono text-micro text-slate`, used for the topic-tag rows under each `/research` section heading (e.g. "Persona consistency", "Social reasoning", "Value stability").

5. **Two-column topic block** (the dominant `/research` and `/company` pattern): label column (heading + tag list) at `minmax(0,22rem)`, content column (lead paragraph in `text-lead text-bone` + supporting paragraph in `text-body text-ash`) at `minmax(0,1fr)`, `md:gap-20`, wrapped in an `<article>` with `border-b border-hairline` and alternating `bg-ink`/`bg-void`.

6. **Transcript/dialogue card** (unique to the Expression section of `/research`): `rounded-[var(--radius-lg)] border border-hairline bg-surface p-6 sm:p-8` card. Each turn is a flex row: fixed-width (`w-[4.5rem]`) uppercase mono speaker label (`text-slate`) + the line itself (`text-bone` for the human speaker, `text-ember` for Meera). Between turns, an annotation line is inset (`pl-[5.5rem]`) with a colored left border (`border-l-2`, ember when annotating Meera's response, hairline-grey otherwise) — a clever way to show interruption/timing annotations inline with a real-looking transcript. A `<figcaption>` below, separated by a `border-t`, gives the methodological caption in `text-micro text-slate`.

7. **Definition-list stat block** (Evaluation section): `<dl class="divide-y divide-hairline border-t border-hairline">`, each `<dt>` (`text-body font-medium text-bone`) + `<dd>` (`text-small text-ash`, `measure`) pair in its own `py-6` row — used for the four "how we evaluate" criteria.

8. **Careers list**: same two-column grid pattern as topic blocks but as `<ul><li>` items in a `divide-y border-t border-b` wrapper — heading + paragraph pairs for each open research area, ending in a primary-button mailto CTA.

9. **Footer**: `border-t border-hairline bg-void`, 4-column grid on desktop (`1.5fr repeat(3,1fr)`): wordmark + one-line mission statement + email link in col 1; three link columns ("Explore", "Lab", "Connect") each with a `font-mono text-micro uppercase tracking-[0.14em] text-slate` header and `space-y-3` link list. Below, a full-width hairline rule, then a small-print row (`text-micro text-slate`) with copyright and the two 3D-asset attribution links (three.js / Google GNM, both CC-licensed geometry credits — required disclosure, not decorative).

10. **`.rule` divider**: `linear-gradient(to right, transparent, var(--color-hairline) 8%, 92%, transparent)`, 1px tall — a soft-edged horizontal rule used inside the homepage story sections in place of a hard `border-hairline` where a fade is wanted.

11. **Scroll-reveal wrapper**: every meaningful content block on every page carries `data-reveal="N"` — this is a page-wide, consistently-applied animation primitive (see §2.3), not just a homepage flourish. A new page should apply the same `data-reveal` attribute pattern to fit the established rhythm.

---

## 6. Current `/research` page — full audit

### What exists today (verbatim structure, top to bottom)

1. **Hero** (`bg-ink`, `pt-32 pb-20 md:pt-40 md:pb-28`): single `<h1>` ("Personality is not a system prompt.") + one `.measure` lead paragraph. No image, no visual — pure type.
2. **Five topic blocks**, each the two-column pattern from §5.5, alternating `bg-ink`/`bg-void`, each with an `id` anchor for deep-linking:
   - `#identity` — Identity (tags: Persona consistency, Social reasoning, Value stability)
   - `#memory` — Memory (tags: Long-horizon memory, Salience, Reflection, Forgetting)
   - `#perception` — Perception (tags: Multimodal understanding, Prosody, Gaze, Context)
   - `#expression` — Expression (tags: Full-duplex voice, Affect, Facial motion, Timing) — **the only block with a supporting visual**, the transcript card (§5.6)
   - `#agency` — Agency (tags: Planning, Initiative, User control, Alignment)
3. **Evaluation section** (`#evaluation`, `bg-ink`, `py-24 md:py-32`): 12-col grid, eyebrow + `<h2>` in left 4 cols, lead paragraph + 4-item `<dl>` stat block (§5.7) in right 7 cols (offset from col 6).
4. **Closing CTA** (`bg-void`, centered, `.shell-narrow`): "Work on this with us." + one sentence + one primary button linking to `/company#careers`.

That's the entire page — **6 sections total**, all text-and-typography, zero images, zero data visualizations, zero citations/links to actual papers or external research, zero team/people content, zero examples beyond the single transcript illustration.

### Gaps (what a world-class research section should have that this doesn't)

- **No evidence of actual research output.** Every claim is a thesis statement ("We research architectures that preserve character…") with no citation, paper link, dataset, demo video, or benchmark number anywhere on the page. For a "relational intelligence lab," there is currently zero externally-verifiable research artifact linked from `/research`.
- **No people.** No author names, no researcher bios, no "who's behind this" — unusual for a research page whose credibility depends on the humans doing the work. (`/company` has a careers section but never names existing team members either.)
- **Only one illustrative example** (the Expression transcript) across five topic areas — Identity, Memory, Perception, and Agency all make claims with zero concrete illustration, demo, or worked example. This is the single biggest content gap: the page *asserts* a research philosophy five times but only *shows* it once.
- **The Evaluation section describes a methodology with no results.** It explains *how* they plan to evaluate (held conversation, continuity, legible memory, identity through model change) but presents no actual evaluation data, scores, or case studies — appropriate for a pre-launch lab, but worth flagging as a placeholder rather than a finished section if the brief is "build a world-class research section."
- **No downloadable/citable artifact** (no PDF, no arXiv-style writeup, no blog/updates feed, no changelog of research progress over time) — the whole site (confirmed via `sitemap.xml`) is exactly 4 URLs; there is no `/research/[slug]` or `/blog` pattern to extend into, so a "real" research section (with individual posts/papers) would be new IA, not a fill-in.
- **No visual system for data/diagrams.** The homepage's `continuityMap` 5-column diagram (engine → relational core → identity) is the closest thing to a research diagram on the whole site, and it lives on the homepage, not `/research`. `/research` itself has no charts, timelines, architecture diagrams, or figures beyond the one transcript card.
- Positive to preserve: the five-pillar taxonomy (Identity / Memory / Perception / Expression / Agency) is a strong, clean IA and the tag-pill pattern under each heading is an efficient way to preview sub-topics — keep this scaffold, just fill it with real substance (people, citations, artifacts, more worked examples per pillar) rather than replacing the structure.

**CONFIDENCE:** the structural audit is fully observed (raw HTML in `raw/research.html`). The gap assessment ("what a world-class research section should have") is an editorial judgment, flagged as such — reasonable people could weigh these gaps differently depending on the lab's actual publication cadence and confidentiality constraints, which we have no visibility into.

---

## 7. Voice guide

**Tone**: precise, restrained, aphoristic. Declarative short sentences carry the argument; longer sentences are used specifically to complicate or qualify, never to pad. Frequent use of **paired/contrasting short clauses** as a structural device ("Presence without impersonation. Connection without capture." / "Intelligence is becoming abundant. Continuity is not."). Confident but not hyped — no exclamation points, no superlatives like "revolutionary" or "best-in-class," no emoji anywhere in the copy.

**Rules observed:**
- **Sentence case throughout**, including all headings — never title case. ("Personality is not a system prompt.", not "Personality Is Not A System Prompt.")
- **First person plural ("we")** used consistently for the lab's own research claims ("We research architectures…", "We work on long-horizon memory…", "We explore systems that can act…") — never "I," never a corporate "Vyakti believes." Meera herself is referred to in third person ("she"), never first person, in all marketing copy (she isn't given a voice on the marketing site; her voice presumably lives only in-product).
- **No unsupported statistics.** Zero numeric claims about model performance, user counts, or benchmarks anywhere across all four pages — the only numbers on the entire site are the copyright year (2026) and license names (CC BY 3.0, Apache 2.0). This is a deliberate abstention, not an oversight, and is consistent with the "Say what does not work" principle stated on `/company`.
- **British/international spelling** in places ("recognisable," "organise"-family spellings) mixed with otherwise standard copy — treat as house style, not inconsistency.
- **Headlines pose a claim as a compressed aphorism; body copy immediately complicates or grounds it.** Pattern repeats on every page: bold short claim → one or two sentences of qualification/mechanism.
- **Self-aware epistemic humility as a recurring rhetorical move**: the copy repeatedly pre-empts its own hype ("A carefully edited minute can make almost any companion look complete… That is the real test," "The score exists to describe the behaviour. When the two disagree, we believe the conversation and rewrite the metric.") — this is a core voice trait, not incidental.
- **Never markets Meera as human or hides that she's AI** — "Always AI," "Clearly AI" are load-bearing headings, and "identify as AI" language appears verbatim in the copy. Any new copy must preserve this; it's a stated product principle, not just tone.

**8–10 verbatim exemplar sentences** (pulled directly from `raw/*.text.txt`):

1. "Intelligence is becoming abundant. Continuity is not."
2. "A person is a pattern that persists."
3. "The engine can change. The person should remain."
4. "You do not configure Meera. You meet her."
5. "The more human AI feels, the clearer its boundaries must be."
6. "Presence without impersonation. Connection without capture."
7. "A prompt shapes one reply. A relationship shapes what comes next."
8. "The score exists to describe the behaviour. When the two disagree, we believe the conversation and rewrite the metric."
9. "A carefully edited minute can make almost any companion look complete. Identity drift, false memories and repetitive behaviour only appear with time. That is the real test."
10. "Preferences are easy. A coherent identity is harder: a voice, point of view, values and contradictions that remain recognisable without preventing growth."

---

## 8. Confidence notes (summary)

- **Observed directly, high confidence**: all hex colors, all CSS custom properties, the type scale, the font stack and font-face sources, the breakpoints, dark-mode absence, the container/grid values, every component's exact class list, all page copy (verbatim), the sitemap's 4-URL scope, framework/router/bundler fingerprints from headers and chunk naming.
- **Inferred, flagged in-line above**: exact file/folder layout of the Next.js app (no repo access — inferred only from route/header behavior); the precise JS mechanism driving `data-reveal`/`.is-revealed` toggling (IntersectionObserver is the standard approach and consistent with the CSS, but the actual JS implementing it was not fully traced through the minified chunks); the backdrop-blur header-on-scroll behavior (tokens exist for it but no static HTML state showed it applied); usage locations for `--c-raised` and `--c-sage` (defined, tagged as likely-reserved since zero usages were found on the four fetched routes).
- **Nothing was guessed.** Where a value could not be observed (e.g., whether `--c-sage` has a real usage elsewhere in the app, such as inside the `/meera` "request access" form which likely has more interactive states not reachable via static GET), it is reported as unobserved rather than invented.

---

## Raw artifacts (`docs/website-research/brand/raw/`)

| File | Contents |
|---|---|
| `home.html`, `research.html`, `meera.html`, `company.html` | Full raw HTML, GET only |
| `careers.html`, `contact.html`, `principles.html` | Confirmed 404 responses (all three are anchors, not routes: `/company#careers`, `/company#contact`, `/#principles`) |
| `*.text.txt` | Extracted plain-text copy per page, line-numbered, tags stripped |
| `3intbjzc3zwnz.css` | Global Tailwind v4 bundle — all design tokens, global tag rules, shared utility classes |
| `0wx-z7y741wpk.css` | Homepage + Meera-page bespoke CSS Modules (story hero, portrait component) |
| `tokens_3int.txt`, `tokens_0wx.txt` | Extracted `--custom-property` declarations |
| `js_*.js`, `js_turbopack.js` | All JS chunks referenced from the homepage, for further fingerprinting if needed |
| `home.headers.txt` | Raw response headers from the homepage fetch |
