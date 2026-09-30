// WS-R178. HumanOS drafted from a person's own sources.
//
//   node evals/person-sheet-draft/run.mjs
//
// Offline, deterministic, $0, no DB. `api/_person-sheet-draft.js` is plain
// JS (no TypeScript), imported directly; `src/engine/agents/fromSheet.ts`'s
// `validateTeacherSheet`/`DEMO_TEACHER` are bundled from the REAL source on
// every run, `evals/person-sheet/run.mjs`'s own pattern, CLAUDE.md's reason:
// a frozen bundle passes forever while the source rots.
//
// ── what this suite is actually guarding ──────────────────────────────────
//
// 1. THE POSITIVE PROOF (brief law 4). Forty fixture "persons" — claims in
//    English, Hindi and Hinglish — each draft proposals that, once ALL of
//    them are accepted into a base sheet (the exact merge `HumanOsStudio.
//    tsx`'s own `acceptProposal` performs, mirrored below as
//    `applyProposal`), produce a sheet `validateTeacherSheet` accepts.
//
// 2. THREE NEGATIVE CONTROLS, named in the brief:
//      a. a claim without a citation never drafts a line;
//      b. a rejected claim never appears;
//      c. a person with nothing given gets an honest empty draft (zero
//         proposals, every tracked field gapped, never an exception).
//
// 3. THE SHAPE RULES the drafter itself is responsible for: personValues
//    never exceeds its 7-item cap even when more are eligible; personNeverSay
//    never proposes fewer than its 3-item minimum (a gap instead, never a
//    partial fill); the "none" sentinel is NEVER auto-proposed (a person's
//    own explicit opt-out, never inferred); an unrecognized register/script
//    value gaps rather than guesses; determinism (same claims in, byte-
//    identical proposals out).
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..");

const { draftPersonSheetFromClaims, PERSON_SHEET_DRAFT_FIELDS } = await import(
  pathToFileURL(join(REPO, "api/_person-sheet-draft.js")).href
);

const OUT = mkdtempSync(join(tmpdir(), "person-sheet-draft-"));
const ENTRY = join(OUT, "entry.ts");
writeFileSync(
  ENTRY,
  `export { validateTeacherSheet } from ${JSON.stringify(join(REPO, "src/engine/agents/fromSheet"))};\n` +
    `export { DEMO_TEACHER } from ${JSON.stringify(join(REPO, "src/engine/agents/characters/demoTeacher"))};\n`,
);
const BUNDLE = join(OUT, "person-sheet-draft.bundle.mjs");
execSync(
  `npx esbuild ${ENTRY} --bundle --format=esm --platform=node --outfile=${BUNDLE} --log-level=error ` +
    `--alias:@capacitor/core=${join(REPO, "evals/stubs/capacitor.mjs")}`,
  { cwd: REPO, stdio: "inherit" },
);
const { validateTeacherSheet, DEMO_TEACHER } = await import(pathToFileURL(BUNDLE).href);

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
};
const codes = (result) => result.errors.map((e) => `${e.field}:${e.code}`).join(", ");

// ─────────────────────────────────────────────────────────────────────────
// Fixture claims: a small, deterministic phrase pool per language, cycled
// by person index rather than 40 x N hand-typed distinct phrases — the
// mechanical behavior under test does not depend on narrative variety, only
// on domain/key/decision/citation shape.
// ─────────────────────────────────────────────────────────────────────────
const POOLS = {
  en: {
    home: ["grew up in a small coastal town", "spent childhood between two cities", "has lived near the same market for years", "moved out of the family home at twenty"],
    culture: ["loves quiet festivals over big ones", "keeps a small home altar with fresh flowers", "prefers small gatherings to big parties", "follows regional cinema closely"],
    pronouns: ["she/her", "he/him", "they/them"],
    biography: ["moved cities twice for work", "spends weekends reading in cafes", "took a year off to travel solo", "switched careers after ten years"],
    habit: ["jokes to defuse tension", "talks fast when excited", "goes quiet before a hard conversation", "softens bad news with a joke first"],
    taste: ["cricket commentary on weekends", "old film soundtracks", "strategy board games", "street food reviews", "vintage motorcycles"],
    curiosity: ["how bus routes get named", "old city maps", "why certain words survive in slang", "how street food carts pick their spots"],
    value: ["curiosity", "directness", "showing up on time", "no drama", "quiet consistency", "generosity", "patience"],
    boundary: ["give medical advice", "discuss her salary", "predict exam results", "share other people's secrets", "take sides in family disputes"],
    codeSwitch: ["switches to Hindi when excited", "drops into English for work talk", "mixes languages with close friends only"],
  },
  hi: {
    home: ["छोटे तटीय शहर में पली बढ़ी", "दो शहरों के बीच बचपन बीता", "सालों से उसी बाज़ार के पास रहती है", "बीस की उम्र में घर से अलग हुई"],
    culture: ["बड़े जश्न से ज़्यादा शांत त्योहार पसंद", "घर में छोटा मंदिर ताज़े फूलों के साथ", "बड़ी पार्टी से छोटी मुलाक़ात पसंद", "क्षेत्रीय सिनेमा को क़रीब से देखती है"],
    pronouns: ["वह/उसकी", "वह/उसका", "वे/उनकी"],
    biography: ["काम के लिए दो बार शहर बदला", "सप्ताहांत में कैफे में पढ़ना पसंद", "एक साल यात्रा के लिए निकली", "दस साल बाद करियर बदला"],
    habit: ["तनाव कम करने के लिए मज़ाक करती है", "उत्साहित होने पर तेज़ बोलती है", "मुश्किल बात से पहले चुप हो जाती है", "बुरी ख़बर मज़ाक के साथ देती है"],
    taste: ["सप्ताहांत में क्रिकेट कमेंट्री", "पुराने फिल्मी गाने", "रणनीति वाले बोर्ड गेम", "स्ट्रीट फूड समीक्षा", "पुरानी मोटरसाइकिलें"],
    curiosity: ["बस रूट के नाम कैसे पड़ते हैं", "पुराने शहर के नक्शे", "स्लैंग के शब्द क्यों टिकते हैं", "स्ट्रीट फूड ठेले जगह कैसे चुनते हैं"],
    value: ["जिज्ञासा", "स्पष्टता", "समय पर आना", "नाटक नहीं", "शांत निरंतरता", "उदारता", "धैर्य"],
    boundary: ["मेडिकल सलाह नहीं देती", "सैलरी पर बात नहीं करती", "परीक्षा परिणाम की भविष्यवाणी नहीं", "दूसरों के राज़ नहीं बांटती", "पारिवारिक झगड़ों में पक्ष नहीं लेती"],
    codeSwitch: ["उत्साहित होने पर हिंदी में बदलती है", "काम की बात अंग्रेज़ी में करती है", "क़रीबी दोस्तों के साथ भाषाएं मिलाती है"],
  },
  hinglish: {
    home: ["chhote coastal town mein badi hui", "do shehron ke beech bachpan beeta", "market ke paas hi saalon se rehti hai", "twenty ki age mein ghar se alag hui"],
    culture: ["bade jashn se zyada shaant tyohaar pasand", "ghar mein chhota mandir fresh phoolon ke saath", "badi party se chhoti mulaqat pasand", "regional cinema closely follow karti hai"],
    pronouns: ["she/her", "he/him", "they/them"],
    biography: ["kaam ke liye do baar shehar badla", "weekends mein cafe mein padhna pasand", "ek saal travel ke liye nikli", "das saal baad career badla"],
    habit: ["tension kam karne ke liye joke karti hai", "excited hone par fast bolti hai", "mushkil baat se pehle quiet ho jaati hai", "buri news joke ke saath deti hai"],
    taste: ["weekend cricket commentary", "purane film songs", "strategy board games", "street food reviews", "purani motorcycles"],
    curiosity: ["bus routes ke naam kaise padte hain", "purane shehar ke naksha", "slang ke words kyun tikte hain", "street food thele jagah kaise choose karte hain"],
    value: ["curiosity", "directness", "time pe aana", "no drama", "quiet consistency", "generosity", "patience"],
    boundary: ["medical advice nahi deti", "salary pe baat nahi karti", "exam result ki bhavishyavani nahi", "dusron ke secrets nahi bataati", "family disputes mein side nahi leti"],
    codeSwitch: ["excited hone par Hindi mein switch karti hai", "kaam ki baat English mein karti hai", "close friends ke saath languages mix karti hai"],
  },
};

const LANGS = ["en", "hi", "hinglish"];
const REGISTERS = ["formal", "mixed", "casual"];
const SCRIPTS = ["english", "devanagari", "hinglish"];

function pick(pool, index) {
  return pool[index % pool.length];
}

let claimCounter = 0;
function claim({ domain, key, body, decision = "accepted", status = "approved", cited = true }) {
  claimCounter++;
  return {
    claim_id: String(claimCounter),
    domain, key, body,
    origin: "imported",
    confidence: 0.85,
    status,
    sensitive: false,
    source_count: cited ? 1 : 0,
    citation_previews: cited ? [{ excerpt: body.slice(0, 60), entailment: 0.9 }] : [],
    decision,
    reason_code: decision === "accepted" ? "accurate" : decision === "rejected" ? "inaccurate" : "",
    reviewed_at: decision ? "2026-09-13T00:00:00.000Z" : null,
    created_at: "2026-09-01T00:00:00.000Z",
  };
}

/** A realistic set of accepted, cited claims for person `i` in language
 *  `lang` — enough for every drafted field to clear its own minimum. */
function personClaims(i, lang) {
  const p = POOLS[lang];
  const out = [
    claim({ domain: "identity", key: "pronouns", body: pick(p.pronouns, i) }),
    claim({ domain: "identity", key: "home", body: pick(p.home, i) }),
    claim({ domain: "identity", key: "culture", body: pick(p.culture, i + 1) }),
    claim({ domain: "biography", key: "life_event", body: pick(p.biography, i) }),
    claim({ domain: "biography", key: "life_event", body: pick(p.biography, i + 2) }),
    claim({ domain: "habit", key: "humor", body: pick(p.habit, i) }),
    claim({ domain: "delivery", key: "pacing", body: pick(p.habit, i + 1) }),
    claim({ domain: "language", key: "register", body: pick(REGISTERS, i) }),
    claim({ domain: "language", key: "script", body: pick(SCRIPTS, i) }),
    claim({ domain: "language", key: "code_switching", body: pick(p.codeSwitch, i) }),
  ];
  for (let k = 0; k < 4; k++) out.push(claim({ domain: "knowledge", key: `taste_${k}`, body: pick(p.taste, i + k) }));
  for (let k = 0; k < 2; k++) out.push(claim({ domain: "knowledge", key: `curiosity_${k}`, body: pick(p.curiosity, i + k) }));
  for (let k = 0; k < 4; k++) out.push(claim({ domain: "value", key: "value", body: pick(p.value, i + k) }));
  for (let k = 0; k < 3; k++) out.push(claim({ domain: "boundary", key: "never_say", body: pick(p.boundary, i + k) }));
  return out;
}

function baseSheet(name) {
  return {
    ...DEMO_TEACHER,
    sheetKind: "person",
    slug: `person-fixture-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name,
    version: "person-fixture-draft",
    identityWho: "", identityLife: "", lifeTexture: "", tasteTopics: "", curiosityTopics: "",
    personLine: `${name}. Drafted from what they gave.`,
    personValues: [], personNeverSay: [],
    personTalk: { register: "mixed", scriptBaseline: "roman-hinglish", codeSwitchNote: "" },
    subjectStrands: [], examTrack: [], doubtEscalationLadder: [], rigorFloor: [],
    boardVerbalisms: [], commonMistakeBank: [], analogyBank: [],
    syllabusScope: "", outOfScopePolicy: "", technicalTermRule: "",
    explanationOrder: "", workedExamplePattern: "", firstMoveOnDoubt: "",
    notationConventions: "", credentialFacts: "",
    boundaryParagraph: "", stageEarly: "", stageGettingClose: "", stageEstablished: "",
    ritualPatternShapes: "", abilityLabelBan: "", winMethodRule: "",
    life: { ...DEMO_TEACHER.life, weekdayShape: [], weekendShape: [], weeklyRhythm: [], preoccupations: [] },
    cloneDisclosureFact: DEMO_TEACHER.cloneDisclosureFact.replaceAll("Arjun Sir", name),
    academicIntegrityStance: "",
    voiceCloneId: null,
  };
}

/** Mirrors `HumanOsStudio.tsx`'s own `acceptProposal` merge rules exactly —
 *  this suite proves the SAME behavior the studio performs, not a second,
 *  divergent one. */
function applyProposal(sheet, proposal) {
  if (proposal.field === "personValues") {
    if ((sheet.personValues ?? []).length >= 7) return sheet;
    return { ...sheet, personValues: [...(sheet.personValues ?? []), proposal.value] };
  }
  if (proposal.field === "personNeverSay") {
    return { ...sheet, personNeverSay: [...(sheet.personNeverSay ?? []), proposal.value] };
  }
  if (proposal.field === "personTalk.register") {
    return { ...sheet, personTalk: { ...sheet.personTalk, register: proposal.value } };
  }
  if (proposal.field === "personTalk.scriptBaseline") {
    return { ...sheet, personTalk: { ...sheet.personTalk, scriptBaseline: proposal.value } };
  }
  if (proposal.field === "personTalk.codeSwitchNote") {
    return { ...sheet, personTalk: { ...sheet.personTalk, codeSwitchNote: proposal.value } };
  }
  return { ...sheet, [proposal.field]: proposal.value };
}

// ── 1. the positive proof: 40 fixture persons, three languages ─────────
console.log("\n── 40 fixture persons draft to sheets that pass the person validator ──");
let allDraftedOk = true;
for (let i = 0; i < 40; i++) {
  const lang = LANGS[i % LANGS.length];
  const name = `Fixture Person ${i}`;
  const claims = personClaims(i, lang);
  const result = draftPersonSheetFromClaims(claims);
  let sheet = baseSheet(name);
  for (const proposal of result.proposals) sheet = applyProposal(sheet, proposal);
  const verdict = validateTeacherSheet(sheet);
  if (!verdict.ok) {
    allDraftedOk = false;
    console.log(`  FAIL fixture ${i} (${lang}): ${codes(verdict)}`);
  }
}
ok("all 40 fixture persons (English, Hindi, Hinglish) draft to a sheet that passes validateTeacherSheet", allDraftedOk);

// A second pass over the SAME 40, confirming every proposal actually carries
// a citation (law 1) and that the field set drafted plus gapped covers
// every tracked field exactly once (never both, never neither).
let citationsAlwaysPresent = true;
let fieldCoverageOk = true;
for (let i = 0; i < 40; i++) {
  const lang = LANGS[i % LANGS.length];
  const result = draftPersonSheetFromClaims(personClaims(i, lang));
  if (result.proposals.some((p) => !p.citations.length)) citationsAlwaysPresent = false;
  const proposedFields = new Set(result.proposals.map((p) => p.field));
  const gappedFields = new Set(result.gaps.map((g) => g.field));
  for (const field of PERSON_SHEET_DRAFT_FIELDS) {
    const isMulti = field === "personValues" || field === "personNeverSay";
    const inProposals = proposedFields.has(field);
    const inGaps = gappedFields.has(field);
    if (isMulti) { if (inProposals === inGaps) fieldCoverageOk = false; continue; }
    if (inProposals === inGaps) fieldCoverageOk = false;
  }
}
ok("every proposal across all 40 fixtures carries at least one citation", citationsAlwaysPresent);
ok("every tracked field is drafted XOR gapped for every fixture, never both, never neither", fieldCoverageOk);

// ── 2a. NEGATIVE CONTROL: a claim without a citation never drafts a line ──
console.log("\n── NEGATIVE CONTROL: a claim without a citation never drafts a line ──");
const uncited = [
  claim({ domain: "value", key: "value", body: "curiosity", cited: false }),
  claim({ domain: "value", key: "value", body: "directness", cited: false }),
  claim({ domain: "value", key: "value", body: "showing up on time", cited: false }),
];
const uncitedResult = draftPersonSheetFromClaims(uncited);
ok(
  "three accepted but UNCITED value claims produce zero personValues proposals",
  uncitedResult.proposals.filter((p) => p.field === "personValues").length === 0,
  JSON.stringify(uncitedResult.proposals),
);
ok(
  "personValues is gapped instead, with an honest reason",
  uncitedResult.gaps.some((g) => g.field === "personValues"),
);

// A MIX of cited and uncited claims for the same field: only the cited ones
// may surface.
const mixed = [
  claim({ domain: "value", key: "value", body: "curiosity", cited: true }),
  claim({ domain: "value", key: "value", body: "directness", cited: true }),
  claim({ domain: "value", key: "value", body: "generosity", cited: true }),
  claim({ domain: "value", key: "value", body: "an uncited value", cited: false }),
];
const mixedResult = draftPersonSheetFromClaims(mixed);
ok(
  "a mix of cited and uncited value claims: only the cited three draft, the uncited one never appears",
  mixedResult.proposals.filter((p) => p.field === "personValues").length === 3
    && !mixedResult.proposals.some((p) => p.value === "an uncited value"),
  JSON.stringify(mixedResult.proposals),
);

// ── 2b. NEGATIVE CONTROL: a rejected claim never appears ────────────────
console.log("\n── NEGATIVE CONTROL: a rejected claim never appears ──");
const rejected = [
  claim({ domain: "value", key: "value", body: "curiosity", decision: "rejected" }),
  claim({ domain: "value", key: "value", body: "directness", decision: "rejected" }),
  claim({ domain: "value", key: "value", body: "generosity", decision: "rejected" }),
  claim({ domain: "value", key: "value", body: "patience", decision: null }),
];
const rejectedResult = draftPersonSheetFromClaims(rejected);
ok(
  "three REJECTED and one UNDECIDED value claim draft zero personValues proposals",
  rejectedResult.proposals.filter((p) => p.field === "personValues").length === 0,
  JSON.stringify(rejectedResult.proposals),
);

// ── 2c. NEGATIVE CONTROL: a person with nothing given gets an honest
//        empty draft ─────────────────────────────────────────────────────
console.log("\n── NEGATIVE CONTROL: a person with nothing given gets an honest empty draft ──");
let threw = null;
let emptyResult;
try {
  emptyResult = draftPersonSheetFromClaims([]);
} catch (cause) {
  threw = cause;
}
ok("draftPersonSheetFromClaims([]) never throws", !threw, threw ? String(threw) : "");
if (emptyResult) {
  ok("zero proposals", emptyResult.proposals.length === 0, JSON.stringify(emptyResult.proposals));
  ok(
    "every tracked field is gapped",
    PERSON_SHEET_DRAFT_FIELDS.every((field) => emptyResult.gaps.some((g) => g.field === field)),
    emptyResult.gaps.map((g) => g.field).join(", "),
  );
  ok("acceptedClaimCount is 0", emptyResult.acceptedClaimCount === 0);
}
// Also: undefined/null/non-array input never throws, same honest empty shape.
for (const input of [undefined, null, "not an array", 42]) {
  let inputThrew = null;
  let r;
  try { r = draftPersonSheetFromClaims(input); } catch (cause) { inputThrew = cause; }
  ok(`draftPersonSheetFromClaims(${JSON.stringify(input)}) never throws`, !inputThrew, inputThrew ? String(inputThrew) : "");
  if (r) ok(`  ...and returns zero proposals`, r.proposals.length === 0);
}

// ── 3. shape rules the drafter itself owns ───────────────────────────────
console.log("\n── personValues never exceeds its 7-item cap ──");
const tenValues = Array.from({ length: 10 }, (_, k) => claim({ domain: "value", key: "value", body: `value ${k}` }));
const cappedResult = draftPersonSheetFromClaims(tenValues);
ok(
  "10 eligible value claims draft at most 7 personValues proposals",
  cappedResult.proposals.filter((p) => p.field === "personValues").length === 7,
  String(cappedResult.proposals.filter((p) => p.field === "personValues").length),
);

console.log("\n── personNeverSay: fewer than 3 draftable lines is a gap, never a partial fill ──");
const twoBoundaries = [
  claim({ domain: "boundary", key: "never_say", body: "give medical advice" }),
  claim({ domain: "boundary", key: "never_say", body: "discuss her salary" }),
];
const fewBoundariesResult = draftPersonSheetFromClaims(twoBoundaries);
ok(
  "two eligible boundary claims: zero personNeverSay proposals (below the minimum of 3)",
  fewBoundariesResult.proposals.filter((p) => p.field === "personNeverSay").length === 0,
);
ok("personNeverSay is gapped as insufficient-accepted-claims", fewBoundariesResult.gaps.some((g) => g.field === "personNeverSay" && g.reason === "insufficient-accepted-claims"));
ok(
  "the drafter NEVER auto-proposes the \"none\" sentinel for personNeverSay",
  !fewBoundariesResult.proposals.some((p) => p.field === "personNeverSay" && p.value === "none")
    && ![...Array(40).keys()].some((i) => draftPersonSheetFromClaims(personClaims(i, LANGS[i % LANGS.length])).proposals.some((p) => p.field === "personNeverSay" && p.value === "none")),
);

console.log("\n── personTalk.register / scriptBaseline: recognized aliases draft, unrecognized ones gap ──");
const registerOk = draftPersonSheetFromClaims([claim({ domain: "language", key: "register", body: "Casual" })]);
ok('a "Casual" register claim normalizes to the enum value "casual"', registerOk.proposals.find((p) => p.field === "personTalk.register")?.value === "casual", JSON.stringify(registerOk.proposals));
const registerUnrecognized = draftPersonSheetFromClaims([claim({ domain: "language", key: "register", body: "chill" })]);
ok(
  'an unrecognized register value ("chill") gaps instead of guessing',
  !registerUnrecognized.proposals.some((p) => p.field === "personTalk.register")
    && registerUnrecognized.gaps.some((g) => g.field === "personTalk.register" && g.reason === "unrecognized-value"),
);
const scriptOk = draftPersonSheetFromClaims([claim({ domain: "language", key: "script", body: "Hinglish" })]);
ok('a "Hinglish" script claim normalizes to "roman-hinglish"', scriptOk.proposals.find((p) => p.field === "personTalk.scriptBaseline")?.value === "roman-hinglish", JSON.stringify(scriptOk.proposals));

console.log("\n── determinism: the same claims draft byte-identical proposals ──");
const claimsForDeterminism = personClaims(7, "hinglish");
const firstRun = JSON.stringify(draftPersonSheetFromClaims(claimsForDeterminism));
const secondRun = JSON.stringify(draftPersonSheetFromClaims(claimsForDeterminism));
ok("two calls on the same claims produce byte-identical JSON", firstRun === secondRun);

console.log("\n── never a line the AI could say: no proposed value is sentence-shaped or first-person ──");
const SENTENCE_SHAPED_RE = /^[A-Z][^.?!]*[.?!]$/;
const FIRST_PERSON_RE = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;
let noRecitableLines = true;
for (let i = 0; i < 40; i++) {
  const lang = LANGS[i % LANGS.length];
  const result = draftPersonSheetFromClaims(personClaims(i, lang));
  for (const p of result.proposals) {
    if (typeof p.value !== "string") continue;
    if (SENTENCE_SHAPED_RE.test(p.value) || FIRST_PERSON_RE.test(p.value)) {
      noRecitableLines = false;
      console.log(`  FAIL fixture ${i} (${lang}) field ${p.field}: "${p.value}"`);
    }
  }
}
ok("no proposed value across all 40 fixtures is sentence-shaped or opens in first person", noRecitableLines);

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
