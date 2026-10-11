import { createRoot } from "react-dom/client";
import { useState } from "react";
import PrivateTextRehearsal from "../../src/studio/PrivateTextRehearsal";
import "../../src/studio/design/tokens.css";

function Host() {
  const [token, setToken] = useState("recovery-owner-token");
  const [replicaId, setReplicaId] = useState("10000000-0000-4000-8000-000000000001");
  const [visible, setVisible] = useState(true);
  const [authErrors, setAuthErrors] = useState(0);
  Object.assign(window, { privateTextRecoveryProbe: {
    changeToken: () => setToken("replacement-owner-token"),
    changeReplica: () => setReplicaId("10000000-0000-4000-8000-000000000002"),
    logout: () => setVisible(false),
    authErrors: () => authErrors,
  } });
  return visible ? <PrivateTextRehearsal token={token} replicaId={replicaId} lifecycle="enrolling"
    onBack={() => {}} onEditContext={() => {}} onAuthError={() => setAuthErrors(value => value + 1)} /> : null;
}

const root = createRoot(document.getElementById("root")!);
root.render(<Host />);
