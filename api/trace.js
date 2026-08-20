// Turn-trace sink — docs/TRACE.md. The ONLY write path into meera_turn /
// meera_turn_leg, and deliberately the only endpoint of any kind that names
// those tables.
//
// ── this endpoint is WRITE-ONLY, and that is the access rule ──────────────
//
// There is no GET, no op, no query parameter that returns a row. Reading the
// trace requires the NEON_URL in the gitignored api/_config.js — i.e. an
// operator on their own machine running scripts/trace.mjs. That is
// `structural-disclosure` applied to ourselves: the access rule is the absence
// of a code path, not a promise about who looks. Adding a viewer later has to
// be a reviewable diff that CREATES a read path where none exists, which is the
// same property api/_agentscope.js calls "a property of the clause's shape, not
// of the value it was called with".
//
// It is also what keeps inner.ts's charter intact. G1 forbids her interior ever
// reading the user; a trace with no read path cannot feed anything back. G4
// forbids her interior having a UI; a trace with no read path cannot become
// one.
//
// Shaped like api/telemetry.js because it has the same job and the same three
// hard-won requirements:
//   1. it MUST accept bodies that are not application/json — the most valuable
//      batch in a session is the last one, flushed at pagehide via sendBeacon,
//      which cannot send application/json without a preflight it is
//      structurally unable to wait for;
//   2. fail-soft — 200 unless the batch is structurally invalid. A trace outage
//      must never surface as a product failure;
//   3. it is never on a reply path, so the write is AWAITED. Fire-and-forget
//      after the response is how a serverless write silently disappears.
import { allow, ipOf } from "./_ratelimit.js";
import { normaliseLeg, normaliseSpine, traceWrite } from "./_trace.js";

const MAX_DEVICE = 64;
const MAX_SESSION = 96;

/** Collect a request body that no framework parsed for us. */
function rawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.on !== "function" || req.readableEnded || req.complete) return resolve("");
    let out = "";
    let bytes = 0;
    req.setEncoding?.("utf8");
    req.on("data", (c) => {
      bytes += c.length;
      if (bytes < 2_000_000) out += c;
    });
    req.on("end", () => resolve(out));
    req.on("error", () => resolve(""));
  });
}

function parseJson(s) {
  if (typeof s !== "string") return null;
  const a = s.indexOf("{");
  if (a < 0) return null;
  try {
    return JSON.parse(s.slice(a, s.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

/** Same four real body shapes api/telemetry.js enumerates — see that file. */
async function readBatch(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Buffer.isBuffer(b) && !Array.isArray(b)) {
    if (Array.isArray(b.legs) || Array.isArray(b.turns)) return b;
    const parts = Object.entries(b).map(([k, v]) => (v === "" || v == null ? k : `${k}=${v}`));
    const rebuilt = parseJson(parts.join("&"));
    if (rebuilt) return rebuilt;
    return null;
  }
  const direct = parseJson(Buffer.isBuffer(b) ? b.toString("utf8") : b);
  if (direct) return direct;
  return parseJson(await rawBody(req));
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  // Not 405-with-a-hint: this endpoint has no read shape at all, and a GET that
  // explains what it would have returned is a read path in a comment.
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // one batch per turn in steady state, plus the pagehide flush and offline
  // drains. Generous for a busy session, bounded against a loop mining the table.
  if (!allow(ipOf(req), "trace", 120)) return res.status(429).json({ error: "slow down" });

  const batch = await readBatch(req);
  const device = String(batch?.device || "").slice(0, MAX_DEVICE);
  const session = String(batch?.session || "").slice(0, MAX_SESSION) || null;
  const turnsIn = Array.isArray(batch?.turns) ? batch.turns : [];
  const legsIn = Array.isArray(batch?.legs) ? batch.legs : [];
  // structurally invalid is the ONLY 400 — a client that cannot form a batch
  // has a bug worth surfacing; everything downstream of that is ours.
  if (!device || (!turnsIn.length && !legsIn.length)) {
    return res.status(400).json({ error: "bad batch" });
  }

  const ctx = { device, sessionId: session };
  const spines = [];
  for (const t of turnsIn.slice(0, 60)) {
    const s = normaliseSpine(t, ctx);
    if (s) spines.push(s);
  }
  const legs = [];
  for (const l of legsIn.slice(0, 200)) {
    const n = normaliseLeg(l, ctx);
    if (n) legs.push(n);
  }
  // Counted BEFORE the orphan-spine mint below, so a synthesised spine can
  // never make the reject count go negative and read like a healthy batch.
  const rejected = turnsIn.length + legsIn.length - spines.length - legs.length;

  // A leg whose turn has no spine patch in this batch still needs one, or the
  // detail row would be an orphan no query can reach from the spine. Minted
  // from the leg itself: turn_id, agent, device — nothing invented.
  const known = new Set(spines.map((s) => s.turn_id));
  for (const l of legs) {
    if (known.has(l.turn_id)) continue;
    const s = normaliseSpine({ turn_id: l.turn_id, agent_id: l.agent_id, started_at: l.at }, ctx);
    if (s) {
      spines.push(s);
      known.add(l.turn_id);
    }
  }

  if (!spines.length) return res.status(200).json({ ok: true, turns: 0, legs: 0, rejected });

  try {
    const out = await traceWrite(spines, legs);
    return res.status(200).json({ ...out, rejected });
  } catch {
    // storage trouble is ours, not the app's
    return res.status(200).json({ ok: false });
  }
}
