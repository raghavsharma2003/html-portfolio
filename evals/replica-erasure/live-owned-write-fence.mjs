// Read-only rollout gate for migration 076. It inventories historical rows
// before apply and verifies the exact composite cascade after apply.
import { q } from "../../api/_db.js";

const tables = [
  "vy_replica_audit",
  "vy_clone_channel",
  "vy_channel_attestation",
  "vy_channel_watch",
  "vy_ingest_run",
  "vy_context_item",
  "vy_context_item_text",
  "vy_video_enrollment",
  "vy_video_enrollment_window",
];
const validatedTables = new Set(tables.slice(1));
const agentTables = ["meera_log", "vy_episode", "vy_fact", "vy_teacher_sheet"];

const inventory = {};
for (const table of tables) {
  const rows = await q(
    `select count(*)::integer total,
            count(*) filter (where replica_id is not null and not exists (
              select 1 from vy_replica r
               where r.replica_id=t.replica_id and r.owner_user_id=t.owner_user_id
            ))::integer orphans
       from ${table} t`,
    [],
  );
  inventory[table] = rows[0];
  if (validatedTables.has(table) && Number(rows[0]?.orphans || 0) !== 0) {
    throw new Error(`076_preflight_orphans:${table}:${rows[0].orphans}`);
  }
}
console.log("live content-free 076 orphan inventory", inventory);

const agentInventory = {};
for (const table of agentTables) {
  const rows = await q(
    `select count(*)::integer total,
            count(*) filter (where not exists (
              select 1 from vy_agent a where a.agent_id=t.agent_id
            ))::integer orphans
       from ${table} t`,
    [],
  );
  agentInventory[table] = rows[0];
  if (Number(rows[0]?.orphans || 0) !== 0) {
    throw new Error(`076_preflight_agent_orphans:${table}:${rows[0].orphans}`);
  }
}
console.log("live content-free 076 agent orphan inventory", agentInventory);

const constraints = await q(
  `select c.conname,tc.relname table_name,c.confdeltype,c.convalidated,
          pg_get_constraintdef(c.oid) definition
     from pg_constraint c
     join pg_class tc on tc.oid=c.conrelid
     join pg_namespace n on n.oid=tc.relnamespace
    where n.nspname='public' and c.conname=any($1::text[])
    order by c.conname`,
  [[...tables.map((table) => `${table}_replica_owner_fk`), ...agentTables.map((table) => `${table}_agent_fk`)]],
);
if (constraints.length === 0) {
  console.log("skip live 076 constraint proof: migration 076 is not applied");
  process.exit(0);
}
if (constraints.length !== tables.length + agentTables.length) {
  throw new Error(`076_partial_apply:${constraints.length}/${tables.length + agentTables.length}`);
}
for (const row of constraints) {
  const agentScoped = agentTables.includes(row.table_name);
  const expected = `${row.table_name}_${agentScoped ? "agent" : "replica_owner"}_fk`;
  const exactDefinition = agentScoped
    ? /FOREIGN KEY \(agent_id\) REFERENCES vy_agent\(agent_id\) ON DELETE CASCADE/.test(row.definition)
    : /FOREIGN KEY \(replica_id, owner_user_id\) REFERENCES vy_replica\(replica_id, owner_user_id\) ON DELETE CASCADE/.test(row.definition);
  if (row.conname !== expected || row.confdeltype !== "c" || !exactDefinition ||
      (row.table_name === "vy_replica_audit" ? row.convalidated : !row.convalidated)) {
    throw new Error(`076_constraint_invalid:${row.table_name}`);
  }
}
console.log("ok live 076 exact cascades enforce nine replica and four target-agent late-write lanes; audit is prospective");
