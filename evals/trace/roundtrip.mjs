// The turn trace, LIVE half: the write path, the read path, the measured cost,
// and the residue check.
//
// Deliberately NOT in evals/run.mjs's suite map. It needs NEON_URL and it
// WRITES, which is the same test that keeps D2 out of CI — a suite that cannot
// run without credentials must not be able to look like a suite that passed.
// Run it by hand:
//
//   node evals/trace/roundtrip.mjs             # write, read back, purge
//   node evals/trace/roundtrip.mjs --keep      # leave the rows for inspection
//
// Every row it writes is prefixed `wstrace-test-`, and the residue check at the
// end is asserted rather than assumed: it prints the count before and after and
// exits non-zero if anything survives.
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { q } from "../../api/_db.js";
import handler from "../../api/trace.js";
import { REAL_TURN_WITH_SECTIONS } from "./fixtures.mjs";
import { build } from "./build.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const PREFIX = "wstrace-test-";
const DEVICE = `${PREFIX}device`;
const keep = process.argv.includes("--keep");

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  cond ? pass++ : fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${name}${detail ? "  " + detail : ""}`);
};

/** Drive the REAL api/trace.js default export with a minimal req/res pair. */
async function postBatch(body) {
  let status = 0;
  let payload = null;
  const res = {
    setHeader() {},
    status(s) {
      status = s;
      return res;
    },
    json(v) {
      payload = v;
      return res;
    },
    end() {
      return res;
    },
  };
  await handler({ method: "POST", body, headers: {}, socket: {} }, res);
  return { status, payload };
}

console.log("── 1. the client produces a batch from a real turn ──");
build();
const mod = await import(join(HERE, ".bundle.mjs") + `?t=${Date.now()}`);
const captured = [];
// api/_db.js's q() is fetch too, so the stub is INSTALLED ONLY around the
// client replay and removed immediately. The first arrangement of this file
// left it installed and every database read came back as `{ok:true}` — a
// captured trace of a test that was measuring its own stub.
const realFetch = globalThis.fetch;
globalThis.fetch = async (_u, init) => {
  captured.push(JSON.parse(init.body));
  return { ok: true, json: async () => ({ ok: true }) };
};
mod.telStart("app", DEVICE);
mod.telIdentify(DEVICE);
mod.installTrace(DEVICE, "web");
// Replay the real turn UP TO but not including its reply: the reply is what
// closes the turn and flushes it, and the server legs belong to the same turn.
const upToReply = REAL_TURN_WITH_SECTIONS.filter(([e]) => e !== "chat.reply");
const replyEvent = REAL_TURN_WITH_SECTIONS.find(([e]) => e === "chat.reply");
for (const [event, props] of upToReply) mod.tel(event, props);
const TURN = mod.traceTurnId("chat");
// the server legs, exactly as opRecall and api/chat.js return them
mod.traceServer("chat", "retrieval", {
  turn_id: TURN,
  person_id: "11111111-1111-4111-8111-111111111111",
  q_chars: 9,
  q_words_n: 1,
  ms_total: 187,
  keyword: { matched_ids: [4021, 4022], background_ids: [3001, 3002, 3003, 3004] },
  semantic: { ok: true, embed_ms: 121, fact_ids: [910], skipped: null },
  observations: { ids: [], n: 0 },
  relbundle: { present: true, relstate_present: false, we_episodes_n: 0, phrases_n: 0 },
  selfbundle: { present: true, texture_present: true, arc_n: 0, untold_n: 0 },
  memories_bytes: 1895,
  blocks: ["RELEVANT TO WHAT THEY JUST SAID:", "STANDING BACKGROUND"],
});
mod.traceServer("chat", "model", {
  turn_id: TURN,
  served_by: "gemini-free",
  model: "google/gemini-3.6-flash",
  ms: 1422,
  tokens_in: 12040,
  tokens_out: 41,
  tokens_cached: 11856,
  core_bytes_sent: 43868,
  tail_bytes_sent: 5141,
  core_truncated: false,
  tail_truncated: false,
  fallbacks: [{ from: "gemini-free", to: "next-key", why: "quota" }],
  pool: { size: 6, tried: 2, eligible: true },
});
// what src/engine/memory.ts's logTurns() patches in once op:"log" returns its
// row ids, and the reply shape the brain.ts hook will add
mod.tracePatch("chat", { in_log_id: 3023, out_log_ids: [3024, 3025], out_chars: 69 });
// her reply closes and flushes the turn — the real event, in the real order
mod.tel(replyEvent[0], replyEvent[1]);
globalThis.fetch = realFetch;

const batch = captured[captured.length - 1];
// rewrite the client-minted ids into the test namespace, so the residue check
// can find every row this file created by prefix alone
const ids = new Map();
let n = 0;
for (const t of batch.turns) ids.set(t.turn_id, `${PREFIX}rt${String(++n).padStart(4, "0")}`);
for (const t of batch.turns) t.turn_id = ids.get(t.turn_id);
for (const l of batch.legs) l.turn_id = ids.get(l.turn_id) ?? l.turn_id;
batch.legs = batch.legs.filter((l) => l.turn_id.startsWith(PREFIX));
const TEST_ID = [...ids.values()].pop();
ok("batch carries turns and legs", batch.turns.length >= 1 && batch.legs.length >= 5, `${batch.legs.length} legs`);

console.log("\n── 2. the real sink writes it ──");
const before = await countRows();
const r = await postBatch(batch);
ok("sink returns 200", r.status === 200, JSON.stringify(r.payload));
ok("sink reports what it wrote", r.payload?.turns >= 1 && r.payload?.legs >= 5);
const after = await countRows();
ok("rows landed", after.turns > before.turns && after.legs > before.legs);

console.log("\n── 3. the turn reads back, end to end ──");
const [row] = await q(`select * from meera_turn where turn_id = $1`, [TEST_ID]);
ok("spine row exists", Boolean(row));
ok("sections survived the round trip", row?.sections?.T5 === 1895 && row?.sections?.T13 === 0);
ok("core/tail bytes survived", row?.core_bytes === 43868 && row?.tail_bytes === 5141);
ok("recall bytes survived", row?.recall_bytes === 1895);
ok("served_by survived", row?.served_by === "gemini-free");
ok("token counts survived", row?.tokens_in === 12040 && row?.tokens_cached === 11856);
ok("person resolved", row?.person_id === "11111111-1111-4111-8111-111111111111");
ok("log ids link to content", Number(row?.in_log_id) === 3023);
ok("agent_id explicit, never defaulted", row?.agent_id === "a0000000-0000-4000-8000-000000000001");
ok("slot_zero flag fired", Array.isArray(row?.flags?.slot_zero) && row.flags.slot_zero.includes("T13"));
ok("fallback flag fired", Boolean(row?.flags?.fallback));

const legRows = await q(`select leg, payload from meera_turn_leg where turn_id = $1 order by seq`, [TEST_ID]);
const byLeg = Object.fromEntries(legRows.map((l) => [l.leg, l.payload]));
ok("every layer left a leg", ["ingress", "interior", "assembly", "retrieval", "model", "egress"].every((l) => byLeg[l]), Object.keys(byLeg).join(","));
ok("retrieval leg kept the row ids", JSON.stringify(byLeg.retrieval?.keyword?.matched_ids) === "[4021,4022]");
ok("model leg kept WHY the fallback fired", byLeg.model?.fallbacks?.[0]?.why === "quota");
ok("no key material anywhere in the legs", !/sk-|Bearer|AIza/.test(JSON.stringify(legRows)));

console.log("\n── 4. the CLI reconstructs it ──");
const out = execFileSync("node", [join(ROOT, "scripts/trace.mjs"), "--turn", TEST_ID], {
  encoding: "utf8",
  cwd: ROOT,
});
for (const section of ["1. INGRESS", "2. RETRIEVAL", "3. INTERIOR", "4. ASSEMBLY", "5. MODEL", "6. EGRESS", "7. CONSOLIDATION"]) {
  ok(`CLI prints ${section}`, out.includes(section));
}
ok("CLI surfaces the zero-byte slots", /zero-byte slots/.test(out));
ok("CLI surfaces the fallback reason", /quota/.test(out));

// --recheck must be a no-op on rows that were just written correctly. Its first
// version compared jsonb key order and "corrected" every row to the identical
// value — a rewrite loop that read like a finding.
const rc = execFileSync("node", [join(ROOT, "scripts/trace.mjs"), "--recheck", "-n", "50"], {
  encoding: "utf8",
  cwd: ROOT,
});
ok("--recheck is idempotent on fresh rows", /^0 of \d+ turn\(s\) corrected$/m.test(rc.trim()), rc.trim().split("\n").pop());

console.log("\n── 5. measured cost ──");
await measureRecall();
await measureBatch();

console.log("\n── 6. residue ──");
if (keep) {
  console.log(`  --keep: rows left behind under ${PREFIX} (purge with: node scripts/trace.mjs --residue ${PREFIX} --purge)`);
} else {
  const res = execFileSync("node", [join(ROOT, "scripts/trace.mjs"), "--residue", PREFIX, "--purge"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  console.log(res.trim().split("\n").map((l) => "  " + l).join("\n"));
  const left = await countTest();
  ok("zero residue", left === 0, `${left} row(s) remain`);
}

console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ── helpers ───────────────────────────────────────────────────────────────

async function countRows() {
  const [a] = await q(`select count(*)::int n from meera_turn`, []);
  const [b] = await q(`select count(*)::int n from meera_turn_leg`, []);
  return { turns: a.n, legs: b.n };
}
async function countTest() {
  const [a] = await q(`select count(*)::int n from meera_turn where turn_id like $1 or device_id like $1`, [PREFIX + "%"]);
  const [b] = await q(`select count(*)::int n from meera_turn_leg where turn_id like $1 or device_id like $1`, [PREFIX + "%"]);
  return a.n + b.n;
}

/**
 * THE NUMBER THAT DECIDES WHETHER THIS SHIPS. api/memory.js's op:"recall" is on
 * the reply path — brain.ts awaits it before compiling — so the retrieval leg
 * must cost nothing there. It is built from values the function already has and
 * returned on the response it was already sending, so the prediction is "zero,
 * plus a few hundred bytes". Measured rather than asserted: paired runs against
 * the live database on a REAL device, alternating so drift hits both arms.
 */
async function measureRecall() {
  const { default: memHandler } = await import("../../api/memory.js");
  const [dev] = await q(
    `select device_id from meera_log where role = 'me' group by device_id order by count(*) desc limit 1`,
    [],
  );
  if (!dev) return console.log("  (no real device in meera_log — skipped)");
  // THE DECISIVE MEASUREMENT, and the reason the wall-clock pair below is
  // reported as a range rather than a verdict: latency to Neon over HTTP swings
  // 350-750ms run to run, so an 8-sample pair cannot resolve a few
  // microseconds of CPU. What it CAN resolve, exactly, is how many statements
  // the request issued — and the claim being tested ("the retrieval leg costs
  // zero round trips") is a claim about that number, not about milliseconds.
  let statements = 0;
  const counting = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/sql")) statements++;
    return counting(url, init);
  };
  const call = async (withTrace) => {
    let payload = null;
    const res = {
      setHeader() {},
      status() {
        return res;
      },
      json(v) {
        payload = v;
        return res;
      },
      end() {
        return res;
      },
    };
    const t = Date.now();
    await memHandler(
      {
        method: "POST",
        headers: {},
        socket: {},
        body: {
          op: "recall",
          device: dev.device_id,
          query: "kaam ka stress kaisa chal raha hai",
          ...(withTrace ? { turn_id: `${PREFIX}measure0001` } : {}),
        },
      },
      res,
    );
    return { ms: Date.now() - t, bytes: JSON.stringify(payload || {}).length, payload };
  };
  await call(false); // warm
  statements = 0;
  await call(false);
  const stmtsOff = statements;
  statements = 0;
  await call(true);
  const stmtsOn = statements;
  console.log(`  op:recall SQL statements — without trace ${stmtsOff}, with trace ${stmtsOn}`);
  ok("the retrieval leg issues ZERO extra statements", stmtsOn === stmtsOff, `${stmtsOn} vs ${stmtsOff}`);

  const off = [];
  const on = [];
  for (let i = 0; i < 8; i++) {
    off.push(await call(false));
    on.push(await call(true));
  }
  globalThis.fetch = counting;
  const med = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const offMs = med(off.map((r) => r.ms));
  const onMs = med(on.map((r) => r.ms));
  const extraBytes = med(on.map((r) => r.bytes)) - med(off.map((r) => r.bytes));
  console.log(
    `  op:recall  n=8/arm  without trace ${offMs}ms  with trace ${onMs}ms  Δ ${onMs - offMs}ms` +
      `   response +${extraBytes} bytes`,
  );
  console.log(`             spread off ${Math.min(...off.map((r) => r.ms))}-${Math.max(...off.map((r) => r.ms))}ms, on ${Math.min(...on.map((r) => r.ms))}-${Math.max(...on.map((r) => r.ms))}ms`);
  // The wall-clock arm is a REGRESSION GUARD, not evidence: the spreads above
  // overlap almost completely, so the honest reading is "under the noise
  // floor", and the statement count above is what actually carries the claim.
  //
  // The threshold is the CONTROL ARM'S OWN SPREAD, not a fixed number. Neon
  // over HTTP swings 350-2000ms run to run; a hardcoded 25ms guard fails on a
  // slow afternoon and teaches whoever hits it to delete the check. "Slower
  // than the control arm's own worst case" is the thing actually worth failing
  // on, and it does not move with the weather.
  const noise = Math.max(25, Math.max(...off.map((r) => r.ms)) - Math.min(...off.map((r) => r.ms)));
  ok(
    "the retrieval leg adds no latency beyond the control arm's own spread",
    onMs - offMs < noise,
    `Δ ${onMs - offMs}ms vs control spread ${noise}ms`,
  );
  ok("the retrieval leg is bounded in size", extraBytes < 1500, `${extraBytes}b`);
  ok("a recall without a turn id carries no leg", !off[0].payload?.trace);
  ok("a recall with a turn id carries one", Boolean(on[0].payload?.trace));
}

/** What one turn actually costs to store, and what the write costs off-path. */
async function measureBatch() {
  const one = {
    device: DEVICE,
    turns: [{ ...batch.turns[0], turn_id: `${PREFIX}size0001` }],
    legs: batch.legs.map((l) => ({ ...l, turn_id: `${PREFIX}size0001` })),
  };
  const wire = JSON.stringify(one).length;
  const t = Date.now();
  await postBatch(one);
  const writeMs = Date.now() - t;
  const [sz] = await q(
    `select coalesce(sum(pg_column_size(t.*)),0)::int as spine,
            (select coalesce(sum(pg_column_size(l.*)),0)::int from meera_turn_leg l where l.turn_id = $1) as legs
       from meera_turn t where t.turn_id = $1`,
    [`${PREFIX}size0001`],
  );
  console.log(
    `  one turn: ${wire} bytes on the wire, ${sz.spine}b spine + ${sz.legs}b legs = ${sz.spine + sz.legs}b stored` +
      `   write ${writeMs}ms (off-path)`,
  );
  // 8kB, not 4: the measured turn is ~4.5kB and the bound is a ceiling that
  // catches a payload explosion, not a target anyone should tune towards. At
  // 4.5kB, 500 turns/day is 2.2MB/day — 30 days of legs plus 90 days of spine
  // is under 100MB, which is cheaper than meera_tel already is.
  ok("a turn stores under 8kB", sz.spine + sz.legs < 8192, `${sz.spine + sz.legs}b`);
}
