import { ReplicaApiError, replicaRequest } from "./replicaApi";
import type { CandidateEvalChoice, CandidateEvalDimension, CandidateEvaluation } from "./types";

export async function getCandidateEvaluation(token: string, replicaId: string, candidateId?: string, signal?: AbortSignal): Promise<CandidateEvaluation> {
  const data = await replicaRequest<{ evaluation: CandidateEvaluation }>(token, "/api/replica-candidate-eval", {
    method: "POST",
    signal,
    body: JSON.stringify({ op: "status", replica_id: replicaId, ...(candidateId ? { candidate_id: candidateId } : {}) }),
  });
  return data.evaluation;
}

export async function judgeCandidateAssignment(
  token: string,
  replicaId: string,
  assignmentId: string,
  assignmentHash: string,
  ratings: Record<CandidateEvalDimension, CandidateEvalChoice>,
  signal?: AbortSignal,
): Promise<{ accepted: true; progress: { completed: number; total: number }; complete: boolean }> {
  const data = await replicaRequest<{ result: { accepted: true; progress: { completed: number; total: number }; complete: boolean } }>(
    token,
    "/api/replica-candidate-eval",
    {
      method: "POST",
      signal,
      body: JSON.stringify({
        op: "judge",
        replica_id: replicaId,
        assignment_id: assignmentId,
        assignment_hash: assignmentHash,
        ratings,
      }),
    },
  );
  return data.result;
}

export type CandidateQualification = {
  available: boolean; verdict?: 'pass' | 'fail' | 'inconclusive'; qualification_id?: string;
  active_changed: false; checks?: { failures: string[]; inconclusive: string[] };
};
export function parseCandidateQualification(value: unknown): CandidateQualification {
  const result = value as CandidateQualification;
  const strings = (list: unknown): list is string[] => Array.isArray(list) && list.length <= 100
    && list.every(item => typeof item === 'string' && item.length <= 500);
  if (!result || typeof result.available !== 'boolean' || result.active_changed !== false
    || (result.verdict !== undefined && !['pass', 'fail', 'inconclusive'].includes(result.verdict))
    || (result.available && (!result.verdict || typeof result.qualification_id !== 'string' || !result.checks))
    || (!result.available && (result.verdict !== undefined || result.qualification_id !== undefined || result.checks !== undefined))
    || (result.qualification_id !== undefined && !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(result.qualification_id))
    || (result.checks !== undefined && (!result.checks || !strings(result.checks.failures) || !strings(result.checks.inconclusive)))
    || (result.verdict === 'pass' && (!result.checks || result.checks.failures.length > 0 || result.checks.inconclusive.length > 0))) {
    throw new ReplicaApiError('Result status could not be verified', 502, {});
  }
  return result;
}
export async function requestCandidateQualification(token: string, replicaId: string, candidateId: string,
  op: 'qualification_status' | 'qualify', signal: AbortSignal): Promise<CandidateQualification> {
  const response = await replicaRequest<{ qualification: unknown }>(token, '/api/replica-candidate-eval', {
    method: 'POST', signal, body: JSON.stringify({ op, replica_id: replicaId, candidate_id: candidateId }),
  });
  return parseCandidateQualification(response.qualification);
}
