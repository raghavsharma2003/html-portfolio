// WS-CONTINUITY — G-C1 (call parity), G-C5 (chat byte-identity) and the
// NEGATIVE CONTROL, offline and DB-free.
//
//   node evals/continuity/parity.mjs
//
// The claim under test is the one sentence SPEC-CONTINUITY §3 makes: "every
// relational and self slot that renders in chat renders on a call for the same
// person and turn". So the two compiles below differ in exactly two fields —
// medium and mode — and in nothing else. Anything that differs in the output
// is therefore a property of the LANE, which is the only thing this gate is
// allowed to be about.
//
// The negative control is not decoration. A parity gate that cannot fail is a
// green light with no wiring behind it, and this repo has shipped one of those
// before (`meera_tel_session`). §4 below re-runs the identical assertion
// against a call compile with the bundle removed — i.e. the exact state this
// workstream found production in — and REQUIRES it to fail. A suite where §4
// passes silently is a broken suite, not a passing build.
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseInput, REL_BUNDLE } from "./_fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), "wscont-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { compile, TAIL_ORDER } = await import(BUNDLE);

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
  return cond;
};

// Slots the chat lane legitimately has and a call legitimately does not — the
// two are named here rather than discovered, so a slot going missing by
// accident can never be mistaken for one of these.
//   culture  cultureNoteText is `mode === "chat"` inside compile() by design.
//   T10      folds SEARCH_DECISION (chat-only: she cannot browse aloud) and
//            FORGET_DECISION (BOTH lanes). It is therefore expected to differ
//            in SIZE across lanes and is checked for PRESENCE only.
const CHAT_ONLY = new Set(["culture"]);
const SIZE_EXEMPT = new Set(["T10"]);

// The person and the turn are identical. Only the transport differs.
const turn = {
  latestUserText: "yaar aaj bahut thak gayi thi office me",
  gapSinceLastMs: 30 * 60_000,
  innerThread: "\n\nWHERE YOUR HEAD IS COMING INTO THIS: some carried line.",
  innerWants: "\n\nWHAT YOU ARE IN THE MIDDLE OF: some want.",
};
const chat = compile(baseInput({ ...turn, medium: "text", mode: "chat", voiceEngine: "gemini" }));
// The call lane exactly as useCallEngine.ts now compiles it.
const call = compile(baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live" }));

console.log("\n§1 — G-C1 call parity (every slot that renders in chat renders on a call)");
const missing = [];
for (const id of TAIL_ORDER) {
  const c = chat.sections[id] ?? 0;
  const v = call.sections[id] ?? 0;
  if (c > 0 && v === 0 && !CHAT_ONLY.has(id)) missing.push(`${id} (chat ${c}b, call 0b)`);
}
ok("no slot renders in chat and nothing on a call", missing.length === 0, missing.join(", "));

const sizeDiffs = [];
for (const id of TAIL_ORDER) {
  if (CHAT_ONLY.has(id) || SIZE_EXEMPT.has(id)) continue;
  const c = chat.sections[id] ?? 0;
  const v = call.sections[id] ?? 0;
  if (c !== v) sizeDiffs.push(`${id} chat=${c}b call=${v}b`);
}
// Slot CONTENT must not depend on the transport at all: §2's first invariant
// ("state is channel-blind — only rendering differs; `medium: voice` shortens
// her, it does not make her forget"). A byte difference in a relational slot
// means some state was read differently on one lane, which is the failure.
ok("relational/self slot bytes are identical across lanes", sizeDiffs.length === 0, sizeDiffs.join(", "));

const rendered = TAIL_ORDER.filter((id) => (call.sections[id] ?? 0) > 0);
console.log(`      call renders: ${rendered.join(", ")}`);
console.log(`      call tail ${call.tail.length}b vs chat tail ${chat.tail.length}b`);

console.log("\n§2 — the seven slots SPEC-CONTINUITY §0 names, on a call");
// T11/T12/T13 are asserted SEPARATELY and honestly: they render on NEITHER
// lane in this app today, because nothing client-side has a self bundle to
// give (api/memory.js's op:"recall" carries `relstate` and no self rows). The
// spec's table claims chat ✅ for them; measured against the code that is
// wrong, and this gate records the truth rather than the table.
for (const id of ["T2", "T3", "T4", "T6"]) {
  ok(`${id} renders on a call`, (call.sections[id] ?? 0) > 0, `${call.sections[id] ?? 0}b`);
}
for (const id of ["T11", "T12", "T13"]) {
  const both = (chat.sections[id] ?? 0) === 0 && (call.sections[id] ?? 0) === 0;
  ok(`${id} is dark on BOTH lanes (no self-bundle source exists)`, both);
}

console.log("\n§3 — the medium is honoured (voice register, not a longer prompt lane)");
ok("call core carries the live speech style", call.core.includes("YOUR VOICE IS THE DELIVERY"));
ok("chat core carries no speech style at all", !chat.core.includes("YOUR VOICE IS THE DELIVERY"));
ok("call core is the VOICE medium", call.core.includes("THIS IS A LIVE PHONE CALL"));
// FORGET_DECISION is "both lanes" per compile()'s own comment, and the old
// hand-assembled live prompt did not have it. This is the regression that
// proves the drift was real rather than theoretical.
ok("FORGET_DECISION reaches the call lane", (call.sections.T10 ?? 0) > 0);
ok("SEARCH_DECISION does NOT reach the call lane", (call.sections.T10 ?? 0) < (chat.sections.T10 ?? 0));

console.log("\n§4 — NEGATIVE CONTROL (this assertion must FAIL for the gate to mean anything)");
// Production before this change: mode "call" hard-nulled the bundle.
const callBefore = compile(baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live", relBundle: null }));
const wouldMiss = TAIL_ORDER.filter(
  (id) => (chat.sections[id] ?? 0) > 0 && (callBefore.sections[id] ?? 0) === 0 && !CHAT_ONLY.has(id),
);
ok(
  "a call compiled with no relBundle is CAUGHT by §1's assertion",
  wouldMiss.length > 0,
  `caught: ${wouldMiss.join(", ") || "NOTHING — the gate is blind"}`,
);
// and the mirror: a bundle that renders nothing must not be mistaken for parity
const emptyish = compile(
  baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live", relBundle: { ...REL_BUNDLE, patterns: [], weEpisodes: [], phrases: [] } }),
);
ok(
  "an emptied bundle is caught too (rows, not just the bundle object, are checked)",
  (emptyish.sections.T4 ?? 0) === 0 && (emptyish.sections.T6 ?? 0) === 0,
);

console.log("\n§5 — the REALTIME lane's structural limit, measured rather than glossed");
// The two call lanes are not equally reachable by a turn-gated slot, and the
// difference is a property of the transport, not a bug to fix here:
//
//   cascade — compiles per spoken turn, so it sees the real turn and T4's
//             moment gate and T6's pull label are both accurate. §1-§3 above
//             are that lane.
//   live    — compiles ONCE at connect, which is correct and load-bearing (a
//             mid-call prompt change is a different person mid-sentence). At
//             connect there is no user turn, so a slot gated ON the turn
//             cannot be turn-accurate. T6 handles this correctly: it renders
//             under its STANDING BACKGROUND heading, which is exactly the
//             0-unprompted-raises behaviour. T4 renders NOTHING, because
//             renderDyadicActive selects by moment shape and there is no
//             moment.
//
// T4 going dark on the realtime lane is the honest outcome — the alternative
// is guessing a moment from the last thing they typed before dialling, which
// is the pull-only law inverted — but it is a real remaining gap and it is
// recorded here so nobody rediscovers it as a surprise.
const pickup = compile(baseInput({ ...turn, medium: "voice", mode: "call", voiceEngine: "live", latestUserText: "", innerThread: "", innerWants: "" }));
ok("live pickup renders T2 (state, not turn-gated)", (pickup.sections.T2 ?? 0) > 0, `${pickup.sections.T2 ?? 0}b`);
ok("live pickup renders T3 (rituals/currency, not turn-gated)", (pickup.sections.T3 ?? 0) > 0, `${pickup.sections.T3 ?? 0}b`);
ok("live pickup renders T6 as STANDING BACKGROUND", (pickup.sections.T6 ?? 0) > 0 && pickup.tail.includes("STANDING BACKGROUND"));
ok("live pickup never renders T6 as ACTIVE (no turn to have referenced it)", !pickup.tail.includes("SHARED HISTORY — ACTIVE"));
ok("T4 is dark at a live pickup — KNOWN, by construction, not a regression", (pickup.sections.T4 ?? 0) === 0);

console.log("\n§6 — G-C5 chat byte-identity (the chat lane must not move)");
// Delegated to the frozen-oracle harness rather than re-implemented: that is
// the 83-fixture proof, run against this tree.
try {
  const out = execSync("node src/engine/__fixtures__/byte-identity.mjs", { cwd: ROOT }).toString().trim();
  const m = /(\d+)\/(\d+) fixtures pass/.exec(out);
  ok("83/83 byte-identity fixtures pass", Boolean(m) && m[1] === m[2] && Number(m[1]) >= 83, m ? `${m[1]}/${m[2]}` : out);
} catch (e) {
  ok("83/83 byte-identity fixtures pass", false, String(e.stdout || e.message).slice(-400));
}

console.log(failed ? `\nFAILED — ${failed} assertion(s)` : "\nPASS — parity, medium, negative control, byte-identity");
process.exit(failed ? 1 : 0);
