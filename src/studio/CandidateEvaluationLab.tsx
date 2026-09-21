import { useCallback, useEffect, useId, useRef, useState } from "react";
import { getCandidateEvaluation, judgeCandidateAssignment, requestCandidateQualification, type CandidateQualification } from "./candidateEvalApi";
import { ReplicaApiError } from "./replicaApi";
import CandidateActivationAction from './CandidateActivationAction';
import {readRememberedStudioLocale,resolveStudioLocale} from '../creatorStudio/studioLocalePreference';
import type {
  CandidateEvalChoice,
  CandidateEvalDimension,
  CandidateEvaluation,
} from "./types";

const DIMENSION_COPY: Record<CandidateEvalDimension, { label: string; hint: string }> = {
  overall: { label: "Overall", hint: "Which one feels more like you?" },
  wording: { label: "Wording", hint: "Phrases, sentence shape, and length" },
  behavior: { label: "Behavior", hint: "Reaction, judgment, and way of responding" },
  relationship: { label: "Relationship", hint: "How you would speak in this exact bond" },
  memory: { label: "Memory", hint: "Facts, callbacks, and honest uncertainty" },
  delivery: { label: "Delivery", hint: "Implied pace, energy, and emotional shape" },
};

const CHOICES: Array<{ value: CandidateEvalChoice; label: string }> = [
  { value: "a", label: "A is closer" },
  { value: "tie", label: "No difference" },
  { value: "b", label: "B is closer" },
];

const TEXT_COMPARISON_COPY={
  en:{title:'Which reply is more like you?',intro:'Compare the written replies. Your choices are saved for review.',seal:'Names stay hidden',empty:'No comparison is ready yet.',complete:(n:number)=>`${n} comparisons saved. Your current AI has not changed.`},
  hi:{title:'कौन सा जवाब आपके जैसा है?',intro:'लिखे हुए जवाबों की तुलना करें। आपकी पसंद समीक्षा के लिए सहेजी जाएगी।',seal:'नाम छिपे रहेंगे',empty:'अभी तुलना तैयार नहीं है।',complete:(n:number)=>`${n} तुलनाएं सहेजी गईं। आपका मौजूदा AI नहीं बदला है।`},
};

const QUALIFICATION_CHECK_COPY: Record<string, { en: string; hi: string }> = {
  fraud_policy_safety_sample_insufficient: { en: "Handles fraud and unsafe requests", hi: "धोखाधड़ी और असुरक्षित अनुरोधों से निपटना" },
  privacy_leakage_safety_sample_insufficient: { en: "Protects private conversations", hi: "निजी बातचीत की सुरक्षा" },
  synthetic_disclosure_safety_sample_insufficient: { en: "Identifies itself as AI", hi: "अपनी AI पहचान बताना" },
  watermark_detection_safety_sample_insufficient: { en: "Keeps AI audio detectable", hi: "AI ऑडियो की पहचान बनाए रखना" },
  false_memory_safety_sample_insufficient: { en: "Avoids invented memories", hi: "मनगढ़ंत यादों से बचना" },
};

function qualificationCheckLabel(code: string, language: 'en' | 'hi') {
  return QUALIFICATION_CHECK_COPY[code]?.[language]
    ?? (language === 'hi' ? "एक और आवश्यक जाँच" : "Another required check");
}

function loadError(cause: unknown) {
  return cause instanceof Error ? cause.message.replaceAll("_", " ") : "The comparison could not be loaded";
}

function QualificationAction({token,replicaId,candidateId,language,onAuthError,onResultsChecked}:{
  token:string;replicaId:string;candidateId:string;language:'en'|'hi';onAuthError:(cause:unknown)=>void;onResultsChecked:()=>void;
}) {
  const [result,setResult]=useState<CandidateQualification|null>(null),[checked,setChecked]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const pending=useRef<AbortController|null>(null),epoch=useRef(0),auth=useRef(onAuthError);auth.current=onAuthError;
  const resultsChecked=useRef(onResultsChecked);resultsChecked.current=onResultsChecked;
  const scope=JSON.stringify([token,replicaId,candidateId]),latest=useRef(scope);latest.current=scope;
  const hi=language==='hi';
  async function request(op:'qualification_status'|'qualify',explicit=false) {
    if(pending.current||(op==='qualify'&&!checked))return;
    const controller=new AbortController(),run=++epoch.current,currentScope=scope;
    pending.current=controller;setBusy(true);setError('');
    const timer=setTimeout(()=>controller.abort(),30_000);
    const current=()=>run===epoch.current&&latest.current===currentScope;
    try {
      const next=await requestCandidateQualification(token,replicaId,candidateId,op,controller.signal);
      if(!current()||controller.signal.aborted)return;
      setResult(next);setChecked(true);
      if(explicit)resultsChecked.current();
    }catch(cause){
      if(!current())return;setChecked(false);
      setError(hi?'नतीजे की पुष्टि नहीं हुई। पहले स्थिति देखें।':'Results are unconfirmed. Read the status before continuing.');
      if(cause instanceof ReplicaApiError&&cause.status===401)auth.current(cause);
    }finally{clearTimeout(timer);if(current()){pending.current=null;setBusy(false);}}
  }
  useEffect(()=>{
    epoch.current++;pending.current?.abort();pending.current=null;setResult(null);setChecked(false);setBusy(false);setError('');
    void request('qualification_status');
    return()=>{epoch.current++;pending.current?.abort();pending.current=null;};
    // Explicit scope owns the read. Callback and locale changes must not start qualification.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[scope]);
  return <div className="candidate-eval-results" aria-busy={busy}>
    <p role="status" aria-live="polite">{!checked?(busy?(hi?'नतीजे की स्थिति देख रहे हैं':'Reading result status'):(hi?'नतीजे की स्थिति जांचनी है':'Result status needs checking'))
      :result?.verdict==='pass'?(hi?'जांच पास हुई। आपका मौजूदा AI नहीं बदला है।':'Checks passed. Your current AI is unchanged.')
      :result?.verdict==='fail'?(hi?'यह बदलाव जांच पास नहीं कर पाया। आपका मौजूदा AI नहीं बदला है।':'This change did not pass. Your current AI is unchanged.')
      :hi?'अभी और जांच चाहिए। आपका मौजूदा AI नहीं बदला है।':'More checks are needed. Your current AI is unchanged.'}</p>
    {checked&&result?.checks&&(result.checks.failures.length>0||result.checks.inconclusive.length>0)?<details>
      <summary>{hi?'हमें अभी क्या जाँचना है':'What we still need to check'}</summary>
      <p>{hi?'ये हमारी प्लेटफ़ॉर्म जाँचें हैं। आपको कुछ और अपलोड करने की ज़रूरत नहीं है।':'These are platform checks. You do not need to upload anything else.'}</p>
      {result.checks.failures.length>0?<><strong>{hi?'जो जाँच पास नहीं हुईं':'Checks that did not pass'}</strong>
        <ul>{result.checks.failures.map(code=><li key={code}>{qualificationCheckLabel(code,language)}</li>)}</ul></>:null}
      {result.checks.inconclusive.length>0?<><strong>{hi?'जिन जाँचों के नतीजे बाकी हैं':'Checks awaiting results'}</strong>
        <ul>{result.checks.inconclusive.map(code=><li key={code}>{qualificationCheckLabel(code,language)}</li>)}</ul></>:null}
    </details>:null}
    {checked&&<button type="button" disabled={busy} onClick={()=>void request('qualify',true)}>{hi?'नतीजे जांचें':'Check results'}</button>}
    {!checked&&<button type="button" disabled={busy} onClick={()=>void request('qualification_status',true)}>{hi?'नतीजे की स्थिति देखें':'Read result status'}</button>}
    {error&&<p role="alert">{error}</p>}
  </div>;
}

export default function CandidateEvaluationLab({
  token,
  replicaId,
  candidateId,
  locale,
  stopped,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  candidateId?: string;
  locale?: 'en' | 'hi';
  stopped: boolean;
  onAuthError: (cause: unknown) => void;
}) {
  const urlLanguage=typeof window==='undefined'?null:new URLSearchParams(window.location.search).get('lang');
  const language=locale??resolveStudioLocale({urlLocale:urlLanguage==='hi'||urlLanguage==='en'?urlLanguage:null,replica:null,rememberedLocale:readRememberedStudioLocale()});
  const textCopy=TEXT_COMPARISON_COPY[language];
  const titleId = useId();
  const [evaluation, setEvaluation] = useState<CandidateEvaluation | null>(null);
  const [ratings, setRatings] = useState<Partial<Record<CandidateEvalDimension, CandidateEvalChoice>>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [activationRevision,setActivationRevision]=useState(0);
  const refreshActivation=useCallback(()=>setActivationRevision(value=>value+1),[]);
  const identity=JSON.stringify([token,replicaId,candidateId,stopped]),latestIdentity=useRef(identity);latestIdentity.current=identity;
  const [evaluationIdentity,setEvaluationIdentity]=useState(identity);
  const loadController=useRef<AbortController|null>(null),voteController=useRef<AbortController|null>(null);
  const requestEpoch=useRef(0),auth=useRef(onAuthError);auth.current=onAuthError;

  const load = useCallback(async () => {
    if (stopped) return;
    loadController.current?.abort();
    const controller=new AbortController(),run=++requestEpoch.current,requestIdentity=identity;
    loadController.current=controller;
    const current=()=>requestEpoch.current===run&&latestIdentity.current===requestIdentity;
    const timer=setTimeout(()=>controller.abort(),20_000);
    setLoading(true);
    setError("");
    try {
      const next = await getCandidateEvaluation(token, replicaId, candidateId,controller.signal);
      if(!current()||controller.signal.aborted)return;
      setEvaluation(next);
      setEvaluationIdentity(requestIdentity);
      setRatings({});
    } catch (cause) {
      if(!current())return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return auth.current(cause);
      setError(loadError(cause));
    } finally {
      clearTimeout(timer);if(current()){loadController.current=null;setLoading(false);}
    }
  }, [identity, replicaId, candidateId, stopped, token]);

  useEffect(() => { setBusy(false);void load();return()=>{requestEpoch.current++;loadController.current?.abort();voteController.current?.abort();voteController.current=null;}; }, [load]);

  async function submit() {
    const assignment = evaluation?.assignment;
    const dimensions = evaluation?.dimensions || [];
    if (stopped||evaluationIdentity!==identity||!assignment || dimensions.some((dimension) => !ratings[dimension]) || busy||voteController.current) return;
    const controller=new AbortController(),requestIdentity=identity;voteController.current=controller;
    const timer=setTimeout(()=>controller.abort(),20_000);
    const current=()=>latestIdentity.current===requestIdentity&&voteController.current===controller;
    setBusy(true);
    setError("");
    try {
      await judgeCandidateAssignment(
        token,
        replicaId,
        assignment.assignment_id,
        assignment.assignment_hash,
        Object.fromEntries(dimensions.map((dimension) => [dimension, ratings[dimension]])) as Record<CandidateEvalDimension, CandidateEvalChoice>,
        controller.signal,
      );
      if(current()&&!controller.signal.aborted)await load();
    } catch (cause) {
      if(!current())return;
      if (cause instanceof ReplicaApiError && cause.status === 401) return auth.current(cause);
      setError(loadError(cause));
    } finally {
      clearTimeout(timer);if(current()){voteController.current=null;setBusy(false);}
    }
  }

  const dimensions = evaluation?.dimensions || [];
  const answered = dimensions.filter((dimension) => ratings[dimension]).length;
  const progress = evaluation?.progress || { completed: 0, total: 0 };

  return (
    <section className="candidate-eval-lab" aria-labelledby={titleId}>
      <div className="candidate-eval-head">
        <div>
          <p className="eyebrow">Blind comparison</p>
          <h2 id={titleId}>{textCopy.title}</h2>
          <p>{textCopy.intro}</p>
        </div>
        <div className="candidate-eval-seal" aria-label="Evaluation blinding status">
          <strong>BLINDED</strong>
          <span>{textCopy.seal}</span>
        </div>
      </div>

      {loading||evaluationIdentity!==identity||stopped ? (
        <div className="candidate-eval-loading" role="status" aria-label="Loading blind evaluation">
          <span /><span /><span />
        </div>
      ) : error ? (
        <div className="candidate-eval-error" role="alert">
          <div><strong>Comparison unavailable</strong><p>{error}</p></div>
          <button type="button" onClick={() => void load()}>Try again</button>
        </div>
      ) : !evaluation?.available ? (
        <div className="candidate-eval-empty">
          <div className="candidate-eval-empty-mark" aria-hidden="true">A/B</div>
          <div>
            <strong>{textCopy.empty}</strong>
            <p>This opens only after a frozen test set and two encrypted model outputs exist for at least 30 comparisons.</p>
          </div>
        </div>
      ) : evaluation.state === "complete" || !evaluation.assignment ? (
        <div className="candidate-eval-complete" role="status">
          <span aria-hidden="true">✓</span>
          <div>
            <strong>Blind review complete</strong>
            <p>{textCopy.complete(progress.completed)}</p>
            {candidateId&&evaluation.state==='complete'&&progress.total>0&&progress.completed===progress.total&&<QualificationAction
              key={identity} token={token} replicaId={replicaId} candidateId={candidateId} language={language} onAuthError={onAuthError}
              onResultsChecked={refreshActivation}/>}
          </div>
        </div>
      ) : (
        <>
          <div className="candidate-eval-progress">
            <span>Comparison {evaluation.assignment.sequence} of {progress.total}</span>
            <strong>{progress.completed} sealed</strong>
          </div>

          <article className="candidate-eval-context">
            <span>Situation</span>
            <p>{evaluation.assignment.context}</p>
          </article>

          <div className="candidate-eval-options" aria-label="Anonymous response options">
            <article>
              <header><span>A</span><small>Anonymous output</small></header>
              <p>{evaluation.assignment.option_a}</p>
            </article>
            <div className="candidate-eval-versus" aria-hidden="true">OR</div>
            <article>
              <header><span>B</span><small>Anonymous output</small></header>
              <p>{evaluation.assignment.option_b}</p>
            </article>
          </div>

          <form className="candidate-eval-form" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
            <div className="candidate-eval-instruction">
              <strong>Judge every layer</strong>
              <span>Choose based on this situation only. A tie is useful evidence.</span>
            </div>
            <div className="candidate-eval-dimensions">
              {dimensions.map((dimension) => {
                const copy = DIMENSION_COPY[dimension];
                return (
                  <fieldset key={dimension}>
                    <legend><strong>{copy.label}</strong><span>{copy.hint}</span></legend>
                    <div>
                      {CHOICES.map((choice) => (
                        <button
                          key={choice.value}
                          className={ratings[dimension] === choice.value ? "selected" : ""}
                          type="button"
                          aria-pressed={ratings[dimension] === choice.value}
                          onClick={() => setRatings((current) => ({ ...current, [dimension]: choice.value }))}
                        >
                          {choice.label}
                        </button>
                      ))}
                    </div>
                  </fieldset>
                );
              })}
            </div>
            <div className="candidate-eval-submit">
              <span>{answered} of {dimensions.length} layers judged</span>
              <button className="button primary-button" type="submit" disabled={busy || answered !== dimensions.length}>
                {busy ? "Sealing comparison..." : "Seal and continue"}
              </button>
            </div>
          </form>
        </>
      )}
      {candidateId && !loading && !error && !stopped && evaluationIdentity === identity && evaluation?.available
        && evaluation.state === 'complete' && progress.total > 0 && progress.completed === progress.total &&
        <CandidateActivationAction key={identity} token={token} replicaId={replicaId}
          candidateId={candidateId} stopped={stopped} statusRevision={activationRevision} locale={language} onAuthError={onAuthError}/>}
    </section>
  );
}
