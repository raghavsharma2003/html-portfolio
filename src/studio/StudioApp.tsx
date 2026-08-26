import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ensureStudioSession,
  googleSignIn,
  isStudioAuthDead,
  sendEmailOtp,
  verifyEmailOtp,
} from "./studioAuth";
import {
  createReplica,
  listReplicas,
  readErasureStatus,
  readReplica,
  ReplicaApiError,
  revokeReplica,
} from "./replicaApi";
import { restoreSession, writeStoredSession } from "./session";
import { friendlyError } from "./errorCopy";
import type {
  ConsentReceipt,
  LivenessChallenge,
  Replica,
  ReplicaErasureStatus,
  ReplicaRuntimeStatus,
  ReplicaSource,
  SignedUpload,
  SourceKind,
  StudioSession,
} from "./types";
import EnrollmentWorkspace from "./EnrollmentWorkspace";
import IdentityProofing from "./IdentityProofing";
import LivenessCapture from "./LivenessCapture";
import ProcessingReview from "./ProcessingReview";
import PersonModelStudio from "./PersonModelStudio";
import CalibrationStudio from "./CalibrationStudio";
import RuntimeGate from "./RuntimeGate";
import ReplicaDialogueLab from "./ReplicaDialogueLab";
import CandidateEvaluationLab from "./CandidateEvaluationLab";
import VoiceEnrollmentLab from "./VoiceEnrollmentLab";
import ModelConsentGate from "./ModelConsentGate";
import VoicePreviewLab from "./VoicePreviewLab";
import VoicePreviewPanel from "./VoicePreviewPanel";
import TeacherSheetStudio from "./TeacherSheetStudio";
import ChannelsStudio from "./ChannelsStudio";
import IngestChannelStudio from "./IngestChannelStudio";
import ContextLockerPanel from "./ContextLockerPanel";
import DisclosurePreview from "./DisclosurePreview";
import MirrorCallStudio from "./MirrorCallStudio";
import VideoLinkMount from "./VideoLinkMount";
import ProcessingStatusMount from "./ProcessingStatusMount";
import { AdvancedArea, StepBlockers, StepPager, WizardRail } from "./WizardRail";
import {
  computeWizard,
  nextStep,
  previousStep,
  queryForStep,
  stepEntryWarning,
  stepFromQuery,
  stepTitle,
  type StepId,
  type WizardInput,
} from "./wizardModel";
import { seedSheetFor, type SheetProvenance } from "./sheetSeed";
import { readRuntimeStatus } from "./runtimeApi";
import { listChannels } from "./channelsApi";
import { readTeacherSheetDraft } from "./teacherSheetApi";
import type { TeacherSheet } from "../engine/agents/teacherTypes";
import {
  createSourceUpload,
  deleteSource,
  finalizeSource,
  grantEnrollmentConsent,
  listEnrollmentConsent,
  listSources,
  retrySourceUpload,
  revokeEnrollmentConsent,
} from "./enrollmentApi";
import {
  type BiometricVerificationAttestations,
  cancelLivenessChallenge,
  createLivenessUpload,
  finalizeLivenessUpload,
  issueLivenessChallenge,
  livenessStatus,
  pollOfficialFaceSession,
  startOfficialFaceSession,
} from "./livenessApi";

type AuthStep = "email" | "code";
type LoadState = "booting" | "loading" | "ready" | "error";

// The teacher mode seam. Read ONCE, at mount, from `?mode=teacher` — see
// `readStudioMode()` below. Generic mode ("replica") is the untouched
// default and stays byte-identical in behavior; teacher mode only relabels
// copy and appends the Gurukul teacher steps (SPEC-GURUKUL §5 WS-E). Nothing
// here is read again after mount, so a mid-session query-string edit does
// not flip the wizard underneath a signed-in teacher.
export type StudioMode = "generic" | "teacher";

function readStudioMode(): StudioMode {
  try {
    return new URLSearchParams(window.location.search).get("mode") === "teacher" ? "teacher" : "generic";
  } catch {
    return "generic";
  }
}

interface StudioCopy {
  brandTag: string;
  introEyebrow: string;
  introTitle: string;
  introBody: string;
  workspaceNoun: string;
  firstEyebrow: string;
  firstTitle: string;
  firstBody: string;
  nameLabel: string;
  namePlaceholder: string;
  fieldNote: string;
  createdNotice: string;
}

const GENERIC_COPY: StudioCopy = {
  brandTag: "PRIVATE REPLICA LAB",
  introEyebrow: "Private by construction",
  introTitle: "A replica that begins with your permission.",
  introBody:
    "Build and control a consent-verified model of yourself. Every source stays private, every capability is separately approved, and revocation stops future use.",
  workspaceNoun: "Self-replica",
  firstEyebrow: "Your first replica",
  firstTitle: "Begin with identity, not an upload.",
  firstBody:
    "Name your private workspace. Voice, memories, and behavior remain locked until consent and liveness services are connected.",
  nameLabel: "Replica name",
  namePlaceholder: "Your name",
  fieldNote: "You may create a replica only of yourself. Verification comes next.",
  // C4 (UX-QUEUE copy audit): the old line spent most of a first success on
  // what does not work. The truth is unchanged and still stated on the panels
  // that own each gate; what changes is that the first thing a person reads
  // after their first action tells them what to do next.
  createdNotice: "Your workspace is ready. Add one file or link on this step, and you can hear a private draft voice before any verification.",
};

const TEACHER_COPY: StudioCopy = {
  brandTag: "GURUKUL TEACHER STUDIO",
  introEyebrow: "Verified, consented, disclosed",
  introTitle: "A teaching clone that begins with your permission, and is disclosed to every student.",
  introBody:
    "Build and control a consent-verified teaching clone of yourself. Every source stays private, every capability is separately approved, revocation stops future use, and students are told before every session that they are talking to an AI clone, not you.",
  workspaceNoun: "Self-teaching-clone",
  firstEyebrow: "Your first teaching clone",
  firstTitle: "Begin with identity, not an upload.",
  firstBody:
    "Name your teaching clone. Voice, teaching style, and pedagogy remain locked until consent and liveness services are connected.",
  nameLabel: "Teacher / clone name",
  namePlaceholder: "Your name, as students will see it",
  fieldNote: "You may create a teaching clone only of yourself. Verification comes next.",
  createdNotice: "Your teaching clone has a workspace. Add one lecture or link on this step, and you can hear a private draft voice before any verification.",
};

const ERASURE_REQUEST_KEY = "vyakti.replica.erasure-request.v1";

function erasureStorageKey(userId: string) {
  return `${ERASURE_REQUEST_KEY}:${userId}`;
}

function storedErasureRequest(userId: string) {
  try {
    const value = localStorage.getItem(erasureStorageKey(userId)) || "";
    return /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value) ? value.toLowerCase() : "";
  } catch {
    return "";
  }
}

function storeErasureRequest(userId: string, requestId: string | null) {
  try {
    const key = erasureStorageKey(userId);
    if (requestId) localStorage.setItem(key, requestId);
    else localStorage.removeItem(key);
  } catch {
    // Browser storage is a convenience only. The server remains authoritative.
  }
}

// UX-Q-10. The permanently-locked "08 Embodiment laboratory" stage list used to
// sit here: a never-shipping visual-modelling teaser inside a teacher's launch
// path, telling them something was missing that was not missing. Removed rather
// than relabelled. A roadmap item is not a step, and a step that can never
// complete is a step that makes the other three look untrustworthy.

function hasSourceConsent(consents: ConsentReceipt[]) {
  const now = Date.now();
  const active = new Set(consents.filter((receipt) =>
    !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > now)
  ).map((receipt) => receipt.scope));
  return (["capture", "transcription", "storage"] as const).every((scope) => active.has(scope));
}

function lifecycleLabel(lifecycle: Replica["lifecycle"]) {
  return lifecycle.replaceAll("_", " ");
}

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Recently created"
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function initials(name: string) {
  const value = name.trim().split(/\s+/).slice(0, 2).map((word) => word[0]).join("");
  return value.toUpperCase() || "VR";
}

function Mark() {
  return (
    <span className="mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

function Spinner({ label }: { label: string }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

// The old `AdvancedSurface` lived here: a single `<details>` in teacher mode
// holding identity, liveness, provider consent, voice training AND launch.
//
// It is gone because it collapsed the wrong axis (UX-Q-05 / BREAK 15).
// Progressive disclosure hides what is OPTIONAL; every one of those five is a
// mandatory gate that `RuntimeGate` refuses activation without, and filing the
// mandatory path under "Advanced" teaches a teacher that required steps are
// optional. What replaces it is `AdvancedArea` in `WizardRail.tsx`, used once
// per step and only for genuinely elective surfaces (a calibration lab, a blind
// A/B, a text dialogue lab). The required gates now sit in the open, on the
// step where they bind.

/**
 * The band heading that groups panels inside a step.
 *
 * A step is not a list of panels, it is two or three moves.
 *
 * IT CARRIES NO NUMBER, and that is the interesting part. UX-Q-07 asked for
 * phase-scoped numbering to kill the `04`/`04` collision between
 * `ProcessingReview` and `ModelConsentGate`; `docs/gurukul/DESIGN-LAW.md` §1
 * then banned section-numbering eyebrows outright, and DESIGN-LAW wins where it
 * disagrees with a prior UI decision. Deleting the numbers kills the collision
 * more permanently than renumbering it would have: there is no longer a number
 * for the next workstream to pick 04 again.
 */
function Band({
  title,
  blurb,
  children,
}: {
  title: string;
  blurb: string;
  children: ReactNode;
}) {
  return (
    <section className="wizard-band">
      <header className="wizard-band-head">
        <h2>{title}</h2>
        <p>{blurb}</p>
      </header>
      <div className="wizard-band-body">{children}</div>
    </section>
  );
}

function AuthGate({ onAuthed, copy }: { onAuthed: (session: StudioSession) => void; copy: StudioCopy }) {
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (step === "code") codeRef.current?.focus();
  }, [step]);

  async function sendCode() {
    setError("");
    setBusy(true);
    try {
      await sendEmailOtp(email.trim());
      setStep("code");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message.replaceAll("_", " ") : "Could not send a code");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode() {
    setError("");
    setBusy(true);
    try {
      const session = await verifyEmailOtp(email.trim(), code.trim());
      writeStoredSession(session);
      onAuthed(session);
    } catch {
      setError("That code did not match. Check it and try again.");
      setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="auth-page">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="auth-brand">
        <a href="/" aria-label="Vyakti home"><Mark /></a>
        <span>VYAKTI</span>
        <span className="brand-rule" />
        <span>{copy.brandTag}</span>
      </header>

      <section className="auth-intro" aria-labelledby="studio-title">
        <p className="eyebrow">{copy.introEyebrow}</p>
        <h1 id="studio-title">{copy.introTitle}</h1>
        <p>{copy.introBody}</p>
        <div className="trust-strip" aria-label="Studio safeguards">
          <span><i />Self-replication only</span>
          <span><i />No public voice library</span>
          <span><i />Auditable deletion</span>
        </div>
      </section>

      <section className="auth-card" aria-labelledby="signin-title">
        <div className="secure-chip"><span className="secure-dot" />Protected workspace</div>
        <h2 id="signin-title">{step === "email" ? "Enter your studio" : "Check your inbox"}</h2>
        <p className="card-copy">
          {step === "email"
            ? "Sign in with the email you want to manage this clone from. If you are already signed in on this device, we will recognise you."
            : `We sent a six-digit code to ${email}.`}
        </p>

        {step === "email" ? (
          <>
            <button
              className="button google-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setBusy(true);
                googleSignIn().catch(() => {
                  setError("Google sign-in is unavailable. Use your email instead.");
                  setBusy(false);
                });
              }}
            >
              <span className="google-g" aria-hidden="true">G</span>
              Continue with Google
            </button>
            <div className="or"><span>or use email</span></div>
            <label className="field-label" htmlFor="studio-email">Email address</label>
            <input
              id="studio-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && email.includes("@") && !busy) void sendCode();
              }}
            />
            <button
              className="button primary-button"
              type="button"
              disabled={busy || !email.includes("@")}
              onClick={() => void sendCode()}
            >
              {busy ? <><Spinner label="Sending sign-in code" />Sending code</> : "Continue securely"}
            </button>
          </>
        ) : (
          <>
            <label className="field-label" htmlFor="studio-code">Six-digit code</label>
            <input
              ref={codeRef}
              id="studio-code"
              className="field code-field"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && code.length === 6 && !busy) void verifyCode();
              }}
            />
            <button
              className="button primary-button"
              type="button"
              disabled={busy || code.length !== 6}
              onClick={() => void verifyCode()}
            >
              {busy ? <><Spinner label="Verifying code" />Verifying</> : "Verify and enter"}
            </button>
            <button
              className="text-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setStep("email");
                setCode("");
                setError("");
              }}
            >
              Use a different email
            </button>
          </>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="legal-copy">
          Access does not grant cloning permission. Separate, recorded consent is required before any biometric processing.
        </p>
      </section>
    </main>
  );
}

function CreateReplicaCard({ onCreate, busy, copy }: { onCreate: (name: string) => void; busy: boolean; copy: StudioCopy }) {
  const [name, setName] = useState("");
  return (
    <section className="empty-card" aria-labelledby="empty-title">
      <div className="portrait-placeholder" aria-hidden="true">
        <div className="scan-ring" />
        <div className="portrait-core">YOU</div>
      </div>
      <div>
        <p className="eyebrow">{copy.firstEyebrow}</p>
        <h2 id="empty-title">{copy.firstTitle}</h2>
        <p>{copy.firstBody}</p>
        <form
          className="create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <label className="field-label" htmlFor="replica-name">{copy.nameLabel}</label>
          <div className="create-row">
            <input
              id="replica-name"
              className="field"
              maxLength={80}
              placeholder={copy.namePlaceholder}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="button primary-button" disabled={busy || !name.trim()}>
              {busy ? <Spinner label="Creating replica" /> : "Create workspace"}
            </button>
          </div>
          <p className="field-note">{copy.fieldNote}</p>
        </form>
      </div>
    </section>
  );
}

function ReplicaList({
  replicas,
  selectedId,
  onSelect,
  onNew,
}: {
  replicas: Replica[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <aside className="replica-rail" aria-label="Your replicas">
      <div className="rail-label">Your replicas</div>
      <div className="replica-list">
        {replicas.map((replica) => (
          <button
            key={replica.replica_id}
            type="button"
            className={`replica-tab ${selectedId === replica.replica_id ? "selected" : ""}`}
            onClick={() => onSelect(replica.replica_id)}
          >
            <span className="replica-monogram">{initials(replica.display_name)}</span>
            <span className="replica-tab-copy">
              <strong>{replica.display_name}</strong>
              <small>{lifecycleLabel(replica.lifecycle)}</small>
            </span>
            <span className={`state-dot state-${replica.lifecycle}`} />
          </button>
        ))}
      </div>
      <button className="new-replica" type="button" onClick={onNew}>
        <span>+</span> New workspace
      </button>
    </aside>
  );
}

/**
 * VoiceUnlockNotice — the inline unlock, where it actually gates.
 *
 * Identity and liveness used to be a wall in their own collapsed section, asked
 * for BEFORE the owner had any evidence we could do the thing. They are now on
 * the Meet step next to the voice they unlock, and this line is the sentence
 * that connects the two. It appears only while something is genuinely missing,
 * and it never claims the preview is blocked, because it is not: the draft
 * preview is private and works unverified. What is gated is ACTIVATION, and
 * that is what it says.
 */
function VoiceUnlockNotice({ replica }: { replica: Replica }) {
  const identity = replica.identity_verified;
  const liveness = replica.liveness_verified;
  if (identity && liveness) return null;
  const missing = !identity && !liveness
    ? "identity and a live challenge"
    : identity ? "a live challenge" : "identity";
  return (
    <aside className="voice-unlock" role="status">
      <p className="eyebrow">Verify to activate your voice</p>
      <p>
        The preview above is private and works right now. To let this voice speak to anyone else we need {missing},
        because a voice is a person and this product only ever clones its own owner.
      </p>
      <a className="text-button" href="#identity-proofing">Verify below on this step</a>
    </aside>
  );
}

function ReplicaWorkspace({
  replica,
  mode,
  copy,
  step,
  wizard,
  wizardInput,
  onGoStep,
  sheet,
  sheetProvenance,
  erasureStatus,
  consents,
  sources,
  enrollmentLoading,
  challenge,
  livenessLoading,
  runtimeStatus,
  onRuntimeStatus,
  onContextCount,
  onGrantConsent,
  onRevokeConsent,
  onCreateUpload,
  onRetryUpload,
  onFinalizeUpload,
  onDeleteSource,
  onIssueChallenge,
  onStartFaceSession,
  onPollFaceSession,
  onCancelChallenge,
  onCreateLivenessUpload,
  onFinalizeLiveness,
  onIdentityChanged,
  onVerifiedConsentChanged,
  onRevoke,
  revoking,
  accessToken,
  onReviewAuthError,
}: {
  replica: Replica;
  mode: StudioMode;
  copy: StudioCopy;
  step: StepId;
  wizard: ReturnType<typeof computeWizard>;
  wizardInput: WizardInput;
  onGoStep: (next: StepId) => void;
  sheet: TeacherSheet;
  sheetProvenance: SheetProvenance;
  erasureStatus: ReplicaErasureStatus | null;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  enrollmentLoading: boolean;
  challenge: LivenessChallenge | null;
  livenessLoading: boolean;
  runtimeStatus: ReplicaRuntimeStatus | null;
  onRuntimeStatus: (status: ReplicaRuntimeStatus) => void;
  onContextCount: (count: number) => void;
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
  onIssueChallenge: (attestations: BiometricVerificationAttestations) => Promise<LivenessChallenge>;
  onStartFaceSession: (challengeId: string) => Promise<{ challenge: LivenessChallenge; quick_link_url: string }>;
  onPollFaceSession: (challengeId: string) => Promise<LivenessChallenge>;
  onCancelChallenge: (challengeId: string) => Promise<{
    challenge: LivenessChallenge;
    erasure: "pending" | "confirmed" | "not_required";
  }>;
  onCreateLivenessUpload: (input: {
    challengeId: string;
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ challenge: LivenessChallenge; source: ReplicaSource; upload: SignedUpload }>;
  onFinalizeLiveness: (challengeId: string, sourceId: string) => Promise<LivenessChallenge>;
  onIdentityChanged: () => Promise<void>;
  onVerifiedConsentChanged: () => Promise<void>;
  onRevoke: () => Promise<void>;
  revoking: boolean;
  accessToken: string;
  onReviewAuthError: (cause: unknown) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const stopped = replica.lifecycle === "revoked" || replica.lifecycle === "purging";
  const erased = erasureStatus?.state === "complete";
  const verificationCount = [replica.age_verified, replica.identity_verified, replica.liveness_verified].filter(Boolean).length;
  const view = wizard.steps.find((row) => row.id === step) ?? wizard.steps[0];
  const stepNumber = view.number;
  const back = previousStep(step);
  const forward = nextStep(step);

  useEffect(() => {
    if (stopped) setConfirming(false);
  }, [stopped]);

  useEffect(() => {
    if (!confirming) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !revoking) setConfirming(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [confirming, revoking]);

  return (
    <>
      <section className="workspace-heading">
        <div>
          <div className="workspace-kicker">
            <span className={`state-dot state-${replica.lifecycle}`} />
            {lifecycleLabel(replica.lifecycle)}
            <span className="tiny-divider" />
            {copy.workspaceNoun}
          </div>
          <h1>{replica.display_name}</h1>
          <p>Created {dateLabel(replica.created_at)} · Policy {replica.policy_version}</p>
        </div>
        <div className="control-seal">
          <span>{stopped ? "STOPPED" : "OWNER CONTROLLED"}</span>
          <small>{stopped ? (erased ? "Erasure verified" : "Erasure in progress") : "Private workspace"}</small>
        </div>
      </section>

      {stopped ? (
        <section className="stopped-panel" role="status">
          <div className={`stop-icon ${erased ? "complete" : ""}`}>{erased ? "✓" : "×"}</div>
          <div>
            <p className="eyebrow">{erased ? "Verified erasure complete" : "Future use disabled"}</p>
            <h2>{erased ? "This replica has been erased." : "This replica has been revoked."}</h2>
            <p>
              {erased
                ? `Provider copies and private storage were confirmed deleted. Backup expiry: ${dateLabel(erasureStatus.backup_expires_at || "")}.`
                : "Generation is blocked. Private artifacts and provider copies are being deleted with durable retries."}
            </p>
            {erasureStatus && (
              <div className="erasure-progress" aria-label="Verified erasure progress">
                <span className={erasureStatus.provider === "confirmed" ? "done" : ""}>
                  <i /> Provider copy {erasureStatus.provider}
                </span>
                <span className={erasureStatus.storage === "confirmed" ? "done" : ""}>
                  <i /> Private storage {erasureStatus.storage}
                </span>
                <small>Last checked {dateLabel(erasureStatus.updated_at)}</small>
              </div>
            )}
          </div>
        </section>
      ) : (
        <>
          <section className="step-head" aria-labelledby="step-title">
            <p className="eyebrow">Step {stepNumber} of {wizard.steps.length}</p>
            <h2 id="step-title">{view.title}</h2>
            <p className="step-promise">{view.promise}</p>
          </section>

          {/* Every number on this strip is derived. The old version rendered a
              literal "Voice versions 0 / No model trained" regardless of the
              real `runtime.versions.voice_genome`, and a "Public access / Off /
              Cannot be changed" claim that ChannelsStudio exists to falsify
              (UX-Q-04, copy audit C5 and C6). A status this product cannot
              derive is not shown. */}
          <section className="readiness-grid" aria-label="Replica readiness">
            <article className="readiness-card readiness-primary">
              <p className="eyebrow">Activation readiness</p>
              <strong>{verificationCount}/3</strong>
              <span>identity checks complete</span>
              <div className="progress-track"><span style={{ transform: `scaleX(${verificationCount * 0.33333})` }} /></div>
            </article>
            <article className="readiness-card">
              <span className="metric-label">Sources</span>
              <strong>{sources.length}</strong>
              <span>{sources.length ? "Private ledger entries" : "Nothing uploaded"}</span>
            </article>
            <article className="readiness-card">
              <span className="metric-label">Voice versions</span>
              <strong>{runtimeStatus ? (runtimeStatus.versions.voice_genome ?? 0) : "\u2014"}{/* emdash-ok: the empty-value placeholder, not prose */}</strong>
              <span>
                {!runtimeStatus
                  ? "Checking"
                  : runtimeStatus.versions.voice_genome
                    ? "Approved voice model"
                    : "Not built yet"}
              </span>
            </article>
            <article className="readiness-card trust-card">
              <span className="metric-label">Public voice library</span>
              <strong>Never</strong>
              <span>Your voice is never listed or shared</span>
            </article>
          </section>

          {(() => {
            const warning = stepEntryWarning(step, wizardInput);
            return warning ? <p className="step-warning" role="status">{warning}</p> : null;
          })()}

          {step === "feed" && (
            <>
              <Band
                title="Permission, then your material"
                blurb="Nothing is read, transcribed or stored until you say it may be. Then everything you bring lands in one private ledger you can erase a row at a time."
              >
                <EnrollmentWorkspace
                  consents={consents}
                  sources={sources}
                  loading={enrollmentLoading}
                  onGrantConsent={onGrantConsent}
                  onRevokeConsent={onRevokeConsent}
                  onCreateUpload={onCreateUpload}
                  onRetryUpload={onRetryUpload}
                  onFinalizeUpload={onFinalizeUpload}
                  onDeleteSource={onDeleteSource}
                />
              </Band>

              <Band
                title="Files, links, videos, channels"
                blurb="Four ways in, one ledger out. Everything here is proposed to you before it changes anything about your clone."
              >
                <ContextLockerPanel
                  key={`context-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                  onItemCount={onContextCount}
                />
                {/* WS-AD's single-video lane has not landed. A labelled hole,
                    never a field that swallows a URL. See VideoLinkMount.tsx. */}
                <VideoLinkMount />
                {/* WS-S. The channel lane is horizontal by the same argument
                    the Context Locker is: a teacher's uploads are one kind of
                    channel and everyone else's are the rest, so it is no longer
                    gated on teacher mode. */}
                <IngestChannelStudio
                  key={`ingest-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />
                {/* WS-AF's processing-status surface belongs here: the moment
                    after a drop, while the owner still has the file in hand. */}
                <ProcessingStatusMount where="feed" />
              </Band>
            </>
          )}

          {step === "meet" && (
            <>
              <Band
                title="Hear it, then talk to it"
                blurb="This is the whole point of the product. The preview is private, and the call is where the clone learns from you while you watch."
              >
                <VoicePreviewPanel
                  key={`hear-voice-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />
                <VoiceUnlockNotice replica={replica} />
                <MirrorCallStudio
                  key={`mirror-call-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  stopped={stopped}
                  onAuthError={onReviewAuthError}
                />
              </Band>

              <Band
                title="Check it and correct it"
                blurb="What we think we learned, one claim at a time, and the dials only you can set. Nothing here publishes anything."
              >
                {mode === "teacher" && (
                  <TeacherSheetStudio
                    key={`sheet-${replica.replica_id}-${sheetProvenance}`}
                    token={accessToken}
                    replicaId={replica.replica_id}
                    sheetDraft={sheet}
                    sheetProvenance={sheetProvenance}
                    onAuthError={onReviewAuthError}
                  />
                )}
                <PersonModelStudio
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />
                <ProcessingReview
                  token={accessToken}
                  replicaId={replica.replica_id}
                  sourceCount={sources.length}
                  onAuthError={onReviewAuthError}
                />
                {/* WS-AF's second slot: "why does it not know that yet". Same
                    component, different question. See ProcessingStatusMount. */}
                <ProcessingStatusMount where="meet" />
              </Band>

              {/* UX-Q-05. Required, therefore open. These four are the gates
                  `RuntimeGate` refuses activation without, and they live on the
                  step whose voice they unlock rather than in a drawer called
                  "Advanced". */}
              <Band
                title="Prove it is you"
                blurb="A voice is a person. These are the checks that let your clone speak to anyone other than you, and they are the only reason this product can exist."
              >
                <IdentityProofing
                  token={accessToken}
                  replicaId={replica.replica_id}
                  sources={sources}
                  onChanged={onIdentityChanged}
                  onAuthError={onReviewAuthError}
                />
                <LivenessCapture
                  consentActive={hasSourceConsent(consents) && replica.age_verified}
                  challenge={challenge}
                  loading={livenessLoading}
                  onIssue={onIssueChallenge}
                  onStartFace={onStartFaceSession}
                  onPollFace={onPollFaceSession}
                  onCancel={onCancelChallenge}
                  onCreateUpload={onCreateLivenessUpload}
                  onRetryUpload={onRetryUpload}
                  onFinalize={onFinalizeLiveness}
                />
                <ModelConsentGate
                  token={accessToken}
                  replica={replica}
                  consents={consents}
                  onChanged={onVerifiedConsentChanged}
                  onAuthError={onReviewAuthError}
                />
                <VoiceEnrollmentLab
                  key={`voice-enrollment-${replica.replica_id}`}
                  token={accessToken}
                  replica={replica}
                  consents={consents}
                  onAuthError={onReviewAuthError}
                />
              </Band>

              <AdvancedArea
                id="advanced-meet"
                title="Advanced tuning, all optional"
                blurb="Four labs for people who want to go further. Nothing in here is required to activate a clone, and skipping all of it costs you nothing."
              >
                <VoicePreviewLab
                  key={`voice-preview-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />
                <CalibrationStudio
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />
                <ReplicaDialogueLab
                  key={`dialogue-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  stopped={stopped}
                  onAuthError={onReviewAuthError}
                  runtimeStatus={runtimeStatus?.replica_id === replica.replica_id ? runtimeStatus : null}
                />
                <CandidateEvaluationLab
                  key={`candidate-eval-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  stopped={stopped}
                  onAuthError={onReviewAuthError}
                />
              </AdvancedArea>
            </>
          )}

          {step === "deploy" && (
            <>
              {mode === "teacher" && (
                <Band
                  title="What every student is told first"
                  blurb="Read this before you decide where the clone can be reached. The order is the informed half of informed consent."
                >
                  {sheetProvenance === "draft" ? (
                    <DisclosurePreview sheet={sheet} />
                  ) : (
                    <section className="disclosure-preview" aria-labelledby="disclosure-empty-title">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">Nothing saved yet</p>
                          <h2 id="disclosure-empty-title">Your sheet has not been saved, so there is nothing to preview</h2>
                          <p>
                            The disclosure card names the teacher a student is talking to. We will not show you a
                            preview with somebody else's name on it. Save your sheet on the Meet it step and come
                            back, and this will show exactly what a student sees.
                          </p>
                        </div>
                      </div>
                      <button className="button secondary-button" type="button" onClick={() => onGoStep("meet")}>
                        Go and save your sheet
                      </button>
                    </section>
                  )}
                </Band>
              )}

              <Band
                title="The gates, then the switch"
                blurb="Activation is refused until every check has passed. The list below is the runtime's own answer, not a summary of it."
              >
                <RuntimeGate
                  key={`runtime-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  stopped={stopped}
                  onAuthError={onReviewAuthError}
                  onStatusChange={onRuntimeStatus}
                />
              </Band>

              {mode === "teacher" && (
                <Band
                  title="Where it can be reached"
                  blurb="One address at a time, each connected separately, each revocable on its own."
                >
                  {sheetProvenance === "draft" ? (
                    <ChannelsStudio
                      key={`channels-${replica.replica_id}`}
                      token={accessToken}
                      replicaId={replica.replica_id}
                      slug={sheet.slug}
                      onAuthError={onReviewAuthError}
                    />
                  ) : (
                    <section id="channels-studio" className="channels-studio" aria-labelledby="channels-empty-title">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">Nothing saved yet</p>
                          <h2 id="channels-empty-title">A channel needs a saved sheet first</h2>
                          <p>
                            The embed code and the widget address are built from your clone's public slug, and that
                            comes from your saved sheet. Until then any snippet we showed you would point somewhere
                            that is not yours.
                          </p>
                        </div>
                      </div>
                      <button className="button secondary-button" type="button" onClick={() => onGoStep("meet")}>
                        Go and save your sheet
                      </button>
                    </section>
                  )}
                </Band>
              )}

              <AdvancedArea
                id="advanced-deploy"
                title="Owner control, including erasure"
                blurb="Revoking stops future use immediately and queues every stored artifact, derived model and provider copy for verified deletion."
              >
                <section className="danger-zone" aria-labelledby="control-title">
                  <div>
                    <p className="eyebrow">Owner control</p>
                    <h2 id="control-title">Revoke this replica</h2>
                    <p>Future use stops immediately. Private artifacts and provider copies are then queued for erasure.</p>
                  </div>
                  <button className="button danger-button" type="button" onClick={() => setConfirming(true)}>
                    Revoke access
                  </button>
                </section>
              </AdvancedArea>
            </>
          )}

          <StepBlockers step={view} />

          <StepPager
            back={back}
            next={forward}
            backLabel={back ? stepTitle(back) : ""}
            nextLabel={forward ? stepTitle(forward) : ""}
            caution={forward ? stepEntryWarning(forward, wizardInput) : null}
            onGo={onGoStep}
          />
        </>
      )}

      {confirming && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => !revoking && setConfirming(false)}>
          <section
            className="confirm-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="revoke-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="modal-stop">STOP</div>
            <h2 id="revoke-title">Revoke {replica.display_name}?</h2>
            <p>
              This immediately blocks generation and queues stored sources, derived models, memories, and provider copies for erasure.
              Audio already exported outside Vyakti cannot be recalled.
            </p>
            <label className="field-label" htmlFor="revoke-confirmation">Type REVOKE to confirm</label>
            <input
              id="revoke-confirmation"
              className="field"
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
            />
            <div className="modal-actions">
              <button className="button secondary-button" disabled={revoking} onClick={() => setConfirming(false)}>Keep replica</button>
              <button
                className="button destructive-button"
                disabled={revoking || confirmation !== "REVOKE"}
                onClick={() => void onRevoke()}
              >
                {revoking ? <><Spinner label="Revoking replica" />Revoking</> : "Revoke permanently"}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}

export default function StudioApp() {
  // Read once, at mount — see readStudioMode()'s own comment. Not re-read on
  // navigation, so this never flips mid-session.
  const [mode] = useState<StudioMode>(readStudioMode);
  const copy = mode === "teacher" ? TEACHER_COPY : GENERIC_COPY;
  const [session, setSession] = useState<StudioSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [selected, setSelected] = useState<Replica | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<ReturnType<typeof friendlyError> | null>(null);
  const [consents, setConsents] = useState<ConsentReceipt[]>([]);
  const [sources, setSources] = useState<ReplicaSource[]>([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [livenessLoading, setLivenessLoading] = useState(false);
  const [erasureRequestId, setErasureRequestId] = useState("");
  const [erasureStatus, setErasureStatus] = useState<ReplicaErasureStatus | null>(null);

  // ── the wizard ────────────────────────────────────────────────────────
  //
  // The step lives in the URL, not only in state, for the plainest reason
  // there is: a person who refreshes, bookmarks, or hits the browser Back
  // button in the middle of a three-step flow must land where they were.
  // `?step=` rather than a hash so it sits next to `?mode=teacher` and
  // `queryForStep` can preserve it, and because a hash is already spoken for
  // by every in-page anchor on these panels (`#identity-proofing` and the
  // rest), which would fight it on every "Go there" click.
  const [step, setStep] = useState<StepId>(() => stepFromQuery(window.location.search));
  const [runtimeStatus, setRuntimeStatus] = useState<ReplicaRuntimeStatus | null>(null);
  const [contextItemCount, setContextItemCount] = useState<number | null>(null);
  const [connectedChannels, setConnectedChannels] = useState<number | null>(null);
  const [sheetDraft, setSheetDraft] = useState<TeacherSheet | null>(null);

  const goStep = useCallback((next: StepId) => {
    setStep(next);
    try {
      window.history.pushState({ step: next }, "", queryForStep(window.location.search, next));
    } catch {
      // A blocked history write must never cost the navigation itself. The
      // step still changes; only the URL falls behind.
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);

  // Back and Forward move between steps rather than leaving the studio. The
  // listener reads the URL rather than the event state so a hand-edited
  // `?step=` in the address bar behaves the same as a click.
  useEffect(() => {
    const onPop = () => setStep(stepFromQuery(window.location.search));
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const identity = useMemo(() => session?.email || session?.phone || "Signed in account", [session]);
  const selectedId = selected?.replica_id ?? null;
  const sessionUserId = session?.userId || "";
  const activeChallengeId = challenge?.challenge_id || "";
  const activeChallengeState = challenge?.state || "";

  const signOut = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
    setReplicas([]);
    setSelected(null);
    setErasureRequestId("");
    setErasureStatus(null);
    setError(null);
  }, []);

  const refreshForRequest = useCallback(async (candidate: StudioSession) => {
    const fresh = await ensureStudioSession(candidate);
    if (fresh.accessToken !== candidate.accessToken) {
      writeStoredSession(fresh);
      setSession(fresh);
    }
    return fresh;
  }, []);

  const handleApiError = useCallback((cause: unknown, fallback: string) => {
    if ((cause instanceof ReplicaApiError && cause.status === 401) || isStudioAuthDead(cause)) {
      signOut();
      return;
    }
    setError(friendlyError(cause, fallback));
  }, [signOut]);

  const handleReviewAuthError = useCallback((cause: unknown) => {
    handleApiError(cause, "Replica qualification controls could not be loaded");
  }, [handleApiError]);

  const loadReplicas = useCallback(async (activeSession: StudioSession) => {
    setLoadState("loading");
    setError(null);
    try {
      const fresh = await refreshForRequest(activeSession);
      const mine = await listReplicas(fresh.accessToken);
      setReplicas(mine);
      setSelected((current) => mine.find((item) => item.replica_id === current?.replica_id) ?? mine[0] ?? null);
      setShowCreate(mine.length === 0);
      setLoadState("ready");
    } catch (cause) {
      handleApiError(cause, "Could not load your private workspace");
      setLoadState("error");
    }
  }, [handleApiError, refreshForRequest]);

  const refreshReplicaView = useCallback(async (activeSession: StudioSession, replicaId: string) => {
    const replica = await readReplica(activeSession.accessToken, replicaId);
    setSelected(replica);
    setReplicas((items) => items.map((item) => item.replica_id === replica.replica_id ? replica : item));
    return replica;
  }, []);

  const handleIdentityChanged = useCallback(async () => {
    if (!session || !selectedId) return;
    try {
      const fresh = await refreshForRequest(session);
      const [nextSources] = await Promise.all([
        listSources(fresh.accessToken, selectedId),
        refreshReplicaView(fresh, selectedId),
      ]);
      setSources(nextSources);
    } catch (cause) {
      handleApiError(cause, "Could not refresh identity evidence");
      throw cause;
    }
  }, [handleApiError, refreshForRequest, refreshReplicaView, selectedId, session]);

  useEffect(() => {
    let live = true;
    restoreSession().then((restored) => {
      if (!live) return;
      setSession(restored);
      setAuthChecked(true);
      if (restored) void loadReplicas(restored);
    });
    return () => { live = false; };
  }, [loadReplicas]);

  useEffect(() => {
    if (!sessionUserId) return;
    setErasureRequestId(storedErasureRequest(sessionUserId));
    setErasureStatus(null);
  }, [sessionUserId]);

  useEffect(() => {
    if (!session || !erasureRequestId) return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const fresh = await refreshForRequest(session);
        const status = await readErasureStatus(fresh.accessToken, erasureRequestId);
        if (!live) return;
        setErasureStatus(status);
        if (status.state === "complete") {
          setNotice("Verified erasure complete. Provider copies and private storage are confirmed deleted.");
          return;
        }
        timer = window.setTimeout(() => void poll(), 5_000);
      } catch (cause) {
        if (!live) return;
        if (cause instanceof ReplicaApiError && cause.status === 404) {
          storeErasureRequest(session.userId, null);
          setErasureRequestId("");
          setErasureStatus(null);
          return;
        }
        handleApiError(cause, "Could not verify erasure progress");
        timer = window.setTimeout(() => void poll(), 10_000);
      }
    };
    void poll();
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [erasureRequestId, handleApiError, refreshForRequest, session]);

  useEffect(() => {
    if (!session || !selectedId) {
      setConsents([]);
      setSources([]);
      setChallenge(null);
      setRuntimeStatus(null);
      setContextItemCount(null);
      setConnectedChannels(null);
      setSheetDraft(null);
      return;
    }
    let live = true;
    const replicaId = selectedId;
    setEnrollmentLoading(true);
    setLivenessLoading(true);
    // Every one of the four new reads below is `allSettled` and every one of
    // them leaves its state at `null` on failure. `null` is UNKNOWN in
    // `wizardModel`, and unknown never renders as "none" or "not done yet" on
    // the rail. A rail that reports a status because a fetch failed is the
    // same defect as a rail that reports a literal.
    setRuntimeStatus(null);
    setContextItemCount(null);
    setConnectedChannels(null);
    setSheetDraft(null);
    void (async () => {
      try {
        const fresh = await refreshForRequest(session);
        const [
          consentResult,
          sourceResult,
          challengeResult,
          runtimeResult,
          sheetResult,
          channelResult,
        ] = await Promise.allSettled([
          listEnrollmentConsent(fresh.accessToken, replicaId),
          listSources(fresh.accessToken, replicaId),
          livenessStatus(fresh.accessToken, replicaId),
          readRuntimeStatus(fresh.accessToken, replicaId),
          mode === "teacher" ? readTeacherSheetDraft(fresh.accessToken, replicaId) : Promise.resolve(null),
          mode === "teacher" ? listChannels(fresh.accessToken, replicaId) : Promise.resolve(null),
        ]);
        if (!live) return;
        if (consentResult.status === "fulfilled") setConsents(consentResult.value);
        if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
        if (challengeResult.status === "fulfilled") setChallenge(challengeResult.value);
        if (runtimeResult.status === "fulfilled") setRuntimeStatus(runtimeResult.value);
        if (sheetResult.status === "fulfilled" && sheetResult.value) setSheetDraft(sheetResult.value.draft);
        if (channelResult.status === "fulfilled" && channelResult.value) {
          setConnectedChannels(channelResult.value.filter((row) => row.status === "connected").length);
        }
        // Only the three that were already surfaced raise a banner. A runtime,
        // sheet or channel read that fails degrades the rail to "unknown",
        // which is honest and quiet; interrupting an upload with a banner about
        // a status widget would be the wrong trade.
        const failed = [consentResult, sourceResult, challengeResult].find((result) => result.status === "rejected");
        if (failed?.status === "rejected") handleApiError(failed.reason, "Some enrollment controls could not be loaded");
      } catch (cause) {
        if (live) handleApiError(cause, "Could not load consent and private sources");
      } finally {
        if (live) setEnrollmentLoading(false);
        if (live) setLivenessLoading(false);
      }
    })();
    return () => { live = false; };
  }, [handleApiError, mode, refreshForRequest, selectedId, session]);

  useEffect(() => {
    if (!session || !selectedId || !activeChallengeId || !["uploaded", "verifying"].includes(activeChallengeState)) return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const fresh = await refreshForRequest(session);
        const next = await livenessStatus(fresh.accessToken, selectedId);
        if (!live) return;
        setChallenge(next);
        if (next && ["uploaded", "verifying"].includes(next.state)) {
          timer = window.setTimeout(() => void poll(), 5_000);
        } else if (next?.state === "passed") {
          const [nextConsents] = await Promise.all([
            listEnrollmentConsent(fresh.accessToken, selectedId),
            refreshReplicaView(fresh, selectedId),
          ]);
          if (live) setConsents(nextConsents);
          if (live) setNotice("Independent liveness verification passed. Training and inference remain separately permissioned.");
        }
      } catch (cause) {
        if (!live) return;
        handleApiError(cause, "Could not refresh liveness verification");
        timer = window.setTimeout(() => void poll(), 10_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 2_000);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [activeChallengeId, activeChallengeState, handleApiError, refreshForRequest, refreshReplicaView, selectedId, session]);

  async function selectReplica(id: string) {
    if (!session) return;
    setLoadState("loading");
    setShowCreate(false);
    setError(null);
    try {
      const fresh = await refreshForRequest(session);
      setSelected(await readReplica(fresh.accessToken, id));
      setLoadState("ready");
    } catch (cause) {
      handleApiError(cause, "Could not open this workspace");
      setLoadState("error");
    }
  }

  async function handleCreate(name: string) {
    if (!session) return;
    setCreating(true);
    setError(null);
    try {
      const fresh = await refreshForRequest(session);
      const replica = await createReplica(fresh.accessToken, name);
      setReplicas((items) => [replica, ...items]);
      setSelected(replica);
      setShowCreate(false);
      setNotice(copy.createdNotice);
    } catch (cause) {
      handleApiError(cause, "Could not create your workspace");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!session || !selected) return;
    setRevoking(true);
    setError(null);
    try {
      const fresh = await refreshForRequest(session);
      const result = await revokeReplica(fresh.accessToken, selected.replica_id);
      const now = new Date().toISOString();
      storeErasureRequest(fresh.userId, result.erasure_request_id);
      setErasureRequestId(result.erasure_request_id);
      setErasureStatus({
        state: "pending",
        requested_at: now,
        updated_at: now,
        completed_at: null,
        backup_expires_at: null,
        attempts: 0,
        provider: "pending",
        storage: "pending",
        deleted_classes: [],
      });
      setSelected(result.replica);
      setReplicas((items) => items.map((item) => item.replica_id === result.replica.replica_id ? result.replica : item));
      setNotice("Replica revoked. Future use is blocked and verified erasure is pending.");
    } catch (cause) {
      handleApiError(cause, "Could not revoke this replica");
    } finally {
      setRevoking(false);
    }
  }

  async function handleGrantConsent() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const granted = await grantEnrollmentConsent(fresh.accessToken, selected.replica_id);
      setConsents(granted);
      await refreshReplicaView(fresh, selected.replica_id);
      setNotice("Source permissions recorded. Private evidence intake is now open.");
    } catch (cause) {
      handleApiError(cause, "Could not record source permissions");
      throw cause;
    }
  }

  async function handleRevokeConsent() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      await revokeEnrollmentConsent(fresh.accessToken, selected.replica_id);
      const [nextConsents, nextSources] = await Promise.all([
        listEnrollmentConsent(fresh.accessToken, selected.replica_id),
        listSources(fresh.accessToken, selected.replica_id),
      ]);
      setConsents(nextConsents);
      setSources(nextSources);
      await refreshReplicaView(fresh, selected.replica_id);
      setNotice("Source permissions withdrawn. The replica is non-operational and source erasure is pending.");
    } catch (cause) {
      handleApiError(cause, "Could not withdraw source permissions");
      throw cause;
    }
  }

  async function handleVerifiedConsentChanged() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const [nextConsents] = await Promise.all([
        listEnrollmentConsent(fresh.accessToken, selected.replica_id),
        refreshReplicaView(fresh, selected.replica_id),
      ]);
      setConsents(nextConsents);
      setNotice(nextConsents.some((receipt) => receipt.scope === "inference" && !receipt.revoked_at)
        ? "Private training and disclosed inference permissions recorded. No model is active until every independent gate passes."
        : "Training and inference withdrawn. Model use is disabled and derived copies are queued for erasure.");
    } catch (cause) {
      handleApiError(cause, "Could not refresh verified model permissions");
      throw cause;
    }
  }

  async function handleCreateUpload(input: {
    kind: SourceKind;
    purpose: "memory" | "identity_document";
    mime: string;
    byteSize: number;
    sha256: string;
    containsThirdParties: boolean;
  }) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await createSourceUpload(fresh.accessToken, { replicaId: selected.replica_id, ...input });
      setSources((items) => [result.source, ...items.filter((item) => item.source_id !== result.source.source_id)]);
      return result;
    } catch (cause) {
      handleApiError(cause, "Could not authorize private upload");
      throw cause;
    }
  }

  async function handleFinalizeUpload(sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const source = await finalizeSource(fresh.accessToken, selected.replica_id, sourceId);
      setSources((items) => [source, ...items.filter((item) => item.source_id !== source.source_id)]);
      setNotice("Source received and isolated in private quarantine. No model training has started.");
      return source;
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.data?.source) {
        const rejected = cause.data.source as ReplicaSource;
        setSources((items) => [rejected, ...items.filter((item) => item.source_id !== rejected.source_id)]);
      }
      handleApiError(cause, "Stored source could not be verified");
      throw cause;
    }
  }

  async function handleRetryUpload(sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      return await retrySourceUpload(fresh.accessToken, selected.replica_id, sourceId);
    } catch (cause) {
      handleApiError(cause, "Could not renew private upload authorization");
      throw cause;
    }
  }

  async function handleIssueChallenge(attestations: BiometricVerificationAttestations) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const issued = await issueLivenessChallenge(fresh.accessToken, selected.replica_id, attestations);
      setChallenge(issued);
      return issued;
    } catch (cause) {
      handleApiError(cause, "Could not issue a live phrase");
      throw cause;
    }
  }

  async function handleStartFaceSession(challengeId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const started = await startOfficialFaceSession(fresh.accessToken, selected.replica_id, challengeId);
      setChallenge(started.challenge);
      return started;
    } catch (cause) {
      handleApiError(cause, "Could not start the official live-face check");
      throw cause;
    }
  }

  async function handlePollFaceSession(challengeId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const updated = await pollOfficialFaceSession(fresh.accessToken, selected.replica_id, challengeId);
      setChallenge(updated);
      if (updated.face_session_state === "passed_deleted") {
        setNotice("Official live-face and ID match passed. The Azure session was deleted; voice challenge capture is now unlocked.");
      }
      return updated;
    } catch (cause) {
      handleApiError(cause, "Could not retrieve the official live-face result");
      throw cause;
    }
  }

  async function handleCancelChallenge(challengeId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await cancelLivenessChallenge(fresh.accessToken, selected.replica_id, challengeId);
      setChallenge(result.challenge);
      setSources((items) => items.map((source) =>
        source.capture_mode === "live_challenge"
          ? { ...source, state: "deleting" }
          : source));
      setNotice(result.erasure === "confirmed"
        ? "Verification cancelled. The provider session is deleted; raw evidence remains queued for confirmed erasure."
        : result.erasure === "pending"
          ? "Verification cancelled. Provider and raw-evidence deletion are pending with the durable cleanup worker."
          : "Verification cancelled. No provider session existed; raw evidence is queued for confirmed erasure.");
      return result;
    } catch (cause) {
      handleApiError(cause, "Could not cancel this verification attempt");
      throw cause;
    }
  }

  async function handleCreateLivenessUpload(input: {
    challengeId: string;
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const created = await createLivenessUpload(fresh.accessToken, { replicaId: selected.replica_id, ...input });
      setChallenge(created.challenge);
      setSources((items) => [created.source, ...items.filter((item) => item.source_id !== created.source.source_id)]);
      return created;
    } catch (cause) {
      handleApiError(cause, "Could not authorize live evidence upload");
      throw cause;
    }
  }

  async function handleFinalizeLiveness(challengeId: string, sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await finalizeLivenessUpload(fresh.accessToken, selected.replica_id, challengeId, sourceId);
      setChallenge(result.challenge);
      setSources((items) => [result.source, ...items.filter((item) => item.source_id !== result.source.source_id)]);
      setNotice("Live evidence secured. Verification is pending and biometric modeling remains locked.");
      return result.challenge;
    } catch (cause) {
      handleApiError(cause, "Could not finalize live evidence");
      throw cause;
    }
  }

  async function handleDeleteSource(sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await deleteSource(fresh.accessToken, selected.replica_id, sourceId);
      setSources((items) => result.erasure === "complete"
        ? items.filter((item) => item.source_id !== sourceId)
        : items.map((item) => item.source_id === sourceId ? { ...item, state: "deleting" } : item));
      setNotice(result.erasure === "complete" ? "Private source erased." : "Source disabled. Verified erasure is pending.");
      return result.erasure;
    } catch (cause) {
      handleApiError(cause, "Could not erase private source");
      throw cause;
    }
  }

  // ── the one place readiness is computed ───────────────────────────────
  //
  // Above every early return, because hooks may not sit behind a conditional,
  // and `selected` may legitimately be null while the list is still loading. A
  // null replica produces an input that is honest about knowing nothing rather
  // than an input full of falses: `runtime: null`, `contextItemCount: null`.
  const wizardInput = useMemo<WizardInput>(() => ({
    stopped: selected ? selected.lifecycle === "revoked" || selected.lifecycle === "purging" : false,
    sourceConsent: hasSourceConsent(consents),
    sourceCount: sources.length,
    contextItemCount,
    identityVerified: Boolean(selected?.identity_verified),
    livenessVerified: Boolean(selected?.liveness_verified),
    sheetPersisted: Boolean(sheetDraft),
    mode,
    runtime: runtimeStatus
      ? {
        active: runtimeStatus.active,
        blockers: runtimeStatus.blockers,
        voiceGenomeVersion: runtimeStatus.versions.voice_genome,
      }
      : null,
    connectedChannels,
  }), [connectedChannels, consents, contextItemCount, mode, runtimeStatus, selected, sheetDraft, sources.length]);

  const wizard = useMemo(() => computeWizard(wizardInput), [wizardInput]);

  // The sheet the consent surfaces render. A saved draft when there is one, a
  // seed carrying THIS owner's name when there is not, and never the demo
  // teacher either way. `sheetSeed.ts` carries the whole argument.
  const sheetProvenance: SheetProvenance = sheetDraft ? "draft" : "seed";
  const sheet = useMemo<TeacherSheet | null>(
    () => sheetDraft ?? (selected ? seedSheetFor(selected) : null),
    [selected, sheetDraft],
  );

  if (!authChecked) {
    return (
      <main className="boot-page">
        <Mark />
        <Spinner label="Opening private studio" />
        <p>Opening your private studio</p>
      </main>
    );
  }

  if (!session) return <AuthGate copy={copy} onAuthed={(next) => { setSession(next); void loadReplicas(next); }} />;

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-logo" href="/" aria-label="Vyakti home">
          <Mark />
          <span><strong>VYAKTI</strong><small>{mode === "teacher" ? "GURUKUL STUDIO" : "REPLICA STUDIO"}</small></span>
        </a>
        <div className="header-trust"><span className="secure-dot" />{mode === "teacher" ? "Private teaching-clone workspace" : "Private self-replica workspace"}</div>
        <div className="account-menu">
          <span className="account-copy"><strong>{identity}</strong><small>Verified account session</small></span>
          <button className="signout-button" type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="studio-layout">
        {/* The two-column shell from PRODUCT-JOURNEY §3.2. The wizard rail sits
            ABOVE the workspace list because the wizard is the journey and the
            list is a switcher: on any given visit an owner changes step several
            times and changes workspace approximately never. The rail is hidden
            while there is no workspace to be in a step of, rather than rendered
            with three empty states. */}
        <div className="studio-rail">
          {selected && !showCreate && (
            <WizardRail steps={wizard.steps} current={step} onGo={goStep} />
          )}
          <ReplicaList
            replicas={replicas}
            selectedId={selected?.replica_id ?? null}
            onSelect={(id) => void selectReplica(id)}
            onNew={() => setShowCreate(true)}
          />
        </div>

        <main className="studio-main">
          {notice && (
            <div className="notice" role="status">
              <span>✓</span>{notice}
              <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>!</span><div><strong>{error.headline}</strong><p>{error.detail}</p></div>
              <button type="button" onClick={() => session && void loadReplicas(session)}>Try again</button>
            </div>
          )}

          {loadState === "loading" || loadState === "booting" ? (
            <div className="workspace-loading" aria-label="Loading replica workspace">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-subtitle" />
              <div className="skeleton-grid">
                {Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-card" key={index} />)}
              </div>
              <div className="skeleton skeleton-panel" />
            </div>
          ) : showCreate || (!selected && loadState === "ready") ? (
            <CreateReplicaCard onCreate={(name) => void handleCreate(name)} busy={creating} copy={copy} />
          ) : selected && sheet ? (
            <ReplicaWorkspace
              replica={selected}
              mode={mode}
              copy={copy}
              step={step}
              wizard={wizard}
              wizardInput={wizardInput}
              onGoStep={goStep}
              sheet={sheet}
              sheetProvenance={sheetProvenance}
              runtimeStatus={runtimeStatus}
              onRuntimeStatus={setRuntimeStatus}
              onContextCount={setContextItemCount}
              erasureStatus={erasureStatus}
              consents={consents}
              sources={sources}
              enrollmentLoading={enrollmentLoading}
              challenge={challenge}
              livenessLoading={livenessLoading}
              onGrantConsent={handleGrantConsent}
              onRevokeConsent={handleRevokeConsent}
              onCreateUpload={handleCreateUpload}
              onRetryUpload={handleRetryUpload}
              onFinalizeUpload={handleFinalizeUpload}
              onDeleteSource={handleDeleteSource}
              onIssueChallenge={handleIssueChallenge}
              onStartFaceSession={handleStartFaceSession}
              onPollFaceSession={handlePollFaceSession}
              onCancelChallenge={handleCancelChallenge}
              onCreateLivenessUpload={handleCreateLivenessUpload}
              onFinalizeLiveness={handleFinalizeLiveness}
              onIdentityChanged={handleIdentityChanged}
              onVerifiedConsentChanged={handleVerifiedConsentChanged}
              onRevoke={handleRevoke}
              revoking={revoking}
              accessToken={session.accessToken}
              onReviewAuthError={handleReviewAuthError}
            />
          ) : null}
        </main>
      </div>
    </div>
  );
}
