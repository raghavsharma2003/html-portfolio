// The follower's own subscription panel (WS-R37). `CheckinsPanel.tsx`'s own
// shape (`role="dialog"`, `.room-menu`/`.room-btn`) so a reader who knows
// one dialog in this app knows this one. Owns no decision - every rule
// lives in api/_payments.js/api/_renewals.js; this file only renders what
// the server said and turns a click into a POST.
import { useCallback, useEffect, useState } from "react";
import type { RoomCopy } from "./copy";
import { withDate, withPrice } from "./copy";
import { paymentStatus, cancelSubscription, RoomPayApiError, type RoomPaymentStatus } from "./roomPayApi";
import { useDialogInView } from "./useDialogInView";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function dateLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export default function SubscriptionPanel({
  session,
  copy,
  onClose,
}: {
  session: string;
  copy: RoomCopy;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<RoomPaymentStatus | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      setStatus(await paymentStatus(session));
    } catch {
      setError(copy.errors.generic);
    }
  }, [session, copy.errors.generic]);

  useEffect(() => {
    void load();
  }, [load]);

  // WS-R63: scroll into view, focus in, Escape closes, focus returns to the
  // opener on close - `useDialogInView`'s own header.
  const dialogRef = useDialogInView(onClose);

  const doCancel = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const result = await cancelSubscription(session);
      setStatus((prev) => (prev ? { ...prev, subscription: result.subscription } : prev));
      setConfirming(false);
      setDone(true);
    } catch (e) {
      setError(e instanceof RoomPayApiError ? copy.subscription.cancelFailed : copy.errors.generic);
    } finally {
      setBusy(false);
    }
  }, [session, copy]);

  const sub = status?.subscription;
  const periodEnd = dateLabel(sub?.current_period_end);
  const priceLabel =
    status?.price_inr != null
      ? `Rs ${status.price_inr}${status.currency && status.currency !== "INR" ? ` ${status.currency}` : ""}`
      : "";

  return (
    <section
      className="room-menu room-subscription"
      role="dialog"
      aria-modal="true"
      aria-label={copy.subscription.title}
      ref={dialogRef}
    >
      <h2>{copy.subscription.title}</h2>
      {error && <p className="room-error">{error}</p>}

      {status && (
        <>
          <p className="room-fine">{status.tier === "paid" ? copy.subscription.tierPaid : copy.subscription.tierFree}</p>
          {/* WS-R125 (migration 130): access keeps working (tier stays
              'paid') while a mandate is merely paused or halted, never
              cancelled - `applyWebhook`'s own tier-flip predicate,
              unchanged - but the follower needs to know why a renewal is
              in doubt. Only `paused` names a working action: the follower
              themselves, in their own UPI app - no button here can do it
              FOR them (Razorpay's own FAQ, fetched 2026-09-05: "only they
              can resume it"). `halted` names no button either, for the
              same reason the studio card's own does not -
              `context/rejected.md#ws-r125-halted-mandate-start-new-button-
              would-have-been-a-silent-no-op`. */}
          {sub && (sub.state === "paused" || sub.state === "halted") && (
            <p className="room-fine">
              {sub.state === "halted"
                ? `${copy.subscriptionMandate.haltedLabel} ${copy.subscriptionMandate.haltedBody}`
                : `${copy.subscriptionMandate.pausedLabel} ${copy.subscriptionMandate.pausedBody}`}
            </p>
          )}
          {status.tier === "paid" && sub && periodEnd && (
            <p className="room-fine">
              {sub.cancel_at_period_end
                ? withDate(copy.subscription.willNotRenew, periodEnd)
                : priceLabel
                  ? withPrice(withDate(copy.subscription.renewsOn, periodEnd), priceLabel)
                  : withDate(copy.subscription.renewsOnNoPrice, periodEnd)}
            </p>
          )}

          {status.tier === "paid" && sub && !sub.cancel_at_period_end && (
            <>
              {done ? (
                <p className="room-fine">{copy.subscription.cancelDone}</p>
              ) : confirming ? (
                <>
                  <p className="room-fine">{copy.subscription.cancelConfirm}</p>
                  <button type="button" className="room-btn" disabled={busy} onClick={() => void doCancel()}>
                    {busy ? copy.subscription.cancelWorking : copy.subscription.cancelYes}
                  </button>
                  <button type="button" className="room-btn" disabled={busy} onClick={() => setConfirming(false)}>
                    {copy.subscription.cancelNo}
                  </button>
                </>
              ) : (
                <button type="button" className="room-btn" onClick={() => setConfirming(true)}>
                  {copy.subscription.cancel}
                </button>
              )}
            </>
          )}
        </>
      )}

      <button type="button" className="room-btn" onClick={onClose}>
        {copy.subscription.close}
      </button>
    </section>
  );
}
