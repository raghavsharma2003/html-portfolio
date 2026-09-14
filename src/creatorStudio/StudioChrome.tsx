// StudioChrome.tsx — WS-R91. `Mark` (the brand glyph) and `Spinner` (the
// generic busy indicator) used to live inside `StudioApp.tsx` itself, where
// both the pre-auth `AuthGate` and the signed-in tree defined further down
// the same file could reach them as plain in-file functions. `AuthGate` is
// now its own file (`AuthGate.tsx`, this workstream) so it can be a Tier 1
// file `evals/studio-locale/run.mjs`'s static scan proves reads only `t.` —
// and a component `StudioApp.tsx` imports cannot also import FROM
// `StudioApp.tsx` without a circular module reference. So both pieces of
// chrome move here, a leaf both files import, neither owns.
//
// Carries no literal English text of its own (`label` is always a caller's
// own prop, an `aria-label` attribute value rather than a JSX text node) —
// `localeContext.tsx`/`Localized.tsx`'s own precedent for what belongs in
// `evals/studio-locale/run.mjs`'s `TIER_1_FILES` list with nothing to
// translate.
export function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}
