import { createYouTubeOAuthChannelProvider } from "./providers/youtube-oauth.js";
import { createYouTubeExtractChannelProvider } from "./providers/youtube-extract.js";
import { createMediaExtractClient, mediaExtractConfig } from "./media-extract-client.js";
import { extractionPosture } from "./extract-routes.js";

// api/_claim-extraction/registry.js's pattern, exactly: read the env, throw a
// coded 503 when it is incomplete, construct otherwise. Nothing else — a
// registry that fell back to a fixture provider when the env was missing
// would be a production deploy quietly ingesting nothing and reporting
// success, which is the `dead-writers` shape with money attached.
//
// There is no fake branch here on purpose. `providers/fake.js` is imported
// BY THE EVAL, never by this file, so no environment variable and no argument
// can make production reach one.
//
// ── two providers, and the EXTRACTION one is the upgrade, not the default ─
//
// The OAuth provider is always constructible and is what a deployment gets
// when the extraction service is not configured: listing works, owner
// captions work, `fetchAudio` refuses honestly. Adding
// `AZURE_MEDIA_EXTRACT_ORIGIN` + `MEDIA_EXTRACT_HMAC_SECRET` upgrades it to
// the composing provider, which delegates listing and captions to the same
// OAuth instance and adds the extraction lane.
//
// Selection is by CONFIGURATION PRESENCE, not by a flag. There is no
// `USE_EXTRACTION=true`: a boolean that turns on a lane whose credentials are
// absent is a lane that 503s at request time, and a boolean that turns OFF a
// lane whose credentials are present is a way to have paid for a service that
// does nothing. The presence of a working origin and secret IS the intent.
//
// The extraction lane additionally needs a way to sign a storage upload,
// which the registry supplies as a function rather than as a credential — the
// service is handed one URL for one object with an expiry, and never a key.

export function createProductionChannelProvider(env = process.env, options = {}) {
  const clientId = env.YOUTUBE_OAUTH_CLIENT_ID;
  const clientSecret = env.YOUTUBE_OAUTH_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw Object.assign(new Error("channel_provider_unavailable"), { code: "channel_provider_unavailable", status: 503 });
  }
  const base = createYouTubeOAuthChannelProvider({
    clientId,
    clientSecret,
    fetchImpl: options.fetchImpl,
    grantStore: options.grantStore,
  });
  if (!env.AZURE_MEDIA_EXTRACT_ORIGIN || !env.MEDIA_EXTRACT_HMAC_SECRET) return base;
  let config;
  try {
    config = mediaExtractConfig(env);
  } catch (error) {
    // A NAMED ROUTE WITH NO CREDENTIAL IS NOT A DISABLED LANE.
    //
    // The tempting thing is to return `base` here, which degrades to the OAuth
    // provider and its honest "cannot download audio" refusal. That would be
    // wrong in a specific and expensive way: the owner set
    // `MEDIA_EXTRACT_ROUTE=proxy` and forgot `MEDIA_EXTRACT_PROXY_URL`, and the
    // generic refusal would send them looking at OAuth scopes. So the lane
    // stays present and carries the route's OWN code to the run row, which is
    // what `api/_replica-activity.js` turns into "add the proxy credential".
    const code = String(error?.code || "channel_extract_no_route_configured");
    return Object.freeze({
      ...base,
      name: base.name,
      version: base.version,
      async fetchAudio() { throw Object.assign(new Error(code), { code, status: 503 }); },
    });
  }
  return createYouTubeExtractChannelProvider({
    base,
    extractClient: createMediaExtractClient({ config, fetchImpl: options.fetchImpl }),
    signUpload: options.signUpload || defaultSignUpload,
  });
}

/** Imported lazily so `api/_replica-storage.js` — and through it the Supabase
 *  config — is not pulled into every module that merely wants to know whether
 *  a channel provider exists. The eval never reaches this function; it injects
 *  its own `signUpload`. */
async function defaultSignUpload(objectPath) {
  const { createSignedReplicaUpload } = await import("../_replica-storage.js");
  return createSignedReplicaUpload(objectPath);
}

/** The sweep endpoint's spelling: absent config DISABLES the lane rather than
 *  500ing the cron. api/replica-liveness-sweep.js's `configuredLivenessVerifier`
 *  is the shape being copied — a cron that 500s every five minutes on an
 *  unconfigured deploy trains everyone to ignore cron alerts. */
export function configuredChannelProvider(env = process.env, options = {}) {
  try { return createProductionChannelProvider(env, options); }
  catch { return null; }
}

/** Whether THIS deploy can extract audio at all. The studio asks so it can
 *  render "import my back catalogue" as available or as a to-do, rather than
 *  offering a button that fails. */
export function channelExtractionConfigured(env = process.env) {
  if (!env.AZURE_MEDIA_EXTRACT_ORIGIN || !env.MEDIA_EXTRACT_HMAC_SECRET) return false;
  try { mediaExtractConfig(env); return true; }
  catch { return false; }
}

/** The two halves, separately, for the readiness panel and for the Activity
 *  surface's empty state.
 *
 *  `channelExtractionConfigured` above answers "is the extraction SERVICE
 *  wired", which is a different question from "will YouTube serve this deploy",
 *  and the second is the one a teacher waiting on a lecture cares about. Both
 *  are reported because a deploy can be wired and routed and still be pointed
 *  at a route that is measured not to work, and that is a state the owner has
 *  to be able to see rather than infer from a run row.
 *
 *  Never throws. A refusal is the answer, not an error. */
export function channelExtractionPosture(env = process.env) {
  const posture = extractionPosture(env);
  const serviceWired = channelExtractionConfigured(env);
  return Object.freeze({
    serviceWired,
    transcript: posture.transcript,
    audio: serviceWired
      ? posture.audio
      : Object.freeze({ ok: false, route: "", provider: "", measuredBlocked: false, code: "channel_extract_service_not_configured" }),
  });
}
