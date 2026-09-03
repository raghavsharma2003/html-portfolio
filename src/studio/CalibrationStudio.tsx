import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { approveCalibration, buildCalibration, chooseCalibration, readCalibration } from "./calibrationApi";
import type { CalibrationChoice, CalibrationScenario, CalibrationStatus } from "./types";

const LAYERS: Record<string, string> = {
  delivery: "Delivery",
  language: "Language",
  behaviour: "Behavior",
  memory: "Memory",
  relationship: "Relationship",
};

const BLOCKERS: Record<string, string> = {
  approved_person_profile_required: "Approve what we learned about you first",
  delivery_calibration_required: "Choose at least one delivery contrast",
  language_calibration_required: "Choose at least one language contrast",
  behaviour_calibration_required: "Choose at least one behavior contrast",
  memory_calibration_required: "Choose at least one memory contrast",
  relationship_calibration_required: "Choose at least one relationship contrast",
  calibration_depth_required: "Resolve at least seven contrasts",
};

function Option({
  side,
  scenario,
  selected,
  busy,
  choose,
}: {
  side: "left" | "right";
  scenario: CalibrationScenario;
  selected: boolean;
  busy: boolean;
  choose: (choice: CalibrationChoice) => void;
}) {
  const option = scenario[side];
  return (
    <button
      className={`calibration-option ${selected ? "selected" : ""}`}
      type="button"
      aria-pressed={selected}
      disabled={busy}
      onClick={() => choose(side)}
    >
      <span>{side === "left" ? "A" : "B"}</span>
      <strong>{option.label}</strong>
      <small>{option.description}</small>
    </button>
  );
}
export default function CalibrationStudio({ token, replicaId, onAuthError }: { token: string; replicaId: string; onAuthError: (cause: unknown) => void }) {
  const [status, setStatus] = useState<CalibrationStatus | null>(null);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setStatus(await readCalibration(token, replicaId));
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Calibration could not be loaded");
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token]);

  useEffect(() => { void load(); }, [load]);

  const scenarios = status?.scenarios ?? [];
  const current = scenarios[active] ?? null;
  const draft = useMemo(() => status?.versions.find((version) => version.status === "draft") ?? null, [status]);
  const approved = useMemo(() => status?.versions.find((version) => version.status === "approved") ?? null, [status]);

  async function choose(choice: CalibrationChoice) {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      await chooseCalibration(token, replicaId, current.scenario_id, choice);
      const next = await readCalibration(token, replicaId);
      setStatus(next);
      const nextUnanswered = next.scenarios.findIndex((scenario, index) => index > active && !scenario.preference);
      if (nextUnanswered >= 0) setActive(nextUnanswered);
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Your calibration choice was not saved");
    } finally {
      setBusy(false);
    }
  }

  async function build() {
    setBusy(true);
    setError("");
    try {
      await buildCalibration(token, replicaId);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Calibration build was refused");
    } finally {
      setBusy(false);
    }
  }

  async function approve(version: number) {
    setBusy(true);
    setError("");
    try {
      await approveCalibration(token, replicaId, version);
      await load();
    } catch (cause) {
      if (cause instanceof ReplicaApiError && cause.status === 401) return onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "Calibration changed and could not be approved");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="calibration-studio" className="calibration-studio" aria-labelledby="calibration-title">
      <div className="calibration-head">
        <div>
          <p className="eyebrow">Behavior calibration</p>
          <h2 id="calibration-title">Show it how you would actually answer</h2>
          <p>Choose between safe behavioral contrasts. Every correction becomes versioned preference evidence, never another sentence glued onto a persona prompt.</p>
        </div>
        <div className="calibration-version"><strong>{approved ? `v${approved.version}` : "\u2014"}</strong><span>approved policy</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">Preparing calibration contrasts…</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Retry</button></div>
      ) : status && current ? (
        <>
          <div className="calibration-progress" aria-label={`${status.readiness.reviewed} of ${scenarios.length} contrasts reviewed`}>
            <span style={{ transform: `scaleX(${scenarios.length ? status.readiness.reviewed / scenarios.length : 0})` }} />
          </div>
          <div className="calibration-nav">
            <div><strong>{status.readiness.reviewed}/{scenarios.length}</strong><span>contrasts reviewed</span></div>
            <div className="calibration-dots" aria-label="Calibration scenarios">
              {scenarios.map((scenario, index) => (
                <button
                  key={scenario.scenario_id}
                  type="button"
                  className={`${index === active ? "active" : ""} ${scenario.preference ? "answered" : ""}`}
                  aria-label={`Open ${LAYERS[scenario.layer] ?? scenario.layer} contrast ${index + 1}`}
                  aria-current={index === active ? "step" : undefined}
                  onClick={() => setActive(index)}
                />
              ))}
            </div>
          </div>
          <article className="calibration-card">
            <div className="calibration-card-meta"><span>{LAYERS[current.layer] ?? current.layer}</span><span>{current.axis.replaceAll("_", " ")}</span></div>
            <h3>{current.context}</h3>
            <div className="calibration-options">
              <Option side="left" scenario={current} selected={current.preference?.choice === "left"} busy={busy} choose={(choice) => void choose(choice)} />
              <div className="calibration-or">or</div>
              <Option side="right" scenario={current} selected={current.preference?.choice === "right"} busy={busy} choose={(choice) => void choose(choice)} />
            </div>
            <div className="calibration-neutral">
              <button type="button" aria-pressed={current.preference?.choice === "tie"} disabled={busy} onClick={() => void choose("tie")}>Both feel like me</button>
              <button type="button" aria-pressed={current.preference?.choice === "neither"} disabled={busy} onClick={() => void choose("neither")}>Neither is me</button>
            </div>
          </article>
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers calibration-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{BLOCKERS[blocker] ?? blocker.replaceAll("_", " ")}</li>)}
            </ul>
          )}
          <div className="calibration-action">
            <p>Free-text notes are never compiled into behavior. Only reviewed, server-owned strategies can enter a frozen runtime capability.</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={busy || !status.readiness.ready} onClick={() => void approve(draft.version)}>{busy ? "Checking choices…" : `Approve calibration v${draft.version}`}</button>
            ) : (
              <button className="button primary-button" type="button" disabled={busy || !status.readiness.ready} onClick={() => void build()}>{busy ? "Building policy…" : "Build calibration policy"}</button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
