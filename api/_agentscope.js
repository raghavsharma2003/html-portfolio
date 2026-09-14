// The agent-scope predicate — docs/SPEC-AGENT-LAYER.md §2 (Law E1), gated by
// §7's G-E1.
//
// THIS FILE IS THE TENANCY BOUNDARY, and it is api/_disclosure.js's sibling on
// purpose. That module makes person B's material unreachable from person A's
// context with one numbered WHERE clause applied before rank; this one does the
// same thing one axis over — agent B's memory of a person is unreachable from
// agent A's retrieval about that same person.
//
// It is a WHERE clause and not a sentence in a prompt for the reason the repo
// has already measured twice, in its own build, at the exact place it carries
// user privacy: ConfAIde Tier-3 leaks at 93% for ChatGPT; PiSAs measures
// single-agent V_vis at 100%; every behavioural mitigation ever measured leaves
// a 9-90% residual (context/measurements.md#disclosure-leak-rates), and Gate 0
// put the local numbers at 57.1% naturalistic / 98.1% adversarial for the
// prompt-instruction arm against ZERO for the SQL predicate
// (context/measurements.md#gate0-structural). A model told "that is the other
// agent's memory, do not use it" while holding the row leaks. A row that was
// never retrieved cannot.
//
// It runs in the WHERE clause, BEFORE the rank computation — never as a
// post-hoc filter over ranked rows. `_disclosure.js` states the reason and it
// transfers verbatim: a disqualified high-salience row that reaches the ranker
// can still consume slot budget, be partially rendered, or escape through a
// ranking bug. `recited-prompt` and `silent-truncation` are the two times this
// repo paid for the other arrangement.
//
// ── what is IMPOSSIBLE here, not merely filtered ───────────────────────────
//
//   - Cross-agent read. The agent binding is a SCALAR uuid. The predicate
//     cannot express "any of these agents" because there is nowhere to put a
//     second agent id — the isolation is a property of the clause's SHAPE, not
//     of the value it was called with. Widening it requires editing this SQL,
//     which is a reviewable diff, not a runtime state. (Exactly the argument
//     _disclosure.js clause 4 makes for its scalar roomId.)
//   - Cross-agent read by accident of a missing binding. `agent_id = null`
//     evaluates to NULL, not TRUE, so an unbound or undefined agent returns
//     ZERO rows rather than everyone's. Three-valued logic points the safe way
//     for an equality; it points the UNSAFE way for a universal quantifier over
//     an empty set, which is the fail-open bug _disclosure.js clause 2b exists
//     to close. Same engine, opposite direction, and the difference is why this
//     module is an equality and not a containment.
//   - A row with no agent. `agent_id` is `not null` on all twenty derived
//     tables after migration 009 and the four raw tables after migration 018,
//     so there is no third state to reason about.
//
// ── the accepted consequence (§2, deliberate, not a gap) ───────────────────
//
//   A second agent starts from ZERO with a user Meera knows well.
//
// That is the correct behaviour, not a limitation to engineer around. A new
// friend does not inherit your old friend's knowledge of you, and a product
// where they do is the betrayal engine `multiparty-direction` already named.
// Cross-agent sharing, if it is ever wanted, arrives the way DM->room
// disclosure did: an explicit, cited, user-granted row — never a default, and
// never a flag in this file.
//
// ── what is NOT agent-scoped, and why ──────────────────────────────────────
//
// Person-intrinsic (§2). These carry no `agent_id` and must never gain one:
//
//   vy_person           — the identity anchor, and the AGE TIER. Age is a
//                         safety property; a per-agent copy of it is a per-agent
//                         opportunity to re-derive it differently, which is a
//                         safety floor that varies by tenant. It must not be
//                         re-derivable per agent, so it is not stored per agent.
//   vy_person_device    — the device belongs to the human, not to whoever they
//                         happen to be talking to.
//   vy_surface_identity — identity resolution is agent-independent (§4): the
//                         same human, whoever they are talking to. The agent
//                         enters at RETRIEVAL, not at identification. A surface
//                         is a phone line, not a different friend.
//
// Agent-free (§2): `vy_model`, `vy_gate_run` — router and gate machinery is
// shared infrastructure and carries no person reference at all.
//
// The FORGET lane is also deliberately unscoped, and that is not an oversight:
// §6 rules that a full wipe of a person deletes their rows across ALL agents,
// because it is their data and not the agent's. G-E5 is the proven property and
// it may not regress. So the manifest-driven cascade in api/memory.js stays
// person-keyed; only RETRIEVAL and the derivation WRITES are scoped here.
//
// ── binding contract ───────────────────────────────────────────────────────
//
//   $n uuid   agentId   — the agent whose relationship is being read or written
//
// One binding, because there is one axis. Callers pass the positional parameter
// they have room for; evals/agent/isolation.mjs passes a COLUMN reference so
// that one batched round trip can evaluate every agent x row pair against the
// SHIPPING clause text — the same reason disclosurePredicate() takes a bind map.

/**
 * Meera's fixed agent id. MIRRORED, not imported — the fourth copy of the
 * constant declared in db/migrations/009_agents.sql (the source of truth) and
 * echoed in db/schema.sql and src/engine/agents/registry.ts.
 *
 * It cannot be imported: registry.ts is TypeScript compiled into a client
 * bundle that must not reach for the database layer, and this file is a
 * serverless module with no TypeScript step. So it is copied, and a copied
 * constant drifts unless something fails a gate when it does —
 * scripts/verify-agent-id.mjs asserts the other three agree, and
 * evals/agent/isolation.mjs asserts THIS one against the migration before it
 * runs a single scenario. What drift costs is not an error: rows get written
 * under one uuid and read under another, nothing throws, and it looks exactly
 * like "she doesn't remember me" — the failure this phase exists to fix.
 */
export const MEERA_AGENT_ID = "a0000000-0000-4000-8000-000000000001";

/**
 * The twenty agent-scoped tables (§2), in migration 009's order. Exported so a
 * gate can enumerate them rather than restate them: a list that has to be kept
 * in sync by hand is a list that will not be.
 *
 * `person` is the column each table is actually READ by, which is what 009's
 * index pairs with agent_id. The last three carry no person reference at all —
 * an index on a column that does not exist is not a stricter reading of the
 * spec, it is a migration that does not apply.
 */
export const AGENT_SCOPED_TABLES = [
  { table: "vy_episode", person: "person_id" },
  { table: "vy_fact", person: "person_id" },
  { table: "vy_rel_state", person: "person_id" },
  { table: "vy_rel_event", person: "person_id" },
  { table: "vy_pattern", person: "person_id" },
  { table: "vy_phrase", person: "person_id" },
  { table: "vy_ritual", person: "person_id" },
  { table: "vy_currency", person: "person_id" },
  { table: "vy_kin", person: "person_id" },
  { table: "vy_india_profile", person: "person_id" },
  { table: "vy_taste_candidate", person: "person_id" },
  { table: "vy_shared_moment", person: "person_id" },
  { table: "vy_visual_assertion", person: "person_id" },
  { table: "vy_embedding", person: "person_id" },
  { table: "vy_derivation", person: "person_id" },
  { table: "vy_session", person: "person_id" },
  { table: "vy_group_member", person: "person_id" },
  { table: "vy_group", person: null },
  { table: "vy_group_turn", person: null },
  { table: "vy_disclosure_grant", person: null },
];

/**
 * Raw relationship memory added to the hard boundary by migration 018.
 * `device` is the person-side owner key each table is read and deleted by.
 * The consolidation lease is operational state rather than memory and is
 * listed separately because its isolation unit is `(agent_id, person_id)`.
 */
export const RAW_AGENT_SCOPED_TABLES = [
  { table: "meera_log", device: "device_id" },
  { table: "meera_nodes", device: "device_id" },
  { table: "meera_edges", device: "device_id" },
  { table: "meera_forget", device: "device_id" },
];

export const AGENT_SCOPED_OPERATIONAL_TABLES = [
  { table: "meera_consolidate_lease", person: "person_id" },
];

/** Tables that carry no agent_id and must never gain one — see the header. */
export const PERSON_INTRINSIC_TABLES = [
  "vy_person",
  "vy_person_device",
  "vy_surface_identity",
];

/**
 * The predicate, as a SQL fragment that begins with `and` and is dropped into
 * the WHERE clause of a query over an agent-scoped table.
 *
 * @param {string} alias  the table's alias (or bare table name) in the query
 * @param {{agentId?:string}} [bind]
 *        SQL expression to substitute for the agent binding. Default is `$1`;
 *        a caller with existing positional parameters passes the next free one
 *        (`$3`, `$4`, ...) and appends the id to its params array, and
 *        evals/agent/isolation.mjs passes a column reference so the shipping
 *        clause text is the tested clause text.
 * @returns {string} SQL
 */
export function agentScopePredicate(alias, bind = {}) {
  if (!alias || !/^[a-z_][a-z_0-9]*$/i.test(alias)) {
    throw new Error(`agentScopePredicate: bad alias ${JSON.stringify(alias)}`);
  }
  // Explicit cast, not decoration: over Neon's SQL-over-HTTP endpoint a bare
  // `$1` compared against a uuid column has no inferable type on some shapes
  // and the statement fails at parse time. The cast also makes the fragment
  // reusable verbatim when the binding is a COLUMN reference rather than a
  // parameter, which is what lets the tested predicate be the shipped one.
  const A = `(${bind.agentId ?? "$1"})::uuid`;
  return `
-- ── (E1) agent scope (SPEC-AGENT-LAYER §2) ─────────────────────────────────
-- Evaluated in the WHERE, before rank. The binding is a SCALAR: there is no
-- way to express "any of these agents", and an absent binding yields NULL and
-- therefore no rows, never everyone's.
and ${alias}.agent_id = ${A}
`;
}

/**
 * The value expression for an INSERT's agent_id column.
 *
 * Every writer over a scoped table names `agent_id` EXPLICITLY rather than
 * leaning on 009's column DEFAULT. The default is a transitional crutch and
 * migration 010 removes it precisely so a forgotten writer fails loudly
 * instead of silently filing another agent's memory under Meera; a call site
 * that still relies on it is a call site that breaks the day 010 applies.
 * Naming it here is what makes 010 applicable.
 *
 * @param {string} [bind] SQL expression for the id (default `$1`)
 */
export function agentValue(bind = "$1") {
  return `(${bind})::uuid`;
}
