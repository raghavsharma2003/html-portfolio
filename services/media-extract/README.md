# media-extract — in-house YouTube audio extraction, gated on attestation

A CPU-only Container App that takes a **video id** (never a URL), verifies the
video belongs to a channel the teacher has **attested they own**, extracts
**audio only** with a pinned `yt-dlp`, normalizes it to the 16 kHz mono WAV
shape the rest of the replica pipeline speaks, and streams it to a pre-signed
Supabase upload target. It never holds media in memory and it never learns who
the teacher is.

It replaces the honest refusal that used to live in
`api/_channel/providers/youtube-oauth.js`. That refusal was correct about the
facts — the YouTube Data API has no download endpoint — and wrong about the
conclusion, because it treated a **ToS** question as if it were the whole of
the legal question. See §"The legal posture" below, which is the part of this
README that matters most.

---

## The legal posture, stated exactly

**Two different permissions, and they are not the same thing.**

1. **Copyright permission** — permission from the *rights holder* to make a
   copy of the work. This is the permission that carries statutory damages and
   the one whose absence is an infringement.
2. **ToS permission** — permission from *YouTube* to use their service in a
   particular way. YouTube's Terms restrict downloading except where the
   service allows it, where the rights holder permits it, or where applicable
   law does. A ToS breach is a **contract** matter between the account holder
   and Google; the remedies are account action or a civil claim, not a
   criminal one.

**Only the second of those is not ours to obtain, and only the first is.** The
teacher whose channel this is *is* the rights holder of their own lectures, so
their attestation gives us (1) directly and completely. It does **not** give us
(2) — nobody can grant YouTube's permission except YouTube, and the Data API's
`captions.download` is the only download YouTube itself sanctions, which is why
the OAuth provider still runs first and captions are still preferred.

So the honest statement of what this service is:

> Extraction proceeds on **copyright permission obtained from the rights
> holder**, and accepts a **residual Terms-of-Service exposure** that no
> permission we can collect eliminates. That exposure is a contractual risk to
> whatever YouTube account or IP the extraction egresses from — not a
> copyright risk — and it is bounded by the attestation gate, which makes the
> only content this service can ever touch content the teacher owns.

This is a synthesis of general-audience sources, **not legal advice and not
reviewed by a lawyer**, and it is flagged in those words here, at the file that
acts on it, for the same reason `youtube-oauth.js` flagged its own judgment:
a caveat that lives only in a research doc is a caveat nobody reads at the
moment it matters. The reversal condition is in
`context/decisions.md#youtube-extraction-in-house`.

**What this service structurally refuses to be.** Not a general-purpose
downloader, and not by policy — by construction:

- it takes an 11-character video id, so a URL cannot be expressed;
- it reads the video's uploader from YouTube's own metadata **before**
  downloading anything, and refuses (`channel_binding_mismatch`) unless it
  matches the attested channel key;
- it refuses without an unexpired attestation receipt hash
  (`attestation_missing` / `attestation_expired`);
- it will PUT bytes to exactly one host, `MEDIA_EXTRACT_UPLOAD_HOST`, and
  refuses to start without it;
- and the application plane will not even form a request unless a
  `vy_channel_watch` row exists whose owner holds a live
  `vy_channel_attestation` for that exact channel URL
  (`api/_channel-watch.js`, `attestedWatchForExtraction`).

Five layers, four of which are inside this service and one of which is a SQL
predicate. The house rule for a harm the next turn does not undo is two
independent layers; this has more because "a service that downloads any
YouTube video on request" is the exact thing that must never accidentally
exist.

---

## The field, as of 2026-08-26

Researched before writing a line of this, because the choice of extractor is
the whole maintenance cost of this service.

| option | state | verdict |
|---|---|---|
| **yt-dlp** | Date-versioned (`YYYY.MM.DD`); latest `2026.08.19`, with `2026.07.04`, `2026.06.09`, `2026.03.17` before it — roughly every 1–6 weeks, driven by breakage rather than a calendar. >1000 extractors. | **Chosen.** The only option with a maintenance cadence that tracks YouTube's changes. |
| **youtube-dl** | The upstream yt-dlp forked from in late 2020, precisely because its cadence had slowed. | No. |
| **pytubefix** | Actively maintained pytube fork, fixes land within days of breakage. Pure Python, no ffmpeg dependency. | Viable fallback if yt-dlp is ever unusable; smaller maintainer base is the risk. |
| **Cobalt** | Still maintained, but **YouTube downloads are currently non-functional** pending a fix. | No — a dependency whose YouTube support is presently down. |
| **Invidious** | Sharp decline in public instances through 2026 due to YouTube IP blocking; self-hosting now the recommendation, which just relocates the same IP problem to us. Piped is the healthier front-end but is not an extraction library. | No. |
| **alperensumeroglu/yt-audio-api** | The reference the owner pointed at: Flask + yt-dlp + ffmpeg, token-gated expiring MP3 downloads, MIT, ~12 commits, **no ToS or copyright disclaimer anywhere**. | Useful as a shape confirmation (yt-dlp → ffmpeg → expiring artifact) and explicitly **not** as a posture to copy — its missing disclaimer is the thing this README exists to not repeat. |

**What actually breaks**, and it is not the library:

- **PO tokens.** A Proof-of-Origin token is required by YouTube for several
  clients' format URLs; without one, requests return **HTTP 403** or get the
  account/IP **blocked**. Tokens are now **bound to the video id**, so one per
  video. yt-dlp's own guidance is to run a **PO token provider plugin**
  (`bgutil-ytdlp-pot-provider`). As of **July 2026** YouTube is rolling out
  enforcement of PO tokens for playback across more clients.
- **nsig / signature extraction.** YouTube rotates the player's `n`-parameter
  transform; a pinned yt-dlp eventually reports *"Signature/nsig extraction
  failed: Some formats may be missing"* and quality silently degrades or the
  download fails outright. This is the single most likely reason a working
  deployment stops working.
- **Datacenter IP blocking — the big one.** AWS/GCP/Azure/Hetzner/DO IP ranges
  are published and mapped. YouTube returns `LOGIN_REQUIRED` at the player API
  for datacenter IPs *before any stream URL is returned*, and reports of
  `"Sign in to confirm you're not a bot"` from cloud hosts are routine.
  **This service runs on Azure Container Apps, so it is squarely in that
  category.** Session cookies help and are invalidated faster when used from a
  datacenter IP; `--cookies-from-browser` is useless in a headless container
  and yt-dlp's OAuth login was removed. Reliable operation at scale needs
  residential/ISP/mobile egress.

The design answer to all three is the same and it is deliberate: **the failure
is typed, not swallowed.** `_classify()` maps yt-dlp's stderr to
`extractor_bot_check`, `extractor_po_token_required`,
`extractor_signature_failed`, `extractor_rate_limited`, `extractor_forbidden`,
`extractor_geo_blocked`, `video_unavailable`, and everything unrecognized stays
`extractor_failed`. Each of those lands on a `vy_ingest_run` row, so an
operator reading the runs table can tell "bump the pin" from "we need a
different egress" from "the teacher unlisted the video" without opening a log.
`MEDIA_EXTRACT_COOKIES_FILE`, `MEDIA_EXTRACT_PROXY` and
`MEDIA_EXTRACT_PLAYER_CLIENTS` exist as the knobs for the first two answers,
all optional and all off by default.

**Nothing here is measured yet.** No extraction against real YouTube has been
run from this deployment. The honest expectation from the sources above is that
the first live attempt from an Azure egress has a material chance of returning
`extractor_bot_check`, and the first measurement to take is exactly that one.
Saying so is cheaper than implying a coverage we do not have.

---

## Update policy — the pin has an expiry

`requirements.txt` pins `yt-dlp==2026.8.19` exactly. That pin is **not** a
"leave it alone" pin; extractors break and a stale pin is a broken service.

1. **On any `extractor_signature_failed`, `extractor_po_token_required` or
   `extractor_bot_check` run row**, check the latest yt-dlp release first.
2. **Monthly at minimum**, bump the pin to the newest release, rebuild, redeploy.
   The image is small and the app is CPU-only, so this is cheap.
3. **Never unpin.** A floating `yt-dlp` means the version that produced a
   corpus is unrecoverable, and `vy_ingest_run.stats` records
   `extractor_version` precisely so two runs stay comparable.
4. If a bump is not enough, the next lever is `MEDIA_EXTRACT_PLAYER_CLIENTS`
   (e.g. `android_vr`, which the PO-token guide lists as not requiring one),
   then a cookies file, then egress.

---

## Protocol

`POST /v1/extract`, `vyakti-media-extract/v1`, the same HMAC admission shape as
`services/voice-evidence` — signed over method, path, RFC3339 timestamp, nonce
and body digest; 60 s skew window; nonce replay denied; the response carries
`X-Vyakti-Response-Signature` over the nonce, status and response digest.

Request body (the whole of it — note the absence of any owner, replica,
person or transcript identifier):

```json
{
  "video_id": "dQw4w9WgXcQ",
  "max_duration_ms": 14400000,
  "attestation": {
    "receipt_hash": "<64 hex>",
    "channel_key": "@arjun-sir-physics",
    "expires_at": "2027-08-26T00:00:00.000Z"
  },
  "upload": { "url": "https://<project>.supabase.co/storage/v1/...token=...", "headers": {} }
}
```

Response:

```json
{
  "protocol": "vyakti-media-extract/v1",
  "video_id": "dQw4w9WgXcQ",
  "sha256": "<64 hex>",
  "byte_size": 55296044,
  "duration_ms": 1728000,
  "sample_rate_hz": 16000,
  "channels": 1,
  "mime": "audio/wav",
  "extractor": "yt-dlp",
  "extractor_version": "2026.8.19",
  "attestation_receipt_hash": "<64 hex>"
}
```

## Environment

| name | required | meaning |
|---|---|---|
| `MEDIA_EXTRACT_HMAC_SECRET` | **yes** | ≥32 bytes, hex or base64url. Startup fails without it. Its own copy — same *name* as the app plane's, a different *setting*. |
| `MEDIA_EXTRACT_UPLOAD_HOST` | **yes** | the one host PUTs may go to (the Supabase project host). Startup fails without it. |
| `MEDIA_EXTRACT_MAX_DURATION_SECONDS` | no | default `14400` (4 h), clamped to 6 h |
| `MEDIA_EXTRACT_MAX_AUDIO_BYTES` | no | default `268435456` (256 MB), clamped to 512 MB |
| `MEDIA_EXTRACT_TIMEOUT_SECONDS` | no | default `1800` |
| `MEDIA_EXTRACT_WORK_DIR` | no | default `/scratch` |
| `MEDIA_EXTRACT_COOKIES_FILE` | no | Netscape cookies path; used only if the file exists |
| `MEDIA_EXTRACT_PROXY` | no | egress proxy for the datacenter-IP problem |
| `MEDIA_EXTRACT_PLAYER_CLIENTS` | no | passed as `youtube:player_client=…` |

## Deploy

```
az acr build -r <registry> -t media-extract:<tag> services/media-extract
az deployment group create -g vyakti-voice -f services/media-extract/infra/main.bicep \
  -p image=<registry>.azurecr.io/media-extract@sha256:<digest> \
     managedEnvironmentId=<env id> \
     userAssignedIdentityResourceId=<identity id> \
     mediaExtractHmacSecretUri=<kv secret uri> \
     uploadHost=<project>.supabase.co \
     experimentId=<id> expiryAt=<RFC3339 Z>
```

The bicep declares an explicit **Startup** probe, carries **no** `gpu:` key and
**no** `initialDelaySeconds:` key, and sets `minReplicas: 0` — WS-L's three
deploy laws, applied rather than rediscovered.
