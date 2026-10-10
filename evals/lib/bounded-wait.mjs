// WS-R181. THE GATE HONEST UNDER LOAD -- shared primitives.
//
// Two waves of ten agents each ran ten full gates at once on this same
// four-core machine and every report carried the same paragraph: port
// collisions, TBT overages, click timeouts, "environmental, reran alone".
// Most of that is not a flaky suite -- it is a barrier TUNED on a quiet
// machine (12 to 30 seconds, one fixed port) meeting a machine that is not
// quiet, every single wave. This file is the fix, factored out once rather
// than patched per suite:
//
//   - boundedWaitMs(base): scales a fixed wait/timeout barrier by how loaded
//     the machine is right now, so a barrier tuned on a quiet dev machine
//     does not fire early just because nine sibling gates are also running.
//     Never returns less than `base` (a quiet machine gets exactly the old
//     behaviour) and never more than `base * MAX_MULTIPLIER` (a barrier
//     cannot grow without bound -- a suite that would genuinely never
//     resolve must still time out, not hang forever).
//   - listenWithPortWait(server, port, host, opts): a fixed-port suite waits
//     for the port to free, on a bounded backoff loop, before binding -- and
//     fails BY NAME, only once the wait itself has expired, rather than
//     crashing the process on Node's own uncaught EADDRINUSE the instant a
//     sibling gate holds the port for one poll interval.
//   - loadRatio()/loadCeilingResult(): the one-minute load average over the
//     core count, and the pass/fail read against a ceiling -- used by a
//     time-measuring check to REFUSE to judge (never silently pass, never
//     report a false regression) when the machine is too busy to measure
//     honestly.
//
// Every function here takes its `os.loadavg`/`os.cpus` (and, for the port
// waiter, its own clock) as optional injected dependencies -- the same shape
// `evals/suite-resources.mjs` already uses -- so evals/gate-load/run.mjs can
// prove the scaling and the ceiling refusal deterministically, at $0, with
// no real machine load and no real port required.
//
// See context/decisions.md#ws-r181-load-aware-barriers-and-a-load-ceiling
// and context/rejected.md's WS-R118/WS-R121/WS-R128/WS-R139/WS-R165/WS-R169
// entries this generalises -- every one of them independently rediscovered
// "this suite is fine, the machine was just busy" and threw the finding
// away instead of fixing the barrier.

import { loadavg as osLoadavg, cpus as osCpus } from "node:os";

/** A barrier can grow at most this many times its quiet-machine value. Six
 * was chosen as the smallest multiplier that kept the WS-R181 measurement's
 * own load-12 sample (ratio 3 on this four-core machine) well inside the cap
 * (see context/measurements.md#ws-r181-bounded-wait-scaling) with headroom
 * for a noisier machine, while still bounding a barrier that could otherwise
 * grow forever on a badly overloaded box. */
const MAX_MULTIPLIER = 6;

/** The absolute one-minute-load-average ceiling a time-measuring check
 * refuses to trust its own numbers above. Deliberately the SAME number
 * ws-common.md's own gate instructions already use for "the machine is
 * quiet enough to run the full gate" ("when the load average is under 8") --
 * one number two callers agree on, not two independently chosen ones that
 * could drift apart. */
export const DEFAULT_LOAD_CEILING = 8;

/** The one-minute load average, the core count, and their ratio -- the
 * natural unit for "is this box oversubscribed" (1.0 means as busy as the
 * box has cores). `cpus()` is floored at 1 so a single-core sandbox can
 * never divide by zero. */
export function loadRatio({ loadavg = osLoadavg, cpus = osCpus } = {}) {
  const load1 = loadavg()[0];
  const cores = Math.max(1, cpus().length);
  return { load1, cores, ratio: load1 / cores };
}

/**
 * Scales `base` (a barrier or timeout in ms tuned on a quiet machine) by how
 * loaded this machine is right now. Below ratio 1 the barrier is unchanged
 * (never less than `base`); above it, it grows linearly up to
 * `MAX_MULTIPLIER x base`.
 */
export function boundedWaitMs(base, opts = {}) {
  if (!Number.isFinite(base) || base <= 0) {
    throw new Error("boundedWaitMs: base must be a positive finite number of ms");
  }
  const { ratio } = loadRatio(opts);
  const multiplier = Math.min(MAX_MULTIPLIER, Math.max(1, ratio));
  return Math.round(base * multiplier);
}

/**
 * Reads the current load and reports whether a time-measuring check should
 * trust its own numbers. `exceeded: true` means "refuse to judge" -- never
 * "pass anyway", never "silently skip". Always returns the load it read,
 * whether or not the ceiling was exceeded, so the caller can record it in
 * its output unconditionally (law 4: "record it in their output").
 */
export function loadCeilingResult(ceiling = DEFAULT_LOAD_CEILING, opts = {}) {
  const { load1, cores, ratio } = loadRatio(opts);
  return { load1, cores, ratio, ceiling, exceeded: load1 > ceiling };
}

/**
 * Binds `server` to `port` on `host`, waiting for the port to free -- a
 * bounded backoff loop, not an instant crash -- rather than letting Node's
 * own uncaught `EADDRINUSE` kill the process the moment a sibling gate holds
 * the port for one poll interval. Retries every `intervalMs` until
 * `timeoutMs` elapses (default: `boundedWaitMs(15000, opts)`, so the wait
 * itself lengthens on a loaded machine exactly like every other barrier in
 * this file), then rejects with a NAMED error -- "port 8941 still in use
 * after waiting Nms" -- so a real collision reads as an understood,
 * named failure rather than a raw Node stack trace indistinguishable from a
 * real regression.
 *
 * The pool's own port lane (`runner-lib.mjs`'s `PORT_LANE_SUITES`) still
 * serialises these three suites against EACH OTHER within one process --
 * this function is the answer to the OTHER collision, a sibling worktree's
 * own separate `node` process holding the identical port at the same
 * instant, which no in-process lane can ever prevent.
 */
export async function listenWithPortWait(server, port, host = "127.0.0.1", opts = {}) {
  const { timeoutMs = boundedWaitMs(15000, opts), intervalMs = 500 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await new Promise((resolve, reject) => {
        const onError = (err) => {
          server.removeListener("listening", onListening);
          reject(err);
        };
        const onListening = () => {
          server.removeListener("error", onError);
          resolve();
        };
        server.once("error", onError);
        server.once("listening", onListening);
        server.listen(port, host);
      });
      return server;
    } catch (err) {
      if (err && err.code === "EADDRINUSE" && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }
      if (err && err.code === "EADDRINUSE") {
        throw new Error(
          `port ${port} still in use after waiting ${timeoutMs}ms for it to free (a sibling gate likely holds it)`,
        );
      }
      throw err;
    }
  }
}
