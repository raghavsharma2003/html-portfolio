import { useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import CloneExperience from '../../src/studio/CloneExperience';
import PersonModelStudio from '../../src/studio/PersonModelStudio';
import type { CloneExperienceProps } from '../../src/studio/CloneExperience';
import type { ConsentReceipt, Replica } from '../../src/studio/types';
import '../../src/studio/studio.css';
import '../../src/studio/design/tokens.css';
import { ITEM, RID, OTHER_RID, SOURCE_NAME } from './fixtures.mjs';

const root = createRoot(document.getElementById('root')!);
const params = new URLSearchParams(location.search);
const noop = () => {};
const nothing = async () => {};
const unused = async (): Promise<never> => { throw Error('Unexpected non-review action in synthetic fixture'); };
const probe: any = { committed: null, change: null, unmount: () => root.unmount(), authErrors: [] };
(window as any).sourceReviewProbe = probe;
function Harness() {
  const [scope, setScope] = useState({ token: 'synthetic-review-a', owner: 'synthetic-owner-a', replicaId: RID });
  const [selection, setSelection] = useState<{ itemId: string; label: string } | null>(params.has('selected') ? { itemId: ITEM, label: SOURCE_NAME } : null);
  probe.change = (kind: string) => setScope(current => ({ ...current, ...(kind === 'owner' ? { owner: 'synthetic-owner-b' } : kind === 'token' ? { token: 'synthetic-review-b' } : { replicaId: OTHER_RID }) }));
  useLayoutEffect(() => { probe.committed = { ...scope }; }, [scope]);
  const replica: Replica = { replica_id: scope.replicaId, display_name: 'Art practice', subject_mode: 'self', lifecycle: 'enrolling', policy_version: 'replica-self-v1', age_verified: false, identity_verified: false, liveness_verified: false, created_at: '2026-09-29', updated_at: '2026-09-29' };
  const consents = ['capture', 'transcription', 'storage'].map(value => ({ consent_id: `synthetic-${value}`, replica_id: scope.replicaId, scope: value, method: 'account_attestation', policy_version: replica.policy_version, granted_at: '2026-09-29', expires_at: null, revoked_at: null })) as ConsentReceipt[];
  const onAuthError = (cause: unknown) => probe.authErrors.push(String(cause));
  if (params.has('direct')) return <div className="studio-shell"><main><PersonModelStudio token={scope.token} replicaId={scope.replicaId} ownerScope={scope.owner} selectedSource={selection} onClearSource={() => setSelection(null)} onAuthError={onAuthError} /></main></div>;
  const props: CloneExperienceProps = {
    identity: scope.owner, accountScope: scope.owner, ownerUserId: scope.owner, accessToken: scope.token,
    workspaceReadState: 'ready', consentReadState: 'ready', replicas: [replica], selected: replica,
    creatingNew: false, creating: false, revoking: false, consents, sources: [], runtimeStatus: null,
    activityView: { replica_id: scope.replicaId, generated_at: '2026-09-29', jobs: [], lanes: [], in_flight: false, next_poll_ms: null },
    wizardInput: { stopped: false, sourceConsent: true, sourceCount: 0, contextItemCount: 1, identityVerified: false, livenessVerified: false, sheetPersisted: false, mode: 'generic', runtime: null, connectedChannels: null, platformWork: null },
    review: null, reviewLoading: false, challenge: null, livenessLoading: false, notice: '', error: null,
    onDismissNotice: noop, onDismissError: noop, onSignOut: noop, onBeginClone: unused, onGrantConsent: nothing,
    onSelectReplica: nothing, onStartNew: noop, onRevoke: async () => false, onCreateUpload: unused,
    onRetryUpload: unused, onFinalizeUpload: unused, onRequestVoiceBuild: unused, onDeleteSource: unused,
    onRefreshEnrollment: nothing, onRefreshReview: nothing, onCheckCaptureReadiness: unused, onIssueChallenge: unused,
    onStartFaceSession: unused, onPollFaceSession: unused, onCancelChallenge: unused, onCreateLivenessUpload: unused,
    onFinalizeLiveness: unused, onVerifiedConsentChanged: nothing, onActivityView: noop, onActivityAct: noop,
    onAuthError, onContextCount: noop,
  };
  return <CloneExperience {...props} />;
}
root.render(<Harness />);
