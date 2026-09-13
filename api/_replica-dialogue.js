import {readPrivateContinuity, continuityReferences, continuityPrompt, privateContinuityPredicate as continuityPredicate,
  continuityFeedbackEligibilitySql, readPrivateContinuitySources} from "./_private-dialogue-continuity.js";
import { randomUUID, createHash } from "node:crypto";
import {
  OWNER_MEMORY_RECALL_SQL, OWNER_MEMORY_FACTS_SQL, OWNER_MEMORY_CORRECT_SQL,
  OWNER_MEMORY_RETRACT_SQL, OWNER_MEMORY_RECLASSIFY_READ_SQL,
  OWNER_MEMORY_CONSENT_STATUS_SQL, OWNER_MEMORY_CONSENT_GRANT_SQL, OWNER_MEMORY_CONSENT_REVOKE_SQL,
  ownerMemoryAuthority,
} from "./_room-memory-authority.js";
import { ownerRelStateFromReplica, ownerRelStateResetFromReplica } from "./_room-relstate.js";
import {
  DIALOGUE_SCHEMA,
  cleanDialogueText,
  hasMalformedDialogueUnicode,
  compileDialoguePrompt,
  dialogueSpeechStyle,
  validateDialogueOutput,
} from "./_dialogue/contracts.js";
import {
  compileRelationshipTail,
  compileReplicaRuntimeCore,
  loadOwnedPrivateRuntimeContext as loadOwnedRuntimeContext,
  loadOwnedTextProfile,
  loadPrivateRelationshipSnapshot,
  openOwnedRuntimeSession,
  ownedRuntimeStatus,
} from "./_replica-runtime.js";
import { replicaId, REPLICA_POLICY_VERSION } from "./_replica.js";
import { beginFoundrySpend, markFoundrySpendUncertain, releaseFoundrySpendBeforeCall, reserveFoundrySpend, settleFoundrySpend } from "./_provider-budget.js";
import { readOwnedDialogueHistory, openOwnedDialogueSession } from "./_replica-dialogue-history.js";
import {ownerPrivateCapabilityAuthoritySql} from './_replica-candidate-activation-authority.js';
import {candidateRuntimeCore,assertCandidateGenerator,assertCandidateResponse,assertCandidateRuntimeUnchanged} from './_replica-candidate-runtime.js';
import { getReplicaVibe } from './_replica-vibe.js';

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

// WS-R167: the owner's own remembered facts, folded into the SAME
// `relationship` prompt segment `compileRelationshipTail` already fills -
// `compileDialoguePrompt` (api/_dialogue/contracts.js) takes one
// `relationship` string, not a second slot, so this stays additive rather
// than widening that contract for one caller. Shape mirrors
// `_room-surface.js`'s own `memories: facts.map(f => `- ${f.body}`)` line
// for the non-expert Room reply exactly, so the two never drift apart.
function ownerMemoryTail(facts) {
  if (!Array.isArray(facts) || !facts.length) return "";
  const lines = facts.slice(0, 30).map((f) => `- ${String(f.body || "").slice(0, 400)}`);
  return `Remembered from earlier private Meet conversations (evidence-backed, never invented):\n${lines.join("\n")}`;
}

async function ownedSelfRuntime(db, ownerUserId, replicaIdInput) {
  const rid = replicaId(replicaIdInput);
  const runtime = await loadOwnedRuntimeContext(db, ownerUserId, rid);
  if (!runtime) fail("dialogue_runtime_not_active");
  return { rid, runtime };
}

async function ownerMemoryOn(db, rid, ownerUserId) {
  const rows = await db(OWNER_MEMORY_CONSENT_STATUS_SQL, [rid, ownerUserId]);
  return rows[0]?.memory_on === true;
}

// ── OP: memory_status / memory_toggle — "It remembers", the owner's own
// honest on/off control, the same weight `vy_room_follower.memory_consent_at`
// gives a follower. Deliberately NOT `_replica-consent.js` (out of this
// workstream's touched-file list; see api/_room-memory-authority.js's own
// header on why a fresh, narrow, local grant/revoke pair is used instead). ──

export async function ownerMemoryStatus(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  return { memory_on: await ownerMemoryOn(db, rid, ownerUserId) };
}

export async function ownerMemoryToggle(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  if (input?.on === true) {
    const receiptHash = createHash("sha256")
      .update(`owner-memory-consent:${rid}:${ownerUserId}:${randomUUID()}`, "utf8")
      .digest("hex");
    const rows = await db(OWNER_MEMORY_CONSENT_GRANT_SQL, [rid, ownerUserId, receiptHash]);
    if (!rows[0]) fail("dialogue_runtime_not_active");
    return { memory_on: true };
  }
  if (input?.on === false) {
    await db(OWNER_MEMORY_CONSENT_REVOKE_SQL, [rid, ownerUserId]);
    return { memory_on: false };
  }
  fail("owner_memory_toggle_invalid", 400);
}

// ── OP: memory_facts / memory_correct / memory_forget / memory_classify —
// the SAME op names and response shapes `api/room.js` already exposes for a
// Room follower (`api/_room-surface.js`'s `roomRememberedThings` and
// neighbours), over the owner's own dyad instead of a follower's. ──

function exactOwnerMemoryReplacement(value) {
  if (typeof value !== "string" || value.length < 3 || value.length > 400) fail("owner_memory_replacement_invalid", 400);
  return value;
}

export async function ownerRememberedThings(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  if (!(await ownerMemoryOn(db, rid, ownerUserId))) return { facts: [] };
  const facts = await db(OWNER_MEMORY_FACTS_SQL, ownerMemoryAuthority({ replica_id: rid, owner_user_id: ownerUserId }));
  return {
    facts: facts.map((f) => ({
      id: String(f.id),
      body: String(f.body),
      kind: String(f.kind),
      name: String(f.name),
      created_at: f.created_at,
      communication_classification: f.communication?.state || "not_applicable",
    })),
  };
}

// Classification is intentionally NOT dispatched to a live model here - the
// Room's own metered wrapper (`_room-memory-consolidation.js`'s
// `runMeteredRoomMemoryReclassification`) needs its own lease/budget path
// wired for the owner lane, out of this workstream's scope
// (context/decisions.md#ws-r167-owner-memory-consolidation-left-unmetered).
// This still reads the real row (never fabricates a job) and reports the
// honest, unconfirmed state rather than a fake success.
async function attemptOwnerMemoryClassification(db, rid, ownerUserId, factId) {
  const rows = await db(OWNER_MEMORY_RECLASSIFY_READ_SQL, [rid, ownerUserId, String(factId)]).catch(() => []);
  return rows.length ? { classification: "unconfirmed" } : { classification: "not_applicable" };
}

export async function ownerCorrectRememberedThing(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  const text = exactOwnerMemoryReplacement(input?.replacement);
  if (!(await ownerMemoryOn(db, rid, ownerUserId))) fail("owner_memory_not_enabled", 403);
  if (!/^\d+$/.test(String(input?.fact_id || ""))) fail("owner_memory_fact_unavailable", 404);
  const rows = await db(OWNER_MEMORY_CORRECT_SQL, [rid, ownerUserId, String(input.fact_id), text]);
  if (!rows[0]) fail("owner_memory_fact_unavailable", 404);
  const fact = { id: String(rows[0].fact_id), body: String(rows[0].body) };
  if (rows[0].communication_classification !== "unclassified") return { fact, communication_classification: "not_applicable" };
  const classification = await attemptOwnerMemoryClassification(db, rid, ownerUserId, fact.id);
  return { fact, communication_classification: classification.classification };
}

export async function ownerReclassifyRememberedThing(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  if (!(await ownerMemoryOn(db, rid, ownerUserId))) fail("owner_memory_not_enabled", 403);
  const result = await attemptOwnerMemoryClassification(db, rid, ownerUserId, input?.fact_id);
  return { communication_classification: result.classification };
}

export async function ownerForgetRememberedThing(db, ownerUserId, input) {
  const { rid } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  if (!(await ownerMemoryOn(db, rid, ownerUserId))) fail("owner_memory_not_enabled", 403);
  if (!/^\d+$/.test(String(input?.fact_id || ""))) fail("owner_memory_fact_unavailable", 404);
  const rows = await db(OWNER_MEMORY_RETRACT_SQL, [rid, ownerUserId, String(input.fact_id)]);
  if (!rows[0]) fail("owner_memory_fact_unavailable", 404);
  return { forgotten: true, fact_id: String(rows[0].fact_id) };
}

// ── OP: relstate / relstate_reset — "How we are" / "Start fresh" for the
// owner's own Meet conversation, `api/_room-relstate.js`'s owner key. ──

export async function ownerRelState(db, ownerUserId, input) {
  const { runtime } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  const memoryOn = await ownerMemoryOn(db, runtime.replica.replica_id, ownerUserId);
  return ownerRelStateFromReplica(db, {
    personId: runtime.replica.subject_person_id,
    agentId: runtime.replica.agent_id,
    memoryOn,
  });
}

export async function ownerRelStateReset(db, ownerUserId, input) {
  const { runtime } = await ownedSelfRuntime(db, ownerUserId, input?.replica_id);
  const memoryOn = await ownerMemoryOn(db, runtime.replica.replica_id, ownerUserId);
  return ownerRelStateResetFromReplica(db, {
    personId: runtime.replica.subject_person_id,
    agentId: runtime.replica.agent_id,
    memoryOn,
  });
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
      where s.session_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid and s.channel=$4
        and s.capability_id=$5::uuid and s.state='active' and s.last_active_at>now()-interval '12 hours'
        and c.capability_id=s.capability_id and c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
        and c.agent_id=s.agent_id and c.subject_person_id=s.person_id
        and r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id and r.lifecycle='active'
        and ${ownerPrivateCapabilityAuthoritySql('c','r')} and (c.state<>'private' or s.channel='private_chat')
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

export const PRIVATE_SESSION_HISTORY_SQL = `select recent.ordinal,u.content as user_content,a.content as assistant_content
       from (
         select t.* from vy_replica_dialogue_turn t
          where t.session_id=$1::uuid and t.replica_id=$2::uuid and t.owner_user_id=$3::uuid
            and t.agent_id=$4::uuid and t.person_id=$5::uuid and t.state='complete'
          order by t.ordinal desc limit 10
       ) recent
       join meera_log u on u.id=recent.user_log_id and u.agent_id=recent.agent_id and u.device_id=recent.device_id
       join meera_log a on a.id=recent.assistant_log_id and a.agent_id=recent.agent_id and a.device_id=recent.device_id
      join vy_replica r on r.replica_id=recent.replica_id and r.owner_user_id=recent.owner_user_id
      join vy_replica_runtime_capability c on c.capability_id=recent.capability_id
      where ${continuityPredicate('recent.continuity_refs','r','c','recent.session_id')}
        and ${continuityFeedbackEligibilitySql('recent')}
      order by recent.ordinal asc`;

async function loadSessionHistory(db, ownerUserId, runtime, sessionId) {
  const rows = await db(
    PRIVATE_SESSION_HISTORY_SQL,
    [sessionId, runtime.replica.replica_id, ownerUserId, runtime.replica.agent_id, runtime.replica.subject_person_id],
  );
  return rows.flatMap((row) => [
    { role: "user", content: row.user_content },
    { role: "assistant", content: row.assistant_content },
  ]);
}

export const PRIVATE_DIALOGUE_BEGIN_SQL = `with authorized as materialized (
       select s.session_id,s.capability_id,s.replica_id,s.owner_user_id,s.agent_id,s.person_id,s.channel,
              c.profile_version,c.calibration_version,pd.device_id
         from vy_replica_runtime_session s
         join vy_replica_runtime_capability c
           on c.capability_id=s.capability_id and c.replica_id=s.replica_id and c.owner_user_id=s.owner_user_id
          and c.agent_id=s.agent_id and c.subject_person_id=s.person_id
         join vy_replica r on r.replica_id=s.replica_id and r.owner_user_id=s.owner_user_id
         join lateral (
           select d.device_id from vy_person_device d where d.person_id=s.person_id order by d.linked_at desc limit 1
         ) pd on true
        where s.session_id=$1::uuid and s.replica_id=$2::uuid and s.owner_user_id=$3::uuid and s.capability_id=$4::uuid
          and s.state='active' and s.last_active_at>now()-interval '12 hours'
          and r.lifecycle='active' and r.subject_mode='self'
          and ${ownerPrivateCapabilityAuthoritySql('c','r')} and (c.state<>'private' or s.channel='private_chat')
          and exists(select 1 from vy_replica_consent x
            where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
              and x.scope='inference' and x.policy_version=$13 and x.revoked_at is null
              and (x.expires_at is null or x.expires_at>now()))
          and ${continuityPredicate('$14::jsonb')}
        for update of r
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
          model,trace_id,user_log_id,prompt_hash,state,continuity_refs)
       select a.session_id,a.capability_id,a.replica_id,a.owner_user_id,a.agent_id,a.person_id,a.device_id,a.ordinal,
              a.profile_version,a.calibration_version,$7,$8,$9,$10,$11,$6,l.id,$12,'generating',$14::jsonb
         from advanced a join user_log l on l.device_id=a.device_id and l.agent_id=a.agent_id
       returning turn_id,session_id,ordinal,created_at
     ) select * from inserted`;

async function beginDialogueTurn(db, ownerUserId, runtime, session, generator, input, prompt, evidence = []) {
  const rows = await db(
    PRIVATE_DIALOGUE_BEGIN_SQL,
    [session.session_id, runtime.replica.replica_id, ownerUserId, runtime.capability.capability_id,
      input.message, input.trace_id, DIALOGUE_SCHEMA, generator.family, generator.name, generator.version,
      generator.model, prompt.prompt_hash, REPLICA_POLICY_VERSION, JSON.stringify(continuityReferences(evidence))],
  );
  if (!rows[0]) fail("dialogue_authorization_changed");
  return rows[0];
}

export const PRIVATE_DIALOGUE_FINISH_SQL = `with authorized as materialized (
       select t.turn_id,t.session_id,t.replica_id,t.owner_user_id,t.agent_id,t.person_id,t.device_id,t.ordinal,t.user_log_id,
              s.channel
         from vy_replica_dialogue_turn t
         join vy_replica_runtime_session s
           on s.session_id=t.session_id and s.capability_id=t.capability_id and s.replica_id=t.replica_id
          and s.owner_user_id=t.owner_user_id and s.agent_id=t.agent_id and s.person_id=t.person_id and s.state='active'
         join vy_replica_runtime_capability c
           on c.capability_id=t.capability_id and c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
          and c.agent_id=t.agent_id and c.subject_person_id=t.person_id and c.profile_version=t.profile_version
          and c.calibration_version=t.calibration_version
         join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id and r.lifecycle='active'
        where t.turn_id=$1::uuid and t.replica_id=$2::uuid and t.owner_user_id=$3::uuid and t.state='generating'
          and ${ownerPrivateCapabilityAuthoritySql('c','r')} and (c.state<>'private' or s.channel='private_chat')
          and exists(select 1 from vy_replica_consent x
            where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
              and x.scope='inference' and x.policy_version=$7 and x.revoked_at is null
              and (x.expires_at is null or x.expires_at>now()))
          and ${continuityPredicate('t.continuity_refs')}
        for update of r
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
     ) select * from finished`;

async function finishDialogueTurn(db, ownerUserId, runtime, turn, output) {
  const rows = await db(
    PRIVATE_DIALOGUE_FINISH_SQL,
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
      where turn_id=$1::uuid and owner_user_id=$2::uuid`,
    [turnId, ownerUserId, cleanFailure(code)],
  ).catch(() => []);
}

// WS-R161 (wave twenty-two). Law 2 of this workstream's own brief: every
// apprentice reply carries this EXACT prefix, so a text-ready AI can never
// read as a finished, qualified one. "apprentice" is this repo's own
// established word for an incomplete AI (never "broken") —
// `src/creatorStudio/ReadinessPanel.tsx`'s own header,
// `context/decisions.md#vyakti-rooms-v1-adopted`. Plain, functional prose;
// survives a read-aloud test; no em-dash (`scripts/check-copy.mjs`'s own
// rule, which this file's directory is not exempt from even though the
// Rooms-vocabulary word list itself is scoped to `src/studio/`/`src/room/`
// only, `scripts/copy-room-scope.mjs`'s own header).
export const TEXT_APPRENTICE_DISCLOSURE =
  "You're talking with an AI apprentice. It is still learning who this person is from what they have shared, and it has no voice yet.";

// Budget reserved so the reply is what gets shortened, never the
// disclosure — the opposite failure shape CLAUDE.md already names for
// prompt truncation (the newest, safety-relevant text sits at the end and
// must never be the part silently cut).
function withApprenticeDisclosure(reply) {
  const budget = Math.max(0, 1_600 - TEXT_APPRENTICE_DISCLOSURE.length - 1);
  const body = cleanDialogueText(reply, budget);
  return `${TEXT_APPRENTICE_DISCLOSURE} ${body}`.trim();
}

// WS-R161. The text-ready conversation door: no `vy_replica_runtime_
// capability`, no session, no turn history — a single, stateless compiled
// reply from the owner's own approved person sheet (WS-R151), their vibe
// line (WS-R153) and the profile's claims, through the SAME compiler the
// voice-ready path uses (`compileReplicaRuntimeCore`/`compileDialoguePrompt`,
// unchanged functions, a new caller). Never a fabricated voice and never a
// claim of likeness — `can_voice` is always `false`, and the voice sample
// and mirror call stay refused with the honest blocker naming voice
// (`api/replica-voice-preview.js`/`api/mirror-call.js`, neither touched by
// this workstream — both already refuse honestly with no active voice
// profile, the SAME gap WS-R158 already named one layer under this one).
//
// Deliberately NOT wired into `vy_replica_dialogue_turn`/session history:
// that machinery is FK-bound to `vy_replica_runtime_capability`
// (`db/migrations/023_replica_runtime.sql`), which a text-only replica has
// none of by design (`textBlockers`'s own header in `_replica-runtime.js`).
// Building a second, lighter session/turn ledger for text alone is real,
// named, future scope — not reached this workstream, stated here rather
// than implied: a text-ready conversation has no server-side memory of its
// own prior turns between requests.
export async function generateOwnedTextDialogue(db, ownerUserId, rawInput, generator, signal) {
  if (!generator || typeof generator.generate !== "function" || !generator.family || !generator.name || !generator.version || !generator.model)
    fail("dialogue_generator_unavailable", 503);
  const rawMessage = String(rawInput?.message || "");
  if (rawMessage.length > 4_000) fail("dialogue_message_too_large", 413);
  if (hasMalformedDialogueUnicode(rawMessage)) fail("dialogue_message_invalid", 400);
  const rid = replicaId(rawInput?.replica_id);
  const message = cleanDialogueText(rawMessage, 4_000);
  if (!message) fail("dialogue_message_required", 400);
  const status = await ownedRuntimeStatus(db, ownerUserId, rid);
  if (!status) fail("dialogue_runtime_not_active");
  if (!status.text_ready) fail("dialogue_text_not_ready", 409, { blockers: status.text_blockers });
  const profile = await loadOwnedTextProfile(db, ownerUserId, rid);
  if (!profile) fail("dialogue_text_not_ready", 409, { blockers: status.text_blockers });
  const vibe = await getReplicaVibe(db, ownerUserId, rid).catch(() => null);
  const core = compileReplicaRuntimeCore(profile.definition, null, message, undefined, vibe);
  const prompt = compileDialoguePrompt({ core, relationship: "", evidence: "", history: [], message });
  signal?.throwIfAborted();
  const generated = await generator.generate({ prompt, signal });
  const output = validateDialogueOutput(generated?.output);
  return {
    has_continuity: false,
    turn_id: randomUUID(),
    session_id: null,
    reply: withApprenticeDisclosure(output.reply),
    delivery: output.delivery,
    can_voice: false,
    billing_state: "not_metered",
    created_at: new Date().toISOString(),
    text_ready: true,
  };
}

export async function generateOwnedDialogue(db, ownerUserId, rawInput, generator, signal, {resolveCandidateGenerator} = {}) {
  if (!generator || typeof generator.generate !== "function" || !generator.family || !generator.name || !generator.version || !generator.model)
    fail("dialogue_generator_unavailable", 503);
  // Reject the current question whole before normalization or any scoped IO.
  // Its accepted size uses the same UTF-16 units as the prompt's 4000 cap.
  const rawMessage = String(rawInput?.message || "");
  if (rawMessage.length > 4_000) fail("dialogue_message_too_large", 413);
  if (hasMalformedDialogueUnicode(rawMessage)) fail("dialogue_message_invalid", 400);
  const input = {
    replica_id: replicaId(rawInput?.replica_id),
    session_id: rawInput?.session_id || null,
    channel: String(rawInput?.channel || "private_chat"),
    message: cleanDialogueText(rawMessage, 4_000),
    trace_id: TRACE.test(String(rawInput?.trace_id || "")) ? String(rawInput.trace_id) : `dialogue_${randomUUID().replaceAll("-", "")}`,
  };
  if (!input.message) fail("dialogue_message_required", 400);
  // WS-R161. A replica with no ACTIVE voice capability falls back to the
  // text-ready door rather than the old unconditional
  // `dialogue_runtime_not_active` refusal — the one behavior this
  // workstream changes in this function. Every other line below is
  // untouched: a voice-ready replica's turn is byte-identical to before.
  const runtime = await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id);
  if (!runtime) return generateOwnedTextDialogue(db, ownerUserId, rawInput, generator, signal);
  if (runtime.capability.private_selection && input.channel !== "private_chat") fail("candidate_runtime_text_only");
  if (runtime.candidateBinding && resolveCandidateGenerator) generator = await resolveCandidateGenerator();
  assertCandidateGenerator(runtime, generator);
  const session = await ensureSession(db, ownerUserId, runtime, input);
  const [snapshot, history, evidence, ownerFacts] = await Promise.all([
    loadPrivateRelationshipSnapshot(db, runtime, { strict: true }),
    loadSessionHistory(db, ownerUserId, runtime, session.session_id),
    rawInput.recall_previous === true && input.channel === "private_chat"
      ? readPrivateContinuity(db, ownerUserId, input.replica_id, session.session_id, input.message) : [],
    // WS-R167: the owner's own extracted memory (facts consolidated from
    // earlier Meet turns), never a follower's. `OWNER_MEMORY_RECALL_SQL`'s
    // own authority CTE already returns nothing when the owner has memory
    // off (context/decisions.md#ws-r167-owner-memory-epoch-is-a-consent-window),
    // so this needs no separate consent branch here - the SAME "the SQL is
    // the gate" discipline `api/_agentscope.js` names for the agent axis.
    db(OWNER_MEMORY_RECALL_SQL, ownerMemoryAuthority({ replica_id: input.replica_id, owner_user_id: ownerUserId })).catch(() => []),
  ]);
  const prompt = compileDialoguePrompt({
    core: candidateRuntimeCore(runtime, input.message),
    relationship: [compileRelationshipTail(snapshot), ownerMemoryTail(ownerFacts)].filter(Boolean).join("\n\n"),
    evidence: continuityPrompt(evidence),
    history,
    message: input.message,
  });
  const turn = await beginDialogueTurn(db, ownerUserId, runtime, session, generator, input, prompt, evidence);
  let reservation = null;
  let spendBeginState = "not_attempted";
  let providerStarted = false;
  let settled = false;
  let settlementAttempted = false;
  let measuredUsage = null;
  let billingState = "not_metered";
  try {
    reservation = await reserveFoundrySpend(db, {
      operation: "dialogue",
      requestKey: turn.turn_id,
      adapter: generator,
      messages: prompt.messages,
      ...(generator.billing?.budget_env ? {env:generator.billing.budget_env} : {}),
    });
    if (reservation) {
      spendBeginState = "attempted_unknown";
      await beginFoundrySpend(db, reservation);
      spendBeginState = "acknowledged";
    }
    assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);
    assertCandidateGenerator(runtime, generator);
    signal?.throwIfAborted();
    providerStarted = true;
    const generated = await generator.generate({ prompt, signal });
    measuredUsage = generated?.usage || null;
    // Candidate refusals still incurred measured provider usage. Settle before
    // revision/authority validation without ever returning the refused answer.
    if (runtime.candidateBinding && reservation) {
      settlementAttempted = true;
      try { await settleFoundrySpend(db, reservation, generated.usage); settled = true; billingState = "settled"; }
      catch (error) { await markFoundrySpendUncertain(db, reservation, error); billingState = "reconcile_required"; }
    }
    assertCandidateResponse(runtime, generator, generated);
    assertCandidateRuntimeUnchanged(runtime, await loadOwnedRuntimeContext(db, ownerUserId, input.replica_id), input.message);
    const output = validateDialogueOutput(generated?.output);
    const finished = await finishDialogueTurn(db, ownerUserId, runtime, turn, output);
    if (!finished) fail("dialogue_authorization_changed");
    if (reservation && !runtime.candidateBinding) {
      settlementAttempted = true;
      try {
        await settleFoundrySpend(db, reservation, generated.usage);
        billingState = "settled";
        settled = true;
      } catch (error) {
        await markFoundrySpendUncertain(db, reservation, error);
        billingState = "reconcile_required";
      }
    }
    return {
      has_continuity: evidence.length > 0,
      has_memory: ownerFacts.length > 0,
      turn_id: finished.turn_id,
      session_id: finished.session_id,
      reply: output.reply,
      delivery: output.delivery,
      can_voice: evidence.length === 0 && !runtime.capability.private_selection && !runtime.candidateBinding,
      billing_state: billingState,
      created_at: finished.created_at,
    };
  } catch (error) {
    if (reservation && providerStarted && !settled && !settlementAttempted && (error?.measured_usage || measuredUsage)) {
      settlementAttempted = true;
      try { await settleFoundrySpend(db, reservation, error?.measured_usage || measuredUsage); settled = true; }
      catch { /* Preserve an unresolved reservation for reconciliation. */ }
    }
    if (reservation && !settled) {
      if (providerStarted || spendBeginState === "attempted_unknown") await markFoundrySpendUncertain(db, reservation, error);
      else await releaseFoundrySpendBeforeCall(db, reservation, error).catch(() => null);
    }
    await failDialogueTurn(db, ownerUserId, turn.turn_id, error);
    throw error;
  }
}

export const PRIVATE_DIALOGUE_SPEECH_SQL = `select t.turn_id,a.content,t.delivery_plan
       from vy_replica_dialogue_turn t
       join meera_log a on a.id=t.assistant_log_id and a.agent_id=t.agent_id and a.device_id=t.device_id and a.role='her'
       join vy_replica_runtime_capability c
         on c.capability_id=t.capability_id and c.replica_id=t.replica_id and c.owner_user_id=t.owner_user_id
        and c.agent_id=t.agent_id and c.subject_person_id=t.person_id and c.profile_version=t.profile_version
        and c.calibration_version=t.calibration_version and c.state='active'
       join vy_replica r on r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id and r.lifecycle='active'
      where coalesce(t.continuity_refs,'[]'::jsonb)='[]'::jsonb and t.turn_id=$1::uuid and t.replica_id=$2::uuid and t.owner_user_id=$3::uuid and t.state='complete'
        and not c.candidate_binding_required
        and ${ownerPrivateCapabilityAuthoritySql('c','r')}
        and exists(select 1 from vy_replica_consent x
          where x.replica_id=r.replica_id and x.owner_user_id=r.owner_user_id
            and x.scope='inference' and x.policy_version=$4 and x.revoked_at is null
            and (x.expires_at is null or x.expires_at>now()))
      limit 1`;

export async function loadOwnedDialogueSpeech(db, ownerUserId, input) {
  const rid = replicaId(input?.replica_id);
  const turnId = safeUuid(input?.dialogue_turn_id, "valid_dialogue_turn_id_required");
  const rows = await db(
    PRIVATE_DIALOGUE_SPEECH_SQL,
    [turnId, rid, ownerUserId, REPLICA_POLICY_VERSION],
  );
  if (!rows[0]) fail("dialogue_turn_not_speakable", 409);
  const output = validateDialogueOutput({ reply: rows[0].content, delivery: rows[0].delivery_plan });
  return { dialogue_turn_id: rows[0].turn_id, text: output.reply, style: dialogueSpeechStyle(output.delivery) };
}

export function createReplicaDialogueHandler({ db, requireUser, resolveGenerator, resolveCandidateGenerator }) {
  if (![db, requireUser, resolveGenerator].every((dependency) => typeof dependency === "function"))
    throw new Error("replica dialogue dependencies required");
  return async function replicaDialogue(req, res) {
    const aborter = new AbortController();
    req.on?.("close", () => aborter.abort(new Error("client_closed")));
    try {
      const user = await requireUser(req);
      if (req.method === "GET") {
        const history = await readOwnedDialogueHistory(db, user.id, req.query || {});
        return res.status(200).json({ history });
      }
      if (req.body?.op === "continuity_sources") {
        const sources = await readPrivateContinuitySources(db, user.id, req.body);
        return res.status(200).json({ sources });
      }
      if (req.body?.op === "open_session") {
        const session = await openOwnedDialogueSession(db, user.id, req.body);
        return res.status(201).json({ session });
      }
      // WS-R167: the owner's own continuity in Meet. Same op names and
      // response shapes `api/room.js` exposes for a Room follower
      // (`api/_room-surface.js`), over the owner's own dyad.
      if (req.body?.op === "memory_status") return res.status(200).json(await ownerMemoryStatus(db, user.id, req.body));
      if (req.body?.op === "memory_toggle") return res.status(200).json(await ownerMemoryToggle(db, user.id, req.body));
      if (req.body?.op === "memory_facts") return res.status(200).json(await ownerRememberedThings(db, user.id, req.body));
      if (req.body?.op === "memory_correct") return res.status(200).json(await ownerCorrectRememberedThing(db, user.id, req.body));
      if (req.body?.op === "memory_classify") return res.status(200).json(await ownerReclassifyRememberedThing(db, user.id, req.body));
      if (req.body?.op === "memory_forget") return res.status(200).json(await ownerForgetRememberedThing(db, user.id, req.body));
      if (req.body?.op === "relstate") return res.status(200).json(await ownerRelState(db, user.id, req.body));
      if (req.body?.op === "relstate_reset") return res.status(200).json(await ownerRelStateReset(db, user.id, req.body));
      if (req.body?.op) fail("unknown_op", 400);
      const generator = await resolveGenerator();
      const turn = await generateOwnedDialogue(db, user.id, req.body || {}, generator, aborter.signal, {resolveCandidateGenerator});
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
