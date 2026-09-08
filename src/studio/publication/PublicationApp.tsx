import { useEffect, useRef, useState } from "react";
import { readStoredSession, writeStoredSession } from "../../creatorStudio/session";
import { ensureStudioSession } from "../studioAuth";
import type { StudioSession } from "../types";
import PublicationSignIn from "./PublicationSignIn";
import ExpertAnswer from "../ExpertAnswer";
import { askPublication, forgetPublication, joinPublication, openPublication, readPublicationAnswer, publicationMemorySettings, setPublicationMemory,
  type Publication, type PublicationAdmission, type PublicationRequest, type PublicationMemory } from "./publicationApi";
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
  const [memory, setMemory] = useState<PublicationMemory | null>(null);
  const [remember, setRemember] = useState(false);
  const [memoryError, setMemoryError] = useState(false);
  const [rejoinRequired, setRejoinRequired] = useState(false);
  const memoryRevision = useRef(0);
  const generation = useRef(0), locked = useRef(false);
  const locale = new URLSearchParams(window.location.search).get("lang") === "hi" ? "hi" : "en";
  const receiptKey = (userId: string) => `vyakti.publication.question.${publicId}.${userId}`;
  const deletionKey = (userId: string) => `${receiptKey(userId)}.deletion`;
  const saveReceipt = (id: string | null) => { setRequestId(id); if (!auth) return; try { if (id) sessionStorage.setItem(receiptKey(auth.userId), id); else sessionStorage.removeItem(receiptKey(auth.userId)); } catch { /* Current page retains the receipt. */ } };
  useEffect(() => {
    const revision = ++generation.current, controller = new AbortController();
    let alive = true;
    locked.current = false; setBusy(false); setRestoring(true); setPublication(null); setAuth(null); setAdmission(null); setAgreed(false); setQuestion(""); setRequest(null); setMessage("");
    memoryRevision.current++; setMemory(null); setRemember(false); setMemoryError(false); setRejoinRequired(false);
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
    const revision = ++memoryRevision.current, controller = new AbortController();
    setMemory(null); setRemember(false); setMemoryError(false); setRejoinRequired(false);
    if (!auth || publication?.version !== 2 || publication.public_id !== publicId || restoring) return () => { controller.abort(); memoryRevision.current++; };
    const userId = auth.userId;
    publicationMemorySettings(auth.accessToken, publicId, controller.signal).then(settings => {
      if (memoryRevision.current !== revision || readStoredSession()?.userId !== userId || readStoredSession()?.accessToken !== auth.accessToken) return;
      if (!settings.available || settings.policy_hash !== publication.terms.memory_policy_hash) throw new Error("memory_policy_changed");
      setMemory(settings); setRemember(settings.enabled);
    }).catch(error => { if (memoryRevision.current === revision && error?.name !== "AbortError") setMemoryError(true); });
    return () => { controller.abort(); memoryRevision.current++; };
  }, [auth?.userId, auth?.accessToken, publicId, publication?.version, publication?.terms.memory_policy_hash, restoring, reload]);
  useEffect(() => {
    const sync = () => { const session = readStoredSession(); if (session?.userId !== auth?.userId || session?.accessToken !== auth?.accessToken) {
      generation.current++; locked.current = false; setBusy(false); setAuth(session); setAdmission(null); setRequest(null); setQuestion(""); setAgreed(false);
    } };
    window.addEventListener("storage", sync); window.addEventListener("focus", sync);
    return () => { window.removeEventListener("storage", sync); window.removeEventListener("focus", sync); };
  }, [auth, restoring]);

  async function run(action: "join" | "ask" | "result" | "forget" | "memory") {
    if (locked.current || !auth || action !== "forget" && (!publication || publication.public_id !== publicId)) return;
    if (deletionUncertain && action !== "forget") return;
    if (action === "join" && !agreed) return;
    if ((action === "join" || action === "memory") && publication?.version === 2 && (!memory?.available || memoryError)) return;
    if (action === "memory" && (!admission || !memory?.policy_hash || requestId && (!request || request.state === "pending" || request.state === "uncertain"))) return;
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
      const responseIsCurrent = () => generation.current === revision && readStoredSession()?.userId === fresh.userId && readStoredSession()?.accessToken === fresh.accessToken;
      if (action === "join") {
        const joined = await joinPublication(fresh.accessToken, publicId, publication!.disclosure_hash, publication!.version === 2 ? {
          remember, expected_memory_epoch: memory!.epoch, expected_memory_policy_hash: memory!.policy_hash!,
        } : undefined);
        if (!responseIsCurrent()) return;
        if (!joined.session_token || !joined.publication) throw new Error("invalid admission");
        setAdmission(joined); setPublication(joined.publication);
        if (joined.memory) { memoryRevision.current++; setMemory(joined.memory); setRemember(joined.memory.enabled); }
        setRejoinRequired(false);
      } else if (action === "memory") {
        const changed = await setPublicationMemory(fresh.accessToken, publicId, admission!.session_token, {
          remember, expected_memory_epoch: memory!.epoch, expected_memory_policy_hash: memory!.policy_hash!,
        });
        if (!responseIsCurrent()) return;
        memoryRevision.current++; setMemory(changed.memory); setRemember(changed.memory.enabled);
        // The confirmed epoch change deliberately withdraws the old answer's authority.
        // No request is replayed; unresolved requests cannot enter this operation.
        saveReceipt(null); setAdmission(null); setRequest(null); setRejoinRequired(true);
        setMessage("Your memory choice is saved. Rejoin to continue.");
      } else if (action === "forget") {
        setDeletionUncertain(true); setRequest(null); setAdmission(null); setAgreed(false); setQuestion("");
        try { sessionStorage.setItem(deletionKey(auth.userId), "pending"); } catch { /* In-memory deletion remains pending. */ }
        const result = await forgetPublication(fresh.accessToken, publicId);
        if (!responseIsCurrent()) return;
        if (!result.forgotten || !result.private_payload_erased) throw new Error("forget not confirmed");
        saveReceipt(null); setDeletionUncertain(false);
        memoryRevision.current++; setMemory(null); setRemember(false); setMemoryError(publication?.version === 2); setRejoinRequired(false);
        try { sessionStorage.removeItem(deletionKey(auth.userId)); } catch { /* A later page can safely confirm deletion again. */ }
        setMessage("Your questions and answers have been deleted.");
      } else {
        const id = action === "ask" ? crypto.randomUUID() : requestId;
        if (!id) return;
        if (action === "ask") { saveReceipt(id); setRequest(null); }
        const result = action === "ask" ? await askPublication(fresh.accessToken, publicId, admission!.session_token, id, question.trim())
          : await readPublicationAnswer(fresh.accessToken, publicId, admission!.session_token, id);
        if (!responseIsCurrent()) return;
        if (!result.request || result.request.request_id !== id) throw new Error("invalid answer receipt");
        setRequest(result.request);
        if (action === "ask") setQuestion("");
      }
    } catch {
      if (generation.current === revision && action === "memory") {
        memoryRevision.current++; setMemory(null); setMemoryError(true); setAdmission(null); setRequest(null); setRejoinRequired(true);
      }
      if (generation.current === revision) setMessage(!authenticated ? "We couldn't refresh your sign-in. Reload to continue." : action === "memory" ? "We couldn't confirm your memory choice. Reload to check it before continuing." : action === "forget" ? "Deletion isn't confirmed. Please try again." : action === "join" ? "We couldn't start this conversation. Reload the link and try again." : "We couldn't confirm the answer. Check its status before asking again.");
    } finally { if (generation.current === revision) { locked.current = false; setBusy(false); } }
  }
  const unresolved = !!requestId && (!request || request.state === "pending" || request.state === "uncertain");
  const memoryBudgetBlocked = request?.state === "blocked" && request.failure_code === "text_publication_memory_budget_exceeded";
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
        }} /> : deletionUncertain ? <p role="status">Deletion needs confirmation. Your previous answers are hidden.</p> : !admission ? <section className="vp-admission"><h2>{rejoinRequired ? "Continue your conversation" : "Before your first question"}</h2>
          <p>For adults aged 18 and over. Your questions and answers are kept for up to {publication.terms.retention_days} days. You can delete them here.</p>
          <p>You have up to {publication.terms.visitor_question_limit} questions. Submitted questions count even when an answer cannot be delivered.</p>
          <label><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />I am 18 or older. I understand this is AI and agree to the retention above.</label>
          {publication.version === 2 && <>
            {memory ? <><label><input type="checkbox" checked={remember} disabled={busy} aria-describedby="publication-memory-policy" onChange={event => setRemember(event.target.checked)} />Remember my recent conversations (optional)</label><p id="publication-memory-policy">{memory.policy}</p></>
              : <p role="status">{memoryError ? "Your memory settings couldn't be loaded. Reload to check your choice." : "Loading your memory choice"}</p>}
          </>}
          <button className="vp-primary" disabled={busy || !agreed || publication.version === 2 && (!memory || memoryError)} onClick={() => void run("join")}>{busy ? "Opening" : rejoinRequired ? "Rejoin conversation" : "Start conversation"}</button>
        </section> : <>
          <section className="vp-answer" aria-live="polite" aria-busy={busy}>
            {request?.state === "complete" && request.answer ? <div className="vp-answer-text"><ExpertAnswer text={request.answer} /></div>
              : request?.state === "withdrawn" ? <p>This answer is no longer available.</p>
              : memoryBudgetBlocked ? <p>{locale === "hi" ? "यह बातचीत याद रखने के लिए बहुत लंबी है। आगे बढ़ने के लिए बातचीत की याद बंद करें।" : "This exchange is too long to use as memory. Turn memory off to continue."}</p>
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
      {!restoring && auth && <details className="vp-data" open={deletionUncertain || memoryBudgetBlocked || undefined}><summary>Your conversation</summary>
        {publication?.version === 2 && admission && memory && !deletionUncertain && <>
          <label><input type="checkbox" checked={remember} disabled={busy || unresolved} aria-describedby="publication-saved-memory-policy" onChange={event => setRemember(event.target.checked)} />Remember my recent conversations</label>
          <p id="publication-saved-memory-policy">{memory.policy}</p>
          <button disabled={busy || unresolved || remember === memory.enabled} onClick={() => void run("memory")}>Save memory choice</button>
        </>}
        <p>Deleting removes your questions and answers. It does not reset your question allowance.</p>
        <button disabled={busy} onClick={() => void run("forget")}>{deletionUncertain ? "Confirm deletion" : "Delete my conversation"}</button>
      </details>}
    </div>
  </main>;
}
