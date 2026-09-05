import { useCallback, useEffect, useMemo, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import { approveCalibration, buildCalibration, chooseCalibration, readCalibration } from "./calibrationApi";
import type { CalibrationChoice, CalibrationScenario, CalibrationStatus } from "./types";
import { useStudioLocale } from "./localeContext";

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
  const { t } = useStudioLocale();
  const c = t.calibrationStudio;
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
      setError(cause instanceof Error ? cause.message : c.errorCouldNotLoad);
    } finally {
      setLoading(false);
    }
  }, [onAuthError, replicaId, token, c.errorCouldNotLoad]);

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
      setError(cause instanceof Error ? cause.message : c.errorChoiceNotSaved);
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
      setError(cause instanceof Error ? cause.message : c.errorBuildRefused);
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
      setError(cause instanceof Error ? cause.message : c.errorApproveChanged);
    } finally {
      setBusy(false);
    }
  }

  const layerLabel = (layer: string): string => c.layers[layer as keyof typeof c.layers] ?? layer;
  const blockerLabel = (blocker: string): string => c.blockers[blocker as keyof typeof c.blockers] ?? blocker.replaceAll("_", " ");

  return (
    <section id="calibration-studio" className="calibration-studio" aria-labelledby="calibration-title">
      <div className="calibration-head">
        <div>
          <p className="eyebrow">{c.eyebrow}</p>
          <h2 id="calibration-title">{c.title}</h2>
          <p>{c.intro}</p>
        </div>
        <div className="calibration-version"><strong>{approved ? `v${approved.version}` : "\u2014"}</strong><span>{c.approvedPolicyLabel}</span></div>
      </div>

      {loading ? <div className="runtime-loading" role="status">{c.preparingContrasts}</div> : error ? (
        <div className="runtime-error" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>{c.retry}</button></div>
      ) : status && current ? (
        <>
          <div
            className="calibration-progress"
            aria-label={c.contrastsReviewedAriaLabel
              .split("{n}")
              .join(String(status.readiness.reviewed))
              .split("{n2}")
              .join(String(scenarios.length))}
          >
            <span style={{ transform: `scaleX(${scenarios.length ? status.readiness.reviewed / scenarios.length : 0})` }} />
          </div>
          <div className="calibration-nav">
            <div><strong>{status.readiness.reviewed}/{scenarios.length}</strong><span>{c.contrastsReviewed}</span></div>
            <div className="calibration-dots" aria-label={c.calibrationScenariosAriaLabel}>
              {scenarios.map((scenario, index) => (
                <button
                  key={scenario.scenario_id}
                  type="button"
                  className={`${index === active ? "active" : ""} ${scenario.preference ? "answered" : ""}`}
                  aria-label={c.openContrastAriaLabel
                    .split("{label}")
                    .join(layerLabel(scenario.layer))
                    .split("{n}")
                    .join(String(index + 1))}
                  aria-current={index === active ? "step" : undefined}
                  onClick={() => setActive(index)}
                />
              ))}
            </div>
          </div>
          <article className="calibration-card">
            <div className="calibration-card-meta"><span>{layerLabel(current.layer)}</span><span>{current.axis.replaceAll("_", " ")}</span></div>
            <h3>{current.context}</h3>
            <div className="calibration-options">
              <Option side="left" scenario={current} selected={current.preference?.choice === "left"} busy={busy} choose={(choice) => void choose(choice)} />
              <div className="calibration-or">{c.orWord}</div>
              <Option side="right" scenario={current} selected={current.preference?.choice === "right"} busy={busy} choose={(choice) => void choose(choice)} />
            </div>
            <div className="calibration-neutral">
              <button type="button" aria-pressed={current.preference?.choice === "tie"} disabled={busy} onClick={() => void choose("tie")}>{c.bothFeelLikeMe}</button>
              <button type="button" aria-pressed={current.preference?.choice === "neither"} disabled={busy} onClick={() => void choose("neither")}>{c.neitherIsMe}</button>
            </div>
          </article>
          {status.readiness.blockers.length > 0 && (
            <ul className="model-blockers calibration-blockers">
              {status.readiness.blockers.map((blocker) => <li key={blocker}><span />{blockerLabel(blocker)}</li>)}
            </ul>
          )}
          <div className="calibration-action">
            <p>{c.freeTextNote}</p>
            {draft ? (
              <button className="button primary-button" type="button" disabled={busy || !status.readiness.ready} onClick={() => void approve(draft.version)}>{busy ? c.checkingChoices : c.approveCalibrationVersion.split("{n}").join(String(draft.version))}</button>
            ) : (
              <button className="button primary-button" type="button" disabled={busy || !status.readiness.ready} onClick={() => void build()}>{busy ? c.buildingPolicy : c.buildCalibrationPolicy}</button>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
