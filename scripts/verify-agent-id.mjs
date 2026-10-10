// Meera's agent id is MIRRORED, not imported — assert the mirrors agree.
//
//   node scripts/verify-agent-id.mjs
//
// Three files have to carry the same uuid and none of them can import it from
// the others: a .sql migration cannot import from TypeScript, db/schema.sql is
// a flat transcript of the live shape by design, and src/engine/agents/
// api/_agentscope.js owns the legacy account-wide row scope. So the constant is copied, and a copied constant drifts
// unless something fails the build when it does. This is that something — the
// same pattern scripts/check-prompt-budget.mjs uses for OPERATIONAL_CORE_CAP,
// where api/chat.js's literal caps are regex-read out of the source and
// compared against the manifest's declared numbers.
//
// What drift costs here, concretely: the migration's column DEFAULT and the
// registry's constant are the two ends of the same identity. If they disagree,
// every writer that does not yet pass an explicit agent_id (which is all of
// them until migration 010 — SPEC-AGENT-LAYER §6) files rows under one uuid
// while every reader scoped by the registry looks under another. Nothing
// errors. Every row simply becomes unreachable, and it looks exactly like
// "she doesn't remember me" — the failure this whole phase exists to fix.
//
// registry.ts is written by WS-AGENT-PERSONA and may not exist yet. Its check
// is SKIPPED WITH A PRINTED NOTE, never silently: a skipped check that reads
// like a passed check is how the meera_tel_session index shadowed its table
// for a day (db/schema.sql:189-196).
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

const MIGRATION = "db/migrations/009_agents.sql";
const SCHEMA = "db/schema.sql";
const AGENT_SCOPE = "api/_agentscope.js";

const UUID_RX = /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g;

let failed = false;
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg) => {
  failed = true;
  console.log(`FAIL  ${msg}`);
};
const skip = (msg) => console.log(`SKIP  ${msg}`);

/** Every distinct uuid literal in a file. "Exactly one distinct" is the real
 *  assertion for the two SQL files: reading only the FIRST match would pass a
 *  half-finished edit that changed three of the forty-two occurrences, which
 *  is the mistake a find-and-replace actually makes. */
const uuidsIn = (src) => [...new Set((src.match(UUID_RX) ?? []).map((s) => s.toLowerCase()))];

const readOrDie = (rel) => {
  const p = join(ROOT, rel);
  if (!existsSync(p)) {
    fail(`${rel} does not exist — the agent id has no source of truth`);
    return null;
  }
  return readFileSync(p, "utf8");
};

console.log("── Meera agent id mirrors (SPEC-AGENT-LAYER §6) ──");

// ── 1. the migration is the source of truth ────────────────────────────────
const migSrc = readOrDie(MIGRATION);
if (!migSrc) process.exit(1);
const migIds = uuidsIn(migSrc);
if (migIds.length !== 1) {
  fail(
    `${MIGRATION} contains ${migIds.length} distinct uuid literals ` +
      `(${migIds.join(", ") || "none"}) — expected exactly 1`,
  );
  process.exit(1);
}
const MEERA_AGENT_ID = migIds[0];

// v4-shaped, because §6's illustrative string was not valid hex and a uuid
// column will not hold it. Version nibble 4, variant nibble 8/9/a/b.
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(MEERA_AGENT_ID)) {
  fail(`${MEERA_AGENT_ID} is not a valid v4-shaped uuid — a uuid column will reject it`);
} else {
  ok(`${MIGRATION} declares ${MEERA_AGENT_ID} (v4-shaped, ${(migSrc.match(UUID_RX) ?? []).length} occurrences, 1 distinct)`);
}

// ── 2. db/schema.sql, the readable record of the live shape ────────────────
const schemaSrc = readOrDie(SCHEMA);
if (schemaSrc) {
  const ids = uuidsIn(schemaSrc);
  if (!ids.includes(MEERA_AGENT_ID)) {
    fail(`${SCHEMA} does not contain ${MEERA_AGENT_ID} from ${MIGRATION} — found: ${ids.join(", ") || "none"}`);
  } else {
    ok(`${SCHEMA} contains the legacy agent id (${(schemaSrc.match(UUID_RX) ?? []).length} uuid occurrences, ${ids.length} distinct)`);
  }
}

// ── 3. api/_agentscope.js, the surviving legacy account-row scope ─────────
const scopePath = join(ROOT, AGENT_SCOPE);
if (!existsSync(scopePath)) {
  skip(`${AGENT_SCOPE} not present — legacy scope mirror unchecked`);
} else {
  const scopeSrc = readFileSync(scopePath, "utf8");
  const named = /MEERA_AGENT_ID\s*(?::[^=]*)?=\s*["'`]([^"'`]+)["'`]/.exec(scopeSrc);
  if (named) {
    if (named[1].toLowerCase() !== MEERA_AGENT_ID) {
      fail(`${AGENT_SCOPE} binds MEERA_AGENT_ID = ${named[1]}, ${MIGRATION} says ${MEERA_AGENT_ID}`);
    } else {
      ok(`${AGENT_SCOPE} matches (MEERA_AGENT_ID binding)`);
    }
  } else if (uuidsIn(scopeSrc).includes(MEERA_AGENT_ID)) {
    ok(`${AGENT_SCOPE} contains ${MEERA_AGENT_ID} (no MEERA_AGENT_ID binding found — matched by literal)`);
  } else {
    fail(
      `${AGENT_SCOPE} exists but carries no MEERA_AGENT_ID binding and no occurrence of ` +
        `${MEERA_AGENT_ID} — found: ${uuidsIn(scopeSrc).join(", ") || "no uuid literals at all"}`,
    );
  }
}

console.log(failed ? "\nFAIL  agent id mirrors disagree" : "\n  ok  agent id mirrors agree");
process.exit(failed ? 1 : 0);
