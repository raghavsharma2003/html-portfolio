const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * An emergency processing run may name one already reviewed source.  The
 * scope is deliberately all-or-nothing: a partial tenant identity would turn
 * a bounded repair into an accidental queue sweep.
 */
export function assertProcessingSourceScope(value) {
  if (value == null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("processing_source_scope_invalid");
  const keys = Object.keys(value).sort();
  const publicShape = keys.join(",") === "owner_user_id,replica_id,source_id";
  const internalShape = keys.join(",") === "ownerUserId,replicaId,sourceId";
  if (keys.length !== 3 || (!publicShape && !internalShape)) {
    throw new Error("processing_source_scope_invalid");
  }
  const scope = {
    ownerUserId: String(publicShape ? value.owner_user_id : value.ownerUserId || ""),
    replicaId: String(publicShape ? value.replica_id : value.replicaId || ""),
    sourceId: String(publicShape ? value.source_id : value.sourceId || ""),
  };
  if (!UUID.test(scope.ownerUserId) || !UUID.test(scope.replicaId) || !UUID.test(scope.sourceId)) {
    throw new Error("processing_source_scope_invalid");
  }
  return Object.freeze(scope);
}

export function processingSourceScopeFromEnv(env = process.env) {
  const raw = env.REPLICA_PROCESSING_SOURCE_SCOPE_JSON;
  if (raw == null || raw === "") return null;
  if (typeof raw !== "string") throw new Error("processing_source_scope_invalid");
  try {
    return assertProcessingSourceScope(JSON.parse(raw));
  } catch (error) {
    if (error?.message === "processing_source_scope_invalid") throw error;
    throw new Error("processing_source_scope_invalid");
  }
}

export function sourceScopeParams(scope) {
  if (!scope) return [];
  const checked = assertProcessingSourceScope(scope);
  return [checked.ownerUserId, checked.replicaId, checked.sourceId];
}
