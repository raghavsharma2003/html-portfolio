import { expertWorkspaceUrl } from "./workspaceNavigation";
import type { ReplicaRuntimeStatus } from "./types";
import MaterialSharePanel from "./publication/MaterialSharePanel";

export default function ExpertSharePanel({ replicaId, token, onReview }: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onRuntimeStatus?: (status: ReplicaRuntimeStatus) => void;
  onReview: () => void;
}) {
  return <section className="vx-expert-share" aria-labelledby="expert-share-title">
    <div className="vx-stage-title"><h1 id="expert-share-title">Give your AI a home.</h1></div>
    <MaterialSharePanel token={token} replicaId={replicaId} onReview={onReview} />
    <details className="vp-data"><summary>Voice and other channels</summary>
      <p>These need their own verification before sharing.</p>
      <a className="vx-button" href={expertWorkspaceUrl(replicaId, "share", window.location.search)}>Review readiness</a>
    </details>
  </section>;
}
