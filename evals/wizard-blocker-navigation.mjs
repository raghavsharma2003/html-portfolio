import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
const source = readFileSync(new URL("../src/creatorStudio/useWizardBlockerNavigation.ts", import.meta.url), "utf8");
function harness(input = source) {
  const refs = [], effects = [], jumps = [], observers = [], timers = new Map(), listeners = new Map();
  const body = {}, document = { body, activeElement: body, querySelector: () => null };
  let cursor = 0, nextStep, callback, state = ["owner-replica", "owner-token", "deploy"];
  class Observer {
    constructor(callback) { this.callback = callback; this.live = false; observers.push(this); }
    observe() { this.live = true; } disconnect() { this.live = false; }
  }
  const react = {
    useRef(value) { const i = cursor++; return refs[i] ??= { current: value }; },
    useCallback(fn) { return fn; },
    useEffect(fn, deps) { const i = cursor++, old = effects[i]; if (!old || deps.some((value, j) => value !== old.deps[j])) { old?.cleanup?.(); effects[i] = { deps, fn, needsRun: true }; } },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(input, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText, {
    exports, document, MutationObserver: Observer,
    window: { setTimeout(fn, duration) { assert.equal(duration, 3000); const id = timers.size + 1; timers.set(id, fn); return id; }, clearTimeout: id => timers.delete(id),
      addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: type => listeners.delete(type) },
    require: name => name === "react" ? react : { jumpTo: (...args) => jumps.push(args) },
  });
  function render(values = state) { state = values; cursor = 0; callback = exports.useWizardBlockerNavigation(...state, step => { nextStep = step; });
    for (const effect of effects.filter(Boolean)) if (effect.needsRun) { effect.needsRun = false; effect.cleanup = effect.fn(); } return callback; }
  render();
  const row = { anchor: "#identity-proofing", label: "Identity", step: "meet" };
  return { jumps, timers, listeners, document, row, render,
    begin() { callback(row); assert.equal(nextStep, "meet"); render([state[0], state[1], "meet"]); },
    mount() { document.querySelector = () => ({ isConnected: true }); for (const observer of observers) if (observer.live) observer.callback(); },
    unmount() { for (const effect of effects.filter(Boolean)) effect.cleanup?.(); },
  };
}
let count = 0; function check(name, fn) { fn(); console.log(`ok ${++count} - ${name}`); }
check("actual hook waits for target mount, then jumps once and clears wait", () => { const h = harness(); h.begin(); assert.equal(h.jumps.length, 0); h.mount(); h.mount(); assert.equal(h.jumps.length, 1); assert.equal(h.timers.size, 0); });
check("replica switch cancels pending focus", () => { const h = harness(); h.begin(); h.render(["different-replica", "owner-token", "meet"]); h.mount(); assert.equal(h.jumps.length, 0); });
check("token switch cancels pending focus", () => { const h = harness(); h.begin(); h.render(["owner-replica", "new-token", "meet"]); h.mount(); assert.equal(h.jumps.length, 0); });
check("later step navigation cancels pending focus", () => { const h = harness(); h.begin(); h.render(["owner-replica", "owner-token", "feed"]); h.mount(); assert.equal(h.jumps.length, 0); });
check("pointer and keyboard interaction cancel pending focus", () => { for (const type of ["pointerdown", "keydown"]) { const h = harness(); h.begin(); h.listeners.get(type)(); h.mount(); assert.equal(h.jumps.length, 0); } });
check("programmatic focus elsewhere is not stolen", () => { const h = harness(); h.begin(); h.document.activeElement = {}; h.mount(); assert.equal(h.jumps.length, 0); });
check("unmount and bounded timeout release the observer without jumping", () => { for (const finish of [h => h.unmount(), h => [...h.timers.values()][0]()]) { const h = harness(); h.begin(); finish(h); h.mount(); assert.equal(h.jumps.length, 0); assert.equal(h.timers.size, 0); } });
check("same-step explicit action uses existing jump immediately", () => { const h = harness(); const go = h.render(["owner-replica", "owner-token", "meet"]); go(h.row); assert.equal(h.jumps.length, 1); });
check("negative control without mount observation cannot complete lazy handoff", () => { const mutant = source.replace('observer.observe(document.body, { subtree: true, childList: true });', '/* removed target observation */'); assert.notEqual(mutant, source); const h = harness(mutant); h.begin(); h.mount(); assert.throws(() => assert.equal(h.jumps.length, 1), assert.AssertionError); });
console.log(`${count} actual hook timing/scope groups passed; synthetic DOM only.`);
