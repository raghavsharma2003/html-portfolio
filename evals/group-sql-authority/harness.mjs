// Hosted-only synthetic PostgreSQL. No Neon client or local database launcher.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { build } from 'esbuild';
import { splitSql } from '../../db/migrations/apply.mjs';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
export const hash = value => createHash('sha256').update(value).digest('hex');
export const uid = n => `d0000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

// The database is an expendable service owned by ONE hosted test job. Neither
// the endpoint nor the credential can be supplied by a caller/environment URL.
export function hostedGuard(env = process.env, platform = process.platform) {
  assert.equal(platform, 'linux', 'SQL proof is GitHub-hosted Linux only');
  assert.equal(env.GITHUB_ACTIONS, 'true', 'SQL proof requires GitHub Actions');
  assert.equal(env.RUNNER_ENVIRONMENT, 'github-hosted', 'self-hosted SQL is prohibited');
  assert.equal(env.GROUP_SQL_SYNTHETIC, 'hosted-ephemeral-only');
  for (const name of ['NEON_URL', 'DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER',
    'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'AZURE_KEY', 'AZURE_ENDPOINT',
    'OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    assert.ok(!env[name], `SQL proof refuses externally supplied ${name}`);
  }
}

// PostgreSQL performs the parameter typing. PREPARE retains the production
// placeholders; only EXECUTE's synthetic argument literals are serialized.
// ARRAY['uuid', ...] is an independently typed text[] expression, not an
// unknown argument, and PostgreSQL cannot implicitly coerce it to uuid[].
// Encode PostgreSQL's array input text instead so PREPARE's inferred type wins.
// https://www.postgresql.org/docs/16/arrays.html#ARRAYS-INPUT
// https://www.postgresql.org/docs/16/sql-prepare.html
function arrayText(value) {
  const items = [];
  for (let i = 0; i < value.length; i++) {
    assert.ok(Object.hasOwn(value, i), 'sparse synthetic SQL array');
    const item = value[i];
    if (item === null || item === undefined) { items.push('NULL'); continue; }
    assert.ok(['string', 'number', 'boolean'].includes(typeof item),
      'synthetic SQL arrays accept scalars only; JSON arrays require JSON.stringify');
    if (typeof item === 'number') assert.ok(Number.isFinite(item));
    const text = String(item);
    assert.ok(!text.includes('\0'));
    items.push('"' + text.replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"');
  }
  return '{' + items.join(',') + '}';
}

export function literal(value) {
  if (value === null || value === undefined) return 'NULL';
  if (Array.isArray(value)) return literal(arrayText(value));
  if (typeof value === 'number') { assert.ok(Number.isFinite(value)); return String(value); }
  if (typeof value === 'boolean') return String(value);
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  assert.ok(!text.includes('\0'));
  return `'${text.replaceAll("'", "''")}'`;
}

export function preparedInput(name, sql, params = []) {
  assert.match(name, /^q[1-9][0-9]*$/);
  assert.ok(Array.isArray(params));
  // Explicitly retain standard string-literal semantics for both quote layers.
  // The production statement is inserted byte-for-byte, not rewritten/cast.
  return `\\pset format csv\n\\pset tuples_only off\nSET standard_conforming_strings=on;\nPREPARE ${name} AS ${sql};\nEXECUTE ${name}${params.length ? '(' + params.map(literal).join(',') + ')' : ''};\n`;
}

export function createDatabase() {
  hostedGuard();
  let sequence = 0;
  const errors = [];
  const receipts = new Map();
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', PGHOST: '127.0.0.1', PGPORT: '5432',
    PGDATABASE: 'vyakti_group_synthetic', PGUSER: 'group_ci', PGPASSWORD: 'synthetic-ci-only',
    PGCONNECT_TIMEOUT: '5', PGOPTIONS: '-c statement_timeout=15000 -c lock_timeout=5000' };
  function psql(input) {
    const r = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-f', '-'],
      { input, encoding: 'utf8', env, timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
    if (r.error || r.status !== 0) {
      const message = `synthetic_postgres_failed: ${r.error?.message || r.stderr || r.status}`;
      errors.push(message);
      throw new Error(message);
    }
    return r.stdout.trim();
  }
  const execute = async (sql, params = []) => {
    const name = `q${++sequence}`;
    // Top-level CTE writes cannot be nested in another CTE, so psql itself
    // returns CSV. A one-statement PREPARE is still the exact production SQL.
    const output = psql(preparedInput(name, sql, params));
    const rows = parseCsv(output);
    if (!rows.length) return [];
    const headers = rows.shift();
    return rows.map(row => Object.fromEntries(headers.map((key, i) => [key, decode(row[i])])));
  };
  const query = async (sql, params = []) => {
    receipts.set(hash(sql), { sha256: hash(sql), calls: (receipts.get(hash(sql))?.calls || 0) + 1 });
    return execute(sql, params);
  };
  return { query, execute, ddl: sql => psql(sql + ';'), errors, receipts,
    identity: () => execute('select current_database() db,current_user as actor,version() as version') };
}

function decode(value) {
  if (value === '') return null;
  if (value === 't' || value === 'true') return true;
  if (value === 'f' || value === 'false') return false;
  if (/^[\[{]/.test(value)) { try { return JSON.parse(value); } catch {} }
  if (/^\{(?:[0-9a-f-]+(?:,[0-9a-f-]+)*)?\}$/i.test(value)) return value === '{}' ? [] : value.slice(1, -1).split(',');
  return value;
}

// CSV rather than tab splitting preserves multiline/quoted synthetic evidence.
export function parseCsv(text) {
  const rows = []; let row = [], value = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { value += '"'; i++; }
      else quoted = !quoted;
    } else if (!quoted && (ch === ',' || ch === '\n')) {
      row.push(value.replace(/\r$/, '')); value = '';
      if (ch === '\n') { rows.push(row); row = []; }
    } else value += ch;
  }
  assert.equal(quoted, false, 'unterminated PostgreSQL CSV');
  if (value || row.length) { row.push(value); rows.push(row); }
  return rows;
}

// Exact table/constraint/index DDL is selected from the canonical schema, with
// recursive FK dependencies. No policy clause or column type is restated here.
// This is intentionally a bounded schema proof, not a full bootstrap proof.
export function schemaPlan() {
  const wanted = new Set(['meera_log', 'vy_episode', 'vy_episode_participant', 'vy_group',
    'vy_group_member', 'vy_group_entitlement', 'vy_disclosure_grant', 'vy_replica',
    'vy_replica_claim', 'vy_replica_claim_decision', 'vy_replica_claim_citation',
    'vy_replica_processing_evidence', 'vy_replica_source', 'vy_context_item',
    'vy_context_item_text', 'vy_replica_consent', 'vy_replica_profile']);
  const statements = splitSql(read('db/schema.sql')).map(sql => ({ sql,
    flat: sql.replace(/--[^\n]*/g, '').trim() }));
  const targets = text => [...text.matchAll(/\b(?:create table if not exists|alter table)\s+(?:public\.)?([a-z_0-9]+)/gi)].map(m => m[1]);
  const belongs = s => targets(s.flat).some(t => wanted.has(t)) ||
    /^(?:create (?:unique )?index)/i.test(s.flat) && [...wanted].some(t => new RegExp(`\\bon\\s+${t}\\b`, 'i').test(s.flat));
  let count;
  do {
    count = wanted.size;
    for (const s of statements.filter(belongs)) {
      for (const target of targets(s.flat)) wanted.add(target);
      for (const m of s.flat.matchAll(/\breferences\s+(?:public\.)?([a-z_0-9]+)/gi)) wanted.add(m[1]);
    }
  } while (count !== wanted.size);
  const indexes = new Set(statements.filter(belongs).flatMap(s =>
    [...s.flat.matchAll(/^create (?:unique )?index if not exists ([a-z_0-9]+)/gi)].map(m => m[1])));
  const selected = statements.filter(s => belongs(s) ||
    /^drop index if exists ([a-z_0-9]+)/i.test(s.flat) && indexes.has(/^drop index if exists ([a-z_0-9]+)/i.exec(s.flat)[1]));
  assert.ok(selected.length > 40);
  assert.ok(!selected.some(s => /\bhalfvec\s*\(/i.test(s.flat)), 'selected schema unexpectedly requires vector extension');
  for (const table of wanted) assert.ok(selected.some(s => new RegExp(`^create table if not exists ${table}\\b`, 'i').test(s.flat)), `missing canonical table ${table}`);
  return { tables: [...wanted].sort(), statements: selected.map(s => s.sql) };
}

// Bundle current production modules without loading any secret config/client.
// Only the q transport is replaced. Application SQL, predicates and projections
// execute from the actual files; fetch is a hard error in this isolated VM.
export async function production(db) {
  const config = [...read('api/_config.example.js').matchAll(/^export const ([A-Z_]+)\s*=/gm)]
    .map(m => `export const ${m[1]} = ${/KEYS|KEYRING/.test(m[1]) ? '[]' : '""'};`).join('\n');
  const built = await build({ stdin: { contents: `export * from './api/_room.js';
    export { withdrawSharedRows } from './api/memory.js';
    export { CLAIMS_SQL, ownedPersonModelStatus, clientClaim } from './api/_person-model.js';
    export { createContextTextEvidence } from './api/_experience-compiler/context-evidence.js';`, resolveDir: ROOT },
    bundle: true, write: false, platform: 'node', format: 'cjs', logLevel: 'silent',
    plugins: [{ name: 'synthetic-only', setup(b) {
      b.onResolve({ filter: /(?:^|\/)_(db|config)\.js$/ }, args => ({ path: args.path.endsWith('_db.js') ? 'db' : 'config', namespace: 'synthetic' }));
      b.onLoad({ filter: /.*/, namespace: 'synthetic' }, args => ({ contents: args.path === 'db'
        ? 'export const q=(...args)=>globalThis.__syntheticQuery(...args);' : config, loader: 'js' }));
    } }], });
  const module = { exports: {} };
  const context = { module, exports: module.exports, require: createRequire(import.meta.url),
    __syntheticQuery: db, Buffer, URL, URLSearchParams, TextEncoder, TextDecoder, AbortController,
    setTimeout, clearTimeout, console,
    process: { env: {}, platform: process.platform },
    fetch: async () => { throw new Error('group_sql_provider_network_forbidden'); } };
  vm.runInNewContext(built.outputFiles[0].text, context, { timeout: 10000 });
  return module.exports;
}
