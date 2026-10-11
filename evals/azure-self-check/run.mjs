import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = fileURLToPath(new URL('../..', import.meta.url));
const previousFetch = globalThis.fetch;
let networkAttempts = 0;
globalThis.fetch = () => { networkAttempts++; throw Error('unexpected network'); };
const current = await import('../../api/_self-check.js');
const { selfCheckServing } = await import('../../api/_self-check-serving.js');
const oldBytes = readFileSync(new URL('./old-self-check.js.txt', import.meta.url));
const oldSource = oldBytes.toString().replace(/from "(\.\/[^"\n]+)"/g, (_all, specifier) => `from ${JSON.stringify(pathToFileURL(join(root, 'api', specifier)).href)}`);
const old = await import(`data:text/javascript;base64,${Buffer.from(oldSource).toString('base64')}`);
const checks = [];
const outputs = [];
const check = async (name, fn) => { await fn(); checks.push(name); };
const fake = {
  VYAKTI_MODEL_SERVING: 'azure_only',
  NEON_URL: 'postgresql://synthetic:PRIVATE_MARKER@db.invalid/synthetic',
  AZURE_FOUNDRY_ENDPOINT: 'https://synthetic-self-check.services.ai.azure.com',
  AZURE_FOUNDRY_API_KEY: 'PRIVATE_MARKER_synthetic_key',
  AZURE_FOUNDRY_DIALOGUE_MODEL: 'synthetic-model',
  AZURE_REPLICA_APP_BUDGET_USD: '1',
  AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: '0.4',
  AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: '1.6',
};
function fakeDb() {
  const calls = [];
  const db = async (sql, params = []) => {
    calls.push({ sql, params });
    if (sql === 'select 1') return [{ value: 1 }];
    if (sql.includes('from information_schema.tables')) return current.MIGRATION_FAMILY_TABLES.map(row => ({ table_name: row.table }));
    if (sql.includes('from information_schema.columns')) return current.MIGRATION_FAMILY_COLUMNS.map(row => ({ table_name: row.table, column_name: row.column }));
    if (sql.includes('distinct on (sweep)')) return [];
    throw Error('unhandled fake database statement');
  };
  return { db, calls };
}
async function run(env, api = current, dbOverride) {
  const fixture = fakeDb();
  const result = await api.runSelfCheck({ env, db: dbOverride || fixture.db, now: 1_788_800_000_000, sweepSchedulesFn: () => ({}) });
  outputs.push(result);
  return { result, calls: fixture.calls };
}
try {
  await check('old actual self-check falsely fails valid Azure without OpenRouter', async () => {
    const { result } = await run(fake, old);
    assert.equal(result.ok, false);
    assert.deepEqual(result.failing_doors, ['env: OPENROUTER_KEY missing']);
  });
  await check('current actual self-check accepts same shared reply config without OpenRouter', async () => {
    const { result, calls } = await run(fake);
    assert.equal(result.ok, true); assert.deepEqual(result.failing_doors, []);
    assert.ok(result.checks.some(row => row.door === 'provider: azure_foundry_shared_reply configuration' && row.ok));
    assert.ok(result.optional_absent.includes('OPENROUTER_KEY'));
    assert.equal(calls.length, 4, 'only existing DB checks; no provider SQL');
  });
  await check('retired reply selection does not change Azure classification', async () => {
    const { result } = await run({ ...fake, VYAKTI_MODEL_SERVING: '', VYAKTI_REPLY_PROVIDER: 'azure_foundry' });
    assert.equal(result.ok, true);
  });
  await check('Room uses the same required Foundry names as Meet', () => {
    const env = { ...fake, AZURE_FOUNDRY_REPLY_ENDPOINT: fake.AZURE_FOUNDRY_ENDPOINT,
      AZURE_FOUNDRY_REPLY_API_KEY: fake.AZURE_FOUNDRY_API_KEY, AZURE_FOUNDRY_REPLY_MODEL: 'retired-model' };
    const rows = current.envPresence(env);
    assert.ok(rows.find(row => row.name === 'AZURE_FOUNDRY_ENDPOINT')?.required);
    assert.ok(rows.find(row => row.name === 'AZURE_FOUNDRY_API_KEY')?.required);
    assert.ok(rows.find(row => row.name === 'AZURE_FOUNDRY_DIALOGUE_MODEL')?.required);
    assert.equal(rows.find(row => row.name === 'AZURE_FOUNDRY_REPLY_ENDPOINT')?.required, false);
    assert.equal(rows.find(row => row.name === 'AZURE_FOUNDRY_REPLY_API_KEY')?.required, false);
    assert.equal(selfCheckServing(env).check.ok, true);
  });
  await check('required rows are unique and presence remains boolean only', () => {
    const rows = current.envPresence(fake);
    assert.equal(new Set(rows.map(row => row.name)).size, rows.length);
    assert.equal(rows.filter(row => row.required).length, 7);
    assert.ok(rows.every(row => Object.keys(row).join(',') === 'name,required,present' && typeof row.present === 'boolean' && typeof row.required === 'boolean'));
    outputs.push(rows);
  });
  const invalidCases = [
    ['endpoint absent', { AZURE_FOUNDRY_ENDPOINT: '' }, 'azure_reply_endpoint_required'],
    ['deceptive endpoint present', { AZURE_FOUNDRY_ENDPOINT: 'https://PRIVATE_MARKER.services.ai.azure.com.invalid' }, 'azure_reply_endpoint_invalid'],
    ['key absent', { AZURE_FOUNDRY_API_KEY: '' }, 'azure_reply_auth_required'],
    ['model malformed', { AZURE_FOUNDRY_DIALOGUE_MODEL: 'PRIVATE_MARKER/bad' }, 'azure_reply_model_required'],
    ['shared input rate absent', { AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: '' }, 'provider_input_rate_required'],
    ['shared output rate invalid', { AZURE_FOUNDRY_OUTPUT_USD_PER_MTOKENS: 'PRIVATE_MARKER' }, 'provider_output_rate_required'],
    ['budget invalid', { AZURE_REPLICA_APP_BUDGET_USD: '-1' }, 'provider_budget_limit_required'],
    ['budget ID invalid', { AZURE_REPLICA_BUDGET_ID: 'PRIVATE_MARKER' }, 'provider_budget_id_invalid'],
    ['Neon whitespace only', { NEON_URL: ' ' }, 'neon_url_missing'],
  ];
  for (const [name, patch, code] of invalidCases) await check(`${name} produces named failure without values`, async () => {
    const { result } = await run({ ...fake, ...patch });
    assert.equal(result.ok, false);
    assert.ok(result.failing_doors.includes(`provider: ${code}`));
    assert.ok(!result.failing_doors.includes('env: OPENROUTER_KEY missing'));
  });
  await check('missing actual required Azure names reach existing failing-door consumer', async () => {
    const { result } = await run({ ...fake, AZURE_FOUNDRY_DIALOGUE_MODEL: '' });
    assert.ok(result.failing_doors.includes('env: AZURE_FOUNDRY_DIALOGUE_MODEL missing'));
    const writes = [];
    await current.recordSelfCheckIncidents(async (sql, params) => { writes.push({ sql, params }); return []; }, result);
    assert.equal(writes.length, result.failed);
    assert.ok(writes.every(row => row.sql.includes('insert into vy_incident') && row.params.includes('self_check')));
    assert.ok(JSON.stringify(writes).includes('provider: azure_reply_model_required'));
    outputs.push(writes);
  });
  await check('provider config success does not suppress real database failure', async () => {
    const { result } = await run(fake, current, async () => { throw Error('PRIVATE_MARKER'); });
    assert.equal(result.ok, false); assert.deepEqual(result.failing_doors, ['db: select_1_failed']);
  });
  await check('Azure readiness is unconditional and retired selectors cannot disable it', async () => {
    for (const patch of [{}, { VYAKTI_MODEL_SERVING: '' }, { VYAKTI_MODEL_SERVING: 'openrouter' },
      { VYAKTI_REPLY_PROVIDER: 'openrouter', OPENROUTER_KEY: 'synthetic' }]) {
      const env = { ...fake, ...patch };
      assert.equal(selfCheckServing(env).check.ok, true);
      assert.equal((await run(env)).result.ok, true);
    }
  });
  await check('legacy exported lists stay available while serving requirements are Azure-only', () => {
    assert.deepEqual(current.REQUIRED_ENV, old.REQUIRED_ENV);
    assert.deepEqual(current.OPTIONAL_ENV, old.OPTIONAL_ENV);
    assert.equal(selfCheckServing({}).check.ok, false);
    assert.ok(selfCheckServing({}).required.includes('AZURE_FOUNDRY_DIALOGUE_MODEL'));
  });
  await check('Azure reply success is not a claim that private auth/encryption/storage are configured', async () => {
    const { result } = await run(fake);
    assert.ok(result.optional_absent.includes('SUPABASE_URL'));
    assert.ok(result.optional_absent.includes('SUPABASE_KEY'));
    assert.equal(fake.PRIVATE_TEXT_REHEARSAL_KEK_B64, undefined);
    assert.equal(result.ok, true, 'scope is deployment checks plus shared reply config, not every private capability');
    assert.ok(!result.checks.some(row => /private.*ready|storage.*ready|auth.*ready/i.test(row.door)));
  });
  await check('all observable results and incident writes exclude credential/input markers', () => {
    const json = JSON.stringify(outputs);
    assert.ok(!json.includes('PRIVATE_MARKER'));
    assert.ok(!json.includes(fake.AZURE_FOUNDRY_ENDPOINT));
    assert.ok(!json.includes(fake.AZURE_FOUNDRY_DIALOGUE_MODEL));
    assert.equal(networkAttempts, 0);
  });
} finally { globalThis.fetch = previousFetch; }
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { at: new Date().toISOString(), passed: checks.length, checks, method: 'Actual old/current self-check, pure provider classifier and existing incident consumer; injected scoped SQL fixtures, no real DB/provider calls', sources: Object.fromEntries(['api/_self-check.js', 'api/_self-check-serving.js'].map(path => [path, sha(readFileSync(join(root, path)))])), old_sha256: sha(oldBytes) };
if (process.argv.includes('--record')) {
  const dir = join(root, 'scratchpad/azure-self-check'); mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now()}.json`); writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); result.artifact = path;
}
console.log(JSON.stringify(result, null, 2));
