import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import VoiceField from "./VoiceField";
import type { BiometricVerificationAttestations, LivenessCaptureReadiness } from "./livenessApi";
import type {
  ConsentReceipt,
  LivenessChallenge,
  Replica,
  ReplicaReview,
  ReplicaSource,
  SignedUpload,
  SourceKind,
  VoiceBuildIntent,
} from "./types";

// Each ceremony is reached only after the previous gate has passed. Loading
// its implementation at that point keeps the first mobile recording journey
// small without changing which checks run or what can unlock the clone.
const IdentityProofing = lazy(() => import("./IdentityProofing"));
const LivenessCapture = lazy(() => import("./LivenessCapture"));
const ModelConsentGate = lazy(() => import("./ModelConsentGate"));
const ProcessingReview = lazy(() => import("./ProcessingReview"));

// stage-model:start
export type CloneVerificationStage =
  | "stopped"
  | "self_test_blocked"
  | "source_permission"
  | "primary_source"
  | "source_processing"
  | "identity_document"
  | "identity_proof"
  | "liveness"
  | "model_consent"
  | "review"
  | "building"
  | "complete";

export interface CloneVerificationFacts {
  replica: Replica;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  review: ReplicaReview | null;
  candidateSourceId?: string | null;
  buildIntent?: VoiceBuildIntent | null;
}

function activeConsentScopes(consents: ConsentReceipt[], now: number) {
  return new Set(consents
    .filter((receipt) => !receipt.revoked_at && (!receipt.expires_at || Date.parse(receipt.expires_at) > now))
    .map((receipt) => receipt.scope));
}

function newestIdentityDocument(sources: ReplicaSource[]) {
  return sources
    .filter((source) => source.capture_mode === "identity_document")
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null;
}

function newestBuild(review: ReplicaReview | null) {
  return review?.builds
    .slice()
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))[0] ?? null;
}

// The exported state model is intentionally colocated with the surface so the
// browser journey and its executable safety matrix cannot drift apart.
// oxlint-disable-next-line react/only-export-components
export function deriveCloneVerificationStage(
  { replica, consents, sources, review, candidateSourceId, buildIntent }: CloneVerificationFacts,
  now = Date.now(),
): CloneVerificationStage {
  if (replica.lifecycle === "revoked" || replica.lifecycle === "purging") return "stopped";
  if (review?.self_test_mode) return "self_test_blocked";

  const scopes = activeConsentScopes(consents, now);
  if (!["capture", "transcription", "storage"].every((scope) => scopes.has(scope as ConsentReceipt["scope"]))) {
    return "source_permission";
  }

  const primary = candidateSourceId
    ? sources.find((source) => source.source_id === candidateSourceId && source.state !== "rejected" && source.state !== "deleting") ?? null
    : sources.find((source) => source.voice_role === "primary" && source.state !== "rejected" && source.state !== "deleting") ?? null;
  if (!primary) return "primary_source";
  if (primary.state !== "ready") return "source_processing";

  const identityDocument = newestIdentityDocument(sources);
  if (!replica.age_verified) {
    if (!identityDocument || identityDocument.state !== "quarantined") return "identity_document";
    return "identity_proof";
  }

  const liveIdentityReady = replica.identity_verified && replica.liveness_verified && scopes.has("biometric");
  if (!liveIdentityReady) return "liveness";
  if (!scopes.has("training") || !scopes.has("inference")) return "model_consent";

  const exactDraftReady = review?.voice_genomes.some((genome) => (genome.status === "draft" || genome.status === "approved") && genome.source_ids.includes(primary.source_id));
  const candidatePromoted = !candidateSourceId || Boolean(buildIntent
    && buildIntent.candidate_source_id === candidateSourceId
    && buildIntent.state === "review"
    && buildIntent.promoted_at);
  if (exactDraftReady && candidatePromoted) {
    return "complete";
  }

  if (candidateSourceId && buildIntent?.candidate_source_id === candidateSourceId) {
    if (buildIntent.state === "queued") return "building";
    if (buildIntent.state === "failed") return "review";
  }

  const build = newestBuild(review);
  if (build && ["queued", "leased", "building", "retry"].includes(build.state)) return "building";
  return "review";
}
// stage-model:end

type SourceUploadInput = {
  kind: SourceKind;
  purpose: "memory" | "identity_document";
  mime: string;
  byteSize: number;
  sha256: string;
  containsThirdParties: boolean;
};

type LivenessUploadInput = {
  challengeId: string;
  kind: "audio" | "video";
  mime: string;
  byteSize: number;
  sha256: string;
};

export interface CloneVerificationJourneyProps {
  token: string;
  replica: Replica;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  review: ReplicaReview | null;
  candidateSourceId?: string | null;
  buildIntent?: VoiceBuildIntent | null;
  reviewLoading?: boolean;
  challenge: LivenessChallenge | null;
  livenessLoading: boolean;
  onOpenSourcePermission: () => void;
  onResetLegacyClone: () => Promise<boolean>;
  onReturnToVoice: () => void;
  onExit?: () => void;
  onContinue: () => void;
  onCreateSourceUpload: (input: SourceUploadInput) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onFinalizeSourceUpload: (sourceId: string) => Promise<ReplicaSource>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
  onSourcesChanged: () => Promise<void>;
  onIdentityChanged: () => Promise<void>;
  onCheckCaptureReadiness: () => Promise<LivenessCaptureReadiness>;
  onIssueChallenge: (attestations: BiometricVerificationAttestations) => Promise<LivenessChallenge>;
  onStartFaceSession: (challengeId: string) => Promise<{ challenge: LivenessChallenge; quick_link_url: string }>;
  onPollFaceSession: (challengeId: string) => Promise<LivenessChallenge>;
  onCancelChallenge: (challengeId: string) => Promise<{
    challenge: LivenessChallenge;
    erasure: "pending" | "confirmed" | "not_required";
  }>;
  onCreateLivenessUpload: (input: LivenessUploadInput) => Promise<{
    challenge: LivenessChallenge;
    source: ReplicaSource;
    upload: SignedUpload;
  }>;
  onFinalizeLiveness: (challengeId: string, sourceId: string) => Promise<LivenessChallenge>;
  onVerifiedConsentChanged: () => Promise<void>;
  onRefreshReview?: () => Promise<void>;
  onAuthError: (cause: unknown) => void;
}

const IDENTITY_MAX_BYTES = 52_428_800;
const IDENTITY_MIMES = new Set(["image/jpeg", "image/png", "application/pdf"]);

type IdentityFile = { file: File; kind: "image" | "document"; mime: string };
type IdentityUploadPhase = "idle" | "hashing" | "authorizing" | "uploading" | "finalizing" | "complete" | "failed";
type IdentityRetry = { file: File; sourceId: string | null; uploaded: boolean };

function fileBytes(bytes: number) {
  if (bytes < 1_048_576) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes >= 10_485_760 ? 0 : 1)} MB`;
}

function identityFile(file: File): IdentityFile | { problem: string } {
  if (file.size < 1) return { problem: "This file is empty." };
  if (file.size > IDENTITY_MAX_BYTES) return { problem: "The document is larger than 50 MB." };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = extension === "pdf" ? "application/pdf"
    : extension === "png" ? "image/png"
      : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "";
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  const mime = IDENTITY_MIMES.has(declared) ? declared : inferred;
  if (!IDENTITY_MIMES.has(mime)) return { problem: "Choose a JPEG, PNG, or PDF." };
  return { file, mime, kind: mime === "application/pdf" ? "document" : "image" };
}

function Icon({ name }: { name: "back" | "lock" | "check" | "file" }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
      {name === "back" && <path {...stroke} d="m15 18-6-6 6-6" />}
      {name === "lock" && <><rect {...stroke} x="5" y="10" width="14" height="10" rx="3" /><path {...stroke} d="M8 10V7a4 4 0 0 1 8 0v3" /></>}
      {name === "check" && <path {...stroke} d="m5 12 4 4L19 6" />}
      {name === "file" && <><path {...stroke} d="M7 3h7l4 4v14H7z" /><path {...stroke} d="M14 3v5h5M10 13h5M10 17h4" /></>}
    </svg>
  );
}

function VerificationProgress({ stage }: { stage: CloneVerificationStage }) {
  const current = stage === "source_processing" ? 0
    : stage === "identity_document" || stage === "identity_proof" ? 1
    : stage === "liveness" ? 2
      : stage === "model_consent" ? 3
        : stage === "review" ? 4
          : stage === "building" || stage === "complete" ? 5 : 0;
  return (
    <div className="cvj-progress" role="img" aria-label={current ? `Verification step ${current} of 5` : "Verification paused"}>
      {Array.from({ length: 5 }, (_, index) => <i key={index} data-state={index + 1 < current ? "done" : index + 1 === current ? "current" : "next"} />)}
    </div>
  );
}

function JourneyHeader({ replica, stage, onExit }: { replica: Replica; stage: CloneVerificationStage; onExit?: () => void }) {
  return (
    <header className="cvj-header">
      {onExit ? <button className="cvj-icon-button" type="button" aria-label="Leave verification" onClick={onExit}><Icon name="back" /></button> : <span />}
      <div className="cvj-header__identity"><strong>Make {replica.display_name} yours</strong><span>Private verification</span></div>
      <VerificationProgress stage={stage} />
    </header>
  );
}

function FocusedMessage({
  icon,
  title,
  body,
  label,
  onAction,
  tone = "calm",
}: {
  icon: "lock" | "check" | "file";
  title: string;
  body: string;
  label?: string;
  onAction?: () => void;
  tone?: "calm" | "blocked" | "ready";
}) {
  return (
    <section className={`cvj-focus cvj-focus--${tone}`} aria-labelledby="cvj-focus-title">
      <span className="cvj-focus__mark"><Icon name={icon} /></span>
      <div><h1 id="cvj-focus-title">{title}</h1><p>{body}</p></div>
      {label && onAction ? <button className="cvj-primary" type="button" onClick={onAction}>{label}</button> : null}
    </section>
  );
}

function LegacySelfTestReset({ onReset }: { onReset: () => Promise<boolean> }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const started = await onReset();
      if (!started) setError("Erasure did not start. This test clone is still blocked. Try again.");
    } catch {
      setError("Erasure did not start. This test clone is still blocked. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cvj-focus cvj-focus--blocked" aria-labelledby="cvj-focus-title">
      <span className="cvj-focus__mark"><Icon name="lock" /></span>
      <div>
        <h1 id="cvj-focus-title">This test clone cannot continue.</h1>
        <p>An older internal test permission was used to build this draft. It cannot continue through real verification. Erase this test clone and begin again with a clean record.</p>
      </div>
      {!confirming ? (
        <button className="cvj-primary" type="button" onClick={() => setConfirming(true)}>Start clean</button>
      ) : (
        <div className="cvj-reset-confirm" role="group" aria-label="Confirm test clone erasure">
          <p>This blocks the clone now and starts verified erasure of its recordings and derived data. The new clone will not inherit this draft or its permissions.</p>
          <div className="cvj-actions">
            <button className="cvj-primary cvj-primary--danger" type="button" disabled={busy} onClick={() => void reset()}>{busy ? "Starting erasure" : "Erase and start again"}</button>
            <button className="cvj-quiet" type="button" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        </div>
      )}
      {error ? <p className="cvj-error" role="alert">{error}</p> : null}
    </section>
  );
}

function IdentityDocumentUpload({
  source,
  onCreateUpload,
  onRetryUpload,
  onFinalizeUpload,
  onDeleteSource,
  onChanged,
}: {
  source: ReplicaSource | null;
  onCreateUpload: CloneVerificationJourneyProps["onCreateSourceUpload"];
  onRetryUpload: CloneVerificationJourneyProps["onRetryUpload"];
  onFinalizeUpload: CloneVerificationJourneyProps["onFinalizeSourceUpload"];
  onDeleteSource: CloneVerificationJourneyProps["onDeleteSource"];
  onChanged: CloneVerificationJourneyProps["onSourcesChanged"];
}) {
  const [selected, setSelected] = useState<IdentityFile | null>(null);
  const [declared, setDeclared] = useState(false);
  const [phase, setPhase] = useState<IdentityUploadPhase>("idle");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const retryRef = useRef<IdentityRetry | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const busy = ["hashing", "authorizing", "uploading", "finalizing"].includes(phase);
  const waitingSource = source && ["pending_upload", "uploaded", "processing"].includes(source.state);

  function choose(file: File | undefined) {
    if (!file) return;
    const result = identityFile(file);
    setError("problem" in result ? result.problem : "");
    setSelected("problem" in result ? null : result);
    setDeclared(false);
    setPhase("idle");
    setProgress(0);
    retryRef.current = null;
  }

  async function finishUpload(retry = false) {
    const file = retryRef.current?.file ?? selected?.file;
    const input = selected ?? (file ? identityFile(file) : null);
    if (!file || !input || "problem" in input || (!retry && !declared)) return;
    setError("");
    try {
      let sourceId = retryRef.current?.sourceId ?? null;
      let uploaded = retryRef.current?.uploaded ?? false;
      let finalized = false;
      let upload: SignedUpload | null = null;
      if (!sourceId) {
        setPhase("hashing");
        setProgress(0);
        const sha256 = await sha256File(file, setProgress);
        setPhase("authorizing");
        const created = await onCreateUpload({
          kind: input.kind,
          purpose: "identity_document",
          mime: input.mime,
          byteSize: file.size,
          sha256,
          containsThirdParties: false,
        });
        sourceId = created.source.source_id;
        upload = created.upload;
        finalized = created.finalized;
        uploaded = created.finalized;
        retryRef.current = { file, sourceId, uploaded };
      } else if (!uploaded) {
        setPhase("authorizing");
        const retried = await onRetryUpload(sourceId);
        upload = retried.upload;
        finalized = retried.finalized;
        uploaded = retried.finalized;
      }
      if (!uploaded) {
        if (!upload) throw new Error("Private upload authorization is missing.");
        setPhase("uploading");
        setProgress(0);
        await putSignedUpload(file, upload, setProgress);
        uploaded = true;
        retryRef.current = { file, sourceId, uploaded: true };
      }
      if (!finalized) {
        setPhase("finalizing");
        await onFinalizeUpload(sourceId);
      }
      retryRef.current = null;
      setPhase("complete");
      setProgress(100);
      setSelected(null);
      setDeclared(false);
      if (inputRef.current) inputRef.current.value = "";
      await onChanged();
    } catch (cause) {
      setPhase("failed");
      setError(cause instanceof Error ? cause.message : "The private upload stopped before verification.");
    }
  }

  async function removeUnfinished() {
    if (!source) return;
    setRemoving(true);
    setError("");
    try {
      await onDeleteSource(source.source_id);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The unfinished upload could not be removed.");
    } finally {
      setRemoving(false);
    }
  }

  if (waitingSource) {
    return (
      <section className="cvj-document cvj-document--waiting" aria-labelledby="cvj-document-title">
        <span className="cvj-focus__mark"><Icon name="lock" /></span>
        <div><h1 id="cvj-document-title">Securing your document.</h1><p>{source.state === "pending_upload" ? "The private upload has not finished." : "Vyakti is checking the stored file. This page does not need another copy."}</p></div>
        <div className="cvj-actions">
          <button className="cvj-primary" type="button" onClick={() => void onChanged()}>Check again</button>
          {source.state === "pending_upload" ? <button className="cvj-quiet" type="button" disabled={removing} onClick={() => void removeUnfinished()}>{removing ? "Removing" : "Remove unfinished upload"}</button> : null}
        </div>
        {error && <p className="cvj-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="cvj-document" aria-labelledby="cvj-document-title">
      <div className="cvj-document__intro"><span className="cvj-focus__mark"><Icon name="file" /></span><div><h1 id="cvj-document-title">Add one private ID.</h1><p>A JPEG, PNG, or PDF confirms your age and identity. A separate live check connects you to the recording. The file is never used to train the clone.</p></div></div>
      {source?.state === "rejected" ? <p className="cvj-error" role="alert">The previous document was not accepted. Choose a new file.</p> : null}
      {source?.state === "deleting" ? <p className="cvj-wait" role="status">The old document is being erased. Check again before adding another.</p> : null}
      <input ref={inputRef} className="cvj-file-input" id="cvj-id-file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" disabled={busy || source?.state === "deleting"} onChange={(event) => choose(event.target.files?.[0])} />
      <label className="cvj-file-picker" htmlFor="cvj-id-file"><Icon name="file" /><span><strong>{selected ? `${selected.mime === "application/pdf" ? "PDF" : "Image"} selected` : "Choose your ID"}</strong><small>{selected ? `${fileBytes(selected.file.size)} on this device` : "JPEG, PNG, or PDF up to 50 MB"}</small></span></label>
      <label className="cvj-declaration"><input type="checkbox" checked={declared} disabled={!selected || busy} onChange={(event) => setDeclared(event.target.checked)} /><span>This current government ID shows only me.</span></label>
      {busy ? <div className="cvj-upload-state" role="status" aria-live="polite"><div><strong>{phase === "hashing" ? "Checking the file" : phase === "authorizing" ? "Opening private storage" : phase === "uploading" ? "Uploading privately" : "Verifying the stored copy"}</strong><span>{phase === "hashing" || phase === "uploading" ? `${progress}%` : "Please keep this page open"}</span></div>{phase === "hashing" || phase === "uploading" ? <progress max="100" value={progress} aria-label="Private document upload progress" /> : <span className="cvj-indeterminate" aria-hidden="true" />}</div> : null}
      {phase === "complete" ? <p className="cvj-success" role="status">Document secured. Opening the identity check.</p> : null}
      {error && <p className="cvj-error" role="alert">{error}</p>}
      <button className="cvj-primary" type="button" disabled={busy || !selected || !declared || source?.state === "deleting"} onClick={() => void finishUpload(false)}>{busy ? "Securing document" : phase === "failed" && retryRef.current ? "Retry private upload" : "Upload privately"}</button>
      {phase === "failed" && retryRef.current ? <button className="cvj-quiet" type="button" onClick={() => void finishUpload(true)}>Retry without choosing the file again</button> : null}
      <p className="cvj-privacy"><Icon name="lock" /> The file goes straight to private storage after you press Upload.</p>
    </section>
  );
}

function latestIdentitySource(sources: ReplicaSource[]) {
  return newestIdentityDocument(sources);
}

function DeferredVerificationStage({ stage }: { stage: CloneVerificationStage }) {
  const label = stage === "identity_proof" ? "Opening the private identity check"
    : stage === "liveness" ? "Opening the live identity check"
      : stage === "model_consent" ? "Opening model permission"
        : "Opening the evidence review";
  return (
    <section className="cvj-build" role="status" aria-live="polite" aria-label={label}>
      <span className="cvj-build__signal"><VoiceField calm /></span>
      <div><h1>{label}.</h1><p>Your completed steps stay saved while this screen opens.</p></div>
    </section>
  );
}

export default function CloneVerificationJourney(props: CloneVerificationJourneyProps) {
  const {
    token,
    replica,
    consents,
    sources,
    review,
    candidateSourceId = null,
    buildIntent = null,
    reviewLoading = false,
    challenge,
    livenessLoading,
    onOpenSourcePermission,
    onResetLegacyClone,
    onReturnToVoice,
    onExit,
    onContinue,
    onCreateSourceUpload,
    onRetryUpload,
    onFinalizeSourceUpload,
    onDeleteSource,
    onSourcesChanged,
    onIdentityChanged,
    onCheckCaptureReadiness,
    onIssueChallenge,
    onStartFaceSession,
    onPollFaceSession,
    onCancelChallenge,
    onCreateLivenessUpload,
    onFinalizeLiveness,
    onVerifiedConsentChanged,
    onRefreshReview,
    onAuthError,
  } = props;
  const stage = useMemo(() => deriveCloneVerificationStage({ replica, consents, sources, review, candidateSourceId, buildIntent }), [buildIntent, candidateSourceId, consents, replica, review, sources]);
  const sourceConsentActive = useMemo(() => {
    const scopes = activeConsentScopes(consents, Date.now());
    return ["capture", "transcription", "storage"].every((scope) => scopes.has(scope as ConsentReceipt["scope"]));
  }, [consents]);
  const latestBuild = useMemo(() => newestBuild(review), [review]);
  const displayedBuildState = buildIntent?.candidate_source_id === candidateSourceId ? buildIntent.build_state || buildIntent.state : latestBuild?.state;

  useEffect(() => {
    if (!onRefreshReview || (stage !== "review" && stage !== "building")) return;
    const timer = window.setInterval(() => {
      void onRefreshReview().catch(onAuthError);
    }, stage === "building" ? 10_000 : 20_000);
    return () => window.clearInterval(timer);
  }, [onAuthError, onRefreshReview, stage]);

  useEffect(() => {
    if (stage !== "source_processing") return;
    const timer = window.setInterval(() => {
      void onSourcesChanged().catch(onAuthError);
    }, 10_000);
    return () => window.clearInterval(timer);
  }, [onAuthError, onSourcesChanged, stage]);

  return (
    <div className="cvj-shell" data-stage={stage}>
      <JourneyHeader replica={replica} stage={stage} onExit={onExit} />
      <main className={`cvj-stage cvj-stage--${stage}`} aria-label="Clone verification">
        {stage === "stopped" ? <FocusedMessage icon="lock" tone="blocked" title="This clone is no longer active." body="Generation is blocked while verified erasure finishes." /> : null}
        {stage === "self_test_blocked" ? <LegacySelfTestReset onReset={onResetLegacyClone} /> : null}
        {stage === "source_permission" ? <FocusedMessage icon="lock" title="Permission needs attention." body="Your recording stays private. Building is paused until capture, transcription, and storage permission are active." label="Review permission" onAction={onOpenSourcePermission} /> : null}
        {stage === "primary_source" ? <FocusedMessage icon="file" title="Finish your voice first." body="A prepared primary recording is required before identity verification can begin." label="Return to voice" onAction={onReturnToVoice} /> : null}
        {stage === "source_processing" ? <section className="cvj-build" aria-labelledby="cvj-source-title"><span className="cvj-build__signal"><VoiceField calm /></span><div><h1 id="cvj-source-title">Preparing your recording.</h1><p>The private worker is checking the exact source you selected. Recent recordings took about 5 to 15 minutes after worker pickup; long files can take longer.</p></div><dl><div><dt>Automatic check</dt><dd>Every 10 seconds while this page is open</dd></div><div><dt>You can return</dt><dd>This continues on the server</dd></div></dl><button className="cvj-quiet" type="button" onClick={() => void onSourcesChanged().catch(onAuthError)}>Check now</button></section> : null}
        {stage === "identity_document" ? <IdentityDocumentUpload source={latestIdentitySource(sources)} onCreateUpload={onCreateSourceUpload} onRetryUpload={onRetryUpload} onFinalizeUpload={onFinalizeSourceUpload} onDeleteSource={onDeleteSource} onChanged={onSourcesChanged} /> : null}
        {stage === "identity_proof" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><IdentityProofing token={token} replicaId={replica.replica_id} sources={sources} onChanged={onIdentityChanged} onAuthError={onAuthError} /></Suspense> : null}
        {stage === "liveness" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><LivenessCapture consentActive={sourceConsentActive && replica.age_verified} challenge={challenge} loading={livenessLoading} onCheckReadiness={onCheckCaptureReadiness} onIssue={onIssueChallenge} onStartFace={onStartFaceSession} onPollFace={onPollFaceSession} onCancel={onCancelChallenge} onCreateUpload={onCreateLivenessUpload} onRetryUpload={onRetryUpload} onFinalize={onFinalizeLiveness} /></Suspense> : null}
        {stage === "model_consent" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><ModelConsentGate token={token} replica={replica} consents={consents} onChanged={onVerifiedConsentChanged} onAuthError={onAuthError} /></Suspense> : null}
        {stage === "review" ? <section className="cvj-review-stage" aria-label="Review voice evidence">{buildIntent?.state === "failed" || latestBuild?.state === "failed" ? <p className="cvj-platform-stop" role="alert"><strong>The exact build stopped on our side.</strong><span>Review the receipts below. Start with a fresh recording only if the source itself was rejected.</span></p> : null}{reviewLoading && !review ? <p className="cvj-wait" role="status">Loading private review receipts.</p> : null}<Suspense fallback={<DeferredVerificationStage stage={stage} />}><ProcessingReview token={token} replicaId={replica.replica_id} sourceCount={sources.length} onAuthError={onAuthError} /></Suspense></section> : null}
        {stage === "building" ? <section className="cvj-build" aria-labelledby="cvj-build-title"><span className="cvj-build__signal"><VoiceField calm /></span><div><h1 id="cvj-build-title">Building your private voice.</h1><p>The server has the reviewed evidence. It checks this exact recording every 10 seconds, and you can safely leave this page.</p></div><dl><div><dt>Current state</dt><dd>{displayedBuildState === "retry" ? "Waiting for an automatic retry" : displayedBuildState === "leased" ? "Build worker assigned" : displayedBuildState === "building" ? "Creating the draft" : "Queued"}</dd></div><div><dt>Completion</dt><dd>No guessed countdown</dd></div></dl>{onRefreshReview ? <button className="cvj-quiet" type="button" onClick={() => void onRefreshReview().catch(onAuthError)}>Check now</button> : null}</section> : null}
        {stage === "complete" ? <FocusedMessage icon="check" tone="ready" title="Your draft voice is ready." body="The draft is bound to your reviewed evidence. Continue to listen before you approve or deploy it." label="Meet your clone" onAction={onContinue} /> : null}
      </main>
    </div>
  );
}
