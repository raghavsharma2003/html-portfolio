import {useEffect, useRef, useState} from 'react';
import {ReplicaApiError, replicaRequest} from './replicaApi';
import {readRememberedStudioLocale, resolveStudioLocale} from '../creatorStudio/studioLocalePreference';

export type CandidateActivationStatus = {
  replica_id: string; candidate_id: string;
  active_capability_id: string | null; current_candidate_id: string | null;
  can_activate: boolean; qualification_id: string | null;
  can_experiment: boolean; experimental_qualification_id: string | null;
  selection_kind: 'baseline' | 'qualified' | 'experimental' | null;
  rollback_target_capability_id: string | null; can_rollback: boolean; blockers: string[];
  can_reset: boolean; reset_target_capability_id: string | null;
};
const uuid = (value: unknown): value is string => typeof value === 'string'
  && /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value);
const nullableId = (value: unknown) => value === null || uuid(value);
export function parseCandidateActivationStatus(value: unknown, replicaId: string, candidateId: string): CandidateActivationStatus {
  const row = value as CandidateActivationStatus;
  if (!row || typeof row !== 'object' || !uuid(row.replica_id) || !uuid(row.candidate_id)
    || row.replica_id !== replicaId || row.candidate_id !== candidateId
    || !nullableId(row.active_capability_id) || !nullableId(row.current_candidate_id)
    || !nullableId(row.qualification_id) || !nullableId(row.rollback_target_capability_id)
    || !nullableId(row.reset_target_capability_id) || typeof row.can_reset !== 'boolean'
    || !nullableId(row.experimental_qualification_id) || typeof row.can_experiment !== 'boolean'
    || ![null, 'baseline', 'qualified', 'experimental'].includes(row.selection_kind)
    || typeof row.can_activate !== 'boolean' || typeof row.can_rollback !== 'boolean'
    || !Array.isArray(row.blockers) || row.blockers.length > 32
    || row.blockers.some(item => typeof item !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(item))
    || (row.can_activate && (!row.qualification_id || !row.active_capability_id || row.blockers.length > 0 || row.current_candidate_id === candidateId))
    || (row.can_experiment && (!row.experimental_qualification_id || !row.active_capability_id || row.current_candidate_id === candidateId))
    || (row.can_reset && (!row.active_capability_id || !row.reset_target_capability_id
      || row.reset_target_capability_id === row.active_capability_id))
    || (row.can_rollback && (!row.active_capability_id || !row.rollback_target_capability_id
      || row.active_capability_id === row.rollback_target_capability_id || row.current_candidate_id !== candidateId))) {
    throw new ReplicaApiError('Version status could not be verified', 502, {});
  }
  return row;
}

export default function CandidateActivationAction({token, replicaId, candidateId, stopped = false, statusRevision = 0, locale, onAuthError}: {
  token: string; replicaId: string; candidateId: string; stopped?: boolean; statusRevision?: number; locale?: 'en' | 'hi'; onAuthError: (cause: unknown) => void;
}) {
  const urlLocale = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('lang');
  const language = locale ?? resolveStudioLocale({urlLocale: urlLocale === 'hi' || urlLocale === 'en' ? urlLocale : null,
    replica: null, rememberedLocale: readRememberedStudioLocale()});
  const identity = JSON.stringify([token, replicaId, candidateId, stopped]);
  const latest = useRef(identity); latest.current = identity;
  const auth = useRef(onAuthError); auth.current = onAuthError;
  const epoch = useRef(0), pending = useRef<AbortController | null>(null);
  const unconfirmedChange = useRef<{identity: string; previousCapability: string | null} | null>(null);
  const refreshQueued = useRef(false), seenRevision = useRef(statusRevision);
  const [view, setView] = useState<{identity: string; status: CandidateActivationStatus | null; checked: boolean}>({identity, status: null, checked: false});
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const visible = view.identity === identity ? view.status : null;
  const checked = view.identity === identity && view.checked;

  async function run(op: 'status' | 'activate' | 'experiment' | 'rollback' | 'reset') {
    if (stopped || pending.current || (op !== 'status' && (!checked || !visible
      || (op === 'activate' ? !visible.can_activate : op === 'experiment' ? !visible.can_experiment
        : op === 'reset' ? !visible.can_reset : !visible.can_rollback)))) return;
    const controller = new AbortController(), runEpoch = ++epoch.current, runIdentity = identity;
    pending.current = controller; setBusy(true); setError('');
    if (op !== 'status') unconfirmedChange.current = {identity: runIdentity, previousCapability: visible!.active_capability_id};
    const current = () => epoch.current === runEpoch && latest.current === runIdentity;
    const deadline = setTimeout(() => controller.abort(), 25_000);
    try {
      const body = {op, replica_id: replicaId, candidate_id: candidateId,
        ...(op !== 'status' ? {expected_capability_id: visible!.active_capability_id} : {}),
        ...(op === 'activate' ? {qualification_id: visible!.qualification_id} : {}),
        ...(op === 'experiment' ? {qualification_id: visible!.experimental_qualification_id} : {}),
        ...(op === 'reset' ? {target_capability_id: visible!.reset_target_capability_id} : {}),
        ...(op === 'rollback' ? {target_capability_id: visible!.rollback_target_capability_id} : {})};
      const response = await replicaRequest<unknown>(token, '/api/replica-candidate-activation', {
        method: 'POST', body: JSON.stringify(body), signal: controller.signal,
      });
      let status = parseCandidateActivationStatus(response, replicaId, candidateId);
      if (op !== 'status' && current()) {
        status = parseCandidateActivationStatus(await replicaRequest<unknown>(token, '/api/replica-candidate-activation', {
          method: 'POST', body: JSON.stringify({op: 'status', replica_id: replicaId, candidate_id: candidateId}), signal: controller.signal,
        }), replicaId, candidateId);
      }
      if (!current()) return;
      setView({identity: runIdentity, status, checked: true});
      const recoveredChange = unconfirmedChange.current?.identity === runIdentity
        && unconfirmedChange.current.previousCapability !== status.active_capability_id;
      if ((op !== 'status' || recoveredChange) && status.active_capability_id) {
        unconfirmedChange.current = null;
        window.dispatchEvent(new CustomEvent('vyakti:private-runtime-changed', {
          detail: {replica_id: replicaId, capability_id: status.active_capability_id},
        }));
      }
    } catch (cause) {
      if (!current()) return;
      setView({identity: runIdentity, status: null, checked: false});
      refreshQueued.current = false;
      const selectionChanged = cause instanceof ReplicaApiError && cause.status === 409 && cause.data?.error === 'candidate_selection_changed';
      setError(selectionChanged ? language === 'hi' ? 'आपका चयन बदल गया है। ताज़ा स्थिति देखें।' : 'Your selection changed. Check the latest status.'
        : op === 'status' ? 'We could not check this version. Please check again.'
        : 'The change is unconfirmed. Check status before continuing.');
      if (cause instanceof ReplicaApiError && cause.status === 401) auth.current(cause);
    } finally {
      clearTimeout(deadline);
      if (current()) {
        pending.current = null; setBusy(false);
        if (refreshQueued.current) {refreshQueued.current = false; void run('status');}
      }
    }
  }
  useEffect(() => {
    epoch.current++; pending.current?.abort(); pending.current = null;
    unconfirmedChange.current = null;
    refreshQueued.current = false;
    setView({identity, status: null, checked: false}); setBusy(false); setError('');
    void run('status');
    return () => { epoch.current++; pending.current?.abort(); pending.current = null; };
    // Account, candidate and stopped state own the request lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);
  useEffect(() => {
    if (seenRevision.current === statusRevision) return;
    seenRevision.current = statusRevision;
    if (pending.current) refreshQueued.current = true;
    else void run('status');
    // Explicit qualification completion requests a read without cancelling a version mutation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusRevision]);

  const isCurrent = checked && visible?.current_candidate_id === candidateId;
  return <section className="feedback-dataset__candidate" aria-label="Private conversation version" aria-busy={busy}>
    <p className="eyebrow">{isCurrent && visible?.selection_kind === 'experimental' ? 'Private text experiment' : 'Private text conversations'}</p>
    <p role="status" aria-live="polite">{stopped ? 'Version changes are paused.'
      : !checked ? busy ? 'Checking your private version' : 'Check status to continue.'
      : isCurrent ? 'This version is selected for new private conversations.'
      : visible?.can_activate ? 'This version passed the checks for private conversations.'
      : visible?.can_experiment ? 'Try a private text experiment while more checks are needed.'
      : 'This version needs more checks before private use.'}</p>
    {isCurrent && <p>Start a new conversation to use it.</p>}
    <div className="feedback-dataset__actions" style={{display: 'flex', flexWrap: 'wrap', gap: 8}}>
      <button type="button" style={{minHeight: 44, maxWidth: '100%'}} disabled={stopped || busy || !checked || !visible?.can_activate}
        onClick={() => void run('activate')}>Use this version privately</button>
      {checked && visible?.can_experiment && !visible.can_activate && <button type="button" style={{minHeight: 44, maxWidth: '100%'}}
        disabled={stopped || busy} onClick={() => void run('experiment')}>Try this version privately</button>}
      {isCurrent && <button type="button" style={{minHeight: 44, maxWidth: '100%'}} disabled={stopped || busy || !checked || !visible?.can_rollback}
        onClick={() => void run('rollback')}>Restore previous version</button>}
      {checked && visible?.can_reset && <button type="button" style={{minHeight: 44, maxWidth: '100%'}} disabled={stopped || busy}
        onClick={() => void run('reset')}>{language === 'hi' ? 'मौजूदा AI इस्तेमाल करें' : 'Use current AI'}</button>}
      <button type="button" style={{minHeight: 44, maxWidth: '100%'}} disabled={stopped || busy}
        onClick={() => void run('status')}>Check version status</button>
    </div>
    {error && <p className="feedback-dataset__error" role="alert">{error}</p>}
  </section>;
}
