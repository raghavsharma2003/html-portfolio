import "./expert-experience.css";

/** Existing Vyakti identity, expert-first entry. The fictional portrait illustrates
 * the use scene; it is never presented as a customer or a quality testimonial. */
export default function ExpertEntryVisual({ copy = { alt: "Illustration of an educator explaining an idea in her studio", knowledge: "Your knowledge.", voice: "Your voice.", people: "Your people." } }: { copy?: { alt: string; knowledge: string; voice: string; people: string } }) {
  return <figure className="expert-entry-visual">
    <img src="/expert/expert-at-work.webp" alt={copy.alt} width="1200" height="800" fetchPriority="high" />
    <figcaption><span>{copy.knowledge}</span><span>{copy.voice}</span><span>{copy.people}</span></figcaption>
  </figure>;
}
