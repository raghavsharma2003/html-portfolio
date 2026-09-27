// Static regression coverage for the prerequisites missing in APK run
// 36301230958. This does not run a browser, fetch history or prove CI green.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n');
const archive = '7a8ad90dd63fd30ea5a1a64bde4cf8dc016b3fb4';
const history = `git fetch --no-tags --depth=2 origin ${archive}:refs/remotes/origin/codex/handoff-history-20260909`;
const chromium = 'npx playwright install --with-deps chromium';
const echo = 'node evals/echosim/build.mjs';
const web = 'npx vite build';
const fontCommands = [
  'mkdir -p "$HOME/.local/share/fonts"',
  'cp node_modules/@expo-google-fonts/noto-sans-devanagari/400Regular/NotoSansDevanagari_400Regular.ttf "$HOME/.local/share/fonts/"',
  'fc-cache -f "$HOME/.local/share/fonts"',
  'fc-list | grep -qi "Noto Sans Devanagari" || { echo "::error::Noto Sans Devanagari did not register with fontconfig -- the glyph pass would be blind on this runner"; exit 1; }',
];
const apk = read('.github/workflows/build-apk.yml');
const release = read('.github/workflows/release-gate.yml');
const runner = read('scripts/verify-release.mjs');
let checks = 0;
function check(name, action) { action(); console.log(`PASS ${++checks}: ${name}`); }

// These workflows use two-space jobs and scalar run commands for their
// prerequisites. Inspect the named job, never a command in a comment or in
// another job. General workflow expression lint remains a separate gate.
function jobLines(source, name) {
  const lines = source.split(/\r?\n/);
  const start = lines.indexOf(`  ${name}:`);
  assert.notEqual(start, -1, `missing job ${name}`);
  const next = lines.findIndex((line, index) => index > start && /^  [\w-]+:/.test(line));
  return lines.slice(start + 1, next === -1 ? undefined : next);
}
function commands(source, name) {
  return jobLines(source, name).flatMap(line => {
    const match = /^(?: {6}- | {8})(?:run|uses): (.+)$/.exec(line);
    return match ? [match[1]] : [];
  });
}
function onceBefore(list, command, later) {
  assert.equal(list.filter(value => value === command).length, 1, `one ${command}`);
  assert.ok(list.includes(later), `missing ${later}`);
  assert.ok(list.indexOf(command) < list.indexOf(later), `${command} must precede ${later}`);
}
function validate(source, name, gate) {
  const list = commands(source, name);
  onceBefore(list, 'actions/checkout@v4', history);
  onceBefore(list, history, 'npm ci');
  onceBefore(list, 'npm ci', chromium);
  onceBefore(list, chromium, gate);
  onceBefore(list, echo, gate);
  if (name === 'build') {
    onceBefore(list, 'node scripts/write-config.mjs --stub', web);
    onceBefore(list, web, gate);
    onceBefore(list, gate, 'npx cap sync android');
  } else {
    onceBefore(list, 'CI=1 node scripts/write-config.mjs --stub', gate);
    assert.equal(list.filter(value => value === web).length, 0, 'release runner owns web build');
  }
}
function validateFailureLogs(source) {
  const list = commands(source, 'gate');
  onceBefore(list, 'node scripts/verify-release.mjs', 'actions/upload-artifact@v4');
  assert.equal(list.filter(value => value === 'actions/upload-artifact@v4').length, 1, 'one diagnostics upload');
  const uploads = jobLines(source, 'gate').join('\n').split(/^ {6}- /m)
    .filter(step => /^ {8}uses: actions\/upload-artifact@v4$/m.test(step));
  assert.equal(uploads.length, 1);
  const upload = uploads[0];
  for (const field of [
    '        if: ${{ failure() }}',
    '          name: release-failure-logs-node-${{ matrix.node-version }}',
    '          path: scratchpad/release-logs/',
    '          retention-days: 7',
    '          if-no-files-found: warn',
  ]) assert.ok(upload.split('\n').includes(field), `diagnostics requires ${field.trim()}`);
}
function validateBundledFont(source, name, gate) {
  const lines = jobLines(source, name);
  let previous = lines.indexOf('      - run: npm ci');
  assert.ok(previous >= 0, 'npm dependencies must exist before installing the bundled face');
  for (const command of fontCommands) {
    const line = `          ${command}`;
    assert.equal(lines.filter(value => value === line).length, 1, `one bundled font command: ${command}`);
    const index = lines.indexOf(line);
    assert.ok(index > previous, 'font setup and registration must run in order after npm ci');
    previous = index;
  }
  assert.ok(lines.indexOf(`      - run: ${gate}`) > previous, 'registered face must exist before browser suites');
}

check('APK prepares archive, browser and both generated artifacts before eval', () => {
  validate(apk, 'build', 'node evals/run.mjs');
});
check('release matrix prepares archive, browser and audio before the unchanged gate', () => {
  validate(release, 'gate', 'node scripts/verify-release.mjs');
  const webAt = runner.indexOf('await gate("web build",');
  const evalAt = runner.indexOf('await gate("eval suite",');
  assert.ok(webAt >= 0 && evalAt > webAt, 'runner builds fixtures before its eval suite');
  assert.ok(!release.includes('secrets' + '.'), 'release remains free of live secret references');
});
check('archive pin agrees with the preserved recovery receipt', () => {
  assert.equal(JSON.parse(read('docs/handoff/2026-09-09/remote-recovery-result.json')).history, archive);
});
check('each missing APK prerequisite is caught', () => {
  for (const command of [history, chromium, web, echo]) {
    assert.throws(() => validate(apk.replace(command, 'true'), 'build', 'node evals/run.mjs'));
  }
});
check('each missing release prerequisite is caught in its own job', () => {
  for (const command of [history, chromium, echo]) {
    assert.throws(() => validate(release.replace(command, 'true'), 'gate', 'node scripts/verify-release.mjs'));
  }
});
check('shallow or mutable archive replacements cannot drop historical controls', () => {
  for (const replacement of [history.replace('--depth=2', '--depth=1'), history.replace(archive, 'codex/handoff-history-20260909')]) {
    assert.throws(() => validate(apk.replace(history, replacement), 'build', 'node evals/run.mjs'));
  }
});
check('a build after eval and a duplicate build are both rejected', () => {
  const late = apk.replace(`      - run: ${web}\n`, '').replace('      - run: node evals/run.mjs', `      - run: node evals/run.mjs\n      - run: ${web}`);
  assert.equal(commands(late, 'build').filter(value => value === web).length, 1, 'late-build control still has exactly one build');
  assert.throws(() => validate(late, 'build', 'node evals/run.mjs'));
  assert.throws(() => validate(apk.replace(`      - run: ${web}`, `      - run: ${web}\n      - run: ${web}`), 'build', 'node evals/run.mjs'));
});
check('failed release retains only sanitized gate logs with per-Node names for seven days', () => {
  validateFailureLogs(release);
});
check('diagnostics cannot broaden its path, trigger, retention or lose matrix isolation', () => {
  for (const [before, after] of [
    ['path: scratchpad/release-logs/', 'path: scratchpad/'],
    ['if: ${{ failure() }}', 'if: ${{ always() }}'],
    ['retention-days: 7', 'retention-days: 90'],
    ['if-no-files-found: warn', 'if-no-files-found: error'],
    ['name: release-failure-logs-node-${{ matrix.node-version }}', 'name: release-failure-logs'],
  ]) assert.throws(() => validateFailureLogs(release.replace(before, after)));
});
check('diagnostic upload must follow the release gate', () => {
  const beforeGate = release.replace('      - run: node scripts/verify-release.mjs\n', '')
    .replace('          if-no-files-found: warn', '          if-no-files-found: warn\n      - run: node scripts/verify-release.mjs');
  assert.throws(() => validateFailureLogs(beforeGate));
});
check('APK and release register the same bundled Hindi face before browser gates', () => {
  validateBundledFont(apk, 'build', 'node evals/run.mjs');
  validateBundledFont(release, 'gate', 'node scripts/verify-release.mjs');
});
check('missing font, cache refresh or fail-closed registration check is caught', () => {
  for (const command of fontCommands) {
    assert.throws(() => validateBundledFont(apk.replace(command, 'true'), 'build', 'node evals/run.mjs'));
  }
  assert.throws(() => validateBundledFont(apk.replace('NotoSansDevanagari_400Regular.ttf', 'WrongFace.ttf'), 'build', 'node evals/run.mjs'));
  assert.throws(() => validateBundledFont(apk.replace('exit 1;', 'exit 0;'), 'build', 'node evals/run.mjs'));
});
check('font registration after eval or before npm dependencies is rejected', () => {
  const beforeFont = apk.replace('      - run: node evals/run.mjs\n', '')
    .replace('      - name: Install the bundled Devanagari face', '      - run: node evals/run.mjs\n      - name: Install the bundled Devanagari face');
  assert.throws(() => validateBundledFont(beforeFont, 'build', 'node evals/run.mjs'));
  const lateInstall = apk.replace('      - run: npm ci\n', '')
    .replace('      - name: Install Chromium for Playwright', '      - run: npm ci\n      - name: Install Chromium for Playwright');
  assert.throws(() => validateBundledFont(lateInstall, 'build', 'node evals/run.mjs'));
});
console.log(`CI prerequisite regression: ${checks} groups passed; static only, no hosted execution.`);
