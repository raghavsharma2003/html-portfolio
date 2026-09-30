import { ReplicaApiError, replicaRequest } from './replicaApi';

export type MaterializeScope = { replicaId: string; datasetId: string; candidateId: string; sourceSetHash: string };
export type MaterializeJob = {
  job_id: string; replica_id: string; dataset_id: string; candidate_id: string;
  state: 'preparing' | 'ready' | 'held' | 'failed';
  completed: number; total: number; active_changed: false; can_advance: boolean;
};
export function parseMaterializeJob(value: unknown, scope: MaterializeScope): MaterializeJob | null {
  if (value === null) return null;
  const job = value as MaterializeJob;
  if (!job || typeof job.job_id !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(job.job_id)
    || job.replica_id !== scope.replicaId || job.dataset_id !== scope.datasetId || job.candidate_id !== scope.candidateId
    || !['preparing', 'ready', 'held', 'failed'].includes(job.state) || job.active_changed !== false
    || !Number.isSafeInteger(job.completed) || !Number.isSafeInteger(job.total) || job.completed < 0
    || job.total < 60 || job.total > 200 || job.total % 2 !== 0 || job.completed > job.total
    || typeof job.can_advance !== 'boolean' || (job.can_advance && job.state !== 'preparing')
    || (job.state === 'ready' && job.completed !== job.total)) {
    throw new ReplicaApiError('Comparison status could not be verified', 502, {});
  }
  return job;
}
export async function requestMaterialization(token: string, scope: MaterializeScope, op: 'status' | 'start' | 'advance', signal: AbortSignal) {
  const result = await replicaRequest<{ job: unknown }>(token, '/api/replica-candidate-materialize', {
    method: 'POST', signal,
    body: JSON.stringify({ op, replica_id: scope.replicaId, dataset_id: scope.datasetId,
      candidate_id: scope.candidateId, expected_source_set_hash: scope.sourceSetHash }),
  });
  return parseMaterializeJob(result.job, scope);
}
