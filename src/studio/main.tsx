import React from "react";
import ReactDOM from "react-dom/client";
import StudioApp from "./StudioApp";
import "./studio.css";

ReactDOM.createRoot(document.getElementById("studio-root")!).render(
  <React.StrictMode>
    <StudioApp />
  </React.StrictMode>,
);
