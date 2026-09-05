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
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel, type StudioCopy } from "./copy";

type Stage = "idle" | "permission" | "recording" | "hashing" | "authorizing" | "uploading" | "finalizing" | "creating" | "deleting";
type Recording = { file: File; url: string; durationMs: number };

function activeScopes(consents: ConsentReceipt[]) {
  const now = Date.now();
  return new Set(consents.filter((receipt) =>
    !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > now)
  ).map((receipt) => receipt.scope));
}

/** The stage label as it prints inside the "Secure statement" button while a
 *  request is in flight -- `t.voiceEnrollmentLab`'s own words for each
 *  in-progress `Stage`, never the raw enum value. */
function stageLabel(c: StudioCopy["voiceEnrollmentLab"], stage: Stage) {
  if (stage === "hashing") return c.stageHashing;
  if (stage === "authorizing") return c.stageAuthorizing;
  if (stage === "uploading") return c.stageUploading;
  if (stage === "finalizing") return c.stageFinalizing;
  return stage;
}

function statusCopy(c: StudioCopy["voiceEnrollmentLab"], profile: VoiceProfile | null) {
  if (!profile) return c.statusNoProfile;
  if (profile.status === "ready") return withCount(c.statusReadyTemplate, profile.genome_version);
  if (profile.status === "creating") return c.statusCreating;
  if (profile.status === "deleting") return c.statusDeleting;
  return c.statusFailed;
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
  const { t } = useStudioLocale();
  const c = t.voiceEnrollmentLab;
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
    !replica.age_verified && c.blockerAdultAge,
    !replica.identity_verified && c.blockerIdentity,
    !replica.liveness_verified && c.blockerLiveness,
    !scopes.has("capture") && c.blockerCapture,
    !scopes.has("storage") && c.blockerStorage,
    !scopes.has("biometric") && c.blockerBiometric,
    !scopes.has("training") && c.blockerVoiceBuilding,
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
        if (failed?.status === "rejected") report(failed.reason, c.errorStatusUnavailable);
      })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [replica.replica_id, report, token, c.errorStatusUnavailable]);

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
    } catch (cause) { report(cause, c.errorIssueFailed); }
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
      report(cause, c.errorMicNotOpened);
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
        throw new Error(c.errorMinDuration);
      }
      setRecording(next);
    } catch (cause) { report(cause, c.errorRecordingNotFinalized); }
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
        if (!uploadCapability) throw new Error(c.errorUploadAuthMissing);
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
    } catch (cause) { report(cause, c.errorConsentNotSecured); }
    finally { setStage("idle"); }
  }

  async function createProfile() {
    setError("");
    setStage("creating");
    try { setProfile(await createVoiceProfile(token, replica.replica_id)); }
    catch (cause) { report(cause, c.errorProfileNotCreated); }
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
    } catch (cause) { report(cause, c.errorProfileNotErased); }
    finally { setStage("idle"); }
  }

  return (
    <section id="voice-enrollment-lab" className="voice-enrollment-section" aria-labelledby="voice-enrollment-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="voice-enrollment-title">{c.title}</h2>
        </div>
        <span className={`voice-provider-state ${profile?.status === "ready" ? "ready" : ""}`}>
          {loading ? c.stateChecking : profile?.status ?? c.stateNotCreated}
        </span>
      </div>
      <p className="voice-enrollment-intro">{c.intro}</p>

      {blockers.length > 0 && (
        <div className="voice-gate-blockers" role="status">
          <strong>{c.blockersHeadline}</strong>
          <p>{c.blockersIntro}</p>
          <ul>{blockers.map((blocker) => <li key={blocker}>{blocker}</li>)}</ul>
        </div>
      )}

      <div className="voice-enrollment-grid">
        <article className="voice-enrollment-card">
          <span className="voice-step">{c.providerStatementStep}</span>
          <h3>{c.recordExactConsent}</h3>
          {!challengeLive && providerConsent?.state !== "uploaded" && providerConsent?.state !== "accepted" && (
            <>
              <label className="field-label" htmlFor="provider-full-name">{c.legalNameLabel}</label>
              <input id="provider-full-name" className="field" autoComplete="name" value={fullName}
                onChange={(event) => setFullName(event.target.value)} placeholder={c.legalNamePlaceholder} />
              <button className="button primary-button" type="button"
                disabled={busy || blockers.length > 0 || fullName.trim().split(/\s+/).length < 2}
                onClick={() => void issue()}>{c.issueStatementButton}</button>
            </>
          )}
          {challengeLive && providerConsent?.statement && (
            <div className="provider-statement">
              <span>{c.readExactlyLabel}</span>
              {/* SERVER-COMPUTED PROSE: Microsoft's own required spoken legal
                  statement, delivered by the provider consent API. This
                  product does not author or translate it -- copy.ts's own
                  header names this exact class of exception, applied here to
                  a THIRD PARTY's fixed legal wording rather than this
                  product's own. */}
              <blockquote>{providerConsent.statement}</blockquote>
              <small>{withLabel(c.expiresTemplate, new Date(providerConsent.expires_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))}</small>
            </div>
          )}
          {stage === "recording" ? (
            <button className="button destructive-button" type="button" onClick={() => void stopRecording()}>
              {withCount(c.stopRecordingTemplate, seconds)}
            </button>
          ) : challengeLive && !recording ? (
            <button className="button secondary-button" type="button" disabled={busy} onClick={() => void startRecording()}>
              {c.recordPrivateWavButton}
            </button>
          ) : null}
          {recording && (
            <div className="provider-recording-review">
              <audio controls src={recording.url}>{c.audioFallback}</audio>
              <span>{withLabel(c.recordingDurationTemplate, (recording.durationMs / 1000).toFixed(1))}</span>
              <div className="voice-row-actions">
                <button className="button secondary-button" disabled={busy} onClick={clearRecording}>{c.retakeButton}</button>
                <button className="button primary-button" disabled={busy || !challengeLive} onClick={() => void upload()}>
                  {stage === "idle" ? c.secureStatementButton : `${stageLabel(c, stage)}${progress ? ` ${progress}%` : ""}`}
                </button>
              </div>
            </div>
          )}
          {(providerConsent?.state === "uploaded" || providerConsent?.state === "accepted") && (
            <>
              <div className="voice-success"><span>✓</span><p><strong>{c.statementSecuredTitle}</strong><small>{providerConsent.state === "accepted" ? c.acceptedByProvider : c.awaitingProviderVerification}</small></p></div>
              <dl className="voice-consent-receipt">
                <div><dt>{c.providerLabel}</dt><dd>{c.providerValue}</dd></div>
                <div><dt>{c.localeLabel}</dt><dd>{providerConsent.locale}</dd></div>
                <div><dt>{c.attemptLabel}</dt><dd>{withCount(c.attemptTemplate, providerConsent.attempt)}</dd></div>
                <div><dt>{c.statementHashLabel}</dt><dd>{providerConsent.statement_sha256.slice(0, 8)}…</dd></div>
              </dl>
            </>
          )}
        </article>

        <article className="voice-enrollment-card">
          <span className="voice-step">{c.exactVoiceBindingStep}</span>
          <h3>{c.buildPrivateVoiceTitle}</h3>
          <p>{statusCopy(c, profile)}</p>
          <div className="voice-binding-list">
            <span><i className={providerConsent?.state === "uploaded" || providerConsent?.state === "accepted" ? "done" : ""} />{c.bindingProviderStatement}</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />{c.bindingApprovedVoice}</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />{c.bindingWavRange}</span>
            <span><i className={profile?.status === "ready" ? "done" : ""} />{c.bindingSpendReservation}</span>
          </div>
          {!profile && (
            <button className="button primary-button" type="button"
              disabled={busy || providerConsent?.state !== "uploaded"}
              onClick={() => void createProfile()}>
              {stage === "creating" ? c.creatingVerifiedProfileButton : c.createVerifiedVoiceButton}
            </button>
          )}
          {profile && (
            <div className="voice-profile-control">
              <label className="field-label" htmlFor="delete-voice">{c.deleteVoiceLabel}</label>
              <input id="delete-voice" className="field" value={deleteText}
                onChange={(event) => setDeleteText(event.target.value.toUpperCase())} autoComplete="off" />
              <button className="button danger-button" type="button"
                disabled={busy || deleteText !== "DELETE VOICE" || profile.status === "deleting"}
                onClick={() => void eraseProfile()}>{c.eraseProviderVoiceButton}</button>
            </div>
          )}
        </article>
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}
      <p className="voice-enrollment-note">{c.footerNote}</p>
    </section>
  );
}
