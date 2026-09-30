// Read-only Neon parser gate for the post-call owner speaker attestation.
// EXPLAIN without ANALYZE plans the data-modifying CTE but executes no write.
import { q } from "../../api/_db.js";
import {
  attestMirrorOwnerSpeaker,
  mirrorOwnerSpeakerAttestationStatus,
} from "../../api/_mirrorcall-speaker-attestation.js";

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const WINDOW = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const SOURCE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const windows = [{
  window_id: WINDOW,
  session_id: SESSION,
  replica_id: REPLICA,
  source_id: SOURCE,
  seq: 1,
  duration_ms: 12_000,
  input_sha256: "a".repeat(64),
}];

let statement = "";
let bound = [];
await attestMirrorOwnerSpeaker(async (sql, params) => {
  if (/select distinct w\.window_id,w\.session_id/.test(sql)) return windows;
  statement = sql;
  bound = params;
  return [{
    eligible_windows: 1,
    attested_windows: 1,
    newly_attested_windows: 1,
    claim_job_state: "queued",
  }];
}, OWNER, { session_id: SESSION, choice: "only_me" });

if (!statement || bound.length !== 8) throw new Error("mirror_speaker_attestation_live_explain_capture_failed");
await q(`explain (format json) ${statement}`, bound);
await mirrorOwnerSpeakerAttestationStatus(q, OWNER, SESSION);
console.log("ok live Neon read-only EXPLAIN parsed owner-speaker attestation and status SQL");

const claimIntegrity = await q(`select count(*)::int total_claims,
  count(*) filter (where c.extractor_run_id is not null)::int extracted_claims,
  count(*) filter (where c.extractor_run_id is not null and not exists (
    select 1 from vy_replica_claim_citation cc where cc.claim_id=c.claim_id
      and cc.replica_id=c.replica_id and cc.owner_user_id=c.owner_user_id
  ))::int extracted_uncited,
  count(*) filter (where c.status='approved' and not exists (
    select 1 from vy_replica_claim_citation cc where cc.claim_id=c.claim_id
      and cc.replica_id=c.replica_id and cc.owner_user_id=c.owner_user_id
  ))::int approved_uncited
  from vy_replica_claim c`);
console.log("live claim integrity inventory", claimIntegrity[0]);

const expressionInventory = await q(`select count(*)::int total,
  count(*) filter (where expires_at>now())::int active,
  count(*) filter (where expires_at<=now())::int expired,
  min(expires_at) filter (where expires_at<=now()) oldest_expired_at
  from vy_replica_expression_observation`);
console.log("live expression retention inventory", expressionInventory[0]);
