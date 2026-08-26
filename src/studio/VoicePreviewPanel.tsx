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

const MAX_TEXT = 280;

// Shapes, not a phrase bank: two short greetings an owner will immediately
// rewrite. Kept under the cap so the counter never opens on a violation.
const WELCOME = {
  hi: "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai — physics, chemistry ya maths?",
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

          <button
            className="button primary-button hear-voice-go"
            type="button"
            disabled={!draft || busy || !text.trim() || overLimit}
            onClick={() => void run(0)}
          >
            {phase.kind === "synthesizing" ? "Generating" : phase.kind === "warming" ? "Waking the voice lab" : "Preview my voice"}
          </button>

          {!loading && !draft && (
            <p className="hear-voice-note">
              There is no draft voice yet. Accept a processed recording in the review step and build a
              draft VoiceGenome first — nothing here can speak before that exists.
            </p>
          )}
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
                <span>until the next attempt — you can leave this open, it retries itself.</span>
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
