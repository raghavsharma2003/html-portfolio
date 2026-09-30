# Google Play submission checklist — Maya

Ordered, so it can be followed top to bottom. Cross-references the other
files in this folder rather than repeating them.

## 1. Build the release artifact

- [ ] Confirm the four signing secrets exist on the repo (Settings → Secrets
      and variables → Actions): `ANDROID_KEYSTORE_BASE64`,
      `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`.
      Without all four, `.github/workflows/build-apk.yml`'s `HAS_KEYSTORE`
      flag is false and the release-signing steps are skipped entirely — the
      workflow will still go green, producing only the unsigned debug APK.
- [ ] Push to `main` (or trigger the workflow manually) and let
      **Build APK** run to completion. It gates the same things
      `verify-release.mjs` gates (tsc, prompt budget, `context.mjs --check`,
      the persona-invariant and parser evals, the watch-lane native evals)
      before it ever touches Gradle — a red run here means the tree is not
      shippable, not that the workflow is wrong.
- [ ] Download the **`maya-release`** artifact from the completed run. It
      contains `app-release.aab` (upload this to Play Console) and
      `app-release.apk` (keep for local sanity-checking only; Play wants the
      `.aab`).
- [ ] Sanity-check `versionCode`/`versionName` in `android/app/build.gradle`
      were bumped if this release ships any native (Java) change — per
      `docs/AUTOUPDATE.md`, the OTA rollback chain resets on a binary version
      change, and an unbumped `versionCode` means Play will reject the upload
      as a duplicate version anyway.

## 2. Store listing

- [ ] Copy title, short description, and full description from
      `docs/playstore/LISTING.md` into Play Console → Grow → Store presence →
      Main store listing. Re-run the character counts if you edit any of them
      (30 / 80 / 4000 char limits).
- [ ] Produce and upload the 5 screenshots described in `LISTING.md`
      ("Screenshot scenes"), captured from the real running app, not mockups.
- [ ] Produce and upload the feature graphic per the concept in `LISTING.md`.
- [ ] App icon: already built (`android/app/src/main/res/mipmap-*`); confirm
      the 512×512 hi-res icon Play wants for the listing matches it.

## 3. Data Safety form

- [ ] Fill in Play Console → App content → Data safety using
      `docs/playstore/DATA-SAFETY.md` row by row. Pay particular attention to
      the two rows marked "not shared / not stored" (raw voice audio,
      screen-share frames) — those sub-answers differ from the rest of the
      table and are easy to get wrong if rushed.
- [ ] Confirm the account-deletion URL field is set to
      `https://meera-silk.vercel.app/delete-account` (this is a distinct field
      from the privacy-policy URL).
- [ ] Set the privacy-policy URL to `https://meera-silk.vercel.app/privacy`.

## 4. Permissions declarations

- [ ] For each flagged permission (RECORD_AUDIO, SYSTEM_ALERT_WINDOW,
      FOREGROUND_SERVICE_MEDIA_PROJECTION, FOREGROUND_SERVICE_MICROPHONE),
      paste the justification text from
      `docs/playstore/PERMISSION-DECLARATIONS.md` into the corresponding
      Console field under App content → Permissions declaration.
- [ ] Record the three 30-second demo videos per the shot lists in that same
      file, one per permission group, and upload them where Console asks for
      permission usage evidence.
- [ ] Paste the OTA-updater reviewer note (same file, final section) into the
      app-review notes field on the release, so a human reviewer sees the
      interpreted-code disclosure before they hit anything in the WebView
      that looks like a self-updating app.

## 5. Content rating

- [ ] Complete the IARC questionnaire using
      `docs/playstore/CONTENT-RATING.md` as the answer key, section by
      section. Confirm the resulting rating lands at 18+/Adults only before
      submitting it — if it doesn't, re-check the romantic-content and
      personal-information answers first.

## 6. Target audience and content

- [ ] Set target age group to 18+ only; do not select any child-directed or
      "appeals to children" options — this app is explicitly excluded from
      that policy track by its own content.
- [ ] Confirm "Ads" is answered "No ads" (matches `site/index.html` /
      `site/privacy.html`, "No ads, anywhere, ever").

## 7. Closed testing, before any production release

- [ ] **New (or recently reset) personal developer accounts must run a closed
      test before Play allows a production release**: minimum **12 testers**,
      opted in and actively using the build, for a minimum of **14
      continuous days**, before the production track becomes available. Set
      this up under Testing → Closed testing, using the same `.aab` from
      step 1.
- [ ] Recruit testers as a real opt-in list (an email list or a Google Group
      the testers join), not a placeholder — Play checks for actual opt-in
      participation, not just a track existing.
- [ ] Only move to production once the closed track has cleared both
      thresholds (tester count and duration) and Play Console shows the
      production-release option unlocked.

## 8. Final pre-submit pass

- [ ] Re-read `docs/playstore/LISTING.md`,
      `docs/playstore/DATA-SAFETY.md`,
      `docs/playstore/PERMISSION-DECLARATIONS.md`, and
      `docs/playstore/CONTENT-RATING.md` end to end for anything that has
      drifted from `site/privacy.html` or the manifest since this checklist
      was written — this pack describes the app as of the 2026-08-25 tree,
      and any later feature/permission change makes the affected file stale
      until it's re-derived.
- [ ] Submit the `.aab` from the closed-testing-cleared release for review.
