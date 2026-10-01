// Synthetic fixture synchronization only. Arrival means the server has parsed
// and held the exact request, not that a click or busy-state render completed.
const KINDS = new Set(['publication-read', 'publication-post', 'draft-load']);

export function createHeldRequestBarrier({
  timeoutMs = 10_000,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let generation = 0, expected = null, held = null;
  const fail = reason => new Error(`publication_fixture_${reason}`);
  return {
    get generation() { return generation; },
    get size() { return held ? 1 : 0; },
    assertIdle() {
      if (expected || held) throw fail('unreleased_request');
    },
    expect(kind) {
      if (!KINDS.has(kind) || expected || held) throw fail('invalid_expectation');
      let resolve, reject;
      const arrived = new Promise((yes, no) => { resolve = yes; reject = no; });
      // An action can fail before its awaited arrival; retain the rejection
      // without an unrelated unhandled-rejection report during cleanup.
      void arrived.catch(() => {});
      const expectation = { kind, generation, resolve, reject, timer: null };
      expected = expectation;
      expectation.timer = schedule(() => {
        if (expected !== expectation) return;
        expected = null;
        reject(fail('held_request_timeout'));
      }, timeoutMs);
      return arrived;
    },
    hold(kind, requestGeneration, release) {
      if (!expected || held || expected.kind !== kind ||
          expected.generation !== requestGeneration || requestGeneration !== generation ||
          typeof release !== 'function') throw fail('unexpected_held_request');
      const expectation = expected;
      expected = null;
      held = Object.freeze({ kind, generation, release });
      cancel(expectation.timer);
      expectation.resolve(held);
    },
    release(request) {
      if (request !== held || !held || request.generation !== generation) throw fail('invalid_release');
      held = null;
      request.release();
    },
    reset() {
      if (expected) {
        cancel(expected.timer);
        expected.reject(fail('generation_reset'));
        expected = null;
      }
      if (held) {
        const request = held;
        held = null;
        request.release();
      }
      generation++;
    },
  };
}
