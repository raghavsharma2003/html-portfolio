import { randomUUID } from "node:crypto";
import {
  DIALOGUE_SCHEMA,
  cleanDialogueText,
  compileDialoguePrompt,
  dialogueSpeechStyle,
  validateDialogueOutput,
} from "./_dialogue/contracts.js";
import {
  compileRelationshipTail,
  compileReplicaRuntimeCore,
  loadOwnedRuntimeContext,
  loadPrivateRelationshipSnapshot,
  openOwnedRuntimeSession,
} from "./_replica-runtime.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { beginFoundrySpend, markFoundrySpendUncertain, releaseFoundrySpendBeforeCall, reserveFoundrySpend, settleFoundrySpend } from "./_provider-budget.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TRACE = /^[A-Za-z0-9_-]{8,96}$/;
const CHANNELS = new Set(["private_chat", "private_call"]);

function fail(code, status = 409, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  throw error;
}

function safeUuid(value, code) {
  const id = String(value || "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code, 400);
  return id;
}

function cleanFailure(value) {
  return String(value?.code || value?.message || "dialogue_generation_failed").replace(/[^a-z0-9_.:-]/gi, "_").slice(0, 120);
}

async function ensureSession(db, ownerUserId, runtime, input) {
  const channel = String(input.channel || "private_chat");
  if (!CHANNELS.has(channel)) fail("dialogue_channel_not_allowed", 400);
  const supplied = input.session_id ? safeUuid(input.session_id, "valid_session_id_required") : null;
  if (!supplied) {
    const opened = await openOwnedRuntimeSession(db, ownerUserId, {
      replica_id: runtime.replica.replica_id,
      channel,
      trace_id: input.trace_id,
    });
    if (!opened) fail("dialogue_session_not_authorized");
    return { session_id: opened.session_id, channel: opened.channel };
  }
  const rows = await db(
    `update vy_replica_runtime_session s set last_active_at=now(),updated_at=now()
       from vy_replica_runtime_capability c,vy_replica r
      where s.session_id=$1 and s.replica_id=$2 and s.owner_user_id=$3 and s.channel=$4
        and s.capability_id=$5 and s.state='active' and s.last_active_at>now()-interval '12 hours'
        and c.capability_id=s.capability_id and c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
        and c.agent_id=s.agent_id and c.subject_person_id=s.person_id and c.state='active'
        and r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id and r.lifecycle='active'
        and exists(select 1 from vy_replica_consent x
          where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
            and x.scope='inference' and x.policy_version=$6 and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
      returning s.session_id,s.channel`,
    [supplied, runtime.replica.replica_id, ownerUserId, channel, runtime.capability.capability_id, REPLICA_POLICY_VERSION],
  );
  if (!rows[0]) fail("dialogue_session_not_authorized");
  return rows[0];
}

async function loadSessionHistory(db, ownerUserId, runtime, sessionId) {
  const rows = await db(
    `select recent.ordinal,u.content as user_content,a.content as assistant_content
       from (
         select t.* from vy_replica_dialogue_turn t
          where t.session_id=$1 and t.replica_id=$2 and t.owner_user_id=$3
            and t.agent_id=$4 and t.person_id=$5 and t.state='complete'
          order by t.ordinal desc limit 10
       ) recent
       join meera_log u on u.id=recent.user_log_id and u.agent_id=recent.agent_id and u.device_id=recent.device_id
       join meera_log a on a.id=recent.assistant_log_id and a.agent_id=recent.agent_id and a.device_id=recent.device_id
      order by recent.ordinal asc`,
    [sessionId, runtime.replica.replica_id, ownerUserId, runtime.replica.agent_id, runtime.replica.subject_person_id],
  );
  return rows.flatMap((row) => [
    { role: "user", content: row.user_content },
    { role: "assistant", content: row.assistant_content },
  ]);
}

async function beginDialogueTurn(db, ownerUserId, runtime, session, generator, input, prompt) {
  const rows = await db(
    `with authorized as (
       select s.session_id,s.capability_id,s.replica_id,s.owner_user_id,s.agent_id,s.person_id,s.channel,
              c.profile_version,c.calibration_version,pd.device_id
         from vy_replica_runtime_session s
         join vy_replica_runtime_capability c
           on c.capability_id=s.capability_id and c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
          and c.agent_id=s.agent_id and c.subject_person_id=s.person_id and c.state='active'
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
         join lateral (
           select d.device_id from vy_person_device d where d.person_id=s.person_id order by d.linked_at desc limit 1
         ) pd on true
        where s.session_id=$1 and s.replica_id=$2 and s.owner_user_id=$3 and s.capability_id=$4
          and s.state='active' and s.last_active_at>now()-interval '12 hours'
          and r.lifecycle='active' and r.subject_mode='self'
          and exists(select 1 from vy_replica_consent x
            where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
              and x.scope='inference' and x.policy_version=$13 and x.revoked_at is null
              and (x.expires_at is null or x.expires_at>now()))
     ), advanced as (
       update vy_replica_runtime_session s
          set next_turn_ordinal=s.next_turn_ordinal+1,last_active_at=now(),updated_at=now()
         from authorized a where s.session_id=a.session_id
       returning a.*,s.next_turn_ordinal-1 as ordinal
     ), user_log as (
       insert into meera_log (device_id,role,channel,kind,content,at,agent_id)
       select a.device_id,'me',case when a.channel='private_call' then 'call' else 'chat' end,
              'text',$5,now(),a.agent_id from advanced a
       returning id,device_id,agent_id
     ), inserted as (
       insert into vy_replica_dialogue_turn
         (session_id,capability_id,replica_id,owner_user_id,agent_id,person_id,device_id,ordinal,
          profile_version,calibration_version,schema_version,provider_family,provider_name,provider_version,
          model,trace_id,user_log_id,prompt_hash,state)
       select a.session_id,a.capability_id,a.replica_id,a.owner_user_id,a.agent_id,a.person_id,a.device_id,a.ordinal,
              a.profile_version,a.calibration_version,$7,$8,$9,$10,$11,$6,l.id,$12,'generating'
         from advanced a join user_log l on l.device_id=a.device_id and l.agent_id=a.agent_id
       returning turn_id,session_id,ordinal,created_at
     ) select * from inserted`,
    [session.session_id, runtime.replica.replica_id, ownerUserId, runtime.capability.capability_id,
      input.message, input.trace_id, DIALOGUE_SCHEMA, generator.family, generator.name, generator.version,
      generator.model, prompt.prompt_hash, REPLICA_POLICY_VERSION],
  );
  if (!rows[0]) fail("dialogue_authorization_changed");
  return rows[0];
}

async function finishDialogueTurn(db, ownerUserId, runtime, turn, output) {
  const rows = await db(
    `with authorized as (
       select t.turn_id,t.session_id,t.replica_id,t.owner_user_id,t.agent_id,t.person_id,t.device_id,t.ordinal,t.user_log_id,
              s.channel
         from vy_replica_dialogue_turn t
         join vy_replica_runtime_session s
           on s.session_id=t.session_id and s.capability_id=t.capability_id and s.replica_id=t.replica_id
          and s.owner_user_id=t.owner_user_id and s.agent_id=t.agent_id and s.person_id=t.person_id and s.state='active'
         join vy_replica_runtime_capability c
           on c.capability_id=t.capability_id and c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.agent_id=t.agent_id and c.subject_person_id=t.person_id and c.profile_version=t.profile_version
          and c.calibration_version=t.calibration_version and c.state='active'
         join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id and r.lifecycle='active'
        where t.turn_id=$1 and t.replica_id=$2 and t.owner_user_id=$3 and t.state='generating'
          and exists(select 1 from vy_replica_consent x
            where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
              and x.scope='inference' and x.policy_version=$7 and x.revoked_at is null
              and (x.expires_at is null or x.expires_at>now()))
     ), assistant_log as (
       insert into meera_log (device_id,role,channel,kind,content,at,agent_id)
       select a.device_id,'her',case when a.channel='private_call' then 'call' else 'chat' end,
              'text',$4,now(),a.agent_id from authorized a
       returning id,device_id,agent_id
     ), finished as (
       update vy_replica_dialogue_turn t
          set assistant_log_id=l.id,response_hash=$5,delivery_plan=$6::jsonb,state='complete',
              failure_code='',completed_at=now(),updated_at=now()
         from authorized a join assistant_log l on l.device_id=a.device_id and l.agent_id=a.agent_id
        where t.turn_id=a.turn_id
       returning t.turn_id,t.session_id,t.ordinal,t.created_at,t.completed_at
     ) select * from finished`,
    [turn.turn_id, runtime.replica.replica_id, ownerUserId, output.reply, output.response_hash,
      JSON.stringify(output.delivery), REPLICA_POLICY_VERSION],
  );
  return rows[0] || null;
}

async function failDialogueTurn(db, ownerUserId, turnId, code) {
  if (!turnId) return;
  await db(
    `update vy_replica_dialogue_turn set state=case when state='complete' then state else 'failed' end,
            failure_code=case when state='complete' then failure_code else $3 end,updated_at=now()
      where turn_id=$1 and owner_user_id=$2`,
    [turnId, ownerUserId, cleanFailure(code)],
  ).catch(() => []);
}

export async function generateOwnedDialogue(db, ownerUserId, rawInput, generator, signal) {
  if (!generator || typeof generator.generate !== "function" || !generator.family || !generator.name || !generator.version || !generator.model)
    fail("dialogue_generator_unavailable", 503);
  const input = {
    replica_id: replicaId(rawInput?.replica_id),
    session_id: rawInput?.session_id || null,
    channel: String(rawInput?.channel || "private_chat"),
    message: cleanDialogueText(rawInput?.message, 4_000),
    trace_id: TRACE.test(String(rawInput?.trace_id || "")) ? String(rawInput.trace_id) : `dialogue_${randomUUID().replaceAll("-", "")}`,
  };
  if (!input.message) fail("dialogue_message_required", 400);
  if (Array.from(String(rawInput?.message || "")).length > 4_000) fail("dialogue_message_too_large", 413);
  const runtime = await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id);
  if (!runtime) fail("dialogue_runtime_not_active");
  const session = await ensureSession(db, ownerUserId, runtime, input);
  const [snapshot, history] = await Promise.all([
    loadPrivateRelationshipSnapshot(db, runtime, { strict: true }),
    loadSessionHistory(db, ownerUserId, runtime, session.session_id),
  ]);
  const prompt = compileDialoguePrompt({
    core: compileReplicaRuntimeCore(runtime.personProfile.definition, runtime.calibration.definition),
    relationship: compileRelationshipTail(snapshot),
    history,
    message: input.message,
  });
  const turn = await beginDialogueTurn(db, ownerUserId, runtime, session, generator, input, prompt);
  let reservation = null;
  let providerStarted = false;
  try {
    reservation = await reserveFoundrySpend(db, {
      operation: "dialogue",
      requestKey: turn.turn_id,
      adapter: generator,
      messages: prompt.messages,
    });
    if (reservation) {
      try { await beginFoundrySpend(db, reservation); }
      catch (error) {
        await releaseFoundrySpendBeforeCall(db, reservation, error).catch(() => null);
        throw error;
      }
      providerStarted = true;
    }
    const generated = await generator.generate({ prompt, signal });
    const output = validateDialogueOutput(generated?.output);
    const finished = await finishDialogueTurn(db, ownerUserId, runtime, turn, output);
    if (!finished) fail("dialogue_authorization_changed");
    let billingState = "not_metered";
    if (reservation) {
      try {
        await settleFoundrySpend(db, reservation, generated.usage);
        billingState = "settled";
      } catch (error) {
        await markFoundrySpendUncertain(db, reservation, error);
        billingState = "reconcile_required";
      }
    }
    return {
      turn_id: finished.turn_id,
      session_id: finished.session_id,
      reply: output.reply,
      delivery: output.delivery,
      can_voice: true,
      billing_state: billingState,
      created_at: finished.created_at,
    };
  } catch (error) {
    if (providerStarted) await markFoundrySpendUncertain(db, reservation, error);
    await failDialogueTurn(db, ownerUserId, turn.turn_id, error);
    throw error;
  }
}

export async function loadOwnedDialogueSpeech(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const turnId = safeUuid(input?.dialogue_turn_id, "valid_dialogue_turn_id_required");
  const rows = await db(
    `select t.turn_id,a.content,t.delivery_plan
       from vy_replica_dialogue_turn t
       join meera_log a on a.id=t.assistant_log_id and a.agent_id=t.agent_id and a.device_id=t.device_id and a.role='her'
       join vy_replica_runtime_capability c
         on c.capability_id=t.capability_id and c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
        and c.agent_id=t.agent_id and c.subject_person_id=t.person_id and c.profile_version=t.profile_version
        and c.calibration_version=t.calibration_version and c.state='active'
       join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id and r.lifecycle='active'
      where t.turn_id=$1 and t.replica_id=$2 and t.owner_user_id=$3 and t.state='complete'
        and exists(select 1 from vy_replica_consent x
          where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
            and x.scope='inference' and x.policy_version=$4 and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
      limit 1`,
    [turnId, rid, ownerUserId, REPLICA_POLICY_VERSION],
  );
  if (!rows[0]) fail("dialogue_turn_not_speakable", 409);
  const output = validateDialogueOutput({ reply: rows[0].content, delivery: rows[0].delivery_plan });
  return { dialogue_turn_id: rows[0].turn_id, text: output.reply, style: dialogueSpeechStyle(output.delivery) };
}

export function createReplicaDialogueHandler({ db, requireUser, resolveGenerator }) {
  if (![db, requireUser, resolveGenerator].every((dependency) => typeof dependency === "function"))
    throw new Error("replica dialogue dependencies required");
  return async function replicaDialogue(req, res) {
    const aborter = new AbortController();
    req.on?.("close", () => aborter.abort(new Error("client_closed")));
    try {
      const user = await requireUser(req);
      const generator = await resolveGenerator();
      const turn = await generateOwnedDialogue(db, user.id, req.body || {}, generator, aborter.signal);
      return res.status(200).json({ turn });
    } catch (error) {
      const status = Number.isInteger(error?.status) ? error.status : 500;
      return res.status(status).json({
        error: status === 500 ? "replica_dialogue_failed" : String(error?.code || error?.message || "replica_dialogue_failed"),
        ...(status < 500 && error?.details ? { details: error.details } : {}),
      });
    }
  };
}
