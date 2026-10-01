import assert from 'node:assert/strict';
import { createDatabase, hash, hostedGuard, literal, parseCsv, preparedInput, production, read, schemaPlan, uid } from './harness.mjs';
import { assertGroupSourceEvent } from '../../api/_group-source-event.js';

const mode = process.argv.slice(2);
assert.ok(mode.length === 1 && ['--source-only', '--hosted-postgres'].includes(mode[0]),
  'Choose --source-only (no SQL) or --hosted-postgres (GitHub-hosted synthetic SQL only)');
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(`ok ${passed} - ${name}`); }
const A = uid(1), B = uid(2), P = uid(11), Q = uid(12), LATE = uid(13), DEVICE = uid(21);
const OWNER = uid(101), OTHER_OWNER = uid(102), RID = uid(201), OTHER_RID = uid(202);
const policy = 'synthetic-group-review-v1';
// Explicit source/consent instants keep prior fixtures independent of the host
// clock. Late-join fixtures use September 2, still before this valid source.
const CONSENT_AT = '2026-09-01T00:00:00.000Z';
const SOURCE_SENT_AT = '2026-09-03T00:00:00.000Z';
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
    assert.equal(literal([P, Q]), `'{"${P}","${Q}"}'`);
    assert.equal(literal([]), "'{}'");
    assert.throws(() => literal(NaN));
    assert.deepEqual(parseCsv('id,body\n1,"Hindi 🎨\r\n exact, ""quoted"""'), [['id', 'body'], ['1', 'Hindi 🎨\r\n exact, "quoted"']]);
  });
  await check('array literals preserve scalar type inference and reject implicit JSON or sparse arrays', () => {
    assert.equal(literal([null, 'NULL', '', 17, true]), `'{NULL,"NULL","","17","true"}'`);
    assert.equal(literal(['a,b', '{x}', '"quoted"', 'path\\leaf', "x');select 'y", 'Hindi 🎨\r\nexact']),
      `'{"a,b","{x}","\\"quoted\\"","path\\\\leaf","x'');select ''y","Hindi 🎨\r\nexact"}'`);
    for (const value of [[{}], [[P]], [NaN], ['x\0y'], Array(1)]) assert.throws(() => literal(value));
    const inherited = Array(1); Object.setPrototypeOf(inherited, { 0: P });
    assert.throws(() => literal(inherited));
  });
  const calls = [];
  const m = await production(async (sql, params) => { calls.push({ sql, params }); return []; });
  await check('actual episode, log and disclosure query capture without database execution', async () => {
    await m.openOrExtendGroupEpisode('1', { roomDevice: DEVICE, agentId: A, recipients: [Q, P], sourceSentAt: SOURCE_SENT_AT });
    await m.logRoomTurn({ groupId: '1', roomDevice: DEVICE, agentId: A, episodeId: '2', recipients: [P, Q], role: 'me', speakerPersonId: P, content: 'synthetic', sourceSentAt: SOURCE_SENT_AT });
    await m.roomHistoryEvidence('1', [P, Q], { agentId: A });
    assert.equal(calls.length, 3);
    assert.ok(calls[0].sql.includes('with made as'));
    assert.ok(calls[1].sql.includes('episode_id'));
    assert.ok(calls[2].sql.includes('disclosure predicate'));
    assert.match(calls[2].sql, /l\.role\s*=\s*'me'/);
  });
  await check('prepared production SQL stays exact while independently typed ARRAY regression is rejected', () => {
    const { sql, params } = calls[0];
    const expectedArgs = `('${params[0]}','${params[1]}','${params[2]}','{"${P}","${Q}"}','${SOURCE_SENT_AT}')`;
    const verify = input => {
      assert.ok(input.includes(`SET standard_conforming_strings=on;\nPREPARE q1 AS ${sql};\n`));
      assert.ok(input.endsWith(`EXECUTE q1${expectedArgs};\n`));
    };
    const actual = preparedInput('q1', sql, params);
    verify(actual);
    assert.throws(() => verify(actual.replace(literal([P, Q]), `ARRAY['${P}','${Q}']`)));
    assert.throws(() => verify(actual.replace(sql, sql.replace('$4::uuid[]', '$4::text[]'))));
    assert.throws(() => preparedInput('q1;select 1', sql, params));
  });
  await check('both source writers require a canonical positive whole-second source instant before querying', async () => {
    const before = calls.length;
    const badDates = [undefined, null, '', 0, 1, 1700000000, 1n, {}, new Date(SOURCE_SENT_AT),
      '1970-01-01T00:00:00.000Z', '1969-12-31T23:59:59.000Z', '0000-01-01T00:00:00.000Z',
      '2026-09-03', '2026-09-03T00:00:00Z', '2026-09-03T00:00:00.001Z', '2026-09-03T00:00:00.0000Z',
      '2026-09-03T00:00:00.000+00:00', '2026-02-29T00:00:00.000Z', '2026-02-30T00:00:00.000Z',
      '2026-09-03T24:00:00.000Z', '2026-09-03T00:00:60.000Z', ' 2026-09-03T00:00:00.000Z'];
    for (const sourceSentAt of badDates) {
      assert.equal(await m.openOrExtendGroupEpisode('1', { roomDevice: DEVICE, agentId: A, recipients: [P, Q], sourceSentAt }), null);
      for (const role of ['me', 'her']) assert.equal(await m.logRoomTurn({ groupId: '1', roomDevice: DEVICE, agentId: A,
        episodeId: '2', recipients: [P, Q], role, speakerPersonId: role === 'me' ? P : null,
        content: 'Must not be written', sourceSentAt }), null);
    }
    assert.equal(calls.length, before, 'invalid source instants never reach q and cannot fall back to receipt time');
    for (const sourceSentAt of ['1970-01-01T00:00:01.000Z', '2028-02-29T12:00:00.000Z', '2099-12-31T23:59:59.000Z']) {
      await m.openOrExtendGroupEpisode('1', { roomDevice: DEVICE, agentId: A, recipients: [P, Q], sourceSentAt });
      assert.equal(calls.at(-1).params[4], sourceSentAt);
      await m.logRoomTurn({ groupId: '1', roomDevice: DEVICE, agentId: A, episodeId: '2', recipients: [P, Q],
        role: 'me', speakerPersonId: P, content: 'Synthetic valid source', sourceSentAt });
      assert.equal(calls.at(-1).params[9], sourceSentAt);
    }
    assert.equal(calls.length, before + 6, 'input validation adds no unapproved age/future policy');
  });
  await check('writer SQL fences group consent and every admitted member at the same statement snapshot', () => {
    for (const [call, dateBind, audienceBind] of [[calls[0], '$5', '$4'], [calls[1], '$10', '$9']]) {
      const verify = sql => {
        for (const clause of [`g.read_consent_at < ${dateBind}::timestamptz`,
          `cm.linked_at >= ${dateBind}::timestamptz`, 'cm.group_id = g.id and cm.agent_id = g.agent_id',
          'cm.left_at is null and cm.linked_at is not null', `${audienceBind}::uuid[] = (select array_agg(m.person_id order by m.person_id)`])
          assert.ok(sql.includes(clause), clause);
      };
      verify(call.sql);
      assert.equal(call.params[Number(dateBind.slice(1)) - 1], SOURCE_SENT_AT);
      assert.throws(() => verify(call.sql.replace(`g.read_consent_at < ${dateBind}`, `g.read_consent_at <= ${dateBind}`)));
      assert.throws(() => verify(call.sql.replace(`cm.linked_at >= ${dateBind}`, `cm.linked_at > ${dateBind}`)));
      assert.throws(() => verify(call.sql.replace('cm.group_id = g.id', 'true')));
      assert.throws(() => verify(call.sql.replace('cm.agent_id = g.agent_id', 'true')));
    }
  });
  await check('source candidate SQL exactly preserves the history authority with only projection, cutoff and bound changes', async () => {
    const before = calls.length;
    await m.roomSourceCandidates('1', [P, Q], { agentId: A, throughLogId: '123' });
    assert.equal(calls.length, before + 1);
    const candidate = calls.at(-1), historySql = calls[2].sql;
    const expected = historySql.replace('l.content, l.episode_id', 'l.content, l.at, l.episode_id')
      .replace('      order by l.id desc limit $6::integer', '        and l.id <= $6::bigint\n      order by l.id desc limit $7::integer');
    assert.equal(candidate.sql, expected);
    assert.deepEqual(Array.from(candidate.params[0]), [P, Q]);
    assert.deepEqual(Array.from(candidate.params).slice(1, 3), [true, '1']);
    assert.deepEqual(Array.from(candidate.params).slice(4), [A, '123', 160]);
    // These mutations must not be mistaken for the full production query.
    for (const fragment of ['l.at, ', 'join vy_episode f on f.id = l.episode_id',
      'and f.agent_id = l.agent_id', 'and f.group_id = l.group_id',
      'l.group_id = $3::bigint', 'l.agent_id = $5::uuid', "l.role = 'me'",
      'l.speaker_person_id is not null', 'f.superseded_by is null',
      'and l.id <= $6::bigint', 'order by l.id desc', 'limit $7::integer']) {
      assert.ok(candidate.sql.includes(fragment), fragment);
      assert.throws(() => assert.equal(candidate.sql.replace(fragment, ''), expected), fragment);
    }
    await m.roomSourceCandidates(1, [P.toUpperCase(), Q], { agentId: A, throughLogId: 123, limit: 1 }, table => 'test_' + table);
    const scoped = calls.at(-1);
    assert.match(scoped.sql, /from test_meera_log l/);
    assert.match(scoped.sql, /join test_vy_episode f/);
    assert.match(scoped.sql, /from test_vy_disclosure_grant g/);
    assert.match(scoped.sql, /from test_vy_episode_participant p/);
    assert.deepEqual(Array.from(scoped.params[0]), [P, Q]);
    assert.deepEqual(Array.from(scoped.params).slice(5), ['123', 1]);
  });
  await check('source candidate invalid bounds and malformed audiences fail before any query', async () => {
    const options = { agentId: A, throughLogId: '123' }, before = calls.length;
    const invalid = [
      ...[undefined, null, '', '0', '-1', '01', '1.5', '1;select 1', '9223372036854775808', 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, {}]
        .flatMap(value => [[value, [P, Q], options], ['1', [P, Q], { ...options, throughLogId: value }]]),
      ...[0, -1, 161, 1.5, '160', NaN, Infinity, null].map(limit => ['1', [P, Q], { ...options, limit }]),
      ...[null, [], Array(2), [P, P], [P, P.toUpperCase()], ['bad'], [P, null], Array(161).fill(P)]
        .map(audience => ['1', audience, options]),
      ['1', [P, Q], { ...options, agentId: 'bad' }],
    ];
    for (const args of invalid) await assert.rejects(m.roomSourceCandidates(...args), /^Error: room_source_candidates_invalid$/);
    let accessed = 0;
    const accessor = [P, Q]; Object.defineProperty(accessor, '0', { get() { accessed++; return P; } });
    await assert.rejects(m.roomSourceCandidates('1', accessor, options), /room_source_candidates_invalid/);
    const inherited = Array(1); Object.setPrototypeOf(inherited, { 0: P });
    await assert.rejects(m.roomSourceCandidates('1', inherited, options), /room_source_candidates_invalid/);
    assert.equal(accessed, 0); assert.equal(calls.length, before);
  });
  await check('source read database failure propagates without history or unrestricted fallback', async () => {
    let count = 0; const failure = new Error('synthetic_candidate_query_failure');
    const broken = await production(async () => { count++; throw failure; });
    await assert.rejects(broken.roomSourceCandidates('1', [P, Q], { agentId: A, throughLogId: '123' }), error => error === failure);
    assert.equal(count, 1);
  });
  await check('roster retains exact recorded person ID additively without guessing a historical name', async () => {
    const raw = [{ person_id: P, username: 'Current handle', honorific: 'aap', linked_at: '2026-09-01', quiet_level: 'normal' }];
    const mocked = await production(async () => raw);
    const [row] = await mocked.roster('1', undefined, A, { strict: true });
    assert.deepEqual({ ...row }, { person_id: P, name: 'Current handle', honorific: 'aap', rank: 'elder', quiet: 'normal', linked: true });
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
await check('PREPARE chooses UUID/bigint/text/JSON array types without serializer coercion', async () => {
  const hostile = [null, 'NULL', '', 'a,b', '{x}', '"quoted"', 'path\\leaf', "x');select 'y", 'Hindi 🎨\r\nexact'];
  const json = [{ tag: 'sad', intensity: 0.5 }];
  const [row] = await db.execute('select to_json($1::uuid[]) uuids,to_json($2::bigint[]) ids,to_json($3::text[]) words,to_json($4::uuid[]) empty,$5::jsonb document',
    [[P, Q], ['1', '2'], hostile, [], JSON.stringify(json)]);
  assert.deepEqual(row.uuids, [P, Q]); assert.deepEqual(row.ids, [1, 2]);
  assert.deepEqual(row.words, hostile); assert.deepEqual(row.empty, []);
  assert.deepEqual(row.document, json);
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
  const [row] = await insert('vy_group', { agent_id: agent, room_device_id: DEVICE, name: 'Synthetic group', surface: 'telegram', surface_chat_id: suffix, read_consent_at: CONSENT_AT });
  for (const [i, person] of people.entries()) await insert('vy_group_member', { group_id: row.id, agent_id: agent, person_id: person, linked_at: CONSENT_AT, surface: 'telegram', surface_user_id: `${suffix}${i}` });
  return row.id;
}
const G = await group(A, '-10001'), G2 = await group(A, '-10002'), GB = await group(B, '-10003');
const episode = (g = G, agentId = A, recipients = [P, Q], sourceSentAt = SOURCE_SENT_AT) => m.openOrExtendGroupEpisode(g, { roomDevice: DEVICE, agentId, recipients, sourceSentAt });
const turn = (ep, opts = {}) => m.logRoomTurn({ groupId: G, roomDevice: DEVICE, agentId: A, episodeId: ep,
  recipients: [P, Q], role: 'me', speakerPersonId: P, content: 'Synthetic original', sourceSentAt: SOURCE_SENT_AT, ...opts });
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
  await db.execute('update vy_group_member set linked_at=$3::timestamptz,left_at=now() where group_id=$1 and person_id=$2 returning group_id', [G, Q, CONSENT_AT]);
  assert.equal(await episode(), null);
  await db.execute('update vy_group_member set left_at=null where group_id=$1 returning group_id', [G]);
  await db.execute('update vy_group set read_consent_at=null where id=$1 returning id', [G]);
  assert.equal(await episode(), null); assert.equal(await turn(e1.id), null);
  await db.execute('update vy_group set read_consent_at=$2::timestamptz where id=$1 returning id', [G, CONSENT_AT]);
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
  for (const [field, value] of [['disclosure_deny', [P]], ['disclosure_scope', 'private'], ['affect_tags', JSON.stringify([{ tag: 'sad', intensity: 0.5 }])]]) {
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

// Candidate recall has its own fixtures: the preceding withdrawal intentionally
// removed P from all earlier A episodes. These are raw historical observations,
// not current-state claims, and no hosted query uses real user data.
const GC = await group(A, '-10004'), GX = await group(A, '-10005');
const ec = await episode(GC), ex = await episode(GX);
assert.ok(ec?.id); assert.ok(ex?.id);
const candidateRows = await db.execute(`insert into meera_log
  (agent_id,device_id,group_id,episode_id,speaker_person_id,role,content,at)
  select $1::uuid,$2::uuid,$3::bigint,$4::bigint,$5::uuid,'me',
    'Candidate ' || n.i || E' Hindi 🎨\\r\\nexact',
    '2026-09-01T00:00:00Z'::timestamptz - n.i * interval '1 second'
  from generate_series(1,170) n(i) order by n.i returning id,content,at,episode_id,speaker_person_id`,
  [A, DEVICE, GC, ec.id, P]);
candidateRows.sort((a, b) => BigInt(a.id) < BigInt(b.id) ? -1 : 1);
const initialCutoff = candidateRows.at(-1).id;
const candidates = (recipients = [P, Q], throughLogId = initialCutoff, g = GC, agentId = A, limit = 160) =>
  m.roomSourceCandidates(g, recipients, { agentId, throughLogId, limit });
const ids = rows => rows.map(row => row.id);
let capturedCandidate;
const captureCandidate = await production(async (sql, params) => { capturedCandidate = { sql, params }; return []; });
async function mutantCandidates(transform, { recipients = [P, Q], throughLogId = initialCutoff, groupId = GC, agentId = A, limit = 160 } = {}) {
  await captureCandidate.roomSourceCandidates(groupId, recipients, { agentId, throughLogId, limit });
  const mutated = transform(capturedCandidate.sql);
  assert.notEqual(mutated, capturedCandidate.sql, 'candidate SQL mutation must actually change the captured production query');
  return db.query(mutated, capturedCandidate.params);
}
await check('candidate pool is latest 160 authorized humans with exact attribution and recording time, not the old 20-row window', async () => {
  const rows = await candidates();
  assert.equal(rows.length, 160);
  assert.deepEqual(ids(rows), ids(candidateRows.slice(-160).reverse()));
  assert.equal(rows[0].content, candidateRows.at(-1).content);
  assert.equal(rows[0].at, candidateRows.at(-1).at);
  assert.deepEqual(Object.keys(rows[0]), ['id', 'role', 'content', 'at', 'episode_id', 'speaker_person_id']);
  assert.equal(rows[0].episode_id, ec.id); assert.equal(rows[0].speaker_person_id, P); assert.equal(rows[0].role, 'me');
  assert.deepEqual(ids(await history([P, Q], GC)), ids(candidateRows.slice(-20).reverse()), 'existing history retains its original default');
  const wrongOrder = await mutantCandidates(sql => sql.replace('order by l.id desc', 'order by l.at desc'));
  assert.throws(() => assert.deepEqual(ids(wrongOrder), ids(rows)), 'recording-time ordering mutant must be caught');
  const overLimit = await mutantCandidates(sql => sql.replace('limit $7::integer', 'limit ($7::integer + 1)'));
  assert.equal(overLimit.length, 161);
  assert.throws(() => assert.equal(overLimit.length, 160), '161-row mutant must be caught');
});
await check('candidate cutoff is inclusive and remains fixed when later human turns arrive', async () => {
  const cutoff = candidateRows[164].id;
  const before = await candidates([P, Q], cutoff);
  assert.deepEqual(ids(before), ids(candidateRows.slice(5, 165).reverse()));
  const newer = await turn(ec.id, { groupId: GC, content: 'Later concurrent correction outside this turn snapshot' }); assert.ok(newer);
  assert.deepEqual(await candidates([P, Q], cutoff), before);
  assert.deepEqual(ids(await candidates([P, Q], cutoff, GC, A, 1)), [cutoff]);
  assert.deepEqual(ids(await candidates([P, Q], newer, GC, A, 1)), [newer]);
  const noCutoff = await mutantCandidates(sql => sql.replace('and l.id <= $6::bigint', 'and $6::bigint > 0'), { throughLogId: cutoff, limit: 1 });
  assert.deepEqual(ids(noCutoff), [newer]);
  assert.throws(() => assert.deepEqual(ids(noCutoff), [cutoff]), 'missing fixed-cutoff mutant must be caught');
});

const GT = await group(A, '-10006'), et = await episode(GT), ebad = await episode(GT);
assert.ok(et?.id); assert.ok(ebad?.id);
const safeLog = await turn(et.id, { groupId: GT, speakerPersonId: Q, content: 'Allowed peer observation' });
const badLog = await turn(ebad.id, { groupId: GT, content: 'Candidate controlled by mutable episode policy' });
assert.ok(safeLog); assert.ok(badLog);
const targeted = (recipients = [P, Q], cutoff = badLog, limit = 160) => candidates(recipients, cutoff, GT, A, limit);
const mutantTargeted = (transform, opts = {}) => mutantCandidates(transform, { groupId: GT, throughLogId: badLog, ...opts });
await check('candidate disclosure filters deny, private, one-to-one and negative affect before LIMIT', async () => {
  for (const [field, value] of [['disclosure_deny', [P]], ['disclosure_scope', 'private'], ['disclosure_scope', 'participants_1to1'],
    ['affect_tags', JSON.stringify([{ tag: 'sad', intensity: 0.5 }])]]) {
    await db.execute(`update vy_episode set ${field}=$2 where id=$1 returning id`, [ebad.id, value]);
    assert.deepEqual(ids(await targeted([P, Q], badLog, 1)), [safeLog]);
    await db.execute("update vy_episode set disclosure_deny='{}',disclosure_scope='participants',affect_tags='[]'::jsonb where id=$1 returning id", [ebad.id]);
  }
});
await check('candidate excludes assistant, unattributed and episode-less legacy rows with rejecting SQL controls', async () => {
  const extra = [];
  for (const values of [{ role: 'her', speaker_person_id: P, episode_id: et.id },
    { role: 'me', speaker_person_id: null, episode_id: et.id },
    { role: 'me', speaker_person_id: P, episode_id: null }]) {
    const [row] = await insert('meera_log', { agent_id: A, device_id: DEVICE, group_id: GT, content: 'Ineligible synthetic historical row', ...values });
    extra.push(row.id);
  }
  const cutoff = extra.at(-1), expected = [badLog, safeLog];
  assert.deepEqual(ids(await targeted([P, Q], cutoff)), expected);
  const mutations = [
    [sql => sql.replace("l.role = 'me'", 'true'), extra[0]],
    [sql => sql.replace('l.speaker_person_id is not null', 'true'), extra[1]],
    [sql => sql.replace('f.id = l.episode_id', `f.id = coalesce(l.episode_id, ${et.id}::bigint)`), extra[2]],
  ];
  for (const [mutate, forbiddenId] of mutations) {
    const rows = await mutantTargeted(mutate, { throughLogId: cutoff });
    assert.ok(ids(rows).includes(forbiddenId));
    assert.throws(() => assert.deepEqual(ids(rows), expected), 'ineligible source mutation must be detected');
  }
});
await check('candidate same-group and same-agent joins reject corrupted legacy bindings and other valid scopes', async () => {
  const [wrongGroup] = await insert('meera_log', { agent_id: A, device_id: DEVICE, group_id: GX, episode_id: et.id, speaker_person_id: P, role: 'me', content: 'Wrong log group' });
  const [wrongAgent] = await insert('meera_log', { agent_id: B, device_id: DEVICE, group_id: GT, episode_id: et.id, speaker_person_id: P, role: 'me', content: 'Wrong log agent' });
  const elsewhere = await turn(ex.id, { groupId: GX, content: 'Valid other group source' }); assert.ok(elsewhere);
  const cutoff = elsewhere;
  const expected = [badLog, safeLog];
  assert.deepEqual(ids(await targeted([P, Q], cutoff)), expected);
  assert.equal((await candidates([P, Q], cutoff, GT, B)).length, 0);
  // Redundant join + WHERE checks each preserve isolation; removal of both
  // must be caught by the corrupted-log fixtures, not hidden by redundancy.
  for (const [single, joined, forbidden] of [
    ['l.group_id = $3::bigint', 'f.group_id = l.group_id', wrongGroup.id],
    ['l.agent_id = $5::uuid', 'f.agent_id = l.agent_id', wrongAgent.id],
  ]) {
    assert.deepEqual(ids(await mutantTargeted(sql => sql.replace(single, 'true'), { throughLogId: cutoff })), expected);
    assert.deepEqual(ids(await mutantTargeted(sql => sql.replace(joined, 'true'), { throughLogId: cutoff })), expected);
    const widened = await mutantTargeted(sql => sql.replace(single, 'true').replace(joined, 'true'), { throughLogId: cutoff });
    assert.ok(ids(widened).includes(forbidden));
    assert.throws(() => assert.deepEqual(ids(widened), expected), 'paired-scope mutation must be caught');
  }
});
await check('candidate supersession immediately excludes a source and removal of the guard is detected', async () => {
  await db.execute('update vy_episode set superseded_by=$2 where id=$1 returning id', [ebad.id, et.id]);
  assert.deepEqual(ids(await targeted()), [safeLog]);
  const widened = await mutantTargeted(sql => sql.replace('f.superseded_by is null', 'true'));
  assert.ok(ids(widened).includes(badLog));
  assert.throws(() => assert.deepEqual(ids(widened), [safeLog]));
  await db.execute('update vy_episode set superseded_by=null where id=$1 returning id', [ebad.id]);
});
await check('candidate late join cannot inherit old evidence and participant-predicate mutation is caught', async () => {
  await insert('vy_group_member', { group_id: GT, agent_id: A, person_id: LATE, linked_at: '2026-09-02T00:00:00Z', surface: 'telegram', surface_user_id: '-100062' });
  assert.equal((await targeted([P, Q, LATE])).length, 0);
  const widened = await mutantTargeted(sql => sql.replace('and p.person_id = r.pid', ''), { recipients: [P, Q, LATE] });
  assert.deepEqual(ids(widened), [badLog, safeLog]);
  assert.throws(() => assert.equal(widened.length, 0));
  await db.execute('delete from vy_group_member where group_id=$1 and person_id=$2 returning person_id', [GT, LATE]);
});
await check('candidate ordinary departure preserves witnessed peer recall but never grants a later outsider access', async () => {
  await db.execute('update vy_group_member set left_at=now() where group_id=$1 and person_id=$2 returning person_id', [GT, P]);
  assert.deepEqual(ids(await targeted([Q])), [badLog, safeLog]);
  assert.equal((await targeted([Q, LATE])).length, 0);
  assert.equal((await db.execute('select person_id from vy_episode_participant where episode_id=$1', [ebad.id])).length, 2,
    'ordinary departure does not rewrite an immutable historical audience');
  await db.execute('update vy_group_member set left_at=null where group_id=$1 and person_id=$2 returning person_id', [GT, P]);
});
await check('candidate grants cover every recipient and revoked or other-agent grants cannot reopen a source', async () => {
  assert.equal((await targeted([LATE])).length, 0);
  const [grant] = await insert('vy_disclosure_grant', { agent_id: A, subject_kind: 'episode', subject_id: ebad.id,
    granted_by: P, granted_to: LATE, group_id: GT, citations: [et.id] });
  assert.deepEqual(ids(await targeted([LATE])), [badLog]);
  assert.equal((await targeted([Q, LATE])).length, 0, 'one granted recipient is not a covering grant set');
  await db.execute('update vy_disclosure_grant set t_invalid=now() where id=$1 returning id', [grant.id]);
  assert.equal((await targeted([LATE])).length, 0);
  const widened = await mutantTargeted(sql => sql.replace('g.t_invalid is null', 'true'), { recipients: [LATE] });
  assert.deepEqual(ids(widened), [badLog]);
  assert.throws(() => assert.equal(widened.length, 0));
  await db.execute('update vy_disclosure_grant set t_invalid=null,agent_id=$2 where id=$1 returning id', [grant.id, B]);
  assert.equal((await targeted([LATE])).length, 0);
  await db.execute('delete from vy_disclosure_grant where id=$1 returning id', [grant.id]);
});
await check('candidate explicit deny and negative affect defeat even a complete grant', async () => {
  const [grant] = await insert('vy_disclosure_grant', { agent_id: A, subject_kind: 'episode', subject_id: ebad.id,
    granted_by: P, granted_to: LATE, group_id: GT, citations: [et.id] });
  await db.execute("update vy_episode set disclosure_scope='private' where id=$1 returning id", [ebad.id]);
  assert.deepEqual(ids(await targeted([LATE])), [badLog], 'preserve existing explicit-grant override of structural private scope');
  await db.execute('update vy_episode set disclosure_deny=$2 where id=$1 returning id', [ebad.id, [LATE]]);
  assert.equal((await targeted([LATE])).length, 0);
  const denyRemoved = await mutantTargeted(sql => sql.replace(/-- \(0\) explicit deny[\s\S]*?(?=-- \(5\) hard floor)/, ''), { recipients: [LATE] });
  assert.deepEqual(ids(denyRemoved), [badLog]);
  assert.throws(() => assert.equal(denyRemoved.length, 0));
  await db.execute("update vy_episode set disclosure_deny='{}',affect_tags=$2::jsonb where id=$1 returning id", [ebad.id, JSON.stringify([{ tag: 'sad' }])]);
  assert.equal((await targeted([LATE])).length, 0);
  const affectRemoved = await mutantTargeted(sql => sql.replace("where (atag->>'tag') = any(($4)::text[])", "where false and ($4)::text[] is not null"), { recipients: [LATE] });
  assert.deepEqual(ids(affectRemoved), [badLog]);
  assert.throws(() => assert.equal(affectRemoved.length, 0));
  await db.execute("update vy_episode set disclosure_scope='participants',affect_tags='[]'::jsonb where id=$1 returning id", [ebad.id]);
  await db.execute('delete from vy_disclosure_grant where id=$1 returning id', [grant.id]);
});
await check('candidate episode erasure cannot leave a readable orphan log', async () => {
  const erased = await episode(GT); const erasedLog = await turn(erased.id, { groupId: GT, content: 'Source about to be erased' });
  assert.ok(erasedLog); assert.ok(ids(await targeted([P, Q], erasedLog)).includes(erasedLog));
  await db.execute('delete from vy_episode where id=$1 returning id', [erased.id]);
  assert.ok(!ids(await targeted([P, Q], erasedLog)).includes(erasedLog));
});
await check('candidate withdrawal removes own text and original-audience rights while retaining the witnessed peer and other agent', async () => {
  const before = await targeted(); assert.deepEqual(ids(before), [badLog, safeLog]);
  const receipt = await m.withdrawSharedRows(P, { agentId: A });
  assert.ok(receipt.room_turns > 0); assert.ok(receipt.participant_rows > 0);
  assert.equal((await targeted([P, Q])).length, 0);
  assert.deepEqual(ids(await targeted([Q])), [safeLog]);
  assert.ok(ids(await candidates([P, Q], lOther, GB, B)).includes(lOther));
});

// Source-event fences are deliberately tested in a fresh group after the
// withdrawal cases. These are ordered statement snapshots, NOT a concurrent
// erasure serialization proof or a historical membership/replay policy.
const GEVENT = await group(A, '-10007');
const EVENT_AFTER = '2026-09-03T00:00:01.000Z', EVENT_LATER = '2026-09-03T00:00:02.000Z';
const eventEpisode = (sourceSentAt = SOURCE_SENT_AT) => episode(GEVENT, A, [P, Q], sourceSentAt);
const eventTurn = (episodeId, sourceSentAt = SOURCE_SENT_AT, role = 'me') => turn(episodeId, {
  groupId: GEVENT, sourceSentAt, role, speakerPersonId: role === 'me' ? P : null, content: 'Synthetic known-consent source event' });
const memberTime = (person, at) => db.execute('update vy_group_member set linked_at=$3::timestamptz where group_id=$1 and person_id=$2 returning person_id', [GEVENT, person, at]);
const groupTime = at => db.execute('update vy_group set read_consent_at=$2::timestamptz where id=$1 returning id', [GEVENT, at]);
await check('source writes accept a trusted canonical event strictly after known consent for human and assistant audit', async () => {
  const ep = await eventEpisode(); assert.ok(ep?.id);
  const human = await eventTurn(ep.id), audit = await eventTurn(ep.id, SOURCE_SENT_AT, 'her');
  assert.ok(human); assert.ok(audit);
  const rows = await db.execute('select id,role,episode_id,speaker_person_id,at from meera_log where id=any($1::bigint[]) order by id', [[human, audit]]);
  assert.deepEqual(rows.map(r => r.role), ['me', 'her']);
  assert.deepEqual(rows.map(r => r.episode_id), [ep.id, ep.id]);
  assert.deepEqual(rows.map(r => r.speaker_person_id), [P, null]);
  assert.ok(rows.every(r => r.at), 'database recording time remains separate from the source-event admission fence');
});
await check('source writes refuse delayed events before or exactly at group read consent without persisting new rows', async () => {
  const ep = await eventEpisode(); assert.ok(ep?.id);
  const before = await db.execute('select count(*) n from meera_log where group_id=$1', [GEVENT]);
  for (const sourceSentAt of ['2026-08-31T23:59:59.000Z', CONSENT_AT]) {
    assert.equal(await eventEpisode(sourceSentAt), null);
    assert.equal(await eventTurn(ep.id, sourceSentAt), null);
    assert.equal(await eventTurn(ep.id, sourceSentAt, 'her'), null);
  }
  assert.deepEqual(await db.execute('select count(*) n from meera_log where group_id=$1', [GEVENT]), before);
});
await check('source writes fence every recipient, not only the speaker, and fail at exact or subsecond-later link equality', async () => {
  const ep = await eventEpisode(); assert.ok(ep?.id);
  for (const person of [P, Q]) {
    for (const linkedAt of [SOURCE_SENT_AT, '2026-09-03T00:00:00.001Z', EVENT_AFTER]) {
      await memberTime(person, linkedAt);
      assert.equal(await eventEpisode(), null);
      assert.equal(await eventTurn(ep.id), null);
      assert.equal(await eventTurn(ep.id, SOURCE_SENT_AT, 'her'), null);
    }
    await memberTime(person, CONSENT_AT);
  }
  assert.ok((await eventEpisode())?.id);
});
await check('source episode creation rechecks a recipient relink after caller observation even when all person IDs stay unchanged', async () => {
  const before = await db.execute('select person_id,linked_at from vy_group_member where group_id=$1 order by person_id', [GEVENT]);
  assert.deepEqual(before.map(r => r.person_id), [P, Q]);
  await memberTime(Q, SOURCE_SENT_AT);
  const after = await db.execute('select person_id,linked_at from vy_group_member where group_id=$1 order by person_id', [GEVENT]);
  assert.deepEqual(after.map(r => r.person_id), before.map(r => r.person_id));
  assert.notEqual(after[1].linked_at, before[1].linked_at);
  assert.equal(await eventEpisode(), null);
  const newer = await eventEpisode(EVENT_AFTER); assert.ok(newer?.id);
  assert.ok(await eventTurn(newer.id, EVENT_AFTER));
  await memberTime(Q, CONSENT_AT);
});
await check('source human and assistant writes recheck relink between episode creation and log insertion', async () => {
  const ep = await eventEpisode(); assert.ok(ep?.id);
  await memberTime(Q, EVENT_AFTER);
  assert.equal(await eventTurn(ep.id), null);
  assert.equal(await eventTurn(ep.id, SOURCE_SENT_AT, 'her'), null);
  const newer = await eventEpisode(EVENT_LATER); assert.ok(newer?.id);
  assert.ok(await eventTurn(newer.id, EVENT_LATER));
  assert.ok(await eventTurn(newer.id, EVENT_LATER, 'her'));
  await memberTime(Q, CONSENT_AT);
});
await check('source writes recheck renewed group consent between episode and log while permitting genuinely newer events', async () => {
  const ep = await eventEpisode(); assert.ok(ep?.id);
  await groupTime(EVENT_AFTER);
  assert.equal(await eventEpisode(), null);
  assert.equal(await eventTurn(ep.id), null);
  assert.equal(await eventTurn(ep.id, SOURCE_SENT_AT, 'her'), null);
  const newer = await eventEpisode(EVENT_LATER); assert.ok(newer?.id);
  assert.ok(await eventTurn(newer.id, EVENT_LATER));
  await groupTime(CONSENT_AT);
});
await check('captured writer SQL mutations cannot silently relax consent equality or omit a non-speaker recipient', async () => {
  let captured;
  const capture = await production(async (sql, params) => { captured = { sql, params }; return []; });
  const ep = await eventEpisode(); assert.ok(ep?.id);
  async function mutated(kind, sourceSentAt, transform) {
    captured = null;
    if (kind === 'episode') await capture.openOrExtendGroupEpisode(GEVENT, { roomDevice: DEVICE, agentId: A, recipients: [P, Q], sourceSentAt });
    else await capture.logRoomTurn({ groupId: GEVENT, roomDevice: DEVICE, agentId: A, episodeId: ep.id, recipients: [P, Q],
      role: kind, speakerPersonId: kind === 'me' ? P : null, content: 'Synthetic timestamp negative control', sourceSentAt });
    assert.ok(captured);
    const sql = transform(captured.sql, kind === 'episode' ? '$5' : '$10');
    assert.notEqual(sql, captured.sql, 'writer negative control must mutate actual captured SQL');
    return db.query(sql, captured.params);
  }
  // Isolate the group-consent equality guard from the independently strict
  // member guard by giving members an earlier known consent instant.
  for (const person of [P, Q]) await memberTime(person, '2026-08-31T23:59:59.000Z');
  for (const kind of ['episode', 'me', 'her']) {
    assert.equal(kind === 'episode' ? await eventEpisode(CONSENT_AT) : await eventTurn(ep.id, CONSENT_AT, kind), null);
    const rows = await mutated(kind, CONSENT_AT, (sql, bind) => sql.replace(`g.read_consent_at < ${bind}::timestamptz`, `g.read_consent_at <= ${bind}::timestamptz`));
    assert.equal(rows.length, 1);
    assert.throws(() => assert.equal(rows.length, 0), 'group equality relaxation must be caught');
  }
  await memberTime(P, CONSENT_AT); await memberTime(Q, SOURCE_SENT_AT);
  for (const kind of ['episode', 'me', 'her']) {
    assert.equal(kind === 'episode' ? await eventEpisode() : await eventTurn(ep.id, SOURCE_SENT_AT, kind), null);
    const equal = await mutated(kind, SOURCE_SENT_AT, (sql, bind) => sql.replace(`cm.linked_at >= ${bind}::timestamptz`, `cm.linked_at > ${bind}::timestamptz`));
    assert.equal(equal.length, 1);
    assert.throws(() => assert.equal(equal.length, 0), 'member equality relaxation must be caught');
    const onlySpeaker = await mutated(kind, SOURCE_SENT_AT, sql => sql.replace('and cm.left_at is null', `and cm.person_id = '${P}'::uuid and cm.left_at is null`));
    assert.equal(onlySpeaker.length, 1);
    assert.throws(() => assert.equal(onlySpeaker.length, 0), 'speaker-only consent check must be caught');
  }
  await memberTime(Q, CONSENT_AT);
});
await check('actual PostgreSQL group authority timestamps cross the real source-event helper boundary without format rewriting', async () => {
  const event = { kind: 'message', isGroup: true, sourceEventKind: 'ordinary_message',
    sourceSentAtSeconds: Date.parse(SOURCE_SENT_AT) / 1000, surface: 'telegram', chatKey: '-10007', surfaceUserId: '-100070' };
  const authority = await m.groupTurnAuthority(GEVENT, A);
  assert.ok(authority);
  assert.deepEqual(Array.from(authority.recipients), [P, Q]);
  assert.equal(authority.linked_members.length, 2);
  // The synthetic PostgreSQL text column uses +00 while its jsonb aggregate
  // carries +00:00. Do not normalize either before passing the actual receipt
  // to the production helper: doing so would hide the cross-boundary defect.
  assert.match(authority.read_consent_at, / \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00$/);
  assert.match(authority.linked_members[0].linked_at, /T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?\+00:00$/);
  console.log(`synthetic authority timestamp formats: group=${JSON.stringify(authority.read_consent_at)} member=${JSON.stringify(authority.linked_members[0].linked_at)}`);
  assert.equal(assertGroupSourceEvent(event, authority, [P, Q]), SOURCE_SENT_AT);
  const refused = receipt => assert.throws(() => assertGroupSourceEvent(event, receipt, [P, Q]),
    error => error.code === 'group_source_event_unavailable' && error.status === 503);
  await groupTime(SOURCE_SENT_AT);
  refused(await m.groupTurnAuthority(GEVENT, A));
  await groupTime(CONSENT_AT);
  for (const linkedAt of [SOURCE_SENT_AT, '2026-09-03T00:00:00.000001Z', EVENT_AFTER]) {
    await memberTime(Q, linkedAt);
    const relinked = await m.groupTurnAuthority(GEVENT, A);
    assert.deepEqual(Array.from(relinked.recipients), [P, Q], 'same recipient IDs do not hide a changed link date');
    refused(relinked);
  }
  await memberTime(Q, '2026-09-02T23:59:59.999999Z');
  assert.equal(assertGroupSourceEvent(event, await m.groupTurnAuthority(GEVENT, A), [P, Q]), SOURCE_SENT_AT,
    'exact PostgreSQL microseconds immediately before the event remain earlier');
  await memberTime(Q, CONSENT_AT);
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
