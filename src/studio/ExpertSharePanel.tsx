import { expertWorkspaceUrl } from "./workspaceNavigation";
import type { ReplicaRuntimeStatus } from "./types";
import MaterialSharePanel from "./publication/MaterialSharePanel";
import { useStudioLocale } from "./localeContext";

export default function ExpertSharePanel({ replicaId, token, onReview }: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onRuntimeStatus?: (status: ReplicaRuntimeStatus) => void;
  onReview: () => void;
}) {
  const { t } = useStudioLocale();
  const copy = t.expertSharePanel;
  return <section className="vx-expert-share" aria-labelledby="expert-share-title">
    <div className="vx-stage-title"><h1 id="expert-share-title">{copy.title}</h1></div>
    <MaterialSharePanel token={token} replicaId={replicaId} onReview={onReview} />
    <details className="vp-data"><summary>{copy.voiceOtherChannelsSummary}</summary>
      <p>{copy.voiceOtherChannelsNote}</p>
      <a className="vx-button" href={expertWorkspaceUrl(replicaId, "share", window.location.search)}>{copy.reviewReadiness}</a>
    </details>
  </section>;
}
