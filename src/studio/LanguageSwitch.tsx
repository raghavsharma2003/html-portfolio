// src/studio/LanguageSwitch.tsx — WS-R159. The signed-in studio shell's own
// language switch: `locale`/`onSwitch` as explicit props, matching
// `src/creatorStudio/StudioShell.tsx`'s own `StudioLanguageSwitch` shape
// (the caller owns the locale state and the switch callback; this component
// only renders the control) rather than reading `useStudioLocale()`'s own
// switchLocale — this registry's `StudioLocaleProvider` deliberately has no
// switchLocale of its own, `localeContext.tsx`'s own header explains why.
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";

export default function LanguageSwitch({
  locale,
  onSwitch,
  id = "studio-language",
}: {
  locale: StudioLocale;
  onSwitch: (locale: StudioLocale) => void;
  id?: string;
}) {
  return (
    <>
      <label className="visually-hidden" htmlFor={id}>{locale === "hi" ? "भाषा" : "Language"}</label>
      <select
        id={id}
        className="auth-language-select"
        value={locale}
        onChange={(event) => onSwitch(event.target.value === "hi" ? "hi" : "en")}
      >
        <option value="en" lang="en">English</option>
        <option value="hi" lang="hi">हिन्दी</option>
      </select>
    </>
  );
}
