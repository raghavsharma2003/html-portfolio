// The Context Locker — "bring your context", the universal ingestion lane
// (Gurukul WS-AB).
//
// An owner hands the platform multiple files and multiple links about
// themselves; each becomes an owned, consent-scoped, content-hashed, size- and
// quota-capped row, and the ones this platform can honestly read become CITED
// proposals on the review surface the platform already has.
//
// ── the split, and why the handler is thin ───────────────────────────────
// `api/context-items.js` (cors, rate limit, auth, dispatch, error shape) over
// this file (the logic, `db` injected as the first argument) is the house shape
// `api/replica-claims.js` / `api/_replica-claims.js` established. It is what
// makes evals/contextlocker.mjs able to drive the REAL code path with a fake
// `db` and no database. The DB is absent in this environment; logic that lived
// in the handler would be logic nothing could ever run (`dead-writers`).
//
// ── owner scoping is a PREDICATE, never a check afterwards ───────────────
// `gate0-structural`: prompt instructions leaked 57-98%, the SQL predicate
// leaked 0 of 31,122. Every statement below carries `owner_user_id = $n` inside
// its WHERE clause or inside a `with owned as (…)` CTE the write selects from.
// A disqualified row that reaches JS can still be logged, partially rendered,
// or escape through a branch added later.
//
// ── NO STATEMENT IN THIS FILE NAMES vy_teacher_sheet ─────────────────────
// Not a write, not a read — the same law `api/_channel-ingest.js` keeps and for
// the same reason: a lane that reads the published sheet "to compare" is one
// edit from a lane that writes it, and the reviewer of that edit sees a diff to
// a query that was already there. evals/contextlocker.mjs asserts the absence
// over every statement this module issues. A proposal is applied by
// `applyIngestRunDelta` (which records a named approver) and merged by
// `saveOwnedTeacherSheetDraft` (which carries the publish gate). Never here.
//
// ── the third-party gate on chat exports ─────────────────────────────────
// A WhatsApp export is the best writing sample this platform will ever be
// handed and it is also, in the same file, somebody else's private messages.
// The owner may mine their OWN turns; they cannot consent on the other party's
// behalf, and nothing in this lane ever mines the other party's turns. What the
// owner must do is say, on the record, that they understand the file contains
// another person's messages and that those messages are used only to separate
// them OUT. Without that acknowledgement the item is refused by name.
import { randomUUID, createHash } from "node:crypto";
import { extractFile } from "./_context/extract.js";
import { classifyLink, extractHtml } from "./_context/link.js";
import {
  ContextItemError,
  ContextRefusal,
  MAX_BYTES_PER_OWNER,
  MAX_ITEMS_PER_OWNER,
  MAX_ITEM_BYTES,
} from "./_context/limits.js";
import { citationViolations, mineContextItem } from "./_context-mining.js";
import { persistInstructionShapedCard } from "./_review-queue.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export { ContextItemError };
export { MAX_ITEM_BYTES, MAX_ITEMS_PER_OWNER, MAX_BYTES_PER_OWNER };

/** Mirrors `INGEST_DELTA_MAX_BYTES` in api/_channel-ingest.js, which is the
 *  table this lane writes its proposals to. Imported would be better; it is
 *  restated because importing the channel worker into the file lane would make
 *  a YouTube-specific module a dependency of every text upload. The eval
 *  asserts the two numbers agree. */
export const CONTEXT_DELTA_MAX_BYTES = 128 * 1024;

const fail = (code, status, details) => { throw new ContextItemError(code, status, details); };

const idOf = (value, code) => {
  const id = String(value ?? "").trim().toLowerCase();
  if (!UUID.test(id)) fail(code, 400);
  return id;
};

export const sha256Hex = (input) => createHash("sha256").update(input).digest("hex");

/** `{ replica_id }` or null. Null rather than a thrown 403, because "not yours"
 *  and "does not exist" must be the same answer: a 403 on someone else's uuid
 *  is an existence oracle and the uuid space is exactly what an enumerator has. */
async function ownedReplica(db, ownerUserId, replicaId) {
  const rows = await db(
    `select r.replica_id from vy_replica r
      where r.replica_id = $1::uuid and r.owner_user_id = $2::uuid
      limit 1`,
    [replicaId, ownerUserId],
  );
  return rows[0] || null;
}

/** The whitelist. Ownership ids, the extracted body and the raw citation spans
 *  never enter a list response — a locker list is rendered on a screen and a
 *  screen is a browser network log. Spans travel on the PROPOSAL, which the
 *  review surface fetches deliberately. */
function clientItem(row) {
  return {
    item_id: row.item_id,
    kind: row.kind,
    format: row.format,
    source_name: row.source_name,
    source_url: row.source_url,
    byte_size: Number(row.byte_size),
    extracted_chars: Number(row.extracted_chars),
    extractor: row.extractor,
    status: row.status,
    refusal_reason: row.refusal_reason,
    routed_to: row.routed_to,
    mine_skip_reason: row.mine_skip_reason,
    authorship: row.authorship,
    owner_speaker: row.owner_speaker,
    consent_scope: row.consent_scope,
    /** PRESENCE, never the id — same reduction `channelWatchApi.ts` documents
     *  for the oauth grant. A studio needs "this produced a proposal"; it gets
     *  the proposal itself from the review surface. */
    proposal: row.run_id ? "present" : null,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function quotaOf(db, ownerUserId) {
  const rows = await db(
    `select count(*)::int as items, coalesce(sum(byte_size), 0)::bigint as bytes
       from vy_context_item where owner_user_id = $1::uuid`,
    [ownerUserId],
  );
  return {
    items: Number(rows[0]?.items ?? 0),
    bytes: Number(rows[0]?.bytes ?? 0),
    max_items: MAX_ITEMS_PER_OWNER,
    max_bytes: MAX_BYTES_PER_OWNER,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// GET — the owner's own locker
// ─────────────────────────────────────────────────────────────────────────

export async function listContextItems(db, ownerUserId, replicaIdValue, limit = 200) {
  const replicaId = idOf(replicaIdValue, "valid_replica_id_required");
  if (!await ownedReplica(db, ownerUserId, replicaId)) return null;
  const rows = await db(
    `select item_id, kind, format, source_name, source_url, byte_size, extracted_chars,
            extractor, status, refusal_reason, routed_to, mine_skip_reason, authorship,
            owner_speaker, consent_scope, run_id, created_at, updated_at
       from vy_context_item
      where replica_id = $1::uuid and owner_user_id = $2::uuid
      order by created_at desc
      limit $3`,
    [replicaId, ownerUserId, Math.min(500, Math.max(1, limit))],
  );
  return {
    items: rows.map(clientItem),
    quota: await quotaOf(db, ownerUserId),
    limits: {
      max_item_bytes: MAX_ITEM_BYTES,
      accepted_file_formats: ["txt", "md", "pdf", "docx", "whatsapp .txt export"],
      routed_elsewhere: { audio: "voice_evidence_lane", youtube: "channel_lane" },
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The write path
// ─────────────────────────────────────────────────────────────────────────

/** Insert the item and (when there is one) its extracted body in ONE statement.
 *
 *  One statement because an item row without its text row is a broken item that
 *  every later mine has to reason about, and a serverless function killed
 *  between two statements is the ordinary way to get one. The quota predicate
 *  rides INSIDE the insert as a second layer over the read the caller already
 *  did — the read is what produces a good error message, the predicate is what
 *  cannot be forgotten.
 *
 *  Zero rows is ambiguous by construction (duplicate hash, or quota, or the
 *  replica stopped being the owner's between the two calls), so the caller
 *  disambiguates with one follow-up read rather than guessing. */
async function insertItem(db, row, body) {
  const rows = await db(
    `with owned as (
       select r.replica_id from vy_replica r
        where r.replica_id = $2::uuid and r.owner_user_id = $3::uuid
     ), quota as (
       select count(*)::int as items, coalesce(sum(byte_size), 0)::bigint as bytes
         from vy_context_item where owner_user_id = $3::uuid
     ), ins as (
       insert into vy_context_item
         (item_id, replica_id, owner_user_id, kind, format, source_name, source_url,
          content_sha256, byte_size, extracted_chars, extractor, status, refusal_reason,
          routed_to, mine_skip_reason, authorship, owner_speaker, consent_scope)
       select $1::uuid, o.replica_id, $3::uuid, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13, $14, $15, $16, $17, $18
         from owned o, quota q
        where q.items < $19 and q.bytes + $9 <= $20
       on conflict (replica_id, content_sha256) do nothing
       returning item_id, replica_id, owner_user_id, kind, format, source_name, source_url,
                 byte_size, extracted_chars, extractor, status, refusal_reason, routed_to,
                 mine_skip_reason, authorship, owner_speaker, consent_scope, run_id,
                 created_at, updated_at
     ), txt as (
       insert into vy_context_item_text (item_id, replica_id, owner_user_id, body, chars)
       select i.item_id, i.replica_id, i.owner_user_id, $21, $10 from ins i where $10 > 0
       on conflict (item_id) do nothing
       returning item_id
     )
     select * from ins`,
    [row.item_id, row.replica_id, row.owner_user_id, row.kind, row.format, row.source_name,
      row.source_url, row.content_sha256, row.byte_size, row.extracted_chars, row.extractor,
      row.status, row.refusal_reason, row.routed_to, row.mine_skip_reason, row.authorship,
      row.owner_speaker, row.consent_scope, MAX_ITEMS_PER_OWNER, MAX_BYTES_PER_OWNER,
      body || ""],
  );
  return rows[0] || null;
}

/** The disambiguation read. Called only on the zero-row path. */
async function existingByHash(db, ownerUserId, replicaId, hash) {
  const rows = await db(
    `select item_id, kind, format, source_name, source_url, byte_size, extracted_chars,
            extractor, status, refusal_reason, routed_to, mine_skip_reason, authorship,
            owner_speaker, consent_scope, run_id, created_at, updated_at
       from vy_context_item
      where replica_id = $1::uuid and owner_user_id = $2::uuid and content_sha256 = $3
      limit 1`,
    [replicaId, ownerUserId, hash],
  );
  return rows[0] || null;
}

const AUTHORSHIP = new Set(["mine", "not_mine", "unknown"]);

/**
 * Add ONE file to the locker: hash, quota, extract, store, mine, propose.
 *
 * @param file `{ filename, bytes: Buffer, authorship, owner_speaker,
 *   third_party_acknowledged }`
 * @returns `{ item, duplicate, proposal }`
 */
export async function addContextFile(db, ownerUserId, replicaIdValue, file, deps = {}) {
  const replicaId = idOf(replicaIdValue, "valid_replica_id_required");
  if (!await ownedReplica(db, ownerUserId, replicaId)) return null;

  const bytes = file?.bytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) fail("file_content_required", 400);
  if (bytes.length > MAX_ITEM_BYTES) {
    fail("file_too_large", 413, { bytes: bytes.length, max: MAX_ITEM_BYTES });
  }
  const authorship = AUTHORSHIP.has(file.authorship) ? file.authorship : "unknown";
  const sourceName = String(file.filename || "").slice(0, 200);

  // The quota is READ before any work is done, so an owner at the ceiling is
  // told which ceiling and by how much rather than watching an extraction run
  // and then fail. The predicate inside the insert is the layer that actually
  // enforces it.
  const quota = await quotaOf(db, ownerUserId);
  if (quota.items >= MAX_ITEMS_PER_OWNER) {
    fail("context_item_quota_exhausted", 409, { ...quota, limit: "items" });
  }
  if (quota.bytes + bytes.length > MAX_BYTES_PER_OWNER) {
    fail("context_byte_quota_exhausted", 409, { ...quota, limit: "bytes", incoming: bytes.length });
  }

  const hash = sha256Hex(bytes);
  const base = {
    item_id: randomUUID(),
    replica_id: replicaId,
    owner_user_id: ownerUserId,
    kind: "file",
    source_name: sourceName,
    source_url: "",
    content_sha256: hash,
    byte_size: bytes.length,
    extracted_chars: 0,
    extractor: "",
    refusal_reason: "",
    routed_to: "",
    mine_skip_reason: "",
    authorship,
    owner_speaker: String(file.owner_speaker || "").slice(0, 120),
    consent_scope: "own_context",
  };

  let extraction = null;
  try {
    const result = extractFile(sourceName, bytes);
    if (result.route) {
      return await storeTerminal(db, { ...base, format: "unknown", status: "routed", routed_to: result.route.routedTo }, { note: result.route.note });
    }
    extraction = result;
  } catch (error) {
    if (!(error instanceof ContextRefusal)) throw error;
    return await storeTerminal(db, {
      ...base, format: "unknown", status: "refused", refusal_reason: error.reason,
    }, { details: error.details });
  }

  // The third-party gate. AFTER extraction, because it is only knowable once
  // the file has been recognised as a chat export — the filename never says so.
  if (extraction.format === "whatsapp_export" && file.third_party_acknowledged !== true) {
    return await storeTerminal(db, {
      ...base, format: "whatsapp_export", status: "refused",
      refusal_reason: "chat_export_third_party_consent_required",
    }, {
      details: {
        speakers: extraction.speakers.map((s) => s.name),
        note: "This export contains another person's private messages. Confirm you understand that only YOUR OWN messages are ever mined and that theirs are read only to separate them out.",
      },
    });
  }

  // A chat export is stored in its SPEAKER-CARRYING form before any span is
  // taken, so the string the citations index and the string the database holds
  // are one string. See `storedExportBody`.
  const speakers = extraction.speakers ?? null;
  if (extraction.format === "whatsapp_export") extraction = storedExportBody(extraction);

  const stored = await insertItem(db, {
    ...base,
    format: extraction.format,
    extracted_chars: extraction.body.length,
    extractor: extraction.extractor,
    status: "extracted",
    consent_scope: extraction.format === "whatsapp_export" ? "own_turns_only" : "own_context",
  }, extraction.body);

  if (!stored) {
    const duplicate = await existingByHash(db, ownerUserId, replicaId, hash);
    if (duplicate) return { item: clientItem(duplicate), duplicate: true, proposal: null };
    fail("context_item_write_failed", 409, { note: "quota predicate refused the insert" });
  }

  const proposal = await mineStored(db, stored, extraction, {
    authorship,
    ownerSpeaker: base.owner_speaker,
  }, deps);
  return { item: proposal.item, duplicate: false, proposal: proposal.proposal, speakers };
}

/**
 * Add ONE link.
 *
 * A YouTube link and an audio link are ROUTED, not refused — they belong to
 * lanes that already exist and already carry the permissions those lanes need.
 * An article is fetched through an injected seam; a deployment with no seam has
 * no article lane and says so rather than storing a URL it never read.
 */
export async function addContextLink(db, ownerUserId, replicaIdValue, link, deps = {}) {
  const replicaId = idOf(replicaIdValue, "valid_replica_id_required");
  if (!await ownedReplica(db, ownerUserId, replicaId)) return null;

  const raw = String(link?.url || "").trim();
  if (!raw) fail("link_url_required", 400);
  if (raw.length > 2000) fail("link_url_too_long", 413, { chars: raw.length, max: 2000 });

  const quota = await quotaOf(db, ownerUserId);
  if (quota.items >= MAX_ITEMS_PER_OWNER) fail("context_item_quota_exhausted", 409, { ...quota, limit: "items" });

  const base = {
    item_id: randomUUID(),
    replica_id: replicaId,
    owner_user_id: ownerUserId,
    kind: "link",
    source_name: "",
    source_url: raw.slice(0, 2000),
    content_sha256: sha256Hex(raw),
    byte_size: 0,
    extracted_chars: 0,
    extractor: "",
    refusal_reason: "",
    routed_to: "",
    mine_skip_reason: "",
    // A link is never the owner's own writing. There is no checkbox for it —
    // see NEVER_OWNER_AUTHORED in api/_context-mining.js.
    authorship: "not_mine",
    owner_speaker: "",
    consent_scope: "third_party_published",
  };

  let classified;
  try {
    classified = classifyLink(raw);
  } catch (error) {
    if (!(error instanceof ContextRefusal)) throw error;
    return await storeTerminal(db, { ...base, format: "unknown", status: "refused", refusal_reason: error.reason }, { details: error.details });
  }
  if (classified.kind === "route") {
    return await storeTerminal(db, { ...base, format: "unknown", status: "routed", routed_to: classified.routedTo }, { note: classified.note });
  }

  if (typeof deps.fetchArticle !== "function") {
    // ABSENT, and named. A stored link nobody ever fetched, shown as a normal
    // item, is `plausible-return-hides-a-dead-pipeline` — the owner would
    // believe their reading list was in the model.
    return await storeTerminal(db, {
      ...base, format: "article", status: "refused", refusal_reason: "article_fetch_not_configured",
    }, { details: { note: "this deployment has no article fetcher, so no link can be read. Upload the text instead." } });
  }

  let extraction;
  try {
    const fetched = await deps.fetchArticle(classified.url);
    extraction = extractHtml(fetched?.html ?? "", classified.url);
    base.source_name = String(fetched?.title || classified.url).slice(0, 200);
    base.byte_size = Buffer.byteLength(String(fetched?.html ?? ""));
  } catch (error) {
    if (!(error instanceof ContextRefusal)) {
      return await storeTerminal(db, {
        ...base, format: "article", status: "refused", refusal_reason: "article_fetch_failed",
      }, { details: { note: String(error?.code || error?.message || "fetch failed").slice(0, 120) } });
    }
    return await storeTerminal(db, { ...base, format: "article", status: "refused", refusal_reason: error.reason }, { details: error.details });
  }

  const stored = await insertItem(db, {
    ...base,
    format: "article",
    extracted_chars: extraction.body.length,
    extractor: extraction.extractor,
    status: "extracted",
  }, extraction.body);
  if (!stored) {
    const duplicate = await existingByHash(db, ownerUserId, replicaId, base.content_sha256);
    if (duplicate) return { item: clientItem(duplicate), duplicate: true, proposal: null };
    fail("context_item_write_failed", 409, { note: "quota predicate refused the insert" });
  }
  const proposal = await mineStored(db, stored, extraction, { authorship: "not_mine" }, deps);
  return { item: proposal.item, duplicate: false, proposal: proposal.proposal };
}

/** A refused or routed item is STORED, not dropped. 051's "revoked rows are
 *  kept" argument transferred: the row is the record that this file was looked
 *  at and declined, and without it the owner re-uploads it forever and the
 *  platform re-refuses it forever with nothing on screen to say why. */
async function storeTerminal(db, row, extra) {
  const stored = await insertItem(db, { ...row, extracted_chars: 0 }, "");
  if (!stored) {
    const duplicate = await existingByHash(db, row.owner_user_id, row.replica_id, row.content_sha256);
    if (duplicate) return { item: clientItem(duplicate), duplicate: true, proposal: null, ...extra };
    fail("context_item_write_failed", 409, { note: "quota predicate refused the insert" });
  }
  return { item: clientItem(stored), duplicate: false, proposal: null, ...extra };
}

// ─────────────────────────────────────────────────────────────────────────
// Mining → a PROPOSAL on vy_ingest_run. Never an application.
// ─────────────────────────────────────────────────────────────────────────

/** The delta ceiling, as `api/_channel-ingest.js` applies it and for the same
 *  reason. An oversized delta is REPLACED by a named marker, never trimmed —
 *  `silent-truncation`. */
function bounded(value) {
  const text = JSON.stringify(value ?? {});
  if (text.length <= CONTEXT_DELTA_MAX_BYTES) return text;
  return JSON.stringify({
    oversized: true, bytes: text.length,
    note: "delta exceeded CONTEXT_DELTA_MAX_BYTES and was not stored",
  });
}

async function mineStored(db, stored, extraction, options, deps = {}) {
  const result = mineContextItem({ item_id: stored.item_id }, extraction, options);

  // WS-R112. THE INSTRUCTION-SHAPED-MATERIAL CARD. Runs ahead of every
  // branch below — a citation-integrity skip or a zero-candidate skip still
  // surfaces the card, because the risk this exists for ("this text reached
  // the platform at all") is independent of whether anything else about the
  // item mined at all (`api/_context-mining.js::materialFlagFor`'s own
  // header). One card per flagged source, `persistInstructionShapedCard`'s
  // own dedupe index making a re-mine idempotent — never re-run inside a
  // try/catch here, so a write failure surfaces exactly as loudly as every
  // other write in this function does, rather than a safety card silently
  // never landing.
  if (result.materialFlag) {
    const persistFlag = deps.persistInstructionShapedCard || persistInstructionShapedCard;
    await persistFlag(db, stored.owner_user_id, stored.replica_id, stored.item_id, result.materialFlag);
  }

  // THE INTEGRITY GATE, at WRITE time. A delta with an unresolvable citation is
  // not stored at all — the item is marked extracted with a named skip reason,
  // and nothing that cannot be checked ever reaches a review screen. A gate
  // that lived only in the eval would be a gate production does not have.
  const violations = citationViolations(result.delta, extraction.body);
  if (violations.length) {
    const item = await markItem(db, stored, {
      status: "extracted",
      mine_skip_reason: "citation_integrity_failed",
      run_id: null,
    });
    return { item, proposal: { ok: false, violations } };
  }

  if (!result.mined || result.deltaCount === 0) {
    const item = await markItem(db, stored, {
      status: "extracted",
      mine_skip_reason: result.reason || "no_candidates_cleared_held_out",
      run_id: null,
    });
    return { item, proposal: { ok: true, proposed: 0, reason: result.reason || "no_candidates_cleared_held_out" } };
  }

  const runId = (deps.newRunId ?? randomUUID)();
  // `on conflict (replica_id, video_ref) do nothing`: re-mining an item that
  // already has a proposal must not reset a proposal the owner is mid-review
  // on. Same idempotence mechanism, same constraint, as the channel lane's.
  const runs = await db(
    `insert into vy_ingest_run
       (run_id, replica_id, owner_user_id, watch_id, video_ref, transcript_source,
        stats, proposed_delta, proposed_delta_count, status)
     values ($1::uuid, $2::uuid, $3::uuid, null, $4, 'context_item',
             $5::jsonb, $6::jsonb, $7, 'proposed')
     on conflict (replica_id, video_ref) do nothing
     returning run_id, status, proposed_delta_count`,
    [runId, stored.replica_id, stored.owner_user_id, `context:${stored.item_id}`,
      bounded(result.stats), bounded(result.delta), result.deltaCount],
  );
  if (!runs[0]) {
    const item = await markItem(db, stored, { status: "mined", mine_skip_reason: "", run_id: null });
    return { item, proposal: { ok: true, proposed: 0, reason: "proposal_already_exists" } };
  }
  const item = await markItem(db, stored, { status: "mined", mine_skip_reason: "", run_id: runs[0].run_id });
  return { item, proposal: { ok: true, run_id: runs[0].run_id, proposed: result.deltaCount } };
}

async function markItem(db, stored, patch) {
  const rows = await db(
    `update vy_context_item
        set status = $3, mine_skip_reason = $4, run_id = coalesce($5::uuid, run_id), updated_at = now()
      where item_id = $1::uuid and owner_user_id = $2::uuid
      returning item_id, kind, format, source_name, source_url, byte_size, extracted_chars,
                extractor, status, refusal_reason, routed_to, mine_skip_reason, authorship,
                owner_speaker, consent_scope, run_id, created_at, updated_at`,
    [stored.item_id, stored.owner_user_id, patch.status, patch.mine_skip_reason || "", patch.run_id],
  );
  if (!rows[0]) fail("context_item_write_failed", 409, { item_id: stored.item_id });
  return clientItem(rows[0]);
}

/**
 * Re-mine a stored item — the op that turns "we found three speakers, which one
 * are you?" into proposals, without a re-upload.
 *
 * It is the ONLY way `owner_speaker` and `authorship` ever change, and it
 * re-runs the whole pass rather than patching the old delta, because a delta
 * mined under a different speaker attribution is a different measurement.
 */
export async function remineContextItem(db, ownerUserId, replicaIdValue, itemIdValue, options = {}, deps = {}) {
  const replicaId = idOf(replicaIdValue, "valid_replica_id_required");
  const itemId = idOf(itemIdValue, "valid_item_id_required");
  const rows = await db(
    `select i.item_id, i.replica_id, i.owner_user_id, i.format, i.status, i.extractor,
            i.authorship, i.owner_speaker, t.body
       from vy_context_item i
       left join vy_context_item_text t on t.item_id = i.item_id
      where i.item_id = $1::uuid and i.replica_id = $2::uuid and i.owner_user_id = $3::uuid
      limit 1`,
    [itemId, replicaId, ownerUserId],
  );
  const row = rows[0];
  if (!row) return null;
  if (row.status === "refused" || row.status === "routed") {
    fail("context_item_not_minable", 409, { status: row.status });
  }
  if (typeof row.body !== "string" || !row.body.length) {
    // An item row with no text row. Named rather than treated as an empty
    // document, because an empty document mines cleanly and would report a
    // truthful-looking "0 proposals" for a storage defect.
    fail("context_item_text_missing", 409, { item_id: itemId });
  }

  const authorship = AUTHORSHIP.has(options.authorship) ? options.authorship : row.authorship;
  const ownerSpeaker = options.owner_speaker === undefined
    ? row.owner_speaker
    : String(options.owner_speaker || "").slice(0, 120);

  await db(
    `update vy_context_item set authorship = $3, owner_speaker = $4, updated_at = now()
      where item_id = $1::uuid and owner_user_id = $2::uuid`,
    [itemId, ownerUserId, authorship, ownerSpeaker],
  );

  // The body is re-segmented from the STORED text, which is the same string the
  // spans were taken against. Re-parsing the original bytes would risk an
  // extractor change silently moving every offset in every stored citation.
  const extraction = resegment(row.format, row.body, row.extractor);
  const proposal = await mineStored(db, { ...row, item_id: itemId }, extraction, {
    authorship, ownerSpeaker,
  }, deps);
  return proposal;
}

/** Rebuild `{ body, segments }` from the STORED canonical text — never from the
 *  original bytes.
 *
 *  That distinction is the point. Re-parsing the upload would let a future
 *  change to an extractor move every offset in every citation already stored,
 *  and nothing would report it: the deltas would still LOOK cited and would
 *  quietly point at the wrong sentences. So a re-mine is a pure function of the
 *  stored string, and the stored string is what the first mine's spans indexed.
 *
 *  A chat export therefore has to carry its speakers INSIDE that string — the
 *  stored form is `speaker\tmessage` per line, written by `storedExportBody` at
 *  add time — because attribution is what decides whether a line may be mined
 *  at all, and a re-mine that had lost it would silently mine everybody. */
function resegment(format, body, extractor) {
  if (format === "whatsapp_export") {
    const segments = [];
    let cursor = 0;
    for (const line of body.split("\n")) {
      const tab = line.indexOf("\t");
      const speaker = tab > 0 ? line.slice(0, tab) : "";
      const start = cursor + (tab > 0 ? tab + 1 : 0);
      const end = cursor + line.length;
      if (end > start) segments.push({ start, end, speaker, text: body.slice(start, end) });
      cursor = end + 1;
    }
    return { format, extractor, body, segments };
  }
  const segments = [];
  const re = /\n[ \t]*\n/g;
  let cursor = 0;
  let match;
  while ((match = re.exec(body))) {
    if (match.index > cursor) segments.push({ start: cursor, end: match.index, speaker: "", text: body.slice(cursor, match.index) });
    cursor = re.lastIndex;
  }
  if (cursor < body.length) segments.push({ start: cursor, end: body.length, speaker: "", text: body.slice(cursor, body.length) });
  return { format, extractor, body, segments: segments.filter((s) => s.text.trim()) };
}

/** The stored form of a chat export: `speaker\tmessage` per line, so speaker
 *  attribution survives into storage and a re-mine resolves the same spans the
 *  first mine cited. Applied at ADD time so the body written to
 *  `vy_context_item_text` and the body the spans index are one string. */
export function storedExportBody(extraction) {
  let body = "";
  const segments = [];
  for (const seg of extraction.segments) {
    const prefix = `${seg.speaker}\t`;
    body += prefix;
    const start = body.length;
    body += seg.text;
    segments.push({ start, end: body.length, speaker: seg.speaker, text: seg.text });
    body += "\n";
  }
  return { ...extraction, body: body.slice(0, -1), segments };
}

// ─────────────────────────────────────────────────────────────────────────
// Removal
// ─────────────────────────────────────────────────────────────────────────

/** Both rows in one statement. A text row surviving its item is an orphan
 *  carrying the owner's words with nothing pointing at it — the exact shape
 *  scripts/relcheck.mjs exists to catch. The PROPOSAL is deliberately kept: it
 *  is a decision record on the review surface, it holds no body text, and
 *  deleting it would re-open a proposal the owner already declined. */
export async function removeContextItem(db, ownerUserId, replicaIdValue, itemIdValue) {
  const replicaId = idOf(replicaIdValue, "valid_replica_id_required");
  const itemId = idOf(itemIdValue, "valid_item_id_required");
  const rows = await db(
    `with removed as (
       delete from vy_context_item
        where item_id = $1::uuid and replica_id = $2::uuid and owner_user_id = $3::uuid
        returning item_id
     ), removed_text as (
       delete from vy_context_item_text t using removed r where t.item_id = r.item_id
       returning t.item_id
     )
     select item_id from removed`,
    [itemId, replicaId, ownerUserId],
  );
  return rows[0] ? { removed: true, item_id: rows[0].item_id } : null;
}
