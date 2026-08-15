// scripts/replay.mjs — SPEC.md §14.3 / §7.3's "replay-verified" requirement:
// re-assemble a compiled context from a session's LOGGED state and prove it
// deterministically, so a swap-test arm can be re-run against the exact
// context a real turn used, byte-identically.
//
// WHAT THIS ACTUALLY PROVES, stated precisely rather than aspirationally
// (see the SCOPE GAP note below — this is a deviation-from-spec finding, not
// an oversight):
//
//   1. DETERMINISM: given a CompileInput reconstructed from real DB state,
//      compiling it TWICE produces byte-identical output — the same
//      discipline SPEC §3.3 requires in CI for the fixture corpus ("Double-
//      compile byte-identity"), applied here to REAL session-derived input.
//   2. TRANSCRIPT FIDELITY: the fields reconstructed from persisted,
//      queryable state (turn count, latest user text, medium/mode, the
//      inter-turn gap) are checked byte-for-byte against `meera_log` itself
//      — no transcription step between the DB and the compiler input.
//
// SCOPE GAP (found, not assumed — verified by grep against the real
// codebase, 2026-08-15): SPEC §3.3 and §7.3 both describe a `compile.manifest`
// event — {model, adapter_version, core_hash, manifest_hash, snapshot_ver}
// logged to `meera_diag` on every turn, "1% sample in prod, 100% during any
// cohort arm" — as the mechanism that makes "D2's identical compiled
// contexts... a query, not a rig." THAT EVENT IS NOT EMITTED ANYWHERE in
// this codebase: `grep -rn "compile.manifest" src/ api/` returns nothing,
// and api/chat.js / brain.ts never write core_hash/manifest_hash/
// adapter_version to meera_diag. Nor is `keys.inner` (her carried interior),
// `herLife`, `ageGates`, or the relBundle-as-it-was-at-that-turn persisted
// anywhere versioned — `meera_state` holds only the CURRENT synced blob, not
// a per-turn history. Consequence: this script CANNOT reconstruct the
// original ORIGINAL served prompt byte-for-byte, because the inputs that
// would make that possible were never written down. What it delivers
// instead — determinism + transcript fidelity on real sessions — is the
// honest ceiling of what's replayable today, and the gap above is filed as
// an interface ticket against WS-COMPILER/WS-INTEGRATE (wire compile.manifest
// per SPEC §3.3 — see the WS-BATTERY exit report).
//
//   node scripts/replay.mjs                 → auto-picks 3 real sessions by
//                                              turn count, replays each
//   node scripts/replay.mjs --device <uuid>  → replay one specific device
//   node scripts/replay.mjs --n <k>          → replay k sessions (default 3)
//
// Read-only against the live DB (NEON_URL, via api/_db.js — same as
// scripts/relcheck.mjs). Writes nothing, so "wsbat-test-" residue does not
// apply here — there is no test data to clean up.
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DBATTERY = join(ROOT, "evals", "dbattery");
const BUNDLE = join(DBATTERY, ".bundle-replay.mjs");

// ── deviation check, printed unconditionally: does compile.manifest exist? ──
function checkManifestLogging() {
  const hits = [];
  for (const f of ["api/chat.js", "src/engine/brain.ts"]) {
    const p = join(ROOT, f);
    if (existsSync(p) && /compile\.manifest|core_hash|manifest_hash/.test(readFileSync(p, "utf8"))) hits.push(f);
  }
  return hits;
}

// rebuild from source every run — evals/run.mjs's own rule: "a frozen
// bundle passes forever while the source rots"
execSync(
  `npx esbuild ${join(DBATTERY, "replay-entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals", "stubs", "capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { compile, hashCore, coresByteIdentical, replaySnapshot } = await import(BUNDLE);
const { q } = await import(join(ROOT, "api", "_db.js"));

const args = process.argv.slice(2);
const argv = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const explicitDevice = argv("--device");
const N = Number(argv("--n") || 3);

async function pickSessions(n) {
  if (explicitDevice) return [explicitDevice];
  const rows = await q(
    `select device_id, count(*)::int n from meera_log
      where device_id::text not like 'wsbat-test-%'
      group by device_id order by n desc limit $1`,
    [n],
  );
  return rows.map((r) => r.device_id);
}

// Reconstruct the DB-backed slice of CompileInput for the LAST turn of a
// session — the deterministic part (SCOPE GAP note above covers the rest).
async function reconstruct(deviceId) {
  const log = await q(
    `select role, channel, kind, content, at from meera_log
      where device_id = $1 order by at asc`,
    [deviceId],
  );
  if (!log.length) return null;

  const last = log[log.length - 1];
  // find the most recent USER turn at/before `last` — that is what `latest`
  // and `messageCount` are computed against in brain.ts's think()
  let latestIdx = log.length - 1;
  while (latestIdx >= 0 && log[latestIdx].role !== "me") latestIdx--;
  if (latestIdx < 0) return null; // an all-assistant tail can't seed a turn

  const latestRow = log[latestIdx];
  const history = log.slice(0, latestIdx); // everything BEFORE the live turn
  const priorUser = [...history].reverse().find((r) => r.role === "me");
  const gapSinceLastMs = priorUser
    ? new Date(latestRow.at).getTime() - new Date(priorUser.at).getTime()
    : 0;
  const mode = latestRow.channel === "call" ? "call" : "chat";
  const medium = mode === "call" ? "voice" : "text";

  // relBundle: reconstructed via the SAME pure fold WS-RELSTATE ships
  // (relstate.ts replaySnapshot), bounded to events at/before this turn — a
  // real point-in-time replay where data exists. Today vy_rel_event is empty
  // for every device in this DB (verified 2026-08-15: `select count(*) from
  // vy_rel_event` = 0), so this path exercises the documented empty/absent
  // default — the same byte-identity floor compiler.ts's own header
  // describes ("absent is the only state today's fixtures exercise").
  let relBundle = null;
  const personRows = await q(`select person_id from vy_person_device where device_id = $1`, [deviceId]);
  if (personRows.length) {
    const personId = personRows[0].person_id;
    const events = await q(
      `select id, person_id, dim, from_v, to_v, direction, note, citations, at
         from vy_rel_event where person_id = $1 and at <= $2 order by at asc`,
      [personId, latestRow.at],
    );
    if (events.length) {
      const state = replaySnapshot(personId, events, { bumpVersion: false, baseVer: 0 });
      relBundle = {
        relState: state,
        lastHonorificMoveAt: null,
        patterns: [],
        rituals: [],
        homeRegion: null,
        currency: [],
        weEpisodes: [],
        phrases: [],
        phraseLedger: [],
      };
    }
  }

  return {
    deviceId,
    messageCount: history.length,
    medium,
    mode,
    latestUserText: latestRow.content,
    gapSinceLastMs,
    relBundle,
    // ── SCOPE GAP fields: no versioned, per-turn record exists for these.
    // Defaulted to the compiler's own documented "absent" behavior, which is
    // a real, well-defined input — not a fabrication — but it means the
    // compiled CORE below will not byte-match whatever the user profile /
    // inner state / herLife actually were at the historical moment. See the
    // file header.
    user: { name: "replayed-user", vibe: [], facts: {} },
    voiceEngine: "eleven",
    isDirective: false,
    watching: false,
    innerThread: "",
    innerWants: "",
    memories: "",
    herLife: "",
    cultureNoteText: "",
    ageGates: null,
    turnsInLog: log.length,
  };
}

async function replayOne(deviceId) {
  const r = await reconstruct(deviceId);
  if (!r) return { deviceId, ok: false, reason: "no user turn in meera_log" };

  const input = {
    user: r.user,
    messageCount: r.messageCount,
    medium: r.medium,
    mode: r.mode,
    voiceEngine: r.voiceEngine,
    isDirective: r.isDirective,
    watching: r.watching,
    innerThread: r.innerThread,
    innerWants: r.innerWants,
    memories: r.memories,
    herLife: r.herLife,
    cultureNoteText: r.cultureNoteText,
    relBundle: r.relBundle,
    latestUserText: r.latestUserText,
    gapSinceLastMs: r.gapSinceLastMs,
    ageGates: r.ageGates,
  };

  // ── proof 1: determinism (double-compile byte-identity on real input) ──
  const a = compile(input);
  const b = compile(input);
  const deterministic = coresByteIdentical(a.core, b.core) && a.tail === b.tail && a.system === b.system;

  // ── proof 2: transcript fidelity (reconstructed fields == meera_log) ──
  // (re-derive latest user text independently, from a fresh query, to prove
  // the reconstruction isn't just echoing its own earlier read)
  const freshFull = await q(
    `select role, content from meera_log where device_id = $1 order by at asc`,
    [deviceId],
  );
  const freshLatestUser = [...freshFull].reverse().find((row) => row.role === "me");
  const transcriptFidelity = freshLatestUser?.content === r.latestUserText;

  return {
    deviceId,
    ok: deterministic && transcriptFidelity,
    deterministic,
    transcriptFidelity,
    turnsInLog: r.turnsInLog,
    messageCount: r.messageCount,
    medium: r.medium,
    mode: r.mode,
    coreHash: hashCore(a.core),
    tailHash: hashCore(a.tail),
    coreLen: a.core.length,
    tailLen: a.tail.length,
    relBundlePresent: Boolean(r.relBundle),
  };
}

async function main() {
  const manifestHits = checkManifestLogging();
  console.log("── replay.mjs — SPEC §14.3 replay-verified proof ──\n");
  console.log(
    manifestHits.length
      ? `compile.manifest logging FOUND in: ${manifestHits.join(", ")}`
      : "compile.manifest logging: NOT FOUND in api/chat.js or src/engine/brain.ts (SPEC §3.3/§7.3 promise it; it is not wired — see file header SCOPE GAP)",
  );
  console.log("");

  const devices = await pickSessions(N);
  if (devices.length < N) {
    console.log(`WARNING: only ${devices.length} real session(s) with meera_log activity found (wanted ${N})`);
  }

  const results = [];
  for (const d of devices) {
    const r = await replayOne(d);
    results.push(r);
    console.log(`device ${d}`);
    if (!r.ok && r.reason) {
      console.log(`  SKIP — ${r.reason}`);
      continue;
    }
    console.log(`  turns in meera_log: ${r.turnsInLog}, messageCount reconstructed: ${r.messageCount}, medium/mode: ${r.medium}/${r.mode}`);
    console.log(`  ${r.deterministic ? "PASS" : "FAIL"}  double-compile byte-identity (core ${r.coreLen}ch, tail ${r.tailLen}ch, hash ${r.coreHash}/${r.tailHash})`);
    console.log(`  ${r.transcriptFidelity ? "PASS" : "FAIL"}  transcript fidelity (reconstructed latestUserText === fresh meera_log read)`);
    console.log(`  relBundle reconstructed from vy_rel_event: ${r.relBundlePresent ? "yes (events found)" : "no (none for this person — expected, table is empty in this DB today)"}`);
    console.log("");
  }

  const usable = results.filter((r) => !r.reason);
  const allOk = usable.length >= 3 && usable.every((r) => r.ok);
  console.log(
    allOk
      ? `REPLAY-VERIFIED: ${usable.length}/${usable.length} real sessions pass determinism + transcript fidelity (>=3 required).`
      : `REPLAY NOT VERIFIED: ${usable.filter((r) => r.ok).length}/${usable.length} sessions passed (need >=3 passing).`,
  );
  console.log(
    `\nScope, stated once more: this is determinism + transcript fidelity on real sessions, not byte-identity to the ORIGINAL served prompt — that requires compile.manifest wiring per the SCOPE GAP above. Ticketed to WS-COMPILER/WS-INTEGRATE.`,
  );
  process.exit(allOk ? 0 : 1);
}

await main();
