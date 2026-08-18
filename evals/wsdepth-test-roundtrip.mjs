// wsdepth-test-roundtrip — proves the replay-rebuild path (relstate.ts's
// REAL rebuildSnapshotFromDb, bundled fresh via esbuild, same as
// wsdepth-test-pure.mjs) reproduces the exact state that a sequence of
// trust/rupture/repair vy_rel_event rows encodes. Deliberately MECHANICAL,
// not LLM-driven: it writes rows in the exact shape deriveTrustRepairForPerson
// itself writes (dim/from_v/to_v/direction/citations), independent of
// whether any particular night's extraction judges correctly — the gate this
// suite proves is "the events replay to the right state", not "the model
// always classifies conflict correctly" (that is what wsdepth-test-llm-smoke
// covers, at n<=10, on real credits).
import { execSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { q } from "../api/_db.js";
import { makeFixturePerson, insertLogRow, insertEpisode, teardown, assertZeroResidue } from "./wsdepth-fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const tmp = mkdtempSync(join(tmpdir(), "wsdepth-rt-"));
const BUNDLE = join(tmp, "relstate.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "src/engine/relstate.ts")} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const { rebuildSnapshotFromDb, initialRelState } = await import(BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (cond) console.log(`  ok  ${name}`);
  else {
    failed++;
    console.log(`FAIL  ${name}  ${detail}`);
  }
};

const { personId, deviceId } = await makeFixturePerson();
console.log(`fixture person ${personId}`);

// QueryFn adapter: relstate.ts's writers are duck-typed against api/_db.js's
// q(query, params, timeoutMs) — the real one, not a fake, so this is a real
// round trip through the real driver too.
const qfn = (sql, params) => q(sql, params);

try {
  const day = (n) => new Date(Date.UTC(2026, 6, 1 + n, 12, 0, 0));
  const ep1 = await insertEpisode(personId, deviceId, {
    logFrom: await insertLogRow(deviceId, { content: "kal raat baat ki thi kuch tension ke baare mein", at: day(0) }),
    logTo: await insertLogRow(deviceId, { content: "acha theek hai", at: day(0) }),
    startedAt: day(0),
    summary: "sharp exchange, hurt feelings",
  });
  const ep2 = await insertEpisode(personId, deviceId, {
    logFrom: await insertLogRow(deviceId, { content: "sorry yaar wo galat tha", at: day(3) }),
    logTo: await insertLogRow(deviceId, { content: "chalo theek hai", at: day(3) }),
    startedAt: day(3),
    summary: "apology offered",
  });
  const ep3 = await insertEpisode(personId, deviceId, {
    logFrom: await insertLogRow(deviceId, { content: "phir se sorry, seriously", at: day(6) }),
    logTo: await insertLogRow(deviceId, { content: "thanks for understanding", at: day(6) }),
    startedAt: day(6),
    summary: "sustained repair, moving past it",
  });

  // Write the EXACT event sequence deriveTrustRepairForPerson's own writer
  // would produce across three nights: rupture opens (ep1), repair begins
  // (ep2), repair completes (ep3) — plus two independent trust-advance
  // events (ep1 decrease, ep3 increase) so the fold's per-dim independence
  // is exercised in the same pass.
  await q(
    `insert into vy_rel_event (person_id, dim, from_v, to_v, direction, note, citations, at) values
       ($1,'rupture','closed','open','advance','conflict-shaped episode: rupture opens',$2,$5),
       ($1,'trust','0.300','0.220','regress','withdrawal after the conflict',$2,$5),
       ($1,'repair','open','repairing','advance','their signal: repair begins',$3,$6),
       ($1,'repair','repairing','repaired','advance','their signal sustained: repaired, rupture closes',$4,$7),
       ($1,'trust','0.220','0.300','advance','warmth returned after repair',$4,$7)`,
    [personId, [ep1], [ep2], [ep3], day(0).toISOString(), day(3).toISOString(), day(6).toISOString()],
  );

  const state = await rebuildSnapshotFromDb(qfn, personId, { bumpVersion: true });

  ok("trust ends at 0.3 (down then back up, both events replayed in order)", Math.abs(state.trust - 0.3) < 1e-9, `trust=${state.trust}`);
  ok("rupture_open is false after the repaired event", state.rupture_open === false, `rupture_open=${state.rupture_open}`);
  ok("repair_state is repaired", state.repair_state === "repaired", `repair_state=${state.repair_state}`);
  ok("honorific untouched by trust/repair events (still schema default)", state.honorific === "tum", `honorific=${state.honorific}`);
  ok("snapshot_ver bumped once", state.snapshot_ver === 1, `snapshot_ver=${state.snapshot_ver}`);

  // Determinism: replaying the SAME events twice must be byte-identical —
  // the actual gate property (SPEC's own "same inputs, same snapshot,
  // byte-equal"), asserted directly rather than inferred from one run.
  const state2 = await rebuildSnapshotFromDb(qfn, personId, { bumpVersion: true });
  const a = JSON.stringify({ ...state, updated_at: null, snapshot_ver: null });
  const b = JSON.stringify({ ...state2, updated_at: null, snapshot_ver: null });
  ok("replay is byte-identical across two independent rebuilds", a === b, `${a} vs ${b}`);

  // The row this function writes back to vy_rel_state (the cache) must
  // itself reload to the same values — proves the INSERT..ON CONFLICT path,
  // not just the in-memory fold.
  const reloaded = await q(`select trust, rupture_open, repair_state from vy_rel_state where person_id = $1`, [personId]);
  ok(
    "vy_rel_state cache row matches the replayed state",
    Math.abs(Number(reloaded[0].trust) - 0.3) < 1e-9 && reloaded[0].rupture_open === false && reloaded[0].repair_state === "repaired",
    JSON.stringify(reloaded[0]),
  );

  // A from-scratch replay (no cached vy_rel_state row) must reach the exact
  // same state — the forget-cascade rebuild scenario this mechanism exists
  // for in the first place.
  await q(`delete from vy_rel_state where person_id = $1`, [personId]);
  const fromScratch = initialRelState(personId);
  void fromScratch;
  const rebuilt = await rebuildSnapshotFromDb(qfn, personId, { bumpVersion: true });
  ok(
    "rebuild from a deleted cache row (forget-cascade shape) reproduces the same state",
    Math.abs(rebuilt.trust - 0.3) < 1e-9 && rebuilt.rupture_open === false && rebuilt.repair_state === "repaired",
    JSON.stringify(rebuilt),
  );
} finally {
  const counts = await teardown(personId);
  console.log("teardown counts:", JSON.stringify(counts));
  const residue = await assertZeroResidue(personId);
  ok("zero residue after teardown", residue === 0, `residue=${residue}`);
}

console.log(failed ? `\n${failed} FAILURE(S)` : "\nall round-trip checks passed");
process.exit(failed ? 1 : 0);
