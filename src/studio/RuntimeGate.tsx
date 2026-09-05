import { useCallback, useEffect, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { activateRuntime, readRuntimeStatus } from "./runtimeApi";
import type { ReplicaRuntimeStatus } from "./types";
import { useStudioLocale } from "./localeContext";
import { withCount } from "./copy";

export default function RuntimeGate({
  token,
  replicaId,
  stopped,
  onAuthError,
  onStatusChange,
}: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onStatusChange?: (runtime: ReplicaRuntimeStatus) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.runtimeGate;
  const [runtime, setRuntime] = useState<ReplicaRuntimeStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const next = await readRuntimeStatus(token, replicaId);
      setRuntime(next);
      onStatusChange?.(next);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.readinessUnavailable);
    } finally {
      setLoading(false);
    }
  }, [onAuthError, onStatusChange, replicaId, token, c.readinessUnavailable]);

  useEffect(() => { void load(); }, [load]);

  async function activate() {
    setActivating(true);
    setError("");
    try {
      const next = await activateRuntime(token, replicaId);
      setRuntime(next);
      onStatusChange?.(next);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : c.activationRefused);
      await load();
    } finally {
      setActivating(false);
    }
  }

  const blockers = runtime?.blockers ?? [];
  return (
    <section id="runtime-gate" className="runtime-gate" aria-labelledby="runtime-gate-title">
      <div className="runtime-gate-head">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="runtime-gate-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
        <div className={`runtime-seal ${runtime?.active ? "active" : ""}`}>
          <span>{runtime?.active ? c.sealActive : c.sealSealed}</span>
          <small>{runtime?.active ? c.sealSubActive : c.sealSubSealed}</small>
        </div>
      </div>

      {loading ? (
        <div className="runtime-loading" role="status">{c.checkingGates}</div>
      ) : error ? (
        <div className="runtime-error" role="alert">
          <span>{error}</span><button type="button" onClick={() => void load()}>{c.retry}</button>
        </div>
      ) : runtime ? (
        <>
          <div className="runtime-score">
            <div><strong>{runtime.qualification.passed}/{runtime.qualification.required}</strong><span>{c.qualificationSuitesPassed}</span></div>
            <div><strong>{runtime.versions.profile ?? "\u2014"}</strong><span>{c.whatWeLearnedVersion}</span></div>
            <div><strong>{runtime.versions.calibration ?? "\u2014"}</strong><span>{c.calibrationVersion}</span></div>
            <div><strong>{runtime.versions.voice_genome ?? "\u2014"}</strong><span>{c.voiceVersion}</span></div>
          </div>
          {blockers.length > 0 && (
            <div className="runtime-blockers">
              <strong>{withCount(blockers.length === 1 ? c.gatesClosedOne : c.gatesClosedMany, blockers.length)}</strong>
              <ul>{blockers.map((blocker) => <li key={blocker}><span />{c.labels[blocker as keyof typeof c.labels] ?? blocker.replaceAll("_", " ")}</li>)}</ul>
            </div>
          )}
          <div className="runtime-action">
            <p>{c.actionNote}</p>
            <button
              className="button primary-button"
              type="button"
              disabled={stopped || runtime.active || !runtime.can_activate || activating}
              onClick={() => void activate()}
            >
              {activating ? c.freezing : runtime.active ? c.runtimeActive : c.activateButton}
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
