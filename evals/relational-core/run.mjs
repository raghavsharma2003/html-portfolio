// WS-R87. api/_relational-core.js's own offline suite.
//
//   node evals/relational-core/run.mjs
//
// Test vectors are PORTED BY HAND from the sibling repo
// (/home/user/Vyakti-GroupAI, read-only), commit
// 9cdc1dccd273c3e5e1197a2bbf6a0dca8b8a74d4 ("feat: add durable side-effect
// and orchestration foundation"):
//
//   packages/relational-core/src/privacy.test.ts        (unit vectors)
//   packages/relational-core/src/privacy-matrix.test.ts (the oracle cross-check)
//
// The sibling's own vectors are written against a much richer shape
// (`DisclosurePolicy` with allowlist/denylist visibility, purposes,
// obligations, multi-owner consent) than the grant this workstream's brief
// names: `{from, to, act, scope, policy_version, expires_at}`. Every vector
// below is the SAME LAW, restated for the simpler shape - each one names the
// sibling test it ports and the line range it read. Where the sibling uses
// `fast-check` for a 500-case property sweep, this suite has no such
// dependency (api/_relational-core.js is dependency-free BY LAW), so the
// oracle cross-check below is an EXHAUSTIVE enumeration of a small
// combinatorial space instead of a random sample - a strictly stronger
// proof over the space it covers, at the cost of covering a smaller space.
//
// Offline, deterministic, $0, no DB, no network, no model call, no sibling
// repo import (this suite reads the sibling only through this file's own
// comments, never a `require`/`import` - the brief's own law: "Network: read
// the sibling repo on disk only").
import assert from "node:assert/strict";
import {
  DISCLOSURE_ACTS,
  REFUSAL_CODES,
  evaluateDisclosure,
} from "../../api/_relational-core.js";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++; else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const NOW = "2026-09-05T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const LATER = "2026-09-05T11:00:00.000Z";
const ALICE = "person-alice";
const BOB = "person-bob";
const CAROL = "person-carol";
const ROOM_X = "room-x";
const ROOM_Y = "room-y";

const req = (overrides = {}) => ({
  from: ALICE, to: BOB, act: "gist", scope: ROOM_X, policy_version: 1, ...overrides,
});
const grant = (overrides = {}) => ({
  from: ALICE, to: BOB, act: "gist", scope: ROOM_X, policy_version: 1, expires_at: null, ...overrides,
});
const evaluate = (request, grants, denies, opts = {}) =>
  evaluateDisclosure(request, grants, denies, { now: NOW_MS, ...opts });

// ═════════════════════════════════════════════════════════════════════════
console.log("── the closed act list (privacy.ts:27, DisclosureAct enum) ──");
{
  ok("DISCLOSURE_ACTS is byte-identical to the sibling's own DisclosureAct enum",
    JSON.stringify(DISCLOSURE_ACTS) === JSON.stringify(["influence", "gist", "paraphrase", "verbatim"]));
  ok("DISCLOSURE_ACTS is frozen", Object.isFrozen(DISCLOSURE_ACTS));
  ok("REFUSAL_CODES is frozen and non-empty", Object.isFrozen(REFUSAL_CODES) && REFUSAL_CODES.length > 0);
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:78-82 ("allows a private memory back to its owner")
// and :84-88 ("denies the same private memory to another person").
console.log("\n── allow requires a matching grant; a different recipient is refused ──");
{
  const decision = evaluate(req(), [grant()], []);
  ok("a matching grant allows (privacy.test.ts:78-82)", decision.allowed === true);
  if (decision.allowed) {
    ok("the receipt restates the request's own fields",
      decision.receipt.from === ALICE && decision.receipt.to === BOB &&
      decision.receipt.act === "gist" && decision.receipt.scope === ROOM_X &&
      decision.receipt.policy_version === 1 && decision.receipt.evaluated_at === NOW);
  }

  const toCarol = evaluate(req({ to: CAROL }), [grant()], []);
  ok("a request to a DIFFERENT recipient than the grant names is refused (privacy.test.ts:84-88)",
    toCarol.allowed === false && toCarol.code === "GRANT_REQUIRED");
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:110-116 ("makes an explicit denial override public
// visibility") — the brief's own negative control: "a deny beats a grant."
console.log("\n── DENY ALWAYS WINS: a deny beats a grant that would otherwise allow ──");
{
  const withGrantOnly = evaluate(req(), [grant()], []);
  ok("sanity: with only the grant present, the request is allowed", withGrantOnly.allowed === true);

  const withDenyToo = evaluate(req(), [grant()], [grant()]);
  ok("NEGATIVE CONTROL: the SAME matching deny alongside the SAME matching grant refuses (privacy.test.ts:110-116)",
    withDenyToo.allowed === false && withDenyToo.code === "DENIED");

  const nonMatchingDeny = evaluate(req(), [grant()], [grant({ to: CAROL })]);
  ok("a deny that does NOT match the request never refuses it (the deny predicate is not vacuous)",
    nonMatchingDeny.allowed === true);
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:118-134 (it.each mismatched world/purpose/proactive/
// conversation) — restated for this shape's own fields. The brief's own
// first-named negative control: "a grant whose scope is another Room is
// refused."
console.log("\n── mismatched scope, act, or policy_version each refuse on their own ──");
{
  const wrongScope = evaluate(req({ scope: ROOM_X }), [grant({ scope: ROOM_Y })], []);
  ok("NEGATIVE CONTROL: a grant scoped to a DIFFERENT Room never matches (privacy.test.ts:118-134, world/conversation mismatch)",
    wrongScope.allowed === false && wrongScope.code === "GRANT_REQUIRED");

  const wrongAct = evaluate(req({ act: "verbatim" }), [grant({ act: "gist" })], []);
  ok("a grant for a DIFFERENT act never satisfies the request (privacy.test.ts:118-134, purpose mismatch; also ports :224-255, \"does not let a grant widen its disclosure act\")",
    wrongAct.allowed === false && wrongAct.code === "GRANT_REQUIRED");

  const wrongPolicyVersion = evaluate(req({ policy_version: 2 }), [grant({ policy_version: 1 })], []);
  ok("a grant issued under an OLDER policy_version never satisfies a request evaluated under a newer one",
    wrongPolicyVersion.allowed === false && wrongPolicyVersion.code === "GRANT_REQUIRED");
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:136-142 ("treats policy expiration as an exclusive
// boundary").
console.log("\n── expiry is an exclusive boundary, not an inclusive one ──");
{
  const atExpiry = evaluate(req(), [grant({ expires_at: NOW })], []);
  ok("a grant expiring AT the evaluation instant is already expired (privacy.test.ts:136-142)",
    atExpiry.allowed === false && atExpiry.code === "GRANT_REQUIRED");

  const beforeExpiry = evaluate(req(), [grant({ expires_at: LATER })], []);
  ok("the SAME grant one hour before its own expiry still satisfies the request", beforeExpiry.allowed === true);

  const neverExpires = evaluate(req(), [grant({ expires_at: null })], []);
  ok("expires_at: null means never - unaffected by any clock", neverExpires.allowed === true);
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:144-172 ("requires a current, matching consent
// grant when asked") and :174-194 ("rejects a revoked consent grant" -
// this module has no separate revocation field; an already-expired grant
// is this shape's equivalent, ported just above).
console.log("\n── no grant at all is GRANT_REQUIRED, never a silent allow ──");
{
  const noGrants = evaluate(req(), [], []);
  ok("an empty grant list refuses by name, never throws (privacy.test.ts:144-150)",
    noGrants.allowed === false && noGrants.code === "GRANT_REQUIRED");
}

// ═════════════════════════════════════════════════════════════════════════
console.log("\n── malformed input is refused or filtered, never thrown on ──");
{
  const badRequest = evaluate({ from: ALICE, to: BOB, act: "not_a_real_act", scope: ROOM_X, policy_version: 1 }, [], []);
  ok("an act outside the closed list on the REQUEST is INVALID_REQUEST",
    badRequest.allowed === false && badRequest.code === "INVALID_REQUEST");

  const missingField = evaluate({ from: ALICE, to: BOB, act: "gist", scope: ROOM_X }, [], []);
  ok("a request missing policy_version is INVALID_REQUEST", missingField.allowed === false && missingField.code === "INVALID_REQUEST");

  const zeroVersion = evaluate(req({ policy_version: 0 }), [grant({ policy_version: 0 })], []);
  ok("policy_version must be a POSITIVE integer - 0 is INVALID_REQUEST even with a matching (equally malformed) grant",
    zeroVersion.allowed === false && zeroVersion.code === "INVALID_REQUEST");

  // A malformed GRANT (as opposed to a malformed request) is filtered out
  // rather than thrown on - a caller building its grant list from untrusted
  // input stays safe, api/_disclosure.js's own "a predicate, not a promise."
  const malformedGrantIgnored = evaluate(req(), [{ from: ALICE, to: BOB, act: "gist" /* no scope, no policy_version */ }], []);
  ok("a malformed grant is silently filtered out (not thrown, not matched) - so the request falls through to GRANT_REQUIRED",
    malformedGrantIgnored.allowed === false && malformedGrantIgnored.code === "GRANT_REQUIRED");

  const nonArrayGrants = evaluate(req(), null, []);
  ok("grants that are not even an array is INVALID_REQUEST, not a crash", nonArrayGrants.allowed === false && nonArrayGrants.code === "INVALID_REQUEST");
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy.test.ts:257-270, the property test "never turns denial into
// allowance when an extra recipient is added" - restated as a hand-enumerated
// sweep (this module has no fast-check dependency by design).
console.log("\n── monotonicity: adding an unrelated grant never turns a deny into an allow ──");
{
  const others = [
    grant({ to: CAROL }),
    grant({ scope: ROOM_Y }),
    grant({ act: "verbatim" }),
    grant({ policy_version: 2 }),
  ];
  let everyCombinationStillDenies = true;
  // 16 combinations of the 4 unrelated grants above, alongside the one
  // matching grant and the one matching deny - exhaustive, not sampled.
  for (let mask = 0; mask < 16; mask++) {
    const extraGrants = others.filter((_, i) => (mask & (1 << i)) !== 0);
    const decision = evaluate(req(), [grant(), ...extraGrants], [grant()]);
    if (decision.allowed !== false || decision.code !== "DENIED") everyCombinationStillDenies = false;
  }
  ok("NEGATIVE CONTROL: none of the 16 combinations of unrelated additional grants ever overrides the one matching deny (privacy.test.ts:257-270)",
    everyCombinationStillDenies);
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy-matrix.test.ts:106-114 (the independent-oracle cross-check,
// 500 fast-check-generated cases) as an EXHAUSTIVE enumeration over a small
// space instead - stronger over what it covers, smaller in what it covers,
// logged as a deliberate substitution rather than silently claiming the same
// coverage (this file's own header explains why).
console.log("\n── independent oracle cross-check, exhaustive over a small space ──");
{
  const FROMS = [ALICE, BOB];
  const TOS = [ALICE, BOB];
  const SCOPES = [ROOM_X, ROOM_Y];
  const VERSIONS = [1, 2];
  let cases = 0, agree = 0;
  for (const from of FROMS) {
    for (const to of TOS) {
      for (const act of DISCLOSURE_ACTS) {
        for (const scope of SCOPES) {
          for (const policy_version of VERSIONS) {
            for (const hasGrant of [true, false]) {
              for (const hasDeny of [true, false]) {
                const request = { from, to, act, scope, policy_version };
                const grants = hasGrant ? [{ ...request, expires_at: null }] : [];
                const denies = hasDeny ? [{ ...request, expires_at: null }] : [];
                // Independent oracle: written from the LAW in prose, never
                // by reading evaluateDisclosure's own source - "allowed iff
                // a grant exactly matches every field and no deny does",
                // deny checked first.
                const oracleAllowed = hasGrant && !hasDeny;
                const decision = evaluate(request, grants, denies);
                cases++;
                if (decision.allowed === oracleAllowed) agree++;
              }
            }
          }
        }
      }
    }
  }
  ok(`the real evaluator agrees with an independent oracle on all ${cases} generated cases (privacy-matrix.test.ts:106-114)`,
    agree === cases, `${agree}/${cases}`);
}

// ═════════════════════════════════════════════════════════════════════════
// Ports privacy-matrix.test.ts:116-139, "proves the deliberately unsafe
// negative control is detectable."
console.log("\n── the deliberately unsafe negative control is detectable ──");
{
  const forbidden = req({ to: CAROL });
  const decision = evaluate(forbidden, [grant()], []); // grant is for BOB, request is for CAROL
  const unsafeNegativeControl = () => true;
  ok("the real evaluator refuses the forbidden case", decision.allowed === false);
  ok("NEGATIVE CONTROL: an 'always allow' stand-in disagrees with the real evaluator on the same case (privacy-matrix.test.ts:116-139)",
    unsafeNegativeControl() !== decision.allowed);
}

console.log(`\nrelational-core: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
