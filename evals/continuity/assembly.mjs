// WS-CONTINUITY — G-C6 (one assembly path) and G-C4 (the live prompt is
// assembled exactly once, at connect), plus the live lane's TAIL BUDGET now
// that it carries the relational slots.
//
//   node evals/continuity/assembly.mjs
//
// G-C4 IS ASSERTED STRUCTURALLY, AND THE REASON MATTERS. The alternative —
// standing up React, a fake WebSocket and a fake mic to count assemblies at
// runtime — would test a harness's model of useCallEngine, not useCallEngine.
// The property that actually holds the guarantee is where the assembly lives:
// exactly one compile() for the live prompt, inside tryStartLive(), which is
// called from the connect effect and nowhere else, and no compile() anywhere
// on a per-turn path in that file. That is checkable from the source, exactly,
// and it is the thing a future edit would break. The runtime counter
// (`liveAssemblies`) ships alongside it as the production half: it rides the
// live_prompt diag record, so a real call that ever assembled twice says so.
import { execSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { baseInput } from "./_fixtures.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
const ENGINE = join(ROOT, "src/components/useCallEngine.ts");
const src = readFileSync(ENGINE, "utf8");
// comments carry the words this file greps for; strip them so a gate can
// never be satisfied (or tripped) by prose about itself
const code = src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !/^\s*\/\//.test(l))
  .join("\n");

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) failed++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `  ${detail}` : ""}`);
};

console.log("\n§1 — G-C6: exactly one prompt assembler in the repo");
// persona.ts's two builders may be reached ONLY through the compiler (via the
// agent module). Anything else importing them is, by definition, a second
// assembly path — which is the failure serverEntry.ts exists to prevent one
// level up ("a mirrored persona is a SECOND persona, and it would drift within
// a week"). It had already drifted: the live lane's own shorter T5/T7
// headings, no T2/T3/T4/T6, no FORGET_DECISION, no age-tier override.
const importers = execSync(
  `grep -rl --include='*.ts' --include='*.tsx' -E '^\\s*(buildSystemPromptParts|buildSpeechStyle),?$|[^.a-zA-Z]buildS(ystemPromptParts|peechStyle)\\(' ${join(ROOT, "src")} || true`,
  { shell: "/bin/bash" },
)
  .toString()
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((p) => p.replace(`${ROOT}/`, ""));
const ALLOWED = new Set([
  "src/engine/persona.ts", // defines them
  "src/engine/agents/types.ts", // declares the AgentModule signature (types only)
  "src/engine/agents/meera.ts", // the AgentModule that re-exports them
  "src/engine/compiler.ts", // the one assembler, through agent.*
  // The byte-identity proof harness. oldOracle.ts is a DELIBERATELY frozen
  // copy of the pre-extraction assembly whose entire job is to be compared
  // against compile(); .budget-entry.ts is its bundle entry. Neither is
  // reachable from the app, and freezing one is the mechanism that makes
  // "the chat lane did not move" checkable at all.
  "src/engine/__fixtures__/oldOracle.ts",
  "src/engine/__fixtures__/.budget-entry.ts",
]);
const strays = importers.filter((f) => !ALLOWED.has(f));
ok("no file outside the compiler seam builds a prompt", strays.length === 0, strays.join(", ") || `(${importers.length} allowed)`);
ok("useCallEngine.ts is not among them", !importers.includes("src/components/useCallEngine.ts"));
ok("useCallEngine.ts imports compile()", /import \{ compile \} from "\.\.\/engine\/compiler"/.test(code));

console.log("\n§2 — G-C4: the live prompt is assembled once, at connect");
const compileCalls = (code.match(/\bcompile\(/g) || []).length;
// three: tryStartLive's one, and the native watch config's two (cascade core
// + live core, which differ only in voiceEngine and share one tail).
ok("compile() appears exactly 3 times in the call engine", compileCalls === 3, `${compileCalls}`);

// The live prompt's compile must sit inside tryStartLive, which is reached
// only from the mount effect.
const tryStart = /async function tryStartLive\(\)[\s\S]*?\n  \}\n/.exec(code);
ok("tryStartLive() is findable", Boolean(tryStart));
const inTryStart = (tryStart?.[0].match(/\bcompile\(/g) || []).length;
ok("tryStartLive() compiles exactly once", inTryStart === 1, `${inTryStart}`);
ok("tryStartLive() is called from exactly one place", (code.match(/tryStartLive\(\)/g) || []).length === 2, "1 definition + 1 call");
ok("it increments the runtime assembly counter", /liveAssemblies\.current \+= 1/.test(tryStart?.[0] || ""));

// Per-turn paths must never assemble. These are the functions that run on
// every spoken turn; a compile() reaching any of them is a different person
// mid-sentence.
for (const fn of ["function handleUser", "function armReengage", "function sayAloud", "function startListening"]) {
  const body = new RegExp(`${fn}\\([\\s\\S]*?\\n  \\}\\n`).exec(code);
  ok(`${fn.replace("function ", "")}() never assembles a prompt`, !(body?.[0] || "").includes("compile("));
}
// and nothing may rebuild the live session's system string after connect
ok("startLiveCall is called exactly once", (code.match(/startLiveCall\(/g) || []).length === 1);
ok("no code path mutates a live session's system", !/\.system\s*=/.test(code));

console.log("\n§3 — the ring fetch is on the ring, not on the reply path");
ok("the fetch is started in the connect effect", /ringFetch\.current = recallForCall\(/.test(code));
ok("it is awaited by a RACE with a deadline, never straight", /Promise\.race\(\[p, new Promise/.test(code));
ok("the deadline is bounded", /RING_FETCH_DEADLINE_MS = (\d+)/.test(code) && Number(/RING_FETCH_DEADLINE_MS = (\d+)/.exec(code)[1]) <= 1000);
ok("a rejected ring fetch cannot reject the connect", /\.catch\(\(\) => \{\s*ringFetchMs\.current = -1;/.test(code));
// the reply path must not gain a lookup: think() still gets the prefetched
// string, never a fresh recall
ok("no per-turn recall was introduced", !/recallMemories\(/.test(code));

console.log("\n§4 — live-lane TAIL budget with the relational slots added");
// scripts/check-prompt-budget.mjs still models the OLD hand-assembled live
// tail (its own comment: "NOT compiled through compiler.ts — a real, separate
// assembly call site"). That model is now stale — the live lane goes through
// compile() — so the number is measured HERE until that file's owner updates
// it. Reported, not hidden: this is the gate that once caught the live lane at
// 93.8% of its cap.
const TAIL_CAP = 24_000;
// The same worst-case profile scripts/check-prompt-budget.mjs uses for the
// live lane, so the two numbers are comparable rather than merely both true.
const HEAVY_USER = {
  name: "Aaaaaaaaaaaaaaaaaaaa",
  vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
  facts: Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)])),
};
const worst = {
  user: HEAVY_USER,
  memories: Array.from({ length: 12 }, (_, i) => `- topic_${i} (kind, last came up ${i}h ago): ${"summary text ".repeat(11).trim().slice(0, 160)} — their own words: "feel_${i}" [rel_a, rel_b, rel_c, rel_d]`).join("\n"),
  herLife: Array.from({ length: 12 }, (_, i) => `- fact about her own life number ${i} (${i}h ago)`).join("\n"),
  innerThread: "\n\nWHERE YOUR HEAD IS COMING INTO THIS: " + "carried feeling text ".repeat(30).trim(),
  innerWants: "\n\nWHAT YOU ARE IN THE MIDDLE OF: " + "a want and an owed thing and a taste row ".repeat(20).trim(),
};
const tmp = mkdtempSync(join(tmpdir(), "wscont-asm-"));
const BUNDLE = join(tmp, "continuity.bundle.mjs");
execSync(
  `npx esbuild ${join(ROOT, "evals/continuity/_entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const { compile } = await import(BUNDLE);
const before = compile(baseInput({ ...worst, medium: "voice", mode: "call", voiceEngine: "live", relBundle: null, latestUserText: "" }));
const after = compile(baseInput({ ...worst, medium: "voice", mode: "call", voiceEngine: "live", latestUserText: "we had such a big fight last night" }));
console.log(`      worst-case live tail: ${before.tail.length}b before -> ${after.tail.length}b after (+${after.tail.length - before.tail.length}b), cap ${TAIL_CAP}`);
console.log(`      worst-case live core: ${after.core.length}b`);
ok("worst-case live tail is inside the operational cap", after.tail.length <= TAIL_CAP, `${after.tail.length}/${TAIL_CAP} (${((100 * after.tail.length) / TAIL_CAP).toFixed(1)}%)`);

console.log(failed ? `\nFAILED — ${failed} assertion(s)` : "\nPASS — one assembler, one assembly at connect, ring fetch off the reply path");
process.exit(failed ? 1 : 0);
