---
name: Vyakti expert sign-in entry
description: Built entry surface only; code-led documentation of the incumbent warm Vyakti identity.
colors:
  paper: "#f8f8f5"
  mineral-green: "#1f6b54"
  brand-green: "#173e32"
  ember: "#b93627"
  ink: "#0c0e0d"
  muted: "#50524f"
  intro-copy: "#4b5b53"
  caption: "#52564e"
  line: "#d7d7d0"
  white: "#fff"
  primary-hover: "#0e352a"
typography:
  display:
    fontFamily: '"Instrument Sans Variable", sans-serif'
    fontSize: "clamp(38px, 4.5vw, 64px)"
    fontWeight: 500
    fontVariation: '"wght" 570'
    lineHeight: 1.04
    letterSpacing: "-.035em"
  title:
    fontFamily: '"Instrument Sans Variable", sans-serif'
    fontSize: "30px"
    fontWeight: 500
    fontVariation: '"wght" 580'
    lineHeight: 1
    letterSpacing: "-.035em"
  body:
    fontFamily: '"Instrument Sans Variable", sans-serif'
    fontSize: "17px"
    lineHeight: 1.5
  form-copy:
    fontFamily: '"Instrument Sans Variable", sans-serif'
    fontSize: "13px"
    lineHeight: 1.5
  label:
    fontFamily: '"Instrument Sans Variable", sans-serif'
    fontSize: "12px"
    fontWeight: 620
rounded:
  control: "14px"
  illustration: "16px"
spacing:
  label-gap: "7px"
  caption-gap: "12px"
  caption-top: "14px"
  title-bottom: "18px"
  visual-bottom: "20px"
  page-row: "24px"
  visual-top: "28px"
components:
  button-primary:
    backgroundColor: "{colors.mineral-green}"
    textColor: "{colors.white}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    width: "100%"
  button-google:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 20px"
    width: "100%"
  input-email:
    backgroundColor: "{colors.white}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "0 15px"
    height: "51px"
    width: "100%"
---

# Design System: Vyakti expert sign-in entry

## Overview

This document is authoritative only for the built expert sign-in entry. Its direction is the incumbent warm ivory and mineral green Vyakti identity, with the ember Vyakti mark, concise text, and a fictional Indian educator at work. It does not replace a global design system or describe the authenticated product.

The surface is code-led, with no approved visual comp. Sources are `src/studio/StudioApp.tsx` (auth section), `ExpertEntryVisual.tsx`, and `expert-experience.css`, including their inherited `studio.css`, `clone-experience.css`, and `vyakti-mark.css` rules. The parent checkout's `PRODUCT.md` supplies durable product context; `context/STATE.md` supplies current evidence boundaries. Instrument Sans on this surface is a scoped implementation choice, not a replacement for PRODUCT.md's broader serif direction.

**Key Characteristics:**

- Warm paper, dark ink, mineral green actions, and an ember identity accent.
- One illustrative scene paired with a direct sign-in task.
- Flat composition, restrained control borders, and generous desktop separation.

## Colors

Mineral green identifies the primary action; brand green carries the wordmark. Ember belongs to the Devanagari glyph and small domain suffix. Paper spans the whole entry without a colored split panel. Ink is the heading and control text color; muted supports form explanations and safeguards. Intro copy and image captions use their separately inherited tones.

The pale green email button in the empty-form screenshots is the primary color at disabled opacity (0.6), not a separate action token. The enabled hover uses the inherited primary-hover tone. Borders use line; fields and the Google button use white.

## Typography

Instrument Sans Variable is the entry's display and body family. The display and title tokens preserve both the CSS weight and the inherited variable-font axis: the explicit `wght` values take precedence for the rendered face. Do not flatten that distinction into a claimed visual weight of 500.

The introduction uses the body role; the form explanation uses form-copy. Button text is 14px at weight 650. Field text is 15px. Captions are 13px desktop and 12px at the entry mobile breakpoint. The consent-timing note is 12px with a 1.5 line height. The Vyakti mark retains Noto Sans Devanagari with Kohinoor Devanagari, Mangal, and sans fallbacks for its glyph, and a small monospace domain suffix.

## Layout

Desktop uses `minmax(0, 1.12fr) minmax(360px, 0.88fr)` columns with a 68px header row and a flexible content row. Horizontal page padding is `clamp(24px, 5vw, 82px)`; the entry overrides the grid gap to 24px vertically and 6vw horizontally. The introduction centers vertically with 20px block padding. Its headline and illustration stop at 560px; introductory copy stops at 460px. The form aligns to the right and stops at 390px, with 28px vertical padding.

The illustration has 28px top and 20px bottom margins, a 3:2 ratio, and a full-width image. Caption items spread across the width with a 12px minimum gap and 14px top margin. Form explanation margins are 12px above and 22px below; label gap is 7px. The field has a 10px bottom margin, followed by the primary button's 13px top margin. The separator retains its 42px height and 10px block margins.

At max-width 800px, the inherited responsive rule changes the page to block flow. Entry padding becomes 20px 24px 40px; the brand margin is 0 0 12px with a 44px minimum height; introduction padding is 12px 0 0. The safeguards strip is hidden. Illustration margins become 20px 0 16px; image ratio becomes 2.6:1 with `object-position: 50% 43%`. The form becomes full width with 18px block padding and no maximum width. At max-width 720px, inherited rules center the introduction, set the brand height to 58px, remove the form's maximum height, and reduce form-copy bottom margin to 15px. These are two actual breakpoints, not one inferred mobile rule.

Evidence: `.impeccable/review/desktop.png` from a 1440x900 viewport and `mobile.png` from a 390x844 viewport. The mobile file is a full-page capture that includes content below the initial viewport. These establish composition, not authentication or accessibility correctness.

## Elevation & Depth

The form container is transparent, borderless, without shadow or backdrop blur. Ambient shapes and page pseudo-element decorations are hidden. Depth comes from the editorial image and the inherited primary-button shadow (`0 10px 22px rgba(11, 91, 69, 0.17)`). The Google button and input have no shadow at rest.

## Shapes

Controls have the control radius; the illustration has the illustration radius. The image uses `object-fit: cover`. Keep the existing Vyakti glyph and wordmark together. This sign-in surface does not introduce cards, navigation tabs, or a chip inventory.

## Components

The email action is full width with a 50px minimum height, disabled until the existing email predicate is satisfied or while busy. Google remains a peer secondary sign-in option, separated by a quiet rule and “or”. The email field retains its real label, email input mode, autocomplete, and existing focus treatment. This document records source behavior and styling; it does not certify that either authentication path was exercised.

The generated illustration is a fictional person, never a customer, testimonial, likeness benchmark, or proof of product output. Runtime asset: `public/expert/expert-at-work.webp` (1200x800 dimensions declared by the component). Retained source: `public/expert/expert-at-work.png`. Prompt and timestamp provenance: `public/expert/expert-at-work.webp.json`, created 2026-09-06T18:10:33.376Z. No model identity or additional provenance is asserted beyond that sidecar.

The illustration settles once from translateY(8px) to zero over 420ms with `cubic-bezier(.22, 1, .36, 1)` and fill mode `both`. It animates transform only and stays visible from the first frame. Animation is enabled only under `prefers-reduced-motion: no-preference`; reduced motion receives the static illustration. The recorded temporal samples in `.impeccable/review/motion-samples.json` contain six nonempty transforms progressing from 6.61744px through 0.901921px to zero; the exact 8px start is a code value, not a captured sample. This documentation did not run an additional browser test.

Preserve the note that source-use agreement appears after sign-in and identity/model authorization appears before generated speech. Hiding the mobile safeguards strip must not remove this timing disclosure. Consent and clip protection remain product constraints, not claims proven by these screenshots.

## Do's and Don'ts

- Do preserve the warm paper, mineral green actions, ember mark, and concise entry copy.
- Do keep the fictional educator visually illustrative and retain its provenance.
- Do preserve consent timing disclosure and the reduced-motion branch.
- Don't promote this entry composition or font override into whole-product authority.
- Don't infer accessibility, authentication success, or voice fidelity from rendered images.
