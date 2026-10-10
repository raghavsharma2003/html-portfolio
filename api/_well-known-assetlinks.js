// api/_well-known-assetlinks.js — the decision logic behind
// GET /.well-known/assetlinks.json, where a fake `env` can reach it
// (WS-R169). Kept apart from the thin HTTP handler in
// api/well-known-assetlinks.js so this function is provable with a plain
// object, never a request/response pair.
//
// Android's Digital Asset Links v1 format — a statically-hosted JSON
// ARRAY (never an object at the root; the spec is explicit that the whole
// document is a list of statements):
// https://developers.google.com/digital-asset-links/v1/getting-started
//
// `android/app/src/vyakti/AndroidManifest.xml`'s intent filter carries
// `android:autoVerify="true"` on the `/r/` and `/c/` deep links (WS-R157).
// Android's app-links verifier fetches exactly this path at install time
// and only grants the "opens straight in the app, no chooser" behaviour
// when a statement here names the installed APK's own signing
// certificate's SHA-256 fingerprint. Nothing else in this file's contract
// changes that: this endpoint is read-only and has no other caller.
//
// The fingerprint is never a literal in this repo — CLAUDE.md's own rule,
// "never print or commit a secret; env var NAMES only, never values" — so
// it is read from `VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256` at request
// time, a `vercel-app` deployment-target var exactly like every other
// request-time secret this manifest documents (docs/gurukul/ENV-MANIFEST.md
// §6, `VYAKTI_PUBLIC_APP_ORIGIN`, is the nearest precedent: a name Gradle
// AND the app both read, never baked into the repo).
//
// context/STATE.md's own "nothing is configured live" is why the honest
// answer today, in every environment, is an EMPTY array — never a
// placeholder or example fingerprint. A non-empty statement carrying a
// fake fingerprint would make Android's verifier believe a link it has no
// right to believe, which is a worse failure than the deep link simply not
// verifying yet (an app that still opens, just behind a disambiguation
// sheet, rather than one that silently mis-claims a certificate it does
// not hold).

export const VYAKTI_PACKAGE_NAME = "app.vyakti.studio";

// Android's own documented shape: 32 upper-case hex octet pairs joined by
// colons (the exact string `keytool -list -v` prints for SHA256, and the
// exact shape Google's Play Console shows for the upload/app-signing
// certificate). Anything else is treated as absent rather than "trust it
// anyway" — a malformed value is exactly as unverifiable to Android as no
// value, so refusing to emit it is the honest behaviour, not a stricter one.
const SHA256_FINGERPRINT_RE = /^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/;

/** Pure: `env` -> the assetlinks.json document. `env` defaults to `{}` so a
 *  caller can prove the unset path without touching `process.env` at all. */
export function buildAssetLinksDocument(env = {}) {
  const raw = String(env.VYAKTI_ANDROID_CERT_FINGERPRINT_SHA256 || "").trim().toUpperCase();
  if (!SHA256_FINGERPRINT_RE.test(raw)) return [];
  return [
    {
      relation: ["delegate_permission/common.handle_all_urls"],
      target: {
        namespace: "android_app",
        package_name: VYAKTI_PACKAGE_NAME,
        sha256_cert_fingerprints: [raw],
      },
    },
  ];
}
