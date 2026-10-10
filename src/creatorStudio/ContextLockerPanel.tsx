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
//   mined        N proposals waiting for you in Review
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
// `t.contextLockerPanel.reasons` renders a server code in plain language; a
// code it does not know renders the CODE. IngestChannelStudio.tsx makes the
// same choice for the same reason: a list that quietly drops the one row it
// did not recognise is how a person learns nothing from the screen that
// exists to tell them.
//
// ── WS-R82: the third-party checkbox is a control, not a ceremony ─────────
// The one consent-shaped checkbox this file carries ("if I upload a chat
// export...") was flagged by WS-R71 for a closer read before converting.
// Read closely, it is a single, conditional, feature-gating acknowledgement
// (third-party privacy for one specific upload path) — not a formal,
// multi-statement enrollment ceremony like `ModelConsentGate.tsx`'s six
// `STATEMENTS` or `EnrollmentWorkspace.tsx`'s four attestations. It is not
// named by exact wording in `scripts/roomsVocabAllowlist.mjs` the way those
// are, so no already-approved English wording is at stake. It is translated
// here as one unit with the rest of the screen, exactly as any other
// checkbox label on this file's other controls would be. See
// context/decisions.md#ws-r82-context-locker-checkbox-is-a-control-not-a-ceremony.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { withCount, withLabel, withNameAndCount } from "./copy";

const KB = 1024;

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

export default function ContextLockerPanel({
  token,
  replicaId,
  testEnvironment = false,
  onAuthError,
  onProposals,
  onItemCount,
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
}) {
  const { t } = useStudioLocale();
  const c = t.contextLockerPanel;
  const copyFor = useCallback((code: string) => c.reasons[code] ?? code, [c.reasons]);
  const humanBytes = useCallback(
    (n: number) =>
      n >= KB * KB ? withCount(c.bytesMB, Math.round((n / (KB * KB)) * 10) / 10)
        : n >= KB ? withCount(c.bytesKB, Math.round(n / KB))
          : withCount(c.bytesBytes, n),
    [c.bytesBytes, c.bytesKB, c.bytesMB],
  );

  const [view, setView] = useState<ContextLockerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [links, setLinks] = useState("");
  const [acknowledged, setAcknowledged] = useState(testEnvironment);
  const [recent, setRecent] = useState<Row[]>([]);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const fail = useCallback(
    (e: unknown) => {
      if (e instanceof ReplicaApiError && (e.status === 401 || e.status === 403)) {
        onAuthError?.(e);
        return;
      }
      setError(e instanceof Error ? e.message : "request failed");
    },
    [onAuthError],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadContextLocker(token, replicaId);
      setView(next);
      onItemCount?.(next.items.length);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [token, replicaId, fail, onItemCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (files: File[]) => {
      if (!files.length) return;
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
        const results = await addContextFiles(token, replicaId, payload);
        const rows = results.map((result, i) => rowFrom(result, files[i]?.name ?? "file"));
        setRecent(rows);
        onProposals?.(rows.reduce((n, row) => n + (row.proposed ?? 0), 0));
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
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
      setRecent(results.map((result, i) => rowFrom(result, urls[i] ?? "link")));
      setLinks("");
      await load();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }, [token, replicaId, links, load, fail]);

  const remine = useCallback(
    async (itemId: string, options: { authorship?: "mine" | "not_mine"; owner_speaker?: string }) => {
      setBusy(true);
      setError("");
      try {
        const result = await remineContextItem(token, replicaId, itemId, options);
        onProposals?.(result.proposal?.proposed ?? 0);
        setRecent((rows) =>
          rows.map((row) => (row.item?.item_id === itemId
            ? { ...row, item: result.item ?? row.item, proposed: result.proposal?.proposed }
            : row)),
        );
        await load();
      } catch (e) {
        fail(e);
      } finally {
        setBusy(false);
      }
    },
    [token, replicaId, load, fail, onProposals],
  );

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
  const speakersById = useMemo(() => {
    const map = new Map<string, ContextSpeaker[]>();
    for (const row of recent) if (row.item && row.speakers?.length) map.set(row.item.item_id, row.speakers);
    return map;
  }, [recent]);

  /** The five states, and nothing else. */
  const stateLabel = useCallback(
    (row: Row): string => {
      if (!row.item) return c.stateNotAdded;
      if (row.item.status === "mined") {
        return row.proposed ? withCount(c.stateProposalCount, row.proposed) : c.stateProposalsReady;
      }
      if (row.item.status === "refused") return c.stateNotRead;
      if (row.item.status === "routed") return c.stateBelongsElsewhere;
      if (row.item.status === "extracted") return c.stateRead;
      return c.stateWorking;
    },
    [c],
  );

  /** Every state carries its reason. `copyFor` falls back to the raw code
   *  rather than to silence, so an unmapped server code is visible instead
   *  of missing. */
  const stateDetail = useCallback(
    (row: Row): string => {
      if (!row.item) return copyFor(row.error || c.detailRequestFailed);
      if (row.item.status === "refused") return copyFor(row.item.refusal_reason);
      if (row.item.status === "routed") return copyFor(row.item.routed_to);
      if (row.item.status === "mined") return c.detailMinedWaiting;
      if (row.item.status === "extracted") return copyFor(row.item.mine_skip_reason || "no_candidates_cleared_held_out");
      return "";
    },
    [c.detailMinedWaiting, c.detailRequestFailed, copyFor],
  );

  // `id` matches the anchor `wizardModel.ts`'s `no_material` blocker already
  // carries (`#context-locker`), so "Go there" actually lands somewhere
  // instead of `jumpTo` silently finding nothing.
  return (
    <section id="context-locker" className="stage-section context-locker" aria-labelledby="context-locker-title">
      <header className="section-heading">
        <div>
          <h2 id="context-locker-title">{c.title}</h2>
          <p className="field-note">{c.intro}</p>
        </div>
      </header>

      {error && (
        <p className="field-note context-locker-error" role="alert">{copyFor(error.replaceAll(" ", "_"))}</p>
      )}

      <div
        className={`context-dropzone${dragging ? " is-dragging" : ""}`}
        onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <p className="context-dropzone-title">{c.dropzoneTitle}</p>
        <p className="field-note">
          {withLabel(c.dropzoneHelpTemplate, view ? humanBytes(view.limits.max_item_bytes) : c.bytesFewMB)}
        </p>
        <button
          type="button"
          className="button primary-button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? c.readingButton : c.chooseFilesButton}
        </button>
        <input
          ref={fileInput}
          type="file"
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
        <span>{c.thirdPartyAck}</span>
      </label>}

      <label className="field">
        <span>{c.linksLabel}</span>
        <textarea
          rows={3}
          value={links}
          placeholder={`${c.linksPlaceholderLine1}\n${c.linksPlaceholderLine2}`}
          onChange={(event) => setLinks(event.target.value)}
        />
      </label>
      <button type="button" className="button" disabled={busy || !links.trim()} onClick={() => void sendLinks()}>
        {c.addLinksButton}
      </button>

      {recent.length > 0 && (
        <ul className="context-results" aria-live="polite">
          {recent.map((row) => (
            <li key={row.key} className={`context-result is-${row.item?.status ?? "error"}`}>
              <span className="context-result-name">{row.label}</span>
              <span className="context-result-state">{stateLabel(row)}</span>
              <span className="field-note">{stateDetail(row)}</span>

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
                      {withNameAndCount(c.iAmSpeaker, speaker.name, speaker.messages)}
                    </button>
                  ))}
                </span>
              )}

              {row.item && row.item.status === "extracted" && row.item.kind === "file"
                && row.item.format !== "whatsapp_export"
                && row.item.mine_skip_reason === "not_owner_authored_no_style_evidence" && (
                <span className="context-result-actions">
                  <button
                    type="button"
                    className="button primary-button"
                    disabled={busy}
                    onClick={() => void remine(row.item!.item_id, { authorship: "mine" })}
                  >
                    {c.thisIsMyOwnWriting}
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="context-list-title">{c.inYourLocker}</h3>
      {loading ? (
        <p className="field-note" role="status">{c.loading}</p>
      ) : items.length === 0 ? (
        <p className="field-note">{c.nothingYet}</p>
      ) : (
        <ul className="context-results">
          {items.map((item) => (
            <li key={item.item_id} className={`context-result is-${item.status}`}>
              <span className="context-result-name">{item.source_name || item.source_url}</span>
              <span className="context-result-state">{stateLabel({ key: item.item_id, item, label: "" })}</span>
              <span className="field-note">
                {item.format} · {item.extracted_chars ? withCount(c.charactersSuffix, item.extracted_chars) : humanBytes(item.byte_size)}
                {item.owner_speaker ? withLabel(c.yourMessagesAs, item.owner_speaker) : ""}
              </span>
              <span className="field-note">{stateDetail({ key: item.item_id, item, label: "" })}</span>
              <span className="context-result-actions">
                <button
                  type="button"
                  className="button destructive-button"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void removeContextItem(token, replicaId, item.item_id)
                      .then(load)
                      .catch(fail)
                      .finally(() => setBusy(false));
                  }}
                >
                  {c.removeButton}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {quota && (
        <p className="field-note">
          {c.quotaSummary
            .split("{n}").join(String(quota.items))
            .split("{n2}").join(String(quota.max_items))
            .split("{label}").join(humanBytes(quota.bytes))
            .split("{label2}").join(humanBytes(quota.max_bytes))}
        </p>
      )}
    </section>
  );
}
