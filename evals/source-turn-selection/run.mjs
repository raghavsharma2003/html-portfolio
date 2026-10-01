import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { selectSourceTurns, SOURCE_SELECTION_LIMITS } from "../../api/_group-recall/selection.js";

let passed = 0;
function check(name, work) {
  work();
  passed++;
  console.log(`ok ${passed} - ${name}`);
}
function source(order, text = "ordinary note", extra = {}) {
  return { sourceId: `source:${order}`, order: String(order), episodeId: "session:a",
    speakerId: `person:${Number(order) % 3}`, speakerLabel: null, recordedAt: null, text, ...extra };
}
function options(candidates, mode = "lexical_recency") {
  const current = candidates[candidates.length - 1];
  return { query: current.text, currentSourceId: current.sourceId,
    currentSpeakerId: current.speakerId, candidates, mode };
}
function pool(count = 40) {
  return Array.from({ length: count }, (_, index) => source(index + 1,
    index === count - 1 ? "cobalt glaze" : "ordinary note"));
}
function refused(input, reason = "invalid_input", selector = selectSourceTurns) {
  assert.throws(() => selector(input), (error) => {
    assert.equal(error.name, "SourceSelectionError");
    assert.equal(error.code, "source_selection_unavailable");
    assert.equal(error.message, "source_selection_unavailable");
    assert.equal(error.reason, reason);
    assert.equal(error.cause, undefined);
    assert.ok(Object.isFrozen(error));
    return true;
  });
}
function byteCheck(result) {
  assert.equal(result.serializedTurns, JSON.stringify(result.turns));
  assert.deepEqual(JSON.parse(result.turns[0].content), result.packet);
  assert.equal(result.metadata.payloadUtf8Bytes, Buffer.byteLength(result.serializedTurns, "utf8"));
  assert.ok(result.metadata.payloadUtf8Bytes <= SOURCE_SELECTION_LIMITS.payloadUtf8Bytes);
}
function deepFrozen(value) {
  if (value && typeof value === "object") {
    assert.ok(Object.isFrozen(value));
    for (const nested of Object.values(value)) deepFrozen(nested);
  }
}

check("fixed limits are frozen and cannot be caller-overridden", () => {
  assert.deepEqual(SOURCE_SELECTION_LIMITS, { candidates: 160, mandatoryRecent: 20, optionalOlder: 12,
    selected: 32, textUtf16: 4000, identityUtf16: 160, orderDigits: 40, queryTerms: 32,
    candidateUtf8Bytes: 524288, payloadUtf8Bytes: 32768 });
  assert.ok(Object.isFrozen(SOURCE_SELECTION_LIMITS));
  refused({ ...options(pool()), maxSelected: 33 });
});
check("recency retains exactly the latest 20 and current once", () => {
  const result = selectSourceTurns(options(pool(), "recency"));
  assert.deepEqual(result.selectedSourceIds, Array.from({ length: 20 }, (_, i) => `source:${i + 21}`));
  assert.equal(result.packet.history.length, 19);
  assert.equal(result.packet.current.sourceId, "source:40");
  assert.equal(result.turns[0].content.split("cobalt glaze").length - 1, 1);
  assert.deepEqual(result.rawTexts, [...result.packet.history.map((row) => row.text), "cobalt glaze"]);
  byteCheck(result);
});
check("short pools retain every record, including zero order", () => {
  const result = selectSourceTurns(options([source(0), source(1, "question")]));
  assert.equal(result.metadata.mandatoryCount, 2);
  assert.equal(result.metadata.optionalCount, 0);
  assert.deepEqual(result.selectedSourceIds, ["source:0", "source:1"]);
});
check("older positive lexical match is added with unchanged evidence", () => {
  const candidates = pool();
  candidates[1].text = "Original cobalt glaze recipe.\r\nदही 🧑🏽‍🎨";
  const result = selectSourceTurns(options(candidates));
  assert.equal(result.metadata.optionalCount, 1);
  assert.equal(result.packet.history[0].text, candidates[1].text);
  assert.deepEqual(result.packet.history[0].span, { unit: "utf16", start: 0, end: candidates[1].text.length });
  byteCheck(result);
});
check("rank uses distinct overlap then decimal recency and caps older at 12", () => {
  const candidates = pool();
  for (let i = 0; i < 20; i++) candidates[i].text = "cobalt glaze";
  const result = selectSourceTurns(options(candidates));
  assert.deepEqual(result.selectedSourceIds, Array.from({ length: 32 }, (_, i) => `source:${i + 9}`));
  assert.equal(result.metadata.optionalCount, 12);
});
check("keyword repetition cannot outrank a two-distinct-token match", () => {
  const candidates = pool();
  for (let i = 0; i < 20; i++) candidates[i].text = "cobalt ".repeat(10);
  candidates[0].text = "cobalt glaze";
  const result = selectSourceTurns(options(candidates));
  assert.ok(result.selectedSourceIds.includes("source:1"));
  assert.ok(!result.selectedSourceIds.includes("source:9"));
  assert.ok(result.selectedSourceIds.includes("source:10"));
});
check("NFKC and lowercase apply only to token copies", () => {
  const candidates = pool();
  candidates[0].text = "ＣＯＢＡＬＴ ＧＬＡＺＥ";
  const result = selectSourceTurns(options(candidates));
  assert.equal(result.packet.history[0].text, "ＣＯＢＡＬＴ ＧＬＡＺＥ");
  assert.equal(result.packet.history[0].sourceId, "source:1");
});
check("Unicode marks and Hindi tokens match without transliteration", () => {
  const candidates = pool();
  candidates[0].text = "नीला रंग café";
  candidates[1].text = "neela rang";
  candidates[39].text = "नीला cafe\u0301";
  const result = selectSourceTurns(options(candidates));
  assert.ok(result.selectedSourceIds.includes("source:1"));
  assert.ok(!result.selectedSourceIds.includes("source:2"));
});
check("no-match older sources are not admitted", () => {
  const result = selectSourceTurns(options(pool()));
  assert.equal(result.metadata.optionalCount, 0);
});
check("empty and whitespace questions remain exact with no optional matches", () => {
  for (const query of ["", " \r\n\t "]) {
    const candidates = pool();
    candidates[39].text = query;
    const result = selectSourceTurns(options(candidates));
    assert.equal(result.packet.current.text, query);
    assert.equal(result.metadata.queryTermCount, 0);
    assert.equal(result.metadata.optionalCount, 0);
  }
});
check("lexical caps unique query tokens at 32 while recency accepts long exact paragraphs", () => {
  const query = Array.from({ length: 32 }, (_, i) => `term${i}`).join(" ");
  assert.equal(selectSourceTurns(options([source(1, query)])).metadata.queryTermCount, 32);
  refused(options([source(1, `${query} extra`)]));
  const paragraph = Array.from({ length: 200 }, (_, i) => `term${i}`).join(" ");
  const recency = selectSourceTurns(options([source(1, paragraph)], "recency"));
  assert.equal(recency.packet.current.text, paragraph);
  assert.equal(recency.metadata.queryTermCount, 0);
  assert.deepEqual(recency.rawTexts, [paragraph]);
  byteCheck(recency);
  refused(options([source(1, paragraph)], "lexical_recency"));
  refused(options([source(1, "x".repeat(4001))], "recency"));
});
check("numeric order is exact beyond MAX_SAFE_INTEGER and input ordering is immaterial", () => {
  const older = source("9007199254740992", "cobalt");
  const current = source("9007199254740993", "query");
  const input = options([older, current]);
  input.candidates.reverse();
  assert.deepEqual(selectSourceTurns(input).selectedSourceIds, [older.sourceId, current.sourceId]);
});
check("speaker and subject stay distinct with unavailable lineage explicit", () => {
  const result = selectSourceTurns(options([source(1, "Bina says that Arun disagrees", { speakerId: "author:Charu" })]));
  const row = result.packet.current;
  assert.equal(row.speakerId, "author:Charu");
  for (const key of ["sourceRevision", "occurredAt", "replyToSourceId", "subjectIds"]) assert.equal(row[key], null);
  assert.equal(result.packet.interpretation, "historical_observations");
  assert.equal(result.packet.currentStateEstablished, false);
  assert.equal(result.packet.coverage, "host_supplied_candidate_pool");
  assert.equal(result.packet.temporalOrder, "recorded_source_order_not_event_time");
});
check("current roster labels are bounded metadata, never raw human vocabulary", () => {
  const result = selectSourceTurns(options([source(1, "Exact words", { speakerLabel: "Current Name" })]));
  assert.equal(result.packet.current.speakerLabel, "Current Name");
  assert.equal(result.packet.current.speakerLabelKind, "current_roster_label");
  assert.deepEqual(result.rawTexts, ["Exact words"]);
  assert.equal(selectSourceTurns(options([source(1)])).packet.current.speakerLabelKind, null);
  for (const label of [undefined, "", " space", "line\nbreak", "x".repeat(161)]) {
    refused(options([source(1, "q", { speakerLabel: label })]));
  }
});
check("source order is not recordedAt event ordering", () => {
  const result = selectSourceTurns(options([
    source(1, "old", { recordedAt: "2026-10-02T00:00:00.000Z" }),
    source(2, "new", { recordedAt: "2026-10-01T00:00:00.000Z" }),
  ]));
  assert.deepEqual(result.selectedSourceIds, ["source:1", "source:2"]);
});
check("calendar dates are canonical and valid, including leap days", () => {
  selectSourceTurns(options([source(1, "q", { recordedAt: "2024-02-29T00:00:00.000Z" })]));
  for (const date of ["2026-02-29T00:00:00.000Z", "2026-02-30T00:00:00.000Z", "2026-10-01", "2026-10-01T00:00:00Z", new Date(), 0]) {
    refused(options([source(1, "q", { recordedAt: date })]));
  }
});
check("whole output is deeply immutable and detached from caller records", () => {
  const candidates = pool();
  const result = selectSourceTurns(options(candidates));
  const before = JSON.stringify(result);
  deepFrozen(result);
  candidates[39].text = "changed";
  candidates[39].speakerId = "changed";
  candidates.push(source(41));
  assert.equal(JSON.stringify(result), before);
  assert.throws(() => { result.packet.current.text = "changed"; }, TypeError);
});
check("identity, order and exact current text mismatches fail closed", () => {
  for (const override of [{ currentSourceId: "source:1" }, { currentSpeakerId: "wrong" }, { query: "different" }]) {
    refused({ ...options(pool()), ...override }, "current_source_mismatch");
  }
  const rows = pool();
  const input = options(rows);
  input.candidates.push(source(41));
  refused(input, "current_source_mismatch");
});
check("duplicate IDs and duplicate orders refuse instead of deduplicating evidence", () => {
  refused(options([source(1), source(2, "q", { sourceId: "source:1" })]));
  refused(options([source(1), source(2, "q", { order: "1" })]));
});
check("decimal order rejects signs, padding, fractions, numbers and excessive digits", () => {
  for (const order of ["01", "-1", "+1", "1.0", "1e4", " 1", 1, "1".repeat(41)]) {
    refused(options([source(1, "q", { order })]));
  }
  selectSourceTurns(options([source("9".repeat(40), "q")]));
});
check("160 candidates pass and 161 or empty pools fail", () => {
  assert.equal(selectSourceTurns(options(pool(160))).metadata.candidateCount, 160);
  refused(options(pool(161)));
  refused({ query: "q", currentSourceId: "s", currentSpeakerId: "p", candidates: [], mode: "recency" });
});
check("exact text and identity limits reject oversized fields without truncation", () => {
  assert.equal(selectSourceTurns(options([source(1, "x".repeat(4000))])).packet.current.text.length, 4000);
  refused(options([source(1, "x".repeat(4001))]));
  for (const field of ["sourceId", "episodeId", "speakerId"]) {
    for (const value of ["", " x", "x ", "x\u0000", "x".repeat(161), 1]) {
      refused(options([source(1, "q", { [field]: value })]));
    }
  }
});
check("own getters on input and candidate are rejected without execution", () => {
  let calls = 0;
  const input = options([source(1, "q")]);
  Object.defineProperty(input, "query", { enumerable: true, get() { calls++; throw new Error("secret"); } });
  refused(input);
  const candidate = source(1, "q");
  Object.defineProperty(candidate, "text", { enumerable: true, get() { calls++; throw new Error("secret"); } });
  refused({ query: "q", currentSourceId: "source:1", currentSpeakerId: candidate.speakerId, candidates: [candidate], mode: "recency" });
  assert.equal(calls, 0);
});
check("toJSON, then and symbol hooks are not invoked", () => {
  let calls = 0;
  for (const key of ["toJSON", "then", Symbol.toStringTag]) {
    const candidate = source(1, "q");
    Object.defineProperty(candidate, key, { enumerable: true, get() { calls++; throw new Error("private"); } });
    refused(options([candidate]));
  }
  assert.equal(calls, 0);
});
check("sparse, accessor, inherited and extra-property arrays are rejected", () => {
  const basic = options([source(1, "q")]);
  const sparse = [source(1), , source(3, "q")];
  refused({ ...basic, candidates: sparse });
  let calls = 0;
  const accessor = [source(1, "q")];
  Object.defineProperty(accessor, "0", { enumerable: true, get() { calls++; return source(1, "q"); } });
  refused({ ...basic, candidates: accessor });
  const extra = [source(1, "q")]; extra.extra = true;
  refused({ ...basic, candidates: extra });
  const inherited = new Array(1);
  Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: source(1, "q") }));
  refused({ ...basic, candidates: inherited });
  assert.equal(calls, 0);
});
check("exotic records, inherited fields, hidden fields and assistant tags refuse", () => {
  class Custom { constructor() { Object.assign(this, source(1, "q")); } }
  const base = options([source(1, "q")]);
  for (const candidate of [new Custom(), new Date(), new Map(), Object.create(source(1, "q")), { ...source(1, "q"), role: "assistant" }]) {
    refused({ ...base, candidates: [candidate] });
  }
  const hidden = source(1, "q");
  Object.defineProperty(hidden, "text", { value: "q", enumerable: false });
  refused({ ...base, candidates: [hidden] });
});
check("null-prototype and cross-realm plain DTOs are supported", () => {
  const input = options([Object.assign(Object.create(null), source(1, "q"))]);
  selectSourceTurns(Object.assign(Object.create(null), input));
  const remote = vm.runInNewContext(`(${JSON.stringify(options([source(1, "q")]))})`);
  assert.equal(selectSourceTurns(remote).packet.current.text, "q");
});
check("malformed values and cycles emit content-free failures", () => {
  for (const input of [null, undefined, [], "PRIVATE_SENTINEL", {}, { ...options(pool()), mode: "semantic" }]) refused(input);
  for (const text of [undefined, NaN, Infinity, 1n, {}, []]) refused(options([source(1, "q", { text })]));
  const candidate = source(1, "q"); candidate.text = candidate;
  refused({ query: "PRIVATE_SENTINEL", currentSourceId: "source:1", currentSpeakerId: candidate.speakerId,
    candidates: [candidate], mode: "recency" });
});
check("UTF-8 measurement includes JSON wrappers, escapes, emoji and lone surrogates", () => {
  for (const text of ["quote\" slash\\ line\n", "हिन्दी 🎨 🧑🏽‍🎨", "\ud800 x \udfff", "\u0000\u0001\t\r\n"]) {
    const result = selectSourceTurns(options([source(1, text)]));
    byteCheck(result);
    assert.equal(result.packet.current.text, text);
    assert.ok(result.metadata.payloadUtf8Bytes > Buffer.byteLength(JSON.stringify(result.packet)));
  }
});

function exactPayloadPool() {
  const candidates = pool(20);
  // Keep span-end digit counts stable while adding exact ASCII byte padding.
  for (let index = 0; index < 19; index++) candidates[index].text = "x".repeat(1000);
  let result = selectSourceTurns(options(candidates, "recency"));
  let remaining = SOURCE_SELECTION_LIMITS.payloadUtf8Bytes - result.metadata.payloadUtf8Bytes;
  for (let index = 0; remaining > 0 && index < candidates.length - 1; index++) {
    const count = Math.min(4000 - candidates[index].text.length, remaining);
    candidates[index].text += "x".repeat(count);
    remaining -= count;
  }
  assert.equal(remaining, 0);
  result = selectSourceTurns(options(candidates, "recency"));
  assert.equal(result.metadata.payloadUtf8Bytes, SOURCE_SELECTION_LIMITS.payloadUtf8Bytes);
  return candidates;
}
check("exact 32768-byte final payload passes; one ASCII byte more refuses", () => {
  const candidates = exactPayloadPool();
  byteCheck(selectSourceTurns(options(candidates, "recency")));
  candidates.find((row, index) => index < 19 && row.text.length < 4000).text += "x";
  refused(options(candidates, "recency"), "required_context_over_budget");
});
check("escaping can exceed the final budget even when text bytes would fit", () => {
  const candidates = pool(20);
  candidates[0].text = "\\".repeat(4000);
  candidates[1].text = "\\".repeat(4000);
  assert.ok(candidates.reduce((sum, row) => sum + Buffer.byteLength(row.text), 0) < 32768);
  refused(options(candidates), "required_context_over_budget");
});
check("mandatory oversize fails instead of silently dropping newest sources", () => {
  const candidates = pool(20);
  for (let index = 0; index < 19; index++) candidates[index].text = "x".repeat(4000);
  refused(options(candidates), "required_context_over_budget");
});
check("oversized optional source is skipped while a later-ranked source can fit", () => {
  const mandatory = pool(20).map((row, index) => ({ ...row, sourceId: `source:${index + 3}`, order: String(index + 3) }));
  // Keep mandatory context near its limit while leaving space for one short row.
  let baseline = selectSourceTurns(options(mandatory));
  let padding = 32768 - baseline.metadata.payloadUtf8Bytes - 800;
  for (let i = 0; padding > 0 && i < mandatory.length - 1; i++) {
    const count = Math.min(4000 - mandatory[i].text.length, padding);
    mandatory[i].text += "z".repeat(count); padding -= count;
  }
  const result = selectSourceTurns(options([source(1, "cobalt"), source(2, `cobalt glaze ${"x".repeat(3987)}`), ...mandatory]));
  assert.ok(!result.selectedSourceIds.includes("source:2"));
  assert.ok(result.selectedSourceIds.includes("source:1"));
  assert.equal(result.metadata.optionalSkippedForBudgetCount, 1);
  assert.equal(result.metadata.mandatoryCount, 20);
  byteCheck(result);
});
check("exact candidate pool cap passes; one byte over rejects before selection", () => {
  const candidates = pool(160);
  let remaining = 524288 - Buffer.byteLength(JSON.stringify(candidates));
  for (let i = 0; remaining > 0 && i < 140; i++) {
    const count = Math.min(4000 - candidates[i].text.length, remaining);
    candidates[i].text += "x".repeat(count); remaining -= count;
  }
  assert.equal(remaining, 0);
  assert.equal(selectSourceTurns(options(candidates, "recency")).metadata.candidateUtf8Bytes, 524288);
  candidates.find((row, index) => index < 140 && row.text.length < 4000).text += "x";
  refused(options(candidates, "recency"), "candidate_context_over_budget");
});
check("candidate pool counts worst-case escaping, not text-only lengths", () => {
  const candidates = pool(160);
  for (let i = 0; i < 140; i++) candidates[i].text = "\u0000".repeat(1000);
  refused(options(candidates), "candidate_context_over_budget");
});
check("source labels and identity metadata are inside final source-turn bytes", () => {
  const rows = exactPayloadPool();
  rows[0].speakerLabel = "named person";
  refused(options(rows, "recency"), "required_context_over_budget");
});
check("duplicate historical text remains distinct attributed evidence", () => {
  const result = selectSourceTurns(options([source(1, "same words"), source(2, "same words")]));
  assert.equal(result.packet.history[0].text, result.packet.current.text);
  assert.notEqual(result.packet.history[0].sourceId, result.packet.current.sourceId);
  assert.equal(result.selectedSourceIds.length, 2);
});
check("two unrelated synthetic adapters need no Vyakti IDs or dependencies", () => {
  const document = source(9, "Keep the blue cover.", { sourceId: "comment:9", episodeId: "review:2", speakerId: "editor:ivy", speakerLabel: "Ivy" });
  const warehouse = source(18, "Hold pallet C.", { sourceId: "approval:18", episodeId: "shipment:4", speakerId: "inspector:lee", recordedAt: "2026-10-01T09:00:00.000Z" });
  for (const candidate of [document, warehouse]) {
    const result = selectSourceTurns(options([candidate]));
    assert.equal(result.packet.current.sourceId, candidate.sourceId);
    assert.equal(result.packet.current.episodeId, candidate.episodeId);
    byteCheck(result);
  }
});

const sourceUrl = new URL("../../api/_group-recall/selection.js", import.meta.url);
const implementation = readFileSync(sourceUrl, "utf8");
check("portable implementation has no imports, I/O, runtime timers or ambient providers", () => {
  assert.doesNotMatch(implementation, /\b(?:import\s|import\(|require\(|fetch\(|process\.|Buffer\.|setTimeout\(|setInterval\(|Date\.now\()/u);
});
check("private package exports only the portable four-file unit", () => {
  const manifest = JSON.parse(readFileSync(new URL("../../api/_group-recall/package.json", import.meta.url), "utf8"));
  assert.equal(manifest.name, "@vyakti/source-turn-selection");
  assert.equal(manifest.private, true);
  assert.equal(manifest.license, "UNLICENSED");
  assert.equal(manifest.dependencies, undefined);
  assert.equal(manifest.scripts, undefined);
  assert.deepEqual(manifest.files, ["selection.js", "selection.d.ts", "README.md"]);
  assert.deepEqual(manifest.exports["."], { types: "./selection.d.ts", import: "./selection.js", default: "./selection.js" });
});
check("declarations and README identify byte scope and authority limits", () => {
  const declarations = readFileSync(new URL("../../api/_group-recall/selection.d.ts", import.meta.url), "utf8");
  const readme = readFileSync(new URL("../../api/_group-recall/README.md", import.meta.url), "utf8");
  assert.match(declarations, /export function selectSourceTurns/u);
  assert.match(declarations, /speakerLabelKind: "current_roster_label" \| null/u);
  assert.match(readme, /Selection does not/u);
  assert.match(readme, /provider transport overhead/u);
  assert.match(readme, /entire admitted/u);
});

async function mutant(before, after) {
  assert.ok(implementation.includes(before), `mutation target absent: ${before}`);
  const mutated = implementation.replace(before, after);
  const encoded = Buffer.from(mutated).toString("base64");
  return (await import(`data:text/javascript;base64,${encoded}`)).selectSourceTurns;
}
const noByteLimit = await mutant("if (chosen.bytes > SOURCE_SELECTION_LIMITS.payloadUtf8Bytes)", "if (false)");
check("negative control proves required full-payload refusal is load-bearing", () => {
  const rows = exactPayloadPool();
  rows.find((row, index) => index < 19 && row.text.length < 4000).text += "x";
  assert.ok(noByteLimit(options(rows, "recency")).metadata.payloadUtf8Bytes > 32768);
  refused(options(rows, "recency"), "required_context_over_budget");
});
const weakCurrent = await mutant("current.text !== options.query", "false");
check("negative control proves exact current text binding is load-bearing", () => {
  const input = { ...options(pool()), query: "different" };
  assert.equal(weakCurrent(input).packet.current.text, "cobalt glaze");
  refused(input, "current_source_mismatch");
});
const weakSpeaker = await mutant("current.speakerId !== options.currentSpeakerId", "false");
check("negative control proves recorded current speaker binding is load-bearing", () => {
  const input = { ...options(pool()), currentSpeakerId: "other" };
  assert.equal(weakSpeaker(input).packet.current.speakerId, "person:1");
  refused(input, "current_source_mismatch");
});
const onlyNineteen = await mutant("mandatoryRecent: 20", "mandatoryRecent: 19");
check("negative control detects dropping one mandatory recent source", () => {
  assert.equal(onlyNineteen(options(pool(), "recency")).selectedSourceIds.length, 19);
  assert.equal(selectSourceTurns(options(pool(), "recency")).selectedSourceIds.length, 20);
});
const countCharacters = await mutant("bytes: utf8Bytes(serializedTurns)", "bytes: serializedTurns.length");
check("negative control detects Unicode character counting instead of UTF-8 bytes", () => {
  const rows = [source(1, "हिन्दी 🎨")];
  const result = countCharacters(options(rows));
  assert.notEqual(result.metadata.payloadUtf8Bytes, Buffer.byteLength(result.serializedTurns));
  byteCheck(selectSourceTurns(options(rows)));
});

console.log(`\n${passed} source-turn selection contract groups passed (${fileURLToPath(sourceUrl)})`);
