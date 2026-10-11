# Play Console Data Safety form — Maya

Source of truth for every row below is `site/privacy.html` ("What we
collect" / "What we don't do" / "Where it lives" / "Deleting your data"). If
the privacy page changes, this document is stale until it is re-derived from
it, not the other way round.

**Top-level answers**

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all user data encrypted in transit? | Yes (HTTPS end to end; `usesCleartextTraffic="false"` in `AndroidManifest.xml`, and the manifest URL / OTA bundle downloads are HTTPS-only per `docs/AUTOUPDATE.md`) |
| Do you provide a way for users to request that their data be deleted? | Yes: in-app ("Make her forget you") and at `https://meera-silk.vercel.app/delete-account`, with no app install required |
| Does your app have an account-deletion web page? | Yes: `https://meera-silk.vercel.app/delete-account` |
| Is data collection required or optional? | Chatting on the web needs no account ("Free. No account. No install.," `site/index.html`). Signing in (for cross-device sync) is optional and is where email/phone/Google identifiers are collected |
| Does the app show ads? | No |
| Does the app sell user data? | No |

---

## Data types collected

| Category | Data type | Collected? | Purpose | Shared with | Encrypted in transit | User can request deletion |
|---|---|---|---|---|---|---|
| Personal info | Email address | Yes, if you sign in | Account management, app functionality (sign-in, cross-device sync) | Supabase (processor, holds sign-in details) — not shared with advertisers | Yes | Yes |
| Personal info | Phone number | Yes, if you sign in | Account management, app functionality (sign-in, cross-device sync) | Supabase (processor) — not shared with advertisers | Yes | Yes |
| Personal info | Google account identifier | Yes, if you sign in with Google | Account management, app functionality | Google (as the sign-in provider), Supabase (processor) | Yes | Yes |
| Messages | In-app chat messages | Yes | App functionality (Maya's replies and memory), personalisation | AI model providers (OpenRouter, Google) to generate replies; Neon Postgres (processor, storage) | Yes | Yes |
| Messages | Voice-call content | Yes, as a transcript only | App functionality (Maya's replies and memory during calls) | AI model providers, for generating replies; Neon Postgres (storage) | Yes | Yes |
| Photos and videos | Photos you send in chat | Yes | App functionality (sharing photos with Maya) | Supabase (processor, storage) | Yes | Yes |
| Photos and videos | Screen-share frames (watch-together) | Yes, transiently during an active session | App functionality (letting Maya comment on what's on screen) | The AI model watching with you, for that session only; not stored anywhere afterwards | Yes | Not applicable — never persisted |
| App activity | Distilled memories (facts, people, places, plans, preferences extracted from conversation) | Yes | App functionality (personalisation, continuity between sessions) | Neon Postgres (storage) — not shared with advertisers | Yes | Yes |
| App activity | In-app actions: taps, scrolls, open/close events, reply latency, call and screen-share session detail | Yes | Analytics, app functionality (diagnosing what went wrong) | Not shared with third parties | Yes | Yes |
| App activity | Draft text, keystroke timings, pauses and corrections (including unsent drafts) | Yes | Analytics, app functionality | Not shared with third parties | Yes | Yes |
| App info and performance | Diagnostics (crash data, errors) | Yes | App functionality (diagnostics), analytics | Not shared with third parties | Yes | Yes |
| Audio | Raw voice-call audio | **No** — recorded audio is transcribed on-device; only the text transcript is uploaded, the recording itself never leaves the device | — | — | — | — |

Notes for the Console form:

- **"Shared" vs "processed"**: every third party listed above (Supabase, Neon,
  OpenRouter, Google, the AI model providers) is a service provider processing
  data on Maya's behalf to deliver the feature the data was collected for.
  None of them is an advertising or data-broker relationship, and none of this
  data is sold. Declare these as service-provider sharing for app
  functionality, not as third-party sharing for advertising or marketing.
- **No advertising ID, no ads SDK.** The app carries no ad network; `site/index.html`
  and `site/privacy.html` both state "no ads, anywhere, ever," and there is no
  ad-serving code in this repo to declare.
- **Data minimisation already implemented**: voice audio is deliberately not
  uploaded (transcript only) and screen-share frames are deliberately not
  stored — both are architectural choices in `site/privacy.html`, not just
  policy statements, so answer the relevant "is this data stored" sub-questions
  "no" for those two rows specifically.
- **Account is optional for the core web chat experience** but the native app's
  sync/reminder features depend on being signed in; answer the "is this
  collection required" sub-question per data type as shown above rather than
  applying one blanket answer to the whole form.
