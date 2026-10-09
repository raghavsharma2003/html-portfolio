# Studio design audit, 2026-10-09

## Scope and evidence

This is a bounded, read-only review of the integrated signed-in personal studio. It excludes `PrivateTextRehearsal`, which is being repaired separately.

The review used the real mounted product components in `evals/studio-workbench27`, at 390px and 1440px, with synthetic API responses. The available screenshot set is historical, dated 2026-09-27. The accepted application commit is `5fe2fa2590a355834bf61eea4e889103351af1f7`, and `git diff --name-only 5fe2fa2590a355834bf61eea4e889103351af1f7..HEAD` contains only context, handoff and research files, but the screenshot files do not carry a source fingerprint that proves which commit produced them. They are visual evidence of the integrated replacement direction, not fresh current-build proof.

Reviewed images:

- `scratchpad/workbench27/overview-390.png`
- `scratchpad/workbench27/overview-1440.png`
- `scratchpad/workbench27/knowledge-390.png`
- `scratchpad/workbench27/knowledge-1440.png`
- `scratchpad/workbench27/personality-390.png`
- `scratchpad/workbench27/personality-1440.png`

The historical fixture receipt reports both viewport journeys passed pre-runtime navigation, bottom placement, overflow, reload, route and readiness checks, with no browser errors. Its scope is synthetic and cannot prove the current build, sign-in, upload, model, voice or provider behavior.

A fresh capture was attempted once on 2026-10-09. Vite and Chromium initialized, but the first `page.goto` exceeded the 30 second limit before a page mounted. Per the bounded-pass rule, it was not retried and produced no replacement screenshots. Fresh visual proof is therefore incomplete. This timeout is not attributed to product performance.

The Impeccable detector was run once across the owning workbench, HumanOS and Context Locker files. It reported two `overused-font` warnings for Instrument Sans in `workbench.css`. Both are false positives for this product: `DESIGN.md` explicitly commits to the existing local Instrument Sans family, and the detector appears to match the generic word `Sans`.

## Audit health

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 3/4 | Visible focus styles, 44px minimum controls, labelled navigation and an intentional reduced-motion path are present. No blocking issue is visible in this pass. |
| Performance | 3/4 | Motion uses opacity, transform and a shared layout indicator. A previously measured small Studio bundle overage remains in the context graph; this visual pass did not rerun performance gates. |
| Responsive design | 3/4 | The historical fixture reports no horizontal overflow at 390px or 1440px, and its screenshots preserve a stable bottom navigation on phone. A fresh integrated capture, live keyboard and browser-chrome behavior remain unverified. |
| Theming | 3/4 | The pearl, graphite and indigo palette is coherent and light-only by design. Workbench CSS repeats literal palette values after defining local variables, which makes refinement harder than it should be. |
| Implementation integrity | 3/4 | The interface is product-specific, calm and task-oriented. A few component seams still expose unclear action ownership and disconnected alignment. |
| **Total** | **15/20** | **Good. The structure is sound; address the concentrated hierarchy and material issues before calling the visual system finished.** |

Severity count: P0 0, P1 1, P2 3, P3 0.

## Priority findings

### 1. P1: Make the source action belong to its source

In both Knowledge screenshots, `Teach your AI` sits between the links controls and the `In your locker` heading. On phone the saved item itself is below the fold, so the primary button does not name or visually touch the item it will teach from. It can reasonably be read as submitting the link field above it.

This comes directly from `ContextLockerPanel.tsx`: the teach action is rendered as a standalone `context-result-actions` block before the locker heading, while the actual saved source rows are rendered later. The code has the correct `teachableSource.item_id`; the presentation discards that relationship.

Move the action into the matching saved-source row and include the source name in its accessible label. Keep `Add links` as the only action attached to the links field. If one source is promoted as the recommended next step, show that recommendation inside its row instead of pulling the button out of context. This is a `$impeccable clarify` and `$impeccable layout` change.

This can be fixed from current fixture evidence. A signed-in test is still needed to verify the action remains attached to the right row while uploads settle, fail, retry, or reorder.

### 2. P2: Remove the orphaned desktop back control

On the 1440px Knowledge and Personality views, `Back to choices` begins at the main viewport padding while the page content begins roughly 90px farther right in its centered 920px column. The control looks detached from the page it navigates. Desktop already has persistent direct navigation in the left rail, so it also duplicates a clearer route.

The mismatch is structural: `CloneExperience.tsx` renders `.vx-back` as a sibling before the centered panel, while `workbench.css` centers `.humanos-studio`, `.emotionos-studio` and `.sources-studio` independently. The button therefore cannot share the panel's content edge.

Hide the redundant control on desktop or put it inside a shared page header aligned to the same max-width column. Keep a concise back control on phone, where Build is collapsed into the bottom navigation, but label the destination more concretely than `choices`. This is a `$impeccable layout` change.

This can be fixed from current fixture evidence.

### 3. P2: Stop the Identity card stretching to the height of the five-field card

The 1440px Personality screenshot shows `Identity` as a very tall empty white panel because the two grid children share one stretched row. The right card needs the height; the left card does not. The empty area makes the screen feel like a dashboard grid and weakens the editorial, personal quality in the brief.

`humanos-studio.css` defines a two-column grid without `align-items: start`, so the shorter `.humanos-card` stretches to the row height. Add top alignment and let each card take its own content height. Preserve the one-column phone flow.

This is a small `$impeccable layout` change that can be fixed immediately. The contents and save behavior should remain untouched.

### 4. P2: Finish the premium material and state movement in the shell

The palette matches the brief, but the overview still reads as a clean wireframe: flat white regions, uniform gray rules, and two generic initial tiles are doing most of the identity work. The visible brand mark is precise, yet the workspace itself does not carry the requested pearl, graphite and restrained metallic character. Repeated literal colors in `workbench.css` also split the palette from the variables declared at the top of the same file.

Consolidate the shell onto the existing variables, then give only the persistent frame and one primary working region a subtle metallic edge treatment. Use a real owner image when the product already has one; otherwise make the initial a compact identity affordance rather than a hero illustration. Do not add more cards, metrics, gradients or explanatory text.

The desktop rail already has an authored Framer Motion selection background and the routed content already crossfades. The phone navigation switches its background abruptly because it uses only `[aria-current]` CSS. Reuse the same shared selection indicator in the stable phone bar, with the existing reduced-motion branch. That gives the requested meaningful movement by showing where the workspace moved, without decorative animation.

The token consolidation and mobile selection indicator can be implemented from current evidence. Final intensity, edge contrast and motion timing should wait for one signed-in phone and desktop pass because screenshots cannot show tactile feel or transition continuity.

## What is already working

- The studio now reads as a personal workbench rather than a technical dashboard. There are no invented scores, diagnostic meters or decorative telemetry in the reviewed views.
- The 390px layout has a stable, thumb-sized bottom navigation and keeps the working content in normal document flow.
- The overview has one strong next action, `Open private test`, after the three setup areas. The hierarchy is easy to understand.
- Typography, spacing and copy are restrained. Instrument Sans and the graphite-on-pearl palette are consistent with the committed design direction.
- Focus visibility, minimum target sizing and reduced-motion handling are present in the owning CSS.

## Hold until a signed-in live test

Do not infer these from the synthetic fixture:

- whether the phone bottom bar remains stable above the software keyboard and browser chrome;
- whether loading, upload, processing, retry and reordered source rows preserve the action-to-source relationship;
- whether recording navigation locks feel clear rather than frozen;
- whether saved and error notices remain transient and scoped to the page that caused them;
- whether the selection movement and content crossfade feel continuous during real lazy-loaded routes;
- whether actual owner imagery is available and appropriate for the workspace identity.

After the four changes above, run one paired 390px and 1440px signed-in pass covering overview, Knowledge and Personality, then finish with `$impeccable polish`. Do not use that pass to reopen the separate private rehearsal work.
