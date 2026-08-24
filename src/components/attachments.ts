// THE COMPOSER'S ATTACHMENT LOGIC — everything about sending pictures that is
// a decision rather than a picture.
//
// ── why this file exists ───────────────────────────────────────────────────
//
// The single-photo path lived as three closures inside Chat.tsx (a 3,000-line
// component), which made every rule in it untestable except through a browser.
// The rules are the part that can silently be wrong: how many pictures may ride
// one message, what happens to the sixth, how many bytes may leave the device,
// which collage a count resolves to, and what shape goes on the wire. All of
// that is pure, so all of it is here and all of it is gated by
// `evals/composer/run.mjs`.
//
// ── ONE COMPRESSION PIPELINE ───────────────────────────────────────────────
//
// `compressImage` below is the SAME function that used to sit in Chat.tsx,
// moved rather than reimplemented, and its defaults are the exact numbers the
// single-photo path has always used (1024px longest edge, JPEG q0.82). That
// matters more than it looks: a second downscaler would drift from the first
// by one quality step and nobody would ever see it, because the only symptom is
// a slightly worse picture on one of two code paths. The eval asserts there is
// exactly ONE `toDataURL` in `src/`, which is the mechanical version of this
// paragraph.
//
// The parameters exist for the byte budget below, not for callers to tune: a
// call site that passes its own numbers is a second pipeline wearing the first
// one's name.

/** The most pictures one message may carry. The owner's number. */
export const MAX_ATTACHMENTS = 5;

/** Longest edge, in CSS pixels, of a compressed attachment. */
export const PHOTO_MAX_DIM = 1024;

/** JPEG quality of a compressed attachment. */
export const PHOTO_QUALITY = 0.82;

/**
 * The most base64 one send may put on the wire, summed across its pictures.
 *
 * A serverless function body is capped around 4.5 MB and base64 inflates a
 * JPEG by a third, so five pictures at the pipeline's own settings (~150-250 KB
 * each) sit an order of magnitude inside this. It is a rail rather than a
 * budget anyone will feel: the case it exists for is a phone that hands us five
 * 48-megapixel frames whose downscaled JPEGs are still enormous, where the
 * alternative to refusing the fifth is a 413 the user reads as the app being
 * broken.
 */
export const MAX_TOTAL_B64 = 3_200_000;

/** Where a picture came from. Telemetry only; nothing branches on it. */
export type AttachSource = "camera" | "gallery";

/** One picture waiting in the compose tray. */
export interface Attachment {
  id: string;
  /** compressed JPEG data URL. The only representation, from the one pipeline. */
  dataUrl: string;
  /** the base64 payload, sliced once here so no call site re-splits it */
  b64: string;
  source: AttachSource;
}

/**
 * The single-photo path's compressor, unchanged and now shared.
 *
 * Returns null on anything unreadable (a HEIC a WebView cannot decode, a file
 * that is not an image, a canvas the browser refuses to taint-free export).
 * The caller shows a notice; it must never throw, because the throw would land
 * on the send handler.
 */
export async function compressImage(
  file: Blob,
  maxDim = PHOTO_MAX_DIM,
  quality = PHOTO_QUALITY,
): Promise<{ dataUrl: string; b64: string } | null> {
  try {
    const src = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej();
      img.src = src;
    });
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(img.width * scale));
    c.height = Math.max(1, Math.round(img.height * scale));
    c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(src);
    const dataUrl = c.toDataURL("image/jpeg", quality);
    return { dataUrl, b64: dataUrl.split(",")[1] || "" };
  } catch {
    return null;
  }
}

/** The base64 bytes a tray currently represents. */
export const totalBytes = (atts: readonly Attachment[]) =>
  atts.reduce((n, a) => n + a.b64.length, 0);

/** Why an offered picture did not make it into the tray. */
export type RefusalReason = "full" | "heavy";

export interface AddResult {
  /** the tray after the add, capped and budgeted */
  next: Attachment[];
  /** how many of the offered pictures were taken */
  accepted: number;
  /** how many were turned away, and why the first of them was */
  refused: number;
  reason: RefusalReason | null;
}

/**
 * Append pictures to the tray, one at a time, stopping at the first rule that
 * says no.
 *
 * ONE AT A TIME rather than as a batch, because a gallery multi-select of eight
 * onto an empty tray should give five and a cue, not zero and a cue. The
 * partial accept is the whole difference between a cap that guides and a cap
 * that argues.
 */
export function addAttachments(
  current: readonly Attachment[],
  incoming: readonly Attachment[],
): AddResult {
  const next = [...current];
  let accepted = 0;
  let reason: RefusalReason | null = null;
  for (const a of incoming) {
    if (next.length >= MAX_ATTACHMENTS) {
      reason = reason ?? "full";
      continue;
    }
    if (totalBytes(next) + a.b64.length > MAX_TOTAL_B64) {
      reason = reason ?? "heavy";
      continue;
    }
    next.push(a);
    accepted++;
  }
  return { next, accepted, refused: incoming.length - accepted, reason };
}

/** Drop one picture out of the tray. */
export const removeAttachment = (current: readonly Attachment[], id: string) =>
  current.filter((a) => a.id !== id);

// ── THE COLLAGE ────────────────────────────────────────────────────────────
//
// WhatsApp's arrangement, because it is the one every user of this product
// already reads without being taught. The shapes are named rather than derived
// so the CSS and the test can both refer to the same five words:
//
//   one    the picture, at its own aspect ratio. A single photo is a photo.
//   two    two squares side by side.
//   three  one tall on the left, two stacked on the right.
//   four   a 2x2 of squares.
//   four+1 the same 2x2, with the last tile carrying a `+N` veil.
//
// FIVE IS FOUR TILES, NOT FIVE. A 5-up grid has no arrangement that is not
// either a lopsided row or a tile at a different size from its neighbours, and
// both read as a layout bug rather than as a set. The overflow veil is how
// every collage in every messaging app answers this, and it is also honest:
// the count is on screen, and the tap opens all of them.

export type CollageShape = "one" | "two" | "three" | "four";

export interface Collage {
  shape: CollageShape;
  /** how many pictures are actually drawn */
  tiles: number;
  /** the number on the last tile's veil, 0 when nothing is hidden */
  overflow: number;
}

/**
 * Which collage a count of pictures resolves to.
 *
 * Counts above MAX_ATTACHMENTS cannot be produced by this app's composer, but
 * they CAN arrive from a synced device running an older or newer build, so the
 * function is total rather than asserting.
 */
export function collageFor(count: number): Collage | null {
  const n = Math.floor(count);
  if (!Number.isFinite(n) || n < 1) return null;
  if (n === 1) return { shape: "one", tiles: 1, overflow: 0 };
  if (n === 2) return { shape: "two", tiles: 2, overflow: 0 };
  if (n === 3) return { shape: "three", tiles: 3, overflow: 0 };
  if (n === 4) return { shape: "four", tiles: 4, overflow: 0 };
  return { shape: "four", tiles: 4, overflow: n - 4 };
}

// ── THE WIRE ───────────────────────────────────────────────────────────────

/** The pictures on a message, newest shape first, oldest shape as the fallback. */
export function imagesOf(m: { photoUrls?: string[]; photoUrl?: string }): string[] {
  if (Array.isArray(m.photoUrls) && m.photoUrls.length) return m.photoUrls.filter(Boolean);
  return m.photoUrl ? [m.photoUrl] : [];
}

export interface ImagePayload {
  /** the agreed contract: every picture as a data URL, capped at MAX_ATTACHMENTS */
  images: string[];
  caption: string;
  /**
   * The pre-existing single-photo body, present ONLY when this send is exactly
   * what the old path already sent: one picture, no caption. That is the case
   * where the new shape buys nothing and the old one is already proven against
   * production, so it is the case that keeps sending the old one.
   */
  legacy: { data: string; mime: string } | null;
}

/**
 * The body of a picture send.
 *
 * Capping HERE as well as in `addAttachments` is deliberate belt-and-braces:
 * the tray is the only producer today, and a second producer added later (a
 * paste handler, a share-target intent) would otherwise reach the wire with the
 * cap enforced nowhere.
 */
export function buildImagePayload(
  atts: readonly Attachment[],
  caption: string,
): ImagePayload {
  const kept = atts.slice(0, MAX_ATTACHMENTS);
  const cap = caption.trim();
  return {
    images: kept.map((a) => a.dataUrl),
    caption: cap,
    legacy:
      kept.length === 1 && !cap ? { data: kept[0].b64, mime: "image/jpeg" } : null,
  };
}

/**
 * What the thread's transcript says a picture message was, for the memory log.
 *
 * `[photo]` for one is the exact string the single-photo path has always
 * written, and it stays that way byte for byte: `brain.ts` tests it against
 * that literal when it decides whether a caption is worth repeating.
 */
export function transcriptLine(count: number, caption: string): string {
  const head = count > 1 ? `[${count} photos]` : "[photo]";
  return caption ? `${head} ${caption}` : head;
}
