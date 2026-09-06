import React from "react";
import ReactDOM from "react-dom/client";
import RoomApp from "./RoomApp";
// The scale first, then the palette and the base layer, then the Room's own
// components. This is `src/studio/main.tsx`'s order and it is the same order
// for the same reason: both of the first two write into the `tokens` layer, so
// on any name declared in both, studio.css wins by source position, which is
// what makes tokens.css add the scale without overruling the palette.
//
// studio.css is imported for the PALETTE, not for its panels. The Room uses
// almost none of its 3 300 lines. Declaring `--paper` and `--forest` locally
// instead would have been fifteen lines and a guaranteed divergence: two
// surfaces of one product whose greens drift apart on the first tweak, in the
// one place where a follower and a creator can compare them. See room.css.
import "../studio/design/tokens.css";
import "../studio/studio.css";
import "./room.css";
import { loadRoomTalkCopy } from "./copy";

// WS-R139, narrowed from `src/studio/main.tsx`'s own precedent. Starts the
// Hindi TALK chunk's own fetch as early as this module can, well before
// `RoomApp.tsx`'s own effect would otherwise start it (which only runs
// after `RoomApp` has mounted and rendered a first time). `loadRoomTalkCopy`
// dedupes (`copy.ts`'s own `hiTalkLoading` cache), so this is a pure head
// start, never a duplicate fetch. `?lang=hi` never appears on a real Room
// URL today (`RoomApp.tsx` decides its locale from the SERVER's own
// `room.locale`, never a URL param) — checked anyway, first, for the layout
// and performance gates' own `room-hi` fixture targets, which DO pass it;
// `vyakti.room.locale.v1` (written once by a real `switchLocale` call, read
// nowhere else) is what gives a RETURNING Hindi follower's own device the
// identical head start on their next visit, before the server has answered.
// Read directly from `location.search`/`localStorage` rather than through
// any React state, which does not exist yet at this point in the module's
// lifecycle.
try {
  const params = new URLSearchParams(window.location.search);
  let hi = params.get("lang") === "hi";
  if (!hi && params.get("lang") === null) {
    try {
      hi = window.localStorage.getItem("vyakti.room.locale.v1") === "hi";
    } catch {
      // Private browsing / storage blocked: no head start, no crash.
    }
  }
  if (hi) void loadRoomTalkCopy("hi");
} catch {
  // A malformed URL leaves this as a no-op; `RoomApp.tsx`'s own later call
  // still starts the fetch, just without this head start.
}

ReactDOM.createRoot(document.getElementById("room-root")!).render(
  <React.StrictMode>
    <RoomApp />
  </React.StrictMode>,
);
