// studioLocalePreference.ts — WS-R91. The pre-sign-in half of the studio's
// locale order, pulled out as its own DOM-free, React-free module so
// `evals/studio-locale/run.mjs` can prove the exact fallback chain directly
// (bundle it, call it, assert) rather than trusting a browser fixture to
// exercise every branch of logic that used to live inline inside
// `StudioApp.tsx`'s own render body.
//
// THE CHAIN (context/decisions.md#ws-r91-authgate-reads-locale-before-sign-in):
//   1. `?lang=` in the URL — always wins, signed in or not. A URL a creator
//      bookmarked or shared should not silently stop meaning what it said
//      (WS-R52's own reason, unchanged).
//   2. Once a replica has loaded, ITS OWN `vy_replica.locale` (migration
//      112) — WS-R52's order, unchanged. A signed-in creator's stored
//      preference always wins over whatever this file remembers locally.
//   3. Before a replica has loaded (signed out, or signed in but the
//      replica list has not resolved yet), the REMEMBERED local choice —
//      the studio's own `localStorage` key, read once.
//   4. `"en"`, same default every other locale read in this codebase falls
//      back to.
//
// A mismatch between step 3's remembered choice and step 2's row (a creator
// switched language on a different device, or before ever finishing sign-in
// on this one) resolves to the ROW every time, by construction: step 2 is
// checked before step 3 is ever consulted.
import { normalizeStudioLocale, type StudioLocale } from "./copy";

export const STUDIO_LOCALE_STORAGE_KEY = "vyakti.studio.locale.v1";

/** Reads the remembered pre-auth choice, or `null` if there is none / storage
 *  is unavailable — every failure path here falls back to `"en"` further up
 *  the chain, exactly `restoreStudioMode`'s own posture in `studioAuth.ts`. */
export function readRememberedStudioLocale(): StudioLocale | null {
  try {
    const raw = localStorage.getItem(STUDIO_LOCALE_STORAGE_KEY);
    return raw === "en" || raw === "hi" ? raw : null;
  } catch {
    return null;
  }
}

/** Best-effort only. A creator who switched language and whose browser then
 *  refused the write still SAW the switch happen (`studioLocale` itself is
 *  in-memory state, not re-derived from storage on every render) — only the
 *  NEXT visit silently reverts, matching every other storage write in this
 *  file's own precedent. */
export function writeRememberedStudioLocale(value: StudioLocale): void {
  try {
    localStorage.setItem(STUDIO_LOCALE_STORAGE_KEY, value);
  } catch {
    // Storage denied. Nothing this call can do about it.
  }
}

/** The chain itself, pure: no `localStorage`, no `window`, no React —
 *  `resolveStudioLocale({ urlLocale, replica: null, rememberedLocale: null })`
 *  is `"en"`, always, provably, without a browser. */
export function resolveStudioLocale({
  urlLocale,
  replica,
  rememberedLocale,
}: {
  urlLocale: StudioLocale | null;
  /** `null` before a replica has loaded (signed out, or the fetch is still
   *  in flight) — an object once it has. `.locale` is read through
   *  `normalizeStudioLocale`, never trusted raw, the same guard every other
   *  reader of this column already applies. */
  replica: { locale?: unknown } | null;
  rememberedLocale: StudioLocale | null;
}): StudioLocale {
  if (urlLocale) return urlLocale;
  if (replica) return normalizeStudioLocale(replica.locale);
  return rememberedLocale ?? "en";
}
