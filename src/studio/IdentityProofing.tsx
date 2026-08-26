import { useEffect, useMemo, useState } from "react";
import { identityStatus, revokeIdentityCase, submitIdentityCase } from "./identityApi";
import type { IdentityCase, ReplicaSource } from "./types";

const STATEMENTS = [
  "This is my own current government-issued identity document.",
  "The document and portrait identify only me.",
  "Use it only to verify my identity and that I am at least 18.",
  "Do not use this document or portrait for model training.",
  "Erase the document and derived identity reference after verification or withdrawal.",
] as const;

function eligibleIdentitySource(source: ReplicaSource) {
  return source.state === "quarantined" && source.capture_mode === "identity_document" && !source.contains_third_parties &&
    ((source.kind === "image" && ["image/jpeg", "image/png"].includes(source.mime)) ||
      (source.kind === "document" && source.mime === "application/pdf"));
}

function sourceLabel(source: ReplicaSource) {
  const type = source.mime === "application/pdf" ? "Private PDF" : "Private ID image";
  return `${type} · ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(source.created_at))}`;
}

export default function IdentityProofing({
  token,
  replicaId,
  sources,
  onChanged,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  sources: ReplicaSource[];
  onChanged: () => Promise<void>;
  onAuthError: (cause: unknown) => void;
}) {
  const [identityCase, setIdentityCase] = useState<IdentityCase | null>(null);
  const [selectedSource, setSelectedSource] = useState("");
  const [checked, setChecked] = useState(() => STATEMENTS.map(() => false));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const eligible = useMemo(() => sources.filter(eligibleIdentitySource), [sources]);
  const pending = identityCase?.state === "submitted" || identityCase?.state === "verifying";
  const verified = identityCase?.state === "verified";

  useEffect(() => {
    let live = true;
    setLoading(true);
    identityStatus(token, replicaId).then((next) => {
      if (live) setIdentityCase(next);
    }).catch((cause) => {
      if (live) {
        setError(cause instanceof Error ? cause.message : "Could not load identity status");
        onAuthError(cause);
      }
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [onAuthError, replicaId, token]);

  useEffect(() => {
    if (!pending) return;
    let live = true;
    let timer = 0;
    const poll = async () => {
      try {
        const next = await identityStatus(token, replicaId);
        if (!live) return;
        setIdentityCase(next);
        if (next?.state === "submitted" || next?.state === "verifying") timer = window.setTimeout(() => void poll(), 5_000);
        else await onChanged();
      } catch (cause) {
        if (!live) return;
        setError(cause instanceof Error ? cause.message : "Could not refresh identity status");
        onAuthError(cause);
        timer = window.setTimeout(() => void poll(), 10_000);
      }
    };
    timer = window.setTimeout(() => void poll(), 2_000);
    return () => { live = false; window.clearTimeout(timer); };
  }, [onAuthError, onChanged, pending, replicaId, token]);

  async function submit() {
    if (!selectedSource || !checked.every(Boolean)) return;
    setBusy(true);
    setError("");
    try {
      setIdentityCase(await submitIdentityCase(token, replicaId, selectedSource));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not submit identity evidence");
      onAuthError(cause);
    } finally {
      setBusy(false);
    }
  }

  async function revoke() {
    if (!identityCase || confirmation !== "ERASE ID") return;
    setBusy(true);
    setError("");
    try {
      setIdentityCase(await revokeIdentityCase(token, replicaId, identityCase.identity_case_id));
      setConfirming(false);
      setConfirmation("");
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not withdraw identity evidence");
      onAuthError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="identity-proofing" className="identity-section" aria-labelledby="identity-title">
      <div className="identity-index">03</div>
      <div className="identity-body">
        <div className="panel-title-row">
          <div><p className="eyebrow">Adult identity</p><h3 id="identity-title">Bind one real person to this replica</h3></div>
          <span className={`permission-badge ${identityCase?.state === "evidence_ready" || verified ? "permission-active" : pending ? "permission-pending" : ""}`}>
            <i />{verified ? "Identity verified" : identityCase?.state === "evidence_ready" ? "ID evidence ready" : pending ? "Independent review pending" : "Identity gate locked"}
          </span>
        </div>

        <p className="identity-intro">
          Choose a private ID image or PDF already in your source vault. The verifier must establish document authenticity,
          current validity, adult age, and a usable portrait. OCR or facial age estimation alone can never unlock the replica.
        </p>

        {loading ? (
          <div className="liveness-wait" role="status"><span className="spinner" />Loading identity evidence status</div>
        ) : pending ? (
          <div className="identity-state identity-pending" role="status">
            <span className="verification-orbit"><i /><i /><i /></span>
            <div><p className="eyebrow">Private evidence isolated</p><h4>Authenticity and age review in progress</h4><p>No name, date of birth, document number, address, portrait, or OCR transcript is written to the replica database.</p></div>
          </div>
        ) : identityCase?.state === "evidence_ready" || verified ? (
          <div className="identity-state identity-ready" role="status">
            <span className="verification-check">✓</span>
            {verified
              ? <div><p className="eyebrow">Composite verification passed</p><h4>Adult identity and liveness are bound</h4><p>The raw ID and live challenge media are queued for verified erasure. Only the bounded proof remains until expiry or withdrawal.</p></div>
              : <div><p className="eyebrow">Evidence accepted</p><h4>Adult ID evidence is ready for live comparison</h4><p>Identity is not complete yet. The next voice + live-face challenge must match this exact private reference.</p></div>}
            <button className="text-button" type="button" onClick={() => setConfirming(true)}>Withdraw and erase</button>
          </div>
        ) : (
          <>
            {(identityCase?.state === "failed" || identityCase?.state === "expired") && (
              <div className="identity-state identity-failed" role="alert"><strong>Evidence did not pass</strong><span>{identityCase.failure_code.replaceAll("_", " ")}</span></div>
            )}
            {eligible.length ? (
              <div className="identity-form">
                <label className="field">
                  <span>Private ID source</span>
                  <select value={selectedSource} onChange={(event) => setSelectedSource(event.target.value)}>
                    <option value="">Choose one quarantined file</option>
                    {eligible.map((source) => <option key={source.source_id} value={source.source_id}>{sourceLabel(source)}</option>)}
                  </select>
                </label>
                <fieldset className="identity-statements">
                  <legend>Explicit identity-use permission</legend>
                  {STATEMENTS.map((statement, index) => (
                    <label key={statement}>
                      <input type="checkbox" checked={checked[index]} onChange={() => setChecked((items) => items.map((item, itemIndex) => itemIndex === index ? !item : item))} />
                      <span>{statement}</span>
                    </label>
                  ))}
                </fieldset>
                <button className="button primary-button" type="button" disabled={busy || !selectedSource || !checked.every(Boolean)} onClick={() => void submit()}>
                  {busy ? "Submitting private evidence" : "Submit for independent verification"}
                </button>
              </div>
            ) : (
              <div className="evidence-gate">
                <span className="large-lock" aria-hidden="true" />
                <div><strong>Add a private ID source first</strong><p>Upload a JPEG, PNG, or PDF above, declare that it contains only you, and complete private finalization.</p></div>
              </div>
            )}
          </>
        )}

        {confirming && identityCase && (
          <div className="identity-withdraw">
            <strong>Withdraw identity evidence and erase its private source?</strong>
            <p>This immediately clears adult, identity, and liveness gates. Type <b>ERASE ID</b> to continue.</p>
            <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} aria-label="Type ERASE ID to confirm" autoComplete="off" />
            <div><button className="text-button" type="button" disabled={busy} onClick={() => setConfirming(false)}>Keep evidence</button><button className="button danger-button" type="button" disabled={busy || confirmation !== "ERASE ID"} onClick={() => void revoke()}>Erase identity evidence</button></div>
          </div>
        )}
        {error && <p className="inline-error" role="alert">{error}</p>}
        <p className="identity-boundary">The owner interface cannot approve authenticity, age, identity, or liveness. It can only submit or revoke evidence.</p>
      </div>
    </section>
  );
}
