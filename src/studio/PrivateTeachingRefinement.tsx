import { useEffect, useRef, useState } from "react";
import "./private-teaching-refinement.css";
import { ReplicaApiError } from "./replicaApi";
import { useStudioLocale } from "./localeContext";
import { readPrivateTeachingRefinement, savePrivateTeachingRefinement, validPrivatePersonChange, validPrivateTeachingValue,
  type PrivateDraftChange, type PrivateDraftRefinement, type PrivatePersonChange, type PrivateTeachingChange } from "./privateTeachingRefinementApi";

type Props = { token: string; replicaId: string; requestId: string; sheetId: string; disabled: boolean; recoveryOnly?: boolean;
  sheetKind?: "person"; onOpenChange: (open: boolean) => void; onDraftChanged: (view: PrivateDraftRefinement) => void;
  onNextQuestion: () => void; onRetryQuestion?: () => void; onEditKnowledge?: () => void; onEditProfile?: () => void;
  onAuthError: (cause: unknown) => void };
const emptyPerson: Partial<PrivatePersonChange> = { register: undefined, script_baseline: undefined };
const personChange = (basis: PrivateDraftRefinement | null): Partial<PrivatePersonChange> => basis?.field === "personTalk" && basis.value
  ? { register: basis.value.register, script_baseline: basis.value.scriptBaseline } : emptyPerson;
const samePerson = (left: Partial<PrivatePersonChange>, right: PrivateDraftRefinement | null) => right?.field === "personTalk"
  && right.value !== null && left.register === right.value.register && left.script_baseline === right.value.scriptBaseline;
const targetValue = (basis: PrivateDraftRefinement, change: PrivateDraftChange) => basis.field === "personTalk"
  ? { register: (change as PrivatePersonChange).register, scriptBaseline: (change as PrivatePersonChange).script_baseline }
  : (change as PrivateTeachingChange).clear === true ? null : (change as { value: string }).value;
const sameTarget = (value: PrivateDraftRefinement["value"], expected: ReturnType<typeof targetValue>) =>
  typeof expected === "object" && expected !== null ? typeof value === "object" && value !== null
    && value.register === expected.register && value.scriptBaseline === expected.scriptBaseline : value === expected;

export default function PrivateTeachingRefinement(props: Props) {
  return <RefinementSession key={`${props.replicaId}:${props.requestId}:${props.sheetId}:${props.token}:${Boolean(props.recoveryOnly)}`} {...props} />;
}
function RefinementSession({token, replicaId, requestId, sheetId, disabled, recoveryOnly = false, sheetKind, onOpenChange,
  onDraftChanged, onNextQuestion, onRetryQuestion, onEditKnowledge, onEditProfile, onAuthError}: Props) {
  const { locale } = useStudioLocale();
  const [open, setOpen] = useState(false), [busy, setBusy] = useState("");
  const [basis, setBasis] = useState<PrivateDraftRefinement | null>(null);
  const [value, setValue] = useState("");
  const [person, setPerson] = useState<Partial<PrivatePersonChange>>(emptyPerson);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [needsReadback, setNeedsReadback] = useState(false);
  const attempted = useRef<{basis: PrivateDraftRefinement; change: PrivateDraftChange} | null>(null);
  const live = useRef(false), locked = useRef(false), generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const focusIntent = useRef<"heading" | "opener" | "next" | null>(null);
  const callbacks = useRef({onOpenChange, onDraftChanged, onAuthError}); callbacks.current = {onOpenChange, onDraftChanged, onAuthError};
  const personCopy = locale === "hi" ? {
    opener: "मेरे बोलने का तरीका बदलें", check: "बोलने का सेव तरीका जाँचें", title: "मैं कैसे जवाब दूँ?",
    review: "अपने निजी ड्राफ्ट की भाषा और बोलने का ढंग देखें।", body: "भाषा और बोलने का ढंग चुनें। यह केवल आपके निजी ड्राफ्ट को बदलता है।",
    register: "बोलने का ढंग", script: "भाषा और लिपि", formal: "औपचारिक", mixed: "मिला-जुला", casual: "अनौपचारिक",
    roman: "रोमन लिपि में हिंग्लिश", devanagari: "देवनागरी में हिंदी", english: "अंग्रेज़ी", choose: "चुनें",
    save: "निजी ड्राफ्ट में लागू करें", saving: "लागू किया जा रहा है", saved: "निजी ड्राफ्ट में सेव हो गया।", unchanged: "सेव तरीका नहीं बदला। फिर से लागू करने से पहले अपनी पसंद देखें।",
    invalid: "यह चुनाव सेव नहीं हुआ। दोनों विकल्प चुनकर फिर कोशिश करें।", changed: "ड्राफ्ट या उसकी अनुमति बदल गई। आगे बढ़ने से पहले सेव तरीका जाँचें।",
    saveUnconfirmed: "सेव होना पक्का नहीं हुआ। फिर से लागू करने से पहले सेव तरीका जाँचें।", readError: "सेव तरीका पढ़ा नहीं जा सका। फिर कोशिश करें।",
    stale: "इस टेस्ट के बाद ड्राफ्ट बदल गया। दोबारा बदलने से पहले नया टेस्ट शुरू करें।", current: "अभी सेव तरीका", absent: "अभी कोई तरीका सेव नहीं है।",
    retry: "यही सवाल फिर आज़माएँ", next: "दूसरा सवाल तैयार करें", source: "स्रोत की जानकारी बदलें", profile: "निजी जानकारी बदलें", close: "बंद करें",
  } : {
    opener: "Adjust how I talk", check: "Check saved talk style", title: "How should I answer?",
    review: "Review the language and register in your private draft.", body: "Choose a language and register. This changes your private draft only.",
    register: "Register", script: "Language and script", formal: "Formal", mixed: "Mixed", casual: "Casual",
    roman: "Hinglish in Roman script", devanagari: "Hindi in Devanagari", english: "English", choose: "Choose",
    save: "Apply to private draft", saving: "Applying", saved: "Saved to private draft.", unchanged: "The saved talk style is unchanged. Review your choices before applying again.",
    invalid: "This choice was not saved. Choose both options and try again.", changed: "The draft or its permissions changed. Check the saved talk style before continuing.",
    saveUnconfirmed: "Saving could not be confirmed. Check the saved talk style before trying again.", readError: "The saved talk style could not be read. Try again.",
    stale: "This draft changed after the test. Start a new test before changing it again.", current: "Current talk style", absent: "No talk style is saved.",
    retry: "Try the same question", next: "Prepare another question", source: "Edit source facts", profile: "Edit personal details", close: "Close",
  };
  const teacherCopy = locale === "hi" ? {
    opener: "मेरे समझाने का तरीका बदलें", check: "सेव तरीका जाँचें", savedTitle: "सेव समझाने का क्रम", title: "कैसे समझाऊँ?",
    review: "अपने निजी ड्राफ्ट में सेव समझाने का क्रम देखें।", body: "अपना पसंदीदा क्रम बताएँ। यह केवल आपके निजी ड्राफ्ट को बदलता है।",
    loading: "सेव तरीका पढ़ा जा रहा है", removed: "यह तरीका अब आपके निजी ड्राफ्ट में नहीं है।", present: "यह तरीका आपके निजी ड्राफ्ट में सेव है।",
    unchanged: "सेव तरीका नहीं बदला। फिर से सेव करने से पहले अपना बदलाव देखें।", readError: "सेव तरीका पढ़ा नहीं जा सका। फिर कोशिश करें।",
    invalid: "यह तरीका सेव नहीं हुआ। इसे छोटा करें या बदलें, फिर कोशिश करें।", changed: "ड्राफ्ट या उसकी अनुमति बदल गई। आगे बढ़ने से पहले सेव तरीका जाँचें।",
    saveUnconfirmed: "सेव होना पक्का नहीं हुआ। फिर से कोशिश करने से पहले सेव तरीका जाँचें।", field: "समझाने का क्रम", characters: "अक्षर",
    save: "तरीका सेव करें", saving: "तरीका सेव हो रहा है", remove: "सेव तरीका हटाएँ", saved: "निजी ड्राफ्ट में सेव हो गया।", removedNotice: "निजी ड्राफ्ट से तरीका हट गया।",
    stale: "इस टेस्ट के बाद ड्राफ्ट बदल गया। इसे फिर बदलने से पहले नया टेस्ट शुरू करें।", current: "अभी सेव समझाने का क्रम", absent: "अभी कोई समझाने का क्रम सेव नहीं है।",
    next: "दूसरा सवाल तैयार करें", close: "बंद करें",
  } : {
    opener: "Adjust how I explain", check: "Check saved guidance", savedTitle: "Saved explanation order", title: "How should I explain?",
    review: "Review the current guidance in your private draft.", body: "Describe the order you prefer. This changes your private draft only.",
    loading: "Reading saved guidance", removed: "Your private draft no longer contains this guidance.", present: "Your private draft contains this guidance.",
    unchanged: "The saved guidance is unchanged. Review your edit before saving again.", readError: "The saved guidance could not be read. Try checking it again.",
    invalid: "This guidance could not be saved. Shorten or revise it, then try again.", changed: "The draft or its permissions changed. Check the saved guidance before continuing.",
    saveUnconfirmed: "Saving could not be confirmed. Check the saved guidance before trying again.", field: "Explanation order", characters: "characters",
    save: "Save guidance", saving: "Saving guidance", remove: "Remove saved guidance", saved: "Saved to private draft.", removedNotice: "Guidance removed from your private draft.",
    stale: "This draft changed after the test. Start a new test before changing it again.", current: "Current explanation order", absent: "No explanation order is saved.",
    next: "Prepare another question", close: "Close guidance",
  };
  useEffect(() => { live.current = true; return () => {live.current = false; generation.current++; abort.current?.abort();}; }, []);
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
        if (sheetKind === "person" && next.field !== "personTalk") throw new Error("Person talk refinement expected.");
        if (sheetKind !== "person" && next.field !== "explanationOrder") throw new Error("Teaching refinement expected.");
        if (recoveryOnly && next.can_save) throw new Error("Recovery requires a read-only review.");
        const pending = attempted.current;
        let preserveAttemptedValue = false;
        setBasis(next); setNeedsReadback(false); setNotice("");
        if (pending && sameTarget(next.value, targetValue(pending.basis, pending.change))
          && next.sheet_hash !== pending.basis.sheet_hash && BigInt(next.private_text_epoch) > BigInt(pending.basis.private_text_epoch)) {
          setNotice(next.field === "personTalk" ? personCopy.saved : next.value === null ? teacherCopy.removed : teacherCopy.present);
        } else if (pending && next.can_save && next.sheet_hash === pending.basis.sheet_hash && next.private_text_epoch === pending.basis.private_text_epoch) {
          preserveAttemptedValue = true;
          setNotice(next.field === "personTalk" ? personCopy.unchanged : teacherCopy.unchanged);
        }
        if (!preserveAttemptedValue) {
          setValue(next.field === "explanationOrder" ? next.value || "" : "");
          setPerson(personChange(next));
        }
        attempted.current = null;
        if (!next.can_save) callbacks.current.onDraftChanged(next);
      } catch (cause) {if(current()){auth(cause);setError(sheetKind === "person" ? personCopy.readError : teacherCopy.readError);}}
    });
  }
  async function save(change: PrivateDraftChange) {
    if (recoveryOnly || !basis?.can_save || needsReadback) return;
    await act("save", async (signal, current) => {
      focusIntent.current = "next"; attempted.current = {basis, change}; setNotice("");
      try {
        const next = await savePrivateTeachingRefinement(token, basis, change, signal);
        if(!current()) return;
        attempted.current = null; setBasis(next);
        setValue(next.field === "explanationOrder" ? next.value || "" : ""); setPerson(personChange(next));
        setNotice(next.field === "personTalk" ? personCopy.saved : (change as PrivateTeachingChange).clear === true ? teacherCopy.removedNotice : teacherCopy.saved);
        callbacks.current.onDraftChanged(next);
      } catch(cause) {
        if(!current()) return;
        auth(cause);
        if(cause instanceof ReplicaApiError && cause.status === 400){attempted.current=null;setError(basis.field === "personTalk" ? personCopy.invalid : teacherCopy.invalid);}
        else {setNeedsReadback(true);setError(cause instanceof ReplicaApiError && cause.status === 409
          ? (basis.field === "personTalk" ? personCopy.changed : teacherCopy.changed)
          : (basis.field === "personTalk" ? personCopy.saveUnconfirmed : teacherCopy.saveUnconfirmed));}
      }
    });
  }
  function close() {
    if (busy || needsReadback) return;
    focusIntent.current = "opener"; setOpen(false); setBasis(null); setNotice(""); setError(""); attempted.current=null; onOpenChange(false);
  }
  const isPerson = sheetKind === "person" || basis?.field === "personTalk";
  const personBasis = basis?.field === "personTalk" ? basis : null;
  const canSaveTeacher = Boolean(basis?.field === "explanationOrder" && basis.can_save && !needsReadback && !busy && !disabled && validPrivateTeachingValue(value) && value !== basis.value);
  const canSavePerson = Boolean(basis?.field === "personTalk" && basis.can_save && !needsReadback && !busy && !disabled && validPrivatePersonChange(person) && !samePerson(person, basis));
  if (!open) return <div className="ptr-actions"><button type="button" ref={element => focusAtMount("opener", element)} disabled={disabled} onClick={() => void read()}>{isPerson ? recoveryOnly ? personCopy.check : personCopy.opener : recoveryOnly ? teacherCopy.check : teacherCopy.opener}</button></div>;
  if (isPerson) return <section className="ptr-editor ptr-refinement" aria-labelledby="ptr-person-refinement-title">
    <h3 id="ptr-person-refinement-title" tabIndex={-1} ref={element => focusAtMount("heading", element)}>{recoveryOnly ? personCopy.current : personCopy.title}</h3>
    <p>{recoveryOnly ? personCopy.review : personCopy.body}</p>
    {busy === "read" ? <p role="status">{personCopy.check}</p> : null}
    {error ? <p className="ptr-message" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {basis?.field === "personTalk" && basis.can_save ? <form onSubmit={event => {event.preventDefault();if(validPrivatePersonChange(person))void save(person);}}>
      <label htmlFor="ptr-person-register">{personCopy.register}<select id="ptr-person-register" value={person.register || ""} disabled={Boolean(busy) || needsReadback} onChange={event => setPerson(current => ({...current, register: event.target.value as PrivatePersonChange["register"]}))}>
        <option value="" disabled>{personCopy.choose}</option><option value="formal">{personCopy.formal}</option><option value="mixed">{personCopy.mixed}</option><option value="casual">{personCopy.casual}</option>
      </select></label>
      <label htmlFor="ptr-person-script">{personCopy.script}<select id="ptr-person-script" value={person.script_baseline || ""} disabled={Boolean(busy) || needsReadback} onChange={event => setPerson(current => ({...current, script_baseline: event.target.value as PrivatePersonChange["script_baseline"]}))}>
        <option value="" disabled>{personCopy.choose}</option><option value="roman-hinglish">{personCopy.roman}</option><option value="devanagari">{personCopy.devanagari}</option><option value="english">{personCopy.english}</option>
      </select></label>
      <div className="ptr-actions"><button type="submit" disabled={!canSavePerson}>{busy === "save" ? personCopy.saving : personCopy.save}</button></div>
    </form> : basis ? <>
      {!notice ? <p>{personCopy.stale}</p> : null}
      <details><summary>{personCopy.current}</summary><p className="ptr-guidance-text">{personBasis?.value ? `${personBasis.value.register}; ${personBasis.value.scriptBaseline}` : personCopy.absent}</p></details>
      {!needsReadback ? <div className="ptr-actions"><button ref={element => focusAtMount("next", element)} type="button" disabled={Boolean(busy) || disabled} onClick={() => (onRetryQuestion || onNextQuestion)()}>{onRetryQuestion ? personCopy.retry : personCopy.next}</button></div> : null}
    </> : null}
    {(onEditKnowledge || onEditProfile) && <div className="ptr-actions">{onEditKnowledge ? <button type="button" disabled={Boolean(busy)} onClick={onEditKnowledge}>{personCopy.source}</button> : null}{onEditProfile ? <button type="button" disabled={Boolean(busy)} onClick={onEditProfile}>{personCopy.profile}</button> : null}</div>}
    <div className="ptr-actions">{needsReadback || !basis ? <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void read()}>{personCopy.check}</button> : null}{!needsReadback ? <button type="button" disabled={Boolean(busy)} onClick={close}>{personCopy.close}</button> : null}</div>
  </section>;
  return <section className="ptr-editor ptr-refinement" aria-labelledby="ptr-refinement-title">
    <h3 id="ptr-refinement-title" tabIndex={-1} ref={element => focusAtMount("heading", element)}>{recoveryOnly ? teacherCopy.savedTitle : teacherCopy.title}</h3>
    <p>{recoveryOnly ? teacherCopy.review : teacherCopy.body}</p>
    {busy === "read" ? <p role="status">{teacherCopy.loading}</p> : null}
    {error ? <p className="ptr-message" role="alert">{error}</p> : null}
    {notice ? <p role="status">{notice}</p> : null}
    {basis?.field === "explanationOrder" && basis.can_save ? <form onSubmit={event => {event.preventDefault();void save({value});}}>
      <label htmlFor="ptr-explanation-order">{teacherCopy.field}<textarea id="ptr-explanation-order" rows={4} maxLength={4000} value={value} readOnly={!basis.can_save || needsReadback} disabled={Boolean(busy)} onChange={event => setValue(event.target.value)} /></label>
      <p className="ptr-count">{value.length} / 4000 {teacherCopy.characters}</p>
      <div className="ptr-actions">{basis.can_save && !needsReadback ? <><button type="submit" disabled={!canSaveTeacher}>{busy === "save" ? teacherCopy.saving : teacherCopy.save}</button>{basis.value !== null ? <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void save({clear:true})}>{teacherCopy.remove}</button> : null}</> : null}</div>
    </form> : basis ? <>
      {!notice ? <p>{teacherCopy.stale}</p> : null}
      <details><summary>{teacherCopy.current}</summary><p className="ptr-guidance-text">{basis.value || teacherCopy.absent}</p></details>
      {!needsReadback ? <div className="ptr-actions"><button ref={element => focusAtMount("next", element)} type="button" disabled={Boolean(busy) || disabled} onClick={() => onNextQuestion()}>{teacherCopy.next}</button></div> : null}
    </> : null}
    <div className="ptr-actions">{needsReadback || !basis ? <button type="button" disabled={Boolean(busy) || disabled} onClick={() => void read()}>{teacherCopy.check}</button> : null}{!needsReadback ? <button type="button" disabled={Boolean(busy)} onClick={close}>{teacherCopy.close}</button> : null}</div>
  </section>;
}
