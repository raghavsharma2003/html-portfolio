// The one-link enrollment endpoint (Gurukul WS-AD).
//
//   GET  /api/video-enroll?replica_id=…            this replica's enrollments
//   GET  /api/video-enroll?enrollment_id=…&windows=1   the ranked windows
//   POST /api/video-enroll  {replica_id, video_url, channel_url, attestations}
//
// Thin by construction — cors, rate limit, auth, dispatch, error shape — with
// every decision in `api/_video-enroll.js` where a fake `db` can reach it.
// `api/context-items.js` over `api/_context-locker.js` is the house shape and
// `dead-writers` is the reason: this environment has no database, so logic in
// a handler is logic no eval will ever run.
//
// ── the seams are built HERE and injected DOWN ──────────────────────────
// The lane takes its dependencies as a bag rather than importing them, so the
// eval drives the real control flow with fixture audio. This handler is the
// one place that turns env into those seams, and every one of them is allowed
// to be ABSENT: an unconfigured deploy answers a named 503 naming the missing
// capability, rather than 500ing or — worse — silently doing less and
// reporting success.
import { q } from "./_db.js";
import { requireUser, AuthError } from "./_auth.js";
import { allow, ipOf } from "./_ratelimit.js";
import { obsBestEffort } from "./_obs.js";
import { attestChannelOwnership } from "./_channel-watch.js";
import { configuredChannelProvider, channelExtractionConfigured } from "./_channel/registry.js";
import { configuredAsrProvider } from "./_asr/registry.js";
import {
  VideoEnrollError,
  VideoEnrollQuotaError,
  enrollFromVideo,
  listVideoEnrollments,
  readVideoEnrollmentWindows,
  videoEnrollLimits,
} from "./_video-enroll.js";

function cors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Cache-Control", "no-store");
}

/**
 * The production dependency bag.
 *
 * Note what is NOT here: `promoteReference`. Promoting a window to the
 * replica's active voice reference means writing an `enhance`-stage artifact,
 * a `selected` decision and a genome reference entry — the three facts
 * `beginOwnedVoicePreview`'s fence reads. Those writes belong to
 * `api/_replica-processing`, which owns artifact identity and the transform
 * version, and inventing a second writer for them here would be a second
 * source of truth for what a replica speaks from. So the seam exists, the
 * lane calls it when it is supplied, and this deploy supplies it only once
 * the processing worker exposes it. Until then the enrollment completes,
 * records its ranked windows, and reports `reference_promoted: false` — which
 * is the honest state, and is visible on the response rather than inferred.
 */
function productionDeps(env = process.env) {
  const provider = configuredChannelProvider(env);
  const asr = configuredAsrProvider(env);
  return {
    env,
    attest: async ({ ownerUserId, replicaId, channel, attestations }) =>
      attestChannelOwnership(q, ownerUserId, replicaId, {
        channel_url: channel.url,
        attestations,
      }),
    extractAudio: async ({ videoId, attestation, ownerUserId, replicaId, enrollmentId, maxDurationMs }) => {
      if (!provider || typeof provider.fetchAudio !== "function") {
        throw Object.assign(new Error("channel_extraction_unavailable"), { code: "channel_extraction_unavailable", status: 503 });
      }
      // The provider's `fetchAudio` is bound to a WATCH, because until now the
      // only way to reach extraction was a standing channel loop. A single
      // enrollment is not a watch and must not create one — a watch has a
      // sweep and a cursor and would keep pulling videos nobody asked for. So
      // the enrollment supplies the same three fields the provider needs to
      // scope the storage path, using the ENROLLMENT id where a watch id
      // would go. The path stays owner- and replica-scoped, which is the
      // property that mattered.
      return provider.fetchAudio(
        { videoId, durationMs: 0 },
        null,
        {
          watch: { watchId: enrollmentId, ownerUserId, replicaId, channel: { url: attestation.channelUrl } },
          attestation,
          maxDurationMs,
        },
      );
    },
    fetchAudioBytes: async ({ objectPath }) => {
      const { readPrivateReplicaObject } = await import("./_replica-storage.js");
      return readPrivateReplicaObject(objectPath);
    },
    transcribe: async ({ objectPath, durationMs }) => {
      if (!asr) throw Object.assign(new Error("asr_unavailable"), { code: "asr_unavailable", status: 503 });
      const result = await asr.transcribe({ storagePath: objectPath, mime: "audio/wav", durationMs }, "hi");
      return { turns: result.turns, text: result.turns.map((turn) => turn.text).join(" ") };
    },
  };
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (!["GET", "POST"].includes(req.method)) return res.status(405).json({ error: "GET or POST only" });
  // Deliberately tighter than the locker's 20/min: one POST here is an Azure
  // container wake, a media download and an ASR batch. The IP limit bounds a
  // script, the owner limit bounds a stuck retry loop, and the DAILY caps in
  // `_video-enroll/quota.js` bound the money. Three different problems.
  if (!allow(ipOf(req), "video_enroll", 10)) return res.status(429).json({ error: "slow_down" });

  try {
    const user = await requireUser(req);
    if (!allow(user.id, "video_enroll_user", 12)) return res.status(429).json({ error: "slow_down" });

    if (req.method === "GET") {
      if (req.query?.enrollment_id) {
        const windows = await readVideoEnrollmentWindows(q, user.id, req.query.enrollment_id);
        return res.status(200).json({ windows });
      }
      const enrollments = await listVideoEnrollments(q, user.id, req.query?.replica_id);
      return res.status(200).json({
        enrollments,
        limits: videoEnrollLimits(),
        // The studio renders "paste a link" as available or as a to-do from
        // this flag rather than offering a button that answers 503.
        extraction_configured: channelExtractionConfigured(),
      });
    }

    const body = req.body || {};
    const result = await enrollFromVideo(q, user.id, {
      replica_id: body.replica_id ?? req.query?.replica_id,
      video_url: body.video_url,
      channel_url: body.channel_url,
      attestations: body.attestations,
    }, productionDeps());

    // COUNTS AND SHAPES ONLY — `_obs.js`'s law. Never the video id (it names a
    // real public video and, with the owner, identifies a person), never the
    // channel, never a transcript fragment.
    obsBestEffort("video_enroll.complete", {
      windows_scored: result.stats?.windows_scored ?? 0,
      windows_eligible: result.stats?.windows_eligible ?? 0,
      selected_over_head_delta: result.stats?.selected_over_head_delta ?? null,
      head_window_rank: result.stats?.head_window_rank ?? null,
      reference_promoted: Boolean(result.reference_promoted),
      deduped: Boolean(result.deduped),
    });
    return res.status(200).json(result);
  } catch (error) {
    if (error instanceof AuthError) return res.status(error.status).json({ error: error.code });
    if (error instanceof VideoEnrollQuotaError || error instanceof VideoEnrollError) {
      // The refusal is NAMED and carries its numbers. An owner who hit the
      // two-a-day cap is told the cap, the count and when it resets; an owner
      // whose extraction was refused by YouTube gets `channel_extract_
      // extractor_bot_check` verbatim, which is a state the studio has a
      // screen for. Neither is "something went wrong".
      obsBestEffort("video_enroll.refused", { code: error.code });
      return res.status(error.status).json({
        error: error.code,
        ...(error.details ? { details: error.details } : {}),
      });
    }
    const status = Number.isInteger(error?.status) ? error.status : 500;
    return res.status(status).json({
      error: status === 500 ? "video_enroll_failure" : String(error.code || error.message),
      ...(status < 500 && error?.details ? { details: error.details } : {}),
    });
  }
}
