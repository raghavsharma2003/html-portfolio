// The switch in More — HIS door back in, and the reason it has to exist.
//
// The explainer sheet promises "We will not ask again", and `shouldExplain`
// makes that true forever. A refusal honoured that completely needs a door the
// person can open themselves, or "no" quietly becomes "never" — which is the
// same defect as a settings screen with no way to leave, one level up.
//
// ── WHY IT LIVES HERE AND NOT IN MoreSheet.tsx ────────────────────────────
//
// MoreSheet belongs to another workstream this wave. A row that carried a
// permission state machine, an async OS read and a re-read on every open would
// be forty lines of this lane's logic inside their file, reviewed by them and
// broken by the next person who touches either. So the whole control is one
// component here, and their side is three lines: an import, and this tag under
// the Sounds row.
//
// It borrows `.sound-row`, `.sswitch` and `.sknob` from that workstream's CSS
// on purpose rather than adding a second switch style — two switches that look
// slightly different in one sheet is the kind of thing nobody files a bug
// about and everybody notices. If those classes are ever renamed to something
// generic (`.switch-row` would be the honest name for what they now are), this
// file changes with them and nothing else does.
//
// ── NO CALLER YET, AND THAT IS A HANDOFF RATHER THAN AN OVERSIGHT ────────
//
// The one site it belongs on is MoreSheet.tsx, which another workstream owns
// this wave, so the control is finished here and the swap there is three lines
// (import, tag, done). Same arrangement `src/native/haptics.ts` states for
// `moment()`, and the same expiry applies: IF THIS IS STILL UNCALLED IN A
// MONTH, DELETE IT. `dead-writers` is this repo's law and it does not stop
// being true for a component.
//
// ── THE FOUR STATES, AND WHY THE ROW IS NOT ALWAYS A SWITCH ───────────────
//
// A toggle that silently does nothing is worse than no toggle. So:
//
//   granted  a real switch over `notifyPrefs.enabled`. Flipping it off stops
//            every post immediately (`canNotify` reads it before the OS).
//   prompt   NOT a switch — a row that says what it will do and then does it:
//            tapping it raises the system dialog. This is the state a person
//            who declined the sheet is in, and it is the door back in.
//   denied   the OS has refused and only the OS can change that. The row says
//            so plainly and is disabled. An app cannot re-request a denied
//            Android 13+ permission, and a switch that pretended otherwise
//            would be the app lying about what a tap does.
//   absent   the browser has no notification API at all (iOS Safari outside an
//            installed PWA, most embedded WebViews). The row is not rendered:
//            an offer that cannot be accepted is not an offer.

import { useCallback, useEffect, useState } from "react";
import type { AppState } from "../state/store";
import { notifyAvailable, permissionState, requestPermission, type NotifyPermission } from "./index";

interface Props {
  state: AppState;
  setState: React.Dispatch<React.SetStateAction<AppState>>;
}

const BellIcon = ({ on, size = 19 }: { on: boolean; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M18 8.6a6 6 0 1 0-12 0c0 5-2 6.4-2 6.4h16s-2-1.4-2-6.4Z" />
    <path d="M13.7 19a2 2 0 0 1-3.4 0" />
    {on ? null : <path d="M4 4l16 16" />}
  </svg>
);

export default function NotifyRow({ state, setState }: Props) {
  const [perm, setPerm] = useState<NotifyPermission>("prompt");
  // Re-read every time the sheet mounts. The user may have changed this in
  // system settings since the app started, and a settings screen showing a
  // stale answer about settings is the one place that is least forgivable.
  useEffect(() => {
    let dropped = false;
    void permissionState().then((p) => {
      if (!dropped) setPerm(p);
    });
    return () => {
      dropped = true;
    };
  }, []);

  const on = perm === "granted" && state.notifyPrefs?.enabled !== false;

  const ask = useCallback(() => {
    const now = Date.now();
    setState((s) => ({ ...s, notifyPrefs: { ...(s.notifyPrefs ?? {}), asked: now } }));
    void (async () => {
      const p = await requestPermission();
      setPerm(p);
      const at = Date.now();
      setState((s) => ({
        ...s,
        notifyPrefs: {
          ...(s.notifyPrefs ?? {}),
          // Asking from HERE clears a previous decline: he came looking for
          // this. `declined` is a promise not to ask him, never a lock on his
          // own switch.
          declined: undefined,
          ...(p === "granted" ? { granted: at, enabled: true } : { declined: at }),
        },
      }));
    })();
  }, [setState]);

  const flip = useCallback(() => {
    const next = state.notifyPrefs?.enabled === false;
    setState((s) => ({ ...s, notifyPrefs: { ...(s.notifyPrefs ?? {}), enabled: next } }));
  }, [state.notifyPrefs?.enabled, setState]);

  if (!notifyAvailable()) return null;

  const sub =
    perm === "denied"
      ? "Blocked in your phone's settings"
      : perm !== "granted"
        ? "Off. Only her messages, a missed call, and her story."
        : on
          ? "Her messages, a missed call, and her story. Nothing else."
          : "Off. Nothing will reach your lock screen.";

  return (
    <button
      type="button"
      className="srow sound-row"
      // Only a switch when it can switch. See the header: a role that promises
      // a state change the OS will not perform is the control lying.
      {...(perm === "granted" ? { role: "switch" as const, "aria-checked": on } : {})}
      disabled={perm === "denied"}
      data-tel="more.notifications"
      onClick={perm === "granted" ? flip : ask}
    >
      <span className="sicon" aria-hidden="true">
        <BellIcon on={on} />
      </span>
      <span className="stext">
        <span className="stitle">Notifications</span>
        <span className="ssub">{sub}</span>
      </span>
      {perm === "granted" ? (
        <span className="sswitch" aria-hidden="true">
          <span className="sknob" />
        </span>
      ) : (
        <span className="schev" aria-hidden="true" />
      )}
    </button>
  );
}
