// ProcessingStatusMount.tsx — WS-AF's home in the wizard.
//
// The owner wants to SEE whether their video arrived and where each job is.
// That surface is WS-AF's build and it had not landed when this shell was
// integrated, so this is the labelled slot, not a fake panel.
//
// TWO SLOTS, ONE COMPONENT, on purpose. The question "did my upload arrive"
// gets asked in two different moods and they want different answers:
//
//   on FEED  ("did that land?")  right after a drop, while the owner still has
//            the file in their hand and can re-add it.
//   on MEET  ("why does it not know that yet?")  when the clone answers without
//            something the owner is sure they gave it, which is the moment a
//            queue depth stops being trivia and becomes the explanation.
//
// `where` selects which of the two it is speaking to. WS-AF should keep that
// distinction rather than shipping one panel twice.
//
// WHEN WS-AF LANDS: replace both `<ProcessingStatusMount>` mounts in
// `StudioApp.tsx` with its panel and delete this file. It holds no state and
// makes no request, so removing it cannot break anything around it.

export default function ProcessingStatusMount({ where }: { where: "feed" | "meet" }) {
  return (
    <section
      id={`processing-status-${where}`}
      className="processing-status-mount"
      aria-labelledby={`processing-status-${where}-title`}
    >
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coming online</p>
          <h2 id={`processing-status-${where}-title`}>
            {where === "feed" ? "Where each upload is right now" : "What has finished, and what has not"}
          </h2>
          <p>
            {where === "feed"
              ? "A live view of every file, link and video you have handed over: queued, downloading, transcribing, mined, or refused with a reason. It is being built and is not connected yet."
              : "If the clone does not know something you are sure you gave it, this is where you will see whether that job has finished. It is being built and is not connected yet."}
          </p>
        </div>
      </div>
      <p className="field-note">
        Until it is connected, each panel above reports its own items and their state. Nothing is hidden, it is just
        in more than one place.
      </p>
    </section>
  );
}
