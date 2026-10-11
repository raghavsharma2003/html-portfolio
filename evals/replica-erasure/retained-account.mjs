// Offline boundary proof over real emitted SQL, checked-in FKs, and the real
// relcheck control flow with an injected catalog. No database/network call;
// these checks do not claim SQL parsing or live referential-integrity proof.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { REPLICA_ERASURE_RETAINED_ACCOUNT_TABLES as retained } from "../../api/_replica-erasure-retained.js";
import { completeReplicaErasure, createReplicaErasureReceipt } from "../../api/_replica-full-erasure.js";
import { completeSourceErasure } from "../../api/_replica-source-erasure.js";
import { completeVoiceErasure } from "../../api/_replica-voice-erasure.js";
import { PERSON_TABLES } from "../../api/memory.js";
import { parseForeignKeys, cascadeReach } from "../erasure-order/fk-graph.mjs";

let checks = 0;
function ok(name, condition) {
  assert.ok(condition, name);
  console.log(`ok ${++checks} - ${name}`);
}
const exactReasons = {
  vy_creator_payout: /payout history.*replicas.*financial history/i,
  vy_creator_payout_account: /payout destination.*shared.*payout configuration/i,
  vy_creator_invite: /redeemed_by_user_id.*account admission.*one replica/i,
  vy_org_member: /organization membership.*account.*other replicas/i,
  vy_operator_push_subscription: /operator notification credentials.*operator role.*replicas/i,
  vy_creator_push_subscription: /creator notification credentials.*account.*replicas/i,
};
const names = Object.keys(exactReasons);
ok("retention inventory is frozen and contains exactly the six account tables",
  Object.isFrozen(retained) && JSON.stringify(Object.keys(retained).sort()) === JSON.stringify([...names].sort()));
for (const name of names) ok(`${name} has its specific account ownership reason`, exactReasons[name].test(retained[name]));

const stripComments = (sql) => sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
const namedDeletes = (sql) => new Set([...stripComments(sql).matchAll(
  /\bdelete\s+from\s+(?:only\s+)?(?:(?:"?public"?)\s*\.\s*)?"?((?:vy_|meera_)[a-z0-9_]+)"?\b/gi,
)].map((match) => match[1].toLowerCase()));
// The existing ordering parser groups SET NULL/DEFAULT with non-blocking
// cascades. They do not DELETE children, so normalize them before this walk.
const deletionEdges = (ddl) => parseForeignKeys(stripComments(ddl)
  .replace(/on\s+delete\s+set\s+(?:null|default)/gi, "on delete no action"));
const schema = await readFile(new URL("../../db/schema.sql", import.meta.url), "utf8");
const edges = deletionEdges(schema);
ok("real schema FK scan is nonempty", edges.length > 100);
const replicaReached = cascadeReach(edges, "vy_replica");
for (const name of names) ok(`${name} survives the schema's replica cascade`, !replicaReached.has(name));
function retainedDeletes(sql, fks = edges) {
  const reached = new Set();
  for (const parent of namedDeletes(sql)) for (const table of cascadeReach(fks, parent)) reached.add(table);
  return names.filter((name) => reached.has(name));
}

const JOB = "10000000-0000-4000-8000-000000000001";
const RID = "20000000-0000-4000-8000-000000000002";
const OWNER = "30000000-0000-4000-8000-000000000003";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const VOICE = "50000000-0000-4000-8000-000000000005";
const TOKEN = "retained-account-test-lease-token-over-thirty-two-bytes";
const receipt = createReplicaErasureReceipt(RID, OWNER, {
  REPLICA_ERASURE_RECEIPT_KEY_B64: Buffer.alloc(32, 7).toString("base64"),
  REPLICA_BACKUP_RETENTION_DAYS: "30",
}, { nonce: "c".repeat(64), nowMs: 0, erasureRequestId: JOB });
const statements = [];
for (const scoped of [false, true]) {
  const erasureScope = scoped ? { jobId: JOB, replicaId: RID, ownerUserId: OWNER } : undefined;
  const label = scoped ? "owner scoped" : "operator sweep";
  await completeReplicaErasure(async (sql) => {
    statements.push({ label: `${label} full`, sql });
    return [{ receipt_id: VOICE }];
  }, { jobId: JOB, replicaId: RID, ownerUserId: OWNER, leaseToken: TOKEN, erasureScope }, receipt);
  for (const privateSchema of [false, true]) {
    await completeSourceErasure(async (sql) => {
      if (sql.includes("private_voice_present")) return [{ private_voice_present: privateSchema }];
      statements.push({ label: `${label} source private-schema=${privateSchema}`, sql });
      return [{ source_id: SOURCE }];
    }, { source: { sourceId: SOURCE, replicaId: RID, ownerUserId: OWNER }, leaseToken: TOKEN, erasureScope });
  }
  await completeVoiceErasure(async (sql) => {
    statements.push({ label: `${label} voice`, sql });
    return [{ voice_profile_id: VOICE }];
  }, { profile: { voiceProfileId: VOICE, replicaId: RID, ownerUserId: OWNER }, leaseToken: TOKEN, erasureScope });
}
ok("all full/source/voice completion variants emitted real statements", statements.length === 8);
for (const { label, sql } of statements) {
  ok(`${label} contains real DELETEs but cannot delete retained account state`,
    namedDeletes(sql).size > 0 && retainedDeletes(sql).length === 0);
  for (const name of names) {
    const mutant = sql.replace(/\bwith\b/i,
      `with forbidden_account_delete as (DELETE FROM ONLY public."${name}" WHERE owner_user_id=$3::uuid),`);
    ok(`negative control: ${label} named DELETE of ${name} is detected`, retainedDeletes(mutant).includes(name));
  }
}
for (const name of names) {
  const mutant = `${schema}\nalter table ${name} add constraint forbidden_account_cascade
    foreign key (owner_user_id) references vy_replica (owner_user_id) on delete cascade;`;
  ok(`negative control: schema cascade to ${name} is detected`,
    retainedDeletes("delete from vy_replica", deletionEdges(mutant)).includes(name));
}
ok("SELECTs and comments mentioning retained tables never count as deletes",
  retainedDeletes(`select * from vy_creator_payout; -- delete from vy_org_member
    /* DELETE FROM vy_creator_invite */ select 1`).length === 0);
ok("SET NULL never masquerades as a deleting cascade",
  retainedDeletes("delete from vy_replica", deletionEdges(`create table vy_creator_payout (
    owner_user_id uuid references vy_replica(owner_user_id) on delete set null);`)).length === 0);

// Run relcheck's actual control flow against a small injected catalog. The
// import replacement removes its live q dependency before evaluation; the
// only reads below are checked-in local source files.
const relcheckUrl = new URL("../../scripts/relcheck.mjs", import.meta.url);
const relcheckSource = (await readFile(relcheckUrl, "utf8"))
  .replace(/^import[^\n]*;\r?$/gm, "")
  .replaceAll("import.meta.url", "REL_URL");
const runRelcheck = new (Object.getPrototypeOf(async function () {}).constructor)(
  "readFile", "q", "PERSON_TABLES", "REPLICA_ERASURE_RETAINED_ACCOUNT_TABLES", "REL_URL", "console", "process", relcheckSource);
async function gate({ extraOwner, cascadeTo, deleteFrom, deleteTable, commentOnly = false } = {}) {
  const catalog = ["vy_replica", ...names, ...(extraOwner ? [extraOwner] : [])];
  const logs = [];
  let code;
  const db = async (sql, params = []) => {
    if (sql.includes("information_schema.columns")) return params.length ? catalog.map((table_name) => ({ table_name })) : [];
    if (sql.includes("select tc.relname child")) return cascadeTo ? [{ parent: "vy_replica", child: cascadeTo, del: "c" }] : [];
    if (sql.includes("to_regclass")) return [{ present: false }];
    return [{ n: 0 }];
  };
  await runRelcheck(async (url, encoding) => {
    const source = await readFile(url, encoding);
    return deleteFrom && url.pathname.endsWith(deleteFrom)
      ? `${source}\n${commentOnly ? "// " : ""}DELETE FROM ONLY public."${deleteTable}" WHERE owner_user_id=$3::uuid;\n`
      : source;
  }, db, PERSON_TABLES, retained, relcheckUrl.href,
  { log: (line) => logs.push(String(line)) }, { exit: (value) => { code = value; } });
  return { code, logs };
}
let result = await gate();
ok("real relcheck accepts the exact retained inventory with no deleting reach", result.code === 0);
result = await gate({ extraOwner: "vy_unlisted_replica_private_data" });
ok("negative control: real relcheck still rejects every other unaccounted owner table",
  result.code === 1 && result.logs.some((line) => line.includes("FAIL  owner-lane erasure reach: vy_unlisted_replica_private_data")));
for (const name of names) {
  result = await gate({ cascadeTo: name });
  ok(`negative control: real relcheck rejects retained cascade ${name}`,
    result.code === 1 && result.logs.some((line) => line.includes(`FAIL  retained account erasure boundary: ${name}`)));
  for (const file of ["_replica-full-erasure.js", "_replica-source-erasure.js", "_replica-voice-erasure.js", "_private-voice-erasure.js"]) {
    result = await gate({ deleteFrom: file, deleteTable: name });
    ok(`negative control: real relcheck rejects ${file} DELETE of ${name}`,
      result.code === 1 && result.logs.some((line) => line.includes(`FAIL  retained account erasure boundary: ${name}`)));
  }
}
result = await gate({ deleteFrom: "_replica-full-erasure.js", deleteTable: names[0], commentOnly: true });
ok("real relcheck ignores explanatory DELETE comments", result.code === 0);
console.log(`retained account erasure: ${checks} checks passed (offline; no live DB proof)`);
