import { useEffect, useRef, useState } from "react";
import { readTurnFeedback, saveTurnFeedback } from "./feedbackApi";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaTurnFeedback, TurnFeedbackRating } from "./types";

// Private text lives only in this mounted editor. No local/session storage cache.
export function useTurnFeedbackEditor(token: string, replicaId: string, turnId: string,
  onAuthError: (cause: unknown) => void, onSaved?: (feedback: ReplicaTurnFeedback) => void) {
  const scope = `${token}:${replicaId}:${turnId}`;
  const currentScope = useRef(scope); currentScope.current = scope;
  const generation = useRef(0), busyRef = useRef(false);
  const callbacks = useRef({ onAuthError, onSaved }); callbacks.current = { onAuthError, onSaved };
  const [resolvedScope, setResolvedScope] = useState("");
  const [reload, setReload] = useState(0), [loading, setLoading] = useState(true);
  const [ratings, setRatings] = useState<Record<string, TurnFeedbackRating>>({});
  const [reasons, setReasons] = useState<string[]>([]), [correction, setCorrection] = useState("");
  const [saved, setSaved] = useState<ReplicaTurnFeedback | null>(null);
  const baseline = useRef("");
  const [clearCorrection, setClearCorrection] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const version = ++generation.current, controller = new AbortController();
    const live = () => generation.current === version && currentScope.current === scope;
    setLoading(true); setResolvedScope(""); setRatings({}); setReasons([]); setCorrection(""); setSaved(null);
    setClearCorrection(false); baseline.current = ""; busyRef.current = false; setBusy(false); setError("");
    void readTurnFeedback(token, replicaId, turnId, controller.signal).then(current => {
      if (!live()) return;
      setSaved(current.feedback); setRatings(current.feedback?.ratings || {}); setReasons(current.feedback?.reason_codes || []);
      setCorrection(current.correction); baseline.current = current.correction; setResolvedScope(scope);
    }).catch(cause => {
      if (!live()) return;
      if (cause instanceof ReplicaApiError && cause.status === 401) callbacks.current.onAuthError(cause);
      setError(cause instanceof Error ? cause.message : "The current correction could not be read");
    }).finally(() => { if (live()) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [token, replicaId, turnId, scope, reload]);
  const ready = resolvedScope === scope;
  async function persist(nextRatings: Record<string, TurnFeedbackRating>, nextReasons: string[]) {
    if (!ready || busyRef.current || !Object.keys(nextRatings).length) return false;
    const edited = correction.trim() !== baseline.current;
    if (edited && !correction.trim() && !clearCorrection) {
      setError("Choose Remove saved wording to clear your statement");
      return false;
    }
    const version = generation.current;
    const live = () => generation.current === version && currentScope.current === scope;
    busyRef.current = true; setBusy(true); setError("");
    try {
      const result = await saveTurnFeedback(token, replicaId, turnId, nextRatings, nextReasons,
        edited && !clearCorrection ? correction : undefined, saved?.revision || 0, clearCorrection);
      if (!live()) return false;
      if (result.revision !== (saved?.revision || 0) + 1) throw new Error("The saved revision could not be verified");
      baseline.current = clearCorrection ? "" : correction.trim(); setCorrection(baseline.current); setClearCorrection(false);
      setSaved(result); setRatings(nextRatings); setReasons(nextReasons); callbacks.current.onSaved?.(result); return true;
    } catch (cause) {
      if (!live()) return false;
      if (cause instanceof ReplicaApiError && cause.status === 401) callbacks.current.onAuthError(cause);
      // The POST might have committed. Require an exact scoped GET before another explicit write.
      setResolvedScope("");
      setError(cause instanceof Error ? cause.message : "The saved correction could not be verified");
      return false;
    } finally { if (live()) { busyRef.current = false; setBusy(false); } }
  }
  return { ready, loading, ratings, setRatings, reasons, setReasons, correction, setCorrection, saved,
    clearCorrection, setClearCorrection, busy, error, persist, retry: () => setReload(value => value + 1) };
}
