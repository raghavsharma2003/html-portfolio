import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

let checks = 0;
let failed = 0;
const ok = (value, label) => {
  checks++;
  if (value) return;
  failed++;
  console.error(`FAIL ${label}`);
};

const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const REPLICA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const recall = await load("api/_experience-compiler/mirror-recall.js");
let captured = null;
const rows = await recall.approvedMirrorRecall(async (sql, params) => {
  captured = { sql, params };
  return [{ id: 7, name: "launch", body: "launch review is Monday", created_at: "2026-08-30T00:00:00Z" }];
}, OWNER, REPLICA);

ok(rows.length === 1 && rows[0].body === "launch review is Monday",
  "approved recall returns bounded fact bodies");
ok(captured.params[0] === REPLICA && captured.params[1] === OWNER,
  "replica and authenticated owner are bound parameters");
ok(/r\.replica_id=\$1::uuid and r\.owner_user_id=\$2::uuid/.test(captured.sql),
  "owner isolation is a SQL predicate");
ok(/r\.subject_mode='self'/.test(captured.sql),
  "only an owner-to-own-replica dyad is eligible");
ok(/consent\.scope='training'/.test(captured.sql)
  && /consent\.policy_version=r\.policy_version/.test(captured.sql)
  && /consent\.revoked_at is null/.test(captured.sql),
  "training-consent revocation immediately suppresses relational recall");
ok(/f\.agent_id=scope\.agent_id and f\.person_id=scope\.subject_person_id/.test(captured.sql),
  "retrieval binds both agent and subject person");
ok(/approved\.boundary_reason like \('replica_claim:'\|\|c\.proposal_hash\|\|':%'\)/.test(captured.sql),
  "only an exact proposal-bound replica-claim materialization enters this lane");
ok(/c\.status='approved'/.test(captured.sql) && /d\.decision='accepted'/.test(captured.sql)
  && /newer\.created_at,newer\.decision_id/.test(captured.sql),
  "recall independently requires the claim's latest live decision to remain accepted");
ok(/disclosure predicate/.test(captured.sql) && /cardinality\(\(array\[scope\.subject_person_id\]\)::uuid\[\]\) >= 1/.test(captured.sql),
  "the shared structural disclosure predicate, not prompt text, controls recall");
ok(/f\.t_invalid is null and f\.retracted_at is null/.test(captured.sql),
  "invalidated and retracted facts are excluded");
ok(/limit 8/.test(captured.sql), "reply memory is bounded to eight facts");

const materializer = readFileSync(join(ROOT, "api/_experience-compiler/relational-materializer.js"), "utf8");
ok(/false,'participants_1to1'/.test(materializer),
  "accepted claim episodes use owner-readable one-to-one disclosure scope");
ok(/insert into vy_episode_participant \(episode_id,person_id,role\)/.test(materializer),
  "the exact subject is inserted into the episode ACL");
ok(/set disclosure_scope='participants_1to1'/.test(materializer),
  "idempotent replay repairs pre-fix accepted episodes");
ok(!/c\.body,greatest\(0\.1,c\.confidence\),false,'private'/.test(materializer),
  "NEGATIVE CONTROL: the stored-but-unreadable private episode shape is gone");

if (failed) {
  console.error(`mirror relational recall: ${checks - failed}/${checks}`);
  process.exit(1);
}
console.log(`mirror relational recall: ${checks}/${checks} PASS`);
