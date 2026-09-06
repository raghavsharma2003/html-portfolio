// VideoLinkMount.tsx — the single-video lane's place on the Feed step.
//
// WHY A MOUNT POINT AND NOT A PANEL
// ---------------------------------------------------------------------------
// The owner's IA (`context/decisions.md#three-step-wizard-ia`) names four things
// on step one: files, a YouTube VIDEO link, a channel link, and other reference
// links. Three of the four have a panel today. The fourth, one video by URL, is
// WS-AD's build on branch `gurukul-ws-ad`, which had landed nothing at the time
// this shell was integrated.
//
// So this is the labelled hole, not a fake panel. It is here rather than absent
// for one reason: the owner asked for four intake surfaces and a step that
// silently ships three is a step that reads as finished. A visible, honestly
// captioned gap is the difference between "not built yet" and "we forgot".
//
// WHAT IT MUST NOT DO. It does not accept a URL into a field that goes nowhere.
// A form that takes input and drops it is worse than no form: it costs the
// owner the paste, the wait, and the trust, and it is exactly the shape
// `docs/HONESTY.md` exists to forbid. There is no input here on purpose.
//
// WHEN WS-AD LANDS: delete this file and mount its panel in the same slot in
// `StudioApp.tsx` (search for `VideoLinkMount`). It carries no state and no API
// call, so removing it cannot break anything above it.

/** What the channel lane already covers, so the gap is stated precisely. */
export default function VideoLinkMount() {
  return (
    <section id="video-link-mount" className="video-link-mount" aria-labelledby="video-link-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Coming online</p>
          <h2 id="video-link-title">One video, by link</h2>
          <p>
            Paste a single lecture URL and we pull the audio, transcribe it, and propose what it teaches us about
            how you explain. This lane is being built right now and is not connected yet.
          </p>
        </div>
      </div>
      <div className="video-link-body">
        <p className="field-note">
          There is deliberately no box to paste into yet. A field that accepted a link and did nothing with it would
          cost you the paste and the wait, and tell you nothing true.
        </p>
        <p className="field-note">
          What works today for video: connect your channel below, and we watch it for new uploads with your
          attested permission. Everything that lane extracts is proposed to you, never applied on its own.
        </p>
      </div>
    </section>
  );
}
