import { expertWorkspaceUrl } from "./workspaceNavigation";
import type { ReplicaRuntimeStatus } from "./types";

export default function ExpertSharePanel({ replicaId }: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onRuntimeStatus?: (status: ReplicaRuntimeStatus) => void;
  onReview: () => void;
}) {
  return <section className="vx-expert-share" aria-labelledby="expert-share-title">
    <div className="vx-stage-title"><h1 id="expert-share-title">Give your AI a home.</h1><p>A private conversation for each person. Your knowledge, with continuity.</p></div>
    <a className="vx-button vx-button--primary" href={expertWorkspaceUrl(replicaId, "share", window.location.search)}>Open expert workspace</a>
    <p>Review your profile and readiness before publishing. Your AI stays private until those checks pass.</p>
    <p>Publishing currently supports teaching profiles. Other expert profiles need their own reviewed setup.</p>
  </section>;
}
