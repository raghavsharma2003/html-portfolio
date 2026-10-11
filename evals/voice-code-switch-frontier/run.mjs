import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildVoiceTextPlan,
  HINDI_PRONUNCIATION_LEXICON_CONTRACT,
} from "../../api/_voice/hindi-text-frontend.js";
import { DEFAULT_VOICE_PREVIEW_STYLE, voicePreviewStyle } from "../../api/_replica-voice-preview.js";
import {
  prolongedWordIndexes,
  LANGUAGE_SPAN_CONTRACT,
  prosodyFeatureSummary,
  scoreSwitchAdjacentErrors,
  switchBoundaryGapMeasurements,
} from "./quality-metrics.mjs";

let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed += 1;
  process.stdout.write(`  PASS ${name}\n`);
}

const corpusDocument = JSON.parse(readFileSync(
  join(process.cwd(), "evals/voice-code-switch-frontier/corpus.v2.json"), "utf8",
));
assert.equal(corpusDocument.contract, "vyakti-voice-code-switch-corpus/v2");
const corpus = Object.freeze(corpusDocument.prompts.map((prompt) => Object.freeze(prompt)));
assert.equal(new Set(corpus.map((prompt) => prompt.id)).size, corpus.length, "duplicate corpus id");

for (const { id: key, text, languageId } of corpus) {
  const first = buildVoiceTextPlan({ text, languageId });
  const second = buildVoiceTextPlan({ text, languageId });
  assert.equal(first.synthesisSegments.length, 1, `${key} acoustic fan-out`);
  assert.equal(first.synthesisSegments[0].languageId, languageId, `${key} primary language`);
  assert.equal(first.synthesisSegments[0].text, first.targetText, `${key} rendered text`);
  assert.equal(first.synthesisSegments[0].semanticIndexes.length, first.semanticSegments.length, `${key} semantic coverage`);
  assert.equal(first.synthesisStrategy, "single_continuous_utterance", `${key} strategy`);
  assert.equal(first.pronunciationLexicon, HINDI_PRONUNCIATION_LEXICON_CONTRACT, `${key} pronunciation contract`);
  assert.equal(first.planSha256, second.planSha256, `${key} determinism`);
  let previousEnd = -1;
  for (const transformation of first.transformations) {
    assert.equal(text.slice(transformation.sourceStartUtf16, transformation.sourceEndUtf16), transformation.source,
      `${key} transformation source`);
    assert.ok(transformation.sourceStartUtf16 >= previousEnd, `${key} overlapping transformation`);
    previousEnd = transformation.sourceEndUtf16;
  }
  for (const unresolved of first.unresolvedLatin) {
    assert.equal(text.slice(unresolved.sourceStartUtf16, unresolved.sourceEndUtf16), unresolved.source,
      `${key} unresolved source`);
    assert.ok(!first.transformations.some((item) => item.sourceStartUtf16 === unresolved.sourceStartUtf16),
      `${key} unresolved token was also transformed`);
  }
}
ok(`${corpus.length} adversarial voice prompts cannot fan out at a language boundary`, true);

const plans = corpus.map(({ text, languageId }) => buildVoiceTextPlan({ text, languageId }));
const coveredRisks = new Set(corpus.flatMap((prompt) => prompt.risks));
ok("the corpus covers Roman, mixed-script, technical, confusable, question, repair, proper-name and emphasis cases",
  new Set(plans.map((plan) => plan.planSha256)).size === corpus.length &&
  plans.some((plan) => plan.semanticSegments.some((segment) => segment.languageId === "en")) &&
  plans.some((plan) => plan.transformations.length >= 5) &&
  ["roman_hindi", "mixed_script", "dense_switch", "english_confusable", "proper_name", "question", "repair", "emphasis"]
    .every((risk) => coveredRisks.has(risk)));

const technical = buildVoiceTextPlan({ text: corpus.find(({ id }) => id === "technical-initialisms").text, languageId: "hi" });
ok("curated initialisms are committed as deterministic orthography transformations",
  ["एआई", "आरएलएचएफ", "जीपीयू", "एपीआई", "टीटीएस", "एसटीटी"].every((token) => technical.targetText.includes(token)) &&
  technical.transformations.filter((item) => item.kind === "reviewed_hindi_borrowing").length >= 6);

const exams = buildVoiceTextPlan({ text: corpus.find(({ id }) => id === "exam-acronyms").text, languageId: "hi" });
ok("curated exam initialisms are rendered with deterministic Indian-script targets",
  exams.targetText.includes("एनसीईआरटी") && exams.targetText.includes("जेईई") && exams.targetText.includes("नीट") &&
  exams.transformations.some((item) => item.kind === "reviewed_hindi_borrowing" && item.source === "JEE"));

const savedFailure = buildVoiceTextPlan({
  text: corpus.find(({ id }) => id === "saved-owner-failure-shape").text,
  languageId: "hi",
});
ok("the saved owner failure shape has a complete curated Hindi orthography plan",
  ["आज", "हम", "इस", "कॉन्सेप्ट", "सिंपल", "एग्ज़ाम्पल", "साथ", "समझेंगे", "आंसर", "चेक", "करेंगे"]
    .every((word) => savedFailure.targetText.includes(word)) && savedFailure.unresolvedLatin.length === 0);

const ownerLong = buildVoiceTextPlan({
  text: `${corpus.find(({ id }) => id === "owner-long-rlhf").text} ${corpus.find(({ id }) => id === "owner-indian-languages").text}`,
  languageId: "hi",
});
ok("the reported long owner paragraph no longer sends raw English words through Hindi phonetics",
  ownerLong.unresolvedLatin.length === 0 &&
  ["इंडिया", "आरएलएचएफ", "फ़्यूचर", "प्रॉमिसिंग", "लैंग्वेजेज़", "ह्यूमन", "फ़ीडबैक", "भारत", "इंग्लिश", "हिंदी"]
    .every((word) => ownerLong.targetText.includes(word)));

const unknownUppercase = buildVoiceTextPlan({
  text: corpus.find(({ id }) => id === "unknown-uppercase").text,
  languageId: "hi",
});
ok("unknown uppercase names stay exact instead of receiving guessed letter spelling",
  unknownUppercase.unresolvedLatin.some((item) => item.source === "QZXV") &&
  !unknownUppercase.transformations.some((item) => item.source === "QZXV"));

const contextualIs = buildVoiceTextPlan({ text: "Hum is app ko test karenge.", languageId: "hi" });
const contextualIsPe = buildVoiceTextPlan({ text: "Hum is app pe test karenge.", languageId: "hi" });
const englishIs = buildVoiceTextPlan({ text: "This is correct, aur result sahi hai.", languageId: "hi" });
ok("the bounded `is` context fixes Hindi grammar without rewriting the English confusable",
  contextualIs.transformations.some((item) => item.source === "is" && item.target === "इस") &&
  contextualIsPe.transformations.some((item) => item.source === "is" && item.target === "इस") &&
  englishIs.unresolvedLatin.some((item) => item.source === "is") &&
  !englishIs.transformations.some((item) => item.source === "is"));

for (const [risk, punctuation] of [["question", "?"], ["exclamation", "!"], ["semicolon", ";"]]) {
  for (const prompt of corpus.filter((item) => item.risks.includes(risk))) {
    const plan = buildVoiceTextPlan({ text: prompt.text, languageId: prompt.languageId });
    assert.equal([...plan.targetText].filter((character) => character === punctuation).length,
      [...prompt.text].filter((character) => character === punctuation).length,
      `${prompt.id} ${risk} punctuation drift`);
  }
}
ok("question, exclamation and phrase-boundary punctuation survive pronunciation planning", true);

for (const [prompt, plan] of corpus.map((item, index) => [item, plans[index]])) {
  if (prompt.languageId === "en") {
    assert.equal(plan.transformations.length, 0, `${prompt.id} English transform`);
    assert.equal(plan.unresolvedLatin.length, 0, `${prompt.id} English unresolved`);
  } else if (plan.unresolvedLatin.length) {
    assert.ok(plan.warnings.includes("native_code_switch_pronunciation_unqualified"),
      `${prompt.id} unresolved code switch hidden`);
  }
}
ok("every unresolved Hindi-lane switch is explicit while English controls remain byte-identical", true);

const cleanSwitch = scoreSwitchAdjacentErrors("आज हम voice test करेंगे", "आज हम voice test करेंगे");
const brokenSwitch = scoreSwitchAdjacentErrors("आज hum voice test करेंगे", "आज hum noise test करेंगे");
const repeatedSwitch = scoreSwitchAdjacentErrors("आज hum voice test करेंगे", "आज hum hum voice test करेंगे");
ok("the scorer isolates switch-adjacent errors instead of hiding them inside whole-utterance WER",
  cleanSwitch.wordErrorRate === 0 && cleanSwitch.switchAdjacentWordErrorRate === 0 &&
  brokenSwitch.errorCount === 1 && brokenSwitch.switchAdjacentErrorCount === 1 &&
  brokenSwitch.switchAdjacentWordErrorRate > 0);
ok("the scorer separately catches repeated switch words",
  repeatedSwitch.repeatedInsertionCount === 1 && repeatedSwitch.errorCount === 1);

const romanReference = "Aaj hum voice test karenge";
const romanAnnotation = {
  contract: LANGUAGE_SPAN_CONTRACT,
  referenceText: romanReference,
  reviewedBy: "deterministic-fixture-author",
  spans: [
    { startToken: 0, endToken: 2, language: "hi" },
    { startToken: 2, endToken: 4, language: "en" },
    { startToken: 4, endToken: 5, language: "hi" },
  ],
};
const romanFallback = scoreSwitchAdjacentErrors(romanReference, "Aaj hum noise test karenge");
const romanScored = scoreSwitchAdjacentErrors(romanReference, "Aaj hum noise test karenge", 1,
  { languageAnnotation: romanAnnotation });
ok("reviewed Roman Hinglish spans expose switches invisible to the labeled script fallback",
  romanFallback.languageBoundaryMethod === "script_heuristic" &&
  romanFallback.switchAdjacentWordErrorRate === null &&
  romanScored.languageBoundaryMethod === "reviewed_language_spans" &&
  romanScored.switchAdjacentTokenCount === 4 && romanScored.switchAdjacentErrorCount === 1 &&
  romanScored.switchAdjacentWordErrorRate === 0.25 &&
  romanScored.languageAnnotationReviewer === romanAnnotation.reviewedBy);
const outsideSwitch = scoreSwitchAdjacentErrors(romanReference, "Kal hum voice test karenge", 1,
  { languageAnnotation: romanAnnotation });
ok("Roman span scoring keeps an error outside the chosen boundary radius out of switch errors",
  outsideSwitch.errorCount === 1 && outsideSwitch.switchAdjacentErrorCount === 0);
for (const invalid of [
  null,
  { ...romanAnnotation, referenceText: `${romanReference}!` },
  { ...romanAnnotation, reviewedBy: " " },
  { ...romanAnnotation, contract: "unversioned" },
  { ...romanAnnotation, spans: romanAnnotation.spans.slice(0, 2) },
  { ...romanAnnotation, spans: [{ startToken: 1, endToken: 5, language: "hi" }] },
  { ...romanAnnotation, spans: [{ startToken: 0, endToken: 6, language: "hi" }] },
  { ...romanAnnotation, spans: [{ startToken: 0, endToken: 5, language: "guessed" }] },
  { ...romanAnnotation, spans: [{ startToken: 0, endToken: 2, language: "hi" },
    { startToken: 1, endToken: 5, language: "en" }] },
  { ...romanAnnotation, spans: [{ startToken: 0, endToken: 0, language: "hi" }] },
]) {
  assert.throws(() => scoreSwitchAdjacentErrors(romanReference, romanReference, 2,
    { languageAnnotation: invalid }), /voice_language_spans_invalid/);
}
ok("ten malformed, stale, incomplete or overlapping annotations refuse instead of fabricating a score", true);
ok("existing mixed-script scoring retains its numerical behavior and declares its heuristic",
  cleanSwitch.languageBoundaryMethod === "script_heuristic" &&
  cleanSwitch.languageAnnotationReviewer === null && cleanSwitch.switchAdjacentTokenCount === 5 &&
  brokenSwitch.switchAdjacentWordErrorRate === 0.2);

const ordinaryTiming = [
  { text: "आज", startMs: 0, endMs: 180 },
  { text: "hum", startMs: 190, endMs: 430 },
  { text: "voice", startMs: 440, endMs: 760 },
  { text: "test", startMs: 770, endMs: 1010 },
  { text: "करेंगे", startMs: 1020, endMs: 1400 },
];
const draggedTiming = ordinaryTiming.map((word, index) => index === 2 ? { ...word, endMs: 2_800 } : word);
ok("word-timing diagnostics flag an abnormal drag without labelling ordinary timing",
  prolongedWordIndexes(ordinaryTiming).length === 0 && prolongedWordIndexes(draggedTiming).includes(2));

const smoothBoundaryTiming = [
  { text: "आज", startMs: 0, endMs: 180 },
  { text: "hum", startMs: 210, endMs: 420 },
  { text: "voice", startMs: 450, endMs: 720 },
  { text: "test", startMs: 750, endMs: 960 },
  { text: "करेंगे", startMs: 990, endMs: 1_350 },
];
const brokenBoundaryTiming = smoothBoundaryTiming.map((word, index) => index < 4
  ? word
  : { ...word, startMs: 1_560, endMs: 1_920 });
const smoothBoundary = switchBoundaryGapMeasurements(smoothBoundaryTiming);
const brokenBoundary = switchBoundaryGapMeasurements(brokenBoundaryTiming);
ok("timing diagnostics expose a synthetic pause injected exactly at a script switch",
  smoothBoundary.boundaries.every((boundary) => boundary.excessOverMedianMs === 0) &&
  brokenBoundary.boundaries.some((boundary) => boundary.gapMs === 600 && boundary.excessOverMedianMs === 570));

const flatProsody = smoothBoundaryTiming.map((word) => ({ ...word, pitchHz: 150, energyDb: -22 }));
const expressiveProsody = flatProsody.map((word, index) => index === 2
  ? { ...word, endMs: word.endMs + 160, pitchHz: 190, energyDb: -17 }
  : index === 4 ? { ...word, pitchHz: 180 } : word);
const flatFeatures = prosodyFeatureSummary(flatProsody, { emphasisIndexes: [2] });
const expressiveFeatures = prosodyFeatureSummary(expressiveProsody, { emphasisIndexes: [2] });
ok("prosody fixtures preserve measurable pitch, energy, duration and final-rise evidence without inventing a quality threshold",
  flatFeatures.pitchRangeSemitones === 0 && flatFeatures.energyRangeDb === 0 &&
  expressiveFeatures.pitchRangeSemitones > 0 && expressiveFeatures.energyRangeDb > 0 &&
  expressiveFeatures.finalPitchDeltaSemitones > 0 &&
  expressiveFeatures.emphasis[0].durationRatioToMedian > 1 &&
  expressiveFeatures.emphasis[0].pitchDeltaSemitones > 0 &&
  expressiveFeatures.emphasis[0].energyDeltaDb > 0);

const providerSource = readFileSync(join(process.cwd(), "api/_voice/providers/open-chatterbox-preview.js"), "utf8");
ok("the provider rejects multi-call text plans and contains no digital segment gap",
  providerSource.includes('fail("open_voice_text_plan_not_continuous", 409)') &&
  providerSource.includes('strategy: "single_continuous_utterance"') &&
  !providerSource.includes("SEGMENT_GAP_MS") && !providerSource.includes("unaltered_segments_with_zero_gap"));

const balanced = voicePreviewStyle();
ok("ordinary preview now starts from Chatterbox's neutral defaults rather than the owner-rejected flat anchor",
  DEFAULT_VOICE_PREVIEW_STYLE === "balanced" && balanced.exaggeration === 0.5 &&
  balanced.cfg_weight === 0.5 && balanced.temperature === 0.8);

const anchor = voicePreviewStyle("identity_anchor");
ok("the former identity anchor remains available only as a reversible calibration condition",
  anchor.exaggeration === 0.2 && anchor.cfg_weight === 0.78 && anchor.temperature === 0.6);

process.stdout.write(`\nvoice code-switch frontier: ${passed} named checks; ${corpus.length} prompt plans verified across structural and span invariants\n`);
