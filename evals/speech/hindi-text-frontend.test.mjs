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
assert.deepEqual(mixed.synthesisSegments.map((segment) => segment.languageId), ["hi", "en", "hi"]);
assert.equal(mixed.synthesisSegments[1].text, "we will study");
ok("unknown English is an explicit English segment instead of a Hindi-tagged silent fallback", true);
ok("reviewed classroom borrowings return to the Hindi segment",
  mixed.synthesisSegments[2].text === "फिज़िक्स और मैथ्स.");
ok("an unresolved Latin warning survives in the auditable plan",
  mixed.warnings.includes("unresolved_latin_retained_as_english"));

const confusable = buildVoiceTextPlan({ text: "he hai", languageId: "hi" });
assert.deepEqual(confusable.synthesisSegments.map((segment) => segment.languageId), ["hi", "en", "hi"]);
ok("the English confusable he is never silently accepted as Hindi hai",
  confusable.synthesisSegments[1].text === "he" && confusable.synthesisSegments[2].text === "है");

const englishArticle = buildVoiceTextPlan({ text: "the formula hai", languageId: "hi" });
assert.deepEqual(englishArticle.synthesisSegments.map((segment) => segment.languageId), ["hi", "en", "hi"]);
ok("the English article the is never silently rewritten as Hindi the",
  englishArticle.synthesisSegments[1].text === "the" &&
  englishArticle.synthesisSegments[2].text === "फ़ॉर्मूला है");

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
  audit.planSha256 === hindi.planSha256 && audit.transformationCount === hindi.transformations.length &&
  !Object.values(audit).includes(currentDefault));

const english = buildVoiceTextPlan({ text: "Hello, let us study today.", languageId: "en" });
ok("English remains byte-identical after its fixed English disclosure",
  english.targetText === `${SYNTHETIC_AUDIO_DISCLOSURES.en} Hello, let us study today.` &&
  english.transformations.length === 0 && english.synthesisSegments.length === 1);

const alternating = Array.from({ length: 9 }, (_, index) => `main x${index}`).join(" ");
assert.throws(
  () => buildVoiceTextPlan({ text: alternating, languageId: "hi" }),
  /hindi_text_frontend_too_many_language_switches/,
);
ok("pathological code switching fails by name instead of falling back to one wrong language", true);

assert.throws(
  () => buildVoiceTextPlan({ text: "आज unknown", languageId: "hi", supportedLanguages: ["hi"] }),
  /hindi_text_frontend_segment_language_unsupported/,
);
ok("the Hindi-only model refuses unresolved English before inference", true);

console.log(`\nhindi text frontend: ${passed} checks passed`);
