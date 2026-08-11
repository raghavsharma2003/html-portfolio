# Auto-update (Android OTA)

The APK ships a copy of the web app inside itself. From now on it also checks,
on every cold start, whether the deployed site has a newer web bundle — and if
it does, downloads it, verifies it, and runs it from the **next** launch.

No plugin, no service. Capacitor's local server can host either the APK's own
assets or a directory under `filesDir`; an update is just "point it at a
different directory next time".

---

## Read this part first: what OTA cannot update

**OTA replaces the web app. It does not replace one line of Java.** If a change
touches anything in this list, the owner installs a new APK — there is no
version of this feature that fixes that, and pretending otherwise is how a phone
ends up running a web bundle that calls a method its APK does not have.

| Still needs a new APK | Where it lives |
|---|---|
| **Screen share / watch-together** — capture, frame cadence, the wake gates, the scene reader | `WatchPlugin.java`, `WatchCaptureService.java`, `WatchEngine.java`, `SceneReader.java` |
| **Her realtime voice on a call with screen share**, including the socket, barge-in, the audio floor, and her live personality note | `LiveWatchEngine.java` |
| **The call microphone** — the permission fast path and the mic hold | `CallMicPlugin.java`, `MicPermissionFastPath.java` |
| **The floating bubble** | `BubbleService.java` |
| **On-device speech recognition plumbing** | `PipedRecognizer.java` |
| App name, icon, splash, permissions, targetSdk, the OTA settings themselves | `AndroidManifest.xml`, `build.gradle`, `capacitor.config.ts` |

**What OTA does update**, which is most of what changes day to day: everything
under `src/` — her text persona (`src/engine/persona.ts`), the inner loop, the
chat UI, the onboarding, the voice-call web lane, memory handling, her photos
and stories, styles.

**What needs neither**: anything under `api/`. Those are server routes; a Vercel
deploy changes them for every phone immediately, with no app update at all.

---

## How it works

### Build side — `scripts/ota-bundle.mjs`

Runs from `scripts/vercel-build.sh` immediately after `vite build`, and **before**
the landing-page shuffle, because that shuffle renames `dist/index.html` to
`chat.html` and the phone loads `/` from the bundle root.

It emits into the deployed site:

```
ota/meera-<version>.zip    the web root, the same shape as assets/public
ota/latest.json           { version, sha256, url, min_native, bytes, built_at }
```

The manifest is **not** inside the zip. A document that carried its own hash
could not be used to check it, and the phone has to be able to refuse a bundle
before it opens it.

The zip is written by hand (no dependency, no `zip` binary): entries sorted,
timestamps pinned, already-compressed files stored rather than deflated. That
makes it deterministic — the same tree produces the same bytes and therefore the
same sha256, so a phone can tell "identical to what I am already running" from
"new".

`version` is `<UTC commit timestamp>-<first 7 of the bundle sha256>`, e.g.
`20260811191135-38f671d`. The timestamp orders versions; the hash names the
content. Commit time is preferred over build time so rebuilding a commit does
not invent a new version.

### Phone side

1. **`MainActivity.onCreate`, before `super.onCreate`** — `OtaUpdater`
   `selectWebRootForThisBoot()` picks this launch's web root and writes it to the
   SharedPreference the Capacitor Bridge reads while it is being constructed.
   It has to happen there: choosing later means `setServerBasePath`, which calls
   `loadUrl` on a live WebView and restarts her session under the user.
2. **After the Bridge exists** — a background check fetches `latest.json`.
3. If the manifest describes a bundle this APK may run, it is downloaded to
   `cacheDir`, its **sha256 is verified before anything is unpacked**, and it is
   unzipped into `filesDir/ota/<version>/` (to a scratch name, renamed on
   success, so a half-written bundle is never a bootable one).
4. It is then **staged**. Nothing changes in the running app. The next cold
   start boots it.

### Safety — the part that matters

The built-in assets are a permanent floor. Nothing writes to them and nothing
can remove them, so the worst case reachable by any bundle, any download and any
crash is *the app the APK shipped with*.

Above the floor is a chain, head first: `trial → current → previous → assets`.

- Every launch of a non-floor root spends an attempt.
- The web app signals it is alive by calling `MeeraUpdater.markLaunchOk()`. That
  clears the attempt count and promotes a trial to current.
- A root that spends **2 launches** without signalling is dropped, blacklisted
  (so it is not downloaded again), and the next slot down gets its own two.
  Trial fails → previous good. That fails too → the floor.
- A launch dismissed before the confirm window hands its attempt back, so two
  impatient taps do not look like two crashes.

Refused outright, never applied:

- sha256 that does not match the manifest (checked **before** unpacking)
- a zip entry containing `..`, an absolute path, a drive prefix or a NUL — that
  is a zip-slip write outside `filesDir`
- more than 8000 entries, a zip over 64 MB, or one that expands past 192 MB
- a bundle with no `index.html` at its root
- any URL that is not `https://`, and any redirect that changes protocol
  (`followSslRedirects(false)`); the manifest URL itself must be https, and
  `usesCleartextTraffic="false"` is stated in the manifest
- `min_native` greater than this APK's contract — see below
- a version string that is not `[A-Za-z0-9._-]{1,64}`; it becomes a directory
  name, and it arrives from the network

A new APK (`versionCode:versionName` changes) drops the whole chain and boots
the assets that came with it. Web and Java are coupled again at that moment, and
a bundle built for the old Java is not evidence about the new one.

### `min_native` — the coupling OTA breaks

`android/app/build.gradle` carries `OTA_NATIVE_CONTRACT`. Every bundle is
stamped with it as `min_native`, and an APK refuses a bundle whose `min_native`
is higher than its own.

**Bump it whenever the JS→Java surface gains something a web bundle could depend
on**: a new `@PluginMethod`, a new event name, a changed payload shape. Bundles
built after the bump are then refused by older APKs — which is correct, because
those phones need a reinstall anyway. `scripts/ota-bundle.mjs` reads that exact
line from `build.gradle`; there is deliberately only one copy of the number, and
the build fails rather than guessing it.

`MeeraUpdater.status()` reports `blockedByNative` when this is what happened, so
"nothing is updating" has a visible reason.

---

## The one change the web app still needs

The confirm signal is the whole rollback mechanism, and it has to come from code
that only runs when the app really rendered:

```ts
import { Capacitor, registerPlugin } from "@capacitor/core";
const Updater = registerPlugin<{ markLaunchOk(): Promise<void> }>("MeeraUpdater");
// after the chat surface has actually painted — not at module top level
if (Capacitor.isNativePlatform()) Updater.markLaunchOk().catch(() => {});
```

Until that lands, a **native fallback** stands in: if the page loads and
something has mounted into `#root` 3.5 s later, the launch counts as good. It is
deliberately weaker evidence — a bundle that mounts a broken tree passes it —
and it exists only so the feature is not inert. Replace it with the real call.

---

## Forcing an update

- **Normally**: deploy, then cold-start the app twice. First launch downloads and
  stages, second launch runs it.
- **Now, without waiting for a restart-and-restart**: from the web console or a
  dev build, `MeeraUpdater.check({ force: true })`. `force` skips only the
  policy refusals (not newer / already rolled back). It does **not** skip
  sha256, https or `min_native`, which are not policy.
- **What is going on**: `MeeraUpdater.status()` → running / current / trial /
  staged / previous / attempts / confirmed / blockedByNative / lastError.
- **From a terminal**, on a debug build:
  `adb shell run-as app.meera.companion cat shared_prefs/meera_ota.xml`

## Rolling back

- **The app does it itself** for a bundle that does not render: two silent
  launches and it reverts, permanently blacklisting that version.
- **By hand, to the previous bundle**: clear the app's data
  (`adb shell pm clear app.meera.companion`) — that empties both prefs and
  `filesDir`, so the next launch is the APK's own web app, and the next check
  fetches whatever is current.
- **To un-blacklist a version** that was rolled back but is actually fine:
  deploy again. A rebuild of a *newer* commit gets a new version string and is
  offered normally; the blacklist is keyed to the exact version.
- **To stop OTA entirely**: `enabled: false` in the `MeeraUpdater` block of
  `capacitor.config.ts`, then ship an APK. That block lives in the APK's assets
  and is not part of any bundle — deliberately, so an update cannot repoint the
  updater at another origin or switch itself back on.

---

## Gotchas

- **The zip only exists in the deploy that built it.** Each Vercel deployment has
  its own files, so `latest.json` and its zip always ship together. A phone
  holding a stale manifest just gets a 404 and tries again next launch.
- **Do not run `npx cap sync` on a `dist/` that still has `dist/ota/` in it** —
  Capacitor copies `webDir` wholesale and the APK would carry a 4 MB copy of a
  web bundle inside itself. `vite build` empties `dist`, and the APK workflow
  always builds before it syncs, so this only bites if you run
  `scripts/vercel-build.sh` and then sync by hand.
- **`versionCode` is still 1.** Nothing here depends on it being bumped, but the
  "new binary" reset keys off `versionCode:versionName`, so two APKs that differ
  only in Java look identical to it. Bump `versionCode` when shipping native
  changes and the reset does its job.

---

## Follow-up, not implemented here

`LiveWatchEngine.LIVE_NOTE` (`LiveWatchEngine.java:366`, appended in
`configure()` at :654) is her entire screen-share personality, and it is a Java
string constant — so today, changing how she behaves while watching your screen
requires a new APK, while changing how she behaves in chat does not. `configure()`
already parses a config JSON that JS sends (`systemLive`, `systemTail`,
`directive`); moving the note into a `liveNote` key on that object, with the
current constant kept as the fallback when the key is absent, would make it
OTA-updatable at the cost of one `optString`. Worth doing next: it moves the
most-edited native string in the app onto the side of the line that can ship
without a reinstall.
