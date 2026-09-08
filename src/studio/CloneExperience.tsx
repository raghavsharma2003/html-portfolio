import "./clone-experience.css";
import "./voice-field.css";
import "./clone-verification-journey.css";
import { initialMeetView } from "./workspaceNavigation";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ActivityPanel from "./ActivityPanel";
import ContextLockerPanel from "./ContextLockerPanel";
import type { PrivateTextReturnDraft } from "./PrivateTextRehearsal";
import { isPrivateTextId } from "./privateTextRehearsalApi";
import VideoEnrollPanel from "./VideoEnrollPanel";
import VoicePreviewPanel from "./VoicePreviewPanel";
import CloneVerificationJourney, { type CloneVerificationJourneyProps } from "./CloneVerificationJourney";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import { addContextFiles, fileToBase64, loadContextLocker } from "./contextLockerApi";
import {
  ENROLLMENT_LANGUAGE_LABELS,
  type EnrollmentLanguage,
} from "./enrollmentLanguage";
import { openPrivateWavCapture, type PrivateWavCapture } from "./wavCapture";
import { presentCloneProgress } from "./activityPresentation";
import VoiceField from "./VoiceField";
import VyaktiMark from "./VyaktiMark";
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
} from "./types";
import type { WizardInput } from "./wizardModel";

const MirrorCallStudio = lazy(() => import("./MirrorCallStudio"));
const PersonModelStudio = lazy(() => import("./PersonModelStudio"));
const ExpertSharePanel = lazy(() => import("./ExpertSharePanel"));
const ExpertConversation = lazy(() => import("./ExpertConversation"));
const PrivateTextRehearsal = lazy(() => import("./PrivateTextRehearsal"));

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

type MainRoom = "voice" | "enrich" | "evolve" | "call" | "share" | "rehearsal";
type EnrichView = "menu" | "files" | "video" | "describe";
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

function signalSummary(sample: VoiceSample) {
  if (!sample.recordedHere && sample.durationMs == null) return "This browser could not read the duration. Choose a different audio or video file.";
  if (!sample.recordedHere && sample.durationMs != null && sample.durationMs < MINIMUM_RECORDING_MS) return "Choose at least 12 seconds of clear, single-speaker audio.";
  if (!sample.recordedHere) return "Speech and signal quality will be verified during private processing.";
  if ((sample.samplePeak ?? 0) >= 0.995) return "The microphone clipped. Move a little farther away and try again.";
  if ((sample.audibleRatio ?? 0) < 0.35) return "Much of the sample is quiet. Move closer and try again.";
  return "The audio level looks usable and no clipping was detected on this device.";
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
  const reduceMotion = useReducedMotion();
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [sample, setSample] = useState<VoiceSample | null>(null);
  const [language, setLanguage] = useState<EnrollmentLanguage>("hinglish");
  const [fileOwnershipConfirmed, setFileOwnershipConfirmed] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [levelHistory, setLevelHistory] = useState<number[]>(() => Array.from({ length: 96 }, () => 0));
  const [hint, setHint] = useState("Press once to begin. Let go whenever you like. Press again to finish.");
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

  const clearSample = useCallback(() => {
    if (sampleUrlRef.current) URL.revokeObjectURL(sampleUrlRef.current);
    sampleUrlRef.current = null;
    setSample(null);
  }, []);

  const stop = useCallback(async () => {
    if (!captureRef.current || stoppingRef.current) return;
    if (Date.now() - startedAtRef.current < MINIMUM_RECORDING_MS) {
      setHint(`Keep speaking for ${Math.ceil((MINIMUM_RECORDING_MS - (Date.now() - startedAtRef.current)) / 1000)} more seconds.`);
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
      sampleUrlRef.current = result.url;
      setSample({
        file: renamed,
        url: result.url,
        kind: "audio",
        durationMs: result.durationMs,
        samplePeak: samplePeakRef.current,
        audibleRatio: totalFramesRef.current ? audibleFramesRef.current / totalFramesRef.current : 0,
        recordedHere: true,
      });
      setElapsedMs(result.durationMs);
      setCaptureState("review");
      setHint("Your sample stayed on this device. Listen once, then continue or record again.");
    } catch (cause) {
      if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
      setError(cause instanceof Error ? cause.message : "The recording could not be finished.");
      setCaptureState("idle");
    } finally {
      if (attempt === captureAttemptRef.current) stoppingRef.current = false;
    }
  }, []);

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
      setHint("Speak naturally about anything. A complete thought is better than a script.");
    } catch (cause) {
      if (!mountedRef.current || captureAttemptRef.current !== captureAttempt) return;
      setError(cause instanceof Error ? cause.message : "The browser could not open your microphone.");
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
    setHint("Press once to begin. Let go whenever you like. Press again to finish.");
  }

  async function chooseFile(file: File | null) {
    if (!file || !mountedRef.current) return;
    const attempt = ++captureAttemptRef.current;
    pendingMediaRef.current?.();
    pendingMediaRef.current = null;
    clearSample();
    setCaptureState("requesting");
    setFileOwnershipConfirmed(false);
    const url = URL.createObjectURL(file);
    const durationMs = await new Promise<number | null>((resolve) => {
      const media = file.type.startsWith("video/") ? document.createElement("video") : new Audio();
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
    });
    if (!mountedRef.current || attempt !== captureAttemptRef.current) {
      URL.revokeObjectURL(url);
      return;
    }
    sampleUrlRef.current = url;
    setSample({ file, url, kind: file.type.startsWith("video/") ? "video" : "audio", durationMs, samplePeak: null, audibleRatio: null, recordedHere: false });
    setFileOwnershipConfirmed(false);
    setCaptureState("review");
    setHint("This file stays local until you choose Continue.");
  }

  const enough = sample?.durationMs != null && sample.durationMs >= MINIMUM_RECORDING_MS;
  const qualityGood = enough && (sample?.samplePeak == null || sample.samplePeak < 0.995) && (sample?.audibleRatio == null || sample.audibleRatio >= 0.35);
  const sourceClear = Boolean(sample?.recordedHere || fileOwnershipConfirmed);

  return (
    <section className="vx-capture" aria-labelledby="vx-capture-title">
      {captureState === "idle" && !sample && onKnowledge && <button type="button" className="vx-button vx-button--quiet" onClick={onKnowledge}>Add knowledge first</button>}
      <motion.div layout="position" className="vx-stage-title">
        <h1 id="vx-capture-title">{captureState === "review" ? "Your voice is ready to become." : "Say something only you would say."}</h1>
        <p>{captureState === "review" ? "Listen once, choose the language, then continue." : "One natural thought is enough. No script needed."}</p>
      </motion.div>

      <div className="vx-capture__center">
        <VoiceField level={level} history={levelHistory} active={captureState === "recording"} calm={captureState === "review"} />
        {captureState !== "review" ? <div className="vx-aperture-marks" aria-hidden="true"><span>12 s minimum</span><span>30 s ideal</span><span>Local first</span></div> : null}
        <AnimatePresence mode="wait" initial={false}>
          {captureState !== "review" ? (
            <motion.button
              key="record"
              className={`vx-record-button is-${captureState}`}
              type="button"
              disabled={disabled || captureState === "requesting"}
              aria-label={captureState === "recording" ? `Finish recording. ${clockDuration(elapsedMs)} recorded` : "Start voice recording"}
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
              initial={reduceMotion ? false : { scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={reduceMotion ? undefined : { scale: 0.96 }}
              whileTap={reduceMotion ? undefined : { scale: 0.965 }}
            >
              <span>{captureState === "requesting" ? "Opening" : captureState === "recording" ? "Finish" : "Begin"}</span>
              {captureState === "recording" && <small>{clockDuration(elapsedMs)}</small>}
            </motion.button>
          ) : sample ? (
            <motion.div
              key="review"
              className="vx-sample"
              initial={reduceMotion ? false : { opacity: 0, clipPath: "inset(42% 0 42% 0 round 24px)" }}
              animate={{ opacity: 1, clipPath: "inset(0% 0 0% 0 round 24px)" }}
              exit={reduceMotion ? undefined : { opacity: 0 }}
            >
              <div className="vx-sample__measure">
                <strong>{sample.durationMs == null ? "Audio ready" : clockDuration(sample.durationMs)}</strong>
                <span>{sample.recordedHere ? "24 kHz private WAV" : `${bytesLabel(sample.file.size)} ${sample.kind} file`}</span>
              </div>
              {sample.kind === "video"
                ? <video controls playsInline preload="metadata" src={sample.url}>Your browser cannot preview this video.</video>
                : <audio controls preload="metadata" src={sample.url}>Your browser cannot preview this audio.</audio>}
              <p className={qualityGood ? "is-good" : "is-warning"}>{signalSummary(sample)}</p>
              {!sample.recordedHere && <label className="vx-source-declaration"><input type="checkbox" checked={fileOwnershipConfirmed} onChange={(event) => setFileOwnershipConfirmed(event.target.checked)} /><span>This file contains only my voice, or I have removed every other speaker.</span></label>}
              <fieldset className="vx-language">
                <legend>How did you speak?</legend>
                <div>
                  {(Object.keys(ENROLLMENT_LANGUAGE_LABELS) as EnrollmentLanguage[]).map((item) => (
                    <button key={item} type="button" className={language === item ? "is-selected" : ""} aria-pressed={language === item} onClick={() => setLanguage(item)}>
                      {ENROLLMENT_LANGUAGE_LABELS[item]}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className="vx-sample__actions">
                <button className="vx-button vx-button--quiet" type="button" onClick={() => void retake()}>Try again</button>
                <button className="vx-button vx-button--primary" type="button" disabled={!qualityGood || !sourceClear} onClick={() => onProceed(sample, language)}>Continue</button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div id="vx-capture-help" className="vx-capture__instruction">
        <strong>{captureState === "recording" ? (elapsedMs < MINIMUM_RECORDING_MS ? `${Math.ceil((MINIMUM_RECORDING_MS - elapsedMs) / 1000)} seconds to go` : elapsedMs < RECOMMENDED_RECORDING_MS ? "Enough to finish" : "Strong sample length") : hint}</strong>
        {captureState === "recording" && <span>{elapsedMs < RECOMMENDED_RECORDING_MS ? "About 30 seconds gives the selector more clean speech." : "Finish at the end of this thought."}</span>}
      </div>

      {captureState === "idle" && (
        <button className="vx-file-alternative" type="button" onClick={() => fileInputRef.current?.click()}>
          Use an audio or video file instead
        </button>
      )}
      <input ref={fileInputRef} className="vx-visually-hidden" type="file" aria-label="Choose your voice recording" tabIndex={-1} accept="audio/*,video/*,.wav,.mp3,.m4a,.aac,.flac,.ogg,.opus,.webm,.mp4,.mov,.mkv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0] ?? null)} />
      {error && <p className="vx-error" role="alert">{error}</p>}
    </section>
  );
}

function Agreement({ busy, error, onContinue }: { busy: boolean; error: string; onContinue: () => void }) {
  const [checks, setChecks] = useState([false, false, false]);
  const all = checks.every(Boolean);
  const labels = [
    "These are my sources, and I am creating only my own private clone.",
    "I am 18 or older and I understand every generated clip is disclosed and protected.",
    "I accept the privacy policy and terms for private capture, storage, and transcription.",
  ];
  return (
    <section className="vx-agreement" aria-labelledby="vx-agreement-title">
      <div className="vx-stage-title">
        <h1 id="vx-agreement-title">Your source-use agreement.</h1>
        <p>This allows private source storage and transcription. Each private text question has its own permission; cloned voice also needs identity checks.</p>
      </div>
      <div className="vx-agreement__body">
        <button className="vx-check-all" type="button" aria-pressed={all} onClick={() => setChecks([!all, !all, !all])}>
          <span className={all ? "is-checked" : ""}>{all ? <Icon name="check" /> : null}</span>
          <strong>{all ? "Everything selected" : "Select all"}</strong>
        </button>
        <div className="vx-agreement__checks">
          {labels.map((label, index) => (
            <label key={label}>
              <input type="checkbox" checked={checks[index]} onChange={() => setChecks((current) => current.map((value, item) => item === index ? !value : value))} />
              <span>{label}</span>
            </label>
          ))}
        </div>
        <p className="vx-agreement__legal">Read the <a href="/privacy" target="_blank" rel="noreferrer">privacy policy and terms</a>. Model authorization is separate, identity-bound, and shown before a voice model is built. You can erase a source or the whole clone later.</p>
        <button className="vx-button vx-button--primary vx-agreement__continue" type="button" disabled={!all || busy} onClick={onContinue}>
          {busy ? "Opening your private space" : "Agree and continue"}
        </button>
        {error && <p className="vx-error" role="alert">{error}</p>}
      </div>
    </section>
  );
}

function RoomNav({ room, onChange }: { room: MainRoom; onChange: (room: MainRoom) => void }) {
  const rooms: Array<{ id: MainRoom; label: string; icon: "voice" | "add" | "spark" | "call" }> = [
    { id: "voice", label: "Meet", icon: "voice" },
    { id: "enrich", label: "Knowledge", icon: "add" },
    { id: "evolve", label: "Review", icon: "spark" },
    { id: "call", label: "Call", icon: "call" },
    { id: "share", label: "Share", icon: "add" },
  ];
  return (
    <nav className="vx-room-nav" aria-label="Clone rooms">
      {rooms.map((item) => (
        <button key={item.id} type="button" className={room === item.id ? "is-active" : ""} aria-current={room === item.id ? "page" : undefined} onClick={() => onChange(item.id)}>
          <Icon name={item.icon} /><span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

function DescribeMe({ token, replicaId, onAuthError, onSaved }: { token: string; replicaId: string; onAuthError: (cause: unknown) => void; onSaved: (count: number) => void }) {
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
      if (!result || result.error) throw new Error(result?.error || "The note was not stored.");
      setText("");
      setMessage("Saved as private context. Any durable change will wait for your review.");
      onSaved((await loadContextLocker(token, replicaId)).items.length);
    } catch (cause) {
      onAuthError(cause);
      setMessage(cause instanceof Error ? cause.message : "The note could not be saved.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="vx-describe" aria-labelledby="vx-describe-title">
      <div className="vx-stage-title"><h1 id="vx-describe-title">Describe yourself naturally.</h1><p>A sentence or a page is fine. Vyakti turns it into cited proposals, never silent personality changes.</p></div>
      <textarea value={text} maxLength={12_000} placeholder="I am warm with close friends, direct at work, and I switch to Hindi when I get excited..." onChange={(event) => setText(event.target.value)} />
      <div><span>{text.trim().length.toLocaleString()} characters</span><button className="vx-button vx-button--primary" type="button" disabled={busy || !text.trim()} onClick={() => void save()}>{busy ? "Saving privately" : "Add to my context"}</button></div>
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
        <motion.button className="vx-drawer-scrim" type="button" aria-label="Close clone drawer" onClick={onClose} initial={reduceMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduceMotion ? undefined : { opacity: 0 }} transition={{ duration: reduceMotion ? 0 : 0.18 }} />
        <motion.aside ref={drawerRef} className="vx-drawer" role="dialog" aria-modal="true" aria-label="Your clones and versions" tabIndex={-1} initial={reduceMotion ? false : { x: "-102%" }} animate={{ x: 0 }} exit={reduceMotion ? undefined : { x: "-102%" }} transition={{ duration: reduceMotion ? 0 : 0.28, ease: [0.16, 1, 0.3, 1] }}>
          <div className="vx-drawer__head"><strong>Your Vyaktis</strong><button type="button" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
          <div className="vx-drawer__list">
            {replicas.map((replica) => (
              <button key={replica.replica_id} type="button" disabled={busy} className={selected?.replica_id === replica.replica_id ? "is-current" : ""} onClick={() => onSelect(replica.replica_id)}>
                <span>{replica.display_name.slice(0, 1).toUpperCase()}</span>
                <div><strong>{replica.display_name}</strong><small>{replica.replica_id === selected?.replica_id && runtimeStatus?.versions.voice_genome ? `Voice v${runtimeStatus.versions.voice_genome}` : replica.lifecycle}</small></div>
                <Icon name="chevron" />
              </button>
            ))}
          </div>
          <button className="vx-drawer__new" type="button" disabled={busy} onClick={onNew}><Icon name="add" />Create another clone</button>
          {selected && <div className="vx-drawer__actions">
            <button type="button" disabled={busy} onClick={onReplace}>Replace primary recording</button>
            {!confirmDelete ? <button className="is-danger" type="button" onClick={() => setConfirmDelete(true)}>Delete this clone</button> : (
              <div className="vx-drawer__confirm"><p>This blocks the clone now and starts verified erasure.</p><button className="is-danger" type="button" disabled={busy} onClick={onDelete}>{busy ? "Deleting" : "Delete permanently"}</button><button type="button" onClick={() => setConfirmDelete(false)}>Cancel</button></div>
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
}

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
    onActivityView, onActivityAct, onAuthError, onContextCount,
  } = props;
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
  const [room, setRoom] = useState<MainRoom>(() => {
    const view = new URLSearchParams(window.location.search).get("view");
    return view === "rehearsal" ? "rehearsal" : view === "call" ? "call" : view === "enrich" ? "enrich" : view === "evolve" ? "evolve" : view === "share" ? "share" : "voice";
  });
  const [meetView, setMeetView] = useState<"conversation" | "sample">(() => initialMeetView(window.location.search, Boolean(runtimeStatus?.active)));
  const [enrichView, setEnrichView] = useState<EnrichView>("menu");
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
      catch { throw new Error("This browser could not read the saved request. No build was sent. Allow local storage and try again."); }
      const fresh = await onReadVoiceReissue();
      if (!currentScope()) return;
      const current = reissueCurrent.current;
      if (!current.selected || !eligible(current.selected, current.sources, current.consents)
        || !eligible(fresh.replica, fresh.sources, fresh.consents)) {
        throw new Error("This saved recording is not available for a new request. Refresh its status before trying again.");
      }
      if (window.localStorage.getItem(voiceSagaKey(replicaId)) !== previousStored
        || readVoiceSaga(replicaId)?.buildIntentId !== previous.buildIntentId) {
        throw new Error("This recording request changed in another tab. Reload before choosing again.");
      }
      const next = { ...previous, buildIntentId: crypto.randomUUID() };
      const serialized = JSON.stringify(next);
      // Persist before the poll effect can send. An uncertain response reuses this exact UUID, including after reload.
      try {
        window.localStorage.setItem(voiceSagaKey(replicaId), serialized);
        if (window.localStorage.getItem(voiceSagaKey(replicaId)) !== serialized) throw new Error("storage_readback_failed");
      } catch {
        throw new Error("This browser could not save the new request. No build was sent. Allow local storage and try again.");
      }
      if (retryRef.current?.sourceId === previous.sourceId) retryRef.current.buildIntentId = next.buildIntentId;
      setVoiceBuildIntent(null);
      setVoiceSaga(next);
    } catch (cause) {
      if (currentScope()) setReissueError(cause instanceof Error ? cause.message : "Could not check this recording. Your saved request has been kept.");
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
    const selector = room === "rehearsal" ? "#ptr-title" : room === "share" ? ".vx-expert-share h1" : room === "enrich" && enrichView === "files" ? "#context-locker-title" : room === "enrich" && enrichView === "menu" ? "#knowledge-menu-title" : null;
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
      setAgreementError(cause instanceof Error ? cause.message : "We could not record the agreement. Nothing was uploaded.");
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
        setUpload({ phase: "hash", progress: 0, message: "Checking the recording on this device" });
        const sha256 = await sha256File(sample.file, (value) => {
          if (active()) setUpload({ phase: "hash", progress: Math.round(value), message: "Checking the recording on this device" });
        });
        if (!active()) return;
        setUpload({ phase: "authorize", progress: 0, message: "Opening a private upload" });
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
          if (!created.upload) throw new Error("Private upload authorization is missing.");
          setUpload({ phase: "upload", progress: 0, message: "Sending the recording to private storage" });
          await putSignedUpload(sample.file, created.upload, (value) => {
            if (active()) setUpload({ phase: "upload", progress: Math.round(value), message: "Sending the recording to private storage" });
          });
          if (!active()) return;
          operation.uploaded = true;
        }
      } else if (!operation.uploaded) {
        if (!sourceId) throw new Error("The private source receipt is missing.");
        setUpload({ phase: "authorize", progress: 0, message: "Renewing the private upload" });
        const retried = await onRetryUpload(sourceId);
        if (!active()) return;
        operation.finalized = retried.finalized;
        operation.uploaded = retried.finalized;
        if (!retried.finalized) {
          if (!retried.upload) throw new Error("Private upload authorization is missing.");
          setUpload({ phase: "upload", progress: 0, message: "Resuming the private upload" });
          await putSignedUpload(sample.file, retried.upload, (value) => {
            if (active()) setUpload({ phase: "upload", progress: Math.round(value), message: "Resuming the private upload" });
          });
          if (!active()) return;
          operation.uploaded = true;
        }
      }
      if (!sourceId) throw new Error("The private source receipt is missing.");
      if (!operation.finalized) {
        setUpload({ phase: "verify", progress: 0, message: "Verifying the stored recording" });
        await onFinalizeUpload(sourceId, operation.uploadIntentId);
        if (!active()) return;
        operation.finalized = true;
      }
      setUpload({ phase: "select", progress: 0, message: "Opening private verification for this exact recording" });
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
      if (active()) setUpload({ phase: "failed", progress: 0, message: cause instanceof Error ? cause.message : "The upload stopped before the build began." });
    } finally {
      if (active()) uploadLockedRef.current = false;
    }
  }, [onCreateUpload, onFinalizeUpload, onRefreshEnrollment, onRefreshReview, onRequestVoiceBuild, onRetryUpload, selected]);

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
  const showSagaRecovery = Boolean(selected && consentActive && voiceSaga && !activeCandidate && !upload);
  const showRecorder = Boolean(selected && consentActive && !voiceSaga && !activeCandidate && (!currentPrimary || replacePrimary) && !upload);
  const showVerification = Boolean(selected && consentActive && activeCandidate && !upload);
  const voiceWorkspaceReady = Boolean(selected && consentActive && !voiceSaga && currentVoiceReady && !replacePrimary && !upload);
  const showRooms = voiceWorkspaceReady || textWorkspaceOpen;
  const readBlocked = workspaceReadState !== "ready" || Boolean(selected && !creatingNew && !agreementBusy && room !== "rehearsal" && consentReadState !== "ready");

  return (
    <div className="vx-shell">
      <header className="vx-header">
        <button className="vx-icon-button" type="button" aria-label="Open your clones" onClick={() => setDrawerOpen(true)}><Icon name="menu" /></button>
        <a className="vx-wordmark" href="/" aria-label="Vyakti home"><VyaktiMark /></a>
        <div ref={accountWrapRef} className="vx-account-wrap"><button className="vx-account" type="button" aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen((value) => !value)} aria-label="Open account menu"><span>{identity.slice(0, 1).toUpperCase()}</span></button>{accountOpen ? <div className="vx-account-popover" role="menu"><span>{identity}</span><button type="button" role="menuitem" onClick={onSignOut}>Sign out</button></div> : null}</div>
      </header>

        {selected && <ActivityPanel headless token={accessToken} replicaId={selected.replica_id} where="feed" showHeading={false} onAuthError={onAuthError} onAct={onActivityAct} onView={onActivityView} journeyPending={Boolean(progress.primarySourceId && !progress.canTest)} />}


      <main className="vx-main" ref={mainRef}>
        <AnimatePresence mode="wait" initial={false}>
          {workspaceReadState !== "ready" ? (
            <section className="vx-scene vx-read-state" key="workspace-read" aria-live="polite"><div className="vx-stage-title"><h1>{workspaceReadState === "error" ? "We could not load your workspace." : "Opening your workspace."}</h1></div>{workspaceReadState === "error" ? <button className="vx-button vx-button--primary" type="button" onClick={onRetryWorkspace}>Try again</button> : <p role="status">Checking your saved clones.</p>}</section>
          ) : selected && room === "rehearsal" ? (
            <motion.div className="vx-scene" key={`rehearsal:${selected.replica_id}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Suspense fallback={<p role="status">Opening private draft test</p>}><PrivateTextRehearsal initialDraft={rehearsalReturn.current?.draft} token={accessToken} replicaId={selected.replica_id} lifecycle={selected.lifecycle} onBack={() => { rehearsalReturn.current = null; chooseRoom("enrich"); }} onEditContext={draft => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== selected.replica_id) return;
                  rehearsalReturn.current = { identity, token: accessToken, replicaId: selected.replica_id, draft };
                  setEnrichView("files"); chooseRoom("enrich");
                }} onAuthError={onAuthError} /></Suspense></motion.div>
          ) : selected && !creatingNew && !agreementBusy && consentReadState !== "ready" ? (
            <section className="vx-scene vx-read-state" key="consent-read" aria-live="polite"><div className="vx-stage-title"><h1>{consentReadState === "error" ? "We could not confirm your permissions." : "Checking your permissions."}</h1></div>{consentReadState === "error" ? <button className="vx-button vx-button--primary" type="button" onClick={onRetryConsent}>Check again</button> : <p role="status">Loading your saved agreement.</p>}</section>
          ) : needsAgreement ? (
            <motion.div className="vx-scene" key="agreement" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><Agreement busy={agreementBusy || creating} error={agreementError} onContinue={() => void continueAgreement()} /></motion.div>
          ) : upload ? (
            <motion.section className="vx-scene vx-upload" key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-labelledby="vx-upload-title">
              <div className="vx-stage-title"><h1 id="vx-upload-title">{upload.phase === "failed" ? "Upload paused." : "Securing your recording."}</h1><p>{upload.message}</p></div>
              <div className="vx-upload__center"><VoiceField level={upload.phase === "failed" ? 0.08 : 0.24} calm /><strong>{upload.phase === "hash" ? "Checking recording" : upload.phase === "upload" ? `Uploading ${upload.progress}%` : upload.phase === "failed" ? "Paused" : upload.phase === "authorize" ? "Opening private upload" : upload.phase === "verify" ? "Verifying receipt" : "Selecting voice"}</strong></div>
              {upload.phase === "failed" ? <><p className="vx-upload__note"><Icon name="lock" /> The recording is still in this tab. Keep it open to retry.</p><div className="vx-upload__actions"><button className="vx-button vx-button--primary" type="button" onClick={() => retryRef.current && void submitRecording(retryRef.current.sample, retryRef.current.language, true)}>Retry safely</button><button className="vx-button vx-button--quiet" type="button" onClick={() => void discardFailedAndRetake()}>Record again</button></div></> : <p className="vx-upload__note"><Icon name="lock" /> Keep this page open until private storage confirms the upload.</p>}
            </motion.section>
          ) : showSagaRecovery && !textWorkspaceOpen ? (
            <motion.section className="vx-scene vx-saga-recovery" key="saga-recovery" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} aria-labelledby="vx-saga-title"><div className="vx-upload__center"><VoiceField level={0.08} calm /></div><div className="vx-stage-title"><h1 id="vx-saga-title">Reconnect your recording.</h1><p>This browser remembers the exact private upload request. Check once for its server receipt, or start a fresh recording if the previous tab closed before upload.</p></div><div className="vx-upload__actions"><button className="vx-button vx-button--primary" type="button" onClick={() => void onRefreshEnrollment()}>Check private receipt</button><button className="vx-button vx-button--quiet" type="button" onClick={() => void replaceRecording()}>Start again</button></div></motion.section>
          ) : showRecorder && !textWorkspaceOpen ? (
            <motion.div className="vx-scene" key="record" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}><ResonanceRecorder key={selected?.replica_id} onKnowledge={() => chooseRoom("enrich")} onProceed={(sample, language) => void submitRecording(sample, language)} /></motion.div>
          ) : showVerification && selected && !textWorkspaceOpen ? (
            <motion.div className="vx-scene vx-verification" key="verification" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>{voiceBuildIntent?.state === "failed" ? <aside className="vx-recovery" role="alert"><div><strong>{selectionReissue ? "Choose whether to use this saved recording." : "This exact recording could not build."}</strong><span>{selectionReissue ? voiceBuildIntent.last_error_code === "primary_selection_snapshot_missing" ? "This older request needs a new confirmation. Your saved recording is still available." : "Your selected recording changed. Confirm only if you want this saved recording to replace that choice." : voiceBuildIntent.last_error_code.replaceAll("_", " ") || "The private build stopped on our side."}</span>{selectionReissue && !onReadVoiceReissue ? <span>Checking this saved recording is unavailable here. Your previous request has been kept.</span> : null}{reissueError ? <span role="alert">{reissueError}</span> : null}</div>{selectionReissue ? <button type="button" disabled={reissueBusy || !onReadVoiceReissue} onClick={() => void reissueSavedRecording()}>{reissueBusy ? "Checking recording" : "Use this recording"}</button> : null}<button type="button" disabled={reissueBusy} onClick={() => void replaceRecording()}>Record again</button></aside> : recoveryJob ? <aside className="vx-recovery" role={recoveryJob.state === "waiting_on_you" ? "status" : "alert"}><div><strong>{recoveryJob.state === "waiting_on_you" ? "One action is needed" : "This step stopped"}</strong><span>{recoveryJob.state_reason}</span></div>{recoveryJob.next_action.kind !== "none" && recoveryJob.next_action.kind !== "wait" && recoveryJob.next_action.kind !== "owner_setup" ? <button type="button" disabled={recoveryBusy} onClick={() => void runRecoveryAction()}>{recoveryBusy ? "Checking" : recoveryJob.next_action.label}</button> : null}</aside> : null}<CloneVerificationJourney ownerUserId={ownerUserId} token={accessToken} replica={selected} consents={consents} sources={sources} review={review} candidateSourceId={activeCandidate?.source_id} buildIntent={voiceBuildIntent} reviewLoading={reviewLoading} challenge={challenge} livenessLoading={livenessLoading} onOpenSourcePermission={() => { void onGrantConsent().catch(onAuthError); }} onResetLegacyClone={onRevoke} onReturnToVoice={() => void replaceRecording()} onExit={() => { setEnrichView("menu"); chooseRoom("enrich"); }} exitLabel="Back to knowledge" onContinue={finishCandidateJourney} onCreateSourceUpload={onCreateUpload} onRetryUpload={onRetryUpload} onFinalizeSourceUpload={onFinalizeUpload} onDeleteSource={onDeleteSource} onSourcesChanged={onRefreshEnrollment} onIdentityChanged={onRefreshEnrollment} onCheckCaptureReadiness={onCheckCaptureReadiness} onIssueChallenge={onIssueChallenge} onStartFaceSession={onStartFaceSession} onPollFaceSession={onPollFaceSession} onCancelChallenge={onCancelChallenge} onCreateLivenessUpload={onCreateLivenessUpload} onFinalizeLiveness={onFinalizeLiveness} onVerifiedConsentChanged={onVerifiedConsentChanged} onRefreshReview={onRefreshReview} onAuthError={onAuthError} /></motion.div>
          ) : showRooms && selected ? (
            <motion.div className="vx-scene vx-room" key={room} initial={reduceMotion ? false : { opacity: 0, filter: "blur(7px)" }} animate={{ opacity: 1, filter: "blur(0px)" }} exit={reduceMotion ? undefined : { opacity: 0, filter: "blur(5px)" }} transition={{ duration: reduceMotion ? 0 : 0.2 }}>
              {room === "voice" && <section className="vx-room__panel vx-room__voice vx-room__scroll"><div className="vx-stage-title"><h1>Meet {selected.display_name}.</h1><p>Ask a question or listen to a voice sample.</p></div><div className="vx-conversation-switch" role="group" aria-label="Meet experience"><button type="button" aria-pressed={meetView === "conversation"} onClick={() => setMeetView("conversation")}>Conversation</button><button type="button" aria-pressed={meetView === "sample"} onClick={() => setMeetView("sample")}>Voice sample</button><button type="button" onClick={() => chooseRoom("rehearsal")}>Private draft test</button></div>{meetView === "conversation" ? <Suspense fallback={<p role="status">Opening conversation</p>}><ExpertConversation key={selected.replica_id} token={accessToken} replicaId={selected.replica_id} lifecycle={selected.lifecycle} runtimeStatus={runtimeStatus} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} onReview={() => chooseRoom("evolve")} /></Suspense> : <VoicePreviewPanel token={accessToken} replicaId={selected.replica_id} wizardInput={wizardInput} onAuthError={onAuthError} testEnvironment onManageSources={() => chooseRoom("enrich")} />}</section>}
              {room === "share" && <section className="vx-room__panel vx-room__scroll">{!voiceWorkspaceReady && <button type="button" className="vx-back" onClick={() => chooseRoom("enrich")}>Back to knowledge</button>}<Suspense fallback={<p role="status">Opening sharing</p>}><ExpertSharePanel key={selected.replica_id} token={accessToken} replicaId={selected.replica_id} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} onReview={() => chooseRoom("evolve")} /></Suspense></section>}
              {room === "enrich" && <section className={`vx-room__panel${enrichView === "menu" ? "" : " vx-room__scroll"}`}>{enrichView === "menu" ? <>{!voiceWorkspaceReady && <button type="button" className="vx-back" onClick={() => chooseRoom("voice")}>Back to voice</button>}<div className="vx-stage-title"><h1 id="knowledge-menu-title">Add more of you.</h1><p>Choose one thing. Every durable change remains a proposal until you accept it.</p></div><div className="vx-enrich-menu">{!voiceWorkspaceReady && <button type="button" onClick={() => chooseRoom("share")}><Icon name="spark" /><span><strong>Share your knowledge</strong><small>Review material for a text-only link</small></span><Icon name="chevron" /></button>}<button type="button" onClick={() => chooseRoom("rehearsal")}><Icon name="spark" /><span><strong>Test a private draft</strong><small>One text answer from your saved source</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("describe")}><Icon name="spark" /><span><strong>Describe me</strong><small>Write naturally</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("files")}><Icon name="add" /><span><strong>Files, images, links</strong><small>Add private context</small></span><Icon name="chevron" /></button><button type="button" onClick={() => setEnrichView("video")}><Icon name="voice" /><span><strong>YouTube or video</strong><small>Bring your own material</small></span><Icon name="chevron" /></button><button type="button" onClick={() => { setReplacePrimary(true); chooseRoom("voice"); }}><Icon name="voice" /><span><strong>Improve my voice</strong><small>Add a stronger recording</small></span><Icon name="chevron" /></button></div></> : <><button className="vx-back" type="button" onClick={() => setEnrichView("menu")}>Back to choices</button>{!voiceWorkspaceReady && <button className="vx-text-button" type="button" onClick={() => chooseRoom("voice")}>Record my voice instead</button>}{enrichView === "files" ? <>{!voiceWorkspaceReady && <button type="button" className="vx-text-button" onClick={() => chooseRoom("share")}>Review text sharing</button>}{rehearsalReturn.current ? <button type="button" className="vx-text-button" onClick={() => chooseRoom("rehearsal")}>{feedCopy.back}</button> : null}<ContextLockerPanel token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError as never} onItemCount={onContextCount} teachSourceLabel={feedCopy.teach} onTeachSource={source => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || source.replicaId !== selected.replica_id || !isPrivateTextId(source.itemId) || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== source.replicaId) return;
                  chooseRoom("evolve");
                }} testSourceLabel={feedCopy.test} onTestSource={savedRehearsal ? undefined : source => {
                  if (!reissueMounted.current || reissueCurrent.current.identity !== identity || source.replicaId !== selected.replica_id || !isPrivateTextId(source.itemId) || reissueCurrent.current.accessToken !== accessToken || reissueCurrent.current.selected?.replica_id !== source.replicaId) return;
                  rehearsalReturn.current = { identity, token: accessToken, replicaId: source.replicaId, draft: { question: rehearsalReturn.current?.draft.question || "", sheetId: rehearsalReturn.current?.draft.sheetId || "", contextItemId: source.itemId } };
                  chooseRoom("rehearsal");
                }} /></> : null}{enrichView === "video" ? <VideoEnrollPanel token={accessToken} replicaId={selected.replica_id} onUseFileUpload={() => { setReplacePrimary(true); chooseRoom("voice"); }} /> : null}{enrichView === "describe" ? <DescribeMe token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} onSaved={onContextCount} /> : null}</>}</section>}
              {room === "evolve" && <section className="vx-room__panel vx-room__scroll"><div className="vx-stage-title"><h1>Choose what becomes you.</h1><p>Nothing changes the clone until you accept the cited proposal.</p></div><Suspense fallback={<p className="vx-panel-loading">Opening your evolution history</p>}><PersonModelStudio token={accessToken} replicaId={selected.replica_id} onAuthError={onAuthError} /></Suspense></section>}
              {room === "call" && <section className="vx-room__panel vx-room__scroll"><div className="vx-stage-title"><h1>Talk with {selected.display_name}.</h1><p>Calls can propose memories and language habits. You decide what stays.</p></div><Suspense fallback={<p className="vx-panel-loading">Opening the private call room</p>}><MirrorCallStudio token={accessToken} replicaId={selected.replica_id} stopped={selected.lifecycle !== "active" && selected.lifecycle !== "ready"} onAuthError={onAuthError} /></Suspense></section>}
            </motion.div>
          ) : null}
        </AnimatePresence>
      </main>

      {room !== "rehearsal" && voiceWorkspaceReady && <RoomNav room={room} onChange={chooseRoom} />}
      {!readBlocked && (notice || error) && <div className={`vx-toast${error ? " is-error" : ""}`} role={error ? "alert" : "status"}><div><strong>{error?.headline || "Done"}</strong><p>{error?.detail || notice}</p></div><button type="button" aria-label="Dismiss" onClick={error ? onDismissError : onDismissNotice}><Icon name="close" /></button></div>}
      <WorkspaceDrawer open={drawerOpen} replicas={replicas} selected={selected} runtimeStatus={runtimeStatus} onClose={() => setDrawerOpen(false)} onSelect={(id) => { setDrawerOpen(false); void onSelectReplica(id); }} onNew={() => { setDrawerOpen(false); onStartNew(); }} onReplace={() => void replaceRecording()} onDelete={() => void onRevoke()} busy={revoking || Boolean(upload)} reduceMotion={reduceMotion} />
    </div>
  );
}
