import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const temp = mkdtempSync(join(root, '.tmp-expert-answer-inline-'));
const emptyCss = join(temp, 'empty-css.mjs');
writeFileSync(emptyCss, 'export default {};\n');
const bundle = join(temp, 'ExpertAnswer.mjs');
await build({
  entryPoints: [join(root, 'src/studio/ExpertAnswer.tsx')], bundle: true,
  format: 'esm', platform: 'node', outfile: bundle, external: ['katex', 'react', 'react/jsx-runtime'],
  jsx: 'automatic',
  plugins: [{ name: 'ignore-answer-css', setup(buildApi) {
    buildApi.onResolve({ filter: /expert-answer\.css$/ }, () => ({ path: emptyCss }));
  } }],
});
const { default: ExpertAnswer } = await import(pathToFileURL(bundle).href);
const answerMath = readFileSync(join(root, 'src/studio/answerMath.ts'), 'utf8');
assert.match(answerMath, /export function splitAnswerInline/);

const html = renderToStaticMarkup(createElement(ExpertAnswer, {
  text: 'Use **bold** and `x < y` safely. Literal <img src=x onerror=alert(1)> and <script>alert(1)</script>.\\[x=**not prose**\\] tail **unfinished',
}));
assert.match(html, /<strong>bold<\/strong>/);
assert.match(html, /<code class="expert-answer__code">x &lt; y<\/code>/);
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(html, /\\\[x=\*\*not prose\*\*\\\]/);
assert.match(html, /\*\*unfinished/);
assert.ok(!html.includes('<img'));
assert.ok(!html.includes('<script'));

const escaped = renderToStaticMarkup(createElement(ExpertAnswer, {
  text: String.raw`Escaped \*\*markers\*\* and \`literal\` stay plain.`,
}));
assert.match(escaped, /Escaped \\\*\\\*markers\\\*\\\* and \\`literal\\` stay plain\./);
assert.ok(!escaped.includes('<strong>'));
assert.ok(!escaped.includes('<code'));

const malformed = renderToStaticMarkup(createElement(ExpertAnswer, {
  text: 'bad **bold `code` then `unclosed',
}));
assert.match(malformed, /bad \*\*bold/);
assert.match(malformed, /<code class="expert-answer__code">code<\/code>/);
assert.match(malformed, /then `unclosed/);

console.log('expert answer inline: 4 component controls passed; no provider or browser calls');
