// The teacher-sheet seam — the publish-time validator, the runtime
// constructor, and the consent gate that decides whether a clone may exist.
//
//   node evals/teachersheet.mjs
//
// Offline, deterministic, $0, no DB. Bundles the REAL TypeScript on every run
// (evals/practice.mjs's pattern, and CLAUDE.md's reason: a frozen bundle
// passes forever while the source rots).
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE VALIDATOR IS THE PUBLISH GATE. teacher-sheet-spec.md §4: "This is a
//    gate, not a linter run: publish fails closed." Four rejections are
//    checked one case each, and each of them is a real failure this product
//    can ship: no crisis lines, a helpline the honesty gate would treat as
//    invented, a sentence-shaped line in a field the model will recite, and a
//    missing arc override — which is a clone of a real named teacher, talking
//    to a minor, wearing the companion arc.
//
// 2. THE DYNAMIC PATH IS THE STATIC PATH. `sheetToModule(DEMO_TEACHER)` must
//    compile to the same bytes as the registered `teacher-demo-arjun` module.
//    They are two spellings today for an import-cycle reason stated in
//    fromSheet.ts's header, and this is the check that makes the drift between
//    them loud.
//
// 3. THE CONSENT GATE, WITH ITS NEGATIVE CONTROL. A check that would pass
//    against the bug it exists to catch is not a check. So the gate predicate
//    is re-run here with the consent clause STRUCK, and the suite fails unless
//    the struck copy goes quiet — which is what proves the live clause is
//    doing the work and not the `status !== 'published'` half beside it.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildLanes, safetyFloorChecks } from "./persona-invariants.data.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Derived from this file's location, never hardcoded: a literal container
// path is true of exactly one machine and silently wrong everywhere else.
const REPO = resolve(HERE, "..");
const OUT = mkdtempSync(join(tmpdir(), "teachersheet-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/agents/fromSheet"))};\n` +
  `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n` +
  `export { getAgent } from ${JSON.stringify(join(REPO, "src/engine/agents/registry"))};\n` +
    `export { compile, MATERIAL_BLOCK_OPEN, MATERIAL_BLOCK_CLOSE, AGE_TIER_SAFETY_OVERRIDE, PLATFORM_STAGE_GETTING_CLOSE, PLATFORM_STAGE_ESTABLISHED, OPERATIONAL_CORE_CAP, OPERATIONAL_TAIL_CAP, renderCreatorMaterial, renderCreatorMaterialParts } from ${JSON.stringify(join(REPO, "src/engine/compiler"))};\n` +
    `export { ROOM_MODE_NOTE } from ${JSON.stringify(join(REPO, "src/engine/room"))};\n` +
    `export { PUBLISHED_HELPLINES } from ${JSON.stringify(join(REPO, "src/engine/honesty"))};\n`,
);
const BUNDLE = join(OUT, "teachersheet.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(HERE, "stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  sheetToModule,
  validateTeacherSheet,
  consentGateBlockers,
  helplineNumbersIn,
  PLACEHOLDER_CONSENT_ARTIFACT_ID,
  DEMO_TEACHER,
  getAgent,
  compile,
  MATERIAL_BLOCK_OPEN,
  MATERIAL_BLOCK_CLOSE,
  AGE_TIER_SAFETY_OVERRIDE,
  PLATFORM_STAGE_GETTING_CLOSE,
  PLATFORM_STAGE_ESTABLISHED,
  OPERATIONAL_CORE_CAP,
  OPERATIONAL_TAIL_CAP,
  ROOM_MODE_NOTE,
  renderCreatorMaterial,
  renderCreatorMaterialParts,
  PUBLISHED_HELPLINES,
} = M;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
/** true when SOME error carries this code (optionally on this field) */
const has = (result, code, field) =>
  result.errors.some((e) => e.code === code && (field === undefined || e.field === field));
const codes = (result) => result.errors.map((e) => `${e.field}:${e.code}`).join(", ");
/** a shallow copy with one field changed — sheets are frozen data, so every
 *  negative case is a COPY and the positive case can never be corrupted by an
 *  earlier test having mutated the fixture. */
const withField = (patch) => ({ ...DEMO_TEACHER, ...patch });

// ── 1. the demo sheet publishes (content half) ─────────────────────────────
console.log("\n── the validator accepts a well-formed sheet ──");
const accepted = validateTeacherSheet(DEMO_TEACHER);
ok("demo teacher sheet passes every content check", accepted.ok, accepted.ok ? "" : codes(accepted));

// ── 2. the four rejections, one case each ──────────────────────────────────
console.log("\n── the validator rejects, one case each (spec §4) ──");

const noCrisis = validateTeacherSheet(withField({ crisisLines: "   " }));
ok("crisis lines empty -> rejected", !noCrisis.ok && has(noCrisis, "crisis-lines-empty", "crisisLines"), codes(noCrisis));

// The Childline-1098 coupling, stated as a test: an actionable number in the
// sheet that is NOT in honesty.ts's PUBLISHED_HELPLINES ships a clone that
// cannot say it — the gate treats an identifier absent from its input as
// invented. 14417 is 14416 with one digit moved, which is exactly the shape a
// typo takes.
const badLine = validateTeacherSheet(
  withField({ crisisLines: DEMO_TEACHER.crisisLines.replace("14416", "14417") }),
);
ok(
  "helpline absent from PUBLISHED_HELPLINES -> rejected, and the error NAMES the number",
  !badLine.ok && badLine.errors.some((e) => e.code === "helpline-not-published" && e.detail === "14417"),
  codes(badLine),
);
ok(
  "Childline 1098 is published, so the demo sheet's own child helpline passes",
  PUBLISHED_HELPLINES.map((h) => h.replace(/\D+/g, "")).includes("1098") &&
    helplineNumbersIn(DEMO_TEACHER.crisisLines).includes("1098"),
);

// A sentence in a lintable field is the `recited-prompt` failure: measured
// twice on this codebase, at 4/5 turns and then verbatim eight turns apart.
const recitable = validateTeacherSheet({
  ...DEMO_TEACHER,
  lifeTexture: "The answer is always hiding in the diagram you refused to draw.",
});
ok(
  "sentence-shaped recitable in a lintable field -> rejected",
  !recitable.ok && has(recitable, "recitable-shape", "lifeTexture"),
  codes(recitable),
);

// A teacher sheet may not fall back to the companion arc — the boundary
// paragraph is the one whose middle sentence is a live escalation path.
const noArc = { ...DEMO_TEACHER };
delete noArc.boundaryParagraph;
const arcResult = validateTeacherSheet(noArc);
ok(
  "arc override missing -> rejected with its own code, not 'empty'",
  !arcResult.ok && has(arcResult, "arc-override-missing", "boundaryParagraph"),
  codes(arcResult),
);

// ── 3. the constructed module clears the safety floor ──────────────────────
// Reuses the invariant suite's own machinery rather than restating it: the
// same buildLanes() and the same safetyFloorChecks() the per-agent runner
// drives, pointed at a module that was built from sheet DATA.
console.log("\n── sheetToModule() output under the safety floor (crisis lines, never-deny-AI, NEVER MANIPULATE, spoken register) ──");
const built = sheetToModule(DEMO_TEACHER);
const lanes = buildLanes(built);
let floorFail = 0;
for (const c of safetyFloorChecks(built, lanes)) {
  if (!c.cond) floorFail++;
  ok(`floor: ${c.name}`, c.cond, c.extra || "");
}
ok("no safety-floor failure on a module built from sheet data", floorFail === 0, `${floorFail} failures`);

// The dynamic path IS the static path. Compare compiled bytes, not shapes:
// two modules with the same keys and different prompts is exactly the drift
// this check exists for.
console.log("\n── the dynamic constructor and the static module are the same bytes ──");
const registered = getAgent("teacher-demo-arjun");
ok("teacher-demo-arjun is registered", !!registered);
const staticLanes = buildLanes(registered);
ok(
  "text-lane prompt bytes identical (static module vs sheetToModule)",
  staticLanes.t.core === lanes.t.core && staticLanes.t.tail === lanes.t.tail,
);
ok(
  "voice-lane prompt bytes identical (static module vs sheetToModule)",
  staticLanes.v.core === lanes.v.core && staticLanes.v.tail === lanes.v.tail,
);
ok(
  "every speech-style lane identical too (live/gemini/eleven/sarvam/device)",
  ["live", "casc", "L", "C", "E", "S", "D"].every((k) => staticLanes[k] === lanes[k]),
);
ok("CRISIS_LINES carried through the constructor", built.CRISIS_LINES === DEMO_TEACHER.crisisLines);
ok("slug/displayName/personaVersion come off the sheet", built.slug === DEMO_TEACHER.slug &&
  built.displayName === DEMO_TEACHER.name && built.personaVersion === DEMO_TEACHER.version);

// The creator-authored active stage used to sit in CORE, so the 149 -> 150
// transition changed the provider cache prefix in a live session. Stable
// creator material stays in CORE; exactly the selected raw stage stays in
// TAIL. Both module constructors must make the same split.
console.log("\n── creator material is cache-stable across the 149 -> 150 stage boundary ──");
const materialStable = [{ label: "who", value: "teacher" }];
const materialSelected = { label: "stage", value: "regular student" };
const splitMaterial = renderCreatorMaterialParts(materialStable, materialSelected);
ok(
  "both sides of the cache boundary are independently closed material blocks",
  splitMaterial.core === renderCreatorMaterial(materialStable) &&
    splitMaterial.tail === renderCreatorMaterial([materialSelected]),
);
const materialPartsAt = (agent, messageCount) => agent.buildSystemPromptParts(
  { name: "", vibe: [], facts: {} }, messageCount, "text",
);
const dynamic149 = materialPartsAt(built, 149);
const dynamic150 = materialPartsAt(built, 150);
const static149 = materialPartsAt(registered, 149);
const static150 = materialPartsAt(registered, 150);
ok("dynamic sheet CORE stays byte-identical across 149 -> 150", dynamic149.core === dynamic150.core);
ok("static teacher CORE stays byte-identical across 149 -> 150", static149.core === static150.core);
ok("the stage transition changes TAIL", dynamic149.tail !== dynamic150.tail);
ok(
  "149 carries only the raw getting-close stage in TAIL",
  dynamic149.tail.includes(DEMO_TEACHER.stageGettingClose) &&
    !dynamic149.tail.includes(DEMO_TEACHER.stageEstablished) &&
    !dynamic149.core.includes(DEMO_TEACHER.stageGettingClose),
);
ok(
  "150 carries only the raw established stage in TAIL",
  dynamic150.tail.includes(DEMO_TEACHER.stageEstablished) &&
    !dynamic150.tail.includes(DEMO_TEACHER.stageGettingClose) &&
    !dynamic150.core.includes(DEMO_TEACHER.stageEstablished),
);
ok(
  "static and sheet-backed modules remain byte-identical on both sides of the boundary",
  static149.core === dynamic149.core && static149.tail === dynamic149.tail &&
    static150.core === dynamic150.core && static150.tail === dynamic150.tail,
);

// Exercise the FINAL compiler composition, where speech style, the minor
// override and ROOM_MODE_NOTE are inserted between AgentModule.core and
// AgentModule.tail. A module-level concatenation test cannot see this seam.
const compileAt = (agent, messageCount, patch = {}) => compile({
  agent,
  user: { name: "", vibe: [], facts: {} },
  messageCount,
  medium: patch.mode === "call" ? "voice" : "text",
  mode: "chat",
  voiceEngine: patch.mode === "call" ? "eleven" : "gemini",
  isDirective: false,
  watching: false,
  innerThread: "",
  innerWants: "",
  memories: "",
  herLife: "",
  cultureNoteText: "",
  ...patch,
});
const envelopeSpans = (text) => {
  const spans = [];
  let cursor = 0;
  while (true) {
    const open = text.indexOf(MATERIAL_BLOCK_OPEN, cursor);
    if (open < 0) break;
    const nextOpen = text.indexOf(MATERIAL_BLOCK_OPEN, open + MATERIAL_BLOCK_OPEN.length);
    const close = text.indexOf(MATERIAL_BLOCK_CLOSE, open + MATERIAL_BLOCK_OPEN.length);
    if (close < 0 || (nextOpen >= 0 && nextOpen < close)) return null;
    spans.push([open, close + MATERIAL_BLOCK_CLOSE.length]);
    cursor = close + MATERIAL_BLOCK_CLOSE.length;
  }
  return text.indexOf(MATERIAL_BLOCK_CLOSE, cursor) >= 0 ? null : spans;
};
const stageInsideTailEnvelope = (compiled, stage) =>
  envelopeSpans(compiled.tail)?.some(([start, end]) => compiled.tail.slice(start, end).includes(stage)) === true;
const trustedInstructionHasAnOutsideCreatorEnvelope = (compiled, instruction) => {
  const outside = (text) => {
    const spans = envelopeSpans(text);
    if (!spans) return false;
    let at = text.indexOf(instruction);
    while (at >= 0) {
      if (!spans.some(([start, end]) => at >= start && at < end)) return true;
      at = text.indexOf(instruction, at + instruction.length);
    }
    return false;
  };
  return outside(compiled.core) || outside(compiled.tail);
};

const finalCases = [
  ["chat", { mode: "chat" }],
  ["call", { mode: "call" }],
  ["minor", { mode: "chat", ageGates: { romanceRegisters: false, engagementMechanics: false } }],
  ["Room", { mode: "chat", roomBundle: { members: [], bridge: [] } }],
];
for (const [label, patch] of finalCases) {
  const dynamicCompiled = compileAt(built, 149, patch);
  const staticCompiled = compileAt(registered, 149, patch);
  const coreOpen = dynamicCompiled.core.indexOf(MATERIAL_BLOCK_OPEN);
  const coreClose = dynamicCompiled.core.lastIndexOf(MATERIAL_BLOCK_CLOSE);
  const tailClose = dynamicCompiled.tail.lastIndexOf(MATERIAL_BLOCK_CLOSE);
  const modeInstruction = label === "call"
    ? built.buildSpeechStyle("eleven")
    : label === "minor"
    ? AGE_TIER_SAFETY_OVERRIDE
    : label === "Room"
    ? ROOM_MODE_NOTE
    : "";
  const modeInstructionAfterCoreMaterial = !modeInstruction ||
    dynamicCompiled.core.indexOf(modeInstruction, coreClose) > coreClose;
  ok(`${label}: final compile has one closed material envelope in CORE and one in TAIL`,
    envelopeSpans(dynamicCompiled.core)?.length === 1 && envelopeSpans(dynamicCompiled.tail)?.length === 1);
  ok(`${label}: every trusted instruction stays outside creator material`,
    trustedInstructionHasAnOutsideCreatorEnvelope(dynamicCompiled, "NEVER MANIPULATE") &&
      trustedInstructionHasAnOutsideCreatorEnvelope(dynamicCompiled, PLATFORM_STAGE_GETTING_CLOSE) &&
      (!modeInstruction || trustedInstructionHasAnOutsideCreatorEnvelope(dynamicCompiled, modeInstruction)) &&
      dynamicCompiled.core.indexOf("NEVER MANIPULATE") < coreOpen &&
      dynamicCompiled.tail.lastIndexOf(PLATFORM_STAGE_GETTING_CLOSE) > tailClose &&
      modeInstructionAfterCoreMaterial);
  ok(`${label}: exact raw active-stage content stays inside the TAIL material envelope`,
    stageInsideTailEnvelope(dynamicCompiled, DEMO_TEACHER.stageGettingClose));
  ok(`${label}: static and sheet-backed final compiles remain identical`,
    dynamicCompiled.core === staticCompiled.core && dynamicCompiled.tail === staticCompiled.tail);
  ok(`${label}: configured operational budgets are unchanged and the prompt fits`,
    OPERATIONAL_CORE_CAP === 72_000 && OPERATIONAL_TAIL_CAP === 24_000 &&
      dynamicCompiled.core.length <= OPERATIONAL_CORE_CAP && dynamicCompiled.tail.length <= OPERATIONAL_TAIL_CAP);
}
const final149 = compileAt(built, 149);
const final150 = compileAt(built, 150);
ok("final compile CORE stays byte-identical across 149 -> 150", final149.core === final150.core);
ok("final compile 149 keeps only the exact raw getting-close stage inside TAIL material",
  stageInsideTailEnvelope(final149, DEMO_TEACHER.stageGettingClose) && !final149.tail.includes(DEMO_TEACHER.stageEstablished));
ok("final compile 150 keeps only the exact raw established stage inside TAIL material",
  stageInsideTailEnvelope(final150, DEMO_TEACHER.stageEstablished) && !final150.tail.includes(DEMO_TEACHER.stageGettingClose));
ok("the platform's selected stage instruction remains outside creator material at 149 and 150",
  final149.tail.lastIndexOf(PLATFORM_STAGE_GETTING_CLOSE) > final149.tail.lastIndexOf(MATERIAL_BLOCK_CLOSE) &&
    final150.tail.lastIndexOf(PLATFORM_STAGE_ESTABLISHED) > final150.tail.lastIndexOf(MATERIAL_BLOCK_CLOSE));

// ── 4. the consent gate, and its negative control ──────────────────────────
console.log("\n── the consent gate: registration is impossible without a consent artifact ──");
const published = { status: "published", consent_artifact_id: "b1000000-0000-4000-8000-000000000001" };
ok("published + consent artifact -> gate open", consentGateBlockers(published).length === 0);
ok(
  "published + NULL consent artifact -> blocked",
  consentGateBlockers({ status: "published", consent_artifact_id: null }).includes("consent_artifact_missing"),
);
ok(
  "the demo teacher's nil-shaped placeholder is NOT a consent row",
  consentGateBlockers({ status: "published", consent_artifact_id: PLACEHOLDER_CONSENT_ARTIFACT_ID }).includes(
    "consent_artifact_placeholder",
  ),
);
ok(
  "status='revoked' with a consent artifact still deregisters (revocation is not an edit to the prompt)",
  consentGateBlockers({ status: "revoked", consent_artifact_id: published.consent_artifact_id }).includes(
    "sheet_not_published",
  ),
);
ok(
  "a draft never loads",
  consentGateBlockers({ status: "draft", consent_artifact_id: null }).length === 2,
);

// THE NEGATIVE CONTROL. The predicate above, copied, with the consent clause
// struck out — nothing else changed. If a NULL consent artifact still blocks
// under the struck copy, then the clause under test was not what blocked it
// in the live one, and every assertion above is measuring the status check.
console.log("\n── negative control: strike the consent clause and the gate must go quiet ──");
function consentGateBlockersSTRUCK(row) {
  const blockers = [];
  if (row.status !== "published") blockers.push("sheet_not_published");
  // ── the consent clause, struck ──
  return blockers;
}
const struckOnNull = consentGateBlockersSTRUCK({ status: "published", consent_artifact_id: null });
const struckOnPlaceholder = consentGateBlockersSTRUCK({
  status: "published",
  consent_artifact_id: PLACEHOLDER_CONSENT_ARTIFACT_ID,
});
ok("with the clause struck, a NULL consent artifact passes (so the live clause is what catches it)", struckOnNull.length === 0);
ok("with the clause struck, the placeholder passes too", struckOnPlaceholder.length === 0);
ok(
  "the live predicate catches both cases the struck copy misses",
  consentGateBlockers({ status: "published", consent_artifact_id: null }).length === 1 &&
    consentGateBlockers({ status: "published", consent_artifact_id: PLACEHOLDER_CONSENT_ARTIFACT_ID }).length === 1,
);

// ── 5. the loader's publish predicate, offline ─────────────────────────────
// api/_teachersheet.js's DB half needs a database and is not driven here (this
// suite is offline by contract). Its GATE half is pure, and it is wired in
// under the same `dead-writers` test as everything else: a loader nothing
// exercises is indistinguishable from a loader that does not work. This is
// also the check that the loader composes the two halves — content validity
// AND consent — rather than either one alone.
console.log("\n── api/_teachersheet.js: the publish predicate (no DB) ──");
const { checkPublishable } = await import(pathToFileURL(join(REPO, "api/_teachersheet.js")).href);
const realConsent = { consent_artifact_id: "b1000000-0000-4000-8000-000000000001" };
ok("valid sheet + a real consent artifact -> publishable", checkPublishable(DEMO_TEACHER, realConsent).ok);
const demoAsIs = checkPublishable(DEMO_TEACHER, null);
ok(
  "the demo teacher is NOT publishable — his placeholder is not a consent row",
  !demoAsIs.ok && demoAsIs.blockers.includes("consent_artifact_placeholder") && demoAsIs.errors.length === 0,
  demoAsIs.blockers.join(", "),
);
const brokenWithConsent = checkPublishable({ ...DEMO_TEACHER, crisisLines: "" }, realConsent);
ok(
  "a consent artifact does not buy past a content failure",
  !brokenWithConsent.ok && brokenWithConsent.blockers.length === 0 && brokenWithConsent.errors.length > 0,
);

// ── 6. WS-R151: sheetKind default equivalence, teacher-kind regression ─────
// Migration 163 adds `sheet_kind` beside this sheet; `fromSheet.ts`'s
// validator now branches on the sheet's own `sheetKind` claim. Every check
// above ran against `DEMO_TEACHER`, which carries no `sheetKind` at all —
// this is the assertion that "absent" and "explicitly teacher" are the same
// input to the validator, which is what makes every sheet saved before this
// workstream still validate exactly as it always did (the brief's own
// promise, "a teacher sheet compiles byte-identically to today"). The full
// person-kind validator (required/optional fields, the person-only checks,
// the negative controls) lives in `evals/person-sheet`, per this
// workstream's own Build list — this file's job is only the teacher-kind
// regression, which is what a suite already named "teacher-sheet" should
// prove when a sibling kind is introduced.
console.log("\n── WS-R151: sheetKind is additive, not a behavior change for a teacher sheet ──");
const explicitTeacher = validateTeacherSheet(withField({ sheetKind: "teacher" }));
ok(
  "sheetKind:'teacher' explicit and sheetKind absent produce the identical verdict",
  explicitTeacher.ok === accepted.ok && codes(explicitTeacher) === codes(accepted),
  `${codes(explicitTeacher)} vs ${codes(accepted)}`,
);
const personShapedButWrongKindClaim = validateTeacherSheet({ ...DEMO_TEACHER, sheetKind: "not-a-real-kind" });
ok(
  "an unrecognized sheetKind claim falls through to the teacher path (fail closed toward the STRICTER validator, never toward the looser one)",
  personShapedButWrongKindClaim.ok === accepted.ok,
);
const teacherAsPerson = validateTeacherSheet({ ...DEMO_TEACHER, sheetKind: "person" });
ok(
  "a fully-populated TEACHER sheet reinterpreted as sheetKind:'person' does not inherit any teacher-only failure (personLine/personValues/personNeverSay/personTalk are what it is missing, nothing from the pedagogy set)",
  !teacherAsPerson.errors.some((e) =>
    [
      "subjectStrands", "examTrack", "doubtEscalationLadder", "rigorFloor",
      "boardVerbalisms", "commonMistakeBank", "analogyBank",
      "subjectDomain", "pacePreference", "strictness", "warmth",
    ].includes(e.field),
  ),
  codes(teacherAsPerson),
);

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
