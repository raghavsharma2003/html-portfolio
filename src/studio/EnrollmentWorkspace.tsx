import { useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import type {
  ConsentReceipt,
  ReplicaSource,
  SignedUpload,
  SourceKind,
} from "./types";

const REQUIRED_SCOPES = ["capture", "transcription", "storage"] as const;

const SOURCE_POLICY: Record<SourceKind, { label: string; accept: string; maxBytes: number; mimes: string[] }> = {
  audio: {
    label: "Audio recording",
    accept: ".wav,.mp3,.m4a,.webm,.ogg,.flac,audio/*",
    maxBytes: 268_435_456,
    mimes: ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp4", "audio/webm", "audio/ogg", "audio/flac", "audio/x-flac"],
  },
  video: {
    label: "Video recording",
    accept: ".mp4,.webm,.mov,.mkv,video/*",
    maxBytes: 536_870_912,
    mimes: ["video/mp4", "video/webm", "video/quicktime", "video/x-matroska"],
  },
  image: {
    label: "Image",
    accept: ".jpg,.jpeg,.png,.webp,.heic,.heif,image/*",
    maxBytes: 26_214_400,
    mimes: ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"],
  },
  text: {
    label: "Plain text or JSON",
    accept: ".txt,.json,text/plain,application/json",
    maxBytes: 10_485_760,
    mimes: ["text/plain", "application/json"],
  },
  document: {
    label: "Document",
    accept: ".pdf,.docx,.txt,.json,application/pdf",
    maxBytes: 52_428_800,
    mimes: ["application/pdf", "application/json", "text/plain", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  chat_archive: {
    label: "Chat archive",
    accept: ".zip,.json,.txt,application/zip,application/json,text/plain",
    maxBytes: 104_857_600,
    mimes: ["application/zip", "application/json", "text/plain", "application/octet-stream"],
  },
};

const IDENTITY_DOCUMENT_POLICY = {
  label: "Government ID (identity only)",
  accept: ".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf",
  maxBytes: 52_428_800,
  mimes: ["image/jpeg", "image/png", "application/pdf"],
} as const;
type UploadMode = SourceKind | "identity_document";

const MIME_BY_EXTENSION: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  webm: "audio/webm",
  ogg: "audio/ogg",
  flac: "audio/flac",
  mp4: "video/mp4",
  mov: "video/quicktime",
  mkv: "video/x-matroska",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  txt: "text/plain",
  json: "application/json",
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
};

function activeScopes(consents: ConsentReceipt[]) {
  const now = Date.now();
  return new Set(
    consents
      .filter((receipt) => !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > now))
      .map((receipt) => receipt.scope),
  );
}

function hasEnrollmentConsent(consents: ConsentReceipt[]) {
  const active = activeScopes(consents);
  return REQUIRED_SCOPES.every((scope) => active.has(scope));
}

function bytesLabel(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(bytes >= 10 * 1024 ** 2 ? 0 : 1)} MB`;
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function normalizedMime(file: File, kind: SourceKind) {
  const declared = file.type.split(";", 1)[0].trim().toLowerCase();
  if (SOURCE_POLICY[kind].mimes.includes(declared)) return declared;
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const inferred = extension === "webm"
    ? kind === "video" ? "video/webm" : "audio/webm"
    : MIME_BY_EXTENSION[extension] || "";
  return SOURCE_POLICY[kind].mimes.includes(inferred) ? inferred : declared;
}

function sourceError(file: File, kind: SourceKind, mime: string) {
  const policy = SOURCE_POLICY[kind];
  if (file.size < 1) return "This file is empty.";
  if (file.size > policy.maxBytes) return `This ${policy.label.toLowerCase()} exceeds the ${bytesLabel(policy.maxBytes)} limit.`;
  if (!policy.mimes.includes(mime)) return `This file type is not accepted as ${policy.label.toLowerCase()}.`;
  return "";
}

function identityDocumentInput(file: File) {
  const declared = String(file.type || "").split(";", 1)[0].trim().toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const mime = IDENTITY_DOCUMENT_POLICY.mimes.includes(declared as typeof IDENTITY_DOCUMENT_POLICY.mimes[number])
    ? declared
    : MIME_BY_EXTENSION[extension] || declared;
  const kind: SourceKind = mime === "application/pdf" ? "document" : "image";
  const problem = file.size < 1
    ? "This file is empty."
    : file.size > IDENTITY_DOCUMENT_POLICY.maxBytes
      ? `This identity document exceeds the ${bytesLabel(IDENTITY_DOCUMENT_POLICY.maxBytes)} limit.`
      : !IDENTITY_DOCUMENT_POLICY.mimes.includes(mime as typeof IDENTITY_DOCUMENT_POLICY.mimes[number])
        ? "Identity evidence must be a JPEG, PNG, or PDF."
        : "";
  return { kind, mime, problem };
}

function SourceState({ state }: { state: ReplicaSource["state"] }) {
  const labels: Record<ReplicaSource["state"], string> = {
    pending_upload: "Upload pending",
    uploaded: "Uploaded",
    quarantined: "Private quarantine",
    processing: "Processing",
    ready: "Ready",
    rejected: "Rejected",
    deleting: "Erasing",
  };
  return <span className={`source-state source-${state}`}><i />{labels[state]}</span>;
}

interface Props {
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  loading: boolean;
  onGrantConsent: () => Promise<void>;
  onRevokeConsent: () => Promise<void>;
  onCreateUpload: (input: {
    kind: SourceKind;
    purpose: "memory" | "identity_document";
    mime: string;
    byteSize: number;
    sha256: string;
    containsThirdParties: boolean;
  }) => Promise<{ source: ReplicaSource; upload: SignedUpload }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload }>;
  onFinalizeUpload: (sourceId: string) => Promise<ReplicaSource>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
}

export default function EnrollmentWorkspace({
  consents,
  sources,
  loading,
  onGrantConsent,
  onRevokeConsent,
  onCreateUpload,
  onRetryUpload,
  onFinalizeUpload,
  onDeleteSource,
}: Props) {
  const [attestations, setAttestations] = useState([false, false, false, false]);
  const [consentBusy, setConsentBusy] = useState(false);
  const [consentError, setConsentError] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [withdrawText, setWithdrawText] = useState("");
  const [uploadMode, setUploadMode] = useState<UploadMode>("audio");
  const [file, setFile] = useState<File | null>(null);
  const [containsThirdParties, setContainsThirdParties] = useState<boolean | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReplicaSource | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const retryFiles = useRef(new Map<string, File>());
  // A successful PUT and a successful manifest finalization are two distinct
  // durability boundaries. Keep the exact file plus this marker until both
  // finish so a transient finalize error never forces an impossible re-PUT to
  // an x-upsert=false object that already exists.
  const uploadedObjects = useRef(new Set<string>());

  const consentActive = hasEnrollmentConsent(consents);
  const latestExpiry = useMemo(() => {
    const active = consents.filter((receipt) => !receipt.revoked_at && receipt.expires_at);
    return active.sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)))[0]?.expires_at ?? null;
  }, [consents]);

  useEffect(() => {
    if (!uploadBusy) return;
    const guard = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", guard);
    return () => window.removeEventListener("beforeunload", guard);
  }, [uploadBusy]);

  useEffect(() => {
    if (!withdrawing && !deleteTarget) return;
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || consentBusy || deleteBusy) return;
      setWithdrawing(false);
      setDeleteTarget(null);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [consentBusy, deleteBusy, deleteTarget, withdrawing]);

  function toggleAttestation(index: number) {
    setAttestations((current) => current.map((checked, item) => item === index ? !checked : checked));
  }

  async function grant() {
    setConsentError("");
    setConsentBusy(true);
    try {
      await onGrantConsent();
    } catch (cause) {
      setConsentError(cause instanceof Error ? cause.message : "Could not record consent");
    } finally {
      setConsentBusy(false);
    }
  }

  async function revoke() {
    setConsentError("");
    setConsentBusy(true);
    try {
      await onRevokeConsent();
      setWithdrawing(false);
      setWithdrawText("");
    } catch (cause) {
      setConsentError(cause instanceof Error ? cause.message : "Could not withdraw permission");
    } finally {
      setConsentBusy(false);
    }
  }

  async function upload() {
    if (!file || containsThirdParties === null) return;
    const identityInput = uploadMode === "identity_document" ? identityDocumentInput(file) : null;
    const kind = identityInput?.kind || uploadMode as SourceKind;
    const mime = identityInput?.mime || normalizedMime(file, kind);
    const problem = identityInput?.problem || sourceError(file, kind, mime);
    if (problem) {
      setUploadError(problem);
      return;
    }
    setUploadError("");
    setUploadBusy(true);
    setUploadProgress(0);
    try {
      setUploadPhase("Computing integrity fingerprint");
      const sha256 = await sha256File(file, setUploadProgress);
      setUploadPhase("Authorizing private upload");
      setUploadProgress(0);
      const result = await onCreateUpload({
        kind,
        purpose: uploadMode === "identity_document" ? "identity_document" : "memory",
        mime,
        byteSize: file.size,
        sha256,
        containsThirdParties,
      });
      retryFiles.current.set(result.source.source_id, file);
      setPendingRetryId(result.source.source_id);
      setUploadPhase("Uploading directly to private storage");
      await putSignedUpload(file, result.upload, setUploadProgress);
      uploadedObjects.current.add(result.source.source_id);
      setUploadPhase("Verifying stored file");
      await onFinalizeUpload(result.source.source_id);
      uploadedObjects.current.delete(result.source.source_id);
      retryFiles.current.delete(result.source.source_id);
      setPendingRetryId(null);
      setUploadPhase("Private source received");
      setUploadProgress(100);
      setFile(null);
      setContainsThirdParties(null);
      if (fileRef.current) fileRef.current.value = "";
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Upload could not be completed");
      setUploadPhase("");
    } finally {
      setUploadBusy(false);
    }
  }

  async function retryUpload(sourceId: string) {
    const retryFile = retryFiles.current.get(sourceId);
    if (!retryFile) {
      setUploadError("The original browser file is no longer available. Erase this pending record and start a new upload.");
      return;
    }
    setUploadError("");
    setUploadBusy(true);
    setUploadProgress(0);
    try {
      if (!uploadedObjects.current.has(sourceId)) {
        setUploadPhase("Renewing private upload authorization");
        const result = await onRetryUpload(sourceId);
        setUploadPhase("Retrying private upload");
        await putSignedUpload(retryFile, result.upload, setUploadProgress);
        uploadedObjects.current.add(sourceId);
      }
      setUploadPhase("Verifying stored file");
      await onFinalizeUpload(sourceId);
      uploadedObjects.current.delete(sourceId);
      retryFiles.current.delete(sourceId);
      setPendingRetryId(null);
      setUploadPhase("Private source received");
      setUploadProgress(100);
      setFile(null);
      setContainsThirdParties(null);
      if (fileRef.current) fileRef.current.value = "";
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Upload retry could not be completed");
      setUploadPhase("");
    } finally {
      setUploadBusy(false);
    }
  }

  async function verifyStoredSource(sourceId: string) {
    setUploadError("");
    setUploadBusy(true);
    setUploadPhase("Checking private storage");
    try {
      await onFinalizeUpload(sourceId);
      uploadedObjects.current.delete(sourceId);
      retryFiles.current.delete(sourceId);
      if (pendingRetryId === sourceId) setPendingRetryId(null);
      setUploadPhase("Private source received");
      setUploadProgress(100);
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      setUploadError(cause instanceof Error
        ? cause.message
        : "No complete stored upload could be verified. Retry with the original file or erase this record.");
      setUploadPhase("");
    } finally {
      setUploadBusy(false);
    }
  }

  async function removeSource() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setUploadError("");
    try {
      await onDeleteSource(deleteTarget.source_id);
      uploadedObjects.current.delete(deleteTarget.source_id);
      retryFiles.current.delete(deleteTarget.source_id);
      if (pendingRetryId === deleteTarget.source_id) {
        setPendingRetryId(null);
        setFile(null);
        setContainsThirdParties(null);
        if (fileRef.current) fileRef.current.value = "";
      }
      setDeleteTarget(null);
      setDeleteText("");
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : "Source erasure could not be started");
    } finally {
      setDeleteBusy(false);
    }
  }

  if (loading) {
    return (
      <section className="enrollment-loading" aria-label="Loading consent and private sources">
        <div className="skeleton skeleton-enrollment" />
        <div className="skeleton skeleton-enrollment" />
      </section>
    );
  }

  return (
    <section id="enrollment-workspace" className="enrollment-section" aria-labelledby="enrollment-title">
      <div className="section-heading enrollment-heading">
        <div>
          <p className="eyebrow">Controlled enrollment</p>
          <h2 id="enrollment-title">Permission before evidence</h2>
        </div>
        <p>Account consent opens private source intake. Biometric modeling, training, inference, and sharing stay locked.</p>
      </div>

      <article className={`consent-panel ${consentActive ? "consent-active" : ""}`}>
        <div className="panel-index">01</div>
        <div className="consent-content">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Source permissions</p>
              <h3>{consentActive ? "Enrollment permission is active" : "Review and attest"}</h3>
            </div>
            <span className={`permission-badge ${consentActive ? "permission-on" : ""}`}>
              <i />{consentActive ? "Recorded" : "Not granted"}
            </span>
          </div>

          {consentActive ? (
            <>
              <p className="consent-lede">
                You permitted Vyakti to receive, transcribe, and privately store sources for this replica.
                This is not permission for biometric modeling, voice training, generation, sharing, telephony, or model improvement.
              </p>
              <div className="receipt-grid">
                {REQUIRED_SCOPES.map((scope) => (
                  <div key={scope}><span>✓</span><strong>{scope}</strong><small>account attestation</small></div>
                ))}
              </div>
              <div className="receipt-footer">
                <span>Policy-bound receipt{latestExpiry ? ` · expires ${dateLabel(latestExpiry)}` : ""}</span>
                <button className="quiet-danger" type="button" onClick={() => setWithdrawing(true)}>Withdraw these permissions</button>
              </div>
            </>
          ) : (
            <>
              <p className="consent-lede">
                These permissions cover only source intake. You can withdraw them later. Withdrawal makes the replica non-operational
                and queues its private sources for erasure.
              </p>
              <div className="scope-grid" aria-label="Permissions being requested">
                <div><strong>Capture</strong><span>Receive files you deliberately select</span></div>
                <div><strong>Transcription</strong><span>Extract searchable words from permitted sources</span></div>
                <div><strong>Storage</strong><span>Keep originals and controlled derivatives privately</span></div>
              </div>
              <fieldset className="attestation-list">
                <legend>Confirm each statement yourself</legend>
                {[
                  "I am creating a replica of myself, not another person.",
                  "I am 18 years old or older.",
                  "I own or have permission to use every source I will add.",
                  "I understand generated audio must be disclosed as synthetic.",
                ].map((label, index) => (
                  <label key={label}>
                    <input type="checkbox" checked={attestations[index]} onChange={() => toggleAttestation(index)} />
                    <span className="custom-check" aria-hidden="true">✓</span>
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <button
                className="button primary-button consent-button"
                type="button"
                disabled={consentBusy || !attestations.every(Boolean)}
                onClick={() => void grant()}
              >
                {consentBusy ? "Recording permission" : "Record source permissions"}
              </button>
            </>
          )}
          {consentError && <p className="inline-error" role="alert">{consentError}</p>}
        </div>
      </article>

      <article className={`evidence-panel ${consentActive ? "evidence-open" : "evidence-locked"}`}>
        <div className="panel-index">02</div>
        <div className="evidence-content">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Private evidence</p>
              <h3>Add source material</h3>
            </div>
            <span className={`permission-badge ${consentActive ? "permission-on" : ""}`}>
              <i />{consentActive ? "Private intake open" : "Consent required"}
            </span>
          </div>

          {!consentActive ? (
            <div className="evidence-gate">
              <span className="large-lock" aria-hidden="true" />
              <div><strong>No file can be selected yet</strong><p>Complete the four attestations above to create a policy-bound source receipt first.</p></div>
            </div>
          ) : (
            <>
              <div className="upload-grid">
                <label>
                  <span className="field-label">Source type</span>
                  <select
                    className="studio-select"
                    value={uploadMode}
                    disabled={uploadBusy || Boolean(pendingRetryId)}
                    onChange={(event) => {
                      const next = event.target.value as UploadMode;
                      setUploadMode(next);
                      setFile(null);
                      setContainsThirdParties(next === "identity_document" ? false : null);
                      setUploadError("");
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    <option value="identity_document">{IDENTITY_DOCUMENT_POLICY.label}</option>
                    {Object.entries(SOURCE_POLICY).map(([value, policy]) => <option key={value} value={value}>{policy.label}</option>)}
                  </select>
                </label>
                <label className="file-picker">
                  <input
                    ref={fileRef}
                    type="file"
                    accept={uploadMode === "identity_document" ? IDENTITY_DOCUMENT_POLICY.accept : SOURCE_POLICY[uploadMode].accept}
                    disabled={uploadBusy || Boolean(pendingRetryId)}
                    onChange={(event) => {
                      setFile(event.target.files?.[0] ?? null);
                      setUploadError("");
                    }}
                  />
                  <span className="file-icon" aria-hidden="true">↑</span>
                  <span className="file-picker-copy">
                    <strong>{file ? file.name : "Choose one file"}</strong>
                    <small>{file ? bytesLabel(file.size) : `Up to ${bytesLabel(uploadMode === "identity_document" ? IDENTITY_DOCUMENT_POLICY.maxBytes : SOURCE_POLICY[uploadMode].maxBytes)}`}</small>
                  </span>
                  <span className="file-action">Browse</span>
                </label>
              </div>

              {uploadMode !== "identity_document" && <fieldset className="people-declaration">
                <legend>Whose voice, face, or private information appears?</legend>
                <label>
                  <input type="radio" name="people" checked={containsThirdParties === false} onChange={() => setContainsThirdParties(false)} />
                  <span><strong>Only mine</strong><small>No other identifiable person appears</small></span>
                </label>
                <label>
                  <input type="radio" name="people" checked={containsThirdParties === true} onChange={() => setContainsThirdParties(true)} />
                  <span><strong>Other people appear</strong><small>I have the right to use this source</small></span>
                </label>
              </fieldset>}

              {containsThirdParties === true && (
                <p className="third-party-note" role="status">
                  This source will stay in quarantine. Other people must be separated from your evidence before any identity processing can be considered.
                </p>
              )}

              {uploadMode === "identity_document" && (
                <p className="identity-source-note" role="status">
                  Identity-only mode bypasses memory extraction and model-training queues. The document is available only to the independent identity and live-match gates, then queued for erasure.
                </p>
              )}

              <div className="upload-integrity">
                <span className="fingerprint-icon" aria-hidden="true">#</span>
                <p><strong>Integrity checked in your browser.</strong> The filename is not retained. A SHA-256 fingerprint is computed before a short-lived private upload URL is issued.</p>
              </div>

              {(uploadBusy || uploadPhase) && (
                <div className="upload-status" role="status">
                  <div><strong>{uploadPhase}</strong><span>{uploadPhase.includes("Uploading") ? `${uploadProgress}%` : "Please keep this page open"}</span></div>
                  <div className={`upload-track ${uploadPhase.includes("Computing") || uploadPhase.includes("Authorizing") || uploadPhase.includes("Verifying") ? "indeterminate" : ""}`}>
                    <span style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}
              {uploadError && <p className="inline-error" role="alert">{uploadError}</p>}
              <button
                className="button primary-button upload-button"
                type="button"
                disabled={uploadBusy || !file || containsThirdParties === null}
                onClick={() => void (pendingRetryId ? retryUpload(pendingRetryId) : upload())}
              >
                {uploadBusy
                  ? "Securing source"
                  : pendingRetryId && uploadedObjects.current.has(pendingRetryId)
                    ? "Retry stored-file verification"
                    : pendingRetryId
                      ? "Retry interrupted upload"
                      : "Upload to private intake"}
              </button>

              <div className="source-ledger">
                <div className="source-ledger-heading">
                  <div><p className="eyebrow">Source ledger</p><h4>{sources.length ? `${sources.length} private source${sources.length === 1 ? "" : "s"}` : "No sources yet"}</h4></div>
                  <span>Original names are not stored</span>
                </div>
                {sources.length > 0 && (
                  <div className="source-list">
                    {sources.map((source) => (
                      <div className="source-row" key={source.source_id}>
                        <span className="source-kind">{source.kind.slice(0, 2).toUpperCase()}</span>
                        <div className="source-copy">
                          <strong>{source.capture_mode === "identity_document" ? "Government ID (identity only)" : SOURCE_POLICY[source.kind].label}</strong>
                          <span>{bytesLabel(source.byte_size)} · added {dateLabel(source.created_at)}{source.contains_third_parties ? " · includes others" : ""}</span>
                          {source.rejection_code && <small>{source.rejection_code.replaceAll("_", " ")}</small>}
                        </div>
                        <SourceState state={source.state} />
                        <span className="source-actions">
                          {source.state === "pending_upload" && retryFiles.current.has(source.source_id) && (
                            <button className="source-retry" type="button" disabled={uploadBusy} onClick={() => void retryUpload(source.source_id)}>
                              {uploadedObjects.current.has(source.source_id) ? "Verify" : "Retry"}
                            </button>
                          )}
                          {source.state === "pending_upload"
                            && source.capture_mode !== "live_challenge"
                            && !retryFiles.current.has(source.source_id) && (
                            <button className="source-retry" type="button" disabled={uploadBusy} onClick={() => void verifyStoredSource(source.source_id)}>
                              Check storage
                            </button>
                          )}
                          <button
                            className="source-delete"
                            type="button"
                            disabled={source.state === "deleting" || uploadBusy}
                            onClick={() => setDeleteTarget(source)}
                          >
                            Remove
                          </button>
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </article>

      {withdrawing && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !consentBusy && setWithdrawing(false)}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="withdraw-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-stop">PAUSE</div>
            <h2 id="withdraw-title">Withdraw source permissions?</h2>
            <p>
              The replica becomes non-operational. Capture and storage permission end immediately, and every private source is queued for erasure.
              You can grant new permission later, but erased sources cannot be recovered.
            </p>
            <label className="field-label" htmlFor="withdraw-confirmation">Type WITHDRAW to confirm</label>
            <input id="withdraw-confirmation" className="field" autoFocus autoComplete="off" value={withdrawText} onChange={(event) => setWithdrawText(event.target.value.toUpperCase())} />
            <div className="modal-actions">
              <button className="button secondary-button" disabled={consentBusy} onClick={() => setWithdrawing(false)}>Keep permissions</button>
              <button className="button destructive-button" disabled={consentBusy || withdrawText !== "WITHDRAW"} onClick={() => void revoke()}>
                {consentBusy ? "Withdrawing" : "Withdraw and erase"}
              </button>
            </div>
          </section>
        </div>
      )}

      {deleteTarget && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !deleteBusy && setDeleteTarget(null)}>
          <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="delete-source-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-stop">ERASE</div>
            <h2 id="delete-source-title">Erase this private source?</h2>
            <p>
              The original file is deleted from private storage. Claims and model versions derived from it must be invalidated and rebuilt.
              This action cannot be undone.
            </p>
            <label className="field-label" htmlFor="delete-source-confirmation">Type ERASE to confirm</label>
            <input id="delete-source-confirmation" className="field" autoFocus autoComplete="off" value={deleteText} onChange={(event) => setDeleteText(event.target.value.toUpperCase())} />
            <div className="modal-actions">
              <button className="button secondary-button" disabled={deleteBusy} onClick={() => setDeleteTarget(null)}>Keep source</button>
              <button className="button destructive-button" disabled={deleteBusy || deleteText !== "ERASE"} onClick={() => void removeSource()}>
                {deleteBusy ? "Erasing" : "Erase source"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
