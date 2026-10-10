import { useCallback, useEffect, useRef, useState } from "react";
import "./private-voice-test.css";
import {
  fetchPrivateVoiceAudio,
  generatePrivateVoice,
  PrivateVoiceApiError,
  ratePrivateVoice,
  readPrivateVoice,
  readPrivateVoiceRun,
  revokePrivateVoice,
  type PrivateVoiceAvailability,
  type PrivateVoiceCandidate,
  type PrivateVoiceRatingKey,
  type PrivateVoiceRatings,
  type PrivateVoiceRun,
} from "./privateVoiceTestApi";

export interface PrivateVoiceTestProps {
  token: string;
  replicaId: string | null;
  locale: "en" | "hi";
  onAuthError?: (cause: unknown) => void;
  onAddRecording: () => void;
  sourceRevision?: string;
  sourceProcessing?: boolean;
  probeOnly?: boolean;
  onAvailability?: (available: boolean) => void;
}

type LoadState = "idle" | "loading" | "available" | "unavailable" | "error";
type BusyAction = "generate" | "rate" | "revoke" | null;
type DisplayRun = Partial<PrivateVoiceRun> & Pick<PrivateVoiceRun, "run_id" | "state">;

const RATING_KEYS: PrivateVoiceRatingKey[] = [
  "owner_likeness", "naturalness", "indian_accent", "pronunciation",
];
const PENDING_STATES = new Set(["queued", "claimed", "running"]);

const COPY = {
  en: {
    title: "Test your voice privately",
    intro: "Choose one of your saved recordings, confirm the private test, then make one sample.",
    loading: "Checking private voice test",
    unavailableTitle: "Private voice test is not available yet",
    unavailableBody: "Your recording stays saved. This test will appear here when the private service is ready for your account.",
    errorTitle: "We could not check the private voice test",
    errorBody: "Try the check again. No voice sample was created.",
    retry: "Check again",
    sampleChoice: "Choose your recording",
    recording: "Recording {n}",
    duration: "{n} seconds",
    noRecordings: "No eligible recording is ready for this private test.",
    preparingRecording: "Your recording is being prepared.",
    preparingRecordingHelp: "Check again after processing finishes.",
    addRecording: "Add a recording",
    language: "Hindi and Hinglish",
    sampleText: "What should your voice say?",
    sampleTextHelp: "Use Hindi or Hinglish. This Hindi model does not support English-only text.",
    sampleTextCount: "{n} of {max} characters",
    fixedSampleOnly: "This service currently supports the fixed sample below.",
    statementTitle: "Private test statement",
    statementHelp: "This exact line is used only to make this sample.",
    confirm: "I confirm this is my own voice and I am using it for a private test.",
    generate: "Make private sample",
    generating: "Starting sample",
    status: "Sample status",
    queued: "Queued",
    claimed: "Preparing your sample",
    running: "Making your sample",
    ready: "Sample ready",
    failed: "Sample failed",
    unknown: "Status needs checking",
    revoked: "Sample removed",
    expired: "Sample expired",
    pendingBody: "You can leave this screen and return to this sample.",
    readyBody: "Listen to your private sample, then rate what you hear.",
    failedBody: "We could not finish this sample.",
    unknownBody: "This sample is saved. Check it before trying another.",
    revokedBody: "This private sample is no longer available.",
    expiredBody: "This private sample is no longer available.",
    checkStatus: "Check this sample",
    cancel: "Cancel sample",
    remove: "Remove sample",
    audioLoading: "Loading your private sample",
    audioError: "The audio could not be loaded. Try loading this sample again.",
    retryAudio: "Load audio again",
    audioLabel: "Your private sample",
    audioFallback: "Your browser cannot play this audio.",
    rateTitle: "How does it sound?",
    rateHelp: "Choose 1 to 5 for each listening note.",
    saveRatings: "Save listening ratings",
    ratingsSaved: "Listening ratings saved",
    cleanup: "Removal is still being confirmed.",
    request: "Private sample",
    code: "Technical details",
    axes: {
      owner_likeness: "Sounds like me",
      naturalness: "Naturalness",
      indian_accent: "Indian accent",
      pronunciation: "Pronunciation",
    },
  },
  hi: {
    title: "अपनी आवाज़ निजी रूप से जाँचें",
    intro: "अपनी सहेजी हुई रिकॉर्डिंग चुनें, निजी जाँच की पुष्टि करें और एक नमूना बनाएँ।",
    loading: "निजी आवाज़ जाँच देखी जा रही है",
    unavailableTitle: "निजी आवाज़ जाँच अभी उपलब्ध नहीं है",
    unavailableBody: "आपकी रिकॉर्डिंग सुरक्षित है। आपके खाते के लिए निजी सेवा तैयार होने पर यह जाँच यहाँ दिखेगी।",
    errorTitle: "निजी आवाज़ जाँच नहीं खुल सकी",
    errorBody: "फिर से जाँचें। कोई आवाज़ नमूना नहीं बनाया गया।",
    retry: "फिर जाँचें",
    sampleChoice: "अपनी रिकॉर्डिंग चुनें",
    recording: "रिकॉर्डिंग {n}",
    duration: "{n} सेकंड",
    noRecordings: "इस निजी जाँच के लिए कोई योग्य रिकॉर्डिंग तैयार नहीं है।",
    preparingRecording: "आपकी रिकॉर्डिंग तैयार की जा रही है।",
    preparingRecordingHelp: "प्रोसेसिंग पूरी होने के बाद फिर जाँचें।",
    addRecording: "रिकॉर्डिंग जोड़ें",
    language: "हिंदी और हिंग्लिश",
    sampleText: "आवाज़ क्या बोले?",
    sampleTextHelp: "हिंदी या हिंग्लिश लिखें। यह हिंदी मॉडल केवल अंग्रेज़ी वाक्य नहीं बोलता।",
    sampleTextCount: "{max} में से {n} अक्षर",
    fixedSampleOnly: "यह सेवा अभी नीचे दिया गया तय नमूना बना सकती है।",
    statementTitle: "निजी जाँच का वाक्य",
    statementHelp: "यही पंक्ति केवल इस नमूने को बनाने के लिए इस्तेमाल होगी।",
    confirm: "मैं पुष्टि करता हूँ कि यह मेरी अपनी आवाज़ है और मैं इसे निजी जाँच के लिए इस्तेमाल कर रहा हूँ।",
    generate: "निजी नमूना बनाएँ",
    generating: "नमूना शुरू हो रहा है",
    status: "नमूने की स्थिति",
    queued: "कतार में",
    claimed: "आपका नमूना तैयार हो रहा है",
    running: "नमूना बन रहा है",
    ready: "नमूना तैयार है",
    failed: "नमूना नहीं बन सका",
    unknown: "स्थिति फिर जाँचनी है",
    revoked: "नमूना हटा दिया गया",
    expired: "नमूने की अवधि पूरी हुई",
    pendingBody: "आप यह स्क्रीन छोड़कर इसी नमूने पर वापस आ सकते हैं।",
    readyBody: "अपना निजी नमूना सुनें, फिर अपनी राय दें।",
    failedBody: "हम यह नमूना पूरा नहीं कर सके।",
    unknownBody: "यह नमूना सुरक्षित है। दूसरा नमूना बनाने से पहले इसे जाँचें।",
    revokedBody: "यह निजी नमूना अब उपलब्ध नहीं है।",
    expiredBody: "यह निजी नमूना अब उपलब्ध नहीं है।",
    checkStatus: "यह नमूना जाँचें",
    cancel: "नमूना रद्द करें",
    remove: "नमूना हटाएँ",
    audioLoading: "आपका निजी नमूना लोड हो रहा है",
    audioError: "ऑडियो लोड नहीं हुआ। यह नमूना फिर लोड करें।",
    retryAudio: "ऑडियो फिर लोड करें",
    audioLabel: "आपका निजी नमूना",
    audioFallback: "आपका ब्राउज़र यह ऑडियो नहीं चला सकता।",
    rateTitle: "आवाज़ कैसी लगी?",
    rateHelp: "हर सुनने के बिंदु के लिए 1 से 5 चुनें।",
    saveRatings: "सुनने की रेटिंग सहेजें",
    ratingsSaved: "सुनने की रेटिंग सहेजी गई",
    cleanup: "हटाने की पुष्टि अभी बाकी है।",
    request: "निजी नमूना",
    code: "तकनीकी जानकारी",
    axes: {
      owner_likeness: "मेरी आवाज़ जैसी",
      naturalness: "स्वाभाविकता",
      indian_accent: "भारतीय उच्चारण",
      pronunciation: "शब्द उच्चारण",
    },
  },
} as const;

function isAbort(cause: unknown): boolean {
  return cause instanceof DOMException && cause.name === "AbortError";
}

function decodeAccountIdentity(token: string): string {
  try {
    const body = token.split(".")[1];
    if (!body) return token;
    const normalized = body.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(body.length / 4) * 4, "=");
    const payload = JSON.parse(atob(normalized)) as { iss?: unknown; sub?: unknown };
    if (typeof payload.sub === "string") return `${typeof payload.iss === "string" ? payload.iss : ""}:${payload.sub}`;
  } catch {
    // Opaque sessions are hashed below. Raw session material is never stored.
  }
  return token;
}

async function runStorageKey(token: string, replicaId: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(`${decodeAccountIdentity(token)}\u0000${replicaId}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    return `vyakti.private-voice-run.v1.${id}`;
  } catch {
    return null;
  }
}

function candidateKey(candidate: PrivateVoiceCandidate): string {
  return `${candidate.source_id}\u0000${candidate.artifact_id}`;
}

function revokeUrl(ref: React.MutableRefObject<string | null>): void {
  if (ref.current) URL.revokeObjectURL(ref.current);
  ref.current = null;
}

function statusCopy(run: DisplayRun, copy: typeof COPY.en | typeof COPY.hi): { title: string; body: string } {
  if (PENDING_STATES.has(run.state)) return { title: copy[run.state], body: copy.pendingBody };
  if (run.state === "ready") return { title: copy.ready, body: copy.readyBody };
  if (run.state === "failed") return { title: copy.failed, body: copy.failedBody };
  if (run.state === "revoked") return { title: copy.revoked, body: copy.revokedBody };
  if (run.state === "expired") return { title: copy.expired, body: copy.expiredBody };
  return { title: copy.unknown, body: copy.unknownBody };
}

export function PrivateVoiceTest({
  token,
  replicaId,
  locale,
  onAuthError,
  onAddRecording,
  sourceRevision,
  sourceProcessing = false,
  probeOnly = false,
  onAvailability,
}: PrivateVoiceTestProps) {
  const copy = COPY[locale];
  const scope = token && replicaId ? `${token}\u0000${replicaId}` : "";
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const onAuthErrorRef = useRef(onAuthError);
  const onAvailabilityRef = useRef(onAvailability);
  onAuthErrorRef.current = onAuthError;
  onAvailabilityRef.current = onAvailability;
  const audioUrlRef = useRef<string | null>(null);
  const storageKeyRef = useRef<string | null>(null);
  const activeControllers = useRef(new Set<AbortController>());
  const availabilityEpochRef = useRef(0);
  const revisionTrackerRef = useRef<{ scope: string; revision: string | undefined }>({ scope, revision: sourceRevision });
  if (revisionTrackerRef.current.scope !== scope) revisionTrackerRef.current = { scope, revision: sourceRevision };

  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [availability, setAvailability] = useState<PrivateVoiceAvailability | null>(null);
  const [selectedCandidate, setSelectedCandidate] = useState("");
  const [sampleText, setSampleText] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [run, setRun] = useState<DisplayRun | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [audioEpoch, setAudioEpoch] = useState(0);
  const [ratings, setRatings] = useState<Partial<PrivateVoiceRatings>>({});
  const [configurationRefreshing, setConfigurationRefreshing] = useState(false);
  const runRef = useRef<DisplayRun | null>(run);
  runRef.current = run;

  const trackedController = useCallback(() => {
    const controller = new AbortController();
    activeControllers.current.add(controller);
    return controller;
  }, []);

  const releaseController = useCallback((controller: AbortController) => {
    activeControllers.current.delete(controller);
  }, []);

  const handleFailure = useCallback((cause: unknown, capturedScope: string) => {
    if (isAbort(cause) || scopeRef.current !== capturedScope) return;
    if (cause instanceof PrivateVoiceApiError && cause.status === 401) onAuthErrorRef.current?.(cause);
    setErrorCode(cause instanceof PrivateVoiceApiError ? cause.code : "private_voice_operation_failed");
  }, []);

  const persistRunId = useCallback((runId: string | null) => {
    const key = storageKeyRef.current;
    if (!key) return;
    try {
      if (runId) sessionStorage.setItem(key, runId);
      else sessionStorage.removeItem(key);
    } catch {
      // Session persistence is a recovery aid. The server remains authoritative.
    }
  }, []);

  const applyRun = useCallback((next: PrivateVoiceRun) => {
    setRun(next);
    setRatings(next.ratings || {});
    setErrorCode(next.error_code || null);
    if (next.state === "revoked" || next.state === "expired") persistRunId(null);
    else persistRunId(next.run_id);
  }, [persistRunId]);

  const loadConfiguration = useCallback(async (
    capturedScope: string,
    capturedToken: string,
    capturedReplica: string,
    refreshOnly = false,
  ) => {
    const availabilityEpoch = ++availabilityEpochRef.current;
    if (refreshOnly) setConfigurationRefreshing(true);
    else {
      setLoadState("loading");
      setErrorCode(null);
    }
    const controller = trackedController();
    try {
      const [next, key] = await Promise.all([
        readPrivateVoice(capturedToken, capturedReplica, controller.signal),
        runStorageKey(capturedToken, capturedReplica),
      ]);
      if (controller.signal.aborted || scopeRef.current !== capturedScope || availabilityEpochRef.current !== availabilityEpoch) return;
      storageKeyRef.current = key;
      setAvailability(next);
      if (!refreshOnly) setSampleText(next.config.text);
      setSelectedCandidate((current) => next.candidates.some((item) => candidateKey(item) === current)
        ? current
        : next.candidates[0] ? candidateKey(next.candidates[0]) : "");
      setLoadState("available");
      onAvailabilityRef.current?.(true);
      if (next.run && !runRef.current) {
        applyRun(next.run);
        return;
      }
      if (runRef.current) return;
      let storedRunId: string | null = next.resume_run_id || null;
      try { storedRunId ||= key ? sessionStorage.getItem(key) : null; } catch { /* no session storage */ }
      if (!storedRunId) return;
      setRun({ run_id: storedRunId, state: "unknown" });
      persistRunId(storedRunId);
      try {
        const restored = await readPrivateVoiceRun(capturedToken, capturedReplica, storedRunId, controller.signal);
        if (!controller.signal.aborted && scopeRef.current === capturedScope && availabilityEpochRef.current === availabilityEpoch) applyRun(restored);
      } catch (cause) {
        if (controller.signal.aborted || scopeRef.current !== capturedScope || availabilityEpochRef.current !== availabilityEpoch) return;
        if (cause instanceof PrivateVoiceApiError && cause.status === 404) { persistRunId(null); setRun(null); }
        else handleFailure(cause, capturedScope);
      }
    } catch (cause) {
      if (isAbort(cause) || scopeRef.current !== capturedScope || availabilityEpochRef.current !== availabilityEpoch) return;
      if (cause instanceof PrivateVoiceApiError && cause.status === 401) {
        onAuthErrorRef.current?.(cause);
        if (!refreshOnly) {
          setLoadState("error");
          setErrorCode(cause.code);
        }
        return;
      }
      if (cause instanceof PrivateVoiceApiError && cause.status === 404) {
        setLoadState("unavailable");
        setAvailability(null);
        onAvailabilityRef.current?.(false);
        return;
      }
      if (!refreshOnly) {
        setLoadState("error");
        setErrorCode(cause instanceof PrivateVoiceApiError ? cause.code : "private_voice_operation_failed");
      }
    } finally {
      if (scopeRef.current === capturedScope && availabilityEpochRef.current === availabilityEpoch) setConfigurationRefreshing(false);
      releaseController(controller);
    }
  }, [applyRun, handleFailure, persistRunId, releaseController, trackedController]);

  useEffect(() => {
    availabilityEpochRef.current += 1;
    for (const controller of activeControllers.current) controller.abort();
    activeControllers.current.clear();
    revokeUrl(audioUrlRef);
    storageKeyRef.current = null;
    setAudioUrl(null);
    setAudioError(null);
    setAvailability(null);
    setSelectedCandidate("");
    setSampleText("");
    setConfirmed(false);
    setRun(null);
    setRatings({});
    setBusyAction(null);
    setConfigurationRefreshing(false);
    setErrorCode(null);
    if (!scope || !replicaId || !token) {
      setLoadState("idle");
      return;
    }
    void loadConfiguration(scope, token, replicaId);
    return () => {
      for (const controller of activeControllers.current) controller.abort();
      activeControllers.current.clear();
    };
  }, [loadConfiguration, replicaId, scope, token]);

  useEffect(() => {
    if (revisionTrackerRef.current.revision === sourceRevision) return;
    revisionTrackerRef.current.revision = sourceRevision;
    if (!scope || !replicaId || !token) return;
    void loadConfiguration(scope, token, replicaId, true);
  }, [loadConfiguration, replicaId, scope, sourceRevision, token]);

  useEffect(() => () => revokeUrl(audioUrlRef), []);

  const checkRun = useCallback(async (runId: string) => {
    if (!replicaId || !scope) return;
    const capturedScope = scope;
    const controller = trackedController();
    try {
      const next = await readPrivateVoiceRun(token, replicaId, runId, controller.signal);
      if (!controller.signal.aborted && scopeRef.current === capturedScope) applyRun(next);
    } catch (cause) {
      handleFailure(cause, capturedScope);
    } finally {
      releaseController(controller);
    }
  }, [applyRun, handleFailure, releaseController, replicaId, scope, token, trackedController]);

  useEffect(() => {
    if (!run || !PENDING_STATES.has(run.state)) return;
    const timer = window.setTimeout(() => void checkRun(run.run_id), 3000);
    return () => window.clearTimeout(timer);
  }, [checkRun, run]);

  useEffect(() => {
    revokeUrl(audioUrlRef);
    setAudioUrl(null);
    setAudioError(null);
    if (!run || run.state !== "ready" || !run.audio_available || !replicaId || !scope) return;
    const capturedScope = scope;
    const capturedRun = run.run_id;
    const controller = trackedController();
    void fetchPrivateVoiceAudio(token, replicaId, capturedRun, controller.signal).then((blob) => {
      const url = URL.createObjectURL(blob);
      if (controller.signal.aborted || scopeRef.current !== capturedScope) {
        URL.revokeObjectURL(url);
        return;
      }
      audioUrlRef.current = url;
      setAudioUrl(url);
    }).catch((cause) => {
      if (isAbort(cause) || scopeRef.current !== capturedScope) return;
      if (cause instanceof PrivateVoiceApiError && cause.status === 401) onAuthErrorRef.current?.(cause);
      setAudioError(cause instanceof PrivateVoiceApiError ? cause.code : "private_voice_audio_unavailable");
    }).finally(() => releaseController(controller));
    return () => controller.abort();
  }, [audioEpoch, releaseController, replicaId, run?.audio_available, run?.run_id, run?.state, scope, token, trackedController]);

  async function generate(): Promise<void> {
    if (!availability || !replicaId || !scope || busyAction || !confirmed) return;
    const candidate = availability.candidates.find((item) => candidateKey(item) === selectedCandidate);
    if (!candidate) return;
    const capturedScope = scope;
    const runId = crypto.randomUUID();
    persistRunId(runId);
    setRun({ run_id: runId, state: "unknown", source_id: candidate.source_id, artifact_id: candidate.artifact_id });
    setBusyAction("generate");
    setErrorCode(null);
    const controller = trackedController();
    try {
      const result = await generatePrivateVoice(token, replicaId, candidate, runId, availability.statement_set,
        availability.text_limits ? sampleText.trim() : undefined, controller.signal);
      if (!controller.signal.aborted && scopeRef.current === capturedScope) applyRun(result.run);
    } catch (cause) {
      if (isAbort(cause) || scopeRef.current !== capturedScope) return;
      if (cause instanceof PrivateVoiceApiError && cause.status === 401) {
        onAuthErrorRef.current?.(cause);
        setErrorCode(cause.code);
      } else {
        try {
          const reconciled = await readPrivateVoiceRun(token, replicaId, runId, controller.signal);
          if (!controller.signal.aborted && scopeRef.current === capturedScope) applyRun(reconciled);
        } catch (reconcileCause) {
          if (!isAbort(reconcileCause) && scopeRef.current === capturedScope) {
            setRun({ run_id: runId, state: "unknown", source_id: candidate.source_id, artifact_id: candidate.artifact_id });
            handleFailure(reconcileCause, capturedScope);
          }
        }
      }
    } finally {
      if (scopeRef.current === capturedScope) setBusyAction(null);
      releaseController(controller);
    }
  }

  async function saveRatings(): Promise<void> {
    if (!run || !replicaId || !scope || busyAction || RATING_KEYS.some((key) => ratings[key] == null)) return;
    const capturedScope = scope;
    const controller = trackedController();
    setBusyAction("rate");
    try {
      const next = await ratePrivateVoice(token, replicaId, run.run_id, ratings as PrivateVoiceRatings, controller.signal);
      if (!controller.signal.aborted && scopeRef.current === capturedScope) applyRun(next);
    } catch (cause) {
      handleFailure(cause, capturedScope);
    } finally {
      if (scopeRef.current === capturedScope) setBusyAction(null);
      releaseController(controller);
    }
  }

  async function revoke(): Promise<void> {
    if (!run || !replicaId || !scope || busyAction) return;
    const capturedScope = scope;
    const controller = trackedController();
    setBusyAction("revoke");
    try {
      const next = await revokePrivateVoice(token, replicaId, run.run_id, controller.signal);
      if (!controller.signal.aborted && scopeRef.current === capturedScope) applyRun(next);
    } catch (cause) {
      handleFailure(cause, capturedScope);
    } finally {
      if (scopeRef.current === capturedScope) setBusyAction(null);
      releaseController(controller);
    }
  }

  if (probeOnly || loadState === "idle") return null;
  if (loadState === "loading") return <section className="private-voice-test private-voice-test--quiet" aria-live="polite"><p>{copy.loading}</p></section>;
  if (loadState === "unavailable") return <section className="private-voice-test private-voice-test--notice" data-private-voice-unavailable>
    <h2>{copy.unavailableTitle}</h2><p>{copy.unavailableBody}</p>
  </section>;
  if (loadState === "error" || !availability) return <section className="private-voice-test private-voice-test--notice" data-private-voice-error>
    <h2>{copy.errorTitle}</h2><p>{copy.errorBody}</p>
    <button className="private-voice-test__secondary" type="button" onClick={() => replicaId && void loadConfiguration(scope, token, replicaId)}>{copy.retry}</button>
    {errorCode ? <details className="private-voice-test__code"><summary>{copy.code}</summary><code>{errorCode}</code></details> : null}
  </section>;

  const chosen = availability.candidates.find((item) => candidateKey(item) === selectedCandidate);
  const sampleTextLength = Array.from(sampleText.trim()).length;
  const sampleTextValid = !availability.text_limits
    || (sampleTextLength > 0 && sampleTextLength <= availability.text_limits.max_code_points);
  const canStart = Boolean(chosen && confirmed && sampleTextValid && !busyAction && (!run || run.state === "revoked" || run.state === "expired"));
  const pending = Boolean(run && PENDING_STATES.has(run.state));
  const currentStatus = run ? statusCopy(run, copy) : null;
  const savedRatings = run?.ratings;

  return <section className="private-voice-test" data-private-voice-test aria-labelledby="private-voice-test-title">
    <header className="private-voice-test__header">
      <div><h2 id="private-voice-test-title">{copy.title}</h2><p>{copy.intro}</p></div>
      <div className="private-voice-test__badges">
        <span className="private-voice-test__scope">{locale === "hi" ? "केवल निजी" : "Private only"}</span>
        {availability.config.model_arm === "hindi_v3" ? <span className="private-voice-test__language">{copy.language}</span> : null}
      </div>
    </header>

    {!run || run.state === "revoked" || run.state === "expired" ? <div className="private-voice-test__setup">
      <fieldset className="private-voice-test__choices">
        <legend>{copy.sampleChoice}</legend>
        {availability.candidates.length ? availability.candidates.map((candidate, index) => {
          const key = candidateKey(candidate);
          return <label className="private-voice-test__choice" key={key}>
            <input type="radio" name="private-voice-candidate" value={key} checked={selectedCandidate === key}
              onChange={() => setSelectedCandidate(key)} />
            <span><strong>{copy.recording.replace("{n}", String(index + 1))}</strong>
              <small>{copy.duration.replace("{n}", String(Math.max(1, Math.round(candidate.duration_ms / 1000))))}</small></span>
          </label>;
        }) : sourceProcessing || configurationRefreshing ? <div className="private-voice-test__empty" data-private-voice-source-processing>
          <strong>{copy.preparingRecording}</strong><p>{copy.preparingRecordingHelp}</p>
          <button className="private-voice-test__secondary" type="button" disabled={configurationRefreshing}
            onClick={() => void loadConfiguration(scope, token, replicaId!, true)}>{copy.retry}</button>
        </div> : <div className="private-voice-test__empty"><p>{copy.noRecordings}</p>
          <button className="private-voice-test__secondary" type="button" onClick={onAddRecording}>{copy.addRecording}</button></div>}
      </fieldset>

      {availability.candidates.length ? <div className="private-voice-test__statement">
        {availability.text_limits ? <div className="private-voice-test__text-input">
          <label htmlFor="private-voice-sample-text">{copy.sampleText}</label>
          <textarea id="private-voice-sample-text" value={sampleText} rows={4}
            aria-describedby="private-voice-sample-help private-voice-sample-count"
            aria-invalid={sampleTextLength > availability.text_limits.max_code_points}
            onChange={(event) => setSampleText(event.currentTarget.value)} />
          <div className="private-voice-test__text-meta">
            <small id="private-voice-sample-help">{copy.sampleTextHelp}</small>
            <small id="private-voice-sample-count" aria-live="polite">{copy.sampleTextCount
              .replace("{n}", String(sampleTextLength)).replace("{max}", String(availability.text_limits.max_code_points))}</small>
          </div>
        </div> : <p className="private-voice-test__fixed-sample" data-private-voice-fixed-sample>{copy.fixedSampleOnly}</p>}
        <div><h3>{copy.statementTitle}</h3><p>{copy.statementHelp}</p></div>
        <blockquote lang="hi">{availability.statement}</blockquote>
        <label className="private-voice-test__confirm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.currentTarget.checked)} />
          <span>{copy.confirm}</span>
        </label>
        <button className="private-voice-test__primary" type="button" disabled={!canStart} onClick={() => void generate()}>
          {busyAction === "generate" ? copy.generating : copy.generate}
        </button>
      </div> : null}
    </div> : null}

    {run && currentStatus ? <div className={`private-voice-test__run private-voice-test__run--${run.state}`} aria-live="polite" aria-busy={pending || busyAction === "generate"}>
      <div className="private-voice-test__run-heading">
        <div><span>{copy.status}</span><h3>{currentStatus.title}</h3></div>
        <small>{copy.request.replace("{id}", run.run_id.slice(0, 8))}</small>
      </div>
      <p>{currentStatus.body}</p>
      {run.cleanup_pending ? <p className="private-voice-test__cleanup">{copy.cleanup}</p> : null}
      {run.state === "ready" && run.audio_available ? <div className="private-voice-test__audio">
        <strong>{copy.audioLabel}</strong>
        {audioUrl ? <audio controls preload="metadata" src={audioUrl}>{copy.audioFallback}</audio>
          : audioError ? <><p role="alert">{copy.audioError}</p><button className="private-voice-test__secondary" type="button" onClick={() => setAudioEpoch((value) => value + 1)}>{copy.retryAudio}</button></>
          : <p>{copy.audioLoading}</p>}
      </div> : null}
      {errorCode ? <details className="private-voice-test__code"><summary>{copy.code}</summary><code>{errorCode}</code></details> : null}
      <div className="private-voice-test__actions">
        {(run.state === "unknown" || run.state === "failed") ? <button className="private-voice-test__secondary" type="button" disabled={Boolean(busyAction)} onClick={() => void checkRun(run.run_id)}>{copy.checkStatus}</button> : null}
        {pending ? <button className="private-voice-test__secondary" type="button" disabled={Boolean(busyAction)} onClick={() => void revoke()}>{copy.cancel}</button> : null}
        {run.state === "ready" || run.state === "failed" || run.state === "unknown" ? <button className="private-voice-test__secondary" type="button" disabled={Boolean(busyAction)} onClick={() => void revoke()}>{copy.remove}</button> : null}
      </div>
    </div> : null}

    {run?.state === "ready" && run.audio_available && !savedRatings ? <section className="private-voice-test__ratings" aria-labelledby="private-voice-rating-title">
      <div><h3 id="private-voice-rating-title">{copy.rateTitle}</h3><p>{copy.rateHelp}</p></div>
      <div className="private-voice-test__rating-grid">{RATING_KEYS.map((key) => <fieldset key={key}>
        <legend>{copy.axes[key]}</legend>
        <div>{[1, 2, 3, 4, 5].map((score) => <button type="button" key={score} disabled={Boolean(busyAction)}
          className={ratings[key] === score ? "is-selected" : ""} aria-pressed={ratings[key] === score}
          aria-label={`${copy.axes[key]}: ${score} / 5`} onClick={() => setRatings((current) => ({ ...current, [key]: score }))}>{score}</button>)}</div>
      </fieldset>)}</div>
      <button className="private-voice-test__primary" type="button" disabled={Boolean(busyAction) || RATING_KEYS.some((key) => ratings[key] == null)} onClick={() => void saveRatings()}>{copy.saveRatings}</button>
    </section> : null}

    {savedRatings ? <section className="private-voice-test__ratings private-voice-test__ratings--saved" aria-label={copy.ratingsSaved}>
      <h3>{copy.ratingsSaved}</h3><dl>{RATING_KEYS.map((key) => <div key={key}><dt>{copy.axes[key]}</dt><dd>{savedRatings[key]} / 5</dd></div>)}</dl>
    </section> : null}
  </section>;
}

export default PrivateVoiceTest;
