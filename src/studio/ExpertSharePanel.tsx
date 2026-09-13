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
// WS-R174. `textReady` joins `voiceWorkspaceReady` in the branch below, not a
// replacement of it: a person who is text-ready (an approved HumanOS sheet,
// no voice recorded — `CloneExperience.tsx`'s own `textReady`,
// WS-R161/167) previously had NO route to `DeployStudio`/`RoomStudio` at
// all, because this file's own condition checked `voiceWorkspaceReady`
// alone. `RoomStudio`'s own publish predicate
// (`api/_room-publish.js#publishBlockers`) has never depended on voice —
// only an active runtime capability, Readiness and an approved disclosure —
// so nothing about the door this screen mounts changes; only the CLIENT
// gate deciding whether to mount it does. Found by walking the real
// personal studio for a text-ready person for the first time
// (`evals/rehearsal/person-room.mjs`), the exact gap wave twenty-three's own
// brief names ("nobody has clicked through the real RoomStudio for a person
// AI"). See `context/rejected.md#ws-r174-expertsharepanel-showed-deploy-
// only-for-voiceworkspaceready-never-textready`.
import { expertWorkspaceUrl } from "./workspaceNavigation";
import type { ReplicaRuntimeStatus } from "./types";
import MaterialSharePanel from "./publication/MaterialSharePanel";
import DeployStudio from "./DeployStudio";
import { useStudioLocale } from "./localeContext";

export default function ExpertSharePanel({ replicaId, token, stopped, onAuthError, onReview, voiceWorkspaceReady, textReady }: {
  token: string;
  replicaId: string;
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
  onRuntimeStatus?: (status: ReplicaRuntimeStatus) => void;
  onReview: () => void;
  voiceWorkspaceReady: boolean;
  textReady: boolean;
}) {
  const { t } = useStudioLocale();
  const copy = t.expertSharePanel;
  if (voiceWorkspaceReady || textReady) {
    return <DeployStudio token={token} replicaId={replicaId} stopped={stopped} onAuthError={onAuthError} onReview={onReview} />;
  }
  return <section className="vx-expert-share" aria-labelledby="expert-share-title">
    <div className="vx-stage-title"><h1 id="expert-share-title">{copy.title}</h1></div>
    <MaterialSharePanel token={token} replicaId={replicaId} onReview={onReview} />
    <details className="vp-data"><summary>{copy.voiceOtherChannelsSummary}</summary>
      <p>{copy.voiceOtherChannelsNote}</p>
      <a className="vx-button" href={expertWorkspaceUrl(replicaId, "share", window.location.search)}>{copy.reviewReadiness}</a>
    </details>
  </section>;
}
