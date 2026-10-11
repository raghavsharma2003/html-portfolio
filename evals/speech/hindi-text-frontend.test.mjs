import assert from "node:assert/strict";
import {
  HINDI_TEXT_FRONTEND_CONTRACT,
  buildVoiceTextPlan,
  voiceTextPlanAudit,
} from "../../api/_voice/hindi-text-frontend.js";
import {
  SYNTHETIC_AUDIO_DISCLOSURES,
  VOICE_PCM_FORMAT,
  assertSynthesisResult,
} from "../../api/_voice/contracts.js";

let passed = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`  PASS ${name}`);
}

const currentDefault = "Namaste! Main aapka apna AI version hoon. Aaj kya padhna hai, physics, chemistry ya maths?";
const hindi = buildVoiceTextPlan({ text: currentDefault, languageId: "hi" });
assert.equal(hindi.contract, HINDI_TEXT_FRONTEND_CONTRACT);
assert.equal(hindi.targetText,
  `${SYNTHETIC_AUDIO_DISCLOSURES.hi} नमस्ते! मैं आपका अपना एआई वर्ज़न हूँ. आज क्या पढ़ना है, फिज़िक्स, केमिस्ट्री या मैथ्स?`);
ok("the exact Studio default becomes one bound Devanagari Hindi synthesis segment",
  hindi.synthesisSegments.length === 1 && hindi.synthesisSegments[0].languageId === "hi" &&
  hindi.synthesisSegments[0].text === hindi.targetText);
ok("the Hindi disclosure is fixed, explicit, and rendered in the same language as the Hindi segment",
  hindi.semanticSegments[0].kind === "disclosure" &&
  hindi.semanticSegments[0].languageId === "hi" &&
  hindi.semanticSegments[0].text === SYNTHETIC_AUDIO_DISCLOSURES.hi);
const localizedResult = assertSynthesisResult({
  disclosureText: SYNTHETIC_AUDIO_DISCLOSURES.hi,
  renderedText: hindi.targetText,
  format: VOICE_PCM_FORMAT,
  stream: (async function* () { yield new Uint8Array([0, 0]); })(),
});
ok("the provider-neutral synthesis contract accepts the fixed Hindi disclosure",
  localizedResult.disclosureText === SYNTHETIC_AUDIO_DISCLOSURES.hi);
assert.throws(() => assertSynthesisResult({
  disclosureText: SYNTHETIC_AUDIO_DISCLOSURES.hi,
  renderedText: `${SYNTHETIC_AUDIO_DISCLOSURES.en} नमस्ते`,
  format: VOICE_PCM_FORMAT,
  stream: (async function* () { yield new Uint8Array([0, 0]); })(),
}), /provider must render the exact synthetic-audio disclosure/);
ok("a disclosure language that does not match the rendered prefix fails closed", true);

const mixed = buildVoiceTextPlan({
  text: "आज we will study physics aur maths.",
  languageId: "hi",
});
assert.deepEqual(mixed.synthesisSegments.map((segment) => segment.languageId), ["hi"]);
ok("mixed-script Hinglish stays one continuous acoustic utterance",
  mixed.synthesisSegments[0].text === mixed.targetText &&
  mixed.warnings.includes("hinglish_single_context_synthesis"));
ok("unknown English remains explicit in the semantic audit instead of being silently rewritten",
  mixed.semanticSegments.some((segment) => segment.languageId === "en" && segment.text.trim() === "we will study"));
ok("curated Indian-English orthography stays inside the continuous Hindi utterance",
  mixed.semanticSegments.some((segment) => segment.languageId === "hi" && segment.text.trim() === "फिज़िक्स और मैथ्स."));
ok("an unresolved Latin warning survives in the auditable plan",
  mixed.warnings.includes("unresolved_latin_retained_as_english"));

const confusable = buildVoiceTextPlan({ text: "he hai", languageId: "hi" });
assert.deepEqual(confusable.synthesisSegments.map((segment) => segment.languageId), ["hi"]);
ok("the English confusable he is never silently accepted as Hindi hai",
  confusable.semanticSegments.some((segment) => segment.languageId === "en" && segment.text.trim() === "he") &&
  confusable.semanticSegments.some((segment) => segment.languageId === "hi" && segment.text.trim() === "है"));

const englishArticle = buildVoiceTextPlan({ text: "the formula hai", languageId: "hi" });
assert.deepEqual(englishArticle.synthesisSegments.map((segment) => segment.languageId), ["hi"]);
ok("the English article the is never silently rewritten as Hindi the",
  englishArticle.semanticSegments.some((segment) => segment.languageId === "en" && segment.text.trim() === "the") &&
  englishArticle.semanticSegments.some((segment) => segment.languageId === "hi" && segment.text.trim() === "फ़ॉर्मूला है"));

const technicalInitialisms = buildVoiceTextPlan({
  text: "AI aur RLHF ke liye GPU, API, TTS aur STT samjho.",
  languageId: "hi",
});
ok("curated technical initialisms receive deterministic Indian-script targets",
  technicalInitialisms.targetText.includes("एआई और आरएलएचएफ") &&
  technicalInitialisms.targetText.includes("जीपीयू") &&
  technicalInitialisms.targetText.includes("एपीआई") &&
  technicalInitialisms.targetText.includes("टीटीएस और एसटीटी"));
ok("technical initialisms still render in the same continuous utterance",
  technicalInitialisms.synthesisSegments.length === 1 &&
  technicalInitialisms.synthesisSegments[0].text === technicalInitialisms.targetText);

const unseenInitialisms = buildVoiceTextPlan({
  text: "IIT JEE mein H aur O ka API check karo, but NEET ko word ki tarah bolo.",
  languageId: "hi",
});
ok("curated initialisms and single-letter symbols receive deterministic Indian-script targets",
  unseenInitialisms.targetText.includes("आईआईटी") && unseenInitialisms.targetText.includes("जेईई") &&
  unseenInitialisms.targetText.includes("एच") && unseenInitialisms.targetText.includes("ओ") &&
  unseenInitialisms.targetText.includes("एपीआई") && unseenInitialisms.targetText.includes("नीट") &&
  unseenInitialisms.transformations.some((item) => item.kind === "reviewed_hindi_borrowing" && item.source === "IIT") &&
  unseenInitialisms.transformations.some((item) => item.kind === "reviewed_latin_symbol" && item.source === "H"));

const ordinaryUppercaseWord = buildVoiceTextPlan({ text: "NASA ka launch dekho.", languageId: "hi" });
ok("a curated word acronym keeps its conventional orthography instead of arbitrary letter spelling",
  ordinaryUppercaseWord.targetText.includes("नासा") &&
  ordinaryUppercaseWord.transformations.some((item) => item.kind === "reviewed_hindi_borrowing" && item.source === "NASA"));

const unknownUppercase = buildVoiceTextPlan({ text: "Aaj QZXV ka result dekho.", languageId: "hi" });
ok("an unknown uppercase token remains exact and auditable rather than receiving a guessed pronunciation",
  unknownUppercase.semanticSegments.some((item) => item.languageId === "en" && item.text.trim() === "QZXV") &&
  unknownUppercase.unresolvedLatin.some((item) => item.source === "QZXV") &&
  !unknownUppercase.transformations.some((item) => item.source === "QZXV"));

for (const transformation of hindi.transformations) {
  assert.equal(
    hindi.inputText.slice(transformation.sourceStartUtf16, transformation.sourceEndUtf16),
    transformation.source,
  );
}
ok("every pronunciation change points back to an exact UTF-16 source slice", true);
ok("plans are deterministic and content addressed",
  buildVoiceTextPlan({ text: currentDefault, languageId: "hi" }).planSha256 === hindi.planSha256);

const audit = voiceTextPlanAudit(hindi);
ok("the persisted audit binds input, target, languages, transformations, and plan hash without raw text",
  audit.inputSha256 === hindi.inputSha256 && audit.targetSha256 === hindi.targetSha256 &&
  audit.synthesisStrategy === "single_continuous_utterance" &&
  audit.pronunciationLexicon === hindi.pronunciationLexicon &&
  audit.planSha256 === hindi.planSha256 && audit.transformationCount === hindi.transformations.length &&
  audit.unresolvedLatinCount === hindi.unresolvedLatin.length &&
  !Object.values(audit).includes(currentDefault));

const english = buildVoiceTextPlan({ text: "Hello, let us study today.", languageId: "en" });
ok("English remains byte-identical after its fixed English disclosure",
  english.targetText === `${SYNTHETIC_AUDIO_DISCLOSURES.en} Hello, let us study today.` &&
  english.transformations.length === 0 && english.synthesisSegments.length === 1);

const naturalRomanHinglish = "India mein RLHF ka future kaafi promising hai, kyunki global AI companies ko diverse languages, cultural context aur high quality human feedback ki growing need hogi. Bharat ke paas English ke saath Hindi, Tamil, Telugu, Bengali, Marathi aur regional languages mein expertise hai.";
assert.equal(Array.from(naturalRomanHinglish).length, 280);
const boundedRomanHinglish = buildVoiceTextPlan({ text: naturalRomanHinglish, languageId: "hi" });
ok("a maximum-length Studio Roman Hinglish paragraph stays inside the synthesis bound instead of failing on lexical switches",
  boundedRomanHinglish.synthesisSegments.length === 1 &&
  boundedRomanHinglish.synthesisSegments[0].languageId === "hi");
ok("the reported long Roman Hinglish paragraph has a complete curated orthography plan",
  boundedRomanHinglish.unresolvedLatin.length === 0 &&
  !boundedRomanHinglish.warnings.includes("native_code_switch_pronunciation_unqualified"));
ok("bounded Roman Hinglish preserves every source transformation span",
  boundedRomanHinglish.transformations.every((transformation) =>
    boundedRomanHinglish.inputText.slice(transformation.sourceStartUtf16, transformation.sourceEndUtf16) === transformation.source));

const ordinaryRomanHinglish = buildVoiceTextPlan({
  text: "Aaj hum is concept ko simple example ke saath samjhenge, phir answer check karenge.",
  languageId: "hi",
});
ok("an ordinary Roman Hinglish classroom line avoids identity-damaging acoustic fan-out",
  ordinaryRomanHinglish.synthesisSegments.length === 1 &&
  ordinaryRomanHinglish.synthesisSegments[0].languageId === "hi" &&
  ordinaryRomanHinglish.unresolvedLatin.length === 0);
ok("the bounded context rule resolves Hindi `is` without making it an unconditional alias",
  ordinaryRomanHinglish.transformations.some((item) =>
    item.kind === "reviewed_roman_hindi_context" && item.source === "is" && item.target === "इस"));

const alternating = Array.from({ length: 9 }, (_, index) => `आज x${index}`).join(" ");
const continuousAlternating = buildVoiceTextPlan({ text: alternating, languageId: "hi" });
ok("even dense mixed-script input cannot reintroduce acoustic fan-out",
  continuousAlternating.synthesisSegments.length === 1 &&
  continuousAlternating.synthesisSegments[0].semanticIndexes.length === continuousAlternating.semanticSegments.length &&
  continuousAlternating.warnings.includes("hinglish_single_context_synthesis"));

const hindiOnlyMixed = buildVoiceTextPlan({ text: "आज unknown", languageId: "hi", supportedLanguages: ["hi"] });
ok("the Hindi-only arm receives one auditable code-mixed utterance instead of a hidden English sub-call",
  hindiOnlyMixed.synthesisSegments.length === 1 &&
  hindiOnlyMixed.synthesisSegments[0].languageId === "hi" &&
  hindiOnlyMixed.semanticSegments.some((segment) => segment.languageId === "en"));

for (const text of ["Aaj constructor call samjho.", "constructor is concept ko explain karo."]) {
  const plan = buildVoiceTextPlan({ text, languageId: "hi" });
  ok("inherited dictionary properties never become spoken implementation text",
    plan.targetText.includes("constructor") && !/function Object|native code/.test(plan.targetText) &&
    !plan.transformations.some(item => item.source === "constructor") &&
    plan.unresolvedLatin.some(item => item.source === "constructor"));
  if (text.startsWith("constructor is")) assert.ok(plan.targetText.includes("constructor is"));
}
for (const text of ["BAS API ka result dekho.", "HUM aur MAIN ka API check karo.", "hum IS concept ko samjho."]) {
  const plan = buildVoiceTextPlan({ text, languageId: "hi" });
  for (const token of text.match(/\b[A-Z]{2,}\b/g).filter(token => token !== "API")) {
    assert.ok(plan.targetText.includes(token));
    assert.ok(plan.unresolvedLatin.some(item => item.source === token));
    assert.ok(!plan.transformations.some(item => item.source === token));
  }
  ok("uppercase collisions stay owner-spelled and auditable in one Hindi utterance",
    plan.synthesisSegments.length === 1 && plan.synthesisSegments[0].text === plan.targetText &&
    plan.targetText.startsWith(SYNTHETIC_AUDIO_DISCLOSURES.hi));
}
const lowerRoman = buildVoiceTextPlan({ text: "Main bas hum is concept ko samjho.", languageId: "hi" });
ok("ordinary Roman Hindi and contextual is retain their reviewed mapping",
  lowerRoman.targetText.includes("मैं बस हम इस कॉन्सेप्ट को समझो"));
const knownUpper = buildVoiceTextPlan({ text: "NASA API IIT JEE AI", languageId: "hi" });
ok("explicitly reviewed acronyms keep their supported pronunciation",
  ["नासा", "एपीआई", "आईआईटी", "जेईई", "एआई"].every(token => knownUpper.targetText.includes(token)));
const exactEnglish = "BAS constructor API main is a method.";
ok("English input remains byte-identical after its fixed disclosure",
  buildVoiceTextPlan({ text: exactEnglish, languageId: "en" }).targetText === `${SYNTHETIC_AUDIO_DISCLOSURES.en} ${exactEnglish}`);

console.log(`\nhindi text frontend: ${passed} checks passed`);
