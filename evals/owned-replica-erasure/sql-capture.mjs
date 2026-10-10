// Offline capture only. Root must EXPLAIN these exact SQL/parameter shapes
// against PostgreSQL; this file neither opens a connection nor proves parsing.
import { pathToFileURL } from 'node:url';
import { prepareReplicaErasures, leaseNextReplicaErasure, renewReplicaErasureLease,
  confirmReplicaChannelStorageErasure, retryReplicaErasure, completeReplicaErasure,
  createReplicaErasureReceipt, getReplicaErasureStatus } from '../../api/_replica-full-erasure.js';
import { leaseNextSourceErasure, renewSourceErasureLease, completeSourceErasure,
  retrySourceErasure } from '../../api/_replica-source-erasure.js';
import { cleanupReplicaChannelExtractionStorage } from '../../api/_channel/extraction-storage.js';
import { OWNED_REPLICA_ERASURE_JOB_SQL } from '../../api/_replica-owned-erasure.js';

export async function captureOwnedErasureSql() {
  const scope = { jobId: '10000000-0000-4000-8000-000000000001',
    replicaId: '20000000-0000-4000-8000-000000000002', ownerUserId: '30000000-0000-4000-8000-000000000003' };
  const sourceId = '40000000-0000-4000-8000-000000000004';
  const token = 'synthetic-erasure-capture-token-at-least-thirty-two-bytes';
  const env = { REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 91).toString('base64'), REPLICA_BACKUP_RETENTION_DAYS: '30' };
  const entries = [{ name: 'owned-job', sql: OWNED_REPLICA_ERASURE_JOB_SQL, params: [scope.jobId, scope.ownerUserId] }];
  let name;
  let present = true;
  const db = async (sql, params = []) => {
    if (sql.includes("to_regclass('public.vy_private_voice_run')")) return [{ private_voice_present: present }];
    entries.push({ name, sql, params });
    return [{ source_id: sourceId, replica_id: scope.replicaId, owner_user_id: scope.ownerUserId,
      job_id: scope.jobId, attempts: 1, erasure_attempts: 1,
      storage_bucket: 'azureblob:vyaktireplicatest:replica-private',
      object_path: `${scope.ownerUserId}/${scope.replicaId}/${sourceId}/original`, artifacts: [] }];
  };
  name = 'owned-prepare'; await prepareReplicaErasures(db, { scope, limit: 1 });
  for (const exists of [true, false]) {
    present = exists;
    name = `owned-source-lease-private-${exists}`;
    const source = await leaseNextSourceErasure(db, { scope, token });
    name = `owned-source-renew-private-${exists}`; await renewSourceErasureLease(db, source);
    name = `owned-source-complete-private-${exists}`; await completeSourceErasure(db, source);
    name = 'owned-source-retry'; await retrySourceErasure(db, source, { failureCode: 'storage_failure' });
  }
  present = true;
  name = 'owned-replica-lease'; const lease = await leaseNextReplicaErasure(db, { scope, token });
  name = 'owned-replica-renew'; await renewReplicaErasureLease(db, lease);
  name = 'owned-replica-storage-confirm'; await confirmReplicaChannelStorageErasure(db, lease);
  name = 'owned-replica-retry'; await retryReplicaErasure(db, lease, { failureCode: 'storage_failure' });
  name = 'owned-replica-complete'; await completeReplicaErasure(db, lease,
    createReplicaErasureReceipt(scope.replicaId, scope.ownerUserId, env, { erasureRequestId: scope.jobId, nonce: 'a'.repeat(64), nowMs: 0 }));
  name = 'owned-status'; await getReplicaErasureStatus(db, scope.ownerUserId, scope.jobId, env);
  name = 'owned-channel-storage'; await cleanupReplicaChannelExtractionStorage(async (sql, params) => {
    entries.push({ name, sql, params });
    if (sql.startsWith('select j.job_id')) return [{ job_id: scope.jobId }];
    return [];
  }, lease, { deletePrefix: async () => ({ confirmed: true }) });
  return [...new Map(entries.map((entry) => [entry.sql + JSON.stringify(entry.params), entry])).values()];
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  console.log(JSON.stringify(await captureOwnedErasureSql()));
}
