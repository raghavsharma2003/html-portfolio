import { useState } from "react";

export default function MirrorTextCorrection({ onSave, locale = "en" }: {
  onSave: (note: string) => Promise<void>;
  locale?: string;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hi = locale === "hi";
  async function save() {
    if (busy || !note.trim()) return;
    setBusy(true); setError("");
    try { await onSave(note.trim()); setOpen(false); setNote(""); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Feedback could not be saved"); }
    finally { setBusy(false); }
  }
  if (!open) return <button className="text-button" type="button" onClick={() => setOpen(true)}>{hi ? "अपने शब्द लिखें" : "Suggest wording"}</button>;
  return <div>
    <label>{hi ? "आप कैसे कहते?" : "How would you say it?"}<textarea value={note} maxLength={2000} rows={3} disabled={busy} onChange={(event) => setNote(event.target.value)} /></label>
    <p>{hi ? "अभी आवाज़ रिकॉर्ड करके सुधार नहीं भेज सकते। यह सुझाव है, अपने आप बदलाव नहीं।" : "Audio corrections are not available yet. This saves feedback, not an automatic change."}</p>
    <button className="text-button" type="button" disabled={busy || !note.trim()} onClick={() => void save()}>{hi ? "सुझाव भेजें" : "Send suggestion"}</button>
    <button className="text-button" type="button" disabled={busy} onClick={() => setOpen(false)}>{hi ? "रद्द करें" : "Cancel"}</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
