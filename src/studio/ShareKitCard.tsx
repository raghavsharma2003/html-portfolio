// ShareKitCard.tsx — the Share tab's own kit (WS-R85, migration 122).
//
// India's creators distribute in WhatsApp groups, an Instagram bio, a
// YouTube description and a Telegram channel post — the Room's existing
// link/story-card/poster/embed cards (`RoomStudio.tsx`) hand a creator ONE
// generic address; this card hands them the exact TEXT each of those four
// places actually wants, plus the right picture, plus a `?via=<channel>`
// so the Growth line can say where followers actually come from
// (`api/_funnel.js`'s `shareKitArrivalsThisWeek`).
//
// SELF-CONTAINED, `ShowcaseCard.tsx`'s own precedent: owns its own fetch,
// never threads a fourth `useState` graph through `RoomStudio.tsx`, and
// fails closed on its own — a creator who cannot see this card can still
// publish and run their Room from the cards above it.
//
// EVERY REAL DECISION LIVES SERVER-SIDE (`api/_share-kit.js`'s
// `buildShareKit`, called through `api/_room-publish.js`'s
// `ownerRoomShareKit`) — this component renders whatever it is handed and
// computes nothing about limits, channels, or which picture goes where.
import { useCallback, useEffect, useRef, useState } from "react";
import { ReplicaApiError } from "./replicaApi";
import {
  readOwnedRoomShareKit,
  storyCardLink,
  ogImageLink,
  RoomPublishApiError,
  type ShareKitRow,
} from "./roomPublishApi";
import { useStudioLocale } from "./localeContext";
import type { StudioCopy } from "./copy";

/** `api/_share-kit.js`'s own `SHARE_KIT_CHANNELS` order, restated — the
 *  fixed row order this card renders in, independent of whatever order the
 *  server's array happens to arrive in. */
const CHANNEL_ORDER = ["whatsapp", "instagram", "youtube", "telegram"] as const;

function channelLabel(t: StudioCopy, channel: ShareKitRow["channel"]): string {
  const c = t.shareKit;
  if (channel === "whatsapp") return c.whatsappLabel;
  if (channel === "instagram") return c.instagramLabel;
  if (channel === "youtube") return c.youtubeLabel;
  return c.telegramLabel;
}

function pictureLink(row: ShareKitRow, slug: string): string | null {
  if (row.picture === "story") return storyCardLink(slug);
  if (row.picture === "og") return ogImageLink(slug);
  return null;
}

export default function ShareKitCard({
  token,
  replicaId,
  slug,
  roomPublished,
  onAuthError,
}: {
  token: string;
  replicaId: string;
  slug: string;
  roomPublished: boolean;
  onAuthError?: (error: ReplicaApiError | RoomPublishApiError) => void;
}) {
  const { t } = useStudioLocale();
  const c = t.shareKit;
  const [kit, setKit] = useState<ShareKitRow[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [copiedChannel, setCopiedChannel] = useState<string | null>(null);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // One `<textarea readOnly>` ref per channel — the fallback path
  // (`navigator.clipboard` absent or its write rejected) selects THIS
  // element's text so a creator can still copy with Ctrl/Cmd+C, rather
  // than claiming a "Copied" success this component could not verify.
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});

  const fail = useCallback(
    (e: unknown) => {
      if (
        (e instanceof ReplicaApiError || e instanceof RoomPublishApiError) &&
        (e.status === 401 || e.status === 403)
      ) {
        onAuthError?.(e);
        return;
      }
      setError(e instanceof Error ? e.message.replaceAll("_", " ") : "request failed");
    },
    [onAuthError],
  );

  const load = useCallback(async () => {
    try {
      const result = await readOwnedRoomShareKit(token, replicaId);
      setKit(result.kit);
      setError("");
    } catch (e) {
      fail(e);
    } finally {
      setLoaded(true);
    }
  }, [token, replicaId, fail]);

  useEffect(() => {
    void load();
    // Re-fetch the moment the Room actually publishes — the kit does not
    // exist before then (`api/_share-kit.js`'s own "nothing honest to
    // share yet" rule), so a creator who publishes without leaving this
    // screen should see the four rows appear without a manual refresh.
  }, [load, roomPublished]);

  useEffect(() => () => {
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
  }, []);

  const copyRow = useCallback(
    (row: ShareKitRow) => {
      const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : undefined;
      if (clipboard?.writeText) {
        clipboard.writeText(row.text).then(
          () => {
            setCopiedChannel(row.channel);
            if (copiedTimer.current) clearTimeout(copiedTimer.current);
            copiedTimer.current = setTimeout(() => setCopiedChannel(null), 2400);
          },
          () => {
            textareaRefs.current[row.channel]?.select();
          },
        );
        return;
      }
      // No Clipboard API at all — select the row's own textarea so a
      // creator can still copy by hand, never a fabricated "Copied".
      textareaRefs.current[row.channel]?.select();
    },
    [],
  );

  const orderedKit = kit
    ? CHANNEL_ORDER.map((channel) => kit.find((row) => row.channel === channel)).filter(
        (row): row is ShareKitRow => row != null,
      )
    : null;

  return (
    <article className="teacher-sheet-card vy-room__share-kit-card">
      <h3>{c.title}</h3>
      <p className="field-note">{c.intro}</p>
      {!loaded && <p className="field-note" role="status">{c.loading}</p>}
      {loaded && !orderedKit && <p className="field-note">{c.notPublishedYet}</p>}
      {orderedKit && (
        <div className="vy-room__share-kit-rows">
          {orderedKit.map((row) => {
            const picture = pictureLink(row, slug);
            return (
              <div key={row.channel} className="vy-room__share-kit-row">
                <h4>{channelLabel(t, row.channel)}</h4>
                <textarea
                  className="field vy-room__share-kit-text"
                  readOnly
                  value={row.text}
                  rows={row.channel === "instagram" ? 2 : 4}
                  aria-label={channelLabel(t, row.channel)}
                  ref={(el) => {
                    textareaRefs.current[row.channel] = el;
                  }}
                />
                <div className="vy-room__share-kit-actions">
                  <button
                    className="button secondary-button"
                    type="button"
                    onPointerDown={() => copyRow(row)}
                  >
                    {copiedChannel === row.channel ? c.copied : c.copy}
                  </button>
                  {row.channel === "whatsapp" && (
                    <a
                      className="button secondary-button"
                      href={`https://wa.me/?text=${encodeURIComponent(row.text)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {c.openWhatsapp}
                    </a>
                  )}
                  {picture && (
                    <a className="button secondary-button" href={picture} target="_blank" rel="noreferrer">
                      {c.viewPicture}
                    </a>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {error && <p className="inline-error" role="alert">{error}</p>}
    </article>
  );
}
