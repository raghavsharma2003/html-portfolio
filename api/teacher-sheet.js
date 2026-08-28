// The teacher-sheet studio endpoint — the HTTP half of Gurukul WS-F.
//
//   GET  /api/teacher-sheet?replica_id=…       read the owner's own sheet
//   PUT  /api/teacher-sheet                    save the draft
//   POST /api/teacher-sheet {op:"save_draft"}  same, the client's spelling
//   POST /api/teacher-sheet {op:"validate"}    the gate's verdict, no write
//   POST /api/teacher-sheet {op:"publish"}     the gate, and it fails closed
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape — and
// every decision in `api/_teacher-sheet-draft.js`, where a fake `db` can reach
// it. `api/replica-claims.js` over `api/_replica-claims.js` is the house shape
// this copies, and the reason is `dead-writers`: the DB is absent in this
// environment, so logic that lived in the handler would be logic no eval could
// ever run.
//
// ── PUT and POST both save, on purpose ────────────────────────────────────
// `src/studio/teacherSheetApi.ts` already shipped its half of this contract
// and it posts `{op:"save_draft"}`. The brief for this endpoint asks for PUT.
// Refusing one of them would either break the client that is already written
// or ignore the brief, so both are accepted and both call the same function —
// which is not two behaviours, it is one behaviour with two spellings, and the
// eval drives it through both.
//
// ── what a response never carries ─────────────────────────────────────────
// The consent artifact's uuid. A studio needs "consent on file / not yet" to
// render a gate; it does not need the identifier, and `api/_teachersheet.js`
// states the governing rule — a caller that must tell a STUDENT anything must
// not be able to reach a teacher's consent state at all. The client shape in
// the module below reduces it to `"present" | null` before it can leave.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import {
  TeacherSheetDraftError,
  readOwnedTeacherSheet,
  saveOwnedTeacherSheetDraft,
  publishOwnedTeacherSheet,
  validateSheetBody,
  statsForEvidence,
} from "./_teacher-sheet-draft.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, PUT, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "PUT", "POST"].includes(req.method)) {
    return res.status(405).json({ error: "GET, PUT or POST only" });
  }
  // Two buckets, IP then user, at `api/replica-claims.js`'s numbers. The IP
  // bucket is the cheaper one to trip and it is checked before auth, because
  // an unauthenticated flood must not cost a Supabase round trip each.
  if (!allow(ipOf(req), "teacher_sheet", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "teacher_sheet_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const sheet = await readOwnedTeacherSheet(q, user.id, req.query?.replica_id);
      return sheet ? res.status(200).json({ sheet }) : notFound(res);
    }

    const body = req.body || {};
    const op = req.method === "PUT" ? "save_draft" : String(body.op || "");

    if (op === "save_draft") {
      const draft = req.method === "PUT" ? (body.draft ?? body.sheet ?? body) : body.draft;
      const saved = await saveOwnedTeacherSheetDraft(q, user.id, body.replica_id ?? req.query?.replica_id, draft);
      if (!saved) return notFound(res);
      // A draft is SAVED even when it does not yet validate — an incomplete
      // draft is the normal state of the screen and refusing the write would
      // lose a teacher's work. So this is 200 with the field errors attached,
      // never a 4xx: `errors` is what the studio renders per row.
      obsBestEffort("teacher_sheet.draft_saved", { errors: saved.errors.length });
      return res.status(200).json({ sheet: saved.sheet, ok: saved.ok, errors: saved.errors });
    }

    if (op === "validate") {
      // Pure — no read, no write, no ownership question, because it validates
      // the body the caller just sent rather than anything stored.
      const verdict = validateSheetBody(body.draft ?? body.sheet, body.evidence);
      return res.status(200).json({
        ...verdict,
        stats: statsForEvidence(body.evidence),
      });
    }

    if (op === "publish") {
      const result = await publishOwnedTeacherSheet(q, user.id, body.replica_id, {
        evidence: body.evidence,
      });
      if (!result) return notFound(res);
      obsBestEffort("teacher_sheet.publish", {
        ok: result.ok,
        errors: result.errors.length,
        blockers: result.blockers,
        // A count and a marker, never a fragment: `_obs.js`'s law is "COUNTS,
        // LABELS AND DECISIONS, never conversation text", and a boardVerbalism
        // is a real person's words.
        phrase_bank: result.phraseBank?.verified
          ? "verified"
          : (result.phraseBank?.unverifiedReason ?? "failed"),
      });
      // 409 rather than 200 when the gate refused: a publish that did not
      // publish must not answer with the success status, or a client that
      // checks only the code ships a clone it believes is live.
      return res.status(result.ok ? 200 : 409).json(result);
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof TeacherSheetDraftError) {
      return res.status(error.status).json({
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "teacher_sheet_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
