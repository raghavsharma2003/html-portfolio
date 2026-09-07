import { useCallback, useEffect, useRef, useState } from "react";
import {
  ENROLLMENT_LANGUAGE_LABELS,
  type EnrollmentLanguage,
} from "./enrollmentLanguage";
import {
  openPrivateWavCapture,
  type PrivateWavCapture,
} from "./wavCapture";

const MINIMUM_MS = 12_000;
const TARGET_MS = 30_000;
const MAXIMUM_MS = 60_000;

const RECORDING_PROMPTS: Record<EnrollmentLanguage, { lang: string; text: string }> = {
  english: {
    lang: "en-IN",
    text: "Hello, I am speaking in my normal voice and pace. When I explain a difficult idea, I begin with the simple meaning, then give a practical example. Clear teaching matters to me, so I pause naturally and let each point settle before moving on.",
  },
  hindi: {
    lang: "hi",
    text: "नमस्ते, मैं अपनी सामान्य आवाज़ और रफ़्तार में बोल रहा हूँ। जब मैं कोई कठिन बात समझाता हूँ, तो पहले उसका सरल अर्थ बताता हूँ, फिर एक छोटा उदाहरण देता हूँ। मुझे साफ़ और स्वाभाविक ढंग से बात करना पसंद है, ताकि सुनने वाला हर बात आराम से समझ सके।",
  },
  hinglish: {
    lang: "en-IN",
    text: "Namaste, main apni normal voice aur pace mein bol raha hoon. Jab main koi difficult idea explain karta hoon, pehle uska simple meaning batata hoon, phir ek practical example deta hoon. Clear teaching mere liye important hai, isliye main naturally Hindi aur English ke beech switch karta hoon.",
  },
};

type CaptureState = "idle" | "requesting" | "recording" | "review";
type Recording = { file: File; url: string; durationMs: number };

function timeLabel(durationMs: number) {
  const seconds = Math.max(0, Math.floor(durationMs / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function safeRecordingName(language: EnrollmentLanguage) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `vyakti-${language}-voice-${stamp}.wav`;
}

interface Props {
  disabled?: boolean;
  onUseRecording: (file: File, language: EnrollmentLanguage) => void;
}

export default function QuickVoiceCapture({ disabled = false, onUseRecording }: Props) {
  const [language, setLanguage] = useState<EnrollmentLanguage>("hinglish");
  const [captureState, setCaptureState] = useState<CaptureState>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [samplePeak, setSamplePeak] = useState(0);
  const [audibleFrames, setAudibleFrames] = useState(0);
  const [totalFrames, setTotalFrames] = useState(0);
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const captureRef = useRef<PrivateWavCapture | null>(null);
  const startedAtRef = useRef(0);
  const stoppingRef = useRef(false);
  const samplePeakRef = useRef(0);
  const audibleFramesRef = useRef(0);
  const totalFramesRef = useRef(0);
  const mountedRef = useRef(false);
  const captureAttemptRef = useRef(0);
  const recordingUrlRef = useRef<string | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;

  const clearRecording = useCallback(() => {
    if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
    recordingUrlRef.current = null;
    setRecording(null);
  }, []);

  const finish = useCallback(async (submitWhenClean = false) => {
    if (!captureRef.current || stoppingRef.current) return;
    stoppingRef.current = true;
    const attempt = captureAttemptRef.current;
    const capture = captureRef.current;
    try {
      const result = await capture.stop();
      if (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current) {
        URL.revokeObjectURL(result.url);
        return;
      }
      captureRef.current = null;
      setElapsedMs(result.durationMs);
      const audibleRatio = totalFramesRef.current
        ? audibleFramesRef.current / totalFramesRef.current
        : 0;
      const qualityProblem = result.durationMs < MINIMUM_MS
        ? "This sample is too short. Speak for at least 12 seconds."
        : samplePeakRef.current >= 0.995
          ? "The microphone level clipped. Move slightly away and record once more."
          : audibleRatio < 0.35
            ? "Too much of this sample is quiet. Move closer and record once more."
            : "";

      if (submitWhenClean && !qualityProblem) {
        const renamed = new File([result.file], safeRecordingName(language), {
          type: "audio/wav",
          lastModified: Date.now(),
        });
        URL.revokeObjectURL(result.url);
        setCaptureState("idle");
        onUseRecording(renamed, language);
        return;
      }
      recordingUrlRef.current = result.url;
      setRecording(result);
      setCaptureState("review");
    } catch (cause) {
      if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
      setError(cause instanceof Error ? cause.message : "The recording could not be finished.");
      setCaptureState("idle");
    } finally {
      if (attempt === captureAttemptRef.current) stoppingRef.current = false;
    }
  }, [language, onUseRecording]);

  useEffect(() => {
    if (captureState !== "recording") return;
    const timer = window.setInterval(() => {
      const next = Date.now() - startedAtRef.current;
      setElapsedMs(next);
      if (next >= MAXIMUM_MS) void finish(true);
    }, 100);
    return () => window.clearInterval(timer);
  }, [captureState, finish]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      captureAttemptRef.current++;
      const capture = captureRef.current;
      captureRef.current = null;
      if (capture) void capture.cancel().catch(() => {});
      if (recordingUrlRef.current) URL.revokeObjectURL(recordingUrlRef.current);
      recordingUrlRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!disabled) return;
    captureAttemptRef.current++;
    const capture = captureRef.current;
    captureRef.current = null;
    if (capture) void capture.cancel().catch(() => {});
    stoppingRef.current = false;
    clearRecording();
    setCaptureState("idle");
  }, [clearRecording, disabled]);

  async function start() {
    if (!mountedRef.current || disabledRef.current || captureState !== "idle") return;
    const attempt = ++captureAttemptRef.current;
    setError("");
    clearRecording();
    setCaptureState("requesting");
    setElapsedMs(0);
    setLevel(0);
    setSamplePeak(0);
    setAudibleFrames(0);
    setTotalFrames(0);
    samplePeakRef.current = 0;
    audibleFramesRef.current = 0;
    totalFramesRef.current = 0;
    try {
      const capture = await openPrivateWavCapture({
        onLevel(next, nextSamplePeak) {
          if (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current) return;
          setLevel(next);
          setSamplePeak((current) => Math.max(current, nextSamplePeak));
          setTotalFrames((current) => current + 1);
          samplePeakRef.current = Math.max(samplePeakRef.current, nextSamplePeak);
          totalFramesRef.current += 1;
          if (next >= 0.035) {
            audibleFramesRef.current += 1;
            setAudibleFrames((current) => current + 1);
          }
        },
      });
      if (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current) { await capture.cancel(); return; }
      captureRef.current = capture;
      await capture.start();
      if (!mountedRef.current || attempt !== captureAttemptRef.current || disabledRef.current) { await capture.cancel(); return; }
      startedAtRef.current = Date.now();
      setCaptureState("recording");
    } catch (cause) {
      if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
      captureRef.current = null;
      setError(cause instanceof Error ? cause.message : "The browser could not start recording.");
      setCaptureState("idle");
    }
  }

  async function retake() {
    const attempt = ++captureAttemptRef.current;
    const capture = captureRef.current;
    captureRef.current = null;
    try { await capture?.cancel(); }
    catch (cause) {
      if (mountedRef.current && attempt === captureAttemptRef.current) setError(cause instanceof Error ? cause.message : "The microphone could not be closed.");
      return;
    }
    if (!mountedRef.current || attempt !== captureAttemptRef.current) return;
    stoppingRef.current = false;
    clearRecording();
    setCaptureState("idle");
    setElapsedMs(0);
    setError("");
  }

  const audibleRatio = totalFrames ? audibleFrames / totalFrames : 0;
  const localSignal = samplePeak >= 0.995
    ? "The level may be too high. Move slightly away from the microphone and retake."
    : audibleRatio < 0.35
      ? "Much of this recording is quiet. Speak closer to the microphone and retake."
      : "The local input level looks usable. Private processing makes the final reference choice.";
  const enough = Boolean(recording && recording.durationMs >= MINIMUM_MS);
  const progress = Math.min(100, Math.round((elapsedMs / TARGET_MS) * 100));

  return (
    <section className="quick-voice-capture" aria-labelledby="quick-voice-title">
      <div className="quick-voice-heading">
        <div>
          <p className="eyebrow">Recommended</p>
          <h4 id="quick-voice-title">Record a clean voice sample</h4>
          <p>Talk naturally about anything. After 12 seconds, one tap finishes the recording and starts your clone.</p>
          <p>About 30 seconds gives us more clean speech to choose from. We keep it private.</p>
        </div>
        <span className="quick-voice-private">Local until you upload</span>
      </div>

      <div className="quick-voice-languages" role="group" aria-label="Recording language">
        {(Object.keys(ENROLLMENT_LANGUAGE_LABELS) as EnrollmentLanguage[]).map((item) => (
          <button
            key={item}
            type="button"
            className={language === item ? "active" : ""}
            disabled={disabled || captureState === "requesting" || captureState === "recording"}
            aria-pressed={language === item}
            onClick={() => setLanguage(item)}
          >
            {ENROLLMENT_LANGUAGE_LABELS[item]}
          </button>
        ))}
      </div>

      <details className="quick-voice-prompt">
        <summary>Need an idea? Show an optional prompt</summary>
        <p>You do not have to read this. Your own natural words are preferred.</p>
        <blockquote lang={RECORDING_PROMPTS[language].lang}>{RECORDING_PROMPTS[language].text}</blockquote>
      </details>

      {captureState === "idle" && (
        <div className="quick-voice-action">
          <button className="button primary-button" type="button" disabled={disabled} onClick={() => void start()}>
            Start recording
          </button>
          <p>Your browser asks for microphone access only after this click.</p>
        </div>
      )}

      {captureState === "requesting" && (
        <div className="quick-voice-wait" role="status">
          <span className="quick-voice-spinner" aria-hidden="true" />
          <div><strong>Opening your microphone</strong><p>Check the browser permission prompt.</p></div>
        </div>
      )}

      {captureState === "recording" && (
        <div className="quick-voice-live">
          <p className="visually-hidden" role="status">Recording started. Finish and build becomes available after 12 seconds.</p>
          <div className="quick-voice-live-top">
            <span className="recording-dot" aria-hidden="true" />
            <div><strong>Recording</strong><span>{timeLabel(elapsedMs)} of 1:00 maximum</span></div>
            <button
              className="button primary-button quick-voice-finish"
              type="button"
              disabled={elapsedMs < MINIMUM_MS}
              onClick={() => void finish(true)}
            >
              {elapsedMs < MINIMUM_MS
                ? `Speak ${Math.ceil((MINIMUM_MS - elapsedMs) / 1000)}s more`
                : "Finish and build"}
            </button>
          </div>
          <div className="quick-voice-meter" aria-label="Live microphone input level">
            <span style={{ transform: `scaleX(${Math.max(0.02, level)})` }} />
          </div>
          <div className="quick-voice-progress">
            <span>{elapsedMs < MINIMUM_MS ? `Keep speaking for ${Math.ceil((MINIMUM_MS - elapsedMs) / 1000)} more seconds` : elapsedMs < TARGET_MS ? "Good. Keep going for a stronger choice." : "Target reached. Stop when this sentence feels complete."}</span>
            <progress max={100} value={progress} aria-label="Recommended recording length" />
          </div>
        </div>
      )}

      {captureState === "review" && recording && (
        <div className="quick-voice-review">
          <div className="quick-voice-review-head">
            <div><strong>Let's improve this sample</strong><span>{timeLabel(recording.durationMs)} · 24 kHz private WAV</span></div>
            <span className="short">Retake needed</span>
          </div>
          <audio controls preload="metadata" src={recording.url} />
          <p>{enough ? localSignal : "Speak for at least 12 seconds. About 30 seconds gives processing more clean speech to choose from."}</p>
          <div className="quick-voice-review-actions">
            <button className="button primary-button" type="button" onClick={() => void retake()}>Record again</button>
          </div>
        </div>
      )}

      {error && <p className="inline-error" role="alert">{error}</p>}
    </section>
  );
}
