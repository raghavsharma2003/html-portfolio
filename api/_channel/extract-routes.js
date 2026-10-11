// The extraction ROUTE table (Gurukul WS-AI).
//
// WS-AD measured that the cheapest lever does not work:
// `context/rejected.md#player-clients-do-not-beat-a-datacenter-ip`. All ten
// yt-dlp player clients returned "Sign in to confirm you're not a bot" from
// Azure Central India, at the metadata probe, before a stream URL was issued.
// WS-AI then measured that a self-hosted PO token provider moves the needle
// while an egress IP is warm and stops moving it once that IP is burned:
// `context/measurements.md#po-token-helps-until-the-ip-is-burned`.
//
// The conclusion both measurements point at is the same one: **the variable is
// the egress IP, and every remaining lever is a credential the owner has to
// buy or grant.** So this file's job is not to pick a winner. It is to make the
// choice ONE ENVIRONMENT VARIABLE instead of a rewrite, and to make every
// unconfigured route refuse by name instead of failing as a generic 502 that an
// operator has to read a container log to understand.
//
// ── THREE PROPERTIES THIS FILE EXISTS TO HOLD ─────────────────────────────
//
// 1. A ROUTE WITHOUT ITS CREDENTIAL REFUSES BY NAME. Not "extraction failed".
//    `channel_extract_route_proxy_credential_missing` reaches the owner's
//    Activity surface as a sentence and a next action, because the next action
//    is a thing only the owner can do (buy a proxy, export a cookie jar) and
//    they cannot do it if nobody tells them which one.
//
// 2. THE PROVENANCE RECORDS THE ROUTE THAT SERVED THE BYTES. Not the route we
//    intended. The service ECHOES the route it actually ran and the client
//    verifies the echo, so a service that quietly served from a different
//    route than it was asked for is a typed failure rather than a row with a
//    wrong provenance stamp on it. `plausible-return-hides-a-dead-pipeline`
//    is the shape being defended against: a proxy bill and a direct-route
//    extraction look identical on the happy path.
//
// 3. THERE IS NO SILENT FALLBACK. One request selects exactly one route.
//    A route that fails fails; nothing retries it under another name. Falling
//    back would make property 2 unenforceable, because the row would carry the
//    last route tried rather than the route that worked, and the two are only
//    distinguishable when somebody is watching.
//
// ── THE TWO HALVES, KEPT APART ────────────────────────────────────────────
//
// A YouTube video gives this platform two different things and they have
// different difficulty, so they get different route tables and a working one
// must never be reported as covering the other:
//
//   TRANSCRIPT (words, knowledge, the way a teacher explains a thing)
//     reachable WITHOUT media bytes. `captions_oauth` is sanctioned by the
//     platform, costs quota rather than money, carries zero ToS exposure, and
//     was measured reachable from a datacenter IP. Its limit is that
//     `captions.download` returns only MANUALLY UPLOADED tracks.
//
//   VOICE (pace, pauses, laughter, the person)
//     needs the audio bytes and therefore needs an egress YouTube will serve.
//
// `transcriptRouteFor` and `audioRouteFor` are separate functions returning
// separate vocabularies for exactly this reason. A deploy with owner OAuth and
// no proxy has a WORKING transcript half and a BLOCKED audio half, and saying
// so in one word each is the whole point.

const AUDIO_ROUTES = Object.freeze(["proxy", "provider", "cookies", "pot", "direct"]);
const TRANSCRIPT_ROUTES = Object.freeze(["captions_oauth", "provider", "proxy", "cookies", "pot", "direct"]);

// Selection order when the deploy does not name a route. Read it as "most
// likely to actually return bytes, first". It is an ORDER, not a fallback
// chain: exactly one of these is chosen, before the request, and if it fails
// the request fails as that route.
//
// `proxy` leads because it is the only lever that changes the variable WS-AD
// isolated. `provider` is second because a third party's egress is somebody
// else's residential pool with a support contract attached. `cookies` is third
// and deliberately below both: it is free, and it is the only route that puts
// a real Google account at risk, so it must never win by being cheapest.
// `pot` is fourth: free, self-hosted, measured to help a warm IP and measured
// not to rescue a burned one. `direct` is last and is the measured-blocked
// baseline that exists so "we tried nothing" is never the silent default.
const AUDIO_PREFERENCE = AUDIO_ROUTES;
const TRANSCRIPT_PREFERENCE = TRANSCRIPT_ROUTES;

const HTTP_PROXY = /^(?:https?|socks5h?|socks4a?):\/\/[^\s/@]*@?[a-z0-9.[\]:-]+(?::\d{1,5})?\/?$/i;
const PROVIDER_NAME = /^[a-z0-9][a-z0-9_-]{1,31}$/;

/** Every provider adapter this build knows how to speak to. A name that is not
 *  here is refused at configuration time rather than at request time, so a
 *  typo in `MEDIA_EXTRACT_PROVIDER` is caught by the studio's readiness check
 *  and not by a teacher waiting on a lecture. */
export const KNOWN_PROVIDERS = Object.freeze(["cobalt", "supadata", "apify", "rapidapi_generic"]);

export class ExtractRouteError extends Error {
  constructor(code, status = 503, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

function refuse(code, status = 503, details) {
  throw new ExtractRouteError(code, status, details);
}

const text = (value) => String(value ?? "").trim();

/* ── per-route credential predicates ───────────────────────────────────────
 *
 * Each returns either a frozen config for its route or throws that route's OWN
 * refusal code. They are separate functions rather than one switch with a
 * default because the default is where a route gets silently treated as
 * configured: a switch that falls through returns `undefined`, and `undefined`
 * is indistinguishable from "no credential needed", which is precisely the
 * `direct` route, which is the one that is measured not to work. */

function proxyConfig(env) {
  const url = text(env.MEDIA_EXTRACT_PROXY_URL);
  if (!url) refuse("channel_extract_route_proxy_credential_missing");
  // Shape-checked here rather than in the service, because a malformed proxy
  // URL that reaches yt-dlp comes back as `extractor_failed`, which names the
  // extractor rather than the actual mistake, which is ours.
  if (!HTTP_PROXY.test(url)) refuse("channel_extract_route_proxy_url_invalid");
  return Object.freeze({ route: "proxy", configured: true });
}

function cookiesConfig(env) {
  // Either a file the deployment mounted, or a base64 jar the service writes
  // to its own scratch on startup. Both are secrets and neither is ever echoed
  // back, logged, or included in the provenance beyond the word "cookies".
  const configured = Boolean(text(env.MEDIA_EXTRACT_COOKIES_FILE) || text(env.MEDIA_EXTRACT_COOKIES_B64));
  if (!configured) refuse("channel_extract_route_cookies_credential_missing");
  return Object.freeze({ route: "cookies", configured: true });
}

function providerConfig(env) {
  const name = text(env.MEDIA_EXTRACT_PROVIDER).toLowerCase();
  if (!name) refuse("channel_extract_route_provider_not_named");
  if (!PROVIDER_NAME.test(name) || !KNOWN_PROVIDERS.includes(name)) {
    refuse("channel_extract_route_provider_unknown", 503, { provider: name.slice(0, 32) });
  }
  if (!text(env.MEDIA_EXTRACT_PROVIDER_KEY)) refuse("channel_extract_route_provider_credential_missing");
  return Object.freeze({ route: "provider", provider: name, configured: true });
}

function potConfig(env) {
  const url = text(env.MEDIA_EXTRACT_POT_PROVIDER_URL);
  if (!url) refuse("channel_extract_route_pot_provider_missing");
  let parsed;
  try { parsed = new URL(url); } catch { refuse("channel_extract_route_pot_provider_invalid"); }
  if (!/^https?:$/.test(parsed.protocol)) refuse("channel_extract_route_pot_provider_invalid");
  return Object.freeze({ route: "pot", configured: true });
}

function directConfig() {
  // No credential, and therefore nothing to refuse on. It is still not a
  // success: it is the route WS-AD measured returning `extractor_bot_check` on
  // all ten player clients, and `routeIsMeasuredBlocked` says so out loud to
  // anything that renders readiness.
  return Object.freeze({ route: "direct", configured: true });
}

function captionsOAuthConfig(env) {
  if (!text(env.YOUTUBE_OAUTH_CLIENT_ID) || !text(env.YOUTUBE_OAUTH_CLIENT_SECRET)) {
    refuse("channel_transcript_route_captions_oauth_credential_missing");
  }
  return Object.freeze({ route: "captions_oauth", configured: true });
}

const AUDIO_CONFIG = Object.freeze({
  proxy: proxyConfig,
  provider: providerConfig,
  cookies: cookiesConfig,
  pot: potConfig,
  direct: directConfig,
});

const TRANSCRIPT_CONFIG = Object.freeze({
  captions_oauth: captionsOAuthConfig,
  provider: providerConfig,
  proxy: proxyConfig,
  cookies: cookiesConfig,
  pot: potConfig,
  direct: directConfig,
});

/** Routes with a measurement saying they do not return bytes from a datacenter
 *  egress. Kept as data so the studio can render "configured, and known not to
 *  work here" rather than a green tick. `direct` is on this list because of
 *  WS-AD's n=10 sweep; `pot` is on it because WS-AI's own A/B showed the help
 *  vanishing once the IP was burned, which makes it a warm-IP mitigation and
 *  not a route. */
export const MEASURED_BLOCKED_FROM_DATACENTER = Object.freeze(["direct", "pot"]);

export function routeIsMeasuredBlocked(route) {
  return MEASURED_BLOCKED_FROM_DATACENTER.includes(String(route || ""));
}

function select(env, explicitName, preference, table, unknownCode) {
  const explicit = text(env[explicitName]).toLowerCase();
  if (explicit) {
    const build = table[explicit];
    if (!build) refuse(unknownCode, 503, { route: explicit.slice(0, 32) });
    // An EXPLICIT route whose credential is absent is an error, never a
    // downgrade. A deploy that said `proxy` and got `direct` is a deploy that
    // believes it is paying for something it is not using.
    return build(env);
  }
  // No explicit route: take the first configured one in preference order. Each
  // candidate's own refusal is swallowed HERE and only here, because "this
  // candidate is not configured" is the question being asked. The last
  // candidate in both tables needs no credential, so this loop cannot fall off
  // the end without an answer.
  let lastCode = "";
  for (const name of preference) {
    try { return table[name](env); }
    catch (error) { lastCode = error?.code || lastCode; }
  }
  refuse(lastCode || "channel_extract_no_route_configured");
}

/**
 * Which route this deploy uses for AUDIO BYTES.
 *
 * `MEDIA_EXTRACT_ROUTE` names one explicitly. Absent, the first configured
 * route in `AUDIO_PREFERENCE` wins. Throws `ExtractRouteError` with the
 * refusing route's own code when an explicitly named route has no credential.
 */
export function audioRouteFor(env = process.env) {
  return select(env, "MEDIA_EXTRACT_ROUTE", AUDIO_PREFERENCE, AUDIO_CONFIG, "channel_extract_route_unknown");
}

/**
 * Which route this deploy uses for the TRANSCRIPT half.
 *
 * Separate on purpose. A deploy with owner OAuth and no proxy resolves
 * `captions_oauth` here and refuses at `audioRouteFor`, which is the true state
 * of that deploy and the one a single combined answer would hide.
 */
export function transcriptRouteFor(env = process.env) {
  return select(env, "MEDIA_EXTRACT_TRANSCRIPT_ROUTE", TRANSCRIPT_PREFERENCE, TRANSCRIPT_CONFIG,
    "channel_transcript_route_unknown");
}

/** Both halves at once, for the studio's readiness panel and for
 *  `docs/gurukul/youtube-extraction-routes.md`'s table. Never throws: a
 *  refusal is DATA here, because the whole purpose of the panel is to show the
 *  owner which half is blocked and what to do about it. */
export function extractionPosture(env = process.env) {
  const half = (fn) => {
    try {
      const config = fn(env);
      return Object.freeze({
        ok: true,
        route: config.route,
        provider: config.provider || "",
        measuredBlocked: routeIsMeasuredBlocked(config.route),
        code: "",
      });
    } catch (error) {
      return Object.freeze({ ok: false, route: "", provider: "", measuredBlocked: false, code: error?.code || "channel_extract_no_route_configured" });
    }
  };
  return Object.freeze({ transcript: half(transcriptRouteFor), audio: half(audioRouteFor) });
}

/**
 * The provenance check, and the reason this module is not just a config
 * reader.
 *
 * `served` is the route the SERVICE says it ran. `asked` is the route the
 * application plane selected. They must be equal. A service that fell back,
 * that was misconfigured, or that is an older build with no route support at
 * all fails here rather than returning bytes whose row says "proxy" over an
 * extraction that went out direct.
 *
 * The negative control in `evals/extractroutes.mjs` drives exactly this: a
 * response stamped `direct` against a request that asked for `proxy` must be
 * refused, and the suite goes red if it is not.
 */
export function assertRouteServed(asked, served) {
  const want = text(asked);
  const got = text(served);
  if (!want || !AUDIO_ROUTES.includes(want)) refuse("channel_extract_route_unknown", 500, { route: want.slice(0, 32) });
  if (!got) refuse("channel_extract_route_unreported", 502);
  if (!AUDIO_ROUTES.includes(got)) refuse("channel_extract_route_unknown", 502, { route: got.slice(0, 32) });
  if (want !== got) refuse("channel_extract_route_mismatch", 502, { asked: want, served: got });
  return got;
}

export const AUDIO_ROUTE_NAMES = AUDIO_ROUTES;
export const TRANSCRIPT_ROUTE_NAMES = TRANSCRIPT_ROUTES;
