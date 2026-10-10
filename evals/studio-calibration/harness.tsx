import { createRoot } from "react-dom/client";
import CalibrationStudio from "../../src/studio/CalibrationStudio";
import "../../src/studio/studio.css";
import type { CalibrationChoice, CalibrationScenario, CalibrationStatus } from "../../src/studio/types";

const replicaId = "10000000-0000-4000-8000-000000000001";
const specs = [
  ["delivery.turn_shape", "delivery", "turn shape"],
  ["delivery.energy_match", "delivery", "energy matching"],
  ["language.code_switch", "language", "code switching"],
  ["language.idiom_density", "language", "idiom density"],
  ["behaviour.support_entry", "behaviour", "support entry"],
  ["behaviour.disagreement", "behaviour", "disagreement"],
  ["behaviour.repair", "behaviour", "repair"],
  ["memory.uncertainty", "memory", "uncertainty response"],
  ["relationship.affection", "relationship", "affection expression"],
  ["relationship.tension_pacing", "relationship", "tension pacing"],
] as const;

const scenarios: CalibrationScenario[] = specs.map(([scenarioId, layer, axis], index) => ({
  scenario_id: scenarioId,
  revision: 1,
  layer,
  axis,
  context: index === 0 ? "When someone shares an ordinary update, which response shape feels more like you?" : `Which ${axis} pattern feels more like you?`,
  left: { id: `${scenarioId}.a`, label: "Quietly specific", description: "A restrained, specific response with room to continue." },
  right: { id: `${scenarioId}.b`, label: "Warmly reflective", description: "A warmer response that connects context before continuing." },
  preference: null,
}));

let versions: CalibrationStatus["versions"] = [];

function status(): CalibrationStatus {
  const reviewed = scenarios.filter((scenario) => scenario.preference).length;
  const resolved = scenarios.filter((scenario) => scenario.preference?.choice !== "neither" && scenario.preference).length;
  const covered = new Set(scenarios.filter((scenario) => scenario.preference?.choice !== "neither" && scenario.preference).map((scenario) => scenario.layer));
  const blockers = ["delivery", "language", "behaviour", "memory", "relationship"]
    .filter((layer) => !covered.has(layer as CalibrationScenario["layer"]))
    .map((layer) => `${layer}_calibration_required`);
  if (resolved < 7) blockers.push("calibration_depth_required");
  return {
    replica_id: replicaId,
    profile_version: 7,
    scenarios: structuredClone(scenarios),
    readiness: { ready: blockers.length === 0, blockers, reviewed, resolved, required: 7, covered_layers: [...covered] },
    versions: structuredClone(versions),
  };
}

globalThis.fetch = async (_input, init) => {
  const body = init?.body ? JSON.parse(String(init.body)) : null;
  if (body?.op === "choose") {
    const scenario = scenarios.find((item) => item.scenario_id === body.scenario_id);
    if (!scenario) return Response.json({ error: "unknown_calibration_scenario" }, { status: 400 });
    scenario.preference = {
      preference_id: crypto.randomUUID(),
      scenario_id: scenario.scenario_id,
      scenario_revision: 1,
      layer: scenario.layer,
      choice: body.choice as CalibrationChoice,
      confidence: 1,
      revision: (scenario.preference?.revision ?? 0) + 1,
      created_at: new Date().toISOString(),
    };
    return Response.json({ preference: scenario.preference });
  }
  if (body?.op === "build") {
    versions = [{ replica_id: replicaId, version: 1, profile_version: 7, status: "draft", created_at: new Date().toISOString() }];
    return Response.json({ calibration: versions[0] }, { status: 201 });
  }
  if (body?.op === "approve") {
    versions = [{ ...versions[0], status: "approved" }];
    return Response.json({ calibration: versions[0] });
  }
  return Response.json({ calibration: status() });
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <CalibrationStudio token="offline-owner-token" replicaId={replicaId} onAuthError={() => undefined} />
  </main></div>,
);
