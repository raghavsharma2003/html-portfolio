// useCompact.ts — "is this a phone", answered once, by the browser.
//
// WHY A HOOK AND NOT A MEDIA QUERY
// ---------------------------------------------------------------------------
// Almost all of the mobile work in this wave is CSS, and should be: a media
// query needs no JavaScript, cannot desynchronise from the viewport, and costs
// nothing. This hook exists for the small set of decisions that are STRUCTURAL
// rather than presentational, where CSS genuinely cannot express the answer:
//
//   - whether a `<details>` starts OPEN. `open` is DOM state, not style. The
//     CSS-only workaround (`details:not([open]) > *  { display: block }`) is
//     unreliable across browsers because the UA stylesheet uses
//     `content-visibility`, and a panel that is invisible on one browser and
//     visible on another is worse than either.
//   - whether a rail renders as three rows or as one segmented control. Those
//     are different DOM, not the same DOM in two skins, and pretending
//     otherwise is how you ship a phone that downloads a desktop rail and hides
//     it.
//
// 720px rather than 590px, which is where studio.css's phone tier sits. The
// tiers answer different questions: 590 is "does this grid still fit", 720 is
// "is one primary action per screen the right density". A 700px tablet in
// portrait wants the compact structure and the roomier grid, and it gets both.
import { useEffect, useState } from "react";

export const COMPACT_QUERY = "(max-width: 720px)";

function readMatch(query: string): boolean {
  // Guarded because this is read during the first render, and a render can
  // happen in an environment with no `matchMedia` (a test runner, an older
  // WebView). `false` is the safe default: it renders the FULL layout, which
  // is complete and merely roomy. Defaulting to compact would hide panels from
  // a desktop user on the basis of a missing browser API, which is the worse
  // failure by a distance.
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(query).matches
      : false;
  } catch {
    return false;
  }
}

/**
 * True on a phone-sized viewport, and it follows a rotation.
 *
 * The listener is on the MediaQueryList rather than on `resize`, so it fires
 * once when the answer changes rather than on every frame of a drag, and it
 * does not fire at all while an on-screen keyboard resizes the visual viewport.
 * That second property matters here: the studio is full of text fields, and a
 * layout that restructures itself when a keyboard opens is a layout that loses
 * the field the person is typing into.
 */
export function useCompact(query: string = COMPACT_QUERY): boolean {
  const [compact, setCompact] = useState(() => readMatch(query));

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const list = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent) => setCompact(event.matches);
    // Re-read on mount as well as subscribing: between the first render and
    // this effect the viewport can already have changed (a rotation during
    // load, a restored window size).
    setCompact(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);

  return compact;
}
