// useMoments — the seam between the milestone OS (engine/milestones.ts) and
// the celebration surface (Celebration.tsx).
//
// milestones.ts is a pure function of the record and the fired-ledger. It
// knows WHAT counts and that it counts once. It deliberately knows nothing
// about when it is safe to interrupt a person, which is this file's whole
// job. Four rules, and each one is a thing that would otherwise be wrong:
//
//   1. ONE AT A TIME. detectMoments can legitimately return several (an
//      imported history, a session that crosses two lines at once). Firing
//      them together is a slot machine. The first is shown; the rest stay
//      eligible and surface on a LATER state change, which spaces them out
//      by real events rather than by a timer.
//   2. MARKED FIRED THE INSTANT IT IS SHOWN, not on dismiss. A crash, a tab
//      close or a reload between "shown" and "dismissed" must not replay it.
//      The ledger is the record of "he has seen this", and he has.
//   3. DEBOUNCED ON A SIGNATURE, not on every render. State is written on
//      typing status, read receipts, her interior — detection runs only when
//      something the DETECTOR reads actually moved (message count, callmark
//      count, first-message stamp, the tallies, the ledger itself).
//   4. NEVER WHILE SHE IS PICKING UP. `suppressed` is the caller's word for
//      "a call is live"; for the first ten seconds of one, a card over the
//      screen lands in the middle of hello. After that a call is just a
//      place they are, and a moment can land there like anywhere else.
//
// What it is NOT allowed to do, and this is the charter line rather than a
// preference: it never fires on elapsed time, silence, or a timer. Every
// trigger here is a state change caused by something that HAPPENED — the
// same law `never-scheduled` and `proactive-reason-contingent` already put
// on her unprompted messages. A days-known milestone becomes ELIGIBLE by
// time passing and still waits for a real interaction to be seen.

import { useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { detectMoments, type Moment } from "../engine/milestones";
import type { AppState } from "../state/store";

/** Long enough for a burst of writes (a reply landing, its status ticking)
 *  to settle into one detection, short enough to still feel caused by the
 *  thing that just happened. */
const DEBOUNCE_MS = 900;

/** She is answering. Nothing goes over the screen during hello. */
const PICKUP_GRACE_MS = 10_000;

export interface MomentsHandle {
  /** The one moment currently on screen, or null. */
  moment: Moment | null;
  /** Called by the surface when it has finished settling. */
  dismiss: () => void;
}

/** Everything the detector actually reads, as one comparable string. If this
 *  has not changed, re-running detection cannot change the answer. */
function signature(s: AppState): string {
  let msgs = 0;
  let calls = 0;
  for (const m of s.messages) {
    if (m.kind === "callmark") calls++;
    else msgs++;
  }
  const t = s.tally ?? {};
  return [
    msgs,
    calls,
    s.messages.find((m) => m.at)?.at ?? 0,
    t.chessGames ?? 0,
    t.chessWinsHim ?? 0,
    t.chessWinsHer ?? 0,
    t.tttGames ?? 0,
    t.wyrCards ?? 0,
    s.momentsFired?.length ?? 0,
  ].join("|");
}

export function useMoments(
  state: AppState,
  setState: Dispatch<SetStateAction<AppState>>,
  suppressed = false,
): MomentsHandle {
  const [moment, setMoment] = useState<Moment | null>(null);
  // The id on screen right now. A ref rather than derived from `moment`
  // because the detection effect reads it in a timeout, after the render
  // that set it — a stale closure over state would let a second card in.
  const showing = useRef<string | null>(null);

  // Rising edge of `suppressed`: the effect body runs only when the value
  // changes, so this stamps the moment the call went live and nothing else.
  const pickupAt = useRef(0);
  useEffect(() => {
    if (suppressed) pickupAt.current = Date.now();
  }, [suppressed]);

  const sig = signature(state);
  const onboarded = state.onboarded;

  useEffect(() => {
    if (!onboarded) return;
    if (showing.current) return; // one at a time — the rest keep their turn
    const t = setTimeout(() => {
      if (showing.current) return;
      // Re-checked here, not at schedule time: the ten seconds may well have
      // elapsed while this timer was pending, and a moment held back for a
      // call that is now a minute old is held back for nothing.
      if (suppressed && Date.now() - pickupAt.current < PICKUP_GRACE_MS) return;

      const found = detectMoments({
        messages: state.messages,
        fired: state.momentsFired ?? [],
        tally: state.tally,
        nowMs: Date.now(),
      })[0];
      if (!found) return;

      showing.current = found.id;
      setMoment(found);
      // Fired NOW, in the same tick it becomes visible. Guarded against a
      // double-push because React may invoke this updater twice in StrictMode
      // and the ledger is a list, not a set.
      setState((s) =>
        s.momentsFired?.includes(found.id)
          ? s
          : { ...s, momentsFired: [...(s.momentsFired ?? []), found.id] },
      );
    }, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // `state` is intentionally not a dependency: `sig` is the projection of it
    // that detection depends on, and depending on the object would run this on
    // every keystroke that touches any unrelated field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig, suppressed, onboarded]);

  const dismiss = () => {
    showing.current = null;
    setMoment(null);
  };

  return { moment, dismiss };
}

export default useMoments;
