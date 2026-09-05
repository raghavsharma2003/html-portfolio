// WS-R96. A fixture server for `scripts/day-one.mjs`'s own offline proof.
// Wraps the REAL `evals/probe-live/fakeServer.mjs` fixture rather than
// re-implementing every static route it already proves — this file's ONLY
// job is to add the one door `day-one.mjs` calls that `probe-live.mjs` never
// does: `GET /api/ops`, with a stand-in `self_check` overview shaped exactly
// like `api/_ops.js#opsOverview`'s own `self_check` key
// (`selfCheckOverview()`, that file's own function). Everything else is
// proxied straight through to the wrapped fixture, byte for byte, so
// `day-one.mjs`'s `probe-live` rows are proven against the SAME server code
// `evals/probe-live/run.mjs` already exercises, never a second copy.
//
// "Three states" (WS-R96's own brief) means three different `self_check`
// overviews this file can hand back — `stub` (nothing configured, the shape
// a real deployment's `runSelfCheck()` produces when only the two REQUIRED_ENV
// names are checked and both are missing), `half` (one required name present,
// a migration family missing), `complete` (clean) — never three different
// static-route behaviours, since `probe-live.mjs`'s own checks do not depend
// on env config at all (every route it looks at is either always-present
// static content or a refusal shape that looks identical whether a secret
// is configured or not, per `docs/gurukul/DAY-ONE.md`'s own step 4 note).
import { createServer } from "node:http";
import { startFakeServer } from "../probe-live/fakeServer.mjs";

export const VALID_OPERATOR_BEARER = "day-one-fixture-operator-bearer";

const SELF_CHECK_STATES = Object.freeze({
  stub: {
    last_started_at: null,
    last_outcome: "never_ran",
    staleness: "unscheduled",
    checked: 2,
    passed: 0,
    failed: 2,
    failing_checks: ["env: OPENROUTER_KEY missing", "env: NEON_URL missing"],
  },
  half: {
    last_started_at: "2026-09-05T02:00:00.000Z",
    last_outcome: "ok",
    staleness: "fresh",
    checked: 4,
    passed: 3,
    failed: 1,
    // NEON_URL and OPENROUTER_KEY both present; the database answers but one
    // migration family is missing — exactly the shape step 3's `self-check:
    // door:vy_room missing` row is written to catch.
    failing_checks: ["migration 071: vy_room missing"],
  },
  complete: {
    last_started_at: "2026-09-05T02:00:00.000Z",
    last_outcome: "ok",
    staleness: "fresh",
    checked: 4,
    passed: 4,
    failed: 0,
    failing_checks: [],
  },
});

function stripHopByHopHeaders(headers) {
  const out = { ...headers };
  delete out.host;
  delete out["content-length"];
  delete out.connection;
  return out;
}

/**
 * `selfCheckState`: one of `"stub"`/`"half"`/`"complete"` (default
 * `"complete"`). `probeDefects`: forwarded verbatim to the wrapped
 * `startFakeServer` (its own negative-control switches — unused by this
 * suite, kept for completeness with the sibling suite's own shape).
 */
export async function startDayOneFixture(port, { selfCheckState = "complete", probeDefects = {} } = {}) {
  if (!(selfCheckState in SELF_CHECK_STATES)) {
    throw new Error(`startDayOneFixture: unknown selfCheckState "${selfCheckState}"`);
  }
  const inner = await startFakeServer(port + 1, probeDefects);

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);

      if (url.pathname === "/api/ops" && req.method === "GET") {
        const auth = String(req.headers.authorization || "");
        const bearer = auth.replace(/^Bearer\s+/i, "");
        // Same courtesy-404 law `api/ops.js`'s own header states: unconfigured
        // and wrong-account look identical from the outside.
        if (!bearer || bearer !== VALID_OPERATOR_BEARER) {
          res.writeHead(404, { "content-type": "application/json" });
          return res.end(JSON.stringify({ error: "not_found" }));
        }
        res.writeHead(200, { "content-type": "application/json" });
        return res.end(JSON.stringify({ ok: true, self_check: SELF_CHECK_STATES[selfCheckState] }));
      }

      // Everything else: proxy through to the wrapped probe-live fixture,
      // unchanged, so day-one.mjs's `probe-live` rows exercise the SAME
      // server code evals/probe-live/run.mjs already proves.
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = Buffer.concat(chunks);
      const innerRes = await fetch(`${inner.url}${req.url}`, {
        method: req.method,
        headers: stripHopByHopHeaders(req.headers),
        body: ["GET", "HEAD"].includes(req.method) ? undefined : body,
        redirect: "manual",
      });
      const buf = Buffer.from(await innerRes.arrayBuffer());
      const headers = {};
      innerRes.headers.forEach((v, k) => {
        headers[k] = v;
      });
      res.writeHead(innerRes.status, headers);
      res.end(buf);
    } catch (e) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end(String(e && e.stack ? e.stack : e));
    }
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () =>
      resolve({
        server,
        url: `http://127.0.0.1:${port}`,
        stop: async () => {
          await new Promise((r) => server.close(r));
          await inner.stop();
        },
      }),
    );
  });
}
