import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import Quick from '../../src/studio/QuickVoiceCapture';
import Modern from '../../src/studio/VoiceEnrollmentLab';
import Creator from '../../src/creatorStudio/VoiceEnrollmentLab';

const params = new URLSearchParams(location.search);
const lane = params.get('lane') ?? 'quick';
const counts = { open: 0, start: 0, cancel: 0, stop: 0, use: 0, apiWrites: 0 };
const revoked: string[] = [];
const created: string[] = [];
const unhandled: string[] = [];
const attempts: any[] = [];
const realNow = Date.now; let offset = 0;
Date.now = () => realNow() + offset;
const realRevoke = URL.revokeObjectURL.bind(URL);
URL.revokeObjectURL = (url) => { revoked.push(url); realRevoke(url); };
window.addEventListener('unhandledrejection', event => unhandled.push(String(event.reason)));
const probe = {
  counts, revoked, created, unhandled, attempts, effects: 0,
  open(options: any = {}) {
    counts.open++;
    const attempt: any = { options, cancelled: false };
    attempts.push(attempt);
    return new Promise(resolve => {
      attempt.permission = () => resolve({
        start() { counts.start++; return new Promise<void>((accept, reject) => { attempt.resume = accept; attempt.rejectResume = () => { attempt.cancel(); reject(new Error('Synthetic resume failed')); }; }); },
        stop() { counts.stop++; return new Promise(resolveStop => { attempt.complete = resolveStop; }); },
        cancel: attempt.cancel = async () => { if (!attempt.cancelled) { attempt.cancelled = true; counts.cancel++; } },
      });
    });
  },
  resolveOpen(index = attempts.length - 1) { attempts[index].permission(); },
  resolveStart(index = attempts.length - 1) { attempts[index].resume(); },
  rejectStart(index = attempts.length - 1) { attempts[index].rejectResume(); },
  level(clean = true, index = attempts.length - 1) { attempts[index].options.onLevel?.(clean ? .5 : .001, .2); },
  resolveStop(index = attempts.length - 1) {
    const file = new File(['synthetic recording'], 'fixture.wav', { type: 'audio/wav' });
    const url = URL.createObjectURL(file); created.push(url);
    attempts[index].complete({ file, url, durationMs: lane === 'quick' ? 13000 : 6000 });
  },
  rejectStop(index = attempts.length - 1) { attempts[index].complete(Promise.reject(new Error('Synthetic stop failed'))); },
  advanceTime() { offset += 13000; },
  unmount() {}, disable(_value = true) {}, scope(_replica = false) {},
};
(window as any).captureLifetime = probe;
const replica = { replica_id: '11111111-1111-4111-8111-111111111111', age_verified: true, identity_verified: true, liveness_verified: true };
const consents = ['capture', 'storage', 'biometric', 'training'].map(scope => ({ scope, revoked_at: null, expires_at: null }));
const onAuthError = () => { throw new Error('Unexpected synthetic auth error'); };
function Host() {
  const [shown, show] = useState(true);
  const [disabled, disable] = useState(false);
  const [token, setToken] = useState('synthetic-session-a');
  const [id, setId] = useState(replica.replica_id);
  probe.unmount = () => flushSync(() => show(false));
  probe.disable = (value = true) => flushSync(() => disable(value));
  probe.scope = otherReplica => flushSync(() => otherReplica ? setId('22222222-2222-4222-8222-222222222222') : setToken('synthetic-session-b'));
  useEffect(() => { probe.effects++; }, []);
  if (!shown) return <p>Capture closed</p>;
  if (lane === 'quick') return <Quick disabled={disabled} onUseRecording={() => { counts.use++; }} />;
  const Lab = lane === 'modern' ? Modern : Creator;
  return <Lab token={token} replica={{ ...replica, replica_id: id } as any} consents={consents as any} onAuthError={onAuthError} />;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Host /></React.StrictMode>);
