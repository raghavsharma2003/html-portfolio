// The cron endpoint for the stays-current loop (Gurukul WS-I).
//
// api/replica-liveness-sweep.js, spelled the same way on purpose: the same
// timing-safe CRON_SECRET comparison with the same 24-byte minimum, the same
// GET-or-POST, the same `no-store`, the same "unconfigured lane returns
// {ok:true, disabled:true} rather than 500ing every tick". A cron that 500s
// on an unconfigured deploy trains everyone to ignore cron alerts, and this
// deploy is unconfigured until a teacher has actually connected a channel.
//
// Thin by construction: auth, dispatch, error shape. Every decision lives in
// api/_channel-ingest.js where evals/channel.mjs can reach it with a fake db.
import { timingSafeEqual } from "node:crypto";
import { q } from "./_db.js";
import { configuredChannelProvider } from "./_channel/registry.js";
import { configuredAsrProvider } from "./_asr/registry.js";
import { runChannelIngestSweep } from "./_channel-ingest.js";
import { attestationForWatch } from "./_channel-watch.js";

function authorized(req) {
  const expected = Buffer.from(String(process.env.CRON_SECRET || ""));
  const actual = Buffer.from(String(req.headers?.authorization || "").replace(/^Bearer\s+/i, ""));
  return expected.length >= 24 && expected.length === actual.length && timingSafeEqual(expected, actual);
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "GET" && req.method !== "POST") return res.status(405).json({ error: "GET or POST only" });
  if (!authorized(req)) return res.status(401).json({ error: "unauthorized" });
  try {
    const channelProvider = configuredChannelProvider();
    const asr = configuredAsrProvider();
    // BOTH lanes are required. A channel provider with no ASR would list
    // videos, fail every transcription, and write a failed run row per video
    // per tick — a disabled lane that looks like a broken one.
    if (!channelProvider || !asr) {
      return res.status(200).json({ ok: true, disabled: true, channel: Boolean(channelProvider), asr: Boolean(asr) });
    }
    // WS-S. The attestation resolver is injected here rather than imported by
    // the worker, for the same reason `db` is: it is the seam evals/
    // mediaextract.mjs replaces to prove the gate refuses. Passing `q` means
    // the gate is a live SQL predicate in production and a fake predicate in
    // the suite — never a branch that only one of the two takes.
    const summary = await runChannelIngestSweep({
      db: q,
      channelProvider,
      asr,
      maxWatches: 3,
      attestations: (watch) => attestationForWatch(q, watch),
    });
    return res.status(200).json({ ok: true, ...summary });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({ error: status === 500 ? "channel_ingest_sweep_failed" : error.code || error.message });
  }
}
