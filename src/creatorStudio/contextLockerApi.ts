// contextLockerApi.ts — fetch wrapper for `/api/context-items`, following the
// existing *Api.ts pattern (see channelWatchApi.ts, teacherSheetApi.ts).
//
// ── the per-item result array is the contract ────────────────────────────
// An owner drags in nine files. One is a scan with no text layer, one is an
// m4a, one is a duplicate of something they added last week. A single
// aggregate status would hide exactly the part they need. So `add_files`
// answers with one result per file, in request order, and every result is one
// of: an item, or a named error. The component renders that array directly.
//
// ── the file never touches this module's memory twice ────────────────────
// `FileReader`'s base64 is produced once, sent, and dropped. Nothing here
// caches a document's bytes: the studio is a browser tab a person leaves open.
import { replicaRequest } from "./replicaApi";

export type ContextItemStatus = "received" | "extracted" | "mined" | "refused" | "routed";
export type ContextAuthorship = "mine" | "not_mine" | "unknown";

export interface ContextItem {
  item_id: string;
  kind: "file" | "link";
  format: string;
  source_name: string;
  source_url: string;
  byte_size: number;
  extracted_chars: number;
  extractor: string;
  status: ContextItemStatus;
  /** Named, always, when status is `refused`. The database enforces it. */
  refusal_reason: string;
  /** Named, always, when status is `routed`: which lane this belongs to. */
  routed_to: string;
  /** Why an EXTRACTED item produced no proposals. Never blank-by-default. */
  mine_skip_reason: string;
  authorship: ContextAuthorship;
  owner_speaker: string;
  consent_scope: string;
  /** PRESENCE, never the id — the proposal itself comes from the review surface. */
  proposal: "present" | null;
  created_at: string | null;
  updated_at: string | null;
}

export interface ContextSpeaker {
  name: string;
  messages: number;
}

export interface ContextAddResult {
  item: ContextItem | null;
  duplicate?: boolean;
  proposal?: { ok: boolean; proposed?: number; reason?: string; run_id?: string } | null;
  /** Chat exports only: who the export says is in it, so the owner can say
   *  which one they are. Without that, the export mines nothing. */
  speakers?: ContextSpeaker[] | null;
  error?: string;
  details?: Record<string, unknown>;
  source_name?: string;
  note?: string;
}

export interface ContextLockerView {
  items: ContextItem[];
  quota: { items: number; bytes: number; max_items: number; max_bytes: number };
  limits: {
    max_item_bytes: number;
    accepted_file_formats: string[];
    routed_elsewhere: Record<string, string>;
  };
}

export async function loadContextLocker(token: string, replicaId: string): Promise<ContextLockerView> {
  return replicaRequest<ContextLockerView>(
    token,
    `/api/context-items?replica_id=${encodeURIComponent(replicaId)}`,
  );
}

export interface ContextFileUpload {
  filename: string;
  content_base64: string;
  authorship?: ContextAuthorship;
  owner_speaker?: string;
  third_party_acknowledged?: boolean;
}

export async function addContextFiles(
  token: string,
  replicaId: string,
  files: ContextFileUpload[],
): Promise<ContextAddResult[]> {
  const data = await replicaRequest<{ results: ContextAddResult[] }>(token, "/api/context-items", {
    method: "POST",
    body: JSON.stringify({ op: "add_files", replica_id: replicaId, files }),
  });
  return Array.isArray(data.results) ? data.results : [];
}

export async function addContextLinks(
  token: string,
  replicaId: string,
  urls: string[],
): Promise<ContextAddResult[]> {
  const data = await replicaRequest<{ results: ContextAddResult[] }>(token, "/api/context-items", {
    method: "POST",
    body: JSON.stringify({ op: "add_links", replica_id: replicaId, links: urls.map((url) => ({ url })) }),
  });
  return Array.isArray(data.results) ? data.results : [];
}

export async function remineContextItem(
  token: string,
  replicaId: string,
  itemId: string,
  options: { authorship?: ContextAuthorship; owner_speaker?: string },
): Promise<ContextAddResult> {
  return replicaRequest<ContextAddResult>(token, "/api/context-items", {
    method: "POST",
    body: JSON.stringify({ op: "remine", replica_id: replicaId, item_id: itemId, ...options }),
  });
}

export async function removeContextItem(token: string, replicaId: string, itemId: string): Promise<void> {
  await replicaRequest<{ removed: boolean }>(token, "/api/context-items", {
    method: "DELETE",
    body: JSON.stringify({ replica_id: replicaId, item_id: itemId }),
  });
}

/** Bytes → base64, without loading the file twice. `readAsDataURL` gives
 *  `data:<mime>;base64,<payload>`; the payload is what the server wants and the
 *  MIME type is deliberately discarded — the server sniffs magic bytes, and a
 *  browser-declared MIME type is a guess from the same filename the server
 *  already has. */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_unreadable"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(file);
  });
}
