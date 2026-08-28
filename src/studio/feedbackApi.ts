import { replicaRequest } from "./replicaApi";
import type { ReplicaTurnFeedback, TurnFeedbackRating } from "./types";

export async function saveTurnFeedback(
  token: string,
  replicaId: string,
  turnId: string,
  ratings: Record<string, TurnFeedbackRating>,
  reasonCodes: string[],
  correction: string,
): Promise<ReplicaTurnFeedback> {
  const data = await replicaRequest<{ feedback: ReplicaTurnFeedback }>(token, "/api/replica-feedback", {
    method: "POST",
    body: JSON.stringify({
      replica_id: replicaId,
      turn_id: turnId,
      ratings,
      reason_codes: reasonCodes,
      ...(correction.trim() ? { correction: correction.trim() } : {}),
    }),
  });
  return data.feedback;
}

