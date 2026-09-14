import assert from 'node:assert/strict';
import {literalEnglishTextNodes} from './jsx-text.mjs';

export function checkJsxTextScanner() {
  // Exact legacy scanner: the generic selector produced a false visible-text finding.
  function oldScan(src) {
    const tag = /<[A-Za-z][A-Za-z0-9.]*(?:\s[^<>]*)?>([^<>{}]+)(?=<)/g;
    const code = /=|;|useState|useRef|const\s|\/\*|\/\//;
    return [...src.matchAll(tag)].map(m => m[1].replace(/\s+/g, ' ').trim())
      .filter(text => text && !code.test(text) && text.split(' ').filter(word => /[A-Za-z]/.test(word)).length >= 3);
  }
  const selector = `const target = editor.current?.querySelector<HTMLInputElement>(".syllabus-chapters input:not(:disabled)") || editor.current?.querySelector<HTMLTextAreaElement>("textarea");`;
  assert.equal(oldScan(selector).length, 1);
  assert.deepEqual(literalEnglishTextNodes(selector), []);
  const cases = [
    ['nested text', '<section><h3>This is a visible sentence</h3></section>', ['This is a visible sentence']],
    ['adjacent text', '<><p>First visible English sentence</p><p>Second visible English sentence</p></>', ['First visible English sentence', 'Second visible English sentence']],
    ['component text', '<Panel>Read your saved draft</Panel>', ['Read your saved draft']],
    ['after expression', '<p>{value} Read your saved draft</p>', ['Read your saved draft']],
    ['multiline', '<p>Read\n your saved\n draft</p>', ['Read your saved draft']],
    ['prose with punctuation', '<p>Read this; save later</p>', ['Read this; save later']],
    ['prose with code word', '<p>The useState hook is available</p>', ['The useState hook is available']],
    ['localized expression', '<p>{t.savedDraftLabel}</p>', []],
    ['attributes and comments', '<p title="This is an attribute">{/* This is a comment */}</p>', []],
    ['script strings', 'const sample = "<p>This is a sample</p>";', []],
    ['Hindi and short label', '<><p>अपना विवरण देखें</p><p>Saved draft</p></>', []],
    ['semantic code only', '<><code>node script.mjs --file &lt;file&gt;</code><p>Read your saved draft</p></>', ['Read your saved draft']],
    ['pre prose still translated', '<pre>Read your saved draft</pre>', ['Read your saved draft']],
  ];
  for (const [label, src, expected] of cases) assert.deepEqual(literalEnglishTextNodes(src), expected, label);
  assert.throws(() => literalEnglishTextNodes('<section><h3>Unclosed visible English sentence</section>'), /locale_scan_invalid_tsx/);
  return 16;
}
