import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";

// Mobile keyboard fix: size the app to the VISUAL viewport, not the layout
// viewport. When the soft keyboard opens, --vvh shrinks so the whole app
// (header included) stays on screen — WhatsApp behavior. Also pin the window
// so browsers can't scroll the header away on input focus.
function syncViewport() {
  const h = window.visualViewport?.height ?? window.innerHeight;
  document.documentElement.style.setProperty("--vvh", `${Math.round(h)}px`);
  if (window.scrollY !== 0) window.scrollTo(0, 0);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", syncViewport);
  window.visualViewport.addEventListener("scroll", syncViewport);
}
window.addEventListener("focusin", () => setTimeout(syncViewport, 250));
window.addEventListener("focusout", () => setTimeout(syncViewport, 250));
syncViewport();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
