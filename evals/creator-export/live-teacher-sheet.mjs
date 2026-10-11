// Opt-in only: the protected root wrapper supplies the isolated-development db.
// No configuration import, execution on import, model call or migration.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { creatorExport, CREATOR_TEACHER_SHEETS_SQL } from '../../api/_creator-export.js';

export async function runCreatorTeacherSheetSqlChecks(db) {
  assert.equal((await db('select current_database() as name'))[0]?.name, 'vyakti_expert_integration_20260906');
  const owner = randomUUID(), other = randomUUID();
  const agent = randomUUID(), otherAgent = randomUUID();
  const bound = randomUUID(), unbound = randomUUID(), otherReplica = randomUUID();
  const replicas = [bound, unbound, otherReplica], agents = [agent, otherAgent];
  const ids = Array.from({ length: 7 }, () => randomUUID());
  const [legacy, explicit, draft, revoked, otherLegacy, otherExplicit, unrelatedAgent] = ids;
  const checks = [];
  let stage = 'exact-sql-explain', failure;
  try {
    await db('EXPLAIN ' + CREATOR_TEACHER_SHEETS_SQL, [[bound, unbound], owner]);
    checks.push('exact-runtime-query-explain');
    stage = 'create-exact-fixtures';
    for (const id of agents) await db("insert into vy_agent(agent_id,slug,display_name) values($1::uuid,$2,'Synthetic export fixture')", [id, 'creator-export-' + id]);
    for (const [rid, user, aid] of [[bound, owner, agent], [unbound, owner, null], [otherReplica, other, otherAgent]]) {
      await db("insert into vy_replica(replica_id,owner_user_id,agent_id,display_name,policy_version) values($1::uuid,$2::uuid,$3::uuid,'Synthetic export fixture','creator-export-eval/v1')", [rid, user, aid]);
    }
    const rows = [
      [legacy, null, null, agent, 'validated', 'own-legacy'],
      [explicit, bound, owner, agent, 'draft', 'own-bound'],
      [draft, unbound, owner, null, 'draft', 'own-unbound'],
      [revoked, unbound, owner, null, 'revoked', 'own-revoked'],
      [otherLegacy, null, null, otherAgent, 'validated', 'other-legacy'],
      [otherExplicit, otherReplica, other, otherAgent, 'draft', 'other-bound'],
      // No shared vy_replica.agent_id: this row's explicit ownership wins
      // over unrelated sheet agent metadata, which is not an ownership FK.
      [unrelatedAgent, otherReplica, other, agent, 'validated', 'other-explicit'],
    ];
    for (const [id, rid, user, aid, status, marker] of rows) {
      await db('insert into vy_teacher_sheet(sheet_id,replica_id,owner_user_id,agent_id,version,sheet,status) values($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5,$6::jsonb,$7)',
        [id, rid, user, aid, 'export-' + id, JSON.stringify({ marker }), status]);
    }
    stage = 'actual-owner-export';
    // All SQL is real; only per-table selection is narrowed to this task.
    const options = { tableApplied: async table => table === 'vy_teacher_sheet' };
    const a = await creatorExport(db, owner, options);
    assert.deepEqual(a.tables.vy_teacher_sheet.map(s => s.sheet_id).sort(), [legacy, explicit, draft, revoked].sort());
    assert.equal(a.tables.vy_teacher_sheet.find(s => s.sheet_id === draft).sheet.marker, 'own-unbound');
    assert.equal(a.manifest.find(x => x.table === 'vy_teacher_sheet').rows, 4);
    checks.push('actual-export-bound-unbound-legacy-revoked-exact');
    stage = 'other-owner-isolation';
    const b = await creatorExport(db, other, options);
    assert.deepEqual(b.tables.vy_teacher_sheet.map(s => s.sheet_id).sort(), [otherLegacy, otherExplicit, unrelatedAgent].sort());
    assert(!JSON.stringify(a).includes('other-explicit'));
    checks.push('explicit-owner-precedence-and-two-owner-isolation');
    stage = 'wrong-replica-and-empty-scope';
    assert.equal((await db(CREATOR_TEACHER_SHEETS_SQL, [[otherReplica], owner])).length, 0);
    assert.equal((await db(CREATOR_TEACHER_SHEETS_SQL, [[], owner])).length, 0);
    checks.push('wrong-owner-replica-and-empty-scope-refused');
    stage = 'unbound-erasure-cascade';
    await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid', [unbound, owner]);
    assert.equal((await db('select sheet_id from vy_teacher_sheet where sheet_id=any($1::uuid[])', [[draft, revoked]])).length, 0);
    assert.equal((await db('select sheet_id from vy_teacher_sheet where sheet_id=any($1::uuid[])', [[otherLegacy, otherExplicit, unrelatedAgent]])).length, 3);
    checks.push('unbound-draft-and-revoked-cascade-preserves-other-owner');
    stage = 'bound-erasure-cascade';
    await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid', [bound, owner]);
    assert.equal((await db('select sheet_id from vy_teacher_sheet where sheet_id=$1::uuid', [explicit])).length, 0);
    checks.push('explicit-bound-draft-cascade');
  } catch (error) {
    failure = error;
    Object.assign(error, { failedStage: stage, lastCompletedCheck: checks.at(-1) || 'none' });
    throw error;
  } finally {
    // Exact generated row IDs and their ownership/agent authority only.
    await db(`delete from vy_teacher_sheet where sheet_id=any($1::uuid[])
      and ((replica_id=any($2::uuid[]) and owner_user_id=any($3::uuid[]))
        or (replica_id is null and owner_user_id is null and agent_id=any($4::uuid[])))`,
      [ids, replicas, [owner, other], agents]);
    for (const [rid, user] of [[bound, owner], [unbound, owner], [otherReplica, other]]) {
      await db('delete from vy_replica where replica_id=$1::uuid and owner_user_id=$2::uuid', [rid, user]);
    }
    for (const id of agents) await db('delete from vy_agent where agent_id=$1::uuid and slug=$2', [id, 'creator-export-' + id]);
    const remaining = (await db(`select
      (select count(*) from vy_teacher_sheet where sheet_id=any($1::uuid[]))+
      (select count(*) from vy_replica where replica_id=any($2::uuid[]))+
      (select count(*) from vy_agent where agent_id=any($3::uuid[])) as n`, [ids, replicas, agents]))[0];
    assert.equal(Number(remaining?.n), 0, 'exact export fixture cleanup');
    if (failure) Object.assign(failure, { creatorExportFixtureCleanupVerified: true, remainingFixtureRows: 0 });
  }
  return { passed: checks.length, checks, remainingFixtureRows: 0 };
}
