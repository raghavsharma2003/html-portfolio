import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import ExpertSharePanel from "../../src/studio/ExpertSharePanel";
import { StudioLocaleProvider } from "../../src/studio/localeContext";
import "../../src/studio/clone-experience.css";

const FIRST = "33333333-3333-4333-8333-333333333333";
const SECOND = "44444444-4444-4444-8444-444444444444";

function App() {
  const [scope, setScope] = useState({ token: "token-a", replicaId: FIRST });
  const [visible, setVisible] = useState(true);
  (window as any).shareProbe = {
    scope: () => setScope({ token: "token-b", replicaId: SECOND }),
    hide: () => setVisible(false),
  };
  return <StudioLocaleProvider locale="en">
    {visible ? <ExpertSharePanel
      token={scope.token}
      replicaId={scope.replicaId}
      stopped={false}
      onAuthError={() => {}}
      onReview={() => {}}
      voiceWorkspaceReady={false}
    /> : null}
  </StudioLocaleProvider>;
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
