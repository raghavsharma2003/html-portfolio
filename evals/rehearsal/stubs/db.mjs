// WS-R94. The db seam every redirected `api/*.js` module resolves `./_db.js`
// to (see `../loader.mjs`). Deliberately NOT a fake in its own right: it
// holds no SQL patterns of its own, only a mutable box the harness fills
// with `evals/room-doors/fixtures.mjs`'s real `doorsDb(state)` before the
// server starts accepting requests. This is what makes the redirect a pure
// injection point rather than a second, hand-rolled database — the same
// discipline `evals/agent-room/loader.mjs`/`evals/recallbench/loader.mjs`
// already established for this repo's other module-boundary mocks.
let current = null;

/** Called once by `harness.mjs` before `listen()`. */
export function setFixtureDb(fn) {
  if (typeof fn !== "function") throw new Error("setFixtureDb: fn required");
  current = fn;
}

/** Same signature as the real `api/_db.js#q` — `(query, params, timeoutMs)`
 *  returning rows — so every caller (room-surface, teachersheet, rate-limit,
 *  incidents, ...) is byte-identical to production on this one seam. */
export async function q(query, params = [], timeoutMs = 10_000) {
  void timeoutMs;
  if (!current) throw new Error("rehearsal fixture db not configured — setFixtureDb() was never called");
  return current(query, params);
}
