#!/usr/bin/env node
import {
  HINGLISH_ALIAS_LEXICON_VERSION,
  SCRIPT_AWARE_MARKER_METRIC,
  measureScriptAwareHindiMarkerProxy,
  normalizeBenchmarkText,
  scoreHinglishTranscriptPair,
} from "./hinglish-script-score.mjs";

let passed = 0;
let failed = 0;
function ok(name, condition, detail = "") {
  if (condition) passed++;
  else failed++;
  console.log(`${condition ? "PASS" : "FAIL"}  ${name}${detail ? `  ${detail}` : ""}`);
}

console.log("\n-- curated cross-script Hinglish transcript score --");

const crossScript = scoreHinglishTranscriptPair(
  "main abhi deploy kar rha hai",
  "मैं अभी deploy कर रहा है",
);
ok("raw WER preserves the Latin-vs-Devanagari mismatch", crossScript.raw.wordErrorRate === 5 / 6);
ok("curated cross-script WER recognizes reviewed equivalents", crossScript.scriptAware.wordErrorRate === 0);
ok("metric labels and lexicon coverage travel with the adjusted score",
  crossScript.scriptAware.label.includes("curated_cross_script") &&
  crossScript.coverage.lexicon === HINGLISH_ALIAS_LEXICON_VERSION &&
  crossScript.coverage.observedMappedDevanagariTokens === 5);

const unknown = scoreHinglishTranscriptPair("namaste friend", "नमस्ते friend");
ok("unknown Devanagari is not guessed into a pass", unknown.scriptAware.wordErrorRate === 0.5);
ok("unknown coverage is explicit", unknown.coverage.observedUnmappedDevanagariTokens.includes("नमस्ते"));

const confusable = scoreHinglishTranscriptPair("hai", "he");
ok("English confusable he is not accepted as Hindi hai", confusable.scriptAware.wordErrorRate === 1);
const english = scoreHinglishTranscriptPair("he messaged actually", "he messaged actually");
ok("ordinary English remains unchanged", english.raw.wordErrorRate === 0 && english.scriptAware.wordErrorRate === 0);

const reordered = scoreHinglishTranscriptPair("hai hai kal", "है कल है");
ok("edit-distance scoring notices repeated-token order", reordered.scriptAware.wordErrors === 2);

ok("normalization retains Devanagari combining marks",
  normalizeBenchmarkText("नहीं, क्या?") === "नहीं क्या");

console.log("\n-- script-aware Hindi marker proxy --");
const roman = measureScriptAwareHindiMarkerProxy([{ speaker: "S0", text: "main abhi deploy kar rha hai" }], { speaker: "S0" });
const devanagari = measureScriptAwareHindiMarkerProxy([{ speaker: "S0", text: "मैं अभी deploy कर रहा है" }], { speaker: "S0" });
ok("Roman and Devanagari reviewed markers produce the same proxy count",
  roman.markerTokens === 5 && devanagari.markerTokens === 5);
ok("the proxy remains honestly labeled", devanagari.label === SCRIPT_AWARE_MARKER_METRIC && /not language ID/.test(devanagari.caveat));
ok("observed Devanagari script is reported separately",
  devanagari.devanagariScriptTokens === 5 && devanagari.devanagariScriptTokenRatio === 5 / 6);
const pureEnglish = measureScriptAwareHindiMarkerProxy([{ text: "the bug is fixed" }]);
ok("ambiguous English 'the' is not counted as a Hindi marker", pureEnglish.markerTokens === 0);

let bounded = false;
try {
  scoreHinglishTranscriptPair("x".repeat(8_001), "x");
} catch (error) {
  bounded = error instanceof RangeError && /exceeds_8000_characters/.test(error.message);
}
ok("pathological inputs fail by name instead of truncating silently", bounded);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
