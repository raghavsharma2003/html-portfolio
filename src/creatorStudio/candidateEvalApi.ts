import { replicaRequest } from "./replicaApi";
import type { CandidateEvalChoice, CandidateEvalDimension, CandidateEvaluation } from "./types";

export async function getCandidateEvaluation(token: string, replicaId: string): Promise<CandidateEvaluation> {
  const data = await replicaRequest<{ evaluation: CandidateEvaluation }>(token, "/api/replica-candidate-eval", {
    method: "POST",
    body: JSON.stringify({ op: "status", replica_id: replicaId }),
  });
  return data.evaluation;
}

export async function judgeCandidateAssignment(
  token: string,
  replicaId: string,
  assignmentId: string,
  assignmentHash: string,
  ratings: Record<CandidateEvalDimension, CandidateEvalChoice>,
): Promise<{ accepted: true; progress: { completed: number; total: number }; complete: boolean }> {
  const data = await replicaRequest<{ result: { accepted: true; progress: { completed: number; total: number }; complete: boolean } }>(
    token,
    "/api/replica-candidate-eval",
    {
      method: "POST",
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
