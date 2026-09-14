import { useCallback, useEffect, useRef, useState } from "react";
import { useStudioLocale } from "./localeContext";
import "./internal-voice-panel.css";
import {
  fetchInternalVoiceAudio,
  generateInternalVoice,
  InternalVoiceApiError,
  rateInternalVoice,
  readInternalVoice,
  revokeInternalVoice,
  type InternalVoiceRatingKey,
  type InternalVoiceRatings,
  type InternalVoiceStatus,
} from "./internalVoiceApi";

const RATING_KEYS: InternalVoiceRatingKey[] = ["owner_likeness", "naturalness", "indian_accent", "pronunciation"];

const COPY = {
  en: {
    eyebrow: "Voice studio",
    badge: "Private test",
    heading: "Your voice, in Hindi",
    intro: "Listen beside your recording. Tell us what feels like you.",
    reference: "Your recording",
    seconds: "{n} seconds",
    unavailable: "The saved reference is not available.",
    generate: "Generate Hindi sample",
    checking: "Checking your voice studio",
    idle: "Ready when you are",
    idleBody: "Your saved recording is ready.",
    queued: "Making your sample",
    running: "Making your sample",
    workingBody: "This can take a few minutes.",
    ready: "Sample ready",
    readyBody: "Listen, then rate what feels close.",
    failed: "Could not make this sample",
    failedBody: "Check this attempt or remove it.",
    unknown: "We could not confirm this sample",
    unknownBody: "Check again.",
    revoked: "Sample removed",
    revokedBody: "The generated audio is no longer available.",
    error: "Voice studio unavailable",
    checkAgain: "Check again",
    checkService: "Check again",
    cancel: "Cancel",
    revoke: "Remove sample",
    audioFallback: "Your browser cannot play this WAV file.",
    sample: "Generated Hindi sample",
    rateHeading: "How does it sound?",
    rateHelp: "Choose 1 to 5 for each.",
    submitRatings: "Save ratings",
    ratingsSaved: "Ratings saved",
    cleanup: "Cleanup is still being confirmed.",
    details: "Details",
    request: "Request {id}",
    errorCode: "Service code: {code}",
    axes: {
      owner_likeness: "Sounds like me",
      naturalness: "Naturalness",
      indian_accent: "Indian accent",
      pronunciation: "Pronunciation",
    },
  },
  hi: {
    eyebrow: "आवाज़ स्टूडियो",
    badge: "निजी परीक्षण",
    heading: "आपकी आवाज़, हिंदी में",
    intro: "अपनी रिकॉर्डिंग के साथ सुनें। बताएँ कि क्या आपकी तरह लगता है।",
    reference: "आपकी रिकॉर्डिंग",
    seconds: "{n} सेकंड",
    unavailable: "सहेजी गई रिकॉर्डिंग उपलब्ध नहीं है।",
    generate: "हिंदी नमूना बनाएँ",
    checking: "आवाज़ स्टूडियो जाँचा जा रहा है",
    idle: "जब चाहें शुरू करें",
    idleBody: "आपकी रिकॉर्डिंग तैयार है।",
    queued: "नमूना बन रहा है",
    running: "नमूना बन रहा है",
    workingBody: "इसमें कुछ मिनट लग सकते हैं।",
    ready: "नमूना तैयार है",
    readyBody: "सुनें, फिर बताएँ कि क्या करीब लगता है।",
    failed: "नमूना नहीं बन सका",
    failedBody: "इस प्रयास को जाँचें या हटा दें।",
    unknown: "हम इस नमूने की पुष्टि नहीं कर सके",
    unknownBody: "फिर जाँचें।",
    revoked: "नमूना हटा दिया गया",
    revokedBody: "बनाई गई आवाज़ अब उपलब्ध नहीं है।",
    error: "आवाज़ स्टूडियो उपलब्ध नहीं है",
    checkAgain: "फिर जाँचें",
    checkService: "फिर जाँचें",
    cancel: "रद्द करें",
    revoke: "नमूना हटाएँ",
    audioFallback: "आपका ब्राउज़र यह WAV फ़ाइल नहीं चला सकता।",
    sample: "बनाया गया हिंदी नमूना",
    rateHeading: "आवाज़ कैसी लगी?",
    rateHelp: "हर बिंदु के लिए 1 से 5 चुनें।",
    submitRatings: "रेटिंग सहेजें",
    ratingsSaved: "रेटिंग सहेजी गई",
    cleanup: "सफाई की पुष्टि अभी बाकी है।",
    details: "विवरण",
    request: "अनुरोध {id}",
    errorCode: "सेवा कोड: {code}",
    axes: {
      owner_likeness: "मेरी आवाज़ जैसी",
      naturalness: "स्वाभाविकता",
      indian_accent: "भारतीय उच्चारण",
      pronunciation: "शब्द उच्चारण",
    },
  },
} as const;

type Availability = "checking" | "hidden" | "visible";

function replaceUrl(ref: React.MutableRefObject<string | null>, next: string | null) {
  if (ref.current) URL.revokeObjectURL(ref.current);
  ref.current = next;
}

export default function InternalVoicePanel({ token, replicaId, onAuthError, onAvailability, probeOnly = false }: {
  token: string;
  replicaId: string;
  onAuthError: (error: unknown) => void;
  onAvailability?: (available: boolean) => void;
  probeOnly?: boolean;
}) {
  const { locale } = useStudioLocale();
  const copy = COPY[locale];
  const [availability, setAvailability] = useState<Availability>("checking");
  const [status, setStatus] = useState<InternalVoiceStatus | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [sampleUrl, setSampleUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [ratings, setRatings] = useState<Partial<InternalVoiceRatings>>({});
  const requestEpoch = useRef(0);
  const referenceUrlRef = useRef<string | null>(null);
  const sampleUrlRef = useRef<string | null>(null);
  const audioScopeRef = useRef<{ token: string; replicaId: string; runId: string } | null>(null);
  const ratingsRun = useRef<string | null>(null);

  const applyFailure = useCallback((cause: unknown, hideUnavailable = false) => {
    if (cause instanceof DOMException && cause.name === "AbortError") return;
    if (cause instanceof InternalVoiceApiError && cause.status === 401) onAuthError(cause);
    if (hideUnavailable && cause instanceof InternalVoiceApiError && cause.status === 404) {
      setAvailability("hidden");
      onAvailability?.(false);
      return;
    }
    setAvailability("visible");
    onAvailability?.(true);
    setErrorCode(cause instanceof InternalVoiceApiError ? cause.code : "internal_voice_operation_failed");
  }, [onAuthError, onAvailability]);

  const loadStatus = useCallback(async (runId?: string, hideUnavailable = false, signal?: AbortSignal) => {
    const epoch = ++requestEpoch.current;
    try {
      const next = await readInternalVoice(token, replicaId, runId, signal);
      if (epoch !== requestEpoch.current) return;
      setAvailability("visible");
      onAvailability?.(true);
      setStatus(next);
      setErrorCode(null);
    } catch (cause) {
      if (epoch !== requestEpoch.current) return;
      applyFailure(cause, hideUnavailable);
    }
  }, [applyFailure, onAvailability, replicaId, token]);

  useEffect(() => {
    const controller = new AbortController();
    setAvailability("checking");
    setStatus(null);
    setErrorCode(null);
    void loadStatus(undefined, true, controller.signal);
    return () => controller.abort();
  }, [loadStatus]);

  useEffect(() => {
    const run = status?.run;
    if (!run || (run.state !== "queued" && run.state !== "running")) return;
    const timer = window.setTimeout(() => void loadStatus(run.run_id), 3000);
    return () => window.clearTimeout(timer);
  }, [loadStatus, status?.run]);

  const audioRunId = status?.run?.run_id || null;
  const audioRunState = status?.run?.state || null;
  const sampleAvailable = audioRunState === "ready" && Boolean(status?.run?.playback_url);

  useEffect(() => {
    if (!audioRunId || audioRunState === "revoked") {
      audioScopeRef.current = null;
      replaceUrl(referenceUrlRef, null);
      replaceUrl(sampleUrlRef, null);
      setReferenceUrl(null);
      setSampleUrl(null);
      return;
    }
    const scope = audioScopeRef.current;
    const scopeChanged = !scope || scope.token !== token || scope.replicaId !== replicaId || scope.runId !== audioRunId;
    if (scopeChanged) {
      audioScopeRef.current = { token, replicaId, runId: audioRunId };
      replaceUrl(referenceUrlRef, null);
      replaceUrl(sampleUrlRef, null);
      setReferenceUrl(null);
      setSampleUrl(null);
    } else if (!sampleAvailable && sampleUrlRef.current) {
      replaceUrl(sampleUrlRef, null);
      setSampleUrl(null);
    }
    const needsReference = !referenceUrlRef.current;
    const needsSample = sampleAvailable && !sampleUrlRef.current;
    setAudioError(null);
    if (!needsReference && !needsSample) return;

    const controller = new AbortController();
    const load = async () => {
      if (needsReference) {
        const reference = await fetchInternalVoiceAudio(token, replicaId, audioRunId, "reference", controller.signal)
          .then((blob) => URL.createObjectURL(blob));
        if (controller.signal.aborted) {
          URL.revokeObjectURL(reference);
          return;
        }
        replaceUrl(referenceUrlRef, reference);
        setReferenceUrl(reference);
      }
      if (!needsSample) return;
      const sample = await fetchInternalVoiceAudio(token, replicaId, audioRunId, "audio", controller.signal)
        .then((blob) => URL.createObjectURL(blob));
      if (controller.signal.aborted) {
        URL.revokeObjectURL(sample);
        return;
      }
      replaceUrl(sampleUrlRef, sample);
      setSampleUrl(sample);
    };
    void load().catch((cause) => {
      if (controller.signal.aborted) return;
      if (cause instanceof InternalVoiceApiError && cause.status === 401) onAuthError(cause);
      setAudioError(cause instanceof InternalVoiceApiError ? cause.code : "internal_voice_audio_unavailable");
    });
    return () => controller.abort();
  }, [audioRunId, audioRunState, onAuthError, replicaId, sampleAvailable, token]);

  useEffect(() => () => {
    replaceUrl(referenceUrlRef, null);
    replaceUrl(sampleUrlRef, null);
  }, []);

  useEffect(() => {
    const run = status?.run;
    if (!run || ratingsRun.current === run.run_id) return;
    ratingsRun.current = run.run_id;
    setRatings(run.ratings || {});
  }, [status?.run]);

  async function generate() {
    if (!status?.can_generate || busy) return;
    setBusy(true);
    setErrorCode(null);
    try {
      const next = await generateInternalVoice(token, replicaId, crypto.randomUUID());
      setStatus(next);
    } catch (cause) {
      applyFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  async function saveRatings() {
    const runId = status?.run?.run_id;
    if (!runId || busy || RATING_KEYS.some((key) => !ratings[key])) return;
    setBusy(true);
    try {
      setStatus(await rateInternalVoice(token, replicaId, runId, ratings as InternalVoiceRatings));
      setErrorCode(null);
    } catch (cause) {
      applyFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    const runId = status?.run?.run_id;
    if (!runId || busy) return;
    setBusy(true);
    try {
      setStatus(await revokeInternalVoice(token, replicaId, runId));
      setErrorCode(null);
    } catch (cause) {
      applyFailure(cause);
    } finally {
      setBusy(false);
    }
  }

  if (availability !== "visible" || probeOnly) return null;
  const run = status?.run || null;
  const terminalRetry = run?.state === "failed" || run?.state === "unknown";
  const pending = run?.state === "queued" || run?.state === "running";
  const stageKind = errorCode || terminalRetry ? "failed" : run?.state === "ready" ? "ready" : pending ? "pending" : "idle";
  const stateTitle = errorCode ? copy.error
    : run?.state === "queued" ? copy.queued
      : run?.state === "running" ? copy.running
        : run?.state === "ready" ? copy.ready
          : run?.state === "failed" ? copy.failed
            : run?.state === "unknown" ? copy.unknown
              : run?.state === "revoked" ? copy.revoked : copy.idle;
  const stateBody = errorCode ? copy.error
    : pending ? copy.workingBody
      : run?.state === "ready" ? copy.readyBody
        : run?.state === "failed" ? copy.failedBody
          : run?.state === "unknown" ? copy.unknownBody
            : run?.state === "revoked" ? copy.revokedBody : copy.idleBody;
  const savedRatings = run?.ratings;

  return (
    <section className="hear-voice internal-voice-panel" data-internal-voice aria-labelledby="internal-voice-title">
      <div className="section-heading">
        <div className="internal-voice-panel__title"><p className="eyebrow">{copy.eyebrow}</p><span className="hear-voice-state idle">{copy.badge}</span><h2 id="internal-voice-title">{copy.heading}</h2></div>
        <p>{copy.intro}</p>
      </div>
      <div className="hear-voice-body">
        <div className="hear-voice-compose">
          <h3>{copy.reference}</h3>
          <p className="hear-voice-message">{status?.reference.label}</p>
          <p className="hear-voice-first-wait">
            {status?.reference.available && status.reference.duration_ms != null
              ? copy.seconds.replace("{n}", String(Math.round(status.reference.duration_ms / 1000)))
              : copy.unavailable}
          </p>
          {referenceUrl ? <audio controls preload="metadata" src={referenceUrl}>{copy.audioFallback}</audio> : null}
          {!run && status?.can_generate ? <>
            <button className="button primary-button hear-voice-go" type="button" disabled={busy} onClick={() => void generate()}>{copy.generate}</button>
          </> : null}
        </div>
        <div className={`hear-voice-stage hear-voice-stage-${stageKind}`} aria-busy={busy || pending}>
          <p className={`hear-voice-state ${stageKind === "pending" ? "working" : stageKind}`}>{stateTitle}</p>
          <h3>{stateTitle}</h3>
          <p className="hear-voice-message">{stateBody}</p>
          {run?.state === "ready" && sampleUrl ? <><strong>{copy.sample}</strong><audio controls preload="metadata" src={sampleUrl}>{copy.audioFallback}</audio></> : null}
          {run?.cleanup_pending ? <small>{copy.cleanup}</small> : null}
          {errorCode ? <button className="review-refresh" type="button" disabled={busy} onClick={() => void loadStatus(run?.run_id)}>{copy.checkService}</button> : null}
          {terminalRetry ? <button className="review-refresh" type="button" disabled={busy} onClick={() => void loadStatus(run.run_id)}>{copy.checkAgain}</button> : null}
          {pending ? <button className="review-refresh" type="button" disabled={busy} onClick={() => void revoke()}>{copy.cancel}</button> : null}
          {run && !pending && run.state !== "revoked" ? <button className="review-refresh" type="button" disabled={busy} onClick={() => void revoke()}>{copy.revoke}</button> : null}
          {run || audioError || errorCode ? <details className="hear-voice-request-details">
            <summary>{copy.details}</summary>
            {run ? <small className="hear-voice-request-receipt">{copy.request.replace("{id}", run.run_id.slice(0, 8))}</small> : null}
            {audioError ? <small role="alert">{copy.errorCode.replace("{code}", audioError)}</small> : null}
            {errorCode ? <small role="alert">{copy.errorCode.replace("{code}", errorCode)}</small> : null}
            {run?.metrics ? <dl className="hear-voice-proof">
              <div><dt>Provider</dt><dd>{Math.round(run.metrics.model_elapsed_ms / 1000)}s</dd></div>
              <div><dt>Audio</dt><dd>{Math.round(run.metrics.duration_ms / 1000)}s</dd></div>
            </dl> : null}
          </details> : null}
        </div>
      </div>
      {run?.state === "ready" && !savedRatings ? <section className="internal-voice-panel__rating" aria-labelledby="internal-voice-rating-title">
        <h3 id="internal-voice-rating-title">{copy.rateHeading}</h3>
        <p className="voice-preview-language-help">{copy.rateHelp}</p>
        {RATING_KEYS.map((key) => <fieldset className="voice-preview-language" key={key}>
          <legend>{copy.axes[key]}</legend>
          {[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} disabled={busy}
            className={ratings[key] === score ? "active" : ""} aria-pressed={ratings[key] === score}
            aria-label={`${copy.axes[key]}: ${score} of 5`} onClick={() => setRatings((current) => ({ ...current, [key]: score }))}>{score}</button>)}
        </fieldset>)}
        <button className="button primary-button hear-voice-go" type="button" disabled={busy || RATING_KEYS.some((key) => !ratings[key])} onClick={() => void saveRatings()}>{copy.submitRatings}</button>
      </section> : null}
      {savedRatings ? <section className="internal-voice-panel__rating" aria-label={copy.ratingsSaved}><h3>{copy.ratingsSaved}</h3><dl className="hear-voice-proof">
        {RATING_KEYS.map((key) => <div key={key}><dt>{copy.axes[key]}</dt><dd>{savedRatings[key]} / 5</dd></div>)}
      </dl></section> : null}
    </section>
  );
}
