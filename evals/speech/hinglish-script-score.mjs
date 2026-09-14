// Evaluation-only Hinglish transcript scoring.
//
// This module deliberately does not transliterate arbitrary Hindi. A generic
// grapheme converter can make two differently pronounced words look equal,
// which is exactly the kind of false improvement a voice benchmark must not
// manufacture. Instead, v1 canonicalizes a bounded, reviewed alias table for
// the Hindi words exercised by this repository's speech and clone probes.
// Every other token remains byte-visible after Unicode normalization and is
// still charged as an error. The result therefore reports alias coverage and
// is named a curated cross-script score, never plain WER/CER.

export const HINGLISH_ALIAS_LEXICON_VERSION = "vyakti-hinglish-aliases/v1";
export const RAW_TRANSCRIPT_METRIC = "raw_unicode_wer_cer/v1";
export const SCRIPT_AWARE_TRANSCRIPT_METRIC = "curated_cross_script_wer_cer/v1";
export const SCRIPT_AWARE_MARKER_METRIC = "curated_script_aware_hindi_marker_proxy/v1";

const MAX_TEXT_CHARACTERS = 8_000;
const MAX_TOKENS = 1_024;
const MAX_EDIT_CELLS = 2_000_000;
const DEVANAGARI_RE = /\p{Script=Devanagari}/u;

// The canonical spelling is stable benchmark data, not a claim that it is the
// only valid Roman Hindi spelling. Aliases include the corpus's authored
// shortforms and common Devanagari ASR renderings. English confusables such as
// `he` for `hai` and `call` for `kal` are intentionally absent: accepting them
// would hide the pronunciation defect this benchmark exists to expose.
const ALIAS_GROUPS = Object.freeze([
  ["hai", ["h", "है"]],
  ["hain", ["हैं"]],
  ["tha", ["था"]],
  ["thi", ["थी"]],
  ["the", ["थे"]],
  ["kya", ["क्या"]],
  ["kyun", ["kyu", "क्यों", "क्युं"]],
  ["nahi", ["nhi", "नहीं", "नही"]],
  ["haan", ["haa", "हाँ", "हां"]],
  ["mera", ["मेरा"]],
  ["meri", ["मेरी"]],
  ["mere", ["मेरे"]],
  ["tera", ["तेरा"]],
  ["teri", ["तेरी"]],
  ["tere", ["तेरे"]],
  ["tum", ["तुम"]],
  ["tumhara", ["तुम्हारा"]],
  ["tumhari", ["तुम्हारी"]],
  ["aap", ["आप"]],
  ["aapka", ["आपका"]],
  ["hum", ["हम"]],
  ["humara", ["हमारा"]],
  ["yaar", ["यार"]],
  ["bhai", ["भाई"]],
  ["kar", ["कर"]],
  ["karo", ["करो"]],
  ["karna", ["करना"]],
  ["raha", ["rha", "रहा"]],
  ["rahi", ["rhi", "रही"]],
  ["rahe", ["rhe", "रहे"]],
  ["gaya", ["गया"]],
  ["gayi", ["गयी", "गई"]],
  ["gaye", ["गये", "गए"]],
  ["achha", ["acha", "accha", "acchha", "अच्छा"]],
  ["theek", ["thik", "ठीक"]],
  ["matlab", ["मतलब"]],
  ["bas", ["बस"]],
  ["abhi", ["अभी"]],
  ["kal", ["कल"]],
  ["aaj", ["आज"]],
  ["pata", ["पता"]],
  ["milte", ["मिलते"]],
  ["arre", ["arey", "अरे"]],
  ["chhod", ["छोड़", "छोड"]],
  ["batao", ["बताओ"]],
  ["hua", ["हुआ"]],
  ["main", ["mai", "meyn", "मैं"]],
  ["hasi", ["हंसी", "हसी"]],
  ["jab", ["जब"]],
  ["tu", ["तू"]],
  ["bahut", ["bohot", "bahoot", "बहुत"]],
  ["padh", ["पढ़", "पढ"]],
]);

const aliasToCanonical = new Map();
for (const [canonical, aliases] of ALIAS_GROUPS) {
  for (const alias of [canonical, ...aliases]) {
    const normalized = String(alias).normalize("NFC").toLowerCase();
    const existing = aliasToCanonical.get(normalized);
    if (existing && existing !== canonical) {
      throw new Error(`duplicate Hinglish alias ${normalized}`);
    }
    aliasToCanonical.set(normalized, canonical);
  }
}

// Ambiguous Latin tokens are not safe evidence of Hindi by themselves. They
// remain valid cross-script aliases when the other side is Devanagari, but do
// not increment the standalone marker proxy.
const AMBIGUOUS_ROMAN_MARKERS = new Set(["h", "the"]);
const markerCanonicals = new Set(ALIAS_GROUPS.map(([canonical]) => canonical));

function boundedText(value, field) {
  const text = String(value ?? "");
  if (text.length > MAX_TEXT_CHARACTERS) {
    throw new RangeError(`${field}_exceeds_${MAX_TEXT_CHARACTERS}_characters`);
  }
  return text;
}

export function normalizeBenchmarkText(value, field = "text") {
  return boundedText(value, field)
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}'\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenizeBenchmarkText(value, field = "text") {
  const normalized = normalizeBenchmarkText(value, field);
  const tokens = normalized ? normalized.split(" ") : [];
  if (tokens.length > MAX_TOKENS) {
    throw new RangeError(`${field}_exceeds_${MAX_TOKENS}_tokens`);
  }
  return tokens;
}

function canonicalizeTokens(tokens) {
  let aliasMatchedTokens = 0;
  let devanagariTokens = 0;
  let mappedDevanagariTokens = 0;
  const unmappedDevanagariTokens = [];
  const canonical = tokens.map((token) => {
    const isDevanagari = DEVANAGARI_RE.test(token);
    if (isDevanagari) devanagariTokens++;
    const mapped = aliasToCanonical.get(token);
    if (mapped) {
      aliasMatchedTokens++;
      if (isDevanagari) mappedDevanagariTokens++;
      return mapped;
    }
    if (isDevanagari) unmappedDevanagariTokens.push(token);
    return token;
  });
  return Object.freeze({
    tokens: Object.freeze(canonical),
    aliasMatchedTokens,
    devanagariTokens,
    mappedDevanagariTokens,
    unmappedDevanagariTokens: Object.freeze([...new Set(unmappedDevanagariTokens)].sort()),
  });
}

function editDistance(left, right, field) {
  const cells = (left.length + 1) * (right.length + 1);
  if (cells > MAX_EDIT_CELLS) throw new RangeError(`${field}_exceeds_${MAX_EDIT_CELLS}_edit_cells`);
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  // Keep only one row. The cell cap bounds CPU; this bounds memory as well.
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i++) {
    const current = new Array(right.length + 1);
    current[0] = i;
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[right.length];
}

const rate = (errors, referenceUnits) => referenceUnits ? errors / referenceUnits : (errors ? 1 : 0);

function metric(referenceTokens, observedTokens, label) {
  const referenceCharacters = [...referenceTokens.join("")];
  const observedCharacters = [...observedTokens.join("")];
  const wordErrors = editDistance(referenceTokens, observedTokens, `${label}_words`);
  const characterErrors = editDistance(referenceCharacters, observedCharacters, `${label}_characters`);
  return Object.freeze({
    label,
    wordErrors,
    referenceWords: referenceTokens.length,
    wordErrorRate: rate(wordErrors, referenceTokens.length),
    characterErrors,
    referenceCharacters: referenceCharacters.length,
    characterErrorRate: rate(characterErrors, referenceCharacters.length),
  });
}

/**
 * Score one expected/transcribed pair twice: untouched Unicode text and the
 * curated alias-canonicalized form. Spaces and punctuation are excluded from
 * CER in both arms. Raw metrics remain the audit trail and release reports
 * must never publish `scriptAware` without its label and coverage object.
 */
export function scoreHinglishTranscriptPair(expectedText, observedText) {
  const expectedRaw = tokenizeBenchmarkText(expectedText, "expected");
  const observedRaw = tokenizeBenchmarkText(observedText, "observed");
  const expected = canonicalizeTokens(expectedRaw);
  const observed = canonicalizeTokens(observedRaw);
  return Object.freeze({
    raw: metric(expectedRaw, observedRaw, RAW_TRANSCRIPT_METRIC),
    scriptAware: metric(expected.tokens, observed.tokens, SCRIPT_AWARE_TRANSCRIPT_METRIC),
    coverage: Object.freeze({
      lexicon: HINGLISH_ALIAS_LEXICON_VERSION,
      expectedAliasMatchedTokens: expected.aliasMatchedTokens,
      observedAliasMatchedTokens: observed.aliasMatchedTokens,
      expectedDevanagariTokens: expected.devanagariTokens,
      observedDevanagariTokens: observed.devanagariTokens,
      expectedMappedDevanagariTokens: expected.mappedDevanagariTokens,
      observedMappedDevanagariTokens: observed.mappedDevanagariTokens,
      expectedUnmappedDevanagariTokens: expected.unmappedDevanagariTokens,
      observedUnmappedDevanagariTokens: observed.unmappedDevanagariTokens,
    }),
  });
}

/**
 * A benchmark-only replacement for interpreting the Roman-only marker ratio.
 * It is a marker proxy, not language ID and not "Hindi percentage". The
 * separate Devanagari ratio is observed script evidence and includes unknown
 * words; the curated marker ratio only includes reviewed aliases.
 */
export function measureScriptAwareHindiMarkerProxy(turns, options = {}) {
  const all = Array.isArray(turns) ? turns : [];
  const selectedSpeaker = String(options.speaker ?? "");
  const selected = selectedSpeaker
    ? all.filter((turn) => String(turn?.speaker ?? "") === selectedSpeaker)
    : all;
  const perTurn = selected.map((turn, index) =>
    tokenizeBenchmarkText(turn?.text ?? "", `turn_${index}`));
  const tokens = perTurn.flat();
  if (tokens.length > MAX_TOKENS) {
    throw new RangeError(`transcript_exceeds_${MAX_TOKENS}_tokens`);
  }
  let markerTokens = 0;
  let romanMarkerTokens = 0;
  let devanagariMarkerTokens = 0;
  let devanagariScriptTokens = 0;
  let turnsWithMarker = 0;

  for (const turnTokens of perTurn) {
    let markersHere = 0;
    for (const token of turnTokens) {
      const isDevanagari = DEVANAGARI_RE.test(token);
      if (isDevanagari) devanagariScriptTokens++;
      const canonical = aliasToCanonical.get(token);
      if (!canonical || !markerCanonicals.has(canonical)) continue;
      if (!isDevanagari && AMBIGUOUS_ROMAN_MARKERS.has(token)) continue;
      markerTokens++;
      markersHere++;
      if (isDevanagari) devanagariMarkerTokens++;
      else romanMarkerTokens++;
    }
    if (markersHere) turnsWithMarker++;
  }

  return Object.freeze({
    label: SCRIPT_AWARE_MARKER_METRIC,
    caveat: "Curated Hindi-marker proxy, not language ID or Hindi-token percentage.",
    lexicon: HINGLISH_ALIAS_LEXICON_VERSION,
    speaker: selectedSpeaker || null,
    tokens: tokens.length,
    markerTokens,
    tokenRatio: rate(markerTokens, tokens.length),
    turns: perTurn.length,
    turnsWithMarker,
    turnRatio: rate(turnsWithMarker, perTurn.length),
    romanMarkerTokens,
    devanagariMarkerTokens,
    devanagariScriptTokens,
    devanagariScriptTokenRatio: rate(devanagariScriptTokens, tokens.length),
  });
}
