// "Never say this", as a predicate on the output — WS-R4.
//
// THIS FILE IMPORTS NOTHING. That is not tidiness, it is the reason it exists:
// `api/_surface.js` is the one door every surface's bytes leave by, it is
// imported by every surface including the Telegram webhook, and it must not
// grow a transitive dependency on storage configuration or a database client in
// order to apply an owner's rule. `api/_review-queue.js` owns the rows and the
// SQL; this module owns the MATCH, and both halves are pure.
//
// The argument for a predicate rather than a prompt line is measured, and it is
// written down in docs/gurukul/safety-floor-teacher.md quoting
// context/rejected.md's `gate0-structural`:
//
//   "prompt instructions leaked 57-98%; the SQL predicate leaked 0 of 31,122 …
//    a sentence in a brief is a preference, a predicate on the output is a
//    guarantee."
//
// There is a second, independent reason not to put the list in a prompt.
// `recited-prompt` (measured twice, in unrelated features): anything
// sentence-shaped in a brief gets recited verbatim. A list of forbidden
// sentences is a phrase bank pointed at exactly the strings it forbids.

/** A long rule is matched by its SHINGLES rather than whole. An AI that says
 *  the forbidden thing again will not reproduce the paragraph byte for byte,
 *  and a rule that only fires on an exact repeat is a rule that never fires.
 *  Six tokens is long enough that an ordinary sentence does not collide with it
 *  by accident and short enough that a rephrasing still trips it. */
export const NEVER_RULE_SHINGLE = 6;

/** Rules shorter than this after normalisation are refused at the door. A
 *  one-character pattern matches every reply this AI will ever produce, and
 *  silently muting a person's clone is worse than refusing their rule out
 *  loud. */
export const NEVER_RULE_MIN_CHARS = 3;

/** At most this many active rules are compiled per replica. A predicate on the
 *  reply path has to have a bounded cost, and an owner with 500 rules has a
 *  different problem than this queue solves. */
export const NEVER_RULE_MAX = 200;

/** Lowercased, punctuation-free, whitespace-collapsed. Used for BOTH halves of
 *  every comparison in this lane (card dedupe and rule matching) so the two can
 *  never disagree about what "the same text" means. */
export function normaliseForMatch(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Rows -> a matcher. PURE, so the eval drives the real predicate with no
 * database and `api/_surface.js` can hold a compiled set without importing
 * anything that touches Postgres.
 *
 * A revoked rule is skipped here as well as in the SQL that loads it. Two
 * independent layers for a property whose failure direction is "a clone says
 * the thing its owner forbade": the house rule `api/_teachersheet.js` states in
 * full.
 */
export function compileNeverRules(rows) {
  const compiled = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (compiled.length >= NEVER_RULE_MAX) break;
    if (row?.revoked_at) continue;
    const normalised = normaliseForMatch(row?.pattern);
    if (normalised.length < NEVER_RULE_MIN_CHARS) continue;
    const tokens = normalised.split(" ").filter(Boolean);
    const needles = tokens.length <= NEVER_RULE_SHINGLE
      ? [normalised]
      : tokens
        .slice(0, tokens.length - NEVER_RULE_SHINGLE + 1)
        .map((_, index) => tokens.slice(index, index + NEVER_RULE_SHINGLE).join(" "));
    compiled.push(Object.freeze({ rule_id: String(row?.rule_id || ""), needles: Object.freeze(needles) }));
  }
  return Object.freeze(compiled);
}

/**
 * Does this reply say something the owner forbade?
 *
 * Returns the rule id that matched, or "". Callers SUPPRESS on a match: saying
 * nothing is the fail-closed direction, and it is the same direction
 * `gateReply` already takes when the honesty gate is unavailable.
 */
export function replyViolatesNeverRule(text, compiledRules) {
  const hay = normaliseForMatch(text);
  if (!hay) return "";
  for (const rule of Array.isArray(compiledRules) ? compiledRules : []) {
    for (const needle of rule.needles || []) {
      if (needle && hay.includes(needle)) return rule.rule_id || "matched";
    }
  }
  return "";
}
