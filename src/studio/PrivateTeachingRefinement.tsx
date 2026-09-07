import { useEffect, useRef, useState } from "react";
import "./private-teaching-refinement.css";
import { ReplicaApiError } from "./replicaApi";
import { readPrivateTeachingRefinement, savePrivateTeachingRefinement, validPrivateTeachingValue,
  type PrivateTeachingChange, type PrivateTeachingRefinement } from "./privateTeachingRefinementApi";

type Props = { token: string; replicaId: string; requestId: string; sheetId: string; disabled: boolean; recoveryOnly?: boolean;
  onOpenChange: (open: boolean) => void; onDraftChanged: (view: PrivateTeachingRefinement) => void;
  onNextQuestion: () => void; onAuthError: (cause: unknown) => void };
export default function PrivateTeachingRefinement(props: Props) {
  // The parent result is request-bound. A changed result/session gets fresh state.
  return <RefinementSession key={`${props.replicaId}:${props.requestId}:${props.sheetId}:${props.token}:${Boolean(props.recoveryOnly)}`} {...props} />;
}
function RefinementSession({token, replicaId, requestId, sheetId, disabled, recoveryOnly = false, onOpenChange, onDraftChanged, onNextQuestion, onAuthError}: Props) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState("");
  const [basis, setBasis] = useState<PrivateTeachingRefinement | null>(null);
  const [value, setValue] = useState("");
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [needsReadback, setNeedsReadback] = useState(false);
  const attempted = useRef<{basis: PrivateTeachingRefinement; change: PrivateTeachingChange} | null>(null);
  const live = useRef(false), locked = useRef(false), generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const focusIntent = useRef<"heading" | "opener" | "next" | null>(null);
  const callbacks = useRef({onOpenChange, onDraftChanged, onAuthError}); callbacks.current = {onOpenChange, onDraftChanged, onAuthError};
  useEffect(() => { live.current = true; return () => {live.current = false; generation.current++; abort.current?.abort();}; }, []);
  // The measured opener removal left BODY focused. Move focus only at the
  // actual replacement mount, and cancel the intent on later user interaction.
  useEffect(() => {
    const cancelFocus = () => {focusIntent.current = null;};
    const events = ["pointerdown", "keydown", "wheel", "touchstart"];
    events.forEach(name => document.addEventListener(name, cancelFocus, true));
    return () => events.forEach(name => document.removeEventListener(name, cancelFocus, true));
  }, []);
  function focusAtMount(kind: "heading" | "opener" | "next", element: HTMLElement | null) {
    if (!element || focusIntent.current !== kind) return;
    focusIntent.current = null;
    if (live.current && document.activeElement === document.body) element.focus();
  }
  const auth = (cause: unknown) => {if (cause instanceof ReplicaApiError && cause.status === 401) callbacks.current.onAuthError(cause);};
  async function act(name: string, work: (signal: AbortSignal, current: () => boolean) => Promise<void>) {
    if (disabled || locked.current) return;
    locked.current = true; setBusy(name); setError("");
    const controller = new AbortController(); abort.current = controller; const run = ++generation.current;
    const current = () => live.current && generation.current === run && !controller.signal.aborted;
    try {await work(controller.signal, current);} finally {if(current()){locked.current=false;setBusy("");}}
  }
  async function read() {
    await act("read", async (signal, current) => {
      focusIntent.current = "heading"; setOpen(true); callbacks.current.onOpenChange(true);
      try {
        const next = await readPrivateTeachingRefinement(token, replicaId, requestId, sheetId, signal);
        if (!current()) return;
        if (recoveryOnly && next.can_save) throw new Error("Recovery requires a read-only review.");
        const pending = attempted.current;
        setBasis(next); setNeedsReadback(false); setNotice("");
        if (pending && next.value === (pending.change.clear === true ? null : pending.change.value)
          && next.sheet_hash !== pending.basis.sheet_hash && BigInt(next.private_text_epoch) > BigInt(pending.basis.private_text_epoch)) {
          setValue(next.value || ""); setNotice(next.value === null ? "Your private draft no longer contains this guidance." : "Your private draft contains this guidance.");
        } else if (pending && next.can_save && next.sheet_hash === pending.basis.sheet_hash && next.private_text_epoch === pending.basis.private_text_epoch) {
          setNotice("The saved guidance is unchanged. Review your edit before saving again.");
        } else {
          setValue(next.value || "");
        }
        attempted.current = null;
        if (!next.can_save) callbacks.current.onDraftChanged(next);
      } catch (cause) {if(current()){auth(cause);setError("The saved guidance could not be read. Try checking it again.");}}
    });
  }
  async function save(change: PrivateTeachingChange) {
    if (recoveryOnly || !basis?.can_save || needsReadback || (change.clear === true ? basis.value === null : !validPrivateTeachingValue(change.value) || change.value === basis.value)) return;
    await act("save", async (signal, current) => {
      focusIntent.current = "next"; attempted.current = {basis, change}; setNotice("");
      try {
        const next = await savePrivateTeachingRefinement(token, basis, change, signal);
        if(!current()) return;
        attempted.current = null; setBasis(next); setValue(next.value || "");
        setNotice(change.clear === true ? "Guidance removed from your private draft." : "Saved to private draft.");
        callbacks.current.onDraftChanged(next);
      } catch(cause) {
        if(!current()) return;
        auth(cause);
        if(cause instanceof ReplicaApiError && cause.status === 400){attempted.current=null;setError("This guidance could not be saved. Shorten or revise it, then try again.");}
        else {setNeedsReadback(true);setError(cause instanceof ReplicaApiError && cause.status === 409
          ? "The draft or its permissions changed. Check the saved guidance before continuing."
          : "Saving could not be confirmed. Check the saved guidance before trying again.");}
      }
    });
  }
  function close() {
    if (busy || needsReadback) return;
    focusIntent.current = "opener"; setOpen(false); setBasis(null); setNotice(""); setError(""); attempted.current=null; onOpenChange(false);
  }
  const canSave = Boolean(basis?.can_save && !needsReadback && !busy && !disabled && validPrivateTeachingValue(value) && value !== basis.value);
  if (!open) return <div className="ptr-actions"><button type="button" ref={element => focusAtMount("opener", element)} disabled={disabled} onClick={() => void read()}>{recoveryOnly ? "Check saved guidance" : "Adjust how I explain"}</button></div>;
  return <section className="ptr-editor ptr-refinement" aria-labelledby="ptr-refinement-title">
    <h3 id="ptr-refinement-title" tabIndex={-1} ref={element => focusAtMount("heading", element)}>{recoveryOnly ? "Saved explanation order" : "How should I explain?"}</h3>
    <p>{recoveryOnly ? "Review the current guidance in your private draft." : "Describe the order you prefer. This changes your private draft only."}</p>
    {busy === "read" ? <p role="status">Reading saved guidance</p> : null}
    {error ? <p className="ptr-message" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {basis?.can_save ? <form onSubmit={event => {event.preventDefault();void save({value});}}>
      <label htmlFor="ptr-explanation-order">Explanation order<textarea id="ptr-explanation-order" rows={4} maxLength={4000} value={value} readOnly={!basis.can_save || needsReadback} disabled={Boolean(busy)} onChange={event => setValue(event.target.value)} /></label>
      <p className="ptr-count">{value.length} / 4000 characters</p>
      <div className="ptr-actions">{basis.can_save && !needsReadback ? <><button type="submit" disabled={!canSave}>{busy === "save" ? "Saving guidance" : "Save guidance"}</button>{basis.value !== null ? <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void save({clear:true})}>Remove saved guidance</button> : null}</> : null}
      </div>
    </form> : basis ? <>
      {!notice ? <p>This draft changed after the test. Start a new test before changing it again.</p> : null}
      <details><summary>Current explanation order</summary><p className="ptr-guidance-text">{basis.value || "No explanation order is saved."}</p></details>
      {!needsReadback ? <div className="ptr-actions"><button ref={element => focusAtMount("next", element)} type="button" disabled={Boolean(busy) || disabled} onClick={onNextQuestion}>Prepare another question</button></div> : null}
    </> : null}
    <div className="ptr-actions">{needsReadback || !basis ? <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void read()}>Check saved guidance</button> : null}{!needsReadback ? <button type="button" disabled={Boolean(busy)} onClick={close}>Close guidance</button> : null}</div>
  </section>;
}
