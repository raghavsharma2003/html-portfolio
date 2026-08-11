// Guard against the failure that once silently deleted her crisis helplines.
//
// api/chat.js slices the system prompt at SYSTEM_MAX and the volatile half at
// TAIL_MAX. For an unknown stretch SYSTEM_MAX sat at 20,000 while her core had
// grown to ~29,800, so every chat message quietly lost its last ~9,800
// characters — the crisis helplines, the never-deny-being-an-AI rule, the
// banned-phrase list and the [search:] protocol all live in that tail. Nothing
// errored. She simply stopped being able to look anything up, and had no
// helpline for someone who needed one.
//
// The proxy now warns on overflow, but a warning in a serverless log is not a
// guard: nobody reads it, and the prompt still ships truncated. This runs in CI
// and FAILS THE BUILD, because a prompt that outgrows its cap must never reach
// production silently again.
//
// The caps are parsed out of api/chat.js rather than duplicated here — a guard
// that can drift from the thing it guards is worse than no guard.
import { build } from "vite";
import { readFileSync, writeFileSync, mkdirSync, rmSync } from "fs";
import { join } from "path";

const ROOT = new URL("..", import.meta.url).pathname;

const capOf = (src, name) => {
  // matches `const SYSTEM_MAX = 48_000;` and `const TAIL_MAX = 14_000;`
  const m = src.match(new RegExp(`${name}\\s*=\\s*([0-9_]+)`));
  if (!m) throw new Error(`could not find ${name} in api/chat.js — guard is stale, fix it`);
  return Number(m[1].replace(/_/g, ""));
};

const chatSrc = readFileSync(join(ROOT, "api/chat.js"), "utf8");
const SYSTEM_MAX = capOf(chatSrc, "SYSTEM_MAX");
const TAIL_MAX = capOf(chatSrc, "TAIL_MAX");

// persona.ts is TypeScript and pulls in app modules, so bundle it the same way
// the app does rather than trying to parse it.
// Build inside node_modules, not /tmp: the bundle keeps @capacitor/core as a
// bare import, and node can only resolve that from somewhere under the project.
const out = join(ROOT, "node_modules/.prompt-budget");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const entry = join(out, "entry.ts");
const personaPath = JSON.stringify(join(ROOT, "src/engine/persona"));
writeFileSync(
  entry,
  `export { buildSystemPromptParts, buildSpeechStyle, WATCH_MODE_NOTE, SEARCH_DECISION } from ${personaPath};\n`,
);
await build({
  logLevel: "error",
  // publicDir off: otherwise this copies her whole photo library into the temp
  // dir just to measure two strings
  publicDir: false,
  build: {
    lib: { entry, formats: ["es"], fileName: "entry" },
    outDir: out,
    write: true,
    emptyOutDir: false,
    minify: false,
    rollupOptions: { external: ["@capacitor/core"] },
  },
});
const { buildSystemPromptParts, buildSpeechStyle, WATCH_MODE_NOTE, SEARCH_DECISION } = await import(
  join(out, "entry.js")
);

// A worst-case profile, not a friendly one: the guard has to model the biggest
// prompt a real user can produce, or it passes right up until someone fills in
// their details.
const user = {
  name: "Aaaaaaaaaaaaaaaaaaaa",
  vibe: ["someone to talk to", "a friend who remembers", "company late at night"],
  facts: Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`fact_key_number_${i}`, "a".repeat(120)]),
  ),
};

let failed = false;
const check = (label, value, cap) => {
  const pct = ((value / cap) * 100).toFixed(1);
  const over = value > cap;
  // 90% is the warn line: a prompt this close will be truncated by the next
  // person who adds a paragraph, and they will not be looking at this number.
  const tight = !over && value > cap * 0.9;
  failed ||= over;
  const state = over ? "OVER CAP" : tight ? "tight" : "ok";
  console.log(`${over ? "FAIL" : tight ? "WARN" : "  ok"}  ${label.padEnd(26)} ${String(value).padStart(6)} / ${cap}  (${pct}%) ${state}`);
};

// Measure what the PROXY actually receives, not what persona.ts returns.
// brain.ts assembles `core = parts.core + buildSpeechStyle(engine)` on calls,
// and grows the tail with her carried feeling, graph recall, her own life
// ledger, the watch block and the search protocol. Measuring persona's raw
// output alone would have reported ~35k for a voice lane that really ships
// ~43k — a guard that passes while the real prompt is over the line is worse
// than no guard, because it is trusted.
// Every figure below is derived from a bound that exists in the code, not
// estimated. If one of those bounds changes, this number is wrong and the
// comment tells you where to look.
const TAIL_EXTRAS =
  // graph recall (api/memory.js): 8 matched + 4 background = 12 lines, each
  // `- name (kind, last came up X): summary — their own words: "feel" [rels]`
  // with summary capped at 160 chars on write and up to 4 relations, plus the
  // ~900-char block header.
  12 * 570 +
  900 +
  // her life ledger: formatHerLife renders at most 12 items, plus its header
  12 * 150 +
  370 +
  // her carried feeling (one thread) and up to 3 wants
  1_500;

const lanes = [
  { label: "text (chat)", medium: "text", style: "", tail: SEARCH_DECISION },
  { label: "voice cascade", medium: "voice", style: buildSpeechStyle("gemini"), tail: "" },
  { label: "voice live", medium: "voice", style: buildSpeechStyle("live"), tail: "" },
  { label: "voice live + watch", medium: "voice", style: buildSpeechStyle("live"), tail: WATCH_MODE_NOTE },
];

for (const lane of lanes) {
  const { core, tail } = buildSystemPromptParts(user, 999, lane.medium);
  check(`${lane.label} core`, core.length + lane.style.length, SYSTEM_MAX);
  check(`${lane.label} tail`, tail.length + lane.tail.length + TAIL_EXTRAS, TAIL_MAX);
}

if (failed) {
  console.error(
    "\nA system prompt exceeds the cap enforced in api/chat.js, so it WILL be\n" +
      "truncated from the end before it reaches the model. The end is where the\n" +
      "newest and most safety-relevant text sits. Either shorten the prompt or\n" +
      "raise the cap in api/chat.js deliberately — do not ignore this.",
  );
  process.exit(1);
}
console.log("\nprompt budget ok");
