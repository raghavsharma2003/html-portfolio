# The Context Locker — "bring your context" (WS-AB)

The universal ingestion lane. Anyone hands the platform multiple files and
multiple links about themselves; each becomes an owned, consent-scoped,
content-hashed, quota-capped item, and the ones the platform can honestly read
become CITED proposals on the review surface that already exists.

Sibling lanes, deliberately not duplicated: WS-S's YouTube channel lane
(`api/_channel-watch.js`, ownership attestation + OAuth + back-catalogue
cursor) and the voice-evidence/ASR lane (biometric consent + diarization).
Items belonging to either are **routed**, not refused.

---

## 1. The item-type matrix

Detection is magic bytes first, extension second. A `.txt` that is really an
m4a is routed as audio; a `.pdf` that is really a zip is refused, not parsed.

| input | outcome | code / extractor |
|---|---|---|
| `.txt`, `.log`, no extension | **accepted** | `text-plain/v1` |
| `.md`, `.markdown` | **accepted** | `markdown-plain/v1` |
| `.txt` that sniffs as a WhatsApp export | **accepted** (speaker-attributed) | `whatsapp-export/v1` |
| `.pdf` with a standard-encoding text layer | **accepted** | `pdf-text-layer/v1` |
| `.docx` | **accepted** | `docx-ooxml/v1` |
| article link (https, public host) | **accepted** if a fetcher is configured | `html-text/v1` |
| audio/video bytes or extension | **routed** | `voice_evidence_lane` |
| YouTube link | **routed** | `channel_lane` |
| audio link (`.mp3`, `.m4a`, …) | **routed** | `voice_evidence_lane` |
| scanned `.pdf` (no text operators) | **refused** | `pdf_no_text_layer` — no OCR lane exists |
| `.pdf` with subset/CID fonts | **refused** | `pdf_text_layer_unreadable` |
| password-protected `.pdf` / `.docx` | **refused** | `pdf_encrypted` / `docx_encrypted` |
| `.pdf` with a non-Flate content filter | **refused** | `pdf_unsupported_filter` |
| corrupted `.pdf` / `.docx` | **refused** | `pdf_malformed` / `docx_malformed` |
| legacy `.doc` (OLE) | **refused** | `doc_legacy_binary_unsupported` |
| `.rtf` / `.odt` / `.pages` / `.epub` | **refused** | one code each |
| `.zip`, `.rar` | **refused** | `archive_unsupported` |
| `.csv`, `.xlsx`, `.json` | **refused** | not prose; mining it puts column headers in a phrase bank |
| `.pptx` | **refused** | `slides_unsupported` |
| uploaded `.html` | **refused** | `html_upload_unsupported` — paste the link, which has a source to cite |
| non-UTF-8 text | **refused** | `text_not_utf8` |
| anything else | **refused** | `format_unsupported`, naming the extension |
| link: `http://`, IP literal, private host, non-443 port, credentials in URL | **refused** | `link_scheme_unsupported` / `link_host_not_public` |
| article link with no fetcher configured | **refused** | `article_fetch_not_configured` |

A refusal is a STORED row with a named reason (migration 058's
`vy_context_item_refusal_named` makes the blank case unrepresentable). Nothing
is accepted-and-ignored and nothing is trimmed: over-cap items refuse with both
numbers (`extracted_text_too_large`, `file_too_large`).

## 2. What is mined, and what is not

| item | mines |
|---|---|
| document, `authorship='mine'` | style evidence, phrase-bank candidates, cited |
| document, `authorship='not_mine'` or `'unknown'` (the default) | **nothing** — `not_owner_authored_no_style_evidence` |
| article link | **nothing**, always — a link is never the owner's writing |
| chat export, owner speaker declared | that speaker's turns only, cited to their spans |
| chat export, no owner speaker | **nothing** — `speaker_unattributed_no_style_evidence` |
| chat export, no third-party acknowledgement | **refused** before extraction is kept |

`no_candidates_cleared_held_out` is the honest fourth answer: the pass ran, and
nothing repeated often enough to clear the `>=3 in the derive half / >=5 in the
held-out half` rule.

## 3. Provenance

Every proposed addition carries `{ item_id, span: { start, end }, speaker }`,
where the offsets index the body stored in `vy_context_item_text`.
`citationResolves` (`api/_context-mining.js`) is the single definition of "this
span really contains this fragment", used by the write path AND the eval —
`citationViolations` runs BEFORE storage, so an unresolvable citation is never
written at all.

## 4. Caps

| cap | value | over it |
|---|---|---|
| per item | 3 MiB | `file_too_large` |
| extracted text per item | 400 000 chars | `extracted_text_too_large` |
| items per owner | 200 | `context_item_quota_exhausted` |
| bytes per owner | 64 MiB | `context_byte_quota_exhausted` |
| speakers in one export | 24 | `chat_export_too_many_speakers` |
| files/links per request | 20 | `batch_too_large` |
| citations per candidate | 3 | truncated by rank, not by chance |

Quotas are per OWNER, not per replica: a per-replica cap is defeated by making
more replicas.

## 5. API

```
GET    /api/context-items?replica_id=…          { items, quota, limits }
POST   /api/context-items {op:"add_files", replica_id, files:[
         { filename, content_base64, authorship?, owner_speaker?,
           third_party_acknowledged? } ]}       { results: [...] }
POST   /api/context-items {op:"add_links", replica_id, links:[{url}]}
POST   /api/context-items {op:"remine", replica_id, item_id,
         authorship?, owner_speaker?}
DELETE /api/context-items {replica_id, item_id}
```

`add_files` / `add_links` answer with one result per input, in request order.
One bad file never fails the batch — that would hide exactly the information the
owner needs.

## 6. Storage and erasure

`vy_context_item` (the row) + `vy_context_item_text` (the body a citation
resolves against), migration 058. Both carry `owner_user_id` and no FK, so both
are deleted BY NAME in `api/_replica-full-erasure.js`, child before parent —
which is what `scripts/relcheck.mjs`'s owner-lane reach walk requires. They are
deliberately NOT in `PERSON_TABLES`; see
`context/rejected.md#owner-keyed-tables-belong-in-person_tables`.

Proposals land on `vy_ingest_run` with `transcript_source='context_item'` and
`video_ref='context:<item_id>'`, so migration 053's approval gate and the
existing review/apply/reject ops all apply unchanged.

## 7. Gate

`node evals/contextlocker.mjs` — 77 checks, offline, deterministic, no DB and
no network, wired into `evals/run.mjs` as `contextlocker`. It carries the
fabricated-citation, uncited-addition and wrong-speaker negative controls.
