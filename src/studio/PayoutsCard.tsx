// The Payouts card (WS-R36). Self-contained on `CheckinsCard.tsx`'s own
// precedent: it owns its own fetch/open/download state rather than threading
// more `useState`s through `RoomStudio.tsx`'s already-large hook graph, and
// it fails closed on its own - a creator who cannot see this card can still
// publish and run their Room.
//
// The download controls are the SAME in-page blob pattern `RoomApp.tsx`'s
// data menu already uses: the file is built in the browser from the
// server's own JSON, never offered as a link, so there is no URL anywhere
// that hands one creator's own money numbers to whoever holds it.
import { useCallback, useEffect, useState } from "react";
import {
  listPayoutStatements,
  readPayoutStatement,
  registerPayoutFundAccount,
  PaymentsApiError,
  type PayoutListEntry,
  type PayoutStatement,
  type PayoutState,
} from "./paymentsApi";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const STATE_LABEL: Record<PayoutState, string> = {
  built: "Built, not yet sent",
  pending_account: "Waiting on a fund account",
  queued: "Queued with the provider",
  sent: "Sent",
  settled: "Settled",
  failed: "Failed",
};

function readableError(e: unknown, fallback: string): string {
  return e instanceof PaymentsApiError ? e.code.replaceAll("_", " ") : fallback;
}

function periodLabel(entry: { period_start: string; period_end: string }): string {
  const start = new Date(entry.period_start).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const end = new Date(entry.period_end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${start} to ${end}`;
}

function statementAsPlainText(s: PayoutStatement): string {
  const lines = [
    `Payout statement, ${periodLabel(s)}`,
    "",
    `Gross: ${inr(s.gross_inr)}`,
    `Platform take: ${inr(s.take_inr)}`,
    `TDS withheld: ${inr(s.tds_inr)}`,
    `Net to you: ${inr(s.net_inr)}`,
    "",
    `Follower subscriptions this period: ${s.follower_subscriptions}`,
  ];
  if (s.suite_share_inr > 0) {
    lines.push(`Suite seat share${s.suite_name ? ` (${s.suite_name})` : ""}: ${inr(s.suite_share_inr)}, included in gross above`);
  }
  lines.push("", s.tds_note, "", `State: ${STATE_LABEL[s.state]}`);
  if (s.provider_payout_ref) lines.push(`Provider reference: ${s.provider_payout_ref}`);
  lines.push(`Built: ${new Date(s.created_at).toLocaleString()}`);
  return lines.join("\n");
}

function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PayoutsCard({ token }: { token: string }) {
  const [payouts, setPayouts] = useState<PayoutListEntry[] | null>(null);
  const [error, setError] = useState("");
  const [openPayout, setOpenPayout] = useState<string | null>(null);
  const [statement, setStatement] = useState<PayoutStatement | null | undefined>(undefined);
  const [fundAccountRef, setFundAccountRef] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      setPayouts(await listPayoutStatements(token));
    } catch (e) {
      setError(readableError(e, "could not load your payouts"));
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggle = useCallback(
    async (payoutId: string) => {
      if (openPayout === payoutId) {
        setOpenPayout(null);
        return;
      }
      setOpenPayout(payoutId);
      setStatement(undefined);
      setError("");
      try {
        setStatement(await readPayoutStatement(token, payoutId));
      } catch (e) {
        setError(readableError(e, "could not load this statement"));
      }
    },
    [token, openPayout],
  );

  const saveFundAccount = useCallback(async () => {
    const ref = fundAccountRef.trim();
    if (!ref) return;
    setBusy("fund-account");
    setError("");
    setNotice("");
    try {
      await registerPayoutFundAccount(token, ref);
      setFundAccountRef("");
      setNotice("Fund account reference saved.");
      await load();
    } catch (e) {
      setError(readableError(e, "could not save this fund account reference"));
    } finally {
      setBusy(null);
    }
  }, [token, fundAccountRef, load]);

  return (
    <article className="teacher-sheet-card vy-room__payouts-card">
      <h3>Payouts</h3>
      <p className="field-note">
        One statement a month, one number you can check against your bank line: what followers paid, what the
        platform took, what was withheld for tax, and what reaches you.
      </p>

      <label className="field-label" htmlFor="payout-fund-account">Fund account reference (from your payment provider, never a bank detail typed here)</label>
      <div className="vy-room__suite-join">
        <input
          id="payout-fund-account"
          className="field"
          value={fundAccountRef}
          placeholder="fa_..."
          onChange={(event) => setFundAccountRef(event.target.value)}
        />
        <button
          className="button secondary-button"
          type="button"
          disabled={busy === "fund-account" || !fundAccountRef.trim()}
          onPointerDown={() => void saveFundAccount()}
        >
          {busy === "fund-account" ? "Saving..." : "Save"}
        </button>
      </div>
      <p className="field-note">
        This platform never asks for your bank account number or UPI id. Your payment provider issues a reference
        once you finish their own onboarding, and that reference is the only thing saved here.
      </p>

      {payouts && payouts.length > 0 && (
        <ul className="vy-room__suite-list">
          {payouts.map((p) => (
            <li key={p.payout_id} className="vy-room__suite-row">
              <div className="vy-room__suite-row-head">
                <span className="vy-room__suite-name">{periodLabel(p)}</span>
                <span className="vy-room__suite-seats">
                  {inr(p.net_inr)} net - {STATE_LABEL[p.state]}
                </span>
              </div>
              <div className="vy-room__suite-actions">
                <button className="button secondary-button" type="button" onPointerDown={() => void toggle(p.payout_id)}>
                  {openPayout === p.payout_id ? "Hide statement" : "Show statement"}
                </button>
              </div>
              {openPayout === p.payout_id && (
                statement !== undefined ? (
                  statement && statement.payout_id === p.payout_id ? (
                    <div className="vy-room__suite-money">
                      <div className="vy-room__stats-grid">
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.gross_inr)}</span>
                          <span className="vy-room__stat-label">Gross</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.take_inr)}</span>
                          <span className="vy-room__stat-label">Platform take</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.tds_inr)}</span>
                          <span className="vy-room__stat-label">TDS withheld</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.net_inr)}</span>
                          <span className="vy-room__stat-label">Net to you</span>
                        </div>
                      </div>
                      <p className="field-note">Follower subscriptions this period: {statement.follower_subscriptions}.</p>
                      {statement.suite_share_inr > 0 && (
                        <p className="field-note">
                          Includes a Suite seat share{statement.suite_name ? ` from ${statement.suite_name}` : ""}: {inr(statement.suite_share_inr)}.
                        </p>
                      )}
                      <p className="field-note">
                        TDS reflects the rate the platform operator has configured. Right now that rate is 0%, so nothing is
                        withheld. The operator believes Section 194J of India's Income Tax Act applies to a creator's Room
                        earnings, but an accountant has not confirmed this, and the rate may change before any real payout
                        is sent.
                      </p>
                      <p className="field-note">
                        State: {STATE_LABEL[statement.state]}
                        {statement.provider_payout_ref ? `, provider reference ${statement.provider_payout_ref}` : ""}.
                      </p>
                      <div className="vy-room__suite-actions">
                        <button
                          className="button secondary-button"
                          type="button"
                          onPointerDown={() =>
                            downloadBlob(
                              JSON.stringify(statement, null, 2),
                              "application/json",
                              `payout-statement-${statement.period_start.slice(0, 10)}.json`,
                            )
                          }
                        >
                          Download as JSON
                        </button>
                        <button
                          className="button secondary-button"
                          type="button"
                          onPointerDown={() =>
                            downloadBlob(
                              statementAsPlainText(statement),
                              "text/plain",
                              `payout-statement-${statement.period_start.slice(0, 10)}.txt`,
                            )
                          }
                        >
                          Download as text
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="field-note">Could not load this statement.</p>
                  )
                ) : (
                  <p className="field-note" role="status">Loading statement.</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {payouts && payouts.length === 0 && (
        <p className="field-note">No payout has been built for you yet. This fills in once a period closes with revenue on it.</p>
      )}

      {notice && <p className="field-note" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
