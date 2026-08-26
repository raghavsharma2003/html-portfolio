// The studio-side half of the teacher sheet: an owner's own DRAFT row, its
// validation, and the publish transition (Gurukul WS-F).
//
// `api/_teachersheet.js` is the READER — it loads the one PUBLISHED sheet for
// a slug and constructs its AgentModule, and it deliberately has no writer.
// This file is the writer, and it is a separate module for the reason the two
// gates are separate: the reader's contract is "a clone that may not exist is
// unreachable, not degraded", and the writer's is "a teacher can always see
// what to fix". Those want opposite error postures (one code and no probing
// follow-up vs. every failure at once, named by field), and a module that had
// to do both would compromise one of them.
//
// ── the split, and why the handler is thin ────────────────────────────────
// `api/replica-claims.js` (43 lines: cors, rate limit, auth, dispatch, error
// shape) over `api/_replica-claims.js` (the logic, `db` injected as the first
// argument) is the house shape, and it is what makes this testable offline:
// `evals/ingest.mjs` calls these functions with a fake `db` and never needs a
// database. The DB is absent in this environment and the eval suite is offline
// by contract, so a design that could only be tested against Neon would be a
// design nothing tests.
//
// ── owner scoping is a PREDICATE, never a check afterwards ────────────────
// `api/_agentscope.js`'s governing measurement (`gate0-structural`): prompt
// instructions leaked 57-98%, the SQL predicate leaked 0 of 31,122. Every
// statement below carries `owner_user_id = $n` inside the WHERE clause or
// inside a `with owned as (...)` CTE the write selects from — never a row read
// first and compared in JS. A disqualified row that reaches JS can still be
// logged, partially rendered, or escape through a branch added later.
//
// A replica is the studio's handle; `vy_teacher_sheet` is keyed by `agent_id`.
// The join is `vy_replica.agent_id` (migration 015), and a replica with no
// agent bound yet is a distinct, nameable answer rather than a 404 that could
// mean four things.
import {
  validateTeacherSheet,
  transcriptStats,
  splitHeldOut,
} from "./_engine.gen.js";
import { checkPublishable } from "./_teachersheet.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A sheet jsonb ceiling. The demo sheet is ~14KB; 24 pedagogy fields and a
 *  40-row mistake bank do not reach ten times that. A cap exists because an
 *  unbounded jsonb body is an unbounded write, and because a 2MB "sheet" is
 *  never a sheet. */
export const SHEET_MAX_BYTES = 256 * 1024;

// Statuses this endpoint may WRITE are 'draft' and 'published', both spelled
// literally in the two statements below. `revoked` appears in neither on
// purpose: revocation deregisters a clone of a real named person and belongs
// to the consent lane (safety-floor-teacher.md §2.2), not to a draft editor.

export class TeacherSheetDraftError extends Error {
  constructor(code, status = 400, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

const fail = (code, status, details) => {
  throw new TeacherSheetDraftError(code, status, details);
};

function replicaIdOf(value) {
  const id = String(value ?? "").trim();
  if (!UUID.test(id)) fail("valid_replica_id_required", 400);
  return id;
}

/** The sheet as it arrives from a studio: a jsonb-shaped object and nothing
 *  else. A string is parsed (the loader's `parsedSheet` does the same on the
 *  way out), anything else is refused before it can reach a validator that
 *  would report it as forty missing fields. */
function sheetBodyOf(value) {
  let sheet = value;
  if (typeof sheet === "string") {
    try {
      sheet = JSON.parse(sheet);
    } catch {
      fail("sheet_unparseable", 400);
    }
  }
  if (!sheet || typeof sheet !== "object" || Array.isArray(sheet)) fail("sheet_must_be_an_object", 400);
  const encoded = JSON.stringify(sheet);
  if (encoded.length > SHEET_MAX_BYTES) {
    fail("sheet_too_large", 413, { bytes: encoded.length, max: SHEET_MAX_BYTES });
  }
  return sheet;
}

/**
 * The owner-scoped handle. Returns `{ replica_id, agent_id }` or null when the
 * replica is not this owner's — null, not a thrown 403, because "not yours"
 * and "does not exist" must be the same answer to a caller. A 403 on someone
 * else's uuid is an existence oracle, and the uuid space is exactly what an
 * enumerator has.
 */
async function ownedReplica(db, ownerUserId, replicaId) {
  const rows = await db(
    `select r.replica_id, r.agent_id
       from vy_replica r
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
      limit 1`,
    [replicaId, ownerUserId],
  );
  return rows[0] || null;
}

/** The client shape. `sheet` is the draft body; the row's own state rides
 *  beside it rather than inside it, which is the distinction `fromSheet.ts`
 *  draws: a `consentArtifactId` inside the jsonb is the studio's CLAIM, the
 *  column is the platform's RECORD, and the gate reads the column. */
function clientSheet(row) {
  if (!row) return { draft: null, updated_at: null, status: "draft", version: "", sheet_id: null, consent_artifact_id: null };
  return {
    draft: row.sheet ?? null,
    updated_at: row.updated_at ?? row.created_at ?? null,
    status: row.status,
    version: row.version ?? "",
    sheet_id: row.sheet_id,
    published_at: row.published_at ?? null,
    // The presence of consent, never its identifier. A studio needs to render
    // "consent on file / not yet"; it does not need the artifact's uuid, and a
    // uuid in a response body is a uuid in a browser's network log.
    consent_artifact_id: row.consent_artifact_id ? "present" : null,
  };
}

/** The newest sheet row for an owner's replica, whatever its status. Ordered
 *  newest-first so a draft written after a publish is what the studio edits —
 *  the loader's `order by published_at desc` answers a different question and
 *  filters to `published` before it asks. */
async function currentRow(db, ownerUserId, replicaId) {
  const rows = await db(
    `select s.sheet_id, s.agent_id, s.version, s.sheet, s.status,
            s.consent_artifact_id, s.created_at, s.updated_at, s.published_at
       from vy_teacher_sheet s
       join vy_replica r on r.agent_id = s.agent_id
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
      order by s.created_at desc
      limit 1`,
    [replicaId, ownerUserId],
  );
  return rows[0] || null;
}

// ─────────────────────────────────────────────────────────────────────────
// GET — read the owner's own sheet
// ─────────────────────────────────────────────────────────────────────────

export async function readOwnedTeacherSheet(db, ownerUserId, replicaIdValue) {
  const replicaId = replicaIdOf(replicaIdValue);
  const owned = await ownedReplica(db, ownerUserId, replicaId);
  if (!owned) return null;
  // An owned replica with no sheet row yet is an EMPTY draft, not a 404: a
  // studio opening the sheet screen for the first time is the normal case, and
  // `teacherSheetApi.ts` documents the caller as one that "should keep editing
  // locally rather than blocking the screen".
  return clientSheet(await currentRow(db, ownerUserId, replicaId));
}

// ─────────────────────────────────────────────────────────────────────────
// PUT / op:save_draft — validate, then persist
// ─────────────────────────────────────────────────────────────────────────
//
// Validation runs BEFORE the write and its failures are returned as data, not
// thrown. A draft is a work in progress and an incomplete one is the normal
// state of the screen — so the endpoint answers 200 with `{ ok:false, errors }`
// the studio renders per row, and the draft is STILL SAVED. Refusing to store
// a teacher's half-finished work because it does not yet pass a publish gate
// would lose the work, and the gate that matters runs at publish.
//
// That is a deliberate asymmetry with the publish op below, which fails closed.

export async function saveOwnedTeacherSheetDraft(db, ownerUserId, replicaIdValue, draftValue) {
  const replicaId = replicaIdOf(replicaIdValue);
  const sheet = sheetBodyOf(draftValue);
  const owned = await ownedReplica(db, ownerUserId, replicaId);
  if (!owned) return null;
  if (!owned.agent_id) fail("replica_has_no_agent", 409, { replica_id: replicaId });

  const validation = validateTeacherSheet(sheet);
  const version = typeof sheet.version === "string" ? sheet.version : "";

  // One statement, owner-scoped inside the CTE. `sheet_id` is derived from the
  // agent so a save is an UPSERT and a studio autosaving every keystroke does
  // not accumulate a row per keystroke. A published row is never overwritten
  // by a draft save — the `status <> 'published'` predicate on the update — so
  // the live clone cannot be edited out from under its students by the draft
  // screen; publishing is the only path that moves published bytes.
  const rows = await db(
    `with owned as (
       select r.agent_id from vy_replica r
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and r.agent_id is not null
     ), existing as (
       select s.sheet_id from vy_teacher_sheet s join owned o on o.agent_id = s.agent_id
        where s.status <> 'published' order by s.created_at desc limit 1
     ), updated as (
       update vy_teacher_sheet s
          set sheet = $3::jsonb, version = $4, status = 'draft', updated_at = now()
         from existing e where s.sheet_id = e.sheet_id and s.status <> 'published'
       returning s.sheet_id, s.agent_id, s.version, s.sheet, s.status,
                 s.consent_artifact_id, s.created_at, s.updated_at, s.published_at
     ), inserted as (
       insert into vy_teacher_sheet (sheet_id, agent_id, version, sheet, status)
       select $5::uuid, o.agent_id, $4, $3::jsonb, 'draft' from owned o
        where not exists (select 1 from existing)
       returning sheet_id, agent_id, version, sheet, status,
                 consent_artifact_id, created_at, updated_at, published_at
     )
     select * from updated union all select * from inserted`,
    [replicaId, ownerUserId, JSON.stringify(sheet), version, newSheetId()],
  );
  if (!rows[0]) fail("teacher_sheet_write_failed", 409, { replica_id: replicaId });

  return {
    ok: validation.ok,
    errors: validation.errors,
    sheet: clientSheet(rows[0]),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// op:publish — the gate, and it fails closed
// ─────────────────────────────────────────────────────────────────────────
//
// teacher-sheet-spec.md §4: "This is a gate, not a linter run: publish fails
// closed." Three things must be true and NONE of them is inferred from the
// request body:
//
//   1. the sheet CONTENT validates (`validateTeacherSheet`);
//   2. the consent gate is open, read off the COLUMN and not off the jsonb —
//      a `consentArtifactId` a studio typed into the sheet is a claim, and a
//      clone of a real living person may not exist on a claim;
//   3. the phrase-bank rule holds against held-out transcript evidence when
//      evidence is supplied, and is reported UNVERIFIED when it is not.
//
// `checkPublishable` composes all three. The write itself re-asserts the
// consent predicate in SQL, which is migration 051's argument transferred:
// "Both exist; only one of them cannot be forgotten by the next writer."

export async function publishOwnedTeacherSheet(db, ownerUserId, replicaIdValue, options = {}) {
  const replicaId = replicaIdOf(replicaIdValue);
  const owned = await ownedReplica(db, ownerUserId, replicaId);
  if (!owned) return null;

  const row = await currentRow(db, ownerUserId, replicaId);
  if (!row) fail("teacher_sheet_not_found", 404, { replica_id: replicaId });

  const sheet = typeof row.sheet === "string" ? sheetBodyOf(row.sheet) : row.sheet;

  // The consent blocker is computed from the COLUMN here, before
  // `checkPublishable` gets a chance to fall back to the sheet's own
  // `consentArtifactId`. That fallback is correct where it lives — the studio's
  // dry-run has no row to read and a claimed id is the only thing available —
  // but on THIS path a row exists, and `fromSheet.ts` states the distinction
  // exactly: "a `consentArtifactId` inside the sheet jsonb is the studio's
  // CLAIM, the column is the platform's RECORD, and the gate reads the column."
  // Without this line a studio could type a plausible uuid into the jsonb and
  // clear the JS gate; only the SQL predicate would still refuse, and a gate
  // whose JS half can be talked past is a gate that will be talked past the
  // day someone widens the SQL.
  const columnBlockers = row.consent_artifact_id ? [] : ["consent_artifact_missing"];
  const verdict = checkPublishable(sheet, row, evidenceOf(options.evidence));
  const blockers = [...new Set([...columnBlockers, ...verdict.blockers])];

  if (!verdict.ok || blockers.length) {
    // NOT an exception. A publish that cannot proceed is a normal answer with
    // a list of reasons — the same posture `checkPublishable`'s own header
    // gives ("publishing is the one moment where 'not yet' is a normal answer
    // rather than an error"), and the studio needs every row at once.
    return { ok: false, errors: verdict.errors, blockers, phraseBank: verdict.phraseBank, sheet: clientSheet(row) };
  }

  const rows = await db(
    `with owned as (
       select r.agent_id from vy_replica r
        where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid and r.agent_id is not null
     ), demoted as (
       update vy_teacher_sheet s set status = 'validated'
         from owned o
        where s.agent_id = o.agent_id and s.status = 'published' and s.sheet_id <> $3::uuid
       returning s.sheet_id
     )
     update vy_teacher_sheet s
        set status = 'published', published_at = now(), updated_at = now()
       from owned o
      where s.sheet_id = $3::uuid and s.agent_id = o.agent_id
        and s.consent_artifact_id is not null
    returning s.sheet_id, s.agent_id, s.version, s.sheet, s.status,
              s.consent_artifact_id, s.created_at, s.updated_at, s.published_at`,
    [replicaId, ownerUserId, row.sheet_id],
  );
  // Zero rows here means the SQL consent predicate refused what the JS gate
  // allowed. That is not a race to retry past — it is the third layer catching
  // a disagreement between the other two, and it is reported as such.
  if (!rows[0]) {
    fail("teacher_sheet_publish_gate", 409, { replica_id: replicaId, blockers: ["consent_artifact_missing"] });
  }

  return { ok: true, errors: [], blockers: [], phraseBank: verdict.phraseBank, sheet: clientSheet(rows[0]) };
}

// ─────────────────────────────────────────────────────────────────────────
// op:validate — the gate's verdict WITHOUT the write
// ─────────────────────────────────────────────────────────────────────────
//
// A dry run. It exists because the alternative — a teacher learning what the
// gate thinks by attempting a publish — makes the publish button the
// diagnostic tool, and a publish button that is routinely pressed to see what
// happens is a publish button that will one day succeed by accident.

export function validateSheetBody(draftValue, evidence) {
  const sheet = sheetBodyOf(draftValue);
  const verdict = checkPublishable(sheet, null, evidenceOf(evidence));
  return { ok: verdict.ok, errors: verdict.errors, blockers: verdict.blockers, phraseBank: verdict.phraseBank };
}

// ─────────────────────────────────────────────────────────────────────────
// evidence
// ─────────────────────────────────────────────────────────────────────────

/**
 * Normalize the optional transcript evidence a caller may attach to a publish
 * or a validate. Shapes accepted: `{ transcript: [{speaker,text}] }` (split
 * here) or `{ heldOut: [...] }` (already split).
 *
 * Bounded, because this is an untrusted body on a request path: 20k turns is
 * far beyond a 10-hour lecture corpus at any realistic turn length, and the
 * point of the cap is that a body cannot become a CPU bill.
 *
 * `undefined` in, `undefined` out — and that is the whole unverified case.
 * A caller that sends no evidence gets a verdict marked unverified, never a
 * silent pass, and never a fabricated empty transcript that would make the
 * >=5 rule fail every fragment for the wrong reason.
 */
const MAX_EVIDENCE_TURNS = 20_000;

export function evidenceOf(evidence) {
  if (!evidence || typeof evidence !== "object") return undefined;
  const turnsOf = (value) =>
    Array.isArray(value)
      ? value
          .slice(0, MAX_EVIDENCE_TURNS)
          .filter((t) => t && typeof t === "object")
          .map((t) => ({ speaker: String(t.speaker ?? ""), text: String(t.text ?? "") }))
      : null;

  const heldOut = turnsOf(evidence.heldOut);
  const transcript = turnsOf(evidence.transcript);
  if (!heldOut?.length && !transcript?.length) return undefined;
  return {
    heldOut: heldOut?.length ? heldOut : splitHeldOut(transcript).heldOut,
    teacherSpeaker: evidence.teacherSpeaker ? String(evidence.teacherSpeaker) : undefined,
  };
}

/** The measured signals off supplied evidence, for the studio's own review
 *  screen. Exposed here rather than as a fourth op with its own auth because
 *  it reads nothing and writes nothing — it is a pure function of a body. */
export function statsForEvidence(evidence) {
  const normalized = evidenceOf(
    Array.isArray(evidence?.transcript) || Array.isArray(evidence?.heldOut) ? evidence : null,
  );
  if (!normalized) return null;
  return transcriptStats(normalized.heldOut, { teacherSpeaker: normalized.teacherSpeaker });
}

/** A v4 uuid from the platform's own randomness. `crypto.randomUUID` is on
 *  globalThis in every runtime this deploys to; there is no fallback branch,
 *  because a fallback that generated a WEAKER id would put a guessable primary
 *  key on the table that decides which clone a student reaches
 *  (`pk-is-an-arbiter`). */
function newSheetId() {
  return globalThis.crypto.randomUUID();
}
