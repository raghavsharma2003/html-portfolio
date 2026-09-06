// The data menu — download-your-data and forget-me — pulled out of
// RoomApp.tsx into its own file (WS-R139) so it can be `React.lazy`-loaded:
// most sessions never open it, and its own erasure flow is exactly the kind
// of rarely-used, self-contained screen the brief calls out (`the Room's
// account, receipt, taste, about and referral screens load as their own
// chunks`) — this is the "receipt" screen's own ENTRY POINT (the receipt
// itself, shown once forgetting completes, is `ForgetReceipt.tsx`, a
// sibling lazy chunk RoomApp.tsx mounts on the "gone" phase).
// See `context/decisions.md#ws-r139-room-secondary-screens-are-lazy-chunks`.
//
// A DEFAULT export: `React.lazy(() => import("./DataMenu"))` requires one.
import { useState } from "react";
import type { StudioSession } from "../studio/types";
import { withName } from "./copy";
import { exportRoomData, forgetRoomData, type RoomFollower, type RoomForgetReceipt } from "./roomApi";
import { useDialogInView } from "./useDialogInView";
import type { RoomCopy } from "./copy";
import { ROOM_VOICE_UI } from "./RoomApp";

export default function DataMenu({
  name,
  copy,
  session,
  auth,
  follower,
  onClose,
  onForgotten,
}: {
  name: string;
  copy: RoomCopy;
  session: string;
  auth: StudioSession | null;
  follower: RoomFollower | null;
  onClose: () => void;
  onForgotten: (receipt: RoomForgetReceipt | null) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // WS-R63: scrolls into view, moves focus in, closes on Escape (WS-R50's
  // own law, now this one hook's job rather than five ad hoc copies of it),
  // returns focus to the opener on close - `useDialogInView`'s own header.
  const dialogRef = useDialogInView(onClose);

  return (
    <section className="room-menu" role="dialog" aria-modal="true" aria-label={copy.menu.title} ref={dialogRef}>

      <h2>{copy.menu.title}</h2>
      {/* WS-R19: real numbers from the follower's own row, never estimated -
          law 5. Renders only for a paid follower with the flag on; a free
          follower's own copy of these fields is always 0 by construction
          (`clientFollower`), so there is nothing honest to show them here. */}
      {ROOM_VOICE_UI && follower?.tier === "paid" && (
        <p className="room-fine room-num">
          {copy.voice.minutesLeft
            .replace("{used}", String(Math.round(follower.voice_seconds_used / 60)))
            .replace("{included}", String(Math.round(follower.voice_seconds_included / 60)))}
        </p>
      )}
      {error && <p className="room-error">{error}</p>}
      <div className="room-actions">
        <button
          type="button"
          className="room-btn"
          disabled={busy || !auth}
          onClick={async () => {
            if (!auth) return;
            setBusy(true);
            try {
              const dump = await exportRoomData(session, auth.accessToken);
              const blob = new Blob([JSON.stringify(dump, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "your-data.json";
              a.click();
              URL.revokeObjectURL(url);
            } catch {
              setError(copy.errors.generic);
            } finally {
              setBusy(false);
            }
          }}
        >
          {copy.menu.download}
        </button>
        <p className="room-fine">{copy.menu.downloadNote}</p>

        {!confirming ? (
          <button type="button" className="room-btn danger" onClick={() => setConfirming(true)}>
            {copy.menu.forget}
          </button>
        ) : (
          <>
            <p className="room-fine">{withName(copy.menu.forgetNote, name)}</p>
            <button
              type="button"
              className="room-btn danger"
              disabled={busy || !auth}
              onClick={async () => {
                if (!auth) return;
                setBusy(true);
                try {
                  const result = await forgetRoomData(session, auth.accessToken);
                  onForgotten(result.receipt ?? null);
                } catch {
                  setError(copy.errors.generic);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {copy.menu.forgetConfirm}
            </button>
            <button type="button" className="room-btn" onClick={() => setConfirming(false)}>
              {copy.menu.forgetCancel}
            </button>
          </>
        )}

        <button type="button" className="room-btn" onClick={onClose}>
          {copy.menu.close}
        </button>
      </div>
    </section>
  );
}
