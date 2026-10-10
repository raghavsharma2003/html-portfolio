// Source-only mirror/order control. This is not a PostgreSQL parser or live gate.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { splitSql } from '../db/migrations/apply.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const files = [
  '015_replica_core.sql', '016_replica_enrollment.sql',
  '017_replica_processing_manifests.sql', '019_replica_generation_provenance.sql',
  '020_replica_review_isolation.sql', '023_replica_runtime.sql',
  '024_person_model.sql', '025_replica_calibration.sql', '026_claim_extraction.sql',
  '027_replica_dialogue.sql', '028_provider_budget.sql', '029_replica_turn_feedback.sql',
  '030_replica_feedback_dataset.sql', '031_replica_candidate_qualification.sql',
  '032_replica_candidate_owner_eval.sql',
];
const laterFiles = [
  '152_replica_correction_candidate_job.sql',
  '155_replica_candidate_materialization.sql',
  '156_replica_candidate_activation.sql',
];
const read = (path) => readFileSync(resolve(root, path), 'utf8').replace(/\r\n/g, '\n');
const sources = new Map([...files, ...laterFiles].map((file) => [file, read(`db/migrations/${file}`)]));

// Compare token-bearing source, preserving quoted values, identifiers and bodies.
// Only full-line comments and outer whitespace are ignored; no SQL interpretation.
const canonical = (sql) => sql.replace(/^\s*--[^\n]*(?:\n|$)/gm, '').trim();
const statements = (sql) => splitSql(sql).map(canonical);

export function checkCandidateSchemaMirror(schema) {
  schema = schema.replace(/\r\n/g, '\n');
  let priorEnd = -1;
  for (const file of files) {
    const begin = `-- BEGIN historical replica mirror: ${file}\n`;
    const end = `-- END historical replica mirror: ${file}`;
    assert.equal(schema.split(begin).length, 2, `${file}: exactly one begin marker required`);
    assert.equal(schema.split(end).length, 2, `${file}: exactly one end marker required`);
    const start = schema.indexOf(begin);
    const stop = schema.indexOf(end);
    assert(start > priorEnd && stop > start, `${file}: prerequisite order changed`);
    assert.equal(schema.slice(start + begin.length, stop).trimEnd(), sources.get(file).trimEnd(), `${file}: historical mirror differs`);
    priorEnd = stop + end.length;
  }
  assert(priorEnd < schema.indexOf('-- Migration 033 -'), 'replica prerequisites must precede033');

  const all = statements(schema);
  let priorPosition = all.findIndex((s) => /^create table if not exists vy_replica_candidate_eval_judgment\s*\(/i.test(s));
  assert(priorPosition >= 0, 'missing evaluation judgment');
  let downstreamStatements = 0;
  for (const file of laterFiles) {
    for (const statement of statements(sources.get(file))) {
      const positions = all.flatMap((s, index) => s === statement ? [index] : []);
      assert.equal(positions.length, 1, `${file}: missing or duplicated exact statement`);
      assert(positions[0] > priorPosition, `${file}: downstream statement precedes prerequisite`);
      priorPosition = positions[0];
      downstreamStatements++;
    }
  }

  // Lexical reference-order check for just the restored blocks. Existing base
  // tables are discovered only before this insertion, not anywhere in the file.
  const first = schema.indexOf('-- BEGIN historical replica mirror:');
  const tablePattern = /create\s+table\s+(?:if\s+not\s+exists\s+)?([a-z_][\w]*)/gi;
  const known = new Set([...schema.slice(0, first).matchAll(tablePattern)].map((m) => m[1]));
  let tables = 0;
  let references = 0;
  for (const file of files) {
    for (const statement of statements(sources.get(file))) {
      const own = [...statement.matchAll(tablePattern)].map((m) => m[1]);
      own.forEach((table) => known.add(table)); // Permit a table's self-reference.
      tables += own.length;
      for (const match of statement.matchAll(/\breferences\s+([a-z_][\w]*)\s*\(/gi)) {
        assert(known.has(match[1]), `${file}: undeclared earlier FK target ${match[1]}`);
        references++;
      }
    }
  }
  return { mirroredFiles: files.length, tables, statements: files.reduce((n, f) => n + statements(sources.get(f)).length, 0), references, downstreamStatements };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const schema = read('db/schema.sql');
  const result = checkCandidateSchemaMirror(schema);
  const missing = schema.replace('create table if not exists vy_replica_candidate_eval_asset (', 'create table if not exists missing_eval_asset (');
  assert.throws(() => checkCandidateSchemaMirror(missing), /historical mirror differs/);
  const wrongFk = schema.replace('references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete cascade', 'references vy_replica_candidate(candidate_id,dataset_id,replica_id,owner_user_id) on delete restrict');
  assert.throws(() => checkCandidateSchemaMirror(wrongFk), /historical mirror differs/);
  const begin = '-- BEGIN historical replica mirror: 032_replica_candidate_owner_eval.sql\n';
  const end = '-- END historical replica mirror: 032_replica_candidate_owner_eval.sql';
  const start = schema.indexOf(begin);
  const stop = schema.indexOf(end) + end.length;
  const block = schema.slice(start, stop);
  const removed = schema.slice(0, start) + schema.slice(stop);
  const reordered = removed.replace('-- BEGIN historical replica mirror: 031_replica_candidate_qualification.sql', () => block + '\n-- BEGIN historical replica mirror: 031_replica_candidate_qualification.sql');
  assert.throws(() => checkCandidateSchemaMirror(reordered), /prerequisite order changed/);
  console.log(JSON.stringify({ sourceOnly: true, ...result, negativeControls: 3, sqlExecuted: 0 }));
}
