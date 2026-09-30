import { useMemo, useState } from "react";
import { grantVerifiedModelConsent, revokeVerifiedModelConsent } from "./enrollmentApi";
import { ReplicaApiError } from "./replicaApi";
import type { ConsentReceipt, Replica } from "./types";

const STATEMENTS = [
  ["private_self_replica_only", "I am creating only my own private replica. I will not submit another person's identity or voice."],
  ["authorize_biometric_voice_modeling", "I authorize creation of revocable voice embeddings and biometric voice characteristics from my approved evidence."],
  ["authorize_private_training", "I authorize private training or adaptation of a voice model bound only to this replica."],
  ["authorize_disclosed_inference", "I authorize private inference after activation. Every output must identify itself as synthetic."],
  ["understand_synthetic_disclosure_and_watermarking", "I understand generated audio will carry audible disclosure, an imperceptible watermark, and a signed provenance receipt."],
  ["understand_revocation_stops_use_and_deletes_copies", "I understand withdrawal disables use immediately and queues derived models and provider copies for verified deletion."],
] as const;

function isActive(receipt: ConsentReceipt) {
  return !receipt.revoked_at && (!receipt.expires_at || new Date(receipt.expires_at).getTime() > Date.now());
}

export default function ModelConsentGate({
  token,
  replica,
  consents,
  onChanged,
  onAuthError,
}: {
  token: string;
  replica: Replica;
  consents: ConsentReceipt[];
  onChanged: () => Promise<void>;
  onAuthError: (cause: unknown) => void;
}) {
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [withdrawText, setWithdrawText] = useState("");
  const active = useMemo(() => new Map(consents.filter(isActive).map((receipt) => [receipt.scope, receipt])), [consents]);
  const biometric = active.get("biometric");
  const modelReady = active.has("training") && active.has("inference");
  const identityReady = replica.age_verified && replica.identity_verified && replica.liveness_verified && Boolean(biometric);
  const allChecked = STATEMENTS.every(([key]) => checked[key]);

  function report(cause: unknown) {
    if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause);
    setError(cause instanceof Error ? cause.message : "Consent operation failed");
  }

  async function grant() {
    if (!identityReady || !allChecked) return;
    setBusy(true);
    setError("");
    try {
      await grantVerifiedModelConsent(token, replica.replica_id);
      setChecked({});
      await onChanged();
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (withdrawText !== "PAUSE AI") return;
    setBusy(true);
    setError("");
    try {
      await revokeVerifiedModelConsent(token, replica.replica_id);
      setWithdrawText("");
      await onChanged();
    } catch (cause) { report(cause); }
    finally { setBusy(false); }
  }

  return (
    <section id="model-consent-gate" className="model-consent-section" aria-labelledby="model-consent-title">
      <div className="section-heading">
        <div><p className="eyebrow">Permission to build your AI</p><h2 id="model-consent-title">This is the consent that lets your AI exist</h2></div>
        <span className={`model-consent-state ${modelReady ? "ready" : ""}`}>{modelReady ? "Granted" : "Locked"}</span>
      </div>
      <p className="voice-enrollment-intro">Uploading memories never grants rights to build your AI. This separate ceremony is bound to your passed live identity proof and can be withdrawn at any time.</p>

      {!identityReady ? (
        <div className="voice-gate-blockers" role="status"><strong>Verified consent is unavailable</strong><p>Complete adult identity and live face-and-voice verification first. The narrow biometric verification receipt must still be active.</p></div>
      ) : modelReady ? (
        <div className="model-consent-active">
          <div className="voice-success"><span>✓</span><p><strong>Your AI is authorized to run</strong><small>Build permission expires {new Date(active.get("training")!.expires_at!).toLocaleDateString()} · inference expires {new Date(active.get("inference")!.expires_at!).toLocaleDateString()}</small></p></div>
          <p>Public sharing, raw downloads, API access, telephony, and using your material to improve anyone else's AI remain off.</p>
          <label className="field-label" htmlFor="pause-model-confirmation">Type PAUSE AI to withdraw build and inference permission</label>
          <div className="voice-row-actions">
            <input id="pause-model-confirmation" className="field" value={withdrawText} autoComplete="off" onChange={(event) => setWithdrawText(event.target.value.toUpperCase())} />
            <button className="button destructive-button" type="button" disabled={busy || withdrawText !== "PAUSE AI"} onClick={() => void withdraw()}>{busy ? "Withdrawing" : "Withdraw now"}</button>
          </div>
        </div>
      ) : (
        <div className="model-consent-ceremony">
          <div className="model-consent-basis"><span>LIVE</span><p><strong>Identity-bound ceremony</strong><small>Biometric receipt {biometric?.receipt_hash?.slice(0, 10) ?? "verified"}…</small></p></div>
          <div className="model-consent-statements">
            {STATEMENTS.map(([key, label]) => (
              <label key={key} className="model-consent-check">
                <input type="checkbox" checked={Boolean(checked[key])} onChange={(event) => setChecked((current) => ({ ...current, [key]: event.target.checked }))} />
                <span>{label}</span>
              </label>
            ))}
          </div>
          <button className="button primary-button" type="button" disabled={busy || !allChecked} onClick={() => void grant()}>{busy ? "Writing signed receipts" : "Grant permission to build and run your AI"}</button>
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error.replaceAll("_", " ")}</p>}
      <p className="voice-enrollment-note">Build permission lasts 180 days; inference permission lasts 30 days. Renewal always requires a new affirmative ceremony.</p>
    </section>
  );
}
