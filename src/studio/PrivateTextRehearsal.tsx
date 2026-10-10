import { useEffect, useRef, useState } from "react";
import PrivateTeachingRefinement from "./PrivateTeachingRefinement";
import ExpertAnswer from "./ExpertAnswer";
import { ReplicaApiError } from "./replicaApi";
import type { ReplicaLifecycle } from "./types";
import { useStudioLocale } from "./localeContext";
import { privateTextBlockerMessage, privateTextFailureMessage, privateTextRehearsalCopy } from "./privateTextRehearsalCopy";
import { askPrivateText, isPrivateTextId, PRIVATE_TEXT_ATTESTATIONS, readLatestPrivateTextRequest, readPrivateRehearsalDraft, readPrivateTextReadiness, readPrivateTextResult, savePrivateRehearsalDraft, withdrawPrivateText,
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

type Props = { onEditProfile?: (draft: PrivateTextReturnDraft) => void; initialDraft?: PrivateTextReturnDraft; token: string; replicaId: string; lifecycle: ReplicaLifecycle; onBack: () => void; onEditContext: (draft: PrivateTextReturnDraft) => void; onAuthError: (cause: unknown) => void };
const REQUEST_PARAM = "rehearsal_request";
function savedRequest(replicaId: string) {
  const query = new URLSearchParams(location.search);
  const id = query.get(REQUEST_PARAM);
  return query.get("replica") === replicaId && isPrivateTextId(id) ? id : null;
}
function persistRequest(replicaId: string, requestId: string | null, failureMessage = "This browser could not save the request handle. No question was sent.") {
  const query = new URLSearchParams(location.search);
  query.set("replica", replicaId); query.set("view", "rehearsal");
  if (requestId) query.set(REQUEST_PARAM, requestId); else query.delete(REQUEST_PARAM);
  try { history.replaceState(history.state, "", `${location.pathname}?${query}${location.hash}`); }
  catch { throw new Error(failureMessage); }
  if (savedRequest(replicaId) !== requestId) throw new Error(failureMessage);
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
  const { locale } = useStudioLocale();
  const copy = privateTextRehearsalCopy(locale);
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
    catch (cause) { if (live.current) { if (cause instanceof ReplicaApiError && cause.status === 401) onAuthError(cause); setError(copy.stopped.removalFailed); } }
    finally { if (live.current) { locked.current = false; setBusy(false); } }
  }
  return <section className="ptr-panel"><div className="ptr-content"><button className="vx-back" type="button" onClick={onBack}>{copy.back}</button><h1>{copy.stopped.title}</h1><p>{lifecycle === "purging" ? copy.stopped.purging : copy.stopped.unavailable}</p>{error ? <p role="alert">{error}</p> : null}{removed && unresolvedUsage(billing) ? <p>{copy.stopped.usage}</p> : null}{removed ? <p role="status">{copy.stopped.removed}</p> : id && lifecycle !== "purging" ? <button type="button" disabled={busy} onClick={() => void remove()}>{busy ? copy.stopped.removing : copy.stopped.remove}</button> : null}</div></section>;
}
function PrivateTextSession({ token, replicaId, initialDraft, onBack, onEditContext, onEditProfile, onAuthError }: Props) {
  const { locale } = useStudioLocale();
  const copy = privateTextRehearsalCopy(locale);
  const [readiness, setReadiness] = useState<PrivateTextReadiness | null>(null);
  const [readinessError, setReadinessError] = useState(false);
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
  const [recoveryState, setRecoveryState] = useState<"checking" | "ready" | "error">(() => { const query = new URLSearchParams(location.search); return savedRequest(replicaId) ? "ready" : query.get("replica") === replicaId && query.has(REQUEST_PARAM) ? "error" : "checking"; });
  const [recoveryRefresh, setRecoveryRefresh] = useState(0);
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
    setLoading(true); setReadiness(null); setReadinessError(false); setAttested(value => parentRequestId ? value : []);
    void readPrivateTextReadiness(token, replicaId, selection, abort.signal).then(next => {
      if (!mounted.current || attempt !== readOperation.current) return;
      setReadiness(next); setLoading(false);
    }).catch(cause => {
      if (!mounted.current || attempt !== readOperation.current || abort.signal.aborted) return;
      setLoading(false); setReadinessError(true); handleError(cause, copy.errors.availability);
    });
    return () => abort.abort();
  }, [token, replicaId, selection.sheetId, selection.contextItemId, refresh, parentRequestId]);
  useEffect(() => {
    let id = savedRequest(replicaId);
    const query = new URLSearchParams(location.search);
    const urlHasHandle = query.get("replica") === replicaId && query.has(REQUEST_PARAM);
    if (!id && urlHasHandle) { setRecoveryState("error"); return; }
    const abort = new AbortController(); const attempt = operation.current;
    let stage: "discover" | "result" = id ? "result" : "discover";
    setRecoveryState(id ? "ready" : "checking");
    void (async () => {
      try {
        if (!id) {
          const latest = await readLatestPrivateTextRequest(token, replicaId, abort.signal);
          if (!mounted.current || operation.current !== attempt || abort.signal.aborted) return;
          if (!latest) { setRecoveryState("ready"); return; }
          persistRequest(replicaId, latest.request_id, copy.errors.browserHandle); id = latest.request_id; setRequestId(id); setRecoveryState("ready"); stage = "result";
        }
        const next = await readPrivateTextResult(token, replicaId, id, abort.signal);
        if (mounted.current && operation.current === attempt && !abort.signal.aborted) { setResult(next); setNotFound(false); }
      } catch (cause) {
        if (!mounted.current || operation.current !== attempt || abort.signal.aborted) return;
        if (stage === "discover") {
          if (cause instanceof ReplicaApiError && cause.status === 401) onAuthErrorRef.current(cause);
          setRecoveryState("error");
          return;
        }
        setNotFound(requestNotFound(cause));
        handleError(cause, requestNotFound(cause) ? copy.errors.savedMissing : copy.errors.savedUnreadable);
      }
    })();
    return () => abort.abort();
  }, [token, replicaId, recoveryRefresh]);
  const selected = readiness?.selected;
  const selectedContext = selected?.material.context as ({ source_name: string; format: string; body: string; excerpt?: true; source_chars?: number; excerpt_start_char?: number; excerpt_end_char?: number }) | undefined;
  const subjectLabel = (subject: string | undefined) => subject === "physics" ? copy.editor.physics : subject === "chemistry" ? copy.editor.chemistry : subject === "maths" ? copy.editor.maths : subject || "";
  const currentQuery = new URLSearchParams(location.search);
  const hasScopedUrlHandle = currentQuery.get("replica") === replicaId && currentQuery.has(REQUEST_PARAM);
  const profileStart = copy.profileFirstUse;
  const needsPersonalProfile = Boolean(!loading && readiness && readiness.drafts.length === 0 && onEditProfile);
  const ready = Boolean(recoveryState === "ready" && readiness?.can_ask && selected && !editor && !loading && !requestId);
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
    catch (cause) { if (current()) handleError(cause, cause instanceof ReplicaApiError ? copy.errors.actionUnconfirmed : cause instanceof Error ? cause.message : copy.errors.actionUnconfirmed); }
    finally { if (current()) { lock.current = false; setBusy(""); } }
  }
  async function ask(trigger: HTMLFormElement) {
    if (!canAsk || !selected || lock.current) return;
    const focus = actionFocus(trigger);
    let focusQueued = false;
    await act("ask", async (signal, current) => {
      const id = crypto.randomUUID();
      persistRequest(replicaId, id, copy.errors.browserHandle); setRequestId(id); setAttested([]);
      try {
        const next = await askPrivateText(token, { replica_id: replicaId, request_id: id, sheet_id: selected.sheet_id,
          context_item_id: selected.context_item_id, expected_snapshot_hash: selected.snapshot_hash, question,
          ...(parentRequestId ? { parent_request_id: parentRequestId } : {}) }, signal);
        if (current()) {
          if (next.state === "complete") { focus.finish(() => resultHeading.current); focusQueued = true; }
          setResult(next);
        }
      } catch (cause) {
        if (current()) handleError(cause, copy.errors.answerUnconfirmed);
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
        if (current() && requestNotFound(cause)) { setNotFound(true); throw new Error(copy.errors.savedMissing); }
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
    const returnDraft = { question, sheetId: selection.sheetId || selected?.sheet_id || "", contextItemId: selection.contextItemId || selected?.context_item_id || "" };
    if (onEditProfile && selected?.material.draft.sheetKind === "person") { onEditProfile(returnDraft); return; }
    await act("edit", async (signal, current) => {
      const view = await readPrivateRehearsalDraft(token, replicaId, signal);
      if (!current()) return;
      if (selected && view.sheet_id !== selected.sheet_id) throw new Error(copy.errors.draftChanged);
      if (view.status && !["draft", "validated", "published"].includes(view.status)) throw new Error(copy.errors.draftUnavailable);
      if (onEditProfile && (!view.draft || view.draft.sheetKind === "person")) { onEditProfile(returnDraft); return; }
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
  function newQuestion(parent: string | null = null, initialQuestion = "") {
    if (busy) return;
    try { persistRequest(replicaId, null, copy.errors.browserHandle); } catch (cause) { setError(cause instanceof Error ? cause.message : copy.errors.clearHandle); return; }
    operation.current++; readOperation.current++; setReadiness(null); setRefinementOpen(false); setRequestId(null); setParentRequestId(parent); setResult(null); setErased(false); setWithdrawalBilling(null); setNotFound(false); setQuestion(initialQuestion); setAttested(parent ? [...PRIVATE_TEXT_ATTESTATIONS] : []); setError(""); setRecoveryState("ready"); setRefresh(value => value + 1);
  }
  const canStartAnother = erased || result?.state === "withdrawn" || result && ["complete", "blocked"].includes(result.state) && ["settled", "not_started"].includes(result.billing_state);
  return <section className="ptr-panel" aria-labelledby="ptr-title">
    <div className="ptr-content">
      <button className="vx-back" type="button" onClick={onBack}>{copy.back}</button>
      <header className="ptr-heading">
        <h1 id="ptr-title">{copy.pageTitle}</h1>
        <p>{copy.pageBody}</p>
      </header>
      {error && (!readinessError || requestId) ? <p className="ptr-message" role="alert">{error}</p> : null}
      {requestId ? <section className="ptr-result" aria-label={copy.result.aria}>
        <h2 ref={resultHeading} tabIndex={-1}>{erased || result?.state === "withdrawn" ? copy.result.removedTitle : result?.state === "complete" ? copy.result.answerTitle : busy === "ask" && !result ? copy.result.askingTitle : copy.result.pendingTitle}</h2>
        {!erased && result?.state === "complete" ? <>
          <div className="ptr-answer"><ExpertAnswer text={result.answer!} /></div>
          <p className="ptr-source">{copy.result.source}: {readiness?.context_items.find(item => item.item_id === result.source.context_item_id)?.source_name || copy.result.selectedSource}. {copy.result.profile}: {readiness?.drafts.find(item => item.sheet_id === result.source.sheet_id)?.name || copy.result.selectedDraft}.</p>
        </> : erased || result?.state === "withdrawn" ? <p>{copy.result.closed}</p> : <p>{busy === "ask" && !result ? copy.result.asking : result?.state === "blocked" ? privateTextFailureMessage(result.failure_code, locale) : copy.result.pending}</p>}
        {!erased && (result?.state === "complete" || result?.state === "blocked" && result.can_review_teaching === true) && result.billing_state === "settled" ? <PrivateTeachingRefinement recoveryOnly={result.state !== "complete"} sheetKind={result.source.sheet_kind} token={token} replicaId={replicaId} requestId={result.request_id} sheetId={result.source.sheet_id} disabled={Boolean(busy)} onOpenChange={setRefinementOpen} onAuthError={onAuthErrorRef.current} onNextQuestion={newQuestion} onRetryQuestion={question.trim() ? () => newQuestion(null, question) : undefined} onEditKnowledge={() => onEditContext({ question, sheetId: result.source.sheet_id, contextItemId: result.source.context_item_id })} onEditProfile={onEditProfile ? () => onEditProfile({ question, sheetId: result.source.sheet_id, contextItemId: result.source.context_item_id }) : undefined} onDraftChanged={view => {
          readOperation.current++; setReadiness(null); setAttested([]);
          setSelection({sheetId: view.sheet_id, contextItemId: result.source.context_item_id}); setRefresh(value => value + 1);
        }} /> : null}
        {!erased && result?.state === "complete" && result.source.sheet_kind === "person" && onEditProfile ? <button className="vx-button vx-button--quiet" type="button" onClick={() => onEditProfile({ question, sheetId: result.source.sheet_id, contextItemId: result.source.context_item_id })}>{copy.result.adjustPersonality}</button> : null}
        {unresolvedUsage(withdrawalBilling || result?.billing_state) ? <p role="status">{copy.result.usage}</p> : null}
        {result?.failure_code ? <details className="ptr-request-details"><summary>{copy.result.requestDetails}</summary><p>{privateTextFailureMessage(result.failure_code, locale)}</p><code>{copy.result.technicalDetail}: {result.failure_code}</code></details> : null}
        <div className="ptr-actions ptr-actions--result">{result?.state === "blocked" && question.trim() && !refinementOpen ? <button className="vx-button vx-button--primary ptr-followup-action" type="button" disabled={Boolean(busy)} onClick={() => newQuestion(null, question)}>{copy.result.retrySameQuestion}</button> : null}{canStartAnother && !refinementOpen ? <button className={result?.state === "complete" ? "vx-button vx-button--primary ptr-followup-action" : undefined} type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => newQuestion(result?.state === "complete" ? result.request_id : null)}>{result?.state === "complete" ? copy.result.followUp : copy.result.another}</button> : null}{!erased && result?.state !== "withdrawn" ? <>
          <button type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => void checkResult()}>{busy === "read" ? copy.result.checking : copy.result.check}</button>
          <button type="button" disabled={Boolean(busy) || refinementOpen} onClick={() => void removeTest()}>{busy === "withdraw" ? copy.result.closing : notFound ? copy.result.cancel : copy.result.remove}</button>
        </> : null}</div>
      </section> : recoveryState === "checking" ? <section className="ptr-recovery" aria-live="polite"><h2>{copy.recovery.checkingTitle}</h2><p>{copy.recovery.checkingBody}</p></section> : recoveryState === "error" ? <section className="ptr-recovery" role="alert"><h2>{copy.recovery.failedTitle}</h2><p>{copy.recovery.failedBody}</p>{!hasScopedUrlHandle ? <button className="vx-button vx-button--primary" type="button" onClick={() => setRecoveryRefresh(value => value + 1)}>{copy.recovery.tryAgain}</button> : null}</section> : readinessError ? <section className="ptr-recovery" role="alert"><h2>{copy.recovery.loadFailedTitle}</h2><p>{copy.recovery.loadFailedBody}</p><button className="vx-button vx-button--primary" type="button" onClick={() => { setError(""); setRefresh(value => value + 1); }}>{copy.recovery.tryAgain}</button></section> : needsPersonalProfile ? <section className="ptr-profile-first-use" aria-labelledby="ptr-profile-first-use-title">
        <h2 id="ptr-profile-first-use-title">{profileStart.title}</h2>
        <p>{profileStart.body}</p>
        <div className="ptr-actions">
          <button className="vx-button vx-button--primary" type="button" disabled={Boolean(busy)} onClick={() => void editDraft()}>{busy === "edit" ? profileStart.opening : profileStart.action}</button>
          <button type="button" disabled={Boolean(busy)} onClick={() => onEditContext({ question, sheetId: selection.sheetId || selected?.sheet_id || "", contextItemId: selection.contextItemId || selected?.context_item_id || "" })}>{profileStart.sourceAction}</button>
        </div>
      </section> : <div className="ptr-compose">
        <section className="ptr-material" aria-label={copy.material.aria}>
          <div className="ptr-section-heading">
            <div><h2 ref={materialHeading} tabIndex={-1}>{copy.material.title}</h2><p>{copy.material.subtitle}</p></div>
            <button type="button" disabled={Boolean(busy)} onClick={() => { setError(""); setRefresh(value => value + 1); }}>{copy.material.refresh}</button>
          </div>
          {loading ? <p className="ptr-loading" role="status">{copy.material.loading}</p> : null}
          <div className="ptr-fields">
            <label>{selected?.material.draft.sheetKind === "person" ? copy.material.personalProfile : copy.material.teachingDraft}<select value={selection.sheetId || selected?.sheet_id || ""} disabled={Boolean(busy)} onChange={event => changeSelection({ ...selection, sheetId: event.target.value })}><option value="">{copy.material.chooseDraft}</option>{readiness?.drafts.map(draft => <option key={draft.sheet_id} value={draft.sheet_id}>{draft.name || copy.material.unnamedDraft}</option>)}</select></label>
            <label>{copy.material.extractedSource}<select value={selection.contextItemId || selected?.context_item_id || ""} disabled={Boolean(busy)} onChange={event => changeSelection({ ...selection, contextItemId: event.target.value })}><option value="">{copy.material.chooseSource}</option>{readiness?.context_items.map(item => <option key={item.item_id} value={item.item_id} disabled={!item.eligible}>{item.source_name}{item.eligible ? "" : copy.material.unavailableSuffix}</option>)}</select></label>
          </div>
          {readiness?.blockers.length ? <ul className="ptr-blockers">{readiness.blockers.map((blocker, index) => <li key={`${blocker.code}:${index}`}><strong>{blocker.responsibility === "platform" ? copy.blocker.waitingUs : copy.blocker.needsInput}</strong><span>{privateTextBlockerMessage(blocker.code, blocker.responsibility, locale)}</span><details className="ptr-blocker-detail"><summary>{copy.blocker.technicalDetail}</summary><code>{blocker.code}</code></details></li>)}</ul> : null}
          <div className="ptr-actions ptr-material-actions">
            <button type="button" disabled={Boolean(busy)} onClick={() => void editDraft()}>{busy === "edit" ? copy.material.readingDraft : readiness?.drafts.length ? copy.material.editDraft : copy.material.createDraft}</button>
            <button type="button" disabled={Boolean(busy)} onClick={() => onEditContext({ question, sheetId: selection.sheetId || selected?.sheet_id || "", contextItemId: selection.contextItemId || selected?.context_item_id || "" })}>{copy.material.editSource}</button>
          </div>
          {editor ? <form className="ptr-editor" onSubmit={event => { event.preventDefault(); void saveDraft(event.currentTarget); }}>
            <h3>{editorFromPublished ? copy.editor.successorTitle : copy.editor.detailsTitle}</h3>
            {editorFromPublished ? <p>{copy.editor.successorBody}</p> : null}
            <label>{copy.editor.name}<input value={String(editor.name || "")} maxLength={200} onChange={event => setEditor({ ...editor, name: event.target.value })} /></label>
            <label>{copy.editor.identity}<textarea value={String(editor.identityWho || "")} maxLength={2000} rows={3} onChange={event => setEditor({ ...editor, identityWho: event.target.value })} /></label>
            <label>{copy.editor.subject}<select name="subjectDomain" aria-label={copy.editor.subject} value={String(editor.subjectDomain || "")} onChange={event => setEditor({ ...editor, subjectDomain: event.target.value as PrivateDraftBody["subjectDomain"] })}><option value="">{copy.editor.chooseSubject}</option><option value="physics">{copy.editor.physics}</option><option value="chemistry">{copy.editor.chemistry}</option><option value="maths">{copy.editor.maths}</option></select></label>
            <p>{copy.editor.incompleteHelp}</p>
            <div className="ptr-actions"><button type="submit" disabled={Boolean(busy)}>{busy === "save" ? copy.editor.saving : copy.editor.save}</button><button type="button" disabled={Boolean(busy)} onClick={() => setEditor(null)}>{copy.editor.cancel}</button></div>
          </form> : null}
          {selected && !editor ? <details className="ptr-review">
            <summary><span>{copy.material.reviewSource}: {selected.material.context.source_name}</span><small>{selected.material.draft.name}</small></summary>
            <div className="ptr-review-content">
              <div><h3>{selected.material.draft.sheetKind === "person" ? copy.material.personalProfile : copy.material.teachingDraft}</h3><strong>{selected.material.draft.name}</strong><p>{selected.material.draft.identityWho}</p>{selected.material.draft.sheetKind !== "person" ? <p>{copy.material.subject}: {subjectLabel(selected.material.draft.subjectDomain)}</p> : null}</div>
              <div><h3>{selectedContext?.excerpt ? copy.material.sourceExcerpt : copy.material.sourceText}</h3>{selectedContext?.excerpt && Number.isInteger(selectedContext.source_chars) && Number.isInteger(selectedContext.excerpt_start_char) && Number.isInteger(selectedContext.excerpt_end_char) ? <p className="ptr-excerpt-note">{copy.material.excerptSummary(selectedContext.excerpt_start_char!, selectedContext.excerpt_end_char!, selectedContext.source_chars!)}</p> : null}<p className="ptr-source-body">{selected.material.context.body}</p></div>
            </div>
          </details> : null}
        </section>
        <form className="ptr-question" onSubmit={event => { event.preventDefault(); void ask(event.currentTarget); }}>
          <div className="ptr-question-heading"><h2>{copy.question.title}</h2><span className="ptr-count">{question.length} / 2000</span></div>
          {parentRequestId ? <p role="status">{copy.question.followUpContext}</p> : null}
          <label htmlFor="ptr-question">{copy.question.label}<textarea id="ptr-question" rows={3} value={question} maxLength={2000} disabled={Boolean(busy)} onChange={event => { setQuestion(event.target.value); setAttested(value => parentRequestId ? value : []); }} /></label>
          {!parentRequestId ? <fieldset disabled={!ready || Boolean(busy)}><legend>{copy.question.before}</legend>{readiness?.statements.map(statement => <label className="ptr-attestation" key={statement.id}><input type="checkbox" checked={attested.includes(statement.id)} onChange={event => setAttested(value => event.target.checked ? [...value, statement.id] : value.filter(id => id !== statement.id))} /><span>{statement.text}</span></label>)}</fieldset> : null}
          <p className="ptr-retention">{copy.question.retention}</p>
          <button className="vx-button vx-button--primary" type="submit" disabled={!canAsk}>{busy === "ask" ? copy.question.asking : copy.question.ask}</button>
        </form>
      </div>}
    </div>
  </section>;
}
