import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONTEXT_PROPOSAL_REVIEW_SQL as SQL, readContextProposalReview as read } from "../api/_context-proposal-review.js";

const replica = "11111111-1111-4111-8111-111111111111";
const item = "22222222-2222-4222-8222-222222222222";
const owner = "33333333-3333-4333-8333-333333333333";
const other = "44444444-4444-4444-8444-444444444444";
const body = "चलो समझते हैं। This is how we work. चलो समझते हैं।";
const base = {
  replica_id: replica, item_id: item, run_id: other, run_status: "proposed",
  source_name: "My lesson.txt", body, format: "txt", authorship: "mine", owner_speaker: "",
  proposed_delta: { kind: "context-sheet-candidates/v1", item: { item_id: item, chars: body.length },
    additions: [{ field: "boardVerbalisms", fragment: "चलो समझते हैं", occurrences: 2,
      citations: [{ item_id: item, span: { start: 0, end: body.length }, speaker: "owner" }] }] },
};
let checks = 0;
const check = async (name, test) => { await test(); console.log(`ok ${++checks} - ${name}`); };
const fetchRow = row => async (sql, args) => { assert.equal(sql, SQL); assert.deepEqual(args, [replica, item, owner]); return row ? [row] : []; };
const changed = edit => { const row = structuredClone(base); edit(row); return row; };
const reject = (row, code) => assert.rejects(() => read(fetchRow(row), owner, replica, item), error => error.code === code && !error.details);

await check("actual helper returns cited Hindi fragments for a fresh unbound replica", async () => {
  const result = await read(fetchRow(base), owner, replica, item);
  assert.equal(result.proposal.state, "pending");
  assert.equal(result.proposal.candidates[0].fragment, "चलो समझते हैं");
  assert.equal(result.proposal.candidates[0].citations[0].excerpt, body);
  assert.equal(JSON.stringify(result).includes('"body"'), false);
  assert.equal(JSON.stringify(result).includes('"owner_user_id"'), false);
});
await check("invalid identity never calls SQL", () => assert.rejects(() => read(() => assert.fail("queried"), "bad", replica, item), /context_proposal_identity_invalid/));
await check("missing, removed and inaccessible rows share unavailable response", () => reject(null, "context_proposal_not_available"));
await check("caller owner is passed as SQL authority", async () => {
  await assert.rejects(() => read(async (sql, args) => { assert.equal(args[2], other); return []; }, other, replica, item), /not_available/);
});
await check("a different citation item cannot borrow valid text", () => reject(changed(r => r.proposed_delta.additions[0].citations[0].item_id = other), "context_proposal_content_invalid"));
await check("changed canonical text invalidates saved citations", () => reject(changed(r => { r.body = "x".repeat(body.length); }), "context_proposal_citation_invalid"));
await check("changed source length invalidates proposal metadata", () => reject(changed(r => r.body += " changed"), "context_proposal_content_invalid"));
await check("unsupported fields cannot masquerade as suggested phrases", () => reject(changed(r => r.proposed_delta.additions[0].field = "neverRules"), "context_proposal_content_invalid"));
await check("no uncited suggestion returns a partial success", () => reject(changed(r => r.proposed_delta.additions[0].citations = []), "context_proposal_content_invalid"));
await check("speaker reassignment rejects another speaker's citation", () => reject(changed(r => { r.format = "whatsapp_export"; r.owner_speaker = "Teacher"; }), "context_proposal_content_invalid"));
await check("fractional occurrence count is refused", () => reject(changed(r => r.proposed_delta.additions[0].occurrences = 0.5), "context_proposal_content_invalid"));
await check("oversized fragment is refused without silent slicing", () => reject(changed(r => r.proposed_delta.additions[0].fragment = "a".repeat(501)), "context_proposal_content_invalid"));
await check("oversized stored data is refused", () => reject(changed(r => r.proposed_delta.unused = "a".repeat(131073)), "context_proposal_content_invalid"));
await check("historically applied status is not a success receipt", async () => {
  assert.equal((await read(fetchRow(changed(r => r.run_status = "applied")), owner, replica, item)).proposal.state, "historical_unconfirmed");
});
await check("rejected suggestions remain rejected", async () => {
  assert.equal((await read(fetchRow(changed(r => r.run_status = "rejected")), owner, replica, item)).proposal.state, "rejected");
});
await check("failed run cannot expose old proposed data", () => reject(changed(r => r.run_status = "failed"), "context_proposal_not_available"));
await check("long source excerpts are explicitly marked shortened", async () => {
  const row = changed(r => { r.body += " tail".repeat(70); r.proposed_delta.item.chars = r.body.length; r.proposed_delta.additions[0].citations[0].span.end = r.body.length; });
  const citation = (await read(fetchRow(row), owner, replica, item)).proposal.candidates[0].citations[0];
  assert.equal(citation.excerpt.length, 240); assert.equal(citation.clipped, true);
});

const scopeClauses = ["r.run_id=i.run_id", "r.replica_id=i.replica_id", "r.owner_user_id=i.owner_user_id",
  "r.transcript_source='context_item'", "r.video_ref='context:' || i.item_id::text",
  "t.item_id=i.item_id", "t.replica_id=i.replica_id", "t.owner_user_id=i.owner_user_id",
  "p.replica_id=i.replica_id", "p.owner_user_id=i.owner_user_id", "i.replica_id=$1::uuid",
  "i.item_id=$2::uuid", "i.owner_user_id=$3::uuid", "p.lifecycle not in ('revoked','purging')",
  "i.status='mined'", "s.source_id=i.source_id", "s.replica_id=i.replica_id", "s.owner_user_id=i.owner_user_id",
  "s.state not in ('deleting','rejected')"];
const guards = sql => scopeClauses.every(clause => sql.includes(clause));
await check("SQL scope guard catches every removed authority/latest-run predicate mutant", () => {
  assert.equal(guards(SQL), true);
  for (const clause of scopeClauses) assert.equal(guards(SQL.replace(clause, "true")), false, clause);
  assert.doesNotMatch(SQL, /\b(insert|update|delete)\b/i);
  assert.doesNotMatch(SQL, /agent_id/);
});
await check("HTTP dispatch precedes agent-dependent ordinary sheet read", () => {
  const source = readFileSync(new URL("../api/teacher-sheet.js", import.meta.url), "utf8");
  assert.ok(source.indexOf('req.query?.op === "ingest_review"') < source.indexOf("const sheet = await readOwnedTeacherSheet"));
  assert.match(source, /readContextProposalReview\(q, user.id, req.query\?\.replica_id, req.query\?\.item_id\)/);
});
console.log(`PASS ${checks} context proposal checks; SQL guard mutants are structural evidence, not real SQL execution.`);
