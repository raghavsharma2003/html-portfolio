// Replay retained synthetic Azure outputs through the actual generated engine.
// No model calls. This repairs separator fragments, not the four-bubble cap.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as engine from '../api/_engine.gen.js';
import { gateReply, honestyContextFor } from '../api/_surface.js';

const rawBaseline = "r83 ka ek session 23 minute ka hota hai  \nisme pehle 19 minute exercise solve karne hain  \nphir 4 minute apne answers check karne ke hain  \nis sequence ko follow karo  \n\n---\n\nab jo wo exercise h jisko dobara dekhna hai, uske upar 'birch-28' label lagana hai  \nmatlab wo exercise abhi review hone wali hai, complete nahi hai  ";
const rawPolicy = "r83 me do phase hote hain ek toh 19 minutes ke practice question solve karne ke liye  \n\n----\n\nfir 4 minutes hote hain apne likhe answers ko check karne ke liye  \n\n----\n\njo exercise abhi review ki demand karti h, uske liye label hai birch-28  — matlab usme abhi bhi dekhna baki hai, complete hone ka matlab sahi hona nahi hota  \n\n----\n\nachha, tumne kis exercise pe abhi tak kaam kiya h?";
let checks = 0;
const check = (name, fn) => { fn(); console.log(`ok ${++checks} - ${name}`); };
const bubbles = text => engine.parseBubbles(text).bubbles;

// Mutate the actual generated runtime, not a parallel parser. Restoring the
// former regex must reproduce the observed ghost bubbles and missing label.
const runtime = readFileSync(new URL('../api/_engine.gen.js', import.meta.url), 'utf8');
const current = String.raw`/\n?-{3,}\n?|\n+/`;
const previous = String.raw`/\n?---\n?|\n+/`;
assert.equal(runtime.split(current).length, 2, 'one actual separator expression');
const mutantPath = join(mkdtempSync(join(tmpdir(), 'separator-regression-')), 'old-runtime.mjs');
writeFileSync(mutantPath, runtime.replace(current, previous));
const old = await import(pathToFileURL(mutantPath).href);

check('three or more hyphens are completely consumed without phantom bubbles', () => {
  for (const length of [3, 4, 5, 6, 7, 20, 101]) {
    for (const separator of ['-'.repeat(length), `\n${'-'.repeat(length)}\n`, `\r\n${'-'.repeat(length)}\r\n`]) {
      assert.deepEqual(bubbles(`first${separator}second`), ['first', 'second']);
    }
  }
});
check('clean text, triple separators and one/two hyphens preserve previous parser output', () => {
  for (const text of ['hello', 'first\nsecond', 'first---second', 'first\n---\nsecond',
    'PINE-63 and BIRCH-28', 'call 1800-599-0019 pe', 'e-mail', 'x-y', 'first--second', '-']) {
    assert.deepEqual(engine.parseBubbles(text), old.parseBubbles(text));
  }
});
check('protocol extraction remains ahead of presentation splitting', () => {
  const result = engine.parseBubbles('[tone: calm]first\n----\nsecond');
  assert.equal(result.tone, 'calm');
  assert.deepEqual(result.bubbles, ['first', 'second']);
});
check('existing four-bubble ceiling remains unchanged', () => {
  assert.deepEqual(bubbles('one\ntwo\nthree\nfour\nfive'), ['one', 'two', 'three', 'four']);
});
check('retained policy raw now keeps both timing parts and BIRCH-28 without ghost separators', () => {
  const result = bubbles(rawPolicy);
  assert.equal(result.length, 4);
  assert.ok(result[0].includes('19 minutes'));
  assert.ok(result[1].includes('4 minutes'));
  assert.ok(result[2].includes('birch-28') && result[2].includes('complete hone ka matlab sahi hona nahi hota'));
  assert.ok(!result.some(x => /^-+$/.test(x)));
});
check('actual old-runtime negative control reproduces two ghost bubbles and lost BIRCH-28', () => {
  const result = old.parseBubbles(rawPolicy).bubbles;
  assert.deepEqual(result.filter(x => x === '-'), ['-', '-']);
  assert.ok(!result.join('\n').includes('birch-28'));
});
check('retained baseline still loses its later label under the unchanged cap', () => {
  const result = bubbles(rawBaseline);
  assert.deepEqual(result, old.parseBubbles(rawBaseline).bubbles);
  assert.equal(result.length, 4);
  assert.ok(!result.join('\n').includes('birch-28'));
});
check('actual shared output gate preserves recovered label and timing through dash cleanup', () => {
  const context = honestyContextFor(engine, { core: '', tail: '' }, [{ role: 'user', content: 'Walk me through R83 and the label for an exercise needing review.' }]);
  const result = gateReply(engine, rawPolicy, context, 'separator-replay');
  assert.ok(result.gated && result.text.includes('birch-28'));
  assert.ok(result.text.includes('19 minutes') && result.text.includes('4 minutes'));
  assert.ok(!result.text.split('\n').some(x => /^-+$/.test(x)));
  assert.equal(result.findings.length, 0);
});
console.log(`separator runs: ${checks} checks passed; policy label recovered; baseline label still omitted by existing four-bubble cap; no model execution`);
