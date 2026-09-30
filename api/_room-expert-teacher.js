// SELECT-only, opt-in authority reader. The existing persisted sheet column is
// a publication receipt, not proof of an independently verified active grant.
import { validateTeacherSheet, consentGateBlockers } from "./_engine.gen.js";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

export const ROOM_EXPERT_TEACHER_SQL = `select r.room_id,r.replica_id,r.owner_user_id,r.agent_id,
    r.published_at as room_published_at,r.paused_at,p.lifecycle,a.slug,
    s.sheet_id,s.version,s.sheet,s.status,s.consent_artifact_id,s.published_at,
    s.replica_id as sheet_replica_id,s.owner_user_id as sheet_owner_user_id
  from vy_room r
  join vy_replica p on p.replica_id=r.replica_id and p.owner_user_id=r.owner_user_id and p.agent_id=r.agent_id
  join vy_agent a on a.agent_id=r.agent_id
  join vy_teacher_sheet s on s.agent_id=r.agent_id
 where r.room_id=$1::uuid and r.replica_id=$2::uuid
   and r.owner_user_id=$3::uuid and r.agent_id=$4::uuid
   and r.published_at is not null and r.paused_at is null
   and p.lifecycle not in ('revoked','purging')
   and s.status='published' and s.published_at is not null
   and s.consent_artifact_id is not null
   and s.consent_artifact_id <> '00000000-0000-0000-0000-000000000000'::uuid
   and s.consent_artifact_id <> '00000000-0000-4000-8000-000000000000'::uuid
   and ((s.replica_id=r.replica_id and s.owner_user_id=r.owner_user_id)
     or (s.replica_id is null and s.owner_user_id is null))
 order by s.published_at desc,s.sheet_id desc limit 1`;

function fail(code, status = 503) {
  throw Object.assign(new Error(code), { code, status });
}
function uuid(value) {
  if (typeof value !== "string" || value.length !== 36 || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
      || /^00000000-0000-[04]000-[08]000-000000000000$/i.test(value)) fail("room_expert_teacher_scope_invalid", 400);
  return value.toLowerCase();
}
function scopeOf(input) {
  if (!input || typeof input !== "object") fail("room_expert_teacher_scope_invalid", 400);
  return { roomId: uuid(input.roomId), replicaId: uuid(input.replicaId), ownerUserId: uuid(input.ownerUserId), agentId: uuid(input.agentId) };
}
function digest(value) { return sha256Hex(canonicalJson(value)); }

export async function readRoomExpertTeacher(db, input) {
  const scope = scopeOf(input);
  if (typeof db !== "function") fail("room_expert_teacher_database_required", 500);
  let rows;
  try { rows = await db(ROOM_EXPERT_TEACHER_SQL, [scope.roomId,scope.replicaId,scope.ownerUserId,scope.agentId]); }
  catch { fail("room_expert_teacher_read_failed"); }
  if (!Array.isArray(rows) || rows.length > 1) fail("room_expert_teacher_result_invalid");
  if (!rows.length) fail("room_expert_teacher_unavailable", 409);
  const row = rows[0];
  if (!row || row.room_id !== scope.roomId || row.replica_id !== scope.replicaId
      || row.owner_user_id !== scope.ownerUserId || row.agent_id !== scope.agentId
      || !row.room_published_at || row.paused_at != null || !row.lifecycle || ["revoked","purging"].includes(row.lifecycle)
      || !row.published_at || consentGateBlockers(row).length
      || !((row.sheet_replica_id === scope.replicaId && row.sheet_owner_user_id === scope.ownerUserId)
        || (row.sheet_replica_id === null && row.sheet_owner_user_id === null))) fail("room_expert_teacher_unavailable", 409);
  let sheet;
  try { sheet = JSON.parse(typeof row.sheet === "string" ? row.sheet : JSON.stringify(row.sheet)); }
  catch { fail("room_expert_teacher_result_invalid"); }
  if (!validateTeacherSheet(sheet).ok || sheet.slug !== row.slug || sheet.version !== row.version
      || sheet.consentArtifactId !== row.consent_artifact_id) fail("room_expert_teacher_result_invalid");
  const publication = { status: "published", consentBasis: "persisted_sheet_column",
    sheetId: uuid(row.sheet_id), agentId: scope.agentId, replicaId: scope.replicaId, ownerId: scope.ownerUserId,
    consentArtifactId: uuid(row.consent_artifact_id), sheetVersion: row.version, agentSlug: row.slug };
  const snapshot = { scope, publication, sheet, publishedAt: String(row.published_at),
    sheetOwner: { replicaId: row.sheet_replica_id, ownerId: row.sheet_owner_user_id } };
  return Object.freeze({ ...snapshot, snapshotSha256: digest(snapshot) });
}

export function assertRoomExpertTeacherMatches(expected, sheet, agentSlug) {
  if (!expected || expected.publication?.agentSlug !== agentSlug || digest(expected.sheet) !== digest(sheet)) {
    fail("room_expert_teacher_changed", 409);
  }
}

export async function assertRoomExpertTeacherCurrent(db, input, expected) {
  if (!expected || typeof expected !== "object") fail("room_expert_teacher_snapshot_invalid", 400);
  const { snapshotSha256, ...snapshot } = expected;
  if (snapshotSha256 !== digest(snapshot) || digest(snapshot.scope) !== digest(scopeOf(input))) fail("room_expert_teacher_snapshot_invalid", 400);
  const current = await readRoomExpertTeacher(db, input);
  if (current.snapshotSha256 !== snapshotSha256) fail("room_expert_teacher_changed", 409);
  return current;
}
