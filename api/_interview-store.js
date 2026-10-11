// The interview's database lane — WS-R5, migration 075.
//
// Every decision lives in `api/_interview-gaps.js` (pure) and every STATEMENT
// lives here, for `api/clone-chat.js` over `api/_clonechat.js`'s reason: a
// handler is HTTP shape and nothing else, and a decision a fake database cannot
// reach is a decision nothing offline can gate.
//
// ── OWNERSHIP IS A PREDICATE, NEVER A FILTER ─────────────────────────────
// Every statement here joins or scopes on `owner_user_id = $n::uuid`. A caller
// holding a session id it does not own gets zero rows, not somebody else's
// interview — `api/_agentscope.js`'s law and migration 009's, restated.
//
// ── WHAT THIS FILE DELIBERATELY CANNOT DO ────────────────────────────────
// Write a sheet field, write a persona, select a conditioning window, or create
// a source. An interview answer becomes a `vy_replica_source` row with
// `purpose='interview'` that the ORDINARY consented upload lane already created,
// and this file only STAMPS the purpose on a source the owner already owns. So
// there is no second way into the private biometric bucket
// (`api/_replica-storage.js` stays the one place that knows how it is
// addressed), and `mirror-reference-accumulation-was-inert` stays honoured:
// interview answers grow the SOURCE SET and change no voice.
import { randomUUID } from "node:crypto";
import { MirrorCallError, mirrorUuid } from "./_mirrorcall.js";

const SESSION_COLUMNS = `session_id, replica_id, owner_user_id, mirror_session_id,
  policy_version, started_at, ended_at, gaps, questions_asked, answers_captured, updated_at`;

const ANSWER_COLUMNS = `answer_id, session_id, replica_id, owner_user_id, gap_kind,
  topic, question_shape_hash, source_id, window_id, created_at`;

const SHA256 = /^[0-9a-f]{64}$/;

function fail(code, status = 409, details) {
  throw new MirrorCallError(code, status, details);
}

function jsonbArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
  return [];
}

export function clientInterviewSession(row) {
  if (!row) return null;
  const gaps = jsonbArray(row.gaps);
  return {
    interview_id: row.session_id,
    replica_id: row.replica_id,
    mirror_session_id: row.mirror_session_id,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    gaps,
    questions_asked: Number(row.questions_asked ?? 0),
    answers_captured: Number(row.answers_captured ?? 0),
    // Derived here rather than in the studio so the arithmetic that decides
    // "what would the next interview ask" has ONE definition. A gap is open
    // when it was never answered in this interview.
    open_gaps: gaps.length - Number(row.answers_captured ?? 0),
  };
}

export function clientInterviewAnswer(row) {
  if (!row) return null;
  return {
    answer_id: row.answer_id,
    gap_kind: row.gap_kind,
    topic: row.topic,
    question_shape_hash: row.question_shape_hash,
    // NULL is a REPORTED state, never a hidden one: an answer whose audio we
    // did not keep is different from an answer nobody gave, and only one of
    // those is our fault.
    source_id: row.source_id ?? null,
    audio_kept: row.source_id !== null && row.source_id !== undefined,
    window_id: row.window_id ?? null,
    created_at: row.created_at,
  };
}

/**
 * Open the interview for an OPEN Mirror Call, or return the one already open.
 *
 * The gap list is frozen onto the row here and never recomputed, for migration
 * 075's stated reason: an interview whose fourth question came from a different
 * ranking than its first is an interview nobody can reproduce.
 *
 * Returns null when the mirror session is not this owner's, is not open, or the
 * replica is gone. ONE answer for all three — `teacher_sheet_unavailable`'s
 * discipline, so a session id cannot be used as an existence oracle.
 */
export async function openInterviewSession(db, ownerUserId, mirrorSessionId, gaps, options = {}) {
  const msid = mirrorUuid(mirrorSessionId, "mirror_session_id_invalid");
  const interviewId = options.interviewId || randomUUID();
  const payload = JSON.stringify(Array.isArray(gaps) ? gaps : []);
  const rows = await db(
    `with mirror as (
       select s.session_id, s.replica_id, s.owner_user_id, s.policy_version
         from vy_mirror_session s
        where s.session_id = $1::uuid and s.owner_user_id = $2::uuid and s.state = 'open'
          and exists (
            select 1 from vy_replica r
             where r.replica_id = s.replica_id and r.owner_user_id = s.owner_user_id
               and r.lifecycle not in ('revoked','purging')
          )
     ), inserted as (
       insert into vy_interview_session
         (session_id, replica_id, owner_user_id, mirror_session_id, policy_version, gaps)
       select $3::uuid, m.replica_id, $2::uuid, m.session_id, m.policy_version, $4::jsonb
         from mirror m
       on conflict (mirror_session_id) do nothing
       returning ${SESSION_COLUMNS}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $2::uuid, 'interview.start', 'interview_session', session_id::text,
              policy_version, 'allowed',
              jsonb_build_object('gaps', jsonb_array_length(gaps),
                                 'mirror_session_id', mirror_session_id)
         from inserted
     )
     select * from inserted`,
    [msid, ownerUserId, interviewId, payload],
  );
  if (rows[0]) return clientInterviewSession(rows[0]);
  // Already open. The studio reconnecting after a dropped socket must RESUME
  // its interview, not be told its own call is unavailable.
  return getInterviewByMirrorSession(db, ownerUserId, msid);
}

export async function getInterviewByMirrorSession(db, ownerUserId, mirrorSessionId) {
  const rows = await db(
    `select ${SESSION_COLUMNS} from vy_interview_session i
      where i.mirror_session_id = $1::uuid and i.owner_user_id = $2::uuid
      limit 1`,
    [mirrorUuid(mirrorSessionId, "mirror_session_id_invalid"), ownerUserId],
  );
  return clientInterviewSession(rows[0]);
}

/** Every shape this replica has ALREADY answered, across every interview it has
 *  ever had. Fed back into `buildInterviewGaps` so a second interview does not
 *  re-ask what the first one answered — the interview's whole claim is that it
 *  asks only what the archive cannot answer, and an archive that just grew an
 *  answer can answer it. */
export async function answeredShapeHashes(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select distinct a.question_shape_hash from vy_interview_answer a
      where a.replica_id = $1::uuid and a.owner_user_id = $2::uuid
      limit 500`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return rows.map((row) => String(row.question_shape_hash || "")).filter(Boolean);
}

/** Count a question as ASKED. Separate from recording an answer because the two
 *  are separate facts: a question asked and never answered is the state the
 *  end-of-interview summary reports as "what the next interview would ask", and
 *  collapsing it into the answer count would make an unanswered question
 *  invisible. */
export async function markQuestionAsked(db, ownerUserId, interviewId) {
  const rows = await db(
    `update vy_interview_session i
        set questions_asked = i.questions_asked + 1, updated_at = now()
      where i.session_id = $1::uuid and i.owner_user_id = $2::uuid and i.ended_at is null
      returning ${SESSION_COLUMNS}`,
    [mirrorUuid(interviewId, "interview_id_invalid"), ownerUserId],
  );
  return clientInterviewSession(rows[0]);
}

/**
 * Record one answer, stamp its source as interview material, and bump the
 * count — in ONE statement.
 *
 * Three things happen together or none of them do, and that is the point.
 * A source stamped `purpose='interview'` with no answer row would be material
 * the person-model builder prefers for register with nothing saying why; an
 * answer row with an unstamped source would be an answer the register lane
 * cannot find. Neon has no transaction across `q()` calls, so the only way to
 * make them atomic is to make them one statement.
 *
 * The `on conflict do nothing` on the answer is what makes a retried window
 * idempotent: a second window against a gap that already has an answer changes
 * nothing at all, including the count. `vy_interview_answer_shape_ix` is the
 * arbiter, and `pk-is-an-arbiter` is why it is named in the clause rather than
 * left to a primary key that would never conflict.
 */
export async function recordInterviewAnswer(db, ownerUserId, interviewId, input) {
  const iid = mirrorUuid(interviewId, "interview_id_invalid");
  const answerId = input?.answerId || randomUUID();
  const hash = String(input?.questionShapeHash || "").toLowerCase();
  if (!SHA256.test(hash)) fail("interview_shape_hash_invalid", 400);
  const kind = String(input?.gapKind || "");
  const topic = String(input?.topic || "").slice(0, 120);
  if (!topic) fail("interview_topic_required", 400);
  const sourceId = input?.sourceId ? mirrorUuid(input.sourceId, "interview_source_id_invalid") : null;
  const windowId = input?.windowId ? mirrorUuid(input.windowId, "interview_window_id_invalid") : null;
  const rows = await db(
    `with owned as (
       select i.session_id, i.replica_id, i.owner_user_id, i.policy_version
         from vy_interview_session i
        where i.session_id = $1::uuid and i.owner_user_id = $2::uuid and i.ended_at is null
     ), stamped as (
       -- Owner-scoped, and scoped to the replica this interview belongs to. A
       -- source id from another of the owner's replicas is refused by the join,
       -- not by a branch: material from a different replica entering this
       -- replica's register lane is a cross-replica leak with the owner's own
       -- id on both sides, which is exactly the kind nobody would notice.
       update vy_replica_source s set purpose = 'interview', updated_at = now()
         from owned o
        where s.source_id = $3::uuid and s.replica_id = o.replica_id
          and s.owner_user_id = o.owner_user_id
       returning s.source_id
     ), inserted as (
       insert into vy_interview_answer
         (answer_id, session_id, replica_id, owner_user_id, gap_kind, topic,
          question_shape_hash, source_id, window_id)
       select $4::uuid, o.session_id, o.replica_id, o.owner_user_id, $5, $6, $7,
              (select source_id from stamped), $8::uuid
         from owned o
       on conflict (session_id, question_shape_hash) do nothing
       returning ${ANSWER_COLUMNS}
     ), counted as (
       update vy_interview_session i
          set answers_captured = i.answers_captured + 1, updated_at = now()
         from inserted n
        where i.session_id = n.session_id
       returning i.session_id
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select n.replica_id, $2::uuid, 'interview.answer', 'interview_answer', n.answer_id::text,
              o.policy_version, 'allowed',
              jsonb_build_object('gap_kind', n.gap_kind, 'topic', n.topic,
                                 'audio_kept', n.source_id is not null)
         from inserted n cross join owned o
     )
     select * from inserted`,
    [iid, ownerUserId, sourceId, answerId, kind, topic, hash, windowId],
  );
  return clientInterviewAnswer(rows[0]);
}

export async function listInterviewAnswers(db, ownerUserId, interviewId) {
  const rows = await db(
    `select ${ANSWER_COLUMNS} from vy_interview_answer a
      where a.session_id = $1::uuid and a.owner_user_id = $2::uuid
      order by a.created_at limit 200`,
    [mirrorUuid(interviewId, "interview_id_invalid"), ownerUserId],
  );
  return rows.map(clientInterviewAnswer);
}

/**
 * End the interview.
 *
 * Idempotent by the `ended_at is null` predicate: a second end returns null and
 * the caller reads the row. Nothing here writes a sheet, queues a fine-tune or
 * touches a conditioning selection, and that absence is the point — the whole
 * output of an interview is a set of consented SOURCES and the honest counts
 * below.
 */
export async function endInterviewSession(db, ownerUserId, interviewId) {
  const rows = await db(
    `with ended as (
       update vy_interview_session i
          set ended_at = now(), updated_at = now()
        where i.session_id = $1::uuid and i.owner_user_id = $2::uuid and i.ended_at is null
       returning ${SESSION_COLUMNS}
     ), audit as (
       insert into vy_replica_audit
         (replica_id, owner_user_id, action, object_kind, object_id, policy, outcome, facts)
       select replica_id, $2::uuid, 'interview.end', 'interview_session', session_id::text,
              policy_version, 'allowed',
              jsonb_build_object('questions_asked', questions_asked,
                                 'answers_captured', answers_captured)
         from ended
     )
     select * from ended`,
    [mirrorUuid(interviewId, "interview_id_invalid"), ownerUserId],
  );
  return clientInterviewSession(rows[0]);
}

/**
 * The interview sources this replica has, for the person-model builder.
 *
 * Returned as ids rather than as a boolean because the builder has to be able
 * to say WHICH claims came from a conversation, and a boolean would only let it
 * say that some did. `honesty-by-instruction`'s generalisation applies: if a
 * property is decidable from the rows, decide it on the rows.
 */
export async function interviewSourceIds(db, ownerUserId, replicaIdValue) {
  const rows = await db(
    `select s.source_id from vy_replica_source s
      where s.replica_id = $1::uuid and s.owner_user_id = $2::uuid and s.purpose = 'interview'
      order by s.created_at desc limit 500`,
    [mirrorUuid(replicaIdValue, "mirror_replica_id_invalid"), ownerUserId],
  );
  return rows.map((row) => String(row.source_id));
}

/** Everything `buildInterviewGaps` reads, in one round of owner-scoped reads.
 *
 *  `vy_replica_readiness` is WS-R3's table and MAY NOT EXIST on a deployment
 *  that has not applied their migration, so its read is wrapped and a failure
 *  degrades to `null` — which `buildInterviewGaps` reports as
 *  `detectors.readiness === false` rather than as "readiness is fine". A hard
 *  failure here would make the interview unreachable because a sibling
 *  workstream had not landed, which is a coupling neither of us asked for. */
export async function readInterviewInputs(db, ownerUserId, replicaIdValue) {
  const rid = mirrorUuid(replicaIdValue, "mirror_replica_id_invalid");
  const [claims, contextItems, spans, sheet, answered] = await Promise.all([
    db(
      `select c.claim_id, c.domain, c.key, c.body, c.origin, c.confidence, c.status,
              c.t_valid_from, c.t_valid_to, c.created_at, c.updated_at,
              d.decision
         from vy_replica_claim c
         join vy_replica r on r.replica_id = c.replica_id and r.owner_user_id = $2::uuid
         left join lateral (
           select x.decision from vy_replica_claim_decision x
            where x.claim_id = c.claim_id and x.replica_id = c.replica_id
              and x.owner_user_id = c.owner_user_id
            order by x.created_at desc limit 1
         ) d on true
        where c.replica_id = $1::uuid and c.owner_user_id = $2::uuid
        order by c.created_at desc limit 500`,
      [rid, ownerUserId],
    ),
    db(
      `select i.item_id, i.source_name, i.source_url, i.status, i.extracted_chars
         from vy_context_item i
        where i.replica_id = $1::uuid and i.owner_user_id = $2::uuid
        order by i.created_at desc limit 200`,
      [rid, ownerUserId],
    ),
    db(
      `select e.source_id, e.span_start_ms, e.span_end_ms, e.value
         from vy_replica_processing_evidence e
        where e.replica_id = $1::uuid and e.owner_user_id = $2::uuid
          and e.evidence_type = 'transcript_span'
        order by e.created_at desc limit 200`,
      [rid, ownerUserId],
    ),
    db(
      `select t.sheet from vy_teacher_sheet t
         join vy_replica r on r.agent_id = t.agent_id
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and t.status <> 'revoked'
        order by case when t.status = 'published' then 0 else 1 end, t.published_at desc nulls last
        limit 1`,
      [rid, ownerUserId],
    ),
    answeredShapeHashes(db, ownerUserId, rid),
  ]);
  let readiness = null;
  try {
    const rows = await db(
      `select * from vy_replica_readiness
        where replica_id = $1::uuid and owner_user_id = $2::uuid
        order by computed_at desc limit 1`,
      [rid, ownerUserId],
    );
    readiness = rows[0] || null;
  } catch {
    // The table is not deployed here. Reported, never guessed at.
    readiness = null;
  }
  const sheetRow = sheet[0]?.sheet;
  return {
    claims,
    // `vy_context_item` has no title column; the owner's own filename or link
    // is the only name this platform has for an item, and the gap model reads
    // it as such rather than inventing one.
    contextItems: contextItems.map((row) => ({
      item_id: row.item_id,
      source_name: row.source_name || "",
      title: row.source_url || "",
      status: row.status,
    })),
    // `vy_replica_processing_evidence.value` is WS-processing's blob and its
    // shape is theirs, so only the two fields this model reads are lifted out,
    // and a blob that carries neither contributes a span with no topic rather
    // than throwing. `text` is what a transcript span actually holds; `topic`
    // is read too in case a future span carries one.
    transcriptSpans: spans.map((row) => {
      const blob = row.value && typeof row.value === "object"
        ? row.value
        : (() => { try { return JSON.parse(String(row.value || "")); } catch { return {}; } })();
      return {
        source_id: row.source_id,
        topic: String(blob?.topic ?? ""),
        title: String(blob?.text ?? blob?.title ?? "").slice(0, 400),
      };
    }),
    sheet: sheetRow && typeof sheetRow === "object"
      ? sheetRow
      : (() => { try { return JSON.parse(String(sheetRow || "")); } catch { return null; } })(),
    readiness,
    answeredShapeHashes: answered,
  };
}
