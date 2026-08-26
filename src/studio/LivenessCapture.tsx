import { useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import type { BiometricVerificationAttestations } from "./livenessApi";
import type { LivenessChallenge, ReplicaSource, SignedUpload } from "./types";

type CaptureMode = "audio" | "video";
type CaptureStage =
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
  file: File;
  url: string;
  durationMs: number;
  kind: CaptureMode;
  mime: string;
};

const VIDEO_TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];

function supportedType(mode: CaptureMode) {
  if (typeof MediaRecorder === "undefined") return "";
  return (mode === "video" ? VIDEO_TYPES : []).find((mime) => MediaRecorder.isTypeSupported(mime)) || "";
}

function remainingLabel(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

function permissionMessage(cause: unknown, mode: CaptureMode) {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") {
    return `${mode === "video" ? "Camera or microphone" : "Microphone"} access was blocked. Open this site's browser permissions, allow access, then try again.`;
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return mode === "video" ? "A working camera and microphone were not found." : "A working microphone was not found.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "The recording device is busy in another app. Close it there and try again.";
  }
  return "The browser could not open a private recording session.";
}

interface Props {
  consentActive: boolean;
  challenge: LivenessChallenge | null;
  loading: boolean;
  onIssue: (attestations: BiometricVerificationAttestations) => Promise<LivenessChallenge>;
  onStartFace: (challengeId: string) => Promise<{ challenge: LivenessChallenge; quick_link_url: string }>;
  onPollFace: (challengeId: string) => Promise<LivenessChallenge>;
  onCancel: (challengeId: string) => Promise<{
    challenge: LivenessChallenge;
    erasure: "pending" | "confirmed" | "not_required";
  }>;
  onCreateUpload: (input: {
    challengeId: string;
    kind: CaptureMode;
    mime: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ challenge: LivenessChallenge; source: ReplicaSource; upload: SignedUpload }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload }>;
  onFinalize: (challengeId: string, sourceId: string) => Promise<LivenessChallenge>;
}

export default function LivenessCapture({
  consentActive,
  challenge,
  loading,
  onIssue,
  onStartFace,
  onPollFace,
  onCancel,
  onCreateUpload,
  onRetryUpload,
  onFinalize,
}: Props) {
  const [mode] = useState<CaptureMode>("video");
  const [stage, setStage] = useState<CaptureStage>("idle");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [error, setError] = useState("");
  const [secondsRecorded, setSecondsRecorded] = useState(0);
  const [progress, setProgress] = useState(0);
  const [now, setNow] = useState(Date.now());
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [objectUploaded, setObjectUploaded] = useState(false);
  const [faceBusy, setFaceBusy] = useState(false);
  const [verificationConsent, setVerificationConsent] = useState<Record<keyof BiometricVerificationAttestations, boolean>>({
    live_face_and_voice_processing: false,
    compare_face_to_my_id: false,
    anti_spoof_and_synthetic_detection: false,
    erase_raw_and_provider_session: false,
    self_only_private_replica: false,
  });
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const previewRef = useRef<HTMLVideoElement>(null);
  const autoStopRef = useRef<number | null>(null);
  const facePopupRef = useRef<Window | null>(null);

  const videoMime = useMemo(() => supportedType("video"), []);
  const selectedMime = videoMime;
  const expiresAt = challenge ? new Date(challenge.expires_at).getTime() : 0;
  const remaining = expiresAt - now;
  const challengeState = challenge?.state;
  const challengeIssued = challenge?.state === "issued" && remaining > 0;
  const pendingVerification = challenge?.state === "uploaded" || challenge?.state === "verifying";
  const cancellableChallenge = challenge && ["issued", "uploaded", "verifying"].includes(challenge.state);
  const facePassed = challenge?.face_session_state === "passed_deleted";
  const faceFailed = challenge?.face_session_state === "failed_deleted" || challenge?.face_session_state === "expired_deleted";
  const allVerificationConsent = Object.values(verificationConsent).every(Boolean);
  const busy = ["requesting", "recording", "hashing", "authorizing", "uploading", "finalizing"].includes(stage);

  function stopTracks() {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
  }

  function clearRecording() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setProgress(0);
    setPendingSourceId(null);
    setObjectUploaded(false);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (stage !== "recording") return;
    const timer = window.setInterval(() => setSecondsRecorded(Math.floor((Date.now() - startedAtRef.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (stage !== "ready" || !previewRef.current || !streamRef.current) return;
    previewRef.current.srcObject = streamRef.current;
    void previewRef.current.play().catch(() => {});
  }, [stage]);

  useEffect(() => () => {
    stopTracks();
    facePopupRef.current?.close();
    facePopupRef.current = null;
    if (recording) URL.revokeObjectURL(recording.url);
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
  }, [recording]);

  useEffect(() => {
    if (!busy) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [busy]);

  useEffect(() => {
    if (challengeState !== "issued" || remaining > 0 || (stage !== "ready" && stage !== "recording")) return;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    else {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      if (previewRef.current) previewRef.current.srcObject = null;
      setStage("idle");
    }
    setError("This live phrase expired. Request a new randomized phrase before recording again.");
  }, [challengeState, remaining, stage]);

  async function issue() {
    if (!allVerificationConsent) {
      setError("Confirm every narrow biometric verification statement before requesting a challenge.");
      return;
    }
    setError("");
    clearRecording();
    stopTracks();
    setStage("requesting");
    try {
      await onIssue(Object.fromEntries(
        Object.keys(verificationConsent).map((key) => [key, true]),
      ) as BiometricVerificationAttestations);
      setVerificationConsent((current) => Object.fromEntries(
        Object.keys(current).map((key) => [key, false]),
      ) as Record<keyof BiometricVerificationAttestations, boolean>);
      setStage("idle");
      setNow(Date.now());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "A live phrase could not be issued");
      setStage("idle");
    }
  }

  async function cancelChallenge() {
    if (!cancellableChallenge || !challenge) return;
    setFaceBusy(true);
    setError("");
    facePopupRef.current?.close();
    facePopupRef.current = null;
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
      setError(cause instanceof Error ? cause.message : "This verification attempt could not be cancelled");
    } finally {
      setFaceBusy(false);
    }
  }

  async function startFaceSession() {
    if (!challengeIssued || !challenge) return;
    const popup = window.open("about:blank", "vyakti-official-face-check", "popup,width=520,height=760");
    if (!popup) {
      setError("The official face-check window was blocked. Allow pop-ups for this site, then try again.");
      return;
    }
    facePopupRef.current?.close();
    facePopupRef.current = popup;
    popup.opener = null;
    setFaceBusy(true);
    setError("");
    try {
      const started = await onStartFace(challenge.challenge_id);
      const link = new URL(started.quick_link_url);
      if (link.origin !== "https://liveness.face.azure.com") throw new Error("The official Azure link was invalid");
      popup.location.replace(link.toString());
    } catch (cause) {
      popup.close();
      if (facePopupRef.current === popup) facePopupRef.current = null;
      setError(cause instanceof Error ? cause.message : "The official face check could not start");
    } finally {
      setFaceBusy(false);
    }
  }

  async function pollFaceSession() {
    if (!challenge) return;
    setFaceBusy(true);
    setError("");
    try {
      await onPollFace(challenge.challenge_id);
      facePopupRef.current?.close();
      facePopupRef.current = null;
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The official face result is not available yet"); }
    finally { setFaceBusy(false); }
  }

  async function requestMedia() {
    if (!selectedMime || !navigator.mediaDevices?.getUserMedia) {
      setError(`${mode === "video" ? "Video" : "Audio"} recording is not supported in this browser.`);
      return;
    }
    setError("");
    setStage("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
        video: mode === "video" ? { facingMode: "user", width: { ideal: 720 }, height: { ideal: 720 } } : false,
      });
      streamRef.current = stream;
      setStage("ready");
    } catch (cause) {
      setError(permissionMessage(cause, mode));
      setStage("idle");
    }
  }

  function startRecording() {
    const stream = streamRef.current;
    if (!stream || !selectedMime) return;
    setError("");
    clearRecording();
    chunksRef.current = [];
    const recorder = new MediaRecorder(stream, { mimeType: selectedMime });
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data.size) chunksRef.current.push(event.data);
    };
    recorder.onerror = () => {
      recorder.onstop = null;
      stopTracks();
      setError("The browser recording stopped unexpectedly. Request device access and record again.");
      setStage("idle");
    };
    recorder.onstop = () => {
      const durationMs = Date.now() - startedAtRef.current;
      const blob = new Blob(chunksRef.current, { type: selectedMime });
      stopTracks();
      if (durationMs < 4_000 || blob.size < 1) {
        setError("That capture was too short. Read the complete phrase in one continuous recording.");
        setStage("idle");
        return;
      }
      const extension = selectedMime.includes("mp4") ? "mp4" : "webm";
      const file = new File([blob], `live-challenge.${extension}`, { type: selectedMime });
      setRecording({ file, url: URL.createObjectURL(blob), durationMs, kind: mode, mime: selectedMime });
      setStage("recorded");
    };
    startedAtRef.current = Date.now();
    setSecondsRecorded(0);
    recorder.start(250);
    setStage("recording");
    autoStopRef.current = window.setTimeout(() => stopRecording(), 60_000);
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

  async function upload() {
    if (!recording || !challengeIssued || !challenge) return;
    setError("");
    try {
      let sourceId = pendingSourceId;
      let signedUpload: SignedUpload | null = null;
      let uploaded = objectUploaded;
      if (sourceId && !uploaded) {
        setStage("authorizing");
        setProgress(0);
        const retried = await onRetryUpload(sourceId);
        signedUpload = retried.upload;
      } else if (!sourceId) {
        setStage("hashing");
        const sha256 = await sha256File(recording.file, setProgress);
        setStage("authorizing");
        setProgress(0);
        const created = await onCreateUpload({
          challengeId: challenge.challenge_id,
          kind: recording.kind,
          mime: recording.mime,
          byteSize: recording.file.size,
          sha256,
        });
        sourceId = created.source.source_id;
        setPendingSourceId(sourceId);
        signedUpload = created.upload;
      }
      if (!uploaded) {
        if (!signedUpload) throw new Error("Private upload authorization is missing");
        setStage("uploading");
        await putSignedUpload(recording.file, signedUpload, setProgress);
        uploaded = true;
        setObjectUploaded(true);
      }
      setStage("finalizing");
      await onFinalize(challenge.challenge_id, sourceId);
      setPendingSourceId(null);
      setObjectUploaded(false);
      setStage("idle");
      clearRecording();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Live evidence could not be secured");
      setStage("recorded");
    }
  }

  return (
    <section id="liveness-capture" className="liveness-section" aria-labelledby="liveness-title">
      <div className="liveness-index">04</div>
      <div className="liveness-body">
        <div className="panel-title-row">
          <div>
            <p className="eyebrow">Live capture</p>
            <h3 id="liveness-title">Prove this recording was made now</h3>
          </div>
          <span className={`permission-badge ${pendingVerification ? "permission-pending" : ""}`}>
            <i />{pendingVerification ? "Verification pending" : "Biometric gate locked"}
          </span>
        </div>

        {!consentActive ? (
          <div className="evidence-gate">
            <span className="large-lock" aria-hidden="true" />
            <div><strong>Source permission and adult ID evidence are required first</strong><p>Record capture and private storage permission, then complete the independent ID evidence step above.</p></div>
          </div>
        ) : loading ? (
          <div className="liveness-wait" role="status"><span className="spinner" />Loading live challenge status</div>
        ) : pendingVerification ? (
          <div className="verification-pending" role="status">
            <span className="verification-orbit"><i /><i /><i /></span>
            <div>
              <p className="eyebrow">Evidence secured</p>
              <h4>Waiting for an independent verifier</h4>
              <p>
                The challenge recording is isolated in private quarantine. It has not granted biometric, training, inference,
                or generation permission. The gate stays locked until the independent composite verifier settles every check.
              </p>
              <button className="text-button" type="button" disabled={faceBusy} onClick={() => void cancelChallenge()}>
                Withdraw verification and erase evidence
              </button>
            </div>
          </div>
        ) : challenge?.state === "passed" ? (
          <div className="verification-pending verification-passed" role="status">
            <span className="verification-check">✓</span>
            <div><p className="eyebrow">Verifier result</p><h4>Live challenge passed</h4><p>Biometric comparison permission is bound to this evidence. Training and inference permission remain separate.</p></div>
          </div>
        ) : !challengeIssued ? (
          <div className="challenge-empty">
            <div>
              <p>
                Request a one-time phrase, then complete both checks inside the ten-minute challenge window. The Azure
                camera link expires sooner. Each phrase combines Hindi, English, an unpredictable code, and a narrow
                biometric-consent statement to resist replay.
              </p>
              {challenge?.state === "failed" && <p className="challenge-failure">Previous attempt failed: {challenge.failure_code.replaceAll("_", " ") || "verification did not pass"}</p>}
              {challenge?.state === "expired" && <p className="challenge-failure">The previous phrase expired without a completed upload.</p>}
              <fieldset className="biometric-consent-list">
                <legend>Before any biometric processing</legend>
                {([
                  ["live_face_and_voice_processing", "Process my live face and voice only to verify this private self-replica."],
                  ["compare_face_to_my_id", "Compare my live face with the government ID I submitted."],
                  ["anti_spoof_and_synthetic_detection", "Run replay, synthetic-media, and single-speaker checks on this attempt."],
                  ["erase_raw_and_provider_session", "Erase raw verification media and the provider session after the decision."],
                  ["self_only_private_replica", "This is me, I am an adult, and this replica will remain private and disclosed as synthetic."],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    <input
                      type="checkbox"
                      checked={verificationConsent[key]}
                      onChange={(event) => setVerificationConsent((current) => ({ ...current, [key]: event.target.checked }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
            </div>
            <button className="button primary-button" type="button" disabled={stage === "requesting" || !allVerificationConsent} onClick={() => void issue()}>
              {stage === "requesting" ? "Issuing phrase" : "Request live phrase"}
            </button>
          </div>
        ) : (
          <>
            <div className="challenge-card">
              <div className="challenge-meta">
                <span>Attempt {challenge.attempt} of 10 today</span>
                <time className={remaining < 60_000 ? "urgent" : ""} dateTime={challenge.expires_at}>{remainingLabel(remaining)} remaining</time>
              </div>
              <blockquote>{challenge.phrase}</blockquote>
              <p>Read every word exactly as shown, naturally and without playback in the room.</p>
              <button className="text-button" type="button" disabled={busy} onClick={() => void cancelChallenge()}>
                Cancel and erase this attempt
              </button>
            </div>

            {!facePassed ? (
              <div className={`official-face-gate ${faceFailed ? "official-face-failed" : ""}`}>
                <div className="official-face-mark" aria-hidden="true">ID</div>
                <div>
                  <p className="eyebrow">Official live-face check</p>
                  <h4>{faceFailed ? "This face session did not pass" : "Match your live face to your ID"}</h4>
                  <p>
                    Azure hosts a single-use camera check. Vyakti receives only the bounded live/not-live and same-person
                    decision. The one-time link is never durably stored; a short volatile retry cache expires with the
                    authorization. An encrypted recovery credential exists only until confirmed provider deletion, which
                    must complete before capture unlocks.
                  </p>
                  {challenge.face_session_state === "not_started" ? (
                    <button className="button primary-button" type="button" disabled={faceBusy} onClick={() => void startFaceSession()}>
                      {faceBusy ? "Creating protected session" : "Open official face check"}
                    </button>
                  ) : faceFailed ? (
                    <p className="challenge-failure">Request a new randomized challenge to try again. This provider session has been deleted.</p>
                  ) : (
                    <button className="button secondary-button" type="button" disabled={faceBusy} onClick={() => void pollFaceSession()}>
                      {faceBusy ? "Checking and deleting session" : "I finished — check result"}
                    </button>
                  )}
                  <small>Pop-ups must be allowed for the Azure-hosted check. Do not share its one-time link.</small>
                </div>
              </div>
            ) : (
              <>
            <div className="capture-privacy">
              <span className="fingerprint-icon" aria-hidden="true">○</span>
              <p><strong>Nothing uploads when permission opens.</strong> Capture stays only in this browser until you review it and choose Upload. Device tracks close after recording.</p>
            </div>

            {stage === "idle" && !recording && (
              <div className="capture-setup">
                <fieldset className="capture-mode">
                  <legend>Required capture</legend>
                  <label className={!videoMime ? "unsupported" : ""}>
                    <input type="radio" name="capture-mode" checked readOnly disabled={!videoMime} />
                    <span><strong>Voice + live face</strong><small>{videoMime ? "Camera and microphone required" : "Not supported"}</small></span>
                  </label>
                </fieldset>
                <button className="button primary-button permission-button" type="button" disabled={!selectedMime} onClick={() => void requestMedia()}>
                  Allow {mode === "video" ? "camera and microphone" : "microphone"}
                </button>
                <p className="permission-note">Your browser will show its own permission prompt. Vyakti cannot bypass a denial.</p>
              </div>
            )}

            {stage === "requesting" && <div className="liveness-wait" role="status"><span className="spinner" />Waiting for browser permission</div>}

            {stage === "ready" && (
              <div className={`capture-live capture-${mode}`}>
                {mode === "video" ? <video ref={previewRef} muted playsInline aria-label="Private camera preview" /> : <div className="audio-ready"><span className="mic-symbol">●</span><div><strong>Microphone ready</strong><small>Recording has not started</small></div></div>}
                <button className="record-button" type="button" onClick={startRecording}><i />Start recording</button>
              </div>
            )}

            {stage === "recording" && (
              <div className="recording-live" role="status">
                <div className="recording-pulse"><i /></div>
                <div><strong>Recording</strong><span>{remainingLabel(secondsRecorded * 1000)} · 1:00 maximum</span></div>
                <button className="button stop-recording" type="button" onClick={stopRecording}>Stop and review</button>
              </div>
            )}

            {recording && stage !== "recording" && (
              <div className="recording-review">
                {recording.kind === "video"
                  ? <video src={recording.url} controls playsInline aria-label="Review live challenge recording" />
                  : <audio src={recording.url} controls aria-label="Review live challenge recording" />}
                <div className="recording-review-meta">
                  <div><strong>Private local capture</strong><span>{Math.round(recording.durationMs / 1000)} seconds · not uploaded yet</span></div>
                  <button className="text-button" type="button" disabled={busy || Boolean(pendingSourceId)} onClick={retake}>Record again</button>
                </div>
                {busy && (
                  <div className="upload-status" role="status">
                    <div><strong>{stage === "hashing" ? "Computing fingerprint" : stage === "authorizing" ? "Authorizing private upload" : stage === "uploading" ? "Uploading live evidence" : "Verifying stored evidence"}</strong><span>{stage === "hashing" || stage === "uploading" ? `${progress}%` : "Please keep this page open"}</span></div>
                    <div className={`upload-track ${stage === "authorizing" || stage === "finalizing" ? "indeterminate" : ""}`}><span style={{ transform: `scaleX(${progress / 100})` }} /></div>
                  </div>
                )}
                <button className="button primary-button liveness-upload" type="button" disabled={busy || remaining <= 0} onClick={() => void upload()}>
                  {busy ? "Securing evidence" : pendingSourceId ? "Retry private upload" : "Upload for verification"}
                </button>
              </div>
            )}
              </>
            )}
          </>
        )}
        {error && <p className="inline-error liveness-error" role="alert">{error}</p>}
        <p className="liveness-boundary">Live evidence is not a verifier result. Only the independent server verifier can mark this challenge as passed.</p>
      </div>
    </section>
  );
}
