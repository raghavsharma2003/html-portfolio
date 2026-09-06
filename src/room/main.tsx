import React from "react";
import ReactDOM from "react-dom/client";
import RoomApp from "./RoomApp";
// Shared scale, palette and base precede Room components, exactly as in
// Creator Studio. The Room does not load the creator-only panel stylesheet.
import "../creatorStudio/design/tokens.css";
import "../creatorStudio/design/foundation.css";
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
