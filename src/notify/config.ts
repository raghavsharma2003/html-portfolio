// ═══════════════════════════════════════════════════════════════════════════
// THE FCM SLOT — everything here is INERT until the owner pastes six strings.
// ═══════════════════════════════════════════════════════════════════════════
//
// WHY A SLOT AND NOT A FEATURE. Push (a message that reaches a phone whose app
// is not running at all) needs Firebase Cloud Messaging, which needs a Firebase
// project, which is an externally-configured service with its own console, its
// own billing relationship and its own service-account key. None of that can be
// created from inside this repo. What CAN be built without any of it is the
// entire plumbing on both sides of the missing keys, so that lighting it up is
// a paste rather than a workstream.
//
// So every push call site in this app is gated on `pushConfigured()`, and with
// the fields below empty:
//
//   * no service worker is registered,
//   * no token is ever requested from the browser or the phone,
//   * `api/push-token.js` answers 200 `{ stored: false }` and touches no table,
//   * `api/_push.js`'s send helper returns `{ sent: 0, reason: "unconfigured" }`
//     without a network call,
//   * and NOTHING in the local-notification path (the part that works today)
//     goes through any of it.
//
// The last line is the design: local notifications and push are two independent
// lanes that happen to share the copy layer. Push arriving later must not be
// able to change how the working lane behaves, and cannot, because the working
// lane never reads this file.
//
// ── WHAT THE OWNER PASTES, EXACTLY ────────────────────────────────────────
//
// These are the WEB half, and they are NOT secrets: a Firebase web config is
// public by design (it identifies the project; it authorises nothing on its
// own). That is why they can live in a committed file at all. The SERVER half
// — the service-account key that can actually send — goes in `api/_config.js`,
// which is gitignored, and its names are listed in `api/_config.example.js`.
//
//   1. console.firebase.google.com → create a project (or open the existing
//      one) → Project settings → General → "Your apps" → add a Web app.
//   2. Copy the `firebaseConfig` object it shows you into WEB_PUSH below:
//      apiKey, authDomain, projectId, messagingSenderId, appId.
//   3. Project settings → Cloud Messaging → Web configuration → "Web Push
//      certificates" → Generate key pair. Paste the public key as `vapidKey`.
//   4. Project settings → Service accounts → "Generate new private key". That
//      downloads a JSON file. From it, put into `api/_config.js`:
//         FCM_PROJECT_ID   = <project_id>
//         FCM_CLIENT_EMAIL = <client_email>
//         FCM_PRIVATE_KEY  = <private_key>   (keep the \n escapes intact)
//      and add the same three names to `scripts/write-config.mjs`'s STRINGS
//      list, or the deploy will have them locally and not in production —
//      which is the one place nobody is watching. (They are already listed
//      there; this step is here for whoever adds a seventh.)
//   5. Apply `db/migrations/015_push_tokens.sql`. Until push is configured no
//      row is ever written, so the migration is not needed before this point.
//   6. ANDROID ONLY, and only when the APK should receive push: put the
//      `google-services.json` for the same project at
//      `android/app/google-services.json`, add the Google Services gradle
//      plugin, and `npx cap sync android`. The web build needs none of this.
//
// Nothing else in the repo changes. `pushConfigured()` flips on its own the
// moment the six strings below are non-empty.

/** The Firebase web app config, verbatim from the console. Public by design. */
export const WEB_PUSH = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  messagingSenderId: "",
  appId: "",
  /** The Web Push certificate PUBLIC key (step 3). Also public. */
  vapidKey: "",
};

/**
 * Is the push lane configured at all?
 *
 * Every field, not "some" — a half-filled config is the state where a token
 * request fails at runtime in a way that looks like a permission problem, and
 * a wrong diagnosis of a permission problem costs a real user's trust in the
 * one prompt this app is allowed to show.
 */
export function pushConfigured(): boolean {
  return Object.values(WEB_PUSH).every((v) => typeof v === "string" && v.trim().length > 0);
}

/** Where the service worker lives. Only ever fetched when configured. */
export const PUSH_SW_PATH = "/push-sw.js";
