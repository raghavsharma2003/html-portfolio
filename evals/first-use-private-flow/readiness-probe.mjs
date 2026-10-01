import assert from 'node:assert/strict';
import ts from 'typescript';

// Fixture instrumentation only: observe the real effect without replacing a
// request, guard, callback, await, or state update. The inserted statements can
// be removed byte-for-byte to recover the input, including the old controls.
export function instrumentReadiness(source) {
  const tree = ts.createSourceFile('StudioApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const dependencies = '[activityKey, handleApiError, readinessPending, refreshForRequest, selectedId, session]';
  const effects = [];
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[1]?.getText(tree) === dependencies) effects.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert.equal(effects.length, 1, 'one exact Studio readiness effect');
  const effect = effects[0].arguments[0];
  assert(ts.isArrowFunction(effect) && ts.isBlock(effect.body), 'readiness effect block');
  const text = effect.body.getText(tree), offset = effect.body.getStart(tree), edits = [];
  const after = (needle, statement) => {
    const first = text.indexOf(needle);
    assert(first >= 0 && text.indexOf(needle, first + 1) < 0, `one readiness target: ${needle}`);
    edits.push({ at: offset + first + needle.length, inserted: `\n    /* refresh-eval-observer */ ${statement}` });
  };
  assert(text.includes('if (!session || !selectedId || (!activityKey && !readinessPending)) return;'));
  assert(text.includes('if (polling) return;'));
  assert(text.includes('if (!live || !readinessPending || document.visibilityState === "hidden") return;'));
  after('let polling = false;', 'const __refreshEvalEffect = globalThis.__readinessProbe.begin(selectedId, readinessPending, session.userId, session.accessToken);');
  after('polling = true;', 'globalThis.__readinessProbe.polling(__refreshEvalEffect, true);');
  after('        polling = false;', 'globalThis.__readinessProbe.polling(__refreshEvalEffect, false);');
  after('window.addEventListener("focus", resume);', 'globalThis.__readinessProbe.registered(__refreshEvalEffect);');
  after('live = false;', 'globalThis.__readinessProbe.disposed(__refreshEvalEffect);');
  let code = source;
  for (const edit of edits.sort((a, b) => b.at - a.at)) code = code.slice(0, edit.at) + edit.inserted + code.slice(edit.at);
  let recovered = code;
  for (const edit of edits) {
    assert.equal(recovered.split(edit.inserted).length, 2, 'unique observer insertion');
    recovered = recovered.replace(edit.inserted, '');
  }
  assert.equal(recovered, source, 'observer removal restores every original source byte');
  return code;
}

// Passed to Playwright addInitScript, so deliberately self-contained. No
// application data writes, auth calls, promises, timers, or event dispatches.
export function installReadinessProbe() {
  let sequence = 0;
  const effects = new Map(), events = [];
  const record = (id, event) => {
    const effect = effects.get(id);
    if (!effect) throw new Error('unknown_readiness_effect');
    events.push({ id, scope: effect.scope, event });
    return effect;
  };
  globalThis.__readinessProbe = Object.freeze({
    begin(scope, pending, account, token) {
      if (typeof scope !== 'string' || !scope || typeof pending !== 'boolean' || typeof account !== 'string' || !account || typeof token !== 'string' || !token) throw new Error('invalid_readiness_scope');
      const id = ++sequence;
      effects.set(id, { id, scope, pending, account, token, live: true, registered: false, polling: false });
      record(id, 'begin');
      return id;
    },
    polling(id, value) {
      if (typeof value !== 'boolean') throw new Error('invalid_readiness_poll');
      const effect = record(id, value ? 'poll-start' : 'poll-finish');
      if (effect.polling === value) throw new Error('invalid_readiness_poll_transition');
      effect.polling = value;
    },
    registered(id) {
      const effect = record(id, 'registered');
      if (!effect.live || effect.registered) throw new Error('invalid_readiness_registration');
      effect.registered = true;
    },
    disposed(id) {
      const effect = record(id, 'disposed');
      if (!effect.live) throw new Error('invalid_readiness_disposal');
      effect.live = false;
      effect.registered = false;
    },
    current() { const current = effects.get(sequence); return current ? { ...current } : null; },
    events() { return events.map(event => ({ ...event })); },
  });
}

// Called repeatedly only to observe readiness. Exactly one successful call
// dispatches one real focus; the HTTP assertion, not this observer, proves that
// actual refreshForRequest -> ensureStudioSession -> /api/account ran.
export function focusWhenReadinessIdle(scope) {
  const effect = globalThis.__readinessProbe.current();
  if (!effect || effect.scope !== scope || !effect.live || !effect.registered || !effect.pending || effect.polling || document.visibilityState === 'hidden') return false;
  if (globalThis.__readinessFocus) throw new Error('duplicate_readiness_focus');
  globalThis.__readinessFocus = { effect, before: globalThis.__readinessProbe.events() };
  const now = Date.now;
  Date.now = () => now() + 3600000;
  window.dispatchEvent(new Event('focus'));
  return true;
}
