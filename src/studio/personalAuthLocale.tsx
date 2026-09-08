import { useEffect, useState } from "react";
import { loadPersonalAuthCopy, PERSONAL_AUTH_COPY_TABLE, personalAuthCopyReady } from "./personalAuthCopyRegistry";
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";
import { readRememberedStudioLocale, resolveStudioLocale, writeRememberedStudioLocale } from "../creatorStudio/studioLocalePreference";

export function readPersonalAuthLocale(): StudioLocale {
  const raw = new URLSearchParams(window.location.search).get("lang");
  return resolveStudioLocale({ urlLocale: raw === "hi" || raw === "en" ? raw : null, replica: null, rememberedLocale: readRememberedStudioLocale() });
}

export function usePersonalAuthLocale() {
  const [locale, setLocale] = useState(readPersonalAuthLocale);
  const [revision, setRevision] = useState(0);
  const [failed, setFailed] = useState(false);
  const ready = personalAuthCopyReady(locale);
  useEffect(() => {
    writeRememberedStudioLocale(locale);
    if (ready) { setFailed(false); return; }
    let alive = true;
    setFailed(false);
    loadPersonalAuthCopy(locale).then(() => { if (alive) setRevision(n => n + 1); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [locale, ready, revision]);
  function switchLocale(value: StudioLocale) {
    const url = new URL(window.location.href);
    url.searchParams.set("lang", value);
    try { window.history.replaceState(window.history.state, "", url); } catch { /* The in-memory choice still works when history writes are blocked. */ }
    writeRememberedStudioLocale(value);
    setLocale(value);
  }
  return { locale, ready, failed, switchLocale, retry: () => setRevision(n => n + 1), t: ready ? PERSONAL_AUTH_COPY_TABLE[locale] : PERSONAL_AUTH_COPY_TABLE.en };
}

// This small bootstrap stays available when the lazy locale chunk cannot load.
export function PersonalAuthLoading({ locale, failed, retry, switchLocale, testEnvironment = false }: { locale: StudioLocale; failed: boolean; retry: () => void; switchLocale?: (locale: StudioLocale) => void; testEnvironment?: boolean }) {
  return <main className="auth-page auth-loading" data-auth-theme={testEnvironment ? "test" : "general"} lang={locale} aria-busy={!failed}>
    <section className="auth-card">
      <p role={failed ? "alert" : "status"}>{locale === "hi"
        ? failed ? "भाषा लोड नहीं हुई। फिर कोशिश करें।" : "साइन-इन खुल रहा है।"
        : failed ? "The language could not load. Try again." : "Opening sign-in."}</p>
      {failed && <button type="button" className="text-button" onClick={retry}>{locale === "hi" ? "फिर कोशिश करें" : "Try again"}</button>}
      {failed && locale === "hi" && switchLocale && <button type="button" className="text-button" lang="en" onClick={() => switchLocale("en")}>Use English</button>}
    </section>
  </main>;
}
