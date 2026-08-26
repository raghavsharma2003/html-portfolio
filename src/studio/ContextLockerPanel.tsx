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
// `REASON_COPY` renders a server code in plain language; a code it does not
// know renders the CODE. IngestChannelStudio.tsx makes the same choice for the
// same reason: a list that quietly drops the one row it did not recognise is
// how a person learns nothing from the screen that exists to tell them.
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

const REASON_COPY: Record<string, string> = {
  // refusals — files
  pdf_no_text_layer: "This PDF is a scan. There is no text in it to read, only pictures of text. We have no OCR, so we would rather say so than store it empty.",
  pdf_text_layer_unreadable: "We found text in this PDF but it does not read as language. The fonts use an encoding we cannot map. Export it as text or DOCX instead.",
  pdf_encrypted: "This PDF is password-protected. Remove the password and try again.",
  pdf_unsupported_filter: "This PDF compresses its text in a way we do not read.",
  pdf_malformed: "This file is not a readable PDF.",
  docx_malformed: "This file is not a readable Word document.",
  docx_encrypted: "This Word document is password-protected.",
  docx_no_text: "This Word document has no text in its body.",
  doc_legacy_binary_unsupported: "The old .doc format is not read. Save it as .docx and try again.",
  rtf_unsupported: "RTF is not read. Save it as .docx or plain text.",
  odt_unsupported: "OpenDocument is not read. Export as .docx or text.",
  pages_unsupported: "Pages files are not read. Export as .docx or a PDF with real text in it.",
  epub_unsupported: "EPUB is not read.",
  archive_unsupported: "We do not unpack archives. Upload the files inside it.",
  csv_unsupported: "A spreadsheet is not prose. Mining it would put column headers in your phrasing.",
  spreadsheet_unsupported: "A spreadsheet is not prose.",
  slides_unsupported: "Slides are titles and fragments, not how you talk. Export the speaker notes if that is what you meant.",
  structured_data_unsupported: "Structured data is not prose.",
  html_upload_unsupported: "Paste the page's link instead. An uploaded HTML file has no source to cite.",
  text_not_utf8: "This file is not UTF-8 text. Re-save it as UTF-8.",
  text_unreadable: "This file does not read as language.",
  format_unsupported: "We do not read this file type.",
  extracted_text_too_large: "This document is longer than one item may be. Split it and upload the parts. We do not trim anything silently.",
  file_too_large: "This file is larger than one upload may be.",
  chat_export_third_party_consent_required: "This is a chat export, so it contains someone else's private messages. Tick the box above and add it again. We only ever mine your own messages, and theirs are read only to tell them apart.",
  chat_export_too_many_speakers: "This is a large group chat, mostly other people's words. Export a one-to-one chat instead.",
  whatsapp_export_unparseable: "This looks like a chat export but no line in it matched a message. Export the chat again 'Without media' and upload the .txt unchanged.",
  // refusals — links
  link_unparseable: "That is not a link.",
  link_scheme_unsupported: "Only https links are read.",
  link_host_not_public: "We only read links on public websites.",
  article_fetch_not_configured: "This deployment cannot read links yet. Upload the text instead.",
  article_fetch_failed: "We could not load that page.",
  article_no_text: "That page had no readable text.",
  article_unreadable: "That page did not read as language.",
  // routing
  channel_lane: "This is YouTube. It belongs to the Channel step, which asks you to confirm the channel is yours before reading a single video.",
  voice_evidence_lane: "This is audio. It belongs to the Voice step, which carries the consent your voice needs.",
  // mined-nothing reasons
  not_owner_authored_no_style_evidence: "Read, but not used for how you talk. It is not your own writing. Mark it as yours if it is.",
  speaker_unattributed_no_style_evidence: "Read. Tell us which of these people is you and we will mine only your messages.",
  declared_speaker_not_in_export: "Nobody by that name sends messages in this export.",
  no_candidates_cleared_held_out: "Read, but nothing in it repeated often enough to be worth proposing. That is normal for a short document.",
  citation_integrity_failed: "Read, but the proposals could not be traced back to the text they came from, so none were kept.",
  proposal_already_exists: "Already proposed. See Review.",
  // quotas
  context_item_quota_exhausted: "Your locker is full. Remove something to add more.",
  context_byte_quota_exhausted: "Your locker is out of space. Remove something to add more.",
  replica_not_found: "That clone is not yours.",
};

const copyFor = (code: string) => REASON_COPY[code] ?? code;

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

export default function ContextLockerPanel({
  token,
  replicaId,
  onAuthError,
  onProposals,
}: {
  token: string;
  replicaId: string;
  onAuthError?: (error: ReplicaApiError) => void;
  /** Called with the number of new proposals so the host can nudge the owner
   *  toward the existing sheet-review surface. The panel deliberately does not
   *  navigate on its own — a screen that jumps while a batch is still uploading
   *  loses the rest of the batch's answers. */
  onProposals?: (count: number) => void;
}) {
  const [view, setView] = useState<ContextLockerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [links, setLinks] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
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
      setView(await loadContextLocker(token, replicaId));
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  }, [token, replicaId, fail]);

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

  return (
    <section className="stage-section context-locker" aria-labelledby="context-locker-title">
      <header className="section-heading">
        <div>
          <h2 id="context-locker-title">Bring your context</h2>
          <p className="field-note">
            Everything you have already written about yourself, or that is already about you. Drop the
            files in, paste the links. Each one tells you what it became, and anything we cannot
            honestly read, we say so instead of quietly keeping it.
          </p>
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
        <p className="context-dropzone-title">Drop your files here</p>
        <p className="field-note">
          Text, Markdown, Word documents, PDFs with real text in them, and WhatsApp chat exports.
          Up to {view ? humanBytes(view.limits.max_item_bytes) : "a few MB"} each.
          Audio goes to the Voice step; YouTube goes to the Channel step. Paste those and we will
          point you there rather than doing it twice.
        </p>
        <button
          type="button"
          className="button primary-button"
          disabled={busy}
          onClick={() => fileInput.current?.click()}
        >
          {busy ? "Reading…" : "Choose files"}
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

      <label className="model-consent-check context-ack">
        <input
          type="checkbox"
          checked={acknowledged}
          onChange={(event) => setAcknowledged(event.target.checked)}
        />
        <span>
          If I upload a chat export, I understand it contains another person's private messages, that
          only MY messages are ever used, and that theirs are read only to tell the two apart.
        </span>
      </label>

      <label className="field">
        <span>Or paste links, one per line</span>
        <textarea
          rows={3}
          value={links}
          placeholder={"https://example.com/an-interview-with-me\nhttps://example.com/my-essay"}
          onChange={(event) => setLinks(event.target.value)}
        />
      </label>
      <button type="button" className="button" disabled={busy || !links.trim()} onClick={() => void sendLinks()}>
        Add links
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
                      I am {speaker.name} ({speaker.messages})
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
                    This is my own writing
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}

      <h3 className="context-list-title">In your locker</h3>
      {loading ? (
        <p className="field-note" role="status">Loading…</p>
      ) : items.length === 0 ? (
        <p className="field-note">Nothing yet.</p>
      ) : (
        <ul className="context-results">
          {items.map((item) => (
            <li key={item.item_id} className={`context-result is-${item.status}`}>
              <span className="context-result-name">{item.source_name || item.source_url}</span>
              <span className="context-result-state">{stateLabel({ key: item.item_id, item, label: "" })}</span>
              <span className="field-note">
                {item.format} · {item.extracted_chars ? `${item.extracted_chars.toLocaleString()} characters` : humanBytes(item.byte_size)}
                {item.owner_speaker ? ` · your messages as ${item.owner_speaker}` : ""}
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
                  Remove
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {quota && (
        <p className="field-note">
          {quota.items} of {quota.max_items} items · {humanBytes(quota.bytes)} of {humanBytes(quota.max_bytes)}.
        </p>
      )}
    </section>
  );
}

/** The five states, and nothing else. */
function stateLabel(row: Row): string {
  if (!row.item) return "Not added";
  if (row.item.status === "mined") {
    return row.proposed ? `${row.proposed} proposal${row.proposed === 1 ? "" : "s"}` : "Proposals ready";
  }
  if (row.item.status === "refused") return "Not read";
  if (row.item.status === "routed") return "Belongs elsewhere";
  if (row.item.status === "extracted") return "Read";
  return "Working…";
}

/** Every state carries its reason. `copyFor` falls back to the raw code rather
 *  than to silence, so an unmapped server code is visible instead of missing. */
function stateDetail(row: Row): string {
  if (!row.item) return copyFor(row.error || "request_failed");
  if (row.item.status === "refused") return copyFor(row.item.refusal_reason);
  if (row.item.status === "routed") return copyFor(row.item.routed_to);
  if (row.item.status === "mined") return "Waiting for you in Review. Nothing is applied to your clone until you approve it.";
  if (row.item.status === "extracted") return copyFor(row.item.mine_skip_reason || "no_candidates_cleared_held_out");
  return "";
}
