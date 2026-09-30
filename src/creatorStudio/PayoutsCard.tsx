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
  fetchPayoutStatementReadableHtml,
  listPayoutStatements,
  readPayoutStatement,
  registerPayoutFundAccount,
  PaymentsApiError,
  type PayoutListEntry,
  type PayoutStatement,
} from "./paymentsApi";
import { useStudioLocale } from "./localeContext";
import { withCount, withLabel, type StudioCopy } from "./copy";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

function readableError(e: unknown, fallback: string): string {
  return e instanceof PaymentsApiError ? e.code.replaceAll("_", " ") : fallback;
}

function periodLabel(entry: { period_start: string; period_end: string }): string {
  const start = new Date(entry.period_start).toLocaleDateString(undefined, { month: "short", year: "numeric" });
  const end = new Date(entry.period_end).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  return `${start} to ${end}`;
}

/** WS-R52: the downloaded file's own text is user-visible chrome too, so it
 *  moves into copy.ts exactly like the on-screen labels it mirrors. */
function statementAsPlainText(t: StudioCopy, s: PayoutStatement): string {
  const c = t.payouts;
  const lines = [
    withLabel(c.statementDocTitle, periodLabel(s)),
    "",
    `${c.gross}: ${inr(s.gross_inr)}`,
    `${c.platformTake}: ${inr(s.take_inr)}`,
    `${c.tdsWithheld}: ${inr(s.tds_inr)}`,
    `${c.netToYou}: ${inr(s.net_inr)}`,
    "",
    withCount(c.followerSubsThisPeriod, s.follower_subscriptions),
  ];
  if (s.suite_share_inr > 0) {
    lines.push(
      s.suite_name
        ? c.suiteShare.split("{name}").join(s.suite_name).split("{label}").join(inr(s.suite_share_inr))
        : withLabel(c.suiteShareNoName, inr(s.suite_share_inr)),
    );
  }
  lines.push("", c.tdsNote, "", withLabel(c.stateLine, c.stateLabel[s.state]));
  if (s.provider_payout_ref) {
    lines.push(`${withLabel(c.providerRef, s.provider_payout_ref).replace(/^,\s*/, "")}`);
  }
  if (s.settled_at) lines.push(withLabel(c.settledLine, new Date(s.settled_at).toLocaleString()));
  if (s.failure_reason) lines.push(withLabel(c.failureReasonLine, s.failure_reason));
  lines.push(`${c.statementDocBuilt}: ${new Date(s.created_at).toLocaleString()}`);
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
  const { t, locale } = useStudioLocale();
  const c = t.payouts;
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

  /** WS-R138. `downloadJson`/`downloadText` above turn this SAME statement
   *  into a file this browser already holds; this fetches the server's own
   *  `format:"html"` printable twin - `AccountPage.tsx`'s `openReadable`
   *  shape (WS-R108), restated for the creator's own statement instead of a
   *  follower's export. No inline script is written into the new window
   *  (the builder's own "no script" law): there is nothing here for
   *  `win.document.write` to attach an event handler to. */
  const printStatement = useCallback(
    async (payoutId: string) => {
      setBusy(`print-${payoutId}`);
      setError("");
      try {
        const html = await fetchPayoutStatementReadableHtml(token, payoutId, locale);
        const win = window.open("", "_blank");
        if (!win) throw new Error("popup_blocked");
        win.document.open();
        win.document.write(html);
        win.document.close();
      } catch (e) {
        setError(readableError(e, c.printError));
      } finally {
        setBusy(null);
      }
    },
    [token, locale, c.printError],
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
      setNotice(c.saved);
      await load();
    } catch (e) {
      setError(readableError(e, "could not save this fund account reference"));
    } finally {
      setBusy(null);
    }
  }, [token, fundAccountRef, load, c.saved]);

  return (
    <article className="teacher-sheet-card vy-room__payouts-card">
      <h3>{c.title}</h3>
      <p className="field-note">
        {c.intro}
      </p>

      <label className="field-label" htmlFor="payout-fund-account">{c.fundAccountLabel}</label>
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
          {busy === "fund-account" ? c.saving : c.save}
        </button>
      </div>
      <p className="field-note">
        {c.fundAccountNote}
      </p>

      {payouts && payouts.length > 0 && (
        <ul className="vy-room__suite-list">
          {payouts.map((p) => (
            <li key={p.payout_id} className="vy-room__suite-row">
              <div className="vy-room__suite-row-head">
                <span className="vy-room__suite-name">{periodLabel(p)}</span>
                <span className="vy-room__suite-seats">
                  {c.netLabel.split("{label}").join(inr(p.net_inr)).split("{label2}").join(c.stateLabel[p.state])}
                </span>
              </div>
              <div className="vy-room__suite-actions">
                <button className="button secondary-button" type="button" onPointerDown={() => void toggle(p.payout_id)}>
                  {openPayout === p.payout_id ? c.hideStatement : c.showStatement}
                </button>
              </div>
              {openPayout === p.payout_id && (
                statement !== undefined ? (
                  statement && statement.payout_id === p.payout_id ? (
                    <div className="vy-room__suite-money">
                      <div className="vy-room__stats-grid">
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.gross_inr)}</span>
                          <span className="vy-room__stat-label">{c.gross}</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.take_inr)}</span>
                          <span className="vy-room__stat-label">{c.platformTake}</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.tds_inr)}</span>
                          <span className="vy-room__stat-label">{c.tdsWithheld}</span>
                        </div>
                        <div className="vy-room__stat">
                          <span className="vy-room__stat-value">{inr(statement.net_inr)}</span>
                          <span className="vy-room__stat-label">{c.netToYou}</span>
                        </div>
                      </div>
                      <p className="field-note">{withCount(c.followerSubsThisPeriod, statement.follower_subscriptions)}</p>
                      {statement.suite_share_inr > 0 && (
                        <p className="field-note">
                          {statement.suite_name
                            ? c.suiteShare.split("{name}").join(statement.suite_name).split("{label}").join(inr(statement.suite_share_inr))
                            : withLabel(c.suiteShareNoName, inr(statement.suite_share_inr))}
                        </p>
                      )}
                      <p className="field-note">
                        {c.tdsNote}
                      </p>
                      <p className="field-note">
                        {withLabel(c.stateLine, c.stateLabel[statement.state])}
                        {statement.provider_payout_ref ? withLabel(c.providerRef, statement.provider_payout_ref) : ""}.
                        {statement.settled_at ? ` ${withLabel(c.settledLine, new Date(statement.settled_at).toLocaleString())}.` : ""}
                        {statement.failure_reason ? ` ${withLabel(c.failureReasonLine, statement.failure_reason)}.` : ""}
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
                          {c.downloadJson}
                        </button>
                        <button
                          className="button secondary-button"
                          type="button"
                          onPointerDown={() =>
                            downloadBlob(
                              statementAsPlainText(t, statement),
                              "text/plain",
                              `payout-statement-${statement.period_start.slice(0, 10)}.txt`,
                            )
                          }
                        >
                          {c.downloadText}
                        </button>
                        <button
                          className="button secondary-button"
                          type="button"
                          disabled={busy === `print-${statement.payout_id}`}
                          onPointerDown={() => void printStatement(statement.payout_id)}
                        >
                          {busy === `print-${statement.payout_id}` ? c.openingStatement : c.printStatement}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="field-note">{c.couldNotLoadStatement}</p>
                  )
                ) : (
                  <p className="field-note" role="status">{c.loadingStatement}</p>
                )
              )}
            </li>
          ))}
        </ul>
      )}
      {payouts && payouts.length === 0 && (
        <p className="field-note">{c.noPayoutYet}</p>
      )}

      {notice && <p className="field-note" role="status">{notice}</p>}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
