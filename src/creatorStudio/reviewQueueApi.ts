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
import type {
  FlaggedReply,
  ReviewCard,
  ReviewCorrectionUpload,
  ReviewDecision,
  ReviewQueue,
  ShowcaseEligibleCard,
} from "./types";

// WS-R67 (migration 116): the GET now carries `flags` alongside `queue` -
// read both here rather than adding a second round trip, `flags`'s own
// caller decides whether to render it.
export async function readReviewQueue(
  token: string,
  replicaId: string,
): Promise<{ queue: ReviewQueue; flags: FlaggedReply[] }> {
  const data = await replicaRequest<{ queue: ReviewQueue; flags?: FlaggedReply[] }>(
    token,
    `/api/review-queue?replica_id=${encodeURIComponent(replicaId)}`,
  );
  return { queue: data.queue, flags: data.flags ?? [] };
}

/**
 * "Never say this," off a flagged reply rather than an open card. The
 * server reads the pattern back from `vy_room_reply_flag` itself - this
 * call never sends the reply text, only which reply (by hash).
 */
export async function neverRuleFromFlag(
  token: string,
  replicaId: string,
  replySha256: string,
  reason?: string,
): Promise<{ rule_id: string | null; pattern: string; flags: FlaggedReply[] }> {
  return replicaRequest(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({
      op: "flag_never",
      replica_id: replicaId,
      reply_sha256: replySha256,
      ...(reason ? { reason } : {}),
    }),
  });
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

/**
 * WS-R72. "Sounds right anyway," off a flagged reply - `neverRuleFromFlag`'s
 * own shape one call up: deletes the creator lane's rows for this reply hash
 * and hands back the same re-read `flags` list, so the caller never has to
 * special-case which of the two actions it just took.
 */
export async function dismissFlaggedReply(
  token: string,
  replicaId: string,
  replySha256: string,
): Promise<{ dismissed: number; flags: FlaggedReply[] }> {
  return replicaRequest(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({ op: "flag_dismiss", replica_id: replicaId, reply_sha256: replySha256 }),
  });
}

/**
 * WS-R72. The Share tab's "Pick from your reviews": every decided card
 * `api/_room-publish.js::setRoomShowcase`'s own `sourceCardId` path already
 * accepts, so a creator can browse before they pick rather than typing the
 * same words a card already holds
 * (`context/decisions.md#ws-r66-showcase-card-picker-ui-not-built-v0`).
 */
export async function eligibleShowcaseCards(token: string, replicaId: string): Promise<ShowcaseEligibleCard[]> {
  const data = await replicaRequest<{ cards: ShowcaseEligibleCard[] }>(token, "/api/review-queue", {
    method: "POST",
    body: JSON.stringify({ op: "showcase_eligible", replica_id: replicaId }),
  });
  return data.cards;
}
