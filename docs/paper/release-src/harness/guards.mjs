// harness/guards.mjs — the validity guards, and the reason this suite exists.
//
// A qualification harness that cannot REFUSE TO ISSUE A NUMBER is not a
// protocol, it is a formatter. Each guard below was added after a real run in
// which its absence produced a confident, wrong number:
//
//   1. TRANSPORT MISSES vs PARSE MISSES are different failures and are counted
//      separately. An API key hit a configured spend limit mid-run and every
//      subsequent call 403'd; the surviving subset scored 100%. That subset was
//      selected by which calls beat the limit — a biased denominator, not a
//      sample. A naive classifier would have called those "misses" and moved on.
//
//   2. SELF-INVALIDATION above a 5% transport-error rate. Deliberately tight:
//      an archive of 96 units per judge is small enough that even a few
//      selected-out rows change who got scored.
//
//   3. SELF-INVALIDATION above a 50% parse-miss rate. Added after a judge wrote
//      prose on the majority of calls despite an only-JSON contract, and again
//      when a reasoning model spent its whole token cap on hidden reasoning and
//      returned empty completions on 128 of 192 calls. In both cases the
//      minority that parsed would have scored beautifully.
//
// The two most flattering numbers this programme ever measured were both
// refused by these guards. That is what they are for.

export const TRANSPORT_MISS_LIMIT = 0.05;
export const PARSE_MISS_LIMIT = 0.50;

/** A harness miss is tagged at the call site with one of these prefixes.
 *  Keep them: the kind is not recoverable after the fact, as one of this
 *  programme's own runs discovered when the same 403 produced `error:` bodies
 *  from one model and empty bodies (`unparseable:`) from another. */
export const MISS_TRANSPORT = "error:";
export const MISS_PARSE = "unparseable:";

export const missKind = (m) =>
  typeof m !== "string" ? null
    : m.startsWith(MISS_TRANSPORT) ? "transport"
      : m.startsWith(MISS_PARSE) ? "parse"
        : "unclassified";

export function countMisses(rows) {
  let transport = 0, parse = 0, unclassified = 0;
  for (const r of rows) {
    const k = missKind(r.harnessMiss);
    if (k === "transport") transport++;
    else if (k === "parse") parse++;
    else if (k === "unclassified") unclassified++;
  }
  return { transport, parse, unclassified, total: transport + parse + unclassified };
}

/** The verdict rule. Order matters: a crippled run never gets a statistical
 *  verdict, however good the surviving subset looks.
 *
 *  `ci` is a two-sided interval on the agreement rate; `bar` is the
 *  pre-registered threshold. A PASS requires the LOWER bound to reach the bar —
 *  a point estimate above it with a straddling interval is UNDERPOWERED, not a
 *  pass. */
export function runVerdict({ ci, bar, rowsCalled, transportMisses, parseMisses }) {
  if (rowsCalled > 0 && transportMisses > TRANSPORT_MISS_LIMIT * rowsCalled) {
    return { verdict: "INVALID-RUN (transport)", scorable: false,
      why: `${transportMisses}/${rowsCalled} rows failed in transport (> ${TRANSPORT_MISS_LIMIT * 100}%). The scored subset was selected by which calls succeeded, not by the protocol.` };
  }
  if (rowsCalled > 0 && parseMisses > PARSE_MISS_LIMIT * rowsCalled) {
    return { verdict: "INVALID-RUN (parse)", scorable: false,
      why: `${parseMisses}/${rowsCalled} replies did not carry a parseable verdict (> ${PARSE_MISS_LIMIT * 100}%). Following the output contract is part of the job; scoring the minority that parsed is the same biased denominator in a different costume.` };
  }
  if (ci.lo == null) return { verdict: "NO DATA", scorable: false, why: "no units scored" };
  if (ci.lo >= bar) return { verdict: "PASS", scorable: true, why: `95% lower bound ${(ci.lo * 100).toFixed(1)}% reaches the ${(bar * 100).toFixed(0)}% bar` };
  if (ci.hi < bar) return { verdict: "FAIL", scorable: true, why: `95% upper bound ${(ci.hi * 100).toFixed(1)}% lies below the ${(bar * 100).toFixed(0)}% bar` };
  return { verdict: "UNDERPOWERED", scorable: true, why: `interval straddles the bar; a point estimate above it is not a pass` };
}

/** Wilson score interval — better behaved than the normal approximation at p
 *  near 0 or 1 and at modest n, which is this regime. No dependency. */
export function wilsonCI(successes, n, z = 1.959963984540054) {
  if (!n) return { point: null, lo: null, hi: null };
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const s = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return { point: p, lo: (c - s) / d, hi: (c + s) / d };
}
