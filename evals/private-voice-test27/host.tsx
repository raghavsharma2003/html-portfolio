import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import PrivateVoiceTest from "../../src/studio/PrivateVoiceTest";

declare global {
  interface Window {
    privateVoiceProbe: {
      authErrors: number;
      availability: boolean[];
      created: string[];
      revoked: string[];
      unmount: () => void;
    };
  }
}

const nativeCreate = URL.createObjectURL.bind(URL);
const nativeRevoke = URL.revokeObjectURL.bind(URL);
const probe = {
  authErrors: 0,
  availability: [] as boolean[],
  created: [] as string[],
  revoked: [] as string[],
  unmount: () => {},
};
window.privateVoiceProbe = probe;
URL.createObjectURL = (blob) => {
  const url = nativeCreate(blob);
  probe.created.push(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  probe.revoked.push(url);
  nativeRevoke(url);
};

function Host() {
  const query = new URLSearchParams(location.search);
  const [token, setToken] = useState("synthetic-account-A");
  const [shown, setShown] = useState(true);
  const [sourceRevision, setSourceRevision] = useState("source-revision-1");
  const [sourceProcessing, setSourceProcessing] = useState(query.has("processing"));
  probe.unmount = () => setShown(false);
  return <>
    <nav>
      <button type="button" onClick={() => setToken("synthetic-account-B")}>Switch account</button>
      <button type="button" onClick={() => { setSourceProcessing(false); setSourceRevision("source-revision-2"); }}>Finish source processing</button>
      <button type="button" onClick={() => setShown(false)}>Leave voice test</button>
    </nav>
    {shown ? <PrivateVoiceTest
      token={query.has("no-token") ? "" : token}
      replicaId="10000000-0000-4000-8000-000000000027"
      locale={query.get("lang") === "hi" ? "hi" : "en"}
      sourceRevision={sourceRevision}
      sourceProcessing={sourceProcessing}
      probeOnly={query.has("probe")}
      onAuthError={() => { probe.authErrors += 1; }}
      onAddRecording={() => {}}
      onAvailability={(available) => probe.availability.push(available)}
    /> : <h1>Voice test closed</h1>}
  </>;
}

createRoot(document.getElementById("root")!).render(<Host />);
