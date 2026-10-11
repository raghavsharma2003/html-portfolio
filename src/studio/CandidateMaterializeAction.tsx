import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { requestMaterialization, type MaterializeJob, type MaterializeScope } from './candidateMaterializeApi';
import { ReplicaApiError } from './replicaApi';

const CandidateEvaluationLab = lazy(() => import('./CandidateEvaluationLab'));
export default function CandidateMaterializeAction({ token, replicaId, datasetId, candidateId, sourceSetHash, onAuthError }:
  MaterializeScope & { token: string; onAuthError: (cause: unknown) => void }) {
  const scope = { replicaId, datasetId, candidateId, sourceSetHash };
  const identity = JSON.stringify([token, replicaId, datasetId, candidateId, sourceSetHash]);
  const latest = useRef(identity); latest.current = identity;
  const auth = useRef(onAuthError); auth.current = onAuthError;
  const pending = useRef<AbortController | null>(null), epoch = useRef(0);
  const [view, setView] = useState<{ identity: string; job: MaterializeJob | null; checked: boolean }>({ identity, job: null, checked: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [review, setReview] = useState(false);
  const visible = view.identity === identity ? view.job : null;
  const checked = view.identity === identity && view.checked;

  async function run(op: 'status' | 'start' | 'advance') {
    if (pending.current || (op !== 'status' && (!checked || (op === 'start' ? Boolean(visible) : !visible?.can_advance)))) return;
    const controller = new AbortController(), runEpoch = ++epoch.current, runIdentity = identity;
    pending.current = controller; setBusy(true); setError('');
    const current = () => epoch.current === runEpoch && latest.current === runIdentity && !controller.signal.aborted;
    try {
      let nextOp = op;
      let previousCompleted = visible?.completed ?? -1;
      let expectedJobId = visible?.job_id;
      let expectedTotal = visible?.total;
      while (current()) {
        const deadline = setTimeout(() => controller.abort(), nextOp === 'status' ? 20_000 : 90_000);
        let next: MaterializeJob | null;
        try { next = await requestMaterialization(token, scope, nextOp, controller.signal); }
        finally { clearTimeout(deadline); }
        if (!current()) return;
        if (nextOp !== 'status' && !next) throw new Error('Comparison preparation was not confirmed');
        if (expectedJobId && next?.job_id !== expectedJobId) throw new Error('Comparison job changed');
        if (nextOp !== 'status' && next && ((expectedTotal !== undefined && next.total !== expectedTotal) || next.completed < previousCompleted)) {
          throw new Error('Comparison progress changed');
        }
        expectedJobId = next?.job_id;
        expectedTotal = next?.total;
        setView({ identity: runIdentity, job: next, checked: true });
        // Reads never grant permission to start another provider call. Only this explicit click does.
        if (op === 'status' || !next?.can_advance) break;
        if (nextOp === 'advance' && next.completed <= previousCompleted) throw new Error('Comparison progress was not confirmed');
        previousCompleted = next.completed;
        nextOp = 'advance';
      }
    } catch (cause) {
      if (epoch.current !== runEpoch || latest.current !== runIdentity) return;
      setView((prior) => ({ ...prior, checked: false }));
      setError(op === 'status' ? 'We could not read comparison status. Check again.' : 'Completion is unconfirmed. Check status before continuing.');
      if (cause instanceof ReplicaApiError && cause.status === 401) auth.current(cause);
    } finally {
      if (epoch.current === runEpoch && latest.current === runIdentity) { pending.current = null; setBusy(false); }
    }
  }
  // A new scope starts with a read, never a mutation. Abort cancels client work, not a server charge.
  useEffect(() => {
    epoch.current++; pending.current?.abort(); pending.current = null;
    setView({ identity, job: null, checked: false }); setBusy(false); setError(''); setReview(false);
    void run('status');
    return () => { epoch.current++; pending.current?.abort(); pending.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  return <section className="feedback-dataset__candidate" aria-label="Prepare blind comparison" aria-busy={busy}>
    <p role="status" aria-live="polite">{visible?.state === 'ready' ? 'Your blind comparison is ready.'
      : visible?.state === 'held' ? 'We are checking this comparison before it can continue.'
      : visible?.state === 'failed' ? 'We could not prepare this comparison. Your current AI is unchanged.'
      : visible ? `Preparing responses: ${visible.completed} of ${visible.total}`
      : checked ? 'Compare the candidate with your current AI before approving any change.' : 'Checking comparison status'}</p>
    {visible && visible.total > 0 && <progress value={visible.completed} max={visible.total} aria-label="Comparison responses prepared" />}
    <div className="feedback-dataset__actions">
      {checked && !visible && <button type="button" disabled={busy} onClick={() => void run('start')}>Prepare blind comparison</button>}
      {checked && visible?.can_advance && <button type="button" disabled={busy} onClick={() => void run('advance')}>Continue preparation</button>}
      <button type="button" disabled={busy} onClick={() => void run('status')}>Check comparison status</button>
      {checked && visible?.state === 'ready' && !review && <button type="button" disabled={busy} onClick={() => setReview(true)}>Review blind comparisons</button>}
    </div>
    {error && <p className="feedback-dataset__error" role="alert">{error}</p>}
    {review && checked && visible?.state === 'ready' && <Suspense fallback={<p role="status">Opening comparisons</p>}>
      <CandidateEvaluationLab key={identity} token={token} replicaId={replicaId} candidateId={candidateId} stopped={false} onAuthError={onAuthError} />
    </Suspense>}
  </section>;
}
