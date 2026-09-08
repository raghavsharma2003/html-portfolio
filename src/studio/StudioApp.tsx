import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  StudioAuthError,
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
  ReplicaReview,
  VoiceBuildIntent,
  ReplicaSource,
  SignedUpload,
  SourceKind,
  StudioSession,
} from "./types";
import { getReplicaReview, requestVoiceGenomeBuild } from "./processingApi";
const EnrollmentWorkspace = lazy(() => import("./EnrollmentWorkspace"));
const CloneExperience = lazy(() => import("./CloneExperience"));
const StudioWorkspaceStyles = lazy(() => import("./StudioWorkspaceStyles"));
import ExpertEntryVisual from "./ExpertEntryVisual";
import VyaktiMark from "./VyaktiMark";
import { PersonalAuthLoading, readPersonalAuthLocale, usePersonalAuthLocale } from "./personalAuthLocale";
const VoicePreviewPanel = lazy(() => import("./VoicePreviewPanel"));
const IngestChannelStudio = lazy(() => import("./IngestChannelStudio"));
const ContextLockerPanel = lazy(() => import("./ContextLockerPanel"));
const VideoEnrollPanel = lazy(() => import("./VideoEnrollPanel"));
const ActivityPanel = lazy(() => import("./ActivityPanel"));
import {
  AdvancedArea,
  Band,
  CompactRail,
  jumpTo,
  PlatformWorkBanner,
  StepBlockers,
  StepHead,
  WizardRail,
} from "./WizardRail";
import { useCompact } from "./useCompact";
import { BlockerNotice } from "./BlockerNotice";
import { CLASS_COPY } from "./blockerClass";
import type { ActivityJob, ActivityView } from "./activityApi";
import { activityRevision, IDLE_RECONCILE_MS, presentCloneProgress, presentActivityTiming } from "./activityPresentation";
import {
  computeWizard,
  queryForStep,
  queryForReplica,
  queryWithoutReplica,
  replicaFromQuery,
  stepBlockReason,
  stepFromQuery,
  type StepId,
  type WizardInput,
} from "./wizardModel";
import { seedSheetFor, type SheetProvenance } from "./sheetSeed";
import { selfTestWizard, studioSelfTestUiEnabled } from "./studioTestMode";
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
  setPrimaryVoiceSource,
} from "./enrollmentApi";
import {
  type LivenessIssueInput,
  type LivenessCaptureReadiness,
  livenessCaptureReadiness,
  cancelLivenessChallenge,
  createLivenessUpload,
  finalizeLivenessUpload,
  issueLivenessChallenge,
  livenessStatus,
  pollOfficialFaceSession,
  startOfficialFaceSession,
} from "./livenessApi";

// These panels belong to later tabs or production-only ceremonies. Keeping
// them in the first phone bundle made a person download the entire laboratory
// before they could record one sample. Suspense below gives the feature a
// bounded in-flow loading state only when the owner actually opens it.
const IdentityProofing = lazy(() => import("./IdentityProofing"));
const LivenessCapture = lazy(() => import("./LivenessCapture"));
const ProcessingReview = lazy(() => import("./ProcessingReview"));
const PersonModelStudio = lazy(() => import("./PersonModelStudio"));
const CalibrationStudio = lazy(() => import("./CalibrationStudio"));
const RuntimeGate = lazy(() => import("./RuntimeGate"));
const ReplicaDialogueLab = lazy(() => import("./ReplicaDialogueLab"));
const CandidateEvaluationLab = lazy(() => import("./CandidateEvaluationLab"));
const VoiceEnrollmentLab = lazy(() => import("./VoiceEnrollmentLab"));
const ModelConsentGate = lazy(() => import("./ModelConsentGate"));
const VoicePreviewLab = lazy(() => import("./VoicePreviewLab"));
const VoiceExperimentPanel = lazy(() => import("./VoiceExperimentPanel"));
const TeacherSheetStudio = lazy(() => import("./TeacherSheetStudio"));
const ChannelsStudio = lazy(() => import("./ChannelsStudio"));
const DisclosurePreview = lazy(() => import("./DisclosurePreview"));
const MirrorCallStudio = lazy(() => import("./MirrorCallStudio"));

type AuthStep = "email" | "code";
type LoadState = "booting" | "loading" | "ready" | "error";
type AuthResumeIntent = {
  replicaId: string | null;
  replicaName: string | null;
  step: StepId;
  email: string;
};

const STUDIO_SELF_TEST_UI = studioSelfTestUiEnabled(
  import.meta.env.VITE_REPLICA_SELF_TEST_MODE,
  import.meta.env.VITE_REPLICA_SELF_TEST_ENVIRONMENT,
);

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
  brandTag: "PERSONAL AI",
  introEyebrow: "",
  introTitle: "Your expertise. More personal.",
  introBody:
    "Create an AI with your knowledge, your voice, and a memory for each person.",
  workspaceNoun: "Personal clone",
  firstEyebrow: "",
  firstTitle: "Make your first Vyakti.",
  firstBody:
    "A short natural recording is enough to begin.",
  nameLabel: "Clone name",
  namePlaceholder: "Your name",
  fieldNote: "You can create only your own clone.",
  // C4 (UX-QUEUE copy audit): the old line spent most of a first success on
  // what does not work. The truth is unchanged and still stated on the panels
  // that own each gate; what changes is that the first thing a person reads
  // after their first action tells them what to do next.
  createdNotice: "Your workspace is ready. Add one file or link on this step, and you can hear a private draft voice before any verification.",
};

const TEST_COPY: StudioCopy = {
  brandTag: "INTERNAL TEST STUDIO",
  introEyebrow: "",
  introTitle: "Add your sources. Then test your clone.",
  introBody: "Upload useful examples of your voice, writing, videos, and context. Then hear the draft, talk to it, and correct it.",
  workspaceNoun: "Test clone",
  firstEyebrow: "",
  firstTitle: "Create a test workspace.",
  firstBody: "Name the clone, add any useful sources, then hear it and talk to it.",
  nameLabel: "Clone name",
  namePlaceholder: "Your name",
  fieldNote: "You can change the clone as you test it.",
  createdNotice: "Test workspace ready. Add useful sources, or start talking to the clone now.",
};

const ERASURE_REQUEST_KEY = "vyakti.replica.erasure-request.v1";
const CREATION_INTENT_KEY = "vyakti.replica.creation-intent.v1";

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

function durableCreationIntent(userId: string) {
  const key = `${CREATION_INTENT_KEY}:${userId}`;
  try {
    const stored = localStorage.getItem(key) || "";
    if (/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(stored)) return stored.toLowerCase();
    const created = crypto.randomUUID();
    localStorage.setItem(key, created);
    return created;
  } catch {
    return crypto.randomUUID();
  }
}

function clearCreationIntent(userId: string) {
  try { localStorage.removeItem(`${CREATION_INTENT_KEY}:${userId}`); } catch {
    // The server's owner-scoped intent remains authoritative.
  }
}

function DeferredWorkspacePanel() {
  return (
    <section className="deferred-workspace" role="status" aria-live="polite" aria-atomic="true">
      <Spinner label="Opening this part of the studio" />
      <div>
        <strong>Opening this part</strong>
        <p>Your recording, draft and current place stay unchanged.</p>
      </div>
    </section>
  );
}

const TEST_SOURCE_TYPES = [
  { label: "Audio or video file", anchor: "#enrollment-workspace" },
  { label: "Screenshot, document, or text file", anchor: "#enrollment-workspace" },
  { label: "Text or web link", anchor: "#context-locker" },
  { label: "YouTube video", anchor: "#video-enroll-heading" },
] as const;

function TestSourceGuide() {
  return (
    <details className="test-source-guide">
      <summary>What can I add?</summary>
      <nav aria-label="Source types">
        {TEST_SOURCE_TYPES.map((source) => (
          <button key={source.label} type="button" onClick={() => jumpTo(source.anchor, source.label)}>
            {source.label}
          </button>
        ))}
      </nav>
    </details>
  );
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

// `Band` moved to `WizardRail.tsx` (WS-AJ), where it gained a collapsible phone
// form. It still carries no number, for the reason it never did: UX-Q-07 asked
// for phase-scoped numbering to kill the `04`/`04` collision between
// `ProcessingReview` and `ModelConsentGate`, then DESIGN-LAW §1 banned
// section-numbering eyebrows outright, and deleting the numbers killed the
// collision more permanently than renumbering it would have.

function AuthGate({
  onAuthed,
  testEnvironment,
  resumeIntent,
}: {
  onAuthed: (session: StudioSession) => void;
  testEnvironment: boolean;
  resumeIntent: AuthResumeIntent | null;
}) {
  const { locale, ready, failed, retry, switchLocale, t } = usePersonalAuthLocale();
  const intro = t.variant[testEnvironment ? "test" : "generic"];
  const [step, setStep] = useState<AuthStep>("email");
  const [email, setEmail] = useState(resumeIntent?.email || "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [checkingLink, setCheckingLink] = useState(false);
  const [error, setError] = useState<"linkNotReadyError" | "sendError" | "networkError" | "rateLimitError" | "serviceUnavailableError" | "codeMismatchError" | "googleError" | "">("");
  const codeRef = useRef<HTMLInputElement>(null);
  const linkButtonRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (resumeIntent && step === "email") emailRef.current?.focus();
  }, [resumeIntent, step, ready]);

  const acceptLinkedSession = useCallback(async (showNotReady = false) => {
    setCheckingLink(true);
    try {
      const linked = await restoreSession({ reportTransientFailure: true });
      if (linked) {
        onAuthed(linked);
        return;
      }
      if (showNotReady) setError("linkNotReadyError");
    } catch (cause) {
      if (showNotReady) setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : "serviceUnavailableError" : "networkError");
    } finally {
      setCheckingLink(false);
    }
  }, [onAuthed]);

  useEffect(() => {
    if (step === "code") linkButtonRef.current?.focus();
  }, [step, ready]);

  useEffect(() => {
    if (step !== "code") return;
    const checkStorage = () => { void acceptLinkedSession(false); };
    const checkVisible = () => {
      if (document.visibilityState === "visible") void acceptLinkedSession(false);
    };
    window.addEventListener("storage", checkStorage);
    window.addEventListener("focus", checkStorage);
    document.addEventListener("visibilitychange", checkVisible);
    return () => {
      window.removeEventListener("storage", checkStorage);
      window.removeEventListener("focus", checkStorage);
      document.removeEventListener("visibilitychange", checkVisible);
    };
  }, [acceptLinkedSession, step]);

  async function sendCode() {
    setError("");
    setBusy(true);
    try {
      await sendEmailOtp(email.trim());
      setStep("code");
    } catch (cause) {
      setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : cause.status >= 500 ? "serviceUnavailableError" : "sendError" : "networkError");
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
    } catch (cause) {
      const rejectedCode = cause instanceof StudioAuthError && (cause.status === 400 || cause.status === 401);
      setError(cause instanceof StudioAuthError ? cause.status === 429 ? "rateLimitError" : rejectedCode ? "codeMismatchError" : "serviceUnavailableError" : "networkError");
      if (rejectedCode) setCode("");
      requestAnimationFrame(() => codeRef.current?.focus());
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <PersonalAuthLoading locale={locale} failed={failed} retry={retry} switchLocale={switchLocale} testEnvironment={testEnvironment} />;

  return (
    <main className="auth-page" lang={locale} data-studio-auth-locale={locale} data-auth-theme={testEnvironment ? "test" : "general"}>
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="auth-brand">
        <a href="/" aria-label={t.homeAriaLabel}><VyaktiMark /></a>
        <label className="visually-hidden" htmlFor="studio-auth-language">{locale === "hi" ? "भाषा" : "Language"}</label>
        <select id="studio-auth-language" className="auth-language-select" value={locale} onChange={event => switchLocale(event.target.value === "hi" ? "hi" : "en")}>
          <option value="en" lang="en">English</option><option value="hi" lang="hi">हिन्दी</option>
        </select>
        <span className="brand-rule" />
        <span>{intro.brandTag}</span>
      </header>

      <section className="auth-intro" aria-labelledby="studio-title">
        {intro.introEyebrow && <p className="eyebrow">{intro.introEyebrow}</p>}
        <h1 id="studio-title">{intro.introTitle}</h1>
        <p>{intro.introBody}</p>
        {!testEnvironment && <ExpertEntryVisual copy={{alt: t.visualAlt, ...t.visualCaptions}} />}
        {!testEnvironment && <div className="trust-strip" aria-label={t.safeguardsAriaLabel}>
          <span><i />{t.privateByDefault}</span>
          <span><i />{t.everyClipDisclosed}</span>
          <span><i />{t.deleteAnytime}</span>
        </div>}
      </section>

      <section className="auth-card" aria-labelledby="signin-title">
        <h2 id="signin-title">{step === "email" ? (resumeIntent ? t.welcomeBackTitle : t.emailTitle) : t.inboxTitle}</h2>
        {resumeIntent && step === "email" ? (
          <div className="auth-resume-note" role="status">
            <strong>{t.resumeTitle}</strong>
            <p>
              {t.resumeBodyTemplate.replace("{name}", resumeIntent.replicaName || t.sameClone).replace("{step}", t.stepTitle[resumeIntent.step])}
            </p>
          </div>
        ) : null}
        <p className="card-copy">
          {step === "email"
            ? t.emailBody
            : t.inboxBodyTemplate.replace("{email}", email)}
        </p>

        {step === "email" ? (
          <>
            <label className="field-label" htmlFor="studio-email">{t.emailLabel}</label>
            <input
              ref={emailRef}
              id="studio-email"
              className="field"
              type="email"
              inputMode="email"
              autoComplete="email"
              placeholder={t.emailPlaceholder} lang="en"
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
              {busy ? <><Spinner label={t.sendingAriaLabel} />{t.sending}</> : t.sendLink}
            </button>
            <div className="or"><span>{t.or}</span></div>
            <button
              className="button google-button"
              type="button"
              disabled={busy}
              onClick={() => {
                setError("");
                setBusy(true);
                googleSignIn().catch(() => {
                  setError("googleError");
                  setBusy(false);
                });
              }}
            >
              <span className="google-g" aria-hidden="true">G</span>
              {t.google}
            </button>
          </>
        ) : (
          <>
            <p className="inbox-status" id="studio-inbox-help" role="status">
              {t.inboxHelp}
            </p>
            <button
              ref={linkButtonRef}
              className="button primary-button"
              type="button"
              disabled={busy || checkingLink}
              onClick={() => void acceptLinkedSession(true)}
            >
              {checkingLink ? t.checkingLink : t.openedLink}
            </button>
            <div className="or"><span>{t.optionalCodeDivider}</span></div>
            <label className="field-label" htmlFor="studio-code">{t.codeLabel}</label>
            <input
              ref={codeRef}
              id="studio-code"
              className="field code-field"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-describedby="studio-inbox-help"
              maxLength={6}
              placeholder={t.codePlaceholder}
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
              {busy ? <><Spinner label={t.verifyingAriaLabel} />{t.verifying}</> : t.verify}
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
              {t.differentEmail}
            </button>
          </>
        )}
        {error && <p className="inline-error" role="alert">{String(t[error])}</p>}
        {!testEnvironment && <p className="legal-copy">
          {t.legalNotice}
        </p>}
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
        {copy.firstEyebrow && <p className="eyebrow">{copy.firstEyebrow}</p>}
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
  testEnvironment = false,
}: {
  replicas: Replica[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  testEnvironment?: boolean;
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
              <small>{testEnvironment ? (["ready", "active"].includes(replica.lifecycle) ? "Ready to test" : "Building") : lifecycleLabel(replica.lifecycle)}</small>
            </span>
            <span className={`state-dot state-${replica.lifecycle}`} />
          </button>
        ))}
      </div>
      <button className="new-replica" type="button" onClick={onNew}>
        <span>+</span> Start new clone
      </button>
    </aside>
  );
}

function CloneOverview({
  sources,
  runtimeStatus,
  activityView,
  onGoStep,
}: {
  sources: ReplicaSource[];
  runtimeStatus: ReplicaRuntimeStatus | null;
  activityView: ActivityView | null;
  onGoStep: (next: StepId) => void;
}) {
  const presentation = presentCloneProgress(sources, runtimeStatus, activityView);

  return (
    <section className="clone-overview" aria-labelledby="clone-overview-title">
      <div className="clone-overview-next">
        <div className="clone-overview-status">
          <span>{presentation.canTest ? "Ready" : "Building"}</span>
          <strong aria-live="polite">{presentation.milestoneLabel}</strong>
        </div>
        <h2 id="clone-overview-title">{presentation.next.title}</h2>
        <p>{presentation.next.detail}</p>
        <div className="clone-overview-return" role="status">
          <strong>{presentation.timing.returnGuidance}</strong>
          <span>{presentation.timing.observedRange}</span>
        </div>
        {!presentation.canTest && <p className="clone-test-unlock">Test your clone becomes ready automatically after the recording and voice draft finish. You can leave this page open, close it, or reload it.</p>}
        <button className="button primary-button" type="button" onClick={() => onGoStep(presentation.next.step)}>
          {presentation.next.action}
        </button>
        <details className="clone-overview-progress">
          <summary>Setup milestones</summary>
          <ol aria-label="Clone setup milestones">
            {presentation.milestones.map((milestone, index) => (
              <li className={milestone.done ? "done" : index === presentation.completed ? "current" : ""} key={milestone.label}>
                <span>{milestone.done ? "Done" : index + 1}</span>
                <div><strong>{milestone.label}</strong><small>{milestone.detail}</small></div>
              </li>
            ))}
          </ol>
          <dl className="clone-overview-timing" aria-label="Setup timing and return guidance">
            <div><dt>Current phase</dt><dd>{presentation.timing.phase}</dd></div>
            <div><dt>Observed range</dt><dd>{presentation.timing.observedRange}</dd></div>
            <div><dt>Automatic check</dt><dd>{presentation.timing.nextCheck}</dd></div>
            <div><dt>Leave or return</dt><dd>{presentation.timing.background} {presentation.timing.returnGuidance}</dd></div>
          </dl>
        </details>
      </div>
    </section>
  );
}

function LiveWorkToast({ view, onOpen }: { view: ActivityView | null; onOpen: () => void }) {
  const active = view?.jobs.filter((job) => job.state === "running" || job.state === "queued") ?? [];
  if (!active.length) return null;
  const measured = active.filter((job) => job.lane === "upload_processing" && job.progress && job.progress.total > 0);
  const done = measured.reduce((sum, job) => sum + (job.progress?.done || 0), 0);
  const total = measured.reduce((sum, job) => sum + (job.progress?.total || 0), 0);
  const current = active[0];
  const timing = presentActivityTiming(current, Date.now(), view?.next_poll_ms);
  const measuredLabel = total > 0 ? `${done} of ${total} source checks complete` : timing.ownerLabel;
  return (
    <aside className="live-work-toast" role="status" aria-label="Clone processing status">
      <div className="live-work-toast-copy">
        <span>{active.length === 1 ? "Building your clone" : `${active.length} tasks are active`} · {measuredLabel}</span>
        <strong>{current.state_reason || "Your source is being processed."}</strong>
        <small>{timing.detail} {timing.returnGuidance}</small>
      </div>
      <button type="button" onClick={onOpen}>View details</button>
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
      {/* Carries the class label like every other blocked state on the studio,
          because this genuinely IS the person's turn and saying so in the same
          words the rest of the product uses is what makes "waiting on us"
          believable when it appears. A vocabulary that is only honest in the
          places where honesty is cheap is not a vocabulary. */}
      <p className="voice-unlock-class">{CLASS_COPY.you.label}</p>
      <p>
        The preview above is private and works right now. To let this voice speak to anyone else we need {missing},
        because a voice is a person and this product only ever clones its own owner.
      </p>
      <a className="text-button" href="#identity-proofing">Verify below on this step</a>
    </aside>
  );
}

/**
 * The four readiness cards, and their phone form.
 *
 * Same numbers, same derivation, two layouts. On a phone it is a `<details>`
 * whose summary carries the one number a person is actually tracking, because
 * a four-card grid above the first control is a dashboard where a task should
 * be. Nothing is hidden that is not still one tap away, and nothing here was
 * ever an action, which is what makes it eligible to collapse at all.
 */
function ReadinessStrip({
  compact,
  verificationCount,
  sourceCount,
  runtimeStatus,
}: {
  compact: boolean;
  verificationCount: number;
  sourceCount: number;
  runtimeStatus: ReplicaRuntimeStatus | null;
}) {
  const cards = (
    <>
      <article className="readiness-card readiness-primary">
        <p className="eyebrow">Activation readiness</p>
        <strong>{verificationCount}/3</strong>
        <span>identity checks complete</span>
        <div className="progress-track"><span style={{ transform: `scaleX(${verificationCount * 0.33333})` }} /></div>
      </article>
      <article className="readiness-card">
        <span className="metric-label">Sources</span>
        <strong>{sourceCount}</strong>
        <span>{sourceCount ? "Private ledger entries" : "Nothing uploaded"}</span>
      </article>
      <article className="readiness-card">
        <span className="metric-label">Voice versions</span>
        <strong>{runtimeStatus ? (runtimeStatus.versions.voice_genome ?? 0) : "—"}{/* emdash-ok: the empty-value placeholder, not prose */}</strong>
        {/* WS-AP, from a measured production defect: this read "0 / Not built
            yet" while a real draft genome existed, because the count itself
            used to be scoped to approved-only and the label assumed any
            non-zero count meant approved. Both are fixed together: the count
            is now the newest genome that EXISTS (any status,
            `api/_replica-runtime.js`), and the label reads its own status
            rather than inferring one from a number. */}
        <span>
          {!runtimeStatus || !runtimeStatus.versions.voice_genome
            ? (!runtimeStatus ? "Checking" : "Not built yet")
            : runtimeStatus.voice_genome_status === "approved"
              ? "Approved voice model"
              : "Draft, needs your approval"}
        </span>
      </article>
      <article className="readiness-card trust-card">
        <span className="metric-label">Public voice library</span>
        <strong>Never</strong>
        <span>Your voice is never listed or shared</span>
      </article>
    </>
  );

  if (!compact) {
    return <section className="readiness-grid" aria-label="Replica readiness">{cards}</section>;
  }
  return (
    <details className="readiness-compact">
      <summary>
        <span className="readiness-compact-count">{verificationCount} of 3</span>
        <span className="readiness-compact-label">identity checks complete</span>
      </summary>
      <div className="readiness-grid" aria-label="Replica readiness">{cards}</div>
    </details>
  );
}

function ReplicaWorkspace({
  replica,
  testEnvironment,
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
  activityView,
  onRuntimeStatus,
  onContextCount,
  onGrantConsent,
  onRevokeConsent,
  onCreateUpload,
  onRetryUpload,
  onFinalizeUpload,
  onSetPrimaryVoice,
  onDeleteSource,
  onCheckCaptureReadiness,
  onIssueChallenge,
  onStartFaceSession,
  onPollFaceSession,
  onCancelChallenge,
  onCreateLivenessUpload,
  onFinalizeLiveness,
  onIdentityChanged,
  onVerifiedConsentChanged,
  onRevoke,
  onStartNew,
  revoking,
  accessToken,
  onReviewAuthError,
  compact,
  onActivityView,
  onActivityAct,
}: {
  replica: Replica;
  testEnvironment: boolean;
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
  activityView: ActivityView | null;
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
  }) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload | null; finalized: boolean }>;
  onFinalizeUpload: (sourceId: string) => Promise<ReplicaSource>;
  onSetPrimaryVoice: (sourceId: string) => Promise<ReplicaSource>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
  onCheckCaptureReadiness: (signal?: AbortSignal) => Promise<LivenessCaptureReadiness>;
  onIssueChallenge: (input: LivenessIssueInput, signal?: AbortSignal) => Promise<LivenessChallenge>;
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
  onStartNew: () => void;
  revoking: boolean;
  accessToken: string;
  onReviewAuthError: (cause: unknown) => void;
  /** Phone-sized viewport. Structural, not cosmetic. See `useCompact.ts`. */
  compact: boolean;
  /** Must be reference-stable: it is a dependency of ActivityPanel's poll. */
  onActivityView: (view: ActivityView) => void;
  /** What to do with a job whose next action is not a safe self-retry (the
   *  "Look at the build" tap and anything like it). See `handleActivityAct`'s
   *  own comment for the dead-click defect this closes. */
  onActivityAct: (job: ActivityJob) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [meetView, setMeetView] = useState<"preview" | "call" | "review">(() => {
    const value = new URLSearchParams(window.location.search).get("view");
    return value === "call" || value === "review" ? value : "preview";
  });
  const stopped = replica.lifecycle === "revoked" || replica.lifecycle === "purging";
  const erased = erasureStatus?.state === "complete";
  const verificationCount = [replica.age_verified, replica.identity_verified, replica.liveness_verified].filter(Boolean).length;
  const view = wizard.steps.find((row) => row.id === step) ?? wizard.steps[0];
  const stepNumber = view.number;
  const cloneProgress = presentCloneProgress(sources, runtimeStatus, activityView);
  const journeyPending = Boolean(cloneProgress.primarySourceId && !cloneProgress.canTest);
  const previewWizardInput = testEnvironment
    ? { ...wizardInput, sourceConsent: true, identityVerified: true, livenessVerified: true, mode: "generic" as const, runtime: null }
    : wizardInput;

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

  useEffect(() => {
    const restoreView = () => {
      const value = new URLSearchParams(window.location.search).get("view");
      setMeetView(value === "call" || value === "review" ? value : "preview");
    };
    window.addEventListener("popstate", restoreView);
    return () => window.removeEventListener("popstate", restoreView);
  }, []);

  function chooseMeetView(next: "preview" | "call" | "review") {
    setMeetView(next);
    const params = new URLSearchParams(window.location.search);
    params.set("view", next);
    window.history.replaceState({ step: "meet", view: next, replica: replica.replica_id }, "", `?${params.toString()}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  return (
    <>
      {/* THE PAGE FURNITURE, AND WHAT A PHONE PAYS FOR IT.
          On a wide screen this is a 67px serif name, a kicker, a created-on
          line and a rotated wax seal: a masthead, and it earns its space.
          On a 390pt screen the same block was about a third of the first
          viewport, spent restating a workspace name the person just tapped to
          get here. So on a phone it collapses to one line at --text-small, and
          the details move behind it. The seal is gone entirely below 590px in
          studio.css already; what is new is that the name stops being a
          display heading, because there is only room for one display heading
          on a phone and the STEP TITLE has to be it. */}
      {testEnvironment && (
        <aside className="test-environment-notice" role="status">
          <strong>Internal test environment</strong>
          <span>Private testing only.</span>
        </aside>
      )}

      {compact ? (
        <section className="workspace-heading workspace-heading-compact">
          <span className={`state-dot state-${replica.lifecycle}`} />
          <strong>{replica.display_name}</strong>
          <small>{stopped ? lifecycleLabel(replica.lifecycle) : testEnvironment ? "Private voice clone" : "Voice clone"}</small>
        </section>
      ) : (
        <section className="workspace-heading">
          <div>
            <div className="workspace-kicker">
              <span className={`state-dot state-${replica.lifecycle}`} />
              {testEnvironment ? (runtimeStatus?.versions.voice_genome ? "Ready to test" : "Building") : lifecycleLabel(replica.lifecycle)}
              <span className="tiny-divider" />
              {copy.workspaceNoun}
            </div>
            <h1>{replica.display_name}</h1>
            <p>Created {dateLabel(replica.created_at)}</p>
          </div>
          {testEnvironment ? (
            <div className="workspace-actions" aria-label="Clone actions">
              <button className="button secondary-button" type="button" onClick={onStartNew}>Start new clone</button>
              <button className="workspace-delete" type="button" onClick={() => setConfirming(true)}>Delete this clone</button>
            </div>
          ) : (
            <div className="control-seal">
              <span>{stopped ? "STOPPED" : "OWNER CONTROLLED"}</span>
              <small>{stopped ? (erased ? "Erasure verified" : "Erasure in progress") : "Private workspace"}</small>
            </div>
          )}
        </section>
      )}

      {!stopped && (
        <>
          {testEnvironment && compact && (
            <div className="workspace-actions workspace-actions-compact" aria-label="Clone actions">
              <button className="button secondary-button" type="button" onClick={onStartNew}>Start new</button>
              <button className="workspace-delete" type="button" onClick={() => setConfirming(true)}>Delete clone</button>
            </div>
          )}
          {activityView?.jobs.some((job) => job.state === "running" || job.state === "queued") ? (
            <LiveWorkToast
              view={activityView}
              onOpen={() => {
                onGoStep("feed");
                window.setTimeout(() => jumpTo("#processing-status-feed", "processing details"), 60);
              }}
            />
          ) : step !== "meet" ? (
            <CloneOverview
              sources={sources}
              runtimeStatus={runtimeStatus}
              activityView={activityView}
              onGoStep={onGoStep}
            />
          ) : null}
        </>
      )}

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
          {/* The eyebrow ("Step 2 of 3") is gone on a phone and the promise is
              one tap away. The rail directly above already answers which step
              this is, and answering it twice inside 40px of a 390pt screen is
              exactly the "so much nonsense written on it" DESIGN-LAW \u00a71 names.
              `stepNumber` still drives the wide layout's numbering. */}
          {testEnvironment ? (
            <section className="step-head step-head-test" aria-labelledby="step-title">
              <h2 id="step-title">{view.title}</h2>
            </section>
          ) : compact ? (
            <StepHead title={view.title} promise={view.promise} compact />
          ) : (
            <section className="step-head" aria-labelledby="step-title">
              <p className="eyebrow">Step {stepNumber} of {wizard.steps.length}</p>
              <h2 id="step-title">{view.title}</h2>
              <p className="step-promise">{view.promise}</p>
            </section>
          )}

          {/* Every number on this strip is derived. The old version rendered a
              literal "Voice versions 0 / No model trained" regardless of the
              real `runtime.versions.voice_genome`, and a "Public access / Off /
              Cannot be changed" claim that ChannelsStudio exists to falsify
              (UX-Q-04, copy audit C5 and C6). A status this product cannot
              derive is not shown.

              ON A PHONE IT IS COLLAPSED, and it is the clearest case in the
              studio for collapsing something: four cards, none of which is an
              ACTION, sitting between the step title and the first control. It
              is a dashboard, and a dashboard above the fold on a step whose job
              is one task is the fold spent on furniture. The summary keeps the
              one number that changes ("2 of 3 identity checks"), so nothing a
              person is tracking disappears. */}
          {!testEnvironment && <ReadinessStrip
            compact={compact}
            verificationCount={verificationCount}
            sourceCount={sources.length}
            runtimeStatus={runtimeStatus}
          />}

          {/* The blocking line, now carrying its class. This is the surface the
              owner's screenshot caught saying "9 things ... are still waiting
              on you" while the real blocker was a processing queue nothing
              drained. It names one thing, and it says whose it is. */}
          {!testEnvironment && <BlockerNotice reason={stepBlockReason(step, wizardInput)} className="step-block" />}

          {/* THE OWNER'S REPORT, VERBATIM: "I have to scroll down the whole
              page to know that the audio is processing." One line, on every
              step, directly under the step head, so it is above the fold at
              every width this product ships. Feed and Meet both mount the
              Activity panel; Deploy does not, so its "see what is happening"
              sends the person to the step that does rather than jumping at an
              anchor that is not on the page. */}
          {!testEnvironment && <PlatformWorkBanner
            work={wizardInput.platformWork}
            onSeeActivity={() => {
              if (step === "deploy") { onGoStep("feed"); return; }
              jumpTo(`#processing-status-${step}`, "where each upload is right now");
            }}
          />}

          {step === "feed" && (
            <>
              {testEnvironment && <TestSourceGuide />}
              <Band
                collapsible={compact}
                defaultOpen
                title={testEnvironment ? "Add source files" : "Permission, then your material"}
                blurb={testEnvironment ? "Upload a clear voice recording first. You can add more later." : "Nothing is read, transcribed or stored until you say it may be. Then everything you bring lands in one private ledger you can erase a row at a time."}
              >
                <EnrollmentWorkspace
                  key={`enrollment-${replica.replica_id}`}
                  replicaId={replica.replica_id}
                  testEnvironment={testEnvironment}
                  consents={consents}
                  sources={sources}
                  loading={enrollmentLoading}
                  onGrantConsent={onGrantConsent}
                  onRevokeConsent={onRevokeConsent}
                  onCreateUpload={onCreateUpload}
                  onRetryUpload={onRetryUpload}
                  onFinalizeUpload={onFinalizeUpload}
                  onSetPrimaryVoice={onSetPrimaryVoice}
                  onPrimaryVoiceQueued={() => {
                    const params = new URLSearchParams(window.location.search);
                    params.set("view", "preview");
                    window.history.replaceState({ step: "feed", view: "preview", replica: replica.replica_id }, "", `?${params.toString()}`);
                    setMeetView("preview");
                    onGoStep("meet");
                  }}
                  onDeleteSource={onDeleteSource}
                />
              </Band>

              <Band
                collapsible={compact}
                defaultOpen={false}
                title={testEnvironment ? "Add files and links" : "Files, links, videos, channels"}
                blurb={testEnvironment ? "Optional: add notes, a web link, or one YouTube video." : "Four ways in, one ledger out. Everything here is proposed to you before it changes anything about your clone."}
              >
                <ContextLockerPanel
                  key={`context-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  testEnvironment={testEnvironment}
                  onAuthError={onReviewAuthError}
                  onItemCount={onContextCount}
                />
                <VideoEnrollPanel
                  key={`video-enroll-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  testEnvironment={testEnvironment}
                  onUseFileUpload={() => jumpTo("#enrollment-workspace", "Audio or video file")}
                />
                {/* WS-S. The channel lane is horizontal by the same argument
                    the Context Locker is: a teacher's uploads are one kind of
                    channel and everyone else's are the rest, so it is no longer
                    gated on teacher mode. */}
                {testEnvironment ? (
                  <details className="test-channel-later">
                    <summary>Connect a whole YouTube channel later</summary>
                    <IngestChannelStudio
                      key={`ingest-${replica.replica_id}`}
                      token={accessToken}
                      replicaId={replica.replica_id}
                      testEnvironment
                      onAuthError={onReviewAuthError}
                    />
                  </details>
                ) : (
                  <IngestChannelStudio
                    key={`ingest-${replica.replica_id}`}
                    token={accessToken}
                    replicaId={replica.replica_id}
                    onAuthError={onReviewAuthError}
                  />
                )}
              </Band>

              {/* WS-AF's activity surface, in its own band rather than buried
                  at the foot of the intake band. It is now the thing that
                  answers "did that land, and is anything stuck", which on the
                  day the owner tested was the ONLY honest answer available:
                  their audio was sitting at quarantined because nothing drained
                  the processing queue. It is also the wizard's source of truth
                  for the "waiting on us" class, which is why `onView` is here.
                  UX-Q-AE-02 is closed by this mount and the labelled hole
                  (`ProcessingStatusMount.tsx`) is deleted. */}
              <Band
                collapsible={compact}
                defaultOpen={false}
                title="Where each upload is right now"
                blurb="Everything you have handed over, and what is happening to it. Anything that needs you is at the top, and anything stuck on our side says so."
              >
                <ActivityPanel
                  key={`activity-feed-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  where="feed"
                  // The Band above already carries this exact title and a
                  // blurb that says the same thing; the panel's own heading
                  // is what the owner's screenshot showed rendering twice.
                  showHeading={false}
                  onAuthError={onReviewAuthError}
                  onView={onActivityView}
                  onAct={onActivityAct}
                  journeyPending={journeyPending}
                />
              </Band>
            </>
          )}

          {step === "meet" && (
            <>
              <nav className="meet-view-tabs" aria-label="Meet your clone">
                {([
                  ["preview", "Preview"],
                  ["call", "Voice chat"],
                  ["review", "Review"],
                ] as const).map(([id, label]) => (
                  <button key={id} type="button" className={meetView === id ? "active" : ""} aria-current={meetView === id ? "page" : undefined} onClick={() => chooseMeetView(id)}>
                    {label}
                  </button>
                ))}
              </nav>

              {meetView === "preview" && <Band
                collapsible={false}
                defaultOpen
                title="Hear your voice"
                blurb="Type one line, then listen to the private draft."
              >
                <VoicePreviewPanel
                  key={`hear-voice-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  wizardInput={previewWizardInput}
                  testEnvironment={testEnvironment}
                  onManageSources={() => onGoStep("feed")}
                  onAuthError={onReviewAuthError}
                />
                {!testEnvironment && <VoiceUnlockNotice replica={replica} />}
              </Band>}

              {meetView === "call" && <Band
                collapsible={false}
                defaultOpen
                title="Turn-by-turn voice chat"
                blurb="Talk naturally. Your clone answers after each turn and proposes anything worth remembering for your review."
              >
                <MirrorCallStudio
                  key={`mirror-call-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  stopped={stopped}
                  onAuthError={onReviewAuthError}
                />
              </Band>}

              {meetView === "review" && <><Band
                collapsible={compact}
                defaultOpen
                title={testEnvironment ? "Review what it learned" : "Check it and correct it"}
                blurb="What we think we learned, one claim at a time. You decide what represents you before anything becomes part of the clone."
              >
                {!testEnvironment && mode === "teacher" && (
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
                {!testEnvironment && <ProcessingReview
                  token={accessToken}
                  replicaId={replica.replica_id}
                  sourceCount={sources.length}
                  onAuthError={onReviewAuthError}
                />}
                {/* WS-AF's second mood: "why does it not know that yet". Same
                    data, unfinished work FIRST, because here the unfinished
                    work is the answer rather than the reassurance. */}
                <ActivityPanel
                  key={`activity-meet-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  where="meet"
                  onAuthError={onReviewAuthError}
                  onView={onActivityView}
                  onAct={onActivityAct}
                  journeyPending={journeyPending}
                />
                <details className="voice-experiment-later">
                  <summary>Run a blind voice comparison</summary>
                  <VoiceExperimentPanel
                    key={`voice-experiment-${replica.replica_id}`}
                    replicaId={replica.replica_id}
                  />
                </details>
              </Band>

              {/* UX-Q-05. Required, therefore open. These four are the gates
                  `RuntimeGate` refuses activation without, and they live on the
                  step whose voice they unlock rather than in a drawer called
                  "Advanced". */}
              {!testEnvironment && <Band
                collapsible={compact}
                defaultOpen={false}
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
                  scopeKey={JSON.stringify([accessToken, replica.replica_id, consents.filter(receipt => receipt.scope === "capture" || receipt.scope === "storage").map(receipt => [receipt.consent_id, receipt.revoked_at, receipt.expires_at]), sources.filter(source => source.voice_role === "primary").map(source => [source.source_id, source.updated_at, source.state])])}
                  expectedSourceId={sources.find(source => source.voice_role === "primary")?.source_id}
                  consentActive={hasSourceConsent(consents) && replica.age_verified}
                  challenge={challenge}
                  loading={livenessLoading}
                  onCheckReadiness={onCheckCaptureReadiness}
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
              </Band>}

              {!testEnvironment && <AdvancedArea
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
              </AdvancedArea>}
              </>}
            </>
          )}

          {step === "deploy" && (
            <>
              {mode === "teacher" && (
                // Collapsed on a phone, and the gates band below is the one that
                // opens: the primary ACT on this step is activation, and a step
                // that opens onto reading material puts the act below a fold.
                // The summary still names what is inside, and the disclosure
                // itself is unchanged and one tap away.
                <Band
                  collapsible={compact}
                  defaultOpen={false}
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
                collapsible={compact}
                defaultOpen
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
                  collapsible={compact}
                  defaultOpen={false}
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

          {!testEnvironment && <StepBlockers step={view} compact={compact} />}
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
            <div className="modal-stop">{testEnvironment ? "DELETE" : "STOP"}</div>
            <h2 id="revoke-title">{testEnvironment ? `Delete ${replica.display_name}?` : `Revoke ${replica.display_name}?`}</h2>
            <p>
              {testEnvironment
                ? "This stops the clone now and starts deleting its sources, voice drafts, and stored data. Downloaded audio cannot be recalled."
                : "This immediately blocks generation and queues stored sources, derived models, memories, and provider copies for erasure. Audio already exported outside Vyakti cannot be recalled."}
            </p>
            <label className="field-label" htmlFor="revoke-confirmation">Type {testEnvironment ? "DELETE" : "REVOKE"} to confirm</label>
            <input
              id="revoke-confirmation"
              className="field"
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
            />
            <div className="modal-actions">
              <button className="button secondary-button" disabled={revoking} onClick={() => setConfirming(false)}>Keep clone</button>
              <button
                className="button destructive-button"
                disabled={revoking || confirmation !== (testEnvironment ? "DELETE" : "REVOKE")}
                onClick={() => void onRevoke()}
              >
                {revoking
                  ? <><Spinner label={testEnvironment ? "Deleting clone" : "Revoking replica"} />{testEnvironment ? "Deleting" : "Revoking"}</>
                  : testEnvironment ? "Delete clone" : "Revoke permanently"}
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
  const copy = STUDIO_SELF_TEST_UI ? TEST_COPY : GENERIC_COPY;
  const [session, setSession] = useState<StudioSession | null>(null);
  const activeSessionRef = useRef<StudioSession | null>(null);
  const replicaLoadRevision = useRef(0);
  const accountRevision = useRef(0);
  const creationRevision = useRef(0);
  const livenessReadRevision = useRef(0);
  const livenessIssueRevision = useRef(0);
  const livenessMounted = useRef(false);
  useEffect(() => { livenessMounted.current = true; return () => { livenessMounted.current = false; }; }, []);
  const consentRevision = useRef(0);
  const consentMutation = useRef<string | null>(null);
  const [consentRead, setConsentRead] = useState<{ scope: string; state: "loading" | "ready" | "error" }>({ scope: "", state: "loading" });
  const [consentRetry, setConsentRetry] = useState(0);
  const setCurrentSession = useCallback((next: StudioSession | null) => {
    if (activeSessionRef.current?.accessToken !== next?.accessToken || activeSessionRef.current?.userId !== next?.userId) {
      if (activeSessionRef.current?.userId !== next?.userId) { replicaLoadRevision.current += 1; accountRevision.current += 1; }
      consentRevision.current += 1;
      consentMutation.current = null;
    }
    activeSessionRef.current = next;
    setSession(next);
  }, []);
  const isCurrentSession = useCallback((candidate: StudioSession) => activeSessionRef.current?.userId === candidate.userId && activeSessionRef.current?.accessToken === candidate.accessToken, []);
  const consentScope = (candidate: StudioSession, replicaId: string) => `${candidate.userId}:${candidate.accessToken}:${replicaId}`;
  const [authChecked, setAuthChecked] = useState(false);
  const [authResumeIntent, setAuthResumeIntent] = useState<AuthResumeIntent | null>(null);
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [selected, setSelected] = useState<Replica | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<ReturnType<typeof friendlyError> | null>(null);
  // Focus moves here the moment an error appears (WS-AP): "if there is an
  // error my page should be redirected to that error and the error should
  // come into focus, especially on mobile." `role="alert"` alone announces
  // the text but does not bring a phone's viewport to it, which is the half
  // that actually matters when the banner rendered off the bottom of a long
  // step.
  const errorBannerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!error) return;
    const el = errorBannerRef.current;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    el.focus({ preventScroll: true });
  }, [error]);
  const [consents, setConsents] = useState<ConsentReceipt[]>([]);
  const [sources, setSources] = useState<ReplicaSource[]>([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [livenessLoading, setLivenessLoading] = useState(false);
  const [verificationReview, setVerificationReview] = useState<ReplicaReview | null>(null);
  const [verificationReviewLoading, setVerificationReviewLoading] = useState(false);
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

  // Phone-sized viewport. Structural, not cosmetic: see `useCompact.ts` for why
  // three of this file's decisions cannot be a media query.
  const compact = useCompact();

  // ── what the PLATFORM is doing ────────────────────────────────────────
  //
  // Reduced from WS-AF's activity view, which `ActivityPanel` already polls on
  // a server-decided interval. It is fed UP from that component rather than
  // fetched again here, because a second poll of the same endpoint would double
  // a billed serverless invocation to learn something the first one knows.
  //
  // WHAT IT IS FOR. Two of the runtime's gates ("approved person model",
  // "approved behavior calibration") are nominally the owner's turn and are
  // unreachable while our processing has not finished. Without this field the
  // wizard could not tell those apart and told the owner nine things were
  // waiting on them while their audio sat at `quarantined`.
  //
  // It is NOT cleared when the panel unmounts (moving to the Deploy step, which
  // has no activity mount). That is deliberate and it errs in the safe
  // direction: the last measured state of our own queue is better evidence than
  // nothing, and if it is stale the cost is that we keep saying a blocker is
  // OURS slightly longer than it was. Erring the other way means blaming a
  // person for our queue, which is the defect this whole field exists to
  // remove.
  const [platformWork, setPlatformWork] = useState<WizardInput["platformWork"]>(null);
  const [activityView, setActivityView] = useState<ActivityView | null>(null);

  // `useCallback` is load-bearing, not tidiness: this is a dependency of
  // ActivityPanel's poll effect, and an identity that changed on every render
  // would restart the poll loop on every render.
  const handleActivityView = useCallback((view: ActivityView) => {
    setActivityView(view);
    setPlatformWork({
      running: view.jobs.filter((job) => job.state === "running" || job.state === "queued").length,
      stuck: view.jobs.filter((job) => job.state === "blocked").length,
      undeployedLanes: view.lanes.filter((lane) => !lane.deployed).map((lane) => lane.label),
    });
  }, []);

  // A new workspace is a new queue. Carrying the previous one's platform state
  // across a switch would be the stale-value failure without the excuse.
  useEffect(() => {
    setPlatformWork(null);
    setActivityView(null);
  }, [selected?.replica_id]);

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

  // THE DEAD CLICK (WS-AP, from the owner's screenshots): the Activity panel
  // has always been able to render "Look at the build" on a voice model
  // waiting for approval (`api/_replica-activity.js`'s `normaliseModelBuild`,
  // `state === "review"`), but `ActivityPanel`'s `onAct` prop was never wired
  // to anything here, so `onAct?.(job)` ran against `undefined` and the tap
  // did nothing. That is the shape of a THIRD hidden approval gate: a real
  // human decision the product could name but not let a person reach. This
  // does not invent an approval action that does not exist on the backend; it
  // takes the person to the one place that decision is actually visible and
  // actionable today, Processing Review's build ledger, on the step it lives
  // on.
  const handleActivityAct = useCallback((job: ActivityJob) => {
    if (job.lane === "voice_model_build" && job.next_action.kind === "review") {
      goStep("meet");
      // `ProcessingReview` is not mounted on Feed and may not be on screen
      // yet the instant `step` flips; give the render a tick before asking
      // `jumpTo` to find `#processing-review`.
      window.setTimeout(() => jumpTo("#processing-review", "the build ledger"), 60);
      return;
    }
    if (job.next_action.kind === "fix_input") {
      goStep("feed");
      window.setTimeout(() => jumpTo("#enrollment-workspace", "recording intake"), 60);
    }
  }, [goStep]);

  const identity = useMemo(() => session?.email || session?.phone || "Signed in account", [session]);
  const selectedId = selected?.replica_id ?? null;
  const sessionUserId = session?.userId || "";
  const activeChallengeId = challenge?.challenge_id || "";
  const activeChallengeState = challenge?.state || "";
  const authResumeContext = useRef<AuthResumeIntent>({ replicaId: null, replicaName: null, step, email: "" });
  useEffect(() => {
    authResumeContext.current = {
      replicaId: selectedId,
      replicaName: selected?.display_name ?? null,
      step,
      email: session?.email || "",
    };
  }, [selected?.display_name, selectedId, session?.email, step]);

  const signOut = useCallback((resumeIntent: AuthResumeIntent | null = null) => {
    writeStoredSession(null);
    setAuthResumeIntent(resumeIntent);
    setCurrentSession(null);
    setCreating(false);
    setReplicas([]);
    setSelected(null);
    selectedIdRef.current = null;
    setErasureRequestId("");
    setErasureStatus(null);
    setError(null);
  }, []);

  const refreshForRequest = useCallback(async (candidate: StudioSession) => {
    const fresh = await ensureStudioSession(candidate);
    if (!isCurrentSession(candidate) && !isCurrentSession(fresh)) throw new Error("Your signed-in account changed. Please try again.");
    if (fresh.accessToken !== candidate.accessToken) {
      writeStoredSession(fresh);
      setCurrentSession(fresh);
    }
    return fresh;
  }, []);

  const handleApiError = useCallback((cause: unknown, fallback: string) => {
    if ((cause instanceof ReplicaApiError && cause.status === 401) || isStudioAuthDead(cause)) {
      signOut(authResumeContext.current);
      return;
    }
    setError(friendlyError(cause, fallback));
  }, [signOut]);

  const handleReviewAuthError = useCallback((cause: unknown) => {
    handleApiError(cause, "Replica qualification controls could not be loaded");
  }, [handleApiError]);

  const loadReplicas = useCallback(async (activeSession: StudioSession, preferredReplicaId: string | null = null) => {
    const revision = ++replicaLoadRevision.current;
    const account = accountRevision.current;
    const ownsRead = () => accountRevision.current === account && activeSessionRef.current?.userId === activeSession.userId && revision === replicaLoadRevision.current;
    setLoadState("loading");
    setError(null);
    let requestSession = activeSession;
    try {
      const fresh = await refreshForRequest(activeSession);
      requestSession = fresh;
      if (revision !== replicaLoadRevision.current) return;
      const mine = await listReplicas(fresh.accessToken);
      if (!ownsRead()) return;
      if (!isCurrentSession(fresh)) { setLoadState("error"); return; }
      const visible = STUDIO_SELF_TEST_UI
        ? mine.filter((item) => item.lifecycle !== "revoked" && item.lifecycle !== "purging")
        : mine;
      const requestedReplicaId = preferredReplicaId
        ?? replicaFromQuery(window.location.search)
        ?? selectedIdRef.current;
      const chosen = visible.find((item) => item.replica_id === requestedReplicaId)
        ?? visible[0]
        ?? null;
      setReplicas(visible);
      setSelected(chosen);
      selectedIdRef.current = chosen?.replica_id ?? null;
      if (chosen) {
        window.history.replaceState(
          { step: stepFromQuery(window.location.search), replica: chosen.replica_id },
          "",
          queryForReplica(window.location.search, chosen.replica_id),
        );
      } else if (requestedReplicaId) {
        window.history.replaceState(
          { step: stepFromQuery(window.location.search) },
          "",
          queryWithoutReplica(window.location.search) || window.location.pathname,
        );
      }
      setShowCreate(visible.length === 0);
      setLoadState("ready");
    } catch (cause) {
      if (!ownsRead()) return;
      if (isCurrentSession(requestSession)) handleApiError(cause, "Could not load your private workspace");
      setLoadState("error");
    }
  }, [handleApiError, refreshForRequest]);

  const acceptAuthenticatedSession = useCallback((next: StudioSession) => {
    const intent = authResumeIntent;
    setCurrentSession(next);
    if (intent) {
      setStep(intent.step);
      try {
        window.history.replaceState({ step: intent.step }, "", queryForStep(window.location.search, intent.step));
      } catch {
        // The React state still restores the intended step if history is unavailable.
      }
      setNotice(`Signed in again. Returned to ${intent.replicaName || "your clone"}.`);
    }
    setAuthResumeIntent(null);
    void loadReplicas(next, intent?.replicaId ?? null);
  }, [authResumeIntent, loadReplicas]);

  const refreshReplicaView = useCallback(async (activeSession: StudioSession, replicaId: string) => {
    const replica = await readReplica(activeSession.accessToken, replicaId);
    if (!isCurrentSession(activeSession) || selectedIdRef.current !== replicaId) return replica;
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

  const refreshVerificationReview = useCallback(async () => {
    if (!session || !selectedId) return;
    setVerificationReviewLoading(true);
    try {
      const fresh = await refreshForRequest(session);
      const review = await getReplicaReview(fresh.accessToken, selectedId);
      if (selectedIdRef.current === selectedId) setVerificationReview(review);
    } catch (cause) {
      if ((cause instanceof ReplicaApiError && cause.status === 401) || isStudioAuthDead(cause)) {
        handleApiError(cause, "Could not refresh private build review");
      }
    } finally {
      if (selectedIdRef.current === selectedId) setVerificationReviewLoading(false);
    }
  }, [handleApiError, refreshForRequest, selectedId, session]);

  useEffect(() => {
    setVerificationReview(null);
    if (session && selectedId) void refreshVerificationReview();
  }, [refreshVerificationReview, selectedId, session]);

  useEffect(() => {
    let live = true;
    restoreSession().then((restored) => {
      if (!live) return;
      setCurrentSession(restored);
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
      setVerificationReview(null);
      setVerificationReviewLoading(false);
      setRuntimeStatus(null);
      setContextItemCount(null);
      setConnectedChannels(null);
      setSheetDraft(null);
      return;
    }
    let live = true;
    const replicaId = selectedId;
    const revision = consentRevision.current;
    const scope = consentScope(session, replicaId);
    setConsentRead((previous) => previous.scope === scope && previous.state === "ready" ? previous : { scope, state: "loading" });
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
        if (revision === consentRevision.current && consentMutation.current !== consentScope(fresh, replicaId) && isCurrentSession(fresh) && selectedIdRef.current === replicaId) {
          if (consentResult.status === "fulfilled") setConsents(consentResult.value);
          setConsentRead({ scope: consentScope(fresh, replicaId), state: consentResult.status === "fulfilled" ? "ready" : "error" });
        }
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
        if (live && revision === consentRevision.current && consentMutation.current !== scope) {
          setConsentRead({ scope, state: "error" });
          handleApiError(cause, "Could not load consent and private sources");
        }
      } finally {
        if (live) setEnrollmentLoading(false);
        if (live) setLivenessLoading(false);
      }
    })();
    return () => { live = false; };
  }, [consentRetry, handleApiError, mode, refreshForRequest, selectedId, session]);

  const activityKey = useMemo(() => activityRevision(activityView), [activityView]);
  const readinessPending = useMemo(() => {
    const presentation = presentCloneProgress(sources, runtimeStatus, activityView);
    return Boolean(presentation.primarySourceId && !presentation.canTest);
  }, [activityView, runtimeStatus, sources]);

  // Activity polling is the live ledger, while sources and runtime are the
  // readiness truth. Refresh those durable reads whenever a job actually
  // changes so a completed source or newly built draft appears without a page
  // reload. The activity write and the runtime write are separate, so a slow
  // visible-tab reconciliation continues while a primary recording still owes
  // a usable draft. `activityRevision` excludes generated_at, so ordinary fast
  // activity polls do not multiply these durable reads.
  useEffect(() => {
    if (!session || !selectedId || (!activityKey && !readinessPending)) return;
    let live = true;
    let polling = false;
    let timer = 0;
    const refreshReadiness = async () => {
      if (polling) return;
      polling = true;
      try {
        const fresh = await refreshForRequest(session);
        const [sourceResult, runtimeResult, replicaResult] = await Promise.allSettled([
          listSources(fresh.accessToken, selectedId),
          readRuntimeStatus(fresh.accessToken, selectedId),
          readReplica(fresh.accessToken, selectedId),
        ]);
        if (!live) return;
        if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
        if (runtimeResult.status === "fulfilled") setRuntimeStatus(runtimeResult.value);
        if (replicaResult.status === "fulfilled") {
          setSelected(replicaResult.value);
          setReplicas((items) => items.map((item) => item.replica_id === replicaResult.value.replica_id ? replicaResult.value : item));
        }
        const authFailure = [sourceResult, runtimeResult, replicaResult].find((result) =>
          result.status === "rejected"
          && ((result.reason instanceof ReplicaApiError && result.reason.status === 401) || isStudioAuthDead(result.reason)));
        if (authFailure?.status === "rejected") handleApiError(authFailure.reason, "Could not refresh clone readiness");
      } catch (cause) {
        if (live && ((cause instanceof ReplicaApiError && cause.status === 401) || isStudioAuthDead(cause))) {
          handleApiError(cause, "Could not refresh clone readiness");
        }
      } finally {
        polling = false;
        if (live && readinessPending && document.visibilityState !== "hidden") {
          timer = window.setTimeout(() => { void refreshReadiness(); }, IDLE_RECONCILE_MS);
        }
      }
    };
    const resume = () => {
      if (!live || !readinessPending || document.visibilityState === "hidden") return;
      window.clearTimeout(timer);
      void refreshReadiness();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") window.clearTimeout(timer);
      else resume();
    };
    void refreshReadiness();
    window.addEventListener("online", resume);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      live = false;
      window.clearTimeout(timer);
      window.removeEventListener("online", resume);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activityKey, handleApiError, readinessPending, refreshForRequest, selectedId, session]);

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
          const revision = consentRevision.current;
          const [nextConsents] = await Promise.all([
            listEnrollmentConsent(fresh.accessToken, selectedId),
            refreshReplicaView(fresh, selectedId),
          ]);
          if (live && isCurrentSession(fresh) && selectedIdRef.current === selectedId && revision === consentRevision.current && consentMutation.current !== consentScope(fresh, selectedId)) setConsents(nextConsents);
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
    authResumeContext.current = {
      replicaId: id,
      replicaName: replicas.find((item) => item.replica_id === id)?.display_name ?? null,
      step,
      email: session.email || "",
    };
    const revision = ++replicaLoadRevision.current;
    const account = accountRevision.current;
    const ownsRead = () => accountRevision.current === account && activeSessionRef.current?.userId === session.userId && revision === replicaLoadRevision.current;
    setLoadState("loading");
    setShowCreate(false);
    setError(null);
    let requestSession = session;
    try {
      const fresh = await refreshForRequest(session);
      requestSession = fresh;
      const replica = await readReplica(fresh.accessToken, id);
      if (!ownsRead()) return;
      if (!isCurrentSession(fresh)) { setLoadState("error"); return; }
      setSelected(replica);
      selectedIdRef.current = replica.replica_id;
      window.history.pushState(
        { step, replica: replica.replica_id },
        "",
        queryForReplica(window.location.search, replica.replica_id),
      );
      setLoadState("ready");
    } catch (cause) {
      if (!ownsRead()) return;
      if (isCurrentSession(requestSession)) handleApiError(cause, "Could not open this workspace");
      setLoadState("error");
    }
  }

  async function handleCreate(name: string) {
    if (!session) return;
    setCreating(true);
    setError(null);
    try {
      const fresh = await refreshForRequest(session);
      const replica = await createReplica(fresh.accessToken, name, crypto.randomUUID());
      setReplicas((items) => [replica, ...items]);
      setSelected(replica);
      selectedIdRef.current = replica.replica_id;
      window.history.replaceState(
        { step, replica: replica.replica_id },
        "",
        queryForReplica(window.location.search, replica.replica_id),
      );
      setShowCreate(false);
      setNotice(copy.createdNotice);
    } catch (cause) {
      handleApiError(cause, "Could not create your workspace");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke(): Promise<boolean> {
    if (!session || !selected) return false;
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
      if (STUDIO_SELF_TEST_UI) {
        setReplicas((items) => items.filter((item) => item.replica_id !== result.replica.replica_id));
        setSelected(null);
        setShowCreate(true);
        setNotice("Clone deleted. Stored data is being erased in the background. You can start a new clone now.");
      } else {
        setSelected(result.replica);
        setReplicas((items) => items.map((item) => item.replica_id === result.replica.replica_id ? result.replica : item));
        setNotice("Replica revoked. Future use is blocked and verified erasure is pending.");
      }
      return true;
    } catch (cause) {
      handleApiError(cause, "Could not revoke this replica");
      return false;
    } finally {
      setRevoking(false);
    }
  }

  function beginConsentMutation(active: StudioSession, replicaId: string) {
    if (!isCurrentSession(active) || selectedIdRef.current !== replicaId) throw new Error("The selected clone changed. Check its permissions again.");
    const revision = ++consentRevision.current;
    consentMutation.current = consentScope(active, replicaId);
    setConsentRead({ scope: consentScope(active, replicaId), state: "loading" });
    return revision;
  }

  function settleConsentMutation(active: StudioSession, replicaId: string, revision: number, receipts?: ConsentReceipt[]) {
    if (!isCurrentSession(active) || selectedIdRef.current !== replicaId || consentRevision.current !== revision) return false;
    consentRevision.current += 1;
    consentMutation.current = null;
    if (receipts) setConsents(receipts);
    setConsentRead({ scope: consentScope(active, replicaId), state: receipts ? "ready" : "error" });
    return true;
  }

  async function handleGrantConsent() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    const fresh = await refreshForRequest(session);
    const replicaId = selected.replica_id;
    const revision = beginConsentMutation(fresh, replicaId);
    try {
      const granted = await grantEnrollmentConsent(fresh.accessToken, replicaId);
      if (!settleConsentMutation(fresh, replicaId, revision, granted)) throw new Error("The selected clone changed. Check its permissions again.");
      setNotice("Source permissions recorded.");
      // Receipt success is independent of this optional lifecycle read.
      void refreshReplicaView(fresh, replicaId).catch(() => {});
    } catch (cause) {
      if (settleConsentMutation(fresh, replicaId, revision)) handleApiError(cause, "We could not confirm source permissions. Check again.");
      throw cause;
    }
  }

  async function handleRevokeConsent() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    const fresh = await refreshForRequest(session);
    const replicaId = selected.replica_id;
    const revision = beginConsentMutation(fresh, replicaId);
    try {
      await revokeEnrollmentConsent(fresh.accessToken, replicaId);
      const [nextConsents, nextSources] = await Promise.all([
        listEnrollmentConsent(fresh.accessToken, replicaId), listSources(fresh.accessToken, replicaId),
      ]);
      if (!settleConsentMutation(fresh, replicaId, revision, nextConsents)) return;
      setSources(nextSources);
      await refreshReplicaView(fresh, replicaId);
      setNotice("Source permissions withdrawn. Source erasure is pending.");
    } catch (cause) {
      if (settleConsentMutation(fresh, replicaId, revision)) handleApiError(cause, "Could not confirm permission withdrawal");
      throw cause;
    }
  }

  async function handleVerifiedConsentChanged() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    const fresh = await refreshForRequest(session);
    const replicaId = selected.replica_id;
    const revision = beginConsentMutation(fresh, replicaId);
    try {
      const [nextConsents] = await Promise.all([
        listEnrollmentConsent(fresh.accessToken, replicaId), refreshReplicaView(fresh, replicaId),
      ]);
      if (!settleConsentMutation(fresh, replicaId, revision, nextConsents)) return;
      setNotice(nextConsents.some((receipt) => receipt.scope === "inference" && !receipt.revoked_at)
        ? "Private training and disclosed inference permissions recorded. No model is active until every independent gate passes."
        : "Training and inference withdrawn. Model use is disabled and derived copies are queued for erasure.");
    } catch (cause) {
      if (settleConsentMutation(fresh, replicaId, revision)) handleApiError(cause, "Could not refresh verified model permissions");
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
    uploadIntentId?: string;
    languageHint?: "en" | "hi" | "hi-latn";
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

  async function handleFinalizeUpload(sourceId: string, uploadIntentId?: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const source = await finalizeSource(fresh.accessToken, selected.replica_id, sourceId, uploadIntentId);
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

  const handleReadVoiceReissue = useCallback(async () => {
    if (!session || !selectedId) throw new Error("Your session is no longer available");
    const fresh = await refreshForRequest(session);
    const [replica, nextSources, nextConsents] = await Promise.all([
      readReplica(fresh.accessToken, selectedId),
      listSources(fresh.accessToken, selectedId),
      listEnrollmentConsent(fresh.accessToken, selectedId),
    ]);
    if (selectedIdRef.current !== selectedId) throw new Error("The selected clone changed. Check its recording again.");
    return { replica, sources: nextSources, consents: nextConsents };
  }, [session, selectedId, refreshForRequest]);

  async function handleRequestVoiceBuild(input: { candidateSourceId: string; buildIntentId: string }): Promise<VoiceBuildIntent> {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      return await requestVoiceGenomeBuild(fresh.accessToken, {
        replicaId: selected.replica_id,
        candidateSourceId: input.candidateSourceId,
        buildIntentId: input.buildIntentId,
      });
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 409 && cause.data?.build_intent) {
        const intent = cause.data.build_intent as VoiceBuildIntent;
        setError({ headline: "This voice build stopped", detail: intent.last_error_code.replaceAll("_", " ") || "The server could not continue this exact recording.", canRetry: true });
        return intent;
      }
      handleApiError(cause, "Could not continue the source-bound voice build");
      throw cause;
    }
  }

  /**
   * The public first-run path deliberately combines workspace creation and the
   * one source-intake agreement behind one tap. They remain two server
   * transactions: if the agreement write fails, the newly-created empty clone
   * stays selected and the same screen retries only consent. No upload can
   * begin in the gap.
   */
  async function handleBeginClone(): Promise<Replica> {
    if (!session) throw new Error("Your session is no longer available");
    setCreating(true);
    setError(null);
    const previousReplicaId = selectedIdRef.current;
    const operationAccount = accountRevision.current;
    const operation = ++creationRevision.current;
    const ownsCreation = () => accountRevision.current === operationAccount && activeSessionRef.current?.userId === session.userId && creationRevision.current === operation;
    let requestSession = session;
    let requestReplicaId = previousReplicaId;
    const baseName = "Me";
    const existing = replicas.filter((item) => item.display_name === baseName || item.display_name.startsWith(`${baseName} `)).length;
    const displayName = existing ? `${baseName} ${existing + 1}` : baseName;
    try {
      const fresh = await refreshForRequest(session);
      requestSession = fresh;
      const replica = await createReplica(fresh.accessToken, displayName, durableCreationIntent(fresh.userId));
      if (accountRevision.current !== operationAccount || !isCurrentSession(fresh) || selectedIdRef.current !== previousReplicaId) throw new Error("Your workspace changed. Check your clones before continuing.");
      replicaLoadRevision.current += 1;
      clearCreationIntent(fresh.userId);
      setReplicas((items) => [replica, ...items.filter((item) => item.replica_id !== replica.replica_id)]);
      requestReplicaId = replica.replica_id;
      setSelected(replica);
      selectedIdRef.current = replica.replica_id;
      setSources([]);
      setRuntimeStatus(null);
      setActivityView(null);
      setShowCreate(false);
      window.history.replaceState(
        { step: "feed", replica: replica.replica_id },
        "",
        queryForReplica(queryForStep(window.location.search, "feed"), replica.replica_id),
      );
      const revision = beginConsentMutation(fresh, replica.replica_id);
      try {
        const granted = await grantEnrollmentConsent(fresh.accessToken, replica.replica_id);
        if (!settleConsentMutation(fresh, replica.replica_id, revision, granted)) throw new Error("Your workspace changed. Check its permissions again.");
      } catch (cause) {
        settleConsentMutation(fresh, replica.replica_id, revision);
        throw cause;
      }
      setNotice("");
      return replica;
    } catch (cause) {
      if (ownsCreation() && selectedIdRef.current === requestReplicaId) {
        if (isCurrentSession(requestSession)) handleApiError(cause, "Could not open your private clone");
        else setLoadState("error");
      }
      throw cause;
    } finally {
      if (ownsCreation()) setCreating(false);
    }
  }

  async function handleSetPrimaryVoice(sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await setPrimaryVoiceSource(fresh.accessToken, selected.replica_id, sourceId);
      setSources((items) => items.map((item) => ({
        ...item,
        voice_role: item.source_id === result.source.source_id ? "primary" : "supporting",
      })));
      setNotice(result.rebuild
        ? "Primary voice changed. A fresh voice build is queued."
        : "Primary voice selected. It will drive the clone when processing is ready.");
      return result.source;
    } catch (cause) {
      handleApiError(cause, "Could not choose the primary voice recording");
      throw cause;
    }
  }

  // Back, Forward, refresh, and bookmarks restore both the exact clone and
  // the exact Studio step. The URL is the durable navigation authority.
  useEffect(() => {
    const onPop = () => {
      setStep(stepFromQuery(window.location.search));
      const replicaId = replicaFromQuery(window.location.search);
      if (session && replicaId && replicaId !== selectedIdRef.current) {
        void loadReplicas(session, replicaId);
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [loadReplicas, session]);

  const handleCheckCaptureReadiness = useCallback(async (signal?: AbortSignal) => {
    if (!session || !selected) throw new Error("Your session is no longer available");
    const account = accountRevision.current, replicaId = selected.replica_id;
    const revision = ++livenessReadRevision.current;
    const current = () => livenessMounted.current && !signal?.aborted && account === accountRevision.current &&
      activeSessionRef.current?.userId === session.userId && selectedIdRef.current === replicaId && revision === livenessReadRevision.current;
    if (!current()) throw new Error("Your verification session changed. Check again.");
    const fresh = await refreshForRequest(session);
    if (!current() || !isCurrentSession(fresh)) throw new Error("Your verification session changed. Check again.");
    const result = await livenessCaptureReadiness(fresh.accessToken, replicaId, signal);
    if (!current() || !isCurrentSession(fresh)) throw new Error("Your verification session changed. Check again.");
    setChallenge(result.challenge);
    return result;
  }, [session, selected, refreshForRequest]);

  async function handleIssueChallenge(input: LivenessIssueInput, signal?: AbortSignal) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    const account = accountRevision.current, replicaId = selected.replica_id;
    const revision = ++livenessIssueRevision.current;
    let requestSession = session;
    const current = () => livenessMounted.current && !signal?.aborted && account === accountRevision.current &&
      activeSessionRef.current?.userId === session.userId && selectedIdRef.current === replicaId && revision === livenessIssueRevision.current;
    try {
      if (!current()) throw new Error("Your verification session changed. Check again.");
      const fresh = await refreshForRequest(session);
      requestSession = fresh;
      if (!current() || !isCurrentSession(fresh)) throw new Error("Your verification session changed. Check again.");
      const issued = await issueLivenessChallenge(fresh.accessToken, replicaId, input, signal);
      if (!current() || !isCurrentSession(fresh)) throw new Error("Your verification session changed. Check for a saved attempt.");
      setChallenge(issued);
      return issued;
    } catch (cause) {
      if (current() && isCurrentSession(requestSession)) handleApiError(cause, "Could not issue a live phrase");
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
        setNotice("Official live-face and ID match passed. The Azure session was deleted. Complete verifier availability is still required before recording.");
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
    platformWork,
  }), [connectedChannels, consents, contextItemCount, mode, platformWork, runtimeStatus, selected, sheetDraft, sources.length]);

  const selfTestProgress = useMemo(
    () => presentCloneProgress(sources, runtimeStatus, activityView),
    [activityView, runtimeStatus, sources],
  );
  const wizard = useMemo(() => {
    const base = computeWizard(wizardInput);
    return STUDIO_SELF_TEST_UI ? selfTestWizard(base, {
      sourceAdded: Boolean(selfTestProgress.primarySourceId),
      processing: Boolean(activityView?.jobs.some((job) => job.state === "queued" || job.state === "running")),
      voiceReady: selfTestProgress.canTest,
    }) : base;
  }, [activityView, selfTestProgress.canTest, selfTestProgress.primarySourceId, wizardInput]);
  const activeStep: StepId = STUDIO_SELF_TEST_UI && step === "deploy" ? "feed" : step;

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
      <PersonalAuthLoading locale={readPersonalAuthLocale()} failed={false} retry={() => {}} testEnvironment={STUDIO_SELF_TEST_UI} />
    );
  }

  if (!session) {
    return (
      <AuthGate
        testEnvironment={STUDIO_SELF_TEST_UI}
        resumeIntent={authResumeIntent}
        onAuthed={acceptAuthenticatedSession}
      />
    );
  }

  if (!STUDIO_SELF_TEST_UI) {
    return (
      <Suspense fallback={<DeferredWorkspacePanel />}>
      <StudioWorkspaceStyles />
      <CloneExperience
        ownerUserId={session.userId}
        accountScope={`${session.userId}:${accountRevision.current}`}
        workspaceReadState={loadState === "ready" ? "ready" : loadState === "error" ? "error" : "loading"}
        consentReadState={!session || !selectedId || consentRead.scope !== consentScope(session, selectedId) ? "loading" : consentRead.state}
        onRetryWorkspace={() => { if (session) void loadReplicas(session); }}
        onRetryConsent={() => { setError(null); consentRevision.current += 1; setConsentRead({ scope: "", state: "loading" }); setConsentRetry((value) => value + 1); }}
        identity={identity}
        accessToken={session.accessToken}
        replicas={replicas}
        selected={selected}
        creatingNew={showCreate}
        creating={creating}
        revoking={revoking}
        consents={consents}
        sources={sources}
        runtimeStatus={runtimeStatus}
        activityView={activityView}
        wizardInput={wizardInput}
        review={verificationReview}
        reviewLoading={verificationReviewLoading}
        challenge={challenge}
        livenessLoading={livenessLoading}
        notice={notice}
        error={error}
        onDismissNotice={() => setNotice("")}
        onDismissError={() => setError(null)}
        onSignOut={() => signOut()}
        onBeginClone={handleBeginClone}
        onGrantConsent={handleGrantConsent}
        onSelectReplica={selectReplica}
        onStartNew={() => setShowCreate(true)}
        onRevoke={async () => {
          const started = await handleRevoke();
          if (started) setShowCreate(true);
          return started;
        }}
        onCreateUpload={handleCreateUpload}
        onRetryUpload={handleRetryUpload}
        onFinalizeUpload={handleFinalizeUpload}
        onRequestVoiceBuild={handleRequestVoiceBuild}
        onReadVoiceReissue={handleReadVoiceReissue}
        onDeleteSource={handleDeleteSource}
        onRefreshEnrollment={handleIdentityChanged}
        onRefreshReview={refreshVerificationReview}
        onCheckCaptureReadiness={handleCheckCaptureReadiness}
        onIssueChallenge={handleIssueChallenge}
        onStartFaceSession={handleStartFaceSession}
        onPollFaceSession={handlePollFaceSession}
        onCancelChallenge={handleCancelChallenge}
        onCreateLivenessUpload={handleCreateLivenessUpload}
        onFinalizeLiveness={handleFinalizeLiveness}
        onVerifiedConsentChanged={handleVerifiedConsentChanged}
        onActivityView={handleActivityView}
        onActivityAct={handleActivityAct}
        onAuthError={handleReviewAuthError}
        onContextCount={setContextItemCount}
      />
      </Suspense>
    );
  }

  return (
    <Suspense fallback={<DeferredWorkspacePanel />}>
    <StudioWorkspaceStyles />
    <div className={`studio-shell${STUDIO_SELF_TEST_UI ? " studio-shell-self-test" : ""}`}>
      <header className="studio-header">
        <a className="studio-logo" href="/" aria-label="Vyakti home">
          <Mark />
          <span><strong>VYAKTI</strong><small>{mode === "teacher" ? "GURUKUL STUDIO" : "REPLICA STUDIO"}</small></span>
        </a>
        <div className="header-trust"><span className="secure-dot" />{STUDIO_SELF_TEST_UI ? "Internal test workspace" : mode === "teacher" ? "Private teaching-clone workspace" : "Private self-replica workspace"}</div>
        <div className="account-menu">
          <span className="account-copy"><strong>{identity}</strong><small>{STUDIO_SELF_TEST_UI ? "Test workspace session" : "Verified account session"}</small></span>
          <button className="signout-button" type="button" onClick={() => signOut()}>Sign out</button>
        </div>
      </header>

      <div className="studio-layout">
        {/* The two-column shell from PRODUCT-JOURNEY §3.2. The wizard rail sits
            ABOVE the workspace list because the wizard is the journey and the
            list is a switcher: on any given visit an owner changes step several
            times and changes workspace approximately never. The rail is hidden
            while there is no workspace to be in a step of, rather than rendered
            with three empty states. */}
        {/* THE RAIL, IN TWO FORMS, AND ONLY ONE OF THEM IS RENDERED.
            On a phone the three-row rail costs about a third of the first
            viewport before any control appears, so the phone gets a segmented
            control plus one named line: same three answers (where am I, what
            state is each step in, what is left here), about 90px instead of
            about 300px. It is sticky under the header because "where am I" is a
            question people ask again halfway down a long form. Different DOM
            rather than the same DOM hidden, so a phone does not carry a desktop
            rail it never shows. */}
        {compact ? (
          selected && !showCreate ? (
            <CompactRail steps={wizard.steps} current={activeStep} onGo={goStep} />
          ) : null
        ) : (
        <div className="studio-rail">
          {selected && !showCreate && (
            <WizardRail steps={wizard.steps} current={activeStep} onGo={goStep} label={STUDIO_SELF_TEST_UI ? "Your test flow" : undefined} />
          )}
          <ReplicaList
            replicas={replicas}
            selectedId={selected?.replica_id ?? null}
            onSelect={(id) => void selectReplica(id)}
            onNew={() => setShowCreate(true)}
            testEnvironment={STUDIO_SELF_TEST_UI}
          />
        </div>
        )}

        <main className="studio-main">
          {notice && (
            <div className="notice" role="status">
              <span>✓</span>{notice}
              <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert" tabIndex={-1} ref={errorBannerRef}>
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
            <Suspense fallback={<DeferredWorkspacePanel />}>
              <ReplicaWorkspace
                replica={selected}
                testEnvironment={STUDIO_SELF_TEST_UI}
                mode={mode}
                copy={copy}
                step={activeStep}
                wizard={wizard}
                wizardInput={wizardInput}
                onGoStep={goStep}
                sheet={sheet}
                sheetProvenance={sheetProvenance}
                runtimeStatus={runtimeStatus}
                activityView={activityView}
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
                onSetPrimaryVoice={handleSetPrimaryVoice}
                onDeleteSource={handleDeleteSource}
                onCheckCaptureReadiness={handleCheckCaptureReadiness}
                onIssueChallenge={handleIssueChallenge}
                onStartFaceSession={handleStartFaceSession}
                onPollFaceSession={handlePollFaceSession}
                onCancelChallenge={handleCancelChallenge}
                onCreateLivenessUpload={handleCreateLivenessUpload}
                onFinalizeLiveness={handleFinalizeLiveness}
                onIdentityChanged={handleIdentityChanged}
                onVerifiedConsentChanged={handleVerifiedConsentChanged}
                onRevoke={async () => { await handleRevoke(); }}
                onStartNew={() => {
                  setShowCreate(true);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                revoking={revoking}
                accessToken={session.accessToken}
                onReviewAuthError={handleReviewAuthError}
                compact={compact}
                onActivityView={handleActivityView}
                onActivityAct={handleActivityAct}
              />
            </Suspense>
          ) : null}

          {/* The workspace switcher, on a phone, lives at the FOOT of the page
              rather than above the step. An owner changes step several times a
              visit and changes workspace approximately never, and a horizontal
              scroller of workspace tabs above the fold is a control nobody uses
              taking the space the control everybody uses needs. It is still one
              scroll away, still complete, and collapsed by default. */}
          {compact && (
            <details className="workspace-switch">
              <summary>
                <strong>{selected ? selected.display_name : "Your workspaces"}</strong>
                <span>Switch workspace, or start another one</span>
              </summary>
              <ReplicaList
                replicas={replicas}
                selectedId={selected?.replica_id ?? null}
                onSelect={(id) => void selectReplica(id)}
                onNew={() => setShowCreate(true)}
                testEnvironment={STUDIO_SELF_TEST_UI}
              />
            </details>
          )}
        </main>
      </div>
    </div>
    </Suspense>
  );
}
