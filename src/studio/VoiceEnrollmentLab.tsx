import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import {
  createProviderConsentUpload,
  createVoiceProfile,
  deleteVoiceProfile,
  finalizeProviderConsentUpload,
  issueProviderConsent,
  providerConsentStatus,
  retryProviderConsentUpload,
  voiceProfileStatus,
} from "./providerConsentApi";
import { ReplicaApiError } from "./replicaApi";
import type { ConsentReceipt, ProviderConsent, Replica, VoiceProfile } from "./types";
import { openPrivateWavCapture, type PrivateWavCapture } from "./wavCapture";

type Stage = "idle" | "permission" | "recording" | "hashing" | "authorizing" | "uploading" | "finalizing" | "creating" | "deleting";
type Recording = { file: File; url: string; durationMs: number };

function activeScopes(consents: ConsentReceipt[]) {
  const now = Date.now();
  return new Set(consents.filter((receipt) =>
    !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > now)
  ).map((receipt) => receipt.scope));
}

function words(value: string) {
  return value.replaceAll("_", " ");
}

function statusCopy(profile: VoiceProfile | null) {
  if (!profile) return "No provider voice has been created.";
  if (profile.status === "ready") return `Ready from approved VoiceGenome v${profile.genome_version}.`;
  if (profile.status === "creating") return "Azure is validating and creating the private voice profile.";
  if (profile.status === "deleting") return "Disabled now. Provider erasure is pending.";
  return "Provider creation failed. Review the gate before retrying.";
}

export default function VoiceEnrollmentLab({
  token,
  replica,
  consents,
  onAuthError,
}: {
  token: string;
  replica: Replica;
  consents: ConsentReceipt[];
  onAuthError: (cause: unknown) => void;
}) {
  const [providerConsent, setProviderConsent] = useState<ProviderConsent | null>(null);
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [fullName, setFullName] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [recording, setRecording] = useState<Recording | null>(null);
  const [seconds, setSeconds] = useState(0);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [pendingSourceId, setPendingSourceId] = useState<string | null>(null);
  const [objectUploaded, setObjectUploaded] = useState(false);
  const [deleteText, setDeleteText] = useState("");
  const [clock, setClock] = useState(Date.now());
  const captureRef = useRef<PrivateWavCapture | null>(null);
  const startedRef = useRef(0);
  const autoStopRef = useRef<number | null>(null);
  const expiresAt = providerConsent ? new Date(providerConsent.expires_at).getTime() : 0;
  const challengeLive = providerConsent?.state === "issued" && expiresAt > clock;
  const busy = stage !== "idle";
  const scopes = useMemo(() => activeScopes(consents), [consents]);
  const blockers = [
    !replica.age_verified && "Adult age verification",
    !replica.identity_verified && "Identity verification",
    !replica.liveness_verified && "Live-person verification",
    !scopes.has("capture") && "Capture consent",
    !scopes.has("storage") && "Private storage consent",
    !scopes.has("biometric") && "Biometric modeling consent",
    !scopes.has("training") && "Voice training consent",
  ].filter(Boolean) as string[];

  const report = useCallback((cause: unknown, fallback: string) => {
    if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    setError(cause instanceof Error ? cause.message : fallback);
  }, [onAuthError]);

  function clearRecording() {
    if (recording) URL.revokeObjectURL(recording.url);
    setRecording(null);
    setProgress(0);
    setPendingSourceId(null);
    setObjectUploaded(false);
  }

  useEffect(() => {
    let live = true;
    setLoading(true);
    Promise.allSettled([providerConsentStatus(token, replica.replica_id), voiceProfileStatus(token, replica.replica_id)])
      .then(([consentResult, profileResult]) => {
        if (!live) return;
        if (consentResult.status === "fulfilled") setProviderConsent(consentResult.value);
        if (profileResult.status === "fulfilled") setProfile(profileResult.value);
        const failed = [consentResult, profileResult].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") report(failed.reason, "Voice enrollment status is unavailable");
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [replica.replica_id, report, token]);

  useEffect(() => {
    if (stage !== "recording") return;
    const timer = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedRef.current) / 1000)), 250);
    return () => window.clearInterval(timer);
  }, [stage]);

  useEffect(() => {
    if (providerConsent?.state !== "issued") return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [providerConsent?.state]);

  useEffect(() => () => {
    void captureRef.current?.cancel();
    if (recording) URL.revokeObjectURL(recording.url);
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
  }, [recording]);

  async function issue() {
    setError("");
    clearRecording();
    setStage("authorizing");
    try {
      const issued = await issueProviderConsent(token, replica.replica_id, fullName);
      setProviderConsent(issued);
      setFullName("");
      setClock(Date.now());
    } catch (cause) { report(cause, "Provider consent could not be issued"); }
    finally { setStage("idle"); }
  }

  async function startRecording() {
    setError("");
    clearRecording();
    setStage("permission");
    try {
      const capture = await openPrivateWavCapture();
      captureRef.current = capture;
      capture.start();
      startedRef.current = Date.now();
      setSeconds(0);
      setStage("recording");
      autoStopRef.current = window.setTimeout(() => void stopRecording(), 45_000);
    } catch (cause) {
      captureRef.current = null;
      report(cause, "The microphone could not be opened");
      setStage("idle");
    }
  }

  async function stopRecording() {
    if (autoStopRef.current) window.clearTimeout(autoStopRef.current);
    autoStopRef.current = null;
    const capture = captureRef.current;
    captureRef.current = null;
    if (!capture) return;
    try {
      const next = await capture.stop();
      if (next.durationMs < 5_000 || next.durationMs > 90_000) {
        URL.revokeObjectURL(next.url);
        throw new Error("Read the complete statement in one recording lasting at least five seconds.");
      }
      setRecording(next);
    } catch (cause) { report(cause, "The WAV recording could not be finalized"); }
    finally { setStage("idle"); }
  }

  async function upload() {
    if (!recording || !providerConsent || !challengeLive) return;
    setError("");
    try {
      let sourceId = pendingSourceId;
      let uploadCapability = null;
      let uploaded = objectUploaded;
      if (sourceId && !uploaded) {
        setStage("authorizing");
        uploadCapability = (await retryProviderConsentUpload(
          token, replica.replica_id, providerConsent.provider_consent_id, sourceId,
        )).upload;
      } else if (!sourceId) {
        setStage("hashing");
        const sha256 = await sha256File(recording.file, setProgress);
        setStage("authorizing");
        setProgress(0);
        const created = await createProviderConsentUpload(token, {
          replicaId: replica.replica_id,
          providerConsentId: providerConsent.provider_consent_id,
          mime: "audio/wav",
          byteSize: recording.file.size,
          durationMs: recording.durationMs,
          sha256,
        });
        sourceId = created.source.source_id;
        setProviderConsent(created.provider_consent);
        setPendingSourceId(sourceId);
        uploadCapability = created.upload;
      }
      if (!uploaded) {
        if (!uploadCapability) throw new Error("Private upload authorization is missing.");
        setStage("uploading");
        await putSignedUpload(recording.file, uploadCapability, setProgress);
        uploaded = true;
        setObjectUploaded(true);
      }
      setStage("finalizing");
      const result = await finalizeProviderConsentUpload(
        token, replica.replica_id, providerConsent.provider_consent_id, sourceId!,
      );
      setProviderConsent(result.provider_consent);
      setPendingSourceId(null);
      setObjectUploaded(false);
      clearRecording();
    } catch (cause) { report(cause, "Provider consent could not be secured"); }
    finally { setStage("idle"); }
  }

  async function createProfile() {
    setError("");
    setStage("creating");
    try { setProfile(await createVoiceProfile(token, replica.replica_id)); }
    catch (cause) { report(cause, "The provider voice could not be created"); }
    finally { setStage("idle"); }
  }

  async function eraseProfile() {
    if (!profile || deleteText !== "DELETE VOICE") return;
    setError("");
    setStage("deleting");
    try {
      const result = await deleteVoiceProfile(token, replica.replica_id, profile.voice_profile_id);
      setProfile(result.erasure === "complete" ? null : { ...profile, status: "deleting" });
      setProviderConsent((current) => current ? { ...current, state: "revoked" } : current);
      setDeleteText("");
    } catch (cause) { report(cause, "The provider voice could not be erased"); }
    finally { setStage("idle"); }
  }

  return (
    <section className="voice-enrollment-section" aria-labelledby="voice-enrollment-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Provider voice · Gate 07</p>
          <h2 id="voice-enrollment-title">Create a voice only Microsoft can verify</h2>
        </div>
        <span className={`voice-provider-state ${profile?.status === "ready" ? "ready" : ""}`}>
          {loading ? "Checking" : profile?.status ?? "Not created"}
        </span>
      </div>
      <p className="voice-enrollment-intro">
        Your platform permissions are not provider consent. Microsoft requires a separate spoken legal statement,
        then Vyakti binds it to one reviewed VoiceGenome and one private, metered profile.
      </p>

      {blockers.length > 0 && (
        <div className="voice-gate-blockers" role="status">
          <strong>Enrollment remains locked</strong>
          <p>Complete these independent gates first:</p>
          <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      )}

      <div className="voice-enrollment-grid">
        <article className="voice-enrollment-card">
          <span className="voice-step">01 · Provider statement</span>
          <h3>Record exact consent</h3>
          {!challengeLive && providerConsent?.state !== "uploaded" && providerConsent?.state !== "accepted" && (
            <>
              <label className="field-label" htmlFor="provider-full-name">Legal first and last name</label>
              <input id="provider-full-name" className="field" autoComplete="name" value={fullName}
                onChange={(event) => setFullName(event.target.value)} placeholder="First and last name" />
              <button className="button primary-button" type="button"
                disabled={busy || blockers.length > 0 || fullName.trim().split(/\s+/).length < 2}
                onClick={() => void issue()}>Issue Microsoft statement</button>
            </>
          )}
          {challengeLive && providerConsent?.statement && (
            <div className="provider-statement">
              <span>Read every word exactly</span>
              <blockquote>{providerConsent.statement}</blockquote>
              <small>Expires {new Date(providerConsent.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</small>
            </div>
          )}
          {stage === "recording" ? (
            <button className="button destructive-button" type="button" onClick={() => void stopRecording()}>
              Stop recording · {seconds}s
            </button>
          ) : challengeLive && !recording ? (
            <button className="button secondary-button" type="button" disabled={busy} onClick={() => void startRecording()}>
              Record private WAV
            </button>
          ) : null}
          {recording && (
            <div className="provider-recording-review">
              <audio controls src={recording.url}>Your browser cannot preview this recording.</audio>
              <span>{(recording.durationMs / 1000).toFixed(1)} seconds · 24 kHz PCM WAV</span>
              <div className="voice-row-actions">
                <button className="button secondary-button" disabled={busy} onClick={clearRecording}>Retake</button>
                <button className="button primary-button" disabled={busy || !challengeLive} onClick={() => void upload()}>
                  {stage === "idle" ? "Secure statement" : `${words(stage)}${progress ? ` ${progress}%` : ""}`}
                </button>
              </div>
            </div>
          )}
          {(providerConsent?.state === "uploaded" || providerConsent?.state === "accepted") && (
            <>
              <div className="voice-success"><span>✓</span><p><strong>Statement secured</strong><small>{providerConsent.state === "accepted" ? "Accepted by provider" : "Awaiting provider verification"}</small></p></div>
              <dl className="voice-consent-receipt">
                <div><dt>Provider</dt><dd>Microsoft Azure</dd></div>
                <div><dt>Locale</dt><dd>{providerConsent.locale}</dd></div>
                <div><dt>Attempt</dt><dd>{providerConsent.attempt} of 5</dd></div>
                <div><dt>Statement</dt><dd>{providerConsent.statement_sha256.slice(0, 8)}…</dd></div>
              </dl>
            </>
          )}
        </article>

        <article className="voice-enrollment-card">
          <span className="voice-step">02 · Exact model binding</span>
          <h3>Build the private voice</h3>
          <p>{statusCopy(profile)}</p>
          <div className="voice-binding-list">
            <span><i className={providerConsent?.state === "uploaded" || providerConsent?.state === "accepted" ? "done" : ""} />Provider statement</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />Approved VoiceGenome</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />30–90 sec reviewed WAV</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />Azure spend reservation</span>
          </div>
          {!profile && (
            <button className="button primary-button" type="button"
              disabled={busy || providerConsent?.state !== "uploaded"}
              onClick={() => void createProfile()}>
              {stage === "creating" ? "Creating verified profile" : "Create verified voice"}
            </button>
          )}
          {profile && (
            <div className="voice-profile-control">
              <label className="field-label" htmlFor="delete-voice">Type DELETE VOICE to erase provider copy</label>
              <input id="delete-voice" className="field" value={deleteText}
                onChange={(event) => setDeleteText(event.target.value.toUpperCase())} autoComplete="off" />
              <button className="button danger-button" type="button"
                disabled={busy || deleteText !== "DELETE VOICE" || profile.status === "deleting"}
                onClick={() => void eraseProfile()}>Erase provider voice</button>
            </div>
          )}
        </article>
      </div>
      {error && <p className="inline-error" role="alert">{words(error)}</p>}
      <p className="voice-enrollment-note">No public voice page, downloadable model, bulk API, telephony, or silent generation is enabled.</p>
    </section>
  );
}
