import { createHash } from "node:crypto";
import { syntheticAudioDisclosure } from "./contracts.js";
import { voiceScriptMode } from "./language-conditioning.js";

export const HINDI_TEXT_FRONTEND_CONTRACT = "vyakti-hindi-text-frontend/v1";
// This contract guarantees deterministic text normalization, not an acoustic
// pronunciation score. The latter must be established with generated audio.
export const HINDI_PRONUNCIATION_LEXICON_CONTRACT = "vyakti-curated-hi-in-orthography/v2";

const MAX_CODE_POINTS = 4_000;
const MAX_SYNTHESIS_SEGMENTS = 16;
const MAX_TRANSFORMATIONS = 256;
const TOKEN = /(\p{L}[\p{L}\p{M}'’]*|\p{N}+(?:[.,]\p{N}+)?|\s+|[^\p{L}\p{M}\p{N}\s]+)/gu;
const LATIN = /^[A-Za-z][A-Za-z'’]*$/;
const DEVANAGARI = /[\u0900-\u097f]/u;

// A single uppercase symbol has an unambiguous spoken form. A multi-letter
// uppercase token does not: `IIT` is spelled out, `NASA` is pronounced as a
// word, and an owner's name or product can follow either convention. Known
// initialisms therefore live in the reviewed table below. Unknown uppercase
// tokens stay unchanged instead of receiving a confident but wrong spelling.
const DEVANAGARI_LETTER_NAMES = Object.freeze({
  A: "ए", B: "बी", C: "सी", D: "डी", E: "ई", F: "एफ", G: "जी", H: "एच", I: "आई",
  J: "जे", K: "के", L: "एल", M: "एम", N: "एन", O: "ओ", P: "पी", Q: "क्यू", R: "आर",
  S: "एस", T: "टी", U: "यू", V: "वी", W: "डब्ल्यू", X: "एक्स", Y: "वाई", Z: "ज़ेड",
});

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
  baat: "बात", banao: "बनाओ", bana: "बना", bani: "बनी", banaya: "बनाया", batao: "बताओ",
  bharat: "भारत", bolo: "बोलो", bolna: "बोलना", chhota: "छोटा", chhoti: "छोटी",
  din: "दिन", dobara: "दोबारा", duniya: "दुनिया", gaya: "गया", gayi: "गई", gaye: "गए",
  hamesha: "हमेशा", har: "हर", hogi: "होगी", iss: "इस", kaafi: "काफ़ी", kabhi: "कभी",
  kaise: "कैसे", kahan: "कहाँ", kal: "कल", karenge: "करेंगे", kyunki: "क्योंकि", liye: "लिए",
  log: "लोग", maine: "मैंने", matlab: "मतलब", mumkin: "मुमकिन", naya: "नया", naye: "नए",
  nayi: "नई", paas: "पास", pe: "पर", pehle: "पहले", poora: "पूरा", pyaar: "प्यार",
  ruko: "रुको", saath: "साथ", sahi: "सही", samajhna: "समझना", samjhenge: "समझेंगे",
  shayad: "शायद", suno: "सुनो", waqt: "वक़्त", wala: "वाला", wale: "वाले", wali: "वाली",
  zaroor: "ज़रूर", zindagi: "ज़िंदगी",
});

// Common Indian-English borrowings are rendered in Devanagari to give a
// Hindi-conditioned model an explicit Indian-script target. This is an
// orthographic intervention, not proof of the resulting acoustic
// pronunciation. Unlisted English remains byte-identical and auditable.
const REVIEWED_HINDI_BORROWINGS = Object.freeze({
  ai: "एआई", api: "एपीआई", algebra: "एल्जेब्रा", app: "ऐप", audio: "ऑडियो", answer: "आंसर",
  biology: "बायोलॉजी", call: "कॉल", chapter: "चैप्टर", check: "चेक", clone: "क्लोन",
  chemistry: "केमिस्ट्री", class: "क्लास", concept: "कॉन्सेप्ट",
  companies: "कंपनीज़", company: "कंपनी", context: "कॉन्टेक्स्ट", correct: "करेक्ट", cpu: "सीपीयू",
  cultural: "कल्चरल", custom: "कस्टम", data: "डेटा", design: "डिज़ाइन", digital: "डिजिटल",
  diverse: "डाइवर्स", dozens: "डज़न्स", easy: "ईज़ी", email: "ईमेल", emotional: "इमोशनल",
  english: "इंग्लिश", equation: "इक्वेशन", everyday: "एवरीडे", example: "एग्ज़ाम्पल",
  expertise: "एक्सपर्टीज़", expressive: "एक्सप्रेसिव", feedback: "फ़ीडबैक", file: "फ़ाइल",
  final: "फ़ाइनल", formula: "फ़ॉर्मूला", future: "फ़्यूचर", global: "ग्लोबल", google: "गूगल",
  gpt: "जीपीटी", gpu: "जीपीयू", llm: "एलएलएम",
  growing: "ग्रोइंग", high: "हाई", hindi: "हिंदी", human: "ह्यूमन", idea: "आइडिया",
  india: "इंडिया", indian: "इंडियन", iit: "आईआईटी", jee: "जेईई", language: "लैंग्वेज",
  languages: "लैंग्वेजेज़", life: "लाइफ़", link: "लिंक", login: "लॉगिन", marathi: "मराठी",
  math: "मैथ", maths: "मैथ्स", memory: "मेमरी", mobile: "मोबाइल", model: "मॉडल",
  nasa: "नासा", natural: "नैचरल", ncert: "एनसीईआरटी", need: "नीड", neet: "नीट",
  next: "नेक्स्ट", online: "ऑनलाइन", otp: "ओटीपी", phone: "फ़ोन", photo: "फ़ोटो",
  physics: "फिज़िक्स", please: "प्लीज़", privacy: "प्राइवेसी", process: "प्रोसेस",
  product: "प्रॉडक्ट", promising: "प्रॉमिसिंग", quality: "क्वालिटी", question: "क्वेश्चन",
  rapidly: "रैपिडली", record: "रिकॉर्ड", recording: "रिकॉर्डिंग", regional: "रीजनल",
  replay: "रिप्ले", result: "रिज़ल्ट", rlhf: "आरएलएचएफ", robotic: "रोबॉटिक",
  science: "साइंस", screen: "स्क्रीन", service: "सर्विस", simple: "सिंपल", software: "सॉफ़्टवेयर",
  start: "स्टार्ट", stop: "स्टॉप", stt: "एसटीटी", student: "स्टूडेंट", students: "स्टूडेंट्स",
  switch: "स्विच", tamil: "तमिल", teacher: "टीचर", telugu: "तेलुगु", test: "टेस्ट",
  text: "टेक्स्ट", timer: "टाइमर", topic: "टॉपिक", tts: "टीटीएस", ui: "यूआई", upi: "यूपीआई",
  url: "यूआरएल", user: "यूज़र", ux: "यूएक्स", version: "वर्ज़न", video: "वीडियो",
  voice: "वॉइस", world: "वर्ल्ड", youtube: "यूट्यूब", bengali: "बंगाली",
});

const HINDI_POSTPOSITIONS = new Set(["ka", "ke", "ki", "ko", "mein", "par", "pe", "se"]);

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
  if (/^[A-Z]$/.test(token)) {
    return {
      languageId: "hi",
      text: DEVANAGARI_LETTER_NAMES[token],
      transformation: "reviewed_latin_symbol",
    };
  }
  return { languageId: "en", text: token, transformation: null };
}

function contextualRomanHindi(lexical, position) {
  const source = lexical[position]?.source || "";
  if (source.toLocaleLowerCase("en-US") !== "is") return null;
  if (position < 1 || position + 2 >= lexical.length) return null;
  const previous = lexical[position - 1].source.toLocaleLowerCase("en-US");
  const postposition = lexical[position + 2].source.toLocaleLowerCase("en-US");
  // Resolve only the Hindi grammar shape "hum is concept ko". Bare `is`
  // remains English because it is one of the highest-frequency confusables.
  if (!REVIEWED_ROMAN_HINDI[previous] || !HINDI_POSTPOSITIONS.has(postposition)) return null;
  return { languageId: "hi", text: "इस", transformation: "reviewed_roman_hindi_context" };
}

function contentSegments(input) {
  const lexical = [];
  const transformations = [];
  const unresolvedLatin = [];
  const warnings = new Set();
  const inputScriptMode = voiceScriptMode(input).mode;
  const matches = [...input.matchAll(TOKEN)];
  const lexicalMatches = matches
    .map((match, index) => ({ index, source: match[0] }))
    .filter((item) => LATIN.test(item.source) || DEVANAGARI.test(item.source));
  const lexicalPositions = new Map(lexicalMatches.map((item, position) => [item.index, position]));
  for (const [matchIndex, match] of matches.entries()) {
    const source = match[0];
    const start = match.index;
    const classified = contextualRomanHindi(lexicalMatches, lexicalPositions.get(matchIndex)) || tokenLanguageAndText(source);
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
      unresolvedLatin.push(Object.freeze({
        source,
        sourceStartUtf16: start,
        sourceEndUtf16: start + source.length,
      }));
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
  return { segments, transformations, unresolvedLatin, warnings };
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

// Hindi and Hinglish are one spoken utterance, not a sequence of independent
// voices. Chatterbox accepts one language tag per generation. Splitting at
// every lexical switch therefore reset the seed, reference conditioning,
// rhythm and breath, then inserted digital silence between the outputs. The
// result was measurably longer and less speaker-like, and the owner heard the
// same boundary as choppy, robotic speech.
//
// Keep the exact per-token semantic audit, but render every Hindi/Hinglish
// request in one Hindi-conditioned generation. Known Hindi words and reviewed
// classroom borrowings are already written in Devanagari; unresolved English
// remains byte-identical inside the same continuous context. This is not a
// claim that the model has native code-switch phonology. It is the minimum
// acoustic invariant needed to evaluate that limitation without adding a
// synthetic join defect of our own.
function coalesceHinglishSingleContext(content) {
  const warnings = new Set(content.warnings);
  const hasEnglish = content.segments.some((segment) => segment.languageId === "en");
  const hasHindi = content.segments.some((segment) => segment.languageId === "hi");
  if (hasEnglish && hasHindi) {
    warnings.add("hinglish_single_context_synthesis");
  }
  if (hasEnglish) {
    warnings.add("native_code_switch_pronunciation_unqualified");
  }
  return { warnings };
}

function buildSegments(content, language, disclosureText) {
  const semanticSegments = [
    { kind: "disclosure", languageId: language, text: disclosureText, sourceStartUtf16: null, sourceEndUtf16: null },
    ...content.segments,
  ].map((segment, index) => Object.freeze({ index, ...segment }));
  return {
    semanticSegments,
    synthesisSegments: mergeSynthesisSegments(semanticSegments),
  };
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
    content = { segments: [{ kind: "content", languageId: "en", text: inputText, sourceStartUtf16: 0, sourceEndUtf16: inputText.length }], transformations: [], unresolvedLatin: [], warnings: new Set() };
  } else {
    content = contentSegments(inputText);
  }
  let { semanticSegments, synthesisSegments: rawSynthesisSegments } = buildSegments(content, language, disclosureText);
  if (language === "hi" && rawSynthesisSegments.length > 1) {
    const continuousSynthesis = coalesceHinglishSingleContext(content);
    rawSynthesisSegments = [{
      languageId: "hi",
      text: semanticSegments.map((segment) => segment.text.trim()).filter(Boolean).join(" "),
      semanticIndexes: semanticSegments.map((segment) => segment.index),
    }];
    content = { ...content, warnings: continuousSynthesis.warnings };
  }
  const synthesisSegments = rawSynthesisSegments.map((segment, index) => {
    if (!supported.has(segment.languageId)) fail("hindi_text_frontend_segment_language_unsupported", 409);
    return Object.freeze({ index, ...segment });
  });
  if (!synthesisSegments.length || synthesisSegments.length > MAX_SYNTHESIS_SEGMENTS) {
    fail("hindi_text_frontend_too_many_language_switches", 413);
  }
  const targetText = semanticSegments.map((segment) => segment.text.trim()).filter(Boolean).join(" ");
  const planCore = {
    contract: HINDI_TEXT_FRONTEND_CONTRACT,
    pronunciationLexicon: HINDI_PRONUNCIATION_LEXICON_CONTRACT,
    synthesisStrategy: "single_continuous_utterance",
    languageId: language,
    inputSha256: sha256(inputText),
    targetSha256: sha256(targetText),
    disclosureText,
    semanticSegments,
    synthesisSegments,
    transformations: content.transformations,
    unresolvedLatin: content.unresolvedLatin,
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
    pronunciationLexicon: plan.pronunciationLexicon,
    planSha256: plan.planSha256,
    inputSha256: plan.inputSha256,
    targetSha256: plan.targetSha256,
    synthesisStrategy: plan.synthesisStrategy,
    disclosureLanguage: plan.languageId,
    synthesisLanguages: Object.freeze(plan.synthesisSegments.map((segment) => segment.languageId)),
    synthesisSegmentCount: plan.synthesisSegments.length,
    transformationCount: plan.transformations.length,
    unresolvedLatinCount: plan.unresolvedLatin.length,
    warnings: Object.freeze([...plan.warnings]),
  });
}
