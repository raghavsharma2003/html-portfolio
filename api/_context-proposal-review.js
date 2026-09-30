import { createHash } from "node:crypto";
import { citationViolations } from "./_context-mining.js";
import { MAX_EXTRACTED_CHARS, MAX_CITATIONS_PER_CANDIDATE } from "./_context/limits.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const PROPOSAL_MAX_BYTES = 128 * 1024;
export const PROPOSAL_VIEW_MAX_BYTES = 128 * 1024;
export class ContextProposalReviewError extends Error {
  constructor(code, status = 409) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new ContextProposalReviewError(code, status); };

// Exported for real-database EXPLAIN. No teacher agent or draft is required.
// Every stored text row and run is scoped before any private bytes leave SQL.
export const CONTEXT_PROPOSAL_REVIEW_SQL = `
 select i.item_id, i.replica_id, i.source_name, i.authorship, i.owner_speaker, i.format,
        r.run_id, r.status as run_status, r.proposed_delta, t.body
   from vy_context_item i
   join vy_replica p on p.replica_id=i.replica_id and p.owner_user_id=i.owner_user_id
   join vy_ingest_run r on r.run_id=i.run_id and r.replica_id=i.replica_id
     and r.owner_user_id=i.owner_user_id and r.transcript_source='context_item'
     and r.video_ref='context:' || i.item_id::text
   join vy_context_item_text t on t.item_id=i.item_id and t.replica_id=i.replica_id
     and t.owner_user_id=i.owner_user_id
  where i.replica_id=$1::uuid and i.item_id=$2::uuid and i.owner_user_id=$3::uuid
    and p.lifecycle not in ('revoked','purging') and i.status='mined'
    and (i.source_id is null or exists (
      select 1 from vy_replica_source s where s.source_id=i.source_id
        and s.replica_id=i.replica_id and s.owner_user_id=i.owner_user_id
        and s.state not in ('deleting','rejected')
    ))
  limit 1`;

export async function readContextProposalReview(db, ownerId, replicaId, itemId) {
  if (![ownerId, replicaId, itemId].every(value => typeof value === "string" && UUID.test(value))) {
    fail("context_proposal_identity_invalid", 400);
  }
  const [row] = await db(CONTEXT_PROPOSAL_REVIEW_SQL, [replicaId.toLowerCase(), itemId.toLowerCase(), ownerId.toLowerCase()]);
  if (!row) fail("context_proposal_not_available", 404);
  const state = { proposed: "pending", rejected: "rejected", applied: "historical_unconfirmed" }[row.run_status];
  if (!state) fail("context_proposal_not_available", 404);
  const delta = row.proposed_delta;
  if (!delta || Buffer.byteLength(JSON.stringify(delta), "utf8") > PROPOSAL_MAX_BYTES
    || delta.kind !== "context-sheet-candidates/v1" || !Array.isArray(delta.additions)
    || !delta.additions.length || delta.additions.length > 100
    || typeof row.body !== "string" || !row.body.length || row.body.length > MAX_EXTRACTED_CHARS
    || delta.item?.item_id !== row.item_id || delta.item?.chars !== row.body.length
    || (delta.measurements && delta.measurements.citation?.item_id !== row.item_id)
    || typeof row.source_name !== "string" || row.source_name.length > 500
    || (row.format === "whatsapp_export" ? !row.owner_speaker : row.authorship !== "mine")) {
    fail("context_proposal_content_invalid");
  }
  const additions = delta.additions;
  for (const addition of additions) {
    if (!addition || !["boardVerbalisms", "exSlangRepeat"].includes(addition.field)
      || typeof addition.fragment !== "string" || !addition.fragment.trim() || addition.fragment.length > 500
      || !Number.isSafeInteger(addition.occurrences) || addition.occurrences < 1
      || !Array.isArray(addition.citations) || !addition.citations.length
      || addition.citations.length > MAX_CITATIONS_PER_CANDIDATE
      || addition.citations.some(c => !c || c.item_id !== row.item_id || typeof c.speaker !== "string"
        || c.speaker.length > 200 || (row.format === "whatsapp_export" && c.speaker !== row.owner_speaker))) {
      fail("context_proposal_content_invalid");
    }
  }
  // Reuse the miner's Unicode-aware integrity predicate, not a display approximation.
  if (citationViolations(delta, row.body).length) fail("context_proposal_citation_invalid");
  const proposalHash = createHash("sha256").update(JSON.stringify(delta)).digest("hex");
  const view = {
    replica_id: row.replica_id, item_id: row.item_id, source_name: row.source_name,
    proposal: {
      run_id: row.run_id, state,
      candidates: additions.map((addition, index) => ({
        candidate_id: `${proposalHash}:${index}`, field: addition.field, fragment: addition.fragment,
        occurrences: addition.occurrences,
        citations: addition.citations.map(c => {
          const span = row.body.slice(c.span.start, c.span.end);
          return { excerpt: span.slice(0, 240), clipped: span.length > 240 };
        }),
      })),
    },
  };
  if (Buffer.byteLength(JSON.stringify(view), "utf8") > PROPOSAL_VIEW_MAX_BYTES) fail("context_proposal_view_too_large");
  return view;
}
