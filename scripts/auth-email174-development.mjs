// One-purpose migration 174 verifier for the isolated Vyakti development DB.
// Default mode is offline plan only. The explicit apply flag is required for
// DDL, and every network request is forced to the named development database.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { authEmailSqlCases } from "../api/_auth-email-store.js";

export const AUTH_EMAIL174_DATABASE = "vyakti_expert_integration_20260906";
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION_PATH = resolve(ROOT, "db/migrations/174_vyakti_auth_email_outbox.sql");
const SCHEMA_PATH = resolve(ROOT, "db/schema.sql");
const STORE_PATH = resolve(ROOT, "api/_auth-email-store.js");
const sha256 = value => createHash("sha256").update(value).digest("hex");
const cleanSql = value => value.replace(/^\s*--.*$/gmu, "").trim();
const statementsOf = value => cleanSql(value).split(";").map(value => value.trim()).filter(Boolean);

const CATALOG = Object.freeze({
  identity: "select current_database() as name",
  relation: "select to_regclass('public.vy_auth_email_outbox')::text as table_name,to_regclass('public.vy_auth_email_pilot_slot_seq')::text as sequence_name",
  count: "select count(*)::int as count from vy_auth_email_outbox",
  columns: `select a.attname as name,format_type(a.atttypid,a.atttypmod) as type,a.attnotnull as not_null,
    pg_get_expr(d.adbin,d.adrelid) as default_value
    from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid='public.vy_auth_email_outbox'::regclass and a.attnum>0 and not a.attisdropped order by a.attnum`,
  constraints: `select contype,pg_get_constraintdef(oid,true) as definition from pg_constraint
    where conrelid='public.vy_auth_email_outbox'::regclass order by contype,definition`,
  indexes: `select indexname,indexdef from pg_indexes where schemaname='public' and tablename='vy_auth_email_outbox' order by indexname`,
  sequence: `select data_type,start_value,min_value,max_value,increment_by,cycle from pg_sequences
    where schemaname='public' and sequencename='vy_auth_email_pilot_slot_seq'`,
  sequenceState: "select last_value::bigint as last_value,is_called from vy_auth_email_pilot_slot_seq",
});

const EXPECTED_COLUMNS = Object.freeze({
  request_id: "uuid", pilot_slot: "bigint", retry_pilot_slot: "bigint", request_hash: "text", email_hash: "text",
  redirect_url: "text", redirect_hash: "text", owner_user_id: "uuid", state: "text", preparation_token_hash: "text",
  preparation_lease_expires_at: "timestamp with time zone", payload_envelope: "jsonb", payload_hash: "text",
  acs_operation_id: "uuid", repeatability_first_sent: "timestamp with time zone", operation_location: "text",
  provider_status: "text", attempt_count: "integer", last_error_code: "text", expires_at: "timestamp with time zone",
  payload_erased_at: "timestamp with time zone", created_at: "timestamp with time zone", updated_at: "timestamp with time zone",
});

export async function authEmail174Plan() {
  const [migration, schema, store] = await Promise.all([readFile(MIGRATION_PATH, "utf8"), readFile(SCHEMA_PATH, "utf8"), readFile(STORE_PATH, "utf8")]);
  const ddl = statementsOf(migration), explains = authEmailSqlCases();
  assert.equal(ddl.length, 5, "migration174_exact_five_statements_required");
  assert(ddl.every(statement => /^create (?:sequence|table|(?:unique )?index) if not exists /iu.test(statement)), "migration174_additive_ddl_only");
  assert(ddl.every(statement => !/\b(?:alter|drop|delete|update|insert|do)\b/iu.test(statement)), "migration174_mutating_dml_or_destructive_ddl_refused");
  for (const statement of ddl) assert(schema.includes(statement), "migration174_schema_mirror_mismatch");
  assert.equal(explains.length, 14, "auth_email_exact_explain_inventory_required");
  for (const item of explains) {
    assert(!item.sql.includes(";"), `${item.name}_one_statement_required`);
    const max = Math.max(0, ...[...item.sql.matchAll(/\$(\d+)/gu)].map(match => Number(match[1])));
    assert.equal(max, item.params.length, `${item.name}_parameter_inventory_mismatch`);
  }
  return Object.freeze({
    schema: "vyakti.auth-email174-development-plan/v1", database: AUTH_EMAIL174_DATABASE,
    migrationSha256: sha256(migration), schemaSha256: sha256(schema), storeSha256: sha256(store),
    ddl, explains, providerCalls: 0, emailCalls: 0, userCalls: 0, modelCalls: 0,
  });
}

function verifyCatalog({ columns, constraints, indexes, sequence, sequenceState }) {
  assert.deepEqual(Object.fromEntries(columns.map(row => [row.name, row.type])), EXPECTED_COLUMNS, "migration174_column_contract_mismatch");
  assert.equal(columns.length, 23);
  const counts = constraints.reduce((out, row) => ({ ...out, [row.contype]: (out[row.contype] || 0) + 1 }), {});
  assert.deepEqual(counts, { c: 16, p: 1, u: 3 }, "migration174_constraint_inventory_mismatch");
  const definitions = constraints.map(row => String(row.definition).toLowerCase()).join("\n");
  for (const fragment of ["primary key (request_id)", "unique (pilot_slot)", "unique (retry_pilot_slot)", "unique (acs_operation_id)",
    "attempt_count >= 0", "attempt_count <= 3", "payload_envelope is null", "preparation_token_hash is null",
    "state = any", "expires_at > created_at"]) assert(definitions.includes(fragment), `migration174_constraint_missing_${fragment}`);
  const explicit = new Map(indexes.filter(row => /^vy_auth_email_outbox_(?:state|owner|expiry)_ix$/u.test(row.indexname)).map(row => [row.indexname, String(row.indexdef).toLowerCase()]));
  assert.deepEqual([...explicit.keys()].sort(), ["vy_auth_email_outbox_expiry_ix", "vy_auth_email_outbox_owner_ix", "vy_auth_email_outbox_state_ix"]);
  assert(explicit.get("vy_auth_email_outbox_state_ix").includes("(state, updated_at)"));
  assert(explicit.get("vy_auth_email_outbox_owner_ix").includes("owner_user_id is not null"));
  assert(explicit.get("vy_auth_email_outbox_expiry_ix").includes("payload_envelope is not null"));
  assert.equal(sequence.length, 1);
  assert.equal(sequence[0].data_type, "bigint");
  assert.deepEqual([Number(sequence[0].start_value), Number(sequence[0].min_value), Number(sequence[0].max_value), Number(sequence[0].increment_by), sequence[0].cycle], [1, 1, 50, 1, false]);
  assert.deepEqual([Number(sequenceState[0]?.last_value), sequenceState[0]?.is_called], [1, false], "migration174_pilot_sequence_must_be_unused");
  return { columns: columns.length, constraints: constraints.length, indexes: indexes.length };
}

export async function runAuthEmail174Development({ q, expectedMigrationSha256, writeReceipt }) {
  assert.equal(typeof q, "function", "development_query_function_required");
  assert.equal(typeof writeReceipt, "function", "durable_receipt_writer_required");
  const plan = await authEmail174Plan();
  assert.equal(expectedMigrationSha256, plan.migrationSha256, "migration174_hash_mismatch");
  const identity = (await q(CATALOG.identity))[0];
  assert.equal(identity?.name, AUTH_EMAIL174_DATABASE, "exact_development_database_required");
  const before = (await q(CATALOG.relation))[0] || {};
  if (before.table_name) assert.equal(Number((await q(CATALOG.count))[0]?.count), 0, "auth_email_outbox_must_be_empty_before_migration_proof");
  let ddlAcknowledged = 0;
  for (const statement of plan.ddl) { await q(statement); ddlAcknowledged += 1; }
  assert.equal((await q(CATALOG.identity))[0]?.name, AUTH_EMAIL174_DATABASE, "development_database_changed");
  const after = (await q(CATALOG.relation))[0] || {};
  assert.equal(after.table_name, "vy_auth_email_outbox");
  assert.equal(after.sequence_name, "vy_auth_email_pilot_slot_seq");
  const catalog = verifyCatalog({
    columns: await q(CATALOG.columns), constraints: await q(CATALOG.constraints), indexes: await q(CATALOG.indexes),
    sequence: await q(CATALOG.sequence), sequenceState: await q(CATALOG.sequenceState),
  });
  const explained = [];
  for (const item of plan.explains) {
    const rows = await q(`explain (format json) ${item.sql}`, item.params);
    assert.equal(rows.length, 1, `${item.name}_explain_missing`);
    explained.push(item.name);
  }
  let negativeSqlstate = "";
  try { await q("explain (format json) select auth_email174_missing_column from vy_auth_email_outbox"); }
  catch (cause) { negativeSqlstate = String(cause?.code || ""); }
  assert.equal(negativeSqlstate, "42703", "auth_email174_negative_control_missed");
  assert.equal(Number((await q(CATALOG.count))[0]?.count), 0, "auth_email_outbox_not_empty_after_explain");
  const finalSequence = await q(CATALOG.sequenceState);
  assert.deepEqual([Number(finalSequence[0]?.last_value), finalSequence[0]?.is_called], [1, false], "explain_consumed_pilot_sequence");
  const receipt = {
    schema: "vyakti.auth-email174-development-result/v1", at: new Date().toISOString(), database: AUTH_EMAIL174_DATABASE,
    migrationSha256: plan.migrationSha256, schemaSha256: plan.schemaSha256, storeSha256: plan.storeSha256,
    ddlAcknowledged, catalog, explained, negativeSqlstate, tableRows: 0, pilotSequenceUsed: false,
    providerCalls: 0, emailCalls: 0, userCalls: 0, modelCalls: 0,
  };
  await writeReceipt(receipt);
  return receipt;
}

async function developmentConnection() {
  const config = await import("../api/_config.js").catch(() => ({}));
  const raw = String(process.env.NEON_URL || config.NEON_URL || "").trim();
  assert(raw, "development_neon_url_required");
  const url = new URL(raw);
  assert(["postgres:", "postgresql:"].includes(url.protocol) && url.hostname.endsWith(".neon.tech"), "development_neon_url_invalid");
  url.pathname = `/${AUTH_EMAIL174_DATABASE}`;
  return url.href;
}

function neonQuery(connection) {
  const url = new URL(connection);
  return async (query, params = []) => {
    const response = await fetch(`https://${url.hostname}/sql`, { method: "POST", headers: {
      "Content-Type": "application/json", "Neon-Connection-String": connection,
    }, body: JSON.stringify({ query, params }), signal: AbortSignal.timeout(20_000) });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const code = /^[0-9A-Z]{5}$/u.test(String(body.code || "")) ? String(body.code) : "unknown";
      throw Object.assign(new Error(`auth_email174_sql_${response.status}_${code}`), { code });
    }
    return Array.isArray(body.rows) ? body.rows : [];
  };
}

async function durableReceipt(receipt) {
  const directory = resolve(ROOT, "scratchpad/auth-email174-development");
  await mkdir(directory, { recursive: true });
  const finalPath = resolve(directory, `result-${Date.now()}.json`), temporary = `${finalPath}.tmp`;
  await writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  await rename(temporary, finalPath);
  return finalPath;
}

async function main() {
  const plan = await authEmail174Plan();
  if (!process.argv.includes("--apply-development-174")) {
    console.log(JSON.stringify({ schema: plan.schema, status: "NOT_RUN", database: plan.database,
      migrationSha256: plan.migrationSha256, ddlStatements: plan.ddl.length, explainCases: plan.explains.map(item => item.name),
      next: `Re-run with --apply-development-174 --migration-sha256=${plan.migrationSha256}` }, null, 2));
    return;
  }
  const supplied = process.argv.find(value => value.startsWith("--migration-sha256="))?.slice("--migration-sha256=".length);
  const connection = await developmentConnection();
  let receiptPath = "";
  const result = await runAuthEmail174Development({ q: neonQuery(connection), expectedMigrationSha256: supplied,
    writeReceipt: async receipt => { receiptPath = await durableReceipt(receipt); } });
  console.log(JSON.stringify({ status: "PASS", database: result.database, migrationSha256: result.migrationSha256,
    ddlAcknowledged: result.ddlAcknowledged, explained: result.explained.length, negativeSqlstate: result.negativeSqlstate,
    receiptPath, providerCalls: 0, emailCalls: 0, userCalls: 0, modelCalls: 0 }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(cause => { console.error(String(cause?.code || cause?.message || "auth_email174_development_failed").slice(0, 160)); process.exitCode = 1; });
}
