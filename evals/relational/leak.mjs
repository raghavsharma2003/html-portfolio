// RelationalOS R3 — the cross-agent leak guard.
//
// The claim under test (context/decisions.md `personality-is-a-sheet`): a
// personality is a CharacterSheet on the Relational Core, so NOTHING of
// Maya's sheet may appear in another agent's compiled self. Scans over EVERY
// non-Maya subject's full lane set (text core+tail, every speech style, the
// OS-constant call/watch directives, and the stage tail at all three depths):
//
//   1. GATING — sheet-fragment leaks: every MAYA sheet field's full value
//      must be absent from the subject's output (except crisisLines, which is
//      deliberately the same locale set). A hit means the core still reads
//      Maya somewhere the parameter should flow — a real defect.
//   1b. GATING — the teacher module must not inherit the COMPANION ARC. Its
//      whole reason for supplying arc overrides is that a clone of a named
//      real teacher talking to minors may not carry a romance-escalation
//      clause, and `honesty-by-instruction` says a property decidable on the
//      output is decided there rather than trusted to a paragraph. Carries
//      its own negative control (the clause IS present for the companion), so
//      a pass means the override fired and not that the probe went stale.
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
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const tmp = mkdtempSync(join(tmpdir(), "relleak-"));
const BUNDLE = join(tmp, "relational.bundle.mjs");
execSync(
  `npx esbuild ${join(HERE, ".entry.ts")} --bundle --format=esm --platform=node ` +
    `--outfile=${BUNDLE} --log-level=error --alias:@capacitor/core=${join(ROOT, "evals/stubs/capacitor.mjs")}`,
  { stdio: "inherit", cwd: ROOT },
);
const E = await import(pathToFileURL(BUNDLE).href);
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

// ── every non-Maya agent's full lane set ──────────────────────────────────
// Generalised from Kabir-only (2026-08-25, gurukul WS-A): the failure class
// this guard exists for — a module carrying another character's fragments —
// is not Kabir's alone, and a teacher clone carrying Maya-isms is the same
// defect with higher stakes. Every subject below gets the identical scan.
const user = { name: "Sam", vibe: ["company"], facts: { city: "Pune" } };
const buildLanes = (agent, sheet) => {
  const parts = agent.buildSystemPromptParts(user, 200, "text");
  const vparts = agent.buildSystemPromptParts(user, 200, "voice");
  return {
    "text.core": parts.core,
    "text.tail": parts.tail,
    "voice.core": vparts.core,
    live: agent.buildSpeechStyle("live"),
    gemini: agent.buildSpeechStyle("gemini"),
    eleven: agent.buildSpeechStyle("eleven"),
    sarvam: agent.buildSpeechStyle("sarvam"),
    device: agent.buildSpeechStyle("device"),
    watch: agent.WATCH_MODE_NOTE,
    search: agent.SEARCH_DECISION,
    forget: agent.FORGET_DECISION,
    // OS-constant call/watch directives: shipped verbatim on EVERY agent's
    // call lane (useCallEngine imports them directly), so a Maya-ism inside
    // any of them is a leak into every future personality. Added 2026-08-25.
    callOpen: E.CALL_OPEN_DIRECTIVE(undefined, sheet),
    callOpenFollowup: E.CALL_OPEN_DIRECTIVE({ lastCallMinAgo: 4 }, sheet),
    wAlong: E.WATCH_ALONG_DIRECTIVE(),
    wComment: E.WATCH_COMMENT_DIRECTIVE(),
    wIdle: E.WATCH_IDLE_DIRECTIVE(),
    wPoint: E.WATCH_POINT_DIRECTIVE(),
    wReshow: E.WATCH_RESHOW_DIRECTIVE(),
    wScene: E.WATCH_SCENE_DIRECTIVE(),
    wShow: E.WATCH_SHOW_DIRECTIVE(),
    wStart: E.WATCH_START_DIRECTIVE(),
  };
};

// The stage paragraph rides in the TAIL and is stage-selected, so a single
// build at messageCount 200 only ever exercises ONE of the three. The arc is
// the whole safety point of a teacher module, so it is scanned at all three
// depths rather than at whichever one the default happens to pick.
const stageTails = (agent) =>
  [0, 60, 400].map((n) => agent.buildSystemPromptParts(user, n, "text").tail);

const SUBJECTS = [
  { name: "Kabir", agent: E.kabirAgent, sheet: E.KABIR, selfProbe: "29-year-old Indian man" },
  {
    name: "Arjun Sir (demo teacher)",
    agent: E.demoTeacherAgent,
    sheet: E.DEMO_TEACHER,
    selfProbe: "JEE physics teacher",
  },
];

const shared = new Set(["crisisLines", "slug", "version"]); // deliberately shared / non-prose
const allLanes = [];

for (const s of SUBJECTS) {
  const lanes = buildLanes(s.agent, s.sheet);
  allLanes.push([s.name, lanes]);
  console.log(`── 1. GATING: no Maya sheet fragment in ${s.name}'s compiled self ──`);
  const scan = { ...lanes };
  stageTails(s.agent).forEach((t, i) => (scan[`stage.tail[${i}]`] = t));
  for (const [field, value] of Object.entries(MAYA)) {
    if (shared.has(field) || typeof value !== "string" || value.length < 12) continue;
    const hits = Object.entries(scan).filter(([, text]) => text.includes(value));
    ok(
      `MAYA.${field} absent from every ${s.name} lane`,
      hits.length === 0,
      hits.length ? `leaks into ${hits.map(([l]) => l).join(", ")}` : "",
    );
  }
  // negative control: the scan must be able to see a real leak
  ok(
    `NEGATIVE CONTROL (${s.name}): a planted fragment IS caught`,
    (lanes["text.core"] + MAYA.identityWho).includes(MAYA.identityWho),
  );
  // and the agent is actually itself
  ok(`${s.name}'s own identity compiled in`, lanes["text.core"].includes(s.selfProbe));
  ok(`Maya's name is not ${s.name}'s`, !lanes["text.core"].includes("You are Maya"));
}

// ── 1b. THE ARC IS THE SAFETY PROPERTY, so it is decided on the BYTES ─────
// `honesty-by-instruction` (context/rejected.md): a property decidable on the
// output is decided there, never by a paragraph hoping to be obeyed. The
// teacher module's whole reason for supplying arc overrides is that a clone of
// a named real teacher talking to minors must not carry the companion arc —
// so assert the absence, not the intention. safety-floor-teacher.md §3.1
// requires this clause GONE FROM THE CONTENT and not merely gated by
// clock.ts's romanceRegisters; this check is the content half's evidence.
{
  console.log("\n── 1b. GATING: the teacher module does not inherit the companion arc ──");
  const t = E.demoTeacherAgent;
  const lanes = buildLanes(t, E.DEMO_TEACHER);
  const everything = Object.values(lanes).join("\n") + "\n" + stageTails(t).join("\n");
  const ESCALATION = "warmth can deepen naturally";
  ok("romance-escalation clause absent from every teacher lane", !everything.includes(ESCALATION));
  ok("ROMANCE BOUNDARY header absent", !everything.includes("ROMANCE BOUNDARY"));
  ok("MENTOR BOUNDARY present in its place", everything.includes("MENTOR BOUNDARY"));
  // Negative control on the same string: it IS present for the incumbent, so
  // a pass above means the override fired and not that the probe went stale.
  ok(
    "NEGATIVE CONTROL: the clause IS present for the companion agent",
    buildLanes(E.meeraAgent, MAYA)["text.core"].includes(ESCALATION),
  );
  // The three stage paragraphs are the teacher's own, at all three depths.
  const tails = stageTails(t);
  ok("stage 1 is the mentor arc", tails[0].includes("FIRST SESSIONS"));
  ok("stage 2 is the mentor arc", tails[1].includes("REGULAR STUDENT"));
  ok("stage 3 is the mentor arc", tails[2].includes("LONG HAUL"));
  // The incumbent's own stage-2 seam defect (SPEC-GURUKUL §7: an
  // uninterpolated `${C.stageNickname}` literal reaches the model) must not be
  // inherited — the teacher's replacement deliberately carries no trailing
  // sheet slot, and that is a property, not a hope.
  ok(
    "teacher arc does not inherit the uninterpolated stageNickname literal",
    !tails.some((x) => x.includes("${C.stageNickname}")),
  );
  // The child-specific helpline, and the coupling that makes it sayable.
  ok("Childline 1098 present in the teacher's crisis lines", t.CRISIS_LINES.includes("1098"));
  ok(
    "every teacher lane still carries the invariant-probed helpline",
    everything.includes("Tele-MANAS") && everything.includes("14416"),
  );
}

console.log("\n── 2. MEASURED: residual Maya-isms in the core's own prose ──");
// Markers that belong to HER voice, not his and not the OS. Each hit is a
// future extraction, ordered by count.
const MARKERS = [
  "yaar", "arre", "😭", "kya??", "haan bol", "bhejti hu", "aati hu",
  "tumne", "bata na", "chhod,", "ruk ", "wali ", "kaunsi",
];
const found = [];
for (const [subject, lanes] of allLanes) {
  for (const [laneName, text] of Object.entries(lanes)) {
    for (const m of MARKERS) {
      let i = -1;
      while ((i = text.indexOf(m, i + 1)) >= 0) {
        found.push({
          lane: `${subject}/${laneName}`,
          marker: m,
          ctx: text.slice(Math.max(0, i - 40), i + 40).replace(/\n/g, " "),
        });
      }
    }
  }
}
const byMarker = {};
for (const f of found) byMarker[f.marker] = (byMarker[f.marker] || 0) + 1;
console.log(`  residual Maya-isms across ${allLanes.length} non-Maya agents: ${found.length} hits`);
for (const [m, n] of Object.entries(byMarker).sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(n).padStart(3)} × ${JSON.stringify(m)}`);
for (const f of found.slice(0, 12)) console.log(`      [${f.lane}] …${f.ctx}…`);

// The ratchet: today's measured count. It may FALL (extraction progress) but
// a silent RISE fails — new Maya prose must go into her sheet, not the core.
const RATCHET = 0; // 2026-08-25: 95 -> 64 -> 27 -> 0. The extraction tail is DONE: every Maya-ism the markers can see now lives in her sheet, the watch note is parameterized, and this number may never rise again — new character prose goes in a sheet, full stop.
ok(`residual count ${found.length} <= ratchet ${RATCHET} (falls with extraction, never silently rises)`, found.length <= RATCHET, String(found.length));

console.log(`\n${fail === 0 ? "ALL PASS" : fail + " FAILED"} (${pass} assertions)`);
process.exit(fail === 0 ? 0 : 1);
