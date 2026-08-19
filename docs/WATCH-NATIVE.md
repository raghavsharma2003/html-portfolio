# Watch-together on Android: how a native session records a shared moment

WS-ANDROID-WATCH. Companion to `docs/SPEC-SELF-LAYER.md` §4 and to the web
lane's own notes inside `src/components/useCallEngine.ts`.

## The gap this closes

The web screen-share lane records what she watched with you — a
`vy_shared_moment` row, via `op:"watch_moment"` on `/api/episodes`. The native
Android lane recorded nothing, because it never runs `src/watch/scene.ts`: it
runs `SceneReader.java`, its line-for-line twin, inside the capture service.
`pendingShowWake` was therefore always null in a native session and
`noteHerLine` never produced a write. Safe, but everything a user watched with
her on the phone vanished.

## The shape: the native lane REPORTS, the web layer RECORDS

```
SceneReader.java              geometry — "something happened, and this is what kind"
  └ WatchCaptureService.dispatch()
      ├ look-away, blank, held/fresh-frame gates
      └ LiveWatchEngine.nudge() / WatchEngine.nudge()
           her voice · quiet floor · show floor · ambient share · hard ceiling
      └ if (sent) → emitShowWake()  ── "watchwake" {class} ──▶  JS
                                                                │
src/native/watch.ts  (one listener, dispatched to the owning session)
                                                                │
src/components/useCallEngine.ts                                 ▼
   armMomentWindow(...)  ──  the SAME gate the web lane arms  ──  consumeMomentWindow()
                                                                  └ postWatchMoment()
```

The native side does **not** post to `/api/episodes` itself. The recording gate
is one pair of pure functions in one place, already shipped and covered by
`evals/multimodal/`; a second copy in Java would be a second thing to drift,
and drift is the exact failure the Java geometry's line-for-line discipline
exists to prevent. What crosses the bridge is a **wake class name and nothing
else** — no picture, no text, no claim.

## The guarantees, and where each one lives

- **Every suppressor transitively suppresses recording.** `emitShowWake` sits
  *inside* `dispatch()`'s `if (sent)` branch, i.e. downstream of the look-away,
  the blank guard, the held/fresh-frame gate, and the engine's own her-voice,
  quiet-floor, show-floor, ambient-share and per-minute-ceiling gates — and
  downstream of everything `SceneReader` already refused (scroll-as-translation,
  edge-anchored overlays, `wake-dedupe`). A suppressed wake is never reported,
  so it can arm nothing, so it writes nothing. Position is the mechanism, not a
  second check.
- **`wake-dedupe` is untouched.** The "duplicate" pictures measure 0.00–0.77 MAD
  at 16×16 (`rejected.md`): the mechanism is correct and its misses are not a
  bug. Nothing here loosens it; the spoken ring is charged by the same
  `scene.noteWake()` call that precedes the report.
- **FLAG_SECURE / blackout stores zero rows.** `emitShowWake` refuses a blank
  frame *by name*. That guard is deliberate rather than incidental: `pick()`
  guards its SHOW branches with `!blank` and its **ambient branches with
  nothing**, in `SceneReader.java` exactly as in `scene.ts`, so an `idle`/`along`
  wake genuinely can fire during a blackout. Nothing recordable comes of it
  either way — only SHOW classes are reported and only SHOW classes arm — but
  the most privacy-charged instant on the platform should not be safe by luck.
- **The fabrication guard holds.** Only `watch_moment` is ever written, and it
  stores **her reaction**, which is true regardless of whether the screen-reading
  behind it was. `watch_visual` / `vy_visual_assertion` stays unwired: it
  requires claim + extractor_model + confidence, and this lane produces a
  conversational line rather than a scored claim. Inventing a confidence number
  would be fabricating metadata about fabrication risk. `native-gate.mjs`
  asserts that no code under `android/` names an episode op or an assertion
  table.
- **Fire-and-forget.** The Java report is a `try/catch`-swallowed
  `notifyListeners`; the JS callback only assigns a ref. Neither can throw into
  the capture path, the speech path or the call path, and neither is awaited.

## Tests

- `evals/multimodal/native-gate.mjs` — compiles and **runs** the real
  `SceneReader.java` (it imports nothing from Android) against the bundled
  `scene.ts` over the same frames, and diffs the wake sequences tick for tick:
  blackout, landing, the ImageReader-null still path, away-and-back to the same
  picture, scroll, overlay banner, pointer. It then feeds the **real Java wake
  log** through the **real bundled** `armMomentWindow`/`consumeMomentWindow` and
  asserts the recorded moments. The parts that cannot run off-device (the
  service and the two engines both need Android) are asserted against their real
  source text, by name and by position.
- `evals/multimodal/scene-gate.mjs` §4 — the bridge boundary: a class name
  crossing a process boundary is not a typed union, so ambient, malformed and
  unknown strings are checked to arm nothing.

Both run offline; `native-gate.mjs` needs a JDK (CI already installs one for
the APK) and **fails rather than skips** without one.

## What still needs a physical device

Nothing below was reachable in this environment; none of it is claimed to work.

1. That `WatchPlugin.notifyListeners("watchwake", …)` actually reaches JS
   during a real session — especially while the app is **backgrounded**, which
   is the normal state for native watch-together (the user is in another app).
2. That event **ordering** is preserved when Android batches bridge events:
   the pairing of a wake with the next line she speaks relies on order, not on
   timestamps. The event deliberately carries no timestamp — arming at delivery
   time keeps a batched wake paired with the batched line that followed it,
   where a native timestamp would drop the pair as stale.
3. That a real `vy_shared_moment` row lands from a native session
   (`dead-writers`: assert the row count, do not infer it from the code).
