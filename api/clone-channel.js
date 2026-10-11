// The Channels endpoint — the studio half of Gurukul WS-N.
//
//   GET  /api/clone-channel?replica_id=…            list this clone's channels
//   POST /api/clone-channel {op:"save"}             bind an address (no secret)
//   POST /api/clone-channel {op:"connect"}          address + credential, together
//   POST /api/clone-channel {op:"status"}           pause / resume / revoke
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape — every
// decision lives in `api/_clonechannel.js` and `api/_channel-secrets.js`, where
// a fake `db` and a fake backend can reach them (`dead-writers`: the database
// is absent in this environment, so logic in a handler is logic no eval can
// ever run). `api/teacher-sheet.js` is the shape this copies.
//
// ── THE SECRET GOES PAST THIS FILE AND STOPS ──────────────────────────────
//
// `connect` is the one op that ever holds a live credential, and it holds it
// for the length of one function call:
//
//   1. mint a `credentials_ref` SERVER-SIDE (never accepted from the client —
//      a client-chosen reference is a client that can point one teacher's
//      channel at another teacher's secret);
//   2. write the value to the secret store under that reference;
//   3. write the REFERENCE to `vy_clone_channel`, and only then set the row
//      'connected'.
//
// The order is load-bearing. Secret first, row second, means a failed secret
// write leaves a DRAFT row and the owner is told to try again — the other
// order leaves a connected row whose credential does not exist, which is a
// channel that looks live in the studio and cannot send a single message.
//
// The value is never echoed, never logged, never returned, and never reaches
// Postgres — migration 055's `credentials_ref uuid` makes the last one
// structurally impossible rather than merely intended.
//
// ── the response never carries a credential, or a reason ──────────────────
//
// `clientChannel()` reduces `credentials_ref` to `"present" | null` before
// anything leaves, which is api/_teacher-sheet-draft.js's rule for
// `consent_artifact_id` and the same reason: a studio needs to render a gate,
// not to hold a uuid in a browser's network log.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import {
  CloneChannelError,
  CONNECTABLE_KINDS,
  listCloneChannels,
  saveCloneChannel,
  setCloneChannelStatus,
  mintCredentialsRef,
} from "./_clonechannel.js";
import { ChannelSecretError, putChannelSecret } from "./_channel-secrets.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

const notFound = (res) => res.status(404).json({ error: "replica_not_found" });

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  // Two buckets, IP then user, at api/teacher-sheet.js's numbers. The IP one
  // is checked before auth because an unauthenticated flood must not cost a
  // Supabase round trip each.
  if (!allow(ipOf(req), "clone_channel", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "clone_channel_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const channels = await listCloneChannels(q, user.id, req.query?.replica_id);
      return res.status(200).json({ channels, kinds: CONNECTABLE_KINDS });
    }

    const body = req.body || {};
    const op = String(body.op || "");

    if (op === "save") {
      const saved = await saveCloneChannel(q, user.id, body.replica_id, {
        kind: body.kind,
        externalRef: body.external_ref,
      });
      if (!saved) return notFound(res);
      obsBestEffort("clone_channel.save", { kind: saved.kind, status: saved.status });
      return res.status(200).json({ channel: saved });
    }

    if (op === "connect") {
      // See the header for why this order and not the other one.
      const credentialsRef = mintCredentialsRef();
      await putChannelSecret(credentialsRef, String(body.kind || ""), body.credential);
      const saved = await saveCloneChannel(q, user.id, body.replica_id, {
        kind: body.kind,
        externalRef: body.external_ref,
        credentialsRef,
      });
      if (!saved) return notFound(res);
      obsBestEffort("clone_channel.connect", { kind: saved.kind, status: saved.status });
      return res.status(200).json({ channel: saved });
    }

    if (op === "status") {
      const changed = await setCloneChannelStatus(q, user.id, body.replica_id, body.channel_id, body.status);
      // Null is "not yours, does not exist, or already revoked" — one answer,
      // because a client that could tell them apart could enumerate rows.
      if (!changed) return notFound(res);
      obsBestEffort("clone_channel.status", { kind: changed.kind, status: changed.status });
      return res.status(200).json({ channel: changed });
    }

    return res.status(400).json({ error: "unknown_op" });
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    // Both carry a named code and a status, and NEITHER ever carries the
    // credential — `putChannelSecret` throws `channel_secret_shape_invalid`
    // without quoting what it rejected, on purpose.
    if (error instanceof ChannelSecretError || error instanceof CloneChannelError) {
      return res.status(error.status).json({ error: error.code });
    }
    console.error("[clone-channel] failure:", error?.message || "unknown");
    return res.status(500).json({ error: "clone_channel_failure" });
  }
}
