import { useCallback, useEffect, useRef } from "react";
import { jumpTo } from "./WizardRail";
import type { Missing, StepId } from "./wizardModel";

/** The workspace owns the step change; lazy panels own their actual mount time. */
export function useWizardBlockerNavigation(replicaId: string, token: string, step: StepId, onGoStep: (step: StepId) => void) {
  const pending = useRef<{ replicaId: string; token: string; row: Missing; focus: Element | null } | null>(null);
  const scope = useRef({ replicaId, token, step });
  scope.current = { replicaId, token, step };
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    if (request.replicaId !== replicaId || request.token !== token || request.row.step !== step) { pending.current = null; return; }
    let finished = false;
    const cancel = () => {
      if (finished) return;
      finished = true;
      observer.disconnect();
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", cancel, true);
      window.removeEventListener("keydown", cancel, true);
      if (pending.current === request) pending.current = null;
    };
    const locate = () => {
      if (finished || pending.current !== request || scope.current.replicaId !== replicaId || scope.current.token !== token || scope.current.step !== step) return;
      if (document.activeElement !== document.body && document.activeElement !== request.focus) { cancel(); return; }
      const target = document.querySelector(request.row.anchor);
      if (!target?.isConnected) return;
      cancel();
      jumpTo(request.row.anchor, request.row.label);
    };
    const observer = new MutationObserver(locate);
    const timer = window.setTimeout(cancel, 3000);
    observer.observe(document.body, { subtree: true, childList: true });
    window.addEventListener("pointerdown", cancel, true);
    window.addEventListener("keydown", cancel, true);
    locate();
    return cancel;
  }, [replicaId, step, token]);
  return useCallback((row: Missing) => {
    pending.current = null;
    if (!row.anchor) return;
    if (!row.step || row.step === step) { jumpTo(row.anchor, row.label); return; }
    pending.current = { replicaId, token, row, focus: document.activeElement };
    onGoStep(row.step);
  }, [onGoStep, replicaId, step, token]);
}
