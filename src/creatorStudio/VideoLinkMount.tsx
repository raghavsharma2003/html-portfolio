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

import { useStudioLocale } from "./localeContext";

/** What the channel lane already covers, so the gap is stated precisely. */
export default function VideoLinkMount() {
  const { t } = useStudioLocale();
  const c = t.videoLinkMount;
  return (
    <section id="video-link-mount" className="video-link-mount" aria-labelledby="video-link-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="video-link-title">{c.title}</h2>
          <p>{c.blurb}</p>
        </div>
      </div>
      <div className="video-link-body">
        <p className="field-note">{c.noBoxNote}</p>
        <p className="field-note">{c.worksTodayNote}</p>
      </div>
    </section>
  );
}
