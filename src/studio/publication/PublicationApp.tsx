import { useEffect, useRef, useState } from "react";
import { readStoredSession, writeStoredSession } from "../../creatorStudio/session";
import { consumeStudioOAuthCallback } from "../../creatorStudio/studioAuth";
import { ensureStudioSession } from "../studioAuth";
import { ReplicaApiError } from "../replicaApi";
import type { StudioSession } from "../types";
import PublicationSignIn from "./PublicationSignIn";
import ExpertAnswer from "../ExpertAnswer";
import { askPublication, forgetPublication, joinPublication, openPublication, readPublicationAnswer, publicationMemorySettings, setPublicationMemory,
  type Publication, type PublicationAdmission, type PublicationRequest, type PublicationMemory } from "./publicationApi";
import "./publication.css";

const publicationCopy = {
  en: {
    signOut: "Sign out", context: "AI conversation", opening: "Opening conversation", unavailableTitle: "This link is unavailable", tryAgain: "Try again",
    reload: "Reload conversation", inactive: "This conversation is no longer available.", continueTitle: "Continue your conversation", beforeTitle: "Before your first question",
    retention: (days: number) => `For adults aged 18 and over. Your questions and answers are kept for up to ${days} days. You can delete them here.`,
    allowance: (count: number) => `You have up to ${count} questions. Submitted questions count even when an answer cannot be delivered.`,
    passLabel: "Access pass (first visit)", passHelp: "If you have joined this conversation before, you can leave this blank.",
    agreement: "I am 18 or older. I understand this is AI and agree to the retention above.", rememberOptional: "Remember my recent conversations (optional)",
    memoryLoading: "Loading your memory choice", memoryLoadError: "Your memory settings couldn't be loaded. Reload to check your choice.",
    openingButton: "Opening", rejoin: "Rejoin conversation", start: "Start conversation", withdrawn: "This answer is no longer available.",
    memoryBudget: "This exchange is too long to use as memory. Turn memory off to continue.", blocked: "An answer couldn't be delivered for this question.",
    working: "Working on your question", awaiting: "Your question is awaiting confirmation.", prompt: "What would you like to understand?",
    checkStatus: "Check answer status", question: "Your question", sending: "Sending", ask: "Ask", conversation: "Your conversation",
    remember: "Remember my recent conversations", saveMemory: "Save memory choice",
    deletionNote: "Deleting removes your questions and answers. It does not reset your question allowance.", confirmDeletion: "Confirm deletion", deleteConversation: "Delete my conversation",
    deletionPending: "Deletion needs confirmation. Your previous answers are hidden.", memorySaved: "Your memory choice is saved. Rejoin to continue.",
    deleted: "Your questions and answers have been deleted.", openError: "This link isn't available right now.", refreshError: "We couldn't refresh your sign-in. Reload to continue.",
    memoryError: "We couldn't confirm your memory choice. Reload to check it before continuing.", deletionError: "Deletion isn't confirmed. Please try again.",
    joinError: "We couldn't start this conversation. Reload the link and try again.", answerError: "We couldn't confirm the answer. Check its status before asking again.",
  },
  hi: {
    signOut: "साइन आउट", context: "AI बातचीत", opening: "बातचीत खुल रही है", unavailableTitle: "यह लिंक उपलब्ध नहीं है", tryAgain: "फिर कोशिश करें",
    reload: "बातचीत फिर लोड करें", inactive: "यह बातचीत अब उपलब्ध नहीं है।", continueTitle: "बातचीत जारी रखें", beforeTitle: "पहला सवाल पूछने से पहले",
    retention: (days: number) => `यह बातचीत केवल 18 वर्ष या उससे अधिक उम्र के लोगों के लिए है। आपके सवाल और जवाब ${days} दिनों तक रखे जाते हैं। आप उन्हें यहीं मिटा सकते हैं।`,
    allowance: (count: number) => `आप ${count} सवाल तक पूछ सकते हैं। जवाब न मिल पाने पर भी भेजा गया सवाल गिना जाएगा।`,
    passLabel: "एक्सेस पास (पहली बार)", passHelp: "अगर आप पहले इस बातचीत में शामिल हो चुके हैं, तो इसे खाली छोड़ सकते हैं।",
    agreement: "मैं 18 वर्ष या उससे अधिक उम्र का हूं। मैं समझता हूं कि यह AI है और ऊपर लिखी अवधि से सहमत हूं।", rememberOptional: "मेरी हाल की बातचीत याद रखें (वैकल्पिक)",
    memoryLoading: "आपकी याद रखने की पसंद लोड हो रही है", memoryLoadError: "आपकी याद रखने की सेटिंग लोड नहीं हो सकी। अपनी पसंद जांचने के लिए पेज फिर लोड करें।",
    openingButton: "खुल रही है", rejoin: "फिर से जुड़ें", start: "बातचीत शुरू करें", withdrawn: "यह जवाब अब उपलब्ध नहीं है।",
    memoryBudget: "यह बातचीत याद रखने के लिए बहुत लंबी है। आगे बढ़ने के लिए बातचीत की याद बंद करें।", blocked: "इस सवाल का जवाब नहीं दिया जा सका।",
    working: "आपके सवाल पर काम हो रहा है", awaiting: "आपका सवाल पुष्टि का इंतजार कर रहा है।", prompt: "आप क्या समझना चाहते हैं?",
    checkStatus: "जवाब की स्थिति जांचें", question: "आपका सवाल", sending: "भेजा जा रहा है", ask: "पूछें", conversation: "आपकी बातचीत",
    remember: "मेरी हाल की बातचीत याद रखें", saveMemory: "याद रखने की पसंद सेव करें",
    deletionNote: "मिटाने पर आपके सवाल और जवाब हट जाएंगे। आपके सवालों की सीमा रीसेट नहीं होगी।", confirmDeletion: "मिटाना पक्का करें", deleteConversation: "मेरी बातचीत मिटाएं",
    deletionPending: "मिटाने की पुष्टि चाहिए। आपके पुराने जवाब छिपा दिए गए हैं।", memorySaved: "याद रखने की पसंद सेव हो गई। जारी रखने के लिए फिर से जुड़ें।",
    deleted: "आपके सवाल और जवाब मिटा दिए गए हैं।", openError: "यह लिंक अभी उपलब्ध नहीं है।", refreshError: "साइन इन रीफ्रेश नहीं हो सका। जारी रखने के लिए पेज फिर लोड करें।",
    memoryError: "याद रखने की पसंद पक्की नहीं हो सकी। आगे बढ़ने से पहले पेज फिर लोड करके जांचें।", deletionError: "मिटाना पक्का नहीं हुआ। फिर कोशिश करें।",
    joinError: "बातचीत शुरू नहीं हो सकी। लिंक फिर लोड करके कोशिश करें।", answerError: "जवाब की पुष्टि नहीं हो सकी। दोबारा पूछने से पहले उसकी स्थिति जांचें।",
  },
} as const;

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
  const [accessPass, setAccessPass] = useState("");
  const [accessError, setAccessError] = useState("");
  const memoryRevision = useRef(0);
  const generation = useRef(0), locked = useRef(false);
  const locale = new URLSearchParams(window.location.search).get("lang") === "hi" ? "hi" : "en";
  const copy = publicationCopy[locale];
  const receiptKey = (userId: string) => `vyakti.publication.question.${publicId}.${userId}`;
  const deletionKey = (userId: string) => `${receiptKey(userId)}.deletion`;
  const saveReceipt = (id: string | null) => { setRequestId(id); if (!auth) return; try { if (id) sessionStorage.setItem(receiptKey(auth.userId), id); else sessionStorage.removeItem(receiptKey(auth.userId)); } catch { /* Current page retains the receipt. */ } };
  useEffect(() => {
    const revision = ++generation.current, controller = new AbortController();
    let alive = true;
    locked.current = false; setBusy(false); setRestoring(true); setPublication(null); setAuth(null); setAdmission(null); setAgreed(false); setQuestion(""); setRequest(null); setMessage("");
    setAccessPass(""); setAccessError("");
    memoryRevision.current++; setMemory(null); setRemember(false); setMemoryError(false); setRejoinRequired(false);
    const storedCandidate = readStoredSession();
    const callback = consumeStudioOAuthCallback();
    const candidate = callback ?? storedCandidate;
    // The callback has no user id until refresh. Keep the original stored
    // account as the race baseline instead of writing that pending callback.
    const stillSameAccount = () => { const current = readStoredSession(); return current?.userId === storedCandidate?.userId && current?.accessToken === storedCandidate?.accessToken && current?.refreshToken === storedCandidate?.refreshToken; };
    const restore = async () => {
      if (!candidate) { if (alive && stillSameAccount()) setAuth(null); return; }
      try { const fresh = await ensureStudioSession(candidate);
        if (alive && generation.current === revision && stillSameAccount()) {
          if (!fresh.userId || !fresh.accessToken || !fresh.refreshToken || (!callback && fresh.userId !== candidate.userId)) throw new Error("invalid restored account");
          writeStoredSession(fresh); setAuth(fresh);
        }
      } catch { if (alive && generation.current === revision && stillSameAccount()) setAuth(null); }
    };
    const opening = openPublication(publicId, controller.signal).then(opened => { if (alive) setPublication(opened); })
      .catch(error => { if (alive && error?.name !== "AbortError") setMessage(copy.openError); });
    Promise.allSettled([opening, restore()]).finally(() => { if (alive) setRestoring(false); });
    return () => { alive = false; generation.current++; controller.abort(); };
  }, [publicId, reload]);
  useEffect(() => {
    setRequest(null); setRequestId(null); setAdmission(null); setAgreed(false); setQuestion(""); setDeletionUncertain(false); setAccessPass(""); setAccessError("");
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
      generation.current++; locked.current = false; setBusy(false); setAuth(session); setAdmission(null); setRequest(null); setQuestion(""); setAgreed(false); setAccessPass(""); setAccessError("");
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
    const revision = generation.current; locked.current = true; setBusy(true); setMessage(""); setAccessError("");
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
        } : undefined, publication!.terms.access_mode === "pass" ? accessPass.trim() || undefined : undefined);
        if (!responseIsCurrent()) return;
        if (!joined.session_token || !joined.publication) throw new Error("invalid admission");
        setAdmission(joined); setPublication(joined.publication); setAccessPass(""); setAccessError("");
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
        setMessage(copy.memorySaved);
      } else if (action === "forget") {
        setDeletionUncertain(true); setRequest(null); setAdmission(null); setAgreed(false); setQuestion("");
        try { sessionStorage.setItem(deletionKey(auth.userId), "pending"); } catch { /* In-memory deletion remains pending. */ }
        const result = await forgetPublication(fresh.accessToken, publicId);
        if (!responseIsCurrent()) return;
        if (!result.forgotten || !result.private_payload_erased) throw new Error("forget not confirmed");
        saveReceipt(null); setDeletionUncertain(false);
        memoryRevision.current++; setMemory(null); setRemember(false); setMemoryError(publication?.version === 2); setRejoinRequired(false);
        try { sessionStorage.removeItem(deletionKey(auth.userId)); } catch { /* A later page can safely confirm deletion again. */ }
        setMessage(copy.deleted);
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
    } catch (error) {
      const code = error instanceof ReplicaApiError && typeof error.data?.error === "string" ? error.data.error : "";
      if (generation.current === revision && (code === "text_publication_access_required" || code === "text_publication_access_revoked")) {
        if (code === "text_publication_access_revoked") {
          saveReceipt(null); setAdmission(null); setRequest(null); setRejoinRequired(true); setAccessPass("");
        }
        setAccessError(code === "text_publication_access_revoked"
          ? locale === "hi" ? "आपका एक्सेस पास रद्द हो चुका है। बातचीत जारी रखने के लिए मालिक से नया पास मांगें।" : "Your access pass was revoked. Ask the owner for a new pass to continue."
          : accessPass.trim()
            ? locale === "hi" ? "यह एक्सेस पास इस्तेमाल नहीं हो सकता। कोड जांचें या मालिक से नया पास मांगें।" : "This access pass cannot be used. Check the code or ask the owner for a new pass."
            : locale === "hi" ? "पहली बार बातचीत शुरू करने के लिए अपना एक्सेस पास डालें।" : "Enter your access pass to start this conversation for the first time.");
      }
      if (generation.current === revision && action === "memory") {
        memoryRevision.current++; setMemory(null); setMemoryError(true); setAdmission(null); setRequest(null); setRejoinRequired(true);
      }
      if (generation.current === revision && code !== "text_publication_access_required" && code !== "text_publication_access_revoked") setMessage(!authenticated ? copy.refreshError : action === "memory" ? copy.memoryError : action === "forget" ? copy.deletionError : action === "join" ? copy.joinError : copy.answerError);
    } finally { if (generation.current === revision) { locked.current = false; setBusy(false); } }
  }
  const unresolved = !!requestId && (!request || request.state === "pending" || request.state === "uncertain");
  const memoryBudgetBlocked = request?.state === "blocked" && request.failure_code === "text_publication_memory_budget_exceeded";
  return <main className="vp-page" lang={locale}><header className="vp-top"><a href="/">Vyakti</a>{auth && !restoring ? <button className="vp-text-button" onClick={() => {
    generation.current++; locked.current = false; setBusy(false); writeStoredSession(null); setAuth(null); setAdmission(null); setRequest(null); setQuestion(""); setAgreed(false); setAccessPass(""); setAccessError("");
  }}>{copy.signOut}</button> : <span>{copy.context}</span>}</header>
    <div className="vp-conversation">
      {restoring ? <p role="status">{copy.opening}</p> : !publication ? <section><h1>{copy.unavailableTitle}</h1><p>{message}</p><button onClick={() => setReload(value => value + 1)}>{copy.tryAgain}</button></section> : <>
        <header><h1>{publication.title}</h1><p className="vp-muted">{publication.disclosure}</p></header>
        {message && <div className="vp-message"><p role="status">{message}</p><button disabled={busy} onClick={() => setReload(value => value + 1)}>{copy.reload}</button></div>}
        {!publication.can_text || publication.state !== "active" ? <p>{copy.inactive}</p> : !auth ? <PublicationSignIn locale={locale} onAuthed={session => {
          if (!session.userId || !session.accessToken || !session.refreshToken) return;
          generation.current++; writeStoredSession(session); setAuth(session);
        }} /> : deletionUncertain ? <p role="status">{copy.deletionPending}</p> : !admission ? <section className="vp-admission"><h2>{rejoinRequired ? copy.continueTitle : copy.beforeTitle}</h2>
          <p>{copy.retention(publication.terms.retention_days)}</p>
          <p>{copy.allowance(publication.terms.visitor_question_limit)}</p>
          {publication.terms.access_mode === "pass" && <div className="vp-access-entry">
            <label htmlFor="publication-access-pass">{copy.passLabel}</label>
            <input id="publication-access-pass" type="text" autoComplete="off" spellCheck={false} value={accessPass} disabled={busy}
              aria-describedby="publication-access-pass-help" aria-invalid={!!accessError} onChange={event => { setAccessPass(event.target.value); setAccessError(""); }} />
            <p id="publication-access-pass-help">{copy.passHelp}</p>
            {accessError && <p className="vp-error" role="alert">{accessError}</p>}
          </div>}
          <label><input type="checkbox" checked={agreed} disabled={busy} onChange={event => setAgreed(event.target.checked)} />{copy.agreement}</label>
          {publication.version === 2 && <>
            {memory ? <><label><input type="checkbox" checked={remember} disabled={busy} aria-describedby="publication-memory-policy" onChange={event => setRemember(event.target.checked)} />{copy.rememberOptional}</label><p id="publication-memory-policy">{memory.policy}</p></>
              : <p role="status">{memoryError ? copy.memoryLoadError : copy.memoryLoading}</p>}
          </>}
          <button className="vp-primary" disabled={busy || !agreed || publication.version === 2 && (!memory || memoryError)} onClick={() => void run("join")}>{busy ? copy.openingButton : rejoinRequired ? copy.rejoin : copy.start}</button>
        </section> : <>
          <section className="vp-answer" aria-live="polite" aria-busy={busy}>
            {request?.state === "complete" && request.answer ? <div className="vp-answer-text"><ExpertAnswer text={request.answer} /></div>
              : request?.state === "withdrawn" ? <p>{copy.withdrawn}</p>
              : memoryBudgetBlocked ? <p>{copy.memoryBudget}</p>
              : request?.state === "blocked" ? <p>{copy.blocked}</p>
              : unresolved ? <p>{busy ? copy.working : copy.awaiting}</p>
              : <p>{copy.prompt}</p>}
          </section>
          {unresolved ? <button className="vp-primary" disabled={busy} onClick={() => void run("result")}>{copy.checkStatus}</button> : <form className="vp-composer" onSubmit={event => { event.preventDefault(); void run("ask"); }}>
            <label htmlFor="publication-question">{copy.question}</label><textarea id="publication-question" rows={3} maxLength={2000} value={question} disabled={busy} onChange={event => setQuestion(event.target.value)} />
            <button className="vp-primary" disabled={busy || !question.trim()}>{busy ? copy.sending : copy.ask}</button>
          </form>}
        </>}
      </>}
      {!restoring && !auth && (!publication || !publication.can_text || publication.state !== "active") && <PublicationSignIn locale={locale} onAuthed={session => { generation.current++; writeStoredSession(session); setAuth(session); }} />}
      {!restoring && auth && <details className="vp-data" open={deletionUncertain || memoryBudgetBlocked || undefined}><summary>{copy.conversation}</summary>
        {publication?.version === 2 && admission && memory && !deletionUncertain && <>
          <label><input type="checkbox" checked={remember} disabled={busy || unresolved} aria-describedby="publication-saved-memory-policy" onChange={event => setRemember(event.target.checked)} />{copy.remember}</label>
          <p id="publication-saved-memory-policy">{memory.policy}</p>
          <button className="vp-primary" disabled={busy || unresolved || remember === memory.enabled} onClick={() => void run("memory")}>{copy.saveMemory}</button>
        </>}
        <p>{copy.deletionNote}</p>
        <button disabled={busy} onClick={() => void run("forget")}>{deletionUncertain ? copy.confirmDeletion : copy.deleteConversation}</button>
      </details>}
    </div>
  </main>;
}
