import { createRoot } from "react-dom/client";
import ReplicaDialogueLab from "../../src/studio/ReplicaDialogueLab";
import "../../src/studio/studio.css";
import type { ReplicaRuntimeStatus } from "../../src/studio/types";

const replicaId = "10000000-0000-4000-8000-000000000001";
const sessionId = "70000000-0000-4000-8000-000000000007";
const runtime: ReplicaRuntimeStatus = {
  replica_id: replicaId,
  lifecycle: "active",
  active: true,
  can_activate: true,
  blockers: [],
  qualification: { passed: 7, required: 7 },
  versions: { profile: 7, calibration: 2, voice_genome: 3 },
  activated_at: new Date().toISOString(),
};

let turnNumber = 0;
globalThis.fetch = async (input, init) => {
  const url = String(input);
  if (url.includes("replica-runtime")) return Response.json({ runtime });
  if (url.includes("replica-dialogue")) {
    const body = JSON.parse(String(init?.body || "{}"));
    turnNumber++;
    return Response.json({ turn: {
      turn_id: `80000000-0000-4000-8000-${String(turnNumber).padStart(12, "0")}`,
      session_id: body.session_id || sessionId,
      reply: "Haan, that sounds like the point where I would slow down, name what changed, and ask one specific question.",
      delivery: { mode: "warm", pace: "natural", intensity: 0.58, language_hint: "Hinglish", nonverbals: ["pause"] },
      can_voice: true,
      created_at: new Date().toISOString(),
    } });
  }
  return new Response(new Uint8Array(44), { status: 200, headers: { "Content-Type": "audio/wav" } });
};

createRoot(document.getElementById("root")!).render(
  <div className="studio-shell"><main className="studio-main">
    <ReplicaDialogueLab
      token="offline-owner-token"
      replicaId={replicaId}
      stopped={false}
      runtimeStatus={runtime}
      onAuthError={() => undefined}
    />
  </main></div>,
);
