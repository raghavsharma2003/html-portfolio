// One bubble, memoised.
//
// ── why this file exists ───────────────────────────────────────────────────
//
// Every keystroke in the composer is a `setDraft`, which re-renders Chat,
// which rebuilt every bubble in the thread inline. Measured: ~0.0077 ms per
// message per keystroke, p50 7.7 ms of input handler at 1000 messages in this
// container — and the install base measures 4-8x slower than this container on
// scalar JS (see engine/chess/opponent.ts), so that is 31-62 ms of blocked
// main thread between pressing a key and seeing the letter. Typing is the
// single most frequent interaction in the product; it is the one place where
// a frame budget is not a nicety.
//
// Two things fix it and both are needed. Windowing (Chat.tsx) bounds how many
// rows exist; this memo bounds how many of those re-render. A memo alone is
// worthless if its props change identity every render, so every callback the
// row takes arrives on ONE object built once for the life of the screen
// (`RowApi`), whose methods read live values out of refs. If you add a prop
// here, it must be a primitive or something with a stable identity, or the
// memo silently stops holding and nothing fails except the frame budget.
//
// `data-mid` stays on every rendered row: the read-receipt IntersectionObserver
// in Chat.tsx finds bubbles by that attribute, and the roving-tabindex
// keyboard navigation walks the same query.

import { memo, useMemo } from "react";
import type { Message } from "../state/store";
import { HER_NAME } from "../engine/persona";
import { fmtTime } from "./fmtTime";
import PhotoCard from "./PhotoCard";
import PhotoGrid from "./PhotoGrid";
import { imagesOf } from "./attachments";
import BigEmoji, { isSingleEmoji } from "./BigEmoji";
import VoiceNote from "./VoiceNote";
import GifBubble from "./GifBubble";
import { PhoneIcon, TickIcon } from "./icons";

/** WhatsApp's six, in WhatsApp's order — muscle memory is the whole point. */
export const QUICK_REACTIONS = ["❤️", "😂", "😮", "😢", "🙏", "👍"] as const;

/**
 * The row's whole outside world. Built ONCE in Chat.tsx (`useMemo(…, [])`) and
 * passed by identity, which is what lets `memo` below actually hold.
 */
export interface RowApi {
  /** tap the bubble: open/close its reaction + reply bar */
  toggleSelect(id: string): void;
  /** put (or clear) one emoji on this message */
  react(m: Message, emoji: string): void;
  /** the ↩ chip: quote this message in the composer */
  replyTo(m: Message): void;
  focusRow(id: string): void;
  /** arrow-key navigation between bubbles; extends the window at the top edge */
  moveFocus(id: string, dir: 1 | -1): void;
  clearSelect(): void;
  /** her voice note was played — stops the "unheard" affordance asking */
  voicePlayed(id: string): void;
  /** a gif resolved its remote URL and wants it written back into the message */
  gifResolved(id: string, url: string): void;
  /** tap a quote: go to the message it quotes, loading it in if it is older
   *  than the window */
  jumpToQuoted(m: Message): void;
  /** tap a picture he sent: open it full-screen, on that one, swipeable */
  openPhotos(m: Message, index: number): void;
  /** swipe-to-reply / drag-to-peek, bound to this message */
  swipe(m: Message): {
    onTouchStart(e: React.TouchEvent): void;
    onTouchMove(e: React.TouchEvent): void;
    onTouchEnd(e: React.TouchEvent): void;
  };
}

// ── the 1-3 emoji ramp ─────────────────────────────────────────────────────
//
// One emoji rendered at ~108px with no bubble and TWO rendered as ordinary
// 17px body text: a 5x size cliff across one character, which reads as a bug
// rather than as a rule. A short run of emoji is one gesture in every messaging
// app; the size should fall off, not fall over.
//
// The ramp stops at three because past that it is a sentence written in emoji,
// which is a normal message and belongs in a normal bubble.
//
// A single emoji keeps `isSingleEmoji`'s exact predicate, because that is what
// decides whether `BigEmoji`'s animated Noto URL can exist at all (the CDN is
// keyed on ONE emoji's codepoints). Two and three render as plain glyphs.
const EMOJI_ONE = /^\p{Extended_Pictographic}️?$/u;
const seg =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

/** How many bare emoji this message is, 0 if it is not a short emoji run. */
export function emojiRun(text: string): 0 | 1 | 2 | 3 {
  const t = text.trim();
  if (!t) return 0;
  // Cheap reject before any segmentation: a run of three emoji is at most a
  // handful of code points, and everything the user types is not.
  if (t.length > 24) return 0;
  const parts = seg
    ? [...seg.segment(t)].map((s) => s.segment)
    : // No Segmenter (old WebViews): fall back to code points, which is exact
      // for the bare-emoji-plus-VS16 shapes this predicate accepts anyway.
      [...t].reduce<string[]>((acc, c) => {
        if (c === "️" && acc.length) acc[acc.length - 1] += c;
        else acc.push(c);
        return acc;
      }, []);
  if (parts.length < 1 || parts.length > 3) return 0;
  if (!parts.every((p) => EMOJI_ONE.test(p))) return 0;
  return parts.length as 1 | 2 | 3;
}

export interface RowProps {
  m: Message;
  api: RowApi;
  /** last bubble of a same-sender group — the only one that shows a time */
  lastOfGroup: boolean;
  /** took over from the typing indicator: waits one exit beat (delay in CSS) */
  followsTyping: boolean;
  /** its reaction/reply bar is open */
  selected: boolean;
  /** the thread's single tab stop currently sits here */
  tabbable: boolean;
  /** her newest voice note, not yet played */
  unheard: boolean;
}

function Row({ m, api, lastOfGroup, followsTyping, selected, tabbable, unheard }: RowProps) {
  // `m` is stable for a memoised row, so the handlers are built once per
  // message rather than once per keystroke.
  const sw = useMemo(() => api.swipe(m), [api, m]);
  const follows = followsTyping ? { "data-follows-typing": "" } : {};

  if (m.kind === "callmark") {
    return (
      <div className="call-chip" data-row={m.id}>
        <PhoneIcon size={14} />
        Voice call · {m.text} <span className="ct">{fmtTime(m.at)}</span>
      </div>
    );
  }

  if (m.kind === "voice") {
    return (
      <div
        className={`msg ${m.from} voice ${unheard ? "unheard" : ""}`}
        data-row={m.id}
        {...follows}
        {...sw}
      >
        <VoiceNote m={m} onPlay={() => api.voicePlayed(m.id)} />
        {(lastOfGroup || m.from === "me") && (
          <span className="t">
            {lastOfGroup && fmtTime(m.at)}
            {m.from === "me" && <TickIcon status={m.status ?? "read"} />}
          </span>
        )}
      </div>
    );
  }

  if (m.kind === "gif") {
    return (
      <div className={`msg ${m.from} gifmsg`} data-row={m.id} {...follows} {...sw}>
        <GifBubble m={m} onResolved={api.gifResolved} />
        {lastOfGroup && <span className="t">{fmtTime(m.at)}</span>}
      </div>
    );
  }

  if (m.kind === "photo") {
    // What HE sent: one picture, or up to five as a collage. `imagesOf` owns
    // the precedence between the new field and the legacy one, so this file
    // never has to know which shape a stored message was written in.
    const mine = m.from === "me" ? imagesOf(m) : [];
    return m.from === "me" ? (
      <div className={`msg me photo${mine.length > 1 ? " multi" : ""}`} data-row={m.id} {...sw}>
        {mine.length > 1 ? (
          <PhotoGrid urls={mine} onOpen={(i) => api.openPhotos(m, i)} />
        ) : (
          mine.length === 1 && (
            // A BUTTON, not a bare image. Tapping a photo to see it larger is
            // the one thing every person tries on every messaging app, and
            // before this it did nothing at all. The keyboard gets it too,
            // which a click handler on an <img> would not have given anyone.
            <button
              className="pimg-open"
              data-tel="chat.photo_open"
              onClick={(e) => {
                e.stopPropagation();
                api.openPhotos(m, 0);
              }}
              aria-label="Open photo"
            >
              <img className="pimg" src={mine[0]} alt="" draggable={false} />
            </button>
          )
        )}
        {m.text && <div className="cap">{m.text}</div>}
        <span className="t">
          {fmtTime(m.at)}
          <TickIcon status={m.status ?? "read"} />
        </span>
      </div>
    ) : (
      <div className="msg her photo" data-row={m.id} {...follows} {...sw}>
        <PhotoCard seed={m.photoSeed || m.text} />
        <div className="cap">{m.text}</div>
      </div>
    );
  }

  const emo = emojiRun(m.text);
  // n=1 keeps the historical predicate exactly, so nothing that rendered as a
  // big animated emoji before renders differently now.
  const big = emo === 1 && isSingleEmoji(m.text);
  const ramp = big ? " emoji-big emoji-n1" : emo >= 2 ? ` emoji-big emoji-n${emo}` : "";

  return (
    <div
      className={`msg ${m.from}${ramp} ${selected ? "sel" : ""}`}
      onClick={() => api.toggleSelect(m.id)}
      // Quote-reply was tap-only, so on a keyboard it did not exist at
      // all. The thread is a roving-tabindex list now: ONE tab stop for
      // the whole conversation (putting forty bubbles in the tab order
      // would put the composer forty presses away), arrows move between
      // messages, Enter opens the same chip the tap does.
      role="button"
      data-mid={m.id}
      data-row={m.id}
      data-tel="chat.bubble"
      tabIndex={tabbable ? 0 : -1}
      aria-label={`${m.from === "her" ? HER_NAME : "You"} at ${fmtTime(m.at)}: ${m.text}. Reply`}
      onFocus={() => api.focusRow(m.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          api.toggleSelect(m.id);
        } else if (e.key === "Escape" && selected) {
          api.clearSelect();
        } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
          e.preventDefault();
          api.moveFocus(m.id, e.key === "ArrowDown" ? 1 : -1);
        }
      }}
      {...follows}
      {...sw}
    >
      {selected && (
        // One bar, two affordances, because that is the same gesture he
        // already uses everywhere else: tap a bubble, get the emoji row and
        // the reply arrow. Tapping the emoji already ON the bubble clears
        // it — WhatsApp's own toggle, and the only undo that needs no
        // second menu.
        <div className="react-bar" onClick={(e) => e.stopPropagation()}>
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              className={`react-pick ${m.reaction === emoji ? "on" : ""}`}
              aria-label={m.reaction === emoji ? `Remove ${emoji} reaction` : `React ${emoji}`}
              onClick={() => api.react(m, emoji)}
            >
              {emoji}
            </button>
          ))}
          <button
            className="reply-chip"
            data-tel="chat.reply_chip"
            onClick={() => api.replyTo(m)}
            aria-label="Reply to this message"
          >
            ↩
          </button>
        </div>
      )}
      {m.replyTo && (
        <div
          className={`quote ${m.replyTo.photo ? "has-photo" : ""}`}
          role="button"
          tabIndex={-1}
          aria-label="Go to the quoted message"
          onClick={(e) => {
            // the bubble's own tap opens the reaction bar; a quote is a
            // different target with a different meaning
            e.stopPropagation();
            api.jumpToQuoted(m);
          }}
        >
          {/* A quoted PICTURE shows the picture. The text-only version
              rendered a story reply as her desc in quotation marks —
              which read as words she had typed, in a bubble she never
              sent. The desc still rides `text` underneath for the brain;
              the human-facing quote is the thumbnail plus "Story". */}
          {m.replyTo.photo ? (
            <>
              <img className="qthumb" src={m.replyTo.photo} alt="" loading="lazy" />
              <span className="qcol">
                <b>{m.replyTo.from === "her" ? HER_NAME : "You"}</b>
                <span className="qtext">Story</span>
              </span>
            </>
          ) : (
            <>
              <b>{m.replyTo.from === "her" ? HER_NAME : "You"}</b>
              <span className="qtext">{m.replyTo.text.slice(0, 120)}</span>
            </>
          )}
        </div>
      )}
      {big ? (
        <BigEmoji emoji={m.text} />
      ) : emo >= 2 ? (
        <span className="emoji-run">{m.text.trim()}</span>
      ) : (
        m.text
      )}
      {(lastOfGroup || m.from === "me") && (
        <span className="t">
          {lastOfGroup && fmtTime(m.at)}
          {m.from === "me" && <TickIcon status={m.status ?? "read"} />}
        </span>
      )}
      {m.reaction && (
        // Hangs off the bubble's bottom edge, so it reads as stuck ONTO the
        // message rather than sent after it.
        <span className="react-pill" aria-label={`Reacted ${m.reaction}`}>
          {m.reaction}
        </span>
      )}
      {/* Uncovered by dragging the thread left. aria-hidden because the
          bubble's own accessible name already carries this time — a screen
          reader should not hear the clock twice per message. */}
      <span className="peek-t" aria-hidden="true">
        {fmtTime(m.at)}
      </span>
    </div>
  );
}

/**
 * Default shallow compare is exactly right here: `m` is replaced by identity
 * whenever the message changes (every writer in Chat.tsx maps to a new object),
 * `api` never changes, and everything else is a boolean.
 */
const MessageRow = memo(Row);
export default MessageRow;
