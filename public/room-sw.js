// The Room's service worker (WS-R22, migration 085) — `public/push-sw.js`'s
// own shape, scoped to `/r/` rather than Meera's `/chat`. Two jobs: hold the
// PWA install scope for `room.webmanifest`, and show a due check-in's push.
//
// ── THE PAYLOAD CONTRACT, AND WHY IT IS THIS THIN ──────────────────────────
//
// `api/_push/webpush.js`'s `checkinPushPayload` — the ONLY function in this
// repo that builds a Room push body — sends `{t:"checkin", r:<slug>,
// n:<the room's own PUBLIC display name>, th:<thread id or null>}`. It is
// content-free BY CONSTRUCTION (workstream law #1): there is no check-in
// title, no prompt shape, no reply text anywhere on the wire, so this file
// could not display any of that even if it wanted to. The notification body
// is therefore a FIXED sentence this file writes once, exactly the way
// `push-sw.js` refuses to show a placeholder for an empty FCM body — the
// difference here is the body is deliberately generic rather than absent,
// since "content-free" is the product decision, not a data gap to paper over.
//
// Tapping the notification opens `/r/<slug>` — the thread id, when the
// payload carries one, rides as a query param a future version of the Room
// can read; today every check-in lands in the follower's default room-wide
// thread, so `th` is null and the tap opens the room's own default view,
// which already IS the thread the message sits in.

/* global self, clients */

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  if (data.t !== "checkin") return; // an unrecognised payload shape is dropped, never guessed at
  const slug = typeof data.r === "string" ? data.r : "";
  if (!slug) return;
  const name = typeof data.n === "string" && data.n ? data.n : "Your creator";
  const thread = typeof data.th === "string" && data.th ? data.th : null;
  const route = thread ? `/r/${slug}?thread=${encodeURIComponent(thread)}` : `/r/${slug}`;

  event.waitUntil(
    self.registration.showNotification(`${name} AI has a check-in for you`, {
      body: "Tap to open the conversation.",
      tag: "vyakti-room-checkin",
      renotify: true,
      icon: "/favicon.svg",
      data: { route },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const route = (event.notification.data && event.notification.data.route) || "/r/";
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url.includes(route) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(route);
      return undefined;
    })(),
  );
});
