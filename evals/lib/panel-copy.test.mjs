import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { panelCopy } from './panel-copy.mjs';
const root = mkdtempSync(join(tmpdir(), 'vyakti-panel-copy-'));
assert.equal(dirname(resolve(root)), resolve(tmpdir()));
assert.ok(basename(root).startsWith('vyakti-panel-copy-'));
const dir = join(root, 'src/creatorStudio'); mkdirSync(dir, { recursive: true });
const component = 'const {t}=useStudioLocale(); return <p>{t.readiness.label}</p>';
const write = (en, hi) => {
  writeFileSync(join(dir, 'copy.ts'), `const EN = {readiness: {label: ${JSON.stringify(en)}}, personalAuth:{legal:"model authorization"}};`);
  writeFileSync(join(dir, 'hiCopy.ts'), `export const HI = {readiness: {label: ${JSON.stringify(hi)}}};`);
};
try {
  write('Ready', 'तैयार');
  const base = panelCopy(root, component, ['readiness']);
  assert.ok(base.includes('Ready') && base.includes('तैयार'));
  assert.ok(!base.includes('model authorization'));
  for (const locale of ['en', 'hi']) {
    write(locale === 'en' ? 'your clone' : 'Ready', locale === 'hi' ? 'your clone' : 'तैयार');
    assert.match(panelCopy(root, component, ['readiness']), /\bclone\b/);
  }
  assert.throws(() => panelCopy(root, component + ';t.newSection.label', ['readiness']), /inventory changed/);
  writeFileSync(join(dir, 'hiCopy.ts'), 'export const HI = {};');
  assert.throws(() => panelCopy(root, component, ['readiness']), /literal section required/);
  writeFileSync(join(dir, 'hiCopy.ts'), 'export const HI = {readiness: importedCopy};');
  assert.throws(() => panelCopy(root, component, ['readiness']), /literal section required/);
  console.log('7 scoped panel-copy controls passed: both locales, unrelated auth exclusion, two forbidden locale mutants, added caller, missing/dynamic section');
} finally { rmSync(root, { recursive: true, force: true }); }
