# Studio design audit, 2026-10-09

## Scope and evidence

This is a bounded, read-only review of the integrated signed-in personal studio. It excludes `PrivateTextRehearsal`, which is being repaired separately.

The review used the real mounted product components in `evals/studio-workbench27`, at 390px and 1440px, with synthetic API responses. A fresh integrated batch was captured on 2026-10-09 after the current workspace hierarchy fixes.

Reviewed images:

- `scratchpad/workbench27/overview-390.png`
- `scratchpad/workbench27/overview-1440.png`
- `scratchpad/workbench27/knowledge-390.png`
- `scratchpad/workbench27/knowledge-1440.png`
- `scratchpad/workbench27/personality-390.png`
- `scratchpad/workbench27/personality-1440.png`

The fresh fixture receipt reports both viewport journeys passed pre-runtime navigation, bottom placement, overflow, reload, route and readiness checks, with no browser errors. Its scope is synthetic and cannot prove sign-in, upload, model, voice or provider behavior.

The original dev-server capture failed before receiving fixture HTML because Vite remained in dependency scanning and bundling. `evals/studio-workbench27/run.mjs` now uses the repository's established in-memory Vite build plus exact output-map `node:http` server pattern. No timeout or journey assertion was changed. The repaired run exited successfully and produced the six current screenshots listed above.

The Impeccable detector was run once across the owning workbench, HumanOS and Context Locker files. It reported two `overused-font` warnings for Instrument Sans in `workbench.css`. Both are false positives for this product: `DESIGN.md` explicitly commits to the existing local Instrument Sans family, and the detector appears to match the generic word `Sans`.

## Audit health

| Dimension | Score | Evidence |
| --- | ---: | --- |
| Accessibility | 3/4 | Visible focus styles, 44px minimum controls, labelled navigation and an intentional reduced-motion path are present. No blocking issue is visible in this pass. |
| Performance | 3/4 | Motion uses opacity, transform and a shared layout indicator. A previously measured small Studio bundle overage remains in the context graph; this visual pass did not rerun performance gates. |
| Responsive design | 3/4 | The fresh fixture reports no horizontal overflow at 390px or 1440px, and its screenshots preserve a stable bottom navigation on phone. Live keyboard and browser-chrome behavior remain unverified. |
| Theming | 3/4 | The pearl, graphite and indigo palette is coherent and light-only by design. Workbench CSS repeats literal palette values after defining local variables, which makes refinement harder than it should be. |
| Implementation integrity | 3/4 | The interface is product-specific, calm and task-oriented. A few component seams still expose unclear action ownership and disconnected alignment. |
| **Total** | **15/20** | **Good. The structure is sound; address the concentrated hierarchy and material issues before calling the visual system finished.** |

Severity count for the current workbench: P0 0, P1 0, P2 2, P3 0. One dormant component seam is recorded separately and is not counted as a current journey defect.

## Priority findings

### Dormant component seam: keep any future source action inside its source row

The historical Knowledge screenshots show `Teach your AI` between the links controls and the `In your locker` heading. That image does not represent the current real workbench path. Current `CloneExperience.tsx` passes `onTestSource` to `ContextLockerPanel` and does not pass `onTeachSource`, so the standalone teach branch is dormant in this journey.

`ContextLockerPanel.tsx` still renders the optional teach action as a standalone `context-result-actions` block before the locker heading when a caller supplies `onTeachSource`. If that callback is reintroduced in another surface, the action would again be visually detached from the row it affects.

No current-workbench fix is required. Before any caller enables `onTeachSource`, move that optional action into the matching saved-source row and include the source name in its accessible label. Keep `Add links` as the only action attached to the links field.

A signed-in test would still be required if the optional branch is enabled, to verify the action remains attached to the right row while uploads settle, fail, retry, or reorder.

### 1. P2: Compact the secondary navigation above Knowledge

The current back control now aligns to the 920px content width, which fixes the prior orphaned placement. On desktop it has become a full-width outlined bar even though the persistent rail already provides the same route. In Knowledge, `Describe me` then appears as a second navigation control on its own line and begins left of the centered page content. On phone the two controls consume substantial space before the task heading.

The remaining mismatch is structural: `CloneExperience.tsx` renders both controls as siblings before the centered panel. Alignment rules fixed the first control, but the secondary link still does not belong to the page header.

Hide the redundant back control on desktop. On phone, keep it compact instead of stretching it as a bar. Move `Describe me` into the Knowledge page header as a secondary action, or return it to the Build overview, so one clear task heading starts the page. This is a `$impeccable layout` change.

This can be fixed from current fixture evidence.

### 2. P2: Finish the premium material in the shell

The palette matches the brief, but the overview still reads as a clean wireframe: flat white regions, uniform gray rules, and two generic initial tiles are doing most of the identity work. The visible brand mark is precise, yet the workspace itself does not carry the requested pearl, graphite and restrained metallic character. Repeated literal colors in `workbench.css` also split the palette from the variables declared at the top of the same file.

Consolidate the shell onto the existing variables, then give only the persistent frame and one primary working region a subtle metallic edge treatment. Use a real owner image when the product already has one; otherwise make the initial a compact identity affordance rather than a hero illustration. Do not add more cards, metrics, gradients or explanatory text.

The desktop rail and mobile bar now both have authored Framer Motion selection backgrounds, and routed content crossfades. Preserve this restrained state movement. Token consolidation can be implemented from current evidence. Final material intensity and motion timing should wait for one signed-in phone and desktop pass because screenshots cannot show tactile feel or transition continuity.

## What is already working

- The studio now reads as a personal workbench rather than a technical dashboard. There are no invented scores, diagnostic meters or decorative telemetry in the reviewed views.
- The 390px layout has a stable, thumb-sized bottom navigation and keeps the working content in normal document flow.
- The mobile navigation now carries the same state-linked selection movement as the desktop rail, with reduced motion respected.
- The overview has one strong next action, `Open private test`, after the three setup areas. The hierarchy is easy to understand.
- Personality's Identity card now takes its content height instead of stretching to match the longer five-field card.
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

After the two current-workbench changes above, run one paired 390px and 1440px signed-in pass covering overview, Knowledge and Personality, then finish with `$impeccable polish`. Do not use that pass to reopen the separate private rehearsal work.
