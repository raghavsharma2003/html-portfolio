/** Portable source selection. Input must already be authorized by the host.
 * No ranking decision, identity, or successful result confers permission.
 */
export const SOURCE_SELECTION_LIMITS = Object.freeze({
  candidates: 160,
  mandatoryRecent: 20,
  optionalOlder: 12,
  selected: 32,
  textUtf16: 4000,
  identityUtf16: 160,
  orderDigits: 40,
  queryTerms: 32,
  candidateUtf8Bytes: 524288,
  payloadUtf8Bytes: 32768,
});

const OBJECT_SOURCE = Function.prototype.toString.call(Object);
const ARRAY_SOURCE = Function.prototype.toString.call(Array);
const INPUT_FIELDS = ["query", "currentSourceId", "currentSpeakerId", "candidates", "mode"];
const SOURCE_FIELDS = ["sourceId", "order", "episodeId", "speakerId", "speakerLabel", "recordedAt", "text"];

function failure(reason) {
  return Object.freeze(Object.assign(new Error("source_selection_unavailable"), {
    name: "SourceSelectionError", code: "source_selection_unavailable", reason,
  }));
}

function reject() { throw failure("invalid_input"); }

function plainRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype === null) return true;
  if (Object.getPrototypeOf(prototype) !== null) return false;
  const constructor = Object.getOwnPropertyDescriptor(prototype, "constructor");
  return Boolean(constructor && "value" in constructor &&
    typeof constructor.value === "function" &&
    Function.prototype.toString.call(constructor.value) === OBJECT_SOURCE);
}

function fields(value, expected) {
  if (!plainRecord(value)) reject();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) reject();
  const result = Object.create(null);
  for (const key of expected) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || !("value" in property) || !property.enumerable) reject();
    result[key] = property.value;
  }
  return result;
}

function arrayValues(value) {
  if (!Array.isArray(value)) reject();
  const prototype = Object.getPrototypeOf(value);
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, "constructor");
  if (!constructor || !("value" in constructor) || typeof constructor.value !== "function" ||
      Function.prototype.toString.call(constructor.value) !== ARRAY_SOURCE) reject();
  const length = Object.getOwnPropertyDescriptor(value, "length");
  if (!length || !("value" in length) || !Number.isInteger(length.value) ||
      length.value < 1 || length.value > SOURCE_SELECTION_LIMITS.candidates) reject();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== length.value + 1) reject();
  const result = [];
  for (let index = 0; index < length.value; index++) {
    const entry = Object.getOwnPropertyDescriptor(value, String(index));
    if (!entry || !("value" in entry) || !entry.enumerable) reject();
    result.push(entry.value);
  }
  return result;
}

function identity(value) {
  if (typeof value !== "string" || !value || value.trim() !== value ||
      value.length > SOURCE_SELECTION_LIMITS.identityUtf16 || /[\u0000-\u001f\u007f]/u.test(value)) reject();
  return value;
}

function sourceText(value) {
  if (typeof value !== "string" || value.length > SOURCE_SELECTION_LIMITS.textUtf16) reject();
  return value;
}

function copySource(value) {
  const entry = fields(value, SOURCE_FIELDS);
  const sourceId = identity(entry.sourceId);
  const episodeId = identity(entry.episodeId);
  const speakerId = identity(entry.speakerId);
  const speakerLabel = entry.speakerLabel === null ? null : identity(entry.speakerLabel);
  const order = entry.order;
  if (typeof order !== "string" || !/^(0|[1-9][0-9]{0,39})$/u.test(order)) reject();
  const recordedAt = entry.recordedAt;
  if (recordedAt !== null) {
    if (typeof recordedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(recordedAt) ||
        !Number.isFinite(Date.parse(recordedAt)) || new Date(recordedAt).toISOString() !== recordedAt) reject();
  }
  const text = sourceText(entry.text);
  return Object.freeze({ sourceId, order, episodeId, speakerId, speakerLabel, recordedAt, text });
}

// Numeric order without Number conversion or BigInt/runtime dependence.
function compareOrder(left, right) {
  return left.order.length - right.order.length || (left.order < right.order ? -1 : left.order > right.order ? 1 : 0);
}

function utf8Bytes(text) {
  let bytes = 0;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes++;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length &&
        text.charCodeAt(index + 1) >= 0xdc00 && text.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index++;
    } else bytes += 3;
  }
  return bytes;
}

// Scoring v1 is frozen before evaluation: distinct query-token intersection.
// No stemming, stop words, frequency bonus, transliteration or semantic matching.
function tokens(text) {
  return new Set(text.normalize("NFKC").toLowerCase().match(/[\p{L}\p{M}\p{N}]+/gu) || []);
}

function record(source) {
  return Object.freeze({
    sourceId: source.sourceId,
    order: source.order,
    episodeId: source.episodeId,
    speakerId: source.speakerId,
    speakerLabel: source.speakerLabel,
    speakerLabelKind: source.speakerLabel === null ? null : "current_roster_label",
    sourceRevision: null,
    recordedAt: source.recordedAt,
    occurredAt: null,
    replyToSourceId: null,
    subjectIds: null,
    text: source.text,
    span: Object.freeze({ unit: "utf16", start: 0, end: source.text.length }),
  });
}

function render(selected, current, mode, candidateCount, mandatoryCount, queryTermCount) {
  const ordered = [...selected].sort(compareOrder);
  const packet = Object.freeze({
    schema: "source_turns/v1",
    interpretation: "historical_observations",
    currentStateEstablished: false,
    coverage: "host_supplied_candidate_pool",
    temporalOrder: "recorded_source_order_not_event_time",
    replyAncestryAvailable: false,
    selection: Object.freeze({ mode, candidateCount, mandatoryCount,
      optionalCount: ordered.length - mandatoryCount, queryTermCount }),
    limits: Object.freeze({ sourceTextUtf16: SOURCE_SELECTION_LIMITS.textUtf16,
      selectedSources: SOURCE_SELECTION_LIMITS.selected, payloadUtf8Bytes: SOURCE_SELECTION_LIMITS.payloadUtf8Bytes }),
    current: record(current),
    history: Object.freeze(ordered.filter((source) => source.sourceId !== current.sourceId).map(record)),
  });
  const turns = Object.freeze([Object.freeze({ role: "user", content: JSON.stringify(packet) })]);
  const serializedTurns = JSON.stringify(turns);
  return { ordered, packet, turns, serializedTurns, bytes: utf8Bytes(serializedTurns) };
}

/** Synchronous, pure, fail-closed selection of already-authorized human sources.
 * Accept inert own-data DTOs only. Hostile Proxies and modified built-ins are
 * outside this contract; JavaScript cannot detect Proxies without their traps.
 */
export function selectSourceTurns(input) {
  let options;
  let candidates;
  let queryTerms;
  try {
    options = fields(input, INPUT_FIELDS);
    options.query = sourceText(options.query);
    options.currentSourceId = identity(options.currentSourceId);
    options.currentSpeakerId = identity(options.currentSpeakerId);
    if (!["recency", "lexical_recency"].includes(options.mode)) reject();
    candidates = arrayValues(options.candidates).map(copySource);
    const ids = new Set(candidates.map((source) => source.sourceId));
    const orders = new Set(candidates.map((source) => source.order));
    if (ids.size !== candidates.length || orders.size !== candidates.length) reject();
    // Recency does not rank by query. Its availability must not depend on the
    // lexical-mode token cap when the exact current text fits the text budget.
    queryTerms = options.mode === "lexical_recency" ? tokens(options.query) : new Set();
    if (queryTerms.size > SOURCE_SELECTION_LIMITS.queryTerms) reject();
  } catch { throw failure("invalid_input"); }

  candidates.sort(compareOrder);
  const current = candidates[candidates.length - 1];
  if (current.sourceId !== options.currentSourceId || current.speakerId !== options.currentSpeakerId ||
      current.text !== options.query) throw failure("current_source_mismatch");
  const candidateUtf8Bytes = utf8Bytes(JSON.stringify(candidates));
  if (candidateUtf8Bytes > SOURCE_SELECTION_LIMITS.candidateUtf8Bytes) throw failure("candidate_context_over_budget");

  const mandatoryCount = Math.min(SOURCE_SELECTION_LIMITS.mandatoryRecent, candidates.length);
  const mandatory = candidates.slice(-mandatoryCount);
  let chosen = render(mandatory, current, options.mode, candidates.length, mandatoryCount, queryTerms.size);
  if (chosen.bytes > SOURCE_SELECTION_LIMITS.payloadUtf8Bytes) throw failure("required_context_over_budget");
  let optionalSkippedForBudgetCount = 0;
  if (options.mode === "lexical_recency" && queryTerms.size > 0) {
    const ranked = candidates.slice(0, -mandatoryCount).map((source) => {
      const sourceTerms = tokens(source.text);
      let score = 0;
      for (const term of queryTerms) if (sourceTerms.has(term)) score++;
      return { source, score };
    }).filter((entry) => entry.score > 0).sort((left, right) => right.score - left.score || compareOrder(right.source, left.source));
    for (const entry of ranked) {
      if (chosen.ordered.length >= SOURCE_SELECTION_LIMITS.selected ||
          chosen.ordered.length - mandatoryCount >= SOURCE_SELECTION_LIMITS.optionalOlder) break;
      const proposed = render([...chosen.ordered, entry.source], current, options.mode,
        candidates.length, mandatoryCount, queryTerms.size);
      if (proposed.bytes > SOURCE_SELECTION_LIMITS.payloadUtf8Bytes) {
        optionalSkippedForBudgetCount++;
      } else chosen = proposed;
    }
  }

  return Object.freeze({
    packet: chosen.packet,
    turns: chosen.turns,
    serializedTurns: chosen.serializedTurns,
    rawTexts: Object.freeze(chosen.ordered.map((source) => source.text)),
    selectedSourceIds: Object.freeze(chosen.ordered.map((source) => source.sourceId)),
    metadata: Object.freeze({ mode: options.mode, candidateCount: candidates.length,
      selectedCount: chosen.ordered.length, mandatoryCount,
      optionalCount: chosen.ordered.length - mandatoryCount, queryTermCount: queryTerms.size,
      optionalSkippedForBudgetCount, payloadUtf8Bytes: chosen.bytes, candidateUtf8Bytes }),
  });
}
