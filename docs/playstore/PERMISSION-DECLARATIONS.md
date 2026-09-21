# Permission declarations — Google Play Console

Covers the sensitive/restricted permissions declared in
`android/app/src/main/AndroidManifest.xml` that Play's Console asks for a
written justification on, plus the demo-video shot list each one needs and a
reviewer note about the OTA updater. Grounded in the manifest, `BubbleService.java`,
`WatchCaptureService.java` and `docs/AUTOUPDATE.md`.

---

## RECORD_AUDIO

**Console justification (paste into the permissions declaration form):**

> Maya is an AI companion the user can call by voice. RECORD_AUDIO captures
> the user's side of the call so Maya can hear and respond in real time. The
> permission is requested only when the user starts a voice call, never at
> app launch, and recording stops the moment the call ends.

**30-second demo video shot list:**

1. (0–4s) App home/chat screen, tap the call button.
2. (4–10s) Android's runtime microphone permission prompt appears; tap Allow.
3. (10–22s) Live call screen: show the call actually connecting and Maya
   responding to spoken audio (a visible waveform or speaking indicator is
   enough — audio itself doesn't need to be audible in a silent capture).
4. (22–27s) End the call from the in-app control.
5. (27–30s) Return to the chat screen, showing the call has ended and the mic
   is no longer active (no persistent mic indicator in the status bar).

---

## SYSTEM_ALERT_WINDOW

**Console justification:**

> During a screen-share "watch together" session the user is usually in
> another app, so Maya has no visible surface there. SYSTEM_ALERT_WINDOW
> draws a small floating bubble (`BubbleService`) over other apps as the only
> on-screen sign that Maya is still watching, and as a one-tap way back into
> the conversation. It appears only while a screen-share session is active
> and is removed when the session ends; it is never used for ads or unrelated
> overlays.

**30-second demo video shot list:**

1. (0–5s) Start a screen-share / watch-together session from inside the app.
2. (5–10s) Android's "draw over other apps" permission prompt (if not already
   granted) — grant it.
3. (10–14s) Session goes live; the floating bubble appears.
4. (14–22s) Switch to a different app (e.g. the home screen or another app)
   with the bubble still visible on top, showing its "watching" state.
5. (22–27s) Tap the bubble to return to the Maya conversation.
6. (27–30s) End the screen-share session and show the bubble disappearing.

---

## FOREGROUND_SERVICE_MEDIA_PROJECTION + FOREGROUND_SERVICE_MICROPHONE

**Console justification:**

> Watch-together screen sharing is entirely user-initiated: the user chooses
> to share their screen so Maya can see and comment on it while talking with
> them. `WatchCaptureService` runs as a foreground service of type
> `mediaProjection|microphone` for the duration of that session only, backed
> by Android's required persistent notification, and stops as soon as the
> user ends the share or the call. It is never started in the background and
> never runs without the user's own MediaProjection consent grant.

**30-second demo video shot list:**

1. (0–5s) From an active call, tap "share screen."
2. (5–11s) Android's system screen-capture consent dialog appears; accept it.
3. (11–14s) The persistent foreground-service notification appears (showing
   the app is capturing screen + using the microphone).
4. (14–24s) Show Maya commenting on what's on screen while the share is live
   (chat/voice response referencing what she's "seeing").
5. (24–28s) User ends the share from the in-app control.
6. (28–30s) Notification disappears, confirming the foreground service has
   stopped.

---

## Reviewer note: the OTA web-bundle updater

Paste this into the Console's "Explain this app's permissions/behaviour to
reviewers" free-text field, or an equivalent notes field on submission:

> Maya's Android app is a Capacitor WebView shell. Most of the app (chat UI,
> persona, onboarding, the voice-call web lane) ships as a web bundle inside
> `dist/`, and on cold start the app checks a signed manifest
> (`https://meera-silk.vercel.app/ota/latest.json`) for a newer bundle, verifies
> its SHA-256 before unpacking, and runs it from the next launch. This is
> JavaScript executing inside the WebView, which is the interpreted-code
> update path Play's policy explicitly permits (Play Console Help: "Device and
> Network Abuse" / interpreted-code exemption for JS/WebView content that
> doesn't change the app's primary purpose or declared permissions).
>
> What this cannot do: it cannot add, remove or change any native permission,
> add native code, or touch anything outside the WebView. Every native
> capability listed above (RECORD_AUDIO, SYSTEM_ALERT_WINDOW, the foreground
> services, `AndroidManifest.xml` itself) lives in Java that ships only in a
> new APK/AAB submission through this same Play Console flow, never through
> the OTA path: see `docs/AUTOUPDATE.md`, "what OTA cannot update." Each web
> bundle also declares a `min_native` version and is refused by any installed
> APK whose native contract is older, so a bundle can never assume a native
> capability the reviewed APK doesn't actually have. Bundles are downloaded
> over HTTPS only, with certificate and redirect checks, and a bundle that
> fails to render safely rolls back automatically within two launches to the
> last known-good bundle, with the APK's own shipped assets as an unremovable
> floor underneath everything.
