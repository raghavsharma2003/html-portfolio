# Handoff v1 on the relational kernel (WS-R87, 2026-09-05)

The plan's Phase 3 names the GroupAI kernel
(`/home/user/Vyakti-GroupAI`, `packages/relational-core`) as the engine for
Suites, Handoff and Bridge, "proven on 960 synthetic worlds with zero
leaks." This workstream brings the evaluator that Handoff v0 (WS-R20,
migration 083) already needed a predicate for - not the whole package. This
document is the honest map of what moved, what stayed behind, and what a
future Bridge workstream would need to grow toward.

## What was ported

`api/_relational-core.js` (new, dependency-free, no imports at all) ports,
by hand, from the sibling repo's
`packages/relational-core/src/privacy.ts`, read at commit
`9cdc1dccd273c3e5e1197a2bbf6a0dca8b8a74d4` ("feat: add durable side-effect
and orchestration foundation"):

1. **The closed disclosure-act list.** `DisclosureAct = z.enum(["influence",
   "gist", "paraphrase", "verbatim"])` (`privacy.ts:27`) becomes
   `DISCLOSURE_ACTS`, byte-identical, frozen, exported.
2. **Deny always wins, checked first, unconditionally.** The sibling's
   `authorizeDisclosure` computes a deny (`RECIPIENT_DENIED`) ahead of, and
   never undone by, any allowlist or consent match (`privacy.ts:304-306`,
   proven by the sibling's own property test at `privacy.test.ts:257-270`).
   `evaluateDisclosure` restates this as its first predicate: a matching
   deny short-circuits before a single grant is even filtered.
3. **A grant bound to an exact policy version.** The sibling's
   `activeConsentEvidence` refuses any grant whose `policyVersion` does not
   equal the policy's own current version (`privacy.ts:218`) - a grant
   issued under an older wording of "what happens when you do this" never
   silently satisfies a request evaluated under a newer one.
4. **Expiry as an exclusive boundary.** The sibling's own comparison is
   `now >= Date.parse(validUntil)` (`privacy.ts:226, 301`) - AT the expiry
   instant, already expired, never one tick after. `grantActive` ports the
   identical `<` (not `<=`), named directly by the sibling's own test
   "treats policy expiration as an exclusive boundary" (`privacy.test.ts:
   136-142`).
5. **A named refusal, never a bare boolean.** The sibling's
   `DisclosureDecision` union carries `codes` on its `allowed: false` branch
   (`privacy.ts:145-162`) so a caller can act on WHY, not just THAT.
   `evaluateDisclosure` refuses with one `code` string per decision,
   `api/_handoff.js`'s own `HandoffError` convention restated.

Every test vector in `evals/relational-core/run.mjs` (25 assertions) is
ported the same way - by hand, from `privacy.test.ts` and
`privacy-matrix.test.ts`, cited by file and line range at the point it is
used. Where the sibling used `fast-check` for a 500-case random property
sweep (`privacy-matrix.test.ts:106-114`), this suite has no such
dependency (the kernel port is dependency-free by law), so the
oracle cross-check is an EXHAUSTIVE enumeration of a small combinatorial
space (256 cases) instead - a strictly stronger proof over what it covers,
at the cost of covering less. That substitution is named in the eval file's
own header, not silently claimed as equivalent coverage.

## What was deliberately left in the sibling repo

The sibling's real shape is much larger than what Handoff needs:

- **`DisclosurePolicy`**: zod-validated, allowlist/denylist visibility,
  multiple owners with `any_owner`/`all_owners` consent modes, an
  obligations list (`ask_before_sharing`, `do_not_quote`,
  `do_not_attribute`, `no_derivatives`), purpose gating, conversation-scoped
  audience snapshots (`AudienceEpochId`).
- **`deriveDisclosurePolicy`**: policy inheritance across a chain of derived
  memories, intersecting audiences and purposes and inheriting the
  strictest sensitivity.
- **zod itself.** `api/_relational-core.js` imports nothing - not even the
  sibling's own `zod` dependency - so it can be reached with only a fake
  `db`, this repo's own standing law for every module under `api/_*.js`.

None of this is missing by oversight. Handoff v0 has exactly ONE policy
version per Room (a column on migration 083's own request/reply table) and
exactly ONE grant shape a follower or a creator can ever issue - their own
explicit, verbatim submission IS the grant
(`context/decisions.md#ws-r20-handoff-act-is-inline-not-in-meera-consent`:
"the row itself... already IS a timestamped, versioned record of the
act"). Building the sibling's full multi-owner, multi-purpose policy model
for a caller that cannot yet use most of it would be exactly the mistake
this repo's own `context/rejected.md` warns against elsewhere: machinery
ahead of a caller that needs it.

## How Handoff calls it, behind the flag

`ROOM_HANDOFF_KERNEL` (env var, off by default, see `docs/gurukul/
ENV-MANIFEST.md` §31) gates two call sites in `api/_handoff.js`:

- `sendHandoffRequest`: before the INSERT, evaluates the follower's payload
  as a `verbatim` act, `from` the follower, `to` the Room, `scope` the
  Room, under `HANDOFF_POLICY_VERSION` (the same constant the INSERT is
  about to write). Every field the kernel's request shape needs is already
  in hand - no new SQL statement, on or off. `evals/handoff/run.mjs` proves
  this by diffing the exact SQL text and params the fake `db` receives with
  the flag on versus off: byte-identical.
- `answerHandoff`: before the answering UPDATE, evaluates the creator's
  reply "the other way" (`from` the Room, `to` the follower who asked),
  under the policy version ALREADY STORED on the row being answered (never
  the current `HANDOFF_POLICY_VERSION` constant, which may have moved on).
  This needs a pre-read of the row's `follower_id`/`policy_version` - the
  one new SQL statement this workstream adds, and it never runs when the
  flag is off.

In v0, the grant evaluated is always **self-issued**: the follower's or
creator's own explicit submission is treated as the grant that satisfies
its own request, so a legitimate call can never be refused by the kernel -
matching the decision named above that the row itself IS the consent. The
one place a refusal is reachable today is `deps.handoffDenies`, an optional
array evaluated alongside the self-issued grant. No production code
populates it - it is a deliberate, logged seam
(`context/decisions.md#ws-r87-handoff-v0-grant-is-self-issued`) for a
creator-side block list that is not built yet, proven real by
`evals/handoff/run.mjs`'s own kernel section (which populates it directly)
rather than left as an unexercised code path.

## What Bridge would need next

A future, genuinely multi-party feature (the plan's own "Bridge") would
need real grants issued by one party for another to read, not
self-issued ones - which means:

1. A **grants table** (or a read from wherever grants are decided) so
   `evaluateDisclosure`'s second argument is a real query result, not a
   one-element array built inline.
2. A **deny list a creator can actually populate** - `deps.handoffDenies`
   is the seam; the day it is built, this module needs no change, only a
   real reader wired into that parameter.
3. Possibly **more than one act per request** (Bridge, unlike Handoff, may
   want "gist" or "paraphrase" rather than only "verbatim") - already
   supported by the closed list; nothing in this module assumes
   `verbatim`.
4. If Bridge ever needs multi-owner consent (`all_owners`/`any_owner`) or
   purpose-scoped policies, that is the point to port more of the sibling's
   `DisclosurePolicy` shape rather than bolt owner lists onto this simpler
   grant - two real callers needing the richer shape is the signal the
   abstraction is real, one is not (the same threshold
   `context/decisions.md#ws-r20-handoff-act-is-inline-not-in-meera-consent`
   already names for a different primitive in this same file's own
   ancestry).

## What is proven, and how

- `evals/relational-core/run.mjs`: 25/25, every vector cited to a sibling
  file and line range, offline, deterministic, no sibling import.
- `evals/handoff/run.mjs`: 40/40 (30 pre-existing + 10 new), including a
  byte-for-byte SQL diff of the flag on/off INSERT and a wired-through
  refusal on both send and answer via `deps.handoffDenies`.
- `evals/room-leak/run.mjs` layer 6 (consented-only): runs its whole
  world check TWICE, flag off and flag on, both zero-leak (this
  workstream's own law 4).
- Not proven: no statement in `api/_handoff.js`'s new pre-read has ever run
  against a live Postgres (no `NEON_URL` in this worktree); no real
  `ROOM_HANDOFF_KERNEL=1` request has ever reached a live deployment; the
  sibling repo's own kernel (the full `DisclosurePolicy`/`ConsentGrant`
  shape) has not been exercised by this workstream at all, only read.
