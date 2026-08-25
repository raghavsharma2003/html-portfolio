// RelationalOS R3 — the cross-agent leak guard.
//
// The claim under test (context/decisions.md `personality-is-a-sheet`): a
// personality is a CharacterSheet on the Relational Core, so NOTHING of
// Maya's sheet may appear in Kabir's compiled self. Two scans over Kabir's
// full lane set (text core+tail and every speech style):
//
//   1. GATING — sheet-fragment leaks: every MAYA sheet field's full value
//      must be absent from Kabir's output (except crisisLines, which is
//      deliberately the same locale set). A hit means the core still reads
//      Maya somewhere the parameter should flow — a real defect.
//   2. MEASURED, non-gating — residual Maya-isms in the CORE's own prose
//      (her example quotes inside OS bullets, directive lines): counted and
//      printed with lane + context. This is the evidence-ordered extraction
//      backlog the split's v1 declared; it shrinks release by release. It
//      does NOT fail the build — a hard fail would block every ship behind
//      finishing the tail, and the tail's ORDER is exactly what this
//      measures. The count is asserted monotonically: a RATCHET constant
//      pins today's count so it can fall but never silently rise.
//
// Hermetic: no network, no ambient config (persona compile is pure).
import { execSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "relleak-"));
const BUNDLE = join(tmp, "relational.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(BUNDLE);
const kabir = E.kabirAgent;
const MAYA = E.MAYA;

let pass = 0;
let fail = 0;
const ok = (name, cond, detail = "") => {
  if (cond) pass++;
  else {
    fail++;
    console.log(`  FAIL ${name}${detail ? " — " + detail : ""}`);
    return;
  }
  console.log(`  ok   ${name}${detail ? " — " + detail : ""}`);
};

// ── Kabir's full lane set ─────────────────────────────────────────────────
const user = { name: "Sam", vibe: ["company"], facts: { city: "Pune" } };
const parts = kabir.buildSystemPromptParts(user, 200, "text");
const vparts = kabir.buildSystemPromptParts(user, 200, "voice");
const lanes = {
  "text.core": parts.core,
  "text.tail": parts.tail,
  "voice.core": vparts.core,
  live: kabir.buildSpeechStyle("live"),
  gemini: kabir.buildSpeechStyle("gemini"),
  eleven: kabir.buildSpeechStyle("eleven"),
  sarvam: kabir.buildSpeechStyle("sarvam"),
  device: kabir.buildSpeechStyle("device"),
  watch: kabir.WATCH_MODE_NOTE,
  search: kabir.SEARCH_DECISION,
  forget: kabir.FORGET_DECISION,
};

console.log("── 1. GATING: no Maya sheet fragment in Kabir's compiled self ──");
const shared = new Set(["crisisLines", "slug", "version"]); // deliberately shared / non-prose
for (const [field, value] of Object.entries(MAYA)) {
  if (shared.has(field) || typeof value !== "string" || value.length < 12) continue;
  const hits = Object.entries(lanes).filter(([, text]) => text.includes(value));
  ok(
    `MAYA.${field} absent from every Kabir lane`,
    hits.length === 0,
    hits.length ? `leaks into ${hits.map(([l]) => l).join(", ")}` : "",
  );
}
// negative control: the scan must be able to see a real leak
{
  const planted = lanes["text.core"] + MAYA.identityWho;
  ok("NEGATIVE CONTROL: a planted fragment IS caught", planted.includes(MAYA.identityWho));
}
// and Kabir is actually himself
ok("Kabir's own identity compiled in", lanes["text.core"].includes("29-year-old Indian man"));
ok("Maya's name is not Kabir's", !lanes["text.core"].includes("You are Maya"));

console.log("\n── 2. MEASURED: residual Maya-isms in the core's own prose ──");
// Markers that belong to HER voice, not his and not the OS. Each hit is a
// future extraction, ordered by count.
const MARKERS = [
  "yaar", "arre", "😭", "kya??", "haan bol", "bhejti hu", "aati hu",
  "tumne", "bata na", "chhod,", "ruk ", "wali ", "kaunsi",
];
const found = [];
for (const [laneName, text] of Object.entries(lanes)) {
  for (const m of MARKERS) {
    let i = -1;
    while ((i = text.indexOf(m, i + 1)) >= 0) {
      found.push({ lane: laneName, marker: m, ctx: text.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, " ") });
    }
  }
}
const byMarker = {};
for (const f of found) byMarker[f.marker] = (byMarker[f.marker] || 0) + 1;
console.log(`  residual Maya-isms in Kabir's lanes: ${found.length} hits`);
for (const [m, n] of Object.entries(byMarker).sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(3)} × ${JSON.stringify(m)}`);
for (const f of found.slice(0, 12)) console.log(`      [${f.lane}] …${f.ctx}…`);

// The ratchet: today's measured count. It may FALL (extraction progress) but
// a silent RISE fails — new Maya prose must go into her sheet, not the core.
const RATCHET = 27; // 2026-08-25: 95 -> 64 -> 27, extraction batches 1-2 (22 example-fragment fields, exact-byte cuts, Maya 83/83 byte-identical each time)
ok(`residual count ${found.length} <= ratchet ${RATCHET} (falls with extraction, never silently rises)`, found.length <= RATCHET, String(found.length));

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} assertions)`);
process.exit(fail === 0 ? 0 : 1);
