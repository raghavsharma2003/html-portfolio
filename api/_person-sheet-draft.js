// _person-sheet-draft.js — WS-R178. HumanOS drafted from a person's own
// sources.
//
// ── the gap this closes ────────────────────────────────────────────────────
// WS-R151 built the person sheet and its screen (`HumanOsStudio.tsx`), and a
// person had to TYPE every field by hand. `api/_person-model.js` already
// extracts who a person is from what they gave — files, links, a recording's
// transcript, an interview's answers — into CITED, owner-reviewed claims
// (`vy_replica_claim`, `vy_replica_claim_citation`). Nothing turned an
// accepted claim into a proposed sheet line. This is that mapping.
//
// ── a PURE function, on purpose ────────────────────────────────────────────
// This module takes the claims the caller already read (the SAME
// `ownedPersonModelStatus(db, ownerUserId, replicaId).claims` shape
// `api/replica-person-model.js`'s GET already returns, `clientClaim`'s own
// output) and returns PROPOSALS. It runs no query and writes nothing. The
// caller (`draftOwnedPersonSheet` in `api/_teacher-sheet-draft.js`) is the
// only place a DB is involved, and it is a READ, never a write — a proposal
// is not part of the sheet until the person accepts it and the studio saves
// through the EXISTING `op:"save_draft"` door, unchanged. There is nothing
// here for a migration to persist.
//
// ── the three laws this file is built around ──────────────────────────────
//
//  1. NOTHING THE PERSON DID NOT GIVE ENTERS. Every proposed line names the
//     claim id(s) behind it (`claimIds`) and carries at least one citation
//     excerpt (`citations`). A claim with no citation preview NEVER drafts a
//     line, even if it is accepted — `context/decisions.md
//     #ws-r151-...` and this file's own eval assert this with a negative
//     control. A REJECTED or undecided claim never reaches the field
//     matchers at all: only `decision === "accepted"` claims are read.
//  2. A GAP IS AN HONEST ANSWER, NEVER A FABRICATED LINE. Mirrors
//     `src/engine/ingest/sheetDraft.ts`'s own law for the teacher path
//     ("draft ∪ gaps is the whole sheet contract"): every tracked field not
//     proposed appears in `gaps` with a machine-readable reason. A person
//     with nothing given gets every field gapped and zero proposals — never
//     an exception, never a silently-filled field.
//  3. NEVER A LINE THE AI COULD SAY. `src/engine/shapelint.ts`'s own
//     measurement (`recited-prompt`: her own example quotes recited 4/5
//     turns, authored taste recited twice eight turns apart) is why
//     `fromSheet.ts`'s `validateTeacherSheet` runs `lintLine` over
//     `lifeTexture`/`tasteTopics`/`curiosityTopics`/`personValues`/
//     `personNeverSay`/`personTalk.codeSwitchNote`: no more than 14 words,
//     never capital-start-plus-terminal-punctuation, never first-person-
//     line-initial. `telegraphicFragment` below defeats exactly those three
//     shapes on every fragment this module proposes for those fields (and,
//     as a matter of product intent rather than enforcement, on
//     `identityWho`/`identityLife` too, which the validator does not lint
//     but whose own copy says "a few words... not a biography" /
//     "telegraphically"). A fragment that cannot be made safe is DROPPED,
//     never rewritten — rewriting a person's own words changes their
//     meaning, which this module has no authority to do.
//
// ── what this file deliberately does NOT draft ─────────────────────────────
// `name` (the display name already comes from the replica, and overwriting
// it from a possibly-different claim — a nickname, a legal name — would
// silently diverge from the identity the platform already shows) and
// `personLine` (the one-line shown to anyone before they talk to the AI is a
// short, curated, editorial line with no reliable 1:1 claim source;
// synthesizing one is a creative act this module is not licensed to perform
// on a person's behalf). Both are always reported as gaps with reason
// `needs-person-input`. See `context/decisions.md` for this workstream's own
// entry and its reversal condition.
//
// ── the domain:key vocabulary ───────────────────────────────────────────
// `api/_claim-extraction/contracts.js`'s `DOMAINS` is the closed set a claim
// may carry: identity, biography, event, relationship, knowledge, value,
// boundary, habit, language, delivery. `api/_person-model.js`'s
// `buildPersonModelDefinition` already reads specific `key`s under several of
// these (identity/self_name, language/register, habit/humor, ...) for the
// Person Model's own projection; the field map below reuses that SAME
// vocabulary where it already exists and defines two narrow, DOCUMENTED
// extensions (a `knowledge` claim's `key` containing "curio" routes to
// curiosity rather than taste; a `language` claim keyed "register"/"script"
// routes to HumanOs's own enum fields) rather than inventing a parallel one.

/** Word-count cap mirroring `src/engine/shapelint.ts`'s own `MAX_WORDS` — the
 *  gate every lint-checked field below is ultimately measured against. */
const LINT_MAX_WORDS = 14;

/** Mirrors `shapelint.ts`'s `FIRST_PERSON_LINE_INITIAL_RE`: a fragment that
 *  opens in first person is the shape a phrase bank recites from. Never
 *  rewritten to third person (that changes what a person said); simply not
 *  proposed. */
const FIRST_PERSON_RE = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;

/** Strips trailing terminal punctuation (which is what makes a capital-start
 *  line "sentence-shaped" under `shapelint.ts`'s own regex — removing it is
 *  therefore sufficient, on its own, to take a line out of that shape) and
 *  truncates to `maxWords`. Returns `null` when the result is empty or still
 *  opens in first person — a fragment this module will not propose rather
 *  than rewrite. */
function telegraphicFragment(text, maxWords) {
  const collapsed = String(text ?? "").replace(/\s+/g, " ").trim();
  if (!collapsed) return null;
  const stripped = collapsed.replace(/[.?!]+$/, "").trim();
  if (!stripped) return null;
  const words = stripped.split(" ").filter(Boolean);
  const capped = words.length > maxWords ? words.slice(0, maxWords).join(" ") : stripped;
  if (!capped || FIRST_PERSON_RE.test(capped)) return null;
  return capped;
}

/** A claim is draftable only when it is accepted, not superseded, and — law
 *  1 above — carries at least one citation preview. `clientClaim`'s own
 *  output caps `citation_previews` at 3 non-empty excerpts already. */
function isDraftableClaim(claim) {
  return !!claim
    && claim.decision === "accepted"
    && claim.status !== "superseded"
    && Array.isArray(claim.citation_previews)
    && claim.citation_previews.some((c) => String(c?.excerpt ?? "").trim());
}

/** Up to 5 deduplicated citation excerpts across the claims behind one
 *  proposed line — a joined identityWho line drawing on three claims still
 *  shows every one of them, so the person can check the line against what
 *  they actually gave. */
function citationsOf(claims) {
  const out = [];
  const seen = new Set();
  for (const claim of claims) {
    for (const citation of claim.citation_previews ?? []) {
      const excerpt = String(citation?.excerpt ?? "").trim();
      if (!excerpt || seen.has(excerpt)) continue;
      seen.add(excerpt);
      out.push({ excerpt, entailment: Number(citation?.entailment) || 0 });
      if (out.length >= 5) return out;
    }
  }
  return out;
}

function proposalId(field, claims, index) {
  return `${field}:${index ?? 0}:${claims.map((c) => String(c.claim_id)).join(",")}`;
}

// ── scalar fields: at most ONE proposed line, joining up to several
//    eligible claims' fragments so the person reviews one candidate line
//    per field rather than picking among alternatives that would collide
//    if all accepted at once. ────────────────────────────────────────────
const SCALAR_FIELD_SOURCES = {
  identityWho: {
    matches: (c) => c.domain === "identity" && ["pronouns", "home", "culture"].includes(c.key),
    fragmentMaxWords: 8,
    totalMaxWords: 40,
  },
  identityLife: {
    matches: (c) => c.domain === "biography" || c.domain === "event",
    fragmentMaxWords: 8,
    totalMaxWords: 40,
  },
  lifeTexture: {
    matches: (c) =>
      (c.domain === "habit" && ["humor", "disagreement", "emotional_regulation"].includes(c.key))
      || (c.domain === "delivery" && ["pacing", "turn_shape"].includes(c.key)),
    fragmentMaxWords: 6,
    totalMaxWords: LINT_MAX_WORDS,
  },
  tasteTopics: {
    matches: (c) => c.domain === "knowledge" && !/curio/i.test(c.key),
    fragmentMaxWords: 6,
    totalMaxWords: LINT_MAX_WORDS,
  },
  curiosityTopics: {
    matches: (c) => c.domain === "knowledge" && /curio/i.test(c.key),
    fragmentMaxWords: 6,
    totalMaxWords: LINT_MAX_WORDS,
  },
};

function draftScalarField(field, source, claims) {
  const eligible = claims.filter((c) => isDraftableClaim(c) && source.matches(c));
  if (!eligible.length) return { proposal: null, gap: { field, reason: "no-accepted-claims" } };
  const fragments = [];
  const used = [];
  let totalWords = 0;
  for (const claim of eligible) {
    const fragment = telegraphicFragment(claim.body, source.fragmentMaxWords);
    if (!fragment) continue;
    const words = fragment.split(" ").length;
    if (totalWords + words > source.totalMaxWords) continue;
    fragments.push(fragment);
    used.push(claim);
    totalWords += words;
  }
  if (!fragments.length) {
    return {
      proposal: null,
      gap: { field, reason: "no-draftable-fragment", detail: `${eligible.length} accepted claim(s), none produced a safe line` },
    };
  }
  return {
    proposal: {
      id: proposalId(field, used, 0),
      field,
      value: fragments.join("; "),
      claimIds: used.map((c) => String(c.claim_id)),
      citations: citationsOf(used),
    },
    gap: null,
  };
}

// ── multi-value fields: EVERY eligible claim is its own proposed line, so
//    the person accepts or ignores each one independently. ────────────────
const MULTI_FIELD_SOURCES = {
  personValues: { matches: (c) => c.domain === "value", fragmentMaxWords: 6, cap: 7, min: 3 },
  personNeverSay: { matches: (c) => c.domain === "boundary", fragmentMaxWords: 12, cap: 10, min: 3 },
};

function draftMultiField(field, source, claims) {
  const eligible = claims.filter((c) => isDraftableClaim(c) && source.matches(c));
  const lines = [];
  const seen = new Set();
  for (const claim of eligible) {
    if (lines.length >= source.cap) break;
    const fragment = telegraphicFragment(claim.body, source.fragmentMaxWords);
    if (!fragment) continue;
    const key = fragment.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    lines.push({
      id: proposalId(field, [claim], lines.length),
      field,
      index: lines.length,
      value: fragment,
      claimIds: [String(claim.claim_id)],
      citations: citationsOf([claim]),
    });
  }
  if (lines.length < source.min) {
    return {
      proposals: [],
      gap: {
        field,
        reason: "insufficient-accepted-claims",
        detail: `${lines.length} draftable line(s), need at least ${source.min}`,
      },
    };
  }
  return { proposals: lines, gap: null };
}

// ── how they talk: three independent lines under one sheet field. The
//    studio applies each to `personTalk.<subfield>` on accept. ────────────
const REGISTER_ALIASES = { formal: "formal", mixed: "mixed", casual: "casual", informal: "casual" };
const SCRIPT_ALIASES = {
  "roman-hinglish": "roman-hinglish", hinglish: "roman-hinglish", roman: "roman-hinglish",
  devanagari: "devanagari", hindi: "devanagari",
  english: "english", latin: "english",
};

function draftEnumField(field, claims, matchesKey, aliases, gapReasonWhenPresent) {
  const eligible = claims.filter((c) => isDraftableClaim(c) && c.domain === "language" && c.key === matchesKey);
  for (const claim of eligible) {
    const normalized = String(claim.body ?? "").trim().toLowerCase();
    const value = aliases[normalized];
    if (value) {
      return {
        proposal: { id: proposalId(field, [claim], 0), field, value, claimIds: [String(claim.claim_id)], citations: citationsOf([claim]) },
        gap: null,
      };
    }
  }
  return {
    proposal: null,
    gap: { field, reason: eligible.length ? gapReasonWhenPresent : "no-accepted-claims" },
  };
}

function draftCodeSwitchNote(claims) {
  const field = "personTalk.codeSwitchNote";
  const eligible = claims.filter((c) => isDraftableClaim(c) && c.domain === "language" && c.key === "code_switching");
  for (const claim of eligible) {
    const fragment = telegraphicFragment(claim.body, LINT_MAX_WORDS);
    if (fragment) {
      return {
        proposal: { id: proposalId(field, [claim], 0), field, value: fragment, claimIds: [String(claim.claim_id)], citations: citationsOf([claim]) },
        gap: null,
      };
    }
  }
  return { proposal: null, gap: { field, reason: eligible.length ? "no-draftable-fragment" : "no-accepted-claims" } };
}

/** Every field this module tracks, scalar and multi alike — asserted against
 *  by this module's own eval so a field added to one map and forgotten in
 *  the gap-completeness check becomes a red suite, never a silent omission
 *  (`src/engine/ingest/sheetDraft.ts`'s own `FIELD_SOURCE_CLASS` census is
 *  the precedent for enumerating rather than deriving). */
export const PERSON_SHEET_DRAFT_FIELDS = Object.freeze([
  ...Object.keys(SCALAR_FIELD_SOURCES),
  ...Object.keys(MULTI_FIELD_SOURCES),
  "personTalk.register", "personTalk.scriptBaseline", "personTalk.codeSwitchNote",
  "name", "personLine",
]);

/**
 * Map a person's accepted, cited claims to proposed HumanOS sheet lines.
 *
 * `claims` — the shape `ownedPersonModelStatus(...).claims` already returns
 * (`clientClaim`'s own output): only `decision === "accepted"` rows with at
 * least one citation preview are ever read; everything else (undecided,
 * rejected, superseded, or accepted-but-uncited) is silently ignored, never
 * an error.
 *
 * Deterministic: the same claims in the same order produce byte-identical
 * proposals — a studio that re-drafted and showed a different result would
 * teach a person the pipeline is arbitrary, the same reason
 * `draftFromSignals` (`sheetDraft.ts`) states this requirement for the
 * teacher path.
 *
 * Returns `{ proposals, gaps, acceptedClaimCount }`. `proposals` ∪ `gaps`
 * covers every field in `PERSON_SHEET_DRAFT_FIELDS` (`name`/`personLine`
 * always gap, by design — see this file's header).
 */
export function draftPersonSheetFromClaims(claims) {
  const accepted = Array.isArray(claims) ? claims.filter(isDraftableClaim) : [];
  const proposals = [];
  const gaps = [];

  for (const [field, source] of Object.entries(SCALAR_FIELD_SOURCES)) {
    const { proposal, gap } = draftScalarField(field, source, accepted);
    if (proposal) proposals.push(proposal);
    if (gap) gaps.push(gap);
  }

  for (const [field, source] of Object.entries(MULTI_FIELD_SOURCES)) {
    const { proposals: lines, gap } = draftMultiField(field, source, accepted);
    proposals.push(...lines);
    if (gap) gaps.push(gap);
  }

  const register = draftEnumField("personTalk.register", accepted, "register", REGISTER_ALIASES, "unrecognized-value");
  if (register.proposal) proposals.push(register.proposal); else gaps.push(register.gap);

  const script = draftEnumField("personTalk.scriptBaseline", accepted, "script", SCRIPT_ALIASES, "unrecognized-value");
  if (script.proposal) proposals.push(script.proposal); else gaps.push(script.gap);

  const codeSwitch = draftCodeSwitchNote(accepted);
  if (codeSwitch.proposal) proposals.push(codeSwitch.proposal); else gaps.push(codeSwitch.gap);

  // Always gapped, by design — see this file's header.
  gaps.push({ field: "name", reason: "needs-person-input", detail: "the display name comes from the replica, never overwritten by a claim" });
  gaps.push({ field: "personLine", reason: "needs-person-input", detail: "a one-line introduction is not synthesized from claims" });

  return Object.freeze({
    proposals: Object.freeze(proposals),
    gaps: Object.freeze(gaps),
    acceptedClaimCount: accepted.length,
  });
}
