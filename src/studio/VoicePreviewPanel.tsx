// "Preview my voice" — the first place an owner meets their own clone.
//
// VoicePreviewLab (further down the studio, behind the advanced surface) is the
// calibration instrument: seven delivery conditions, blind A/B, a held-out
// gate. This is not that. This is one box, one button, and one honest answer.
//
// The honesty is the design. The GPU runtime scales to zero, so the first
// click of the day genuinely cannot produce audio for about two to three
// minutes — and every dishonest way of showing that was available and
// rejected: a spinner that runs until the platform kills the request at 240 s,
// a fake progress bar, or an error for a service that is merely asleep. The
// server answers 202 with a warming state; this component shows it, counts
// down, and retries by itself.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getReplicaReview } from "./processingApi";
import { ReplicaApiError } from "./replicaApi";
import { friendlyError } from "./errorCopy";
import type { ReplicaReview } from "./types";
import { requestVoicePanelPreview, type VoicePanelWarming } from "./voicePanelApi";
import { disabledReason, type DisabledReason } from "./blockerClass";
import { DisabledAction } from "./BlockerNotice";

const MAX_TEXT = 280;

// Shapes, not a phrase bank: two short greetings an owner will immediately
// rewrite. Kept under the cap so the counter never opens on a violation.
const WELCOME = {
  hi: "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai, physics, chemistry ya maths?",
  en: "Hello, this is my AI version. Tell me what you are stuck on today and we will work through it together.",
} as const;

type Phase =
  | { kind: "idle" }
  | { kind: "synthesizing" }
  | { kind: "warming"; warming: VoicePanelWarming; retryAt: number; attempt: number }
  | { kind: "ready"; url: string; generationId: string; modelCommitment: string }
  | { kind: "error"; headline: string; detail: string; canRetry: boolean };

// A cold start is one wake, not a loop. Six polls at ~30 s covers the measured
// 161 s boot with margin; past that something is wrong and saying so beats
// retrying forever against a GPU meter.
const MAX_AUTO_RETRIES = 6;

export default function VoicePreviewPanel({ token, replicaId, onAuthError }: {
  token: string;
  replicaId: string;
  onAuthError: (cause: unknown) => void;
}) {
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<"hi" | "en">("hi");
  const [text, setText] = useState<string>(WELCOME.hi);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [remaining, setRemaining] = useState(0);
  const urlRef = useRef<string>("");

  const draft = useMemo(
    () => review?.voice_genomes.find((item) => item.status === "draft") ?? null,
    [review],
  );
  const overLimit = Array.from(text).length > MAX_TEXT;

  useEffect(() => {
    let live = true;
    setLoading(true);
    getReplicaReview(token, replicaId)
      .then((value) => { if (live) setReview(value); })
      .catch((cause) => {
        if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onAuthError, replicaId, token]);

  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);

  const run = useCallback(async (attempt: number) => {
    if (!draft) return;
    setPhase({ kind: "synthesizing" });
    try {
      const outcome = await requestVoicePanelPreview(token, {
        replicaId,
        genomeVersion: draft.version,
        text,
        languageId: language,
      });
      if (outcome.kind === "warming") {
        if (attempt >= MAX_AUTO_RETRIES) {
          setPhase({
            kind: "error",
            headline: "The voice runtime did not finish waking up",
            detail: `It has been asked ${attempt} times over about ${Math.round((attempt * outcome.retryAfterMs) / 1000)} seconds and is still starting. Try again in a few minutes, or tell support the runtime is not coming up.`,
            canRetry: true,
          });
          return;
        }
        setPhase({ kind: "warming", warming: outcome, retryAt: Date.now() + outcome.retryAfterMs, attempt });
        return;
      }
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(outcome.audio);
      setPhase({
        kind: "ready",
        url: urlRef.current,
        generationId: outcome.generationId,
        modelCommitment: outcome.modelCommitment,
      });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      const friendly = friendlyError(cause, "Preview");
      setPhase({ kind: "error", ...friendly });
    }
  }, [draft, language, onAuthError, replicaId, text, token]);

  // The countdown and the automatic retry. One interval owns both, so the
  // number on screen and the moment the request fires cannot drift apart.
  useEffect(() => {
    if (phase.kind !== "warming") { setRemaining(0); return; }
    const tick = () => {
      const left = phase.retryAt - Date.now();
      setRemaining(Math.max(0, Math.ceil(left / 1000)));
      if (left <= 0) void run(phase.attempt + 1);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [phase, run]);

  function changeLanguage(next: "hi" | "en") {
    setLanguage(next);
    if (text.trim() === WELCOME.hi || text.trim() === WELCOME.en) setText(WELCOME[next]);
  }

  const busy = phase.kind === "synthesizing" || phase.kind === "warming";

  // ── why the button is dead, in the button's own box ─────────────────────
  //
  // THE OWNER'S REPORT, VERBATIM: "Preview my voice" rendered DISABLED with no
  // visible reason attached to it. The reason existed, in `hear-voice-note`
  // below, but only for the `!draft` case and only after `loading` had
  // finished, so during the load there was a dead primary button and nothing
  // else, and on a 390pt screen the note that eventually appeared was under
  // the fold anyway.
  //
  // Every branch that disables the button now produces a reason, and the
  // reason names its CLASS, because "we have not built your draft voice yet"
  // and "your text is too long" ask for opposite behaviour from the reader:
  // one means wait, the other means type. A disabled control that does not say
  // which is a control that gets read as a bug.
  //
  // ORDER MATTERS. It is the order a person would discover them in: our
  // problems first (there is nothing to preview, or the machine is busy), then
  // theirs (the box is empty, or too long). Reporting "your text is too long"
  // while there is no voice model at all would be true and useless.
  const reason: DisabledReason | null = loading
    ? disabledReason(
      "us",
      "We are still checking whether you have a draft voice.",
      "This takes a moment. The button turns on by itself when the check comes back.",
    )
    : !draft
      ? disabledReason(
        "us",
        "There is no draft voice to preview yet, because we have not built one from your recordings.",
        "Nothing here needs you. Once a recording has been through processing and a draft voice is built, this turns on. The activity panel on this step shows where your recordings are.",
      )
      : busy
        ? disabledReason(
          "us",
          phase.kind === "warming"
            ? "The voice runtime is starting up, which takes two to three minutes after a quiet period."
            : "Your line is being generated right now.",
          "It retries by itself. You can leave this open or go and do something else on this step.",
        )
        : !text.trim()
          ? disabledReason(
            "you",
            "The box is empty, so there is nothing to say.",
            "Type a line for your clone to read aloud.",
          )
          : overLimit
            ? disabledReason(
              "you",
              `That is longer than the ${MAX_TEXT} characters a preview can take.`,
              "Shorten it and the button turns on.",
            )
            : null;

  return (
    <section className="hear-voice" aria-labelledby="hear-voice-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Your voice</p>
          <h2 id="hear-voice-title">Preview my voice</h2>
        </div>
        <p>
          A private draft, generated from your own consented recording. Every clip opens with the
          spoken AI disclosure and carries an inaudible watermark. Previewing does not activate
          anything and does not let anyone else hear it.
        </p>
      </div>

      <div className="hear-voice-body">
        <div className="hear-voice-compose">
          <fieldset className="voice-preview-language">
            <legend>Language</legend>
            <button type="button" className={language === "hi" ? "active" : ""} aria-pressed={language === "hi"}
              onClick={() => changeLanguage("hi")}>Hindi and Hinglish</button>
            <button type="button" className={language === "en" ? "active" : ""} aria-pressed={language === "en"}
              onClick={() => changeLanguage("en")}>English</button>
          </fieldset>

          <label className="voice-preview-script" htmlFor="hear-voice-text">
            <span>What should it say?</span>
            <textarea
              id="hear-voice-text"
              value={text}
              rows={4}
              maxLength={MAX_TEXT}
              onChange={(event) => setText(event.target.value)}
            />
            <small className={overLimit ? "hear-voice-over" : ""}>
              {Array.from(text).length}/{MAX_TEXT} characters. The spoken AI disclosure is added for you.
            </small>
          </label>

          {/* The reason lives INSIDE the same box as the button, so it cannot
              drift below a fold in a later layout change. On a 390pt screen
              "adjacent" and "in the same element" are the same requirement. */}
          <DisabledAction reason={reason}>
            <button
              className="button primary-button hear-voice-go"
              type="button"
              disabled={Boolean(reason)}
              // Press feedback fires on pointerdown, and so does the work: a
              // cold voice runtime takes two to three minutes, and spending
              // the click duration on top of that for nothing is the exact
              // latency DESIGN-LAW §2 calls the enemy. The keyboard path is
              // separate because pointerdown never fires for it.
              onPointerDown={() => { if (!reason) void run(0); }}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && !reason) {
                  event.preventDefault();
                  void run(0);
                }
              }}
            >
              {phase.kind === "synthesizing" ? "Generating" : phase.kind === "warming" ? "Waking the voice lab" : "Preview my voice"}
            </button>
          </DisabledAction>
        </div>

        <div className="hear-voice-stage" aria-live="polite">
          {phase.kind === "ready" ? (
            <>
              <p className="hear-voice-state ready">Ready</p>
              <audio controls preload="metadata" src={phase.url}>Your browser cannot play this protected WAV.</audio>
              <dl className="hear-voice-proof">
                <div><dt>Disclosure</dt><dd>Spoken, on every clip</dd></div>
                <div><dt>Watermark</dt><dd>PerTh, verified before release</dd></div>
              </dl>
              <small>Receipt {phase.generationId.slice(0, 8)} · model {phase.modelCommitment.slice(0, 10)}</small>
            </>
          ) : phase.kind === "warming" ? (
            <>
              <p className="hear-voice-state warming">Warming up</p>
              <p className="hear-voice-message">{phase.warming.message}</p>
              <p className="hear-voice-countdown">
                <strong>{remaining}s</strong>
                <span>until the next attempt. You can leave this open, it retries itself.</span>
              </p>
              <small>
                The voice runtime sleeps when nobody is using it, which is why the first preview of the
                day is slow and the ones after it take a few seconds.
              </small>
            </>
          ) : phase.kind === "synthesizing" ? (
            <>
              <p className="hear-voice-state working">Generating</p>
              <p className="hear-voice-message">Rendering your words, adding the disclosure and the watermark.</p>
            </>
          ) : phase.kind === "error" ? (
            <>
              <p className="hear-voice-state failed">Did not work</p>
              <p className="hear-voice-message">{phase.headline}</p>
              <small>{phase.detail}</small>
              {phase.canRetry && (
                <button className="review-refresh" type="button" onClick={() => void run(0)}>Try again</button>
              )}
            </>
          ) : (
            <>
              <p className="hear-voice-state idle">Nothing generated yet</p>
              <p className="hear-voice-message">
                Write a line and press the button. The first preview after a quiet period takes two to
                three minutes while the runtime starts; after that it is seconds.
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
