// "Preview my voice" — the first place an owner meets their own clone.
//
// VoicePreviewLab (further down the studio, behind the advanced surface) is the
// calibration instrument: seven delivery conditions, blind A/B, a held-out
// gate. This is not that. This is one box, one button, and one honest answer.
//
// The honesty is the design. The GPU runtime scales to zero, so the first
// click of the day genuinely cannot produce audio for about two to five
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
import { voicePreviewBlockReason, type WizardInput } from "./wizardModel";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

const MAX_TEXT = 280;

// Shapes, not a phrase bank: three short greetings an owner will immediately
// rewrite. Kept under the cap so the counter never opens on a violation.
// These are what the AI SAYS (seed text for the box), not studio chrome, so
// they stay exactly as before regardless of the studio's own UI locale.
type PreviewLanguage = "hi" | "hi-latn" | "en";

function languageOptions(c: StudioCopy["voicePreviewPanel"]): ReadonlyArray<{
  id: PreviewLanguage;
  label: string;
  help: string;
  inputLanguage: string;
}> {
  return [
    { id: "hi", label: c.languageHindiLabel, help: c.languageHindiHelp, inputLanguage: "hi" },
    { id: "hi-latn", label: c.languageHinglishLabel, help: c.languageHinglishHelp, inputLanguage: "hi-Latn" },
    { id: "en", label: c.languageEnglishLabel, help: c.languageEnglishHelp, inputLanguage: "en" },
  ];
}

const WELCOME: Record<PreviewLanguage, string> = {
  hi: "नमस्ते! मैं आपका अपना एआई वर्ज़न हूँ। आज क्या पढ़ना है, फिज़िक्स, केमिस्ट्री या मैथ्स?",
  "hi-latn": "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai, physics, chemistry ya maths?",
  en: "Hello, this is my AI version. Tell me what you are stuck on today and we will work through it together.",
};

function normalizePersistedLanguage(value: unknown, text: unknown): PreviewLanguage | null {
  if (value === "en" || value === "hi-latn") return value;
  if (value !== "hi") return null;
  return typeof text === "string" && /[\u0900-\u097f]/u.test(text) ? "hi" : "hi-latn";
}

type Phase =
  | { kind: "idle" }
  | { kind: "synthesizing" }
  | { kind: "warming"; warming: VoicePanelWarming; retryAt: number; attempt: number }
  | { kind: "ready"; url: string; generationId: string; modelCommitment: string; textPlanSha256: string; transformationCount: number; spokenText: string }
  | { kind: "error"; headline: string; detail: string; canRetry: boolean };

// A cold start can require two syntheses: the first wakes the GPU, then the
// first poll after the server's 200 s wake window dispatches a fresh synthesis
// against that warm runtime. Ten polls keep the client attached for 300 s, so
// that second request can finish and a later poll can protect and return audio.
// Seven polls crossed the wake window but stopped on the same response that
// dispatched the necessary second synthesis.
const MAX_AUTO_RETRIES = 10;

// ── THE WAIT SURVIVES A TAB SWITCH (WS-AP, from the owner's own report) ────
//
// The owner waited ten minutes on "Waking the voice lab", switched browser
// tabs, came back, and had to start over. This panel's own copy already
// promised "You can leave this open or go and do something else on this
// step", which was true for a background TAB (the JS keeps running) and false
// for anything that actually reloads the page — a phone OS discarding a
// backgrounded tab under memory pressure, or a person genuinely refreshing.
// Either way `phase` is in-memory React state and a reload erases it, so the
// person came back to "idle" and pressed the button again, and every one of
// those extra presses is a fresh two-to-three-minute cold start stacked on
// the last one. Ten minutes of nothing was four button presses, not one long
// wait.
//
// `sessionStorage` is the fix: it survives a reload in the SAME tab (unlike
// plain React state) without surviving a genuinely new tab or a different
// device (unlike `localStorage`, which would be the wrong scope for a wait
// that is honestly tied to one browser tab's in-flight request). What is
// persisted is enough to resume the SAME countdown on remount: the retry
// clock, the attempt count, and the exact text/language that was being
// synthesised, so the retry that fires next is the next tick of the same
// wait rather than a new one.
const WARMUP_KEY_PREFIX = "vy.voicePreview.warmup.";
// Generous on purpose. The real cold start can take 2-5 minutes; this is the ceiling
// past which a persisted wait is treated as abandoned rather than resumable,
// covering a slow admission queue plus however long a person's tab genuinely
// stayed backgrounded. Past it, starting fresh is more honest than pretending
// to resume something that has likely already finished or died unseen.
const RESUMABLE_MS = 8 * 60_000;

interface PersistedWarmup {
  text: string;
  language: PreviewLanguage;
  genomeVersion: number;
  attempt: number;
  retryAt: number;
  warming: VoicePanelWarming;
}

function warmupKey(replicaId: string): string {
  return `${WARMUP_KEY_PREFIX}${replicaId}`;
}

function readPersistedWarmup(replicaId: string): PersistedWarmup | null {
  try {
    const raw = window.sessionStorage.getItem(warmupKey(replicaId));
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!value || typeof value !== "object" || typeof value.retryAt !== "number" || typeof value.text !== "string") return null;
    // Stale rather than resumable: a wait this old has almost certainly
    // already resolved (or failed) without anyone watching, and resuming it
    // would be a countdown with nothing real behind it.
    if (value.retryAt < Date.now() - RESUMABLE_MS) return null;
    const language = normalizePersistedLanguage(value.language, value.text);
    if (!language) return null;
    return { ...value, language } as PersistedWarmup;
  } catch {
    // Private browsing can throw on read as well as write. A wait that
    // cannot be persisted still works; it just cannot survive a reload,
    // which is the pre-fix behaviour, not a new failure.
    return null;
  }
}

function writePersistedWarmup(replicaId: string, value: PersistedWarmup) {
  try {
    window.sessionStorage.setItem(warmupKey(replicaId), JSON.stringify(value));
  } catch {
    // Quota or private browsing. See `readPersistedWarmup`.
  }
}

function clearPersistedWarmup(replicaId: string) {
  try {
    window.sessionStorage.removeItem(warmupKey(replicaId));
  } catch {
    // Nothing to clean up if the write never landed in the first place.
  }
}

export default function VoicePreviewPanel({ token, replicaId, wizardInput, onAuthError, testEnvironment = false }: {
  token: string;
  replicaId: string;
  /** So the "no draft yet" reason can be DERIVED from the same wizard state
   *  the rail reads, rather than a class hardcoded in this file. See
   *  `wizardModel.voicePreviewBlockReason` for the production defect this
   *  closes: this panel used to say "us" unconditionally, which was backwards
   *  whenever the true blocker was the owner's own identity, liveness, or an
   *  unreviewed evidence set sitting in Processing Review. */
  wizardInput: WizardInput;
  onAuthError: (cause: unknown) => void;
  testEnvironment?: boolean;
}) {
  const { t } = useStudioLocale();
  const c = t.voicePreviewPanel;
  const LANGUAGE_OPTIONS = useMemo(() => languageOptions(c), [c]);
  const [review, setReview] = useState<ReplicaReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [language, setLanguage] = useState<PreviewLanguage>("hi-latn");
  const [text, setText] = useState<string>(WELCOME["hi-latn"]);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [remaining, setRemaining] = useState(0);
  const urlRef = useRef<string>("");
  const textRef = useRef<HTMLTextAreaElement>(null);
  // Runs the restore check exactly once per mount, after the review fetch
  // below has had a chance to answer. Not a dependency-array guard: `draft`
  // is a fresh object every render once `review` is set, so gating on
  // `draft` alone would fire the restore attempt again on every unrelated
  // re-render.
  const restoredRef = useRef(false);

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
        languageId: language === "en" ? "en" : "hi",
      });
      if (outcome.kind === "warming") {
        if (attempt >= MAX_AUTO_RETRIES) {
          setPhase({
            kind: "error",
            headline: c.runtimeNotWokenHeadline,
            detail: c.ownerReportTooManyTimes
              .split("{n}").join(String(attempt))
              .split("{n2}").join(String(Math.round((attempt * outcome.retryAfterMs) / 1000))),
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
        textPlanSha256: outcome.textPlanSha256,
        transformationCount: outcome.transformationCount,
        spokenText: outcome.spokenText,
      });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
      const friendly = friendlyError(cause, "Preview");
      setPhase({ kind: "error", ...friendly });
    }
  }, [draft, language, onAuthError, replicaId, text, token]);

  // RE-ATTACH rather than restart. Once the review fetch has answered (so
  // `draft` is either a real genome or confirmed absent), check for a
  // still-live warmup left by an earlier mount of this same panel. Restoring
  // `text`/`language` alongside `phase` matters: without it the countdown
  // would resume correctly but then synthesise whatever the (now-default)
  // textbox holds, which is a request for a different line than the one that
  // was actually waited on.
  useEffect(() => {
    if (loading || restoredRef.current) return;
    restoredRef.current = true;
    const persisted = readPersistedWarmup(replicaId);
    if (!persisted) return;
    // The draft the persisted wait was for may no longer be the current one
    // (a new recording replaced it while the tab was away). Resuming against
    // the wrong genome version would synthesise a stale voice silently, so
    // this refuses rather than guesses.
    if (!draft || draft.version !== persisted.genomeVersion) {
      clearPersistedWarmup(replicaId);
      return;
    }
    setText(persisted.text);
    setLanguage(persisted.language);
    setPhase({ kind: "warming", warming: persisted.warming, retryAt: persisted.retryAt, attempt: persisted.attempt });
  }, [loading, draft, replicaId]);

  // PERSIST while warming, CLEAR once the wait resolves either way. Written
  // as its own effect off `phase` rather than inline in `run`, so a restored
  // phase (set by the effect above, not by `run`) is persisted too — the
  // record has to survive a SECOND reload just as well as the first.
  useEffect(() => {
    if (phase.kind === "warming") {
      if (!draft) return; // `run` cannot fire without a draft; nothing to persist yet.
      writePersistedWarmup(replicaId, {
        text, language, genomeVersion: draft.version,
        attempt: phase.attempt, retryAt: phase.retryAt, warming: phase.warming,
      });
    } else if (phase.kind === "ready" || phase.kind === "error") {
      clearPersistedWarmup(replicaId);
    }
  }, [phase, draft, replicaId, text, language]);

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

  function changeLanguage(next: PreviewLanguage) {
    setLanguage(next);
    if (Object.values(WELCOME).includes(text.trim())) setText(WELCOME[next]);
  }

  const selectedLanguage = LANGUAGE_OPTIONS.find((option) => option.id === language) ?? LANGUAGE_OPTIONS[0];

  function focusComposer() {
    textRef.current?.focus();
    textRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
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
      c.disabledCheckingHeadline,
      c.disabledCheckingNext,
    )
    : !draft
      ? voicePreviewBlockReason(wizardInput)
      : busy
        ? disabledReason(
          "us",
          phase.kind === "warming" ? c.disabledBusyWarming : c.disabledBusyGenerating,
          c.disabledBusyNext,
        )
        : !text.trim()
          ? disabledReason(
            "you",
            c.disabledEmptyHeadline,
            c.disabledEmptyNext,
          )
          : overLimit
            ? disabledReason(
              "you",
              c.disabledOverLimitHeadline.split("{n}").join(String(MAX_TEXT)),
              c.disabledOverLimitNext,
            )
            : null;

  return (
    <section className="hear-voice" aria-labelledby="hear-voice-title">
      <div className="section-heading">
        <div>
          {!testEnvironment && <p className="eyebrow">{c.eyebrow}</p>}
          <h2 id="hear-voice-title">{c.title}</h2>
        </div>
        <p>{testEnvironment ? c.introTest : c.introReal}</p>
      </div>

      <div className="hear-voice-body">
        <div className="hear-voice-compose">
          <fieldset className="voice-preview-language">
            <legend>{c.languageLegend}</legend>
            {LANGUAGE_OPTIONS.map((option) => (
              <button
                key={option.id}
                type="button"
                className={language === option.id ? "active" : ""}
                aria-pressed={language === option.id}
                onClick={() => changeLanguage(option.id)}
              >
                {option.label}
              </button>
            ))}
          </fieldset>
          <p className="voice-preview-language-help" id="hear-voice-language-help">{selectedLanguage.help}</p>

          <label className="voice-preview-script" htmlFor="hear-voice-text">
            <span>{c.yourLine}</span>
            <textarea
              ref={textRef}
              id="hear-voice-text"
              value={text}
              lang={selectedLanguage.inputLanguage}
              rows={4}
              maxLength={MAX_TEXT}
              aria-describedby="hear-voice-language-help hear-voice-counter"
              onChange={(event) => setText(event.target.value)}
            />
            <small id="hear-voice-counter" className={overLimit ? "hear-voice-over" : ""}>
              {(testEnvironment ? c.charactersLeftTest : c.charactersLeftReal).split("{n}").join(String(MAX_TEXT - Array.from(text).length))}
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
              // One semantic click covers pointer, keyboard, assistive tech
              // and programmatic activation without parallel event paths.
              onClick={() => { if (!reason) void run(0); }}
            >
              {phase.kind === "synthesizing"
                ? c.buttonGenerating
                : phase.kind === "warming"
                  ? c.buttonWaking
                  : phase.kind === "ready"
                    ? c.buttonAnotherTake
                    : c.buttonPreview}
            </button>
          </DisabledAction>
        </div>

        <div className={`hear-voice-stage hear-voice-stage-${phase.kind}`} aria-live="polite" aria-busy={busy}>
          {phase.kind === "ready" ? (
            <>
              <p className="hear-voice-state ready">{c.stateReady}</p>
              <h3>{c.listenToThisTake}</h3>
              <audio controls preload="metadata" src={phase.url}>{c.audioFallback}</audio>
              {phase.transformationCount > 0 && (
                <details className="hear-voice-pronunciation-plan">
                  <summary>{c.pronunciationPlanSummary.split("{n}").join(String(phase.transformationCount))}</summary>
                  <p>{c.spokenAsLabel} <span lang="hi">{phase.spokenText}</span></p>
                  <small>{c.originalTextUnchangedNote.split("{n}").join(phase.textPlanSha256.slice(0, 10))}</small>
                </details>
              )}
              {!testEnvironment && <dl className="hear-voice-proof">
                <div><dt>{c.disclosureRowLabel}</dt><dd>{c.disclosureRowValue}</dd></div>
                <div><dt>{c.watermarkRowLabel}</dt><dd>{c.watermarkRowValue}</dd></div>
              </dl>}
              <div className="hear-voice-correction">
                <strong>{c.notRightYet}</strong>
                <span>{c.editLineNote}</span>
                <button className="review-refresh" type="button" onClick={focusComposer}>{c.editLine}</button>
              </div>
              <small>{c.receiptLine.split("{n}").join(phase.generationId.slice(0, 8)).split("{n2}").join(phase.modelCommitment.slice(0, 10))}</small>
            </>
          ) : phase.kind === "warming" ? (
            <>
              <p className="hear-voice-state warming">{c.stateWarming}</p>
              <h3>{c.runtimeStarting}</h3>
              <p className="hear-voice-message">{phase.warming.message}</p>
              <div className="hear-voice-wait-metrics" aria-label={c.nextCheckLabel}>
                <div><span>{c.nextCheckLabel}</span><strong>{remaining}s</strong></div>
                <div><span>{c.coldStartEstimateTitle}</span><strong>{c.coldStartEstimateLabel.split("{n}").join(String(Math.ceil(phase.warming.etaSecondsLow / 60))).split("{n2}").join(String(Math.ceil(phase.warming.etaSecondsHigh / 60)))}</strong></div>
              </div>
              <p className="hear-voice-attempt">{c.checkCompleteNote.split("{n}").join(String(phase.attempt + 1))}</p>
              <small>{c.keepWorkingNote}</small>
            </>
          ) : phase.kind === "synthesizing" ? (
            <>
              <p className="hear-voice-state working">{c.stateGenerating}</p>
              <h3>{c.makingYourTake}</h3>
              <p className="hear-voice-message">{testEnvironment ? c.renderingTest : c.renderingReal}</p>
            </>
          ) : phase.kind === "error" ? (
            <>
              <p className="hear-voice-state failed">{c.stateFailed}</p>
              <h3>{c.previewStopped}</h3>
              <p className="hear-voice-message">{phase.headline}</p>
              <small>{phase.detail}</small>
              {phase.canRetry && (
                <button className="review-refresh" type="button" onClick={() => void run(0)}>{c.tryAgain}</button>
              )}
            </>
          ) : (
            <>
              <p className="hear-voice-state idle">{c.stateIdle}</p>
              <h3>{c.takeAppearsHere}</h3>
              <p className="hear-voice-message">{c.chooseLanguageNote}</p>
              <p className="hear-voice-first-wait">{c.firstWaitNote}</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
