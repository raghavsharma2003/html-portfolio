import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { instrumentReadiness, installReadinessProbe, focusWhenReadinessIdle } from './readiness-probe.mjs';

const studio = readFileSync(new URL('../../src/studio/StudioApp.tsx', import.meta.url), 'utf8');
function effectFrom(source) {
  const tree = ts.createSourceFile('StudioApp.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let effect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useEffect'
      && node.arguments[1]?.getText(tree) === '[activityKey, handleApiError, readinessPending, refreshForRequest, selectedId, session]') effect = node.arguments[0].getText(tree);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  assert(effect);
  return effect;
}
function sandbox() {
  const dispatches = [], scope = {
    Date: { now: () => 123 }, Event: class Event { constructor(type) { this.type = type; } },
    document: { visibilityState: 'visible' }, window: { dispatchEvent: event => dispatches.push(event.type) },
  };
  runInNewContext(`(${installReadinessProbe})(); globalThis.focusWhenIdle = (${focusWhenReadinessIdle});`, scope);
  return { scope, probe: scope.__readinessProbe, dispatches };
}
const json = value => JSON.parse(JSON.stringify(value));

export async function runReadinessProbeControls() {
  let checks = 0;
  const check = async (name, fn) => { await fn(); checks++; console.log(`PASS readiness observer ${name}`); };
  await check('five unique insertions leave all production request/guard/state bytes intact', () => {
    const instrumented = instrumentReadiness(studio);
    assert.equal(instrumented.split('/* refresh-eval-observer */').length - 1, 5);
    for (const expression of ['await refreshForRequest(session)', 'listSources(fresh.accessToken, selectedId)', 'readRuntimeStatus(fresh.accessToken, selectedId)', 'readReplica(fresh.accessToken, selectedId)', 'if (polling) return;', 'if (!live) return;', 'window.removeEventListener("focus", resume);']) {
      assert.equal(effectFrom(instrumented).split(expression).length, effectFrom(studio).split(expression).length);
    }
  });
  await check('absent or duplicate exact effect fails rather than instrumenting a neighbour', () => {
    assert.throws(() => instrumentReadiness(studio.replace('[activityKey, handleApiError, readinessPending, refreshForRequest, selectedId, session]', '[]')), /one exact/);
    assert.throws(() => instrumentReadiness(studio + `\nuseEffect(${effectFrom(studio)}, [activityKey, handleApiError, readinessPending, refreshForRequest, selectedId, session]);`), /one exact/);
  });
  await check('missing and duplicate lifecycle anchors fail closed', () => {
    for (const [before, after] of [['window.addEventListener("focus", resume);', 'window.addEventListener("focus", other);'], ['polling = true;', 'polling = true; polling = true;'], ['        polling = false;', '        polling = Boolean(0);']]) {
      assert.throws(() => instrumentReadiness(studio.replace(before, after)), /one readiness target/);
    }
  });
  await check('missing effect cannot dispatch or advance the clock', () => {
    const { scope, dispatches } = sandbox();
    assert.equal(scope.focusWhenIdle('selected'), false); assert.deepEqual(dispatches, []); assert.equal(scope.Date.now(), 123);
  });
  await check('busy, unregistered, disposed, wrong-scope, no-readiness and hidden states cannot dispatch', () => {
    for (const state of ['busy', 'unregistered', 'disposed', 'wrong-scope', 'no-readiness', 'hidden']) {
      const { scope, probe, dispatches } = sandbox(), id = probe.begin('selected', state !== 'no-readiness', 'owner', 'old');
      if (state !== 'unregistered') probe.registered(id);
      if (state === 'busy') probe.polling(id, true);
      if (state === 'disposed') probe.disposed(id);
      if (state === 'hidden') scope.document.visibilityState = 'hidden';
      assert.equal(scope.focusWhenIdle(state === 'wrong-scope' ? 'url-only-scope' : 'selected'), false, state);
      assert.deepEqual(dispatches, [], state); assert.equal(scope.Date.now(), 123, state);
    }
  });
  await check('idle observation and one focus are atomic and cannot repeat', () => {
    const { scope, probe, dispatches } = sandbox(), id = probe.begin('selected', true, 'owner', 'old');
    probe.registered(id); assert.equal(scope.focusWhenIdle('selected'), true);
    assert.deepEqual(dispatches, ['focus']); assert.equal(scope.Date.now(), 3600123);
    assert.equal(scope.__readinessFocus.effect.id, id);
    assert.throws(() => scope.focusWhenIdle('selected'), /duplicate_readiness_focus/);
    assert.deepEqual(dispatches, ['focus']); assert.equal(scope.Date.now(), 3600123);
  });
  await check('disposed effect finally cannot mark its live successor idle', () => {
    const { scope, probe, dispatches } = sandbox(), old = probe.begin('old', true, 'owner', 'old');
    probe.polling(old, true); probe.registered(old); probe.disposed(old);
    const current = probe.begin('selected', true, 'owner', 'fresh'); probe.polling(current, true); probe.registered(current);
    probe.polling(old, false);
    assert.equal(probe.current().id, current); assert.equal(probe.current().polling, true); assert.equal(probe.current().account, 'owner'); assert.equal(probe.current().token, 'fresh');
    assert.equal(scope.focusWhenIdle('selected'), false); assert.deepEqual(dispatches, []);
    probe.polling(current, false); assert.equal(scope.focusWhenIdle('selected'), true);
    assert.deepEqual(dispatches, ['focus']);
  });
  await check('observed copies cannot forge readiness or rewrite prior events', () => {
    const { scope, probe } = sandbox(), id = probe.begin('selected', true, 'owner', 'old'); probe.polling(id, true); probe.registered(id);
    probe.current().polling = false; probe.events()[0].event = 'forged';
    assert.equal(probe.current().polling, true); assert.equal(probe.events()[0].event, 'begin'); assert.equal(scope.focusWhenIdle('selected'), false);
  });
  // Execute the actual extracted readiness callback under controlled promises.
  // Its original polling guard must drop a focus while its automatic request is
  // held; observing idle must then permit exactly one new real callback entry.
  async function actualEffect(observe) {
    const { scope, probe } = sandbox(), trace = [], listeners = new Map();
    let release, began, settled;
    const held = new Promise(resolve => { release = resolve; });
    const started = new Promise(resolve => { began = resolve; });
    const finished = new Promise(resolve => { settled = resolve; });
    let rounds = 0;
    Object.assign(scope, {
      session: { userId: 'owner', accessToken: 'old' }, selectedId: 'selected', activityKey: '', readinessPending: true, IDLE_RECONCILE_MS: 60000,
      refreshForRequest: async session => { trace.push('auth'); return session; },
      listSources: () => { trace.push('sources'); return held.then(() => []); },
      readRuntimeStatus: () => { trace.push('runtime'); return held.then(() => null); },
      readReplica: () => { trace.push('replica'); began(); return held.then(() => ({ replica_id: 'selected' })); },
      setSources: () => trace.push('set-sources'), setRuntimeStatus: () => trace.push('set-runtime'),
      setSelected: () => trace.push('set-selected'), setReplicas: () => trace.push('set-replicas'),
      handleApiError: () => { throw Error('unexpected_auth_error'); }, ReplicaApiError: Error, isStudioAuthDead: () => false,
    });
    Object.assign(scope.window, {
      addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); },
      clearTimeout: () => {}, setTimeout: () => { rounds++; settled(); return rounds; },
      dispatchEvent: event => { trace.push('focus'); listeners.get(event.type)?.(); },
    });
    Object.assign(scope.document, { addEventListener: () => {}, removeEventListener: () => {} });
    const callback = effectFrom(observe ? instrumentReadiness(studio) : studio);
    runInNewContext(ts.transpileModule(`globalThis.start = ${callback};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, scope);
    const cleanup = scope.start(); await started;
    if (observe) assert.equal(probe.current().polling, true);
    scope.window.dispatchEvent(new scope.Event('focus'));
    assert.equal(trace.filter(event => event === 'auth').length, 1, 'old unobserved focus is ignored by actual polling guard');
    release(); await finished;
    if (observe) { assert.equal(probe.current().polling, false); assert.equal(scope.focusWhenIdle('selected'), true); }
    else scope.window.dispatchEvent(new scope.Event('focus'));
    // Await the controlled second read by its actual schedule completion.
    const secondFinished = new Promise(resolve => { settled = resolve; }); await secondFinished;
    cleanup(); assert.equal(listeners.has('focus'), false);
    return { trace, state: observe ? json(probe.current()) : null };
  }
  await check('actual polling guard reproduces ignored premature focus; observed idle enables one later refresh', async () => {
    const original = await actualEffect(false), observed = await actualEffect(true);
    assert.deepEqual(observed.trace, original.trace, 'instrumentation preserves actual requests, state writes and cleanup order');
    assert.equal(observed.trace.filter(event => event === 'auth').length, 2);
    assert.equal(observed.state.live, false); assert.equal(observed.state.registered, false);
  });
  await check('safe source/build exits precede hosted-only HTTP/browser imports; mounted contract remains intact', () => {
    const source = readFileSync(new URL('./refresh.mjs', import.meta.url), 'utf8');
    const sourceExit = source.indexOf("if(process.argv.includes('--source-only'))"), buildExit = source.indexOf("if(process.argv.includes('--build-only'))");
    assert(sourceExit > 0 && buildExit > sourceExit);
    for (const dependency of ['node:http', 'playwright']) {
      assert(!new RegExp(`^import .*from ['"]${dependency}['"]`, 'm').test(source));
      assert(source.indexOf(`await import('${dependency}')`) > buildExit);
    }
    assert(source.indexOf("process.env.GITHUB_ACTIONS!=='true'") > buildExit);
    assert.match(source, /for\(const width of \[390,1440\]\)for\(const method of \['create','list','select'\]\)for\(const variant of \['old','current'\]\)/);
    assert.match(source, /for\(const outcome of \['success','error'\]\)/);
    assert.match(source, /await waitFor\('operation request queued'/);
    assert.match(source, /await page\.waitForFunction\(focusWhenReadinessIdle,scope,\{timeout:10000\}\)/);
    assert.match(source, /await waitFor\('refresh request queued'/);
    assert.match(source, /await backgroundRefresh\(method==='list'\?OTHER:RID\)/);
    assert.match(source, /old creating flag remains set after promise settlement/);
    assert.match(source, /name:'Try again',exact:true/);
    for (const forbidden of ["count('/api/replica-consent','grant'),0", "count('/api/replica-text-rehearsal','ask'),0", "count('/api/account','logout'),0"]) assert(source.includes(forbidden));
  });
  return checks;
}
