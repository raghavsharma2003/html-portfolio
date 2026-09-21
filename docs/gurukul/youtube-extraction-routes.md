# youtube-extraction-routes.md — the two halves, the four routes, and the one number

**Audience: the owner, choosing and paying for one thing.** The ask was "can at
least we have youtube video scraping if not the channel full scraping for now?
what can we do, should we do some 3rd party thing here because we need it to
work." This page answers it with a recommendation and a number rather than a
menu, and it separates the half that is already unblocked from the half that is
not, because one working half hiding a blocked one is the specific way this
question gets answered wrongly.

Companion to `youtube-extraction-posture.md`, which is the legal and safety
posture and has not changed. Nothing here weakens the attestation gate: every
route below runs behind the same four layers.

---

## 0. The one-paragraph answer

The transcript half and the voice half are different problems. **The transcript
half already works for the videos a teacher captioned by hand, through
YouTube's own sanctioned API, and it is blocked for everything else.** **The
voice half needs a residential proxy and there is no free way around it.** The
recommendation is **IPRoyal residential, pay as you go, $7.00/GB with a $7
minimum and traffic that does not expire**, which is roughly **$0.08 for a
15 minute lecture**. It is not the cheapest per gigabyte. It is the cheapest way
to find out whether this works at all, which is the decision actually in front
of us.

---

## 1. The transcript half

**Verdict: partly unblocked, today, with no proxy and no grey zone. The rest is
blocked and no free route rescues it.**

| route | needs | measured from a datacenter IP |
|---|---|---|
| **Data API `captions.download`** (owner OAuth) | the teacher's OAuth grant | **reachable.** The API answers a datacenter IP normally: `videos.list` with no key returned a plain `403 "Method doesn't allow unregistered callers"` in **0.15 s**, which is an API error and not a bot check. There is no IP reputation problem on this surface at all. |
| public `timedtext` | nothing | **blocked.** `429` with Google's "Sorry" interstitial in 0.37 s. |
| InnerTube `/youtubei/v1/player` | nothing | **blocked.** WEB client returned `playabilityStatus: LOGIN_REQUIRED`, "Sign in to confirm you're not a bot", 0 caption tracks, 0 formats. ANDROID and IOS contexts returned `HTTP 400`. TVHTML5 returned "no longer supported in this application or device". |
| `youtube-transcript-api` (Python) | nothing | **blocked.** Raised its own `IpBlocked` exception, whose message names cloud provider IPs as the cause. |
| public Invidious / Piped instances | nothing | **all dead.** 7 instances probed, 0 usable: `401`, `403 Endpoint disabled`, `403`, `502`, `526`, `403`, `502`. |
| third-party transcript API | a paid key | **not tested.** Costs money and an account, and this session has no authority to open either. |

**What that means in practice.** `captions.download` returns only
**manually uploaded** caption tracks and refuses auto-generated (`ASR`) ones
even for the channel owner. Indian coaching teachers essentially never upload
manual tracks for hour-long Hinglish lectures. So the sanctioned route is real,
free, safe and covers a small minority of the corpus, exactly as
`youtube-extraction-posture.md` §2 said before any of it was measured.

Everything that would cover the rest of the corpus without media bytes goes
through the same player surface the audio does, and is blocked by the same IP
reputation. **There is no free transcript route hiding behind the audio
problem.** If we want the words for an uncaptioned lecture, we need either the
teacher to export their own file (already implemented, the `upload` lane), a
third-party transcript API, or the same proxy the voice half needs.

The one genuinely useful consequence: **a proxy bought for the voice half
unblocks the transcript half too, and unblocks it more cheaply.** A
transcript-only pull needs the player response and a caption file, not the
media stream, which is roughly 4 MB rather than 11 MB.

---

## 2. The voice half

**Verdict: blocked, and the free lever is now measured as well as reasoned.**

WS-AD measured that all ten yt-dlp player clients are refused from Azure
Central India. This session added the lever that
`rejected.md#player-clients-do-not-beat-a-datacenter-ip` named as its own
reversal condition, the `bgutil-ytdlp-pot-provider` PO token plugin, and
measured it from a Google Cloud egress in Ohio:

- **While the IP was warm:** with the PO token provider, metadata succeeded
  **5 of 6**. Without it, in the same interleaved trials, **1 of 6**. The lever
  is connected and it is real.
- **Audio bytes, same session:** **0 of 12**. The best any trial reached was a
  format selection followed by `HTTP 403` on the media fetch.
- **After roughly forty requests over half an hour:** the same A/B returned
  **0 of 4 with the provider and 0 of 4 without**. The help had vanished
  entirely.

Full method and numbers: `measurements.md#po-token-helps-until-the-ip-is-burned`.

**The conclusion is the one WS-AD's entry already pointed at, now with a second
independent egress behind it: the variable is the IP, and a PO token is a
mitigation for a warm IP rather than a route.** A free, self-hosted PO token
provider is worth having wired, and it is not the answer.

---

## 3. The routes, costed

A 15 minute lecture is roughly **11 MB (0.011 GB)** through a proxy: about
6.8 MB of Opus audio at format 251, plus about 4 MB of watch page, player
JavaScript and player API JSON. A 45 minute lecture is roughly 0.033 GB.

| route | what it costs | per 15 min video | honest state |
|---|---|---|---|
| **direct** | nothing | n/a | **measured blocked.** WS-AD n=10 clients from Azure; WS-AI 0/12 audio from GCP. |
| **pot** (self-hosted `bgutil-ytdlp-pot-provider`, MIT, free) | nothing but a container | n/a for audio | **measured: helps metadata on a warm IP, does not deliver bytes, stops helping once the IP is burned.** Wired, not recommended alone. |
| **proxy**, IPRoyal residential PAYG | **$7.00/GB**, 1 GB minimum, traffic does not expire | **$0.077** | **untested by us.** No credential, and this session has no authority to buy one. |
| **proxy**, Evomi residential | **$0.49/GB**, but a 100 GB/month floor at **$49.99/month** | $0.005 | untested. Cheapest per GB, wrong shape for a first trial. |
| **proxy**, Oxylabs residential | ~**$8/GB** PAYG; $30 for 5 GB on the Starter plan | ~$0.088 | untested. |
| **proxy**, Bright Data residential | **$8.40/GB** PAYG, down to ~$3.50/GB on the $499/month Growth plan | ~$0.092 | untested. |
| **cookies** from a logged-in account | nothing in money | free | **not recommended.** See §5. |
| **provider**, Apify `truefetch/youtube-video-downloader` | $0.01 actor start + $0.10 metadata + $0.30 download | **$0.41** | **no audio-only mode.** It downloads video files, so we pay for and transfer megabytes we then throw away. |
| **provider**, cobalt public API | n/a | n/a | **unusable.** `POST https://api.cobalt.tools/` returned `{"status":"error","error":{"code":"error.api.auth.jwt.missing"}}`, HTTP 400. Anonymous access is closed. Self-hosting relocates our own IP problem rather than solving it. |
| **provider**, Supadata (transcripts only) | free tier 100 credits/month; Pro $17 for 3,000 credits; 1 credit per transcript | ~$0.006 per transcript | transcript half only, gives no audio and therefore no voice. |
| **provider**, RapidAPI YouTube-to-MP3 services | subscription tiers, per-vendor | **[UNVERIFIED]** | Could not confirm current per-request pricing for any specific vendor. Most publish no terms and no ToS position. |
| `alperensumeroglu/yt-audio-api` (the owner's reference) | nothing, it is our own code | n/a | It is yt-dlp in a Flask wrapper. It has the same IP problem we have, plus no ToS or copyright disclaimer anywhere, which is the posture `youtube-extraction-posture.md` exists to not repeat. |

Sources are listed in §7. Anything marked **[UNVERIFIED]** was not confirmed
against a current pricing page and is not estimated here.

---

## 4. The recommendation, and why it beats the others

**Use `MEDIA_EXTRACT_ROUTE=proxy` with IPRoyal residential, pay as you go.**

- **It is the only lever that changes the measured variable.** Two independent
  datacenter egresses, twenty-odd measured attempts, and the free levers do not
  produce audio bytes. Nothing except a different IP has ever moved this.
- **It is the cheapest route to the FIRST ANSWER, which is the decision we are
  actually making.** Evomi is fourteen times cheaper per gigabyte and demands
  $49.99/month to find that out. IPRoyal costs **$7 once**, its traffic does not
  expire, and $7 buys roughly **90 fifteen-minute lectures**. If it works, we
  switch to a cheaper vendor at volume with no code change, because the route is
  a URL in an environment variable. If it does not work, we are out $7.
- **It beats every third-party API on price and on shape.** Apify is $0.41 per
  video, five times the proxy, and has no audio-only mode, so it also transfers
  video frames we discard. cobalt is closed to anonymous callers. The RapidAPI
  vendors would not confirm pricing and mostly publish no terms.
- **It buys both halves at once.** The same credential unblocks transcripts for
  uncaptioned lectures, which nothing else on this page does.
- **It does not risk an account.** The cookies route is free and is the only
  option here whose downside is somebody's Google account.

**Per clone, all in, at the recommended route:** a 15 minute video is about
**$0.077** of proxy traffic. A teacher's first ten lectures cost under a dollar.
A 300 video back catalogue of 45 minute lectures is about 10 GB, so **about
$70** at IPRoyal or about **$5** at Evomi's volume rate once volume is proven.

---

## 5. The cookies route, stated plainly

It is wired, it costs nothing, and it is **not** the recommendation. The risks,
said out loud rather than in a footnote:

- **It ties extraction to a real Google account.** Every request we make is made
  as that person. YouTube's remedies for ToS breach are account level.
- **The account can be flagged or terminated.** From a datacenter IP, which is
  the harsh case, this is the documented failure mode rather than a theoretical
  one.
- **Cookies expire.** Sessions used from an unfamiliar datacenter egress are
  invalidated in days to weeks, so this is a route somebody has to keep feeding.
- **The cookie jar is a live credential in our infrastructure.** It is written
  to scratch with mode `0600`, never logged and never echoed, and it is still a
  Google session sitting in a container.

If it is ever used, it should be a **throwaway account created for the purpose,
never the teacher's and never ours**, and the owner should decide that
knowingly rather than discover it.

---

## 6. Switching a route on

One variable. Nothing else changes, and nothing needs a redeploy of the
application plane.

```
MEDIA_EXTRACT_ROUTE=proxy               # on the media-extract container app
MEDIA_EXTRACT_PROXY_URL=http://USER:PASS@geo.iproyal.com:12321
MEDIA_EXTRACT_PROXY=http://USER:PASS@geo.iproyal.com:12321
```

`MEDIA_EXTRACT_ROUTE` and `MEDIA_EXTRACT_PROXY_URL` are read by the application
plane, which is what makes the refusal land on the run row with a name;
`MEDIA_EXTRACT_PROXY` is read by the service, which is what actually reaches
yt-dlp. Both are set to the same value. Where to get the credential: an IPRoyal
account, Residential Proxies, "Pay as you go", then the generated
`user:pass@host:port` from the proxy dashboard.

The other routes, for completeness:

| route | application plane | service |
|---|---|---|
| `direct` | nothing | nothing |
| `pot` | `MEDIA_EXTRACT_POT_PROVIDER_URL` | `MEDIA_EXTRACT_POT_PROVIDER_URL` |
| `cookies` | `MEDIA_EXTRACT_COOKIES_B64` or `_FILE` | same |
| `provider` | `MEDIA_EXTRACT_PROVIDER` + `MEDIA_EXTRACT_PROVIDER_KEY` | `MEDIA_EXTRACT_PROVIDER_KEY` |

**A route whose credential is absent refuses by its own name.** Setting
`MEDIA_EXTRACT_ROUTE=proxy` and forgetting the URL does not fall back to
`direct` and does not report a generic failure: the run row carries
`channel_extract_route_proxy_credential_missing`, and the owner's Activity
surface renders "This deployment is set to reach YouTube through a proxy, but no
proxy address has been given to it." with the next action "Add the proxy address
to the deployment settings".

**And a route never gets credit for another route's work.** The service echoes
the route it actually ran; the client refuses the result if it is not the route
it asked for (`channel_extract_route_mismatch`). This exists because on the
happy path a paid proxy extraction and a free direct one return an identical
WAV, and the only moment the difference is visible is the moment something
asserts it. `evals/extractroutes.mjs` runs that assertion's negative control in
both directions.

**No `provider` adapter ships in this build.** Selecting `provider` refuses at
`route_provider_adapter_unavailable` rather than quietly running direct. The
seam is there; the vendor is the owner's call and nobody has made it.

---

## 7. Sources

Fetched 2026-08-26 unless noted.

- IPRoyal residential pricing: <https://iproyal.com/residential-proxies/>
- Evomi pricing: <https://evomi.com/pricing>
- Bright Data residential pricing (via published summaries; the pricing page
  itself 404ed to our fetcher): <https://aimultiple.com/proxy-pricing>, <https://dataresearchtools.com/bright-data-pricing-2026/>
- Oxylabs residential pricing (same caveat): <https://aimultiple.com/proxy-pricing>, <https://dataimpulse.com/blog/oxylabs-pricing-explained/>
- Apify actor pricing: <https://apify.com/truefetch/youtube-video-downloader>
- Supadata pricing: <https://supadata.ai/pricing>
- cobalt API auth requirement: measured, `POST https://api.cobalt.tools/`
- PO token provider: <https://github.com/Brainicism/bgutil-ytdlp-pot-provider>
- The owner's reference implementation: <https://github.com/alperensumeroglu/yt-audio-api>

---

## 8. Where the code is

| thing | file |
|---|---|
| the route table | `api/_channel/extract-routes.js` |
| the transport, which asserts the echo | `api/_channel/media-extract-client.js` |
| the provenance field | `api/_channel/contracts.js` (`audioRef.extractionRoute`) |
| the service side | `services/media-extract/app.py` (`_route`, `_common_args`) |
| the readiness answer, both halves | `api/_channel/registry.js` (`channelExtractionPosture`) |
| the owner-facing reasons and actions | `api/_replica-activity.js` (`REASONS`, `routeNextAction`) |
| the proof | `evals/extractroutes.mjs` (81 checks, negative control both ways) |
| the measurement | `context/measurements.md#po-token-helps-until-the-ip-is-burned` |
| the decision | `context/decisions.md#residential-proxy-is-the-audio-route` |
