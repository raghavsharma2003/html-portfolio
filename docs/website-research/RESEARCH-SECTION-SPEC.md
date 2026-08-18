# Research section — design specification

**Owner:** WS-RES-DESIGN
**Date:** 2026-08-18
**Target:** `vyakti.ai` (Next 16 App Router, Tailwind v4, Lenis, GSAP/Motion available)
**Repo studied:** `vyakti-website @ 8fc2ec3` (branch `claude/vyakti-research-website-a47qnq`)
**Content source:** `docs/website-research/content.json`, `copy.md`, `assets-manifest.md`, `docs/paper/figures/*.theme.svg`

This is a specification, not code. It tells implementation agents exactly what to
build, in what order, from which data field, and what would make each piece wrong.

---

## 0. The design problem, and the answer

The existing `/research` page is **thematic**: four pillars (turn-taking, affect,
persona, culture) plus an evaluation philosophy section. It asserts. It has no
evidence under it.

Our real output is **evidential**: one paper at preprint stage, one honestly
incomplete, four standalone measured results, one release with a datasheet, two
public retractions.

The wrong fix is a "Publications" page bolted on beside the pillars. That creates
exactly the ghetto the brief names: the pillars keep asserting, the evidence sits
in a filing cabinet nobody opens, and the two halves never argue with each other.

**The fix: a pillar is not a topic. A pillar is a claim, and every claim carries
its evidence in the same block.** Under each pillar's prose, an *evidence rail*
lists what we have measured on that track, each row bound to n, method, date, and
a link to the paper or result that produced it. A pillar with nothing measured
yet says so, in the same typography, in the same place. Nothing is hidden by
being omitted.

That single move does three things at once: it kills the publications ghetto, it
makes the four pillars honest (one of them is currently empty and will now say
so), and it turns the site's own thesis into something the page demonstrates
rather than states.

### The boldest idea: publish the strikethrough

The lab's two retracted findings are not a paragraph inside a "how we work" list.
They are rendered **at claim scale, struck through in place, with the control that
killed them annotated underneath** in the exact seam grammar `turn-diagram.tsx`
already uses for overlap and gap.

```
   ~~Judges favour their own vendor's model, by roughly 16×.~~
   │ A between-judge control killed it. A judge with no vendor
   │ conflict showed a larger effect.

   ~~Six judges failed because the material is Hinglish.~~
   │ Re-judged in monolingual English: −3.1 to +6.6 pp.
   │ Inside our own 13.6 pp noise floor. It is not the code-switching.
```

The site already argues that the interesting information lives in the seams
("Overlap and gap are properties of the exchange, not errors in it"; "Failure
located, not just counted"). Applying that grammar to our own knowledge is the
brand argument, not a decoration of it. No marketing adjective can buy what a
crossed-out claim at 3rem buys. It is also unfakeable: a lab that did not do the
control has nothing to strike through.

**Why it fits:** it is the same visual language, applied one level up. And it is
the only element on the page that a competitor cannot copy by writing better copy.

---

## 0.1 Conflicts found in the source material — resolve before build

These are real and must be settled by a human or by the content agent. Do not
paper over them in the design.

| # | Issue | Resolution required |
|---|---|---|
| **C1** | `content.json` `papers[0].status` reads **"Under review, NeurIPS JUDGe 2026 workshop"**. The governing law is: *"Under review at the NeurIPS 2026 JUDGe workshop" only after submission; until Aug 29 it is "Submitted"/"Preprint".* Today is 2026-08-18, before the deadline. | **The site must not render "Under review" today.** Set `status: "preprint"` and let the venue line read *"Submission target: JUDGe 2026 (NeurIPS workshop, non-archival), deadline 29 Aug 2026."* See §3.2 for the status enum that makes this a one-word flip later. |
| **C2** | `assets-manifest.md` F1 table gives the ceiling CI as `[69.8, 85.4]`. `content.json`, `copy.md`, `context/measurements.md:949`, `CAMERA.md:50` and the SVG's own `<desc>` all give **`[67.7, 84.4]`**. `CAMERA.md:251` shows both, in two columns (cluster-bootstrap vs naive Wilson). | The manifest row is quoting the wrong column. **Site uses `[67.7, 84.4]` everywhere** (cluster-bootstrap, matching the figure). Fix the manifest. |
| **C3** | The house design law bans the em-dash *"anywhere visible — headline, eyebrow, body, quote attribution, button, alt text"*, zero tolerance. `content.json`, `copy.md` and the paper's own **title** are full of them. | **Carve-out, stated as law in the codebase:** em-dashes are permitted *only* inside verbatim scholarly text that would be falsified by editing it — paper titles, abstracts, BibTeX, and the SVG-embedded `<desc>`/alt text that must stay byte-identical to the figure. **All site-authored copy** (headings, standfirsts, section intros, captions we write, labels, CTAs, evidence-rail claim lines) uses a colon, comma, or full stop. Enforce with a lint rule that allowlists `content.json` paths `papers[].title`, `papers[].abstract_*`, `papers[].bibtex`, and the figure `alt` strings. |
| **C4** | All three `.theme.svg` files use the **same internal ids**: `ttl`, `dsc`, `hatch`, `hatchLight`. Inlining all three on one page produces duplicate DOM ids, and every `url(#hatch)` silently resolves to the first figure's pattern. | The figure build script (§4.1) **must namespace every id and every `url(#…)` reference** per figure. This is a correctness bug, not a nicety. |
| **C5** | `content.json` has no field mapping evidence to the site's four pillars. | Additive schema change, §1.4. Required before the evidence rail can be built. |
| **C6** | Lenis is initialised with no anchor handling and `html.lenis { scroll-behavior: auto }`. Hash navigation to `/research#affect` from the footer is not guaranteed to land correctly. | Must be fixed as part of this work, because the existing footer anchors are load-bearing. §6.4. |

---

## 1. Information architecture

### 1.1 Routes

| Route | Type | What lives there |
|---|---|---|
| `/research` | static | **The index.** Hero, the four pillar sections (each now carrying an evidence rail), the papers block, the standalone results block, the method module, the release block, the closing hire CTA. This is the page that must read like a lab. |
| `/research/papers/[slug]` | SSG, `generateStaticParams` over `content.json.papers[]` | **Paper pages.** Two today: `judge-qualification`, `identity-ceiling`. One template, two very different states (§3). |
| `/research/releases/[slug]` | SSG over `content.json.release` (array-ify it) | **Release / datasheet page.** One today: `vyakti-judge-qual`. Contents, licences, exclusions, datasheet-limits-first summary, de-identification record, how to cite. |
| `/research/papers` | **308 → `/research#papers`** | Deliberately not a page. A publications index listing two entries looks smaller than the same two entries embedded under the claims they support. Promote to a real page only at ≥5 papers; the redirect means external links written today keep working when it flips. |

No other routes. Four people-worth of route surface for a three-person lab is a
tell. Standalone results do **not** get pages; they are full entries on the index
with stable anchors (§1.2), which is enough to link, share and cite.

Slugs are derived from `content.json` ids, with the `paper-b-` / `paper-a-`
prefixes stripped:
`paper-b-judge-qualification` → `judge-qualification`;
`paper-a-identity-ceiling` → `identity-ceiling`.
Store the mapping as an explicit `slug` field rather than deriving it with string
surgery, so a future rename cannot silently 404 an indexed URL.

### 1.2 Anchors on `/research` — the compatibility contract

The footer links to `#turn-taking`, `#affect`, `#persona`, `#culture`,
`#evaluation`. **These five ids must survive this work unchanged**, on the same
page, still scrolling to a section whose heading matches the link label. This is
a hard constraint; a redesign that renames them is a broken redesign.

Existing ids, kept, semantics unchanged:

- `#turn-taking` `#affect` `#persona` `#culture` — the four pillar sections. Each keeps its `scroll-mt-24`, its `<h2>`, its term pills, its prose. It **gains** an evidence rail below the prose.
- `#evaluation` — kept, and this is where the section is upgraded. Today it is a four-item philosophy list. It becomes the lab's method and instruments: the philosophy list is retained (it is good, and it is the *why*) and the method module (§5) is added beneath it. The heading stays "How we know it is working."

New ids, additive only:

- `#papers` — the papers block.
- `#results` — the standalone results block.
- `#method` — the method module (nested inside the `#evaluation` section; both ids resolve, `#evaluation` to the top of the section, `#method` to the module).
- `#release` — the release block.
- `#structural-privacy`, `#engagement-fabrication`, `#judge-ceiling`, `#cache-economics` — one per standalone result, so a single number is directly linkable. Derived from `content.json.results[].id`, so adding a result adds an anchor with no code change.

### 1.3 Page order on `/research`

Order is an argument. This one runs: *here are the four things we work on and
what we have measured on each → here is the work in long form → here are the
results that stand alone → here is why you should believe any of it → here is the
thing you can go download.*

1. Hero (existing copy, kept)
2. `#turn-taking` — pillar + evidence rail *(rail state: open, no measurement yet)*
3. `#affect` — pillar + evidence rail
4. `#persona` — pillar + evidence rail
5. `#culture` — pillar + evidence rail
6. `#papers` — the two papers, as cards that state their own status
7. `#results` — four standalone results, full entries
8. `#evaluation` → containing `#method` — philosophy list, then the method module (the struck claims live here)
9. `#release` — `vyakti-judge-qual`
10. Closing CTA (existing "Work on this with us", kept)

Ten sections. Layout families used, each at most once, per the house
section-repetition ban: sticky-sidebar split (2–5, one family reused across the
four pillars by design, since they are siblings), two-up card row (6), hairline
divided list (7), offset 12-col column (8), full-bleed ledger (§5) (8), asymmetric
split (9), centred narrow (10). Eyebrow budget: 10 sections → at most 4 eyebrows.
Allocate to: `#papers`, `#results`, `#evaluation`, `#release`. The four pillar
sections take none (they have `<h2>`s that carry themselves).

### 1.4 Required additive schema in `content.json`

The evidence rail is data-driven or it will rot. Add to every entry in `papers[]`
and `results[]`:

```jsonc
"site_pillars": ["culture", "evaluation"],   // ids from src/lib/site.ts PILLARS, plus "evaluation"
"slug": "judge-qualification",               // papers only; explicit, never derived
"rail_claim": "Six frontier judges failed a bar fixed before any of them ran.",
"rail_number": "6 / 6",                      // the one scannable value; null is legal
"rail_meta": "n = 96 units, 192 judgments · pre-registered backtest · 18 Aug 2026"
```

`rail_claim` is site-authored, one sentence, no em-dash, and it is a *claim* not a
title. `rail_number` and `rail_meta` are copied from existing fields, never
re-typed.

Proposed mapping (a human should sign this off; changing it later is a one-word
edit, which is the point):

| Pillar | Evidence attached | Rail state |
|---|---|---|
| `turn-taking` | none | **Open.** Renders "No published measurement yet." |
| `affect` | `vision-gate-engagement` | Measured |
| `persona` | `paper-a-identity-ceiling` (in prep), `gate0-structural-privacy` | One in-preparation, one measured |
| `culture` | `paper-b-judge-qualification`, and the code-switching retraction | Measured, plus one struck claim |
| `evaluation` (§8 of the page) | `paper-b-judge-qualification`, `ground-truth-ceiling-standalone`, the release | Measured |
| unattached | `cache-economics` | Lives in `#results` only, labelled "operating conditions", explicitly not a research finding |

The empty `turn-taking` rail is not a problem to design around. It is the single
most credible element in the section: a lab that marks its own empty cell is a lab
whose filled cells mean something. Do not quietly attach a loosely-related result
to fill it.

### 1.5 Navigation and footer

**Top nav (`NAV` in `src/lib/site.ts`): unchanged.** Three items. Adding
"Papers" to a global nav for two papers over-claims scale and the brief is
explicit that the lab is three people.

**Footer (`FOOTER_GROUPS`): the Research group keeps all six existing links in
their existing order**, and appends two:

```
Research
  Overview        /research
  Turn-taking     /research#turn-taking
  Affect          /research#affect
  Persona         /research#persona
  Culture         /research#culture
  Evaluation      /research#evaluation
  Papers          /research#papers          ← new
  Release         /research/releases/vyakti-judge-qual   ← new
```

Eight links in one column against three-link columns is fine visually (the grid is
`[1.5fr_repeat(3,1fr)]` and columns are top-aligned). Do **not** add a fourth
group; it breaks the grid template and the footer's balance.

**In-page section rail** (`/research` only, `lg+`): a thin fixed rail at the left
gutter listing the ten section anchors as mono micro labels, current section in
`bone`, others in `slate`, driven by one `IntersectionObserver` (never a scroll
listener). It replaces the need for a nav item and gives the page the *feel* of a
long technical document, which is the brief. Hidden below `lg`, hidden for
`prefers-reduced-motion` only in its transition, not its presence.

### 1.6 Breadcrumbs

On `/research/papers/[slug]` and `/research/releases/[slug]` only. Never on
`/research` (a top-level page with a breadcrumb to itself is noise).

Form: mono micro, `text-slate`, links `hover:text-bone`, separator is a `/` in
`hairline`, sits directly above the `<h1>` with `mb-6`.

```
Research  /  Papers  /  Judge qualification
```

The last crumb is a **short title**, not the paper's full title (which is 20 words
long). Add `short_title` to `content.json.papers[]`. Emit `BreadcrumbList`
JSON-LD alongside, reusing the existing `structured-data.tsx` pattern.

### 1.7 Adding a future paper: the minimal-work contract

The acceptance test for this whole IA is: **a new paper ships by editing one JSON
file and dropping SVGs in one directory. No `.tsx` is touched.**

1. Append an object to `content.json.papers[]` with the required fields (§3.6).
2. Drop `fig-*.theme.svg` files into `docs/website-research/figures/` and list them under the paper's `figures[]`.
3. Run `npm run figures` (§4.1) — generates namespaced React components.
4. Build.

`generateStaticParams` picks up the slug, the paper card appears in `#papers`
ordered by `date` descending with in-preparation entries last, the evidence rail
picks it up on whichever pillars `site_pillars` names, `sitemap.ts` gains the URL
(it must be changed to map over `content.json` rather than a hardcoded array),
and the footer needs no change. If any of that requires a code edit, the IA has
failed and should be fixed rather than worked around.

---

## 2. `/research` — page-by-page wireframe

Copy intent is given per section. Where the exact words already exist in `copy.md`
or `content.json`, the field is named and the copy is **not** rewritten.

### 2.1 Hero — unchanged

Existing: `h1` "The gap is not intelligence. It is behaviour." + lead paragraph.
Keep verbatim. It is good and it is already the argument.

**One addition:** a single mono micro line beneath the lead, above the fold:

> Two papers. Four standalone results. Two retractions. One released benchmark.

Four counts, all true today, all derivable from `content.json` (`papers.length`,
`results.length`, a `retractions.length`, `release` presence) so they cannot drift.
This is the honest version of a metrics strip: no percentages, no growth, no
adjective, and every number is a count of a thing you can click. It also front-loads
"two retractions", which is the differentiator, before anyone has scrolled.

*Data:* computed from `content.json`. Never hardcoded.

### 2.2–2.5 The four pillar sections

Existing structure is kept exactly: `id`, `scroll-mt-24`, alternating
`bg-ink`/`bg-void`, `md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]`, `h2` + term
pills in the left column, `summary` (lead) + `detail` (body) in the right.
`#turn-taking` keeps `<TurnDiagram />`.

**Added, in the right column, below `detail`:**

```
────────────────────────────────────────────  ← hairline, full column width
EVIDENCE                                       ← mono micro, tracking .16em, slate

┌ evidence row ─────────────────────────────┐
│  0 / 31,122          ← rail_number, mono, text-h3, tabular-nums, bone
│  A retrieval predicate leaked zero times   ← rail_claim, text-body, bone
│  across 494 disclosure scenarios.
│  n = 494 scenarios, 31,122 checks ·        ← rail_meta, mono micro, slate
│  offline fixture battery · 18 Aug 2026
│  Read the result →                         ← small, ember, underline on hover
└────────────────────────────────────────────┘
```

Rows are separated by `divide-y divide-hairline`, one per entry whose
`site_pillars` includes this pillar. Maximum three rows per pillar; if a pillar
ever exceeds three, the fourth and beyond collapse behind "and N more" linking to
`#results`.

**Row variants:**

- **Measured** (default) — as above. `rail_number` in `bone`.
- **In preparation** — `rail_number` is null and is replaced by a mono micro chip reading `IN PREPARATION` in `slate` on a `surface` background. `rail_claim` is phrased as a question, not an assertion (Paper A: "Does byte-identical compiled context survive a model swap?"). `rail_meta` states the blocker honestly, e.g. `74 of 2,304 calls · rate-limited to ~75/day · not a finding`.
- **Struck** — the claim renders with `text-decoration: line-through`, `text-decoration-color: var(--color-ember)`, `text-decoration-thickness: 1px`, colour `slate` (not bone; a dead claim is not live text). Directly beneath, the seam annotation: `border-l-2 border-ember pl-3 font-mono text-micro text-slate`, carrying the control that killed it. **Reuses `turn-diagram.tsx`'s seam styling verbatim.** On `#culture` only.
- **Open** — no number, no link. One line in seam grammar with a `hairline` (not ember) left border: *"No published measurement yet. This track is where the product work is ahead of the paper work."* On `#turn-taking` only. That second sentence is the honest reason and it is true; do not soften it and do not remove it.

*Data:* `PILLARS` from `src/lib/site.ts` (unchanged) joined to `content.json`
`papers[]` + `results[]` filtered by `site_pillars`.

### 2.6 `#papers`

Eyebrow `Papers`. `h2`: **"Two papers. One of them is not finished, and we will say so on its own page."**

Standfirst, from `copy.md` "Standfirst": the three-person / small-by-design /
load-bearing paragraph. Trim the em-dashes per C3.

Layout: two cards, `md:grid-cols-2`, `gap-6`. Not a table, not a list. Each card
is `rounded-[var(--radius-lg)] border border-hairline bg-surface p-6 sm:p-8` —
the TurnDiagram container, so papers read as artefacts of the same lab.

Card contents, top to bottom:
1. **Status chip** (§3.2). Ember-bordered for `preprint`, hairline for `in_preparation`.
2. **Title**, `text-h3`, `bone`, clamped to 4 lines with the full title in `title` attribute. Links to the paper page (whole card is the click target, with the title as the accessible name).
3. **Authors**, mono micro, slate: `Raghav Sharma · Gaurav Sharma · Aryan Tiwari`. Middot separators, no "et al.", never abbreviated. Three people means three names.
4. **One-sentence what-it-found**, `text-body`, `ash`. For Paper B, the ceiling line. For Paper A, the question it is built to answer.
5. **Two or three key numbers** as mono `text-h3` values with mono micro labels beneath (Paper B: `6/6 failed`, `77.1% ceiling`, `80% bar`). **Paper A shows none** — it shows a completion rail instead (§3.5).
6. **Footer row**: `Read the paper →` in ember, and a mono micro venue line.

*Data:* `content.json.papers[]`.

### 2.7 `#results`

Eyebrow `Results`. `h2`: **"Four measurements that stand on their own."**

Standfirst: one sentence, from `copy.md` "Standalone results" intro: findings
outside either paper, cited with the same discipline — n, method, date, source.

Layout: hairline-divided vertical list (`divide-y divide-hairline
border-t border-hairline`), one entry per result, each `py-10`. Not cards. Four
cards in a row is the single most-recognisable slop layout and this content is
too dense for it.

Each entry, `md:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]`:

- **Left column:** the number, mono, `text-h2`, `tabular-nums`, `bone`. Beneath it, the comparison number in mono `small`, `slate`, which is what makes it mean anything: `0 / 31,122` is a party trick until `57.1% naturalistic, 98.1% adversarial` sits under it. Exactly **one** result on the page gets its number in `ember`: `0 / 31,122`. One accent, spent once, on the strongest thing.
- **Right column:** `headline` as `text-lead` `bone`; `meaning` as `text-body` `ash` (this is the paragraph that does the honest hedging — "no difference detected, not no difference exists" — and it must never be trimmed for length); then the provenance line.
- **Provenance line** (mandatory, §2.9): mono micro, slate, `n · method · date · source`.

`cache-economics` carries an extra mono micro label above its headline reading
`OPERATING CONDITIONS`, so it is not read as a research finding. It is a real,
useful number about running the product, and mislabelling it as science would be
the exact overclaim this page exists to avoid.

*Data:* `content.json.results[]`, in file order.

### 2.8 `#evaluation` → `#method`

Section id `#evaluation` retained. Existing offset 12-col layout and the four-item
`<dl>` philosophy list retained verbatim (it is well-written and it is the *why*).

Beneath it, `#method`: the method module, specified in full in §5.

### 2.9 `#release`

Eyebrow `Release`. `h2`: **"The harness, the verdicts, and the mistakes."**

Two columns. Left: what it is (`release.description`), licences as two mono chips
(`Apache-2.0` code, `CC BY 4.0` data), status line, and the CTA — which, because
no public URL exists yet, is **not a link**. It is a disabled-state affordance
(§3.4) reading `Repository URL posts with the arXiv preprint` in slate, in a
hairline-bordered pill with `cursor: default`. Never a dead `href="#"`.

Right: `release.contents[]` as a hairline-divided list, and `release.exclusions[]`
under a mono micro label `NOT IN THE RELEASE`. Leading with what is excluded, at
equal weight to what is included, is the datasheet ethic applied to the web page.

*Data:* `content.json.release`.

### 2.10 The provenance law

**No number renders anywhere in this section without its `n · method · date`
line inside the same component.** Not adjacent, not in a tooltip, not on the
detail page: in the same bordered block, always visible, never behind an
interaction.

This is the structural defence against the "fake-precise unsourced numbers" tell.
A big number with no provenance is slop; the identical big number chained to
`n = 494 scenarios, 31,122 checks · offline fixture battery · 18 Aug 2026` is a
lab. The rule is enforced by making it impossible to render a number except
through one component (`<Measure>`), whose `n`, `method` and `date` props are
required and non-nullable in TypeScript.

---

## 3. The paper page template

One template. Two states that look genuinely different because the underlying
truth is genuinely different.

### 3.1 Section order

1. Breadcrumb
2. Status chip + venue line
3. `h1` title, then subtitle in `text-lead` `ash`
4. Author line + affiliation + date
5. Abstract, with plain/technical toggle
6. Key findings (measured papers only)
7. Long-form body: The setup / What we found / What we are releasing
8. Figures, inline, positioned within §7 where they are argued
9. **What this does not show** — limitations
10. Artifacts (PDF, arXiv, code, benchmark)
11. Cite (BibTeX)
12. Footer: back to `/research`, and the last-updated date

### 3.2 Status: the enum

Status is never free text on the page. It is an enum in `content.json` with a
fixed label, a fixed chip style, and a required `status_note`.

| value | chip label | chip style | when it is legal |
|---|---|---|---|
| `in_preparation` | `In preparation` | hairline border, slate text | data collection or writing incomplete |
| `preprint` | `Preprint` | hairline border, bone text | draft complete, posted or posting; **not yet submitted** |
| `submitted` | `Submitted` | ember border, bone text | submission actually sent |
| `under_review` | `Under review` | ember border, bone text | **only after the venue confirms receipt** |
| `accepted` | `Accepted` | ember fill, on-ember text | acceptance in writing |
| `published` | `Published` | ember fill, on-ember text | camera-ready public |

Rules that are not negotiable:

- **The chip never contains a venue name.** Venue lives on the next line, and until `accepted` it is prefixed **"Submission target:"**. A chip reading "Under review, NeurIPS JUDGe 2026" is the sentence that makes a lab look like it is inflating, and it is currently what `content.json` says (C1).
- Every status renders its `status_note` beneath the venue line, in mono micro, slate, with an explicit **as-of date**: `Status as of 18 August 2026.` A status without a date is a claim that ages badly on its own.
- Paper B today is **`preprint`**. Venue line: *"Submission target: JUDGe 2026, 'Can We Trust the Judge?', NeurIPS 2026 workshop, non-archival. Deadline 29 August 2026."* Flipping to `submitted` and later `under_review` is a one-field edit, which is the whole reason for the enum.

### 3.3 Abstract, plain/technical

A two-option segmented control above the abstract, mono micro labels
`Plain language` / `Technical`. **Default: plain language.** A lab confident in
its work leads with the version a non-specialist can read; leading with the
technical abstract is a status display, not a communication.

Behaviour: both abstracts are in the DOM (SEO, no-JS, Ctrl-F all work). The
inactive one is `hidden`. Switching does a 140ms opacity crossfade on the text and
slides the indicator pill 240ms `var(--ease-out-quint)`.

**Do not animate the container height.** The two abstracts differ by ~120 words;
an animated height change on a block that size is slow, janky, and shifts
everything below it. Height snaps, opacity crossfades. This is a deliberate call,
not an omission.

Keyboard: real `role="tablist"` / `role="tab"` / `role="tabpanel"`, arrow keys
move between tabs, the state is in the URL as `?abstract=technical` so a technical
reader can link a colleague straight to the version they want.

### 3.4 Artifacts block: how to show links that do not exist yet

Every paper has four artifact slots: `pdf`, `arxiv`, `code`, `benchmark`. Paper B
has all four `null` today with a `*_status` string beside each. Paper A has four
`null` and four "not applicable" strings.

This is the honesty pressure point and the design must not blink.

**Render every slot, always.** A 2×2 grid of slots, each `border border-hairline
rounded-[var(--radius)] p-5`.

- **Slot with a URL:** label in bone, URL host in mono micro slate, `→` in ember, whole slot is a link, `hover:border-ash`.
- **Slot without a URL:** identical box, identical size, identical position. Label in slate. The `*_status` string in mono micro beneath it, verbatim. `cursor: default`, no hover, `aria-disabled` is wrong here (it is not a control) so it is simply a `<div>`. **Never** a greyed-out link, never `href="#"`, never "coming soon", never a mailing-list capture.

The slot's presence is the point: an empty-but-labelled slot reading
*"Camera-ready draft complete; public PDF not yet posted"* is more credible than
hiding the slot, because it tells the reader exactly what exists and what does
not. It also makes the day the PDF lands a one-field edit.

**Absolutely forbidden:** fabricating an arXiv id. `content.json` says it outright
(`"id not yet issued — do not fabricate one"`). The design gives fabrication no
place to hide: there is no slot on the page that renders better when filled with a
plausible-looking string than when filled with the truth.

### 3.5 Paper A: showing an unfinished paper without looking empty or overclaiming

Paper A has no findings, no figures, no PDF, no BibTeX. The naive template
renders a stub. Three moves fix it, and none of them involve inventing content.

**Move 1: the page's length comes from real narrative, not from padding.** The
"Why the scope changed" section in `copy.md` is 250 words of genuinely
interesting scientific reasoning — an independent study partially scooped the
original framing, so the claim was narrowed and sharpened. That is the most
intellectually honest thing on the entire site and it is a *feature* of this page.
It runs at full width, immediately after the abstract, under the heading
**"Why the scope changed."** It is the reason to read the page.

**Move 2: replace "key findings" with a completion rail.** Not a progress bar
(that reads as a product feature). A hairline track, 1px, full column width, with
the first 3.2% filled in **slate** — never ember, which is reserved for results.
Beneath, mono micro:

```
Primary comparison arm     74 of 2,304 calls        3%
Candidate arm              2,304 of 2,304 calls     complete
Rate limit                 ~75 calls/day on the current pool
Blocked on                 a qualified judge; see Paper B
```

Four rows, and the fourth is the best thing on the page: this paper is blocked on
the subject matter of the other paper. Stating that connection explicitly makes
the two-paper corpus read as a research programme rather than two documents.

**Move 3: quarantine the preliminary observation.** The seven Devanagari hits
render inside a container with a mono micro header `NOT A FINDING` and a
`border-l-2 border-hairline` seam, carrying `preliminary_observations[0].caveat`
verbatim. The number `7` is set in `slate` at `text-body`, not in `bone` at
`text-h2`. Typographic weight is a truth claim; an unadjudicated raw count does
not get result-sized type.

Cite block: instead of BibTeX, one line — *"Not citable yet. This page will carry
a BibTeX entry when there is a paper to cite."*

### 3.6 Required fields for a new paper

```jsonc
{
  "id": "...",
  "slug": "...",                  // required, explicit
  "short_title": "...",           // breadcrumb + card, <= 4 words
  "title": "...",                 // verbatim, em-dashes permitted
  "subtitle": "...",
  "status": "preprint",           // enum, §3.2
  "status_note": "...",
  "status_as_of": "2026-08-18",
  "venue": { "name": "...", "kind": "workshop", "archival": false, "deadline": "2026-08-29" },
  "authors": ["Raghav Sharma", "Gaurav Sharma", "Aryan Tiwari"],
  "affiliation": "Vyakti.ai",
  "date": "2026-08-18",
  "abstract_plain": "...",
  "abstract_technical": "...",
  "key_findings": [ { "headline", "meaning", "source" } ],
  "figures": ["fig-f1-agreement-forest"],   // ids, resolved against the figure registry
  "sections": [ { "heading", "body" } ],    // long-form, markdown subset
  "limitations": "...",                     // required, non-empty; a paper page without it does not build
  "links": { "pdf": null, "pdf_status": "...", ... },
  "bibtex": null,
  "site_pillars": ["culture"],
  "rail_claim": "...", "rail_number": "...", "rail_meta": "..."
}
```

`limitations` being **required and non-empty** is a build-time gate. It is the
one field a rushed future session would skip, and skipping it is the failure mode
this whole section is designed against.

---

## 4. Data-visual language

### 4.1 Inline SVG components, generated at build time

**Decision: inline SVG React components. Not `<img>`, not `<object>`, not runtime fetch.**

Reasons, in order:
1. The `.theme.svg` files exist specifically so host CSS custom properties can reach in. `<img>` isolates them and the theming is dead on arrival. Light mode on this site is a real, tested mode, and a white-background figure on a `#12110e` ground is unacceptable.
2. Inlining puts the SVG's `<title>`/`<desc>` in the accessibility tree directly.
3. No network request, no layout shift, SSR-able.

**Build step: `scripts/build-figures.mjs`, run in `prebuild`** (alongside the
existing `build-head-model.mjs`). For each `docs/website-research/figures/*.theme.svg`:

- **Namespace every id** (`ttl` → `f1-ttl`, `hatch` → `f1-hatch`, etc.) and rewrite every `url(#…)` and `aria-labelledby` reference to match. **This fixes C4 and is the reason the step must exist at all** — three figures on one page currently collide.
- Emit a server component to `src/components/figures/fig-f1-agreement-forest.tsx` with `width`/`height` removed and `viewBox` kept, so it scales.
- Emit a registry `src/components/figures/index.ts` mapping figure id → component + `minWidth`, so `content.json` can reference figures by string.
- Fail the build if a `.theme.svg` contains a raw hex outside a `var(--fig-*, #hex)` fallback. Today they are clean; this keeps them clean.

Never hand-edit the generated components. Never hand-edit the `.theme.svg` files
either: they are produced from `docs/paper/figures/*.mjs`, which is what
guarantees no figure can state a number the analysis did not print.

### 4.2 Theme binding

The figure wrapper defines the bridge. Because `--color-*` already flip under
`prefers-color-scheme`, the figures theme for free in both modes:

```css
.figure-frame {
  --fig-bg:     var(--color-surface);   /* matches the frame it sits in */
  --fig-ink:    var(--color-bone);
  --fig-muted:  var(--color-ash);
  --fig-grid:   var(--color-hairline);
  --fig-accent: var(--color-raised);
}
.figure-frame svg text {
  font-family: var(--font-sans);        /* a CSS rule beats the SVG presentation attribute */
  font-variant-numeric: tabular-nums;
}
```

Geist, not Geist Mono, for figure text: the SVG geometry was laid out on Helvetica
metrics and Geist is far closer to them than a monospace is. `tabular-nums` keeps
the numeric columns aligned. Do not set `--fig-bg: transparent` — the hatch
patterns rely on an opaque tile to occlude gridlines behind them.

### 4.3 The colour decision

**The figures stay achromatic. The ember lives only in the annotation layer around
them, never inside the plot.**

This is deliberate and it should be defended, not "fixed" later. The figures were
built colourless for grayscale-print and colourblind safety; series are separated
by ink value, fill-versus-outline, dash and hatch. Introducing a brand accent into
a data series would mean *we* coloured the data, which is exactly the move that
makes a research figure look like a marketing chart. Keeping the accent outside
the frame means the plot is untouched and the emphasis is visibly ours.

The one accent on the whole `/research` page goes to `0 / 31,122` (§2.7), and one
per paper page goes to the `Read →` affordance. That is the entire budget.

### 4.4 The frame: making them siblings of `turn-diagram.tsx`

Every figure is wrapped in the **exact container `turn-diagram.tsx` already uses**:

```
<figure class="rounded-[var(--radius-lg)] border border-hairline bg-surface p-6 sm:p-8">
  [scroll container]
    [svg]
  <figcaption class="mt-6 border-t border-hairline pt-4 text-micro leading-relaxed text-slate">
```

Same radius, same hairline, same surface, same 6/8 padding, same `mt-6 border-t
pt-4` caption rule, same `text-micro text-slate`. That is what "feels native"
means here: not a new visual idea, the existing one reused without deviation.

Above the frame, a mono micro label: `FIGURE 1`. Below the caption, in mono micro
slate, the source line: `Rebuilt from docs/paper/figures/fig-f1-agreement-forest.mjs`.
That line is doing real work — it says the figure is generated from the analysis,
not drawn.

### 4.5 Figure specs

Captions are the "Recommended caption" strings from `assets-manifest.md`, with
em-dashes converted per C3. Alt text is the SVG's own `<desc>`, kept byte-identical
(em-dashes permitted there, per C3, because drift between alt and `<desc>` is the
worse failure).

---

**Figure 1 — `fig-f1-agreement-forest`** · viewBox `0 0 920 540` · min-width `860px`

- **Shows:** pooled agreement of five scorable candidate judges (28.1% to 54.2%) against the pre-registered ≥80% bar, with the ground truth's own measured 77.1% test–retest ceiling `[67.7, 84.4]` as a hatched vertical band. The bar sits *above* the ceiling. This is the paper's entire argument in one image.
- **Form:** horizontal forest plot. Thick interval = cluster bootstrap; thin interval = naive Wilson drawn behind it, which visibly shows what the independence assumption was buying.
- **Labels:** judge name right-aligned at left; `52/96 = 54.2%  [43.8%, 64.6%]` mono-aligned at right; `FAIL` in the far-right column. The `claude-opus-5` row is in a separate band **labelled INVALID (parse-selected denominator)** and must never be described in adjacent copy as a judge that passed. Cohere `command-a-plus` is **absent** because it produced 0 scorable units; if copy mentions it, it is "disqualified for cause", never "the worst performer".
- **Placement:** paper page, inside "What we found", under the "Every candidate failed" claim. Also the one figure that appears on `/research` — in `#papers`, beside the Paper B card, at reduced scale, as the section's visual anchor.
- **Reveal:** standard `data-reveal` on the whole `<figure>` as one unit. Nothing inside the SVG animates. See §6.3.

**Figure 2 — `fig-f2-slot-a-evacuation`** · viewBox `0 0 960 406` · min-width `900px`

- **Shows:** left panel, slot-A pick rates (62.0% gpt-5.6-terra to 89.6% Mistral-Large-3) against the trusted judge's 58.9% on identical rows and a 50% reference. Right panel, observed tie rate against slot-A pick rate, with the analytic content-blind prediction `q² + (1−q)²` as a dashed curve. Judges sitting on the curve have stopped reading the replies.
- **Form:** two panels, bar chart plus scatter with an overlaid analytic curve.
- **Labels:** the dashed curve **must be labelled analytic/derived**, never as a measured series. It is the one non-measured quantity in the entire content package and mislabelling it would be the exact overclaim this section exists to avoid.
- **Placement:** paper page, under "Position bias doesn't add noise, it deletes the measurement."
- **Reveal:** standard `data-reveal`, whole unit.

**Figure 3 — `fig-f3-english-recovery`** · viewBox `0 0 960 448` · min-width `900px`

- **Shows:** the same 96 units machine-translated to monolingual English and re-judged. Recoveries run −3.1 to +6.6 pp, mean +3.2. Every English point falls inside a shaded ±13.6 pp noise band centred on its Hinglish value. No judge approaches the bar in either condition.
- **Form:** paired dumbbell plot, five judges, with the noise band as a shaded region.
- **Labels:** the caption must carry the disclosed confound: gpt-5.6-terra is both a judge under test and the translator that produced the English condition for all five judges. That sentence is not optional and does not get moved to a footnote.
- **Placement:** paper page, under the retraction of the code-switching hypothesis. **This is the figure of a negative result** and it should be given the same size and prominence as F1. Shrinking the figure that refutes your own title is the tell you did not mean it.
- **Reveal:** standard `data-reveal`, whole unit.

### 4.6 Mobile: the figure data table

At 360px, F1's 9.5px labels render at roughly 3.7px. Unreadable. Two things
happen below `md`:

1. The SVG sits in an `overflow-x: auto` container at its `minWidth`, `-webkit-overflow-scrolling: touch`, `data-lenis-prevent` on the container (Lenis will otherwise eat the horizontal gesture), with a right-edge gradient mask as the scroll affordance and `role="region"` + `aria-label="Figure 1, scrollable"` + `tabindex="0"` so keyboard users can scroll it.
2. Beneath the figcaption, the **figure data table** renders: the exact per-judge numbers from `assets-manifest.md`, as a real `<table>` with `<caption>` and `<th scope="col">`. Two columns on mobile, mono, tabular-nums.

Above `md`, the same table is available behind a `<details>` with summary
`Figure data`. It is not a fallback; it is a first-class artifact, and it is the
only form of the figure that a screen reader can actually read row by row.

**The table numbers come from a `figure_data` block in `content.json`, not from
retyping the manifest.** A figure and its table disagreeing is the worst possible
failure for this section.

---

## 5. The method module: "How we work"

Anchor `#method`, inside `#evaluation`. Full-bleed against `bg-void`, breaking the
shell's rhythm deliberately: this is the one place on the page where the layout
changes register, because it is the one place making an argument about the lab
rather than about a result.

`h2`: **"Why any of this should be believed."**

Standfirst: one sentence. *Four practices, each measured against our own record
rather than asserted about it.* (from `copy.md`).

Four sub-modules. Each is designed to be **evidenced, not listed**. The failure
mode is four bullets with four adjectives; the fix in each case is to show the
artifact.

### 5.1 Pre-registration — show the clock

Not the sentence "we pre-register." The commit chain, as a mono ledger:

```
2026-08-13   2e82a0f   qualification method and ≥80% bar committed
2026-08-13   c18b239   ...
2026-08-15   d10e840   judge-qualification instantiation committed
             +25 min   first backtest result exists
2026-08-15   —         first candidate judge runs
```

Mono, hairline-divided rows, hashes in `slate`, the `+25 min` delta row in `bone`
with an ember left border in seam grammar. The delta is the thing: a reader does
not need to verify a hash to feel that someone was counting minutes.

Closing line, `text-small` `ash`: *"We cite the hashes rather than assert the
sequence, because a claim about pre-registration that cannot be checked is not
one."*

*Data:* `content.json.principles[0].evidence` (commit chain
`2e82a0f, c18b239, bfeb979, a7198a2, a053019, d10e840`). Needs the dates and
messages added to `content.json` as a structured `commit_chain[]` — currently they
are a prose string, which the design cannot render as a ledger.

### 5.2 The retractions — the struck claims

**The boldest element on the site.** Two claims, at `text-h2` scale, struck
through, each with the killing control annotated beneath in seam grammar.

```
RETRACTED
~~A judge favours its own vendor's model, by roughly 16×.~~
│ A between-judge control killed it. A judge with no vendor
│ conflict at all showed a larger effect, which is the opposite
│ of what the favoritism explanation predicts.

RETRACTED
~~Six frontier judges failed because the material is code-switched.~~
│ The identical 96 units, machine-translated to monolingual English
│ and re-judged: −3.1 to +6.6 pp. Every interval overlapping.
│ Inside our own 13.6 pp noise floor. It is not the code-switching.
```

Typography: `RETRACTED` in mono micro, `letter-spacing: .16em`, `ember`. The claim
at `text-h2`, `slate`, `line-through` with `text-decoration-color: var(--color-ember)`,
`text-decoration-thickness: 1px` (a thick strike reads as a redaction; a hairline
strike reads as a correction, which is what this is). The control note in the
TurnDiagram seam style, `border-l-2 border-ember pl-3 font-mono text-micro text-slate`.

Closing line: *"Both were reasonable readings of the evidence at the time. Both
were wrong. That is the paper's argument, not an exception to it."*

Motion: none beyond the standard reveal. The strikethrough must **not** animate
in. A line that draws itself across the claim turns a scientific correction into a
gag, and it would be the one moment on the page where the design was performing
instead of reporting.

*Data:* `content.json.principles[1]`, plus a new structured `retractions[]` array
carrying `claim` (the struck text) and `control` (the seam note) as separate
fields. Currently they are inside one prose blob.

### 5.3 n / method / date — do not claim it, point at the page

One short block. The copy does the work:

> Every number in this section carries its sample size, its method, and the date
> it was measured. That is not a claim about our standards. Scroll back and check
> any of them.

Beneath, one worked example rendered as a live `<Measure>` component — the same
component used everywhere else on the page — with its provenance line highlighted
by a hairline bracket and a mono micro label pointing at each part: `n`, `method`,
`date`, `source`. An annotated diagram of the thing the reader has already
scrolled past twenty times.

Then, one sentence on why it is enforced: the fabrication metric's own noise floor
exists because a claim was once reported without enough n to separate signal from
noise, and a properly powered re-run moved the "effect" by up to 75 pp on
byte-identical input.

### 5.4 Datasheet and de-identification — show the leak we caught

Two artifacts, side by side.

Left: the datasheet's own opening position, as a pull-quote at `text-lead`, in
`bone`, with a hairline left rule:

> The ground truth in this release was produced by an AI model, not human
> annotators. Every "agreement" figure means agreement with one trusted judge.
> It never means accuracy.

Attribution beneath in mono micro: `vyakti-judge-qual datasheet, section 1`.

Right: the de-identification record.

```
22 / 22    gates passed, run against the built bundle, not the source tree
1          real leak caught and fixed before shipping
           a provider error message carrying a full cloud tenant hostname
```

`22 / 22` and `1` in mono `text-h3`, `bone`. The caught leak is the credibility:
a sweep that finds nothing proves nothing, and saying so out loud is the point.

*Data:* `content.json.principles[3]`, `content.json.release`.

---

## 6. Motion and interaction

### 6.1 The vocabulary is already set. Use it.

The site has exactly one entrance: `[data-reveal]`, 16px rise plus fade, 620ms
`--ease-out-quint`, staggered 80ms by the numeric index, revealed once via one
shared `IntersectionObserver`, never re-animated on scroll-back. **Every new
element in this section uses it and nothing else.** No new entrance vocabulary is
introduced by this work.

Stagger index budget per section: 0 to 3. Beyond index 3 the last element waits
320ms after the first, which reads as slow.

### 6.2 The complete motion inventory

| Element | Trigger | Property | Duration / easing | Purpose |
|---|---|---|---|---|
| Every section block, figure, card, evidence row | in-view, once | `opacity` + `translate3d` | 620ms `--ease-out-quint`, 80ms stagger | state indication |
| Section rail (§1.5) active item | in-view | `color` | 240ms `--ease-out-quint` | spatial consistency |
| Abstract toggle indicator | click / arrow key | `transform: translateX` | 240ms `--ease-out-quint` | feedback |
| Abstract text swap | same | `opacity` | 140ms, linear-ish | preventing a jarring change |
| BibTeX disclosure | click | `height` (the sanctioned accordion exception) | 240ms `--ease-out-quint` | feedback |
| Copy-BibTeX confirmation | click | `opacity` on a "Copied" label | 140ms in, 1.6s hold, 240ms out | feedback |
| Paper card | hover, `@media (hover:hover) and (pointer:fine)` | `border-color` only | 140ms `ease` | feedback |
| `Read the paper →` arrow | hover, same guard | `transform: translateX(2px)` | 140ms `--ease-out-quint` | feedback |
| Header, nav underline, CTA press | existing | unchanged | unchanged | unchanged |

### 6.3 What must be static

- **Everything inside every SVG.** No scrubbed chart draw-on, no bars growing from zero, no counting numbers, no path-length animation. The figures are flat SVGs with no `<g>` groups, so any intra-figure animation would require the build script to synthesise groups by coordinate matching, which is fragile and would eventually mis-target and animate the wrong element. More importantly: an animated data figure is a chart that is performing, and this page's whole argument is that it is not performing. Standard reveal on the `<figure>` as one unit, then still.
- **The strikethroughs.** §5.2.
- **Every number.** No NumberFlow, no count-up. A number that counts up is a number asking to be admired. `77.1%` appears at `77.1%`.
- **The completion rail on Paper A.** It does not fill on scroll. 3% is not an achievement to animate toward.
- **The section rail's presence.** Only its active-item colour transitions.

No GSAP, no ScrollTrigger, no pinning, no scrubbing anywhere in this section. The
dependency exists in the project; using it here would need a one-sentence
justification per §15 of the design law, and there is not one. Motion's
`whileInView` is also unnecessary: `Reveal` already covers it with one observer for
the whole page, which is cheaper than a component per element.

### 6.4 Lenis and anchors — the fix that must ship

`SmoothScroll` initialises Lenis with no anchor handling, and `globals.css` sets
`html.lenis { scroll-behavior: auto }`. The footer's five existing
`/research#…` links are load-bearing and must land correctly in both cases:

1. **Same-page hash click** (section rail, in-page links): intercept, call `lenis.scrollTo(target, { offset: -96 })` to clear the 68px header plus breathing room, and `history.pushState` the hash so the URL updates and back works.
2. **Cross-page hash arrival** (`/meera` → footer → `/research#affect`): on mount, if `location.hash` matches an element, call `lenis.scrollTo(el, { offset: -96, immediate: true })` after layout settles. `scroll-mt-24` on the target is kept as the no-JS fallback.
3. **Reduced motion:** `SmoothScroll` returns early and Lenis never initialises, so both paths must fall back to `el.scrollIntoView({ behavior: 'auto' })` and the CSS `scroll-mt-24`. Test this path explicitly; it is the one that silently breaks.

Acceptance: with JS disabled, with reduced motion on, and normally, all five
existing footer anchors land with the section heading fully visible below the
header. This is a regression test, not a nice-to-have.

---

## 7. Responsive and accessibility

### 7.1 Breakpoints and dense content

- **Pillar evidence rails:** stack at `< md`. The number moves above the claim, keeps `text-h3`, `tabular-nums`.
- **Standalone results list:** the two-column grid collapses to one; the number stays first and stays large. The `meaning` paragraph must not be truncated on mobile: the honest hedging lives in it.
- **Figures:** §4.6. Scroll container plus the data table.
- **Figure data tables and the F1 numbers table:** at `< md`, drop to the two most load-bearing columns (judge, agreement) and put the CI on a second line within the cell rather than in its own column. Never a horizontally-scrolling table with six columns on a phone. Never a table that becomes a stack of unlabelled cards.
- **Commit ledger (§5.1):** the hash column truncates to 7 characters (it already is) and the message wraps. It does not scroll.
- **Struck claims (§5.2):** `text-h2` is already fluid-clamped down to 1.75rem. At the smallest size verify the strikethrough still reads as a strike and not as an underline artifact; if it does not, bump `text-decoration-thickness` to 1.5px below `sm` only.
- **Section rail:** `hidden lg:block`. No mobile equivalent; a floating TOC on a phone is a nuisance.

### 7.2 Focus and keyboard

- The global `:focus-visible` (2px ember, 3px offset) applies. Do not override it anywhere in this section.
- **Card link pattern:** the whole paper card is clickable, but only the title is a real `<a>`, with a `::after` overlay covering the card. This keeps one tab stop per card and a sane accessible name. Never wrap a card containing links in an `<a>`.
- **Abstract tabs:** roving tabindex, arrow keys, `aria-selected`, `aria-controls`.
- **Scrollable figure container:** `tabindex="0"` and `role="region"` with an `aria-label`, so keyboard users can reach and scroll it.
- **BibTeX copy button:** a real `<button>`, `aria-live="polite"` region announcing "Copied".
- **Disabled artifact slots** are `<div>`s, not disabled buttons, so they are read as text, not as broken controls.

### 7.3 Alt text policy

1. Figures use the SVG's embedded `<title>`/`<desc>` via `role="img"` + `aria-labelledby`. **No separate `alt` attribute is authored.** One source, so drift is structurally impossible. The build script preserves them and only namespaces the ids.
2. `<desc>` text is the data description from `assets-manifest.md`, which is already verbatim-identical to the SVG. If either is edited, both are edited in the same commit.
3. Decorative rules, gradients and the section rail get `aria-hidden="true"`.
4. `figcaption` is authored copy and is **not** a duplicate of the alt text. Caption says what the figure argues; `<desc>` says what the figure contains.
5. No image on these pages carries an empty or generic alt. There are no photographs, no screenshots and no logos in this section, by design.

### 7.4 Contrast

- Body copy AA (4.5:1) minimum; hero and `text-lead` target AAA. The existing token set already clears this in both modes; the risk is new combinations.
- **`text-slate` (`#7a746a` dark / `#5f594f` light) is approved only at `text-micro` and `text-small`, and never for anything a reader must read to understand a claim.** Provenance lines are `slate` and that is intentional: they are reference material. The claim itself is never `slate` except when struck.
- Struck claims are `slate` at `text-h2` — large text, so the 3:1 threshold applies and it passes. Verify in light mode specifically, where struck text plus a light ground is the weakest combination on the page.
- The ember strike-decoration is decoration, not text, so it is exempt from text contrast but must remain visible: verify against both `bg-void` and `bg-ink`.
- Figures: contrast is carried by the token bridge. Verify `--fig-grid: var(--color-hairline)` gridlines are visible in light mode, where `#dedbd4` on `#ffffff` is only just there. If it fails a visual check, bridge `--fig-grid` to a mix rather than editing the SVG.
- `prefers-contrast: more`: raise `--fig-grid` and `--fig-muted` one step toward ink, and drop the header's `backdrop-blur`.

---

## 8. What not to do

Each of these is a specific failure this section is at real risk of.

1. **No metrics dashboard.** No stat grid, no cards with a big number and a one-word label, no sparklines, no "99.8%" floating with nothing under it. Every number renders through `<Measure>` with a mandatory provenance line, in the same block. If a number cannot carry its n, method and date, it does not go on the site.
2. **No marketing adjectives.** No "state-of-the-art", "cutting-edge", "breakthrough", "rigorous", "world-class", "pioneering". The word "rigorous" is the specific trap: this section's whole argument is rigour, and the fastest way to lose it is to claim it. Show the commit hashes and let the reader conclude it.
3. **No wall of BibTeX.** One collapsed disclosure per paper page, at the bottom, with a copy button. Never expanded by default, never on `/research`, never a "Cite all" block. Paper A has no BibTeX and gets a sentence instead of an empty `<pre>`.
4. **No screenshot figures.** No PNG of a chart, no exported image of a table, no screengrab of a terminal or a notebook. The three figures are generated SVGs from the analysis scripts and any future figure follows the same path. A screenshot in a research section says the numbers were not reproducible enough to redraw.
5. **No claimed peer review.** Not in the chip, not in the venue line, not in the OG image, not in the JSON-LD. Today the honest label is `Preprint` with a submission target and a deadline (C1). "Under review" is a claim about a third party and it is only true after that third party confirms receipt. A `ScholarlyArticle` JSON-LD block must not carry a `publisher` or an `isPartOf` naming NeurIPS until acceptance.
6. **No fabricated identifiers.** No arXiv id, no DOI, no repository URL, no `arxiv.org/abs/…` placeholder "for layout". `content.json` says it explicitly and the artifact-slot design (§3.4) ensures the truthful state renders well.
7. **No hiding Paper A.** The honest handling of an incomplete paper is a page that says it is incomplete, not omission. Omission is what a lab that expects to be caught does.
8. **No filling the empty pillar.** `#turn-taking` has no measured result. Do not attach a tangentially related number to make the grid look symmetric.
9. **No animated data.** §6.3.
10. **No fake precision in site copy.** `77.1%` is real. Do not write "roughly 77%" in one place and `77.1%` in another; do not round `31,122` to "31k"; do not write "9×" where `content.json` says `9.2×`. Copy the string from `content.json`, never retype it.
11. **No em-dashes in site-authored copy.** C3. The carve-out is verbatim scholarly text only.
12. **No "coming soon", no waitlist, no email capture** anywhere in the research section. The lab has one email address in the footer and that is the entire conversion surface. A research page with a lead-gen form is not a research page.
13. **No third accent, no gradient, no glassmorphism, no purple.** One accent, already locked to ember, and this section spends it twice (§4.3).
14. **No re-animating on scroll-back.** The existing `Reveal` unobserves after firing. Do not replace it with something that does not.
15. **Do not describe `claude-opus-5` as a judge that passed**, or Cohere `command-a-plus` as "the worst performer". Both are specific mislabels the manifest warns about, and both are the kind of error a copywriter makes in good faith. INVALID and disqualified-for-cause are different failures from a low score.

---

## 9. Build order

Nine tasks. Each is independently shippable and independently reviewable. Tasks 1
to 3 are prerequisites for everything visual; do not start 4 before 3 is green.

---

**Task 1 — Resolve the content conflicts.** *(content agent + human sign-off)*

Fix C1 (status enum value), C2 (ceiling CI in the manifest), C5 (`site_pillars`,
`slug`, `short_title`, `rail_*`), and structure the prose blobs the design needs as
data: `commit_chain[]`, `retractions[]`, `figure_data`, `limitations`, `venue`.
Add the em-dash allowlist (C3) as a comment in `content.json`.

*Acceptance:* `content.json` validates against a committed JSON Schema; every
`papers[]` entry has a non-empty `limitations`; no site-authored string field
contains an em-dash; the ceiling CI is `[67.7, 84.4]` in every file.

---

**Task 2 — `scripts/build-figures.mjs` and the figure registry.**

Namespace ids (C4), strip `width`/`height`, emit server components and a registry
with `minWidth` per figure. Wire into `prebuild`.

*Acceptance:* all three figures render inline on one test page simultaneously with
correct hatch patterns (the C4 regression); no duplicate DOM ids in the rendered
HTML; build fails if a raw hex is introduced into a `.theme.svg`; generated files
are gitignored or committed consistently and never hand-edited.

---

**Task 3 — Primitives: `<Measure>`, `<StatusChip>`, `<EvidenceRow>`, `<FigureFrame>`, `<SeamNote>`.**

`<Measure>` takes required `n`, `method`, `date`, `source` props typed
non-nullable. `<FigureFrame>` reproduces the `turn-diagram.tsx` container exactly
and owns the token bridge, the scroll container and the data table. `<SeamNote>`
extracts TurnDiagram's seam styling so both use one implementation.

*Acceptance:* TypeScript rejects a `<Measure>` without provenance; a visual diff
shows `<FigureFrame>` and `<TurnDiagram>` frames as pixel-identical at the same
width in both colour modes; `turn-diagram.tsx` is refactored onto `<SeamNote>`
with no visual change.

---

**Task 4 — Lenis anchor handling.** *(§6.4)*

*Acceptance:* all five existing footer anchors land correctly from a cold
cross-page navigation, from an in-page click, with JS disabled, and with reduced
motion enabled. Twelve cases, all pass. Ship this before anything changes on
`/research`, so any later regression is attributable.

---

**Task 5 — `/research` evidence rails.**

Add the rail to all four pillar sections. All four states: measured, in
preparation, struck, open.

*Acceptance:* `#turn-taking` renders the open state and no evidence is invented to
fill it; `#culture` renders one struck claim; every rail row's number is followed
by its provenance; the four existing anchor ids still resolve; the page still
builds with `PILLARS` unmodified.

---

**Task 6 — `/research` new sections: `#papers`, `#results`, `#release`.**

Plus the hero count line (§2.1) and the eight-link footer group.

*Acceptance:* the counts in the hero line are computed, not typed; `cache-economics`
carries its `OPERATING CONDITIONS` label; `0 / 31,122` is the only ember number on
the page; the release CTA is a non-link disabled affordance with the status string
verbatim; layout-family and eyebrow budgets from §1.3 both hold.

---

**Task 7 — The paper page template + Paper B.**

`/research/papers/[slug]`, `generateStaticParams`, breadcrumbs, status chip,
abstract toggle, key findings, three inline figures, limitations, artifact slots,
BibTeX. Update `sitemap.ts` to map over `content.json`.

*Acceptance:* the chip reads `Preprint`, not "Under review"; no fabricated arXiv
id anywhere including JSON-LD; all four artifact slots render in their empty state
with verbatim status strings; the abstract toggle works with JS disabled (plain
visible, technical present in DOM); `?abstract=technical` deep-links; the three
figures scroll horizontally on mobile with their data tables beneath.

---

**Task 8 — Paper A.**

Same template, in-preparation state: completion rail, "Why the scope changed",
quarantined preliminary observation, no BibTeX.

*Acceptance:* the page contains zero elements a reader could mistake for a result;
`7` renders at `text-body` in `slate`, never at heading scale; the completion rail
is slate, never ember; the "blocked on Paper B" row links to Paper B; the page is
long enough to read as substantial without a single sentence of padding.

---

**Task 9 — The method module + `/research/releases/vyakti-judge-qual`.**

The commit ledger, the two struck claims at full scale, the annotated `<Measure>`,
the datasheet pull-quote and the de-identification record. Then the release page.

*Acceptance:* the strikethroughs do not animate; the seam annotations use the same
component as `turn-diagram.tsx`; the caught leak is stated, not just the 22/22;
the datasheet quote is attributed to section 1 of the datasheet; contrast on struck
`text-h2` slate passes in light mode.

---

**Cross-cutting acceptance, checked once at the end:**

- Both colour modes rendered and reviewed on every new page, not assumed.
- Zero em-dashes outside the C3 allowlist, checked by lint.
- Every number on every page traceable to a `content.json` field with a `source`.
- No number renders without `n`, `method`, `date` in the same component.
- Lighthouse a11y 100 on `/research` and both paper pages.
- `prefers-reduced-motion` verified on all three pages, including anchor landing.
- Author line reads `Raghav Sharma · Gaurav Sharma · Aryan Tiwari` on every paper, card, BibTeX and JSON-LD block, spelled and ordered identically.
