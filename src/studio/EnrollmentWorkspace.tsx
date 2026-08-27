import { useEffect, useMemo, useRef, useState } from "react";
import { putSignedUpload, sha256File } from "./enrollmentApi";
import {
  deriveEnrollmentLanguageReadiness,
  ENROLLMENT_LANGUAGE_LABELS,
  missingHindiFamily,
  parseEnrollmentLanguageLabels,
  voiceEnrollmentSources,
  type EnrollmentLanguage,
  type EnrollmentLanguageChoice,
  type EnrollmentLanguageLabels,
} from "./enrollmentLanguage";
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
    // Windows' file dialog relies much more heavily on extensions than MIME
    // wildcards. Keep the wildcard for unusual browser registrations, but
    // name every format our ingestion lane can actually process so recordings
    // do not disappear from the picker.
    accept: ".wav,.wave,.mp3,.mpga,.mpeg,.m4a,.aac,.aif,.aiff,.ogg,.oga,.opus,.flac,.webm,.weba,.amr,.wma,audio/*",
    maxBytes: 1_073_741_824,
    mimes: [
      "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave",
      "audio/mpeg", "audio/mp3", "audio/mpeg3", "audio/x-mpeg-3", "audio/x-mp3",
      "audio/mp4", "audio/x-m4a", "audio/aac", "audio/x-aac",
      "audio/aiff", "audio/x-aiff", "audio/ogg", "audio/opus",
      "audio/flac", "audio/x-flac", "audio/webm", "audio/amr", "audio/x-ms-wma",
    ],
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

const CALIBRATION_COPY: Record<Exclude<EnrollmentLanguage, "english">, { title: string; prompt: string }> = {
  hindi: {
    title: "Hindi calibration",
    prompt: "नमस्ते, मैं अपनी सामान्य आवाज़ और रफ़्तार में बोल रहा हूँ। जब मैं कोई कठिन बात समझाता हूँ, तो पहले उसका सरल अर्थ बताता हूँ, फिर एक छोटा उदाहरण देता हूँ। मुझे साफ़ और स्वाभाविक ढंग से बात करना पसंद है, ताकि सुनने वाला बिना जल्दबाज़ी के समझ सके।",
  },
  hinglish: {
    title: "Hinglish calibration",
    prompt: "Namaste, main apni normal voice aur pace mein bol raha hoon. Jab main koi difficult idea explain karta hoon, pehle uska simple meaning batata hoon, phir ek chhota example deta hoon. Mere liye clear rehna important hai, isliye main naturally Hindi aur English ke beech switch karta hoon.",
  },
};

const MIME_BY_EXTENSION: Record<string, string> = {
  wav: "audio/wav",
  wave: "audio/wav",
  mp3: "audio/mpeg",
  mpga: "audio/mpeg",
  mpeg: "audio/mpeg",
  m4a: "audio/mp4",
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  webm: "audio/webm",
  weba: "audio/webm",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  opus: "audio/opus",
  flac: "audio/flac",
  amr: "audio/amr",
  wma: "audio/x-ms-wma",
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

function fileKey(file: File) {
  return [file.name, file.size, file.lastModified, file.type].join(":");
}

function durationLabel(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainder = rounded % 60;
  if (hours) return `${hours}h ${minutes}m`;
  return `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function mediaDuration(file: File) {
  return new Promise<number | null>((resolve) => {
    const media = document.createElement(file.type.startsWith("video/") ? "video" : "audio");
    const url = URL.createObjectURL(file);
    const finish = (value: number | null) => {
      media.removeAttribute("src");
      media.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    media.preload = "metadata";
    media.onloadedmetadata = () => finish(Number.isFinite(media.duration) ? media.duration : null);
    media.onerror = () => finish(null);
    media.src = url;
  });
}

function storedLanguageLabels(replicaId: string) {
  if (typeof window === "undefined") return {};
  try {
    return parseEnrollmentLanguageLabels(window.localStorage.getItem(`vyakti:enrollment-languages:${replicaId}`));
  } catch {
    return {};
  }
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
    quarantined: "Processing queued",
    processing: "Processing",
    ready: "Ready",
    rejected: "Rejected",
    deleting: "Erasing",
  };
  return <span className={`source-state source-${state}`}><i />{labels[state]}</span>;
}

interface Props {
  replicaId: string;
  /** Build-time-only internal test surface. The backend still records the
   * source grant before accepting a byte. */
  testEnvironment?: boolean;
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
  replicaId,
  testEnvironment = false,
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
  const [files, setFiles] = useState<File[]>([]);
  const file = files[0] || null;
  const [fileLanguages, setFileLanguages] = useState<Record<string, EnrollmentLanguageChoice>>({});
  const [fileDurations, setFileDurations] = useState<Record<string, number | null>>({});
  const [sourceLanguages, setSourceLanguages] = useState<EnrollmentLanguageLabels>(() => storedLanguageLabels(replicaId));
  const [calibrationLanguage, setCalibrationLanguage] = useState<Exclude<EnrollmentLanguage, "english"> | null>(null);
  const [activeFileIndex, setActiveFileIndex] = useState(-1);
  const [containsThirdParties, setContainsThirdParties] = useState<boolean | null>(testEnvironment ? false : null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadPhase, setUploadPhase] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [pendingRetryId, setPendingRetryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ReplicaSource | null>(null);
  const [deleteText, setDeleteText] = useState("");
  const [deleteBusy, setDeleteBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const durationProbe = useRef(0);
  const retryFiles = useRef(new Map<string, File>());
  // A successful PUT and a successful manifest finalization are two distinct
  // durability boundaries. Keep the exact file plus this marker until both
  // finish so a transient finalize error never forces an impossible re-PUT to
  // an x-upsert=false object that already exists.
  const uploadedObjects = useRef(new Set<string>());

  const consentActive = hasEnrollmentConsent(consents);
  const intakeOpen = testEnvironment || consentActive;
  const latestExpiry = useMemo(() => {
    const active = consents.filter((receipt) => !receipt.revoked_at && receipt.expires_at);
    return active.sort((a, b) => String(b.expires_at).localeCompare(String(a.expires_at)))[0]?.expires_at ?? null;
  }, [consents]);
  const selectedLanguageChoices = useMemo(
    () => files.map((selectedFile) => fileLanguages[fileKey(selectedFile)] || "unknown"),
    [fileLanguages, files],
  );
  const languageReadiness = useMemo(
    () => deriveEnrollmentLanguageReadiness(sources, sourceLanguages, selectedLanguageChoices),
    [selectedLanguageChoices, sourceLanguages, sources],
  );
  const missingHindiReferences = useMemo(() => missingHindiFamily(languageReadiness), [languageReadiness]);
  const voiceSources = useMemo(() => voiceEnrollmentSources(sources), [sources]);
  const labeledVoiceSourceCount = voiceSources.filter((source) => sourceLanguages[source.source_id] && sourceLanguages[source.source_id] !== "unknown").length;
  const isVoiceUpload = uploadMode === "audio" || uploadMode === "video";

  useEffect(() => {
    try {
      window.localStorage.setItem(`vyakti:enrollment-languages:${replicaId}`, JSON.stringify(sourceLanguages));
    } catch {
      // Browser storage is a convenience for owner labels, never a readiness authority.
    }
  }, [replicaId, sourceLanguages]);

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

  function selectFiles(nextFiles: File[]) {
    const probe = ++durationProbe.current;
    const defaultLanguage: EnrollmentLanguageChoice = calibrationLanguage || "unknown";
    setFiles(nextFiles);
    setFileLanguages(Object.fromEntries(nextFiles.map((selectedFile) => [fileKey(selectedFile), defaultLanguage])));
    setFileDurations({});
    setUploadError("");
    if (!isVoiceUpload || !nextFiles.length) return;
    void Promise.all(nextFiles.map(async (selectedFile) => [fileKey(selectedFile), await mediaDuration(selectedFile)] as const))
      .then((entries) => {
        if (durationProbe.current === probe) setFileDurations(Object.fromEntries(entries));
      });
  }

  function resetSelectedFiles() {
    durationProbe.current += 1;
    setFiles([]);
    setFileLanguages({});
    setFileDurations({});
    if (fileRef.current) fileRef.current.value = "";
  }

  function markSourceLanguage(sourceId: string, language: EnrollmentLanguageChoice) {
    setSourceLanguages((current) => ({ ...current, [sourceId]: language }));
  }

  function releaseTerminalRetry(cause: unknown) {
    const failed = (cause as { data?: { source?: ReplicaSource } } | null)?.data?.source;
    if (!failed || failed.state === "pending_upload") return;
    uploadedObjects.current.delete(failed.source_id);
    retryFiles.current.delete(failed.source_id);
    setPendingRetryId((current) => current === failed.source_id ? null : current);
  }

  function openCalibration(language: Exclude<EnrollmentLanguage, "english">) {
    setUploadMode("audio");
    resetSelectedFiles();
    setContainsThirdParties(null);
    setUploadError("");
    setCalibrationLanguage(language);
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
    if (!files.length || containsThirdParties === null) return;
    if (uploadMode === "identity_document" && files.length !== 1) return;
    for (const candidate of files) {
      const identityInput = uploadMode === "identity_document" ? identityDocumentInput(candidate) : null;
      const kind = identityInput?.kind || uploadMode as SourceKind;
      const mime = identityInput?.mime || normalizedMime(candidate, kind);
      const problem = identityInput?.problem || sourceError(candidate, kind, mime);
      if (problem) {
        setUploadError(`${candidate.name}: ${problem}`);
        return;
      }
    }
    setUploadError("");
    setUploadBusy(true);
    setUploadProgress(0);
    try {
      for (const [index, current] of files.entries()) {
        setActiveFileIndex(index);
        const identityInput = uploadMode === "identity_document" ? identityDocumentInput(current) : null;
        const kind = identityInput?.kind || uploadMode as SourceKind;
        const mime = identityInput?.mime || normalizedMime(current, kind);
        const prefix = files.length > 1 ? `${index + 1} of ${files.length}: ` : "";
        setUploadPhase(`${prefix}Computing integrity fingerprint`);
        const sha256 = await sha256File(current, setUploadProgress);
        setUploadPhase(`${prefix}Authorizing private upload`);
        setUploadProgress(0);
        const result = await onCreateUpload({
          kind,
          purpose: uploadMode === "identity_document" ? "identity_document" : "memory",
          mime,
          byteSize: current.size,
          sha256,
          containsThirdParties,
        });
        if (kind === "audio" || kind === "video") {
          markSourceLanguage(result.source.source_id, fileLanguages[fileKey(current)] || "unknown");
        }
        retryFiles.current.set(result.source.source_id, current);
        setPendingRetryId(result.source.source_id);
        setUploadPhase(`${prefix}Uploading directly to private storage`);
        await putSignedUpload(current, result.upload, setUploadProgress);
        uploadedObjects.current.add(result.source.source_id);
        setUploadPhase(`${prefix}Verifying stored file`);
        await onFinalizeUpload(result.source.source_id);
        uploadedObjects.current.delete(result.source.source_id);
        retryFiles.current.delete(result.source.source_id);
        setPendingRetryId(null);
      }
      setUploadPhase("Upload complete. Processing queued.");
      setUploadProgress(100);
      resetSelectedFiles();
      setContainsThirdParties(null);
      setCalibrationLanguage(null);
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      releaseTerminalRetry(cause);
      setUploadError(cause instanceof Error ? cause.message : "Upload could not be completed");
      setUploadPhase("");
    } finally {
      setUploadBusy(false);
      setActiveFileIndex(-1);
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
      setUploadPhase("Upload complete. Processing queued.");
      setUploadProgress(100);
      resetSelectedFiles();
      setContainsThirdParties(null);
      setCalibrationLanguage(null);
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      releaseTerminalRetry(cause);
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
      setUploadPhase("Upload complete. Processing queued.");
      setUploadProgress(100);
      setTimeout(() => setUploadPhase(""), 2200);
    } catch (cause) {
      releaseTerminalRetry(cause);
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
        resetSelectedFiles();
        setContainsThirdParties(null);
      }
      setSourceLanguages((current) => {
        const next = { ...current };
        delete next[deleteTarget.source_id];
        return next;
      });
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
      <section className="enrollment-loading" aria-label={testEnvironment ? "Opening source intake" : "Loading consent and private sources"}>
        <div className="skeleton skeleton-enrollment" />
        {!testEnvironment && <div className="skeleton skeleton-enrollment" />}
      </section>
    );
  }

  return (
    <section id="enrollment-workspace" className="enrollment-section" aria-labelledby="enrollment-title">
      <div className="section-heading enrollment-heading">
        <div>
          {!testEnvironment && <p className="eyebrow">Controlled enrollment</p>}
          <h2 id="enrollment-title">{testEnvironment ? "Add audio, video, screenshots, or documents" : "Permission first, then anything you upload"}</h2>
        </div>
        {!testEnvironment && (
          <p>Account consent opens private source intake. Biometric modeling, training, inference, and sharing stay locked.</p>
        )}
      </div>

      {!testEnvironment && <article className={`consent-panel ${consentActive ? "consent-active" : ""}`}>
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
      </article>}

      <article className={`evidence-panel ${intakeOpen ? "evidence-open" : "evidence-locked"}`}>
        <div className="evidence-content">
          <div className="panel-title-row">
            <div>
              <p className="eyebrow">Private evidence</p>
              <h3>Add source material</h3>
            </div>
            {!testEnvironment && <span className={`permission-badge ${intakeOpen ? "permission-on" : ""}`}>
              <i />{intakeOpen ? "Private intake open" : "Consent required"}
            </span>}
          </div>

          {!intakeOpen ? (
            <div className="evidence-gate">
              <span className="large-lock" aria-hidden="true" />
              <div><strong>No file can be selected yet</strong><p>Complete the four attestations above to create a policy-bound source receipt first.</p></div>
            </div>
          ) : (
            <>
              {!testEnvironment && <section className="language-readiness" aria-labelledby="language-readiness-title">
                <div className="language-readiness-head">
                  <div>
                    <h4 id="language-readiness-title">Voice reference coverage</h4>
                    <p>See which languages have a labeled voice source that finished private processing.</p>
                  </div>
                  <span>{labeledVoiceSourceCount} of {voiceSources.length} voice sources labeled</span>
                </div>
                <ul className="language-readiness-list">
                  {languageReadiness.map((item) => (
                    <li key={item.language}>
                      <strong>{ENROLLMENT_LANGUAGE_LABELS[item.language]}</strong>
                      <span>{item.sourceCount
                        ? `${item.sourceCount} labeled source${item.sourceCount === 1 ? "" : "s"}`
                        : item.selectedCount
                          ? `${item.selectedCount} file${item.selectedCount === 1 ? "" : "s"} waiting to upload`
                          : "No source is labeled for this language"}</span>
                      <span className={`language-state language-state-${item.state}`}>{item.label}</span>
                    </li>
                  ))}
                </ul>
                <p className="language-readiness-boundary">
                  Coverage uses labels you add in this browser and the source processing state. It is not automatic language identification or a promise of synthesis quality.
                </p>

                {missingHindiReferences.length > 0 && (
                  <div className="language-gap" role="status">
                    <div>
                      <strong>{missingHindiReferences.length === 2
                        ? "Hindi and Hinglish are not confirmed yet"
                        : `${ENROLLMENT_LANGUAGE_LABELS[missingHindiReferences[0]]} is not confirmed yet`}</strong>
                      <p>
                        {voiceSources.length && labeledVoiceSourceCount < voiceSources.length
                          ? "One or more existing voice sources have no language label. Label them in the source ledger, or add a short calibration."
                          : "Add a short, clean sample in the missing language before you judge that language in the clone."}
                      </p>
                    </div>
                    <div className="language-gap-actions">
                      {missingHindiReferences.includes("hindi") && (
                        <button className="button secondary-button" type="button" onClick={() => openCalibration("hindi")}>Add Hindi calibration</button>
                      )}
                      {missingHindiReferences.includes("hinglish") && (
                        <button className="button secondary-button" type="button" onClick={() => openCalibration("hinglish")}>Add Hinglish calibration</button>
                      )}
                    </div>
                  </div>
                )}

                {calibrationLanguage && (
                  <div className="calibration-guide">
                    <div className="calibration-guide-head">
                      <div>
                        <strong>{CALIBRATION_COPY[calibrationLanguage].title}</strong>
                        <p>Start with 30 to 60 seconds in your normal pace, accent, and speaking style.</p>
                      </div>
                      <button className="quiet-action" type="button" onClick={() => setCalibrationLanguage(null)}>Close guide</button>
                    </div>
                    <blockquote lang={calibrationLanguage === "hindi" ? "hi" : "en-IN"}>{CALIBRATION_COPY[calibrationLanguage].prompt}</blockquote>
                    <p className="calibration-honesty">More hours do not automatically improve similarity. A clean, representative sample is more useful for this language check.</p>
                    <button
                      className="button secondary-button"
                      type="button"
                      onClick={() => fileRef.current?.click()}
                    >
                      Choose calibration recording
                    </button>
                  </div>
                )}
              </section>}

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
                      resetSelectedFiles();
                      if (next !== "audio") setCalibrationLanguage(null);
                      setContainsThirdParties(testEnvironment || next === "identity_document" ? false : null);
                      setUploadError("");
                    }}
                  >
                    {!testEnvironment && <option value="identity_document">{IDENTITY_DOCUMENT_POLICY.label}</option>}
                    {Object.entries(SOURCE_POLICY).map(([value, policy]) => <option key={value} value={value}>{policy.label}</option>)}
                  </select>
                </label>
                <label className="file-picker">
                  <input
                    ref={fileRef}
                    type="file"
                    multiple={uploadMode !== "identity_document"}
                    accept={uploadMode === "identity_document" ? IDENTITY_DOCUMENT_POLICY.accept : SOURCE_POLICY[uploadMode].accept}
                    disabled={uploadBusy || Boolean(pendingRetryId)}
                    onChange={(event) => selectFiles(Array.from(event.target.files || []))}
                  />
                  <span className="file-icon" aria-hidden="true">↑</span>
                  <span className="file-picker-copy">
                    <strong>{files.length > 1 ? `${files.length} files selected` : file ? file.name : uploadMode === "identity_document" ? "Choose one file" : "Choose files"}</strong>
                    <small>{files.length > 1 ? `${bytesLabel(files.reduce((total, item) => total + item.size, 0))} total` : file ? bytesLabel(file.size) : `Up to ${bytesLabel(uploadMode === "identity_document" ? IDENTITY_DOCUMENT_POLICY.maxBytes : SOURCE_POLICY[uploadMode].maxBytes)} each`}</small>
                  </span>
                  <span className="file-action">Browse</span>
                </label>
              </div>

              {files.length > 0 && (
                <section className="intake-queue" aria-labelledby="intake-queue-title" aria-live="polite">
                  <div className="intake-queue-head">
                    <div>
                      <h4 id="intake-queue-title">Selected file queue</h4>
                      <p>This tab uploads one file at a time. Each completed file then moves to private processing.</p>
                    </div>
                    <span>{isVoiceUpload && files.every((selectedFile) => typeof fileDurations[fileKey(selectedFile)] === "number")
                      ? `${durationLabel(files.reduce((total, selectedFile) => total + (fileDurations[fileKey(selectedFile)] || 0), 0))} total`
                      : `${bytesLabel(files.reduce((total, selectedFile) => total + selectedFile.size, 0))} total`}</span>
                  </div>
                  <ol>
                    {files.map((selectedFile, index) => {
                      const key = fileKey(selectedFile);
                      const queueState = uploadBusy
                        ? index < activeFileIndex
                          ? "Private processing queued"
                          : index === activeFileIndex
                            ? "Uploading in this tab"
                            : "Waiting in this tab"
                        : "Ready to upload";
                      return (
                        <li key={key}>
                          <span className="queue-position">{index + 1}</span>
                          <div className="queue-file-copy">
                            <strong>{selectedFile.name}</strong>
                            <span>{fileDurations[key] !== undefined && fileDurations[key] !== null ? durationLabel(fileDurations[key] as number) : bytesLabel(selectedFile.size)}</span>
                          </div>
                          {isVoiceUpload && (
                            <label className="queue-language">
                              <span>Spoken language</span>
                              <select
                                value={fileLanguages[key] || "unknown"}
                                disabled={uploadBusy}
                                onChange={(event) => setFileLanguages((current) => ({ ...current, [key]: event.target.value as EnrollmentLanguageChoice }))}
                              >
                                <option value="unknown">Not sure</option>
                                <option value="english">English</option>
                                <option value="hindi">Hindi</option>
                                <option value="hinglish">Hinglish</option>
                              </select>
                            </label>
                          )}
                          <span className={`queue-state ${uploadBusy && index === activeFileIndex ? "queue-state-running" : ""}`}>{queueState}</span>
                        </li>
                      );
                    })}
                  </ol>
                  {isVoiceUpload && (
                    <p className="queue-honesty">An hour across several files is supported. Duration alone is not a quality signal. Prefer clear clips that represent how you actually speak.</p>
                  )}
                </section>
              )}

              {!testEnvironment && uploadMode !== "identity_document" && <fieldset className="people-declaration">
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
                          {(source.kind === "audio" || source.kind === "video") && (
                            <label className="source-language-label">
                              <span>Reference language</span>
                              <select
                                value={sourceLanguages[source.source_id] || "unknown"}
                                onChange={(event) => markSourceLanguage(source.source_id, event.target.value as EnrollmentLanguageChoice)}
                              >
                                <option value="unknown">Not labeled</option>
                                <option value="english">English</option>
                                <option value="hindi">Hindi</option>
                                <option value="hinglish">Hinglish</option>
                              </select>
                            </label>
                          )}
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
