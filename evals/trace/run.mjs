// The turn-trace suite, OFFLINE half — no database, no network, no money.
//
// Wired into evals/run.mjs under the same test the honesty and time suites are:
// `dead-writers` does not stop being true for evals, and a suite nothing
// invokes is indistinguishable from a suite that does not exist. The half that
// needs a database (evals/trace/roundtrip.mjs) is deliberately NOT in that map,
// exactly as D2 is not — keeping it out of the object is the mechanism that
// makes "CI never needs NEON_URL for this" true by construction.
//
// Four properties are asserted here, and each one is a bug this repo has paid
// for once already:
//
//  A. THE CONTENT FIREWALL HOLDS. api/_trace.js's sanitiser cannot be talked
//     into storing a message or a key, no matter how the caller shapes it.
//  B. THE CORRELATOR RECONSTRUCTS A REAL TURN from the events brain.ts and
//     Chat.tsx already emit — replayed verbatim from production telemetry
//     captured on 2026-08-20, so this is a real funnel and not a fixture.
//  C. THE TAP COSTS NOTHING MEASURABLE. `live-floor` is 1.4-1.5s and
//     api/chat.js has a 720ms text floor; a tap on tel() sits inside both.
//  D. NO WRITE ON A REPLY PATH. Structural, by reading the source: api/chat.js
//     and opRecall must never import the trace writer. A timing can regress
//     quietly; an import cannot.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "./build.mjs";
import { sanitise, normaliseLeg, normaliseSpine, buildBatch, deriveFlags } from "../../api/_trace.js";
import { REAL_TURN, REAL_TURN_WITH_SECTIONS, TURN2_ZERO_SLOTS } from "./fixtures.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}${detail ? "  " + detail : ""}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? "  " + detail : ""}`);
  }
};

// ── A. the content firewall ───────────────────────────────────────────────
console.log("\nA. content firewall (api/_trace.js sanitise)");
{
  const dirty = {
    // every one of these is a real field name from somewhere in this codebase
    text: "he told me his sister is in hospital",
    content: "kal shaadi hai",
    summary: "their wedding is in december",
    query: "when is the ipl final",
    feel: "scared",
    thread: "still annoyed about the review thing",
    api_key: "sk-or-v1-deadbeef",
    Authorization: "Bearer sk-live-abc",
    // …and these are the shapes that must survive
    in_chars: 17,
    memories_bytes: 0,
    tail_bytes: 5204,
    matched_ids: [101, 102],
    core_hash: "9230f53f643430a3",
    ok: true,
    nested: { tokens_in: 900, body: "a whole message" },
  };
  const clean = sanitise(dirty);
  const flat = JSON.stringify(clean);
  ok("message text refused", !/hospital|shaadi|december/.test(flat));
  ok("her interior refused (inner.ts G4)", !/annoyed/.test(flat));
  ok("search query refused", !/ipl final/.test(flat));
  ok("credentials refused", !/sk-or|sk-live|Bearer/.test(flat));
  ok("counts survive", clean.in_chars === 17 && clean.tail_bytes === 5204);
  ok("row ids survive", JSON.stringify(clean.matched_ids) === "[101,102]");
  ok("hash survives", clean.core_hash === "9230f53f643430a3");
  ok("nested content refused, nested shape kept", clean.nested?.tokens_in === 900 && !clean.nested?.body);
  ok("drops are counted, never silent", clean._stripped >= 7, `stripped=${clean._stripped}`);

  // the length rule, independent of the key name: a 64-char ceiling clears
  // every hash, slug and uuid this system has, and clears no sentence
  const long = sanitise({ note_free_field: "x".repeat(400) });
  ok("long strings truncated even under an unknown key", (long.note_free_field || "").length <= 64);

  // and the structural version: a payload that is entirely content becomes a
  // count of what was refused, never a half-record that reads like a whole one
  const all = sanitise({ text: "a", body: "b", summary: "c" });
  ok("all-content payload becomes a count", Object.keys(all).join(",") === "_stripped");
}

// ── B. the correlator, on a REAL production turn ──────────────────────────
console.log("\nB. correlator over a real turn (meera_tel, 2026-08-20)");
{
  build();
  const mod = await import(pathToFileURL(join(HERE, ".bundle.mjs")).href + `?t=${Date.now()}`);
  const sent = [];
  globalThis.fetch = async (_url, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  mod.telStart("app", "wstrace-test-device");
  mod.telIdentify("wstrace-test-device");
  mod.installTrace("wstrace-test-device", "web");

  for (const [event, props] of REAL_TURN) mod.tel(event, props);
  // the correlator flushes at chat.reply; nothing else should be needed
  ok("flushed at turn close, without a timer", sent.length >= 1);

  const batch = sent[sent.length - 1];
  const turn = batch.turns[0];
  const legs = Object.fromEntries(batch.legs.map((l) => [l.leg, l.payload]));

  ok("one turn, not one event stream", batch.turns.length === 1, `legs=${batch.legs.length}`);
  ok("turn id minted and well-formed", /^t-[a-z0-9]+-[a-z0-9]{6}$/.test(turn.turn_id), turn.turn_id);
  ok("ingress captured", legs.ingress?.chars === 17 && legs.ingress?.kind === "text");
  ok("interior captured, shape only", legs.interior && !("text" in legs.interior));
  ok("assembly captured", legs.assembly?.core_hash === "9230f53f643430a3");
  ok("tail bytes on the spine", turn.tail_bytes === 5204);
  ok("route decision captured", legs.route?.model === "google/gemini-3.6-flash");
  ok("egress captured", legs.egress?.bubbles_n === 2);
  ok("latency on the spine", turn.latency_ms === 3327);
  ok("in and out message ids both present", Boolean(turn.in_msg_id && turn.out_msg_id));
  ok(
    "the ingress and the egress are the SAME turn",
    batch.legs.every((l) => l.turn_id === turn.turn_id),
  );

  // this is the whole point: one row, and it answers the question
  const spine = normaliseSpine(turn, { device: "wstrace-test-device" });
  ok("spine normalises", Boolean(spine));
  ok(
    "flags derived from the real turn",
    JSON.stringify(deriveFlags({ ...spine, retrieval: {} })) === "{}",
    JSON.stringify(deriveFlags({ ...spine, retrieval: {} })),
  );

  // ── B2. the assembly leg, on the turn that carried real per-slot bytes ──
  console.log("\nB2. per-slot bytes, from production (2026-08-20 11:56:56Z)");
  sent.length = 0;
  for (const [event, props] of REAL_TURN_WITH_SECTIONS) mod.tel(event, props);
  const b2 = sent[sent.length - 1];
  const t2 = b2.turns[0];
  const a2 = b2.legs.find((l) => l.leg === "assembly").payload;
  ok("sections reach the spine", t2.sections?.T5 === 1895 && t2.sections?.T11 === 220);
  ok("core bytes reach the spine", t2.core_bytes === 43868);
  ok(
    "zero-byte slots identified at capture time",
    JSON.stringify([...a2.zero_slots].sort()) === JSON.stringify([...TURN2_ZERO_SLOTS].sort()),
    `${a2.zero_slots.length} slots`,
  );
  const f2 = deriveFlags(normaliseSpine(t2, { device: "wstrace-test-device" }));
  ok("slot_zero flag fires on a real production turn", Array.isArray(f2.slot_zero));
  ok(
    "…and names the slots that are actually dark",
    f2.slot_zero.includes("T2") && f2.slot_zero.includes("T13") && f2.slot_zero.includes("T1"),
    f2.slot_zero.join(","),
  );

  // ── C. what the tap costs ──────────────────────────────────────────────
  console.log("\nC. tap overhead");
  // ALTERNATING blocks, medians, and a warm-up first. A single before/after
  // pair measures JIT warm-up at least as much as it measures the tap: the
  // first arrangement of this test reported the tapped run as FASTER than the
  // bare one, which is not a result, it is a warning that the effect is under
  // the noise floor. Reported as a range, not a point.
  const N = 20_000;
  const burn = () => {
    for (let i = 0; i < N; i++) mod.tel("chat.read", { n: 4, dwell_ms: [1, 2, 3, 4] });
  };
  const time = (fn) => {
    const t = process.hrtime.bigint();
    fn();
    return Number(process.hrtime.bigint() - t) / 1e6;
  };
  mod.setTelTap(null);
  burn(); // warm-up, discarded
  const bareRuns = [];
  const tapRuns = [];
  for (let k = 0; k < 5; k++) {
    mod.setTelTap(null);
    bareRuns.push(time(burn));
    mod.installTrace("wstrace-test-device", "web");
    tapRuns.push(time(burn));
  }
  const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
  const bare = median(bareRuns);
  const tapped = median(tapRuns);
  const perEvent = ((tapped - bare) / N) * 1000; // microseconds
  console.log(
    `  n=${N}x5  bare med ${bare.toFixed(1)}ms  tapped med ${tapped.toFixed(1)}ms` +
      `  Δ ${perEvent.toFixed(3)}µs/event  (spread bare ${Math.min(...bareRuns).toFixed(1)}-${Math.max(...bareRuns).toFixed(1)}, ` +
      `tapped ${Math.min(...tapRuns).toFixed(1)}-${Math.max(...tapRuns).toFixed(1)})`,
  );
  // A whole turn emits ~8 traced events. 50µs each would be 0.4ms against a
  // 720ms floor; the real number is two orders below that. The assertion is
  // deliberately loose — it is a regression guard, not a benchmark.
  ok("tap costs under 50µs/event", perEvent < 50, `${perEvent.toFixed(2)}µs`);
}

// ── F. the brain.ts hook is not a dead interface ──────────────────────────
console.log("\nF. the brain.ts seam (three call sites, exercised here)");
{
  build();
  const mod = await import(pathToFileURL(join(HERE, ".bundle.mjs")).href + `?t=${Date.now()}f`);
  const sent = [];
  globalThis.fetch = async (_u, init) => {
    sent.push(JSON.parse(init.body));
    return { ok: true, json: async () => ({ ok: true }) };
  };
  mod.telStart("app", "wstrace-test-device");
  mod.telIdentify("wstrace-test-device");
  mod.installTrace("wstrace-test-device", "web");

  ok("no open turn ⇒ no turn id goes up", JSON.stringify(mod.traceRequestFields("chat")) === "{}");
  mod.tel("chat.send", { kind: "text", chars: 12, msg_id: "wstrace-test-m1" });
  const fields = mod.traceRequestFields("chat");
  ok("open turn ⇒ the proxy learns the turn id", /^t-/.test(fields.turn_id) && fields.lane === "proxy");
  ok("call mode maps to the call channel", mod.traceChannelFor("call") === "call");

  // site 2: the non-streaming body
  const consumed = mod.traceModelResponse("chat", {
    text: "hmm",
    trace: { served_by: "openrouter", model: "google/gemini-3.6-flash", ms: 1200, tokens_in: 900 },
  });
  ok("a non-stream body is folded but NOT consumed", consumed === false);
  // site 3: the trailing SSE frame
  const frame = mod.traceModelResponse("chat", {
    meera_trace: { served_by: "gemini-free", tokens_cached: 11856 },
  });
  ok("a trailing SSE frame is folded AND consumed", frame === true);
  ok("a normal delta frame is neither", mod.traceModelResponse("chat", { choices: [{ delta: { content: "a" } }] }) === false);

  mod.tel("chat.reply", { msg_id: "wstrace-test-m2", bubbles: 1, latency_ms: 1300, lane: "proxy", kind: "text" });
  const spine = sent[sent.length - 1].turns[0];
  ok("served_by reaches the spine", spine.served_by === "gemini-free", String(spine.served_by));
  ok("token counts reach the spine", spine.tokens_in === 900 && spine.tokens_cached === 11856);
  ok(
    "…which is the field Chat.tsx's own telemetry says it cannot have",
    spine.served_by !== spine.lane,
    `lane=${spine.lane} served_by=${spine.served_by}`,
  );
}

// ── D. no write on a reply path (structural) ──────────────────────────────
console.log("\nD. no trace write on any reply path");
{
  const chat = readFileSync(join(ROOT, "api/chat.js"), "utf8");
  const memory = readFileSync(join(ROOT, "api/memory.js"), "utf8");
  // an IMPORT, not a mention: both files legitimately talk about api/_trace.js
  // in comments, and a check that cannot tell a sentence from a dependency is
  // a check that will be silenced by the first person it annoys
  const imports = (src) => /^\s*import[^\n]*from\s+["'][^"']*_trace\.js["']/m.test(src);
  ok("api/chat.js does not import the trace writer", !imports(chat));
  ok("api/chat.js writes no rows at all", !/from "\.\/_db\.js"/.test(chat));
  ok("api/memory.js does not import the trace writer", !imports(memory));
  // the recall path may only RETURN a leg, never insert one
  const opRecall = memory.slice(memory.indexOf("async function opRecall"), memory.indexOf("function relBundleShape"));
  ok("opRecall inserts nothing into the trace tables", !/meera_turn/.test(opRecall));
  ok("opRecall returns the leg instead", /trace: buildTrace\(/.test(opRecall));
  const trace = readFileSync(join(ROOT, "api/trace.js"), "utf8");
  ok("the only write path is POST-only", /POST only/.test(trace) && !/req\.method === "GET"/.test(trace));
  ok("the sink returns no rows", !/select /i.test(trace));
}

// ── E. batch statement shape ──────────────────────────────────────────────
console.log("\nE. one statement per batch");
{
  const ctx = { device: "wstrace-test-device" };
  const id = "wstrace-test-bbbb0002";
  const b = buildBatch(
    [
      normaliseSpine({ turn_id: id, tail_bytes: 100 }, ctx),
      normaliseSpine({ turn_id: id, core_bytes: 200 }, ctx),
    ],
    [normaliseLeg({ turn_id: id, leg: "ingress", payload: { in_chars: 3 } }, ctx)],
  );
  ok("duplicate spines merge to one row", (b.sql.match(/on conflict/g) || []).length === 1 && b.turns === 1);
  ok("legs and spine ride ONE statement", !b.sql.trim().slice(0, -1).includes(";"));
  ok("retention prunes in the same statement", /prune_legs/.test(b.sql) && /prune_turns/.test(b.sql));
  ok("prune is bounded", /limit 200/.test(b.sql));
}

console.log(`\n${fail ? "FAIL" : "PASS"} — ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
