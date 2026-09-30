import assert from 'node:assert/strict';
import { createDatabase, hash, hostedGuard, literal, parseCsv, production, read, schemaPlan, uid } from './harness.mjs';

const mode = process.argv.slice(2);
assert.ok(mode.length === 1 && ['--source-only', '--hosted-postgres'].includes(mode[0]),
  'Choose --source-only (no SQL) or --hosted-postgres (GitHub-hosted synthetic SQL only)');
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
const A = uid(1), B = uid(2), P = uid(11), Q = uid(12), LATE = uid(13), DEVICE = uid(21);
const OWNER = uid(101), OTHER_OWNER = uid(102), RID = uid(201), OTHER_RID = uid(202);
const policy = 'synthetic-group-review-v1';
const plan = schemaPlan();

if (mode[0] === '--source-only') {
  await check('hosted guard refuses local, self-hosted and externally supplied connections', () => {
    const safe = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', GROUP_SQL_SYNTHETIC: 'hosted-ephemeral-only' };
    hostedGuard(safe, 'linux');
    assert.throws(() => hostedGuard(safe, 'win32'));
    assert.throws(() => hostedGuard({}, 'linux'));
    assert.throws(() => hostedGuard({ ...safe, RUNNER_ENVIRONMENT: 'self-hosted' }, 'linux'));
    for (const name of ['NEON_URL', 'DATABASE_URL', 'PGHOST', 'PGPASSWORD', 'AZURE_KEY'])
      assert.throws(() => hostedGuard({ ...safe, [name]: 'synthetic-negative' }, 'linux'));
  });
  await check('PostgreSQL serializer preserves hostile and multiline synthetic values', () => {
    assert.equal(literal("x');select 'y"), "'x'');select ''y'");
    assert.equal(literal([P, Q]), `ARRAY['${P}','${Q}']`);
    assert.equal(literal([]), "'{}'");
    assert.throws(() => literal(NaN));
    assert.deepEqual(parseCsv('id,body\n1,"Hindi 🎨\r\n exact, ""quoted"""'), [['id', 'body'], ['1', 'Hindi 🎨\r\n exact, "quoted"']]);
  });
  const calls = [];
  const m = await production(async (sql, params) => { calls.push({ sql, params }); return []; });
  await check('actual episode, log and disclosure query capture without database execution', async () => {
    await m.openOrExtendGroupEpisode('1', { roomDevice: DEVICE, agentId: A, recipients: [Q, P] });
    await m.logRoomTurn({ groupId: '1', roomDevice: DEVICE, agentId: A, episodeId: '2', recipients: [P, Q], role: 'me', speakerPersonId: P, content: 'synthetic' });
    await m.roomHistoryEvidence('1', [P, Q], { agentId: A });
    assert.equal(calls.length, 3);
    assert.ok(calls[0].sql.includes('with made as'));
    assert.ok(calls[1].sql.includes('episode_id'));
    assert.ok(calls[2].sql.includes('disclosure predicate'));
    assert.match(calls[2].sql, /l\.role\s*=\s*'me'/);
  });
  await check('actual owner-review query and canonical DDL selected, not handwritten', () => {
    assert.ok(m.CLAIMS_SQL.includes('review_consent'));
    assert.ok(m.CLAIMS_SQL.includes('digest(convert_to('));
    for (const table of ['vy_episode_participant', 'vy_replica_claim_citation', 'vy_context_item_text']) assert.ok(plan.tables.includes(table));
    assert.ok(plan.statements.every(sql => read('db/schema.sql').includes(sql)));
  });
  await check('hosted workflow stays keyless and actually invokes the SQL mode', () => {
    const workflow = read('.github/workflows/group-authority.yml');
    assert.ok(!workflow.includes(['secrets', '.'].join('')));
    assert.ok(workflow.includes('image: postgres:16.15-bookworm'));
    assert.ok(workflow.includes('runs-on: ubuntu-24.04'));
    assert.ok(workflow.includes('node evals/group-sql-authority/run.mjs --hosted-postgres'));
    assert.ok(!workflow.includes('continue-on-error'));
  });
  console.log(`SOURCE ONLY: ${passed} groups; ${plan.tables.length} canonical tables/${plan.statements.length} statements selected. No SQL parsed or executed, no server started.`);
  process.exit(0);
}

const db = createDatabase(); // refuses this mode before invoking psql locally
const m = await production(db.query);
await check('dedicated synthetic PostgreSQL identity and empty schema', async () => {
  const [identity] = await db.identity();
  assert.equal(identity.db, 'vyakti_group_synthetic'); assert.equal(identity.actor, 'group_ci');
  assert.match(identity.version, /^PostgreSQL 16\.15\b/);
  assert.equal((await db.execute("select tablename from pg_tables where schemaname='public'")).length, 0);
  console.log(`database: ${identity.version}`);
});
await check('canonical bounded schema applies with PostgreSQL constraints intact', async () => {
  db.ddl('create extension if not exists pgcrypto');
  for (const [i, sql] of plan.statements.entries()) {
    try { db.ddl(sql); } catch (error) { throw new Error(`canonical DDL ${i + 1}/${plan.statements.length} ${sql.replace(/--[^\n]*/g, '').trim().slice(0, 120)}: ${error.message}`); }
  }
  console.log(`schema: ${plan.tables.length} tables, ${plan.statements.length} exact source statements`);
});

async function insert(table, object) {
  const keys = Object.keys(object), values = Object.values(object);
  return db.execute(`insert into ${table} (${keys.join(',')}) values (${keys.map((_, i) => '$' + (i + 1)).join(',')}) returning *`, values);
}
for (const id of [A, B]) await insert('vy_agent', { agent_id: id, slug: `synthetic-${id}`, display_name: 'Synthetic only' });
async function group(agent, suffix, people = [P, Q]) {
  const [row] = await insert('vy_group', { agent_id: agent, room_device_id: DEVICE, name: 'Synthetic group', surface: 'telegram', surface_chat_id: suffix, read_consent_at: '2026-09-01T00:00:00Z' });
  for (const [i, person] of people.entries()) await insert('vy_group_member', { group_id: row.id, agent_id: agent, person_id: person, linked_at: '2026-09-01T00:00:00Z', surface: 'telegram', surface_user_id: `${suffix}${i}` });
  return row.id;
}
const G = await group(A, '-10001'), G2 = await group(A, '-10002'), GB = await group(B, '-10003');
const episode = (g = G, agentId = A, recipients = [P, Q]) => m.openOrExtendGroupEpisode(g, { roomDevice: DEVICE, agentId, recipients });
const turn = (ep, opts = {}) => m.logRoomTurn({ groupId: G, roomDevice: DEVICE, agentId: A, episodeId: ep,
  recipients: [P, Q], role: 'me', speakerPersonId: P, content: 'Synthetic original', ...opts });
const history = (recipients = [P, Q], g = G, agentId = A, limit = 20) => m.roomHistoryEvidence(g, recipients, { agentId, limit });
let e1, l1, eOther, lOther;
await check('one statement creates exact immutable audience and independent turn episodes', async () => {
  e1 = await episode(); assert.ok(e1?.id); assert.equal(e1.extended, false);
  const e2 = await episode(); assert.notEqual(e1.id, e2.id);
  const participants = await db.execute('select person_id from vy_episode_participant where episode_id=$1 order by person_id', [e1.id]);
  assert.deepEqual(participants.map(x => x.person_id), [P, Q]);
  l1 = await turn(e1.id); assert.ok(l1);
  const [row] = await db.execute('select episode_id,speaker_person_id from meera_log where id=$1', [l1]);
  assert.equal(row.episode_id, e1.id); assert.equal(row.speaker_person_id, P);
});
await check('creation rejects partial, unlinked, departed, wrong-agent and consentless audiences', async () => {
  assert.equal(await episode(G, A, [P, LATE]), null);
  assert.equal(await episode(G, B), null);
  assert.equal(await episode(G, A, [P]), null);
  await db.execute('update vy_group_member set linked_at=null where group_id=$1 and person_id=$2 returning group_id', [G, Q]);
  assert.equal(await episode(), null);
  await db.execute('update vy_group_member set linked_at=now(),left_at=now() where group_id=$1 and person_id=$2 returning group_id', [G, Q]);
  assert.equal(await episode(), null);
  await db.execute('update vy_group_member set left_at=null where group_id=$1 returning group_id', [G]);
  await db.execute('update vy_group set read_consent_at=null where id=$1 returning id', [G]);
  assert.equal(await episode(), null); assert.equal(await turn(e1.id), null);
  await db.execute('update vy_group set read_consent_at=now() where id=$1 returning id', [G]);
});
await check('log binding rejects cross-group, cross-agent and stale episode audiences', async () => {
  assert.equal(await turn(e1.id, { groupId: G2 }), null);
  assert.equal(await turn(e1.id, { agentId: B }), null);
  assert.equal(await turn(e1.id, { recipients: [P, LATE] }), null);
  assert.equal(await turn(e1.id, { speakerPersonId: LATE }), null);
  assert.equal(await turn(null), null);
});
await check('history retains authorized human evidence and excludes assistant/legacy turns', async () => {
  assert.ok(await turn(e1.id, { role: 'her', speakerPersonId: null, content: 'Synthetic derived reply' }));
  await insert('meera_log', { agent_id: A, device_id: DEVICE, group_id: G, role: 'me', speaker_person_id: P, content: 'Legacy turn without audience' });
  assert.deepEqual((await history()).map(r => r.id), [l1]);
  assert.equal((await history([], G)).length, 0);
  assert.equal((await history([P, LATE])).length, 0);
});
await check('late joiner cannot inherit earlier audience or change its participant rows', async () => {
  await insert('vy_group_member', { group_id: G, agent_id: A, person_id: LATE, linked_at: '2026-09-02T00:00:00Z', surface: 'telegram', surface_user_id: '-100012' });
  await m.addEpisodeParticipant(e1.id, LATE, 'participant', undefined, A);
  assert.equal((await db.execute('select person_id from vy_episode_participant where episode_id=$1', [e1.id])).length, 2);
  assert.equal((await history([P, Q, LATE])).length, 0);
  assert.equal(await turn(e1.id, { recipients: [P, Q, LATE] }), null);
  const fresh = await episode(G, A, [P, Q, LATE]); assert.ok(fresh?.id);
  assert.ok(await turn(fresh.id, { recipients: [P, Q, LATE], content: 'Synthetic after join' }));
  assert.equal((await history([P, Q, LATE])).length, 1);
  await db.execute('delete from vy_group_member where group_id=$1 and person_id=$2 returning person_id', [G, LATE]);
});
await check('disclosure happens before LIMIT and explicit deny/private/negative affect wins', async () => {
  const denied = await episode(); const deniedLog = await turn(denied.id, { content: 'Synthetic withheld' }); assert.ok(deniedLog);
  for (const [field, value] of [['disclosure_deny', [P]], ['disclosure_scope', 'private'], ['affect_tags', [{ tag: 'sad', intensity: 0.5 }]]]) {
    await db.execute(`update vy_episode set ${field}=$2 where id=$1 returning id`, [denied.id, value]);
    const rows = await history([P, Q], G, A, 1);
    assert.equal(rows.length, 1); assert.notEqual(rows[0].id, deniedLog);
    await db.execute("update vy_episode set disclosure_deny='{}',disclosure_scope='participants',affect_tags='[]'::jsonb where id=$1 returning id", [denied.id]);
  }
});
await check('matching humans do not authorize another group or another agent', async () => {
  const otherRoom = await episode(G2); assert.ok(await turn(otherRoom.id, { groupId: G2, content: 'Other group' }));
  eOther = await episode(GB, B); lOther = await turn(eOther.id, { groupId: GB, agentId: B, content: 'Other agent' }); assert.ok(lOther);
  assert.ok(!(await history()).some(r => r.id === lOther));
  assert.equal((await history([P, Q], G, B)).length, 0);
});
await check('withdrawal removes own turns/audience/grants and preserves other agent and remaining peer', async () => {
  const peerLog = await turn(e1.id, { speakerPersonId: Q, content: 'Remaining peer' }); assert.ok(peerLog);
  await insert('vy_disclosure_grant', { agent_id: A, subject_kind: 'episode', subject_id: e1.id, granted_by: P, granted_to: Q, group_id: G, citations: [e1.id] });
  const receipt = await m.withdrawSharedRows(P, { agentId: A });
  assert.ok(receipt.participant_rows > 0); assert.ok(receipt.room_turns > 0); assert.equal(receipt.grants, 1);
  assert.equal(receipt.episodes_closed, 0, 'a remaining participant retains witnessed episodes');
  assert.equal((await history([P, Q])).length, 0);
  assert.ok((await history([Q])).some(r => r.id === peerLog));
  assert.ok((await history([P, Q], GB, B)).some(r => r.id === lOther));
  assert.equal((await db.execute('select id from meera_log where id=$1', [l1])).length, 0);
  assert.equal((await db.execute('select id from meera_log where id=$1', [lOther])).length, 1);
});

for (const [replica, owner] of [[RID, OWNER], [OTHER_RID, OTHER_OWNER]]) {
  await insert('vy_replica', { replica_id: replica, owner_user_id: owner, display_name: 'Synthetic art owner', policy_version: policy });
  await insert('vy_replica_consent', { replica_id: replica, owner_user_id: owner, scope: 'training', method: 'account_attestation', policy_version: policy, receipt_hash: hash(replica) });
}
const documents = [];
for (let i = 0; i < 5; i++) {
  const source = uid(301 + i), item = uid(401 + i), body = `Hindi 🎨\r\n exact art method ${i + 1}`;
  const digest = hash(body), evidence = m.createContextTextEvidence({ replicaId: RID, ownerUserId: OWNER, sourceId: source, itemId: item, inputSha256: digest, body, format: 'pdf', authorship: 'mine' })[0];
  await insert('vy_replica_source', { source_id: source, replica_id: RID, owner_user_id: OWNER, kind: 'document', capture_mode: 'upload', storage_bucket: 'synthetic', object_path: `fixture/${source}`, mime: 'application/pdf', sha256: digest, state: 'ready', purpose: 'context_item', provenance: { purpose: 'context_item' } });
  await insert('vy_context_item', { item_id: item, source_id: source, replica_id: RID, owner_user_id: OWNER, kind: 'file', format: 'pdf', content_sha256: digest, status: 'extracted', authorship: 'mine' });
  await insert('vy_context_item_text', { item_id: item, replica_id: RID, owner_user_id: OWNER, body, chars: body.length });
  await insert('vy_replica_processing_evidence', { evidence_id: evidence.evidence_id, source_id: source, replica_id: RID, owner_user_id: OWNER, evidence_type: evidence.evidence_type, value: evidence.value,
    input_sha256: digest, adapter_family: evidence.adapter.family, adapter_name: evidence.adapter.name, adapter_version: evidence.adapter.version, record_hash: evidence.record_hash });
  documents.push({ source, item, body, digest, evidence });
}
const [claim] = await insert('vy_replica_claim', { replica_id: RID, owner_user_id: OWNER, domain: 'knowledge', key: 'art_method', body: 'Synthetic owner-authored art method', origin: 'self_declared', confidence: 1, source_ids: documents.map(d => d.source) });
for (const d of documents) await insert('vy_replica_claim_citation', { claim_id: claim.claim_id, replica_id: RID, owner_user_id: OWNER, source_id: d.source, evidence_id: d.evidence.evidence_id, start_char: 0, end_char: d.body.length, quote_hash: d.digest, entailment: 1 });
const review = async () => (await m.ownedPersonModelStatus(db.query, OWNER, RID)).claims.find(c => c.claim_id === claim.claim_id);
const first = documents[0];
await check('actual owned status returns all five source-bound exact UTF-16/CRLF citations', async () => {
  const row = await review(); assert.equal(row.citation_previews.length, 5);
  for (const d of documents) {
    const preview = row.citation_previews.find(c => c.source_id === d.source); assert.ok(preview);
    assert.equal(preview.excerpt, d.body); assert.equal(preview.context_item_id, d.item);
    assert.equal(preview.citation.end_char, d.body.length); assert.equal(preview.source_locator.end_char, d.body.length);
    assert.equal(preview.modality, 'document'); assert.equal(preview.source_locator.page_mapping, 'unavailable');
    assert.ok(!('input_sha256' in preview)); assert.ok(!('evidence_text' in preview));
  }
});
await check('owner/replica mismatch yields no claim rows or source previews', async () => {
  assert.equal((await db.query(m.CLAIMS_SQL, [RID, OTHER_OWNER])).length, 0);
  assert.equal((await db.query(m.CLAIMS_SQL, [OTHER_RID, OWNER])).length, 0);
  assert.equal(await m.ownedPersonModelStatus(db.query, OTHER_OWNER, RID), null);
});
async function changed(label, table, where, parameters, field, bad, good, expected = 4) {
  await check(label, async () => {
    await db.execute(`update ${table} set ${field}=$${parameters.length + 1} where ${where} returning 1 as changed`, [...parameters, bad]);
    assert.equal((await review()).citation_previews.length, expected);
    await db.execute(`update ${table} set ${field}=$${parameters.length + 1} where ${where} returning 1 as changed`, [...parameters, good]);
    assert.equal((await review()).citation_previews.length, 5);
  });
}
await changed('deleting source is immediately excluded', 'vy_replica_source', 'source_id=$1', [first.source], 'state', 'deleting', 'ready');
await changed('non-ready document is excluded', 'vy_replica_source', 'source_id=$1', [first.source], 'state', 'processing', 'ready');
await changed('third-party source is excluded', 'vy_replica_source', 'source_id=$1', [first.source], 'contains_third_parties', true, false);
await changed('current canonical text mutation invalidates old evidence commitment', 'vy_context_item_text', 'item_id=$1', [first.item], 'body', 'Synthetic changed text', first.body);
await changed('wrong authorship cannot support owner review', 'vy_context_item', 'item_id=$1', [first.item], 'authorship', 'not_mine', 'mine');
await changed('wrong context scope cannot support owner review', 'vy_context_item', 'item_id=$1', [first.item], 'consent_scope', 'other', 'own_context');
await changed('removed claim source membership hides only that preview', 'vy_replica_claim', 'claim_id=$1', [claim.claim_id], 'source_ids', documents.slice(1).map(d => d.source), documents.map(d => d.source));
await changed('wrong quote digest is excluded in SQL', 'vy_replica_claim_citation', 'evidence_id=$1', [first.evidence.evidence_id], 'quote_hash', '0'.repeat(64), first.digest);
await changed('UTF-16 boundary inside emoji is excluded in SQL', 'vy_replica_claim_citation', 'evidence_id=$1', [first.evidence.evidence_id], 'start_char', 7, 0);
await changed('wrong evidence raw source commitment is excluded', 'vy_replica_processing_evidence', 'evidence_id=$1', [first.evidence.evidence_id], 'input_sha256', '0'.repeat(64), first.digest);
await changed('malformed source locator is withheld by actual client projection', 'vy_replica_processing_evidence', 'evidence_id=$1', [first.evidence.evidence_id], 'value', { ...first.evidence.value, locator: { ...first.evidence.value.locator, end_char: first.body.length + 1 } }, first.evidence.value);
for (const [field, bad, good] of [['revoked_at', '2026-09-01T00:00:00Z', null], ['expires_at', '2020-01-01T00:00:00Z', null], ['policy_version', 'obsolete-policy', policy]])
  await changed(`training consent ${field} revokes all preview access`, 'vy_replica_consent', 'replica_id=$1', [RID], field, bad, good, 0);
await check('revoked replica is unavailable to the real status caller', async () => {
  await db.execute("update vy_replica set lifecycle='revoked' where replica_id=$1 returning replica_id", [RID]);
  assert.equal(await m.ownedPersonModelStatus(db.query, OWNER, RID), null);
  await db.execute("update vy_replica set lifecycle='draft' where replica_id=$1 returning replica_id", [RID]);
});
await check('source deletion cascades citations and canonical context without widening remaining review', async () => {
  await db.execute('delete from vy_replica_source where source_id=$1 returning source_id', [first.source]);
  assert.equal((await review()).citation_previews.length, 4);
  assert.equal((await db.execute('select item_id from vy_context_item_text where item_id=$1', [first.item])).length, 0);
  assert.equal((await db.execute('select evidence_id from vy_replica_claim_citation where evidence_id=$1', [first.evidence.evidence_id])).length, 0);
});
await check('no swallowed database failure occurred', () => assert.deepEqual(db.errors, []));
console.log(`HOSTED SYNTHETIC POSTGRES: ${passed} groups passed; actual production query receipts ${JSON.stringify([...db.receipts.values()])}`);
console.log('Scope: bounded SQL semantics, not production catalog/migration state, provider output, owner quality, transport delivery, last-participant vector closure or concurrency proof. Ephemeral service is destroyed with the hosted job.');
