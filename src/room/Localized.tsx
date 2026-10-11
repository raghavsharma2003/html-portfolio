// LANGUAGE TAGGING FOR SCREEN READERS, THE RENDERING HALF (WS-R79).
//
// `copy.ts`'s own `detectRoomTextLang` answers what script a piece of text
// is actually in; this file is the one place that turns that answer into a
// real DOM node carrying a real `lang` attribute - the NODE, never the
// document (`context/decisions.md#ws-r79-tag-at-the-node-not-the-document`).
// `copy.ts` stays plain TS with no JSX on purpose (`evals/room-locale/run.mjs`'s
// own comment on why, restated: it is bundled standalone by more than one
// offline eval, and adding a JSX dependency there would drag React into
// every one of them for no reason). This sibling is where the JSX lives.
//
// Every component here is presentational and stateless - a string in, a
// tagged node out - so nothing here changes WHAT is shown, only what a
// screen reader is told about it (law 4: no visual change).
import type { ReactNode } from "react";
import { detectRoomTextLang } from "./copy";

/** One piece of text whose language can differ from the surrounding
 *  document, wrapped in the smallest element that can carry a `lang`
 *  without changing layout - `span` inline, `p` block, matching whichever
 *  the caller already used before this workstream. Renders nothing for an
 *  empty string, the same "nothing to show" the callers already guarded for
 *  before this change (`room.room.bio &&`, `disclosure ?`). */
export function Localized({
  text,
  as: Tag = "span",
  className,
}: {
  text: string;
  as?: "span" | "p";
  className?: string;
}): ReactNode {
  if (!text) return null;
  return (
    <Tag lang={detectRoomTextLang(text)} className={className}>
      {text}
    </Tag>
  );
}

/** `copy.ts`'s own `withName` (`template.split("{name}").join(name)`), but
 *  splitting into real DOM siblings instead of one concatenated string, so
 *  the spliced name can carry its own `lang` distinct from the template
 *  around it. Every call site this replaces already used `withName` for
 *  rendering (never for a non-JSX use like `nav.share`'s own `text`, which
 *  keeps `withName` unchanged) - the two helpers answer the same question,
 *  one as a string and one as a node, and neither is more correct than the
 *  other for its own use. */
export function LocalizedName({ template, name }: { template: string; name: string }): ReactNode {
  const parts = template.split("{name}");
  if (parts.length === 1) return template;
  const nodes: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (part) nodes.push(<span key={`t${i}`}>{part}</span>);
    if (i < parts.length - 1 && name) {
      nodes.push(<Localized as="span" text={name} key={`n${i}`} />);
    }
  });
  return <>{nodes}</>;
}

/** A disclosure card's text, line by line - `RoomApp.tsx`/`AccountPage.tsx`'s
 *  own `.split("\n").map(...)` shape, reused rather than re-derived, each
 *  line tagged on its own rather than the whole card at once: a disclosure
 *  is one language today, but tagging per LINE costs nothing and stays
 *  correct the day a card mixes a platform sentence with a creator one. */
export function LocalizedDisclosure({ text }: { text: string }): ReactNode {
  return (
    <>
      {text.split("\n").map((line, i) => (
        <Localized as="p" text={line} key={`${i}:${line}`} />
      ))}
    </>
  );
}
