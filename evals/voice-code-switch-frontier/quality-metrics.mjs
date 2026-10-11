const WORD = /[\p{L}\p{M}\p{N}]+/gu;

export function scoreTokens(value) {
  return [...String(value || "").normalize("NFC").toLocaleLowerCase("und").matchAll(WORD)]
    .map((match) => Object.freeze({ text: match[0], startUtf16: match.index, endUtf16: match.index + match[0].length }));
}

export const LANGUAGE_SPAN_CONTRACT = "vyakti-reviewed-language-spans/v1";

// Annotations describe linguistic runs, not script. Token offsets refer to
// scoreTokens(referenceText), with an exclusive end. Exact text binding and
// complete coverage prevent a stale or partial annotation from inventing a
// switch score. Reviewer identity is provenance, not proof of review quality.
function languageRuns(tokens, annotation, referenceText) {
  if (annotation !== undefined) {
    const invalid = () => { throw new Error("voice_language_spans_invalid"); };
    if (!annotation || annotation.contract !== LANGUAGE_SPAN_CONTRACT ||
        annotation.referenceText !== referenceText ||
        typeof annotation.reviewedBy !== "string" || !annotation.reviewedBy.trim() ||
        !Array.isArray(annotation.spans) || !tokens.length) invalid();
    const languages = [];
    for (const span of annotation.spans) {
      if (!span || !Number.isInteger(span.startToken) || !Number.isInteger(span.endToken) ||
          span.startToken !== languages.length || span.endToken <= span.startToken ||
          span.endToken > tokens.length || !["hi", "en", "neutral"].includes(span.language)) invalid();
      for (let index = span.startToken; index < span.endToken; index += 1) languages.push(span.language);
    }
    if (languages.length !== tokens.length) invalid();
    return languages;
  }
  return tokens.map((token) => {
    if (/[\u0900-\u097f]/u.test(token.text)) return "hi";
    if (/[a-z]/iu.test(token.text)) return "en";
    return "neutral";
  });
}

export function switchAdjacentIndexes(tokens, radius = 2, annotation, referenceText) {
  if (!Number.isInteger(radius) || radius < 1) throw new Error("voice_switch_radius_invalid");
  const languages = languageRuns(tokens, annotation, referenceText);
  const indexes = new Set();
  for (let index = 1; index < languages.length; index += 1) {
    const left = languages[index - 1];
    const right = languages[index];
    if (left === "neutral" || right === "neutral" || left === right) continue;
    for (let offset = -radius; offset <= radius - 1; offset += 1) {
      const candidate = index + offset;
      if (candidate >= 0 && candidate < tokens.length) indexes.add(candidate);
    }
  }
  return indexes;
}

function alignment(reference, observed) {
  const rows = reference.length + 1;
  const columns = observed.length + 1;
  const cost = Array.from({ length: rows }, () => Array(columns).fill(0));
  const back = Array.from({ length: rows }, () => Array(columns).fill(""));
  for (let row = 1; row < rows; row += 1) { cost[row][0] = row; back[row][0] = "delete"; }
  for (let column = 1; column < columns; column += 1) { cost[0][column] = column; back[0][column] = "insert"; }
  for (let row = 1; row < rows; row += 1) {
    for (let column = 1; column < columns; column += 1) {
      const same = reference[row - 1].text === observed[column - 1].text;
      const candidates = [
        { op: same ? "equal" : "substitute", value: cost[row - 1][column - 1] + (same ? 0 : 1), rank: 0 },
        { op: "delete", value: cost[row - 1][column] + 1, rank: 1 },
        { op: "insert", value: cost[row][column - 1] + 1, rank: 2 },
      ].sort((left, right) => left.value - right.value || left.rank - right.rank);
      cost[row][column] = candidates[0].value;
      back[row][column] = candidates[0].op;
    }
  }
  const operations = [];
  let row = reference.length;
  let column = observed.length;
  while (row > 0 || column > 0) {
    const op = back[row][column];
    if (op === "equal" || op === "substitute") {
      operations.push(Object.freeze({ op, referenceIndex: row - 1, observedIndex: column - 1 }));
      row -= 1; column -= 1;
    } else if (op === "delete") {
      operations.push(Object.freeze({ op, referenceIndex: row - 1, observedIndex: null }));
      row -= 1;
    } else {
      operations.push(Object.freeze({
        op: "insert",
        referenceIndex: null,
        insertionAfterReferenceIndex: row - 1,
        insertionBeforeReferenceIndex: row,
        observedIndex: column - 1,
      }));
      column -= 1;
    }
  }
  return Object.freeze(operations.reverse());
}

export function scoreSwitchAdjacentErrors(referenceText, observedText, radius = 2, { languageAnnotation } = {}) {
  const reference = scoreTokens(referenceText);
  const observed = scoreTokens(observedText);
  const switchIndexes = switchAdjacentIndexes(reference, radius, languageAnnotation, referenceText);
  const operations = alignment(reference, observed);
  let errors = 0;
  let switchErrors = 0;
  let repeatedInsertions = 0;
  for (const item of operations) {
    if (item.op === "equal") continue;
    errors += 1;
    const referenceIndexes = item.op === "insert"
      ? [item.insertionAfterReferenceIndex, item.insertionBeforeReferenceIndex]
      : [item.referenceIndex];
    if (referenceIndexes.some((index) => switchIndexes.has(index))) switchErrors += 1;
    if (item.op === "insert") {
      const token = observed[item.observedIndex]?.text;
      const previous = observed[item.observedIndex - 1]?.text;
      const next = observed[item.observedIndex + 1]?.text;
      if (token && (token === previous || token === next)) repeatedInsertions += 1;
    }
  }
  return Object.freeze({
    languageBoundaryMethod: languageAnnotation === undefined ? "script_heuristic" : "reviewed_language_spans",
    languageAnnotationReviewer: languageAnnotation?.reviewedBy ?? null,
    referenceTokenCount: reference.length,
    observedTokenCount: observed.length,
    errorCount: errors,
    wordErrorRate: reference.length ? errors / reference.length : null,
    switchAdjacentTokenCount: switchIndexes.size,
    switchAdjacentErrorCount: switchErrors,
    switchAdjacentWordErrorRate: switchIndexes.size ? switchErrors / switchIndexes.size : null,
    repeatedInsertionCount: repeatedInsertions,
    operations,
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function graphemeCount(value) {
  const text = String(value || "").normalize("NFC");
  if (!text) return 0;
  if (typeof Intl.Segmenter === "function") {
    return [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(text)].length;
  }
  return Array.from(text).length;
}

function percentile(values, quantile) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * quantile;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function timedWords(words, { requireProsody = false } = {}) {
  return (Array.isArray(words) ? words : []).map((word, index) => {
    const text = String(word?.text || "").normalize("NFC");
    const startMs = Number(word?.startMs);
    const endMs = Number(word?.endMs);
    const pitchHz = Number(word?.pitchHz);
    const energyDb = Number(word?.energyDb);
    if (!text || !Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
      throw new Error(`voice_word_timing_invalid:${index}`);
    }
    if (requireProsody && (!Number.isFinite(pitchHz) || pitchHz <= 0 || !Number.isFinite(energyDb))) {
      throw new Error(`voice_word_prosody_invalid:${index}`);
    }
    return Object.freeze({ index, text, startMs, endMs, durationMs: endMs - startMs, pitchHz, energyDb });
  });
}

export function prolongedWordIndexes(words) {
  const rows = timedWords(words).map((word) => Object.freeze({
    ...word,
    millisecondsPerGrapheme: word.durationMs / Math.max(1, graphemeCount(word.text)),
  }));
  const baseline = median(rows.filter((row) => row.durationMs >= 80).map((row) => row.millisecondsPerGrapheme));
  if (baseline === null) return Object.freeze([]);
  return Object.freeze(rows
    .filter((row) => row.durationMs >= 800 && row.millisecondsPerGrapheme >= baseline * 2.5)
    .map((row) => row.index));
}

// Returns measurements rather than a universal pass/fail threshold. Natural
// pauses vary by speaker and sentence, so a deployment gate must first be
// calibrated on the owner's real recordings.
export function switchBoundaryGapMeasurements(words) {
  const rows = timedWords(words);
  const languages = languageRuns(rows);
  const allGapsMs = [];
  const boundaries = [];
  for (let index = 1; index < rows.length; index += 1) {
    const gapMs = rows[index].startMs - rows[index - 1].endMs;
    if (gapMs < 0) throw new Error(`voice_word_timing_overlap:${index}`);
    allGapsMs.push(gapMs);
    if (languages[index - 1] !== "neutral" && languages[index] !== "neutral" &&
        languages[index - 1] !== languages[index]) {
      boundaries.push(Object.freeze({
        leftIndex: index - 1,
        rightIndex: index,
        leftLanguage: languages[index - 1],
        rightLanguage: languages[index],
        gapMs,
      }));
    }
  }
  const medianGapMs = median(allGapsMs);
  return Object.freeze({
    medianGapMs,
    languageBoundaryMethod: "script_heuristic",
    p90GapMs: percentile(allGapsMs, 0.9),
    boundaries: Object.freeze(boundaries.map((boundary) => Object.freeze({
      ...boundary,
      excessOverMedianMs: medianGapMs === null ? null : boundary.gapMs - medianGapMs,
    }))),
  });
}

// Objective acoustic descriptors for later blind evaluation. A wide range is
// not automatically "better" and a question need not always rise, so this
// deliberately reports evidence without inventing an unvalidated quality bar.
export function prosodyFeatureSummary(words, { emphasisIndexes = [] } = {}) {
  const rows = timedWords(words, { requireProsody: true });
  if (!rows.length) return Object.freeze({
    pitchRangeSemitones: null,
    energyRangeDb: null,
    finalPitchDeltaSemitones: null,
    emphasis: Object.freeze([]),
  });
  const pitchSemitones = rows.map((row) => 12 * Math.log2(row.pitchHz));
  const energy = rows.map((row) => row.energyDb);
  const durationMedian = median(rows.map((row) => row.durationMs));
  const pitchMedian = median(pitchSemitones);
  const energyMedian = median(energy);
  const marked = [...new Set(emphasisIndexes)].map((index) => {
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
      throw new Error(`voice_emphasis_index_invalid:${index}`);
    }
    return Object.freeze({
      index,
      text: rows[index].text,
      durationRatioToMedian: rows[index].durationMs / durationMedian,
      pitchDeltaSemitones: pitchSemitones[index] - pitchMedian,
      energyDeltaDb: energy[index] - energyMedian,
    });
  });
  return Object.freeze({
    pitchRangeSemitones: percentile(pitchSemitones, 0.9) - percentile(pitchSemitones, 0.1),
    energyRangeDb: percentile(energy, 0.9) - percentile(energy, 0.1),
    finalPitchDeltaSemitones: rows.length < 2 ? null : pitchSemitones.at(-1) - pitchSemitones.at(-2),
    emphasis: Object.freeze(marked),
  });
}
