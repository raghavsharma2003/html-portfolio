import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import VoiceField from "./VoiceField";
import type { LivenessIssueInput, LivenessCaptureReadiness } from "./livenessApi";
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
import { useStudioLocale } from "./localeContext";
import type { CloneVerificationJourneyCopy } from "./copy";

// Each ceremony is reached only after the previous gate has passed. Loading
// its implementation at that point keeps the first mobile recording journey
// small without changing which checks run or what can unlock the clone.
const ComparisonReferenceReview = lazy(() => import("./ComparisonReferenceReview"));
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
  comparisonSourceId?: string | null;
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
  { replica, consents, sources, review, candidateSourceId, comparisonSourceId, buildIntent }: CloneVerificationFacts,
  now = Date.now(),
): CloneVerificationStage {
  if (replica.lifecycle === "revoked" || replica.lifecycle === "purging") return "stopped";
  if (review?.self_test_mode) return "self_test_blocked";

  const scopes = activeConsentScopes(consents, now);
  if (!(comparisonSourceId ? ["capture", "storage"] : ["capture", "transcription", "storage"]).every((scope) => scopes.has(scope as ConsentReceipt["scope"]))) {
    return "source_permission";
  }

  const primary = candidateSourceId
    ? sources.find((source) => source.source_id === candidateSourceId && source.state !== "rejected" && source.state !== "deleting") ?? null
    : sources.find((source) => source.voice_role === "primary" && source.state !== "rejected" && source.state !== "deleting") ?? null;
  if (!primary && !comparisonSourceId) return "primary_source";
  if (primary && primary.state !== "ready" && !comparisonSourceId) return "source_processing";

  const identityDocument = newestIdentityDocument(sources);
  if (!replica.age_verified) {
    if (!identityDocument || identityDocument.state !== "quarantined") return "identity_document";
    return "identity_proof";
  }

  const liveIdentityReady = replica.identity_verified && replica.liveness_verified && scopes.has("biometric");
  if (!liveIdentityReady) return "liveness";
  // Private comparison can establish identity but never substitutes for the
  // ordinary recording and permissions required by a voice build.
  if (!primary) return "primary_source";
  if (primary.state !== "ready") return "source_processing";
  if (!scopes.has("transcription")) return "source_permission";
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
  ownerUserId?: string;
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
  exitLabel?: string;
  onContinue: () => void;
  onCreateSourceUpload: (input: SourceUploadInput) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onFinalizeSourceUpload: (sourceId: string) => Promise<ReplicaSource>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
  onSourcesChanged: () => Promise<void>;
  onIdentityChanged: () => Promise<void>;
  onCheckCaptureReadiness: (signal?: AbortSignal) => Promise<LivenessCaptureReadiness>;
  onIssueChallenge: (input: LivenessIssueInput, signal?: AbortSignal) => Promise<LivenessChallenge>;
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

function identityFile(file: File, copy: CloneVerificationJourneyCopy["identity"]): IdentityFile | { problem: string } {
  if (file.size < 1) return { problem: copy.fileEmpty };
  if (file.size > IDENTITY_MAX_BYTES) return { problem: copy.fileTooLarge };
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = extension === "pdf" ? "application/pdf"
    : extension === "png" ? "image/png"
      : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : "";
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  const mime = IDENTITY_MIMES.has(declared) ? declared : inferred;
  if (!IDENTITY_MIMES.has(mime)) return { problem: copy.chooseFileType };
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
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney;
  const current = stage === "source_processing" ? 0
    : stage === "identity_document" || stage === "identity_proof" ? 1
    : stage === "liveness" ? 2
      : stage === "model_consent" ? 3
        : stage === "review" ? 4
          : stage === "building" || stage === "complete" ? 5 : 0;
  return (
    <div className="cvj-progress" role="img" aria-label={current ? copy.verificationStepTemplate.replace("{n}", String(current)) : copy.verificationPaused}>
      {Array.from({ length: 5 }, (_, index) => <i key={index} data-state={index + 1 < current ? "done" : index + 1 === current ? "current" : "next"} />)}
    </div>
  );
}

function JourneyHeader({ replica, stage, onExit, exitLabel }: { replica: Replica; stage: CloneVerificationStage; onExit?: () => void; exitLabel?: string }) {
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney;
  return (
    <header className={`cvj-header${onExit && exitLabel ? " cvj-header--labelled-exit" : ""}`}>
      {onExit ? exitLabel ? <button className="cvj-exit-link" type="button" onClick={onExit}><Icon name="back" /><span>{exitLabel}</span></button> : <button className="cvj-icon-button" type="button" aria-label={copy.leaveVerification} onClick={onExit}><Icon name="back" /></button> : <span />}
      <div className="cvj-header__identity"><strong>{copy.makeYoursTemplate.replace("{name}", replica.display_name)}</strong><span>{copy.privateVerification}</span></div>
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
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney.legacyReset;
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function reset() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const started = await onReset();
      if (!started) setError(copy.erasureFailedError);
    } catch {
      setError(copy.erasureFailedError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="cvj-focus cvj-focus--blocked" aria-labelledby="cvj-focus-title">
      <span className="cvj-focus__mark"><Icon name="lock" /></span>
      <div>
        <h1 id="cvj-focus-title">{copy.title}</h1>
        <p>{copy.body}</p>
      </div>
      {!confirming ? (
        <button className="cvj-primary" type="button" onClick={() => setConfirming(true)}>{copy.startClean}</button>
      ) : (
        <div className="cvj-reset-confirm" role="group" aria-label={copy.confirmAriaLabel}>
          <p>{copy.confirmBody}</p>
          <div className="cvj-actions">
            <button className="cvj-primary cvj-primary--danger" type="button" disabled={busy} onClick={() => void reset()}>{busy ? copy.startingErasure : copy.eraseAndStartAgain}</button>
            <button className="cvj-quiet" type="button" disabled={busy} onClick={() => setConfirming(false)}>{copy.cancel}</button>
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
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney.identity;
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
    const result = identityFile(file, copy);
    setError("problem" in result ? result.problem : "");
    setSelected("problem" in result ? null : result);
    setDeclared(false);
    setPhase("idle");
    setProgress(0);
    retryRef.current = null;
  }

  async function finishUpload(retry = false) {
    const file = retryRef.current?.file ?? selected?.file;
    const input = selected ?? (file ? identityFile(file, copy) : null);
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
        if (!upload) throw new Error(copy.uploadAuthMissing);
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
      setError(cause instanceof Error ? cause.message : copy.uploadStopped);
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
      setError(cause instanceof Error ? cause.message : copy.removeFailed);
    } finally {
      setRemoving(false);
    }
  }

  if (waitingSource) {
    return (
      <section className="cvj-document cvj-document--waiting" aria-labelledby="cvj-document-title">
        <span className="cvj-focus__mark"><Icon name="lock" /></span>
        <div><h1 id="cvj-document-title">{copy.securingTitle}</h1><p>{source.state === "pending_upload" ? copy.uploadNotFinished : copy.checkingStoredFile}</p></div>
        <div className="cvj-actions">
          <button className="cvj-primary" type="button" onClick={() => void onChanged()}>{copy.checkAgain}</button>
          {source.state === "pending_upload" ? <button className="cvj-quiet" type="button" disabled={removing} onClick={() => void removeUnfinished()}>{removing ? copy.removing : copy.removeUnfinished}</button> : null}
        </div>
        {error && <p className="cvj-error" role="alert">{error}</p>}
      </section>
    );
  }

  return (
    <section className="cvj-document" aria-labelledby="cvj-document-title">
      <div className="cvj-document__intro"><span className="cvj-focus__mark"><Icon name="file" /></span><div><h1 id="cvj-document-title">{copy.addTitle}</h1><p>{copy.addBody}</p></div></div>
      {source?.state === "rejected" ? <p className="cvj-error" role="alert">{copy.rejected}</p> : null}
      {source?.state === "deleting" ? <p className="cvj-wait" role="status">{copy.deleting}</p> : null}
      <input ref={inputRef} className="cvj-file-input" id="cvj-id-file" type="file" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf" disabled={busy || source?.state === "deleting"} onChange={(event) => choose(event.target.files?.[0])} />
      <label className="cvj-file-picker" htmlFor="cvj-id-file"><Icon name="file" /><span><strong>{selected ? copy.typeSelectedTemplate.replace("{type}", selected.mime === "application/pdf" ? copy.pdfLabel : copy.imageLabel) : copy.chooseId}</strong><small>{selected ? copy.sizeOnDeviceTemplate.replace("{size}", fileBytes(selected.file.size)) : copy.fileTypesHint}</small></span></label>
      <label className="cvj-declaration"><input type="checkbox" checked={declared} disabled={!selected || busy} onChange={(event) => setDeclared(event.target.checked)} /><span>{copy.declaration}</span></label>
      {busy ? <div className="cvj-upload-state" role="status" aria-live="polite"><div><strong>{phase === "hashing" ? copy.statusChecking : phase === "authorizing" ? copy.statusAuthorizing : phase === "uploading" ? copy.statusUploading : copy.statusVerifying}</strong><span>{phase === "hashing" || phase === "uploading" ? `${progress}%` : copy.keepPageOpen}</span></div>{phase === "hashing" || phase === "uploading" ? <progress max="100" value={progress} aria-label={copy.uploadProgressAriaLabel} /> : <span className="cvj-indeterminate" aria-hidden="true" />}</div> : null}
      {phase === "complete" ? <p className="cvj-success" role="status">{copy.documentSecured}</p> : null}
      {error && <p className="cvj-error" role="alert">{error}</p>}
      <button className="cvj-primary" type="button" disabled={busy || !selected || !declared || source?.state === "deleting"} onClick={() => void finishUpload(false)}>{busy ? copy.securingDocument : phase === "failed" && retryRef.current ? copy.retryUpload : copy.uploadPrivately}</button>
      {phase === "failed" && retryRef.current ? <button className="cvj-quiet" type="button" onClick={() => void finishUpload(true)}>{copy.retryWithoutChoosing}</button> : null}
      <p className="cvj-privacy"><Icon name="lock" /> {copy.privacyNote}</p>
    </section>
  );
}

function latestIdentitySource(sources: ReplicaSource[]) {
  return newestIdentityDocument(sources);
}

function DeferredVerificationStage({ stage }: { stage: CloneVerificationStage }) {
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney.deferred;
  const label = stage === "identity_proof" ? copy.identityProof
    : stage === "liveness" ? copy.liveness
      : stage === "model_consent" ? copy.modelConsent
        : copy.review;
  return (
    <section className="cvj-build" role="status" aria-live="polite" aria-label={label}>
      <span className="cvj-build__signal"><VoiceField calm /></span>
      <div><h1>{label}.</h1><p>{copy.stepsSaved}</p></div>
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
    exitLabel,
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
  const { t } = useStudioLocale();
  const copy = t.cloneVerificationJourney.main;
  const [comparisonOpen,setComparisonOpen]=useState(false);
  const comparisonSource=candidateSourceId||sources.find(source=>source.voice_role==="primary")?.source_id;
  const comparisonScope=JSON.stringify([props.ownerUserId,token,replica.replica_id,comparisonSource,consents.map(c=>[c.consent_id,c.revoked_at,c.expires_at]),sources.filter(s=>s.source_id===comparisonSource).map(s=>[s.updated_at,s.state])]);
  const [privateSelection,setPrivateSelection]=useState<{scope:string;sourceId:string}|null>(null);
  const selectionRead=useRef<AbortController|null>(null);
  useEffect(()=>()=>{selectionRead.current?.abort();},[comparisonScope]);
  const refreshPrivateSelection=useCallback(()=>{
    selectionRead.current?.abort();const controller=new AbortController();selectionRead.current=controller;
    void onCheckCaptureReadiness(controller.signal).then(value=>{
      if(controller.signal.aborted)return;
      const selected=value.comparison;
      setPrivateSelection(selected?.selection_kind==="private_comparison_reference"?{scope:comparisonScope,sourceId:selected.primary_source_id}:null);
    }).catch(error=>{if(!controller.signal.aborted){setPrivateSelection(null);onAuthError(error);}});
  },[comparisonScope,onAuthError,onCheckCaptureReadiness]);
  const comparisonSourceId=privateSelection?.scope===comparisonScope?privateSelection.sourceId:null;
  const stage = useMemo(() => deriveCloneVerificationStage({ replica, consents, sources, review, candidateSourceId, comparisonSourceId, buildIntent }), [buildIntent, candidateSourceId, comparisonSourceId, consents, replica, review, sources]);
  const privateConsentActive=useMemo(()=>{const scopes=activeConsentScopes(consents,Date.now());return scopes.has("capture")&&scopes.has("storage");},[consents]);
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
      <JourneyHeader replica={replica} stage={stage} onExit={onExit} exitLabel={exitLabel} />
      <main className={`cvj-stage cvj-stage--${stage}`} aria-label={copy.ariaLabel}>
        {stage === "stopped" ? <FocusedMessage icon="lock" tone="blocked" title={copy.stopped.title} body={copy.stopped.body} /> : null}
        {stage === "self_test_blocked" ? <LegacySelfTestReset onReset={onResetLegacyClone} /> : null}
        {stage === "source_permission" ? <FocusedMessage icon="lock" title={copy.sourcePermission.title} body={copy.sourcePermission.body} label={copy.sourcePermission.label} onAction={onOpenSourcePermission} /> : null}
        {stage === "primary_source" ? <FocusedMessage icon="file" title={copy.primarySource.title} body={copy.primarySource.body} label={copy.primarySource.label} onAction={onReturnToVoice} /> : null}
        {stage === "source_processing" ? <section className="cvj-build" aria-labelledby="cvj-source-title"><span className="cvj-build__signal"><VoiceField calm /></span><div><h1 id="cvj-source-title">{copy.sourceProcessing.title}</h1><p>{copy.sourceProcessing.body}</p></div><dl><div><dt>{copy.sourceProcessing.autoCheckLabel}</dt><dd>{copy.sourceProcessing.autoCheckValue}</dd></div><div><dt>{copy.sourceProcessing.returnLabel}</dt><dd>{copy.sourceProcessing.returnValue}</dd></div></dl><button className="cvj-quiet" type="button" onClick={() => void onSourcesChanged().catch(onAuthError)}>{copy.sourceProcessing.checkNow}</button></section> : null}
        {stage === "identity_document" ? <IdentityDocumentUpload source={latestIdentitySource(sources)} onCreateUpload={onCreateSourceUpload} onRetryUpload={onRetryUpload} onFinalizeUpload={onFinalizeSourceUpload} onDeleteSource={onDeleteSource} onChanged={onSourcesChanged} /> : null}
        {stage === "identity_proof" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><IdentityProofing token={token} replicaId={replica.replica_id} sources={sources} onChanged={onIdentityChanged} onAuthError={onAuthError} /></Suspense> : null}
        {stage === "liveness" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><LivenessCapture scopeKey={JSON.stringify([token, replica.replica_id, consents.filter(receipt => receipt.scope === "capture" || receipt.scope === "storage").map(receipt => [receipt.consent_id, receipt.revoked_at, receipt.expires_at]), sources.filter(source => source.voice_role === "primary").map(source => [source.source_id, source.updated_at, source.state])])} expectedSourceId={candidateSourceId || sources.find(source => source.voice_role === "primary")?.source_id} consentActive={(comparisonSourceId ? privateConsentActive : sourceConsentActive) && replica.age_verified} challenge={challenge} loading={livenessLoading} onCheckReadiness={onCheckCaptureReadiness} onIssue={onIssueChallenge} onStartFace={onStartFaceSession} onPollFace={onPollFaceSession} onCancel={onCancelChallenge} onCreateUpload={onCreateLivenessUpload} onRetryUpload={onRetryUpload} onFinalize={onFinalizeLiveness} /></Suspense> : null}
        {!["stopped","self_test_blocked","complete","building"].includes(stage) && privateConsentActive && props.ownerUserId ? <details className="cvj-comparison-disclosure" onToggle={event=>setComparisonOpen(event.currentTarget.open)}><summary>{copy.comparisonSummary}</summary>{comparisonOpen?<Suspense fallback={<p>{copy.openingComparisonReview}</p>}><ComparisonReferenceReview key={comparisonScope} token={token} ownerUserId={props.ownerUserId} replicaId={replica.replica_id} expectedSourceId={comparisonSource || ""} onAuthError={onAuthError} onSelectionChanged={refreshPrivateSelection}/></Suspense>:null}</details>:null}
        {stage === "model_consent" ? <Suspense fallback={<DeferredVerificationStage stage={stage} />}><ModelConsentGate token={token} replica={replica} consents={consents} onChanged={onVerifiedConsentChanged} onAuthError={onAuthError} /></Suspense> : null}
        {stage === "review" ? <section className="cvj-review-stage" aria-label="Review voice evidence">{buildIntent?.state === "failed" || latestBuild?.state === "failed" ? <p className="cvj-platform-stop" role="alert"><strong>{copy.review.failedStrong}</strong><span>{copy.review.failedSpan}</span></p> : null}{reviewLoading && !review ? <p className="cvj-wait" role="status">{copy.review.loading}</p> : null}<Suspense fallback={<DeferredVerificationStage stage={stage} />}><ProcessingReview token={token} replicaId={replica.replica_id} sourceCount={sources.length} onAuthError={onAuthError} /></Suspense></section> : null}
        {stage === "building" ? <section className="cvj-build" aria-labelledby="cvj-build-title"><span className="cvj-build__signal"><VoiceField calm /></span><div><h1 id="cvj-build-title">{copy.building.title}</h1><p>{copy.building.body}</p></div><dl><div><dt>{copy.building.currentStateLabel}</dt><dd>{displayedBuildState === "retry" ? copy.building.stateRetry : displayedBuildState === "leased" ? copy.building.stateLeased : displayedBuildState === "building" ? copy.building.stateBuilding : copy.building.stateQueued}</dd></div><div><dt>{copy.building.completionLabel}</dt><dd>{copy.building.completionValue}</dd></div></dl>{onRefreshReview ? <button className="cvj-quiet" type="button" onClick={() => void onRefreshReview().catch(onAuthError)}>{copy.building.checkNow}</button> : null}</section> : null}
        {stage === "complete" ? <FocusedMessage icon="check" tone="ready" title={copy.complete.title} body={copy.complete.body} label={copy.complete.label} onAction={onContinue} /> : null}
      </main>
    </div>
  );
}
