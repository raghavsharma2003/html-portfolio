import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SOURCES = 5;

// The outer Room row survives an empty showcase. No outer row means the
// authority disappeared or became ineligible, never an empty public corpus.
export const PUBLIC_ROOM_KNOWLEDGE_SQL = `select r.room_id,k.id,k.question,k.answer,k.position
  from vy_room r
  left join lateral (
    select s.id,s.question,s.answer,s.position
      from vy_room_showcase s
     where s.room_id=r.room_id and s.removed_at is null
     order by s.position asc,s.id asc
     limit 5
  ) k on true
 where r.room_id=$1::uuid and r.replica_id=$2::uuid
   and r.owner_user_id=$3::uuid and r.agent_id=$4::uuid
   and r.published_at is not null and r.paused_at is null
   and not exists(select 1 from vy_replica_runtime_capability candidate_cap
     where candidate_cap.replica_id=r.replica_id and candidate_cap.owner_user_id=r.owner_user_id
       and candidate_cap.state='active' and candidate_cap.candidate_binding_required)
 order by k.position asc,k.id asc`;

function fail(code, status) {
  throw Object.assign(new Error(code), { code, status });
}

function uuid(value, code = "room_knowledge_scope_invalid", status = 400) {
  if (typeof value !== "string" || value.length !== 36 || !UUID.test(value)) fail(code, status);
  return value.toLowerCase();
}

function scopeOf(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("room_knowledge_scope_invalid", 400);
  return Object.freeze({
    roomId: uuid(value.roomId), replicaId: uuid(value.replicaId),
    ownerUserId: uuid(value.ownerUserId), agentId: uuid(value.agentId),
  });
}

// PostgreSQL length(text) counts Unicode characters, not UTF-16 code units.
// Preserve the exact public copy, including whitespace; do not trim or crop.
function text(value, maximum) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum * 2 ||
      [...value].length > maximum || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]|\u0000/u.test(value)) {
    fail("room_knowledge_result_invalid", 503);
  }
  return value;
}

function snapshot(scope, items) {
  if (!Array.isArray(items) || items.length > MAX_SOURCES) fail("room_knowledge_result_invalid", 503);
  const ids = new Set(), positions = new Set();
  const sources = items.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) fail("room_knowledge_result_invalid", 503);
    const id = uuid(item.id, "room_knowledge_result_invalid", 503);
    const question = text(item.question, 200), answer = text(item.answer, 1200);
    const position = item.position;
    if (!Number.isInteger(position) || position < 1 || position > MAX_SOURCES || ids.has(id) || positions.has(position)) {
      fail("room_knowledge_result_invalid", 503);
    }
    ids.add(id); positions.add(position);
    const contentSha256 = sha256Hex(canonicalJson({
      schema: "room-public-qa/v1", room_id: scope.roomId, item_id: id, question, answer,
    }));
    return Object.freeze({ id, question, answer, position, contentSha256 });
  }).sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  const setSha256 = sha256Hex(canonicalJson({
    schema: "room-public-qa-set/v1", ...scope,
    sources: sources.map(({ id, position, contentSha256 }) => ({ id, position, contentSha256 })),
  }));
  return Object.freeze({ scope: "public_room_qa", roomId: scope.roomId, sources: Object.freeze(sources), setSha256 });
}

export async function readPublicRoomKnowledge(db, input) {
  const scope = scopeOf(input);
  if (typeof db !== "function") fail("room_knowledge_database_required", 500);
  let rows;
  try {
    rows = await db(PUBLIC_ROOM_KNOWLEDGE_SQL, [scope.roomId, scope.replicaId, scope.ownerUserId, scope.agentId]);
  } catch {
    // A database/provider error must not become a plausible empty corpus.
    fail("room_knowledge_read_failed", 503);
  }
  if (!Array.isArray(rows) || rows.length > MAX_SOURCES) fail("room_knowledge_result_invalid", 503);
  if (rows.length === 0) fail("room_knowledge_unavailable", 409);
  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row) ||
        uuid(row.room_id, "room_knowledge_result_invalid", 503) !== scope.roomId) {
      fail("room_knowledge_result_invalid", 503);
    }
  }
  if (rows.length === 1 && rows[0].id === null && rows[0].question === null &&
      rows[0].answer === null && rows[0].position === null) return snapshot(scope, []);
  return snapshot(scope, rows);
}

function exactKeys(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export async function assertPublicRoomKnowledgeCurrent(db, input, expected) {
  const scope = scopeOf(input);
  // This is a retained caller snapshot, not independent publication authority.
  // Recompute it before comparing, then re-read current SQL authority below.
  let retained;
  try {
    if (!exactKeys(expected, ["scope", "roomId", "sources", "setSha256"]) ||
        expected.scope !== "public_room_qa" || expected.roomId !== scope.roomId ||
        !Array.isArray(expected.sources) || !expected.sources.every((item) =>
          exactKeys(item, ["id", "question", "answer", "position", "contentSha256"]))) throw new Error();
    retained = snapshot(scope, expected.sources);
    if (canonicalJson(retained) !== canonicalJson(expected)) throw new Error();
  } catch {
    fail("room_knowledge_snapshot_invalid", 400);
  }
  const current = await readPublicRoomKnowledge(db, scope);
  if (current.setSha256 !== retained.setSha256) fail("room_knowledge_changed", 409);
  return current;
}
