import { useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import { micPermissionMessage, openStreamWavTap, type StreamWavTap } from "./wavCapture";
import type { ReplicaSource, SignedUpload, VoiceIdentityChallenge as Challenge } from "./types";

// WS-R2. The band that replaces the Azure IdentityProofing + LivenessCapture
// cards when VOICE_IDENTITY_CHALLENGE is on.
//
// ── one microphone, two artifacts ─────────────────────────────────────────
// ONE getUserMedia stream feeds both a MediaRecorder (the camera clip that
// services/voice-evidence embeds) and a WAV tap (what Sarvam transcribes).
// Opening the microphone twice would be two capture sessions of the same
// person on two clocks, and the transcript would then be of a slightly
// different recording than the one that was scored.
//
// The tap itself is `openStreamWavTap`, and it lives in wavCapture.ts rather
// than here. Two reasons, both load-bearing. Its encoder and resampler are
// already there, and that file's own header says why they must stay one
// copy: "Re-implementing these two there would be two encoders that can
// drift, and a resampler that drifts produces audio the fidelity meter scores
// lower for reasons nobody can find." And `evals/sound.mjs` enumerates every
// file permitted to construct an AudioContext, because "an AudioContext built
// anywhere else is a second sound layer with no gate on it" — an enumeration
// that is only worth anything if new audio graphs move to the owner files
// instead of the allowlist growing to meet them. This panel therefore holds
// no audio graph at all.
//
// ── honest states ─────────────────────────────────────────────────────────
// AGENTS.md: blockers split into "waiting on you" and "waiting on us", and a
// platform failure is never dressed up as the person's fault. Every state
// below says which side is holding the work, and every refusal says what to
// do next.

type Stage =
  | "idle"
  | "requesting"
  | "ready"
  | "recording"
  | "recorded"
  | "hashing"
  | "authorizing"
  | "uploading"
  | "finalizing";

type Recording = {
  video: File;
  wav: File;
  url: string;
  durationMs: number;
  mime: string;
};

const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
const TARGET_MS = 10_000;
const MIN_MS = 4_000;
const MAX_MS = 30_000;

function supportedVideoType() {
  if (typeof MediaRecorder === "undefined") return "";
  return VIDEO_TYPES.find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function clock(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** What a failure code means to the person who caused it, and what they can do
 *  about it. A raw code on screen is a dead end; this is the only place that
 *  turns one into an instruction. */
const REASON: Record<string, { title: string; note: string }> = {
  spoken_code_missing: {
    title: "The spoken code did not come through",
    note: "Say the six digits one at a time, clearly, at the end of the sentence. Get a new sentence and try again.",
  },
  sentence_not_read: {
    title: "The sentence did not come through",
    note: "Read every word exactly as shown, at your normal speaking pace, somewhere quiet. Get a new sentence and try again.",
  },
  voice_did_not_match: {
    title: "This did not sound like your enrolled voice",
    note: "Use the same microphone and room you enrolled with if you can, and keep background noise down. Get a new sentence and try again.",
  },
  reference_evidence_insufficient: {
    title: "There is not enough enrolled voice to compare against",
    note: "This one is on us. Add more of your own audio in the first step, let it finish processing, then come back.",
  },
  challenge_expired: {
    title: "That sentence expired",
    note: "Sentences are good for three minutes. Get a new one and record straight away.",
  },
  challenge_evidence_deleted: {
    title: "That recording was deleted before it was checked",
    note: "Get a new sentence and record again.",
  },
  owner_cancelled: {
    title: "You cancelled that attempt",
    note: "Get a new sentence whenever you are ready.",
  },
  challenge_superseded: {
    title: "That sentence was replaced by a newer one",
    note: "Read the sentence shown above.",
  },
};

function reasonFor(code: string) {
  return REASON[code] || {
    title: "That attempt did not pass",
    note: "Get a new sentence and record again in a quiet room.",
  };
}

interface Props {
  consentActive: boolean;
  challenge: Challenge | null;
  loading: boolean;
  onIssue: () => Promise<Challenge>;
  onCancel: (challengeId: string) => Promise<Challenge>;
  onCreateUpload: (input: {
    challengeId: string;
    role: "capture" | "transcript";
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ challenge: Challenge; source: ReplicaSource; upload: SignedUpload }>;
  onFinalize: (challengeId: string, sourceId: string) => Promise<Challenge>;
  onRefresh: () => void;
}

export default function VoiceIdentityChallengeBand({
  consentActive,
  challenge,
  loading,
  onIssue,
  onCancel,
  onCreateUpload,
  onFinalize,
  onRefresh,
}: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const [secondsRecorded, setSecondsRecorded] = useState(0);
  const [progress, setProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [busyLabel, setBusyLabel] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const tapRef = useRef<StreamWavTap | null>(null);
  const startedAtRef = useRef(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const autoStopRef = useRef<number | null>(null);

  const videoMime = useMemo(() => supportedVideoType(), []);
  const expiresAt = challenge ? new Date(challenge.expires_at).getTime() : 0;
  const remaining = expiresAt - now;
  const issued = challenge?.state === "issued" && remaining > 0;
  const pending = challenge?.state === "captured" || challenge?.state === "verifying";
  const verified = challenge?.state === "verified";
  const settledFail = challenge?.state === "failed" || challenge?.state === "expired";
  const busy = ["requesting", "recording", "hashing", "authorizing", "uploading", "finalizing"].includes(stage);

  function stopTracks() {
    const tap = tapRef.current;
    tapRef.current = null;
    // Discard whatever it holds: this path is teardown, not a completed
    // recording, and the only caller that wants the bytes takes them from the
    // recorder's own onstop below.
    if (tap) void tap.stop();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  function clearRecording() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setProgress(0);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (stage !== "recording") return;
    const timer = window.setInterval(
      () => setSecondsRecorded(Math.floor((Date.now() - startedAtRef.current) / 1000)),
      250,
    );
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== "ready" || !previewRef.current || !streamRef.current) return;
    previewRef.current.srcObject = streamRef.current;
    void previewRef.current.play().catch(() => {});
  }, [stage]);

  // While the server is deciding, poll. The decision is made by a scheduled
  // sweep rather than by this request, so there is nothing to await inline.
  useEffect(() => {
    if (!pending) return;
    const timer = window.setInterval(onRefresh, 10_000);
    return () => window.clearInterval(timer);
  }, [pending, onRefresh]);

  useEffect(() => () => {
    stopTracks();
    if (recording) URL.revokeObjectURL(recording.url);
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
  }, [recording]);

  useEffect(() => {
    if (!busy) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  // An expired sentence stops the recorder rather than letting somebody finish
  // reading something the server will refuse.
  useEffect(() => {
    if (challenge?.state !== "issued" || remaining > 0) return;
    if (stage !== "ready" && stage !== "recording") return;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      stopTracks();
      setStage("idle");
    }
    setError("That sentence expired. Get a new one before recording again.");
  }, [challenge?.state, remaining, stage]);

  async function issue() {
    setError("");
    clearRecording();
    stopTracks();
    setStage("requesting");
    try {
      await onIssue();
      setStage("idle");
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A sentence could not be issued");
      setStage("idle");
    }
  }

  async function cancel() {
    if (!challenge) return;
    setError("");
    stopTracks();
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
      chunksRef.current = [];
    }
    try {
      await onCancel(challenge.challenge_id);
      clearRecording();
      setStage("idle");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "This attempt could not be cancelled");
    }
  }

  async function requestMedia() {
    if (!videoMime || !navigator.mediaDevices?.getUserMedia || typeof AudioContext === "undefined") {
      setError("This browser cannot record camera and microphone together. Try Chrome, Edge, or Safari.");
      return;
    }
    setError("");
    setStage("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } },
      });
      streamRef.current = stream;
      setStage("ready");
    } catch (cause) {
      setError(micPermissionMessage(cause));
      setStage("idle");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || !videoMime) return;
    setError("");
    clearRecording();
    chunksRef.current = [];
    // Same stream, same samples, so the transcript and the speaker score are
    // about one recording rather than two.
    const tap = openStreamWavTap(stream);
    tapRef.current = tap;
    const recorder = new MediaRecorder(stream, { mimeType: videoMime });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recorder.onstop = null;
      stopTracks();
      setError("The browser recording stopped unexpectedly. Allow camera access and record again.");
      setStage("idle");
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: videoMime });
      tapRef.current = null;
      void (async () => {
        let wav: File | null = null;
        try {
          wav = await tap.stop();
        } catch {
          // A tap that could not close cleanly has no bytes to give; the
          // refusal below says so rather than sending half a recording.
          wav = null;
        }
        streamRef.current?.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
        if (previewRef.current) previewRef.current.srcObject = null;
        if (durationMs < MIN_MS || blob.size < 1 || !wav) {
          setError("That was too short to check. Read the whole sentence in one go, about ten seconds.");
          setStage("idle");
          return;
        }
        const extension = videoMime.includes("mp4") ? "mp4" : "webm";
        setRecording({
          video: new File([blob], `identity-challenge.${extension}`, { type: videoMime }),
          wav,
          url: URL.createObjectURL(blob),
          durationMs,
          mime: videoMime,
        });
        setStage("recorded");
      })();
    };
    startedAtRef.current = Date.now();
    setSecondsRecorded(0);
    recorder.start(250);
    setStage("recording");
    autoStopRef.current = window.setTimeout(() => stopRecording(), MAX_MS);
  }

  function stopRecording() {
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function retake() {
    clearRecording();
    stopTracks();
    setError("");
    setStage("idle");
  }

  /** One artifact: hash, authorize, upload, finalize. Called twice. The
   *  challenge only becomes `captured` once the server has both. */
  async function sendOne(challengeId: string, role: "capture" | "transcript", file: File, kind: "audio" | "video") {
    setStage("hashing");
    setProgress(0);
    const sha256 = await sha256File(file, setProgress);
    setStage("authorizing");
    setProgress(0);
    const created = await onCreateUpload({
      challengeId, role, kind, mime: file.type, byteSize: file.size, sha256,
    });
    setStage("uploading");
    await putSignedUpload(file, created.upload, setProgress);
    setStage("finalizing");
    await onFinalize(challengeId, created.source.source_id);
  }

  async function upload() {
    if (!recording || !issued || !challenge) return;
    setError("");
    try {
      setBusyLabel("Securing the recording");
      await sendOne(challenge.challenge_id, "capture", recording.video, "video");
      setBusyLabel("Securing the audio");
      await sendOne(challenge.challenge_id, "transcript", recording.wav, "audio");
      setBusyLabel("");
      setStage("idle");
      clearRecording();
      onRefresh();
    } catch (cause) {
      setBusyLabel("");
      setError(cause instanceof Error ? cause.message : "The recording could not be secured");
      setStage("recorded");
    }
  }

  const failure = challenge ? reasonFor(challenge.failure_code) : null;

  return (
    <section id="voice-identity-challenge" className="liveness-section" aria-labelledby="voice-identity-title">
      <div className="liveness-body">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Prove it is you</p>
            <h3 id="voice-identity-title">Read this sentence out loud, on camera</h3>
          </div>
          <span className={`permission-badge ${pending ? "permission-pending" : ""}`}>
            <i />{verified ? "Verified" : pending ? "Checking" : "Not verified yet"}
          </span>
        </div>

        {!consentActive ? (
          <div className="evidence-gate">
            <span className="large-lock" aria-hidden="true" />
            <div>
              <strong>Recording and storage permission are needed first</strong>
              <p>Give permission to record and to store your own material, then come back to this check.</p>
            </div>
          </div>
        ) : loading ? (
          <div className="liveness-wait" role="status"><span className="spinner" />Loading this check</div>
        ) : verified ? (
          <div className="verification-pending verification-passed" role="status">
            <span className="verification-check">✓</span>
            <div>
              <p className="eyebrow">Result</p>
              <h4>Your voice matched your enrolment</h4>
              <p>
                The recording was compared with the voice already on this account and then deleted. This check
                covers identity and the live anti-replay check. Age is verified separately.
              </p>
            </div>
          </div>
        ) : pending ? (
          <div className="verification-pending" role="status">
            <span className="verification-orbit"><i /><i /><i /></span>
            <div>
              <p className="eyebrow">Waiting on us</p>
              <h4>Checking your recording</h4>
              <p>
                Your recording is in private storage and has granted nothing. We compare it with the voice
                already on this account and check that you read today's sentence. This usually takes a few
                minutes, and it can take longer if our voice service is starting up. You can leave this page open.
              </p>
              <button className="text-button" type="button" onClick={() => void cancel()}>
                Cancel this attempt and delete the recording
              </button>
            </div>
          </div>
        ) : !issued ? (
          <div className="challenge-empty">
            <div>
              <p>
                We give you a sentence, you read it out loud on camera, and we check two things: that the voice
                is the one already enrolled on this account, and that you read today's sentence rather than
                playing an old recording. It takes about ten seconds. The recording is deleted once the check
                has run, whatever the answer.
              </p>
              {settledFail && failure && (
                <div className="challenge-failure">
                  <strong>{failure.title}</strong>
                  <p>{failure.note}</p>
                  {challenge?.decision === "review" && (
                    <p>
                      This one was close rather than clearly wrong, so a person will look at it. Recording again
                      in a quieter room is usually faster.
                    </p>
                  )}
                </div>
              )}
            </div>
            <button
              className="button primary-button"
              type="button"
              disabled={stage === "requesting"}
              onClick={() => void issue()}
            >
              {stage === "requesting" ? "Getting a sentence" : "Get my sentence"}
            </button>
          </div>
        ) : (
          <>
            <div className="challenge-card">
              <div className="challenge-meta">
                <span>Attempt {challenge.attempt} of 10 today</span>
                <time className={remaining < 60_000 ? "urgent" : ""} dateTime={challenge.expires_at}>
                  {clock(remaining)} left
                </time>
              </div>
              <blockquote>{challenge.sentence}</blockquote>
              <p>Read every word as it is written, including the six digits, one at a time. About ten seconds.</p>
              <button className="text-button" type="button" disabled={busy} onClick={() => void cancel()}>
                Cancel and delete this attempt
              </button>
            </div>

            <div className="capture-privacy">
              <span className="fingerprint-icon" aria-hidden="true">○</span>
              <p>
                <strong>Nothing uploads when the camera opens.</strong> The recording stays in this browser until
                you review it and choose to send it. The camera and microphone close as soon as you stop.
              </p>
            </div>

            {stage === "idle" && !recording && (
              <div className="capture-setup">
                <button
                  className="button primary-button permission-button"
                  type="button"
                  disabled={!videoMime}
                  onClick={() => void requestMedia()}
                >
                  Allow camera and microphone
                </button>
                <p className="permission-note">
                  Your browser will ask you itself. We cannot get around a refusal, and you can stop at any point.
                </p>
              </div>
            )}

            {stage === "requesting" && (
              <div className="liveness-wait" role="status"><span className="spinner" />Waiting for browser permission</div>
            )}

            {stage === "ready" && (
              <div className="capture-live capture-video">
                <video ref={previewRef} muted playsInline aria-label="Private camera preview" />
                <button className="record-button" type="button" onClick={startRecording}><i />Start recording</button>
              </div>
            )}

            {stage === "recording" && (
              <div className="recording-live" role="status">
                <div className="recording-pulse"><i /></div>
                <div>
                  <strong>Recording</strong>
                  <span>{clock(secondsRecorded * 1000)} of about {Math.round(TARGET_MS / 1000)} seconds</span>
                </div>
                <button className="button stop-recording" type="button" onClick={stopRecording}>Stop and review</button>
              </div>
            )}

            {recording && stage !== "recording" && (
              <div className="recording-review">
                <video src={recording.url} controls playsInline aria-label="Review your recording" />
                <div className="recording-review-meta">
                  <div>
                    <strong>Still only on this device</strong>
                    <span>{Math.round(recording.durationMs / 1000)} seconds, not sent yet</span>
                  </div>
                  <button className="text-button" type="button" disabled={busy} onClick={retake}>Record again</button>
                </div>
                {busy && (
                  <div className="upload-status" role="status">
                    <div>
                      <strong>
                        {stage === "hashing" ? "Fingerprinting the file"
                          : stage === "authorizing" ? "Getting private upload permission"
                            : stage === "uploading" ? busyLabel || "Sending"
                              : "Confirming what arrived"}
                      </strong>
                      <span>{stage === "hashing" || stage === "uploading" ? `${progress}%` : "Keep this page open"}</span>
                    </div>
                    <div className={`upload-track ${stage === "authorizing" || stage === "finalizing" ? "indeterminate" : ""}`}>
                      <span style={{ transform: `scaleX(${progress / 100})` }} />
                    </div>
                  </div>
                )}
                <button
                  className="button primary-button liveness-upload"
                  type="button"
                  disabled={busy || remaining <= 0}
                  onClick={() => void upload()}
                >
                  {busy ? "Sending" : "Send this for checking"}
                </button>
              </div>
            )}
          </>
        )}
        {error && <p className="inline-error liveness-error" role="alert">{error}</p>}
        <p className="liveness-boundary">
          A recording is not a result. Only the server check can mark this as verified, and it decides on your
          voice and on the words you read, never on your face.
        </p>
      </div>
    </section>
  );
}
