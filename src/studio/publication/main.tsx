import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource-variable/geist";
import "@fontsource-variable/instrument-sans";
import "@fontsource/noto-sans-devanagari/devanagari-600.css";
import PublicationApp from "./PublicationApp";

const publicId = new URLSearchParams(window.location.search).get("publication") || "";
ReactDOM.createRoot(document.getElementById("studio-root")!).render(<React.StrictMode><PublicationApp publicId={publicId} /></React.StrictMode>);
