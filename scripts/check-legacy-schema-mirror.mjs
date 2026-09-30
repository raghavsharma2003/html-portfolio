// Source-only inventory. Neither SQL parsing nor PostgreSQL catalog acceptance.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { splitSql } from '../db/migrations/apply.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const hash = (s) => createHash('sha256').update(s).digest('hex');
const restored = [
  '010_agent_strict.sql', '011_self_layer.sql', '012_turn_trace.sql',
  '013_surface_room_binding.sql', '014_kin_provisional_texture_drift.sql',
  '015_push_tokens.sql', '021_raw_agent_strict.sql', '022_remaining_agent_keys.sql',
];

// Remove comments/collapse whitespace only OUTSIDE quoted SQL values and dollar
// bodies. Equality is lexical; an absent statement can be represented by an
// inline constraint or superseded later and still needs catalog reconciliation.
export function canonical(sql) {
  let out = '';
  for (let i = 0; i < sql.length;) {
    if (sql.slice(i, i + 2) === '--') {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end + 1;
      if (!/[ (,:]$/.test(out)) out += ' ';
    } else if (sql.slice(i, i + 2) === '/*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth) {
        if (sql.slice(i, i + 2) === '/*') { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === '*/') { depth--; i += 2; }
        else i++;
      }
      assert.equal(depth, 0, 'unterminated block comment');
      if (!/[ (,:]$/.test(out)) out += ' ';
    } else if (sql[i] === "'" || sql[i] === '"') {
      const quote = sql[i];
      const start = i++;
      let closed = false;
      while (i < sql.length) {
        if (sql[i] === quote && sql[i + 1] === quote) i += 2;
        else if (sql[i++] === quote) { closed = true; break; }
      }
      assert(closed, 'unterminated quoted token');
      out += sql.slice(start, i);
    } else if (sql[i] === '$' && /^\$[a-zA-Z_]*\$/.test(sql.slice(i))) {
      const tag = /^\$[a-zA-Z_]*\$/.exec(sql.slice(i))[0];
      const end = sql.indexOf(tag, i + tag.length);
      assert(end >= 0, 'unterminated dollar body');
      out += sql.slice(i, end + tag.length);
      i = end + tag.length;
    } else if (/[(),:]/.test(sql[i])) {
      out = out.trimEnd() + sql[i++];
    } else if (/\s/.test(sql[i])) {
      if (!/[ (,:]$/.test(out)) out += ' ';
      i++;
    } else out += sql[i++];
  }
  return out.trim();
}

const sqlStatements = (s) => splitSql(s).map(canonical);
const migrations = readdirSync(resolve(root, 'db/migrations')).filter((f) => /^\d.*\.sql$/.test(f)).sort();
const legacy = migrations.filter((f) => Number(f.slice(0, 3)) <= 32);
const tablePattern = /^\s*create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/gim;

export function checkLegacySchemaMirror(schema) {
  schema = schema.replace(/\r\n/g, '\n');
  for (const file of restored) {
    const begin = `-- BEGIN historical legacy mirror: ${file}\n`;
    const end = `-- END historical legacy mirror: ${file}`;
    assert.equal(schema.split(begin).length, 2, `${file}: missing/duplicate mirror`);
    assert.equal(schema.split(end).length, 2, `${file}: missing/duplicate end`);
    assert.equal(schema.slice(schema.indexOf(begin) + begin.length, schema.indexOf(end)).trimEnd(), read(`db/migrations/${file}`).trimEnd(), `${file}: changed historical body`);
  }
  const rawScope = schema.indexOf('-- Migration 018 -- hard agent ownership');
  for (const file of restored.slice(0, 6)) assert(schema.indexOf(`-- END historical legacy mirror: ${file}`) < rawScope, `${file}: legacy ordering`);
  for (const file of restored.slice(6)) {
    const start = schema.indexOf(`-- BEGIN historical legacy mirror: ${file}`);
    assert(start > rawScope && start < schema.indexOf('-- BEGIN historical replica mirror: 023_'), `${file}: raw scope/runtime ordering`);
  }
  assert(!schema.includes("'^[0-9a-f]{64})"), 'malformed historical hash CHECK');
  canonical(schema); // Check lexical termination independently of the splitter.
  const all = sqlStatements(schema);
  let legacyStatements = 0;
  let legacyAlterStatements = 0;
  for (const file of legacy) {
    for (const statement of sqlStatements(read(`db/migrations/${file}`))) {
      assert(all.includes(statement), `${file}: missing exact historical statement: ${statement.slice(0, 120)}`);
      legacyStatements++;
      if (/^alter table /i.test(statement)) legacyAlterStatements++;
    }
  }
  const known = new Set();
  let targets = 0;
  for (const statement of all) {
    const declared = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?(\w+)/i.exec(statement);
    if (declared) {
      assert(!known.has(declared[1]), `duplicate table definition ${declared[1]}`);
      known.add(declared[1]);
    }
    // References in historical DO bodies are checked too. This deliberately
    // checks table order only; it cannot type-check columns or FK unique keys.
    for (const match of statement.matchAll(/\b(?:references|alter\s+table)\s+(?:only\s+)?(?:public\.)?(\w+)/gi)) {
      assert(known.has(match[1]), `undeclared earlier target ${match[1]}`);
      targets++;
    }
    const index = /^create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?\w+\s+on\s+(?:public\.)?(\w+)/i.exec(statement);
    if (index) { assert(known.has(index[1]), `undeclared earlier index target ${index[1]}`); targets++; }
  }
  const rawTables = [...schema.matchAll(tablePattern)].map((m) => m[1]);
  assert.equal(known.size, rawTables.length, 'table DDL swallowed by malformed lexical boundaries');
  for (const file of migrations) {
    for (const match of read(`db/migrations/${file}`).matchAll(tablePattern)) {
      assert(known.has(match[1]), `${file}: table definition absent from schema: ${match[1]}`);
    }
  }
  return { restoredFiles: restored.length, restoredStatements: restored.reduce((n, f) => n + sqlStatements(read(`db/migrations/${f}`)).length, 0), restoredTables: 8, legacyFiles: legacy.length, legacyStatements, legacyAlterStatements, schemaStatements: all.length, schemaTables: known.size, lexicalTargets: targets };
}

function inventory(schema) {
  const baseline = execFileSync('git', ['show', '8fe09246:db/schema.sql'], { cwd: root, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  const before = sqlStatements(baseline);
  const after = sqlStatements(schema);
  const rows = [];
  for (const file of migrations) {
    for (const [index, statement] of sqlStatements(read(`db/migrations/${file}`)).entries()) {
      rows.push({ file, ordinal: index + 1, statementSha256: hash(statement), statement, baselineExact: before.includes(statement), currentPositions: after.flatMap((s, i) => s === statement ? [i + 1] : []), kind: /^alter table /i.test(statement) ? 'alter_table' : /^do\b/i.test(statement) ? 'guarded_body' : /^create table /i.test(statement) ? 'create_table' : 'other' });
    }
  }
  return { baselineCommit: '8fe09246', schemaSha256Lf: hash(schema), sourceOnly: true, sqlExecuted: 0, exactEqualityIsNotCatalogParity: true, inputs: migrations.map((file) => ({ file, sha256Lf: hash(read(`db/migrations/${file}`)) })), summary: { files: migrations.length, statements: rows.length, exactPresent: rows.filter((r) => r.currentPositions.length).length, notExactNeedsCatalogReconciliation: rows.filter((r) => !r.currentPositions.length).length, legacyNotExact: rows.filter((r) => Number(r.file.slice(0, 3)) <= 32 && !r.currentPositions.length).length }, statements: rows };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schema = read('db/schema.sql');
  const result = checkLegacySchemaMirror(schema);
  assert.throws(() => checkLegacySchemaMirror(schema.replace('create table if not exists vy_self_arc (', 'create table if not exists missing_arc (')), /changed historical body/);
  assert.throws(() => checkLegacySchemaMirror(schema.replace('alter table meera_turn alter column surface drop not null;', '')), /changed historical body/);
  assert.throws(() => checkLegacySchemaMirror(schema.replace("constraint vy_replica_readiness_inputs_hash check (inputs_hash ~ '^[0-9a-f]{64}$'),", () => "constraint vy_replica_readiness_inputs_hash check (inputs_hash ~ '^[0-9a-f]{64}),")), /malformed historical hash CHECK/);
  const orgStart = schema.indexOf('-- Migration 091 - Suites v0,');
  const orgEnd = schema.indexOf('-- Migration 095 (WS-R33) widened', orgStart);
  const org = schema.slice(orgStart, orgEnd);
  const withoutOrg = schema.slice(0, orgStart) + schema.slice(orgEnd);
  assert.throws(() => checkLegacySchemaMirror(withoutOrg + '\n' + org), /undeclared earlier target vy_org/);
  const report = inventory(schema);
  if (process.argv.includes('--write-inventory')) writeFileSync(resolve(root, 'docs/gurukul/research/SCHEMA58-STATEMENT-INVENTORY.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ sourceOnly: true, ...result, negativeControls: 4, inventory: report.summary, sqlExecuted: 0 }));
}
