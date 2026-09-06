// Canonical Context Locker evidence adapters.
//
// They produce existing `vy_replica_processing_evidence` rows. No OCR, visual
// assertion, protected-trait inference, inner-state inference, or model call
// happens here. A text row commits to exact offsets in the stored canonical
// body; an image row commits only to verified bytes and a pixel rectangle.
import {
  PROCESSING_SCHEMA_VERSION,
  assertSha256,
  canonicalJson,
  sha256Hex,
  stableUuid,
} from "../_replica-processing/contracts.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVIDENCE_TEXT = 8_000;

function fail(code, status = 409) {
  throw Object.assign(new Error(code), { code, status });
}

function uuid(value, code) {
  const clean = String(value || "").toLowerCase();
  if (!UUID.test(clean)) fail(code);
  return clean;
}

function finiteInt(value, code, min = 0) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min) fail(code);
  return number;
}

function evidenceRecord(input, evidenceType, value, evidenceKey) {
  const committedValue = Object.freeze({ ...value, evidence_key: evidenceKey });
  const basis = {
    schema_version: PROCESSING_SCHEMA_VERSION,
    replica_id: input.replicaId,
    owner_user_id: input.ownerUserId,
    source_id: input.sourceId,
    artifact_id: null,
    created_by_job_id: null,
    evidence_type: evidenceType,
    span: { start_ms: null, end_ms: null },
    confidence: 1,
    value: committedValue,
    input_sha256: input.inputSha256,
    adapter: {
      family: "context-locker",
      name: String(input.extractor || "verified-container-header").slice(0, 80),
      version: "canonical-evidence-v1",
    },
  };
  const recordHash = sha256Hex(canonicalJson(basis));
  return Object.freeze({
    ...basis,
    evidence_id: stableUuid(`context-evidence:${recordHash}`),
    record_hash: recordHash,
  });
}

function safeChunkEnd(text, start) {
  let end = Math.min(text.length, start + MAX_EVIDENCE_TEXT);
  if (end < text.length && end > start && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
  return end;
}

function common(input) {
  const body = String(input?.body || "");
  if (!body) fail("context_evidence_text_required");
  return {
    replicaId: uuid(input?.replicaId, "context_evidence_replica_invalid"),
    ownerUserId: uuid(input?.ownerUserId, "context_evidence_owner_invalid"),
    sourceId: uuid(input?.sourceId, "context_evidence_source_invalid"),
    itemId: uuid(input?.itemId, "context_evidence_item_invalid"),
    inputSha256: assertSha256(input?.inputSha256, "context evidence source sha256"),
    canonicalTextSha256: sha256Hex(body),
    body,
    format: String(input?.format || "text").slice(0, 40),
    extractor: String(input?.extractor || "text-plain/v1").slice(0, 80),
  };
}

function provenance(base) {
  return Object.freeze({
    origin: "context_locker",
    context_item_id: base.itemId,
    source_id: base.sourceId,
    raw_content_sha256: base.inputSha256,
    canonical_text_sha256: base.canonicalTextSha256,
    format: base.format,
    protected_trait_inference: false,
    inner_state_inference: false,
  });
}

function directTextValue(base, text, locator, speaker = null) {
  return Object.freeze({
    text,
    language: "und",
    words: [],
    epistemic_status: "observed",
    observation_target: "owner_supplied_text",
    semantic_inference: false,
    ...(speaker ? { speaker } : {}),
    locator,
    calibration: { status: "not_applicable", method: "exact_stored_text", revision: base.extractor },
    provenance: provenance(base),
  });
}

/**
 * Create exact text evidence. Ordinary files require the owner's authorship
 * declaration. A chat export includes only the declared owner's messages and
 * carries a local-to-source fragment map, so third-party words never enter the
 * evidence `text` field.
 */
export function createContextTextEvidence(input) {
  const base = common(input);
  const format = base.format;
  const authorship = String(input?.authorship || "unknown");
  const segments = Array.isArray(input?.segments) ? input.segments : [];
  const rows = [];

  if (format === "whatsapp_export") {
    const ownerSpeaker = String(input?.ownerSpeaker || "");
    if (!ownerSpeaker) return Object.freeze([]);
    const owned = segments.filter((segment) => String(segment?.speaker || "") === ownerSpeaker);
    let current = "";
    let fragments = [];
    const flush = () => {
      if (!current) return;
      const locator = Object.freeze({
        unit: "utf16_code_units",
        shape: "fragment_map",
        fragments: Object.freeze(fragments),
        canonical_text_sha256: base.canonicalTextSha256,
        page_mapping: "unavailable",
      });
      rows.push(evidenceRecord(base, "text_span", directTextValue(base, current, locator, ownerSpeaker), `chat:${rows.length}`));
      current = "";
      fragments = [];
    };
    for (const segment of owned) {
      const start = finiteInt(segment?.start, "context_evidence_segment_invalid");
      const end = finiteInt(segment?.end, "context_evidence_segment_invalid", 1);
      if (end <= start || end > base.body.length || base.body.slice(start, end) !== String(segment?.text || "")) {
        fail("context_evidence_segment_mismatch");
      }
      let cursor = start;
      while (cursor < end) {
        const remaining = MAX_EVIDENCE_TEXT - current.length - (current ? 1 : 0);
        if (remaining <= 0) { flush(); continue; }
        let takeEnd = Math.min(end, cursor + remaining);
        if (takeEnd < end && /[\uD800-\uDBFF]/.test(base.body[takeEnd - 1])) takeEnd--;
        const prefix = current ? "\n" : "";
        const localStart = current.length + prefix.length;
        const fragment = base.body.slice(cursor, takeEnd);
        current += prefix + fragment;
        fragments.push(Object.freeze({
          source_start_char: cursor,
          source_end_char: takeEnd,
          local_start_char: localStart,
          local_end_char: localStart + fragment.length,
          speaker: ownerSpeaker,
        }));
        cursor = takeEnd;
        if (current.length >= MAX_EVIDENCE_TEXT) flush();
      }
    }
    flush();
    return Object.freeze(rows);
  }

  if (authorship !== "mine") return Object.freeze([]);
  let start = 0;
  while (start < base.body.length) {
    const end = safeChunkEnd(base.body, start);
    const locator = Object.freeze({
      unit: "utf16_code_units",
      shape: "contiguous",
      start_char: start,
      end_char: end,
      canonical_text_sha256: base.canonicalTextSha256,
      // Current PDF/DOCX extractors preserve exact canonical character spans
      // but not a page map. Saying unavailable is safer than inventing page 1.
      page_mapping: "unavailable",
    });
    rows.push(evidenceRecord(base, "text_span", directTextValue(base, base.body.slice(start, end), locator), `text:${start}:${end}`));
    start = end;
  }
  return Object.freeze(rows);
}

export function createContextImageEvidence(input) {
  const replicaId = uuid(input?.replicaId, "context_evidence_replica_invalid");
  const ownerUserId = uuid(input?.ownerUserId, "context_evidence_owner_invalid");
  const sourceId = uuid(input?.sourceId, "context_evidence_source_invalid");
  const itemId = uuid(input?.itemId, "context_evidence_item_invalid");
  const inputSha256 = assertSha256(input?.inputSha256, "context image sha256");
  const width = finiteInt(input?.width, "context_image_width_invalid", 1);
  const height = finiteInt(input?.height, "context_image_height_invalid", 1);
  const format = String(input?.format || "image").slice(0, 40);
  const base = { replicaId, ownerUserId, sourceId, itemId, inputSha256, extractor: "verified-image-header/v1" };
  const value = Object.freeze({
    epistemic_status: "observed",
    observation_target: "pixel_geometry",
    semantic_inference: false,
    locator: {
      unit: "pixels",
      shape: "rectangle",
      x: 0,
      y: 0,
      width,
      height,
      image_sha256: inputSha256,
    },
    ocr: { status: "not_run", reason: "ocr_not_configured" },
    visual_assertions: { status: "not_run", reason: "no_reviewed_visual_model" },
    provenance: {
      origin: "context_locker",
      context_item_id: itemId,
      source_id: sourceId,
      raw_content_sha256: inputSha256,
      format,
      protected_trait_inference: false,
      inner_state_inference: false,
    },
  });
  return Object.freeze([evidenceRecord(base, "image_region", value, `image:0:0:${width}:${height}`)]);
}

export function verifyContextCanonicalEvidence(record) {
  if (!record || !new Set(["text_span", "image_region"]).has(record.evidence_type)) fail("context_evidence_type_invalid");
  const replicaId = uuid(record.replica_id, "context_evidence_replica_invalid");
  const ownerUserId = uuid(record.owner_user_id, "context_evidence_owner_invalid");
  const sourceId = uuid(record.source_id, "context_evidence_source_invalid");
  const itemId = uuid(record.value?.provenance?.context_item_id, "context_evidence_item_invalid");
  const inputSha256 = assertSha256(record.input_sha256, "context evidence source sha256");
  if (record.schema_version !== PROCESSING_SCHEMA_VERSION || record.artifact_id !== null ||
      record.created_by_job_id !== null || record.confidence !== 1 ||
      record.span?.start_ms !== null || record.span?.end_ms !== null ||
      record.adapter?.family !== "context-locker" || record.adapter?.version !== "canonical-evidence-v1" ||
      !record.adapter?.name || replicaId !== record.replica_id || ownerUserId !== record.owner_user_id ||
      sourceId !== record.source_id || itemId !== record.value?.provenance?.context_item_id ||
      sourceId !== record.value?.provenance?.source_id || inputSha256 !== record.value?.provenance?.raw_content_sha256 ||
      record.value?.provenance?.origin !== "context_locker" || record.value?.epistemic_status !== "observed") {
    fail("context_evidence_contract_invalid");
  }
  const basis = { ...record };
  delete basis.evidence_id;
  delete basis.record_hash;
  const expectedHash = sha256Hex(canonicalJson(basis));
  const expectedId = stableUuid(`context-evidence:${expectedHash}`);
  if (record.record_hash !== expectedHash || record.evidence_id !== expectedId) fail("context_evidence_commitment_invalid");
  if (!/^(?:text:\d+:\d+|chat:\d+|image:0:0:\d+:\d+)$/.test(String(record.value?.evidence_key || ""))) fail("context_evidence_key_invalid");
  if (record.value?.provenance?.protected_trait_inference !== false || record.value?.provenance?.inner_state_inference !== false || record.value?.semantic_inference !== false) {
    fail("context_evidence_inference_forbidden");
  }
  if (record.evidence_type === "text_span" && (typeof record.value?.text !== "string" || !record.value.text || record.value.text.length > MAX_EVIDENCE_TEXT)) {
    fail("context_evidence_text_invalid");
  }
  if (record.evidence_type === "text_span") {
    const locator = record.value?.locator;
    if (record.value?.observation_target !== "owner_supplied_text" ||
        record.value?.calibration?.method !== "exact_stored_text" ||
        !/^[0-9a-f]{64}$/.test(String(locator?.canonical_text_sha256 || "")) ||
        locator?.page_mapping !== "unavailable" || locator?.unit !== "utf16_code_units") {
      fail("context_text_locator_invalid");
    }
    if (locator.shape === "contiguous") {
      const start = finiteInt(locator.start_char, "context_text_locator_invalid");
      const end = finiteInt(locator.end_char, "context_text_locator_invalid", 1);
      if (end <= start || end - start !== record.value.text.length ||
          record.value.evidence_key !== `text:${start}:${end}`) fail("context_text_locator_invalid");
    } else if (locator.shape === "fragment_map") {
      const fragments = Array.isArray(locator.fragments) ? locator.fragments : [];
      if (!fragments.length || !/^chat:\d+$/.test(record.value.evidence_key)) fail("context_text_locator_invalid");
      let localCursor = 0;
      for (const [index, fragment] of fragments.entries()) {
        const sourceStart = finiteInt(fragment?.source_start_char, "context_text_locator_invalid");
        const sourceEnd = finiteInt(fragment?.source_end_char, "context_text_locator_invalid", 1);
        const localStart = finiteInt(fragment?.local_start_char, "context_text_locator_invalid");
        const localEnd = finiteInt(fragment?.local_end_char, "context_text_locator_invalid", 1);
        const expectedStart = localCursor + (index ? 1 : 0);
        if (sourceEnd <= sourceStart || localEnd <= localStart || localStart !== expectedStart ||
            sourceEnd - sourceStart !== localEnd - localStart || localEnd > record.value.text.length ||
            !String(fragment?.speaker || "")) fail("context_text_locator_invalid");
        localCursor = localEnd;
      }
      if (localCursor !== record.value.text.length) fail("context_text_locator_invalid");
    } else {
      fail("context_text_locator_invalid");
    }
  }
  if (record.evidence_type === "image_region") {
    const locator = record.value?.locator;
    if (record.value?.observation_target !== "pixel_geometry" || record.value?.ocr?.status !== "not_run" ||
        record.value?.visual_assertions?.status !== "not_run" || locator?.unit !== "pixels" ||
        locator?.shape !== "rectangle" || locator?.x !== 0 || locator?.y !== 0 ||
        locator?.image_sha256 !== inputSha256 || finiteInt(locator?.width, "context_image_width_invalid", 1) < 1 ||
        finiteInt(locator?.height, "context_image_height_invalid", 1) < 1 ||
        record.value.evidence_key !== `image:0:0:${locator.width}:${locator.height}`) {
      fail("context_image_unmeasured_assertion_forbidden");
    }
  }
  return record;
}

export const CONTEXT_EVIDENCE_WRITE_SQL = `with owned_item as materialized (
  select i.item_id,i.replica_id,i.owner_user_id,i.source_id,i.content_sha256,i.format,i.extractor
    from vy_context_item i
    join vy_replica_source s on s.source_id=i.source_id and s.replica_id=i.replica_id
     and s.owner_user_id=i.owner_user_id and s.state='ready' and s.sha256=i.content_sha256
   where i.item_id=$1::uuid and i.replica_id=$2::uuid and i.owner_user_id=$3::uuid
), desired as materialized (
  select value item from jsonb_array_elements($4::jsonb)
), inserted as (
  insert into vy_replica_processing_evidence
    (evidence_id,replica_id,owner_user_id,source_id,artifact_id,created_by_job_id,
     evidence_type,span_start_ms,span_end_ms,confidence,value,input_sha256,
     adapter_family,adapter_name,adapter_version,record_hash)
  select (d.item->>'evidence_id')::uuid,(d.item->>'replica_id')::uuid,
         (d.item->>'owner_user_id')::uuid,(d.item->>'source_id')::uuid,null,null,
         d.item->>'evidence_type',null,null,(d.item->>'confidence')::double precision,
         d.item->'value',d.item->>'input_sha256',d.item#>>'{adapter,family}',
         d.item#>>'{adapter,name}',d.item#>>'{adapter,version}',d.item->>'record_hash'
    from desired d join owned_item i
      on i.replica_id=(d.item->>'replica_id')::uuid
     and i.owner_user_id=(d.item->>'owner_user_id')::uuid
     and i.source_id=(d.item->>'source_id')::uuid
     and i.content_sha256=d.item->>'input_sha256'
     and i.item_id=(d.item#>>'{value,provenance,context_item_id}')::uuid
     and i.source_id=(d.item#>>'{value,provenance,source_id}')::uuid
   where d.item->>'evidence_type' in ('text_span','image_region')
     and d.item#>>'{value,provenance,origin}'='context_locker'
     and (d.item#>>'{value,provenance,protected_trait_inference}')::boolean=false
     and (d.item#>>'{value,provenance,inner_state_inference}')::boolean=false
     and (d.item->>'evidence_type'<>'text_span' or d.item#>>'{value,text}' is not null)
  on conflict do nothing returning evidence_id
), covered as (
  select count(*)::integer total from desired d where exists (
    select 1 from vy_replica_processing_evidence e,owned_item i
     where e.evidence_id=(d.item->>'evidence_id')::uuid
       and e.replica_id=i.replica_id and e.owner_user_id=i.owner_user_id
       and e.source_id=i.source_id and e.input_sha256=i.content_sha256
       and e.record_hash=d.item->>'record_hash'
  )
)
select total from covered`;

// A new owner attribution replaces the old observation set. Clearing first is
// intentionally fail-closed: if the following insert is interrupted, there is
// temporarily no evidence rather than stale evidence assigned to the wrong
// speaker. A retry deterministically restores the exact same rows.
export const CONTEXT_TEXT_EVIDENCE_CLEAR_SQL = `with owned_item as materialized (
  select i.item_id,i.replica_id,i.owner_user_id,i.source_id
    from vy_context_item i
   where i.item_id=$1::uuid and i.replica_id=$2::uuid and i.owner_user_id=$3::uuid
     and i.source_id is not null
), invalidated_claims as (
  update vy_replica_claim c set status='superseded',updated_at=now()
    from owned_item i
   where c.replica_id=i.replica_id and c.owner_user_id=i.owner_user_id
     and i.source_id=any(c.source_ids) and c.status in ('proposed','approved')
  returning c.claim_id
), removed as (
  delete from vy_replica_processing_evidence e using owned_item i
   where e.replica_id=i.replica_id and e.owner_user_id=i.owner_user_id
     and e.source_id=i.source_id and e.evidence_type='text_span'
     and e.value#>>'{provenance,origin}'='context_locker'
     and e.value#>>'{provenance,context_item_id}'=i.item_id::text
  returning e.evidence_id
)
select count(*)::integer removed from removed`;

export async function clearContextCanonicalTextEvidence(db, input) {
  const rows = await db(CONTEXT_TEXT_EVIDENCE_CLEAR_SQL, [
    uuid(input?.itemId, "context_evidence_item_invalid"),
    uuid(input?.replicaId, "context_evidence_replica_invalid"),
    uuid(input?.ownerUserId, "context_evidence_owner_invalid"),
  ]);
  return Object.freeze({ removed: Number(rows[0]?.removed || 0) });
}

export async function persistContextCanonicalEvidence(db, input) {
  const records = Array.isArray(input?.records) ? input.records.map(verifyContextCanonicalEvidence) : [];
  if (!records.length) return Object.freeze({ expected: 0, covered: 0 });
  if (records.length > 128) fail("context_evidence_batch_too_large");
  const rows = await db(CONTEXT_EVIDENCE_WRITE_SQL, [
    uuid(input?.itemId, "context_evidence_item_invalid"),
    uuid(input?.replicaId, "context_evidence_replica_invalid"),
    uuid(input?.ownerUserId, "context_evidence_owner_invalid"),
    JSON.stringify(records),
  ]);
  const covered = Number(rows[0]?.total ?? -1);
  if (covered !== records.length) fail("context_evidence_persist_denied");
  return Object.freeze({ expected: records.length, covered });
}
