// WS-AC. The CLONE'S REPLY inside a Mirror Call — the half WS-X did not build.
//
// Contract: docs/gurukul/MIRROR-CALL-SPEC.md §"Clone speech" and §"Build shape"
// ("Everything gated"), plus `src/studio/mirrorCallApi.ts`, which is the client
// side of every field asserted here.
//
// ── what this suite drives, and what it therefore proves ─────────────────
// The REAL reply assembler (api/_mirrorcall-reply.js) against the REAL sheet
// fixture bundled from source, the REAL store statements
// (api/_mirrorcall-store.js) against a fake database that routes on statement
// SHAPE, and the REAL wire adapter (api/_mirrorcall-wire.js) against real rows.
// So it can see: who the assembler refuses, which persona answered, whether the
// honest markers survive onto the wire, and whether the shape the studio parses
// would survive its own normalizer.
//
// It CANNOT see SQL types or referential integrity —
// `offline-mocks-cannot-type-check-sql`, and a mock cannot even tell you the
// statement PARSES. Migration 060 is UNAPPLIED and no statement added by this
// workstream has ever executed against a database. Said out loud here rather
// than implied by a green line.
//
// ── the fake database routes on STATEMENT SHAPE, never on a table name ────
// `router-matched-a-table-instead-of-a-statement`, the sibling suite's rule
// verbatim: a mock branch keyed on a table name will one day answer a different
// query than it was written for, and one that OVER-RETURNS hides real defects
// while every assertion stays green. Each branch matches a phrase unique to ONE
// statement, and an unmatched statement THROWS.
//
// ── §5 IS A NEGATIVE CONTROL AND IT IS THE POINT ─────────────────────────
// The one rule this workstream was given about synthesis is: do not fork the
// HMAC / watermark / disclosure path. A suite that only asserts the real path
// is correct proves nothing about that rule — the real path was already
// correct. So §5 keeps a FORKED protection adapter set beside the real one,
// with the watermark proof check struck out, and FAILS unless the fork is
// caught. If the strike ever stops being caught, the check that catches it has
// become decoration.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");
const load = (rel) => import(pathToFileURL(join(REPO, rel)).href);

let failed = 0;
let checks = 0;
const ok = (cond, what) => {
  checks++;
  if (cond) return true;
  failed++;
  console.log(`  FAIL ${what}`);
  return false;
};
const eq = (a, b, what) =>
  ok(Object.is(a, b), `${what} — got ${JSON.stringify(a)}, want ${JSON.stringify(b)}`);

// ── the fixture sheet, bundled from the REAL source ───────────────────────
// evals/clonechannel.mjs's pattern and CLAUDE.md's reason: a frozen bundle
// passes forever while the source rots.
const OUT = mkdtempSync(join(tmpdir(), "mirrorreply-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n`,
);
const BUNDLE = join(OUT, "mirrorreply.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const { DEMO_TEACHER } = await import(pathToFileURL(BUNDLE).href);

const reply = await load("api/_mirrorcall-reply.js");
const store = await load("api/_mirrorcall-store.js");
const wire = await load("api/_mirrorcall-wire.js");
const warmup = await load("api/_voice/warmup.js");
const contracts = await load("api/_voice/contracts.js");
const delivery = await load("api/_provenance/delivery.js");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const STRANGER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const REPLICA = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const AGENT = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SESSION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const WINDOW = "11111111-1111-4111-8111-111111111111";
const WINDOW_2 = "11111111-1111-4111-8111-111111111112";
const SHEET_DRAFT = "22222222-2222-4222-8222-222222222222";
const SHEET_PUB = "22222222-2222-4222-8222-222222222223";
const CONSENT = "33333333-3333-4333-8333-333333333333";
const SLUG = "arjun-sir-physics";

const sheetFor = (name, slug) => ({ ...DEMO_TEACHER, name, slug });
const SHEET_BODY = sheetFor("Arjun Sir", SLUG);

// ═════════════════════════════════════════════════════════════════════════
// the fake database
// ═════════════════════════════════════════════════════════════════════════

function fakeDb(seed = {}) {
  const state = {
    replicas: [{
      replica_id: REPLICA, owner_user_id: OWNER, agent_id: AGENT,
      subject_mode: seed.subjectMode ?? "self", lifecycle: seed.lifecycle ?? "enrolling",
    }],
    agents: [{ agent_id: AGENT, slug: SLUG }],
    sheets: seed.sheets ?? [{
      sheet_id: SHEET_DRAFT, agent_id: AGENT, version: "", status: "draft",
      consent_artifact_id: null, sheet: SHEET_BODY, published_at: null, created_at: 1,
    }],
    genomes: seed.genomes ?? [{ replica_id: REPLICA, version: 3, status: "draft" }],
    sessions: [{
      session_id: SESSION, replica_id: REPLICA, owner_user_id: OWNER,
      state: seed.sessionState ?? "open",
    }],
    windows: [
      { window_id: WINDOW, session_id: SESSION, replica_id: REPLICA, owner_user_id: OWNER, seq: 1, asr_state: "transcribed" },
      { window_id: WINDOW_2, session_id: SESSION, replica_id: REPLICA, owner_user_id: OWNER, seq: 2, asr_state: "dropped" },
    ],
    turns: [],
    unmatched: [],
  };

  const ownedReplica = (rid, owner) => state.replicas.find((r) =>
    r.replica_id === rid && r.owner_user_id === owner &&
    r.subject_mode === "self" && !["revoked", "purging"].includes(r.lifecycle));

  const db = async (sql, params) => {
    const has = (f) => sql.includes(f);

    // ── mirrorReplyAgent. The most specific phrase first: this is the only
    //    statement joining vy_teacher_sheet to vy_agent through vy_replica.
    if (has("join vy_agent a on a.agent_id = s.agent_id")) {
      const [rid, owner] = params;
      // The OWNER FENCE, read off the SQL text so §3g's strike is honoured by
      // this fake. `evals/clonechannel.mjs`'s technique: a mock that enforces a
      // predicate the statement no longer carries proves the mock, not the
      // statement.
      const fenced = has("r.owner_user_id = $2::uuid");
      const row = fenced
        ? ownedReplica(rid, owner)
        : state.replicas.find((r) => r.replica_id === rid &&
          r.subject_mode === "self" && !["revoked", "purging"].includes(r.lifecycle));
      if (!row) return [];
      const agent = state.agents.find((a) => a.agent_id === AGENT);
      // The predicates, read OFF THE SQL TEXT so §2c's strike is honoured.
      const excludesRevoked = has("s.status <> 'revoked'");
      const prefersPublished = has("order by (s.status = 'published' and s.consent_artifact_id is not null) desc");
      let rows = state.sheets.filter((s) => s.agent_id === AGENT)
        .filter((s) => !excludesRevoked || s.status !== "revoked");
      rows = rows.slice().sort((a, b) => {
        if (prefersPublished) {
          const rank = (s) => (s.status === "published" && s.consent_artifact_id ? 0 : 1);
          if (rank(a) !== rank(b)) return rank(a) - rank(b);
        }
        return b.created_at - a.created_at;
      });
      return rows[0] ? [{ ...rows[0], slug: agent.slug }] : [];
    }

    // ── mirrorDraftGenomeVersion
    if (has("from vy_replica_voice_genome vg")) {
      const [rid, owner] = params;
      if (!ownedReplica(rid, owner)) return [];
      const rows = state.genomes
        .filter((g) => g.replica_id === rid && g.status === "draft")
        .sort((a, b) => b.version - a.version);
      return rows[0] ? [{ version: rows[0].version }] : [];
    }

    // ── recordMirrorTurn. The ONE write. Matched before any plain turn read
    //    because it also contains a turn select in its returning clause.
    if (has("with allowed as (")) {
      const requireOpen = has("s.state = 'open'");
      const requireTranscribed = has("w.asr_state = 'transcribed'");
      const [rid, sid, wid, text, assembled, sheetId, source, slug, owner, gateApplied, findings] = params;
      if (!ownedReplica(rid, owner)) return [];
      const sess = state.sessions.find((s) => s.session_id === sid && s.replica_id === rid &&
        s.owner_user_id === owner && (!requireOpen || s.state === "open"));
      if (!sess) return [];
      const win = state.windows.find((w) => w.window_id === wid && w.session_id === sid &&
        w.replica_id === rid && w.owner_user_id === owner &&
        (!requireTranscribed || w.asr_state === "transcribed"));
      if (!win) return [];
      // `on conflict (window_id) do nothing` — the unique index is the shape
      // that makes an ingest retry a retry rather than a second clone turn.
      if (state.turns.some((t) => t.window_id === wid)) return [];
      const row = {
        turn_id: `f0000000-0000-4000-8000-${String(state.turns.length + 1).padStart(12, "0")}`,
        session_id: sid, window_id: wid, replica_id: rid, owner_user_id: owner,
        seq: win.seq, text, assembled_chars: assembled, sheet_id: sheetId,
        sheet_source: source, agent_slug: slug, gate_applied: gateApplied,
        gate_findings: findings, generation_id: null, voice_state: "unspoken",
        voice_failure_code: "", created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      state.turns.push(row);
      return [row];
    }

    // ── noteMirrorTurnVoice
    if (has("update vy_mirror_turn t")) {
      const [sid, tid, owner, voiceState, failureCode, generationId] = params;
      const row = state.turns.find((t) => t.turn_id === tid && t.session_id === sid && t.owner_user_id === owner);
      if (!row) return [];
      row.voice_state = voiceState;
      row.voice_failure_code = failureCode;
      if (generationId) row.generation_id = generationId;
      return [row];
    }

    // ── getMirrorTurn (by turn_id, with the lifecycle exists-clause)
    if (has("where t.turn_id = $2::uuid and t.session_id = $1::uuid")) {
      const [sid, tid, owner] = params;
      const row = state.turns.find((t) => t.turn_id === tid && t.session_id === sid && t.owner_user_id === owner);
      if (!row) return [];
      return ownedReplica(row.replica_id, owner) ? [row] : [];
    }

    // ── getMirrorTurnByWindow
    if (has("where t.window_id = $3::uuid and t.session_id = $2::uuid")) {
      const [rid, sid, wid, owner] = params;
      const row = state.turns.find((t) => t.window_id === wid && t.session_id === sid &&
        t.replica_id === rid && t.owner_user_id === owner);
      return row ? [row] : [];
    }

    // ── listMirrorTurns
    if (has("order by t.seq asc limit 2000")) {
      const [sid, rid, owner] = params;
      return state.turns.filter((t) => t.session_id === sid && t.replica_id === rid && t.owner_user_id === owner)
        .sort((a, b) => a.seq - b.seq);
    }

    // An unmatched statement THROWS. An empty answer from a mock is
    // indistinguishable from a correct empty answer from Postgres.
    state.unmatched.push(sql.slice(0, 120));
    throw new Error(`unrouted statement: ${sql.slice(0, 160)}`);
  };
  return { db, state };
}

// ═════════════════════════════════════════════════════════════════════════
// the fake engine — the six gate functions plus compile, and nothing else
// ═════════════════════════════════════════════════════════════════════════
//
// `hasGate()` requires exactly these six. A fake missing one would exercise
// `gateReply`'s FAIL-CLOSED branch instead of its real path, so §1f asserts the
// fake satisfies `hasGate` — otherwise every "the clone replied" check below
// would be silently testing suppression.

function fakeEngine(overrides = {}) {
  return {
    compile: (input) => ({ core: `core:${input.medium}/${input.mode}`, tail: `tail:${input.latestUserText}`, input }),
    parseBubbles: (text) => ({ bubbles: String(text).split("\n").filter(Boolean) }),
    stripTextingDashes: (b) => b,
    guardReply: (parsed) => ({ reply: parsed, findings: [] }),
    openCommitments: () => [],
    hisVocabulary: () => [],
    sharedVocabulary: () => [],
    ...overrides,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// 1. REPLY ASSEMBLY — the owner's own sheet, through the one door
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 1. reply assembly ──");

{
  const engine = fakeEngine();
  const surface = await load("api/_surface.js");
  ok(surface.hasGate(engine),
    "the fake engine satisfies hasGate — otherwise every reply below would be testing SUPPRESSION, not assembly");

  const draftRow = { sheet_id: SHEET_DRAFT, agent_id: AGENT, status: "draft", consent_artifact_id: null, sheet: SHEET_BODY, slug: SLUG };
  let compiled = null;
  const out = await reply.assembleMirrorReply({
    sheetRow: draftRow,
    history: [],
    latestText: "toh basically dekho, force ka matlab hai rate of change of momentum",
    engine,
    reply: (c) => { compiled = c; return "haan exactly, wahi toh. rate of change of momentum."; },
  });

  ok(out.ok, "a transcribed owner window produces a clone turn");
  eq(out.text, "haan exactly, wahi toh. rate of change of momentum.", "and the turn is the gated engine text");
  eq(out.sheetSource, "draft", "from the DRAFT sheet, because no published one exists");
  eq(out.agentSlug, SLUG, "carrying the agent slug the sheet actually names");
  eq(out.truncated, false, "a short reply is not truncated");

  // The compile inputs. These are the difference between a Mirror Call reply
  // and a widget reply, and getting them wrong is invisible in the output.
  ok(compiled, "the reply function was reached — the assembler did not short-circuit");
  eq(compiled.input.medium, "voice", "compiled as SPOKEN, not texted — the owner grades it as a voice");
  eq(compiled.input.mode, "call", "and in call mode, so the spoken-register rules apply");
  eq(compiled.input.memories, "", "with NO retrieval — the Mirror Call has no memory lane and claims none");
  eq(compiled.input.latestUserText,
    "toh basically dekho, force ka matlab hai rate of change of momentum",
    "the owner's own transcript is what the clone answers");
  ok(compiled.input.agent && compiled.input.agent.slug === SLUG,
    "the agent compiled against is the OWNER'S module, built by sheetToModule from their own sheet");

  // §1g THE PUBLISHED SHEET WINS. Same assembler, a published+consented row.
  const pubRow = { sheet_id: SHEET_PUB, agent_id: AGENT, status: "published", consent_artifact_id: CONSENT, sheet: SHEET_BODY, slug: SLUG };
  const pub = await reply.assembleMirrorReply({
    sheetRow: pubRow, history: [], latestText: "ek aur baat",
    engine, reply: () => "bolo",
  });
  ok(pub.ok, "a published sheet also replies");
  eq(pub.sheetSource, "published", "and says PUBLISHED, so the owner knows which clone they just graded");

  // A published row with no consent artifact is NOT published for this purpose.
  // 051's CHECK makes that row impossible in the database; the assembler
  // refusing to call it published anyway is the second layer, and it is the one
  // that survives someone widening the constraint.
  const unconsented = await reply.assembleMirrorReply({
    sheetRow: { ...pubRow, consent_artifact_id: null }, history: [], latestText: "hm",
    engine, reply: () => "hm",
  });
  eq(unconsented.sheetSource, "draft",
    "a 'published' row with no consent artifact is reported as DRAFT — consent, not status, is what published means");
}

// ═════════════════════════════════════════════════════════════════════════
// 2. THE REFUSALS — every one of them named, none of them a fallback persona
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 2. refusals ──");

{
  const engine = fakeEngine();

  // 2a NO SHEET AT ALL. The load-bearing refusal: an owner with no sheet gets
  // NO TURN, not a generic assistant wearing their cloned voice.
  const noSheet = await reply.assembleMirrorReply({
    sheetRow: null, history: [], latestText: "hello", engine, reply: () => "hi there!",
  });
  eq(noSheet.ok, false, "no sheet, no turn");
  eq(noSheet.reason, "clone_sheet_absent", "and the reason is NAMED");
  eq(noSheet.text, undefined, "there is no text on a refusal — no fallback persona exists to produce one");

  // 2b THE NEGATIVE CONTROL FOR 2a. If the assembler had ANY default-agent
  // branch, a null sheet plus a cooperative reply function would produce a
  // turn. It must not, and this is what proves the check in 2a is doing work
  // rather than tripping on a missing argument.
  ok(!noSheet.ok && !noSheet.text,
    "NEGATIVE CONTROL: a cooperative reply function cannot coax a turn out of a sheetless replica");

  // 2c AN INVALID SHEET fails closed rather than serving the version that
  // predates the rule. The draft path needs this more than the published one,
  // because a draft has never been through the publish gate at all.
  const broken = await reply.assembleMirrorReply({
    sheetRow: { sheet_id: SHEET_DRAFT, status: "draft", sheet: { name: "", slug: "" }, slug: SLUG },
    history: [], latestText: "hello", engine, reply: () => "hi",
  });
  eq(broken.ok, false, "an invalid sheet produces no turn");
  eq(broken.reason, "clone_sheet_invalid", "named as invalid, not as absent — they need different fixes");

  // 2d A WRONG-AGENT ROW. One mis-joined row is all it takes for an owner to
  // calibrate their voice against somebody else's persona.
  const mismatched = await reply.assembleMirrorReply({
    sheetRow: { sheet_id: SHEET_DRAFT, status: "draft", sheet: SHEET_BODY, slug: "someone-else-entirely" },
    history: [], latestText: "hello", engine, reply: () => "hi",
  });
  eq(mismatched.ok, false, "a sheet whose slug is not the row's slug is refused");
  eq(mismatched.reason, "clone_sheet_invalid", "the wrong-agent guard fires");

  // 2e NO ENGINE. A hand-rolled fallback prompt here would be a second clone of
  // a real, named, living person — and on this surface that person is the one
  // listening.
  const noEngine = await reply.assembleMirrorReply({
    sheetRow: { sheet_id: SHEET_DRAFT, status: "draft", sheet: SHEET_BODY, slug: SLUG },
    history: [], latestText: "hello", engine: null,
  });
  eq(noEngine.reason, "clone_engine_unavailable", "no engine is a NAMED absence, never a hand-rolled prompt");

  // 2f A DROPPED WINDOW. `clone-initiative-record-has-no-absence`: silence is
  // not an input the reply predicate has, so a window with no words gets no
  // reply rather than a reply about the silence.
  const dropped = await reply.assembleMirrorReply({
    sheetRow: { sheet_id: SHEET_DRAFT, status: "draft", sheet: SHEET_BODY, slug: SLUG },
    history: [], latestText: "   ", engine, reply: () => "you went quiet?",
  });
  eq(dropped.ok, false, "an empty transcript produces no turn");
  eq(dropped.reason, "owner_window_dropped", "named as a drop");
  ok(!dropped.text, "the clone does not answer nothing — `clone-initiative-record-has-no-absence`");

  // 2g AN EMPTY GATED REPLY. The gate suppressing everything is a real outcome
  // and it is not the same as the clone having nothing to say.
  const suppressed = await reply.assembleMirrorReply({
    sheetRow: { sheet_id: SHEET_DRAFT, status: "draft", sheet: SHEET_BODY, slug: SLUG },
    history: [], latestText: "hello", engine, reply: () => "",
  });
  eq(suppressed.reason, "clone_reply_empty", "a gate that suppressed everything says so");

  // 2h EVERY reason emitted above is in the published vocabulary. A reason
  // invented at a call site is a reason no client can render.
  for (const r of [noSheet, broken, mismatched, noEngine, dropped, suppressed]) {
    ok(reply.MIRROR_TURN_ABSENT_REASONS.includes(r.reason),
      `"${r.reason}" is in MIRROR_TURN_ABSENT_REASONS`);
  }
  ok(reply.MIRROR_TURN_ABSENT_REASONS.includes("clone_reply_lane_not_wired"),
    "the OLD reason is retained — a deployment still running WS-X's tree emits it, and a client must parse it");
}

// ═════════════════════════════════════════════════════════════════════════
// 3. OWNER SCOPING — a predicate, never a branch
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 3. owner scoping ──");

{
  const { db, state } = fakeDb();

  ok(await store.mirrorReplyAgent(db, OWNER, REPLICA), "the owner reaches their own sheet");
  eq(await store.mirrorReplyAgent(db, STRANGER, REPLICA), null,
    "a STRANGER reaches nothing — the sheet read is owner-scoped IN SQL");
  eq(await store.mirrorDraftGenomeVersion(db, STRANGER, REPLICA), null,
    "and a stranger cannot learn which version of somebody else's voice is current");
  eq(await store.mirrorDraftGenomeVersion(db, OWNER, REPLICA), 3,
    "the owner gets the newest DRAFT genome version, resolved server-side and never from the client");

  // The write. A stranger cannot cause a turn row on somebody else's window,
  // and the refusal is the `allowed` CTE returning nothing rather than a check.
  eq(await store.recordMirrorTurn(db, STRANGER, REPLICA, SESSION, {
    windowId: WINDOW, text: "not yours", sheetSource: "draft",
  }), null, "a stranger cannot write a turn onto another owner's window");
  eq(state.turns.length, 0, "and no row was created — the refusal is the absence of a write, not a rollback");

  const turn = await store.recordMirrorTurn(db, OWNER, REPLICA, SESSION, {
    windowId: WINDOW, text: "haan bilkul", assembledChars: 11,
    sheetSource: "draft", sheetId: SHEET_DRAFT, agentSlug: SLUG,
    gateApplied: true, gateFindings: 0,
  });
  ok(turn, "the owner's turn is written");
  eq(turn.sheet_source, "draft", "carrying its persona source");
  eq(turn.voice_state, "unspoken", "and starting unspoken — nothing has been synthesised yet");

  // 3d THE RETRY. An ingest whose response never reached the browser is retried
  // with the same window; the second attempt must return the SAME turn.
  const again = await store.recordMirrorTurn(db, OWNER, REPLICA, SESSION, {
    windowId: WINDOW, text: "a completely different reply", sheetSource: "draft",
  });
  eq(again.turn_id, turn.turn_id, "a retry returns the SAME turn — one window, one clone turn");
  eq(again.text, "haan bilkul", "and the original text, not the retry's — the first reply is the one that happened");
  eq(state.turns.length, 1, "still one row");

  // 3e A DROPPED window cannot carry a turn, and that is a SQL predicate
  // (`w.asr_state = 'transcribed'`) rather than a JS guard.
  eq(await store.recordMirrorTurn(db, OWNER, REPLICA, SESSION, {
    windowId: WINDOW_2, text: "answering a silence", sheetSource: "draft",
  }), null, "a dropped window cannot carry a clone turn");

  // 3f THE SYNTHESIS BINDING READ.
  eq((await store.getMirrorTurn(db, OWNER, SESSION, turn.turn_id)).text, "haan bilkul",
    "turn_voice's text comes from the ROW");
  eq(await store.getMirrorTurn(db, STRANGER, SESSION, turn.turn_id), null,
    "and a stranger cannot read it, so they cannot make another owner's clone speak");
}

// 3g THE NEGATIVE CONTROL ON THE OWNER CLAUSE. Strike `r.owner_user_id = $2`
// out of the sheet read and the stranger gets the sheet. If striking it makes
// no difference, the clause was decoration and the check above proved nothing.
{
  const { db } = fakeDb();
  const struck = async (sql, params) => db(sql.replace("and r.owner_user_id = $2::uuid", ""), params);
  // The fake honours the clause by reading it off the SQL text, so the struck
  // copy really does lose the fence.
  const leaked = await store.mirrorReplyAgent(struck, STRANGER, REPLICA);
  ok(leaked, "NEGATIVE CONTROL: with the owner clause struck, the stranger DOES reach the sheet");
  ok(!(await store.mirrorReplyAgent(db, STRANGER, REPLICA)),
    "so the shipping clause is what refuses them, not an accident of the fixture");
}

// ═════════════════════════════════════════════════════════════════════════
// 4. THE HONEST MARKERS ON THE WIRE
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 4. the wire ──");

{
  const row = {
    turn_id: "f0000000-0000-4000-8000-000000000001", text: "haan bilkul",
    assembled_chars: 11, sheet_source: "draft", sheet_id: SHEET_DRAFT,
    agent_slug: SLUG, gate_applied: true, gate_findings: 2, voice_state: "unspoken",
  };

  const wired = wire.wireTurn(row, { canVoice: true });
  eq(wired.turn_id, row.turn_id, "the contract's turn_id");
  eq(wired.text, "haan bilkul", "the contract's text");
  eq(wired.can_voice, true, "the contract's can_voice");
  eq(wired.sheet_source, "draft",
    "THE HONEST MARKER: the payload says which persona answered — `plausible-return-hides-a-dead-pipeline`");
  eq(wired.truncated, null, "an untruncated reply says so with null, not with silence");
  eq(wired.gate.findings, 2, "gate COUNTS travel");
  ok(!JSON.stringify(wired).includes("guardReply"), "and the strings the gate caught do not");

  // 4b `can_voice` is a statement about THIS DEPLOYMENT and is not optimistic.
  const mute = wire.wireTurn(row, { canVoice: false, voiceAbsentReason: "voice_route_unconfigured" });
  eq(mute.can_voice, false, "an unconfigured deployment says the turn cannot be voiced");
  eq(mute.voice_absent_reason, "voice_route_unconfigured",
    "and NAMES why — an owner must not read an unset env var as their clone failing");
  eq(wired.voice_absent_reason, "",
    "while a voiceable turn carries no reason, so the field is never a stale leftover");

  // 4c TRUNCATION IS NEVER SILENT.
  const trimmed = wire.wireTurn({ ...row, text: "short", assembled_chars: 900 }, { canVoice: true });
  ok(trimmed.truncated, "a capped reply carries its truncation block");
  eq(trimmed.truncated.assembled_chars, 900, "with what the engine actually produced");
  eq(trimmed.truncated.spoken_chars, 5, "and what the owner will hear");

  // 4d A TURN WITH NO TEXT IS NOT A TURN.
  eq(wire.wireTurn({ ...row, text: "" }, { canVoice: true }), null,
    "an empty turn wires to null, so the client's `turn && turn_id` test sees an absence rather than a blank caption");
  eq(wire.wireTurn(null), null, "and a null row wires to null");

  // 4e THE CLIENT'S OWN NORMALIZER. `ingestAudioWindow` accepts a turn only
  // when `turn_id` is a string, and reads exactly three fields off it.
  ok(typeof wired.turn_id === "string" && wired.turn_id.length > 0,
    "the studio's `typeof result.turn.turn_id === 'string'` test passes");
  ok(typeof wired.text === "string" && typeof wired.can_voice === "boolean",
    "and the two fields it reads beside it are the types it reads them as");
}

// ═════════════════════════════════════════════════════════════════════════
// 5. THE 501 -> SERVED TRANSITION, AND THE CAP THAT MUST NOT DRIFT
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 5. served ──");

{
  eq(wire.MIRROR_CALL_CONTRACT, "mirror-call/v1",
    "the contract version did NOT move — serving a new op is not a new contract");
  ok(wire.MIRROR_CALL_OPS.includes("turn_voice"),
    "turn_voice is on the served list (it answered 501 in WS-X's tree)");
  eq(wire.MIRROR_CALL_UNSERVED_OPS.length, 0,
    "and the unserved list is empty — nothing is advertised-and-silent");
  ok(wire.MIRROR_CALL_OPS.includes("status"),
    "status is served too, so the studio waits on a real answer instead of showing an estimate as a fact");

  // The route file's dispatcher must actually reach it. `aliveness-was-
  // unreachable-not-meera-bound`: a seam can be complete at both ends and still
  // be dead because nothing passes the argument between them. Grep for the
  // CALLER, not the definition.
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(join(REPO, "api/mirror-call.js"), "utf8");
  ok(/op === "turn_voice"/.test(route), "the dispatcher has a turn_voice branch");
  ok(/await opTurnVoice\(/.test(route), "and it CALLS opTurnVoice — a definition with no caller is not a feature");
  ok(/await cloneTurnFor\(/.test(route), "and ingest_window CALLS the reply assembler");
  ok(!/turn_absent_reason: "clone_reply_lane_not_wired"/.test(route),
    "the hardcoded not-wired reason is gone from the ingest payload");

  // THE CAP. `capMirrorReply` caps assembly at exactly what `capPanelText`
  // will accept. If one moves and the other does not, every long turn becomes a
  // 413 the owner reads as a broken clone.
  eq(reply.MIRROR_REPLY_TEXT_MAX, warmup.PANEL_TEXT_MAX,
    "the reply cap EQUALS the synthesis cap — drift here is a support ticket, so it is a failing check instead");

  const capped = reply.capMirrorReply("x ".repeat(400));
  ok(capped.text.length <= reply.MIRROR_REPLY_TEXT_MAX, "a long reply is capped to what can be spoken");
  ok(capped.truncated, "and the cap is REPORTED, never silent");
  ok(capped.assembledChars > capped.text.length, "with the original length beside it");
  const short = reply.capMirrorReply("  haan   bilkul  ");
  eq(short.text, "haan bilkul", "a short reply is whitespace-normalised and otherwise untouched");
  eq(short.truncated, false, "and not reported as truncated");
}

// ═════════════════════════════════════════════════════════════════════════
// 6. THE SYNTHESIS PATH — DISCLOSURE AND WATERMARK, AND A FORK THAT MUST FAIL
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 6. synthesis ──");

{
  // 6a THE DISCLOSURE PREFIX IS THE PROVIDER'S INVARIANT AND IT IS ASSERTED.
  // `disclosure-announces-the-clone`: every synthesised clip SPEAKS this
  // sentence, and the honest consequence (it unblinds a listening test) is a
  // known cost that is paid, not a reason to drop it.
  eq(contracts.SYNTHETIC_AUDIO_DISCLOSURE, "This is an AI-generated voice replica.",
    "the disclosure sentence is the one the whole lane agrees on");
  eq(contracts.renderTextWithDisclosure("haan bilkul"),
    "This is an AI-generated voice replica. haan bilkul",
    "and it is PREPENDED to the text the runtime speaks");

  const goodResult = {
    format: { ...contracts.VOICE_PCM_FORMAT },
    stream: (async function* () { yield new Uint8Array([0, 0]); })(),
    renderedText: contracts.renderTextWithDisclosure("haan bilkul"),
  };
  ok(contracts.assertSynthesisResult(goodResult), "a clip carrying the disclosure passes assertSynthesisResult");

  // 6b THE NEGATIVE CONTROL ON THE DISCLOSURE. A clip WITHOUT the prefix must
  // be refused. If this ever stops throwing, the assertion has become
  // decoration and a clone can speak undisclosed.
  let threw = false;
  try {
    contracts.assertSynthesisResult({
      format: { ...contracts.VOICE_PCM_FORMAT },
      stream: (async function* () { yield new Uint8Array([0, 0]); })(),
      renderedText: "haan bilkul",
    });
  } catch { threw = true; }
  ok(threw, "NEGATIVE CONTROL: a clip with the disclosure prefix STRIPPED is refused");

  // And a clip that is ONLY the disclosure is refused too — the prefix is not
  // a way to satisfy the check with no content.
  let threwEmpty = false;
  try {
    contracts.assertSynthesisResult({
      format: { ...contracts.VOICE_PCM_FORMAT },
      stream: (async function* () { yield new Uint8Array([0, 0]); })(),
      renderedText: `${contracts.SYNTHETIC_AUDIO_DISCLOSURE} `,
    });
  } catch { threwEmpty = true; }
  ok(threwEmpty, "and a clip that is ONLY the disclosure is refused");

  // 6c THE MIRROR CALL DOES NOT FORK THE PATH. Read the route: it must reach
  // WS-W's handler and must NOT construct its own protection adapters, its own
  // HMAC, or its own disclosure.
  const { readFileSync } = await import("node:fs");
  const route = readFileSync(join(REPO, "api/mirror-call.js"), "utf8");
  ok(/handleVoicePreviewPanel\(/.test(route),
    "turn_voice synthesises through WS-W's handler — the HMAC, disclosure and watermark path is REUSED");
  ok(/protectReplicaStream\(/.test(route),
    "and hands the stream to the one protection path");
  ok(!/SYNTHETIC_AUDIO_DISCLOSURE/.test(route),
    "the route does NOT reimplement the disclosure — a second copy is a second place to drop it");
  // It may READ whether the HMAC secret exists — that is the configuration
  // question `voiceRouteState` answers so an unset env var reads as an unset
  // env var and not as a mute clone. It may not SIGN with it.
  ok(!/createHmac|createSign|\.digest\(/.test(route),
    "and it signs nothing of its own — the only signer is WS-W's provider");
  ok(/turn\.text/.test(route) && !/text:\s*(?:query|req\.query|body)\??\.\w*text/.test(route),
    "THE BINDING: the synthesised text is the TURN ROW's, never the caller's");

  // 6d THE FORKED SYNTHESIS PATH, WHICH MUST FAIL.
  //
  // `protectReplicaStream` refuses a watermark proof that does not bind to the
  // issued token hash (`assertWatermarkProof`). A fork that skips the embed —
  // the exact shortcut a well-meaning refactor takes when the watermarker is
  // slow — must be caught. This drives the REAL function with adapters whose
  // watermark returns an unbound proof.
  const format = { ...contracts.VOICE_PCM_FORMAT };
  const tokenHash = "a".repeat(64);
  const source = (async function* () { yield new Uint8Array([1, 2, 3, 4]); })();
  const baseAdapters = {
    tokenIssuer: { issue: async () => ({ message: new Uint8Array([7, 7]), tokenHash }) },
    replicaCommitter: { commit: async () => "b".repeat(64) },
    ledger: { open: async () => {}, abort: async () => {}, seal: async () => {} },
    disclosure: {
      prepend: async ({ stream }) => ({ stream, proof: { scheme: "audible-prefix-v1" } }),
    },
    // THE FORK: no watermark embedded, and a proof that binds to nothing.
    watermark: {
      name: "forked", version: "0",
      embed: async ({ stream }) => ({ stream, proof: { algorithm: "none" } }),
    },
  };
  let forkRefused = false;
  try {
    await delivery.protectReplicaStream({
      authorization: {
        generationId: "f0000000-0000-4000-8000-00000000000a",
        replicaId: REPLICA, ownerUserId: OWNER, policyVersion: "replica-self-v1",
      },
      sourceStream: source,
      format,
      adapters: baseAdapters,
      disclosureEvidence: { renderedText: contracts.renderTextWithDisclosure("hi"), renderer: "fake@0" },
      allowTestAdapters: true,
    });
  } catch { forkRefused = true; }
  ok(forkRefused,
    "NEGATIVE CONTROL: a FORKED synthesis path whose watermark proof does not bind to the issued token is REFUSED");
}

// ═════════════════════════════════════════════════════════════════════════
// 7. THE 202-WARMING CONTRACT — the same body the preview panel produces
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 7. warming ──");

{
  const body = warmup.warmingBody("runtime_cold", { wake_dispatched: true });
  eq(body.state, "warming", "a cold GPU is WARMING, not an error");
  eq(body.stage, "runtime_cold", "and names which cold start it is");
  ok(body.eta_seconds_low > 0 && body.eta_seconds_high >= body.eta_seconds_low,
    "carrying the MEASURED 2-3 minute band rather than a countdown nobody measured");
  eq(body.retry_after_ms, warmup.WARMUP.retryAfterMs, "and how long to wait before asking again");

  const front = warmup.warmingBody("admission_cold");
  ok(front.message !== body.message,
    "the broker's cold start and the runtime's are DIFFERENT states with different copy — they fail differently");

  // An admission REFUSAL must never be dressed up as latency. WS-L's negative
  // control, restated here because turn_voice is now a second caller of it.
  eq(warmup.classifyPreviewFailure({ code: "transport_binding_invalid" }).state, "error",
    "a wrong key or a replayed nonce is an ERROR, never a warming state");
  eq(warmup.classifyPreviewFailure({ code: "open_voice_unreachable" }).state, "warming",
    "while an unreachable runtime IS a warming state");

  // The warmth registry `status` reads from. A wake CLEARS the ready belief.
  const registry = warmup.createWarmthRegistry();
  const origin = "https://example.invalid";
  eq(registry.read(origin, 1000).state, "cold", "an origin nobody has poked is COLD, never assumed warm");
  registry.note(origin, "ready", 1000);
  eq(registry.read(origin, 1500).state, "warm", "a successful synthesis makes it warm");
  registry.note(origin, "waking", 2000);
  eq(registry.read(origin, 2100).state, "warming",
    "and a wake clears the ready belief rather than sitting beside it");
}

// ═════════════════════════════════════════════════════════════════════════
// 8. THE ROLLING CALL — history the next reply compiles against
// ═════════════════════════════════════════════════════════════════════════
console.log("\n── 8. history ──");

{
  const windows = [
    { seq: 1, asr_state: "transcribed", transcript: "pehla sawal" },
    { seq: 2, asr_state: "dropped", transcript: "" },
    { seq: 3, asr_state: "transcribed", transcript: "teesra sawal" },
  ];
  const turns = [
    { seq: 1, text: "pehla jawab" },
    { seq: 3, text: "teesra jawab" },
  ];
  const history = reply.mirrorReplyHistory(windows, turns);
  eq(history.length, 4, "a dropped window contributes NOTHING — no placeholder, no invented turn");
  eq(history[0].role, "user", "the owner speaks first");
  eq(history[1].content, "pehla jawab", "and the clone answers");
  eq(history[2].content, "teesra sawal", "in seq order, with the dropped window simply absent");

  const capped = reply.mirrorReplyHistory(
    Array.from({ length: 40 }, (_, i) => ({ seq: i + 1, asr_state: "transcribed", transcript: `w${i}` })),
    [],
  );
  eq(capped.length, reply.MIRROR_REPLY_HISTORY_TURNS,
    "history is bounded — an unbounded prompt inside a live call is an unbounded budget");
  eq(capped[capped.length - 1].content, "w39", "and it keeps the NEWEST turns, not the oldest");
}

console.log(`\n${failed ? "FAILED" : "PASSED"} — ${checks - failed}/${checks} checks`);
if (failed) process.exit(1);
