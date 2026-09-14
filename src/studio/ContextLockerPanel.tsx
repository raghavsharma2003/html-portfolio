// The Context step (Gurukul WS-AB) — "bring your context".
//
// Drop in the files and paste the links that are about you, and watch each one
// answer for itself. This is the surface for the horizontal platform: not a
// teacher uploading lectures, anyone handing over the material that makes them
// them.
//
// ── the screen's one job is to never lie about an item ───────────────────
// Every item shows exactly one of five states, and four of them carry a
// reason:
//
//   mined        private suggested phrases, available to inspect
//   read         we read it, and it produced nothing — here is why
//   refused      we will not pretend to have read this — here is why
//   routed       it belongs to another step — here is which
//   working      in flight
//
// There is no sixth state and there is deliberately no quiet success. An item
// that sat in a list looking fine while contributing nothing is the failure
// this whole lane is built against (`plausible-return-hides-a-dead-pipeline`),
// and the server refuses to store an item without a reason for exactly the same
// purpose — the CHECK constraints in migration 058 make the blank state
// unrepresentable, and this component makes it unrenderable.
//
// ── the two questions the screen asks back ───────────────────────────────
// 1. "Is this your own writing?" A document nobody has claimed mines nothing.
//    We could guess. Guessing wrong puts somebody else's sentences in the
//    owner's clone, and there is no version of that which is a small error.
// 2. "Which one of these people are you?" A chat export names its senders and
//    only the owner's turns are ever mined. Both questions are asked AFTER the
//    file is read, because neither is knowable from a filename.
//
// ── copy is mapped, never swallowed ──────────────────────────────────────
// `REASON_COPY` renders a server code in plain language; a code it does not
// know renders the CODE. IngestChannelStudio.tsx makes the same choice for the
// same reason: a list that quietly drops the one row it did not recognise is
// how a person learns nothing from the screen that exists to tell them.
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useId, useMemo, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  addContextFiles,
  addContextLinks,
  fileToBase64,
  loadContextLocker,
  remineContextItem,
  removeContextItem,
} from "./contextLockerApi";
import type {
  ContextAddResult,
  ContextItem,
  ContextLockerView,
  ContextSpeaker,
} from "./contextLockerApi";
import { useStudioLocale } from "./localeContext";
import type { ContextLockerPanelCopy } from "./copy";
const ContextProposalReview = lazy(() => import("./ContextProposalReview"));

// An explicit action may replace its focused control. Recover only that lost
// focus; later input/focus movement permanently cancels this one-shot intent.
function useActionFocus() {
  type Intent = { origin: HTMLElement; target?: () => HTMLElement | null; dispose: () => void };
  const pending = useRef<Intent | null>(null);
  const cancel = () => { pending.current?.dispose(); pending.current = null; };
  useEffect(() => cancel, []);
  useLayoutEffect(() => {
    const intent = pending.current;
    if (!intent?.target) return;
    cancel();
    if (document.activeElement === document.body && (!intent.origin.isConnected || intent.origin.matches(":disabled"))) {
      const target = intent.target();
      if (target?.isConnected) target.focus();
    }
  });
  return (container: HTMLElement) => {
    cancel();
    const origin = document.activeElement;
    if (!(origin instanceof HTMLElement) || !container.contains(origin)) return { finish: (_target: () => HTMLElement | null) => {}, cancel: () => {} };
    const moved = () => cancel();
    const focused = (event: FocusEvent) => { if (event.target !== origin && event.target !== document.body) cancel(); };
    const intent: Intent = { origin, dispose: () => {
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
    return { finish: (target: () => HTMLElement | null) => { if (pending.current === intent) intent.target = target; }, cancel: () => { if (pending.current === intent) cancel(); } };
  };
}

// WS-R166: the reason map moved to the copy registry
// (`src/studio/copy.ts#ContextLockerPanelCopy.reasons`,
// `context/decisions.md#ws-r159-tier-1-scope-and-tier-2-allowlist`'s own
// allowlist, closed one file at a time) so both locales carry it; `copyFor`
// now takes that map as a parameter rather than closing over a module-level
// English-only constant.
const copyFor = (code: string, reasons: Record<string, string>) => reasons[code] ?? code;

const KB = 1024;
const humanBytes = (n: number) =>
  n >= KB * KB ? `${(n / (KB * KB)).toFixed(1)} MB` : n >= KB ? `${Math.round(n / KB)} KB` : `${n} bytes`;

type Row = {
  key: string;
  item: ContextItem | null;
  /** Chat exports only, and only on the add that discovered them. */
  speakers?: ContextSpeaker[] | null;
  proposed?: number;
  error?: string;
  label: string;
};

const rowFrom = (result: ContextAddResult, fallbackLabel: string): Row => ({
  key: result.item?.item_id ?? `err:${fallbackLabel}:${Math.random().toString(36).slice(2)}`,
  item: result.item,
  speakers: result.speakers ?? null,
  proposed: result.proposal?.proposed,
  error: result.error,
  label: result.item?.source_name || result.item?.source_url || result.source_name || fallbackLabel,
});

type ContextLockerPanelProps = {
  token: string;
  replicaId: string;
  testEnvironment?: boolean;
  onAuthError?: (error: ReplicaApiError) => void;
  onProposals?: (count: number) => void;
  onItemCount?: (count: number) => void;
  onPrivateTextItemCount?: (count: number) => void;
  onTeachSource?: (source: { replicaId: string; itemId: string }) => void;
  teachSourceLabel?: string;
  onTestSource?: (source: { replicaId: string; itemId: string }) => void;
  testSourceLabel?: string;
};

export default function ContextLockerPanel(props: ContextLockerPanelProps) {
  const scope = useRef({ token: props.token, replicaId: props.replicaId, generation: 0 });
  if (scope.current.token !== props.token || scope.current.replicaId !== props.replicaId) {
    scope.current = { token: props.token, replicaId: props.replicaId, generation: scope.current.generation + 1 };
  }
  // Old requests may finish, but cannot retain the former owner's rows or
  // callbacks when the authenticated scope changes.
  return <ContextLockerScope key={scope.current.generation} {...props} />;
}

function ContextLockerScope({
  token,
  replicaId,
  testEnvironment = false,
  onAuthError,
  onProposals,
  onItemCount,
  onPrivateTextItemCount,
  onTeachSource,
  teachSourceLabel,
  onTestSource,
  testSourceLabel,
}: {
  token: string;
  replicaId: string;
  testEnvironment?: boolean;
  onAuthError?: (error: ReplicaApiError) => void;
  /** Called with the number of new proposals so the host can nudge the owner
   *  toward the existing sheet-review surface. The panel deliberately does not
   *  navigate on its own — a screen that jumps while a batch is still uploading
   *  loses the rest of the batch's answers. */
  onProposals?: (count: number) => void;
  /** Called with the number of items in the locker after every load. The step
   *  rail needs to know whether this owner has brought ANY material, and this
   *  panel is the only thing that asks the server. Reporting it up is cheaper
   *  and more honest than a second fetch that could disagree with this one. */
  onItemCount?: (count: number) => void;
  /** Reports only owner-authored, extracted text that the private rehearsal
   *  can offer. The rehearsal server still validates its source receipt and
   *  canonical evidence before enabling a question. */
  onPrivateTextItemCount?: (count: number) => void;
  onTeachSource?: (source: { replicaId: string; itemId: string }) => void;
  teachSourceLabel?: string;
  onTestSource?: (source: { replicaId: string; itemId: string }) => void;
  testSourceLabel?: string;
}) {
  const { t } = useStudioLocale();
  const copy = t.contextLockerPanel;
  const resolvedTeachSourceLabel = teachSourceLabel ?? copy.teachYourAi;
  const resolvedTestSourceLabel = testSourceLabel ?? copy.testThisSource;
  const [view, setView] = useState<ContextLockerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [links, setLinks] = useState("");
  const [acknowledged, setAcknowledged] = useState(testEnvironment);
  const [recent, setRecent] = useState<Row[]>([]);
  const mounted = useRef(false);
  const loadGeneration = useRef(0);
  const reminePending = useRef(false);
  const actionFocus = useActionFocus();
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; loadGeneration.current += 1; };
  }, []);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [reviewItem, setReviewItem] = useState<{ replicaId: string; itemId: string } | null>(null);
  const reviewRegionId = useId();
  const reviewTrigger = useRef<HTMLButtonElement | null>(null);
  const lockerHeading = useRef<HTMLHeadingElement | null>(null);
  const openItemId = reviewItem?.replicaId === replicaId ? reviewItem.itemId : null;
  const closeReview = () => {
    setReviewItem(null);
    (reviewTrigger.current?.isConnected ? reviewTrigger.current : lockerHeading.current)?.focus();
  };
  const reviewButton = (item: ContextItem) => item.status === "mined" ? <button
    type="button" className="button" disabled={busy}
    aria-expanded={openItemId === item.item_id} aria-controls={reviewRegionId}
    onClick={event => {
      reviewTrigger.current = event.currentTarget;
      if (openItemId === item.item_id) closeReview();
      else setReviewItem({ replicaId, itemId: item.item_id });
    }}>{copy.viewPhrases}</button> : null;

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ReplicaApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return;
      }
      setError(e instanceof Error ? e.message : copy.errorFallback);
    },
    [onAuthError, copy.errorFallback],
  );

  const load = useCallback(async () => {
    if (!mounted.current) return;
    const generation = ++loadGeneration.current;
    setLoading(true);
    try {
      const next = await loadContextLocker(token, replicaId);
      if (!mounted.current || generation !== loadGeneration.current) return;
      if (!next
        || !Array.isArray(next.items)
        || !next.quota
        || !next.limits
        || !Number.isFinite(next.limits.max_item_bytes)
        || !Array.isArray(next.limits.accepted_file_formats)) {
        throw new Error("context_locker_response_invalid");
      }
      setView(next);
      onItemCount?.(next.items.length);
      onPrivateTextItemCount?.(next.items.filter(isTeachableContextSource).length);
      setError("");
      return true;
    } catch (e) {
      if (mounted.current && generation === loadGeneration.current) fail(e);
    } finally {
      if (mounted.current && generation === loadGeneration.current) setLoading(false);
    }
  }, [token, replicaId, fail, onItemCount, onPrivateTextItemCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (files: File[]) => {
      if (!files.length || !mounted.current) return;
      setBusy(true);
      setError("");
      try {
        const payload = await Promise.all(
          files.map(async (file) => ({
            filename: file.name,
            content_base64: await fileToBase64(file),
            third_party_acknowledged: acknowledged,
          })),
        );
        if (!mounted.current) return;
        const results = await addContextFiles(token, replicaId, payload);
        if (!mounted.current) return;
        const rows = results.map((result, i) => rowFrom(result, files[i]?.name ?? "file"));
        setRecent(rows);
        onProposals?.(rows.reduce((n, row) => n + (row.proposed ?? 0), 0));
        await load();
      } catch (e) {
        if (mounted.current) fail(e);
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [token, replicaId, acknowledged, load, fail, onProposals],
  );

  const sendLinks = useCallback(async () => {
    const urls = links.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    if (!urls.length) return;
    setBusy(true);
    setError("");
    try {
      const results = await addContextLinks(token, replicaId, urls);
      if (!mounted.current) return;
      setRecent(results.map((result, i) => rowFrom(result, urls[i] ?? "link")));
      setLinks("");
      await load();
    } catch (e) {
      if (mounted.current) fail(e);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [token, replicaId, links, load, fail]);

  const remine = useCallback(
    async (itemId: string, options: { authorship?: "mine" | "not_mine"; owner_speaker?: string }, trigger?: HTMLButtonElement) => {
      if (!mounted.current || reminePending.current || busy) return;
      const focus = trigger ? actionFocus(trigger) : null;
      let focusQueued = false;
      reminePending.current = true;
      setBusy(true);
      setError("");
      try {
        const result = await remineContextItem(token, replicaId, itemId, options);
        if (!mounted.current) return;
        if (!result?.item || result.item.item_id !== itemId) throw new Error("context_locker_response_invalid");
        onProposals?.(result.proposal?.proposed ?? 0);
        setRecent((rows) =>
          rows.map((row) => (row.item?.item_id === itemId
            ? { ...row, item: result.item ?? row.item, proposed: result.proposal?.proposed }
            : row)),
        );
        if (await load() && mounted.current) {
          focus?.finish(() => Array.from(lockerHeading.current?.parentElement?.querySelectorAll<HTMLButtonElement>("[data-test-source]") || []).find(button => button.dataset.testSource === itemId && !button.disabled) || lockerHeading.current);
          focusQueued = true;
        }
      } catch (e) {
        if (mounted.current) fail(e);
      } finally {
        if (!focusQueued) focus?.cancel();
        reminePending.current = false;
        if (mounted.current) setBusy(false);
      }
    },
    [token, replicaId, load, fail, onProposals, busy],
  );

  const attributionControls = (item: ContextItem) => item.kind === "file"
    && item.status === "extracted" && item.extracted_chars > 0
    && item.consent_scope === "own_context"
    && ["text", "markdown", "pdf", "docx"].includes(item.format) ? (
      <span className="context-result-actions" role="group" aria-label={copy.writingAttributionAriaLabel}>
        <button type="button" className="button" disabled={busy || item.authorship === "mine"}
          aria-pressed={item.authorship === "mine"}
          onClick={event => void remine(item.item_id, { authorship: "mine" }, event.currentTarget)}>{copy.myWriting}</button>
        <button type="button" className="button" disabled={busy || item.authorship === "not_mine"}
          aria-pressed={item.authorship === "not_mine"}
          onClick={event => void remine(item.item_id, { authorship: "not_mine" }, event.currentTarget)}>{copy.referenceOnly}</button>
      </span>
    ) : null;

  const drop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setDragging(false);
      void send(Array.from(event.dataTransfer?.files ?? []));
    },
    [send],
  );

  const items = view?.items ?? [];
  const quota = view?.quota;
  const teachableSource = recent.map((row) => row.item).find(isTeachableContextSource)
    ?? items.find(isTeachableContextSource);
  const speakersById = useMemo(() => {
    const map = new Map<string, ContextSpeaker[]>();
    for (const row of recent) if (row.item && row.speakers?.length) map.set(row.item.item_id, row.speakers);
    return map;
  }, [recent]);

  // `id` matches the anchor `wizardModel.ts`'s `no_material` blocker already
  // carries (`#context-locker`), so "Go there" actually lands somewhere
  // instead of `jumpTo` silently finding nothing.
  return (
    <section id="context-locker" className="stage-section context-locker" aria-labelledby="context-locker-title">
      <header className="section-heading">
        <div>
          <h2 id="context-locker-title">{copy.heading}</h2>
          <p className="field-note">
            {copy.intro}
          </p>
        </div>
      </header>

      {error && (
        <p className="field-note context-locker-error" role="alert">{copyFor(error.replaceAll(" ", "_"), copy.reasons)}</p>
      )}

      <div
        className={`context-dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <p className="context-dropzone-title">{copy.dropzoneTitle}</p>
        <p className="field-note">
          {copy.dropzoneBodyTemplate.replace("{size}", view ? humanBytes(view.limits.max_item_bytes) : copy.fewMb)}
        </p>
        <button
          type="button"
          className="button primary-button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? copy.reading : copy.chooseFiles}
        </button>
        <input
          ref={fileInput}
          type="file"
          accept=".txt,.text,.log,.md,.markdown,.pdf,.docx,.png,.jpg,.jpeg,.webp,text/plain,text/markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,image/webp"
          multiple
          className="context-file-input"
          onChange={(event) => {
            void send(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
      </div>

      {!testEnvironment && <label className="model-consent-check context-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>
          {copy.chatConsentNote}
        </span>
      </label>}

      <label className="field">
        <span>{copy.pasteLinksLabel}</span>
        <textarea
          rows={3}
          value={links}
          placeholder={copy.linksPlaceholder}
          onChange={(event) => setLinks(event.target.value)}
        />
      </label>
      <button type="button" className="button" disabled={busy || !links.trim()} onClick={() => void sendLinks()}>
        {copy.addLinks}
      </button>

      {recent.length > 0 && (
        <ul className="context-results" aria-live="polite">
          {recent.map((row) => (
            <li key={row.key} className={`context-result is-${row.item?.status ?? "error"}`}>
              <span className="context-result-name">{row.label}</span>
              <span className="context-result-state">{stateLabel(row, copy)}</span>
              <span className="field-note">{stateDetail(row, copy)}</span>
              {row.item && reviewButton(row.item)}

              {row.item && row.item.status === "extracted"
                && row.item.mine_skip_reason === "speaker_unattributed_no_style_evidence"
                && (speakersById.get(row.item.item_id)?.length ?? 0) > 0 && (
                <span className="context-result-actions">
                  {speakersById.get(row.item.item_id)!.map((speaker) => (
                    <button
                      key={speaker.name}
                      type="button"
                      className="button"
                      disabled={busy}
                      onClick={() => void remine(row.item!.item_id, { owner_speaker: speaker.name })}
                    >
                      {copy.iAmSpeakerTemplate.replace("{name}", speaker.name).replace("{count}", String(speaker.messages))}
                    </button>
                  ))}
                </span>
              )}

              {row.item && attributionControls(row.item)}
            </li>
          ))}
        </ul>
      )}

      {onTeachSource && teachableSource ? (
        <div className="context-result-actions">
          <button type="button" className="button primary-button" data-teach-source={teachableSource.item_id}
            disabled={busy || loading} onClick={() => {
              if (mounted.current && !busy && !loading) onTeachSource({ replicaId, itemId: teachableSource.item_id });
            }}>{resolvedTeachSourceLabel}</button>
        </div>
      ) : null}

      {openItemId && <Suspense fallback={<p role="status">{copy.openingPhrases}</p>}>
        <ContextProposalReview key={`${replicaId}:${openItemId}`} token={token} replicaId={replicaId}
          itemId={openItemId} regionId={reviewRegionId} onClose={closeReview} onAuthError={onAuthError} />
      </Suspense>}

      <h3 ref={lockerHeading} tabIndex={-1} className="context-list-title">{copy.inYourLocker}</h3>
      {loading && !view ? (
        <p className="field-note" role="status">{copy.loadingEllipsis}</p>
      ) : items.length === 0 ? (
        <p className="field-note">{copy.nothingYet}</p>
      ) : (
        <ul className="context-results">
          {items.map((item) => (
            <li key={item.item_id} className={`context-result is-${item.status}`}>
              <span className="context-result-name">{item.source_name || item.source_url}</span>
              <span className="context-result-state">{stateLabel({ key: item.item_id, item, label: "" }, copy)}</span>
              <span className="field-note">
                {item.format} · {item.extracted_chars ? copy.charactersTemplate.replace("{n}", item.extracted_chars.toLocaleString()) : humanBytes(item.byte_size)}
                {item.owner_speaker ? ` · ${copy.yourMessagesAsTemplate.replace("{name}", item.owner_speaker)}` : ""}
              </span>
              <span className="field-note">{stateDetail({ key: item.item_id, item, label: "" }, copy)}</span>
              {attributionControls(item)}
              <span className="context-result-actions">
                {onTestSource && item.kind === "file" && ["extracted", "mined"].includes(item.status) && item.extracted_chars > 0
                  && item.consent_scope === "own_context" && item.authorship === "mine"
                  && ["text", "markdown", "pdf", "docx"].includes(item.format) ?
                  <button type="button" className="button" data-test-source={item.item_id} disabled={busy || loading} onClick={() => {
                    if (mounted.current && !busy && !loading) onTestSource({ replicaId, itemId: item.item_id });
                  }}>{resolvedTestSourceLabel}</button> : null}
                {reviewButton(item)}
                <button
                  type="button"
                  className="button destructive-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    if (openItemId === item.item_id) setReviewItem(null);
                    void removeContextItem(token, replicaId, item.item_id)
                      .then(async () => {
                        if (!mounted.current) return;
                        setRecent(rows => rows.filter(row => row.item?.item_id !== item.item_id));
                        await load();
                        if (mounted.current) lockerHeading.current?.focus();
                      })
                      .catch(error => { if (mounted.current) fail(error); })
                      .finally(() => { if (mounted.current) setBusy(false); });
                  }}
                >
                  {copy.remove}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {quota && (
        <p className="field-note">
          {copy.quotaTemplate
            .replace("{items}", String(quota.items))
            .replace("{maxItems}", String(quota.max_items))
            .replace("{bytes}", humanBytes(quota.bytes))
            .replace("{maxBytes}", humanBytes(quota.max_bytes))}
        </p>
      )}
    </section>
  );
}

export function isTeachableContextSource(item: ContextItem | null | undefined): item is ContextItem {
  return !!item && item.kind === "file" && ["extracted", "mined"].includes(item.status)
    && item.extracted_chars > 0 && item.consent_scope === "own_context" && item.authorship === "mine"
    && ["text", "markdown", "pdf", "docx"].includes(item.format);
}

/** The five states, and nothing else. */
function stateLabel(row: Row, copy: ContextLockerPanelCopy): string {
  if (!row.item) return copy.states.notAdded;
  if (row.item.status === "mined") {
    return row.proposed
      ? (row.proposed === 1 ? copy.states.suggestionSingularTemplate : copy.states.suggestionPluralTemplate).replace("{n}", String(row.proposed))
      : copy.states.suggestionsSaved;
  }
  if (row.item.status === "refused") return copy.states.notRead;
  if (row.item.status === "routed") return copy.states.belongsElsewhere;
  if (row.item.status === "extracted") return copy.states.read;
  return copy.states.working;
}

/** Every state carries its reason. `copyFor` falls back to the raw code rather
 *  than to silence, so an unmapped server code is visible instead of missing. */
function stateDetail(row: Row, copy: ContextLockerPanelCopy): string {
  if (!row.item) return copyFor(row.error || "request_failed", copy.reasons);
  if (row.item.status === "refused") return copyFor(row.item.refusal_reason, copy.reasons);
  if (row.item.status === "routed") return copyFor(row.item.routed_to, copy.reasons);
  if (row.item.status === "mined") return copy.phraseSuggestionsSavedPrivately;
  if (row.item.status === "extracted") return copyFor(row.item.mine_skip_reason || "no_candidates_cleared_held_out", copy.reasons);
  return "";
}
