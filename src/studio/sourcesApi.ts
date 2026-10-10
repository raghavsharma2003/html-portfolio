import { deleteSource } from "./enrollmentApi";
import { removeContextItem } from "./contextLockerApi";
import { replicaRequest } from "./replicaApi";

export type SourceOverviewKind = "recording" | "file" | "link" | "call";

export interface SourceOverview {
  source_id: string;
  context_item_id: string | null;
  kind: SourceOverviewKind;
  display_name: string;
  state: string;
  state_detail_code: string;
  contains_third_parties: boolean;
  created_at: string;
  yield: {
    claims_approved: number;
    claims_proposed: number;
    voice_seconds: number;
  };
}

export interface SourceRemovalImpact {
  source_id: string;
  claims_approved: number;
  claims_proposed: number;
  voice_seconds: number;
  is_primary_voice: boolean;
}

export interface SourceRemovalReceipt {
  erasure: "complete" | "pending";
  rebuild_required: boolean | null;
}

const SOURCE_KINDS = new Set<SourceOverviewKind>(["recording", "file", "link", "call"]);

function wholeNumber(value: unknown, key: string) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new Error(`invalid_${key}`);
  return number;
}

function sourceOverview(value: unknown): SourceOverview {
  if (!value || typeof value !== "object") throw new Error("invalid_source_overview");
  const row = value as Record<string, unknown>;
  const kind = String(row.kind || "") as SourceOverviewKind;
  const sourceId = String(row.source_id || "");
  if (!sourceId || !SOURCE_KINDS.has(kind) || !row.yield || typeof row.yield !== "object") {
    throw new Error("invalid_source_overview");
  }
  const yielded = row.yield as Record<string, unknown>;
  return {
    source_id: sourceId,
    context_item_id: row.context_item_id ? String(row.context_item_id) : null,
    kind,
    display_name: String(row.display_name || "").slice(0, 200),
    state: String(row.state || ""),
    state_detail_code: String(row.state_detail_code || "").slice(0, 120),
    contains_third_parties: row.contains_third_parties === true,
    created_at: String(row.created_at || ""),
    yield: {
      claims_approved: wholeNumber(yielded.claims_approved, "claims_approved"),
      claims_proposed: wholeNumber(yielded.claims_proposed, "claims_proposed"),
      voice_seconds: wholeNumber(yielded.voice_seconds, "voice_seconds"),
    },
  };
}

export async function listSourceOverview(token: string, replicaId: string) {
  const data = await replicaRequest<{ sources: unknown[] }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "overview", replica_id: replicaId }),
  });
  if (!Array.isArray(data.sources)) throw new Error("invalid_sources_overview");
  return data.sources.map(sourceOverview);
}

export async function previewSourceRemoval(token: string, replicaId: string, sourceId: string) {
  const data = await replicaRequest<{ impact: Record<string, unknown> }>(token, "/api/replica-source", {
    method: "POST",
    body: JSON.stringify({ op: "removal_preview", replica_id: replicaId, source_id: sourceId }),
  });
  const impact = data.impact;
  if (!impact || String(impact.source_id || "") !== sourceId) throw new Error("invalid_source_removal_impact");
  return {
    source_id: sourceId,
    claims_approved: wholeNumber(impact.claims_approved, "claims_approved"),
    claims_proposed: wholeNumber(impact.claims_proposed, "claims_proposed"),
    voice_seconds: wholeNumber(impact.voice_seconds, "voice_seconds"),
    is_primary_voice: impact.is_primary_voice === true,
  } satisfies SourceRemovalImpact;
}

export async function removeOverviewSource(
  token: string,
  replicaId: string,
  source: SourceOverview,
): Promise<SourceRemovalReceipt> {
  if (source.context_item_id) {
    const receipt = await removeContextItem(token, replicaId, source.context_item_id);
    if (!receipt.removed || !["complete", "pending"].includes(String(receipt.erasure || ""))) {
      throw new Error("invalid_context_removal_receipt");
    }
    return { erasure: receipt.erasure as "complete" | "pending", rebuild_required: null };
  }
  const receipt = await deleteSource(token, replicaId, source.source_id);
  if (receipt.source_id !== source.source_id || !["complete", "pending"].includes(receipt.erasure)) {
    throw new Error("invalid_source_removal_receipt");
  }
  return { erasure: receipt.erasure, rebuild_required: receipt.rebuild_required };
}
