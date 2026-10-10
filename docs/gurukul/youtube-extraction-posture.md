# youtube-extraction-posture.md — what we built, what it removes, what it does not

**Audience: the owner, making a launch decision.** This page is written so that
it can be read once, in full, and acted on. It does not soften anything and it
does not argue against the decision that has been made — the decision is to
extract audio from teachers' own channels, gated on their attested consent, and
this page is the honest account of what that does and does not settle.

**It is not legal advice.** It is a synthesis of general-audience sources,
assembled by an engineer, on 2026-08-26. Every factual claim below has a source
in §5. Before scaling past a handful of teachers, a lawyer should read §1 and
§2 and say whether they agree.

---

## 1. The two permissions, and which one we can get

There are two separate permissions in play and they are routinely confused.

| | who grants it | what it covers | can we get it? |
|---|---|---|---|
| **Copyright permission** | the rights holder — for a teacher's own lectures, *the teacher* | making and using a copy of the work | **Yes, completely.** This is what the attestation records. |
| **ToS permission** | YouTube | using YouTube's service to download | **No.** Nobody can grant it but YouTube, and YouTube's Terms restrict downloading except where the service allows it, the rights holder permits it, or law allows it. |

The important asymmetry: **copyright is the one with statutory damages and the
one that can be infringed. ToS is a contract.** A ToS breach is a matter
between the account holder (or the IP address) and Google; the remedies
described in the sources are account suspension, banning, or a civil claim for
breach of contract — not criminal exposure, and not copyright damages.

So the honest one-sentence statement of our posture:

> We extract on **copyright permission obtained from the rights holder**, and we
> accept a **residual contractual exposure to YouTube** that no permission we
> can collect eliminates.

**What the attestation removes.** The whole of the copyright and likeness risk,
which is the large one: the teacher is the rights holder, the teacher is the
subject, and the teacher has recorded — in a hashed, dated, revocable artifact
— that they own the channel and authorize the use. There is no third party
whose work we are copying and no person whose likeness we are using without
their say-so. That is the entire premise of this platform and this lane does
not weaken it.

**What it does not remove.** YouTube's Terms restrict downloading *regardless of
who owns the video*. A teacher's permission does not bind Google. This is
residual and it is real.

Note the sources also say the reverse, and it is worth having in the same
paragraph: downloading **your own uploads** is described repeatedly as the
lower-risk case, and "a direct grant of permission from the copyright holder
overrides the general rules of copyright". Our situation is that case, plus a
platform whose Terms still say no. That is genuinely the whole of it.

### Mitigations actually implemented

Not aspirations — each of these is a line of code or a column:

1. **Owner-only content.** The service resolves the video's uploader from
   YouTube's own metadata *before downloading a byte* and refuses
   (`channel_binding_mismatch`) unless it matches the attested channel. It
   takes a video **id**, not a URL, so "download this arbitrary video" cannot
   be expressed as a request.
2. **No redistribution.** The audio goes to the private
   `vyakti-replica-private` bucket, scoped to `owner/replica/watch/video`, and
   is never served publicly. The clone emits its own synthesized voice, never
   the source audio.
3. **Retained as consented training evidence only.** It enters the same
   `vy_ingest_run` pipeline as an uploaded file and produces PROPOSED deltas a
   human approves. Nothing self-publishes.
4. **Deletion on revocation.** Revoking the attestation revokes the watch in
   the same statement, and `api/_replica-full-erasure.js` already deletes
   `vy_channel_watch` rows and the replica's private objects.
5. **A bounded term.** `expires_at` is NOT NULL and defaults to one year. A
   lapsed attestation stops extraction with no sweep and no cleanup job,
   because the predicate simply stops matching.
6. **Rate discipline.** `maxReplicas: 2`, one extraction per replica, a
   six-hourly sweep, a small batch, and a bounded back-catalogue page. We are
   not hammering anything.

---

## 2. The safer paths, and why extraction still had to exist

The brief asked for a materially safer path to be recommended as the default if
one gets the same data. Two exist, both are implemented, and **both run before
extraction** in the code — but neither is sufficient, and it is important to be
clear why.

**(a) Owner OAuth captions — `captions.download`.** YouTube's own sanctioned
download. It is quota-cheap, needs no media transfer, and carries **no ToS
exposure at all**. `api/_channel-ingest.js`'s `transcriptFor` tries it first,
always, with no flag — so on any video where it works, extraction never
happens.

*Why it is not enough:* `captions.download` returns only **manually-uploaded**
caption tracks. It refuses auto-generated (`trackKind: 'ASR'`) tracks for
everybody, the owner included. Indian coaching teachers essentially never
upload manual caption tracks for hour-long Hinglish lectures. In practice this
lane covers a small minority of the corpus.

*It also loses something extraction keeps:* a caption file has no audio. The
voice lane needs audio, and so does anything measuring delivery — pace, pauses,
laughter, stretch. Captions give us words; extraction gives us the person.

**(b) Direct upload by the teacher.** Already implemented as the `upload`
transcript source. Zero ToS exposure — the teacher exports their own file (via
YouTube Studio or Takeout) and hands it to us. Legally the cleanest thing on
this page.

*Why it is not enough:* it does not scale to a back catalogue. "Please download
and upload three hundred lectures" is not a request a teacher completes, and a
data source that depends on sustained manual effort produces one burst and then
nothing. It also cannot be a *loop* — "stays current" means noticing next
week's upload without asking.

**Recommended ordering, which is what the code does:**

```
owner captions (OAuth, sanctioned, free)
   → direct upload (teacher-initiated, zero exposure)
      → extraction (attested, in-house)          ← this lane
```

Extraction is the lane that makes the other two *sufficient* rather than the
lane that replaces them. It exists because it is the only one that reaches
years of a teacher's own recorded teaching without asking them to do anything.

---

## 3. What actually breaks, operationally

This is not a legal risk; it is the reason the service needs an owner.

- **Datacenter IP blocking.** The largest practical problem. Cloud IP ranges
  (AWS/GCP/**Azure**/Hetzner/DO) are published and mapped, and YouTube returns
  `LOGIN_REQUIRED` at the player API for them *before returning any stream
  URL*. `"Sign in to confirm you're not a bot"` from cloud hosts is routine.
  **Our service runs on Azure Container Apps.** Expect this.
- **PO tokens.** Required for several clients; absent, requests 403 or the
  IP/account gets blocked. Tokens are now bound per video id. As of **July
  2026** YouTube is rolling out enforcement for playback. Mitigation is a PO
  token provider plugin (`bgutil-ytdlp-pot-provider`).
- **nsig / signature rotation.** A pinned yt-dlp eventually reports
  *"Signature/nsig extraction failed"* and formats go missing. Mitigation is
  the update policy.

**Every one of these is a typed failure code on a `vy_ingest_run` row**
(`channel_extract_extractor_bot_check`,
`channel_extract_extractor_po_token_required`,
`channel_extract_extractor_signature_failed`, …). An operator reads the runs
table and knows which lever to pull without opening a log. The knobs are
`MEDIA_EXTRACT_COOKIES_FILE`, `MEDIA_EXTRACT_PROXY` and
`MEDIA_EXTRACT_PLAYER_CLIENTS`, all optional and all off by default.

> **UPDATE 2026-08-26 (WS-AD, then WS-AI).** This paragraph used to say
> "nothing here is measured". It is measured now, and the prediction below was
> right. `/v1/extract` returns `extractor_bot_check` on all ten player clients
> from the Azure egress, in 2 to 3 seconds, before any stream URL is issued;
> `/v1/enumerate` WORKS from the same egress in the same second. A second
> independent datacenter egress (GCP Ohio) reproduces the block, and the
> free PO-token lever moves metadata on a warm IP and produces zero audio
> bytes. The knobs listed above are now a proper ROUTE TABLE with one variable
> and per-route named refusals: see
> **`docs/gurukul/youtube-extraction-routes.md`**, which also carries the
> costed recommendation. Measurements:
> `context/measurements.md#youtube-extraction-blocked-from-azure` and
> `context/measurements.md#po-token-helps-until-the-ip-is-burned`.

**Nothing here is measured.** No extraction against real YouTube has been run
from this deployment. The honest expectation is that the first live attempt
from an Azure egress has a material chance of returning
`channel_extract_extractor_bot_check`, and that is the first measurement to
take. Saying so is cheaper than implying coverage we do not have.

---

## 4. The field, 2026-08-26

| option | state | verdict |
|---|---|---|
| **yt-dlp** | `YYYY.MM.DD` versioning; latest **2026.08.19**, preceded by 2026.07.04, 2026.06.09, 2026.03.17 — every 1–6 weeks, breakage-driven. >1000 extractors. | **Chosen.** The only cadence that tracks YouTube's changes. Pinned `2026.8.19`. |
| youtube-dl | The upstream yt-dlp forked from in late 2020 *because* its cadence had slowed. | No. |
| pytubefix | Actively maintained pytube fork; fixes within days. Pure Python, no ffmpeg. | Fallback if yt-dlp becomes unusable. Smaller maintainer base is the risk. |
| Cobalt | Maintained, but **YouTube downloads currently non-functional** pending a fix. | No. |
| Invidious | Public instances collapsed through 2026 under YouTube IP blocking; self-hosting recommended, which relocates our own IP problem rather than solving it. Piped is healthier but is a front-end, not a library. | No. |
| `alperensumeroglu/yt-audio-api` | The reference the owner pointed at. Flask + yt-dlp + ffmpeg, expiring tokenized MP3s, MIT, ~12 commits. **No ToS or copyright disclaimer anywhere.** | Confirms the shape (yt-dlp → ffmpeg → expiring artifact). Explicitly not a posture to copy — its missing disclaimer is what this document exists to not repeat. |

---

## 5. Sources

All fetched 2026-08-26.

- yt-dlp releases (version + cadence): <https://github.com/yt-dlp/yt-dlp/releases>
- yt-dlp PO Token Guide (per-client requirements, video-id binding, provider plugins, July 2026 rollout): <https://github.com/yt-dlp/yt-dlp/wiki/Po-Token-Guide>
- nsig / signature extraction failures: <https://github.com/yt-dlp/yt-dlp/issues/14707>, <https://github.com/yt-dlp/yt-dlp/issues/14836>
- Why yt-dlp keeps breaking (geo-blocks, PO tokens, cookies): <https://renderio.dev/blogs/ytdlp-geo-block-pot-cookies/>
- Datacenter IP blocking / `LOGIN_REQUIRED` for cloud egress: <https://ansaribilal.com/blog/ytagent-datacenter-ip-block-youtube-ai-agents-2026/>
- Cookies from datacenter IPs, `--cookies-from-browser` unusable headless, OAuth removed: <https://dev.to/osovsky/6-ways-to-get-youtube-cookies-for-yt-dlp-in-2026-only-1-works-2cnb>
- "Sign in to confirm you're not a bot": <https://vidkraken.com/blog/yt-dlp-sign-in-to-confirm-not-a-bot>
- ToS vs copyright, own-uploads as lower risk, remedies are contractual: <https://audioutils.com/blog/is-yt-dlp-legal>, <https://ytdlp-windows.com/safe-legal.html>, <https://easyytdown.com/blog/is-youtube-download-legal>
- Cobalt YouTube currently non-functional: <https://www.any-video-converter.com/hot-topic/cobalt-tools-alternative.html>
- Invidious instance decline under IP blocking: <https://factually.co/product-reviews/electronics-tech/best-privacy-focused-youtube-frontends-2026-invidious-piped-libretube-newpipe-ae52e7>
- pytubefix maintenance state: <https://roundproxies.com/blog/pytubefix/>
- The owner's reference implementation: <https://github.com/alperensumeroglu/yt-audio-api>

---

## 6. Where the code is

| thing | file |
|---|---|
| the service | `services/media-extract/` (app.py, Dockerfile, infra/main.bicep, README.md) |
| the transport | `api/_channel/media-extract-client.js` |
| the provider | `api/_channel/providers/youtube-extract.js` |
| the attestation + the gate | `api/_channel-watch.js` (`attestationForWatch`) |
| the endpoint | `api/channel-watch.js` |
| the schema | `db/migrations/057_channel_attestation.sql` |
| the studio | `src/studio/IngestChannelStudio.tsx` |
| the proof | `evals/mediaextract.mjs` (36 checks, incl. the negative control) |
| the decision | `context/decisions.md#youtube-extraction-in-house` |
| **the route table (WS-AI)** | `api/_channel/extract-routes.js`, `evals/extractroutes.mjs` |
| **the route choice, costed** | `docs/gurukul/youtube-extraction-routes.md` |
