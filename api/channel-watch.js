// The ingest-channel endpoint — the studio half of Gurukul WS-S.
//
//   GET  /api/channel-watch?replica_id=…       attestations + watches + capability
//   POST /api/channel-watch {op:"attest"}      record the ownership attestation
//   POST /api/channel-watch {op:"watch"}       start the loop (attestation-gated)
//   POST /api/channel-watch {op:"status"}      pause / resume / revoke the watch
//   POST /api/channel-watch {op:"backfill"}    start / stop the back-catalogue import
//   POST /api/channel-watch {op:"revoke_attestation"}   withdraw permission
//
// This endpoint is what WS-M found missing: nothing in `api/` ever INSERTed
// into `vy_channel_watch`, so the whole stays-current loop had no way to be
// started by anybody.
//
// Thin by construction: cors, rate limit, auth, dispatch, error shape. Every
// decision lives in `api/_channel-watch.js` where a fake `db` can reach it —
// `dead-writers`' lesson: the database is absent in this environment, so
// logic in a handler is logic no eval can ever run. `api/clone-channel.js` is
// the shape this copies.
//
// ── the order of the two ops is the informed half of informed consent ─────
//
// `attest` must precede `watch`, and it is not a UI convention: the INSERT in
// `createChannelWatch` selects its rows from a live attestation, so a client
// that skipped the attestation step gets `channel_attestation_required` from
// a SQL predicate rather than from a validation branch. The studio renders
// the statements, the teacher ticks all five, and only then does the button
// that starts the loop do anything at all.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { channelExtractionConfigured } from "./_channel/registry.js";
import { ChannelError } from "./_channel/contracts.js";
import {
  CHANNEL_ATTESTATIONS,
  CHANNEL_ATTESTATION_STATEMENT_SET,
  ChannelWatchError,
  attestChannelOwnership,
  createChannelWatch,
  listChannelAttestations,
  listChannelWatches,
  revokeChannelAttestation,
  setBackfillState,
  setChannelWatchStatus,
} from "./_channel-watch.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  // api/clone-channel.js's numbers. The IP bucket is checked before auth so
  // an unauthenticated flood costs no Supabase round trip.
  if (!allow(ipOf(req), "channel_watch", 20)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "channel_watch_user", 60)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      const replicaId = req.query?.replica_id;
      const [attestations, watches] = await Promise.all([
        listChannelAttestations(q, user.id, replicaId),
        listChannelWatches(q, user.id, replicaId),
      ]);
      return res.status(200).json({
        attestations,
        watches,
        // The statements themselves come from the server, so the studio
        // cannot render a shorter list than the one the server requires —
        // a consent screen whose text is authored client-side is a consent
        // screen that can be edited by whoever ships the client.
        statements: CHANNEL_ATTESTATIONS,
        statement_set: CHANNEL_ATTESTATION_STATEMENT_SET,
        // Whether extraction is available AT ALL on this deploy. The studio
        // renders the back-catalogue offer against this rather than against a
        // guess, so a teacher is never shown a button that 503s.
        extraction_available: channelExtractionConfigured(),
      });
    }

    const body = req.body && typeof req.body === "object" ? req.body : {};
    const replicaId = body.replica_id;
    switch (String(body.op || "")) {
      case "attest": {
        const attestation = await attestChannelOwnership(q, user.id, replicaId, body);
        obsBestEffort("channel_attestation_granted", { replica_id: attestation.attestation_id });
        return res.status(200).json({ attestation });
      }
      case "watch": {
        const watch = await createChannelWatch(q, user.id, replicaId, body);
        return res.status(200).json({ watch });
      }
      case "status": {
        const watch = await setChannelWatchStatus(q, user.id, replicaId, body.watch_id, body.status);
        return res.status(200).json({ watch });
      }
      case "backfill": {
        const watch = await setBackfillState(q, user.id, replicaId, body.watch_id, body.backfill_state);
        return res.status(200).json({ watch });
      }
      case "revoke_attestation": {
        const attestation = await revokeChannelAttestation(q, user.id, replicaId, body.attestation_id);
        return res.status(200).json({ attestation });
      }
      default:
        return res.status(400).json({ error: "unsupported_op" });
    }
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.message });
    if (error instanceof ChannelWatchError || error instanceof ChannelError) {
      return res.status(error.status).json({ error: error.code, ...(error.details ? { details: error.details } : {}) });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "channel_watch_failed" : String(error.message) });
  }
}
