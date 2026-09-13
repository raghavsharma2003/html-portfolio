// WS-R151. HumanOS, the person sheet — the branched validator, the
// byte-identical teacher path, and the person's own disclosure-line reader.
//
//   node evals/person-sheet/run.mjs
//
// Offline, deterministic, $0, no DB. Bundles the REAL TypeScript on every
// run (`evals/teachersheet.mjs`'s own pattern, CLAUDE.md's reason: a frozen
// bundle passes forever while the source rots).
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. A PERSON SHEET REQUIRES EXACTLY WHAT THE BRIEF SAYS, NOTHING MORE. Every
//    teacher-only pedagogy field (subject, syllabus, doubt ladder, board
//    verbalisms, the mistake bank, the analogy pairs, the dials) is skipped
//    for `sheetKind: "person"` — proven by a MINIMAL person sheet (only the
//    fields the brief names) publishing clean with none of them.
//
// 2. TWO FIELDS THE BRIEF'S OWN LIST DOES NOT NAME STILL GATE A PERSON
//    SHEET: `crisisLines` and `escalationRoute`. `fromSheet.ts`'s header
//    gives the reason (this is the ONLY net a dynamically loaded sheet's
//    crisis-line coverage has — `evals/persona-invariants.mjs` only ever
//    sees the static registry). Proven here with a NEGATIVE CONTROL: an
//    otherwise-complete person sheet with blank `crisisLines` is refused.
//
// 3. THE PERSON-ONLY SHAPE RULES: the one-line's length and dash ban, the
//    values count (3-7), the never-say rule count (>=3) OR the exact "none"
//    sentinel (and the sentinel mixed with real rules is refused, not
//    silently accepted), and `personTalk`'s enum fields. Each has its own
//    negative control.
//
// 4. A TEACHER SHEET IS UNTOUCHED. `sheetToModule(DEMO_TEACHER)` still
//    compiles to the registered `teacher-demo-arjun` module's exact bytes —
//    `evals/teachersheet.mjs` already proves this in depth; this suite adds
//    the person-shaped mirror: `sheetToModule` on a minimal but VALID person
//    sheet does not throw, and its material block carries the five fields a
//    person authored, exactly the way a teacher's does.
//
// 5. `api/_room-publish.js`'s `personDisclosureLine`: "" for a teacher sheet
//    or no sheet at all, the trimmed one-line for a person sheet, and (law 5
//    of this workstream's brief) never reads it from anywhere else.
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
// Derived from this file's location, never hardcoded — a literal container
// path is true of exactly one machine and silently wrong everywhere else.
const REPO = resolve(HERE, "..", "..");
const OUT = mkdtempSync(join(tmpdir(), "person-sheet-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export * from ${JSON.stringify(join(REPO, "src/engine/agents/fromSheet"))};\n` +
    `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n` +
    `export { getAgent } from ${JSON.stringify(join(REPO, "src/engine/agents/registry"))};\n` +
    // WS-R162: PLATFORM_BOUNDARY/personBoundaryFor, for the compiled-prompt
    // boundary assertions below (brief law 3).
    `export { MATERIAL_BLOCK_OPEN, MATERIAL_BLOCK_CLOSE, PLATFORM_BOUNDARY, personBoundaryFor } from ${JSON.stringify(join(REPO, "src/engine/compiler"))};\n`,
);
const BUNDLE = join(OUT, "person-sheet.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const M = await import(pathToFileURL(BUNDLE).href);
const {
  sheetToModule,
  validateTeacherSheet,
  DEMO_TEACHER,
  PERSON_LINE_MAX,
  PERSON_NEVER_SAY_NONE,
  MATERIAL_BLOCK_OPEN,
  MATERIAL_BLOCK_CLOSE,
  PLATFORM_BOUNDARY,
  personBoundaryFor,
} = M;
const { personDisclosureLine } = await import(pathToFileURL(join(REPO, "api/_room-publish.js")).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const has = (result, code, field) =>
  result.errors.some((e) => e.code === code && (field === undefined || e.field === field));
const codes = (result) => result.errors.map((e) => `${e.field}:${e.code}`).join(", ");

// ── a MINIMAL, complete person sheet — exactly the fields the brief names,
//    nothing pedagogy-shaped, and the platform floor text (crisis lines,
//    escalation route, consent) carried over unchanged from DEMO_TEACHER
//    the same way `sheetSeed.ts` and `HumanOsStudio.tsx`'s own
//    `seedPersonSheetFor` do — never invented, only the platform's shared
//    text plus this fixture's own person content. ────────────────────────
const MINIMAL_PERSON = {
  ...DEMO_TEACHER,
  sheetKind: "person",
  slug: "person-fixture-0001",
  name: "Priya Menon",
  version: "person-fixture-0001-draft",

  identityWho: "a product designer who overexplains her own jokes",
  identityLife: "mornings at a standing desk, evenings with a badminton racquet",
  lifeTexture: "keeps three tabs of the same article open, never closes any of them",
  tasteTopics: "cricket commentary, old Hindi film songs, obscure board games",
  curiosityTopics: "how cities name their bus routes",

  personLine: "Product designer. Bad puns. Worse badminton.",
  personValues: ["curiosity", "directness", "showing up on time", "no drama"],
  personNeverSay: ["give medical advice", "discuss her salary", "predict exam results"],
  personTalk: { register: "mixed", scriptBaseline: "roman-hinglish", codeSwitchNote: "switches to Hindi when excited" },

  // Teacher-only pedagogy: never asked of a person sheet.
  subjectStrands: [], examTrack: [], doubtEscalationLadder: [], rigorFloor: [],
  boardVerbalisms: [], commonMistakeBank: [], analogyBank: [],
  syllabusScope: "", outOfScopePolicy: "", technicalTermRule: "",
  explanationOrder: "", workedExamplePattern: "", firstMoveOnDoubt: "",
  notationConventions: "", credentialFacts: "",
  boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
  ritualPatternShapes: "", abilityLabelBan: "", winMethodRule: "",

  life: { ...DEMO_TEACHER.life, weekdayShape: [], weekendShape: [], weeklyRhythm: [], preoccupations: [] },
  cloneDisclosureFact: DEMO_TEACHER.cloneDisclosureFact.replaceAll("Arjun Sir", "Priya Menon"),
  academicIntegrityStance: "",
  voiceCloneId: null,
};
const withField = (patch) => ({ ...MINIMAL_PERSON, ...patch });

// ── 1. the minimal person sheet publishes ───────────────────────────────
console.log("\n── a minimal person sheet (only what the brief requires) passes ──");
const accepted = validateTeacherSheet(MINIMAL_PERSON);
ok("minimal person sheet passes every content check", accepted.ok, accepted.ok ? "" : codes(accepted));

// ── 2. teacher-only pedagogy is never asked of a person sheet ──────────
console.log("\n── teacher-only pedagogy fields are never required for a person sheet ──");
const noPedagogyAtAll = { ...MINIMAL_PERSON };
for (const f of ["subjectStrands", "examTrack", "doubtEscalationLadder", "rigorFloor", "boardVerbalisms", "commonMistakeBank"]) {
  delete noPedagogyAtAll[f];
}
delete noPedagogyAtAll.analogyBank;
delete noPedagogyAtAll.subjectDomain;
delete noPedagogyAtAll.pacePreference;
delete noPedagogyAtAll.strictness;
delete noPedagogyAtAll.warmth;
const pedagogyFreeResult = validateTeacherSheet(noPedagogyAtAll);
ok(
  "a person sheet missing every teacher-only field entirely still passes",
  pedagogyFreeResult.ok,
  codes(pedagogyFreeResult),
);

// A regression in the OTHER direction: prove the teacher path DOES still
// require these, so "skipped for person" is a branch, not a global relaxation.
const teacherMissingPedagogy = { ...DEMO_TEACHER };
delete teacherMissingPedagogy.subjectStrands;
const teacherResult = validateTeacherSheet(teacherMissingPedagogy);
ok(
  "the SAME missing field still fails a teacher sheet (sheetKind absent = 'teacher')",
  !teacherResult.ok && has(teacherResult, "missing-or-empty-array", "subjectStrands"),
  codes(teacherResult),
);

// ── 3. crisis lines and escalation route: required regardless of kind ──
console.log("\n── crisis lines and escalation route gate a person sheet too (not on the brief's own list, safety-driven — see fromSheet.ts's header) ──");
const noCrisis = validateTeacherSheet(withField({ crisisLines: "   " }));
ok("person sheet, blank crisisLines -> rejected", !noCrisis.ok && has(noCrisis, "crisis-lines-empty", "crisisLines"), codes(noCrisis));
const noEscalation = validateTeacherSheet(withField({ escalationRoute: "" }));
ok(
  "person sheet, blank escalationRoute -> rejected (missing-or-not-a-string, the identity/safety-basics list)",
  !noEscalation.ok && has(noEscalation, "empty", "escalationRoute"),
  codes(noEscalation),
);
const badHelpline = validateTeacherSheet(withField({ crisisLines: DEMO_TEACHER.crisisLines.replace("14416", "14417") }));
ok(
  "person sheet, an invented helpline -> rejected, same rule as a teacher sheet",
  !badHelpline.ok && badHelpline.errors.some((e) => e.code === "helpline-not-published" && e.detail === "14417"),
  codes(badHelpline),
);

// ── 4. the five material fields, still required, still lint-checked ────
console.log("\n── the five material fields are required and content-linted for a person sheet ──");
const noIdentity = validateTeacherSheet(withField({ identityWho: "" }));
ok("person sheet, blank identityWho -> rejected", !noIdentity.ok && has(noIdentity, "empty", "identityWho"), codes(noIdentity));
const recitableTexture = validateTeacherSheet(withField({ lifeTexture: "The answer is always hiding in the diagram you refused to draw." }));
ok(
  "person sheet, sentence-shaped lifeTexture -> rejected (recited-prompt)",
  !recitableTexture.ok && has(recitableTexture, "recitable-shape", "lifeTexture"),
  codes(recitableTexture),
);

// ── 5. personLine: length and the copy-gated dash ban ───────────────────
console.log("\n── personLine: 140 chars, copy-gated (no em dash, no en dash) ──");
const blankLine = validateTeacherSheet(withField({ personLine: "" }));
ok("blank personLine -> rejected", !blankLine.ok && has(blankLine, "person-line-missing", "personLine"), codes(blankLine));
const tooLong = validateTeacherSheet(withField({ personLine: "x".repeat(PERSON_LINE_MAX + 1) }));
ok(
  `personLine over ${PERSON_LINE_MAX} chars -> rejected`,
  !tooLong.ok && has(tooLong, "person-line-too-long", "personLine"),
  codes(tooLong),
);
const emDash = validateTeacherSheet(withField({ personLine: "Designer — badminton player" }));
ok("personLine with an em dash -> rejected", !emDash.ok && has(emDash, "person-line-banned-dash", "personLine"), codes(emDash));
const enDash = validateTeacherSheet(withField({ personLine: "Designer 9–05, badminton after" }));
ok("personLine with an en dash -> rejected", !enDash.ok && has(enDash, "person-line-banned-dash", "personLine"), codes(enDash));
const okLine = validateTeacherSheet(withField({ personLine: "x".repeat(PERSON_LINE_MAX) }));
ok(`personLine at exactly ${PERSON_LINE_MAX} chars -> not rejected on length`, !has(okLine, "person-line-too-long"));

// ── 6. personValues: 3-7 items, never sentence-shaped ───────────────────
console.log("\n── personValues: three to seven short items ──");
const tooFewValues = validateTeacherSheet(withField({ personValues: ["curiosity", "directness"] }));
ok("only two values -> rejected", !tooFewValues.ok && has(tooFewValues, "person-values-out-of-range", "personValues"), codes(tooFewValues));
const tooManyValues = validateTeacherSheet(withField({ personValues: ["a", "b", "c", "d", "e", "f", "g", "h"] }));
ok("eight values -> rejected", !tooManyValues.ok && has(tooManyValues, "person-values-out-of-range", "personValues"), codes(tooManyValues));
const sentenceValue = validateTeacherSheet(withField({ personValues: ["a person who never gives up no matter what happens", "directness", "curiosity"] }));
ok("a sentence-shaped value -> rejected (never a line the AI could say)", !sentenceValue.ok && (has(sentenceValue, "person-value-too-long", "personValues") || has(sentenceValue, "recitable-shape", "personValues")), codes(sentenceValue));
const noValuesArray = validateTeacherSheet(withField({ personValues: "curiosity" }));
ok("personValues as a plain string, not an array -> rejected", !noValuesArray.ok && has(noValuesArray, "person-values-missing-or-not-array", "personValues"), codes(noValuesArray));

// ── 7. personNeverSay: >=3 rules, OR the exact "none" sentinel ──────────
console.log('── personNeverSay: at least three rules, or the explicit "none" sentinel ──');
const tooFewNeverSay = validateTeacherSheet(withField({ personNeverSay: ["give medical advice"] }));
ok("only one never-say rule -> rejected", !tooFewNeverSay.ok && has(tooFewNeverSay, "person-never-say-too-few", "personNeverSay"), codes(tooFewNeverSay));
const noneSentinel = validateTeacherSheet(withField({ personNeverSay: [PERSON_NEVER_SAY_NONE] }));
ok('the exact ["none"] sentinel alone -> accepted (an explicit opt-out, not a missing field)', noneSentinel.ok, codes(noneSentinel));
const noneMixedIn = validateTeacherSheet(withField({ personNeverSay: [PERSON_NEVER_SAY_NONE, "give medical advice", "discuss salary", "predict exam results"] }));
ok(
  '"none" mixed in among real rules -> rejected (a decision, never a fourth free-text row)',
  !noneMixedIn.ok && has(noneMixedIn, "person-never-say-none-not-alone", "personNeverSay"),
  codes(noneMixedIn),
);
const emptyNeverSay = validateTeacherSheet(withField({ personNeverSay: [] }));
ok("empty personNeverSay -> rejected (missing, not an implicit 'none')", !emptyNeverSay.ok && has(emptyNeverSay, "person-never-say-missing", "personNeverSay"), codes(emptyNeverSay));

// ── 8. personTalk: register / script baseline enums ─────────────────────
console.log("── personTalk: register and script baseline must be one of the named values ──");
const missingTalk = validateTeacherSheet(withField({ personTalk: undefined }));
ok("missing personTalk -> rejected", !missingTalk.ok && has(missingTalk, "person-talk-missing", "personTalk"), codes(missingTalk));
const badRegister = validateTeacherSheet(withField({ personTalk: { register: "chill", scriptBaseline: "roman-hinglish" } }));
ok("an invalid register value -> rejected", !badRegister.ok && has(badRegister, "person-talk-register-invalid", "personTalk"), codes(badRegister));
const badScript = validateTeacherSheet(withField({ personTalk: { register: "mixed", scriptBaseline: "latin" } }));
ok("an invalid script baseline -> rejected", !badScript.ok && has(badScript, "person-talk-script-invalid", "personTalk"), codes(badScript));
const talkNoNote = validateTeacherSheet(withField({ personTalk: { register: "formal", scriptBaseline: "english" } }));
ok("personTalk with no codeSwitchNote at all -> accepted (optional, per the type)", talkNoNote.ok, codes(talkNoNote));

// ── 9. sheetToModule() on a person sheet: no throw, material carries the
//      five fields. WS-R151's own law 3 ("the platform-owned boundary and
//      stage unchanged") held until WS-R162, whose OWN law 3 closes half of
//      that gap: the boundary paragraph is now `personBoundaryFor(sheet.name)`
//      for sheetKind:"person", never the teacher-worded `PLATFORM_BOUNDARY`
//      (`context/rejected.md
//      #ws-r151-platform-boundary-and-stage-text-stays-teacher-worded-for-a-person-sheet`'s
//      own reversal condition, taken up here). The three stage paragraphs
//      are the OTHER half and remain untouched, still teacher-worded, for a
//      person sheet - that half of the gap stays open. ──────────────────
console.log("\n── sheetToModule() on a person sheet ──");
let builtPerson;
let threw = null;
try {
  builtPerson = sheetToModule(MINIMAL_PERSON);
} catch (error) {
  threw = error;
}
ok("sheetToModule does not throw on a minimal person sheet", !threw, threw ? String(threw) : "");
if (builtPerson) {
  const core = builtPerson.buildSystemPromptParts({ name: "a follower", vibe: [], facts: {} }, 5, "text").core;
  ok("compiled core carries the material block markers", core.includes(MATERIAL_BLOCK_OPEN) && core.includes(MATERIAL_BLOCK_CLOSE));
  const material = core.slice(core.indexOf(MATERIAL_BLOCK_OPEN), core.indexOf(MATERIAL_BLOCK_CLOSE));
  for (const [field, label] of [
    ["identityWho", "who"], ["identityLife", "life"], ["lifeTexture", "everyday texture"],
    ["tasteTopics", "taste"], ["curiosityTopics", "curiosity"],
  ]) {
    const contains = material.includes(MINIMAL_PERSON[field]);
    ok(`material block carries "${label}" (${field})`, contains, contains ? "" : material);
  }
  ok("CRISIS_LINES still carried through the constructor for a person sheet", builtPerson.CRISIS_LINES === MINIMAL_PERSON.crisisLines);
  ok("slug/displayName/personaVersion come off the person sheet", builtPerson.slug === MINIMAL_PERSON.slug &&
    builtPerson.displayName === MINIMAL_PERSON.name && builtPerson.personaVersion === MINIMAL_PERSON.version);

  // WS-R162 law 3: the compiled prompt carries a PERSON boundary, never the
  // teacher-worded one - the exact gap `context/STATE.md`'s own words named
  // ("a person's compiled prompt still says 'you are a teacher'").
  const expectedPersonBoundary = personBoundaryFor(MINIMAL_PERSON.name);
  ok("compiled core carries personBoundaryFor(sheet.name) verbatim", core.includes(expectedPersonBoundary));
  ok("compiled core never carries the teacher-worded PLATFORM_BOUNDARY", !core.includes(PLATFORM_BOUNDARY));
  ok('compiled core never says "you are a teacher" for a person sheet', !core.toLowerCase().includes("you are a teacher"));
  ok('the person boundary names the AI in the platform\'s own words ("<Name> AI, made by <Name>")',
    expectedPersonBoundary.includes(`${MINIMAL_PERSON.name} AI, made by ${MINIMAL_PERSON.name}`));
}

// The teacher path's own byte-identity proof lives in `evals/teachersheet.mjs`
// in depth; this is the negative control that the SAME compiler run on the
// SAME sheet with `sheetKind` toggled off produces the identical teacher
// output `evals/teachersheet.mjs` already measures — i.e. this file's own
// bundling and fixture cannot silently be exercising a stale path.
const teacherAgain = sheetToModule(DEMO_TEACHER);
const registered = M.getAgent("teacher-demo-arjun");
const teacherParts = teacherAgain.buildSystemPromptParts({ name: "a student", vibe: [], facts: {} }, 5, "text");
const registeredParts = registered.buildSystemPromptParts({ name: "a student", vibe: [], facts: {} }, 5, "text");
ok(
  "this suite's own bundle still reproduces the teacher byte-identity result (cross-check against evals/teachersheet.mjs)",
  teacherParts.core === registeredParts.core && teacherParts.tail === registeredParts.tail,
);
// WS-R162: the branch this workstream adds is `sheetKind === "person"` only
// - a TEACHER sheet (sheetKind absent, DEMO_TEACHER's own default) still
// compiles the teacher-worded PLATFORM_BOUNDARY, unchanged, never the new
// personBoundaryFor path.
ok("a TEACHER sheet's compiled core still carries the unchanged PLATFORM_BOUNDARY", teacherParts.core.includes(PLATFORM_BOUNDARY));

// ── 10. api/_room-publish.js::personDisclosureLine ──────────────────────
console.log("\n── personDisclosureLine (WS-R151 law 5) ──");
ok('null sheet -> ""', personDisclosureLine(null) === "");
ok('no sheet at all (undefined) -> ""', personDisclosureLine(undefined) === "");
ok('a TEACHER sheet -> "" (never reads personLine off a teacher sheet)', personDisclosureLine({ sheetKind: "teacher", personLine: "should never surface" }) === "");
ok('a sheet with no sheetKind at all -> "" (defaults to teacher, same as the validator)', personDisclosureLine({ personLine: "should never surface" }) === "");
ok(
  "a PERSON sheet -> the trimmed personLine",
  personDisclosureLine({ sheetKind: "person", personLine: `  ${MINIMAL_PERSON.personLine}  ` }) === MINIMAL_PERSON.personLine,
);
ok('a PERSON sheet with no personLine set -> ""', personDisclosureLine({ sheetKind: "person" }) === "");

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
