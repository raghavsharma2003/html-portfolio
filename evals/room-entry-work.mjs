// Execute the real Room component with a native-format spy. This proves work
// removal and byte-identical markup, not a simulated browser timing claim.
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import { build } from "vite";

const root = new URL("..", import.meta.url);
const componentUrl = new URL("src/room/RoomApp.tsx", root);
const source = readFileSync(componentUrl, "utf8");
const dateBlock = source.match(/  const settingsReminderDate = useMemo\(\(\) =>[\s\S]*?\[phase, settingsReminderDue, settingsBaseline, locale\]\);/)?.[0];
assert.ok(dateBlock, "actual deferred date block exists");
// Recreate the original expensive placement in the actual component.
const anchor = "  // WS-R59: the install card's own derived state";
assert.equal(source.split(anchor).length, 2);
const mutant = source.replace(dateBlock, "").replace(anchor,
  dateBlock.replace('useMemo(() => phase === "talking" && settingsReminderDue && settingsBaseline', "settingsBaseline")
    .replace(', [phase, settingsReminderDue, settingsBaseline, locale])', '') + "\n" + anchor);
const temporary = mkdtempSync(join(tmpdir(), "room-entry-work-"));
const require = createRequire(import.meta.url);
let checks = 0;
function check(name, fn) { fn(); console.log(`ok ${++checks} - ${name}`); }

async function compile(componentSource, label) {
  const entry = join(fileURLToPath(root), "__room_entry_work__.tsx");
  const contents = `import React from 'react';
    import {renderToStaticMarkup} from 'react-dom/server';
    import RoomApp from './src/room/RoomApp';
    import {loadRoomCopy} from './src/room/copy';
    export async function render(props) {
      await loadRoomCopy(props.fixtureOpen.locale);
      return renderToStaticMarkup(React.createElement(RoomApp, props));
    }`;
  const result = await build({
    configFile: false, root: fileURLToPath(root), logLevel: "silent", ssr: { noExternal: true },
    build: { ssr: entry, write: false, minify: false,
      rolldownOptions: { output: { format: "cjs", codeSplitting: false } } },
    define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "actual-room-component",
      resolveId(id) { if (id === entry) return entry; },
      load(id) {
        if (id === entry) return contents;
        if (/[\\/]RoomApp\.tsx$/.test(id)) return componentSource;
      },
    }],
  });
  const file = join(temporary, `${label}.cjs`);
  const output = (Array.isArray(result) ? result[0] : result).output;
  const chunk = output.find(item => item.type === "chunk" && item.isEntry);
  assert.ok(chunk, "actual component bundle emitted");
  writeFileSync(file, chunk.code);
  return require(file).render;
}

try {
  const actual = await compile(source, "actual");
  const previous = await compile(mutant, "original-placement-mutant");
  const native = Date.prototype.toLocaleDateString;
  for (const locale of ["en", "hi"]) {
    for (const [phase, reviewed, expectedCalls] of [
      ["join", "2000-01-01T00:00:00Z", 0],
      ["talking", new Date().toISOString(), 0],
      ["talking", "2000-01-01T00:00:00Z", 1],
      ["loading", "2000-01-01T00:00:00Z", 0],
    ]) {
      const props = {
        fixtureOpen: {
          room: { slug: "fixture", name: "Fixture", display_name: "Fixture", taste_enabled: false, handoff_enabled: false },
          disclosure: "This is an AI replica.", locale, joined: phase === "talking", session: null, threads: [],
          follower: { tier: "free", remembers: false, joined_at: reviewed, settings_reviewed_at: reviewed },
        },
        fixturePhase: phase, fixtureTurns: [], fixtureTasteDismissed: true,
      };
      let calls = [];
      Date.prototype.toLocaleDateString = function (...args) { calls.push(args); return Reflect.apply(native, this, args); };
      let html, oldHtml, actualCalls, oldCalls;
      try {
        html = await actual(props); actualCalls = calls; calls = [];
        oldHtml = await previous(props); oldCalls = calls;
      } finally { Date.prototype.toLocaleDateString = native; }
      check(`${locale} ${phase} ${expectedCalls ? "due" : "unused"}: real render only formats a visible reminder`, () => {
        assert.equal(actualCalls.length, expectedCalls);
        assert.equal(oldCalls.length, 1, "original placement really performs the unnecessary native call");
        assert.equal(html, oldHtml, "all rendered markup stays byte-identical");
        if (expectedCalls) assert.equal(actualCalls[0][0], locale === "hi" ? "hi-IN" : "en-IN");
        else assert.throws(() => assert.equal(oldCalls.length, expectedCalls), assert.AssertionError);
      });
    }
  }
  // Execute the actual hook call with React's dependency-equality contract.
  // This checks the callback/dependency wiring; SSR above checks real markup.
  let nativeCalls = 0;
  let previousDeps;
  let memoized;
  const state = {
    phase: "join", settingsReminderDue: true, settingsBaseline: "2000-01-01T00:00:00Z", locale: "hi",
    Date: class extends Date {
      toLocaleDateString(...args) { nativeCalls++; return super.toLocaleDateString(...args); }
    },
    useMemo(fn, deps) {
      if (!previousDeps || deps.some((value, index) => !Object.is(value, previousDeps[index]))) {
        memoized = fn(); previousDeps = [...deps];
      }
      return memoized;
    },
  };
  const renderDate = () => runInNewContext(`(() => { ${dateBlock} return settingsReminderDate; })()`, state);
  renderDate();
  check("actual memo callback skips join even with an overdue follower date", () => assert.equal(nativeCalls, 0));
  state.phase = "talking";
  const first = renderDate();
  for (let i = 0; i < 5; i++) assert.equal(renderDate(), first);
  check("actual memo dependencies reuse the due date across unrelated rerenders", () => assert.equal(nativeCalls, 1));
  state.locale = "en"; renderDate();
  state.settingsBaseline = "2001-01-01T00:00:00Z"; renderDate();
  check("locale and baseline changes invalidate the formatted date", () => assert.equal(nativeCalls, 3));
  state.settingsReminderDue = false;
  check("reviewed reminder clears without another native format", () => {
    assert.equal(renderDate(), ""); assert.equal(nativeCalls, 3);
  });
} finally {
  assert.equal(dirname(resolve(temporary)), resolve(tmpdir()));
  assert.ok(basename(temporary).startsWith("room-entry-work-"));
  rmSync(temporary, { recursive: true, force: true });
}
console.log(`${checks} Room render and memo-wiring checks passed; no browser timing claim.`);
