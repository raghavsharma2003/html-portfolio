const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Undefined is the existing operator sweep. An explicitly supplied invalid
// scope must never widen an owner's operation into that sweep.
export function erasureScope(input) {
  if (input === undefined) return null;
  const scope = Object.fromEntries(["jobId", "replicaId", "ownerUserId"].map((key) =>
    [key, String(input?.[key] || "").toLowerCase()]));
  if (!Object.values(scope).every((value) => UUID.test(value))) {
    throw Object.assign(new Error("erasure_scope_invalid"), { code: "erasure_scope_invalid", status: 400 });
  }
  return Object.freeze(scope);
}

export function erasureScopeParams(scope) {
  return scope ? [scope.jobId, scope.replicaId, scope.ownerUserId] : [];
}

export function erasureScopePredicate(scope, alias, offset) {
  if (!scope) return "";
  if (!/^[a-z_]+$/.test(alias) || !Number.isInteger(offset) || offset < 0) throw Error("erasure_scope_sql_invalid");
  return `and ${alias}.replica_id=$${offset + 2}::uuid and ${alias}.owner_user_id=$${offset + 3}::uuid
    and exists (select 1 from vy_replica_erasure_job owned_erasure
      where owned_erasure.job_id=$${offset + 1}::uuid
        and owned_erasure.replica_id=${alias}.replica_id
        and owned_erasure.owner_user_id=${alias}.owner_user_id
        and owned_erasure.state<>'complete')`;
}

export function assertErasureScope(scope, row) {
  if (scope && (!row || row.replicaId !== scope.replicaId || row.ownerUserId !== scope.ownerUserId ||
    (row.jobId !== undefined && row.jobId !== scope.jobId))) {
    throw Object.assign(new Error("erasure_scope_mismatch"), { code: "erasure_scope_mismatch" });
  }
}
