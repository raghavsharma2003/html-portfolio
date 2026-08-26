// The server-side teacher-sheet loader — Gurukul WS-B.
//
// SPEC-GURUKUL.md §2: the registry is compile-time static today; Gurukul needs
// DB-backed sheets, "an AgentModule constructed at runtime from the stored
// sheet ... The static registry stays for Maya/Kabir; the dynamic loader is
// additive." This is that loader.
//
// ── it constructs, it does not re-implement ───────────────────────────────
// The module is built by `sheetToModule` out of api/_engine.gen.js — the same
// function `agents/teacher.ts` spells out statically, bundled from the real
// TypeScript by scripts/build-engine-bundle.mjs. src/engine/serverEntry.ts's
// header has the argument in full and it applies here with one extra edge: a
// hand-ported constructor in api/ would be a second definition of what a
// teacher clone IS, and a teacher clone is a clone of a real, named, living
// person published under their consent. A drifted second copy of that would
// keep returning 200.
//
// ── the registration gate, and why there are three of it ──────────────────
// safety-floor-teacher.md §2.2: consent gates registration; revocation
// DEREGISTERS the module rather than asking the clone to stop. A sheet loads
// only when `status='published'` AND `consent_artifact_id is not null`, and
// that rule is enforced three times on purpose:
//
//   1. `vy_teacher_sheet_publish_gate`, a CHECK constraint — a row that
//      violates it cannot exist (migration 051);
//   2. the WHERE clause below — a row that violates it is never READ, the
//      same discipline api/_agentscope.js applies one axis over
//      (`gate0-structural`: instructions leaked 57-98%, the SQL predicate
//      leaked 0 of 31,122);
//   3. `consentGateBlockers` over the row that came back — which catches the
//      case the other two cannot: a WHERE clause someone widens later.
//
// Three copies of a predicate is normally a smell. Here the failure being
// guarded is a clone of a real teacher still talking to a child after that
// teacher withdrew consent, and the house rule for a harm the next turn does
// not undo is two independent layers. This has three because the third is
// free.
//
// ── FAIL CLOSED, and never toward Meera ───────────────────────────────────
// Every failure below throws a structured error. NOTHING here returns a
// default agent. A wrong-agent fallback is the disaster case for this product:
// the student asked their physics teacher a question and got a 24-year-old
// companion persona built for consenting adults, with none of the minor
// defaults and none of the clone disclosure — and it would look like a working
// product from every log line. api/_agentscope.js states the same law in SQL
// ("an unbound or undefined agent returns ZERO rows rather than everyone's"),
// api/tg.js states it in prose ("a degraded persona that still answers is the
// `silent-truncation` failure shape"). This module states it by having no
// fallback branch to take.
import { q } from "./_db.js";
import { sheetToModule, validateTeacherSheet, consentGateBlockers } from "./_engine.gen.js";

export const TEACHER_SHEET_STATUSES = Object.freeze(["draft", "validated", "published", "revoked"]);

/** Structured, loud, and carrying the blockers — _replica-runtime.js's shape.
 *  A caller that has to tell a studio WHY a clone is unreachable cannot do it
 *  from a boolean, and a caller that has to tell a STUDENT anything must not
 *  be able to reach the teacher's consent state at all, which is why the
 *  details ride on the error and never on a response body. */
function sheetError(code, status = 409, details) {
  const error = Object.assign(new Error(code), { code, status });
  if (details) error.details = details;
  return error;
}

/**
 * The one read. Joined on `vy_agent.slug` because a slug is what a surface
 * carries and an `agent_id` is what the tables are keyed by — and the join
 * makes an unknown slug return zero rows rather than an unfiltered scan.
 *
 * Both gate clauses are IN THE PREDICATE, not applied after: a disqualified
 * row that reaches JS can still be logged, partially rendered, or escape
 * through a branch added later (_disclosure.js's argument, transferred).
 *
 * `order by published_at desc limit 1` is belt-and-braces over migration
 * 051's partial unique index, which already makes at most one row publishable
 * per agent.
 */
async function publishedRow(slug, timeoutMs) {
  const rows = await q(
    `select s.sheet_id, s.agent_id, s.version, s.sheet, s.status,
            s.consent_artifact_id, s.published_at, a.slug
       from vy_teacher_sheet s
       join vy_agent a on a.agent_id = s.agent_id
      where a.slug = $1
        and s.status = 'published'
        and s.consent_artifact_id is not null
      order by s.published_at desc
      limit 1`,
    [slug],
    timeoutMs,
  );
  return rows[0] || null;
}

function parsedSheet(value) {
  if (value && typeof value === "object") return value;
  if (typeof value !== "string") return null;
  try {
    const result = JSON.parse(value);
    return result && typeof result === "object" ? result : null;
  } catch {
    return null;
  }
}

/**
 * Load the published TeacherSheet for `slug` and construct its AgentModule.
 *
 * Throws on every failure path; returns `{ module, sheet, row }` or nothing.
 * The caller decides what a student sees — this module's contract is that a
 * clone which may not exist is unreachable, not degraded.
 */
export async function loadTeacherAgent(slug, timeoutMs = 10_000) {
  if (typeof slug !== "string" || !slug.trim()) {
    throw sheetError("teacher_sheet_bad_slug", 400);
  }

  const row = await publishedRow(slug.trim(), timeoutMs);
  // No row means one of: no such agent, no sheet, not published, consent
  // withdrawn. Deliberately ONE error code and no probing follow-up query:
  // "this teacher has revoked their consent" is the teacher's business, and a
  // caller that could distinguish the cases could enumerate which teachers had
  // revoked. Unreachable is unreachable.
  if (!row) throw sheetError("teacher_sheet_unavailable", 404, { slug });

  // Clause 3 (see the header): the WHERE clause already excluded these, so
  // reaching here means the predicate was widened, not that a row is bad.
  const blockers = consentGateBlockers({
    status: row.status,
    consent_artifact_id: row.consent_artifact_id,
  });
  if (blockers.length) {
    throw sheetError("teacher_sheet_consent_gate", 409, { slug, sheet_id: row.sheet_id, blockers });
  }

  const sheet = parsedSheet(row.sheet);
  if (!sheet) throw sheetError("teacher_sheet_unparseable", 500, { slug, sheet_id: row.sheet_id });

  // Re-validated at LOAD, not merely at publish. A sheet that was valid when
  // it was published and is not valid now — the helpline allowlist moved, a
  // field's rule tightened — must fail closed rather than quietly serve the
  // version that predates the rule. This is the same function the studio's
  // publish path runs, so the two can never disagree about what valid means.
  const validation = validateTeacherSheet(sheet);
  if (!validation.ok) {
    throw sheetError("teacher_sheet_invalid", 409, {
      slug,
      sheet_id: row.sheet_id,
      errors: validation.errors,
    });
  }

  const module = sheetToModule(sheet);

  // The wrong-agent guard. A module whose slug is not the slug that was asked
  // for is the disaster case with a different name — a student reaching a
  // different teacher's clone — and it is reachable through one mis-joined
  // row. `pk-is-an-arbiter` is the precedent: an identity key that does not
  // mean what its writer thought corrupts silently.
  if (module.slug !== row.slug || module.slug !== slug.trim()) {
    throw sheetError("teacher_sheet_slug_mismatch", 500, {
      requested: slug.trim(),
      row_slug: row.slug,
      sheet_slug: module.slug,
    });
  }

  return {
    module,
    sheet,
    row: {
      sheet_id: row.sheet_id,
      agent_id: row.agent_id,
      version: row.version,
      published_at: row.published_at,
    },
  };
}

/**
 * The publish-time half, for the studio: validate the sheet CONTENT and the
 * consent state together, and say why not.
 *
 * Returns `{ ok, errors, blockers }` rather than throwing, because a studio
 * showing a teacher what to fix needs every failure at once, and because
 * publishing is the one moment where "not yet" is a normal answer rather than
 * an error. The floor invariants and the prompt budget are NOT run here —
 * they run over compiled output (teacher-sheet-spec.md §4.4/§4.5) and are
 * driven by evals/teachersheet.mjs and the release gate.
 */
export function checkPublishable(sheet, rowState) {
  const validation = validateTeacherSheet(sheet);
  const blockers = consentGateBlockers({
    status: "published",
    consent_artifact_id: rowState?.consent_artifact_id ?? sheet?.consentArtifactId ?? null,
  }).filter((b) => b !== "sheet_not_published");
  return {
    ok: validation.ok && blockers.length === 0,
    errors: validation.errors,
    blockers,
  };
}
