import { createHash } from "node:crypto";
import { syntheticAudioDisclosure } from "./contracts.js";
import { voiceScriptMode } from "./language-conditioning.js";

export const HINDI_TEXT_FRONTEND_CONTRACT = "vyakti-hindi-text-frontend/v1";

const MAX_CODE_POINTS = 4_000;
const MAX_SYNTHESIS_SEGMENTS = 16;
const MAX_TRANSFORMATIONS = 256;
const TOKEN = /(\p{L}[\p{L}\p{M}'’]*|\p{N}+(?:[.,]\p{N}+)?|\s+|[^\p{L}\p{M}\p{N}\s]+)/gu;
const LATIN = /^[A-Za-z][A-Za-z'’]*$/;
const DEVANAGARI = /[\u0900-\u097f]/u;

// This table is intentionally reviewed and bounded. It is not a language
// detector and it never guesses an unknown Latin token. Unknowns stay byte for
// byte identical and move to an explicit English segment. Additions therefore
// require a pronunciation example and a regression test, not a bigger regex.
const REVIEWED_ROMAN_HINDI = Object.freeze({
  aaj: "आज", aap: "आप", aapka: "आपका", aapki: "आपकी", aapko: "आपको",
  ab: "अब", abhi: "अभी", accha: "अच्छा", achha: "अच्छा", agar: "अगर",
  apna: "अपना", apne: "अपने", aur: "और", bahut: "बहुत", bas: "बस",
  bhi: "भी", bilkul: "बिल्कुल", chahiye: "चाहिए", chalo: "चलो",
  dekho: "देखो", ek: "एक", ham: "हम", hamein: "हमें", hamara: "हमारा",
  hai: "है", hain: "हैं", ho: "हो", hoga: "होगा", hoon: "हूँ",
  hum: "हम", humein: "हमें", iska: "इसका", isko: "इसको", jaise: "जैसे",
  kar: "कर", karein: "करें", karna: "करना", karte: "करते", ka: "का",
  ke: "के", ki: "की", ko: "को", kuch: "कुछ", kyon: "क्यों", kyun: "क्यों",
  kya: "क्या", lekin: "लेकिन", main: "मैं", mein: "में", mera: "मेरा",
  mere: "मेरे", meri: "मेरी", milte: "मिलते", mujhe: "मुझे", nahi: "नहीं",
  namaskar: "नमस्कार", namaste: "नमस्ते", padhna: "पढ़ना", padhenge: "पढ़ेंगे",
  par: "पर", phir: "फिर", raha: "रहा", rahe: "रहे", rahi: "रही",
  sab: "सब", samajh: "समझ", samjho: "समझो", se: "से", sikhna: "सीखना",
  sikhte: "सीखते", tha: "था", thi: "थी", toh: "तो", tum: "तुम",
  tumhara: "तुम्हारा", tumhari: "तुम्हारी", tumhe: "तुम्हें", ya: "या",
  yeh: "यह", ye: "ये", woh: "वह", wo: "वो",
});

// Common classroom borrowings are rendered in Devanagari because this is how
// Hindi TTS models preserve an Indian pronunciation without pretending the
// word is Hindi. Unlisted English remains English and is synthesized as such.
const REVIEWED_HINDI_BORROWINGS = Object.freeze({
  ai: "एआई", algebra: "एल्जेब्रा", biology: "बायोलॉजी", chapter: "चैप्टर",
  chemistry: "केमिस्ट्री", class: "क्लास", concept: "कॉन्सेप्ट",
  equation: "इक्वेशन", example: "एग्ज़ाम्पल", formula: "फ़ॉर्मूला",
  maths: "मैथ्स", math: "मैथ", physics: "फिज़िक्स", question: "क्वेश्चन",
  science: "साइंस", student: "स्टूडेंट", students: "स्टूडेंट्स",
  teacher: "टीचर", topic: "टॉपिक", version: "वर्ज़न", video: "वीडियो",
});

function fail(code, status = 400) {
  throw Object.assign(new Error(code), { code, status });
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonical(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function tokenLanguageAndText(token) {
  if (DEVANAGARI.test(token)) return { languageId: "hi", text: token, transformation: null };
  if (!LATIN.test(token)) return { languageId: null, text: token, transformation: null };
  const key = token.toLocaleLowerCase("en-US").replace(/[’']/g, "'");
  if (REVIEWED_ROMAN_HINDI[key]) {
    return { languageId: "hi", text: REVIEWED_ROMAN_HINDI[key], transformation: "reviewed_roman_hindi" };
  }
  if (REVIEWED_HINDI_BORROWINGS[key]) {
    return { languageId: "hi", text: REVIEWED_HINDI_BORROWINGS[key], transformation: "reviewed_hindi_borrowing" };
  }
  return { languageId: "en", text: token, transformation: null };
}

function contentSegments(input) {
  const lexical = [];
  const transformations = [];
  const warnings = new Set();
  const inputScriptMode = voiceScriptMode(input).mode;
  for (const match of input.matchAll(TOKEN)) {
    const source = match[0];
    const start = match.index;
    const classified = tokenLanguageAndText(source);
    lexical.push({ source, start, end: start + source.length, ...classified });
    if (classified.transformation) {
      transformations.push(Object.freeze({
        kind: classified.transformation,
        source,
        target: classified.text,
        sourceStartUtf16: start,
        sourceEndUtf16: start + source.length,
      }));
    } else if (classified.languageId === "en" && inputScriptMode !== "devanagari") {
      warnings.add("unresolved_latin_retained_as_english");
    }
  }
  if (transformations.length > MAX_TRANSFORMATIONS) fail("hindi_text_frontend_too_many_transformations", 413);

  const segments = [];
  let pendingNeutral = "";
  let pendingNeutralStart = null;
  for (const token of lexical) {
    if (!token.languageId) {
      if (segments.length) {
        segments[segments.length - 1].text += token.text;
        segments[segments.length - 1].sourceEndUtf16 = token.end;
      } else {
        if (pendingNeutralStart === null) pendingNeutralStart = token.start;
        pendingNeutral += token.text;
      }
      continue;
    }
    const text = pendingNeutral + token.text;
    const sourceStartUtf16 = pendingNeutralStart ?? token.start;
    pendingNeutral = "";
    pendingNeutralStart = null;
    const last = segments[segments.length - 1];
    if (last?.languageId === token.languageId) {
      last.text += text;
      last.sourceEndUtf16 = token.end;
    } else {
      segments.push({
        kind: "content",
        languageId: token.languageId,
        text,
        sourceStartUtf16,
        sourceEndUtf16: token.end,
      });
    }
  }
  if (pendingNeutral) {
    if (segments.length) segments[segments.length - 1].text += pendingNeutral;
    else segments.push({ kind: "content", languageId: "hi", text: pendingNeutral, sourceStartUtf16: 0, sourceEndUtf16: input.length });
  }
  return { segments, transformations, warnings };
}

function mergeSynthesisSegments(semanticSegments) {
  const result = [];
  for (const segment of semanticSegments) {
    const clean = segment.text.trim();
    if (!clean) continue;
    const last = result[result.length - 1];
    if (last?.languageId === segment.languageId) {
      last.text = `${last.text} ${clean}`;
      last.semanticIndexes.push(segment.index);
    } else {
      result.push({ languageId: segment.languageId, text: clean, semanticIndexes: [segment.index] });
    }
  }
  return result;
}

export function buildVoiceTextPlan({ text, languageId, supportedLanguages = ["en", "hi"] }) {
  const inputText = typeof text === "string" ? text.trim() : "";
  if (!inputText) fail("hindi_text_frontend_text_required");
  if (Array.from(inputText).length > MAX_CODE_POINTS) fail("hindi_text_frontend_text_too_large", 413);
  const language = String(languageId || "en").toLowerCase();
  if (!new Set(["en", "hi"]).has(language)) fail("hindi_text_frontend_language_invalid");
  const supported = new Set(supportedLanguages.map((value) => String(value).toLowerCase()));
  if (!supported.has(language)) fail("hindi_text_frontend_language_unsupported");

  const disclosureText = syntheticAudioDisclosure(language);
  let content;
  if (language === "en") {
    content = { segments: [{ kind: "content", languageId: "en", text: inputText, sourceStartUtf16: 0, sourceEndUtf16: inputText.length }], transformations: [], warnings: new Set() };
  } else {
    content = contentSegments(inputText);
  }
  const semanticSegments = [
    { kind: "disclosure", languageId: language, text: disclosureText, sourceStartUtf16: null, sourceEndUtf16: null },
    ...content.segments,
  ].map((segment, index) => Object.freeze({ index, ...segment }));
  const synthesisSegments = mergeSynthesisSegments(semanticSegments).map((segment, index) => {
    if (!supported.has(segment.languageId)) fail("hindi_text_frontend_segment_language_unsupported", 409);
    return Object.freeze({ index, ...segment });
  });
  if (!synthesisSegments.length || synthesisSegments.length > MAX_SYNTHESIS_SEGMENTS) {
    fail("hindi_text_frontend_too_many_language_switches", 413);
  }
  const targetText = semanticSegments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const planCore = {
    contract: HINDI_TEXT_FRONTEND_CONTRACT,
    languageId: language,
    inputSha256: sha256(inputText),
    targetSha256: sha256(targetText),
    disclosureText,
    semanticSegments,
    synthesisSegments,
    transformations: content.transformations,
    warnings: [...content.warnings].sort(),
  };
  return Object.freeze({
    ...planCore,
    inputText,
    targetText,
    planSha256: sha256(canonical(planCore)),
  });
}

export function voiceTextPlanAudit(plan) {
  return Object.freeze({
    contract: plan.contract,
    planSha256: plan.planSha256,
    inputSha256: plan.inputSha256,
    targetSha256: plan.targetSha256,
    disclosureLanguage: plan.languageId,
    synthesisLanguages: Object.freeze(plan.synthesisSegments.map((segment) => segment.languageId)),
    synthesisSegmentCount: plan.synthesisSegments.length,
    transformationCount: plan.transformations.length,
    warnings: Object.freeze([...plan.warnings]),
  });
}
