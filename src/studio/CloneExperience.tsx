import "./clone-experience.css";
import "./voice-field.css";
import "./clone-verification-journey.css";
import "./ListeningTest.css";
import "./emotionos-studio.css";
import { firstMeetSurface, initialMeetView } from "./workspaceNavigation";
import { readVoiceLikeness } from "./calibrationApi";
import { ReplicaApiError } from "./replicaApi";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActivityPanel from "./ActivityPanel";
import ContextLockerPanel from "./ContextLockerPanel";
import type { PrivateTextReturnDraft } from "./PrivateTextRehearsal";
import { isPrivateTextId } from "./privateTextRehearsalApi";
import VideoEnrollPanel from "./VideoEnrollPanel";
import VoicePreviewPanel from "./VoicePreviewPanel";
import CloneVerificationJourney, { type CloneVerificationJourneyProps } from "./CloneVerificationJourney";
import { FirstFiveMinutesRail, firstFiveMinutesStep } from "./FirstFiveMinutes";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import { transferRecording } from "./recordingUpload";
import { addContextFiles, fileToBase64, loadContextLocker } from "./contextLockerApi";
import {
  ENROLLMENT_LANGUAGE_LABELS,
  type EnrollmentLanguage,
} from "./enrollmentLanguage";
import { openPrivateWavCapture, type PrivateWavCapture } from "./wavCapture";
import { presentCloneProgress } from "./activityPresentation";
import VoiceField from "./VoiceField";
import VyaktiMark from "./VyaktiMark";
import { noteInstallVisit, markInstallDismissed, shouldShowInstallCard, STUDIO_INSTALL_KEY } from "./installPrompt";
import type { ActivityJob, ActivityView } from "./activityApi";
import type {
  ConsentReceipt,
  LivenessChallenge,
  Replica,
  ReplicaReview,
  ReplicaRuntimeStatus,
  ReplicaSource,
  SignedUpload,
  SourceKind,
  VoiceBuildIntent,
  VoiceListeningCandidate,
} from "./types";
import type { WizardInput } from "./wizardModel";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import { useStudioLocale } from "./localeContext";
import type { CloneExperienceShellCopy } from "./copy";
import WorkspaceNotice from "./WorkspaceNotice";
import { workspaceLifecycleLabel } from "./workspaceLifecycle";

const MirrorCallStudio = lazy(() => import("./MirrorCallStudio"));
const PersonModelStudio = lazy(() => import("./PersonModelStudio"));
const EmotionOsStudio = lazy(() => import("./EmotionOsStudio"));
const ExpertSharePanel = lazy(() => import("./ExpertSharePanel"));
const ExpertConversation = lazy(() => import("./ExpertConversation"));
const PrivateTextRehearsal = lazy(() => import("./PrivateTextRehearsal"));
// WS-R151: HumanOS, the person sheet. Lazy for the same reason every other
// full-screen editor panel on this menu is — it is not the enrich menu
// itself, which must stay light.
const HumanOsStudio = lazy(() => import("./HumanOsStudio"));
const ListeningTest = lazy(() => import("./ListeningTest"));
const InternalVoicePanel = lazy(() => import("./InternalVoicePanel"));
const SourcesStudio = lazy(() => import("./SourcesStudio"));

type ListeningLoadState = "idle" | "loading" | "ready" | "unavailable" | "error";

const REQUIRED_SCOPES = ["capture", "transcription", "storage"] as const;
const MINIMUM_RECORDING_MS = 12_000;
const RECOMMENDED_RECORDING_MS = 30_000;
const MAXIMUM_RECORDING_MS = 60_000;
const VOICE_SAGA_KEY = "vyakti:experience:voice-saga:v1";

export type VoiceReissueSnapshot = { replica: Replica; sources: ReplicaSource[]; consents: ConsentReceipt[] };

const SELECTION_REISSUE_CODES = new Set(["primary_selection_snapshot_missing", "primary_voice_selection_changed"]);

type VoiceCreationSaga = {
  uploadIntentId: string;
  buildIntentId: string;
  sourceId: string | null;
  language: EnrollmentLanguage;
};

const LANGUAGE_HINT: Record<EnrollmentLanguage, "en" | "hi" | "hi-latn"> = {
  english: "en",
  hindi: "hi",
  hinglish: "hi-latn",
};

function voiceSagaKey(replicaId: string) {
  return `${VOICE_SAGA_KEY}:${replicaId}`;
}

function readVoiceSaga(replicaId: string | null): VoiceCreationSaga | null {
  if (!replicaId) return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(voiceSagaKey(replicaId)) || "null") as Partial<VoiceCreationSaga> | null;
    if (!parsed || !/^[0-9a-f-]{36}$/iu.test(parsed.uploadIntentId || "") || !/^[0-9a-f-]{36}$/iu.test(parsed.buildIntentId || "")) return null;
    if (!parsed.language || !(parsed.language in LANGUAGE_HINT)) return null;
    return { uploadIntentId: parsed.uploadIntentId!, buildIntentId: parsed.buildIntentId!, sourceId: parsed.sourceId || null, language: parsed.language };
  } catch {
    return null;
  }
}

function storeVoiceSaga(replicaId: string, saga: VoiceCreationSaga | null) {
  try {
    if (saga) window.localStorage.setItem(voiceSagaKey(replicaId), JSON.stringify(saga));
    else window.localStorage.removeItem(voiceSagaKey(replicaId));
  } catch {
    // The server-owned intents remain authoritative inside the active tab.
  }
}

type MainRoom = "voice" | "enrich" | "evolve" | "call" | "share" | "rehearsal" | "emotionos";
// WS-R151: "humanos" is HumanOS, the person sheet screen (`HumanOsStudio.tsx`).
type EnrichView = "menu" | "files" | "video" | "describe" | "humanos" | "sources";
type CaptureState = "idle" | "requesting" | "recording" | "review";
type UploadState = {
  phase: "hash" | "authorize" | "upload" | "verify" | "select" | "failed";
  progress: number;
  message: string;
};

type VoiceSample = {
  file: File;
  url: string;
  kind: "audio" | "video";
  durationMs: number | null;
  samplePeak: number | null;
  audibleRatio: number | null;
  recordedHere: boolean;
};

function activeEnrollmentConsent(consents: ConsentReceipt[], policyVersion: string | null): boolean {
  const now = Date.now();
  const active = new Set(consents
    .filter((receipt) => receipt.policy_version === policyVersion && !receipt.revoked_at && (!receipt.expires_at || Date.parse(receipt.expires_at) > now))
    .map((receipt) => receipt.scope));
  return REQUIRED_SCOPES.every((scope) => active.has(scope));
}

function safeRecordingName() {
  return `vyakti-voice-${new Date().toISOString().replace(/[:.]/gu, "-")}.wav`;
}

const RECORDING_MIME_BY_EXTENSION: Record<string, string> = {
  wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac",
  flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", webm: "video/webm",
  mp4: "video/mp4", mov: "video/quicktime", mkv: "video/x-matroska",
};

function normalizeRecordingFile(file: File): { file: File; kind: "audio" | "video" } {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = RECORDING_MIME_BY_EXTENSION[extension];
  const declaredMedia = file.type.startsWith("audio/") || file.type.startsWith("video/");
  const mime = declaredMedia ? file.type : inferred || file.type;
  const kind = declaredMedia ? (mime.startsWith("video/") ? "video" : "audio")
    : (["webm", "mp4", "mov", "mkv"].includes(extension) ? "video" : "audio");
  if (!inferred || declaredMedia) return { file, kind };
  return { file: new File([file], file.name, { type: inferred, lastModified: file.lastModified }), kind };
}

function clockDuration(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function bytesLabel(bytes: number) {
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function sourceLanguageKey(replicaId: string) {
  return `vyakti:enrollment-languages:${replicaId}`;
}

function rememberSourceLanguage(replicaId: string, sourceId: string, language: EnrollmentLanguage) {
  try {
    const key = sourceLanguageKey(replicaId);
    const current = JSON.parse(window.localStorage.getItem(key) || "{}") as Record<string, string>;
    window.localStorage.setItem(key, JSON.stringify({ ...current, [sourceId]: language }));
  } catch {
    // The server-side source remains authoritative. This label only improves the owner's local view.
  }
}

function signalSummary(sample: VoiceSample, copy: CloneExperienceShellCopy["capture"]) {
  if (!sample.recordedHere && sample.durationMs == null) return copy.signalCouldNotReadDuration;
  if (!sample.recordedHere && sample.durationMs != null && sample.durationMs < MINIMUM_RECORDING_MS) return copy.signalChooseTwelveSeconds;
  if (!sample.recordedHere) return copy.signalVerifiedDuringProcessing;
  if ((sample.samplePeak ?? 0) >= 0.995) return copy.signalClipped;
  if ((sample.audibleRatio ?? 0) < 0.35) return copy.signalTooQuiet;
  return copy.signalUsable;
}

function Icon({ name }: { name: "menu" | "voice" | "add" | "spark" | "call" | "close" | "chevron" | "lock" | "check" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" focusable="false">
      {name === "menu" && <><path {...common} d="M4 7h16M4 12h16M4 17h16" /></>}
      {name === "close" && <path {...common} d="m6 6 12 12M18 6 6 18" />}
      {name === "chevron" && <path {...common} d="m9 6 6 6-6 6" />}
      {name === "lock" && <><rect {...common} x="5" y="10" width="14" height="10" rx="3" /><path {...common} d="M8 10V7a4 4 0 0 1 8 0v3" /></>}
      {name === "check" && <path {...common} d="m5 12 4.2 4.2L19 6.5" />}
      {name === "voice" && <><path {...common} d="M4 13v-2m4 6V7m4 13V4m4 13V7m4 6v-2" /></>}
      {name === "add" && <><path {...common} d="M12 5v14M5 12h14" /></>}
      {name === "spark" && <><path {...common} d="M12 3c.8 4.3 3.1 6.7 7 7.5-3.9.8-6.2 3.2-7 7.5-.8-4.3-3.1-6.7-7-7.5C8.9 9.7 11.2 7.3 12 3Z" /></>}
      {name === "call" && <path {...common} d="M7.1 4.5 9.8 8l-1.7 2.1a13.4 13.4 0 0 0 5.8 5.8l2.1-1.7 3.5 2.7-.8 2.4c-.3.8-1.1 1.3-2 1.2A15.5 15.5 0 0 1 3.5 7.3c-.1-.9.4-1.7 1.2-2l2.4-.8Z" />}
    </svg>
  );
}

function ResonanceRecorder({ disabled, onProceed, onKnowledge }: { disabled?: boolean; onKnowledge?: () => void; onProceed: (sample: VoiceSample, language: EnrollmentLanguage) => void }) {
  const { t } = useStudioLocale();
  const copy = t.cloneExperienceShell.capture;
  const reduceMotion = useReducedMotion();
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [language, setLanguage] = useState<EnrollmentLanguage>("hinglish");
  const [fileOwnershipConfirmed, setFileOwnershipConfirmed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [levelHistory, setLevelHistory] = useState<number[]>(() => Array.from({ length: 96 }, () => 0));
  const [hint, setHint] = useState(copy.initialHint);
  const [error, setError] = useState("");
  const captureRef = useRef<PrivateWavCapture | null>(null);
  const startedAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const samplePeakRef = useRef(0);
  const audibleFramesRef = useRef(0);
  const totalFramesRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const captureAttemptRef = useRef(0);
  const mountedRef = useRef(true);
  const sampleUrlRef = useRef<string | null>(null);
  const pendingMediaRef = useRef<(() => void) | null>(null);

  const readMediaDuration = useCallback((url: string, kind: "audio" | "video") => new Promise<number | null>((resolve) => {
    const media = kind === "video" ? document.createElement("video") : new Audio();
    let finished = false;
    const finish = (duration: number | null) => {
      if (finished) return;
      finished = true;
      window.clearTimeout(timer);
      media.onloadedmetadata = null;
      media.onerror = null;
      media.removeAttribute("src");
      media.load();
      if (pendingMediaRef.current === cancel) pendingMediaRef.current = null;
      resolve(duration);
    };
    const cancel = () => finish(null);
    const timer = window.setTimeout(cancel, 15_000);
    pendingMediaRef.current = cancel;
    media.preload = "metadata";
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration * 1000 : null);
    media.onerror = cancel;
    media.src = url;
  }), []);

  const clearSample = useCallback(() => {
    if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    sampleUrlRef.current = null;
    setSample(null);
  }, []);

  const stop = useCallback(async () => {
    if (!captureRef.current || stoppingRef.current) return;
    if (Date.now() - startedAtRef.current < MINIMUM_RECORDING_MS) {
      setHint(copy.keepSpeakingTemplate.replace("{n}", String(Math.ceil((MINIMUM_RECORDING_MS - (Date.now() - startedAtRef.current)) / 1000))));
      return;
    }
    stoppingRef.current = true;
    const attempt = captureAttemptRef.current;
    const capture = captureRef.current;
    try {
      const result = await capture.stop();
      if (!mountedRef.current || attempt !== captureAttemptRef.current) {
        URL.revokeObjectURL(result.url);
        return;
      }
      captureRef.current = null;
      const renamed = new File([result.file], safeRecordingName(), { type: "audio/wav", lastModified: Date.now() });
      const decodedDurationMs = await readMediaDuration(result.url, "audio");
      if (!mountedRef.current || attempt !== captureAttemptRef.current) {
        URL.revokeObjectURL(result.url);
        return;
      }
      if (decodedDurationMs == null || decodedDurationMs < MINIMUM_RECORDING_MS) {
        URL.revokeObjectURL(result.url);
        throw new Error(copy.recordingFailed);
      }
      sampleUrlRef.current = result.url;
      setSample({
        file: renamed,
        url: result.url,
        kind: "audio",
        durationMs: decodedDurationMs,
        samplePeak: samplePeakRef.current,
        audibleRatio: totalFramesRef.current ? audibleFramesRef.current / totalFramesRef.current : 0,
        recordedHere: true,
      });
      setElapsedMs(decodedDurationMs);
      setCaptureState("review");
      setHint(copy.reviewHint);
    } catch (cause) {
      if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
      if (captureRef.current === capture) captureRef.current = null;
      setError(cause instanceof Error ? cause.message : copy.recordingFailed);
      setCaptureState("idle");
    } finally {
      if (attempt === captureAttemptRef.current) stoppingRef.current = false;
    }
  }, [copy, readMediaDuration]);

  useEffect(() => {
    if (captureState !== "recording") return;
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAtRef.current;
      setElapsedMs(next);
      if (next >= MAXIMUM_RECORDING_MS) void stop();
    }, 100);
    return () => window.clearInterval(timer);
  }, [captureState, stop]);

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
      const target = event.target;
      const interactive = target instanceof HTMLElement && Boolean(target.closest("button, a, input, textarea, select, summary, audio, video, [contenteditable='true']"));
      if (event.code !== "Space" || event.repeat || disabled || interactive) return;
      event.preventDefault();
      if (captureState === "idle") void start();
      else if (captureState === "recording") void stop();
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureAttemptRef.current += 1;
      const capture = captureRef.current;
      captureRef.current = null;
      if (capture) void capture.cancel().catch(() => {});
      pendingMediaRef.current?.();
      pendingMediaRef.current = null;
      if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
      sampleUrlRef.current = null;
    };
  }, []);

  async function start() {
    if (!mountedRef.current || disabled || captureState !== "idle") return;
    const captureAttempt = captureAttemptRef.current + 1;
    captureAttemptRef.current = captureAttempt;
    setError("");
    clearSample();
    setCaptureState("requesting");
    setElapsedMs(0);
    setLevel(0);
    setLevelHistory(Array.from({ length: 96 }, () => 0));
    samplePeakRef.current = 0;
    audibleFramesRef.current = 0;
    totalFramesRef.current = 0;
    try {
      const capture = await openPrivateWavCapture({
        onLevel(nextLevel, nextPeak) {
          if (!mountedRef.current || captureAttemptRef.current !== captureAttempt) return;
          setLevel(nextLevel);
          setLevelHistory((current) => [...current.slice(-95), nextLevel]);
          samplePeakRef.current = Math.max(samplePeakRef.current, nextPeak);
          totalFramesRef.current += 1;
          if (nextLevel >= 0.035) audibleFramesRef.current += 1;
        },
      });
      if (!mountedRef.current || captureAttemptRef.current !== captureAttempt) {
        await capture.cancel();
        return;
      }
      captureRef.current = capture;
      await capture.start();
      if (!mountedRef.current || captureAttemptRef.current !== captureAttempt) {
        await capture.cancel();
        return;
      }
      startedAtRef.current = Date.now();
      setCaptureState("recording");
      setHint(copy.recordingHint);
    } catch (cause) {
      if (!mountedRef.current || captureAttemptRef.current !== captureAttempt) return;
      setError(cause instanceof Error ? cause.message : copy.micOpenFailed);
      setCaptureState("idle");
    }
  }

  async function retake() {
    captureAttemptRef.current += 1;
    const attempt = captureAttemptRef.current;
    pendingMediaRef.current?.();
    pendingMediaRef.current = null;
    if (captureRef.current) {
      const capture = captureRef.current;
      captureRef.current = null;
      await capture.cancel();
    }
    if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
    stoppingRef.current = false;
    clearSample();
    setCaptureState("idle");
    setElapsedMs(0);
    setLevel(0);
    setError("");
    setFileOwnershipConfirmed(false);
    setHint(copy.initialHint);
  }

  async function chooseFile(file: File | null) {
    if (!file || !mountedRef.current) return;
    const attempt = ++captureAttemptRef.current;
    pendingMediaRef.current?.();
    pendingMediaRef.current = null;
    clearSample();
    setCaptureState("requesting");
    setFileOwnershipConfirmed(false);
    const normalized = normalizeRecordingFile(file);
    const url = URL.createObjectURL(normalized.file);
    const durationMs = await readMediaDuration(url, normalized.kind);
    if (!mountedRef.current || attempt !== captureAttemptRef.current) {
      URL.revokeObjectURL(url);
      return;
    }
    sampleUrlRef.current = url;
    setSample({ file: normalized.file, url, kind: normalized.kind, durationMs, samplePeak: null, audibleRatio: null, recordedHere: false });
    setFileOwnershipConfirmed(false);
    setCaptureState("review");
    setHint(copy.stayLocalHint);
  }

  const enough = sample?.durationMs != null && sample.durationMs >= MINIMUM_RECORDING_MS;
  const qualityGood = enough && (sample?.samplePeak == null || sample.samplePeak < 0.995) && (sample?.audibleRatio == null || sample.audibleRatio >= 0.35);
  const sourceClear = Boolean(sample?.recordedHere || fileOwnershipConfirmed);

  return (
    <section className={`vx-capture is-${captureState}`} aria-labelledby="vx-capture-title">
      <div className="vx-stage-title">
        <h1 id="vx-capture-title">{captureState === "review" ? copy.readyHeading : copy.sayHeading}</h1>
        <p>{captureState === "review" ? copy.readyBody : copy.sayBody}</p>
      </div>

      <div className="vx-capture__center">
        {captureState !== "review" && <div className="vx-capture__signal" aria-hidden="true">
          <div className="vx-capture__wave">
            {levelHistory.filter((_, index) => index % 3 === 0).map((value, index) => <span key={index} style={{ transform: `scaleY(${captureState === "recording" && !reduceMotion ? Math.max(0.06, Math.min(1, Math.sqrt(Math.max(value, level * 0.1)))) : 0.06})` }} />)}
          </div>
          <span className="vx-capture__clock">{clockDuration(elapsedMs)}</span>
          <span className="vx-capture__duration">{copy.minMinimum} / {copy.idealLength}</span>
        </div>}
        <AnimatePresence initial={false}>
          {captureState !== "review" ? (
            <motion.button
              key="record"
              className={`vx-record-button is-${captureState}`}
              type="button"
              disabled={disabled || captureState === "requesting"}
              aria-label={captureState === "recording" ? copy.finishRecordingAriaTemplate.replace("{duration}", clockDuration(elapsedMs)) : copy.startRecordingAria}
              aria-pressed={captureState === "recording"}
              aria-describedby="vx-capture-help"
              onPointerDown={(event) => {
                if (event.pointerType === "mouse" && event.button !== 0) return;
                event.currentTarget.focus({ preventScroll: true });
                if (captureState === "recording") void stop();
                else if (captureState === "idle") void start();
              }}
              onClick={(event) => {
                // Pointer activation is handled on press so a long hold starts
                // immediately and release never stops it. detail=0 preserves
                // native keyboard and assistive-technology button activation.
                if (event.detail !== 0) return;
                if (captureState === "recording") void stop();
                else if (captureState === "idle") void start();
              }}
              initial={false}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.16 }}
            >
              <span>{captureState === "requesting" ? copy.opening : captureState === "recording" ? copy.finish : copy.begin}</span>

            </motion.button>
          ) : sample ? (
            <motion.div
              key="review"
              className="vx-sample"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.18 }}
            >
              <div className="vx-sample__measure">
                <strong>{sample.durationMs == null ? copy.audioReady : clockDuration(sample.durationMs)}</strong>
                <span>{sample.recordedHere ? copy.sealedWav : copy.fileLabelTemplate.replace("{size}", bytesLabel(sample.file.size)).replace("{kind}", sample.kind)}</span>
              </div>
              {sample.kind === "video"
                ? <video controls playsInline preload="metadata" src={sample.url}>{copy.videoFallback}</video>
                : <audio controls preload="metadata" src={sample.url}>{copy.audioFallback}</audio>}
              <p className={qualityGood ? "is-good" : "is-warning"}>{signalSummary(sample, copy)}</p>
              {!sample.recordedHere && <label className="vx-source-declaration"><input type="checkbox" checked={fileOwnershipConfirmed} onChange={(event) => setFileOwnershipConfirmed(event.target.checked)} /><span>{copy.onlyMyVoice}</span></label>}
              <fieldset className="vx-language">
                <legend>{copy.howDidYouSpeak}</legend>
                <div>
                  {(Object.keys(ENROLLMENT_LANGUAGE_LABELS) as EnrollmentLanguage[]).map((item) => (
                    <button key={item} type="button" className={language === item ? "is-selected" : ""} aria-pressed={language === item} onClick={() => setLanguage(item)}>
                      {ENROLLMENT_LANGUAGE_LABELS[item]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="vx-sample__actions">
                <button className="vx-button vx-button--quiet" type="button" onClick={() => void retake()}>{copy.tryAgain}</button>
                <button className="vx-button vx-button--primary" type="button" disabled={!qualityGood || !sourceClear} onClick={() => onProceed(sample, language)}>{copy.continueLabel}</button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div id="vx-capture-help" className="vx-capture__instruction">
        <strong>{captureState === "recording" ? (elapsedMs < MINIMUM_RECORDING_MS ? copy.secondsToGoTemplate.replace("{n}", String(Math.ceil((MINIMUM_RECORDING_MS - elapsedMs) / 1000))) : elapsedMs < RECOMMENDED_RECORDING_MS ? copy.enoughToFinish : copy.strongSampleLength) : hint}</strong>
        {captureState === "recording" && <span>{elapsedMs < RECOMMENDED_RECORDING_MS ? copy.aboutThirtySeconds : copy.finishAtEnd}</span>}
      </div>

      <div className="vx-capture__alternatives">
      {captureState === "idle" && (
        <button className="vx-file-alternative" type="button" onClick={() => fileInputRef.current?.click()}>
          {copy.useFileInstead}
        </button>
      )}
      {captureState === "idle" && !sample && onKnowledge && <button type="button" className="vx-button vx-button--quiet" onClick={onKnowledge}>{copy.addKnowledgeFirst}</button>}
      </div>
      <input ref={fileInputRef} className="vx-visually-hidden" type="file" aria-label={copy.chooseRecordingAria} tabIndex={-1} accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm,.mp4,.mov,.mkv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0] ?? null)} />
      {error && <p className="vx-error" role="alert">{error}</p>}
    </section>
  );
}

function Agreement({ busy, error, onContinue }: { busy: boolean; error: string; onContinue: () => void }) {
  const { t } = useStudioLocale();
  const copy = t.cloneExperienceShell.agreement;
  const [checks, setChecks] = useState([false, false, false]);
  const all = checks.every(Boolean);
  const labels = [
    copy.labelOwnSources,
    copy.labelAgeAndDisclosure,
    copy.labelPrivacyTerms,
  ];
  return (
    <section className="vx-agreement" aria-labelledby="vx-agreement-title">
      <div className="vx-stage-title">
        <h1 id="vx-agreement-title">{copy.heading}</h1>
        <p>{copy.body}</p>
      </div>
      <div className="vx-agreement__body">
        <button className="vx-check-all" type="button" aria-pressed={all} onClick={() => setChecks([!all, !all, !all])}>
          <span className={all ? "is-checked" : ""}>{all ? <Icon name="check" /> : null}</span>
          <strong>{all ? copy.everythingSelected : copy.selectAll}</strong>
        </button>
        <div className="vx-agreement__checks">
          {labels.map((label, index) => (
            <label key={label}>
              <input type="checkbox" checked={checks[index]} onChange={() => setChecks((current) => current.map((value, item) => item === index ? !value : value))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="vx-agreement__legal">{copy.legalPrefix}<a href="/privacy" target="_blank" rel="noreferrer">{copy.legalLinkText}</a>{copy.legalSuffix}</p>
        <button className="vx-button vx-button--primary vx-agreement__continue" type="button" disabled={!all || busy} onClick={onContinue}>
          {busy ? copy.openingPrivateSpace : copy.agreeAndContinue}
        </button>
        {error && <p className="vx-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function RoomNav({ room, onChange }: { room: MainRoom; onChange: (room: MainRoom) => void }) {
  const { t } = useStudioLocale();
  const copy = t.cloneExperienceShell.roomNav;
  const rooms: Array<{ id: MainRoom; label: string; icon: "voice" | "add" | "spark" | "call" }> = [
    { id: "voice", label: copy.meet, icon: "voice" },
    { id: "enrich", label: copy.knowledge, icon: "add" },
    { id: "evolve", label: copy.review, icon: "spark" },
    { id: "call", label: copy.call, icon: "call" },
    { id: "share", label: copy.share, icon: "add" },
  ];
  return (
    <nav className="vx-room-nav" aria-label={copy.ariaLabel}>
      {rooms.map((item) => (
        <button key={item.id} type="button" className={room === item.id ? "is-active" : ""} aria-current={room === item.id ? "page" : undefined} onClick={() => onChange(item.id)}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function DescribeMe({ token, replicaId, onAuthError, onSaved }: { token: string; replicaId: string; onAuthError: (cause: unknown) => void; onSaved: (count: number) => void }) {
  const { t } = useStudioLocale();
  const copy = t.cloneExperienceShell.describeMe;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function save() {
    const body = text.trim();
    if (!body || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const file = new File([body], "about-me.txt", { type: "text/plain;charset=utf-8", lastModified: Date.now() });
      const results = await addContextFiles(token, replicaId, [{ filename: file.name, content_base64: await fileToBase64(file), authorship: "mine" }]);
      const result = results[0];
      if (!result || result.error) throw new Error(result?.error || copy.notStoredError);
      setText("");
      setMessage(copy.savedNote);
      onSaved((await loadContextLocker(token, replicaId)).items.length);
    } catch (cause) {
      onAuthError(cause);
      setMessage(cause instanceof Error ? cause.message : copy.notSavedError);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="vx-describe" aria-labelledby="vx-describe-title">
      <div className="vx-stage-title"><h1 id="vx-describe-title">{copy.heading}</h1><p>{copy.body}</p></div>
      <textarea value={text} maxLength={12_000} placeholder={copy.placeholder} onChange={(event) => setText(event.target.value)} />
      <div><span>{copy.charactersTemplate.replace("{n}", text.trim().length.toLocaleString())}</span><button className="vx-button vx-button--primary" type="button" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? copy.savingPrivately : copy.addToContext}</button></div>
      {message && <p role="status">{message}</p>}
    </section>
  );
}

function WorkspaceDrawer({ open, replicas, selected, runtimeStatus, onClose, onSelect, onNew, onReplace, onDelete, busy, reduceMotion }: {
  open: boolean;
  replicas: Replica[];
  selected: Replica | null;
  runtimeStatus: ReplicaRuntimeStatus | null;
  onClose: () => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReplace: () => void;
  onDelete: () => void;
  busy: boolean;
  reduceMotion: boolean;
}) {
  const { t, locale } = useStudioLocale();
  const copy = t.cloneExperienceShell.drawer;
  const [confirmDelete, setConfirmDelete] = useState(false);
  const drawerRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const drawer = drawerRef.current;
    const focusables = () => Array.from(drawer?.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex='-1'])") ?? []);
    window.setTimeout(() => (focusables()[0] ?? drawer)?.focus(), 0);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusables();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previous?.focus({ preventScroll: true });
    };
  }, [onClose, open]);
  return (
    <AnimatePresence>
      {open && <>
        <motion.button className="vx-drawer-scrim" type="button" aria-label={copy.closeDrawerAria} onClick={onClose} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} />
        <motion.aside ref={drawerRef} className="vx-drawer" role="dialog" aria-modal="true" aria-label={copy.dialogAria} tabIndex={-1} initial={reduceMotion ? false : { x: "-102%" }} animate={{ x: 0 }} exit={reduceMotion ? undefined : { x: "-102%" }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
          <div className="vx-drawer__head"><strong>{copy.heading}</strong><button type="button" aria-label={copy.closeAria} onClick={onClose}><Icon name="close" /></button></div>
          <div className="vx-drawer__list">
            {replicas.map((replica) => (
              <button key={replica.replica_id} type="button" disabled={busy} className={selected?.replica_id === replica.replica_id ? "is-current" : ""} onClick={() => onSelect(replica.replica_id)}>
                <span>{replica.display_name.slice(0, 1).toUpperCase()}</span>
                <div><strong>{replica.display_name}</strong><small>{replica.replica_id === selected?.replica_id && runtimeStatus?.versions.voice_genome ? copy.voiceVersionTemplate.replace("{n}", String(runtimeStatus.versions.voice_genome)) : workspaceLifecycleLabel(replica.lifecycle, locale)}</small></div>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
          <button className="vx-drawer__new" type="button" disabled={busy} onClick={onNew}><Icon name="add" />{copy.createAnother}</button>
          {selected && <div className="vx-drawer__actions">
            <button type="button" disabled={busy} onClick={onReplace}>{copy.replacePrimary}</button>
            {!confirmDelete ? <button className="is-danger" type="button" onClick={() => setConfirmDelete(true)}>{copy.deleteClone}</button> : (
              <div className="vx-drawer__confirm"><p>{copy.deleteConfirmBody}</p><button className="is-danger" type="button" disabled={busy} onClick={onDelete}>{busy ? copy.deleting : copy.deletePermanently}</button><button type="button" onClick={() => setConfirmDelete(false)}>{copy.cancel}</button></div>
            )}
          </div>}
        </motion.aside>
      </>}
    </AnimatePresence>
  );
}

export interface CloneExperienceProps {
  identity: string;
  accountScope?: string;
  ownerUserId?: string;
  workspaceReadState?: "loading" | "ready" | "error";
  consentReadState?: "loading" | "ready" | "error";
  onRetryWorkspace?: () => void;
  onRetryConsent?: () => void;
  accessToken: string;
  replicas: Replica[];
  selected: Replica | null;
  creatingNew: boolean;
  creating: boolean;
  revoking: boolean;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  runtimeStatus: ReplicaRuntimeStatus | null;
  activityView: ActivityView | null;
  wizardInput: WizardInput;
  review: ReplicaReview | null;
  reviewLoading: boolean;
  challenge: LivenessChallenge | null;
  livenessLoading: boolean;
  notice: string;
  error: { headline: string; detail: string } | null;
  onDismissNotice: () => void;
  onDismissError: () => void;
  onSignOut: () => void;
  onBeginClone: () => Promise<Replica>;
  onGrantConsent: () => Promise<void>;
  onSelectReplica: (id: string) => Promise<void>;
  onStartNew: () => void;
  onRevoke: () => Promise<boolean>;
  onCreateUpload: (input: { kind: SourceKind; purpose: "memory" | "identity_document"; mime: string; byteSize: number; sha256: string; containsThirdParties: boolean; uploadIntentId?: string; languageHint?: "en" | "hi" | "hi-latn" }) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; replayed: boolean; finalized: boolean }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; replayed: boolean; finalized: boolean }>;
  onFinalizeUpload: (sourceId: string, uploadIntentId?: string) => Promise<ReplicaSource>;
  onRequestVoiceBuild: (input: { candidateSourceId: string; buildIntentId: string }) => Promise<VoiceBuildIntent>;
  onReadVoiceReissue?: () => Promise<VoiceReissueSnapshot>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
  onRefreshEnrollment: () => Promise<void>;
  onRefreshReview: () => Promise<void>;
  onCheckCaptureReadiness: CloneVerificationJourneyProps["onCheckCaptureReadiness"];
  onIssueChallenge: CloneVerificationJourneyProps["onIssueChallenge"];
  onStartFaceSession: CloneVerificationJourneyProps["onStartFaceSession"];
  onPollFaceSession: CloneVerificationJourneyProps["onPollFaceSession"];
  onCancelChallenge: CloneVerificationJourneyProps["onCancelChallenge"];
  onCreateLivenessUpload: CloneVerificationJourneyProps["onCreateLivenessUpload"];
  onFinalizeLiveness: CloneVerificationJourneyProps["onFinalizeLiveness"];
  onVerifiedConsentChanged: CloneVerificationJourneyProps["onVerifiedConsentChanged"];
  onActivityView: (view: ActivityView) => void;
  onActivityAct: (job: ActivityJob) => void;
  onAuthError: (cause: unknown) => void;
  onContextCount: (count: number) => void;
  onPersonalSheetSaved?: (replicaId: string, sheet: TeacherSheet) => void;
}

/** WS-R157. The one shape this file needs off a captured `beforeinstallprompt`
 *  event, `src/room/RoomApp.tsx`'s own type restated here rather than
 *  imported — typed loosely rather than pulling in a DOM lib type, since none
 *  ships with this project's `lib` and every browser that fires the real
 *  event satisfies this shape regardless. */
type InstallPromptEvent = {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export default function CloneExperience(props: CloneExperienceProps) {
  const {
    identity, accessToken, replicas, selected, creatingNew, creating, revoking, consents, sources,
    accountScope, ownerUserId, workspaceReadState = "ready", consentReadState = "ready", onRetryWorkspace, onRetryConsent,
    runtimeStatus, activityView, wizardInput, review, reviewLoading, challenge, livenessLoading,
    notice, error, onDismissNotice, onDismissError,
    onSignOut, onBeginClone, onGrantConsent, onSelectReplica, onStartNew, onRevoke,
    onCreateUpload, onRetryUpload, onFinalizeUpload, onRequestVoiceBuild, onDeleteSource,
    onRefreshEnrollment, onRefreshReview, onReadVoiceReissue, onCheckCaptureReadiness, onIssueChallenge, onStartFaceSession,
    onPollFaceSession, onCancelChallenge, onCreateLivenessUpload, onFinalizeLiveness,
    onVerifiedConsentChanged,
    onActivityView, onActivityAct, onAuthError, onContextCount, onPersonalSheetSaved,
  } = props;
  const { t, locale } = useStudioLocale();
  const copy = t.cloneExperienceShell;
  // Only the current authenticated workspace owns this unsent, in-memory return.
  // A scope transition clears it during render, before any old callback can run.
  const rehearsalReturn = useRef<{ identity: string; token: string; replicaId: string; draft: PrivateTextReturnDraft } | null>(null);
  if (rehearsalReturn.current && (rehearsalReturn.current.identity !== identity || rehearsalReturn.current.token !== accessToken || rehearsalReturn.current.replicaId !== selected?.replica_id)) rehearsalReturn.current = null;
  const rehearsalQuery = new URLSearchParams(window.location.search);
  const savedRehearsal = rehearsalQuery.get("replica") === selected?.replica_id && isPrivateTextId(rehearsalQuery.get("rehearsal_request"));
  const feedCopy = rehearsalQuery.get("lang") === "hi"
    ? { teach: "अपने AI को सिखाएँ", test: "इस सामग्री से पूछें", back: "निजी सवाल पर लौटें" }
    : { teach: "Teach your AI", test: "Test this source", back: "Back to private test" };
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [privateTextItems, setPrivateTextItems] = useState<{ replicaId: string; count: number } | null>(null);
  const onPrivateTextItemCount = useCallback((count: number) => {
    if (!selected) return;
    setPrivateTextItems((current) => current?.replicaId === selected.replica_id && current.count === count
      ? current
      : { replicaId: selected.replica_id, count });
  }, [selected?.replica_id]);
  // This is an entry hint from the exact Context Locker rows, never authority
  // to ask. PrivateTextRehearsal still rechecks source receipts, evidence and
  // all three question attestations on the server.
  const privateTextEntryEligible = Boolean(selected && wizardInput.sheetPersisted
    && privateTextItems?.replicaId === selected.replica_id && privateTextItems.count > 0);
  // WS-R157: the install card's own state — `installEvent` is the captured
  // `beforeinstallprompt` (null on every browser that never fires one, iOS
  // included by design), `installReady`/`installDismissed` come from
  // `noteInstallVisit` below, off the studio's own fixed key
  // (`installPrompt.ts`'s `STUDIO_INSTALL_KEY`) rather than a slug — see
  // that file's own header for why one key covers the whole studio.
  const [installEvent, setInstallEvent] = useState<InstallPromptEvent | null>(null);
  const [installReady, setInstallReady] = useState(false);
  const [installDismissed, setInstallDismissed] = useState(false);
  const [room, setRoom] = useState<MainRoom>(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    return view === "rehearsal" ? "rehearsal" : view === "call" ? "call" : view === "enrich" ? "enrich" : view === "evolve" ? "evolve" : view === "share" ? "share" : view === "emotionos" ? "emotionos" : "voice";
  });
  // WS-R161: a text-ready-only visit (no voice active yet) still opens on
  // "conversation", never the sample tab a not-yet-existing voice cannot
  // answer for.
  const [meetView, setMeetView] = useState<"conversation" | "sample">(() => initialMeetView(window.location.search, Boolean(runtimeStatus?.active || runtimeStatus?.text_ready)));
  const [internalVoiceAvailability, setInternalVoiceAvailability] = useState<"unknown" | "enabled" | "disabled">("unknown");
  useEffect(() => setInternalVoiceAvailability("unknown"), [accessToken, selected?.replica_id]);
  // The two full-screen enrich fixtures deep-link straight past the menu:
  // HumanOS from WS-R151 and Sources from WS-R185. Every URL without one of
  // those exact values still opens on the unchanged menu.
  const [enrichView, setEnrichView] = useState<EnrichView>(() => {
    const requested = new URLSearchParams(window.location.search).get("enrichView");
    return requested === "humanos" || requested === "sources" ? requested : "menu";
  });
  const [showListeningTest, setShowListeningTest] = useState(
    () => new URLSearchParams(window.location.search).get("listening") === "1",
  );
  const [listeningLoad, setListeningLoad] = useState<ListeningLoadState>("idle");
  const [listeningCandidates, setListeningCandidates] = useState<{
    left: VoiceListeningCandidate; right: VoiceListeningCandidate; referenceSha256: string;
  } | null>(null);
  const [agreementBusy, setAgreementBusy] = useState(false);
  const [agreementError, setAgreementError] = useState("");
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const [replacePrimary, setReplacePrimary] = useState(false);
  const [upload, setUpload] = useState<UploadState | null>(null);
  const retryRef = useRef<{ sample: VoiceSample; language: EnrollmentLanguage; sourceId: string | null; uploaded: boolean; finalized: boolean; intentBound: boolean; uploadIntentId: string; buildIntentId: string } | null>(null);
  const uploadAttemptRef = useRef(0);
  const uploadLockedRef = useRef(false);
  const activeReplicaRef = useRef<string | null>(selected?.replica_id ?? null);
  const accountWrapRef = useRef<HTMLDivElement | null>(null);
  const agreementLockedRef = useRef(false);
  const firstSourceAgreement = useRef<string | null>(null);
  const routeFocus = useRef<Element | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [voiceSaga, setVoiceSaga] = useState<VoiceCreationSaga | null>(() => readVoiceSaga(selected?.replica_id ?? null));
  const [voiceBuildIntent, setVoiceBuildIntent] = useState<VoiceBuildIntent | null>(null);
  const [reissueBusy, setReissueBusy] = useState(false);
  const [reissueError, setReissueError] = useState("");
  const reissueOperation = useRef(0);
  const reissueLocked = useRef(false);
  const reissueMounted = useRef(false);
  const reissueCurrent = useRef(props);
  reissueCurrent.current = props;
  const requestVoiceBuildRef = useRef(onRequestVoiceBuild);
  const refreshEnrollmentRef = useRef(onRefreshEnrollment);
  const refreshReviewRef = useRef(onRefreshReview);
  requestVoiceBuildRef.current = onRequestVoiceBuild;
  refreshEnrollmentRef.current = onRefreshEnrollment;
  refreshReviewRef.current = onRefreshReview;
  const consentActive = activeEnrollmentConsent(consents, selected?.policy_version ?? null);
  const progress = useMemo(() => presentCloneProgress(sources, runtimeStatus, activityView), [activityView, runtimeStatus, sources]);
  const currentPrimary = useMemo(() => sources.find((source) => source.voice_role === "primary" && source.state !== "rejected" && source.state !== "deleting") ?? null, [sources]);
  const activeCandidate = useMemo(() => {
    if (!voiceSaga) return null;
    return sources.find((source) => source.source_id === voiceSaga.sourceId || source.upload_intent_id === voiceSaga.uploadIntentId) ?? null;
  }, [sources, voiceSaga]);
  const currentVoiceReady = useMemo(() => Boolean(currentPrimary && review?.voice_genomes.some((genome) =>
    (genome.status === "draft" || genome.status === "approved") && genome.source_ids.includes(currentPrimary.source_id))), [currentPrimary, review]);
  const recoveryJob = useMemo(() => {
    const targetSourceId = activeCandidate?.source_id ?? currentPrimary?.source_id;
    const targetBuildId = voiceBuildIntent?.build_id ?? null;
    return activityView?.jobs.find((job) => {
      const belongsToCurrentJourney = job.lane === "upload_processing"
        ? job.ref === targetSourceId
        : job.lane === "voice_model_build"
          ? targetBuildId ? job.ref === targetBuildId : !voiceSaga
          : false;
      return belongsToCurrentJourney && (job.state === "waiting_on_you" || job.state === "blocked" || job.state === "failed");
    }) ?? null;
  }, [activeCandidate?.source_id, activityView, currentPrimary?.source_id, voiceBuildIntent?.build_id, voiceSaga]);
  const selectionReissue = voiceBuildIntent?.state === "failed" && SELECTION_REISSUE_CODES.has(voiceBuildIntent.last_error_code);
  useEffect(() => {
    reissueMounted.current = true;
    return () => { rehearsalReturn.current = null; reissueMounted.current = false; reissueOperation.current += 1; };
  }, []);
  /* WS-R157: capture `beforeinstallprompt` once, this tab's own lifetime —
   * `RoomApp.tsx`'s own effect, restated here. `preventDefault` stops the
   * browser's own default mini-infobar so the card below is the only UI that
   * ever offers this. iOS never fires this event at all; this effect simply
   * never captures anything there, and `showInstallIOS` below is not gated
   * on it. */
  useEffect(() => {
    const onPrompt = (event: Event) => {
      event.preventDefault();
      setInstallEvent(event as unknown as InstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  /* WS-R157: the visit count and any live dismissal, read (and the count
   * incremented) once per real mount — `noteInstallVisit` is the ONLY place
   * this component touches its own `localStorage` keys, under the studio's
   * one fixed key rather than a slug. */
  useEffect(() => {
    const storage = (() => {
      try {
        return window.localStorage;
      } catch {
        return null;
      }
    })();
    const state = noteInstallVisit(storage, STUDIO_INSTALL_KEY, Date.now());
    setInstallReady(state.readyBySecondVisit);
    setInstallDismissed(state.dismissed);
  }, []);
  useEffect(() => {
    reissueOperation.current += 1;
    reissueLocked.current = false;
    setReissueBusy(false);
    setReissueError("");
  }, [identity, accessToken, selected?.replica_id, onReadVoiceReissue]);

  async function reissueSavedRecording() {
    if (reissueLocked.current || !selectionReissue || !selected || !voiceSaga?.sourceId || !onReadVoiceReissue) return;
    const replicaId = selected.replica_id;
    const previous = voiceSaga;
    let previousStored: string | null = null;
    const operation = ++reissueOperation.current;
    const currentScope = () => {
      const current = reissueCurrent.current;
      return reissueMounted.current && reissueOperation.current === operation
        && current.identity === identity && current.accessToken === accessToken
        && current.selected?.replica_id === replicaId && current.onReadVoiceReissue === onReadVoiceReissue;
    };
    const eligible = (replica: Replica, rows: ReplicaSource[], receipts: ConsentReceipt[]) => {
      const source = rows.find(row => row.source_id === previous.sourceId && row.replica_id === replicaId);
      return replica.replica_id === replicaId && !["revoked", "purging"].includes(replica.lifecycle)
        && activeEnrollmentConsent(receipts.filter(row => row.replica_id === replicaId), replica.policy_version)
        && source && (source.kind === "audio" || source.kind === "video")
        && ["upload", "import", "derived"].includes(source.capture_mode)
        && ["quarantined", "processing", "ready"].includes(source.state) && !source.contains_third_parties;
    };
    reissueLocked.current = true;
    setReissueBusy(true);
    setReissueError("");
    try {
      try { previousStored = window.localStorage.getItem(voiceSagaKey(replicaId)); }
      catch { throw new Error(copy.sagaRecovery.cannotReadSaved); }
      const fresh = await onReadVoiceReissue();
      if (!currentScope()) return;
      const current = reissueCurrent.current;
      if (!current.selected || !eligible(current.selected, current.sources, current.consents)
        || !eligible(fresh.replica, fresh.sources, fresh.consents)) {
        throw new Error(copy.sagaRecovery.notEligibleForNewRequest);
      }
      if (window.localStorage.getItem(voiceSagaKey(replicaId)) !== previousStored
        || readVoiceSaga(replicaId)?.buildIntentId !== previous.buildIntentId) {
        throw new Error(copy.sagaRecovery.changedInAnotherTab);
      }
      const next = { ...previous, buildIntentId: crypto.randomUUID() };
      const serialized = JSON.stringify(next);
      // Persist before the poll effect can send. An uncertain response reuses this exact UUID, including after reload.
      try {
        window.localStorage.setItem(voiceSagaKey(replicaId), serialized);
        if (window.localStorage.getItem(voiceSagaKey(replicaId)) !== serialized) throw new Error("storage_readback_failed");
      } catch {
        throw new Error(copy.sagaRecovery.cannotSaveNew);
      }
      if (retryRef.current?.sourceId === previous.sourceId) retryRef.current.buildIntentId = next.buildIntentId;
      setVoiceBuildIntent(null);
      setVoiceSaga(next);
    } catch (cause) {
      if (currentScope()) setReissueError(cause instanceof Error ? cause.message : copy.sagaRecovery.couldNotCheckRecording);
    } finally {
      if (currentScope()) { reissueLocked.current = false; setReissueBusy(false); }
    }
  }

  const needsAgreement = agreementBusy || creatingNew || !selected || !consentActive;
  const reduceMotion = Boolean(useReducedMotion());

  useEffect(() => {
    const nextReplicaId = selected?.replica_id ?? null;
    if (activeReplicaRef.current === nextReplicaId) return;
    const pending = retryRef.current;
    if (pending?.sample.url) URL.revokeObjectURL(pending.sample.url);
    uploadAttemptRef.current += 1;
    uploadLockedRef.current = false;
    retryRef.current = null;
    setUpload(null);
    setReplacePrimary(false);
    setEnrichView("menu");
    setVoiceSaga(readVoiceSaga(nextReplicaId));
    setVoiceBuildIntent(null);
    // The first replica arrives after sign-in/list hydration. Keep the URL's
    // initial room then; changing or clearing an existing replica resets it.
    if (activeReplicaRef.current !== null) setRoom("voice");
    activeReplicaRef.current = nextReplicaId;
  }, [selected?.replica_id]);

  useEffect(() => {
    if (!selected || !voiceSaga || voiceSaga.sourceId) return;
    const recovered = sources.find((source) => source.upload_intent_id === voiceSaga.uploadIntentId) ?? null;
    if (!recovered) return;
    const next = { ...voiceSaga, sourceId: recovered.source_id };
    storeVoiceSaga(selected.replica_id, next);
    setVoiceSaga(next);
  }, [selected, sources, voiceSaga]);

  useEffect(() => {
    if (!selected || !voiceSaga?.sourceId) return;
    const candidate = sources.find((source) => source.source_id === voiceSaga.sourceId) ?? null;
    if (!candidate || candidate.state === "pending_upload" || candidate.state === "uploaded" || candidate.state === "rejected" || candidate.state === "deleting") return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const intent = await requestVoiceBuildRef.current({ candidateSourceId: candidate.source_id, buildIntentId: voiceSaga.buildIntentId });
        if (!live) return;
        setVoiceBuildIntent(intent);
        if (intent.state === "review" && intent.promoted_at) {
          await Promise.all([refreshEnrollmentRef.current(), refreshReviewRef.current()]);
          if (!live) return;
          storeVoiceSaga(selected.replica_id, null);
          setVoiceSaga(null);
          setVoiceBuildIntent(null);
          return;
        }
        if (intent.state !== "failed") timer = window.setTimeout(() => void poll(), 10_000);
      } catch {
        if (live) timer = window.setTimeout(() => void poll(), 15_000);
      }
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [selected, sources, voiceSaga]);

  useEffect(() => {
    if (!accountOpen) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !accountWrapRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setAccountOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [accountOpen]);

  useEffect(() => {
    const onPop = () => {
      const view = new URLSearchParams(window.location.search).get("view");
      setRoom(view === "rehearsal" ? "rehearsal" : view === "call" ? "call" : view === "enrich" ? "enrich" : view === "evolve" ? "evolve" : view === "share" ? "share" : "voice");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!routeFocus.current) return;
    const main = mainRef.current;
    const selector = room === "rehearsal" ? "#ptr-title" : room === "share" ? ".vx-expert-share h1" : room === "enrich" && enrichView === "files" ? "#context-locker-title" : room === "enrich" && enrichView === "sources" ? "#sources-studio-title" : room === "enrich" && enrichView === "menu" ? "#knowledge-menu-title" : null;
    if (!main || !selector) { routeFocus.current = null; return; }
    const moveFocus = () => {
      const heading = main.querySelector<HTMLElement>(selector);
      if (!heading) return false;
      const active = document.activeElement;
      const mayMove = !active || active === document.body || active === routeFocus.current;
      routeFocus.current = null;
      if (mayMove) { heading.tabIndex = -1; heading.focus(); }
      return true;
    };
    if (moveFocus()) return;
    const observer = new MutationObserver(() => { if (moveFocus()) observer.disconnect(); });
    observer.observe(main, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [room, enrichView]);

  function chooseRoom(next: MainRoom) {
    routeFocus.current = document.activeElement;
    setRoom(next);
    const params = new URLSearchParams(window.location.search);
    params.set("step", "meet");
    params.set("view", next);
    if (selected) params.set("replica", selected.replica_id);
    window.history.replaceState({ replica: selected?.replica_id, view: next }, "", `?${params.toString()}`);
  }

  // WS-R155: the listening test needs two saved voice samples and the
  // reference hash they were both measured against, fetched on demand
  // rather than on every visit to the voice room -- readVoiceLikeness is the
  // SAME read VoicePreviewPanel's own score card uses, so opening this never
  // costs a second kind of request.
  async function openListeningTest() {
    if (!selected) return;
    setShowListeningTest(true);
    if (listeningLoad === "ready" || listeningLoad === "loading") return;
    setListeningLoad("loading");
    try {
      const summary = await readVoiceLikeness(accessToken, selected.replica_id);
      const candidates = summary?.listening_candidates || [];
      if (summary?.listening_ready && candidates.length === 2 && summary.reference_sha256) {
        setListeningCandidates({ left: candidates[0], right: candidates[1], referenceSha256: summary.reference_sha256 });
        setListeningLoad("ready");
      } else {
        setListeningLoad("unavailable");
      }
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) { onAuthError(cause); return; }
      setListeningLoad("error");
    }
  }

  // A deep link (`?listening=1`, the layout fixture's own way in) opens the
  // test before the owner ever clicks the button; the effect below is what
  // actually fetches candidates for that path, since openListeningTest above
  // is only ever called from a click.
  useEffect(() => {
    if (!showListeningTest || listeningLoad !== "idle" || !selected) return;
    openListeningTest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showListeningTest, selected?.replica_id]);

  async function continueAgreement() {
    if (agreementLockedRef.current) return;
    agreementLockedRef.current = true;
    setAgreementBusy(true);
    setAgreementError("");
    const previousReplicaId = selected?.replica_id;
    const sameAccount = () => reissueMounted.current && reissueCurrent.current.identity === identity && (accountScope ? reissueCurrent.current.accountScope === accountScope : reissueCurrent.current.accessToken === accessToken);
    try {
      const replica = creatingNew || !selected ? await onBeginClone() : selected;
      if (!(creatingNew || !selected)) await onGrantConsent();
      if (!sameAccount() || reissueCurrent.current.selected?.replica_id !== replica.replica_id) return;
      if (creatingNew || !selected || firstSourceAgreement.current === replica.replica_id) {
        firstSourceAgreement.current = null;
        routeFocus.current = document.activeElement;
        setEnrichView("files");
        setRoom("enrich");
        const params = new URLSearchParams(window.location.search);
        params.set("view", "enrich");
        window.history.replaceState(null, "", `?${params.toString()}`);
      }
    } catch (cause) {
      if (!sameAccount()) return;
      if (!creatingNew && previousReplicaId && reissueCurrent.current.selected?.replica_id !== previousReplicaId) return;
      if ((creatingNew || !selected) && reissueCurrent.current.selected?.replica_id !== previousReplicaId) firstSourceAgreement.current = reissueCurrent.current.selected?.replica_id || null;
      setAgreementError(cause instanceof Error ? cause.message : copy.agreement.couldNotRecordAgreement);
    } finally {
      agreementLockedRef.current = false;
      setAgreementBusy(false);
    }
  }

  const submitRecording = useCallback(async (sample: VoiceSample, language: EnrollmentLanguage, resume = false) => {
    if (!selected || uploadLockedRef.current) return;
    uploadLockedRef.current = true;
    const replicaId = selected.replica_id;
    const attempt = uploadAttemptRef.current + 1;
    uploadAttemptRef.current = attempt;
    const retry = retryRef.current;
    const durable = readVoiceSaga(replicaId) ?? {
      uploadIntentId: crypto.randomUUID(),
      buildIntentId: crypto.randomUUID(),
      sourceId: null,
      language,
    };
    const operation = retry && resume ? retry : {
      sample,
      language,
      sourceId: durable.sourceId,
      uploaded: false,
      finalized: false,
      intentBound: false,
      uploadIntentId: durable.uploadIntentId,
      buildIntentId: durable.buildIntentId,
    };
    retryRef.current = operation;
    const initialSaga = { uploadIntentId: operation.uploadIntentId, buildIntentId: operation.buildIntentId, sourceId: operation.sourceId, language: operation.language };
    storeVoiceSaga(replicaId, initialSaga);
    setVoiceSaga(initialSaga);
    const active = () => uploadAttemptRef.current === attempt
      && activeReplicaRef.current === replicaId
      && retryRef.current === operation;
    try {
      let sourceId = operation.sourceId;
      if (!operation.intentBound) {
        setUpload({ phase: "hash", progress: 0, message: copy.upload.hashMessage });
        const sha256 = await sha256File(sample.file, (value) => {
          if (active()) setUpload({ phase: "hash", progress: Math.round(value), message: copy.upload.hashMessage });
        });
        if (!active()) return;
        setUpload({ phase: "authorize", progress: 0, message: copy.upload.authorizeMessage });
        const created = await onCreateUpload({ kind: sample.kind, purpose: "memory", mime: sample.file.type || (sample.kind === "video" ? "video/mp4" : "audio/wav"), byteSize: sample.file.size, sha256, containsThirdParties: false, uploadIntentId: operation.uploadIntentId, languageHint: LANGUAGE_HINT[language] });
        if (!active()) return;
        sourceId = created.source.source_id;
        operation.sourceId = sourceId;
        operation.intentBound = true;
        operation.finalized = created.finalized;
        operation.uploaded = created.finalized;
        const boundSaga = { uploadIntentId: operation.uploadIntentId, buildIntentId: operation.buildIntentId, sourceId, language: operation.language };
        storeVoiceSaga(replicaId, boundSaga);
        setVoiceSaga(boundSaga);
        rememberSourceLanguage(replicaId, sourceId, language);
        if (!created.finalized) {
          if (!created.upload) throw new Error(copy.upload.uploadAuthMissing);
          setUpload({ phase: "upload", progress: 0, message: copy.upload.uploadMessage });
          const transfer = await transferRecording({
            file: sample.file,
            sourceId,
            uploadIntentId: operation.uploadIntentId,
            put: (file, onProgress) => putSignedUpload(file, created.upload!, onProgress),
            finalize: onFinalizeUpload,
            onProgress: (value) => {
              if (active()) setUpload({ phase: "upload", progress: Math.round(value), message: copy.upload.uploadMessage });
            },
            onReconciling: () => {
              if (active()) setUpload({ phase: "verify", progress: 0, message: copy.upload.verifyMessage });
            },
            isActive: active,
          });
          if (!active()) return;
          operation.uploaded = true;
          operation.finalized = transfer === "reconciled";
        }
      } else if (!operation.uploaded) {
        if (!sourceId) throw new Error(copy.upload.sourceReceiptMissing);
        setUpload({ phase: "authorize", progress: 0, message: copy.upload.renewMessage });
        const retried = await onRetryUpload(sourceId);
        if (!active()) return;
        operation.finalized = retried.finalized;
        operation.uploaded = retried.finalized;
        if (!retried.finalized) {
          if (!retried.upload) throw new Error(copy.upload.uploadAuthMissing);
          setUpload({ phase: "upload", progress: 0, message: copy.upload.resumeMessage });
          const transfer = await transferRecording({
            file: sample.file,
            sourceId,
            uploadIntentId: operation.uploadIntentId,
            put: (file, onProgress) => putSignedUpload(file, retried.upload!, onProgress),
            finalize: onFinalizeUpload,
            onProgress: (value) => {
              if (active()) setUpload({ phase: "upload", progress: Math.round(value), message: copy.upload.resumeMessage });
            },
            onReconciling: () => {
              if (active()) setUpload({ phase: "verify", progress: 0, message: copy.upload.verifyMessage });
            },
            isActive: active,
          });
          if (!active()) return;
          operation.uploaded = true;
          operation.finalized = transfer === "reconciled";
        }
      }
      if (!sourceId) throw new Error(copy.upload.sourceReceiptMissing);
      if (!operation.finalized) {
        setUpload({ phase: "verify", progress: 0, message: copy.upload.verifyMessage });
        await onFinalizeUpload(sourceId, operation.uploadIntentId);
        if (!active()) return;
        operation.finalized = true;
      }
      setUpload({ phase: "select", progress: 0, message: copy.upload.selectMessage });
      const nextSaga = { uploadIntentId: operation.uploadIntentId, buildIntentId: operation.buildIntentId, sourceId, language: operation.language };
      storeVoiceSaga(replicaId, nextSaga);
      setVoiceSaga(nextSaga);
      const intent = await onRequestVoiceBuild({ candidateSourceId: sourceId, buildIntentId: operation.buildIntentId });
      if (!active()) return;
      setVoiceBuildIntent(intent);
      if (intent.state === "review" && intent.promoted_at) {
        await Promise.all([onRefreshEnrollment(), onRefreshReview()]);
        storeVoiceSaga(replicaId, null);
        setVoiceSaga(null);
        setVoiceBuildIntent(null);
      }
      setUpload(null);
      uploadLockedRef.current = false;
      retryRef.current = null;
      setReplacePrimary(false);
      URL.revokeObjectURL(sample.url);
    } catch (cause) {
      if (active()) setUpload({ phase: "failed", progress: 0, message: cause instanceof Error ? cause.message : copy.upload.stoppedBeforeBuild });
    } finally {
      if (active()) uploadLockedRef.current = false;
    }
  }, [onCreateUpload, onFinalizeUpload, onRefreshEnrollment, onRefreshReview, onRequestVoiceBuild, onRetryUpload, selected, copy]);

  async function discardFailedAndRetake() {
    const retry = retryRef.current;
    if (retry?.sourceId) await onDeleteSource(retry.sourceId);
    if (retry?.sample.url) URL.revokeObjectURL(retry.sample.url);
    if (selected) storeVoiceSaga(selected.replica_id, null);
    setVoiceSaga(null);
    setVoiceBuildIntent(null);
    retryRef.current = null;
    uploadLockedRef.current = false;
    setUpload(null);
    setReplacePrimary(true);
  }

  async function runRecoveryAction() {
    if (!recoveryJob || recoveryBusy) return;
    if (recoveryJob.next_action.kind !== "retry") {
      onActivityAct(recoveryJob);
      return;
    }
    setRecoveryBusy(true);
    try {
      await onFinalizeUpload(recoveryJob.ref);
      await onRefreshEnrollment();
    } finally {
      setRecoveryBusy(false);
    }
  }

  async function replaceRecording() {
    setDrawerOpen(false);
    if (selected) storeVoiceSaga(selected.replica_id, null);
    setVoiceSaga(null);
    setVoiceBuildIntent(null);
    setReplacePrimary(true);
    chooseRoom("voice");
  }

  function finishCandidateJourney() {
    if (!selected || voiceBuildIntent?.state !== "review" || !voiceBuildIntent.promoted_at) return;
    storeVoiceSaga(selected.replica_id, null);
    setVoiceSaga(null);
    setVoiceBuildIntent(null);
    chooseRoom("voice");
  }

  const knowledgeOpen = Boolean(selected && consentActive && room === "enrich" && !upload);
  const textShareOpen = Boolean(selected && consentActive && room === "share" && !upload);
  const textReviewOpen = Boolean(selected && consentActive && room === "evolve" && !upload);
  const textWorkspaceOpen = knowledgeOpen || textShareOpen || textReviewOpen;
  // WS-R161 (wave twenty-two). `text_ready` (an approved person sheet, no
  // voice needed — `api/_replica-runtime.js#textBlockers`) is what lets
  // Meet open before the voice recorder has ever run. Read off the SAME
  // `runtimeStatus` the voice gates below already use, never a second
  // fetch.
  const textReady = Boolean(runtimeStatus?.text_ready);
  const showSagaRecovery = Boolean(selected && consentActive && voiceSaga && !activeCandidate && !upload);
  // A text-ready person who has never touched the recorder (no primary
  // voice, `replacePrimary` false) skips straight to Meet instead of being
  // forced into the recorder screen unprompted — the one behavior change
  // this workstream makes here. `replacePrimary` (set by "Record my voice
  // instead"/"Improve my voice") still opens the recorder on request,
  // text-ready or not, and a non-text-ready person's existing behavior is
  // byte-identical (the `textReady ? ... : ...` branch only changes
  // anything when `textReady` is true).
  const showRecorder = Boolean(selected && consentActive && !voiceSaga && !activeCandidate && !upload
    && (textReady ? replacePrimary : (!currentPrimary || replacePrimary)));
  const showVerification = Boolean(selected && consentActive && activeCandidate && !upload);
  const voiceVerificationPending = Boolean(showVerification && activeCandidate?.state === "ready"
    && voiceBuildIntent?.state !== "failed"
    && !review?.self_test_mode && selected
    && (!selected.age_verified || !selected.identity_verified || !selected.liveness_verified));
  const voiceWorkspaceReady = Boolean(selected && consentActive && !voiceSaga && runtimeStatus?.active
    && currentVoiceReady && !replacePrimary && !upload);
  const privateFirstMeet = Boolean(selected && consentActive && room === "voice" && meetView === "conversation"
    && !voiceSaga && !activeCandidate && !upload && !replacePrimary
    && firstMeetSurface({ voiceWorkspaceReady, textReady, hasSavedSheet: wizardInput.sheetPersisted,
      hasTextMaterial: privateTextEntryEligible }) === "private-rehearsal");
  const showRooms = voiceWorkspaceReady || textWorkspaceOpen || (textReady && !upload && !voiceSaga && !activeCandidate);
  const readBlocked = workspaceReadState !== "ready" || Boolean(selected && !creatingNew && !agreementBusy && room !== "rehearsal" && consentReadState !== "ready");

  // WS-R164: the first five minutes' own small rail — only for a person who
  // has a real replica (past Agreement) and has not reached a working room
  // yet. `reachedMeet` follows the real Meet gates plus the direct private
  // rehearsal room, so the fixed rail steps out of the way on every surface
  // where a person is already testing a question (see
  // `FirstFiveMinutes.tsx`'s own header for why).
  const firstFiveMinutesStepId = selected && !creatingNew && !readBlocked
    ? firstFiveMinutesStep({
        hasFirstSource: sources.some((source) => ["uploaded", "quarantined", "processing", "ready"].includes(source.state))
          || (wizardInput.contextItemCount ?? 0) > 0,
        collecting: showRecorder || Boolean(upload),
        reachedMeet: showRooms || privateFirstMeet || room === "rehearsal"
          || (room === "voice" && meetView === "sample" && internalVoiceAvailability === "enabled"),
      })
    : null;

  // WS-R157: the install card's own derived state, `RoomApp.tsx`'s own
  // shape restated for the studio. `showRooms && selected` is this file's
  // equivalent of the Room's `phase === "talking"` — a settled, ongoing use
  // of the product, never mid-recording, mid-upload or still onboarding.
  const isIOS = typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);
  const alreadyInstalled = typeof window !== "undefined" && (() => {
    try {
      return (
        window.matchMedia?.("(display-mode: standalone)").matches === true ||
        (window.navigator as Navigator & { standalone?: boolean }).standalone === true
      );
    } catch {
      return false;
    }
  })();
  const showInstall = shouldShowInstallCard({
    signedIn: true,
    talking: showRooms && Boolean(selected),
    readyBySecondVisit: installReady,
    dismissed: installDismissed,
    alreadyInstalled,
    hasPromptEvent: Boolean(installEvent),
    isIOS,
  });
  const showInstallIOS = isIOS;
  const dismissInstall = useCallback(() => {
    setInstallEvent(null);
    setInstallDismissed(true);
    try {
      markInstallDismissed(window.localStorage, STUDIO_INSTALL_KEY, Date.now());
    } catch {
      // Best effort — see `noteInstallVisit`'s own header.
    }
  }, []);
  const doInstall = useCallback(async () => {
    if (!installEvent) {
      dismissInstall(); // iOS's "Got it" — nothing to prompt, only to dismiss.
      return;
    }
    try {
      await installEvent.prompt();
      await installEvent.userChoice;
    } catch {
      // Best effort — a prompt already consumed (a second tap, or the
      // browser revoked it between capture and tap) fails silently; the
      // dismiss below still runs so the card does not linger either way.
    }
    dismissInstall();
  }, [installEvent, dismissInstall]);

  return (
    <div className="vx-shell" lang={locale}>
      <header className="vx-header">
        <button className="vx-icon-button" type="button" aria-label={copy.header.openClonesAria} onClick={() => setDrawerOpen(true)}><Icon name="menu" /></button>
        <a className="vx-wordmark" href="/" aria-label={copy.header.homeAria}><VyaktiMark /></a>
        <div ref={accountWrapRef} className="vx-account-wrap"><button className="vx-account" type="button" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen((value) => !value)} aria-label={copy.header.openAccountMenuAria}><span>{identity.slice(0, 1).toUpperCase()}</span></button>{accountOpen ? <div className="vx-account-popover" role="menu"><span>{identity}</span><button type="button" role="menuitem" onClick={onSignOut}>{copy.header.signOut}</button></div> : null}</div>
      </header>

        {selected && <ActivityPanel headless token={accessToken} replicaId={selected.replica_id} where="feed" showHeading={false} onAuthError={onAuthError} onAct={onActivityAct} onView={onActivityView} journeyPending={Boolean(progress.primarySourceId && !progress.canTest)} />}
        {firstFiveMinutesStepId && <FirstFiveMinutesRail step={firstFiveMinutesStepId} />}


      <main className="vx-main" ref={mainRef}>
        {selected && room === "voice" && meetView === "sample" && internalVoiceAvailability === "unknown" ? <Suspense fallback={null}>
          <InternalVoicePanel token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} probeOnly
            onAvailability={(available) => setInternalVoiceAvailability(available ? "enabled" : "disabled")} />
        </Suspense> : null}
        <AnimatePresence mode="wait" initial={false}>
          {workspaceReadState !== "ready" ? (
            <section className="vx-scene vx-read-state" key="workspace-read" aria-live="polite"><div className="vx-stage-title"><h1>{workspaceReadState === "error" ? copy.readStates.workspaceError : copy.readStates.workspaceLoading}</h1></div>{workspaceReadState === "error" ? <button className="vx-button vx-button--primary" type="button" onClick={onRetryWorkspace}>{copy.readStates.tryAgain}</button> : <p role="status">{copy.readStates.checkingSavedClones}</p>}</section>
          ) : internalVoiceAvailability === "enabled" && selected && room === "voice" && meetView === "sample" ? (
            <motion.div className="vx-scene vx-room" key={`internal-voice:${selected.replica_id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <section className="vx-room__panel vx-room__voice vx-room__scroll"><Suspense fallback={null}>
                <div className="vx-conversation-switch internal-voice-tabs" role="group" aria-label={copy.rooms.voice.meetExperienceAria}><button type="button" aria-pressed={false} onClick={() => setMeetView("conversation")}>{copy.rooms.voice.conversation}</button><button type="button" aria-pressed={true} onClick={() => setMeetView("sample")}>{copy.rooms.voice.voiceSample}</button></div>
                <InternalVoicePanel token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} />
              </Suspense></section>
            </motion.div>
          ) : selected && room === "rehearsal" ? (
            <motion.div className="vx-scene" key={`rehearsal:${selected.replica_id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Suspense fallback={<p role="status">{copy.readStates.openingPrivateDraftTest}</p>}><PrivateTextRehearsal initialDraft={rehearsalReturn.current?.draft} token={accessToken} replicaId={selected.replica_id} lifecycle={selected.lifecycle} onBack={() => { rehearsalReturn.current = null; chooseRoom("enrich"); }} onEditContext={draft => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== selected.replica_id) return;
                  rehearsalReturn.current = { identity, token: accessToken, replicaId: selected.replica_id, draft };
                  setEnrichView("files"); chooseRoom("enrich");
                }} onAuthError={onAuthError} /></Suspense></motion.div>
          ) : selected && !creatingNew && !agreementBusy && consentReadState !== "ready" ? (
            <section className="vx-scene vx-read-state" key="consent-read" aria-live="polite"><div className="vx-stage-title"><h1>{consentReadState === "error" ? copy.readStates.consentError : copy.readStates.consentLoading}</h1></div>{consentReadState === "error" ? <button className="vx-button vx-button--primary" type="button" onClick={onRetryConsent}>{copy.readStates.checkAgain}</button> : <p role="status">{copy.readStates.loadingAgreement}</p>}</section>
          ) : needsAgreement ? (
            <motion.div className="vx-scene" key="agreement" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Agreement busy={agreementBusy || creating} error={agreementError} onContinue={() => void continueAgreement()} /></motion.div>
          ) : privateFirstMeet && selected ? (
            <motion.div className="vx-scene" key={`first-meet-rehearsal:${selected.replica_id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Suspense fallback={<p role="status">{copy.readStates.openingPrivateDraftTest}</p>}><PrivateTextRehearsal initialDraft={rehearsalReturn.current?.draft} token={accessToken} replicaId={selected.replica_id} lifecycle={selected.lifecycle} onBack={() => { setEnrichView("files"); chooseRoom("enrich"); }} onEditContext={draft => {
              if (!reissueMounted.current || reissueCurrent.current.identity !== identity || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== selected.replica_id) return;
              rehearsalReturn.current = { identity, token: accessToken, replicaId: selected.replica_id, draft };
              setEnrichView("files"); chooseRoom("enrich");
            }} onAuthError={onAuthError} /></Suspense></motion.div>
          ) : upload ? (
            <motion.section className="vx-scene vx-upload" key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-labelledby="vx-upload-title">
              <div className="vx-stage-title"><h1 id="vx-upload-title">{upload.phase === "failed" ? copy.upload.pausedHeading : copy.upload.securingHeading}</h1><p>{upload.message}</p></div>
              <div className="vx-upload__center"><VoiceField level={upload.phase === "failed" ? 0.08 : 0.24} calm /><strong>{upload.phase === "hash" ? copy.upload.checkingRecording : upload.phase === "upload" ? copy.upload.uploadingPercentTemplate.replace("{n}", String(upload.progress)) : upload.phase === "failed" ? copy.upload.paused : upload.phase === "authorize" ? copy.upload.openingPrivateUpload : upload.phase === "verify" ? copy.upload.verifyingReceipt : copy.upload.selectingVoice}</strong></div>
              {upload.phase === "failed" ? <><p className="vx-upload__note"><Icon name="lock" /> {copy.upload.recordingStillHere}</p><div className="vx-upload__actions"><button className="vx-button vx-button--primary" type="button" onClick={() => retryRef.current && void submitRecording(retryRef.current.sample, retryRef.current.language, true)}>{copy.upload.retrySafely}</button><button className="vx-button vx-button--quiet" type="button" onClick={() => void discardFailedAndRetake()}>{copy.upload.recordAgain}</button></div></> : <p className="vx-upload__note"><Icon name="lock" /> {copy.upload.keepPageOpen}</p>}
            </motion.section>
          ) : showSagaRecovery && !textWorkspaceOpen ? (
            <motion.section className="vx-scene vx-saga-recovery" key="saga-recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-labelledby="vx-saga-title"><div className="vx-upload__center"><VoiceField level={0.08} calm /></div><div className="vx-stage-title"><h1 id="vx-saga-title">{copy.sagaRecovery.heading}</h1><p>{copy.sagaRecovery.body}</p></div><div className="vx-upload__actions"><button className="vx-button vx-button--primary" type="button" onClick={() => void onRefreshEnrollment()}>{copy.sagaRecovery.checkReceipt}</button><button className="vx-button vx-button--quiet" type="button" onClick={() => void replaceRecording()}>{copy.sagaRecovery.startAgain}</button></div></motion.section>
          ) : showRecorder && !textWorkspaceOpen ? (
            <motion.div className="vx-scene" key="record" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><ResonanceRecorder key={selected?.replica_id} onKnowledge={() => chooseRoom("enrich")} onProceed={(sample, language) => void submitRecording(sample, language)} /></motion.div>
          ) : voiceVerificationPending && selected && !textWorkspaceOpen ? (
            <motion.section className="vx-scene vx-saga-recovery" key="voice-verification-pending" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-labelledby="vx-verification-pending-title"><div className="vx-stage-title"><h1 id="vx-verification-pending-title">{copy.verification.platformPendingHeading}</h1><p>{privateTextEntryEligible ? copy.verification.platformPendingReadyBody : copy.verification.platformPendingBody}</p></div><div className="vx-upload__actions">{privateTextEntryEligible ? <button className="vx-button vx-button--primary" type="button" onClick={() => chooseRoom("rehearsal")}>{copy.verification.testPrivateDraft}</button> : null}<button className="vx-button vx-button--quiet" type="button" onClick={() => { setEnrichView("menu"); chooseRoom("enrich"); }}>{copy.verification.backToKnowledge}</button></div></motion.section>
          ) : showVerification && selected && !textWorkspaceOpen ? (
            <motion.div className="vx-scene vx-verification" key="verification" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{voiceBuildIntent?.state === "failed" ? <aside className="vx-recovery" role="alert"><div><strong>{selectionReissue ? copy.verification.chooseWhetherToUse : copy.verification.couldNotBuild}</strong><span>{selectionReissue ? voiceBuildIntent.last_error_code === "primary_selection_snapshot_missing" ? copy.verification.needsNewConfirmation : copy.verification.confirmToReplace : voiceBuildIntent.last_error_code.replaceAll("_", " ") || copy.verification.buildStoppedOurSide}</span>{selectionReissue && !onReadVoiceReissue ? <span>{copy.verification.checkingUnavailable}</span> : null}{reissueError ? <span role="alert">{reissueError}</span> : null}</div>{selectionReissue ? <button type="button" disabled={reissueBusy || !onReadVoiceReissue} onClick={() => void reissueSavedRecording()}>{reissueBusy ? copy.verification.checkingRecording : copy.verification.useThisRecording}</button> : null}<button type="button" disabled={reissueBusy} onClick={() => void replaceRecording()}>{copy.verification.recordAgain}</button></aside> : recoveryJob ? <aside className="vx-recovery" role={recoveryJob.state === "waiting_on_you" ? "status" : "alert"}><div><strong>{recoveryJob.state === "waiting_on_you" ? copy.verification.actionNeeded : copy.verification.stepStopped}</strong><span>{recoveryJob.state_reason}</span></div>{recoveryJob.next_action.kind !== "none" && recoveryJob.next_action.kind !== "wait" && recoveryJob.next_action.kind !== "owner_setup" ? <button type="button" disabled={recoveryBusy} onClick={() => void runRecoveryAction()}>{recoveryBusy ? copy.verification.checking : recoveryJob.next_action.label}</button> : null}</aside> : null}<CloneVerificationJourney ownerUserId={ownerUserId} token={accessToken} replica={selected} consents={consents} sources={sources} review={review} candidateSourceId={activeCandidate?.source_id} buildIntent={voiceBuildIntent} reviewLoading={reviewLoading} challenge={challenge} livenessLoading={livenessLoading} onOpenSourcePermission={() => { void onGrantConsent().catch(onAuthError); }} onResetLegacyClone={onRevoke} onReturnToVoice={() => void replaceRecording()} onExit={() => { setEnrichView("menu"); chooseRoom("enrich"); }} exitLabel={copy.verification.backToKnowledge} onContinue={finishCandidateJourney} onCreateSourceUpload={onCreateUpload} onRetryUpload={onRetryUpload} onFinalizeSourceUpload={onFinalizeUpload} onDeleteSource={onDeleteSource} onSourcesChanged={onRefreshEnrollment} onIdentityChanged={onRefreshEnrollment} onCheckCaptureReadiness={onCheckCaptureReadiness} onIssueChallenge={onIssueChallenge} onStartFaceSession={onStartFaceSession} onPollFaceSession={onPollFaceSession} onCancelChallenge={onCancelChallenge} onCreateLivenessUpload={onCreateLivenessUpload} onFinalizeLiveness={onFinalizeLiveness} onVerifiedConsentChanged={onVerifiedConsentChanged} onRefreshReview={onRefreshReview} onAuthError={onAuthError} /></motion.div>
          ) : showRooms && selected ? (
            <motion.div className="vx-scene vx-room" key={room} initial={reduceMotion ? false : { opacity: 0, filter: "blur(7px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={reduceMotion ? undefined : { opacity: 0, filter: "blur(5px)" }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
              {room === "voice" && <section className="vx-room__panel vx-room__voice vx-room__scroll"><div className="vx-stage-title"><h1>{copy.rooms.voice.headingTemplate.replace("{name}", selected.display_name)}</h1><p>{copy.rooms.voice.body}</p></div><div className="vx-conversation-switch" role="group" aria-label={copy.rooms.voice.meetExperienceAria}><button type="button" aria-pressed={meetView === "conversation"} onClick={() => setMeetView("conversation")}>{copy.rooms.voice.conversation}</button><button type="button" aria-pressed={meetView === "sample"} onClick={() => setMeetView("sample")}>{copy.rooms.voice.voiceSample}</button><button type="button" onClick={() => chooseRoom("rehearsal")}>{copy.rooms.voice.privateDraftTest}</button><button type="button" onClick={openListeningTest}>{copy.rooms.voice.listeningTest}</button></div>{showListeningTest ? (
                listeningLoad === "ready" && listeningCandidates ? (
                  <Suspense fallback={<p role="status">{copy.rooms.voice.openingListeningTest}</p>}>
                    <ListeningTest
                      token={accessToken}
                      replicaId={selected.replica_id}
                      left={listeningCandidates.left}
                      right={listeningCandidates.right}
                      referenceSha256={listeningCandidates.referenceSha256}
                      onClose={() => setShowListeningTest(false)}
                      onAuthError={onAuthError}
                    />
                  </Suspense>
                ) : (
                  <section className="lt-panel" aria-live="polite">
                    <h2>{copy.rooms.voice.listeningTest}</h2>
                    {listeningLoad === "loading" ? <p>{copy.rooms.voice.lookingForSamples}</p>
                      : listeningLoad === "unavailable" ? <p>{copy.rooms.voice.needTwoSamples}</p>
                      : <p>{copy.rooms.voice.couldNotOpen}</p>}
                    <button type="button" className="lt-cancel" onClick={() => setShowListeningTest(false)}>{copy.rooms.voice.close}</button>
                  </section>
                )
              ) : meetView === "conversation" ? <Suspense fallback={<p role="status">{copy.rooms.voice.openingConversation}</p>}><ExpertConversation key={selected.replica_id} token={accessToken} replicaId={selected.replica_id} lifecycle={selected.lifecycle} runtimeStatus={runtimeStatus} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} onReview={() => chooseRoom("evolve")} /></Suspense> : <VoicePreviewPanel token={accessToken} replicaId={selected.replica_id} wizardInput={wizardInput} onAuthError={onAuthError} testEnvironment onManageSources={() => chooseRoom("enrich")} />}</section>}
              {room === "share" && <section className="vx-room__panel vx-room__scroll">{!voiceWorkspaceReady && <button type="button" className="vx-back" onClick={() => chooseRoom("enrich")}>{copy.rooms.share.backToKnowledge}</button>}<Suspense fallback={<p role="status">{copy.rooms.share.openingSharing}</p>}><ExpertSharePanel key={selected.replica_id} token={accessToken} replicaId={selected.replica_id} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} onReview={() => chooseRoom("evolve")} voiceWorkspaceReady={voiceWorkspaceReady} /></Suspense></section>}
              {room === "enrich" && <section className={`vx-room__panel${enrichView === "menu" ? "" : " vx-room__scroll"}`}>{enrichView === "menu" ? <>{!voiceWorkspaceReady && <button type="button" className="vx-back" onClick={() => { setReplacePrimary(true); chooseRoom("voice"); }}>{copy.rooms.enrich.backToVoice}</button>}<div className="vx-stage-title"><h1 id="knowledge-menu-title">{copy.rooms.enrich.heading}</h1><p>{copy.rooms.enrich.body}</p></div><div className="vx-enrich-menu">{!voiceWorkspaceReady && <button type="button" onClick={() => chooseRoom("share")}><Icon name="spark" /><span><strong>{copy.rooms.enrich.shareKnowledgeTitle}</strong><small>{copy.rooms.enrich.shareKnowledgeNote}</small></span><Icon name="chevron" /></button>}<button type="button" onClick={() => setEnrichView("sources")}><Icon name="add" /><span><strong>{copy.rooms.enrich.sourcesTitle}</strong><small>{copy.rooms.enrich.sourcesNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => chooseRoom("rehearsal")}><Icon name="spark" /><span><strong>{copy.rooms.enrich.testDraftTitle}</strong><small>{copy.rooms.enrich.testDraftNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("describe")}><Icon name="spark" /><span><strong>{copy.rooms.enrich.describeMeTitle}</strong><small>{copy.rooms.enrich.describeMeNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("humanos")}><Icon name="spark" /><span><strong>{copy.rooms.enrich.whoYouAreTitle}</strong><small>{copy.rooms.enrich.whoYouAreNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("files")}><Icon name="add" /><span><strong>{copy.rooms.enrich.filesTitle}</strong><small>{copy.rooms.enrich.filesNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("video")}><Icon name="voice" /><span><strong>{copy.rooms.enrich.videoTitle}</strong><small>{copy.rooms.enrich.videoNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => { setReplacePrimary(true); chooseRoom("voice"); }}><Icon name="voice" /><span><strong>{copy.rooms.enrich.improveVoiceTitle}</strong><small>{copy.rooms.enrich.improveVoiceNote}</small></span><Icon name="chevron" /></button><button type="button" onClick={() => chooseRoom("emotionos")}><Icon name="spark" /><span><strong>{copy.rooms.enrich.vibeTitle}</strong><small>{copy.rooms.enrich.vibeNote}</small></span><Icon name="chevron" /></button></div></> : <><button className="vx-back" type="button" onClick={() => setEnrichView("menu")}>{copy.rooms.enrich.backToChoices}</button>{!voiceWorkspaceReady && <button className="vx-text-button" type="button" onClick={() => { setReplacePrimary(true); chooseRoom("voice"); }}>{copy.rooms.enrich.recordInstead}</button>}{enrichView === "sources" ? <Suspense fallback={<p role="status">{copy.rooms.enrich.openingSources}</p>}><SourcesStudio token={accessToken} replicaId={selected.replica_id} onSourcesChanged={onRefreshEnrollment} /></Suspense> : null}{enrichView === "files" ? <>{!voiceWorkspaceReady && <button type="button" className="vx-text-button" onClick={() => chooseRoom("share")}>{copy.rooms.enrich.reviewTextSharing}</button>}{rehearsalReturn.current ? <button type="button" className="vx-text-button" onClick={() => chooseRoom("rehearsal")}>{feedCopy.back}</button> : null}<ContextLockerPanel token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError as never} onItemCount={onContextCount} onPrivateTextItemCount={onPrivateTextItemCount} teachSourceLabel={feedCopy.teach} onTeachSource={source => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || source.replicaId !== selected.replica_id || !isPrivateTextId(source.itemId) || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== source.replicaId) return;
                  chooseRoom("evolve");
                }} testSourceLabel={feedCopy.test} onTestSource={savedRehearsal ? undefined : source => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || source.replicaId !== selected.replica_id || !isPrivateTextId(source.itemId) || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== source.replicaId) return;
                  rehearsalReturn.current = { identity, token: accessToken, replicaId: source.replicaId, draft: { question: rehearsalReturn.current?.draft.question || "", sheetId: rehearsalReturn.current?.draft.sheetId || "", contextItemId: source.itemId } };
                  chooseRoom("rehearsal");
                }} /></> : null}{enrichView === "video" ? <VideoEnrollPanel token={accessToken} replicaId={selected.replica_id} onUseFileUpload={() => { setReplacePrimary(true); chooseRoom("voice"); }} /> : null}{enrichView === "describe" ? <DescribeMe token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} onSaved={onContextCount} /> : null}{enrichView === "humanos" ? <Suspense fallback={<p role="status">{copy.rooms.enrich.openingWhoYouAre}</p>}><HumanOsStudio token={accessToken} replica={selected} locale={locale} onAuthError={onAuthError} onSaved={onPersonalSheetSaved} /></Suspense> : null}</>}</section>}
              {room === "evolve" && <section className="vx-room__panel vx-room__scroll"><div className="vx-stage-title"><h1>{copy.rooms.evolve.heading}</h1><p>{copy.rooms.evolve.body}</p></div><Suspense fallback={<p className="vx-panel-loading">{copy.rooms.evolve.openingHistory}</p>}><PersonModelStudio token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} /></Suspense></section>}
              {room === "emotionos" && <section className="vx-room__panel vx-room__scroll"><Suspense fallback={<p className="vx-panel-loading">{copy.rooms.emotionos.openingVibe}</p>}><EmotionOsStudio token={accessToken} replicaId={selected.replica_id} replica={selected as { locale?: unknown }} onAuthError={onAuthError} onBack={() => chooseRoom("enrich")} /></Suspense></section>}
              {room === "call" && <section className="vx-room__panel vx-room__scroll"><div className="vx-stage-title"><h1>{copy.rooms.call.headingTemplate.replace("{name}", selected.display_name)}</h1><p>{copy.rooms.call.body}</p></div><Suspense fallback={<p className="vx-panel-loading">{copy.rooms.call.openingCallRoom}</p>}><MirrorCallStudio token={accessToken} replicaId={selected.replica_id} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} /></Suspense></section>}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      {room !== "rehearsal" && (voiceWorkspaceReady || textReady) && <RoomNav room={room} onChange={chooseRoom} />}
      {/* WS-R157: the install card. `shouldShowInstallCard` (above) decides
          whether this renders at all; this block only decides which of the
          two variants — a browser with a captured `beforeinstallprompt` gets
          a working button, iOS gets static "Add to home screen" instructions
          instead, since no button can ever exist there. `RoomApp.tsx`'s own
          `.room-cap`/`.room-btn` pattern, restated here as `.vx-install`/
          `.vx-button` so this card reads as one more instance of the SAME
          dismissible-card language the studio already has (`.vx-recovery`),
          not a new visual system. */}
      {showInstall && (
        <aside className="vx-install" role="note">
          <div>
            <strong>{showInstallIOS ? "Add Vyakti to your home screen." : "Get the Vyakti app."}</strong>
            <span>
              {showInstallIOS
                ? "Open the share menu below, then choose Add to Home Screen."
                : "It opens like an app and remembers where you left off."}
            </span>
          </div>
          {showInstallIOS ? (
            <button type="button" onClick={dismissInstall}>Got it</button>
          ) : (
            <>
              <button type="button" onClick={() => void doInstall()}>Install</button>
              <button type="button" className="vx-install__quiet" onClick={dismissInstall}>Not now</button>
            </>
          )}
        </aside>
      )}
      <WorkspaceNotice message={notice} error={error} locale={locale}
        scope={`${identity}:${selected?.replica_id || "new"}:${room}:${enrichView}`}
        hidden={readBlocked || drawerOpen || accountOpen}
        onDismissNotice={onDismissNotice} onDismissError={onDismissError} />
      <WorkspaceDrawer open={drawerOpen} replicas={replicas} selected={selected} runtimeStatus={runtimeStatus} onClose={() => setDrawerOpen(false)} onSelect={(id) => { setDrawerOpen(false); void onSelectReplica(id); }} onNew={() => { setDrawerOpen(false); onStartNew(); }} onReplace={() => void replaceRecording()} onDelete={() => void onRevoke()} busy={revoking || Boolean(upload && upload.phase !== "failed")} reduceMotion={reduceMotion} />
    </div>
  );
}
