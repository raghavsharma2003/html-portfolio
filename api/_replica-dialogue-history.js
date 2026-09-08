import {continuityPredicate} from "./_private-dialogue-continuity.js";
// Resume the existing owner-only private conversation. No inferred memory,
// transcript copy, session extension on read, or model call belongs here.
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import {DIALOGUE_AUTHORITY_SQL as runtime} from "./_replica-dialogue-authority.js";
import { canonicalJson, sha256Hex } from "./_provenance/contracts.js";
import { validateDialogueOutput } from "./_dialogue/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fail(code, status = 409) { throw Object.assign(new Error(code), { code, status }); }
function sessionId(value, optional = false) {
  if (optional && (value === undefined || value === null || value === "")) return null;
  const id = String(value || "").toLowerCase();
  if (!UUID.test(id)) fail("valid_session_id_required", 400);
  return id;
}

// Mirrors loadOwnedRuntimeContext's current live prerequisites, at the actual
// history/open statement, rather than trusting a previous readiness read.


export const DIALOGUE_HISTORY_SQL = `with authorized as materialized (${runtime}),
  selected as materialized (
    select s.* from vy_replica_runtime_session s join authorized a
      on s.capability_id=a.capability_id and s.replica_id=a.replica_id and s.owner_user_id=a.owner_user_id
      and s.agent_id=a.agent_id and s.person_id=a.subject_person_id
     where s.channel='private_chat' and s.state='active' and s.last_active_at>now()-interval '12 hours'
       and ($3::uuid is null or s.session_id=$3::uuid)
     order by s.last_active_at desc,s.started_at desc,s.session_id desc limit 1
  ), turns as materialized (
    select t.* from vy_replica_dialogue_turn t join selected s
      on t.session_id=s.session_id and t.capability_id=s.capability_id and t.replica_id=s.replica_id
      and t.owner_user_id=s.owner_user_id and t.agent_id=s.agent_id and t.person_id=s.person_id
    join authorized a on t.profile_version=a.profile_version and t.calibration_version=a.calibration_version
  ), recent as materialized (
    select t.*,u.content as question,a.content as reply from turns t
    join meera_log u on u.id=t.user_log_id and u.agent_id=t.agent_id and u.device_id=t.device_id and u.role='me'
    join meera_log a on a.id=t.assistant_log_id and a.agent_id=t.agent_id and a.device_id=t.device_id and a.role='her'
    join authorized r on r.replica_id=t.replica_id
    join vy_replica_runtime_capability c on c.capability_id=t.capability_id
    where t.state='complete' and ${continuityPredicate('t.continuity_refs','r','c','t.session_id')} order by t.ordinal desc limit 10
  ), latest as (select * from turns order by ordinal desc limit 1)
  select exists(select 1 from authorized) as runtime_active,s.session_id,
    coalesce((select jsonb_agg(jsonb_build_object('turn_id',t.turn_id,'ordinal',t.ordinal,'trace_id',t.trace_id,
      'question',t.question,'reply',t.reply,'delivery',t.delivery_plan,'created_at',t.created_at,
      'has_continuity',jsonb_array_length(coalesce(t.continuity_refs,'[]'::jsonb))>0)
      order by t.ordinal asc) from recent t),'[]'::jsonb) as exchanges,
    exists(select 1 from turns where state='generating') as pending,
    (select jsonb_build_object('trace_id',t.trace_id,'state',t.state) from latest t) as latest_request,
    coalesce((select jsonb_agg(jsonb_build_object('turn_id',t.turn_id,'provider_family',t.provider_family,
      'provider_name',t.provider_name,'provider_version',t.provider_version,'model',t.model))
      from (select turn_id,provider_family,provider_name,provider_version,model from recent
        union select turn_id,provider_family,provider_name,provider_version,model from latest) t),'[]'::jsonb) as billing_candidates
    from (select 1) seed left join selected s on true`;

// Existing session UUID is the idempotency key. A collision cannot adopt a
// foreign, revoked, expired or differently-bound session. No new unique index.
export const DIALOGUE_OPEN_SQL = `with authorized as materialized (${runtime} for update of r)
  insert into vy_replica_runtime_session as current
    (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,channel,trace_id)
  select $3::uuid,a.capability_id,a.replica_id,a.owner_user_id,a.agent_id,a.subject_person_id,
    'private_chat','dialogue-session-'||$3::text from authorized a
  on conflict(session_id) do update set updated_at=current.updated_at
    where current.capability_id=excluded.capability_id and current.replica_id=excluded.replica_id
      and current.owner_user_id=excluded.owner_user_id and current.agent_id=excluded.agent_id
      and current.person_id=excluded.person_id and current.channel=excluded.channel
      and current.trace_id=excluded.trace_id and current.state='active'
      and current.last_active_at>now()-interval '12 hours'
  returning session_id`;

export const DIALOGUE_HISTORY_SPEND_SQL = `select request_hash,state from vy_provider_spend
  where operation='dialogue' and request_hash=any($1::text[])`;

export async function openOwnedDialogueSession(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id), id = sessionId(input?.session_id);
  const rows = await db(DIALOGUE_OPEN_SQL, [rid, ownerUserId, id, REPLICA_POLICY_VERSION]);
  if (!rows[0] || rows[0].session_id !== id) fail("dialogue_session_not_authorized");
  return { replica_id: rid, session_id: id };
}

export async function readOwnedDialogueHistory(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id), id = sessionId(input?.session_id, true);
  const [row] = await db(DIALOGUE_HISTORY_SQL, [rid, ownerUserId, id, REPLICA_POLICY_VERSION]);
  if (!row || row.runtime_active !== true) fail("dialogue_runtime_not_active");
  if (id && !row.session_id) fail("dialogue_session_not_authorized");
  if (!Array.isArray(row.exchanges) || !Array.isArray(row.billing_candidates) || typeof row.pending !== "boolean")
    fail("dialogue_history_invalid", 503);
  const hashes = new Map(row.billing_candidates.map(turn => [turn.turn_id, sha256Hex(canonicalJson({
    operation: "dialogue", request_key: turn.turn_id, provider_family: turn.provider_family,
    provider_name: turn.provider_name, provider_version: turn.provider_version, model: turn.model,
  }))]));
  const spend = hashes.size ? await db(DIALOGUE_HISTORY_SPEND_SQL, [[...hashes.values()]]) : [];
  const billing = turnId => {
    const entries = spend.filter(item => item.request_hash === hashes.get(turnId));
    return entries.some(item => item.state !== "settled" && item.state !== "released") ? "reconcile_required"
      : entries.some(item => item.state === "settled") ? "settled" : "not_metered";
  };
  const exchanges = row.exchanges.map(turn => {
    let output;
    try { output = validateDialogueOutput({ reply: turn.reply, delivery: turn.delivery }); }
    catch { fail("dialogue_history_invalid", 503); }
    return { question: turn.question, trace_id: turn.trace_id, answer: {
      has_continuity: turn.has_continuity === true, turn_id: turn.turn_id, session_id: row.session_id, reply: output.reply, delivery: output.delivery,
      can_voice: turn.has_continuity !== true, billing_state: billing(turn.turn_id), created_at: turn.created_at,
    } };
  });
  return { replica_id: rid, session_id: row.session_id || null, exchanges, latest_request: row.latest_request || null,
    pending: row.pending, billing_pending: [...hashes.keys()].some(key => billing(key) === "reconcile_required") };
}
