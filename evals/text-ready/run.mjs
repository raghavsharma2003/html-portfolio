// WS-R161 (wave twenty-two). Meet opens for any person: the text-ready
// capability level and the text-ready dialogue door.
//
//   node evals/text-ready/run.mjs
//
// Drives the REAL, shipping modules directly — `api/_replica-runtime.js`
// (`textBlockers`, `clientRuntimeStatus`, `compileReplicaRuntimeCore`'s new
// optional `vibe` parameter) and `api/_replica-dialogue.js`
// (`generateOwnedTextDialogue`, and `generateOwnedDialogue`'s own fallback
// into it) — against a hand-rolled fake `db`. The fake matches EXACTLY on
// this repo's own exported SQL constants (`RUNTIME_STATUS_SQL`,
// `TEXT_CAPABILITY_ENSURE_SQL`, `OWNED_TEXT_PROFILE_SQL`,
// `OWNED_PRIVATE_RUNTIME_CONTEXT_SQL`), never a substring match on a live
// table or column name (`evals/lib/source-scan.mjs`'s own reason for
// existing, restated here for a query matcher rather than a text scanner:
// a blunt substring match is the thing that goes wrong quietly). Any
// statement this suite does not recognise throws loudly rather than
// returning a plausible empty row set — the `plausible-return-hides-a-
// dead-pipeline` failure class `context/rejected.md` already names more
// than once.
//
// What this suite does NOT prove, named rather than assumed: migration 167
// has never run against a real Postgres (no NEON_URL in this environment);
// nobody has opened Meet in a real signed-in browser for a text-ready-only
// replica (that walk is `evals/rehearsal/personal.mjs`'s own, driven
// through the real UI with this suite's identical fake generator seam).
//
// Offline, deterministic, $0, no DB, no network, no GPU.
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const runtime = await import(pathToFileURL(join(REPO, "api/_replica-runtime.js")).href);
const dialogue = await import(pathToFileURL(join(REPO, "api/_replica-dialogue.js")).href);
const authority = await import(pathToFileURL(join(REPO, "api/_room-memory-authority.js")).href);
const {
  textBlockers, clientRuntimeStatus, compileReplicaRuntimeCore, loadOwnedTextIdentity,
  RUNTIME_STATUS_SQL, TEXT_CAPABILITY_ENSURE_SQL, OWNED_TEXT_PROFILE_SQL, OWNED_PRIVATE_RUNTIME_CONTEXT_SQL,
} = runtime;
const { generateOwnedTextDialogue, generateOwnedDialogue, TEXT_APPRENTICE_DISCLOSURE } = dialogue;
const { OWNER_MEMORY_RECALL_SQL } = authority;

// ── a full-good RUNTIME_STATUS_SQL row, and small overrides per scenario ──
const REPLICA_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const AGENT_ID = "55555555-5555-4555-8555-555555555555";

function statusRow(overrides = {}) {
  return {
    replica_id: REPLICA_ID, subject_mode: "self", lifecycle: "enrolling",
    subject_person_id: "33333333-3333-4333-8333-333333333333",
    age_verified_at: new Date().toISOString(), identity_verified_at: new Date().toISOString(),
    liveness_verified_at: new Date().toISOString(), identity_expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    person_age_tier: "adult_verified", account_person_matches: true, inference_consent: true,
    profile_version: 1, profile_approved: true,
    calibration_version: null, calibration_approved: false,
    genome_version: null, genome_approved: false, genome_latest_version: null, genome_latest_status: null,
    voice_profile_id: null, voice_ready: false, test_voice: false, qualification_passed: 0,
    fidelity_status: null, fidelity_score: null, fidelity_computed_at: null,
    readiness_overall: null, readiness_min_part: null, readiness_unmeasured: 0, readiness_computed_at: null,
    capability_state: null, capability_activated_at: null, candidate_binding_required: false,
    candidate_runtime_authorized: true,
    ...overrides,
  };
}

const PROFILE_DEFINITION = {
  schema: "vyakti.person-model.v1",
  identity: { self_name: "Rehearsal Person", pronouns: "she/her", home: "", culture: "" },
  speech: { languages: ["Hindi", "English"], code_switching: "", register: "", fillers: [], pacing: "", dialogue_register: { sources: 0, claims: [] } },
  behavior: { turn_shape: "", humor: "Dry, deadpan jokes with close friends.", disagreement: "", repair: "", emotional_regulation: "" },
  values: [], boundaries: ["Never discuss other people's private medical details."],
  autobiography: [], knowledge: [], relationship_modes: [], uncertainty: { alternatives: [] },
  provenance: { builder: "person-model-builder/v1", claims: [{ claim_id: "1", domain: "identity", key: "self_name", confidence: 1, origin: "self_declared" }] },
};

const FAKE_VIBE = { vibe_id: "v1", replica_id: REPLICA_ID, owner_user_id: OWNER_ID, version: 1, warmth: 3, energy: 2, humour: 3, directness: 1, formality: 1, note: "", created_at: new Date().toISOString() };

/** One fake db per scenario. `row: null` means RUNTIME_STATUS_SQL finds no
 *  replica at all (an owner asking about someone else's replica_id, or one
 *  that never existed) — every other scenario passes a real row shaped by
 *  `statusRow()`'s overrides. `withVibe`/`withProfile` gate the two other
 *  statements `generateOwnedTextDialogue` issues once text_ready is true.
 *  WS-R172: `withMemory`/`facts` gate `OWNER_MEMORY_RECALL_SQL` (the owner's
 *  extracted Meet memory, only reachable once `loadOwnedTextIdentity` finds
 *  a real `row.agent_id` — `statusRow()`'s own default has none, matching
 *  a genuinely fresh replica before this workstream's own agent mint has
 *  ever run); the relationship-snapshot queries `loadPrivateRelationshipSnapshot`
 *  issues always answer `[]` (never a fabricated relationship). */
function fakeDb({ row, withProfile = true, withVibe = true, withMemory = false, facts = [] } = {}) {
  const calls = [];
  const db = async (sql, params) => {
    calls.push(sql);
    if (sql === RUNTIME_STATUS_SQL) return row ? [row] : [];
    if (sql === TEXT_CAPABILITY_ENSURE_SQL) return []; // the write path; unproven offline, see this file's own header
    if (sql === OWNED_TEXT_PROFILE_SQL) return withProfile ? [{ version: 1, definition: JSON.stringify(PROFILE_DEFINITION) }] : [];
    if (sql === OWNED_PRIVATE_RUNTIME_CONTEXT_SQL) return []; // no active/private VOICE capability in any scenario this suite drives
    if (sql === OWNER_MEMORY_RECALL_SQL) return withMemory ? facts : [];
    if (/from vy_(?:rel_state|pattern|ritual|currency|phrase|kin)\b/.test(sql)) return [];
    if (sql.includes("from vy_replica where replica_id = $1::uuid and owner_user_id = $2::uuid")) return withProfile ? [{ replica_id: params[0] }] : [];
    if (sql.includes("from vy_replica_vibe where replica_id=$1::uuid and owner_user_id=$2::uuid and superseded_at is null")) return withVibe ? [FAKE_VIBE] : [];
    throw new Error(`text-ready fixture: unmatched SQL statement (${sql.length} chars): ${sql.slice(0, 120)}`);
  };
  return { db, calls };
}

function fakeGenerator(replyText = "Namaste! I am still learning, but happy to talk.") {
  let calls = 0;
  let lastPrompt = null;
  return {
    generator: {
      family: "rehearsal", name: "fake-text-dialogue", version: "v1", model: "rehearsal-fake",
      generate: async ({ prompt }) => {
        calls++;
        lastPrompt = prompt;
        return { output: { reply: replyText, delivery: { mode: "grounded", pace: "natural", intensity: 0.4, language_hint: "", nonverbals: [] } }, usage: null };
      },
    },
    calls: () => calls,
    lastPrompt: () => lastPrompt,
  };
}

// ── 1. textBlockers, the pure function ─────────────────────────────────────
ok("a replica with no profile at all is NOT text_ready", textBlockers(statusRow({ profile_approved: false, profile_version: null })).includes("person_profile_not_approved"));
ok("a revoked replica is refused (text-ready)", textBlockers(statusRow({ lifecycle: "revoked" })).includes("replica_revoked"));
ok("a purging replica is refused (text-ready)", textBlockers(statusRow({ lifecycle: "purging" })).includes("replica_revoked"));
ok("no consent granted is not text_ready", textBlockers(statusRow({ inference_consent: false })).includes("inference_consent_required"));
ok("identity not bound is not text_ready", textBlockers(statusRow({ subject_person_id: null, account_person_matches: false })).includes("self_identity_not_bound"));
ok("a non-self replica is never text_ready", textBlockers(statusRow({ subject_mode: "teacher" })).includes("self_replica_only"));
ok("an eligible replica IS text_ready with zero blockers", textBlockers(statusRow()).length === 0, JSON.stringify(textBlockers(statusRow())));
ok("a missing row is refused by name", textBlockers(null).includes("replica_not_found"));

// text_ready never depends on ANY voice-pipeline field — the whole point.
ok("text_ready holds with no calibration, no genome, no voice, zero qualification suites passed, no readiness snapshot", textBlockers(statusRow({
  calibration_approved: false, genome_approved: false, voice_ready: false, qualification_passed: 0,
  fidelity_status: null, readiness_computed_at: null,
})).length === 0);

// ── 2. clientRuntimeStatus carries text_ready as a PEER of active/blockers ─
{
  const eligible = clientRuntimeStatus(statusRow());
  ok("clientRuntimeStatus.text_ready is true for an eligible row", eligible.text_ready === true);
  ok("clientRuntimeStatus.text_ready never implies voice active", eligible.active === false && eligible.blockers.length > 0);
  const revoked = clientRuntimeStatus(statusRow({ lifecycle: "revoked" }));
  ok("clientRuntimeStatus.text_ready is false for a revoked row", revoked.text_ready === false && revoked.text_blockers.includes("replica_revoked"));
}

// ── 3. compileReplicaRuntimeCore's new, optional vibe parameter ────────────
{
  const withoutVibe = compileReplicaRuntimeCore(PROFILE_DEFINITION, null, "hello");
  const withVibeArg = compileReplicaRuntimeCore(PROFILE_DEFINITION, null, "hello", undefined, FAKE_VIBE);
  ok("omitting vibe renders byte-identical to before this parameter existed", !withoutVibe.includes("YOUR OWN VIBE"));
  ok("passing a real vibe row renders the vibe line", withVibeArg.includes("YOUR OWN VIBE") && withVibeArg.includes("warmth: affectionate"));
  ok("the vibe line never displaces the profile's own knowledge/boundaries", withVibeArg.includes("Boundaries:"));
}

// ── 4. generateOwnedTextDialogue: the door itself ───────────────────────────
{
  const { db } = fakeDb({ row: statusRow() });
  const { generator, calls } = fakeGenerator("Namaste! I am still learning, but happy to talk.");
  const turn = await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Who are you?" }, generator, null);
  ok("a text-ready turn completes (the fake reply seam), never a crash", turn && typeof turn.reply === "string");
  ok("the fake generator was actually called exactly once", calls() === 1);
  ok("every reply carries the EXACT apprentice disclosure prefix", turn.reply.startsWith(TEXT_APPRENTICE_DISCLOSURE));
  ok("the model's own reply text still reaches the caller, after the prefix", turn.reply.includes("Namaste"));
  ok("a text-ready turn never claims voice (can_voice is always false)", turn.can_voice === false);
  ok("a text-ready turn is honestly stateless (no session)", turn.session_id === null);
  ok("a text-ready turn is marked text_ready for the client to render the apprentice framing", turn.text_ready === true);
}

// NEGATIVE CONTROL 1 — a replica with no source (no approved profile at
// all) is not text_ready; the door refuses, never a fabricated success.
{
  const { db } = fakeDb({ row: statusRow({ profile_approved: false, profile_version: null }), withProfile: false });
  const { generator, calls } = fakeGenerator();
  let error = null;
  try { await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Hello?" }, generator, null); }
  catch (cause) { error = cause; }
  ok("NEGATIVE CONTROL — a replica with no source (no approved profile) is refused, never a fabricated success",
    error?.code === "dialogue_text_not_ready" && Array.isArray(error?.details?.blockers) && error.details.blockers.includes("person_profile_not_approved"));
  ok("NEGATIVE CONTROL — the generator is never called for a replica that is not text_ready", calls() === 0);
}

// NEGATIVE CONTROL 2 — a revoked replica is refused.
{
  const { db } = fakeDb({ row: statusRow({ lifecycle: "revoked" }) });
  const { generator, calls } = fakeGenerator();
  let error = null;
  try { await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Hello?" }, generator, null); }
  catch (cause) { error = cause; }
  ok("NEGATIVE CONTROL — a revoked replica is refused", error?.code === "dialogue_text_not_ready" && error.details.blockers.includes("replica_revoked"));
  ok("NEGATIVE CONTROL — the generator is never called for a revoked replica", calls() === 0);
}

// NEGATIVE CONTROL 3 — a replica belonging to no one this owner can see
// (RUNTIME_STATUS_SQL finds nothing) is refused, never a crash.
{
  const { db } = fakeDb({ row: null, withProfile: false });
  const { generator, calls } = fakeGenerator();
  let error = null;
  try { await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Hello?" }, generator, null); }
  catch (cause) { error = cause; }
  ok("NEGATIVE CONTROL — a replica this owner cannot see is refused, never a crash", error?.code === "dialogue_runtime_not_active");
  ok("NEGATIVE CONTROL — the generator is never called", calls() === 0);
}

// ── 5. generateOwnedDialogue's own fallback: the SAME behavior through the
//    real conversation door, not a second, differently-wired path ──────────
{
  const { db } = fakeDb({ row: statusRow() });
  const { generator, calls } = fakeGenerator("A completed turn through the real door.");
  const turn = await generateOwnedDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Who are you?" }, generator, null, {});
  ok("generateOwnedDialogue itself falls back to the text-ready door when no voice capability is active", turn && turn.reply.startsWith(TEXT_APPRENTICE_DISCLOSURE));
  ok("the fallback used the SAME generator, called exactly once", calls() === 1);
}

// ── 6. WS-R172: continuity without a voice — the owner's Meet memory and
//    relationship state reach the text-ready door's own compile ──────────
{
  const factRow = { id: "9001", body: "switched to a morning schedule this month", kind: "user", name: "preference", created_at: new Date().toISOString(), communication: null };
  const { db } = fakeDb({ row: statusRow({ agent_id: AGENT_ID }), withMemory: true, facts: [factRow] });
  const { generator, calls, lastPrompt } = fakeGenerator("Glad the morning schedule is working out.");
  const turn = await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Do you remember what I told you?" }, generator, null);
  ok("a text-ready turn with a minted agent and an extracted fact completes", calls() === 1 && typeof turn.reply === "string");
  ok("the compiled prompt's own system message carries the fact body (through compileRelationshipTail/ownerMemoryTail, the SAME compile the voice-ready door uses)",
    lastPrompt()?.messages?.[0]?.content?.includes(factRow.body));
  ok("the turn honestly reports has_memory:true", turn.has_memory === true);
  ok("has_continuity stays false (text-ready is stateless turn-to-turn, an unrelated, unchanged fact)", turn.has_continuity === false);
}

// NEGATIVE CONTROL 4 — a text-ready replica with NO minted agent yet
// (`statusRow()`'s own default) never fabricates memory, even when the
// fixture's own `OWNER_MEMORY_RECALL_SQL` branch would otherwise answer a
// fact — proving the agent-presence check in `loadOwnedTextIdentity`, not
// merely a coincidentally-empty fixture, is what gates this.
{
  const factRow = { id: "9002", body: "should never reach an agent-less replica", kind: "user", name: "preference", created_at: new Date().toISOString(), communication: null };
  const { db } = fakeDb({ row: statusRow(), withMemory: true, facts: [factRow] });
  const { generator, calls, lastPrompt } = fakeGenerator("Good to meet you.");
  const turn = await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Do you remember me?" }, generator, null);
  ok("NEGATIVE CONTROL — the turn still completes honestly (never a crash) with no agent minted yet", calls() === 1 && typeof turn.reply === "string");
  ok("NEGATIVE CONTROL — no agent means no memory tail reaches the compiled prompt, even though the fixture's own memory branch would answer one",
    !lastPrompt()?.messages?.[0]?.content?.includes(factRow.body));
  ok("NEGATIVE CONTROL — has_memory reports false honestly", turn.has_memory === false);
}

// NEGATIVE CONTROL 5 — a minted agent but memory OFF (the fixture's own
// `withMemory:false`) never leaks the same fact into the compiled prompt.
{
  const factRow = { id: "9003", body: "should never reach a turn while memory is off", kind: "user", name: "preference", created_at: new Date().toISOString(), communication: null };
  const { db } = fakeDb({ row: statusRow({ agent_id: AGENT_ID }), withMemory: false, facts: [factRow] });
  const { generator, lastPrompt } = fakeGenerator("Tell me more.");
  const turn = await generateOwnedTextDialogue(db, OWNER_ID, { replica_id: REPLICA_ID, message: "Do you remember me?" }, generator, null);
  ok("NEGATIVE CONTROL — memory off: the same fact never reaches the compiled prompt", !lastPrompt()?.messages?.[0]?.content?.includes(factRow.body));
  ok("NEGATIVE CONTROL — memory off: has_memory reports false honestly", turn.has_memory === false);
}

// ── 7. WS-R172: loadOwnedTextIdentity, the pure identity loader ──────────
{
  const { db } = fakeDb({ row: statusRow({ agent_id: AGENT_ID }) });
  const identity = await loadOwnedTextIdentity(db, OWNER_ID, REPLICA_ID);
  ok("loadOwnedTextIdentity returns the real agent/person ids for an eligible, agent-minted replica",
    identity?.agent_id === AGENT_ID && identity?.subject_person_id === statusRow().subject_person_id);

  const { db: dbNoAgent } = fakeDb({ row: statusRow() });
  const noAgent = await loadOwnedTextIdentity(dbNoAgent, OWNER_ID, REPLICA_ID);
  ok("NEGATIVE CONTROL — loadOwnedTextIdentity returns null for an eligible replica with no minted agent yet, never a fabricated id", noAgent === null);

  const { db: dbRevoked } = fakeDb({ row: statusRow({ agent_id: AGENT_ID, lifecycle: "revoked" }) });
  const revokedIdentity = await loadOwnedTextIdentity(dbRevoked, OWNER_ID, REPLICA_ID);
  ok("NEGATIVE CONTROL — loadOwnedTextIdentity returns null for a revoked replica, even with an agent already minted", revokedIdentity === null);
}

console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
