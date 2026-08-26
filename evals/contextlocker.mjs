// The Context Locker (Gurukul WS-AB) — extraction, refusal, dedup, quota,
// ownership, citation integrity, and speaker attribution, end to end.
//
//   node evals/contextlocker.mjs
//
// Offline, deterministic, $0, no DB and no network. It drives the REAL
// `addContextFile` / `addContextLink` / `remineContextItem` through a fake `db`
// and fixture bytes, so the code path this suite reaches is the code path a
// browser upload reaches; only the database seam is replaced.
//
// ── what this suite is actually guarding ─────────────────────────────────
//
// 1. EVERY ITEM TYPE ANSWERS FOR ITSELF. The matrix is the deliverable: each
//    accepted format extracts, each refused format refuses BY NAME, and each
//    routed kind names the lane it belongs to. A format that was quietly
//    stored-and-ignored would pass a suite that only checked the happy path,
//    so the refusals are asserted as loudly as the acceptances — including a
//    CORRUPTED file, which is the case most likely to produce a plausible
//    empty success (`plausible-return-hides-a-dead-pipeline`).
//
// 2. CITATION INTEGRITY, WITH ITS NEGATIVE CONTROL. Every proposed addition
//    names an item AND a span, and `body.slice(span)` really contains the
//    fragment. The control is a FABRICATED citation — right item, right
//    fragment, a span pointing somewhere else — and the suite asserts it is
//    REJECTED. Without that control, "cited" is a word the pipeline prints.
//
// 3. SPEAKER ATTRIBUTION, WITH ITS NEGATIVE CONTROL. A chat export mined for
//    the owner must cite ONLY the owner's messages. The control re-mines the
//    same export declaring the OTHER party as the owner and asserts that not
//    one citation lands on the real owner's lines — because a lane that mined
//    the wrong speaker would still produce confident, cited, well-formed
//    proposals, and a person's clone would start talking like their mother.
//
// 4. THE CAPS ARE REFUSALS. Item quota, byte quota and per-item size each
//    refuse with the numbers attached. Nothing is trimmed (`silent-truncation`).
//
// 5. OWNERSHIP IS A PREDICATE. Another owner's replica is UNREACHABLE, not
//    filtered: the fake db's ownership CTE returns nothing, and the suite
//    asserts the answer is the same "not found" a nonexistent replica gets —
//    a distinguishable 403 would be an existence oracle over the uuid space.
//
// 6. NO STATEMENT NAMES vy_teacher_sheet. Asserted over every SQL string the
//    locker sends, the same absence evals/channel.mjs asserts over the sweep.
import { deflateRawSync } from "node:zlib";
import { createHash } from "node:crypto";
import {
  addContextFile,
  addContextLink,
  listContextItems,
  remineContextItem,
  removeContextItem,
  MAX_ITEMS_PER_OWNER,
  MAX_BYTES_PER_OWNER,
  MAX_ITEM_BYTES,
} from "../api/_context-locker.js";
import { citationResolves, citationViolations } from "../api/_context-mining.js";
import { extractFile } from "../api/_context/extract.js";
import { ContextRefusal } from "../api/_context/limits.js";

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

// ─────────────────────────────────────────────────────────────────────────
// the fake db — it honours 058's constraints, because those are the rules
// this suite exists to check and a fake that ignored them would be checking
// itself (evals/channel.mjs's fake honours 053's approval gate for the same
// reason and says so).
// ─────────────────────────────────────────────────────────────────────────
function fakeDb(state) {
  const calls = [];
  // ROUTED ON THE STATEMENT, NEVER ON A TABLE NAME.
  // `router-matched-a-table-instead-of-a-statement` is the rejection this
  // ordering exists to avoid, and it bit this very suite once: the insert's
  // `with owned as (select r.replica_id from vy_replica r …)` CTE contains
  // both of the standalone reads' text, so a table-name router answered the
  // ownership query for the INSERT and silently reported a quota refusal.
  // Writes are matched first, and the reads are matched on how they START.
  const db = async (sql, params) => {
    calls.push(sql);
    const head = sql.trimStart();

    if (sql.includes("insert into vy_context_item")) {
      const [itemId, replicaId, ownerUserId, kind, format, sourceName, sourceUrl, hash,
        byteSize, chars, extractor, status, refusalReason, routedTo, mineSkip, authorship,
        ownerSpeaker, consentScope, maxItems, maxBytes, body] = params;
      if (!state.replicas.some((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)) return [];
      const mine = state.items.filter((i) => i.owner_user_id === ownerUserId);
      // the quota predicate, exactly as the statement spells it
      if (mine.length >= maxItems) return [];
      if (mine.reduce((n, i) => n + i.byte_size, 0) + byteSize > maxBytes) return [];
      // the unique index on (replica_id, content_sha256)
      if (state.items.some((i) => i.replica_id === replicaId && i.content_sha256 === hash)) return [];
      // 058's CHECK constraints
      if (status === "refused" && !refusalReason) throw Object.assign(new Error("vy_context_item_refusal_named"), { code: "23514" });
      if (status === "routed" && !routedTo) throw Object.assign(new Error("vy_context_item_routing_named"), { code: "23514" });
      const row = {
        item_id: itemId, replica_id: replicaId, owner_user_id: ownerUserId, kind, format,
        source_name: sourceName, source_url: sourceUrl, content_sha256: hash,
        byte_size: byteSize, extracted_chars: chars, extractor, status,
        refusal_reason: refusalReason, routed_to: routedTo, mine_skip_reason: mineSkip,
        authorship, owner_speaker: ownerSpeaker, consent_scope: consentScope, run_id: null,
        created_at: `t${state.items.length}`, updated_at: `t${state.items.length}`,
      };
      state.items.push(row);
      if (chars > 0) state.texts.set(itemId, body);
      return [{ ...row }];
    }

    if (sql.includes("update vy_context_item\n        set status")) {
      const [itemId, ownerUserId, status, skip, runId] = params;
      const row = state.items.find((i) => i.item_id === itemId && i.owner_user_id === ownerUserId);
      if (!row) return [];
      Object.assign(row, { status, mine_skip_reason: skip, run_id: runId ?? row.run_id });
      return [{ ...row }];
    }

    if (sql.includes("update vy_context_item set authorship")) {
      const [itemId, ownerUserId, authorship, ownerSpeaker] = params;
      const row = state.items.find((i) => i.item_id === itemId && i.owner_user_id === ownerUserId);
      if (row) Object.assign(row, { authorship, owner_speaker: ownerSpeaker });
      return [];
    }

    if (sql.includes("insert into vy_ingest_run")) {
      const [runId, replicaId, ownerUserId, videoRef, stats, delta, count] = params;
      if (state.runs.some((r) => r.replica_id === replicaId && r.video_ref === videoRef)) return [];
      const row = {
        run_id: runId, replica_id: replicaId, owner_user_id: ownerUserId, watch_id: null,
        video_ref: videoRef, transcript_source: "context_item", stats: JSON.parse(stats),
        proposed_delta: JSON.parse(delta), proposed_delta_count: count, status: "proposed",
        approved_by_user_id: null, decided_at: null,
      };
      state.runs.push(row);
      return [{ run_id: runId, status: "proposed", proposed_delta_count: count }];
    }

    if (sql.includes("delete from vy_context_item\n")) {
      const [itemId, replicaId, ownerUserId] = params;
      const at = state.items.findIndex((i) => i.item_id === itemId && i.replica_id === replicaId && i.owner_user_id === ownerUserId);
      if (at < 0) return [];
      state.items.splice(at, 1);
      state.texts.delete(itemId);
      return [{ item_id: itemId }];
    }

    // ── the reads, matched on how the statement STARTS ────────────────────
    if (head.startsWith("select r.replica_id")) {
      const [replicaId, ownerUserId] = params;
      return state.replicas.some((r) => r.replica_id === replicaId && r.owner_user_id === ownerUserId)
        ? [{ replica_id: replicaId }]
        : [];
    }

    if (head.startsWith("select count(*)::int as items")) {
      const mine = state.items.filter((i) => i.owner_user_id === params[0]);
      return [{ items: mine.length, bytes: mine.reduce((n, i) => n + i.byte_size, 0) }];
    }

    if (head.startsWith("select i.item_id")) {
      const [itemId, replicaId, ownerUserId] = params;
      const row = state.items.find((i) => i.item_id === itemId && i.replica_id === replicaId && i.owner_user_id === ownerUserId);
      return row ? [{ ...row, body: state.texts.get(itemId) ?? null }] : [];
    }

    if (head.startsWith("select item_id, kind, format") && sql.includes("content_sha256 = $3")) {
      const [replicaId, ownerUserId, hash] = params;
      const row = state.items.find((i) => i.replica_id === replicaId && i.owner_user_id === ownerUserId && i.content_sha256 === hash);
      return row ? [{ ...row }] : [];
    }

    if (head.startsWith("select item_id, kind, format")) {
      const [replicaId, ownerUserId] = params;
      return state.items.filter((i) => i.replica_id === replicaId && i.owner_user_id === ownerUserId).map((i) => ({ ...i }));
    }

    throw new Error(`fake db: unrouted statement\n${sql.slice(0, 160)}`);
  };
  db.calls = calls;
  return db;
}

const freshState = () => ({
  replicas: [{ replica_id: REPLICA, owner_user_id: OWNER }],
  items: [], texts: new Map(), runs: [],
});

const b64 = (buffer) => Buffer.from(buffer).toString("base64");

// ─────────────────────────────────────────────────────────────────────────
// fixtures
// ─────────────────────────────────────────────────────────────────────────

/** Prose with a repeated verbalism, structured so the fragment clears BOTH
 *  halves of the phrase-bank rule: >=3 occurrences in the derive half (the
 *  catchphrase floor) and >=5 in the held-out half (the phrase-bank floor).
 *  Parity-interleaved by `splitHeldOut`, so 14 paragraphs give 7 and 7. */
const OWN_WRITING = Array.from({ length: 14 }, (_, i) =>
  `Dekho beta, the thing about rotational motion is that torque is not a mystery, it is just force with a lever arm. Paragraph ${i} of my own notes.`,
).join("\n\n");

/** A minimal but REAL PDF: an unfiltered content stream with a BT/Tj/ET run.
 *  Unfiltered on purpose — a Flate stream would test node:zlib, and what needs
 *  testing is the operator scan. */
function makePdf(lines) {
  const content = lines.map((line) => `BT (${line.replace(/([()\\])/g, "\\$1")}) Tj ET`).join("\n");
  return Buffer.from(
    `%PDF-1.4\n1 0 obj\n<< /Type /Page /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n`,
    "latin1",
  );
}

/** A zip whose single STORED entry is word/document.xml — a real, minimal
 *  .docx as far as this extractor is concerned. */
function makeDocx(paragraphs) {
  const xml = `<?xml version="1.0"?><w:document><w:body>${
    paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")
  }</w:body></w:document>`;
  const name = Buffer.from("word/document.xml", "utf8");
  const data = Buffer.from(xml, "utf8");
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(0, 8);       // stored
  header.writeUInt32LE(0, 14);      // crc, unchecked by this reader
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);
  return Buffer.concat([header, name, data]);
}

const EXPORT_LINES = [];
for (let i = 0; i < 16; i++) {
  EXPORT_LINES.push(`08/03/2026, 21:${String(10 + i).padStart(2, "0")} - Arjun Sir: haan bilkul, dekho beta that is exactly the confusion everyone has here.`);
  EXPORT_LINES.push(`08/03/2026, 21:${String(10 + i).padStart(2, "0")} - Priya Menon: acha okay sir, samajh gaya, thank you so much for the explanation.`);
}
const WHATSAPP_EXPORT = [
  "08/03/2026, 21:09 - Messages and calls are end-to-end encrypted. No one outside of this chat can read them.",
  ...EXPORT_LINES,
].join("\n");

// ─────────────────────────────────────────────────────────────────────────
// 1. the item-type matrix — extraction, refusal and routing, by name
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── item-type matrix ──");

const refusalOf = (filename, bytes) => {
  try {
    const result = extractFile(filename, Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes));
    return result.route ? { routed: result.route.routedTo } : { ok: result.format };
  } catch (error) {
    if (error instanceof ContextRefusal) return { refused: error.reason };
    throw error;
  }
};

ok("txt extracts", refusalOf("notes.txt", OWN_WRITING).ok === "text");
ok("md extracts as markdown", refusalOf("notes.md", OWN_WRITING).ok === "markdown");
ok("pdf text layer extracts", refusalOf("cv.pdf", makePdf(["Dekho beta this is the text layer", "and this is a second line of it"])).ok === "pdf");
ok("docx extracts", refusalOf("bio.docx", makeDocx(["Dekho beta this is my own writing about myself", "and here is a second paragraph of it"])).ok === "docx");
ok("whatsapp export is recognised by SNIFF, not by filename",
  refusalOf("chat.txt", WHATSAPP_EXPORT).ok === "whatsapp_export");

// the refusals
ok("corrupted pdf refuses by name",
  refusalOf("broken.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])])).refused === "pdf_malformed"
  || refusalOf("broken.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04])])).refused === "pdf_no_text_layer",
  JSON.stringify(refusalOf("broken.pdf", Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.from([0, 1, 2, 3, 4])]))));
ok("truncated docx refuses by name",
  refusalOf("broken.docx", makeDocx(["hello"]).subarray(0, 40)).refused === "docx_malformed",
  JSON.stringify(refusalOf("broken.docx", makeDocx(["hello"]).subarray(0, 40))));
ok("scanned pdf (no text operators) refuses as pdf_no_text_layer",
  refusalOf("scan.pdf", Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Length 4 >>\nstream\n\x00\x01\x02\x03\nendstream\nendobj\n", "latin1")).refused === "pdf_no_text_layer",
  JSON.stringify(refusalOf("scan.pdf", Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /XObject /Subtype /Image /Length 4 >>\nstream\n\x00\x01\x02\x03\nendstream\nendobj\n", "latin1"))));
ok("encrypted pdf refuses as pdf_encrypted",
  refusalOf("locked.pdf", Buffer.from("%PDF-1.4\ntrailer << /Encrypt 9 0 R >>\nstream\nx\nendstream\n", "latin1")).refused === "pdf_encrypted");
ok("legacy .doc refuses by name", refusalOf("old.doc", Buffer.from("\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1 legacy", "latin1")).refused === "doc_legacy_binary_unsupported");
ok("rtf refuses by name", refusalOf("x.rtf", Buffer.from("{\\rtf1 hello}")).refused === "rtf_unsupported");
ok("csv refuses by name (a spreadsheet is not prose)", refusalOf("x.csv", Buffer.from("a,b\n1,2\n")).refused === "csv_unsupported");
ok("unknown extension refuses as format_unsupported", refusalOf("x.dwg", Buffer.from("binary-ish content here")).refused === "format_unsupported");
ok("non-utf8 .txt refuses as text_not_utf8", refusalOf("x.txt", Buffer.from([0xff, 0xfe, 0x41, 0x00, 0x42, 0x00, 0xff, 0xff, 0xfd])).refused === "text_not_utf8");
ok("audio bytes ROUTE to the voice lane, not refused", refusalOf("note.m4a", Buffer.from("....ftypM4A ")).routed === "voice_evidence_lane");
ok("audio by magic bytes alone routes too (a .txt that is really a wav)",
  refusalOf("mislabelled.txt", Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVE"), Buffer.alloc(16)])).routed === "voice_evidence_lane");

// ─────────────────────────────────────────────────────────────────────────
// 2. the happy path: a document mines CITED proposals
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── mining with provenance ──");

const state = freshState();
const db = fakeDb(state);

const added = await addContextFile(db, OWNER, REPLICA, {
  filename: "my-notes.txt",
  bytes: Buffer.from(OWN_WRITING, "utf8"),
  authorship: "mine",
});
ok("own writing is stored as extracted-then-mined", added.item.status === "mined", added.item.status + " / " + added.item.mine_skip_reason);
ok("a proposal row exists on vy_ingest_run", state.runs.length === 1);
ok("the run's transcript_source is context_item", state.runs[0]?.transcript_source === "context_item");
ok("the run is PROPOSED, never applied", state.runs[0]?.status === "proposed" && state.runs[0]?.approved_by_user_id === null);
ok("the run's video_ref names the item", state.runs[0]?.video_ref === `context:${added.item.item_id}`);
ok("proposals were produced", (added.proposal?.proposed ?? 0) > 0, `proposed=${added.proposal?.proposed}`);

const delta = state.runs[0]?.proposed_delta;
const storedBody = state.texts.get(added.item.item_id);
ok("every addition names an item AND a span",
  delta.additions.length > 0 && delta.additions.every((a) => a.citations.length > 0
    && a.citations.every((c) => c.item_id === added.item.item_id && Number.isInteger(c.span?.start) && Number.isInteger(c.span?.end))));
ok("every citation RESOLVES against the stored body",
  delta.additions.every((a) => a.citations.every((c) => citationResolves(storedBody, c, a.fragment))));
ok("the measurements carry a citation too", delta.measurements?.citation?.item_id === added.item.item_id);
ok("citationViolations is clean on the stored delta", citationViolations(delta, storedBody).length === 0);

// THE NEGATIVE CONTROL. Same item, same fragment, a span pointing at a
// different part of the document. If this passed, "cited" would be a label.
const fabricated = JSON.parse(JSON.stringify(delta));
fabricated.additions[0].citations = [{ item_id: added.item.item_id, span: { start: 0, end: 4 }, speaker: "owner" }];
ok("NEGATIVE CONTROL: a fabricated citation FAILS the integrity check",
  citationViolations(fabricated, storedBody).some((v) => v.code === "citation_span_does_not_contain_fragment"));

const uncited = JSON.parse(JSON.stringify(delta));
uncited.additions[0].citations = [];
ok("NEGATIVE CONTROL: an uncited addition FAILS the integrity check",
  citationViolations(uncited, storedBody).some((v) => v.code === "uncited_addition"));

// ─────────────────────────────────────────────────────────────────────────
// 3. somebody else's words are never mined
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── whose words ──");

const notMine = await addContextFile(db, OWNER, REPLICA, {
  filename: "textbook-extract.txt",
  bytes: Buffer.from(OWN_WRITING.replace(/Paragraph/g, "Section"), "utf8"),
  authorship: "not_mine",
});
ok("a document declared NOT the owner's mines nothing", notMine.item.status === "extracted");
ok("...and the reason is NAMED, not blank",
  notMine.item.mine_skip_reason === "not_owner_authored_no_style_evidence", notMine.item.mine_skip_reason);

const unknownAuthor = await addContextFile(db, OWNER, REPLICA, {
  filename: "something.txt",
  bytes: Buffer.from(OWN_WRITING.replace(/Paragraph/g, "Item"), "utf8"),
});
ok("authorship defaults to unknown and mines nothing",
  unknownAuthor.item.authorship === "unknown" && unknownAuthor.item.mine_skip_reason === "not_owner_authored_no_style_evidence");

// ─────────────────────────────────────────────────────────────────────────
// 4. chat exports — speaker attribution, and the wrong-speaker control
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── chat export speaker attribution ──");

const unacknowledged = await addContextFile(db, OWNER, REPLICA, {
  filename: "chat.txt",
  bytes: Buffer.from(WHATSAPP_EXPORT, "utf8"),
});
ok("a chat export without the third-party acknowledgement is REFUSED by name",
  unacknowledged.item.status === "refused" && unacknowledged.item.refusal_reason === "chat_export_third_party_consent_required",
  unacknowledged.item.refusal_reason);
ok("...and the refusal tells the owner which speakers are in the file",
  Array.isArray(unacknowledged.details?.speakers) && unacknowledged.details.speakers.includes("Arjun Sir"));

// a different byte sequence so the dedup index does not swallow the retry
const chatState = freshState();
const chatDb = fakeDb(chatState);
const chat = await addContextFile(chatDb, OWNER, REPLICA, {
  filename: "chat.txt",
  bytes: Buffer.from(WHATSAPP_EXPORT, "utf8"),
  third_party_acknowledged: true,
});
ok("an acknowledged export is stored with consent scope own_turns_only",
  chat.item.consent_scope === "own_turns_only", chat.item.consent_scope);
ok("an export with NO declared owner speaker mines nothing, by name",
  chat.item.status === "extracted" && chat.item.mine_skip_reason === "speaker_unattributed_no_style_evidence",
  chat.item.mine_skip_reason);
ok("...and the speakers are returned so the owner can say which one they are",
  chat.speakers?.some((s) => s.name === "Arjun Sir") && chat.speakers?.some((s) => s.name === "Priya Menon"));
ok("the encryption banner is dropped as a system line, not attributed to anyone",
  !chat.speakers?.some((s) => /end-to-end/i.test(s.name)));

const chatBody = chatState.texts.get(chat.item.item_id);
const arjun = await remineContextItem(chatDb, OWNER, REPLICA, chat.item.item_id, { owner_speaker: "Arjun Sir" });
ok("re-mining with the owner's speaker produces proposals", (arjun.proposal?.proposed ?? 0) > 0, JSON.stringify(arjun.proposal));
const arjunDelta = chatState.runs[0]?.proposed_delta;
ok("every citation from the export names Arjun Sir",
  arjunDelta.additions.every((a) => a.citations.every((c) => c.speaker === "Arjun Sir")));
ok("every citation from the export RESOLVES",
  arjunDelta.additions.every((a) => a.citations.every((c) => citationResolves(chatBody, c, a.fragment))));
ok("no cited span contains Priya's signature phrase",
  arjunDelta.additions.every((a) => a.citations.every((c) => !/samajh gaya/i.test(chatBody.slice(c.span.start, c.span.end)))));

// THE WRONG-SPEAKER NEGATIVE CONTROL. Re-mine the same export declaring the
// OTHER party as the owner. The lane must mine HER lines and no citation may
// land on Arjun's — a lane that got this wrong would still return confident,
// well-formed, resolvable citations.
const wrongState = freshState();
const wrongDb = fakeDb(wrongState);
const wrongAdd = await addContextFile(wrongDb, OWNER, REPLICA, {
  filename: "chat.txt", bytes: Buffer.from(WHATSAPP_EXPORT, "utf8"), third_party_acknowledged: true,
});
const wrongBody = wrongState.texts.get(wrongAdd.item.item_id);
const priya = await remineContextItem(wrongDb, OWNER, REPLICA, wrongAdd.item.item_id, { owner_speaker: "Priya Menon" });
const priyaDelta = wrongState.runs[0]?.proposed_delta;
ok("NEGATIVE CONTROL: declaring the other party mines HER turns", (priya.proposal?.proposed ?? 0) > 0);
ok("NEGATIVE CONTROL: not one citation lands on Arjun Sir",
  priyaDelta.additions.every((a) => a.citations.every((c) => c.speaker === "Priya Menon")));
ok("NEGATIVE CONTROL: the two attributions produce DIFFERENT fragments",
  JSON.stringify(priyaDelta.additions.map((a) => a.fragment).sort())
    !== JSON.stringify(arjunDelta.additions.map((a) => a.fragment).sort()));

const absent = await remineContextItem(wrongDb, OWNER, REPLICA, wrongAdd.item.item_id, { owner_speaker: "Nobody At All" });
ok("a declared speaker who is not in the export is named, not silently empty",
  absent.item.mine_skip_reason === "declared_speaker_not_in_export", absent.item.mine_skip_reason);

// ─────────────────────────────────────────────────────────────────────────
// 5. dedup
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── dedup ──");

const dedupState = freshState();
const dedupDb = fakeDb(dedupState);
const first = await addContextFile(dedupDb, OWNER, REPLICA, { filename: "a.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" });
const second = await addContextFile(dedupDb, OWNER, REPLICA, { filename: "a-copy.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" });
ok("the same bytes twice is ONE row", dedupState.items.length === 1);
ok("...and the second add reports it as a duplicate rather than a success", second.duplicate === true);
ok("...pointing at the SAME item", second.item.item_id === first.item.item_id);
ok("...and no second proposal was written", dedupState.runs.length === 1);
ok("the hash really is sha256 of the bytes",
  dedupState.items[0].content_sha256 === createHash("sha256").update(Buffer.from(OWN_WRITING)).digest("hex"));

// ─────────────────────────────────────────────────────────────────────────
// 6. quotas and the size cap — refusals with numbers, never trims
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── quotas ──");

const quotaState = freshState();
for (let i = 0; i < MAX_ITEMS_PER_OWNER; i++) {
  quotaState.items.push({ item_id: `x${i}`, replica_id: REPLICA, owner_user_id: OWNER, byte_size: 10, content_sha256: `${i}`.padStart(64, "0"), status: "extracted" });
}
const quotaDb = fakeDb(quotaState);
let quotaError = null;
try { await addContextFile(quotaDb, OWNER, REPLICA, { filename: "n.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" }); }
catch (error) { quotaError = error; }
ok("the item quota refuses by name", quotaError?.code === "context_item_quota_exhausted", String(quotaError?.code));
ok("...and the refusal carries the numbers", quotaError?.details?.max_items === MAX_ITEMS_PER_OWNER && quotaError?.details?.items === MAX_ITEMS_PER_OWNER);

const byteState = freshState();
byteState.items.push({ item_id: "big", replica_id: REPLICA, owner_user_id: OWNER, byte_size: MAX_BYTES_PER_OWNER, content_sha256: "f".repeat(64), status: "extracted" });
const byteDb = fakeDb(byteState);
let byteError = null;
try { await addContextFile(byteDb, OWNER, REPLICA, { filename: "n.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" }); }
catch (error) { byteError = error; }
ok("the byte quota refuses by name", byteError?.code === "context_byte_quota_exhausted", String(byteError?.code));

let sizeError = null;
try {
  await addContextFile(fakeDb(freshState()), OWNER, REPLICA, {
    filename: "huge.txt", bytes: Buffer.alloc(MAX_ITEM_BYTES + 1, 0x41), authorship: "mine",
  });
} catch (error) { sizeError = error; }
ok("a file over the per-item cap refuses with BOTH numbers",
  sizeError?.code === "file_too_large" && sizeError.details.max === MAX_ITEM_BYTES && sizeError.details.bytes === MAX_ITEM_BYTES + 1);

// The extracted-text ceiling is a refusal too, never a slice.
let capError = null;
try { extractFile("long.txt", Buffer.from("word ".repeat(120_000), "utf8")); }
catch (error) { capError = error; }
ok("an over-long extraction refuses rather than truncating",
  capError instanceof ContextRefusal && capError.reason === "extracted_text_too_large" && capError.details.max > 0,
  String(capError?.reason));

// ─────────────────────────────────────────────────────────────────────────
// 7. ownership — unreachable, not filtered
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── ownership ──");

const ownState = freshState();
const ownDb = fakeDb(ownState);
ok("another owner cannot add to this replica",
  (await addContextFile(ownDb, OTHER, REPLICA, { filename: "a.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" })) === null);
ok("...and nothing was written", ownState.items.length === 0);
ok("another owner cannot list this replica's locker", (await listContextItems(ownDb, OTHER, REPLICA)) === null);
const mineFirst = await addContextFile(ownDb, OWNER, REPLICA, { filename: "a.txt", bytes: Buffer.from(OWN_WRITING), authorship: "mine" });
ok("another owner cannot re-mine this owner's item",
  (await remineContextItem(ownDb, OTHER, REPLICA, mineFirst.item.item_id, { authorship: "mine" })) === null);
ok("another owner cannot remove this owner's item",
  (await removeContextItem(ownDb, OTHER, REPLICA, mineFirst.item.item_id)) === null);
ok("...and the item is still there", ownState.items.length === 1);
ok("a nonexistent replica answers the SAME way an unowned one does",
  (await listContextItems(ownDb, OWNER, "11111111-1111-4111-8111-111111111111")) === null);

// ─────────────────────────────────────────────────────────────────────────
// 8. links — routing, and an absent fetcher that says so
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── links ──");

const linkState = freshState();
const linkDb = fakeDb(linkState);
const yt = await addContextLink(linkDb, OWNER, REPLICA, { url: "https://www.youtube.com/@arjun-sir-physics" });
ok("a YouTube link is ROUTED to the channel lane, not refused",
  yt.item.status === "routed" && yt.item.routed_to === "channel_lane");
const audioLink = await addContextLink(linkDb, OWNER, REPLICA, { url: "https://example.com/talk.mp3" });
ok("an audio link is ROUTED to the voice lane", audioLink.item.routed_to === "voice_evidence_lane");
const article = await addContextLink(linkDb, OWNER, REPLICA, { url: "https://example.com/my-interview" });
ok("with no fetcher configured an article is REFUSED by name, never stored unread",
  article.item.status === "refused" && article.item.refusal_reason === "article_fetch_not_configured");
const httpLink = await addContextLink(linkDb, OWNER, REPLICA, { url: "http://example.com/x" });
ok("a non-https link refuses", httpLink.item.refusal_reason === "link_scheme_unsupported");
const localLink = await addContextLink(linkDb, OWNER, REPLICA, { url: "https://169.254.169.254/latest/meta-data/" });
ok("an IP literal refuses (SSRF)", localLink.item.refusal_reason === "link_host_not_public");

const fetched = await addContextLink(linkDb, OWNER, REPLICA, { url: "https://example.com/interview-2" }, {
  fetchArticle: async () => ({ title: "An interview", html: `<html><body><h1>Interview</h1><p>${OWN_WRITING.replace(/\n\n/g, "</p><p>")}</p></body></html>` }),
});
ok("a fetched article extracts", fetched.item.status === "extracted" && fetched.item.format === "article");
ok("...but mines NOTHING — it is not the owner's writing, whatever they tick",
  fetched.item.mine_skip_reason === "not_owner_authored_no_style_evidence", fetched.item.mine_skip_reason);

// ─────────────────────────────────────────────────────────────────────────
// 9. removal, and the law about vy_teacher_sheet
// ─────────────────────────────────────────────────────────────────────────
console.log("\n── removal and the sheet law ──");

const removed = await removeContextItem(dedupDb, OWNER, REPLICA, first.item.item_id);
ok("an item can be removed", removed?.removed === true);
ok("...and its text goes with it", !dedupState.texts.has(first.item.item_id));
ok("...but the PROPOSAL row is kept as a decision record", dedupState.runs.length === 1);

const everySql = [db.calls, chatDb.calls, wrongDb.calls, dedupDb.calls, linkDb.calls, ownDb.calls, quotaDb.calls, byteDb.calls].flat();
ok(`NO statement names vy_teacher_sheet (${everySql.length} statements)`,
  !everySql.some((sql) => /vy_teacher_sheet/.test(sql)));
ok("every statement that reads or writes an item carries an owner predicate",
  everySql.filter((sql) => /vy_context_item/.test(sql)).every((sql) => /owner_user_id/.test(sql)));
ok("every ::uuid-cast parameter is cast (no bare uuid comparison)",
  everySql.filter((sql) => /vy_context_item|vy_ingest_run/.test(sql))
    .every((sql) => !/\b(item_id|replica_id|owner_user_id|run_id)\s*=\s*\$\d+(?!::uuid)\b/.test(sql)));

// a base64 sanity check for the handler's decode path
ok("base64 round-trips the fixtures", Buffer.from(b64(Buffer.from(OWN_WRITING)), "base64").toString("utf8") === OWN_WRITING);
ok("deflateRaw is available for the docx path", deflateRawSync(Buffer.from("x")).length > 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
