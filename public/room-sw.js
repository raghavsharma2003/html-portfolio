// The Room's service worker (WS-R22 migration 085; precache and offline
// shell added WS-R59; the push contract below rewritten WS-R81). `public/
// push-sw.js`'s own shape, scoped to `/r/` rather than Meera's `/chat`.
// Three jobs: hold the PWA install scope for the per-Room `manifest.
// webmanifest` (`api/_room-manifest.js`), precache the built shell so a
// follower on a bad connection opens the Room like an app instead of a
// spinner, and show a due push — a check-in, a renewal reminder, or a
// dormancy notice.
//
// ── THE PAYLOAD CONTRACT FOR PUSH (WS-R81) ──────────────────────────────
//
// Every push this platform ever sends to a follower's own device arrives as
// the SAME shape: `{t, title, body, url}`.
//
//   t      a CLOSED list this file owns: "checkin", "renewal", "dormancy" -
//          the only three kinds any Room builder in `api/_push/webpush.js`
//          (`checkinPushPayload`/`renewalPushPayload`/`dormancyPushPayload`)
//          has ever emitted or ever will without a matching edit HERE first.
//   title  the exact, fixed sentence a follower sees on their lock screen -
//          assembled server-side by the SAME payload function, never
//          composed in this file. Content-free BY CONSTRUCTION at the
//          SOURCE (workstream law #1, `api/_push/webpush.js`'s own header
//          on each builder): there is no check-in title, no prompt shape,
//          no reply text, no renewal date or amount, no follower-authored
//          word anywhere upstream of this string, so this file could not
//          display any of that even if it wanted to.
//   body   likewise fixed and content-free.
//   url    the exact route a tap should open - `/r/<slug>?via=push`, with
//          `&thread=<id>` appended for a check-in against a named thread
//          (today every check-in lands in the follower's default room-wide
//          thread, so this is always absent in practice).
//
// An unrecognised `t` is DROPPED, named once in a `console.warn`, never
// guessed at and never shown as a placeholder — `notificationclick` then
// focuses an existing window at `url` before opening a new one.
//
// `public/push-sw.js` is the SIBLING worker for this platform's two OTHER
// account-wide push kinds (a creator's weekly note, an operator's incident
// alert) - a second FILE, not a second contract: its own header documents
// the identical `{t, title, body, url}` shape. It does not share this
// file's closed-kind drop, because it is also Meera's own worker (a
// different product built in this same repo, out of this workstream's
// scope to touch) - see that file's own header for why.
//
// FOUND BUILDING THIS (WS-R81): before this fix, this file's own `push`
// handler checked `data.t !== "checkin"` and returned for EVERYTHING else -
// so `api/_renewals.js`'s own renewal push (WS-R37) has been silently
// discarded on arrival on every follower's own device for as long as it has
// existed, and `api/_dormancy.js`'s own dormancy notice (WS-R75) shipped
// with NO web-push send at all for exactly this reason (that workstream
// found the bug and declined to add a second, equally invisible send path -
// `context/rejected.md#ws-r75-web-push-type-switch-drops-every-non-checkin-
// payload`). Both now reach a phone; the dormancy sweep's own send is wired
// for the first time in `api/_dormancy.js` alongside this fix.
//
// ── THE PRECACHE, AND THE ONE LAW IT MUST NEVER BREAK ───────────────────────
//
// WS-R59's brief, verbatim: "network-first for everything under /api/ with
// NO caching of any /api/ response, ever ... a shared phone must never find
// a follower's words in a cache." Every conversation turn, every check-in
// design, every account setting travels over `/api/room`, `/api/checkins`,
// `/api/handoff` — one shared POST endpoint per surface, body-routed by `op`,
// so there is no URL shape that is "safe" to cache and no URL shape that
// carries the follower's own words either; the ONLY sound rule is a blanket
// one. The `fetch` handler below checks `pathname.startsWith("/api/")` as
// its very first statement and returns immediately, before calling
// `event.respondWith` and before touching `caches` at all — not "fetches
// and declines to store the result", which would still be one dropped
// `return` away from doing it anyway. No code path in this file that could
// call `cache.put`/`cache.add` on an `/api/` request exists to be reached;
// `evals/room-install/run.mjs`'s static scan and its NEGATIVE CONTROL (a
// worker source that DOES cache one) are what keep that true on every
// future edit, not just this one.
//
// What DOES get precached is the opposite of a follower's words: `room.html`
// and the hashed JS/CSS Vite emits for it, plus the Room's one icon
// (`favicon.svg`) — the same handful of bytes for every creator's Room,
// public before a follower ever types anything. There are no bundled font
// files to precache (`src/room/room.css`'s own comment: the Room relies on
// the PLATFORM's own Noto Sans Devanagari face, never a downloaded one), so
// the fonts entry in the precache list is empty by construction here, not an
// omission.
//
// `derivePrecacheList` fetches the REAL, currently-deployed `room.html` and
// reads its own `<script src>`/`<link href>` attributes rather than a
// baked-in list — Vite's content-hashed filenames (`room-yB2-ERyy.js`,
// `room-BKFbqJp1.css`, ...) already live inside that file, so this needs no
// build-hash injected into vite.config.ts: the cache name below is a SHA-256
// of the discovered URL set, which changes the moment a new build changes
// which files `room.html` references — `room-shell-<hash>` — and `activate`
// deletes every `room-shell-*` cache that is not the current one. A vite
// plugin that copied a manifest into this file would prove the same fact
// with a second moving part; reading the file the browser is about to
// request anyway proves it with none.

/* global self, clients, caches, fetch, crypto */

const SHELL_PATH = "/room.html";
const SHELL_ICON = "/favicon.svg";
const CACHE_PREFIX = "room-shell-";

/** PURE given its one side effect (the network fetch of `room.html` itself).
 *  Exported shape asserted by `evals/room-install/run.mjs`'s static scan:
 *  every discovered URL is same-origin, absolute, and NEVER under `/api/`. */
async function derivePrecacheList() {
  const res = await fetch(SHELL_PATH, { cache: "no-store" });
  const html = await res.text();
  const urls = new Set([SHELL_PATH, SHELL_ICON]);
  const attrRe = /\b(?:src|href)="(\/[^"]+)"/g;
  let m;
  while ((m = attrRe.exec(html))) {
    const url = m[1];
    if (url.startsWith("/api/")) continue; // never — see this file's own header
    urls.add(url);
  }
  const sorted = [...urls].sort();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sorted.join("|")));
  const hash = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 16);
  return { urls: sorted, cacheName: `${CACHE_PREFIX}${hash}` };
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const { urls, cacheName } = await derivePrecacheList();
        const cache = await caches.open(cacheName);
        await cache.addAll(urls);
      } catch {
        // Best effort, `recordRoomArrival`'s own posture (api/_room-surface.js):
        // a follower who installs mid-deploy, or offline, still gets the
        // shell over the network exactly as before this workstream — the
        // Room simply is not precached until the next successful install.
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Drop every room-shell-* cache except the CURRENT build's own name.
      // `install` (this same worker version, always run immediately before
      // `activate`) already opened and filled that one; re-deriving the name
      // here rather than reading a module-level variable is deliberate — a
      // service worker can be terminated and restarted between `install` and
      // `activate` (or long after), so nothing computed in memory during
      // `install` can be trusted to still be there. `caches.keys()` plus a
      // fresh `derivePrecacheList()` call is the only durable source of
      // truth for "which cache is the current one".
      const names = await caches.keys();
      const { cacheName: current } = await derivePrecacheList().catch(() => ({ cacheName: null }));
      // `current` is null only when THIS fetch of room.html itself failed
      // (offline, or a mid-deploy hiccup) — in that case skip pruning
      // entirely rather than treating "cannot tell which is current" as
      // "delete everything", which would wipe out the very cache `install`
      // just built for a follower who is activating this worker offline.
      if (current) {
        await Promise.all(
          names
            .filter((n) => n.startsWith(CACHE_PREFIX) && n !== current)
            .map((n) => caches.delete(n)),
        );
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // cross-origin: hands off entirely

  // THE ONE LAW: never intercepted, never cached, ever — see this file's own
  // header. This branch returns before `event.respondWith` and before
  // `caches` is touched at all, so there is no code path in this file that
  // can reach a `cache.put` for an `/api/` request.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    // Network-first for the page itself, so a follower with a real
    // connection always sees today's build; the precached `room.html` is
    // the OFFLINE fallback only, `RoomApp.tsx`'s own `offline` phase is what
    // renders once it boots from these cached bytes with no network under
    // it — never a stale conversation, because no conversation content ever
    // lives in this cache (the law above).
    event.respondWith(
      fetch(req).catch(async () => (await caches.match(SHELL_PATH)) || Response.error()),
    );
    return;
  }

  // A precached shell asset (JS/CSS/icon): cache-first for speed, network
  // fallback for anything this deploy's precache pass missed. `caches.match`
  // with no cache name searches every open cache, so this needs no
  // module-level `CACHE_NAME` that a restarted worker could have lost.
  event.respondWith(caches.match(req).then((cached) => cached || fetch(req)));
});

// The closed list this file owns — see the header above. Kept as a Set,
// named once, rather than a chain of `||` comparisons a future kind could
// be bolted onto without also touching the doc comment above it.
const KNOWN_PUSH_KINDS = new Set(["checkin", "renewal", "dormancy"]);

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const t = typeof data.t === "string" ? data.t : "";
  if (!KNOWN_PUSH_KINDS.has(t)) {
    // Ignored by NAME, never guessed at, never shown as a placeholder — the
    // exact drop this file's header explains was previously silent for
    // every kind but "checkin". Now only a genuinely unlisted kind is
    // dropped, and it says so.
    console.warn(`[room-sw] unrecognised push kind, dropped: ${t || "(none)"}`);
    return;
  }
  const title = typeof data.title === "string" ? data.title : "";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" && data.url ? data.url : "/r/";
  if (!title) {
    console.warn(`[room-sw] push kind "${t}" carried no title, dropped`);
    return;
  }

  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: `vyakti-room-${t}`,
      renotify: true,
      icon: "/favicon.svg",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/r/";
  event.waitUntil(
    (async () => {
      const all = await clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (client.url.includes(url) && "focus" in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
      return undefined;
    })(),
  );
});
