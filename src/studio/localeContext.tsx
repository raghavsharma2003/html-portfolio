// src/studio/localeContext.tsx — WS-R159. The signed-in personal studio's
// own locale provider, matching `src/creatorStudio/localeContext.tsx`
// (WS-R52)'s own established shape exactly rather than inventing a second
// one: `StudioLocaleProvider` takes `locale` as a PROP (the caller resolves
// it once), and `useStudioLocale()` reads a context with a REAL default
// value (English) rather than throwing outside a provider — this is not a
// stylistic choice, it is load-bearing: several PRE-EXISTING `evals/`
// harnesses (`evals/conversation-setup-ui.mjs`, committed before this
// workstream, importing a `StudioLocaleProvider` from `./localeContext`
// that did not yet exist) already assumed exactly this contract
// (`context/rejected.md
// #ws-r159-first-localecontext-draft-invented-a-second-provider-contract`).
//
// `readStudioLocale()` is the CALLER's job (`StudioApp.tsx` calls it once
// and passes the result down as the `locale` prop), not the provider's —
// again matching creatorStudio's own split (its own `StudioApp.tsx` resolves
// locale itself and passes it to both `StudioLocaleProvider` and
// `StudioLocaleAuthProvider`).
//
// WHAT THIS PROVIDER DOES NOT DO. The chain's second-priority step in
// `src/creatorStudio/`'s own order — a signed-in creator's own stored
// `vy_replica.locale` — has no equivalent read here: the personal studio's
// own `Replica` type (`./types.ts`) carries no `locale` column at all, and
// this workstream ships no migration (`context/decisions.md
// #ws-r159-tier-1-scope-and-tier-2-allowlist`). `readStudioLocale()`'s chain
// is therefore `?lang=` -> remembered choice -> `"en"`, one step shorter
// than `resolveStudioLocale`'s general shape; `resolveStudioLocale` is still
// reused directly (called with `replica: null` always) rather than
// reimplemented, so the URL-wins-always and empty-string-normalizes-to-null
// behavior stays identical to every other locale reader in this codebase.
import { createContext, useContext, useEffect, useReducer, type ReactNode } from "react";
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";
import {
  normalizeStudioLocale,
  readRememberedStudioLocale,
  resolveStudioLocale,
  writeRememberedStudioLocale,
} from "../creatorStudio/studioLocalePreference";
import { loadStudioCopy, STUDIO_COPY_TABLE, studioCopyReady, type StudioCopy } from "./copy";

/** `?lang=` -> remembered choice -> `"en"`. No replica-locale step — see
 *  this file's own header. Called once by the caller (`StudioApp.tsx`),
 *  never by the provider itself. */
export function readStudioLocale(): StudioLocale {
  const raw = new URLSearchParams(window.location.search).get("lang");
  return resolveStudioLocale({
    urlLocale: raw === "hi" || raw === "en" ? raw : null,
    replica: null,
    rememberedLocale: readRememberedStudioLocale(),
  });
}

interface StudioLocaleValue {
  locale: StudioLocale;
  t: StudioCopy;
}

const DEFAULT_VALUE: StudioLocaleValue = { locale: "en", t: STUDIO_COPY_TABLE.en };

const StudioLocaleContext = createContext<StudioLocaleValue>(DEFAULT_VALUE);

/** Never throws outside a provider: falls back to `en`, the same posture
 *  `src/creatorStudio/localeContext.tsx`'s own header states and for the
 *  same reason — a file mounted by an eval harness or fixture with no
 *  provider still renders real English rather than crashing. */
export function useStudioLocale(): StudioLocaleValue {
  return useContext(StudioLocaleContext);
}

/** Renders nothing until the resolved locale's table is installed (English
 *  is always "installed"; Hindi resolves the instant `copy.ts`'s dynamic
 *  `import()` lands) — `context/decisions.md
 *  #studio-hindi-table-is-its-own-chunk`'s own contract, restated here for
 *  this registry. `switchLocale` (the URL write plus the studio's own
 *  remembered-choice write) is the CALLER's job — `LanguageSwitch.tsx` calls
 *  it directly, since the caller is the one component that knows how it
 *  reached its current `locale` prop in the first place. */
export function StudioLocaleProvider({ locale, children }: { locale: StudioLocale; children: ReactNode }) {
  const safe = normalizeStudioLocale(locale);
  const ready = studioCopyReady(safe);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    writeRememberedStudioLocale(safe);
  }, [safe]);
  useEffect(() => {
    if (ready) return;
    let alive = true;
    loadStudioCopy(safe).then(() => {
      if (alive) rerender();
    });
    return () => { alive = false; };
  }, [safe, ready]);
  if (!ready) return null;
  const value: StudioLocaleValue = { locale: safe, t: STUDIO_COPY_TABLE[safe] };
  return <StudioLocaleContext.Provider value={value}>{children}</StudioLocaleContext.Provider>;
}
