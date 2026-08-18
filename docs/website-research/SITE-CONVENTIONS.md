# Vyakti site conventions — a manual for build agents

Produced by WS-SITE-STUDY. Studied repo: local clone of the Vyakti.ai marketing
site, branch `claude/vyakti-research-website-a47qnq` @ `8fc2ec3`, read-only.
Next.js `16.3.0`, React `19.2.8`, Tailwind v4, GSAP, `motion`, `lenis`,
`three.js`. Every claim below cites the file it came from.

---

## READ THIS FIRST — the base this manual describes is not the live site

Mid-task, the coordinator flagged that the GitHub clone this document was
built from (`8fc2ec3`, dated 2026-08-12) is **stale**: the live
`vyakti.ai` deployment (fetched 2026-08-14, forensically reverse-engineered
in [`brand/BRAND.md`](./brand/BRAND.md) since no source repo for it exists)
was authored by a different agent and differs materially in content, tokens,
and IA. I did not independently verify the live site myself — I have no
network access to it — but I did verify that `brand/BRAND.md` is a real,
carefully-sourced artifact (it cites raw HTTP response headers, compiled CSS,
and fetched HTML saved under `brand/raw/`), and I spot-checked several of its
specific claims (the `/#principles` nav link, the five-pillar taxonomy)
directly against those raw files myself rather than taking the coordinator's
paraphrase on faith. One correction to the coordinator's own summary came out
of that check — see §0.2.

**Safe to build on regardless of which source tree turns out to be current**
(this is genuinely stack-level, not content-level, and both the clone and the
live site are built on it):
- §1 — Next.js 16.3 API/behavior digest (cited to `node_modules/next/dist/docs/`).
- §5 — animation house rules (durations, easings, spring config, reduced-motion) — the clone's tokens (`--duration-fast: 140ms` etc.) match the live site's own tokens almost exactly (see §0.2 table), so this is doubly confirmed, not just clone-only.
- §6 — the design-principles checklist from `.claude/skills/` — these are generic anti-slop rules, not Vyakti-specific content.
- §9 — build/lint/verify commands and the `prebuild` risk analysis.
- The **general shape** of the component inventory (§4) and page anatomy (§2) — header/footer/CTA/reveal/two-column-topic-block patterns are structurally confirmed on the live site by BRAND.md §5, even though exact copy and some class values differ.

**Must be re-derived once the true latest source arrives** (content- and
token-specific, confirmed to differ):
- Exact hex values for every `--c-*` token (§0.2 has both versions side by side).
- The pillar taxonomy and count (clone: 4; live: 5) and every pillar's id/name/tags.
- The nav item list (clone has no Principles item; live does, linking to `/#principles`).
- Dark mode strategy (clone ships a real dark/light system; live is light-only).
- Font stack (clone: Geist + Geist Mono only; live also self-hosts Noto Sans Devanagari for the wordmark glyph).
- Exact section counts/copy on `/research` (§8 gives both versions).

### 0.1 What the coordinator told me, verbatim (relayed, not independently confirmed beyond what I could check)

> The GitHub clone is stale. The repo's only branch (`claude/vyakti-research-website-a47qnq` @ `8fc2ec3`) is dated 2026-08-12, but the live `vyakti.ai` production deployment is dated 2026-08-14 and was pushed straight from a developer machine via the Vercel CLI (no git metadata on the deployment), so it was never committed to GitHub. The live site was authored by a different agent (Codex).

I have no way to verify the dates, the deploy mechanism, or "authored by Codex"
myself — I'm relaying that as the coordinator's claim, sourced to them, not as
something I confirmed. Everything else in this section I *did* check against
`brand/BRAND.md` and its `raw/` evidence directly.

### 0.2 Repo (clone) vs live — confirmed discrepancies

| Aspect | Clone (`8fc2ec3`, this document's base) | Live (`vyakti.ai`, per `brand/BRAND.md`) | My verification |
|---|---|---|---|
| Nav items | Research, Meera, Company (`src/lib/site.ts` `NAV`) | Research, Meera, **Principles**, Company, + "Meet Meera" CTA | Grepped `brand/raw/home.text.txt` myself: nav text is literally `Research / Meera / Principles / Company / Meet Meera` (appears twice, header + mobile). Grepped `brand/raw/home.html` for the href: **`/#principles`** — an anchor on the homepage, not a standalone route. (Correction to the coordinator's phrasing "a `/principles` route" — `brand/BRAND.md`'s own raw-artifacts table says `principles.html` was fetched and came back a **confirmed 404** as a standalone path; it only resolves as `/#principles`.) |
| Research pillars | 4: `turn-taking`, `affect`, `persona`, `culture` (`src/lib/site.ts` `PILLARS`) | 5: `identity`, `memory`, `perception`, `expression`, `agency` (`BRAND.md` §6) | Not independently re-fetched by me; relayed from `BRAND.md` §6, which cites `raw/research.html`. |
| Color tokens | `--c-ink:#12110e` (near-black), `--c-bone:#f4f1ea` (near-white), `--c-ember:#f0653a`, dark-mode-primary (`globals.css`) | `--c-ink:#f8f8f5` (near-white!), `--c-bone:#0c0e0d` (near-black!), `--c-ember:#c83f2d`, plus a live-only `--c-meera:#6f2342` token; **light-only** | `BRAND.md` §2.1 explicitly flags that `--c-ink`/`--c-bone` are inverted in meaning between light/dark relative to what the names suggest — I did not re-verify the hex values myself, relaying from `BRAND.md`. |
| Dark mode | Real: `:root` dark tokens + `@media (prefers-color-scheme: light)` override block, `viewport.colorScheme = "dark light"` (`globals.css`, `layout.tsx`) | **None.** `color-scheme: light` hard-set, zero `dark:` classes applied anywhere across all 4 fetched routes | `BRAND.md` §3, "high confidence," directly observed. |
| Fonts | Geist + Geist Mono only (`layout.tsx` imports `next/font/google`) | Geist + Geist Mono + **Noto Sans Devanagari** (500/600) for the "व्य" wordmark glyph, all self-hosted via `next/font` | `BRAND.md` §2.2. |
| `/research` structure | 4 pillar sections + Evaluation + closing CTA + hero (`src/app/research/page.tsx`, read in full, §8 below) | Hero + 5 pillar sections + Evaluation (12-col grid) + closing CTA, 6 sections total, only the Expression pillar has a supporting visual | `BRAND.md` §6, "fully observed" from `raw/research.html`. |
| Animation tokens | `--duration-fast:140ms`, `--duration-base:240ms`, `--duration-reveal:620ms`, `--ease-out-quint: cubic-bezier(.23,1,.32,1)` (`globals.css`) | `--duration-fast:.14s`, `--duration-base:.26s`, `--duration-reveal:.76s`, same `--ease-out-quint` curve | `BRAND.md` §2.3 — **close but not identical**: base and reveal durations differ (240ms→260ms, 620ms→760ms) though the easing curve and fast-duration are exact matches. Worth flagging rather than assuming byte-identical. |
| Reveal primitive | `[data-reveal="N"]` → `.is-revealed`, IntersectionObserver, `--reveal-delay` (`reveal.tsx`, read in full) | Same attribute pattern (`data-reveal="N"` → `.is-revealed`), mechanism inferred (not traced through minified JS) but CSS behavior matches | `BRAND.md` §2.3 and §5.11 — the live site's own uncertainty is "the exact JS wasn't traced," not the pattern's existence. |

**Practical implication for whoever builds next:** if the assignment is "extend
the site that's live at vyakti.ai," this whole document's *content* sections
(§2's exact page copy, §3's exact hex values, §7's `PILLARS` array, §8) describe
the **wrong tree** and must be re-derived from `brand/BRAND.md` plus a fresh
clone once one exists. If the assignment is "extend this specific cloned
branch as the source of truth" (which was this task's original, explicit
instruction), everything below is accurate as written. I did not have
instructions to reconcile the two trees or pick a winner, so I haven't — I've
documented both and flagged every place they diverge.

---

## 1. Next.js 16.3 — what's actually different from older Next

Everything below is quoted or paraphrased from `node_modules/next/dist/docs/`
inside the clone (confirmed present, `next@16.3.0` per its `package.json`).
This section is base-independent: it describes the framework, not the site's
content.

### 1.1 Cache Components / PPR is opt-in, and this repo does NOT opt in

`node_modules/next/dist/docs/01-app/01-getting-started/08-caching.md` documents
a large new caching model ("Cache Components," `use cache` directive, Partial
Prerendering) gated behind `cacheComponents: true` in `next.config.ts`. The
clone's `next.config.ts` is the untouched scaffold (`{ /* config options here */ }`)
— **Cache Components is OFF**. This means:

- The **previous caching model** applies:
  `node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`,
  which opens: *"This guide assumes you are not using Cache Components... If
  you're not using Cache Components, see the Caching and Revalidating
  (Previous Model) guide."*
- `fetch()` is **not cached by default** (`cache: 'force-cache'` opts in);
  route segment config (`export const dynamic`, `fetchCache`, `revalidate`)
  works as in Next 13-15.
- Do **not** write `'use cache'` / `cacheLife()` / `cacheTag()` into this
  codebase expecting them to do anything useful — they're real Next 16 APIs
  but they're inert without the config flag, and turning the flag on is a
  cross-cutting decision, not something to slip into one new page.
- **Gotcha for whoever builds next:** if a future agent reads about Cache
  Components anywhere (blog posts, training data, this very doc) and reaches
  for `'use cache'` on a new page, it will silently do nothing useful here.
  Flip `cacheComponents: true` deliberately and audit the whole site's runtime
  API usage against `08-caching.md`'s Suspense-boundary requirements first.

### 1.2 `params` and `searchParams` are Promises — must be awaited

`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md`:
> "Since the `params` prop is a promise, you must use `async/await` or React's
> `use` function to access the values... In version 14 and earlier, `params`
> was a synchronous prop."

Same file for `searchParams`: it's a `Promise`, and reading it "opt[s] the
page into dynamic rendering at request time" (this repo has no routes that
read `searchParams` today — all four pages are static).

None of this site's current pages use dynamic segments (`[slug]`) or
`searchParams`, so this is forward-looking only, but it's the #1 thing that
breaks when a training-data-era agent writes a new dynamic route.

### 1.3 `PageProps<'/route'>` / `LayoutProps<'/route'>` typed helpers (new)

`page.md`: *"You can type pages with `PageProps` to get strongly typed
`params` and `searchParams` from the route literal... `PageProps` is a
globally available helper... Types are generated during `next dev`, `next
build`, or with `next typegen`. After type generation, the `PageProps` helper
is globally available. It doesn't need to be imported."*

`layout.md` documents the same for `LayoutProps<'/route'>`, including typed
named slots for parallel routes.

**This repo already uses it**: `src/app/layout.tsx` line 88 —
`export default function RootLayout({ children }: LayoutProps<"/">) {`. No
import for `LayoutProps` appears anywhere in the file — confirming it's the
ambient global the docs describe. Any new page/layout should follow this
pattern (`PageProps<'/research'>`, `LayoutProps<'/meera'>`) instead of
hand-writing `{ params: Promise<{...}> }` types.

### 1.4 `middleware.js` is deprecated → renamed to `proxy.js`

`node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/middleware.md`
(marked `version: draft`):
> "The `middleware.js` file convention has been **deprecated** in Next.js 16
> and renamed to `proxy.js`... All functionality remains the same — only the
> file and export names have changed." A codemod exists:
> `npx @next/codemod@canary middleware-to-proxy .`

The clone has neither file today (`find src/app -maxdepth 1 -iname
"proxy.ts" -o -iname "middleware.ts"` returns nothing). **Gotcha:** if a future
agent needs request-level logic (auth gate, geo-redirect, A/B split), write
`src/proxy.ts`, not `src/middleware.ts` — the old name is deprecated-but-still-
documented, and training data will default to the old name.

### 1.5 Server vs Client Components — standard React 19 RSC rules, confirmed unchanged

`node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md`
(read in full): pages/layouts are Server Components by default; `'use client'`
marks a **boundary**, not a single file — everything that file imports and
directly renders joins the client bundle; Server Components can still be
passed as `children`/props into Client Components (the `<Modal><Cart/></Modal>`
pattern); `generateMetadata`/`metadata` export are **Server-Component-only**
(`generate-metadata.md` — *"metadata must be resolved on the server before the
page component is rendered"*); React Context requires a Client Component
wrapper. Nothing here differs from the general RSC model — the site follows it
correctly already (every `page.tsx` is a plain Server Component; every
interactive piece — `Reveal`, `SiteHeader`, `SmoothScroll`, `HeroStage`,
`HeadPortrait`, `head/index.tsx`, `head/head-scene.tsx` — is `'use client'` at
the top).

### 1.6 Metadata API — object or `generateMetadata`, never both

`generate-metadata.md`: static `metadata` export vs. dynamic `generateMetadata`
function; *"You cannot export both the `metadata` object and `generateMetadata`
function from the same route segment."* Every page in this repo uses the
static `metadata: Metadata` object (see §2) since none of the four routes need
per-request data for their `<head>`.

### 1.7 Route segment config (previous-model caching, since Cache Components is off)

From `caching-without-cache-components.md`:
`export const dynamic = 'auto' | 'force-dynamic' | 'error' | 'force-static'`,
`fetchCache`, `revalidate` (must be a statically-analyzable literal — `600` is
valid, `60 * 10` is not) — none of these are set anywhere in the clone today
(no route needs them; every page is plain static content with no data
fetching).

### 1.8 What I could NOT verify

- I did not run `next build`/`next dev` myself in this session — I read the
  docs and the source, but did not execute a build to confirm the digest above
  against real compiler output. (Build/lint commands are documented in §9 for
  whoever runs them.)
- I did not check `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/next-root-params.md`
  or the full parallel-routes/intercepting-routes docs in depth — the site has
  no parallel routes, `@slot` folders, or intercepted routes today, so I
  prioritized the docs that map to what exists or what's likely to be added
  (research figures, new sections) over exhaustive coverage of unused features.

---

## 2. Routing + file layout (clone tree — see §0.2 if the live tree differs here)

```
src/app/
  layout.tsx          root layout: fonts, metadata, viewport, <html>/<body>, global chrome
  globals.css          all design tokens + base/utility/component layers
  page.tsx              /
  research/page.tsx     /research
  meera/page.tsx         /meera
  company/page.tsx       /company
  icon.tsx               generated favicon (ImageResponse, 32x32)
  opengraph-image.tsx    generated site-level OG image (1200x630, ImageResponse)
  not-found.tsx           404 UI
  robots.ts               MetadataRoute.Robots
  sitemap.ts               MetadataRoute.Sitemap (hand-lists the 4 URLs + priority/changeFrequency)
```
(`find src/app -type f`, confirmed exhaustive — this is the entire `app/`
tree; no route groups, no dynamic segments, no parallel/intercepted routes,
no `loading.tsx`/`error.tsx`/`template.tsx` anywhere.)

### Anatomy of a page (read all four in full: `page.tsx`, `research/page.tsx`,
`meera/page.tsx`, `company/page.tsx`)

Every page follows the same shape:

1. **Imports**: `type { Metadata }` from `"next"`, any needed components
   (`@/components/...`), and content from `@/lib/site` (`SITE`, `PILLARS`,
   etc. as needed).
2. **`export const metadata: Metadata`** — always includes `title`,
   `description`, `alternates: { canonical: "/path" }`, and (except the
   homepage) an `openGraph: { title, description, url }` override. The
   homepage relies on the root layout's `title.template` (`"%s | Vyakti"`)
   instead of repeating the brand name.
3. **Default export function**, PascalCase + `Page` suffix (`HomePage`,
   `ResearchPage`, `MeeraPage`, `CompanyPage`) — no props destructured on any
   current page (none read `params`/`searchParams`).
4. **A `<>...</>` fragment of `<section>` elements**, each:
   - full-bleed background: `bg-ink` or `bg-void`, alternating for rhythm.
   - `border-t border-hairline` (occasionally `border-b`) so sections read as
     a single ruled column, never boxed.
   - vertical rhythm: `py-24 md:py-32` is the dominant pattern; hero-ish
     sections use `pt-32 pb-20 md:pt-40 md:pb-28`; the tightest sections
     (closing CTAs) use `py-20 md:py-28`.
   - inner wrapper `<div className="shell">` (max-width 1240px) or
     `shell-narrow` (760px, centered CTAs) for horizontal rhythm.
   - `data-reveal="N"` on the elements that should animate in (see §5).
5. **Inline content arrays** for repeated small items (`CAPABILITIES` in
   `meera/page.tsx`, `ROLES` in `company/page.tsx`, an anonymous array in
   `page.tsx`'s Meera-capabilities section) rather than pulling everything
   from `site.ts` — only genuinely cross-page content (`PILLARS`, `NAV`,
   `FOOTER_GROUPS`) lives centrally. Page-specific lists live next to their
   page.

### Layout composition (`src/app/layout.tsx`, read in full)

- `Geist`/`Geist_Mono` from `next/font/google`, both `display: "swap"`,
  exposed as CSS variables (`--font-geist`, `--font-geist-mono`) consumed by
  `globals.css`'s `@theme`.
- `metadataBase`, full OpenGraph/Twitter/robots block, `keywords`, `category`
  — a genuinely complete SEO metadata object, all sourced from `SITE`.
- `viewport.themeColor` is **media-conditional** (`prefers-color-scheme`) —
  the two brand colors (`#12110E` dark, `#F6F6F4` light) rather than one flat
  value.
- Body order is fixed and matters: `<StructuredData/>` → skip-link → `<SmoothScroll/>`
  → `<Reveal/>` → `<SiteHeader/>` → `<main id="main">{children}</main>` →
  `<SiteFooter/>`. `SmoothScroll` and `Reveal` render `null` (they're pure
  side-effect components) but must mount above `main` so their effects attach
  before content paints.
- A `no-js` class is stripped from `<html>` by an inline blocking `<script>`
  before paint — `globals.css`'s `.no-js [data-reveal] { opacity: 1; transform: none }`
  rule means JS-disabled visitors see fully-revealed content instead of
  permanently-hidden `opacity: 0` elements.

---

## 3. Styling system (`src/app/globals.css`, read in full — 273 lines)

### 3.1 Tailwind v4 setup

- `@import "tailwindcss";` — the v4 single-import form, no `@tailwind base/components/utilities` directives (those are v3). Confirmed by `package.json`'s `@tailwindcss/postcss` devDependency (the v4 PostCSS plugin) and `postcss.config.mjs`.
- **`@theme { ... }`** block maps every design token to a Tailwind-consumable CSS variable (`--color-void: var(--c-void)`, etc.) — this is the v4 "CSS-first config" mechanism; there is no `tailwind.config.js`/`.ts` file in the repo (confirmed: not present in the file listing).
- Actual color **values** live in a separate `:root { --c-void: #0a0907; ... }` block, then get remapped for light mode inside `@media (prefers-color-scheme: light) { :root { ... } }`. The indirection (`--color-X: var(--c-X)`, then `--c-X` redefined per mode) is deliberate: it's what lets `bg-void`/`text-bone`/etc. utility classes stay mode-agnostic in the JSX while the actual hex flips underneath.

### 3.2 Every design token defined

**Colors** (`--c-*`, dark values in `:root`, light overrides in the
`prefers-color-scheme: light` media query):

| Token | Dark | Light | Role (per the file's own comment) |
|---|---|---|---|
| `--c-void` | `#0a0907` | `#eceae5` | deepest background |
| `--c-ink` | `#12110e` | `#f6f6f4` | primary section background |
| `--c-surface` | `#191713` | `#ffffff` | raised card background |
| `--c-raised` | `#211e19` | `#ffffff` | further-raised background |
| `--c-hairline` | `#2c2922` | `#dedbd4` | all borders/dividers |
| `--c-bone` | `#f4f1ea` | `#16140f` | primary text |
| `--c-ash` | `#a49d91` | `#57524a` | secondary/body text |
| `--c-slate` | `#7a746a` | `#5f594f` (darkened for AA, per comment) | tertiary/label text |
| `--c-ember` | `#f0653a` | `#c8431a` (darkened for AA, per comment) | the one accent |
| `--c-sage` | `#7fc8a9` | `#1f6b4f` | defined, secondary accent, not used on any current page (grepped — zero usages in `src/`) |
| `--c-on-ember` | `#14120e` | `#ffffff` | text color for solid-ember fills, flips per mode so contrast holds both ways |

**Fonts**: `--font-sans: var(--font-geist), ui-sans-serif, system-ui, sans-serif`;
`--font-mono: var(--font-geist-mono), ui-monospace, "SF Mono", monospace`.

**Type scale** (fluid, `clamp()`-based, 360px→1440px per the file's comment):
`--text-eyebrow: 0.6875rem` (fixed) · `--text-micro: 0.75rem` (fixed) ·
`--text-small: 0.875rem` (fixed) · `--text-body: clamp(0.9375rem, 0.89rem + 0.22vw, 1.0625rem)` ·
`--text-lead: clamp(1.0625rem, 0.98rem + 0.4vw, 1.3125rem)` ·
`--text-h3: clamp(1.25rem, 1.11rem + 0.62vw, 1.75rem)` ·
`--text-h2: clamp(1.75rem, 1.35rem + 1.75vw, 3.25rem)` ·
`--text-h1: clamp(2.5rem, 1.72rem + 3.45vw, 5.25rem)`.

**Motion**: `--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1)` ·
`--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1)` ·
`--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)` ·
`--duration-fast: 140ms` · `--duration-base: 240ms` · `--duration-slow: 420ms` ·
`--duration-reveal: 620ms`. Comment: *"One easing family. Never ease-in on
UI."* — matches the `.claude/skills` house rules exactly (§5/§6 below).

**Radii** ("shape lock" per the file's comment — one system, applied
everywhere): `--radius-sm: 8px` · `--radius: 12px` · `--radius-lg: 18px`.
Interactive elements (buttons, CTAs, nav pills) are `rounded-full`
independently of this scale; containers use the `--radius-*` tokens.

### 3.3 Dark/light strategy

`color-scheme: dark` is the `:root` default; a `@media (prefers-color-scheme:
light)` block overrides both `color-scheme` and every `--c-*` token. There is
**no `data-theme` attribute, no `.dark` class, no theme toggle** anywhere in
the source — the site follows system preference only, with no manual
override. `viewport.colorScheme = "dark light"` in `layout.tsx` and the
media-conditional `themeColor` array are what tell the browser chrome (and
`prefers-color-scheme`-aware OS UI) both modes are genuinely supported.
**(Contrast with the live site: per §0.2, the live deployment is light-only —
this dual-mode system is a clone-only trait, not yet confirmed on the tree
that's actually shipping.)**

### 3.4 Base layer highlights (`@layer base`)

- Every element's `border-color` defaults to `var(--color-hairline)` (`*, *::before, *::after { border-color: ... }`) — so any bare `border` utility never needs an explicit color.
- Lenis integration CSS: `html.lenis, html.lenis body { height: auto }`, `html.lenis { scroll-behavior: auto }` (native smooth scroll would fight Lenis), `[data-lenis-prevent] { overscroll-behavior: contain }` (for nested scroll containers that should opt out of Lenis).
- `::selection` tinted with the ember accent via `color-mix(in oklab, ...)`.
- `:focus-visible` gets a 2px ember outline — a deliberate, visible focus ring (not `outline: none`).
- `h1`-`h4` get `font-weight: 500` and `text-wrap: balance` globally; `h1`/`h2`/`h3` get their `font-size`/`line-height`/`letter-spacing` set as bare-tag rules from the type-scale tokens (tracking tightens as size grows — `h1: -0.035em`, `h2: -0.028em`, `h3: -0.018em`), so **you get correct heading typography by writing `<h1>`/`<h2>`/`<h3>` with no utility classes at all**, only overriding when a heading needs a narrower `max-w` or a color override.
- Custom scrollbar styling (`::-webkit-scrollbar*`) matched to the token palette.

### 3.5 Utility layer — recurring class strings to reuse verbatim

- `.shell` — `max-width: 1240px; margin-inline: auto; padding-inline: clamp(1.25rem, 5vw, 3.5rem)` — the standard page container, used in every section on every page.
- `.shell-narrow` — same padding, `max-width: 760px` — used for centered CTA sections.
- `.measure` — `max-width: 62ch` — applied to any paragraph that needs a readable line length regardless of its container's width.
- `.eyebrow` — mono, `0.6875rem`, `0.16em` tracking, uppercase, `text-slate` — the section-kicker label. **Used sparingly** — grepped across all 4 pages: appears on `research/page.tsx` (Evaluation), `company/page.tsx` (Careers), `page.tsx` (Research section) — roughly 1 per 2-3 sections, consistent with the `.claude/skills` eyebrow-restraint rule (§6 below).
- `.rule` — a hairline that fades at both ends via `linear-gradient` — used once, in the footer, between the link grid and the copyright row.

### 3.6 Component layer — the reveal primitive

```css
[data-reveal] {
  opacity: 0;
  transform: translate3d(0, 16px, 0);
  transition: opacity var(--duration-reveal) var(--ease-out-quint),
              transform var(--duration-reveal) var(--ease-out-quint);
  transition-delay: var(--reveal-delay, 0ms);
  will-change: transform, opacity;
}
[data-reveal].is-revealed { opacity: 1; transform: none; will-change: auto; }
.no-js [data-reveal] { opacity: 1; transform: none; }
```
Plus a top-level `@media (prefers-reduced-motion: reduce)` block that zeroes
all transition/animation durations globally and forces `[data-reveal]` to its
revealed state unconditionally. This is the **entire** CSS side of the reveal
system — the JS side is `src/components/reveal.tsx` (§4 below).

---

## 4. Component inventory (`src/components/`, every file read)

| Component | Props | Renders | When to use |
|---|---|---|---|
| `site-header.tsx` (`'use client'`) | none | Fixed header, transitions from transparent to `bg-ink/70 backdrop-blur-xl` once the page scrolls past a sentinel `<div>` (IntersectionObserver, not a scroll listener). Desktop nav from `NAV`, active-link underline via a `scale-x` transform, "Request access" pill CTA, and a full mobile menu with a hamburger→X icon animation and `overflow: hidden` body-lock while open. | Once, in root `layout.tsx`. Never re-instantiate per page. |
| `site-footer.tsx` | none | 4-column grid: wordmark + tagline + email (col 1), then `FOOTER_GROUPS.map(...)` for the other 3 columns, then a `.rule` divider, then copyright + the required CC-BY-3.0 head-model attribution line. | Once, in root `layout.tsx`. |
| `reveal.tsx` (`'use client'`) | none | Renders `null`. One shared `IntersectionObserver` (`rootMargin: "0px 0px -12% 0px", threshold: 0.08`) for every `[data-reveal]` element on the page; adds `.is-revealed` and unobserves once triggered (reveals once, never re-animates on scroll-back). Reads `data-reveal`'s numeric value as a stagger index, converts to a `--reveal-delay` of `index * 80ms`. Short-circuits entirely (adds `.is-revealed` to everything immediately, no observer) when `prefers-reduced-motion: reduce`. | Mount once in root layout. Any new section's animated children just need `data-reveal="0"`, `data-reveal="1"`, etc. — no new JS. **This is the scroll-reveal primitive any new page/section should use for entrance motion**, rather than reaching for GSAP ScrollTrigger or Motion's `whileInView` for a plain fade-up. |
| `smooth-scroll.tsx` (`'use client'`) | none | Instantiates Lenis (`duration: 1.05`, custom exponential ease-out, `touchMultiplier: 1.6`), runs its own `requestAnimationFrame` loop, and publishes scroll progress onto `<html>` as the CSS custom property `--scroll-progress` (0→1) plus a `data-scrolled` boolean attribute — a **single shared source of scroll truth** other components/CSS can read instead of registering their own listeners. No-ops entirely under `prefers-reduced-motion: reduce`. | Mount once in root layout. Any component that needs scroll position should read `--scroll-progress` off `<html>` rather than adding a second scroll listener. |
| `structured-data.tsx` | none | One `<script type="application/ld+json">` with an `@graph` of `Organization` + `WebSite` + `SoftwareApplication` (Meera) nodes, all sourced from `SITE`. | Once, in root layout. If a new top-level product/page is added, extend the `@graph` array here rather than adding a second JSON-LD script tag (the comment explicitly says this is deliberate — "so search engines get a single graph rather than competing top-level entities"). |
| `hero-stage.tsx` (`'use client'`) | none | The homepage's pinned, scroll-driven hero: a `320vh` runway with a `sticky` inner stage; three copy "beats" cross-fade based on scroll progress (computed in a private `requestAnimationFrame` loop, written to CSS custom properties `--beat-0/1/2`, never to React state) over the `VyaktiHead` WebGL point-cloud face. | Homepage only — it's a bespoke, single-use hero, not a reusable pattern. Study it as the reference for "how this codebase does a pinned scroll narrative without re-rendering React on every scroll frame" if a future scroll-driven section is needed elsewhere. |
| `head-portrait.tsx` (`'use client'`) | `className?: string` | Same `VyaktiHead` WebGL face, but idle/ambient instead of scroll-driven: a slow sine-wave drift of the `progress` value on a 17-second period, so the face is "never perfectly still, and never busy" (file's own comment). | Used on `/meera` as a static-position portrait. Reach for this (not `hero-stage.tsx`) whenever the face is wanted without a scroll narrative attached. |
| `head/index.tsx` (`'use client'`) | `VyaktiHead({ progress: {current:number}, className? })`, exported `useWebglAllowed()` hook, exported `HeadFallback` component | Dynamically imports `head-scene.tsx` with `ssr: false`; gates on both `prefers-reduced-motion` and a cached WebGL-support probe via `useSyncExternalStore` (so the fallback renders correctly on the server and swaps client-side without an effect-driven state update); renders a soft radial-gradient `HeadFallback` when WebGL/motion isn't available. | The single entry point for "the face" — never import `head-scene.tsx` directly; always go through `VyaktiHead`. |
| `head/head-scene.tsx` (`'use client'`, dynamically imported) | `{ progress: {current:number} }` | The actual `@react-three/fiber` scene: loads `/models/head-geo.glb`, samples it into a point cloud (`MeshSurfaceSampler`, seeded PRNG for determinism), custom vertex/fragment shaders (`head/shaders.ts`) for depth-based shading. `SAMPLE_COUNT`/`SAMPLE_COUNT_MOBILE` split for perf. | Not directly reusable as-is (it's tightly coupled to this one model), but the pattern — GLTF → sampled point cloud → custom shader, driven by a plain mutable `progress` object rather than React state — is the template for any future "data made physical" 3D visual. |
| `turn-diagram.tsx` | none (static content, `EXCHANGE` array hardcoded in the file) | A conversation-analyst-style annotated transcript: speaker-labeled lines plus inline "seam" annotations (`overlap`/`gap`) with a colored left border, wrapped in a `<figure>` with a `<figcaption>` disclaiming it's "an illustration ... not measurements from a run." | **This is the sibling pattern for new research figures.** Any new custom data visual for `/research` should match its shape: a `<figure>` in `rounded-[var(--radius-lg)] border border-hairline bg-surface p-6 sm:p-8`, a monospace/small-caps label column, an honest `<figcaption>` that states what the figure is (and isn't) rather than implying it's real measured data unless it genuinely is. It's used twice today — inline on the homepage's turn-taking section, and inside `research/page.tsx`'s `turn-taking` pillar block (conditionally rendered only for that one pillar id). |
| `ui/cta.tsx` | `{ href: string; children: ReactNode; variant?: "primary"\|"secondary" }` + any `Link` prop except `href`/`children` | A `next/link`-wrapped pill button. `primary`: `bg-ember text-on-ember hover:bg-ember/90`. `secondary`: `border border-hairline text-bone hover:border-ash hover:bg-surface`. Both share `active:scale-[0.98]`, `whitespace-nowrap`, `--duration-fast`/`--ease-out-quint` transitions. | **The only CTA component in the codebase** — every button-shaped link on every page goes through this, never a hand-rolled `<Link className="...">`. |

---

## 5. Animation conventions

### 5.1 What the codebase actually does (not just what the skills prescribe)

- **Scroll reveal**: `[data-reveal="N"]` + `reveal.tsx`'s single IntersectionObserver, as documented in §3.6/§4. This is used far more than GSAP or Motion — it's the default entrance animation for essentially every section on every page.
- **Smooth scroll**: Lenis, wired in `smooth-scroll.tsx`, feeding `--scroll-progress` to CSS/WebGL. GSAP's `ScrollTrigger` is **not currently used anywhere** in `src/` despite being a devDependency-adjacent skill topic — the pinned hero (`hero-stage.tsx`) hand-rolls its own scroll-progress `requestAnimationFrame` loop instead of reaching for ScrollTrigger. **Gotcha for a new pinned/scrubbed section:** the established house pattern is a private rAF loop writing CSS custom properties (see `hero-stage.tsx`), not GSAP ScrollTrigger, even though GSAP is installed. Match the existing pattern unless there's a specific reason ScrollTrigger's pin/snap machinery is needed.
- **`motion` package**: installed (`package.json`) but **not imported anywhere in `src/`** (grepped `from "motion` and `from 'motion` — zero hits). It's available but unused; nothing here should be assumed to already use Motion's spring/gesture system.
- **Reduced motion**: handled at three independent layers — CSS (`@media (prefers-reduced-motion: reduce)` in `globals.css`, zeroes all transition/animation durations and force-reveals `[data-reveal]`), `reveal.tsx` (checks `matchMedia` once, skips the observer entirely), and every WebGL/scroll component (`smooth-scroll.tsx`, `head-portrait.tsx`, `head/index.tsx`'s `canRunScene()`) independently checks the same media query before doing any work. **No single global "reduced motion" React context** — each component re-checks `matchMedia` itself. Match this pattern (don't introduce a context) for consistency.

### 5.2 House rules from `.claude/skills/animate/SKILL.md`, `DESIGN-PRINCIPLES.md` §1-7, `review-animations/STANDARDS.md`, and `apple-design/SKILL.md` (all cross-checked, and they agree with each other and with `globals.css`'s own tokens)

**Gate — should it animate at all?**

| Frequency the user sees it | Verdict |
|---|---|
| 100+/day (keyboard shortcuts, palette toggles) | No animation, ever |
| Tens/day (hover, list nav) | Near-imperceptible only, or nothing |
| Occasional (modals, drawers, toasts) | Standard animation |
| Rare/first-time (onboarding, success) | Delight budget lives here |

Name the purpose in one word before writing code: **feedback, spatial
consistency, state indication, preventing a jarring change, explanation**
(marketing/onboarding only), or **delight** (rare-tier only). "Looks cool" on
a frequent element is not a valid purpose.

**Easing, decision order:** entering/exiting → `ease-out` (site's
`--ease-out-quint: cubic-bezier(0.23, 1, 0.32, 1)`); moving/morphing on screen
→ `ease-in-out` (site's `--ease-in-out: cubic-bezier(0.77, 0, 0.175, 1)`);
hover/color → bare `ease`; constant motion (marquee, progress) → `linear`.
**Never `ease-in` on UI.**

**Duration budgets:** button press 100-160ms; tooltips/small popovers
125-200ms; dropdowns/selects 150-250ms; modals/drawers 200-500ms;
marketing/explanatory can be longer. **UI animations stay under 300ms.** The
site's own tokens (`--duration-fast: 140ms`, `--duration-base: 240ms`,
`--duration-slow: 420ms`) sit inside these bands; `--duration-reveal: 620ms`
is the deliberate exception for the once-per-element scroll entrance, which
the "marketing/explanatory can be longer" row licenses.

**Properties:** animate only `transform` and `opacity` (GPU-composited,
skip layout/paint); `clip-path` is the sanctioned fourth; `height` tolerated
only for accordions. Never `transform: scale(0)` as an entrance — start at
`scale(0.9-0.97)` + `opacity: 0` (the site's own `[data-reveal]` uses
`translate3d(0, 16px, 0)` + `opacity: 0`, consistent with this). In Motion (if
ever introduced), use the full transform string (`transform:
"translateX(100px)"`), not the `x`/`y`/`scale` shorthand props — those aren't
hardware-accelerated and drop frames under load.

**Springs (Apple-design skill), if a gesture-driven interaction is ever
added:** default to critically-damped (`damping: 1.0`, `response 0.3-0.4s`),
add bounce (`damping ~0.8`) only when the gesture itself carried momentum (a
flick/drag release) — never on a menu that just faded in. Always animate from
the current on-screen (presentation) value on interrupt, never the logical
target. Velocity handoff on drag release:
`relativeVelocity = gestureVelocity / (targetValue - currentValue)`.

**Stagger:** 30-80ms between items for group entrances (the site's
`reveal.tsx` uses exactly `index * 80ms`). Never block interaction while
stagger plays.

**GSAP, if used:** `ease: 'none'` whenever `scrub` is active (any real easing
feels wrong once motion is scroll-linked) — this is a hard, frequently-missed
rule, worth restating even though the site doesn't currently use ScrollTrigger.

**Never ship** (from `animate/SKILL.md`'s own table, cross-checked against
this site's CSS — the site currently violates none of these): `transition:
all`; `transform: scale(0)` entrances; `ease-in` on UI; a built-in weak
`ease-out` instead of the strong custom curve; animation on a keyboard
shortcut or 100+/day action; UI duration over 300ms with no stated reason;
`transform-origin: center` on a trigger-anchored popover (modals are exempt);
keyframes on toasts/toggles/rapidly-retriggered elements (use transitions,
which retarget from the current value; keyframes restart from zero);
animating `width`/`height`/`margin`/`padding`/`top`/`left`; Motion `x`/`y`/`scale`
shorthand under load; ungated `:hover` motion (gate with `@media (hover: hover)
and (pointer: fine)`); missing `prefers-reduced-motion`; everything entering
at once with no stagger.

---

## 6. Design-principles checklist (distilled from `.claude/skills/DESIGN-PRINCIPLES.md`,
`apple-design/SKILL.md`, `taste-skill/SKILL.md` — all read; `taste-skill` is
1206 lines, read selectively at its highest-signal sections: dials/architecture
§1-4, AI-tells §9, final pre-flight §14)

A build agent should verify a new page/section against every line:

**Content & copy**
- [ ] Zero em-dashes (`—`) anywhere visible — headline, eyebrow, body, quote, caption, button, alt text. Zero tolerance, not "sparingly." (`taste-skill` §9.G, `DESIGN-PRINCIPLES.md` §12 — the single most-repeated LLM tell both documents call out independently.)
- [ ] No generic names/avatars/brand-slop verbs ("Elevate," "Unleash," "Acme," "John Doe"). No fake-precise unsourced numbers (`92%`, `4.1×`).
- [ ] No section-number eyebrows (`00 / INDEX`), no version labels in a hero (`V0.6`, `BETA`), no scroll cues (`↓ Scroll to explore`).

**Layout**
- [ ] Hero fits the initial viewport: headline ≤ 2 lines, subtext ≤ 20 words and ≤ 4 lines, CTA visible with no scroll; top padding capped at `pt-24` desktop; max 4 text elements (eyebrow OR brand strip, headline, subtext, CTAs) — no trust micro-strip or pricing teaser inside the hero itself.
- [ ] **Eyebrow restraint**: `.eyebrow` usage ≤ `ceil(sectionCount / 3)` across the page (hero counts as 1). This site already respects it — see §3.5.
- [ ] **Section-layout-repetition ban**: a layout family (two-column topic block, full-width quote, sticky-heading list) appears once per page family; an 8-section page needs ≥4 different layout families. Max 2 consecutive image+text zig-zag splits.
- [ ] Shape-consistency lock: one corner-radius system for the whole page (this site: `--radius-sm/--radius/--radius-lg` for containers, `rounded-full` for every interactive element — confirmed consistent across all 4 pages).
- [ ] Color-consistency lock: one accent (`--c-ember`) used identically everywhere — confirmed, no second accent appears anywhere in `src/`.
- [ ] **Note a live tension worth flagging, not silently "fixing":** `taste-skill` §4.7 bans the "left big headline + right small explainer paragraph" split-header pattern by default. This site's homepage (Research-tracks section, `page.tsx`) and `research/page.tsx` (Evaluation section) both use exactly that shape — sticky/fixed left column with a heading, flexible right column with body content. This is allowed under the skill's own exception ("only when there is a real compositional reason... the right column carries a visual or interactive element, not just filler text") since the right columns carry a real content list (`PILLARS.map`) or a `<dl>` stat block, not filler prose — but a future agent adding a *third* instance of this exact shape should stop and check whether it's still earning the exception, not assume it's free.

**Buttons/forms/a11y**
- [ ] Button-contrast check (WCAG AA, 4.5:1 body / 3:1 large) on every CTA — this site's `Cta` component (§4) already encodes both variants correctly.
- [ ] CTA labels fit one line; no duplicate CTA intent on one page (this site: "Request access" is used consistently for the Meera-access intent across nav, hero, and homepage closing CTA — don't introduce a synonym like "Get started" for the same action).
- [ ] `prefers-reduced-motion` and `hover`/`pointer` media queries handled everywhere motion exists (confirmed for existing components in §5.1).

**Typography/color**
- [ ] Serif is not the default; if ever used, not `Fraunces`/`Instrument_Serif` (moot here — the site is Geist-only sans, no serif anywhere).
- [ ] Tracking is size-specific (tighter on large display type, near-zero on body) — already encoded in `globals.css`'s bare `h1`/`h2`/`h3` rules (§3.4).
- [ ] Italic descender clearance (`leading-[1.1]` min + `pb-1`) for any italic word containing `y g j p q` — not currently applicable (no italic type used anywhere in `src/`), but binding if introduced.

**Pre-flight mechanical checks worth running on any new page** (from
`taste-skill/SKILL.md` §14, condensed to what's non-obvious): count
`uppercase tracking` instances and compare to `ceil(sectionCount/3)`; grep the
rendered copy for `—`/`–` before shipping; confirm both light and dark
rendering are checked, not assumed (this repo's dark/light split is real and
tested per `globals.css`'s structure — don't add a component that only
renders correctly in one mode).

---

## 7. Content model (`src/lib/site.ts`, read in full)

Single file, four exports, all `as const`:

- **`SITE`** — name, domain, url, tagline, description, locale, twitter
  handle, email, careers email. Consumed by `layout.tsx` (metadata),
  `structured-data.tsx` (JSON-LD), `site-footer.tsx`, `meera/page.tsx` and
  `company/page.tsx` (mailto CTAs).
- **`NAV`** — `{ label, href }[]`, 3 items today (Research, Meera, Company).
  Consumed by `site-header.tsx` (desktop + mobile nav).
- **`FOOTER_GROUPS`** — `{ title, links: {label, href}[] }[]`, 3 groups
  (Research, Product, Company). **This is the file that documents every
  in-page anchor a new page must keep resolvable**: `/research`,
  `/research#turn-taking`, `/research#affect`, `/research#persona`,
  `/research#culture`, `/research#evaluation`, `/meera`,
  `/meera#capabilities`, `/meera#access`, `/company`, `/company#careers`,
  `/company#contact`. **Any restructuring of `/research`'s pillar IDs must
  update both `PILLARS` (which drives the `id` attributes on
  `research/page.tsx`'s `<article>` elements) and this array in lockstep, or
  the footer will 404-anchor.**
- **`PILLARS`** — the four research tracks (`turn-taking`, `affect`,
  `persona`, `culture`), each `{ id, title, summary, detail, terms: string[] }`.
  Drives: the homepage's "Research" section (`summary` + `terms`), the entire
  `research/page.tsx` pillar-by-pillar body (`title`/`summary`/`detail`/`terms`,
  plus the `id` used both as the DOM anchor and as the conditional-render key
  for `<TurnDiagram/>` on the `turn-taking` pillar specifically).

**How a new research section should extend this file (clone-tree instructions
— re-derive against the live 5-pillar taxonomy per §0.2 if that's the actual
target):** add a new entry to `PILLARS` with a unique `id`, then add the
matching anchor(s) to `FOOTER_GROUPS`'s Research group so the footer link list
and the actual page stay in sync — the codebase has no automated check for
this, it's a manual convention enforced by both files being small and
adjacent. If the new section needs its own custom figure (like
`turn-diagram.tsx`), follow the pattern in §4's `turn-diagram.tsx` row:
conditionally render it inside the pillar loop keyed on the new `id`, not as a
separate hardcoded section.

---

## 8. The existing `/research` page

### 8.1 Clone version (`src/app/research/page.tsx`, read in full — this is
what §0.2 flags as possibly superseded)

Structure, top to bottom:
1. Hero (`bg-ink`, `pt-32 pb-20 md:pt-40 md:pb-28`): `<h1>` "The gap is not
   intelligence. It is behaviour." + one lead paragraph.
2. `PILLARS.map(...)` — 4 `<article>` sections, alternating `bg-ink`/`bg-void`,
   each `id={pillar.id}` with `scroll-mt-24` (so anchor scrolling clears the
   fixed header), two-column grid (label column: title + tag pills; content
   column: summary + detail + conditionally `<TurnDiagram/>` for
   `turn-taking` only).
3. Evaluation (`id="evaluation"`): 12-col grid, eyebrow + `<h2>` in the left,
   a lead paragraph + a 4-row `<dl>` (held-conversation-not-single-turns,
   judgement-by-the-person, failure-located-not-counted, adversarial-partners)
   in the right, offset `col-start-6`.
4. Closing CTA (`bg-void`, `.shell-narrow`, centered): "Work on this with us."
   + one sentence + one `Cta` linking `/company#careers`.

**What it currently claims:** the four-pillar taxonomy (turn-taking, affect,
persona, culture) as the lab's organizing structure; that evaluation happens
through held conversation with a real person who is trying to tell, not
single-turn scoring; that failures are localized to a moment and a reason,
not just counted. Any new research content added to this page must not
contradict these claims (e.g., don't introduce a benchmark-score framing that
implies single-turn evaluation is sufficient — the page explicitly argues
against that).

### 8.2 Live version, per `brand/BRAND.md` §6 (full structural + gap audit
already written by the brand agent — summarized here, not re-derived)

6 sections: hero ("Personality is not a system prompt.") → 5 pillar blocks
(Identity, Memory, Perception, Expression, Agency — only Expression has a
supporting visual, the transcript card) → Evaluation (12-col grid, matches the
clone's layout shape) → closing CTA. `BRAND.md` flags real content gaps worth
knowing before adding "research figures" to whichever tree is current: **zero
citations/paper links/benchmark numbers anywhere on the live page**, **no
named researchers**, and **only one of five pillars has any concrete
illustration** — meaning new research figures (this task's stated purpose)
would be filling a gap the brand agent already identified independently, not
duplicating existing content.

---

## 9. Build/verify commands

From `package.json` (clone):
```
npm run dev      # next dev
npm run build     # next build
npm run start      # next start
npm run lint       # eslint
npm run prebuild    # node scripts/build-head-model.mjs (runs automatically before `npm run build`)
npm run model       # node scripts/build-head-model.mjs --force
```

### 9.1 The `prebuild` step — verified safe for a fresh build, but read this before assuming so blindly

`scripts/build-head-model.mjs` (read in full) derives
`public/models/head-geo.glb` from an upstream three.js example asset
(`LeePerrySmith.glb`, pinned to tag `r180`, SHA-256-verified on fetch). It is
a **no-op if the output file already exists** (`existsSync(OUT) && !force` →
early return). **I confirmed the derived file is committed to the repo**
(`git ls-files public/models/` → `head-geo.glb` present, `git log` shows it
added in commit `e91ab0b` and reworked in `8fc2ec3`), so a fresh clone +
`npm install` + `npm run build` will **not** hit the network for this step —
it logs `"public/models/head-geo.glb present, skipping."` and exits.

**Flag for whoever changes this:** if the committed `.glb` is ever deleted (or
`.gitignore`d) without someone noticing, `prebuild` will silently start making
a real network fetch to `raw.githubusercontent.com` on every fresh build/CI
run, which is slow and will hard-fail (`throw`) in any sandboxed/offline build
environment, and will also hard-fail if upstream three.js ever moves the `r180`
tag or the file's bytes change (the SHA-256 check is strict, by design — see
the script's own comments). This is a real, if currently dormant, build-fragility
point worth a CI check that the binary stays committed.

### 9.2 What I ran / did not run

I read `scripts/build-head-model.mjs` and confirmed via `git ls-files` and
`git log` that its output is committed, rather than executing `npm run build`
myself (LAWS for this task were read-only on the site repo — I did not modify
or build it, only read source and git metadata; `npm install` had already
completed in the background before I started reading, confirmed via
`node_modules/next/dist/docs` existing). I did not run `npm run lint` or
`tsc` myself either — no ESLint or TypeScript findings are claimed here beyond
what's directly visible in the source I read.

---

## Recipe: authoring a new page in this codebase

```tsx
// src/app/<route>/page.tsx
import type { Metadata } from "next";
// import only what this page needs from the shared component set (§4):
import { Cta } from "@/components/ui/cta";
// import shared content, and extend it in src/lib/site.ts if this page
// needs a new cross-page constant (§7) — page-local lists stay in this file:
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: "Page Title", // becomes "Page Title | Vyakti" via the root layout's template
  description: "One or two sentences, specific, no filler verbs.",
  alternates: { canonical: "/route" },
  openGraph: {
    title: "Page Title", // can differ slightly from <title> for social framing
    description: "Same or a tightened variant for social cards.",
    url: "/route",
  },
};

const LOCAL_CONTENT = [
  // page-specific data arrays live here, not in site.ts, unless another
  // page also needs them (§7)
] as const;

export default function RoutePage() {
  return (
    <>
      <section className="border-b border-hairline bg-ink pt-32 pb-20 md:pt-40 md:pb-28">
        <div className="shell">
          <h1 className="max-w-[20ch] text-bone">Headline, sentence case, no em-dash.</h1>
          <p className="measure mt-8 text-lead text-ash">One lead paragraph.</p>
        </div>
      </section>

      <section id="anchor-name" className="scroll-mt-24 border-b border-hairline bg-void py-24 md:py-32">
        <div className="shell">
          {/* content, with data-reveal="0", data-reveal="1", ... on entrance elements */}
        </div>
      </section>

      {/* alternate bg-ink / bg-void per section; vary layout family per §6 */}
    </>
  );
}
```

Then: (1) if the page needs a persistent nav/footer entry, add it to `NAV`
and/or `FOOTER_GROUPS` in `src/lib/site.ts` (§7) and keep every `id="..."`
anchor in the new page's markup in sync with the footer's `href`s; (2) if the
page needs a custom data visual, build it as a `<figure>` sibling to
`turn-diagram.tsx` (§4), not a bespoke one-off shape; (3) run the design
checklist (§6) and the animation house rules (§5.2) before considering it
done; (4) do not enable `cacheComponents` or reach for `'use cache'` as part
of a single-page change (§1.1) — that's a site-wide decision; (5) remember
§0's caveat: verify against `brand/BRAND.md` and a fresh check of the live
site's actual current state before assuming this document's *content*
sections (tokens, pillars, nav) are still what's live, even though its
*structural* sections (§1, §5, §6, §9) hold regardless.
