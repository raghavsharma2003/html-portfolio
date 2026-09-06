import { readReconciledMigration } from "../lib/reconciled-migration.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  CONTEXT_TEXT_EVIDENCE_CLEAR_SQL,
  CONTEXT_EVIDENCE_WRITE_SQL,
  clearContextCanonicalTextEvidence,
  createContextImageEvidence,
  createContextTextEvidence,
  persistContextCanonicalEvidence,
  verifyContextCanonicalEvidence,
} from "../../api/_experience-compiler/context-evidence.js";
import { inspectImage } from "../../api/_context/image.js";
import { addContextFile } from "../../api/_context-locker.js";

let checks = 0;
const ok = (name, condition) => { assert.ok(condition, name); checks++; console.log(`PASS  ${name}`); };
const equal = (name, actual, expected) => { assert.deepEqual(actual, expected, name); checks++; console.log(`PASS  ${name}`); };
const rejects = (name, code, action) => {
  assert.throws(action, (error) => error?.code === code, name);
  checks++;
  console.log(`PASS  ${name}  ${code}`);
};
const hex = (value) => createHash("sha256").update(String(value)).digest("hex");

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SOURCE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const ITEM = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const BODY = `${"My exact owner-authored notes. ".repeat(300)}\ud83d\ude42 tail`;

function textInput(overrides = {}) {
  return {
    replicaId: REPLICA,
    ownerUserId: OWNER,
    sourceId: SOURCE,
    itemId: ITEM,
    inputSha256: hex("raw-document"),
    format: "docx",
    extractor: "docx-ooxml/v1",
    body: BODY,
    segments: [{ start: 0, end: BODY.length, speaker: "", text: BODY }],
    authorship: "mine",
    ownerSpeaker: "",
    ...overrides,
  };
}

console.log("\n-- exact document and text evidence --");
const first = createContextTextEvidence(textInput());
const replay = createContextTextEvidence(textInput());
equal("same source and stored text produce byte-stable evidence", replay, first);
ok("a long document is bounded into non-empty 8k rows", first.length === 2 && first.every((row) => row.value.text.length <= 8_000));
ok("each document row binds exact canonical offsets", first.every((row) => {
  const { start_char: start, end_char: end } = row.value.locator;
  return BODY.slice(start, end) === row.value.text && row.value.locator.unit === "utf16_code_units";
}));
ok("page mapping is unavailable rather than fabricated", first.every((row) => row.value.locator.page_mapping === "unavailable"));
ok("raw bytes and canonical text have separate commitments", first.every((row) =>
  row.input_sha256 === hex("raw-document") && row.value.provenance.canonical_text_sha256 === hex(BODY)));
ok("no evidence row claims semantics, protected traits, or inner state", first.every((row) =>
  row.value.semantic_inference === false && row.value.provenance.protected_trait_inference === false && row.value.provenance.inner_state_inference === false));
ok("every document commitment verifies", first.every((row) => verifyContextCanonicalEvidence(row) === row));
equal("unknown authorship produces no owner text evidence", createContextTextEvidence(textInput({ authorship: "unknown" })), []);
equal("another person's declared writing produces no owner text evidence", createContextTextEvidence(textInput({ authorship: "not_mine" })), []);
const otherOwner = createContextTextEvidence(textInput({ ownerUserId: OTHER }));
ok("owner scope changes every evidence commitment", otherOwner[0].record_hash !== first[0].record_hash);
const tampered = JSON.parse(JSON.stringify(first[0]));
tampered.value.text = `x${tampered.value.text.slice(1)}`;
rejects("tampering one character breaks the commitment", "context_evidence_commitment_invalid", () => verifyContextCanonicalEvidence(tampered));
const contractTamper = { ...first[0], confidence: 0.4 };
rejects("a non-observed confidence cannot enter the canonical adapter", "context_evidence_contract_invalid", () => verifyContextCanonicalEvidence(contractTamper));

console.log("\n-- chat attribution and fragment citations --");
const CHAT = "Arjun\tmeri exact line\nPriya\ther private line\nArjun\tmera second answer";
const arjunStart1 = CHAT.indexOf("meri exact line");
const priyaStart = CHAT.indexOf("her private line");
const arjunStart2 = CHAT.indexOf("mera second answer");
const segments = [
  { start: arjunStart1, end: arjunStart1 + "meri exact line".length, speaker: "Arjun", text: "meri exact line" },
  { start: priyaStart, end: priyaStart + "her private line".length, speaker: "Priya", text: "her private line" },
  { start: arjunStart2, end: arjunStart2 + "mera second answer".length, speaker: "Arjun", text: "mera second answer" },
];
const chat = createContextTextEvidence(textInput({
  body: CHAT,
  format: "whatsapp_export",
  extractor: "whatsapp-export/v1",
  ownerSpeaker: "Arjun",
  authorship: "unknown",
  segments,
}));
ok("chat evidence contains only the declared owner's words", chat.length === 1 && !chat[0].value.text.includes("private line") && chat[0].value.text.includes("exact line"));
ok("every local chat fragment resolves to the exact stored source span", chat[0].value.locator.fragments.every((fragment) =>
  chat[0].value.text.slice(fragment.local_start_char, fragment.local_end_char) === CHAT.slice(fragment.source_start_char, fragment.source_end_char)
  && fragment.speaker === "Arjun"));
equal("an unattributed chat creates no evidence", createContextTextEvidence(textInput({
  body: CHAT, format: "whatsapp_export", extractor: "whatsapp-export/v1", ownerSpeaker: "", segments,
})), []);
rejects("a mismatched stored segment is refused", "context_evidence_segment_mismatch", () => createContextTextEvidence(textInput({
  body: CHAT,
  format: "whatsapp_export",
  extractor: "whatsapp-export/v1",
  ownerSpeaker: "Arjun",
  segments: [{ ...segments[0], text: "fabricated" }],
})));

console.log("\n-- image geometry, without OCR or interpretation --");
const png = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png, 0);
png.write("IHDR", 12, "ascii");
png.writeUInt32BE(1080, 16);
png.writeUInt32BE(1920, 20);
equal("PNG dimensions come from the verified container header", inspectImage(png), { format: "png", mime: "image/png", width: 1080, height: 1920 });
const image = createContextImageEvidence({
  replicaId: REPLICA,
  ownerUserId: OWNER,
  sourceId: SOURCE,
  itemId: ITEM,
  inputSha256: createHash("sha256").update(png).digest("hex"),
  format: "png",
  width: 1080,
  height: 1920,
});
ok("image evidence is one exact full-image rectangle", image.length === 1 && image[0].evidence_type === "image_region"
  && image[0].value.locator.x === 0 && image[0].value.locator.y === 0
  && image[0].value.locator.width === 1080 && image[0].value.locator.height === 1920);
ok("image evidence contains no OCR text or visual assertion", !Object.hasOwn(image[0].value, "text")
  && image[0].value.ocr.status === "not_run" && image[0].value.visual_assertions.status === "not_run");
ok("image commitment verifies", verifyContextCanonicalEvidence(image[0]) === image[0]);
rejects("impossible image dimensions are refused", "context_image_width_invalid", () => createContextImageEvidence({
  replicaId: REPLICA, ownerUserId: OWNER, sourceId: SOURCE, itemId: ITEM,
  inputSha256: hex("image"), format: "png", width: 0, height: 10,
}));

console.log("\n-- owner-scoped persistence and deletion reach --");
const calls = [];
const result = await persistContextCanonicalEvidence(async (sql, params) => {
  calls.push({ sql, params });
  return [{ total: JSON.parse(params[3]).length }];
}, { itemId: ITEM, replicaId: REPLICA, ownerUserId: OWNER, records: first });
equal("a complete retry-safe persistence reports every record covered", result, { expected: first.length, covered: first.length });
ok("write SQL binds item, owner, replica, source and raw hash before insertion", /i\.item_id=\$1::uuid/.test(CONTEXT_EVIDENCE_WRITE_SQL)
  && /i\.replica_id=\$2::uuid/.test(CONTEXT_EVIDENCE_WRITE_SQL)
  && /i\.owner_user_id=\$3::uuid/.test(CONTEXT_EVIDENCE_WRITE_SQL)
  && /s\.sha256=i\.content_sha256/.test(CONTEXT_EVIDENCE_WRITE_SQL)
  && /i\.source_id=\(d\.item->>'source_id'\)::uuid/.test(CONTEXT_EVIDENCE_WRITE_SQL));
ok("only the two explicit evidence types can enter this adapter", /in \('text_span','image_region'\)/.test(CONTEXT_EVIDENCE_WRITE_SQL));
ok("idempotence is a database conflict rule plus exact coverage readback", /on conflict do nothing/.test(CONTEXT_EVIDENCE_WRITE_SQL) && /record_hash=d\.item->>'record_hash'/.test(CONTEXT_EVIDENCE_WRITE_SQL));
await assert.rejects(() => persistContextCanonicalEvidence(async () => [{ total: 0 }], {
  itemId: ITEM, replicaId: REPLICA, ownerUserId: OWNER, records: first,
}), (error) => error?.code === "context_evidence_persist_denied");
checks++;
console.log("PASS  incomplete persistence fails closed");

const clearCalls = [];
equal("re-attribution clears stale text observations before replacement", await clearContextCanonicalTextEvidence(async (sql, params) => {
  clearCalls.push({ sql, params });
  return [{ removed: 2 }];
}, { itemId: ITEM, replicaId: REPLICA, ownerUserId: OWNER }), { removed: 2 });
ok("clear is owner-scoped and supersedes claims from the old attribution", /i\.owner_user_id=\$3::uuid/.test(CONTEXT_TEXT_EVIDENCE_CLEAR_SQL)
  && /status='superseded'/.test(CONTEXT_TEXT_EVIDENCE_CLEAR_SQL)
  && /e\.evidence_type='text_span'/.test(CONTEXT_TEXT_EVIDENCE_CLEAR_SQL));

console.log("\n-- real Context Locker caller, with only its database and storage seams replaced --");
function callerHarness() {
  const state = { items: [], texts: new Map(), evidence: [], sources: [] };
  const db = async (sql, params) => {
    const head = sql.trimStart();
    if (sql.includes("insert into vy_replica_processing_evidence")) {
      const records = JSON.parse(params[3]);
      const item = state.items.find((candidate) => candidate.item_id === params[0]
        && candidate.replica_id === params[1] && candidate.owner_user_id === params[2]);
      const source = state.sources.find((candidate) => candidate.source_id === item?.source_id
        && candidate.state === "ready" && candidate.sha256 === item?.content_sha256);
      if (!item || !source) return [{ total: 0 }];
      for (const record of records) {
        if (!state.evidence.some((candidate) => candidate.evidence_id === record.evidence_id)) state.evidence.push(record);
      }
      return [{ total: records.every((record) => state.evidence.some((candidate) =>
        candidate.evidence_id === record.evidence_id && candidate.record_hash === record.record_hash)) ? records.length : 0 }];
    }
    if (head.startsWith("select r.replica_id")) return params[0] === REPLICA && params[1] === OWNER ? [{ replica_id: REPLICA }] : [];
    if (head.startsWith("select count(*)::int as items")) {
      const mine = state.items.filter((item) => item.owner_user_id === params[0]);
      return [{ items: mine.length, bytes: mine.reduce((sum, item) => sum + item.byte_size, 0) }];
    }
    if (sql.includes("insert into vy_context_item")) {
      const row = {
        item_id: params[0], replica_id: params[1], owner_user_id: params[2], kind: params[3],
        format: params[4], source_name: params[5], source_url: params[6], content_sha256: params[7],
        byte_size: params[8], extracted_chars: params[9], extractor: params[10], status: params[11],
        refusal_reason: params[12], routed_to: params[13], mine_skip_reason: params[14], authorship: params[15],
        owner_speaker: params[16], consent_scope: params[17], source_id: params[21], run_id: null,
        created_at: "now", updated_at: "now",
      };
      state.items.push(row);
      if (params[9] > 0) state.texts.set(row.item_id, params[20]);
      return [{ ...row }];
    }
    if (sql.includes("update vy_context_item\n        set status")) {
      const row = state.items.find((candidate) => candidate.item_id === params[0] && candidate.owner_user_id === params[1]);
      if (!row) return [];
      Object.assign(row, { status: params[2], mine_skip_reason: params[3], run_id: params[4] ?? row.run_id });
      return [{ ...row }];
    }
    throw new Error(`caller harness unrouted SQL: ${sql.slice(0, 100)}`);
  };
  let sequence = 0;
  const deps = {
    createCanonicalSource: async ({ contentSha256, format }) => {
      const source = {
        source_id: `10000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
        state: "ready", sha256: contentSha256, format,
      };
      state.sources.push(source);
      return source;
    },
    discardCanonicalSource: async () => {},
  };
  return { state, db, deps };
}

const textCaller = callerHarness();
const textAdded = await addContextFile(textCaller.db, OWNER, REPLICA, {
  filename: "owner.txt", bytes: Buffer.from("These exact words are my own short note."), authorship: "mine",
}, textCaller.deps);
ok("the browser upload caller stores a source-linked item", textAdded.item.item_id === textCaller.state.items[0].item_id
  && textCaller.state.items[0].source_id === textCaller.state.sources[0].source_id);
ok("the browser upload caller reaches canonical text evidence", textCaller.state.evidence.length === 1
  && textCaller.state.evidence[0].evidence_type === "text_span"
  && textCaller.state.evidence[0].value.text === "These exact words are my own short note.");

const imageCaller = callerHarness();
const imageAdded = await addContextFile(imageCaller.db, OWNER, REPLICA, {
  filename: "screen.png", bytes: png, authorship: "unknown",
}, imageCaller.deps);
ok("the browser image caller reaches exact pixel-region evidence", imageAdded.image.width === 1080
  && imageCaller.state.evidence.length === 1 && imageCaller.state.evidence[0].evidence_type === "image_region");
ok("the browser image caller reports the named OCR gap", imageAdded.proposal.reason === "image_ocr_not_configured");

const migration = readReconciledMigration("db/migrations/070_context_canonical_evidence.sql");
const locker = readFileSync(new URL("../../api/_context-locker.js", import.meta.url), "utf8");
const source = readFileSync(new URL("../../api/_replica-source.js", import.meta.url), "utf8");
ok("migration extends existing evidence and source authorities, not a new table", migration.includes("'text_span','image_region'")
  && migration.includes("add column if not exists source_id uuid") && !/create table/i.test(migration));
ok("source deletion cascades through context item and canonical text", /vy_context_item_source_fk/.test(migration)
  && /vy_context_item_text_item_fk/.test(migration) && (migration.match(/on delete cascade/g) || []).length === 2);
ok("owner removal deletes evidence immediately and queues exact private source erasure", /removed_evidence as/.test(locker)
  && /source_erasure as/.test(locker) && /state='deleting'/.test(locker));
ok("Context Locker sources never enter the voice source list", /provenance->>'purpose' = 'context_item'/.test(source));
ok("Context source finalization rechecks live capture and storage and does not enqueue audio jobs", /finalizeOwnedContextSource/.test(source)
  && /array\['capture','storage'\]/.test(source));

console.log(`\n${checks} context canonical evidence checks passed`);
