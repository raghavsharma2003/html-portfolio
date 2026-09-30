import "./expert-entry.css";

/** Brand artwork for the personal entry. It depicts no customer or product proof. */
export default function ExpertEntryVisual({ copy = { alt: "Luminous curved glass panels in soft silver light", knowledge: "Your knowledge.", voice: "Your voice.", people: "Your people." } }: { copy?: { alt: string; knowledge: string; voice: string; people: string } }) {
  return <figure className="expert-entry-visual">
    <picture>
      <source media="(max-width: 720px)" srcSet="/expert/auth-silver-640.webp" width="640" height="360" />
      <img src="/expert/auth-silver-1200.webp" alt={copy.alt} width="1200" height="675" loading="lazy" decoding="async" fetchPriority="low" />
    </picture>
    <figcaption><span>{copy.knowledge}</span><span>{copy.voice}</span><span>{copy.people}</span></figcaption>
  </figure>;
}
