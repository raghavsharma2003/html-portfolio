// evals/room-relstate/run.mjs — WS-R154, "RelationOS in the Room".
//
// api/_room-relstate.js (new) is the whole surface this workstream adds: the
// compiler's raw ingredients for a Room follower's dyad (`fetchRoomRelBundle`),
// the follower's own "How we are" read (`roomRelStateFromFollower`), and the
// follower's own explicit rupture reset (`roomRelStateResetFromFollower`).
// This suite proves, offline, with a fake db and the REAL compiler:
//
//   1. The byte-identity safety frame: no `vy_rel_state` row => `null` =>
//      `compile()` renders EXACTLY the same bytes as no relBundle at all
//      (compiler.ts's own "gated entirely on `input.relBundle`" contract).
//   2. Field mapping is exact and type-coerced correctly (trust as Number,
//      rupture_open as Boolean, cs_ratio null-preserved).
//   3. The memory-off predicate (law 3, "their choice is the predicate"):
//      memory off issues ZERO queries and returns the honest `has_state:
//      false` shape — never a fabricated read.
//   4. The reset write never fabricates a citation: it either chains the
//      real citations of the event it supersedes, or refuses honestly
//      ("nothing_open"/"no_record") — with a NEGATIVE CONTROL proving the
//      refusal path is reachable and does not silently insert anyway.
//   5. A populated bundle actually changes the compiled bytes, and does so
//      through the SAME `compile()` path the DM lane uses (T2 `rel.snapshot`
//      renders `stageForDims`/the honorific/the coarse trust band).
//
// Offline, deterministic, $0 — no network, no database, no model call.
// Bundled fresh from the real source on every run, `gates-that-live-
// nowhere`'s reason (`context/rejected.md`).
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

// ─────────────────────────────────────────────────────────────────────────
// Bundle the REAL compiler + relstate.ts, esbuild's exact invocation
// evals/rupture-channel/run.mjs already proved out for this repo's own
// module graph (the capacitor alias is required there for the same reason:
// compiler.ts's own import chain).
// ─────────────────────────────────────────────────────────────────────────
const tmp = mkdtempSync(join(tmpdir(), "room-relstate-"));
const BUNDLE = join(tmp, "room-relstate.bundle.mjs");
try {
  execSync(
    `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
      `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
    { stdio: "inherit", cwd: ROOT },
  );
  const { compile, TEST_AGENT, initialRelState, stageForDims, ruptureStance } = await import(pathToFileURL(BUNDLE).href);

  // The decision module itself: plain JS, no bundling needed — this is the
  // literal file `api/room.js` imports in production.
  const RELSTATE = await import(pathToFileURL(join(ROOT, "api/_room-relstate.js")).href);
  const { fetchRoomRelBundle, roomRelStateFromFollower, roomRelStateResetFromFollower, MEERA_AGENT_ID } = RELSTATE;

  const PERSON = "rs-fixture-person-0000-000000000000";
  const AGENT = "rs-fixture-agent-00000-000000000000";
  const NOW = Date.UTC(2026, 8, 13, 9, 0, 0);
  const iso = (ms) => new Date(ms).toISOString();

  // ═══════════════════════════════════════════════════════════════════════
  // 1. fetchRoomRelBundle — byte-identity law and field mapping
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n── 1. fetchRoomRelBundle: byte-identity law and field mapping ──");
  {
    const emptyDb = async () => [];
    const bundleNone = await fetchRoomRelBundle(emptyDb, { personId: PERSON, agentId: AGENT });
    ok("no vy_rel_state row => null (never a fabricated default bundle)", bundleNone === null);

    const compiledWithNullVsAbsent = () => {
      const base = {
        agent: TEST_AGENT,
        user: { name: "", vibe: [], facts: {} }, messageCount: 5, medium: "text", mode: "chat",
        voiceEngine: "gemini", isDirective: false, watching: false, innerThread: "", innerWants: "",
        memories: "", herLife: "", cultureNoteText: "", latestUserText: "hi", nowMs: NOW,
      };
      return { withNull: compile({ ...base, relBundle: null }), absent: compile(base) };
    };
    const { withNull, absent } = compiledWithNullVsAbsent();
    ok("compile({relBundle:null}) is byte-identical to compile({}) with no relBundle field at all",
      withNull.system === absent.system);

    const row = {
      honorific: "aap", cs_ratio: null, cs_on_stress: "unknown", trust: "0.62", rupture_open: false,
      repair_state: "none", ritual_density: 0, pacing_gap_s: null, snapshot_ver: 4,
      updated_at: iso(NOW - 3600_000),
    };
    let queried = [];
    const dbRow = async (sql, params) => {
      queried.push(sql);
      if (sql.includes("select honorific")) return [row];
      if (sql.includes("dim = 'honorific'")) return [{ at: iso(NOW - 20 * 86_400_000) }];
      if (sql.includes("dim in ('rupture', 'repair')")) return [];
      throw new Error(`unexpected query: ${sql}`);
    };
    const bundle = await fetchRoomRelBundle(dbRow, { personId: PERSON, agentId: AGENT });
    ok("honorific passes through exactly", bundle.relState.honorific === "aap");
    ok("trust is coerced to a real Number, not a string", bundle.relState.trust === 0.62 && typeof bundle.relState.trust === "number");
    ok("rupture_open is coerced to a real Boolean", bundle.relState.rupture_open === false);
    ok("cs_ratio null is preserved, never coerced to 0", bundle.relState.cs_ratio === null);
    ok("lastHonorificMoveAt comes from the honorific-dim query", bundle.lastHonorificMoveAt === iso(NOW - 20 * 86_400_000));
    ok("lastRuptureMoveAt is null when no rupture/repair event has ever fired", bundle.lastRuptureMoveAt === null);
    ok("warmEpisodesSinceRupture is 0 and the vy_episode query is NEVER issued when rupture_open is false",
      bundle.warmEpisodesSinceRupture === 0 && !queried.some((q) => q.includes("vy_episode")));
    ok("every dyadic derivation this workstream does not populate is an empty array/null, never fabricated",
      bundle.patterns.length === 0 && bundle.rituals.length === 0 && bundle.homeRegion === null &&
      bundle.currency.length === 0 && bundle.weEpisodes.length === 0 && bundle.phrases.length === 0 &&
      bundle.phraseLedger.length === 0);

    // The vy_episode guard, the other direction: rupture_open true DOES
    // trigger the warm-episode count, and only then.
    const rowOpen = { ...row, rupture_open: true, repair_state: "open" };
    let episodeQueried = false;
    const dbOpen = async (sql) => {
      if (sql.includes("select honorific")) return [rowOpen];
      if (sql.includes("dim = 'honorific'")) return [];
      if (sql.includes("dim in ('rupture', 'repair')")) return [{ at: iso(NOW - 2 * 86_400_000) }];
      if (sql.includes("vy_episode")) { episodeQueried = true; return [{ c: 3 }]; }
      throw new Error(`unexpected query: ${sql}`);
    };
    const bundleOpen = await fetchRoomRelBundle(dbOpen, { personId: PERSON, agentId: AGENT });
    ok("an OPEN rupture with a real lastRuptureMoveAt DOES query vy_episode for warmEpisodesSinceRupture",
      episodeQueried && bundleOpen.warmEpisodesSinceRupture === 3);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 2. roomRelStateFromFollower — the memory-off predicate
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n── 2. roomRelStateFromFollower: memory-off issues ZERO queries ──");
  {
    const throwingDb = async (sql) => { throw new Error(`memory is OFF — no query should ever reach here: ${sql}`); };
    const off = await roomRelStateFromFollower(throwingDb, { person_id: PERSON, agent_id: AGENT, memory_consent_at: null });
    ok("memory off returns the honest {has_state:false, memory_on:false} shape, never throwing",
      off.has_state === false && off.memory_on === false);

    const emptyDb = async () => [];
    const onNoRow = await roomRelStateFromFollower(emptyDb, { person_id: PERSON, agent_id: AGENT, memory_consent_at: iso(NOW - 86_400_000) });
    ok("memory on, no vy_rel_state row yet => {has_state:false, memory_on:true} (the common case, relstate-zero-rows)",
      onNoRow.has_state === false && onNoRow.memory_on === true);

    const row = { honorific: "tu", cs_ratio: null, cs_on_stress: "unknown", trust: 0.8, rupture_open: false, repair_state: "none", ritual_density: 0, pacing_gap_s: null, snapshot_ver: 1, updated_at: iso(NOW) };
    const dbRow = async (sql) => (sql.includes("select honorific") ? [row] : []);
    const onWithRow = await roomRelStateFromFollower(dbRow, { person_id: PERSON, agent_id: AGENT, memory_consent_at: iso(NOW - 86_400_000) });
    ok("memory on, a real row => full raw fields, honorific included", onWithRow.has_state === true && onWithRow.honorific === "tu" && onWithRow.trust === 0.8);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 3. roomRelStateResetFromFollower — never fabricates a citation
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n── 3. roomRelStateResetFromFollower: honest no-ops, and citations are chained never fabricated ──");
  {
    const noRowDb = async () => [];
    const noRow = await roomRelStateResetFromFollower(noRowDb, { person_id: PERSON, agent_id: AGENT });
    ok("no vy_rel_state row at all => {reset:false, reason:'nothing_open'}", noRow.reset === false && noRow.reason === "nothing_open");

    const closedDb = async (sql) => (sql.includes("select rupture_open") ? [{ rupture_open: false, repair_state: "none", snapshot_ver: 1 }] : []);
    const closed = await roomRelStateResetFromFollower(closedDb, { person_id: PERSON, agent_id: AGENT });
    ok("rupture_open already false => the SAME honest no-op, never a fabricated success", closed.reset === false && closed.reason === "nothing_open");

    // NEGATIVE CONTROL: an open rupture with NO citable event to chain from
    // (a state the schema should never actually produce, since every write
    // path cites something — but this function must refuse rather than
    // fabricate one if it ever did happen) never inserts.
    let insertCalled = false;
    const noRecordDb = async (sql) => {
      if (sql.includes("select rupture_open")) return [{ rupture_open: true, repair_state: "open", snapshot_ver: 2 }];
      if (sql.includes("select citations")) return [];
      if (sql.includes("insert into vy_rel_event")) { insertCalled = true; return []; }
      throw new Error(`unexpected query: ${sql}`);
    };
    const noRecord = await roomRelStateResetFromFollower(noRecordDb, { person_id: PERSON, agent_id: AGENT });
    ok("NEGATIVE CONTROL: an open rupture with NO citable event refuses ('no_record'), and NEVER calls insert",
      noRecord.reset === false && noRecord.reason === "no_record" && insertCalled === false);

    // The successful path: citations are CHAINED from the real prior event,
    // never invented — asserted by capturing the exact params the insert
    // statement is called with.
    let capturedInsertSql = null;
    let capturedInsertParams = null;
    let capturedUpdateParams = null;
    const REAL_CITATIONS = [4001, 4002];
    const okDb = async (sql, params) => {
      if (sql.includes("select rupture_open")) return [{ rupture_open: true, repair_state: "open", snapshot_ver: 5 }];
      if (sql.includes("select citations")) return [{ citations: REAL_CITATIONS }];
      if (sql.includes("insert into vy_rel_event")) { capturedInsertSql = sql; capturedInsertParams = params; return []; }
      if (sql.includes("update vy_rel_state")) { capturedUpdateParams = params; return [{ repair_state: "repaired", rupture_open: false }]; }
      throw new Error(`unexpected query: ${sql}`);
    };
    const okResult = await roomRelStateResetFromFollower(okDb, { person_id: PERSON, agent_id: AGENT });
    ok("a real open rupture with a citable event resets successfully", okResult.reset === true && okResult.repair_state === "repaired" && okResult.rupture_open === false);
    // The insert statement binds (person_id, agent_id, from_v, note,
    // citations) as $1..$5, in that order — citations is params[4].
    ok("the written event's citations are EXACTLY the chained ones, never invented, never dropped, never padded",
      JSON.stringify(capturedInsertParams?.[4]) === JSON.stringify(REAL_CITATIONS));
    ok("the direction is the literal 'reset' (the one Direction value no other writer in relstate.ts ever produces — this action's own signature), written in the statement text itself, never a caller-supplied value",
      /'repair',\s*\$3,\s*'repaired',\s*'reset',\s*\$4,\s*\$5/.test(capturedInsertSql || ""));
    ok("the update targets the SAME (person_id, agent_id) dyad the read used, never a third id",
      capturedUpdateParams?.[0] === PERSON && capturedUpdateParams?.[1] === AGENT);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 4. The compiler composition proof — the SAME compile() path
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n── 4. compile() actually renders this dyad's state (T2 rel.snapshot), and stageForDims agrees ──");
  {
    const state = { ...initialRelState(PERSON), honorific: "tu", trust: 0.75, rupture_open: false, repair_state: "none" };
    const relBundle = {
      relState: state, lastHonorificMoveAt: iso(NOW - 30 * 86_400_000), lastRuptureMoveAt: null,
      warmEpisodesSinceRupture: 0, patterns: [], rituals: [], homeRegion: null, currency: [],
      weEpisodes: [], phrases: [], phraseLedger: [],
    };
    const compiled = compile({
      agent: TEST_AGENT,
      user: { name: "", vibe: [], facts: {} }, messageCount: 12, medium: "text", mode: "chat",
      voiceEngine: "gemini", isDirective: false, watching: false, innerThread: "", innerWants: "",
      memories: "", herLife: "", cultureNoteText: "", latestUserText: "hi", nowMs: NOW, relBundle,
    });
    ok("the compiled tail carries the RELATIONSHIP STATE block", compiled.tail.includes("RELATIONSHIP STATE"));
    ok("the honorific renders", compiled.tail.includes("honorific: tu"));
    // `bandTrust` (0.7<=x<0.88 => "strong") is its OWN coarse vocabulary,
    // distinct from `Stage`'s (0.7<=x<0.88 => "close") — the T2 block renders
    // the former, `stageForDims` below computes the latter; the two are
    // deliberately different words for deliberately different questions.
    ok("the coarse trust band renders (0.75 => \"strong\"), never the raw number", compiled.tail.includes("trust: strong") && !compiled.tail.includes("0.75"));
    const stage = stageForDims(state, { lastRuptureMoveAt: relBundle.lastRuptureMoveAt, warmEpisodesSinceRupture: 0 });
    ok("stageForDims (the same function the account page imports) agrees this dyad reads as 'close'", stage === "close");

    // The rupture cap, the workstream brief's own opening citation
    // (`rejected.md#rupture-never-closes`): an OPEN rupture caps the stage
    // regardless of trust, on the LAPSING stance, not the raw flag.
    const openState = { ...state, rupture_open: true, repair_state: "open" };
    const stanceStillOpen = ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: iso(NOW - 2 * 86_400_000), warmEpisodesSince: 0 });
    const stanceLapsed = ruptureStance({ ruptureOpen: true, repairState: "open", lastMoveAt: iso(NOW - 30 * 86_400_000), warmEpisodesSince: 0 });
    ok("a fresh open rupture reads as an OPEN stance", stanceStillOpen === "open");
    ok("the SAME raw rupture_open, 30 days later with no signal, reads as SETTLED (the automatic lapse this workstream's reset gives a follower an explicit alternative to)", stanceLapsed === "settled");
    const stageOpen = stageForDims(openState, { lastRuptureMoveAt: iso(NOW - 2 * 86_400_000), warmEpisodesSinceRupture: 0 });
    ok("an OPEN rupture caps the stage below what trust alone (0.75) would earn — never 'close' while it is held", stageOpen === "warming");
  }

  // ═══════════════════════════════════════════════════════════════════════
  // 5. WIRING: roomSay actually gates fetchRoomRelBundle on remembers &&
  //    !expertProfile — static, with a negative control proving the check
  //    is not vacuous.
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n── 5. wiring: api/_room-surface.js gates the relBundle fetch on memory being ON ──");
  {
    const surfaceSrc = readFileSync(join(ROOT, "api/_room-surface.js"), "utf8");
    const GATE_RE = /const relBundle = remembers && !expertProfile\s*\n\s*\? await fetchRoomRelBundle\(/;
    ok("api/_room-surface.js's own relBundle fetch is gated on `remembers && !expertProfile`", GATE_RE.test(surfaceSrc));
    ok("api/_room-relstate.js is imported into api/_room-surface.js (the wiring this suite is checking is reachable at all)",
      /from ["']\.\/_room-relstate\.js["']/.test(surfaceSrc));
    // NEGATIVE CONTROL: the check above must actually be capable of failing.
    const mutated = surfaceSrc.replace("const relBundle = remembers && !expertProfile", "const relBundle = true");
    ok("NEGATIVE CONTROL: the same check against a mutated copy (gate removed) correctly fails",
      !GATE_RE.test(mutated));
  }

  console.log(`\nroom-relstate: ${pass} passed, ${fail} failed`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
if (fail) process.exit(1);
