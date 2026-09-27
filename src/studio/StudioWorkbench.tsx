import { motion, useReducedMotion } from "framer-motion";
import type { StudioLocale } from "../creatorStudio/studioLocalePreference";

export type WorkspaceDestination = "overview" | "knowledge" | "voice" | "personality" | "test" | "review" | "style" | "share";

const words = {
  en: {
    navigation: "Your workspace", build: "Build", improve: "Improve", publish: "Share",
    overview: "Your AI", knowledge: "Knowledge", voice: "Voice", personality: "Personality",
    test: "Test", review: "Corrections", style: "Response style", share: "Share",
    private: "Private workspace", sampleSaved: "Sample saved", pending: "Keep or discard your recording before leaving.",
    intro: "Build your AI.", next: "Add what you know. Shape how it responds. Then try a conversation.",
    knowledgeNote: "Notes, documents and links", voiceNote: "Record or upload your voice",
    personalityNote: "Your perspective, style and boundaries", saved: "Saved", add: "Add", open: "Open",
    testTitle: "Meet your AI", testNote: "Ask a real question. Tell it what you would change.",
    testAction: "Open private test", sources: "Manage your sources", preview: "Preview sharing",
  },
  hi: {
    navigation: "आपकी जगह", build: "बनाएँ", improve: "सुधारें", publish: "साझा करें",
    overview: "आपका AI", knowledge: "जानकारी", voice: "आवाज़", personality: "व्यक्तित्व",
    test: "आज़माएँ", review: "सुधार", style: "जवाब देने का अंदाज़", share: "साझा करें",
    private: "निजी जगह", sampleSaved: "नमूना सहेजा गया", pending: "आगे जाने से पहले अपनी रिकॉर्डिंग रखें या हटाएँ।",
    intro: "अपना AI बनाएँ।", next: "अपनी जानकारी जोड़ें। जवाब देने का अंदाज़ चुनें। फिर बातचीत करें।",
    knowledgeNote: "नोट्स, दस्तावेज़ और लिंक", voiceNote: "आवाज़ रिकॉर्ड या अपलोड करें",
    personalityNote: "आपका नज़रिया, अंदाज़ और सीमाएँ", saved: "सहेजा गया", add: "जोड़ें", open: "खोलें",
    testTitle: "अपने AI से मिलें", testNote: "एक असली सवाल पूछें। बताएँ कि आप क्या बदलेंगे।",
    testAction: "निजी टेस्ट खोलें", sources: "अपनी सामग्री देखें", preview: "साझा करने के विकल्प",
  },
} as const;

type Props = {
  locale: StudioLocale;
  name: string;
  active: WorkspaceDestination;
  disabled: boolean;
  onNavigate: (destination: WorkspaceDestination) => void;
};

export function WorkspaceNavigation({ locale, name, active, disabled, onNavigate }: Props) {
  const copy = words[locale];
  const reduced = useReducedMotion();
  const groups: { label: string; items: WorkspaceDestination[] }[] = [
    { label: copy.build, items: ["overview", "knowledge", "voice", "personality"] },
    { label: copy.improve, items: ["test", "review", "style"] },
    { label: copy.publish, items: ["share"] },
  ];
  const mobileItems: WorkspaceDestination[] = ["overview", "test", "review", "share"];
  const mobileActive = ["knowledge", "voice", "personality"].includes(active) ? "overview" : active === "style" ? "review" : active;
  return <>
    <aside className="workbench-sidebar">
      <div className="workbench-identity"><span aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span><div><strong>{name}</strong><small>{copy.private}</small></div></div>
      <nav aria-label={copy.navigation}>{groups.map(group => <div className="workbench-nav-group" key={group.label}>
        <p>{group.label}</p>
        {group.items.map(item => <button key={item} type="button" disabled={disabled} aria-current={item === active ? "page" : undefined} onClick={() => onNavigate(item)}>
          {item === active && <motion.span className="workbench-selection" layoutId="workbench-selection" transition={{ duration: reduced ? 0 : 0.18, ease: "easeOut" }} aria-hidden="true" />}
          <span>{copy[item]}</span>
        </button>)}
      </div>)}</nav>
      {disabled && <p className="workbench-nav-note" role="status">{copy.pending}</p>}
    </aside>
    <nav className="workbench-mobile-nav" aria-label={copy.navigation}>{mobileItems.map(item => <button key={item} type="button" disabled={disabled} aria-current={mobileActive === item ? "page" : undefined} onClick={() => onNavigate(item)}>{item === "overview" ? copy.build : item === "review" ? copy.improve : copy[item]}</button>)}</nav>
  </>;
}

export function WorkspaceOverview({ locale, name, knowledgeSaved, profileSaved, voiceSaved, onNavigate, onSources }: {
  locale: StudioLocale; name: string; knowledgeSaved: boolean; profileSaved: boolean; voiceSaved: boolean;
  onNavigate: Props["onNavigate"]; onSources: () => void;
}) {
  const copy = words[locale];
  const items: { id: WorkspaceDestination; title: string; note: string; saved: boolean }[] = [
    { id: "knowledge", title: copy.knowledge, note: copy.knowledgeNote, saved: knowledgeSaved },
    { id: "voice", title: copy.voice, note: copy.voiceNote, saved: voiceSaved },
    { id: "personality", title: copy.personality, note: copy.personalityNote, saved: profileSaved },
  ];
  return <section className="workbench-overview" aria-labelledby="knowledge-menu-title">
    <header className="workbench-intro"><div><p className="workbench-person-name">{name}</p><h1 id="knowledge-menu-title">{copy.intro}</h1><p>{copy.next}</p></div><div className="workbench-monogram" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</div></header>
    <div className="workbench-setup-list">{items.map(item => <button type="button" key={item.id} onClick={() => onNavigate(item.id)}>
      <span><strong>{item.title}</strong><small>{item.note}</small></span><span className="workbench-row-action">{item.saved ? item.id === "voice" ? copy.sampleSaved : copy.saved : copy.add}<span aria-hidden="true">→</span></span>
    </button>)}</div>
    <section className="workbench-test"><div><h2>{copy.testTitle}</h2><p>{copy.testNote}</p></div><button className="vx-button vx-button--primary" type="button" onClick={() => onNavigate("test")}>{copy.testAction}</button></section>
    <div className="workbench-secondary"><button type="button" onClick={onSources}>{copy.sources}</button><button type="button" onClick={() => onNavigate("share")}>{copy.preview}</button></div>
  </section>;
}
