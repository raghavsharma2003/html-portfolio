// The push service worker. FETCHED ONLY WHEN PUSH IS CONFIGURED.
//
// `src/notify/push.ts` registers this file behind `pushConfigured()`, which is
// false in the shipping tree, so today no browser ever asks for it. It is
// committed anyway because a service worker must be served from the site root
// to hold the "/" scope, which means it cannot be produced by the bundler as a
// hashed asset — it is a static file or it is nothing.
//
// It is written against the PLATFORM push API (`self.addEventListener("push")`)
// rather than firebase-messaging-sw.js, for the same reason the client half
// carries no Firebase SDK: FCM web delivery IS standard Web Push, and the SDK
// on this side adds a second display path whose behaviour differs from this one
// in ways nobody would notice until a real notification looked wrong.
//
// ── THE PAYLOAD CONTRACT ──────────────────────────────────────────────────
//
// `api/_push.js` sends FCM HTTP v1 with a `data` block only, never a
// `notification` block. That is deliberate: an FCM `notification` block is
// displayed by the BROWSER before this file runs, so the copy rules in
// `src/notify/copy.ts` would be bypassed by whatever the server happened to
// put in it, and the tap route would be the origin rather than the thread.
// Data-only means every push this product can send is displayed by the code
// below, in one place, with one set of rules.
//
//   { title, body, largeBody?, kind, route }
//
// WS-R81: this file is ALSO the sibling worker for Vyakti Rooms' two
// account-wide push kinds that are not follower-facing — a creator's own
// weekly note (`api/_creator-push.js`) and an operator's own incident alert
// (`api/_incidents.js`) — registered directly by `src/studio/StudioApp.tsx`/
// `OpsBoard.tsx`, never through `src/notify/push.ts`. Those two now emit
// `public/room-sw.js`'s own documented `{t, title, body, url}` shape rather
// than this file's older `{kind, route}` names, so `t`/`url` are read here
// as ALIASES of `kind`/`route` (`data.t ?? data.kind`, `data.url ?? data.
// route`) rather than the older field names being retired — Meera's own
// sender (`api/_push.js`) is a different product built in this same repo
// and out of this workstream's scope to touch, so it keeps sending `kind`/
// `route` unchanged and this file keeps answering to both.
//
// UNLIKE room-sw.js, this file does NOT drop an unrecognised kind by name:
// it shows any payload that carries a non-empty title and body regardless
// of what `t`/`kind` says, exactly as it always has. Room-sw.js's own
// closed list (`checkin`/`renewal`/`dormancy`) is that OTHER worker's fix
// for a bug this file never had (its own "no silent push" law below already
// covers "never show nothing sensible") — and this file has no way to
// enumerate Meera's own kind vocabulary, which is not this workstream's to
// close over.
//
// ── WHY THERE IS NO SILENT PUSH ───────────────────────────────────────────
//
// The subscription is `userVisibleOnly: true`, and this handler always shows
// something. A push that arrives with no displayable text is DROPPED rather
// than shown as a placeholder: "Meera" with an empty body on a lock screen is
// the generic notification this whole workstream exists to not send. Browsers
// answer an unshown userVisibleOnly push with their own "This site has been
// updated in the background" message, which is ugly and is also the correct
// consequence — it makes a malformed send visible to us instead of silent.

/* global self, clients */

const TAGS = {
  reply: "meera-reply",
  missedCall: "meera-missed-call",
  story: "meera-story",
  // WS-R81: Vyakti Rooms' two account-wide kinds, keyed by the NEW `t`
  // value each builder now emits (`api/_creator-push.js`'s `creator_week`,
  // `api/_incidents.js`'s `incident`).
  creator_week: "vyakti-creator-week",
  incident: "vyakti-ops-incident",
};

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = {};
  }
  const data = d.data || d;
  // `t`/`url` (WS-R81, room-sw.js's own contract) are read as ALIASES of
  // this file's older `kind`/`route` names — see the header above for why
  // neither name retires the other here.
  const kind = typeof data.t === "string" && data.t ? data.t : (typeof data.kind === "string" ? data.kind : "");
  const title = typeof data.title === "string" ? data.title : "";
  const body = typeof data.body === "string" ? data.body : "";
  if (!title || !body) return; // never a placeholder — see the header
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      // One notification per KIND, replaced rather than stacked, exactly as the
      // fixed ids do on the local lane (src/notify/local.ts).
      tag: TAGS[kind] || "meera",
      renotify: false,
      icon: "/icon-192.png",
      // The BADGE is not a small icon — Android and Chrome mask it to a
      // monochrome silhouette, so a colour launcher icon (which is what this
      // was) arrives as a white blob in the status bar. `/badge-96.png` is
      // flat white on transparency at the 96px the spec asks for, the web
      // half of the same fix `ic_stat_meera` is on the native lane.
      badge: "/badge-96.png",
      data: { url: typeof data.url === "string" ? data.url : (typeof data.route === "string" ? data.route : "#chat") },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "#chat";
  event.waitUntil(
    (async () => {
      const open = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of open) {
        if ("focus" in c) {
          // An open tab is FOCUSED and routed, never replaced. Reloading a live
          // tab would throw away a draft he was typing and, if a call were up,
          // the call.
          await c.focus();
          if ("navigate" in c) await c.navigate(new URL(url, self.registration.scope).href);
          return;
        }
      }
      await clients.openWindow(new URL(url, self.registration.scope).href);
    })(),
  );
});
