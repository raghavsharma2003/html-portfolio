// localeContext.tsx — WS-R52. Hands the studio's own copy table
// (STUDIO_COPY_TABLE from copy.ts) to any component mounted under
// `StudioLocaleProvider`, without threading a `t`/`locale` prop through
// every one of the ~30 panel components `StudioApp.tsx` renders.
//
// WHY A CONTEXT RATHER THAN PROPS, UNLIKE `src/room/copy.ts`
// ---------------------------------------------------------------------------
// The Room is one component (`RoomApp.tsx`) reading `ROOM_COPY_TABLE[locale]`
// once and passing the resulting `copy` object down its own, single tree.
// The studio is not that shape: `StudioApp.tsx` lazy-mounts ~30 independent
// panel components, each with its own prop interface already defined by an
// earlier workstream, and Tier 2 of this workstream (the enrollment/voice
// wizard internals -- see copy.ts's own header) is deliberately NOT touched.
// A context lets `BlockerNotice.tsx` and `WizardRail.tsx` -- both shared by
// EVERY panel, Tier 1 and Tier 2 alike -- read the two-word class badge in
// the creator's own language with no change to their exported signature, so
// even an unconverted Tier 2 panel's "Waiting on you"/"Waiting on us" badge
// comes out in Hindi for free. Prop-threading `t` through 30 independent
// interfaces to get the same two labels right would be the wrong shape for
// what it buys.
//
// `useStudioLocale()` never throws outside a provider: it falls back to
// `en`, so a file rendered by an eval harness or Storybook-shaped fixture
// with no provider still renders real English rather than crashing.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import {
  loadStudioCopy,
  loadStudioCopyAuth,
  normalizeStudioLocale,
  STUDIO_COPY_TABLE,
  studioAuthCopyReady,
  studioCopyReady,
  type StudioCopy,
  type StudioLocale,
} from "./copy";

interface StudioLocaleValue {
  locale: StudioLocale;
  t: StudioCopy;
}

const DEFAULT_VALUE: StudioLocaleValue = { locale: "en", t: STUDIO_COPY_TABLE.en };

const StudioLocaleContext = createContext<StudioLocaleValue>(DEFAULT_VALUE);

// A module-level mirror of the current locale, for the handful of plain
// functions that are not components and so cannot call `useStudioLocale()`
// -- `WizardRail.tsx`'s `jumpTo`/`announce`, called from both Tier 1 and
// Tier 2 panels this workstream did not otherwise touch. `StudioLocaleProvider`
// keeps it in sync on every render via the effect below; every OTHER read of
// locale in this codebase goes through the context, never this variable --
// it exists only because a free function has nothing to subscribe to.
let activeLocale: StudioLocale = "en";
export function getActiveStudioLocale(): StudioLocale {
  return activeLocale;
}

export function StudioLocaleProvider({ locale, children }: { locale: StudioLocale; children: ReactNode }) {
  const safe = normalizeStudioLocale(locale);
  // The Hindi table is TWO independently-lazy chunks (`src/studio/
  // hiAuthCopy.ts` + `hiCopy.ts`, WS-R113 splitting the WS-R71 merge): until
  // `loadStudioCopy` has installed BOTH, `STUDIO_COPY_TABLE.hi` throws on
  // read, so this provider (mounted only around the SIGNED-IN tree --
  // `StudioLocaleAuthProvider` above is the sign-in screen's own, smaller
  // gate) renders NOTHING for a locale whose table is not fully ready yet -
  // never English in its place - and re-renders once both chunks land.
  // English is ready at module load, so the English studio pays no wait at
  // all; a signed-in Hindi creator waits on whichever chunk (if either) is
  // not already installed and never sees the wrong language.
  const ready = studioCopyReady(safe);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    activeLocale = safe;
  }, [safe]);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadStudioCopy(safe).then(() => {
      if (alive) rerender();
    });
    return () => {
      alive = false;
    };
  }, [safe, ready]);
  if (!ready) return null;
  const value: StudioLocaleValue = { locale: safe, t: STUDIO_COPY_TABLE[safe] };
  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>;
}

export function useStudioLocale(): StudioLocaleValue {
  return useContext(StudioLocaleContext);
}

// WS-R113. `AuthGate.tsx` (the sign-in screen) reads exactly two sections --
// `t.authGate` in full, `t.shell.languageGroupLabel` for its own language
// switch -- both of which now live in their own chunk, `hiAuthCopy.ts`,
// smaller and loaded earlier than the rest of the studio's Hindi table
// (`copy.ts`'s own header names the measurement this fixes). Gating the
// SIGN-IN screen on `studioCopyReady`/`loadStudioCopy` (the signed-in
// provider below, unchanged) would still block it on every OTHER panel's
// Hindi -- `roomStudio`, the whole enrollment wizard -- none of which a
// signed-out visitor can ever reach. This provider is the sign-in screen's
// own gate: it waits on `studioAuthCopyReady`/`loadStudioCopyAuth` only.
// `StudioApp.tsx` mounts THIS provider around `AuthGate`, never the one
// below, for exactly this reason.
export function StudioLocaleAuthProvider({ locale, children }: { locale: StudioLocale; children: ReactNode }) {
  const safe = normalizeStudioLocale(locale);
  const ready = studioAuthCopyReady(safe);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    activeLocale = safe;
  }, [safe]);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadStudioCopyAuth(safe).then(() => {
      if (alive) rerender();
    });
    return () => {
      alive = false;
    };
  }, [safe, ready]);
  if (!ready) return null;
  const value: StudioLocaleValue = { locale: safe, t: STUDIO_COPY_TABLE[safe] };
  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>;
}
