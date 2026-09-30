// The widget's endpoint — the HTTP half of Gurukul WS-N item 3.
//
//   POST /api/clone-chat {op:"open", clone:"<slug>"}   -> session + disclosure
//   POST /api/clone-chat {op:"say",  session, message, transcript}
//
// Thin by construction: cors, rate limit, dispatch, error shape — every
// decision lives in `api/_clonechat.js`, where a fake `db` can reach it.
// `api/teacher-sheet.js` over `api/_teacher-sheet-draft.js` is the house shape
// this copies, and the reason is `dead-writers`: the database is absent in
// this environment, so logic in the handler would be logic no eval could run.
//
// ── PUBLIC, and therefore rate-limited twice ──────────────────────────────
//
// This is the only endpoint in the tree that answers an UNAUTHENTICATED
// visitor on somebody else's website. Two buckets: the IP (cheap to trip,
// checked first, so a flood costs no database round trip) and the visitor id
// the widget carries. The visitor id is client-supplied and therefore not a
// security control — it is the bucket that keeps one honest tab from spending
// a teacher's budget, and the IP bucket is what an attacker actually meets.
//
// ── CORS is `*`, and that is a deliberate, bounded decision ───────────────
//
// The widget runs on a teacher's own domain, which we do not know in advance
// and must not have to be told — "no code per customer" is the whole brief.
// The bounded part: this endpoint reads NO cookie, accepts NO credential, and
// sets `Access-Control-Allow-Credentials` nowhere, so a wildcard origin grants
// exactly the ability to POST a message and read a reply, which is the
// ability the widget is for. Everything that could be abused across origins —
// a session, a person, a memory — this lane structurally does not have.
//
// ── what a response never carries ─────────────────────────────────────────
//
// The provider, the model, the agent uuid, the sheet, the consent state, or
// which of the five reasons a clone is unreachable applies. `clone_unavailable`
// is one code for all of them (api/_clonechannel.js states why), and the
// engine's internals fence is a floor invariant, not a header we set here.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { CloneChatError, openCloneSession, cloneChatTurn } from "./_clonechat.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

/** Client-supplied, so it is a bucket key and never an identity. Clamped hard
 *  because an unbounded one is an unbounded number of buckets, which is the
 *  rate limiter's own denial of service. */
const visitorOf = (body) => String(body?.visitor || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 64);

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "clone_chat_ip", 60)) return res.status(429).json({ error: "slow_down" });

  const body = req.body || {};
  const visitor = visitorOf(body);
  if (visitor && !allow(visitor, "clone_chat_visitor", 20)) {
    return res.status(429).json({ error: "slow_down" });
  }

  try {
    const op = String(body.op || "");

    if (op === "open") {
      const opened = await openCloneSession(q, { slug: body.clone, visitorId: visitor });
      obsBestEffort("clone_chat.open", { ok: true });
      return res.status(200).json(opened);
    }

    if (op === "say") {
      const turn = await cloneChatTurn(q, {
        session: body.session,
        message: body.message,
        transcript: body.transcript,
      });
      // COUNTS AND DECISIONS, never conversation text — `_obs.js`'s law, and
      // the text here belongs to a visitor who is very likely a child.
      obsBestEffort("clone_chat.turn", {
        bubbles: turn.bubbles.length,
        gate_findings: turn.gate.findings,
      });
      return res.status(200).json(turn);
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof CloneChatError) return res.status(error.status).json({ error: error.code });
    // Everything else is 500 with a fixed code. An error message from below
    // can carry a table name, a slug, or a provider — none of which a page on
    // somebody else's domain gets to learn.
    console.error("[clone-chat] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "clone_chat_failure" });
  }
}
