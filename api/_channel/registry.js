import { createYouTubeOAuthChannelProvider } from "./providers/youtube-oauth.js";

// api/_claim-extraction/registry.js's pattern, exactly: read the env, throw a
// coded 503 when it is incomplete, construct otherwise. Nothing else — a
// registry that fell back to a fixture provider when the env was missing
// would be a production deploy quietly ingesting nothing and reporting
// success, which is the `dead-writers` shape with money attached.
//
// There is no fake branch here on purpose. `providers/fake.js` is imported
// BY THE EVAL, never by this file, so no environment variable and no argument
// can make production reach it.

export function createProductionChannelProvider(env = process.env) {
  const clientId = env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error("channel_provider_unavailable"), { code: "channel_provider_unavailable", status: 503 });
  }
  return createYouTubeOAuthChannelProvider({ clientId, clientSecret });
}

/** The sweep endpoint's spelling: absent config DISABLES the lane rather than
 *  500ing the cron. api/replica-liveness-sweep.js's `configuredLivenessVerifier`
 *  is the shape being copied — a cron that 500s every five minutes on an
 *  unconfigured deploy trains everyone to ignore cron alerts. */
export function configuredChannelProvider(env = process.env) {
  try { return createProductionChannelProvider(env); }
  catch { return null; }
}
