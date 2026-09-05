import { lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ensureStudioSession, isStudioAuthDead } from "./studioAuth";
import {
  createReplica,
  exportReplicaData,
  listReplicas,
  readCreatorPushConfig,
  readErasureStatus,
  readReplica,
  ReplicaApiError,
  revokeReplica,
  setReplicaLocale,
  subscribeCreatorPush,
  revokeCreatorPush,
  type CreatorPushConfig,
} from "./replicaApi";
// WS-R52. `StudioLocale` (aliased: this file already has its own unrelated
// `StudioCopy` interface -- src/studio/copy.ts's own `StudioCopy` never
// enters this file, only the locale type and the provider do) plus the
// provider StudioApp mounts once, at the top of the signed-in tree.
// WS-R70 adds `STUDIO_COPY_TABLE` for the SAME reason, read directly by
// `studioLocale` rather than through `useStudioLocale()` -- `handleExport`
// below is a plain callback, not a component, so it cannot call a hook.
import { loadStudioCopy, normalizeStudioLocale, STUDIO_COPY_TABLE, studioCopyReady, withLabel, type StudioLocale as StudioChromeLocale } from "./copy";
import { StudioLocaleProvider, useStudioLocale } from "./localeContext";
// WS-R91. The pre-sign-in half of the locale chain (?lang= / a remembered
// local choice / "en"), pulled out as its own pure module so it can be
// unit-tested directly -- see `studioLocalePreference.ts`'s own header.
import {
  readRememberedStudioLocale,
  resolveStudioLocale,
  writeRememberedStudioLocale,
} from "./studioLocalePreference";
import { restoreSession, writeStoredSession } from "./session";
// WS-R91. AuthGate is its own file now (evals/studio-locale/run.mjs's own
// TIER_1_FILES entry) -- see that file's header for why. `Mark`/`Spinner`
// moved to `StudioChrome.tsx` alongside it, the shared leaf both this file
// and AuthGate.tsx import rather than either importing from the other.
import AuthGate, { type AuthGateVariant } from "./AuthGate";
import { Mark, Spinner } from "./StudioChrome";
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
import { Localized } from "./Localized";
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

// WS-R91. `brandTag`/`introEyebrow`/`introTitle`/`introBody` moved out of
// this interface: they were the OLD AuthGate's own fields, now
// `copy.ts#authGate.variant`'s job in both locales — see `AuthGate.tsx`.
// Everything left here is `CreateReplicaCard`'s own copy shape.
//
// WS-R106. The three fixed English objects that used to live here
// (`GENERIC_COPY`/`TEACHER_COPY`/`TEST_COPY`) moved into
// `copy.ts#studioApp.createReplica` (both locales) -- this interface now
// only names the SHAPE, read locale-aware where `copy` is assigned below.
// See context/decisions.md#ws-r106-studioapp-tsx-converted-tier-1.
interface StudioCopy {
  workspaceNoun: string;
  firstEyebrow: string;
  firstTitle: string;
  firstBody: string;
  nameLabel: string;
  namePlaceholder: string;
  fieldNote: string;
  createdNotice: string;
}

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

// WS-R106. Anchors are structural (never translated); labels come from
// `t.studioApp.testSourceGuide` (both the button text and the `jumpTo`
// announcement it feeds share the same translated string -- WizardRail.tsx's
// own `announcedMoveText` composes the locale-aware "moved to {label}"
// template around whatever this passes it, so passing the Hindi label here
// is what keeps the screen-reader announcement in the reader's own language
// too).
const TEST_SOURCE_ANCHORS = [
  { key: "audioOrVideoFile", anchor: "#enrollment-workspace" },
  { key: "screenshotDocumentOrTextFile", anchor: "#enrollment-workspace" },
  { key: "textOrWebLink", anchor: "#context-locker" },
  { key: "youtubeVideo", anchor: "#video-enroll-heading" },
  { key: "youtubeChannel", anchor: "#ingest-channel-title" },
] as const;

function TestSourceGuide() {
  const { t } = useStudioLocale();
  const c = t.studioApp.testSourceGuide;
  return (
    <nav className="test-source-guide" aria-label={c.ariaLabel}>
      <p>{c.intro}</p>
      <div>
        {TEST_SOURCE_ANCHORS.map((source) => {
          const label = c[source.key];
          return (
            <button key={source.key} type="button" onClick={() => jumpTo(source.anchor, label)}>
              {label}
            </button>
          );
        })}
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

// AuthGate moved to its own file, AuthGate.tsx (WS-R91) -- see that file's
// header for why. `AuthStep` above is used only by it, so it moved too.
// WS-R106: `copy` below now arrives locale-aware from `copy.ts#studioApp.
// createReplica` (StudioApp's own selection, see the `const copy = ...`
// assignment there) -- `CreateReplicaCard` itself stays a plain function of
// its `copy` prop, unchanged in shape, since it has no other way to reach
// `useStudioLocale()` (it renders both signed-in AND, transiently, while a
// brand new account has zero workspaces).

function CreateReplicaCard({ onCreate, busy, copy }: { onCreate: (name: string) => void; busy: boolean; copy: StudioCopy }) {
  const { t } = useStudioLocale();
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
              {busy ? <Spinner label={t.studioApp.creatingAriaLabel} /> : t.studioApp.createButton}
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
  const { t } = useStudioLocale();
  const c = t.studioApp.replicaList;
  return (
    <aside className="replica-rail" aria-label={c.yourAIsAriaLabel}>
      <div className="rail-label">{c.yourAIsLabel}</div>
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
        <span>+</span> {c.newWorkspace}
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
  const { t } = useStudioLocale();
  const c = t.studioApp.voiceUnlockNotice;
  const identity = replica.identity_verified;
  const liveness = replica.liveness_verified;
  if (identity && liveness) return null;
  // WS-R106: three complete sentences rather than one English sentence with
  // a noun phrase interpolated mid-clause -- Hindi word order does not put
  // the missing thing in the same place English does, so each branch is its
  // own full, independently correct sentence in `copy.ts#studioApp.
  // voiceUnlockNotice` rather than a template a translator would have to
  // guess the grammar around.
  const body = !identity && !liveness
    ? c.bodyMissingBoth
    : identity ? c.bodyMissingLiveness : c.bodyMissingIdentity;
  return (
    <aside className="voice-unlock" role="status">
      {/* Carries the class label like every other blocked state on the studio,
          because this genuinely IS the person's turn and saying so in the same
          words the rest of the product uses is what makes "waiting on us"
          believable when it appears. A vocabulary that is only honest in the
          places where honesty is cheap is not a vocabulary. */}
      <p className="voice-unlock-class">{CLASS_COPY.you.label}</p>
      <p>{body}</p>
      <a className="text-button" href="#identity-proofing">{c.verifyLink}</a>
    </aside>
  );
}

/** RFC 4648 base64url, both directions - `OpsBoard.tsx`'s own pair,
 *  restated here rather than imported: that file is a standalone mount
 *  this surface deliberately does not depend on, its own header's reason
 *  restated. Two tiny pure functions duplicated a second time is a
 *  smaller risk than a cross-file import neither side asked for. */
function b64uToUint8Array(b64u: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
  const base64 = (b64u + pad).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
function bufToB64u(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// WS-R74 (migration 118). "This week on your phone" - `OpsBoard.tsx`'s own
// `PushAlertsCard` restated for the creator lane, self-contained per
// `CheckinsCard.tsx`'s own precedent (owns its own fetch/subscribe state
// rather than threading more useStates through `ReplicaWorkspace`'s already
// large prop list). Reuses `/push-sw.js`, the SAME generic, already-
// reviewed display worker every other account-wide push in this repo uses
// (`api/_creator-push.js`'s own header on why this works unmodified) -
// never a second service worker or a second display path.
function WeeklyPushCard({ token }: { token: string }) {
  const { t } = useStudioLocale();
  const c = t.creatorPush;
  const [config, setConfig] = useState<CreatorPushConfig | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [checked, setChecked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      let cfg: CreatorPushConfig | null = null;
      try {
        cfg = await readCreatorPushConfig(token);
      } catch {
        cfg = null;
      }
      if (!live) return;
      setConfig(cfg);
      if (!cfg?.configured) {
        setChecked(true);
        return;
      }
      try {
        const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
        const existing = await registration?.pushManager.getSubscription();
        if (live) setSubscribed(Boolean(existing));
      } catch {
        // Unsupported browser (no serviceWorker/PushManager) - the control
        // below renders its own honest "not configured" state, since
        // `config` stayed whatever the read above returned; `checked`
        // still flips so the button is not left permanently disabled.
      } finally {
        if (live) setChecked(true);
      }
    })();
    return () => {
      live = false;
    };
  }, [token]);

  const toggle = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      if (subscribed) {
        const registration = await navigator.serviceWorker.getRegistration("/push-sw.js");
        const existing = await registration?.pushManager.getSubscription();
        if (existing) {
          await revokeCreatorPush(token, existing.endpoint);
          await existing.unsubscribe();
        }
        setSubscribed(false);
      } else {
        if (!config?.vapid_public) return;
        if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("push_unsupported");
        const permission = await Notification.requestPermission();
        if (permission !== "granted") throw new Error("push_denied");
        const registration = await navigator.serviceWorker.register("/push-sw.js");
        await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        const subscription =
          existing ??
          (await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64uToUint8Array(config.vapid_public),
          }));
        const endpoint = subscription.endpoint;
        const p256dh = bufToB64u(subscription.getKey("p256dh"));
        const auth = bufToB64u(subscription.getKey("auth"));
        await subscribeCreatorPush(token, endpoint, p256dh, auth);
        setSubscribed(true);
      }
    } catch {
      setError(c.error);
    } finally {
      setBusy(false);
    }
  }, [subscribed, config, token, c.error]);

  return (
    <section className="export-zone" aria-labelledby="weekly-push-title">
      <div>
        <h2 id="weekly-push-title">{c.title}</h2>
        <p>{c.intro}</p>
      </div>
      {!config?.configured ? (
        <p>{c.notConfigured}</p>
      ) : (
        <>
          <button
            className="button secondary-button"
            type="button"
            disabled={busy || !checked}
            onPointerDown={() => void toggle()}
          >
            {subscribed ? c.turnOff : c.turnOn}
          </button>
          {error && <p className="inline-error" role="alert">{error}</p>}
        </>
      )}
    </section>
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
  onExport,
  exporting,
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
  onExport: () => Promise<void>;
  exporting: boolean;
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
  // WS-R70. This is the ONE Tier 2 (allowlisted, deferred) read of `t` in
  // this file's "Owner control" section -- the surrounding English strings
  // in this section stay as they are (this workstream's scope cut, see
  // context/rejected.md), but the new "Download everything" control this
  // workstream adds is written properly bilingual from the start rather
  // than joining the deferred pile. Never throws outside a provider
  // (`useStudioLocale`'s own header): falls back to English.
  const { t } = useStudioLocale();
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
          <strong>{t.studioApp.testEnvironmentNoticeTitle}</strong>
          <span>{t.studioApp.testEnvironmentNoticeBody}</span>
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
            {/* WS-R79: a creator's own Room name, independent of which
                locale they are reading the rest of the studio's chrome in. */}
            <h1><Localized as="span" text={replica.display_name} /></h1>
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
              jumpTo(`#processing-status-${step}`, t.studioApp.feed.uploadStatusTitle);
            }}
          />

          {step === "feed" && (
            <>
              {testEnvironment && <TestSourceGuide />}
              <Band
                collapsible={compact}
                defaultOpen
                title={testEnvironment ? t.studioApp.feed.materialTitleTest : t.studioApp.feed.materialTitle}
                blurb={testEnvironment ? t.studioApp.feed.materialBlurbTest : t.studioApp.feed.materialBlurb}
              >
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.material}</div>}>
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
                title={testEnvironment ? t.studioApp.feed.filesTitleTest : t.studioApp.feed.filesTitle}
                blurb={testEnvironment ? t.studioApp.feed.filesBlurbTest : t.studioApp.feed.filesBlurb}
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
                title={t.studioApp.feed.uploadStatusTitle}
                blurb={t.studioApp.feed.uploadStatusBlurb}
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
                title={t.studioApp.meet.hearTalkTitle}
                blurb={t.studioApp.meet.hearTalkBlurb}
              >
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.voice}</div>}>
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
                <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.call}</div>}>
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
                title={testEnvironment ? t.studioApp.meet.checkCorrectTitleTest : t.studioApp.meet.checkCorrectTitle}
                blurb={testEnvironment ? t.studioApp.meet.checkCorrectBlurbTest : t.studioApp.meet.checkCorrectBlurb}
              >
                {/* WS-R4. FIRST in this band, and open, because it is the one
                    thing on the Meet step that is thirty seconds long and moves
                    the number. Everything below it is a lab. */}
                {!testEnvironment && (
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.reviewQueue}</div>}>
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
                title={t.studioApp.meet.proveTitle}
                blurb={t.studioApp.meet.proveBlurb}
              >
                {/* WS-R2. One band, two possible identity paths, never both.
                    The Azure pair needs two Microsoft Limited Access
                    approvals and has never been deployed; the spoken
                    challenge uses services that are already running. The flag
                    is off by default, so this renders exactly what it renders
                    today until the main loop turns it on. */}
                {VOICE_IDENTITY_UI ? (
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.identityChecks}</div>}>
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
                    <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.identityChecks}</div>}>
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
                title={t.studioApp.meet.advancedTitle}
                blurb={t.studioApp.meet.advancedBlurb}
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
                  title={t.studioApp.deploy.disclosureTitle}
                  blurb={t.studioApp.deploy.disclosureBlurb}
                >
                  {sheetProvenance === "draft" ? (
                    <DisclosurePreview sheet={sheet} />
                  ) : (
                    <section className="disclosure-preview" aria-labelledby="disclosure-empty-title">
                      <div className="section-heading">
                        <div>
                          <p className="eyebrow">{t.studioApp.deploy.disclosureEmpty.eyebrow}</p>
                          <h2 id="disclosure-empty-title">{t.studioApp.deploy.disclosureEmpty.title}</h2>
                          <p>{t.studioApp.deploy.disclosureEmpty.body}</p>
                        </div>
                      </div>
                      <button className="button secondary-button" type="button" onClick={() => onGoStep("meet")}>
                        {t.studioApp.deploy.disclosureEmpty.button}
                      </button>
                    </section>
                  )}
                </Band>
              )}

              <Band
                collapsible={compact}
                defaultOpen
                title={t.studioApp.deploy.gatesTitle}
                blurb={t.studioApp.deploy.gatesBlurb}
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
                  title={t.studioApp.deploy.roomTitle}
                  blurb={t.studioApp.deploy.roomBlurb}
                >
                  <Suspense fallback={<div className="review-loading" role="status"><span className="spinner" />{t.studioApp.loading.room}</div>}>
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
                  title={t.studioApp.deploy.channelsTitle}
                  blurb={t.studioApp.deploy.channelsBlurb}
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
                          <p className="eyebrow">{t.studioApp.deploy.channelsEmpty.eyebrow}</p>
                          <h2 id="channels-empty-title">{t.studioApp.deploy.channelsEmpty.title}</h2>
                          <p>{t.studioApp.deploy.channelsEmpty.body}</p>
                        </div>
                      </div>
                      <button className="button secondary-button" type="button" onClick={() => onGoStep("meet")}>
                        {t.studioApp.deploy.channelsEmpty.button}
                      </button>
                    </section>
                  )}
                </Band>
              )}

              <AdvancedArea
                id="advanced-deploy"
                title={t.studioApp.deploy.ownerAreaTitle}
                blurb={t.studioApp.deploy.ownerAreaBlurb}
              >
                <section className="export-zone" aria-labelledby="export-title">
                  <div>
                    <p className="eyebrow">{t.creatorExport.eyebrow}</p>
                    <h2 id="export-title">{t.creatorExport.title}</h2>
                    <p>{t.creatorExport.body}</p>
                  </div>
                  <button
                    className="button secondary-button"
                    type="button"
                    disabled={exporting}
                    onClick={() => void onExport()}
                  >
                    {exporting ? <><Spinner label={t.creatorExport.downloading} />{t.creatorExport.downloading}</> : t.creatorExport.button}
                  </button>
                </section>
                <WeeklyPushCard token={accessToken} />
                <section className="danger-zone" aria-labelledby="control-title">
                  <div>
                    <p className="eyebrow">{t.studioApp.deploy.ownerControlEyebrow}</p>
                    <h2 id="control-title">{t.studioApp.deploy.revokeTitle}</h2>
                    <p>{t.studioApp.deploy.revokeBody}</p>
                  </div>
                  <button className="button danger-button" type="button" onClick={() => setConfirming(true)}>
                    {t.studioApp.deploy.revokeButton}
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
            <h2 id="revoke-title">{withLabel(t.studioApp.revokeDialog.titleTemplate, replica.display_name)}</h2>
            <p>{t.studioApp.revokeDialog.body}</p>
            <label className="field-label" htmlFor="revoke-confirmation">{t.studioApp.revokeDialog.confirmLabel}</label>
            <input
              id="revoke-confirmation"
              className="field"
              autoFocus
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value.toUpperCase())}
            />
            <div className="modal-actions">
              <button className="button secondary-button" disabled={revoking} onClick={() => setConfirming(false)}>{t.studioApp.revokeDialog.keepButton}</button>
              <button
                className="button destructive-button"
                disabled={revoking || confirmation !== "REVOKE"}
                onClick={() => void onRevoke()}
              >
                {revoking ? <><Spinner label={t.studioApp.revokeDialog.revokingAriaLabel} />{t.studioApp.revokeDialog.revoking}</> : t.studioApp.revokeDialog.revokePermanently}
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
  // WS-R91. AuthGate's own locale-aware variant key into `copy.ts`'s
  // `authGate.variant` table -- the SAME three-way selection `copy` below
  // makes for `CreateReplicaCard`, restated as a string key rather than an
  // object so AuthGate can look itself up correctly in either language.
  const authVariant: AuthGateVariant = STUDIO_SELF_TEST_UI ? "test" : mode === "teacher" ? "teacher" : "generic";
  const [session, setSession] = useState<StudioSession | null>(null); // copy-ok: scripts/check-copy.mjs's textNodes() pairs this generic's ">" with a later "<Replica[]>" across the plain useState lines between them, extracting real code (not copy) as a fake text node -- ws-r10-check-copy-apostrophe-parity's own documented failure mode, restated for angle brackets rather than apostrophes; "replicas" here is the pre-existing state variable, unrelated to the rooms-vocabulary rule this fires.
  const [authChecked, setAuthChecked] = useState(false);
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [selected, setSelected] = useState<Replica | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [exporting, setExporting] = useState(false);
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
  // WS-R91. The pre-auth half of the chain: a replica has not loaded yet
  // (signed out, or the fetch is still in flight), so there is no
  // `vy_replica.locale` to read -- the studio's own remembered LOCAL choice
  // stands in until one has. `resolveStudioLocale`'s own header states the
  // full order; `context/decisions.md#ws-r91-authgate-reads-locale-before-sign-in`
  // is the decision.
  const [rememberedLocale, setRememberedLocale] = useState<StudioChromeLocale | null>(
    () => readRememberedStudioLocale(),
  );
  const [localeBusy, setLocaleBusy] = useState(false);
  const studioLocale: StudioChromeLocale = resolveStudioLocale({
    urlLocale,
    replica: selected,
    rememberedLocale,
  });
  // WS-R106. `StudioApp` itself mounts `StudioLocaleProvider` below rather
  // than sitting under it, so it cannot call `useStudioLocale()` -- `sa` is
  // the direct `STUDIO_COPY_TABLE` read `handleExport` already used for
  // exactly this reason (see its own `const t = STUDIO_COPY_TABLE[...]`
  // below), generalised to the whole `studioApp` block so every handler in
  // this component can read locale-aware copy the same way.
  //
  // `studioCopyReady` guards this the SAME way `StudioLocaleProvider` guards
  // its own read one file over: `STUDIO_COPY_TABLE.hi` is a Proxy that
  // THROWS on any property read until `loadStudioCopy("hi")` has installed
  // the real table, and this line runs unconditionally in `StudioApp()`'s
  // own body -- well before the `<StudioLocaleProvider>` in this function's
  // JSX return has any chance to render null and stop React from ever
  // reaching it. Every actual USE of `sa`/`copy` sits inside that same
  // Provider's children (the signed-in tree, `CreateReplicaCard` included),
  // so the English fallback below is never shown to a Hindi reader -- it
  // exists only so this assignment does not crash the render before the
  // Provider gets a chance to withhold its children the way it already
  // does. See context/rejected.md#ws-r106-studioapp-own-copy-read-crashed-
  // before-the-hindi-chunk-loaded.
  const sa = studioCopyReady(studioLocale) ? STUDIO_COPY_TABLE[studioLocale].studioApp : STUDIO_COPY_TABLE.en.studioApp;
  const copy: StudioCopy = sa.createReplica[STUDIO_SELF_TEST_UI ? "test" : mode === "teacher" ? "teacher" : "generic"];
  // `StudioLocaleProvider`'s own effect (localeContext.tsx) re-renders ITS
  // OWN subtree once the Hindi chunk lands, which fixes `useStudioLocale()`
  // reads everywhere under it -- but `sa`/`copy` above are computed in this
  // PARENT component, one level outside that subtree, so nothing forces
  // `StudioApp()` itself to recompute them once the chunk resolves. Without
  // this, a Hindi reader whose render happens to settle before the fetch
  // finishes would see `copy`'s English fallback (`nameLabel`/`firstBody`/
  // etc, all still props read directly, not through context) forever, not
  // just for the one frame it exists to bridge. Mirrors
  // `StudioLocaleProvider`'s own not-ready effect exactly, one component up.
  const [, forceStudioCopyRerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    if (studioCopyReady(studioLocale)) return;
    let alive = true;
    loadStudioCopy(studioLocale).then(() => {
      if (alive) forceStudioCopyRerender();
    });
    return () => {
      alive = false;
    };
  }, [studioLocale]);
  // `src/room/RoomApp.tsx`'s own line, same reason: the studio's chrome
  // locale is a client-side fact `studio.html`'s static `lang="en"` cannot
  // know at build time.
  useEffect(() => {
    document.documentElement.lang = studioLocale;
  }, [studioLocale]);
  // WS-R91. Once a replica has loaded, ITS OWN locale is the authoritative
  // record (`resolveStudioLocale` already prefers it over `rememberedLocale`
  // for what is ON SCREEN) -- this keeps the LOCAL memory in sync with it
  // too, so a mismatch (a creator switched language on a different device,
  // or before finishing sign-in on this one) does not keep surfacing after
  // the row has already settled it. Logged as a decision, not silently
  // assumed: `context/decisions.md#ws-r91-authgate-reads-locale-before-sign-in`.
  useEffect(() => {
    if (selected) writeRememberedStudioLocale(normalizeStudioLocale(selected.locale));
  }, [selected]);
  const switchLocale = useCallback(
    async (next: StudioChromeLocale) => {
      if (localeBusy || next === studioLocale) return;
      // Remembered locally regardless of sign-in state -- AuthGate's own
      // language switch (pre-auth) and the signed-in shell's (post-auth)
      // are the SAME callback for exactly this reason: whichever screen a
      // creator switches language on, the choice survives a reload before
      // any replica has loaded to say otherwise.
      writeRememberedStudioLocale(next);
      setRememberedLocale(next);
      if (!session || !selected) return;
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

  const identity = useMemo(() => session?.email || session?.phone || sa.header.signedInAccountFallback, [session, sa]);
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
          setNotice(sa.notices.erasureComplete);
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
          if (live) setNotice(sa.notices.livenessVerified);
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
            ? sa.invite.codeRequired
            : sa.invite.codeInvalid,
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
      setNotice(sa.notices.revoked);
    } catch (cause) {
      handleApiError(cause, "Could not revoke your AI");
    } finally {
      setRevoking(false);
    }
  }

  // WS-R70. `t` read directly off `STUDIO_COPY_TABLE` (never `useStudioLocale()`
  // -- this is a plain callback, not a component, so it cannot call a hook)
  // by the SAME `studioLocale` every other locale-aware read in this
  // component already uses. A client-side Blob download: the export
  // response is one JSON document already in memory, and there is no
  // server-side file to point a URL at (never the bytes, this workstream's
  // own boundary law over `vy_replica_source` restated one layer up -- the
  // creator's OWN document, once downloaded, is briefly a Blob in their own
  // browser, never a second copy this platform stores).
  async function handleExport() {
    if (!session || !selected) return;
    const t = STUDIO_COPY_TABLE[studioLocale].creatorExport;
    setExporting(true);
    setError(null);
    try {
      const fresh = await refreshForRequest(session);
      const dump = await exportReplicaData(fresh.accessToken);
      const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `vyakti-export-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setNotice(t.done);
    } catch (cause) {
      // A 429 here is ALWAYS the once-a-day scope (this op has no other rate
      // gate) - the specific, honest wait ("try again tomorrow") rather than
      // `friendlyError`'s generic 429 text ("wait about a minute"), which
      // would be wrong for a 24-hour window.
      if (cause instanceof ReplicaApiError && cause.status === 429) {
        setError({ headline: t.error, detail: t.rateLimited, canRetry: false });
      } else {
        handleApiError(cause, t.error);
      }
    } finally {
      setExporting(false);
    }
  }

  async function handleGrantConsent() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const granted = await grantEnrollmentConsent(fresh.accessToken, selected.replica_id);
      setConsents(granted);
      await refreshReplicaView(fresh, selected.replica_id);
      setNotice(sa.notices.sourceConsentGranted);
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
      setNotice(sa.notices.sourceConsentWithdrawn);
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
        ? sa.notices.inferenceConsentGranted
        : sa.notices.inferenceConsentWithdrawn);
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
      setNotice(sa.notices.sourceQuarantined);
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
        setNotice(sa.notices.officialFacePassed);
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
        ? sa.notices.verificationCancelledConfirmed
        : result.erasure === "pending"
          ? sa.notices.verificationCancelledPending
          : sa.notices.verificationCancelledNoProviderSession);
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
      setNotice(sa.notices.liveEvidenceSecured);
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
      setNotice(sa.notices.attemptCancelled);
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
      if (result.challenge.state === "captured") setNotice(sa.notices.recordingSecured);
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
      setNotice(result.erasure === "complete" ? sa.notices.sourceErased : sa.notices.sourceDisabled);
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
        <Spinner label={sa.loading.privateStudioAriaLabel} />
        <p>{sa.loading.privateStudio}</p>
      </main>
    );
  }

  if (!session) {
    return (
      // WS-R91. The provider mounts ABOVE the gate: the sign-in screen reads
      // real translated copy in both locales, from the moment it renders,
      // rather than the fixed English `copy` object above (still used
      // below, unchanged, by the signed-in-only `CreateReplicaCard`).
      // context/decisions.md#ws-r91-authgate-reads-locale-before-sign-in.
      <StudioLocaleProvider locale={studioLocale}>
        <AuthGate
          variant={authVariant}
          testEnvironment={STUDIO_SELF_TEST_UI}
          onAuthed={(next) => { setSession(next); void loadReplicas(next); }}
          onSwitchLocale={switchLocale}
        />
      </StudioLocaleProvider>
    );
  }

  return (
    // WS-R52. Wraps the whole signed-in tree so any panel -- Tier 1 fully
    // localized, Tier 2 not yet (copy.ts's own header) -- can read the
    // creator's chrome locale via `useStudioLocale()` with no prop threading.
    <StudioLocaleProvider locale={studioLocale}>
    <div className={`studio-shell${STUDIO_SELF_TEST_UI ? " studio-shell-self-test" : ""}`}>
      <header className="studio-header">
        <a className="studio-logo" href="/" aria-label={sa.header.homeAriaLabel}>
          <Mark />
          <span><strong>VYAKTI</strong><small>{mode === "teacher" ? sa.header.gurukulStudio : sa.header.genericStudio}</small></span>
        </a>
        <div className="header-trust"><span className="secure-dot" />{STUDIO_SELF_TEST_UI ? sa.header.internalTestWorkspace : mode === "teacher" ? sa.header.privateTeachingWorkspace : sa.header.privateSelfOnlyWorkspace}</div>
        <div className="account-menu">
          <span className="account-copy"><strong>{identity}</strong><small>{STUDIO_SELF_TEST_UI ? sa.header.testWorkspaceSession : sa.header.verifiedAccountSession}</small></span>
          <button className="signout-button" type="button" onClick={signOut}>{sa.header.signOut}</button>
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
            <WizardRail steps={wizard.steps} current={activeStep} onGo={goStep} label={STUDIO_SELF_TEST_UI ? sa.header.yourTestFlow : undefined} />
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
              <button type="button" aria-label={sa.header.dismissMessage} onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert" tabIndex={-1} ref={errorBannerRef}>
              <span>!</span><div><strong>{error.headline}</strong><p>{error.detail}</p></div>
              <button type="button" onClick={() => session && void loadReplicas(session)}>{sa.header.tryAgain}</button>
            </div>
          )}

          {loadState === "loading" || loadState === "booting" ? (
            <div className="workspace-loading" aria-label={sa.loading.workspaceAriaLabel}>
              <div className="skeleton skeleton-title" />
              <div className="skeleton skeleton-subtitle" />
              <div className="skeleton-grid">
                {Array.from({ length: 4 }, (_, index) => <div className="skeleton skeleton-card" key={index} />)}
              </div>
              <div className="skeleton skeleton-panel" />
            </div> /* copy-ok: check-copy.mjs's textNodes() pairs this ">" with a later "<InviteGate" across the loadState/showCreate ternary, extracting real code (not copy) as a fake text node -- ws-r10-check-copy-apostrophe-parity's own failure mode, restated for angle brackets; "replicas.length" is the pre-existing state read, unrelated to rooms-vocabulary. */
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
                  {sa.header.backToShell}
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
                  onExport: handleExport,
                  exporting,
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
                <strong>{selected ? selected.display_name : sa.workspaceSwitch.yourWorkspaces}</strong>
                <span>{sa.workspaceSwitch.switchOrStartAnother}</span>
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
