import assert from 'node:assert/strict';
import { IncomingMessage } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHistoricalMessageSignalFixture } from './signal-fixture.mjs';

// IncomingMessage instances have no socket and never bind or connect. These
// controls validate the fixture, not real HTTP delivery or adapter acceptance.
export function verifySignalFixtureControls() {
  let checks = 0;
  const test = (name, action) => { action(); checks++; console.log(`ok signal fixture ${checks} ${name}`); };
  test('runtimes without a native getter receive a stable historical close signal', () => {
    const req = new IncomingMessage(null), fixture = createHistoricalMessageSignalFixture(() => undefined);
    const state = fixture(req);
    assert.equal(fixture(req), state);
    assert.equal(state.signal.aborted, false);
    req.emit('close');
    assert.equal(state.signal.aborted, true);
  });
  test('complete-body close retains a live modern native signal and injects historical abort', () => {
    const req = new IncomingMessage(null), native = new AbortController();
    const fixture = createHistoricalMessageSignalFixture(() => native.signal), state = fixture(req);
    const oldConditionalFixture = AbortSignal.any([native.signal, new AbortController().signal]);
    req.complete = true;
    req.emit('close');
    assert.equal(state.nativeSignal, native.signal);
    assert.equal(native.signal.aborted, false);
    assert.equal(state.legacyCloseController.signal.aborted, true);
    assert.equal(state.signal.aborted, true);
    assert.equal(AbortSignal.any([state.signal, new AbortController().signal]).aborted, true,
      'the old unconditional adapter composition still fails on historical normal-close behavior');
    assert.throws(() => assert.equal(oldConditionalFixture.aborted, true),
      'the prior fixture skipped historical close whenever a modern native signal existed');
  });
  test('real native cancellation reaches the combined signal with its exact reason', () => {
    const req = new IncomingMessage(null), native = new AbortController();
    const state = createHistoricalMessageSignalFixture(() => native.signal)(req);
    const reason = new Error('synthetic_native_disconnect');
    native.abort(reason);
    assert.equal(req.complete, false);
    assert.equal(state.legacyCloseController.signal.aborted, false);
    assert.equal(state.signal.aborted, true);
    assert.equal(state.signal.reason, reason);
  });
  test('already-aborted native signals remain aborted without waiting for close', () => {
    const req = new IncomingMessage(null), native = new AbortController();
    const reason = new Error('synthetic_earlier_native_abort');
    native.abort(reason);
    const state = createHistoricalMessageSignalFixture(() => native.signal)(req);
    assert.equal(state.signal.aborted, true);
    assert.equal(state.signal.reason, reason);
  });
  test('a message destroyed before first access preserves historical close behavior', () => {
    for (const nativeSignal of [undefined, new AbortController().signal]) {
      const req = new IncomingMessage(null);
      req.complete = true;
      req.destroyed = true;
      const state = createHistoricalMessageSignalFixture(() => nativeSignal)(req);
      assert.equal(state.signal.aborted, true);
      assert.equal(nativeSignal?.aborted ?? false, false);
    }
  });
  test('incomplete close still cancels and only one native read and listener are installed', () => {
    const req = new IncomingMessage(null), native = new AbortController();
    let reads = 0;
    const fixture = createHistoricalMessageSignalFixture(() => { reads++; return native.signal; });
    const first = fixture(req);
    assert.equal(fixture(req).signal, first.signal);
    assert.equal(reads, 1);
    assert.equal(req.listenerCount('close'), 1);
    req.emit('close');
    assert.equal(req.complete, false);
    assert.equal(first.signal.aborted, true);
  });
  return checks;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  console.log(`signal fixture: ${verifySignalFixtureControls()} groups passed; no sockets or servers`);
}
