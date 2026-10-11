// WS-R87: Handoff v1 on the relational kernel.
//
// A dependency-free port of the evaluator surface Handoff needs from the
// sibling repo's kernel, `@vyakti/relational-core`
// (/home/user/Vyakti-GroupAI, packages/relational-core/src/privacy.ts,
// read at commit 9cdc1dc "feat: add durable side-effect and orchestration
// foundation"). The plan's Phase 3 names that kernel as the engine for
// Suites, Handoff and Bridge, "proven on 960 synthetic worlds with zero
// leaks" — this workstream brings the evaluator, not the whole package
// (docs/gurukul/HANDOFF-KERNEL.md says exactly what was left behind and
// why).
//
// The sibling's `authorizeDisclosure` evaluates a zod-validated
// `DisclosurePolicy` (an allowlist/denylist of recipients, purposes,
// conversations, an obligations list, a consent mode across MULTIPLE
// owners) against a `DisclosureRequest` carrying a batch of consent
// grants. Handoff v0 (migration 083) needs a much narrower thing: ONE
// follower, ONE creator, ONE Room, a closed list of disclosure acts, and a
// grant that is bound to a policy version — the shape this workstream's own
// brief names directly: "a grant {from, to, act, scope, policy_version,
// expires_at}, an evaluate(request, grants, denies) that returns allow or a
// named refusal with deny-always-wins, and a payload receipt shape." That
// is what is ported here, by hand, not by trimming the zod schema — this
// module imports nothing, not even the sibling's own `zod` dependency,
// because Handoff's own file (api/_handoff.js) states its own law right at
// the top: this module stays reachable with only a fake `db`, and a real
// dependency-free port must not smuggle one back in through its evaluator.
//
// ── what carries over from the sibling, and how ────────────────────────────
//
// 1. THE CLOSED ACT LIST. `DisclosureAct = z.enum(["influence", "gist",
//    "paraphrase", "verbatim"])` (privacy.ts:27) becomes `DISCLOSURE_ACTS`
//    below, byte-identical, frozen. Handoff only ever evaluates "verbatim"
//    (the whole point of the payload screen), but the list stays closed and
//    complete so a later Bridge feature that wants "gist" or "paraphrase"
//    never has to touch this file to get it.
// 2. DENY ALWAYS WINS, CHECKED FIRST, UNCONDITIONALLY. The sibling's
//    `authorizeDisclosure` computes `RECIPIENT_DENIED` from
//    `policy.deniedRecipientIds` ahead of, and never undone by, any
//    allowlist or consent match (privacy.ts:304-306, and the sibling's own
//    property test "never turns denial into allowance when an extra
//    recipient is added", privacy.test.ts:257-270). `evaluateDisclosure`
//    below restates that as the very first predicate: a matching deny short
//    circuits before any grant is even filtered.
// 3. A GRANT BOUND TO A POLICY VERSION, NEVER TRUSTED ACROSS ONE. The
//    sibling's `activeConsentEvidence` refuses any `ConsentGrant` whose
//    `policyVersion !== policy.version` (privacy.ts:218) — a grant issued
//    under an OLDER wording of "what happens when you do this" never
//    silently satisfies a request evaluated under a newer one. `matches()`
//    below restates the identical equality check on `policy_version`.
// 4. EXPIRY IS AN EXCLUSIVE BOUNDARY. The sibling's own grant/policy
//    `validUntil` check is `now >= Date.parse(validUntil)` (privacy.ts:226,
//    301) — AT the expiry instant, already expired, never one tick after.
//    `grantActive` below uses the same `<` (not `<=`) comparison, ported
//    from the sibling's own test naming this directly: "treats policy
//    expiration as an exclusive boundary" (privacy.test.ts:136-142).
// 5. A NAMED REFUSAL, NEVER A BARE BOOLEAN. The sibling's own
//    `DisclosureDecision` union carries `codes: readonly
//    DisclosureDenialCode[]` on the `allowed: false` branch (privacy.ts:145-
//    162) precisely so a caller can act on WHY, not just THAT — Handoff's
//    own `HandoffError` class (api/_handoff.js) already refuses "by name"
//    everywhere else, so this evaluator refuses the same way: one `code`
//    string per decision.
//
// ── what does NOT carry over, and is left in the sibling on purpose ────────
//
// No `DisclosurePolicy` (allowlist/denylist visibility, purposes,
// obligations, multi-owner consent modes), no zod validation, no
// `deriveDisclosurePolicy` (policy inheritance across derived memories), no
// `AudienceEpochId`/conversation-membership-snapshot machinery. Handoff v0
// has exactly one policy version per Room (a column on migration 083's own
// request/reply table, named in that migration's own file rather than
// repeated here — evals/room-leak/run.mjs's own repo-wide static scan treats
// any mention of that table's name outside Handoff's own lane as a possible
// new reader, `context/rejected.md`'s own precedent for this exact trap) and
// exactly one grant shape a follower or creator can ever issue — their own
// explicit, verbatim submission IS the grant
// (context/decisions.md#ws-r20-handoff-act-is-inline-not-in-meera-consent:
// "the row itself... already IS a timestamped, versioned record of the
// act"). Building the sibling's full policy model here for a caller that
// cannot yet use most of it would be exactly the mistake
// context/rejected.md warns against elsewhere in this repo: machinery ahead
// of a caller that needs it. docs/gurukul/HANDOFF-KERNEL.md names what
// Bridge (a future, real multi-party feature) would need to grow this
// module toward.

/**
 * The closed list of disclosure acts, ported byte-identical from the
 * sibling's `DisclosureAct` enum (privacy.ts:27). Frozen so a caller cannot
 * silently widen it by mutating the array in place.
 */
export const DISCLOSURE_ACTS = Object.freeze(["influence", "gist", "paraphrase", "verbatim"]);

/**
 * Every refusal this evaluator can return, by name — restated here (not
 * imported, this module has no imports at all) so a caller can compare
 * against a closed list rather than a magic string, `api/_handoff.js`'s own
 * `HandoffError` convention one file over.
 */
export const REFUSAL_CODES = Object.freeze([
  "INVALID_REQUEST",
  "INVALID_GRANT_SHAPE",
  "DENIED",
  "GRANT_REQUIRED",
]);

const isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
const isPositiveInt = (value) => Number.isInteger(value) && value > 0;

function isWellFormedRequestShape(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    isNonEmptyString(value.from) &&
    isNonEmptyString(value.to) &&
    DISCLOSURE_ACTS.includes(value.act) &&
    isNonEmptyString(value.scope) &&
    isPositiveInt(value.policy_version)
  );
}

/**
 * A grant (or a deny — the SAME shape, evaluated by the SAME predicate,
 * `evaluateDisclosure`'s own deny-always-wins law):
 *
 *   from            an opaque identity string. This module never
 *                    interprets it beyond equality — the caller's own ids
 *                    (Handoff passes a follower_id or a Room-scoped
 *                    "room:<room_id>" string).
 *   to               an opaque identity string, same rule.
 *   act              one of DISCLOSURE_ACTS.
 *   scope            an opaque string the grant is bound to. Handoff binds
 *                     this to a room_id — a grant scoped to one Room never
 *                     matches a request scoped to another, no matter how
 *                     permissive every other field is (the negative control
 *                     this workstream's own brief names: "a grant whose
 *                     scope is another Room is refused").
 *   policy_version   a positive integer. Ported rule 3 above: a grant under
 *                    an older policy version never matches a newer request.
 *   expires_at       an ISO-8601 string, or null/undefined for "never
 *                     expires". Ported rule 4 above: the expiry instant
 *                     itself is already expired.
 */
function isWellFormedGrantShape(value) {
  return isWellFormedRequestShape(value);
}

function grantActive(grant, atMs) {
  if (grant.expires_at === null || grant.expires_at === undefined) return true;
  const expiresAtMs = Date.parse(grant.expires_at);
  if (!Number.isFinite(expiresAtMs)) return false;
  return atMs < expiresAtMs;
}

function sameScope(grant, request) {
  return (
    grant.from === request.from &&
    grant.to === request.to &&
    grant.act === request.act &&
    grant.scope === request.scope &&
    grant.policy_version === request.policy_version
  );
}

function refusal(code, evaluatedAtIso) {
  return { allowed: false, code, evaluated_at: evaluatedAtIso };
}

/**
 * evaluate(request, grants, denies) -> a payload receipt or a named
 * refusal. Pure: no I/O, no mutation of any argument, deterministic for a
 * given `opts.now`.
 *
 * DENY ALWAYS WINS. A deny that matches the request refuses it even when a
 * grant also matches — checked FIRST, unconditionally, before a single
 * grant is even filtered. Ported rule 2 above.
 *
 * `grants`/`denies` may be any array; malformed entries (missing a field,
 * an act outside the closed list, an expired one) are filtered out rather
 * than thrown on, `api/_disclosure.js`'s own "a predicate, not a promise"
 * restated for an in-memory list instead of a SQL WHERE clause — a caller
 * that built its grant list from untrusted input is still safe. A
 * malformed REQUEST is the one thing this function refuses by name
 * (`INVALID_REQUEST`) rather than silently ignoring, since a request is
 * never optional the way one grant among many can be.
 */
export function evaluateDisclosure(request, grants, denies, opts = {}) {
  const now = Number.isFinite(opts.now) ? opts.now : Date.now();
  const evaluatedAtIso = new Date(now).toISOString();

  if (!isWellFormedRequestShape(request)) return refusal("INVALID_REQUEST", evaluatedAtIso);
  if (!Array.isArray(grants) || !Array.isArray(denies)) return refusal("INVALID_REQUEST", evaluatedAtIso);

  const activeDenies = denies.filter((d) => isWellFormedGrantShape(d) && grantActive(d, now));
  if (activeDenies.some((d) => sameScope(d, request))) {
    return refusal("DENIED", evaluatedAtIso);
  }

  const activeGrants = grants.filter((g) => isWellFormedGrantShape(g) && grantActive(g, now));
  const matchingGrant = activeGrants.find((g) => sameScope(g, request));
  if (!matchingGrant) {
    return refusal("GRANT_REQUIRED", evaluatedAtIso);
  }

  return {
    allowed: true,
    receipt: {
      from: request.from,
      to: request.to,
      act: request.act,
      scope: request.scope,
      policy_version: request.policy_version,
      evaluated_at: evaluatedAtIso,
    },
  };
}
