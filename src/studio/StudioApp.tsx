import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  setReplicaLocale,
} from "./replicaApi";
// WS-R52. `StudioLocale` (aliased: this file already has its own unrelated
// `StudioCopy` interface -- src/studio/copy.ts's own `StudioCopy` never
// enters this file, only the locale type and the provider do) plus the
// provider StudioApp mounts once, at the top of the signed-in tree.
import { normalizeStudioLocale, type StudioLocale as StudioChromeLocale } from "./copy";
import { StudioLocaleProvider } from "./localeContext";
import { restoreSession, writeStoredSession } from "./session";
import { friendlyError } from "./errorCopy";
import { markFunnelStep } from "./funnelApi";
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
  VoiceIdentityChallenge,
} from "./types";
import IdentityProofing from "./IdentityProofing";
import ProcessingReview from "./ProcessingReview";
import PersonModelStudio from "./PersonModelStudio";
import CalibrationStudio from "./CalibrationStudio";
import RuntimeGate from "./RuntimeGate";
import ReplicaDialogueLab from "./ReplicaDialogueLab";
import CandidateEvaluationLab from "./CandidateEvaluationLab";
import VoiceEnrollmentLab from "./VoiceEnrollmentLab";
import ModelConsentGate from "./ModelConsentGate";
import TeacherSheetStudio from "./TeacherSheetStudio";
import ChannelsStudio from "./ChannelsStudio";
import IngestChannelStudio from "./IngestChannelStudio";
import ContextLockerPanel from "./ContextLockerPanel";
import DisclosurePreview from "./DisclosurePreview";
import VideoEnrollPanel from "./VideoEnrollPanel";
import ActivityPanel from "./ActivityPanel";
import ReadinessPanel from "./ReadinessPanel";
import type { Readiness } from "./readinessApi";
import type { InterviewPreview } from "./mirrorCallApi";
import type { OwnedRoom, RoomStats } from "./roomPublishApi";
import StudioShell from "./StudioShell";
import DriftWatchCard from "./DriftWatchCard";
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
import { InviteGate } from "./InviteGate";
import { CLASS_COPY } from "./blockerClass";
import type { ActivityJob, ActivityView } from "./activityApi";
import {
  computeWizard,
  queryForStep,
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
import {
  cancelVoiceIdentityChallenge,
  createVoiceIdentityUpload,
  finalizeVoiceIdentityUpload,
  issueVoiceIdentityChallenge,
  voiceIdentityChallengeUiEnabled,
  voiceIdentityStatus,
} from "./voiceIdentityApi";

// WS-R49: lazy, not a top-level import, for the eight heaviest panels that
// never render on a signed-out /studio visit. Every one of these sits behind
// `replica &&` and a wizard `step === "..."` gate deep inside StudioApp's own
// render tree (see each usage site below), so a signed-out phone downloaded
// and parsed all of them before ever showing a sign-in form — a static import
// puts a component's bytes in the SAME dependency graph as the screen before
// the gate that renders it, regardless of what actually mounts. Picked by
// source size (`wc -c src/studio/*.tsx`), largest first, and each converted
// component keeps its own Suspense boundary at its own usage site rather than
// one boundary for all eight, so a slow panel never blanks its siblings.
// Measured effect on /studio's JS transfer budget (scripts/check-
// performance.mjs, n=3, cold cache): context/measurements.md#ws-r49-studio-
// lazy-panels-2026-09-04.
const EnrollmentWorkspace = lazy(() => import("./EnrollmentWorkspace"));
const RoomStudio = lazy(() => import("./RoomStudio"));
const MirrorCallStudio = lazy(() => import("./MirrorCallStudio"));
const VoicePreviewLab = lazy(() => import("./VoicePreviewLab"));
const LivenessCapture = lazy(() => import("./LivenessCapture"));
const VoiceIdentityChallengeBand = lazy(() => import("./VoiceIdentityChallenge"));
const VoicePreviewPanel = lazy(() => import("./VoicePreviewPanel"));
const VoiceExperimentPanel = lazy(() => import("./VoiceExperimentPanel"));
// ReviewQueue: same reasoning, its own commit — see the WS-R49 note at its
// usage site in the "Meet" step's "Check it and correct it" band.
const ReviewQueue = lazy(() => import("./ReviewQueue"));

type AuthStep = "email" | "code";
type LoadState = "booting" | "loading" | "ready" | "error";

const STUDIO_SELF_TEST_UI = studioSelfTestUiEnabled(
  import.meta.env.VITE_REPLICA_SELF_TEST_MODE,
  import.meta.env.VITE_REPLICA_SELF_TEST_ENVIRONMENT,
);

// WS-R2. When this is on, the "Prove it is you" band shows the spoken
// identity challenge instead of the Azure ID-document and face-liveness
// cards. Default OFF and read once at module load, so a deployed build
// without the variable renders byte-identically to today's studio. The server
// half is gated separately by VOICE_IDENTITY_CHALLENGE, and BOTH have to be
// set: a studio that offered the band against a 404 endpoint would be the
// blame inversion AGENTS.md forbids.
const VOICE_IDENTITY_UI = voiceIdentityChallengeUiEnabled(import.meta.env.VITE_VOICE_IDENTITY_CHALLENGE);

// WS-R23 (086). When this is on, a brand new account (one with zero
// workspaces) sees InviteGate before CreateReplicaCard. Default OFF and read
// once at module load, `VOICE_IDENTITY_UI`'s own pattern: the server half is
// gated separately by `INVITES_REQUIRED`, and the server predicate is what
// actually decides — this flag only decides whether the studio ASKS first.
// An account that already owns a workspace never sees this screen regardless
// of this flag (StudioApp's own render condition also checks
// `replicas.length === 0`), matching the server's "or an account already
// owning a replica" exemption exactly.
const INVITES_REQUIRED_UI = import.meta.env.VITE_INVITES_REQUIRED === "1";

// WS-R31. A presentation change, not a capability: every panel below the top
// of the studio is the SAME component, reading the SAME data, gated by the
// SAME blockers whether this is on or off. What flips is only which
// navigation renders above them: the three-tab shell (`StudioShell.tsx`) or
// the old wizard rail. UNSET = ON, unlike every other flag in this file,
// because that default IS the workstream's whole point
// (`docs/gurukul/ENV-MANIFEST.md` says why): a build that forgot to set it
// should still ship the shorter path, and the one-line "All panels" link
// inside the shell (never a rebuild) is the rollback if a real defect turns
// up in production. Setting it to the literal string "0" is the only way off.
const STUDIO_SHELL_UI = import.meta.env.VITE_STUDIO_SHELL !== "0";

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
  brandTag: "PRIVATE AI LAB",
  introEyebrow: "Private by construction",
  introTitle: "An AI that begins with your permission.",
  introBody:
    "Build and control a consent-verified AI of yourself. Every source stays private, every capability is separately approved, and revocation stops future use.",
  workspaceNoun: "Your AI",
  firstEyebrow: "Your first AI",
  firstTitle: "Begin with identity, not an upload.",
  firstBody:
    "Name your private workspace. Voice, memories, and behavior remain locked until consent and liveness services are connected.",
  nameLabel: "AI name",
  namePlaceholder: "Your name",
  fieldNote: "You may create an AI only of yourself. Verification comes next.",
  // C4 (UX-QUEUE copy audit): the old line spent most of a first success on
  // what does not work. The truth is unchanged and still stated on the panels
  // that own each gate; what changes is that the first thing a person reads
  // after their first action tells them what to do next.
  createdNotice: "Your workspace is ready. Add one file or link on this step, and you can hear a private draft voice before any verification.",
};

const TEACHER_COPY: StudioCopy = {
  brandTag: "GURUKUL TEACHER STUDIO",
  introEyebrow: "Verified, consented, disclosed",
  introTitle: "A teaching AI that begins with your permission, and is disclosed to every student.",
  introBody:
    "Build and control a consent-verified teaching AI of yourself. Every source stays private, every capability is separately approved, revocation stops future use, and students are told before every session that they are talking to an AI, not you.",
  workspaceNoun: "Your teaching AI",
  firstEyebrow: "Your first teaching AI",
  firstTitle: "Begin with identity, not an upload.",
  firstBody:
    "Name your teaching AI. Voice, teaching style, and pedagogy remain locked until consent and liveness services are connected.",
  nameLabel: "Teacher / AI name",
  namePlaceholder: "Your name, as students will see it",
  fieldNote: "You may create a teaching AI only of yourself. Verification comes next.",
  createdNotice: "Your teaching AI has a workspace. Add one lecture or link on this step, and you can hear a private draft voice before any verification.",
};

const TEST_COPY: StudioCopy = {
  brandTag: "INTERNAL TEST STUDIO",
  introEyebrow: "",
  introTitle: "Add your sources. Then test your AI.",
  introBody: "Upload useful examples of your voice, writing, videos, and context. Then hear the draft, talk to it, and correct it.",
  workspaceNoun: "Test AI",
  firstEyebrow: "",
  firstTitle: "Create a test workspace.",
  firstBody: "Name your AI, add any useful sources, then hear it and talk to it.",
  nameLabel: "AI name",
  namePlaceholder: "Your name",
  fieldNote: "You can change your AI as you test it.",
  createdNotice: "Test workspace ready. Add useful sources, or start talking to your AI now.",
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

const TEST_SOURCE_TYPES = [
  { label: "Audio or video file", anchor: "#enrollment-workspace" },
  { label: "Screenshot, document, or text file", anchor: "#enrollment-workspace" },
  { label: "Text or web link", anchor: "#context-locker" },
  { label: "YouTube video", anchor: "#video-enroll-heading" },
  { label: "YouTube channel", anchor: "#ingest-channel-title" },
] as const;

function TestSourceGuide() {
  return (
    <nav className="test-source-guide" aria-label="Five source types">
      <p>Add any source type. None is required to open your AI.</p>
      <div>
        {TEST_SOURCE_TYPES.map((source) => (
          <button key={source.label} type="button" onClick={() => jumpTo(source.anchor, source.label)}>
            {source.label}
          </button>
        ))}
      </div>
    </nav>
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

function AuthGate({ onAuthed, copy, testEnvironment }: { onAuthed: (session: StudioSession) => void; copy: StudioCopy; testEnvironment: boolean }) {
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
        {copy.introEyebrow && <p className="eyebrow">{copy.introEyebrow}</p>}
        <h1 id="studio-title">{copy.introTitle}</h1>
        <p>{copy.introBody}</p>
        {!testEnvironment && <div className="trust-strip" aria-label="Studio safeguards">
          <span><i />Self-replication only</span>
          <span><i />No public voice library</span>
          <span><i />Auditable deletion</span>
        </div>}
      </section>

      <section className="auth-card" aria-labelledby="signin-title">
        <div className="secure-chip"><span className="secure-dot" />Protected workspace</div>
        <h2 id="signin-title">{step === "email" ? "Enter your studio" : "Check your inbox"}</h2>
        <p className="card-copy">
          {step === "email"
            ? "Sign in with the email you want to manage your AI from. If you are already signed in on this device, we will recognise you."
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
        {!testEnvironment && <p className="legal-copy">
          Access does not grant permission to build your AI. Separate, recorded consent is required before any biometric processing.
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
              {busy ? <Spinner label="Creating your AI" /> : "Create workspace"}
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
    <aside className="replica-rail" aria-label="Your AIs">
      <div className="rail-label">Your AIs</div>
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

// WS-R31. Exported so `StudioShell.tsx` (the Feed/Meet/Share collapse) can
// mount the EXACT same panel tree the old wizard rail mounts, rather than a
// second copy of ~700 lines of JSX that could drift from this one. This is a
// pure addition of the `export` keyword: the function, its props and every
// panel inside it are byte-identical to before.
export function ReplicaWorkspace({
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
  onRuntimeStatus,
  onRoomPublished,
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
  voiceChallenge,
  onIssueVoiceChallenge,
  onCancelVoiceChallenge,
  onCreateVoiceIdentityUpload,
  onFinalizeVoiceIdentity,
  onRefreshVoiceChallenge,
  onIdentityChanged,
  onVerifiedConsentChanged,
  onRevoke,
  revoking,
  accessToken,
  onReviewAuthError,
  compact,
  onActivityView,
  onActivityAct,
  onReadiness,
  onInterviewPreview,
  onRoomState,
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
  onRuntimeStatus: (status: ReplicaRuntimeStatus) => void;
  onRoomPublished: (published: boolean) => void;
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
  voiceChallenge: VoiceIdentityChallenge | null;
  onIssueVoiceChallenge: () => Promise<VoiceIdentityChallenge>;
  onCancelVoiceChallenge: (challengeId: string) => Promise<VoiceIdentityChallenge>;
  onCreateVoiceIdentityUpload: (input: {
    challengeId: string;
    role: "capture" | "transcript";
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ challenge: VoiceIdentityChallenge; source: ReplicaSource; upload: SignedUpload }>;
  onFinalizeVoiceIdentity: (challengeId: string, sourceId: string) => Promise<VoiceIdentityChallenge>;
  onRefreshVoiceChallenge: () => void;
  onIdentityChanged: () => Promise<void>;
  onVerifiedConsentChanged: () => Promise<void>;
  onRevoke: () => Promise<void>;
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
  // WS-R31. Three purely additive, fed-up reads: `StudioShell`'s tab
  // headlines need Readiness's own number, the interview's next topic and
  // the Room's own state, and every one of them is already computed inside a
  // panel this tree already mounts. Optional so the untouched old rail view
  // (which passes none of them) renders byte-identically to before.
  onReadiness?: (readiness: Readiness) => void;
  onInterviewPreview?: (preview: InterviewPreview | null | undefined) => void;
  onRoomState?: (room: OwnedRoom | null, stats: RoomStats | null, blocker: { label: string; anchor: string; cls: "you" | "us" } | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const stopped = replica.lifecycle === "revoked" || replica.lifecycle === "purging";
  const erased = erasureStatus?.state === "complete";
  const view = wizard.steps.find((row) => row.id === step) ?? wizard.steps[0];
  const stepNumber = view.number;
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
          <span>Add any useful sources, then hear and talk to your AI.</span>
        </aside>
      )}

      {compact ? (
        <section className="workspace-heading workspace-heading-compact">
          <span className={`state-dot state-${replica.lifecycle}`} />
          <strong>{replica.display_name}</strong>
          <small>{stopped ? lifecycleLabel(replica.lifecycle) : copy.workspaceNoun}</small>
        </section>
      ) : (
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
      )}

      {stopped ? (
        <section className="stopped-panel" role="status">
          <div className={`stop-icon ${erased ? "complete" : ""}`}>{erased ? "✓" : "×"}</div>
          <div>
            <p className="eyebrow">{erased ? "Verified erasure complete" : "Future use disabled"}</p>
            <h2>{erased ? "Your AI has been erased." : "Your AI has been revoked."}</h2>
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
          {compact ? (
            <StepHead title={view.title} promise={view.promise} compact />
          ) : (
            <section className="step-head" aria-labelledby="step-title">
              <p className="eyebrow">Step {stepNumber} of {wizard.steps.length}</p>
              <h2 id="step-title">{view.title}</h2>
              <p className="step-promise">{view.promise}</p>
            </section>
          )}

          {/* WS-R3. This replaced `ReadinessStrip`, which rendered four derived
              numbers on every step: identity checks, a source count, a voice
              version and a trust claim. Two problems, and only the second one
              is about design. It was a DASHBOARD sitting between the step title
              and the first control, on a step whose job is one task; and it
              wore the word "Readiness" while answering none of the five
              questions a creator actually has to answer before they let their
              AI talk to anyone.

              The panel answers those five, with an honest "not measured yet"
              wherever the instrument does not exist, and it is on the MEET step
              only: readiness is what Meet is for, and repeating it on Feed and
              Deploy would be the same furniture in three places. Its trust line
              carries over the one claim from the old strip that never changes
              with a measurement. */}
          {!testEnvironment && step === "meet" && <ReadinessPanel
            key={`readiness-${replica.replica_id}`}
            token={accessToken}
            replicaId={replica.replica_id}
            onAuthError={onReviewAuthError}
            onGoStep={onGoStep}
            onReadiness={onReadiness}
          />}

          {/* WS-R9. "It notices drift" — the Rooms plan's own line, and the
              caught case it cites by name: a provider swapping a model within
              four days under the same name. Directly under Readiness on the
              same step, because both answer "can I trust what I am about to
              publish" and a creator should not have to go looking for the
              second half of that answer on a different screen. */}
          {!testEnvironment && step === "meet" && <DriftWatchCard
            key={`drift-watch-${replica.replica_id}`}
            token={accessToken}
            replicaId={replica.replica_id}
            onAuthError={onReviewAuthError}
            onGoStep={onGoStep}
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
          <PlatformWorkBanner
            work={wizardInput.platformWork}
            onSeeActivity={() => {
              if (step === "deploy") { onGoStep("feed"); return; }
              jumpTo(`#processing-status-${step}`, "where each upload is right now");
            }}
          />

          {step === "feed" && (
            <>
              {testEnvironment && <TestSourceGuide />}
              <Band
                collapsible={compact}
                defaultOpen
                title={testEnvironment ? "Add source files" : "Permission, then your material"}
                blurb={testEnvironment ? "Upload audio, video, documents, or screenshots. Multiple files can be added in one pass." : "Nothing is read, transcribed or stored until you say it may be. Then everything you bring lands in one private ledger you can erase a row at a time."}
              >
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading your material</div>}>
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
                    onDeleteSource={onDeleteSource}
                  />
                </Suspense>
              </Band>

              <Band
                collapsible={compact}
                defaultOpen={false}
                title={testEnvironment ? "Add files and links" : "Files, links, videos, channels"}
                blurb={testEnvironment ? "Drop text files or paste useful links. Add only what will help your AI understand you." : "Four ways in, one ledger out. Everything here is proposed to you before it changes anything about your AI."}
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
                />
                {/* WS-S. The channel lane is horizontal by the same argument
                    the Context Locker is: a teacher's uploads are one kind of
                    channel and everyone else's are the rest, so it is no longer
                    gated on teacher mode. */}
                <IngestChannelStudio
                  key={`ingest-${replica.replica_id}`}
                  token={accessToken}
                  replicaId={replica.replica_id}
                  testEnvironment={testEnvironment}
                  onAuthError={onReviewAuthError}
                />
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
                />
              </Band>
            </>
          )}

          {step === "meet" && (
            <>
              <Band
                collapsible={compact}
                defaultOpen
                title="Hear it, then talk to it"
                blurb="This is the whole point of the product. The preview is private, and the call is where your AI learns from you while you watch."
              >
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading her voice</div>}>
                  <VoicePreviewPanel
                    key={`hear-voice-${replica.replica_id}`}
                    token={accessToken}
                    replicaId={replica.replica_id}
                    wizardInput={previewWizardInput}
                    testEnvironment={testEnvironment}
                    onAuthError={onReviewAuthError}
                  />
                </Suspense>
                <Suspense fallback={null}>
                  <VoiceExperimentPanel
                    key={`voice-experiment-${replica.replica_id}`}
                    replicaId={replica.replica_id}
                  />
                </Suspense>
                {!testEnvironment && <VoiceUnlockNotice replica={replica} />}
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading the call</div>}>
                  <MirrorCallStudio
                    key={`mirror-call-${replica.replica_id}`}
                    token={accessToken}
                    replicaId={replica.replica_id}
                    stopped={stopped}
                    onAuthError={onReviewAuthError}
                    onInterviewPreview={onInterviewPreview}
                  />
                </Suspense>
              </Band>

              <Band
                collapsible={compact}
                defaultOpen={false}
                title={testEnvironment ? "Processing status" : "Check it and correct it"}
                blurb={testEnvironment ? "See what your AI is learning from the sources you added." : "What we think we learned, one claim at a time, and the dials only you can set. Nothing here publishes anything."}
              >
                {/* WS-R4. FIRST in this band, and open, because it is the one
                    thing on the Meet step that is thirty seconds long and moves
                    the number. Everything below it is a lab. */}
                {!testEnvironment && (
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading the review queue</div>}>
                    <ReviewQueue
                      key={`review-queue-${replica.replica_id}`}
                      token={accessToken}
                      replicaId={replica.replica_id}
                      onAuthError={onReviewAuthError}
                    />
                  </Suspense>
                )}
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
                {!testEnvironment && <PersonModelStudio
                  token={accessToken}
                  replicaId={replica.replica_id}
                  onAuthError={onReviewAuthError}
                />}
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
                />
              </Band>

              {/* UX-Q-05. Required, therefore open. These four are the gates
                  `RuntimeGate` refuses activation without, and they live on the
                  step whose voice they unlock rather than in a drawer called
                  "Advanced". */}
              {!testEnvironment && <Band
                collapsible={compact}
                defaultOpen={false}
                title="Prove it is you"
                blurb="A voice is a person. These are the checks that let your AI speak to anyone other than you, and they are the only reason this product can exist."
              >
                {/* WS-R2. One band, two possible identity paths, never both.
                    The Azure pair needs two Microsoft Limited Access
                    approvals and has never been deployed; the spoken
                    challenge uses services that are already running. The flag
                    is off by default, so this renders exactly what it renders
                    today until the main loop turns it on. */}
                {VOICE_IDENTITY_UI ? (
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading identity checks</div>}>
                    <VoiceIdentityChallengeBand
                      consentActive={hasSourceConsent(consents)}
                      challenge={voiceChallenge}
                      loading={livenessLoading}
                      onIssue={onIssueVoiceChallenge}
                      onCancel={onCancelVoiceChallenge}
                      onCreateUpload={onCreateVoiceIdentityUpload}
                      onFinalize={onFinalizeVoiceIdentity}
                      onRefresh={onRefreshVoiceChallenge}
                    />
                  </Suspense>
                ) : (
                  <>
                    <IdentityProofing
                      token={accessToken}
                      replicaId={replica.replica_id}
                      sources={sources}
                      onChanged={onIdentityChanged}
                      onAuthError={onReviewAuthError}
                    />
                    <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading identity checks</div>}>
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
                    </Suspense>
                  </>
                )}
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
                blurb="Four labs for people who want to go further. Nothing in here is required to activate your AI, and skipping all of it costs you nothing."
              >
                <Suspense fallback={null}>
                  <VoicePreviewLab
                    key={`voice-preview-${replica.replica_id}`}
                    token={accessToken}
                    replicaId={replica.replica_id}
                    onAuthError={onReviewAuthError}
                  />
                </Suspense>
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
                  blurb="Read this before you decide where your AI can be reached. The order is the informed half of informed consent."
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

              {/* WS-R7. Above ChannelsStudio's own band on purpose: the Room
                  is the primary, private, remembering address every follower
                  actually talks to, and a channel is an address on somebody
                  ELSE's platform this product connects to. It does not need a
                  saved sheet to render — it proposes its OWN address from the
                  replica's name — but publishing stays honestly locked until
                  the sheet is published, same as everything else that reads
                  the disclosure card. */}
              {mode === "teacher" && (
                <Band
                  collapsible={compact}
                  defaultOpen
                  title="Your Room"
                  blurb="A private, continuing address for every follower. This is where publishing actually happens."
                >
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />Loading your Room</div>}>
                    <RoomStudio
                      key={`room-${replica.replica_id}`}
                      token={accessToken}
                      replicaId={replica.replica_id}
                      onAuthError={onReviewAuthError}
                      onGoStep={onGoStep}
                      onStatusChange={onRoomPublished}
                      onRoomState={onRoomState}
                    />
                  </Suspense>
                </Band>
              )}

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
                            The embed code and the widget address are built from your AI's public slug, and that
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
                blurb="Revoking stops future use immediately and queues every stored artifact, derived AI and provider copy for verified deletion."
              >
                <section className="danger-zone" aria-labelledby="control-title">
                  <div>
                    <p className="eyebrow">Owner control</p>
                    <h2 id="control-title">Revoke your AI</h2>
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
            <div className="modal-stop">STOP</div>
            <h2 id="revoke-title">Revoke {replica.display_name}?</h2>
            <p>
              This immediately blocks generation and queues stored sources, derived AI versions, memories, and provider copies for erasure.
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
              <button className="button secondary-button" disabled={revoking} onClick={() => setConfirming(false)}>Keep your AI</button>
              <button
                className="button destructive-button"
                disabled={revoking || confirmation !== "REVOKE"}
                onClick={() => void onRevoke()}
              >
                {revoking ? <><Spinner label="Revoking your AI" />Revoking</> : "Revoke permanently"}
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
  const copy = STUDIO_SELF_TEST_UI ? TEST_COPY : mode === "teacher" ? TEACHER_COPY : GENERIC_COPY;
  const [session, setSession] = useState<StudioSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [selected, setSelected] = useState<Replica | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // WS-R31. Runtime-only, never persisted: the "All panels" link inside
  // `StudioShell` sets this true; the old rail view's own link back sets it
  // false. `STUDIO_SHELL_UI` decides whether the shell exists AT ALL for this
  // build; this decides which view a signed-in person is looking at RIGHT
  // NOW inside a build that has it.
  const [showAllPanels, setShowAllPanels] = useState(false);
  // WS-R52. `?lang=` first, read ONCE at mount (a URL a creator bookmarked
  // or shared should not silently stop meaning what it said); the stored
  // preference (`selected.locale`, migration 112) once a replica has
  // loaded and the URL gave nothing. `null` here means "no explicit URL
  // hint" -- not "English" -- so the stored preference is never shadowed by
  // a default this file invented. Exactly the fallback chain
  // `api/_room-surface.js`'s `openRoom` already uses one surface over.
  const [urlLocale] = useState<StudioChromeLocale | null>(() => {
    const raw = new URLSearchParams(window.location.search).get("lang");
    return raw === "en" || raw === "hi" ? raw : null;
  });
  const [localeBusy, setLocaleBusy] = useState(false);
  const studioLocale: StudioChromeLocale = urlLocale ?? normalizeStudioLocale(selected?.locale);
  // `src/room/RoomApp.tsx`'s own line, same reason: the studio's chrome
  // locale is a client-side fact `studio.html`'s static `lang="en"` cannot
  // know at build time.
  useEffect(() => {
    document.documentElement.lang = studioLocale;
  }, [studioLocale]);
  const switchLocale = useCallback(
    async (next: StudioChromeLocale) => {
      if (!session || !selected || localeBusy || next === studioLocale) return;
      setLocaleBusy(true);
      try {
        const updated = await setReplicaLocale(session.accessToken, selected.replica_id, next);
        setSelected(updated);
        setReplicas((prev) => prev.map((r) => (r.replica_id === updated.replica_id ? updated : r)));
      } catch {
        // A locale switch that fails leaves the chrome exactly where it was
        // -- never a silent partial flip, and never worth a full-page error
        // banner for what is a convenience control, not a blocking action.
      } finally {
        setLocaleBusy(false);
      }
    },
    [session, selected, localeBusy, studioLocale],
  );
  // WS-R23 (086). `inviteConfirmed` gates CreateReplicaCard behind
  // InviteGate for a brand new account; `inviteCode` is what the eventual
  // create call sends. Neither is read at all unless INVITES_REQUIRED_UI is
  // on and replicas.length === 0 — see the render condition below.
  const [inviteConfirmed, setInviteConfirmed] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  const [inviteError, setInviteError] = useState<string | null>(null);
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
  // WS-R2. Only ever populated when VOICE_IDENTITY_UI is on; the status call
  // is not made otherwise, so a build with the flag off never touches the
  // endpoint that would 404 at it.
  const [voiceChallenge, setVoiceChallenge] = useState<VoiceIdentityChallenge | null>(null);
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
  // WS-R7. `null` means the Room panel has not answered yet — the same
  // "unknown is not zero" rule `connectedChannels` above already carries, so
  // Deploy readiness cannot claim "not published" before the Room has ever
  // been asked. Fed up from `RoomStudio`'s own load rather than fetched a
  // second time here, `onRuntimeStatus`'s own pattern one field over.
  const [roomPublished, setRoomPublished] = useState<boolean | null>(null);
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

  // `useCallback` is load-bearing, not tidiness: this is a dependency of
  // ActivityPanel's poll effect, and an identity that changed on every render
  // would restart the poll loop on every render.
  const handleActivityView = useCallback((view: ActivityView) => {
    setPlatformWork({
      running: view.jobs.filter((job) => job.state === "running" || job.state === "queued").length,
      stuck: view.jobs.filter((job) => job.state === "blocked").length,
      undeployedLanes: view.lanes.filter((lane) => !lane.deployed).map((lane) => lane.label),
    });
  }, []);

  // A new workspace is a new queue. Carrying the previous one's platform state
  // across a switch would be the stale-value failure without the excuse.
  useEffect(() => { setPlatformWork(null); }, [selected?.replica_id]);

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
    }
  }, [goStep]);

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
    handleApiError(cause, "AI qualification controls could not be loaded");
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
        // WS-R25 (migration 088). This effect fires exactly once per
        // replica selection - the studio wizard's own mount for THIS
        // replica - so this is the one call site for "studio_opened".
        // Fire and forget: a failed mark must never block or surface an
        // error on the wizard itself.
        void markFunnelStep(fresh.accessToken, replicaId, "studio_opened").catch(() => {});
        const [
          consentResult,
          sourceResult,
          challengeResult,
          runtimeResult,
          sheetResult,
          channelResult,
          voiceChallengeResult,
        ] = await Promise.allSettled([
          listEnrollmentConsent(fresh.accessToken, replicaId),
          listSources(fresh.accessToken, replicaId),
          livenessStatus(fresh.accessToken, replicaId),
          readRuntimeStatus(fresh.accessToken, replicaId),
          mode === "teacher" ? readTeacherSheetDraft(fresh.accessToken, replicaId) : Promise.resolve(null),
          mode === "teacher" ? listChannels(fresh.accessToken, replicaId) : Promise.resolve(null),
          VOICE_IDENTITY_UI ? voiceIdentityStatus(fresh.accessToken, replicaId) : Promise.resolve(null),
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
        if (voiceChallengeResult.status === "fulfilled") setVoiceChallenge(voiceChallengeResult.value);
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
      const replica = await createReplica(fresh.accessToken, name, inviteCode || undefined);
      setReplicas((items) => [replica, ...items]);
      setSelected(replica);
      setShowCreate(false);
      setInviteConfirmed(false);
      setInviteCode("");
      setInviteError(null);
      setNotice(copy.createdNotice);
    } catch (cause) {
      // WS-R23 (086). The server's ONLY two invite refusals, named exactly
      // (api/replica.js's error field IS the code, not a sentence — see
      // ReplicaApiError's own `raw.replaceAll("_", " ")` transform, why this
      // matches on the space-separated form rather than the wire form).
      // Handled here rather than through errorCopy.ts's REFUSAL_COPY map so
      // the person lands back on InviteGate with a reason, not on the
      // generic error banner with no form to retry from.
      if (
        cause instanceof ReplicaApiError &&
        (cause.message.trim() === "invite required" || cause.message.trim() === "invite invalid")
      ) {
        setInviteConfirmed(false);
        setInviteError(
          cause.message.trim() === "invite required"
            ? "An invite code is required for your first workspace."
            : "That code did not work. Check it and try again, or apply below.",
        );
        return;
      }
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
      setNotice("Your AI is revoked. Future use is blocked and verified erasure is pending.");
    } catch (cause) {
      handleApiError(cause, "Could not revoke your AI");
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
      setNotice("Source permissions withdrawn. Your AI is non-operational and source erasure is pending.");
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
        ? "Private build and disclosed inference permissions recorded. Your AI is not active until every independent gate passes."
        : "Build and inference permissions withdrawn. Your AI is disabled and derived copies are queued for erasure.");
    } catch (cause) {
      handleApiError(cause, "Could not refresh verified AI permissions");
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
      setNotice("Source received and isolated in private quarantine. Building your AI from it has not started.");
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
      setNotice("Live evidence secured. Verification is pending and biometric setup remains locked.");
      return result.challenge;
    } catch (cause) {
      handleApiError(cause, "Could not finalize live evidence");
      throw cause;
    }
  }

  // ── WS-R2: the spoken identity challenge ────────────────────────────────
  // Every one of these mirrors its liveness twin above. The one difference
  // worth naming is `handleRefreshVoiceChallenge`: the verdict is reached by a
  // scheduled sweep and not by any request the studio makes, so the panel
  // polls while the challenge is in flight rather than awaiting a result that
  // no open connection is going to deliver.
  async function handleRefreshVoiceChallenge() {
    if (!session || !selected) return;
    try {
      const fresh = await refreshForRequest(session);
      setVoiceChallenge(await voiceIdentityStatus(fresh.accessToken, selected.replica_id));
    } catch {
      // A failed poll is not worth a banner: the panel already says the check
      // is with us, and the next tick either succeeds or the person reloads.
    }
  }

  async function handleIssueVoiceChallenge() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const issued = await issueVoiceIdentityChallenge(fresh.accessToken, selected.replica_id);
      setVoiceChallenge(issued);
      return issued;
    } catch (cause) {
      handleApiError(cause, "Could not get a sentence to read");
      throw cause;
    }
  }

  async function handleCancelVoiceChallenge(challengeId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const cancelled = await cancelVoiceIdentityChallenge(fresh.accessToken, selected.replica_id, challengeId);
      setVoiceChallenge(cancelled);
      setSources((items) => items.map((source) =>
        source.capture_mode === "identity_challenge" ? { ...source, state: "deleting" } : source));
      setNotice("Attempt cancelled. The recording is queued for deletion.");
      return cancelled;
    } catch (cause) {
      handleApiError(cause, "Could not cancel this attempt");
      throw cause;
    }
  }

  async function handleCreateVoiceIdentityUpload(input: {
    challengeId: string;
    role: "capture" | "transcript";
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const created = await createVoiceIdentityUpload(fresh.accessToken, { replicaId: selected.replica_id, ...input });
      setVoiceChallenge(created.challenge);
      setSources((items) => [created.source, ...items.filter((item) => item.source_id !== created.source.source_id)]);
      return created;
    } catch (cause) {
      handleApiError(cause, "Could not get permission to send the recording");
      throw cause;
    }
  }

  async function handleFinalizeVoiceIdentity(challengeId: string, sourceId: string) {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const result = await finalizeVoiceIdentityUpload(fresh.accessToken, selected.replica_id, challengeId, sourceId);
      setVoiceChallenge(result.challenge);
      setSources((items) => [result.source, ...items.filter((item) => item.source_id !== result.source.source_id)]);
      if (result.challenge.state === "captured") setNotice("Recording secured. We are checking it now.");
      return result.challenge;
    } catch (cause) {
      handleApiError(cause, "Could not secure the recording");
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
    roomPublished,
    platformWork,
  }), [connectedChannels, consents, contextItemCount, mode, platformWork, roomPublished, runtimeStatus, selected, sheetDraft, sources.length]);

  const wizard = useMemo(() => {
    const base = computeWizard(wizardInput);
    return STUDIO_SELF_TEST_UI ? selfTestWizard(base) : base;
  }, [wizardInput]);
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
      <main className="boot-page">
        <Mark />
        <Spinner label="Opening private studio" />
        <p>Opening your private studio</p>
      </main>
    );
  }

  if (!session) return <AuthGate copy={copy} testEnvironment={STUDIO_SELF_TEST_UI} onAuthed={(next) => { setSession(next); void loadReplicas(next); }} />;

  return (
    // WS-R52. Wraps the whole signed-in tree so any panel -- Tier 1 fully
    // localized, Tier 2 not yet (copy.ts's own header) -- can read the
    // creator's chrome locale via `useStudioLocale()` with no prop threading.
    <StudioLocaleProvider locale={studioLocale}>
    <div className={`studio-shell${STUDIO_SELF_TEST_UI ? " studio-shell-self-test" : ""}`}>
      <header className="studio-header">
        <a className="studio-logo" href="/" aria-label="Vyakti home">
          <Mark />
          <span><strong>VYAKTI</strong><small>{mode === "teacher" ? "GURUKUL STUDIO" : "REPLICA STUDIO"}</small></span>
        </a>
        <div className="header-trust"><span className="secure-dot" />{STUDIO_SELF_TEST_UI ? "Internal test workspace" : mode === "teacher" ? "Private teaching-AI workspace" : "Private, self-only workspace"}</div>
        <div className="account-menu">
          <span className="account-copy"><strong>{identity}</strong><small>{STUDIO_SELF_TEST_UI ? "Test workspace session" : "Verified account session"}</small></span>
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
        {/* THE RAIL, IN TWO FORMS, AND ONLY ONE OF THEM IS RENDERED.
            On a phone the three-row rail costs about a third of the first
            viewport before any control appears, so the phone gets a segmented
            control plus one named line: same three answers (where am I, what
            state is each step in, what is left here), about 90px instead of
            about 300px. It is sticky under the header because "where am I" is a
            question people ask again halfway down a long form. Different DOM
            rather than the same DOM hidden, so a phone does not carry a desktop
            rail it never shows. */}
        {/* WS-R31. `StudioShell` carries its own tab bar (the collapse's
            whole point), so the wizard rail and its phone twin render only
            when the shell is off for this build, or when this person tapped
            "All panels" to reach the full bench. The replica switcher stays
            in both cases: switching workspace is orthogonal to which
            navigation is on screen. */}
        {compact ? (
          selected && !showCreate && !(STUDIO_SHELL_UI && !showAllPanels) ? (
            <CompactRail steps={wizard.steps} current={activeStep} onGo={goStep} />
          ) : null
        ) : (
        <div className="studio-rail">
          {selected && !showCreate && !(STUDIO_SHELL_UI && !showAllPanels) && (
            <WizardRail steps={wizard.steps} current={activeStep} onGo={goStep} label={STUDIO_SELF_TEST_UI ? "Your test flow" : undefined} />
          )}
          <ReplicaList
            replicas={replicas}
            selectedId={selected?.replica_id ?? null}
            onSelect={(id) => void selectReplica(id)}
            onNew={() => setShowCreate(true)}
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
            <div className="workspace-loading" aria-label="Loading your AI's workspace">
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-subtitle" />
              <div className="skeleton-grid">
                {Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-card" key={index} />)}
              </div>
              <div className="skeleton skeleton-panel" />
            </div>
          ) : showCreate || (!selected && loadState === "ready") ? (
            INVITES_REQUIRED_UI && replicas.length === 0 && !inviteConfirmed ? (
              <InviteGate
                onContinue={(code) => {
                  setInviteError(null);
                  setInviteCode(code);
                  setInviteConfirmed(true);
                }}
                error={inviteError}
              />
            ) : (
              <CreateReplicaCard onCreate={(name) => void handleCreate(name)} busy={creating} copy={copy} />
            )
          ) : selected && sheet ? (
            <>
              {/* WS-R31. The one-line way back, symmetric with the shell's
                  own "All panels" link: visible only when this build HAS a
                  shell to return to and this person explicitly left it. */}
              {STUDIO_SHELL_UI && showAllPanels && (
                <button type="button" className="text-button studio-back-to-shell-link" onClick={() => setShowAllPanels(false)}>
                  Back to Feed / Meet / Share
                </button>
              )}
              {(() => {
                const workspaceProps = {
                  replica: selected,
                  testEnvironment: STUDIO_SELF_TEST_UI,
                  mode,
                  copy,
                  step: activeStep,
                  wizard,
                  wizardInput,
                  onGoStep: goStep,
                  sheet,
                  sheetProvenance,
                  runtimeStatus,
                  onRuntimeStatus: setRuntimeStatus,
                  onRoomPublished: setRoomPublished,
                  onContextCount: setContextItemCount,
                  erasureStatus,
                  consents,
                  sources,
                  enrollmentLoading,
                  challenge,
                  livenessLoading,
                  onGrantConsent: handleGrantConsent,
                  onRevokeConsent: handleRevokeConsent,
                  onCreateUpload: handleCreateUpload,
                  onRetryUpload: handleRetryUpload,
                  onFinalizeUpload: handleFinalizeUpload,
                  onDeleteSource: handleDeleteSource,
                  onIssueChallenge: handleIssueChallenge,
                  onStartFaceSession: handleStartFaceSession,
                  onPollFaceSession: handlePollFaceSession,
                  onCancelChallenge: handleCancelChallenge,
                  onCreateLivenessUpload: handleCreateLivenessUpload,
                  onFinalizeLiveness: handleFinalizeLiveness,
                  voiceChallenge,
                  onIssueVoiceChallenge: handleIssueVoiceChallenge,
                  onCancelVoiceChallenge: handleCancelVoiceChallenge,
                  onCreateVoiceIdentityUpload: handleCreateVoiceIdentityUpload,
                  onFinalizeVoiceIdentity: handleFinalizeVoiceIdentity,
                  onRefreshVoiceChallenge: handleRefreshVoiceChallenge,
                  onIdentityChanged: handleIdentityChanged,
                  onVerifiedConsentChanged: handleVerifiedConsentChanged,
                  onRevoke: handleRevoke,
                  revoking,
                  accessToken: session.accessToken,
                  onReviewAuthError: handleReviewAuthError,
                  compact,
                  onActivityView: handleActivityView,
                  onActivityAct: handleActivityAct,
                } as const;
                return STUDIO_SHELL_UI && !showAllPanels
                  ? (
                    <StudioShell
                      {...workspaceProps}
                      onShowAllPanels={() => setShowAllPanels(true)}
                      locale={studioLocale}
                      localeBusy={localeBusy}
                      onSwitchLocale={(next) => void switchLocale(next)}
                    />
                  )
                  : <ReplicaWorkspace {...workspaceProps} />;
              })()}
            </>
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
              />
            </details>
          )}
        </main>
      </div>
    </div>
    </StudioLocaleProvider>
  );
}
