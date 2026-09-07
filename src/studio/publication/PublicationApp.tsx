import { useEffect, useRef, useState } from "react";
import { readStoredSession, writeStoredSession } from "../../creatorStudio/session";
import { ensureStudioSession } from "../studioAuth";
import type { StudioSession } from "../types";
import PublicationSignIn from "./PublicationSignIn";
import { askPublication, forgetPublication, joinPublication, openPublication, readPublicationAnswer,
  type Publication, type PublicationAdmission, type PublicationRequest } from "./publicationApi";
import "./publication.css";

export default function PublicationApp({ publicId }: { publicId: string }) {
  const [publication, setPublication] = useState<Publication | null>(null);
  const [auth, setAuth] = useState<StudioSession | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [admission, setAdmission] = useState<PublicationAdmission | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [question, setQuestion] = useState("");
  const [request, setRequest] = useState<PublicationRequest | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [deletionUncertain, setDeletionUncertain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const generation = useRef(0), locked = useRef(false);
  const locale = new URLSearchParams(window.location.search).get("lang") === "hi" ? "hi" : "en";
  const receiptKey = (userId: string) => `vyakti.publication.question.${publicId}.${userId}`;
  const deletionKey = (userId: string) => `${receiptKey(userId)}.deletion`;
  const saveReceipt = (id: string | null) => { setRequestId(id); if (!auth) return; try { if (id) sessionStorage.setItem(receiptKey(auth.userId), id); else sessionStorage.removeItem(receiptKey(auth.userId)); } catch { /* Current page retains the receipt. */ } };
  useEffect(() => {
    const revision = ++generation.current, controller = new AbortController();
    let alive = true;
    locked.current = false; setBusy(false); setRestoring(true); setPublication(null); setAdmission(null); setAgreed(false); setQuestion(""); setRequest(null); setMessage("");
    const candidate = readStoredSession();
    const stillSameAccount = () => { const current = readStoredSession(); return current?.userId === candidate?.userId && current?.accessToken === candidate?.accessToken && current?.refreshToken === candidate?.refreshToken; };
    const restore = async () => {
      if (!candidate) { if (alive && stillSameAccount()) setAuth(null); return; }
      try { const fresh = await ensureStudioSession(candidate);
        if (alive && generation.current === revision && stillSameAccount()) {
          if (fresh.userId !== candidate.userId || !fresh.accessToken || !fresh.refreshToken) throw new Error("invalid restored account");
          writeStoredSession(fresh); setAuth(fresh);
        }
      } catch { if (alive && generation.current === revision && stillSameAccount()) setAuth(null); }
    };
    const opening = openPublication(publicId, controller.signal).then(opened => { if (alive) setPublication(opened); })
      .catch(error => { if (alive && error?.name !== "AbortError") setMessage("This link isn't available right now."); });
    Promise.allSettled([opening, restore()]).finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; generation.current++; controller.abort(); };
  }, [publicId, reload]);
  useEffect(() => {
    setRequest(null); setRequestId(null); setAdmission(null); setAgreed(false); setQuestion(""); setDeletionUncertain(false);
    if (!auth) return;
    try { const id = sessionStorage.getItem(receiptKey(auth.userId)); if (id && /^[a-f0-9-]{36}$/.test(id)) setRequestId(id); setDeletionUncertain(sessionStorage.getItem(deletionKey(auth.userId)) === "pending"); } catch { /* No stored receipt. */ }
  }, [auth?.userId, publicId]);
  useEffect(() => {
    const sync = () => { const session = readStoredSession(); if (session?.userId !== auth?.userId || session?.accessToken !== auth?.accessToken) {
      generation.current++; locked.current = false; setBusy(false); setAuth(session); setAdmission(null); setRequest(null); setQuestion(""); setAgreed(false);
    } };
    window.addEventListener("storage", sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); };
  }, [auth, restoring]);

  async function run(action: "join" | "ask" | "result" | "forget") {
    if (locked.current || !auth || action !== "forget" && !publication) return;
    if (deletionUncertain && action !== "forget") return;
    if (action === "join" && !agreed) return;
    if ((action === "ask" || action === "result") && !admission) return;
    if (action === "ask" && (!question.trim() || question.length > 2000 || requestId && (!request || request.state === "pending" || request.state === "uncertain"))) return;
    const revision = generation.current; locked.current = true; setBusy(true); setMessage("");
    let authenticated = false;
    try {
      const candidate = readStoredSession();
      if (!candidate || candidate.userId !== auth.userId || candidate.accessToken !== auth.accessToken) {
        generation.current++; setAuth(candidate); locked.current = false; setBusy(false); return;
      }
      const fresh = await ensureStudioSession(candidate);
      const current = readStoredSession();
      if (generation.current !== revision) return;
      if (current?.userId !== candidate.userId || current?.accessToken !== candidate.accessToken || current?.refreshToken !== candidate.refreshToken) {
        generation.current++; setAuth(current); locked.current = false; setBusy(false); return;
      }
      if (fresh.userId !== candidate.userId || !fresh.accessToken || !fresh.refreshToken) throw new Error("invalid refreshed account");
      writeStoredSession(fresh); setAuth(fresh); authenticated = true;
      if (action === "join") {
        const joined = await joinPublication(fresh.accessToken, publicId, publication!.disclosure_hash);
        if (generation.current !== revision) return;
        if (!joined.session_token || !joined.publication) throw new Error("invalid admission");
        setAdmission(joined); setPublication(joined.publication);
      } else if (action === "forget") {
        setDeletionUncertain(true); setRequest(null); setAdmission(null); setAgreed(false); setQuestion("");
        try { sessionStorage.setItem(deletionKey(auth.userId), "pending"); } catch { /* In-memory deletion remains pending. */ }
        const result = await forgetPublication(fresh.accessToken, publicId);
        if (generation.current !== revision) return;
        if (!result.forgotten || !result.private_payload_erased) throw new Error("forget not confirmed");
        saveReceipt(null); setDeletionUncertain(false);
        try { sessionStorage.removeItem(deletionKey(auth.userId)); } catch { /* A later page can safely confirm deletion again. */ }
        setMessage("Your questions and answers have been deleted.");
      } else {
        const id = action === "ask" ? crypto.randomUUID() : requestId;
        if (!id) return;
        if (action === "ask") { saveReceipt(id); setRequest(null); }
        const result = action === "ask" ? await askPublication(fresh.accessToken, publicId, admission!.session_token, id, question.trim())
          : await readPublicationAnswer(fresh.accessToken, publicId, admission!.session_token, id);
        if (generation.current !== revision) return;
        if (!result.request || result.request.request_id !== id) throw new Error("invalid answer receipt");
        setRequest(result.request);
        if (action === "ask") setQuestion("");
      }
    } catch {
      if (generation.current === revision) setMessage(!authenticated ? "We couldn't refresh your sign-in. Reload to continue." : action === "forget" ? "Deletion isn't confirmed. Please try again." : action === "join" ? "We couldn't start this conversation. Reload the link and try again." : "We couldn't confirm the answer. Check its status before asking again.");
    } finally { if (generation.current === revision) { locked.current = false; setBusy(false); } }
  }
  const unresolved = !!requestId && (!request || request.state === "pending" || request.state === "uncertain");
  return <main className="vp-page"><header className="vp-top"><a href="/">Vyakti</a>{auth && !restoring ? <button className="vp-text-button" onClick={() => {
    generation.current++; locked.current = false; setBusy(false); writeStoredSession(null); setAuth(null); setAdmission(null); setRequest(null); setQuestion(""); setAgreed(false);
  }}>Sign out</button> : <span>AI conversation</span>}</header>
    <div className="vp-conversation">
      {restoring ? <p role="status">Opening conversation</p> : !publication ? <section><h1>This link is unavailable</h1><p>{message}</p><button onClick={() => setReload(value => value + 1)}>Try again</button></section> : <>
        <header><p className="vp-eyebrow">Published knowledge</p><h1>{publication.title}</h1><p className="vp-muted">{publication.disclosure}</p></header>
        {message && <div className="vp-message"><p role="status">{message}</p><button disabled={busy} onClick={() => setReload(value => value + 1)}>Reload conversation</button></div>}
        {!publication.can_text || publication.state !== "active" ? <p>This conversation is no longer available.</p> : !auth ? <PublicationSignIn locale={locale} onAuthed={session => {
          if (!session.userId || !session.accessToken || !session.refreshToken) return;
          generation.current++; writeStoredSession(session); setAuth(session);
        }} /> : deletionUncertain ? <p role="status">Deletion needs confirmation. Your previous answers are hidden.</p> : !admission ? <section className="vp-admission"><h2>Before your first question</h2>
          <p>For adults aged 18 and over. Your questions and answers are kept for up to {publication.terms.retention_days} days. You can delete them here.</p>
          <p>You have up to {publication.terms.visitor_question_limit} questions. Submitted questions count even when an answer cannot be delivered.</p>
          <label><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />I am 18 or older. I understand this is AI and agree to the retention above.</label>
          <button className="vp-primary" disabled={busy || !agreed} onClick={() => void run("join")}>{busy ? "Opening" : "Start conversation"}</button>
        </section> : <>
          <section className="vp-answer" aria-live="polite" aria-busy={busy}>
            {request?.state === "complete" && request.answer ? <div className="vp-answer-text">{request.answer}</div>
              : request?.state === "withdrawn" ? <p>This answer is no longer available.</p>
              : request?.state === "blocked" ? <p>An answer couldn't be delivered for this question.</p>
              : unresolved ? <p>{busy ? "Working on your question" : "Your question is awaiting confirmation."}</p>
              : <p>What would you like to understand?</p>}
          </section>
          {unresolved ? <button disabled={busy} onClick={() => void run("result")}>Check answer status</button> : <form className="vp-composer" onSubmit={event => { event.preventDefault(); void run("ask"); }}>
            <label htmlFor="publication-question">Your question</label><textarea id="publication-question" rows={3} maxLength={2000} value={question} disabled={busy} onChange={event => setQuestion(event.target.value)} />
            <button className="vp-primary" disabled={busy || !question.trim()}>{busy ? "Sending" : "Ask"}</button>
          </form>}
        </>}
      </>}
      {!restoring && !auth && (!publication || !publication.can_text || publication.state !== "active") && <PublicationSignIn locale={locale} onAuthed={session => { generation.current++; writeStoredSession(session); setAuth(session); }} />}
      {!restoring && auth && <details className="vp-data" open={deletionUncertain || undefined}><summary>Your conversation</summary>
        <p>Deleting removes your questions and answers. It does not reset your question allowance.</p>
        <button disabled={busy} onClick={() => void run("forget")}>{deletionUncertain ? "Confirm deletion" : "Delete my conversation"}</button>
      </details>}
    </div>
  </main>;
}
