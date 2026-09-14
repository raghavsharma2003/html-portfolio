import "./sources-studio.css";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useStudioLocale } from "./localeContext";
import {
  listSourceOverview,
  previewSourceRemoval,
  removeOverviewSource,
  type SourceOverview,
  type SourceRemovalImpact,
  type SourceRemovalReceipt,
} from "./sourcesApi";

export interface SourcesStudioApi {
  list: typeof listSourceOverview;
  previewRemoval: typeof previewSourceRemoval;
  remove: typeof removeOverviewSource;
}

interface SourcesStudioProps {
  token: string;
  replicaId: string;
  onSourcesChanged?: () => void | Promise<void>;
  api?: SourcesStudioApi;
}

const DEFAULT_API: SourcesStudioApi = {
  list: listSourceOverview,
  previewRemoval: previewSourceRemoval,
  remove: removeOverviewSource,
};

function interpolate(template: string, values: Record<string, string | number>) {
  return Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, String(value)), template);
}

export default function SourcesStudio({ token, replicaId, onSourcesChanged, api = DEFAULT_API }: SourcesStudioProps) {
  const { locale, t } = useStudioLocale();
  const copy = t.sourcesStudio;
  const [sources, setSources] = useState<SourceOverview[]>([]);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [selected, setSelected] = useState<SourceOverview | null>(null);
  const [impact, setImpact] = useState<SourceRemovalImpact | null>(null);
  const [impactState, setImpactState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [confirmation, setConfirmation] = useState("");
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState(false);
  const [receipt, setReceipt] = useState<SourceRemovalReceipt | null>(null);
  const dialogTitleId = useId();
  const dialogDescriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const mountedRef = useRef(false);
  const scopeRef = useRef("");
  const listRequestRef = useRef(0);
  const impactRequestRef = useRef(0);
  const removalRequestRef = useRef(0);
  const removalLockRef = useRef(false);
  const scopeKey = `${token}\n${replicaId}`;

  useLayoutEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      listRequestRef.current += 1;
      impactRequestRef.current += 1;
      removalRequestRef.current += 1;
      removalLockRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    scopeRef.current = scopeKey;
    listRequestRef.current += 1;
    impactRequestRef.current += 1;
    removalRequestRef.current += 1;
    removalLockRef.current = false;
    setSources([]);
    setLoadState("loading");
    setSelected(null);
    setImpact(null);
    setImpactState("idle");
    setConfirmation("");
    setRemoving(false);
    setRemoveError(false);
    setReceipt(null);
    returnFocusRef.current = null;
  }, [scopeKey]);

  const load = useCallback(async () => {
    const request = ++listRequestRef.current;
    const requestScope = scopeKey;
    setLoadState("loading");
    try {
      const nextSources = await api.list(token, replicaId);
      if (!mountedRef.current || scopeRef.current !== requestScope || listRequestRef.current !== request) return;
      setSources(nextSources);
      setLoadState("ready");
    } catch {
      if (!mountedRef.current || scopeRef.current !== requestScope || listRequestRef.current !== request) return;
      setLoadState("error");
    }
  }, [api, replicaId, scopeKey, token]);

  useEffect(() => { void load(); }, [load]);

  const loadImpact = useCallback(async (source: SourceOverview) => {
    const request = ++impactRequestRef.current;
    const requestScope = scopeKey;
    setImpact(null);
    setImpactState("loading");
    try {
      const nextImpact = await api.previewRemoval(token, replicaId, source.source_id);
      if (!mountedRef.current || scopeRef.current !== requestScope || impactRequestRef.current !== request) return;
      setImpact(nextImpact);
      setImpactState("ready");
    } catch {
      if (!mountedRef.current || scopeRef.current !== requestScope || impactRequestRef.current !== request) return;
      setImpactState("error");
    }
  }, [api, replicaId, scopeKey, token]);

  function openRemoval(source: SourceOverview) {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelected(source);
    setConfirmation("");
    setRemoveError(false);
    setReceipt(null);
    void loadImpact(source);
  }

  const closeRemoval = useCallback(() => {
    if (removing) return;
    impactRequestRef.current += 1;
    setSelected(null);
    setImpact(null);
    setImpactState("idle");
    setConfirmation("");
    requestAnimationFrame(() => returnFocusRef.current?.focus());
  }, [removing]);

  useEffect(() => {
    if (!selected) return;
    const node = dialogRef.current;
    const focusable = () => Array.from(node?.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ) || []);
    requestAnimationFrame(() => focusable()[0]?.focus());
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRemoval();
        return;
      }
      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [closeRemoval, selected]);

  async function confirmRemoval() {
    if (removalLockRef.current || !selected || !impact || impactState !== "ready" || confirmation !== copy.confirmWord) return;
    removalLockRef.current = true;
    const request = ++removalRequestRef.current;
    const requestScope = scopeKey;
    const removedSource = selected;
    const requestIsCurrent = () => mountedRef.current && scopeRef.current === requestScope
      && removalRequestRef.current === request;
    setRemoving(true);
    setRemoveError(false);
    try {
      const nextReceipt = await api.remove(token, replicaId, removedSource);
      if (!requestIsCurrent()) return;
      setSources((current) => current.filter((source) => source.source_id !== removedSource.source_id));
      setReceipt(nextReceipt);
      setSelected(null);
      setImpact(null);
      setImpactState("idle");
      setConfirmation("");
      if (onSourcesChanged) await onSourcesChanged();
      if (!requestIsCurrent()) return;
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      if (!requestIsCurrent()) return;
      setRemoveError(true);
    } finally {
      if (removalRequestRef.current === request) {
        removalLockRef.current = false;
        if (mountedRef.current && scopeRef.current === requestScope) setRemoving(false);
      }
    }
  }

  const count = sources.length === 1 ? copy.countOne : interpolate(copy.countManyTemplate, { count: sources.length });

  return (
    <section className="sources-studio" aria-labelledby="sources-studio-title">
      <header className="sources-studio__header">
        <div>
          <h1 id="sources-studio-title" ref={headingRef} tabIndex={-1}>{copy.title}</h1>
          <p>{copy.intro}</p>
        </div>
        {loadState === "ready" ? <span className="sources-studio__count">{count}</span> : null}
      </header>

      <div className="sources-studio__receipt" aria-live="polite" aria-atomic="true">
        {receipt ? (
          <p>
            {receipt.erasure === "complete" ? copy.removedComplete : copy.removedPending}
            {receipt.rebuild_required ? ` ${copy.rebuildRequired}` : ""}
          </p>
        ) : null}
      </div>

      {loadState === "loading" ? (
        <div className="sources-ledger sources-ledger--loading" role="status" aria-label={copy.loading}>
          <span className="sr-only">{copy.loading}</span>
          {[0, 1, 2].map((row) => <div className="sources-row sources-row--skeleton" aria-hidden="true" key={row}><i /><i /><i /></div>)}
        </div>
      ) : null}

      {loadState === "error" ? (
        <div className="sources-studio__state" role="alert">
          <p>{copy.loadError}</p>
          <button type="button" className="sources-studio__secondary" onClick={() => void load()}>{copy.retry}</button>
        </div>
      ) : null}

      {loadState === "ready" && sources.length === 0 ? (
        <div className="sources-studio__state">
          <h2>{copy.emptyTitle}</h2>
          <p>{copy.emptyBody}</p>
        </div>
      ) : null}

      {loadState === "ready" && sources.length > 0 ? (
        <div className="sources-ledger">
          {sources.map((source) => {
            const sourceDate = new Date(source.created_at);
            const date = Number.isNaN(sourceDate.getTime()) ? "" : new Intl.DateTimeFormat(locale, {
              day: "numeric", month: "short", year: "numeric",
            }).format(sourceDate);
            const state = copy.states[source.state] || copy.statusUnavailable;
            const detail = source.state_detail_code
              ? source.context_item_id
                ? t.contextLockerPanel.reasons[source.state_detail_code]
                  || interpolate(copy.detailCodeTemplate, { code: source.state_detail_code })
                : interpolate(copy.detailCodeTemplate, { code: source.state_detail_code })
              : "";
            const name = source.display_name || copy.unnamed[source.kind];
            const voiceTime = formatTime(source.yield.voice_seconds, copy.secondsTemplate, copy.minutesTemplate);
            const hasYield = source.yield.claims_approved > 0 || source.yield.claims_proposed > 0 || source.yield.voice_seconds > 0;
            return (
              <article className="sources-row" key={source.source_id}>
                <div className="sources-row__identity">
                  <span className={`sources-row__kind sources-row__kind--${source.kind}`}>{copy.kind[source.kind]}</span>
                  <h2 title={name}>{name}</h2>
                  {date ? <p>{interpolate(copy.addedOnTemplate, { date })}</p> : null}
                  {source.contains_third_parties ? <p className="sources-row__declaration">{copy.thirdPartyDeclaration}</p> : null}
                </div>
                <div className="sources-row__status">
                  <span className={`sources-row__status-chip sources-row__status-chip--${statusTone(source.state)}`}>{state}</span>
                  {detail ? <p>{detail}</p> : null}
                </div>
                <dl className="sources-row__yield">
                  {source.yield.claims_approved > 0 ? <><dt>{copy.acceptedDetails}</dt><dd>{source.yield.claims_approved}</dd></> : null}
                  {source.yield.claims_proposed > 0 ? <><dt>{copy.draftDetails}</dt><dd>{source.yield.claims_proposed}</dd></> : null}
                  {source.yield.voice_seconds > 0 ? <><dt>{copy.voiceTime}</dt><dd>{voiceTime}</dd></> : null}
                  {!hasYield ? <><dt className="sr-only">{copy.acceptedDetails}</dt><dd className="sources-row__no-yield">{copy.noYield}</dd></> : null}
                </dl>
                <button type="button" className="sources-row__remove" onClick={() => openRemoval(source)}>{copy.remove}</button>
              </article>
            );
          })}
        </div>
      ) : null}

      {selected ? (
        <div className="sources-dialog__backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeRemoval(); }}>
          <div className="sources-dialog" role="dialog" aria-modal="true" aria-labelledby={dialogTitleId} aria-describedby={dialogDescriptionId} ref={dialogRef}>
            <div className="sources-dialog__handle" aria-hidden="true" />
            <p className="sources-dialog__kind">{copy.kind[selected.kind]}</p>
            <h2 id={dialogTitleId}>{copy.dialogTitle}</h2>
            <p id={dialogDescriptionId}>{copy.dialogBody}</p>

            {impactState === "loading" ? <p className="sources-dialog__checking" role="status">{copy.impactLoading}</p> : null}
            {impactState === "error" ? (
              <div className="sources-dialog__error" role="alert">
                <p>{copy.impactError}</p>
                <button type="button" className="sources-studio__secondary" onClick={() => void loadImpact(selected)}>{copy.retry}</button>
              </div>
            ) : null}
            {impact ? (
              <div className="sources-dialog__impact">
                <ul>
                  <li>{interpolate(copy.impactAcceptedTemplate, { count: impact.claims_approved })}</li>
                  <li>{interpolate(copy.impactDraftTemplate, { count: impact.claims_proposed })}</li>
                  <li>{interpolate(copy.impactVoiceTemplate, { time: formatTime(impact.voice_seconds, copy.secondsTemplate, copy.minutesTemplate) })}</li>
                </ul>
                {impact.is_primary_voice ? <p className="sources-dialog__warning">{copy.primaryVoiceWarning}</p> : null}
                <label htmlFor={`${dialogTitleId}-confirmation`}>
                  {interpolate(copy.confirmInstructionTemplate, { word: copy.confirmWord })}
                </label>
                <input
                  id={`${dialogTitleId}-confirmation`}
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.currentTarget.value)}
                  autoComplete="off"
                  aria-label={copy.confirmLabel}
                />
              </div>
            ) : null}
            {removeError ? <p className="sources-dialog__remove-error" role="alert">{copy.removalError}</p> : null}
            <div className="sources-dialog__actions">
              <button type="button" className="sources-studio__secondary" onClick={closeRemoval} disabled={removing}>{copy.cancel}</button>
              <button
                type="button"
                className="sources-dialog__danger"
                onClick={() => void confirmRemoval()}
                disabled={removing || impactState !== "ready" || !impact || confirmation !== copy.confirmWord}
              >
                {removing ? copy.removing : copy.removeForever}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function formatTime(seconds: number, secondsTemplate: string, minutesTemplate: string) {
  if (seconds < 60) return interpolate(secondsTemplate, { count: seconds });
  return interpolate(minutesTemplate, { minutes: Math.floor(seconds / 60), seconds: seconds % 60 });
}

function statusTone(state: string) {
  if (["ready", "mined"].includes(state)) return "ready";
  if (["rejected", "refused"].includes(state)) return "stopped";
  if (["processing", "extracted", "routed", "quarantined"].includes(state)) return "active";
  return "quiet";
}
