import { createRoot } from "react-dom/client";
import ExpertSharePanel from "../../src/studio/ExpertSharePanel";

declare global {
  interface Window { routeEvents: string[]; }
}

window.routeEvents = [];

createRoot(document.getElementById("root")!).render(<ExpertSharePanel
  token="synthetic-owner"
  replicaId="10000000-0000-4000-8000-000000000001"
  stopped={false}
  voiceWorkspaceReady
  onAuthError={cause => { throw cause; }}
  onReview={() => window.routeEvents.push("corrections")}
  onOpenProfile={() => window.routeEvents.push("profile")}
/>);
