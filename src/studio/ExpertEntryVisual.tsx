import "./expert-experience.css";

/** Existing Vyakti identity, expert-first entry. The fictional portrait illustrates
 * the use scene; it is never presented as a customer or a quality testimonial. */
export default function ExpertEntryVisual() {
  return <figure className="expert-entry-visual">
    <img src="/expert/expert-at-work.webp" alt="Illustration of an educator explaining an idea in her studio" width="1200" height="800" fetchPriority="high" />
    <figcaption><span>Your knowledge.</span><span>Your voice.</span><span>Your people.</span></figcaption>
  </figure>;
}
