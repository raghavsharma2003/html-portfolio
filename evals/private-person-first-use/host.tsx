import { useState } from "react";
import { createRoot } from "react-dom/client";
import PrivateTextRehearsal, { type PrivateTextReturnDraft } from "../../src/studio/PrivateTextRehearsal";
import { StudioLocaleProvider } from "../../src/studio/localeContext";
import type { StudioLocale } from "../../src/creatorStudio/studioLocalePreference";

declare global {
  interface Window { profileDraft?: PrivateTextReturnDraft; }
}

const ITEM = "30000000-0000-4000-8000-000000000001";
const params = new URLSearchParams(location.search);
const locale: StudioLocale = params.get("lang") === "hi" ? "hi" : "en";
const scenario = params.get("scenario") === "teacher" ? "teacher" : "person";

function Fixture() {
  const [profileOpen, setProfileOpen] = useState(false);
  if (profileOpen) return <main><h1>{locale === "hi" ? "व्यक्तित्व खुल गया" : "Personality opened"}</h1></main>;
  return <PrivateTextRehearsal
    token={`synthetic-owner-${scenario}`}
    replicaId="10000000-0000-4000-8000-000000000001"
    lifecycle="draft"
    initialDraft={{ question: "How should I explain this?", sheetId: "", contextItemId: ITEM }}
    onBack={() => {}}
    onEditContext={() => {}}
    onEditProfile={draft => { window.profileDraft = draft; setProfileOpen(true); }}
    onAuthError={cause => { throw cause; }}
  />;
}

createRoot(document.getElementById("root")!).render(<StudioLocaleProvider locale={locale}><Fixture /></StudioLocaleProvider>);
