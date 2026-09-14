import { useEffect, useRef, useState } from "react";
import PrivateTeachingRefinement from "./PrivateTeachingRefinement";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaLifecycle } from "./types";
import { askPrivateText, isPrivateTextId, PRIVATE_TEXT_ATTESTATIONS, readPrivateRehearsalDraft, readPrivateTextReadiness, readPrivateTextResult, savePrivateRehearsalDraft, withdrawPrivateText,
  type PrivateDraftBody, type PrivateTextAttestation, type PrivateTextBillingState, type PrivateTextReadiness, type PrivateTextResult } from "./privateTextRehearsalApi";
import "./private-text-rehearsal.css";

// An explicit action may replace its focused control. Recover only that lost
// focus; later input/focus movement permanently cancels this one-shot intent.
function useActionFocus() {
  type Intent = { origin: HTMLElement; target?: () => HTMLElement | null; frame: number | null; dispose: () => void };
  const pending = useRef<Intent | null>(null);
  const cancel = () => { pending.current?.dispose(); pending.current = null; };
  useEffect(() => cancel, []);
  return (container: HTMLElement) => {
    cancel();
    const origin = document.activeElement;
    if (!(origin instanceof HTMLElement) || !container.contains(origin)) return { finish: (_target: () => HTMLElement | null) => {}, cancel: () => {} };
    const moved = () => cancel();
    const focused = (event: FocusEvent) => { if (event.target !== origin && event.target !== document.body) cancel(); };
    const intent: Intent = { origin, frame: null, dispose: () => {
      if (intent.frame !== null) cancelAnimationFrame(intent.frame);
      document.removeEventListener("pointerdown", moved, true);
      document.removeEventListener("keydown", moved, true);
      document.removeEventListener("input", moved, true);
      document.removeEventListener("focusin", focused, true);
    } };
    pending.current = intent;
    document.addEventListener("pointerdown", moved, true);
    document.addEventListener("keydown", moved, true);
    document.addEventListener("input", moved, true);
    document.addEventListener("focusin", focused, true);
    return { finish: (target: () => HTMLElement | null) => {
      if (pending.current !== intent) return;
      intent.target = target;
      intent.frame = requestAnimationFrame(() => {
        if (pending.current !== intent) return;
        cancel();
        if (document.activeElement === document.body && (!intent.origin.isConnected || intent.origin.matches(":disabled"))) {
          const next = intent.target?.();
          if (next?.isConnected) next.focus();
        }
      });
    }, cancel: () => { if (pending.current === intent) cancel(); } };
  };
}

export type PrivateTextReturnDraft = { question: string; sheetId: string; contextItemId: string };

type Props = { initialDraft?: PrivateTextReturnDraft; token: string; replicaId: string; lifecycle: ReplicaLifecycle; onBack: () => void; onEditContext: (draft: PrivateTextReturnDraft) => void; onAuthError: (cause: unknown) => void };
const REQUEST_PARAM = "rehearsal_request";
function savedRequest(replicaId: string) {
  const query = new URLSearchParams(location.search);
  const id = query.get(REQUEST_PARAM);
  return query.get("replica") === replicaId && isPrivateTextId(id) ? id : null;
}
function persistRequest(replicaId: string, requestId: string | null) {
  const query = new URLSearchParams(location.search);
  query.set("replica", replicaId); query.set("view", "rehearsal");
  if (requestId) query.set(REQUEST_PARAM, requestId); else query.delete(REQUEST_PARAM);
  try { history.replaceState(history.state, "", `${location.pathname}?${query}${location.hash}`); }
  catch { throw new Error("This browser could not save the request handle. No question was sent."); }
  if (savedRequest(replicaId) !== requestId) throw new Error("This browser could not save the request handle. No question was sent.");
}
const stopped = (lifecycle: ReplicaLifecycle) => ["paused", "revoked", "purging"].includes(lifecycle);
const unresolvedUsage = (billing?: PrivateTextBillingState | null) => Boolean(billing && ["unknown", "reserved", "in_flight", "reconcile_required"].includes(billing));
const requestNotFound = (cause: unknown) => cause instanceof ReplicaApiError && cause.status === 404 && cause.data?.error === "rehearsal_not_found";
export default function PrivateTextRehearsal(props: Props) {
  if (stopped(props.lifecycle)) return <StoppedPrivateText key={`${props.replicaId}:${props.token}:${props.lifecycle}`} {...props} />;
  // Scope changes replace the whole content tree synchronously, before old async effects clean up.
  return <PrivateTextSession key={`${props.replicaId}:${props.token}:${props.lifecycle}`} {...props} />;
}
function StoppedPrivateText({ token, replicaId, lifecycle, onBack, onAuthError }: Props) {
  const id = savedRequest(replicaId);
  const [busy, setBusy] = useState(false);
  const [removed, setRemoved] = useState(false);
  const [billing, setBilling] = useState<PrivateTextBillingState | null>(null);
  const [error, setError] = useState("");
  const live = useRef(false);
  const locked = useRef(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => { live.current = true; return () => { live.current = false; abort.current?.abort(); }; }, []);
  async function remove() {
    if (!id || locked.current || lifecycle === "purging") return;
    locked.current = true; setBusy(true); setError(""); abort.current = new AbortController();
    try { const withdrawn = await withdrawPrivateText(token, replicaId, id, abort.current.signal); if (live.current) { setRemoved(true); setBilling(withdrawn.billing_state); } }
    catch (cause) { if (live.current) { if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause); setError("Removal could not be confirmed. Retry removing this saved test."); } }
    finally { if (live.current) { locked.current = false; setBusy(false); } }
  }
  return <section className="ptr-panel"><div className="ptr-content"><button type="button" onClick={onBack}>Back to your workspace</button><h1>Private draft test is stopped.</h1><p>{lifecycle === "purging" ? "Erasure is already underway for this AI." : "This workspace must be available before a private answer can be requested or read."}</p>{error ? <p role="alert">{error}</p> : null}{removed && unresolvedUsage(billing) ? <p>Removing a test does not cancel incurred usage.</p> : null}{removed ? <p role="status">This saved test's private payload has been removed.</p> : id && lifecycle !== "purging" ? <button type="button" disabled={busy} onClick={() => void remove()}>{busy ? "Removing saved test" : "Remove saved test"}</button> : null}</div></section>;
}
function PrivateTextSession({ token, replicaId, initialDraft, onBack, onEditContext, onAuthError }: Props) {
  const [readiness, setReadiness] = useState<PrivateTextReadiness | null>(null);
  const [selection, setSelection] = useState(() => ({ sheetId: isPrivateTextId(initialDraft?.sheetId) ? initialDraft.sheetId : "", contextItemId: isPrivateTextId(initialDraft?.contextItemId) ? initialDraft.contextItemId : "" }));
  const [question, setQuestion] = useState(() => typeof initialDraft?.question === "string" && initialDraft.question.length <= 2000 ? initialDraft.question : "");
  const [attested, setAttested] = useState<PrivateTextAttestation[]>([]);
  const [requestId, setRequestId] = useState<string | null>(() => savedRequest(replicaId));
  const [parentRequestId, setParentRequestId] = useState<string | null>(null);
  const [result, setResult] = useState<PrivateTextResult | null>(null);
  const [refinementOpen, setRefinementOpen] = useState(false);
  const [erased, setErased] = useState(false);
  const [withdrawalBilling, setWithdrawalBilling] = useState<PrivateTextBillingState | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [busy, setBusy] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [editor, setEditor] = useState<PrivateDraftBody | null>(null);
  const [editorBase, setEditorBase] = useState<PrivateDraftBody | null>(null);
  const [editorFromPublished, setEditorFromPublished] = useState(false);
  const actionFocus = useActionFocus();
  const materialHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const operation = useRef(0);
  const readOperation = useRef(0);
  const lock = useRef(false);
  const mounted = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const onAuthErrorRef = useRef(onAuthError); onAuthErrorRef.current = onAuthError;
  const handleError = (cause: unknown, fallback: string) => {
    if (cause instanceof ReplicaApiError && cause.status === 401) onAuthErrorRef.current(cause);
    setError(fallback);
  };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; operation.current++; controller.current?.abort(); }; }, []);
  useEffect(() => {
    const abort = new AbortController(); const attempt = ++readOperation.current;
    setLoading(true); setReadiness(null); setAttested(value => parentRequestId ? value : []);
    void readPrivateTextReadiness(token, replicaId, selection, abort.signal).then(next => {
      if (!mounted.current || attempt !== readOperation.current) return;
      setReadiness(next); setLoading(false);
    }).catch(cause => {
      if (!mounted.current || attempt !== readOperation.current || abort.signal.aborted) return;
      setLoading(false); handleError(cause, "We could not check the saved draft and source. Refresh availability to try the read again.");
    });
    return () => abort.abort();
  }, [token, replicaId, selection.sheetId, selection.contextItemId, refresh, parentRequestId]);
  useEffect(() => {
    const id = savedRequest(replicaId);
    if (!id) return;
    const abort = new AbortController(); const attempt = operation.current;
    void readPrivateTextResult(token, replicaId, id, abort.signal).then(next => {
      if (mounted.current && operation.current === attempt && !abort.signal.aborted) { setResult(next); setNotFound(false); }
    }).catch(cause => {
      if (mounted.current && operation.current === attempt && !abort.signal.aborted) { setNotFound(requestNotFound(cause)); handleError(cause, requestNotFound(cause) ? "No saved result was found. Cancel this request before starting a new question." : "The saved request could not be read. Check its result before asking another question."); }
    });
    return () => abort.abort();
  }, [token, replicaId]);
  const selected = readiness?.selected;
  const ready = Boolean(readiness?.can_ask && selected && !editor && !loading && !requestId);
  const canAsk = ready && !busy && question.trim().length > 0 && question.length <= 2000 && PRIVATE_TEXT_ATTESTATIONS.every(id => attested.includes(id));
  function changeSelection(next: typeof selection) {
    operation.current++; readOperation.current++; setSelection(next); setReadiness(null); setResult(null); setParentRequestId(null); setAttested([]); setError(""); setEditor(null);
  }
  async function act(name: string, work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (lock.current) return;
    lock.current = true; setBusy(name); setError("");
    const attempt = ++operation.current; const abort = new AbortController(); controller.current = abort;
    const current = () => mounted.current && operation.current === attempt && !abort.signal.aborted;
    try { await work(abort.signal, current); }
    catch (cause) { if (current()) handleError(cause, cause instanceof Error ? cause.message : "This action could not be confirmed."); }
    finally { if (current()) { lock.current = false; setBusy(""); } }
  }
  async function ask(trigger: HTMLFormElement) {
    if (!canAsk || !selected || lock.current) return;
    const focus = actionFocus(trigger);
    let focusQueued = false;
    await act("ask", async (signal, current) => {
      const id = crypto.randomUUID();
      persistRequest(replicaId, id); setRequestId(id); setAttested([]);
      try {
        const next = await askPrivateText(token, { replica_id: replicaId, request_id: id, sheet_id: selected.sheet_id,
          context_item_id: selected.context_item_id, expected_snapshot_hash: selected.snapshot_hash, question,
          ...(parentRequestId ? { parent_request_id: parentRequestId } : {}) }, signal);
        if (current()) {
          if (next.state === "complete") { focus.finish(() => resultHeading.current); focusQueued = true; }
          setResult(next);
        }
      } catch (cause) {
        if (current()) handleError(cause, "We could not confirm the answer. This request may have started. Check its saved result; no question will be sent again automatically.");
      }
    });
    if (!focusQueued) focus.cancel();
  }
  async function checkResult() {
    if (!requestId) return;
    await act("read", async (signal, current) => {
      setErased(false); setResult(null);
      try {
        const next = await readPrivateTextResult(token, replicaId, requestId, signal);
        if (current()) { setResult(next); setNotFound(false); }
      } catch (cause) {
        if (current() && requestNotFound(cause)) { setNotFound(true); throw new Error("No saved result was found. Cancel this request before starting a new question."); }
        throw cause;
      }
    });
  }
  async function removeTest() {
    if (!requestId) return;
    await act("withdraw", async (signal, current) => {
      // Hide already displayed content while withdrawal is pending, including on an uncertain response.
      setResult(null);
      const withdrawn = await withdrawPrivateText(token, replicaId, requestId, signal);
      if (current()) { setErased(true); setNotFound(false); setWithdrawalBilling(withdrawn.billing_state); setQuestion(""); setRefresh(value => value + 1); }
    });
  }
  async function editDraft() {
    if (requestId) return;
    await act("edit", async (signal, current) => {
      const view = await readPrivateRehearsalDraft(token, replicaId, signal);
      if (!current()) return;
      if (selected && view.sheet_id !== selected.sheet_id) throw new Error("The current editable draft changed. Refresh availability and choose it before editing.");
      if (view.status && !["draft", "validated", "published"].includes(view.status)) throw new Error("This saved sheet is unavailable for a private draft. Refresh availability before editing.");
      setEditorFromPublished(view.status === "published");
      setEditorBase(view.draft || {}); setEditor(view.draft || {}); setAttested([]);
    });
  }
  async function saveDraft(trigger: HTMLFormElement) {
    if (!editor || !editorBase || lock.current) return;
    const focus = actionFocus(trigger);
    let focusQueued = false;
    await act("save", async (signal, current) => {
      const saved = await savePrivateRehearsalDraft(token, replicaId, { ...editorBase, ...editor }, signal);
      if (current()) { focus.finish(() => materialHeading.current); focusQueued = true; setEditor(null); setEditorBase(null); setSelection(value => ({ ...value, sheetId: saved.sheet_id! })); setReadiness(null); setRefresh(value => value + 1); }
    });
    if (!focusQueued) focus.cancel();
  }
  function newQuestion(parent: string | null = null) {
    if (busy) return;
    try { persistRequest(replicaId, null); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not clear the saved handle."); return; }
    operation.current++; readOperation.current++; setReadiness(null); setRefinementOpen(false); setRequestId(null); setParentRequestId(parent); setResult(null); setErased(false); setWithdrawalBilling(null); setNotFound(false); setQuestion(""); setAttested(parent ? [...PRIVATE_TEXT_ATTESTATIONS] : []); setError(""); setRefresh(value => value + 1);
  }
  const canStartAnother = erased || result?.state === "withdrawn" || result && ["complete", "blocked"].includes(result.state) && ["settled", "not_started"].includes(result.billing_state);
  return <section className="ptr-panel" aria-labelledby="ptr-title">
    <div className="ptr-content">
      <button className="vx-back" type="button" onClick={onBack}>Back to your workspace</button>
      <header className="ptr-heading"><h1 id="ptr-title">Test your private draft.</h1><p>Review your teaching draft and one extracted source. This produces a private AI text answer.</p></header>
      {error ? <p className="ptr-message" role="alert">{error}</p> : null}
      {requestId ? <section className="ptr-result" aria-label="Saved private test">
        <h2 ref={resultHeading} tabIndex={-1}>{erased || result?.state === "withdrawn" ? "Private test removed." : result?.state === "complete" ? "Your private text answer" : "Check your private request."}</h2>
        {!erased && result?.state === "complete" ? <><p className="ptr-answer">{result.answer}</p><p className="ptr-source">Source: {readiness?.context_items.find(item => item.item_id === result.source.context_item_id)?.source_name || "Selected private source"}. Teaching draft: {readiness?.drafts.find(item => item.sheet_id === result.source.sheet_id)?.name || "Selected private draft"}.</p></> : erased || result?.state === "withdrawn" ? <p>This request is closed. Any saved question and answer have been removed.</p> : <p>{result?.state === "blocked" ? "This answer is unavailable under the current draft or source permissions." : "An answer is not confirmed yet. Checking the saved result does not send another question."}</p>}
        {!erased && (result?.state === "complete" || result?.state === "blocked" && result.can_review_teaching === true) && result.billing_state === "settled" ? <PrivateTeachingRefinement recoveryOnly={result.state !== "complete"} token={token} replicaId={replicaId} requestId={result.request_id} sheetId={result.source.sheet_id} disabled={Boolean(busy)} onOpenChange={setRefinementOpen} onAuthError={onAuthErrorRef.current} onNextQuestion={newQuestion} onDraftChanged={view => {
          readOperation.current++; setReadiness(null); setAttested([]);
          setSelection({sheetId: view.sheet_id, contextItemId: result.source.context_item_id}); setRefresh(value => value + 1);
        }} /> : null}
        {unresolvedUsage(withdrawalBilling || result?.billing_state) ? <p role="status">Removing a test does not cancel incurred usage.</p> : null}
        {result?.failure_code ? <details><summary>Request details</summary><p>{result.failure_code.replaceAll("_", " ")}</p></details> : null}
        <div className="ptr-actions">{!erased && result?.state !== "withdrawn" ? <><button type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => void checkResult()}>{busy === "read" ? "Checking result" : "Check saved result"}</button><button type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => void removeTest()}>{busy === "withdraw" ? "Closing private request" : notFound ? "Cancel this request" : "Remove this private test"}</button></> : null}{canStartAnother && !refinementOpen ? <button type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => newQuestion(result?.state === "complete" ? result.request_id : null)}>{result?.state === "complete" ? "Ask a follow-up" : "Prepare another question"}</button> : null}</div>
      </section> : <>
        <section className="ptr-material" aria-label="Selected material">
          <div className="ptr-section-heading"><h2 ref={materialHeading} tabIndex={-1}>Choose what the answer uses.</h2><button type="button" disabled={Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }}>Refresh availability</button></div>
          {loading ? <p role="status">Checking saved draft and source</p> : null}
          <div className="ptr-fields"><label>Teaching draft<select value={selection.sheetId || selected?.sheet_id || ""} disabled={Boolean(busy)} onChange={event => changeSelection({ ...selection, sheetId: event.target.value })}><option value="">Choose a saved draft</option>{readiness?.drafts.map(draft => <option key={draft.sheet_id} value={draft.sheet_id}>{draft.name || "Unnamed draft"}</option>)}</select></label><label>Extracted source<select value={selection.contextItemId || selected?.context_item_id || ""} disabled={Boolean(busy)} onChange={event => changeSelection({ ...selection, contextItemId: event.target.value })}><option value="">Choose a saved text source</option>{readiness?.context_items.map(item => <option key={item.item_id} value={item.item_id} disabled={!item.eligible}>{item.source_name}{item.eligible ? "" : " (unavailable)"}</option>)}</select></label></div>
          {readiness?.blockers.length ? <ul className="ptr-blockers">{readiness.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}><strong>{blocker.responsibility === "platform" ? "Waiting on us: " : "Needs your input: "}</strong>{blocker.field ? `${blocker.field}: ` : ""}{blocker.code.replaceAll("_", " ")}</li>)}</ul> : null}
          <div className="ptr-actions"><button type="button" disabled={Boolean(busy)} onClick={() => void editDraft()}>{busy === "edit" ? "Reading draft" : readiness?.drafts.length ? "Edit draft details" : "Create a private draft"}</button><button type="button" disabled={Boolean(busy)} onClick={() => onEditContext({ question, sheetId: selection.sheetId || selected?.sheet_id || "", contextItemId: selection.contextItemId || selected?.context_item_id || "" })}>Add or edit source material</button></div>
          {editor ? <form className="ptr-editor" onSubmit={event => { event.preventDefault(); void saveDraft(event.currentTarget); }}><h3>{editorFromPublished ? "Create a private draft from this sheet" : "Private draft details"}</h3>{editorFromPublished ? <p>Saving creates a private draft for testing. It does not publish your changes.</p> : null}<label>Your name<input value={String(editor.name || "")} maxLength={200} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label><label>Who you are<textarea value={String(editor.identityWho || "")} maxLength={2000} rows={3} onChange={event => setEditor({ ...editor, identityWho: event.target.value })} /></label><label>Subject<select name="subjectDomain" aria-label="Subject" value={String(editor.subjectDomain || "")} onChange={event => setEditor({ ...editor, subjectDomain: event.target.value as PrivateDraftBody["subjectDomain"] })}><option value="">Choose a subject</option><option value="physics">Physics</option><option value="chemistry">Chemistry</option><option value="maths">Maths</option></select></label><p>You can save an incomplete draft. These three fields are required to ask a private question.</p><div className="ptr-actions"><button type="submit" disabled={Boolean(busy)}>{busy === "save" ? "Saving draft" : "Save private draft"}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>Cancel edit</button></div></form> : null}
          {selected && !editor ? <div className="ptr-review"><div><h3>{selected.material.draft.name}</h3><p>{selected.material.draft.identityWho}</p><p>Subject: {selected.material.draft.subjectDomain}</p></div><details open><summary>Review source: {selected.material.context.source_name}</summary><p className="ptr-source-body">{selected.material.context.body}</p></details></div> : null}
        </section>
        <form className="ptr-question" onSubmit={event => { event.preventDefault(); void ask(event.currentTarget); }}>
          {parentRequestId ? <p role="status">Your saved question and answer will be used only as context for this follow-up.</p> : null}
          <label htmlFor="ptr-question">Your question<textarea id="ptr-question" rows={4} value={question} maxLength={2000} disabled={Boolean(busy)} onChange={event => { setQuestion(event.target.value); setAttested(value => parentRequestId ? value : []); }} /></label><p className="ptr-count">{question.length} / 2000 characters</p>
          {!parentRequestId ? <fieldset disabled={!ready || Boolean(busy)}><legend>For this question and selected material</legend>{readiness?.statements.map(statement => <label className="ptr-attestation" key={statement.id}><input type="checkbox" checked={attested.includes(statement.id)} onChange={event => setAttested(value => event.target.checked ? [...value, statement.id] : value.filter(id => id !== statement.id))} /><span>{statement.text}</span></label>)}</fieldset> : null}
          <p className="ptr-retention">Permission lasts 30 days. Saved tests stay until you remove them.</p>
          <button className="vx-button vx-button--primary" type="submit" disabled={!canAsk}>{busy === "ask" ? "Asking privately" : "Ask privately"}</button>
        </form>
      </>}
    </div>
  </section>;
}
