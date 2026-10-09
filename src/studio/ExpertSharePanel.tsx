// ExpertSharePanel.tsx — WS-R152. Kept as the export name `CloneExperience.tsx`
// already lazy-imports (`const ExpertSharePanel = lazy(() => import
// ("./ExpertSharePanel"));`), so mounting the new Deploy screen needed no
// edit to that file's own giant single-tree JSX beyond one new prop.
//
// TWO SCREENS BEHIND ONE DOOR, NOT A REPLACEMENT
// ---------------------------------------------------------------------------
// The pre-existing text-publication path (`MaterialSharePanel`, "share your
// knowledge" as a text-only link before a voice exists) is a real, tested
// feature (`evals/text-publication-ui/early-share.mjs`,
// `evals/verification-knowledge/run.mjs`,
// `evals/first-use-private-flow/run.mjs` all drive it), reachable from the
// "Add more of you" menu's own `{!voiceWorkspaceReady && ...}` guard
// (`CloneExperience.tsx`) — the SAME condition this file now branches on.
// `voiceWorkspaceReady` is fed down rather than re-derived, so the two
// places that decide "is text sharing or Deploy the right screen right now"
// can never disagree. Once voice IS ready, the "Add more of you" menu stops
// offering the text-only path at all and the bottom nav's own Share tab
// takes over — so this screen shows the real Deploy surface (`DeployStudio`)
// from that point on, never both at once.
//
// Room publication consumes `vy_replica_runtime_capability`, the active voice
// capability. `text_ready` is stored separately and cannot satisfy that door.
// A no-voice owner therefore keeps the material-publication ceremony even
// after private text Meet becomes available. This branch mirrors the server
// authority instead of presenting a Room action the server must refuse.
import { useState } from "react";
import { deploySurface } from "./workspaceNavigation";
import type { ReplicaRuntimeStatus } from "./types";
import MaterialSharePanel from "./publication/MaterialSharePanel";
import DeployStudio from "./DeployStudio";
import { useStudioLocale } from "./localeContext";

export default function ExpertSharePanel({ replicaId, token, stopped, onAuthError, onReview, onOpenProfile, voiceWorkspaceReady }: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onRuntimeStatus?: (status: ReplicaRuntimeStatus) => void;
  onReview: () => void;
  onOpenProfile: () => void;
  voiceWorkspaceReady: boolean;
}) {
  const { t, locale } = useStudioLocale();
  const copy = t.expertSharePanel;
  const scope = `${token}:${replicaId}`;
  const [localView, setLocalView] = useState<{ scope: string; value: "sharing" | "readiness" }>(() => ({ scope, value: "sharing" }));
  const view = localView.scope === scope ? localView.value : "sharing";
  if (deploySurface(voiceWorkspaceReady) === "room") {
    return <DeployStudio token={token} replicaId={replicaId} stopped={stopped} onAuthError={onAuthError} onReview={onReview} onOpenProfile={onOpenProfile} />;
  }
  if (view === "readiness") {
    return <section className="vx-expert-share" aria-label={copy.reviewReadiness}>
      <button className="vx-back" type="button" onClick={() => setLocalView({ scope, value: "sharing" })}>
        {locale === "hi" ? "शेयरिंग पर वापस जाएँ" : "Back to sharing"}
      </button>
      <DeployStudio token={token} replicaId={replicaId} stopped={stopped} onAuthError={onAuthError} onReview={onReview} onOpenProfile={onOpenProfile} />
    </section>;
  }
  return <section className="vx-expert-share" aria-labelledby="expert-share-title">
    <div className="vx-stage-title"><h1 id="expert-share-title">{copy.title}</h1></div>
    <MaterialSharePanel token={token} replicaId={replicaId} onReview={onReview} onOpenProfile={onOpenProfile} />
    <details className="vp-data"><summary>{copy.voiceOtherChannelsSummary}</summary>
      <p>{copy.voiceOtherChannelsNote}</p>
      <button className="vx-button" type="button" onClick={() => setLocalView({ scope, value: "readiness" })}>{copy.reviewReadiness}</button>
    </details>
  </section>;
}
