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

ReactDOM.createRoot(document.getElementById("room-root")!).render(
  <React.StrictMode>
    <RoomApp />
  </React.StrictMode>,
);
