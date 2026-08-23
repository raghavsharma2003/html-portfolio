import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { activateRuntime, readRuntimeStatus } from "./runtimeApi";
import type { ReplicaRuntimeStatus } from "./types";

const LABELS: Record<string, string> = {
  self_replica_only: "Self-replica policy",
  replica_not_ready: "Approved voice and behavior models",
  self_identity_not_bound: "Verified account-to-person binding",
  adult_verification_required: "Living-adult verification",
  identity_verification_required: "Identity verification",
  liveness_verification_required: "Live anti-replay check",
  inference_consent_required: "Inference permission",
  person_profile_not_approved: "Approved person model",
  calibration_not_approved: "Approved behavior calibration",
  voice_genome_not_approved: "Approved VoiceGenome",
  voice_not_ready: "Production voice mapping",
  production_voice_required: "Non-test voice provider",
  qualification_incomplete: "Seven-suite qualification",
};

export default function RuntimeGate({
  token,
  replicaId,
  stopped,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
}) {
  const [runtime, setRuntime] = useState<ReplicaRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setRuntime(await readRuntimeStatus(token, replicaId));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Runtime readiness is unavailable");
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);

  async function activate() {
    setActivating(true);
    setError("");
    try {
      setRuntime(await activateRuntime(token, replicaId));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Runtime activation was refused");
      await load();
    } finally {
      setActivating(false);
    }
  }

  const blockers = runtime?.blockers ?? [];
  return (
    <section className="runtime-gate" aria-labelledby="runtime-gate-title">
      <div className="runtime-gate-head">
        <div>
          <p className="eyebrow">09 · Private runtime</p>
          <h2 id="runtime-gate-title">One qualified identity, frozen at launch.</h2>
          <p>
            Launch binds the exact person model, VoiceGenome, provider voice, relationship namespace,
            and evaluation set. New drafts cannot silently change an active replica.
          </p>
        </div>
        <div className={`runtime-seal ${runtime?.active ? "active" : ""}`}>
          <span>{runtime?.active ? "ACTIVE" : "SEALED"}</span>
          <small>{runtime?.active ? "Private use only" : "No generation access"}</small>
        </div>
      </div>

      {loading ? (
        <div className="runtime-loading" role="status">Checking every launch gate…</div>
      ) : error ? (
        <div className="runtime-error" role="alert">
          <span>{error}</span><button type="button" onClick={() => void load()}>Retry</button>
        </div>
      ) : runtime ? (
        <>
          <div className="runtime-score">
            <div><strong>{runtime.qualification.passed}/{runtime.qualification.required}</strong><span>qualification suites passed</span></div>
            <div><strong>{runtime.versions.profile ?? "—"}</strong><span>person model version</span></div>
            <div><strong>{runtime.versions.calibration ?? "—"}</strong><span>calibration version</span></div>
            <div><strong>{runtime.versions.voice_genome ?? "—"}</strong><span>VoiceGenome version</span></div>
          </div>
          {blockers.length > 0 && (
            <div className="runtime-blockers">
              <strong>{blockers.length} launch gate{blockers.length === 1 ? "" : "s"} still closed</strong>
              <ul>{blockers.map((blocker) => <li key={blocker}><span />{LABELS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}</ul>
            </div>
          )}
          <div className="runtime-action">
            <p>Replica calls use protected cascade speech only. There is no fallback to Meera, another cloud voice, or device TTS.</p>
            <button
              className="button primary-button"
              type="button"
              disabled={stopped || runtime.active || !runtime.can_activate || activating}
              onClick={() => void activate()}
            >
              {activating ? "Freezing capability…" : runtime.active ? "Runtime active" : "Activate private runtime"}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
