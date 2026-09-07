import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../..', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const closure = ['api/_model-serving-policy.js', 'api/_azure-surface-reply.js', 'api/_provider-budget.js', 'api/_provenance/contracts.js', 'api/_voice/contracts.js', 'api/_replica.js', 'api/_invites.js'];
const oldWriter = readFileSync(new URL('./old-write-config.mjs.txt', import.meta.url));
const oldBuild = readFileSync(new URL('./old-vercel-build.sh.txt', import.meta.url));
const workspace = mkdtempSync(join(tmpdir(), 'vyakti-azure-build-'));
const checks = [];
let prepared = false;
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP)$/i.test(key)));
const fake = {
  CI: '1', VYAKTI_MODEL_SERVING: 'azure_only',
  AZURE_FOUNDRY_ENDPOINT: 'https://synthetic-build.services.ai.azure.com',
  AZURE_FOUNDRY_API_KEY: 'synthetic-azure-key-never-real',
  AZURE_FOUNDRY_REPLY_MODEL: 'synthetic-model',
  AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: '0.4',
  AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: '1.6',
  AZURE_REPLICA_APP_BUDGET_USD: '1',
  NEON_URL: 'postgresql://synthetic-user:synthetic-pass@db.invalid/synthetic',
};
const secretValues = [fake.AZURE_FOUNDRY_API_KEY, fake.NEON_URL, 'synthetic-openrouter-never-real'];
const check = (name, fn) => { fn(); checks.push(name); console.log(`ok ${checks.length}: ${name}`); };
const copy = (dir, path) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); copyFileSync(join(root, path), join(dir, path)); };
function prepare(old = false) {
  const dir = join(workspace, 'case');
  if (!prepared) {
    mkdirSync(join(dir, 'scripts'), { recursive: true });
    mkdirSync(join(dir, 'api'), { recursive: true });
    mkdirSync(join(dir, 'src'), { recursive: true });
    writeFileSync(join(dir, 'package.json'), '{"type":"module"}');
    writeFileSync(join(dir, 'guard.mjs'), 'globalThis.fetch=()=>{throw new Error("NETWORK_FORBIDDEN_IN_BUILD_CONFIG_TEST")};\n');
    for (const path of closure) copy(dir, path);
    prepared = true;
  }
  // Each child is a fresh process and receives a fresh config-file state;
  // immutable dependency bytes can be shared across these sequential cases.
  rmSync(join(dir, 'api/_config.js'), { force: true });
  writeFileSync(join(dir, 'scripts/write-config.mjs'), old ? oldWriter : readFileSync(join(root, 'scripts/write-config.mjs')));
  return dir;
}
function run(dir, vars, args = [], command = process.execPath) {
  const result = spawnSync(command, args.length ? args : ['--import', pathToFileURL(join(dir, 'guard.mjs')).href, 'scripts/write-config.mjs'], {
    cwd: dir, env: { ...safeEnv, ...vars }, encoding: 'utf8', timeout: 12_000,
  });
  if (result.error) throw new Error(`fixture subprocess failed: ${result.error.code || 'unknown'}`);
  const output = (result.stdout || '') + (result.stderr || '');
  for (const value of secretValues) assert.ok(!output.includes(value), 'configuration value appeared in subprocess output');
  return { ...result, output, config: existsSync(join(dir, 'api/_config.js')) ? readFileSync(join(dir, 'api/_config.js'), 'utf8') : null };
}
function writer(vars, { old = false, stub = false, existing } = {}) {
  const dir = prepare(old);
  if (existing !== undefined) writeFileSync(join(dir, 'api/_config.js'), existing);
  return run(dir, vars, ['--import', pathToFileURL(join(dir, 'guard.mjs')).href, 'scripts/write-config.mjs', ...(stub ? ['--stub'] : [])]);
}
const invalid = patch => ({ ...fake, ...patch });
try {
  check('old valid Azure-only configuration refuses without OpenRouter', () => {
    const r = writer(fake, { old: true });
    assert.equal(r.status, 1); assert.match(r.output, /OPENROUTER_KEY is required/);
  });
  check('valid Azure-only bootstrap writes real synthetic config without existing config or network', () => {
    const r = writer(fake); assert.equal(r.status, 0);
    assert.ok(r.config.includes(JSON.stringify(fake.NEON_URL)));
    assert.ok(r.config.includes('export const OPENROUTER_KEY = "";'));
    assert.ok(!r.config.includes(fake.AZURE_FOUNDRY_API_KEY), 'runtime-only Azure key must not be newly baked');
  });
  check('explicit azure_foundry provider alone chooses Azure validation', () => {
    assert.equal(writer(invalid({ VYAKTI_MODEL_SERVING: '', VYAKTI_REPLY_PROVIDER: 'azure_foundry' })).status, 0);
  });
  check('reply-specific endpoint/key override general fields as runtime does', () => {
    assert.equal(writer(invalid({ AZURE_FOUNDRY_ENDPOINT: '', AZURE_FOUNDRY_API_KEY: '', AZURE_FOUNDRY_REPLY_ENDPOINT: fake.AZURE_FOUNDRY_ENDPOINT, AZURE_FOUNDRY_REPLY_API_KEY: fake.AZURE_FOUNDRY_API_KEY })).status, 0);
  });
  const cases = [
    ['missing endpoint', { AZURE_FOUNDRY_ENDPOINT: '' }, 'azure_reply_endpoint_required'],
    ['deceptive endpoint', { AZURE_FOUNDRY_ENDPOINT: 'https://synthetic.services.ai.azure.com.foreign.invalid' }, 'azure_reply_endpoint_invalid'],
    ['HTTP endpoint', { AZURE_FOUNDRY_ENDPOINT: 'http://synthetic.services.ai.azure.com' }, 'azure_reply_endpoint_invalid'],
    ['endpoint userinfo', { AZURE_FOUNDRY_ENDPOINT: 'https://synthetic:credential@synthetic.services.ai.azure.com' }, 'azure_reply_endpoint_invalid'],
    ['missing key', { AZURE_FOUNDRY_API_KEY: '' }, 'azure_reply_auth_required'],
    ['missing model', { AZURE_FOUNDRY_REPLY_MODEL: '' }, 'azure_reply_model_required'],
    ['invalid model', { AZURE_FOUNDRY_REPLY_MODEL: 'bad/model' }, 'azure_reply_model_required'],
    ['missing reply input rate despite generic rate', { AZURE_FOUNDRY_REPLY_INPUT_USD_PER_MTOKENS: '', AZURE_FOUNDRY_INPUT_USD_PER_MTOKENS: '0.4' }, 'provider_input_rate_required'],
    ['invalid output rate', { AZURE_FOUNDRY_REPLY_OUTPUT_USD_PER_MTOKENS: 'NaN' }, 'provider_output_rate_required'],
    ['zero budget', { AZURE_REPLICA_APP_BUDGET_USD: '0' }, 'provider_budget_limit_required'],
    ['invalid budget ID', { AZURE_REPLICA_BUDGET_ID: 'INVALID' }, 'provider_budget_id_invalid'],
    ['missing Neon', { NEON_URL: ' ' }, 'NEON_URL_required'],
    ['conflicting external provider', { VYAKTI_REPLY_PROVIDER: 'openrouter', OPENROUTER_KEY: 'synthetic-openrouter-never-real' }, 'model_serving_provider_denied'],
  ];
  for (const [name, patch, code] of cases) check(`${name} refuses before creating config`, () => {
    const r = writer(invalid(patch)); assert.equal(r.status, 1); assert.equal(r.config, null); assert.ok(r.output.includes(code));
  });
  check('explicit Azure invalid --stub cannot bypass validation or overwrite existing file', () => {
    const r = writer(invalid({ AZURE_FOUNDRY_API_KEY: '' }), { stub: true, existing: '// existing synthetic config\n' });
    assert.equal(r.status, 1); assert.equal(r.config, '// existing synthetic config\n');
  });
  check('legacy companion generated bytes remain identical including labelled keyring', () => {
    const env = { CI: '1', NEON_URL: fake.NEON_URL, OPENROUTER_KEY: 'synthetic-openrouter-never-real', GOOGLE_KEYS: JSON.stringify(['label~synthetic-google-key-long-enough']) };
    const before = writer(env, { old: true }), after = writer(env);
    assert.equal(before.status, 0); assert.equal(after.status, 0); assert.equal(after.config, before.config);
  });
  check('legacy missing OpenRouter still refuses', () => assert.equal(writer({ CI: '1', NEON_URL: fake.NEON_URL }).status, 1));
  check('unconfigured generic CI --stub remains identical', () => {
    const before = writer({ CI: '1' }, { old: true, stub: true }), after = writer({ CI: '1' }, { stub: true });
    assert.equal(after.status, 0); assert.equal(after.config, before.config);
  });
  check('local config overwrite refusal remains', () => {
    const r = writer({ ...fake, CI: '' }, { existing: '// retained\n' });
    assert.equal(r.status, 1); assert.equal(r.config, '// retained\n');
  });

  const candidates = process.platform === 'win32'
    ? [join(process.env.LOCALAPPDATA || '', 'Programs/Git/bin/bash.exe'), join(process.env.ProgramFiles || '', 'Git/bin/bash.exe')]
    : ['/bin/bash', '/usr/bin/bash'];
  const bash = candidates.find(existsSync);
  assert.ok(bash, 'Bash is required for actual build-shell controls; no silent skip');
  function build(vars, { old = false, existing } = {}) {
    const dir = prepare(old);
    writeFileSync(join(dir, 'scripts/vercel-build.sh'), (old ? oldBuild.toString() : readFileSync(join(root, 'scripts/vercel-build.sh'), 'utf8')).replaceAll('\r\n', '\n'));
    copy(dir, 'scripts/vercel-product.mjs');
    writeFileSync(join(dir, '.vercel-release-preinstall.json'), '{}');
    if (existing !== undefined) writeFileSync(join(dir, 'api/_config.js'), existing);
    mkdirSync(join(dir, 'bin'), { recursive: true });
    writeFileSync(join(dir, 'bin/npx'), '#!/usr/bin/env bash\nprintf "VITE_SENTINEL\\n"\nexit 73\n', { mode: 0o755 });
    const pathKey = Object.keys(safeEnv).find(key => key.toLowerCase() === 'path') || 'PATH';
    // Export within Bash to avoid Windows/MSYS PATH separator ambiguity.
    const result = run(dir, { ...vars, [pathKey]: safeEnv[pathKey], NODE_OPTIONS: `--import=${pathToFileURL(join(dir, 'guard.mjs')).href}` }, ['-c', 'export PATH="$PWD/bin:$PATH"; exec bash scripts/vercel-build.sh'], bash);
    return result;
  }
  check('old invalid Azure build falls through generic stub to Vite', () => {
    const r = build(invalid({ AZURE_FOUNDRY_API_KEY: '' }), { old: true });
    assert.equal(r.status, 73); assert.ok(r.output.includes('VITE_SENTINEL'));
  });
  check('new invalid Azure build stops before Vite and config write', () => {
    const r = build(invalid({ AZURE_FOUNDRY_API_KEY: '' }));
    assert.equal(r.status, 1); assert.ok(!r.output.includes('VITE_SENTINEL')); assert.equal(r.config, null);
  });
  check('existing config cannot bypass explicit Azure build validation', () => {
    const r = build(invalid({ AZURE_FOUNDRY_API_KEY: '' }), { existing: '// retained\n' });
    assert.equal(r.status, 1); assert.ok(!r.output.includes('VITE_SENTINEL')); assert.equal(r.config, '// retained\n');
  });
  check('valid Azure build reaches Vite without stub fallback', () => {
    const r = build(fake); assert.equal(r.status, 73); assert.ok(r.output.includes('VITE_SENTINEL')); assert.ok(!r.output.includes('Building with stub config'));
  });
  check('unconfigured legacy static preview still uses stub then reaches Vite', () => {
    const r = build({}); assert.equal(r.status, 73); assert.ok(r.output.includes('Building with stub config')); assert.ok(r.output.includes('VITE_SENTINEL'));
  });
  check('legacy configured build still reaches Vite', () => {
    const r = build({ NEON_URL: fake.NEON_URL, OPENROUTER_KEY: 'synthetic-openrouter-never-real' }); assert.equal(r.status, 73); assert.ok(r.output.includes('VITE_SENTINEL'));
  });
} finally {
  // Only the mkdtemp-owned synthetic workspace is removed, never repository data.
  assert.equal(dirname(workspace), resolve(tmpdir()));
  assert.ok(workspace.includes('vyakti-azure-build-'));
  rmSync(workspace, { recursive: true, force: true });
}
const result = { at: new Date().toISOString(), passed: checks.length, checks, method: 'Actual writer and Bash build branch in isolated synthetic temp trees; Vite replaced by sentinel, network blocked, no real credentials', sources: Object.fromEntries(['scripts/write-config.mjs', 'scripts/vercel-build.sh', ...closure].map(path => [path, sha(readFileSync(join(root, path)))])), old_writer_sha256: sha(oldWriter), old_build_sha256: sha(oldBuild) };
if (process.argv.includes('--record')) {
  const dir = join(root, 'scratchpad/azure-build-config'); mkdirSync(dir, { recursive: true });
  const path = join(dir, `${Date.now()}.json`); writeFileSync(path, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' }); result.artifact = path;
}
console.log(JSON.stringify(result, null, 2));
