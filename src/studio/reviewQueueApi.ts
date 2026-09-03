// The review queue's wire — WS-R4.
//
// Four calls, and the third one is the only interesting one: a correction is
// uploaded as BYTES through the ordinary signed upload, finalized through the
// existing source endpoint, and only then does the card flip. That ordering is
// the client half of `mirror-call-approval-is-one-sql-clause`: the write is
// upstream of the state flip, so a tap whose correction did not land leaves the
// card open rather than reporting a fix that is not there.
import { replicaRequest } from "./replicaApi";
import { finalizeSource } from "./enrollmentApi";
import { IncrementalSha256 } from "./sha256Core";
import type { ReviewCard, ReviewCorrectionUpload, ReviewDecision, ReviewQueue } from "./types";

export async function readReviewQueue(token: string, replicaId: string): Promise<ReviewQueue> {
  const data = await replicaRequest<{ queue: ReviewQueue }>(
    token,
    `/api/review-queue?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return data.queue;
}

export async function fillReviewQueue(token: string, replicaId: string): Promise<{
  written: number;
  queue: ReviewQueue;
  questions_unavailable?: string;
}> {
  return replicaRequest(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({ op: "generate", replica_id: replicaId }),
  });
}

export async function decideReviewCard(
  token: string,
  replicaId: string,
  cardId: string,
  decision: ReviewDecision,
  extra: { correctionSourceId?: string; pattern?: string } = {},
): Promise<{ card: ReviewCard; queue: ReviewQueue }> {
  return replicaRequest(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({
      op: "decide",
      replica_id: replicaId,
      card_id: cardId,
      decision,
      ...(extra.correctionSourceId ? { correction_source_id: extra.correctionSourceId } : {}),
      ...(extra.pattern ? { pattern: extra.pattern } : {}),
    }),
  });
}

function hexOf(bytes: Uint8Array): string {
  const hash = new IncrementalSha256();
  hash.update(bytes);
  return hash.digestHex();
}

/**
 * Upload one correction and return its source id.
 *
 * Text and audio are the SAME lane, deliberately. A typed correction is a
 * `text/plain` object and a dictated one is an audio object; both go to the
 * private bucket through the signed upload and both are finalized by the
 * endpoint that queues the processing DAG, so the transcript of a spoken
 * correction is produced by the pipeline that already transcribes a lecture.
 */
export async function uploadCorrection(
  token: string,
  replicaId: string,
  cardId: string,
  body: { bytes: Uint8Array; mime: string; correctionKind: "text" | "audio" },
): Promise<string> {
  const minted = await replicaRequest<ReviewCorrectionUpload>(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({
      op: "dictate",
      replica_id: replicaId,
      card_id: cardId,
      correction_kind: body.correctionKind,
      mime: body.mime,
      byte_size: body.bytes.byteLength,
      sha256: hexOf(body.bytes),
    }),
  });
  const put = await fetch(minted.upload.url, {
    method: minted.upload.method,
    headers: minted.upload.headers,
    // A fresh, exactly sized buffer: some runtimes reject a view whose
    // underlying buffer is larger than the view, and a short write here is a
    // byte-size mismatch the server rejects with a code nobody can act on.
    body: body.bytes.slice().buffer as ArrayBuffer,
    signal: AbortSignal.timeout(30_000),
  });
  if (!put.ok) throw new Error("The correction could not be stored. Try again.");
  await finalizeSource(token, replicaId, minted.source.source_id);
  return minted.source.source_id;
}

export function encodeCorrectionText(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
