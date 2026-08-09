import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";

// Mobile keyboard fix (WhatsApp behavior): Chromium resizes the layout
// viewport via the interactive-widget meta; iOS Safari never does, so we
// track the VISUAL viewport ourselves — height into --vvh, and Safari's
// forced layout-viewport offset into --vvt (translate the shell to follow,
// or the header slides off-screen). rAF-throttled; inert during pinch-zoom.
const vv = window.visualViewport;
let raf = 0;
function sync() {
  raf = 0;
  if (vv && vv.scale !== 1) return; // don't fight pinch-zoom
  const h = vv?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
  document.documentElement.style.setProperty("--vvt", `${Math.round(vv?.offsetTop ?? 0)}px`);
  if (window.scrollY !== 0) window.scrollTo(0, 0);
}
function schedule() {
  if (!raf) raf = requestAnimationFrame(sync);
}
if (vv) {
  vv.addEventListener("resize", schedule);
  vv.addEventListener("scroll", schedule);
}
window.addEventListener("focusin", schedule);
// iOS 26.0 bug: offsetTop/height stay stale after keyboard dismiss — resync late
window.addEventListener("focusout", () => setTimeout(schedule, 300));
sync();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
