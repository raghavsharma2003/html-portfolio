import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  readReplica,
  ReplicaApiError,
  revokeReplica,
} from "./replicaApi";
import { restoreSession, writeStoredSession } from "./session";
import type {
  ConsentReceipt,
  LivenessChallenge,
  Replica,
  ReplicaRuntimeStatus,
  ReplicaSource,
  SignedUpload,
  SourceKind,
  StudioSession,
} from "./types";
import EnrollmentWorkspace from "./EnrollmentWorkspace";
import LivenessCapture from "./LivenessCapture";
import ProcessingReview from "./ProcessingReview";
import PersonModelStudio from "./PersonModelStudio";
import CalibrationStudio from "./CalibrationStudio";
import RuntimeGate from "./RuntimeGate";
import ReplicaDialogueLab from "./ReplicaDialogueLab";
import CandidateEvaluationLab from "./CandidateEvaluationLab";
import VoiceEnrollmentLab from "./VoiceEnrollmentLab";
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
  createLivenessUpload,
  finalizeLivenessUpload,
  issueLivenessChallenge,
  livenessStatus,
} from "./livenessApi";

type AuthStep = "email" | "code";
type LoadState = "booting" | "loading" | "ready" | "error";

const STAGES = [
  {
    id: "multimodal",
    number: "08",
    title: "Embodiment laboratory",
    copy: "Calibrate face, gaze, gesture, timing, and cross-modal identity against the same person model.",
    availability: "Visual modeling remains disabled",
  },
] as const;

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

function AuthGate({ onAuthed }: { onAuthed: (session: StudioSession) => void }) {
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
        <span>PRIVATE REPLICA LAB</span>
      </header>

      <section className="auth-intro" aria-labelledby="studio-title">
        <p className="eyebrow">Private by construction</p>
        <h1 id="studio-title">A replica that begins with your permission.</h1>
        <p>
          Build and control a consent-verified model of yourself. Every source stays private,
          every capability is separately approved, and revocation stops future use.
        </p>
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
            ? "Use the same account as Meera. Your existing session is recognized automatically."
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

function CreateReplicaCard({ onCreate, busy }: { onCreate: (name: string) => void; busy: boolean }) {
  const [name, setName] = useState("");
  return (
    <section className="empty-card" aria-labelledby="empty-title">
      <div className="portrait-placeholder" aria-hidden="true">
        <div className="scan-ring" />
        <div className="portrait-core">YOU</div>
      </div>
      <div>
        <p className="eyebrow">Your first replica</p>
        <h2 id="empty-title">Begin with identity, not an upload.</h2>
        <p>
          Name your private workspace. Voice, memories, and behavior remain locked until consent and liveness services are connected.
        </p>
        <form
          className="create-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim()) onCreate(name.trim());
          }}
        >
          <label className="field-label" htmlFor="replica-name">Replica name</label>
          <div className="create-row">
            <input
              id="replica-name"
              className="field"
              maxLength={80}
              placeholder="Your name"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            <button className="button primary-button" disabled={busy || !name.trim()}>
              {busy ? <Spinner label="Creating replica" /> : "Create workspace"}
            </button>
          </div>
          <p className="field-note">You may create a replica only of yourself. Verification comes next.</p>
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

function ReplicaWorkspace({
  replica,
  consents,
  sources,
  enrollmentLoading,
  challenge,
  livenessLoading,
  onGrantConsent,
  onRevokeConsent,
  onCreateUpload,
  onRetryUpload,
  onFinalizeUpload,
  onDeleteSource,
  onIssueChallenge,
  onCreateLivenessUpload,
  onFinalizeLiveness,
  onRevoke,
  revoking,
  accessToken,
  onReviewAuthError,
}: {
  replica: Replica;
  consents: ConsentReceipt[];
  sources: ReplicaSource[];
  enrollmentLoading: boolean;
  challenge: LivenessChallenge | null;
  livenessLoading: boolean;
  onGrantConsent: () => Promise<void>;
  onRevokeConsent: () => Promise<void>;
  onCreateUpload: (input: {
    kind: SourceKind;
    mime: string;
    byteSize: number;
    sha256: string;
    containsThirdParties: boolean;
  }) => Promise<{ source: ReplicaSource; upload: SignedUpload }>;
  onRetryUpload: (sourceId: string) => Promise<{ source: ReplicaSource; upload: SignedUpload }>;
  onFinalizeUpload: (sourceId: string) => Promise<ReplicaSource>;
  onDeleteSource: (sourceId: string) => Promise<"complete" | "pending">;
  onIssueChallenge: () => Promise<LivenessChallenge>;
  onCreateLivenessUpload: (input: {
    challengeId: string;
    kind: "audio" | "video";
    mime: string;
    byteSize: number;
    sha256: string;
  }) => Promise<{ challenge: LivenessChallenge; source: ReplicaSource; upload: SignedUpload }>;
  onFinalizeLiveness: (challengeId: string, sourceId: string) => Promise<LivenessChallenge>;
  onRevoke: () => Promise<void>;
  revoking: boolean;
  accessToken: string;
  onReviewAuthError: (cause: unknown) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [runtimeStatus, setRuntimeStatus] = useState<ReplicaRuntimeStatus | null>(null);
  const stopped = replica.lifecycle === "revoked" || replica.lifecycle === "purging";
  const verificationCount = [replica.age_verified, replica.identity_verified, replica.liveness_verified].filter(Boolean).length;

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
            Self-replica
          </div>
          <h1>{replica.display_name}</h1>
          <p>Created {dateLabel(replica.created_at)} · Policy {replica.policy_version}</p>
        </div>
        <div className="control-seal">
          <span>{stopped ? "STOPPED" : "OWNER CONTROLLED"}</span>
          <small>{stopped ? "Erasure queued" : "Private workspace"}</small>
        </div>
      </section>

      {stopped ? (
        <section className="stopped-panel" role="status">
          <div className="stop-icon">×</div>
          <div>
            <p className="eyebrow">Future use disabled</p>
            <h2>This replica has been revoked.</h2>
            <p>Generation is blocked. Private artifacts and provider copies are queued for verified erasure.</p>
          </div>
        </section>
      ) : (
        <>
          <section className="readiness-grid" aria-label="Replica readiness">
            <article className="readiness-card readiness-primary">
              <p className="eyebrow">Activation readiness</p>
              <strong>{verificationCount}/3</strong>
              <span>identity checks complete</span>
              <div className="progress-track"><span style={{ width: `${verificationCount * 33.333}%` }} /></div>
            </article>
            <article className="readiness-card">
              <span className="metric-label">Sources</span>
              <strong>{sources.length}</strong>
              <span>{sources.length ? "Private ledger entries" : "Nothing uploaded"}</span>
            </article>
            <article className="readiness-card">
              <span className="metric-label">Voice versions</span>
              <strong>0</strong>
              <span>No model trained</span>
            </article>
            <article className="readiness-card trust-card">
              <span className="metric-label">Public access</span>
              <strong>Off</strong>
              <span>Cannot be changed</span>
            </article>
          </section>

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

          <LivenessCapture
            consentActive={hasSourceConsent(consents)}
            challenge={challenge}
            loading={livenessLoading}
            onIssue={onIssueChallenge}
            onCreateUpload={onCreateLivenessUpload}
            onRetryUpload={onRetryUpload}
            onFinalize={onFinalizeLiveness}
          />

          <ProcessingReview
            token={accessToken}
            replicaId={replica.replica_id}
            sourceCount={sources.length}
            onAuthError={onReviewAuthError}
          />

          <PersonModelStudio
            token={accessToken}
            replicaId={replica.replica_id}
            onAuthError={onReviewAuthError}
          />

          <CalibrationStudio
            token={accessToken}
            replicaId={replica.replica_id}
            onAuthError={onReviewAuthError}
          />

          <VoiceEnrollmentLab
            key={`voice-enrollment-${replica.replica_id}`}
            token={accessToken}
            replica={replica}
            consents={consents}
            onAuthError={onReviewAuthError}
          />

          <section className="stage-section locked-path" aria-labelledby="path-title">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Not yet enabled</p>
                <h2 id="path-title">Modeling gates</h2>
              </div>
              <p>Uploading evidence does not authorize biometric modeling, training, inference, or generation.</p>
            </div>
            <div className="stage-list">
              {STAGES.map((stage, index) => (
                <article className="stage-row locked" key={stage.id}>
                  <span className="stage-number">{stage.number}</span>
                  <span className="stage-line" aria-hidden="true" />
                  <div className="stage-copy">
                    <h3>{stage.title}</h3>
                    <p>{stage.copy}</p>
                  </div>
                  <div className="stage-lock">
                    <span className="lock-icon" aria-hidden="true" />
                    <span>
                      <strong>Not available</strong>
                      <small>{stage.availability}</small>
                    </span>
                  </div>
                  {index === 0 && <span className="stage-next">LOCKED</span>}
                </article>
              ))}
            </div>
          </section>

          <RuntimeGate
            key={`runtime-${replica.replica_id}`}
            token={accessToken}
            replicaId={replica.replica_id}
            stopped={stopped}
            onAuthError={onReviewAuthError}
            onStatusChange={setRuntimeStatus}
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
        </>
      )}

      {!stopped && (
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
  const [session, setSession] = useState<StudioSession | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [replicas, setReplicas] = useState<Replica[]>([]);
  const [selected, setSelected] = useState<Replica | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("booting");
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [consents, setConsents] = useState<ConsentReceipt[]>([]);
  const [sources, setSources] = useState<ReplicaSource[]>([]);
  const [enrollmentLoading, setEnrollmentLoading] = useState(false);
  const [challenge, setChallenge] = useState<LivenessChallenge | null>(null);
  const [livenessLoading, setLivenessLoading] = useState(false);

  const identity = useMemo(() => session?.email || session?.phone || "Signed in account", [session]);
  const selectedId = selected?.replica_id ?? null;

  const signOut = useCallback(() => {
    writeStoredSession(null);
    setSession(null);
    setReplicas([]);
    setSelected(null);
    setError("");
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
    setError(cause instanceof Error ? cause.message : fallback);
  }, [signOut]);

  const handleReviewAuthError = useCallback((cause: unknown) => {
    handleApiError(cause, "Replica qualification controls could not be loaded");
  }, [handleApiError]);

  const loadReplicas = useCallback(async (activeSession: StudioSession) => {
    setLoadState("loading");
    setError("");
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
    if (!session || !selectedId) {
      setConsents([]);
      setSources([]);
      setChallenge(null);
      return;
    }
    let live = true;
    const replicaId = selectedId;
    setEnrollmentLoading(true);
    setLivenessLoading(true);
    void (async () => {
      try {
        const fresh = await refreshForRequest(session);
        const [consentResult, sourceResult, challengeResult] = await Promise.allSettled([
          listEnrollmentConsent(fresh.accessToken, replicaId),
          listSources(fresh.accessToken, replicaId),
          livenessStatus(fresh.accessToken, replicaId),
        ]);
        if (!live) return;
        if (consentResult.status === "fulfilled") setConsents(consentResult.value);
        if (sourceResult.status === "fulfilled") setSources(sourceResult.value);
        if (challengeResult.status === "fulfilled") setChallenge(challengeResult.value);
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
  }, [handleApiError, refreshForRequest, selectedId, session]);

  async function selectReplica(id: string) {
    if (!session) return;
    setLoadState("loading");
    setShowCreate(false);
    setError("");
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
    setError("");
    try {
      const fresh = await refreshForRequest(session);
      const replica = await createReplica(fresh.accessToken, name);
      setReplicas((items) => [replica, ...items]);
      setSelected(replica);
      setShowCreate(false);
      setNotice("Private workspace created. Enrollment remains locked until verification services are ready.");
    } catch (cause) {
      handleApiError(cause, "Could not create your workspace");
    } finally {
      setCreating(false);
    }
  }

  async function handleRevoke() {
    if (!session || !selected) return;
    setRevoking(true);
    setError("");
    try {
      const fresh = await refreshForRequest(session);
      const result = await revokeReplica(fresh.accessToken, selected.replica_id);
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

  async function handleCreateUpload(input: {
    kind: SourceKind;
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

  async function handleIssueChallenge() {
    if (!session || !selected) throw new Error("Your session is no longer available");
    try {
      const fresh = await refreshForRequest(session);
      const issued = await issueLivenessChallenge(fresh.accessToken, selected.replica_id);
      setChallenge(issued);
      return issued;
    } catch (cause) {
      handleApiError(cause, "Could not issue a live phrase");
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

  if (!authChecked) {
    return (
      <main className="boot-page">
        <Mark />
        <Spinner label="Opening private studio" />
        <p>Opening your private studio</p>
      </main>
    );
  }

  if (!session) return <AuthGate onAuthed={(next) => { setSession(next); void loadReplicas(next); }} />;

  return (
    <div className="studio-shell">
      <header className="studio-header">
        <a className="studio-logo" href="/" aria-label="Vyakti home">
          <Mark />
          <span><strong>VYAKTI</strong><small>REPLICA STUDIO</small></span>
        </a>
        <div className="header-trust"><span className="secure-dot" />Private self-replica workspace</div>
        <div className="account-menu">
          <span className="account-copy"><strong>{identity}</strong><small>Verified account session</small></span>
          <button className="signout-button" type="button" onClick={signOut}>Sign out</button>
        </div>
      </header>

      <div className="studio-layout">
        <ReplicaList
          replicas={replicas}
          selectedId={selected?.replica_id ?? null}
          onSelect={(id) => void selectReplica(id)}
          onNew={() => setShowCreate(true)}
        />

        <main className="studio-main">
          {notice && (
            <div className="notice" role="status">
              <span>✓</span>{notice}
              <button type="button" aria-label="Dismiss message" onClick={() => setNotice("")}>×</button>
            </div>
          )}
          {error && (
            <div className="error-banner" role="alert">
              <span>!</span><div><strong>Something needs attention</strong><p>{error}</p></div>
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
            <CreateReplicaCard onCreate={(name) => void handleCreate(name)} busy={creating} />
          ) : selected ? (
            <ReplicaWorkspace
              replica={selected}
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
              onCreateLivenessUpload={handleCreateLivenessUpload}
              onFinalizeLiveness={handleFinalizeLiveness}
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
