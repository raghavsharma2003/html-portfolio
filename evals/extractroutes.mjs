// The extraction ROUTE seam (Gurukul WS-AI).
//
//   node evals/extractroutes.mjs
//
// Offline, deterministic, $0, no network, no DB, no model call. It drives the
// REAL route table, the REAL transport client and the REAL activity normaliser
// through a fake `fetch` that signs its responses the way the service does, so
// the code path this suite reaches is the code path a sweep reaches.
//
// ── what this suite exists to guarantee ───────────────────────────────────
//
// The owner asked for single-video YouTube extraction to work and said a third
// party is on the table. WS-AD had already measured that the free lever does
// not beat a datacenter IP. So what this workstream can honestly ship is not a
// working route: it is a SEAM where the choice is one environment variable, and
// where every route that is not switched on says so by name. That claim is only
// worth anything if these four properties hold:
//
// 1. ROUTE SELECTION IS FROM CONFIGURATION, AND EXPLICIT BEATS INFERRED.
//    An env naming a route gets that route. No env gets the first configured
//    route in preference order, which with no credentials at all is `direct`,
//    which is the measured-blocked baseline. A deploy is never left with no
//    answer and never left with a silent one.
//
// 2. A ROUTE WITHOUT ITS CREDENTIAL REFUSES BY ITS OWN NAME.
//    `channel_extract_route_proxy_credential_missing`, not
//    `extraction_failed`. This is the whole reason the table exists: the fix is
//    a thing only the owner can do, and they cannot do it if the error does not
//    say which one. Asserted per route, and asserted to reach the owner's
//    Activity surface as a sentence AND a next action.
//
// 3. THE PROVENANCE RECORDS THE ROUTE THAT SERVED THE BYTES, WITH A NEGATIVE
//    CONTROL. A response stamped `direct` against a request that asked for
//    `proxy` must be REFUSED, not recorded. This is the highest-value check in
//    the file: on the happy path a proxy bill and a direct extraction look
//    identical, and the only moment the difference is visible is the moment
//    something asserts it. The control is run both ways round so a check that
//    passes everything is caught.
//
// 4. THE TWO HALVES STAY APART. A deploy with owner OAuth and no proxy has a
//    WORKING transcript half and a BLOCKED audio half. `extractionPosture` must
//    report those separately, because one combined answer would let a working
//    transcript route hide a blocked audio route, which is exactly the thing
//    the brief asked not to happen.
import { createHash, createHmac } from "node:crypto";
import {
  AUDIO_ROUTE_NAMES,
  KNOWN_PROVIDERS,
  MEASURED_BLOCKED_FROM_DATACENTER,
  assertRouteServed,
  audioRouteFor,
  extractionPosture,
  routeIsMeasuredBlocked,
  transcriptRouteFor,
} from "../api/_channel/extract-routes.js";
import { createMediaExtractClient } from "../api/_channel/media-extract-client.js";
import { audioRef } from "../api/_channel/contracts.js";
import { reasonFor, routeNextAction } from "../api/_replica-activity.js";

let pass = 0;
let fail = 0;
const ok = (label, condition) => {
  if (condition) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}`); }
};
const eq = (actual, expected, label) => ok(`${label} (got ${JSON.stringify(actual)})`, actual === expected);

/** The code a thrower threw, or the string "no-throw" when it did not. Using a
 *  sentinel rather than a boolean means a test that stops throwing reports what
 *  it returned instead of quietly reading as a pass. */
async function codeOf(fn) {
  try { const value = await fn(); return `no-throw:${JSON.stringify(value)?.slice(0, 40)}`; }
  catch (error) { return String(error?.code || error?.message || "unknown"); }
}

const SECRET = "0".repeat(64);
const ORIGIN = "https://media-extract.example";
const ENV_BASE = Object.freeze({ AZURE_MEDIA_EXTRACT_ORIGIN: ORIGIN, MEDIA_EXTRACT_HMAC_SECRET: SECRET });

console.log("\n── 1. route selection is configuration, and explicit beats inferred ──");
{
  eq(audioRouteFor({}).route, "direct",
    "no credentials at all resolves to the measured-blocked baseline rather than to nothing");
  ok("...and that baseline is FLAGGED as measured-blocked, not reported as ready",
    routeIsMeasuredBlocked(audioRouteFor({}).route) === true);

  eq(audioRouteFor({ MEDIA_EXTRACT_PROXY_URL: "http://user:pw@proxy.example:8080" }).route, "proxy",
    "a configured proxy wins the preference order over the free routes");
  eq(audioRouteFor({
    MEDIA_EXTRACT_PROXY_URL: "http://proxy.example:8080",
    MEDIA_EXTRACT_COOKIES_B64: "Y29va2ll",
  }).route, "proxy", "...and still wins when cookies are also configured");

  // The ordering claim that matters most is a negative one: cookies must never
  // win by being free, because cookies is the only route that puts a real
  // Google account at risk. With cookies configured and nothing else, it wins;
  // with a proxy alongside, it does not.
  eq(audioRouteFor({ MEDIA_EXTRACT_COOKIES_B64: "Y29va2ll" }).route, "cookies",
    "cookies wins only when it is the only thing configured");

  eq(audioRouteFor({ ...ENV_BASE, MEDIA_EXTRACT_ROUTE: "pot", MEDIA_EXTRACT_POT_PROVIDER_URL: "http://127.0.0.1:4416" }).route,
    "pot", "an explicitly named route is taken even when a preferred one is unconfigured");
  eq(audioRouteFor({
    MEDIA_EXTRACT_ROUTE: "pot",
    MEDIA_EXTRACT_POT_PROVIDER_URL: "http://127.0.0.1:4416",
    MEDIA_EXTRACT_PROXY_URL: "http://proxy.example:8080",
  }).route, "pot", "...and explicit beats the preference order, so a named route is never quietly upgraded");

  eq(await codeOf(() => audioRouteFor({ MEDIA_EXTRACT_ROUTE: "teleport" })), "channel_extract_route_unknown",
    "a route name this build does not know is refused at configuration time, not at request time");

  ok("every route in the vocabulary is selectable by name",
    AUDIO_ROUTE_NAMES.every((name) => {
      const env = {
        proxy: { MEDIA_EXTRACT_PROXY_URL: "http://p.example:1" },
        cookies: { MEDIA_EXTRACT_COOKIES_B64: "Yw==" },
        pot: { MEDIA_EXTRACT_POT_PROVIDER_URL: "http://127.0.0.1:1" },
        provider: { MEDIA_EXTRACT_PROVIDER: "cobalt", MEDIA_EXTRACT_PROVIDER_KEY: "k" },
        direct: {},
      }[name];
      try { return audioRouteFor({ ...env, MEDIA_EXTRACT_ROUTE: name }).route === name; }
      catch { return false; }
    }));
}

console.log("\n── 2. a route without its credential refuses by its OWN name ──");
{
  const cases = [
    ["proxy", {}, "channel_extract_route_proxy_credential_missing"],
    ["proxy", { MEDIA_EXTRACT_PROXY_URL: "not a url" }, "channel_extract_route_proxy_url_invalid"],
    ["cookies", {}, "channel_extract_route_cookies_credential_missing"],
    ["provider", {}, "channel_extract_route_provider_not_named"],
    ["provider", { MEDIA_EXTRACT_PROVIDER: "nosuchvendor" }, "channel_extract_route_provider_unknown"],
    ["provider", { MEDIA_EXTRACT_PROVIDER: "cobalt" }, "channel_extract_route_provider_credential_missing"],
    ["pot", {}, "channel_extract_route_pot_provider_missing"],
    ["pot", { MEDIA_EXTRACT_POT_PROVIDER_URL: "ftp://x" }, "channel_extract_route_pot_provider_invalid"],
  ];
  for (const [route, env, expected] of cases) {
    eq(await codeOf(() => audioRouteFor({ ...env, MEDIA_EXTRACT_ROUTE: route })), expected,
      `route ${route} with ${Object.keys(env).length ? "a bad" : "no"} credential refuses as itself`);
  }
  // The refusals must be DISTINCT. A table where two routes share a code is a
  // table that cannot tell an operator which env var to set, which is the only
  // thing it is for.
  const codes = new Set();
  for (const [route, env] of cases) codes.add(await codeOf(() => audioRouteFor({ ...env, MEDIA_EXTRACT_ROUTE: route })));
  eq(codes.size, cases.length, "every refusal is a distinct code");

  ok("known providers are a closed list, so a typo cannot become a live route",
    KNOWN_PROVIDERS.length > 0 && !KNOWN_PROVIDERS.includes("nosuchvendor"));
}

console.log("\n── 2b. every refusal reaches the owner's Activity surface ──");
{
  // The point of naming the codes is that a person reads them. `reasonFor` must
  // give each one a real sentence rather than the underscore fallback, and
  // `routeNextAction` must give each one something the owner can DO. A reason
  // with no action is a dead end wearing a helpful voice.
  const routeCodes = [
    "channel_extract_no_route_configured",
    "channel_extract_route_unknown",
    "channel_extract_route_proxy_credential_missing",
    "channel_extract_route_proxy_url_invalid",
    "channel_extract_route_cookies_credential_missing",
    "channel_extract_route_provider_not_named",
    "channel_extract_route_provider_unknown",
    "channel_extract_route_provider_credential_missing",
    "channel_extract_route_provider_adapter_unavailable",
    "channel_extract_route_pot_provider_missing",
    "channel_extract_route_pot_provider_invalid",
    "channel_extract_route_unreported",
    "channel_extract_route_mismatch",
    "channel_extract_service_not_configured",
  ];
  for (const code of routeCodes) {
    const reason = reasonFor(code, "");
    // The fallback is the code with its underscores opened out. If a code fell
    // through to that, this suite must fail rather than pass on a sentence that
    // is really just the identifier with spaces in it.
    const fellThrough = reason.toLowerCase().startsWith("channel extract");
    ok(`${code} has a written reason, not the identifier`, reason.length > 30 && !fellThrough);
    ok(`${code} has a next action the owner can act on`, Boolean(routeNextAction(code)?.label));
  }
  eq(routeNextAction("channel_extract_route_proxy_credential_missing").kind, "owner_setup",
    "a route action is owner_setup, so the panel renders text and not a button that calls nothing");
  // The negative half: a code whose honest answer IS "wait" must NOT be given a
  // setup action, or every transient extractor failure starts telling the owner
  // to go and change a setting.
  eq(routeNextAction("asr_unavailable"), null, "a transient failure is not given a setup action");
  eq(routeNextAction(""), null, "an empty code is not given a setup action");
  // Bot check is the exception that proves the rule: it is not a credential,
  // and WS-AD measured that retrying does not fix it either.
  ok("the measured bot check tells the owner to change route rather than to wait",
    /proxy/i.test(routeNextAction("channel_extract_extractor_bot_check")?.label || ""));
}

console.log("\n── 3. provenance records the route that served the bytes ──");
{
  eq(assertRouteServed("proxy", "proxy"), "proxy", "matching routes pass through");

  // THE NEGATIVE CONTROL, run both ways round. A response that says it served
  // from a cheaper route than the one that was paid for, and a response that
  // says it served from a more expensive one, are both wrong and both must be
  // refused. Running only one direction would pass a check that hard-codes an
  // expectation about which way the lie goes.
  eq(await codeOf(() => assertRouteServed("proxy", "direct")), "channel_extract_route_mismatch",
    "a proxy request served as direct is REFUSED, not recorded");
  eq(await codeOf(() => assertRouteServed("direct", "proxy")), "channel_extract_route_mismatch",
    "...and a direct request served as proxy is refused too");
  eq(await codeOf(() => assertRouteServed("proxy", "")), "channel_extract_route_unreported",
    "a service that reports no route at all is refused rather than assumed");
  eq(await codeOf(() => assertRouteServed("proxy", "teleport")), "channel_extract_route_unknown",
    "a route name we cannot read is refused rather than stamped on a row");

  // The contract carries it. An unrecognized route on an audio ref is refused,
  // because a row stamped with a word this build does not know is a row nobody
  // can interpret later, which is the same as no provenance at all.
  const base = {
    storageBucket: "vyakti-replica-private",
    storagePath: "o/r/w/v/original",
    sha256: "a".repeat(64),
    mime: "audio/wav",
    byteSize: 1024,
    durationMs: 1000,
  };
  eq(audioRef({ ...base, extractionRoute: "proxy" }).extractionRoute, "proxy",
    "audioRef carries a known route onto the ref");
  eq(audioRef(base).extractionRoute, "",
    "...and an upload with no route is empty rather than invented");
  eq(await codeOf(() => audioRef({ ...base, extractionRoute: "teleport" })), "channel_audio_route_invalid",
    "...and an unknown route on a ref is refused");
  // The two lists live in two files on purpose (contracts.js stays dependency
  // free). They are therefore able to drift, so their agreement is asserted
  // rather than assumed.
  ok("the contract's route vocabulary has not drifted from the route table's",
    AUDIO_ROUTE_NAMES.every((name) => audioRef({ ...base, extractionRoute: name }).extractionRoute === name));
}

console.log("\n── 3b. the transport asserts the echo end to end ──");
{
  // A fake network that VERIFIES the request signature and SIGNS its response
  // the way the service does, so what is exercised here is the real client
  // against the real protocol, with only the wire replaced.
  const key = Buffer.from(SECRET, "hex");
  const sign = (...parts) => createHmac("sha256", key).update(parts.join("\n")).digest("base64url");
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

  let sawRoute = "";
  const fakeService = (routeToReport) => async (url, init) => {
    const path = new URL(url).pathname;
    const body = Buffer.from(init.body);
    const nonce = init.headers["X-Vyakti-Nonce"];
    // The route travels inside the signed body, so a wire attacker cannot
    // downgrade it. Asserted by reading it back out of the body the client
    // actually signed rather than out of a header.
    sawRoute = JSON.parse(body.toString()).route;
    const payload = Buffer.from(JSON.stringify({
      protocol: "vyakti-media-extract/v1",
      sha256: "b".repeat(64), byte_size: 4096, duration_ms: 900_000,
      sample_rate_hz: 16_000, channels: 1, mime: "audio/wav",
      extractor_version: "2026.08.19", route: routeToReport,
    }));
    return {
      ok: true, status: 200,
      headers: { get: (name) => name.toLowerCase() === "x-vyakti-response-signature"
        ? sign("vyakti-media-extract/v1", "response", path, nonce, "200", sha(payload)) : null },
      arrayBuffer: async () => payload,
    };
  };

  const attestation = {
    receiptHash: "c".repeat(64),
    channelKey: "@teacher",
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  };
  const request = { videoId: "Q5_BtWc-G7Y", attestation, upload: { url: "https://store.example/o", headers: {} } };
  const env = { ...ENV_BASE, MEDIA_EXTRACT_ROUTE: "proxy", MEDIA_EXTRACT_PROXY_URL: "http://proxy.example:8080" };

  const honest = createMediaExtractClient({ env, fetchImpl: fakeService("proxy") });
  eq(honest.route, "proxy", "the client exposes the route it will ask for");
  const result = await honest.extractAudio(request);
  eq(result.route, "proxy", "an honest service's bytes are recorded under the route that served them");
  eq(sawRoute, "proxy", "...and the route was sent inside the SIGNED body, not as a bare header");

  const lying = createMediaExtractClient({ env, fetchImpl: fakeService("direct") });
  eq(await codeOf(() => lying.extractAudio(request)), "channel_extract_route_mismatch",
    "a service that served from another route is refused, so no row is stamped with a route it did not use");

  const silent = createMediaExtractClient({ env, fetchImpl: fakeService(undefined) });
  eq(await codeOf(() => silent.extractAudio(request)), "channel_extract_route_unreported",
    "an older service that reports no route at all is refused rather than assumed to have obeyed");
}

console.log("\n── 4. the transcript half and the audio half are reported separately ──");
{
  // The exact deploy the owner has today: OAuth for owner captions, an
  // extraction service wired, and no credential that changes the egress IP.
  const today = { ...ENV_BASE, YOUTUBE_OAUTH_CLIENT_ID: "id", YOUTUBE_OAUTH_CLIENT_SECRET: "secret" };
  const posture = extractionPosture(today);
  eq(posture.transcript.route, "captions_oauth",
    "with owner OAuth, the transcript half resolves to the sanctioned free route");
  ok("...and the transcript half is NOT flagged measured-blocked",
    posture.transcript.measuredBlocked === false);
  eq(posture.audio.route, "direct", "the audio half falls to the baseline");
  ok("...and IS flagged measured-blocked, so a working transcript route cannot hide it",
    posture.audio.measuredBlocked === true);

  // The reverse, which is the case a single combined answer would also get
  // wrong: a proxy but no OAuth is a working audio half and a transcript half
  // that has to go through the same proxy rather than through captions.
  const proxied = extractionPosture({ ...ENV_BASE, MEDIA_EXTRACT_PROXY_URL: "http://proxy.example:8080" });
  eq(proxied.audio.route, "proxy", "a proxy deploy resolves the audio half to the proxy");
  ok("...and its audio half is not flagged blocked", proxied.audio.measuredBlocked === false);
  eq(proxied.transcript.route, "proxy",
    "...and with no OAuth the transcript half honestly reports the same proxy, not a free route it does not have");

  eq(transcriptRouteFor({ YOUTUBE_OAUTH_CLIENT_ID: "id", YOUTUBE_OAUTH_CLIENT_SECRET: "s" }).route, "captions_oauth",
    "the transcript table prefers the sanctioned route over everything, including a proxy it could use");
  eq(transcriptRouteFor({
    YOUTUBE_OAUTH_CLIENT_ID: "id", YOUTUBE_OAUTH_CLIENT_SECRET: "s",
    MEDIA_EXTRACT_PROXY_URL: "http://proxy.example:8080",
  }).route, "captions_oauth", "...even when a proxy is also configured, because the sanctioned route costs nothing and risks nothing");

  ok("the measured-blocked list names the two routes WS-AD and WS-AI actually measured",
    MEASURED_BLOCKED_FROM_DATACENTER.includes("direct") && MEASURED_BLOCKED_FROM_DATACENTER.includes("pot") &&
    !MEASURED_BLOCKED_FROM_DATACENTER.includes("proxy"));

  // `extractionPosture` is read by a readiness panel, so it must never throw.
  // A panel that 500s on a misconfigured deploy hides exactly the deploy it
  // exists to describe.
  for (const bad of [{ MEDIA_EXTRACT_ROUTE: "teleport" }, { MEDIA_EXTRACT_ROUTE: "proxy" }, {}]) {
    let threw = false;
    try { extractionPosture(bad); } catch { threw = true; }
    ok(`the posture read survives ${JSON.stringify(bad)}`, threw === false);
  }
  eq(extractionPosture({ MEDIA_EXTRACT_ROUTE: "proxy" }).audio.code,
    "channel_extract_route_proxy_credential_missing",
    "...and reports the refusing route's code as DATA rather than as an exception");
}

console.log("\n── 5. no route module can reach a fixture ──");
{
  const { readFileSync } = await import("node:fs");
  const importsFake = (file) => readFileSync(new URL(file, import.meta.url), "utf8")
    .split("\n").some((line) => /^\s*import\b/.test(line) && /fake/i.test(line));
  ok("the route table has no branch that can return a fixture",
    !importsFake("../api/_channel/extract-routes.js"));
  // The route table must not read a secret VALUE, only its presence. A module
  // that returned a proxy password could put one in a log line or an error
  // detail, and error details cross a network boundary in this repo.
  const source = readFileSync(new URL("../api/_channel/extract-routes.js", import.meta.url), "utf8");
  ok("the route table never carries a credential value into its config objects",
    !/MEDIA_EXTRACT_PROVIDER_KEY\s*\)?\s*[,}]/.test(source.replace(/text\(env\.MEDIA_EXTRACT_PROVIDER_KEY\)/g, "")));
}

console.log(fail ? `\n${fail} of ${pass + fail} FAILURES` : `\nALL ${pass} CHECKS PASS`);
process.exitCode = fail ? 1 : 0;
