import {createRoot} from "react-dom/client";
import {useState} from "react";
import PrivateTextRehearsal from "../../src/studio/PrivateTextRehearsal";
// @ts-expect-error The bounded Vite evaluation supplies this retained component.
import PriorPrivateTextRehearsal from "virtual:prior-private-panel";
import "../../src/studio/design/tokens.css";
import type {ReplicaLifecycle} from "../../src/studio/types";
function Host(){
 const [token,setToken]=useState("private-text-fixture-token");
 const [replicaId,setReplica]=useState("10000000-0000-4000-8000-000000000001");
 const [lifecycle,setLifecycle]=useState<ReplicaLifecycle>(() => new URLSearchParams(location.search).get("lifecycle") === "paused" ? "paused" : "enrolling");
 Object.assign(window,{privateTextProbe:{change:(kind:string)=>{if(kind==="token")setToken("replacement-fixture-token");if(kind==="replica")setReplica("10000000-0000-4000-8000-000000000002");if(kind==="stopped")setLifecycle("paused");},unmount:()=>root.unmount()}});
 const Panel = new URLSearchParams(location.search).has("priorPanel") ? PriorPrivateTextRehearsal : PrivateTextRehearsal;
 return <Panel token={token} replicaId={replicaId} lifecycle={lifecycle} onBack={()=>{}} onEditContext={()=>{}} onAuthError={()=>{}}/>;
}
const root=createRoot(document.getElementById("root")!);root.render(<Host/>);
