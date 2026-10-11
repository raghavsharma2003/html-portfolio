import { replicaRequest } from "./replicaApi";
import type { CalibrationChoice, CalibrationPreference, CalibrationStatus, CalibrationVersion } from "./types";

export async function readCalibration(token: string, replicaId: string): Promise<CalibrationStatus> {
  const data = await replicaRequest<{ calibration: CalibrationStatus }>(token, `/api/replica-calibration?replica_id=${encodeURIComponent(replicaId)}`);
  return data.calibration;
}
export async function chooseCalibration(
  token: string,
  replicaId: string,
  scenarioId: string,
  choice: CalibrationChoice,
  confidence = 1,
): Promise<CalibrationPreference> {
  const data = await replicaRequest<{ preference: CalibrationPreference }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "choose", replica_id: replicaId, scenario_id: scenarioId, choice, confidence }),
  });
  return data.preference;
}

export async function buildCalibration(token: string, replicaId: string): Promise<CalibrationVersion> {
  const data = await replicaRequest<{ calibration: CalibrationVersion }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "build", replica_id: replicaId }),
  });
  return data.calibration;
}

export async function approveCalibration(token: string, replicaId: string, version: number): Promise<CalibrationVersion> {
  const data = await replicaRequest<{ calibration: CalibrationVersion }>(token, "/api/replica-calibration", {
    method: "POST",
    body: JSON.stringify({ op: "approve", replica_id: replicaId, version }),
  });
  return data.calibration;
}
