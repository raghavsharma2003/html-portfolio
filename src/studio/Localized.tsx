// LANGUAGE TAGGING FOR SCREEN READERS, THE RENDERING HALF (WS-R79).
//
// `src/room/Localized.tsx`'s own header, restated for the studio: `copy.ts`'s
// own `detectStudioTextLang` answers what script a piece of text is actually
// in; this file turns that answer into a real DOM node carrying a real
// `lang` attribute - the NODE, never the document
// (`context/decisions.md#ws-r79-tag-at-the-node-not-the-document`). `copy.ts`
// stays plain TS with no JSX so it can keep bundling standalone in
// `evals/studio-locale/run.mjs` the way it already does; this sibling is
// where the JSX lives.
import type { ReactNode } from "react";
import { detectStudioTextLang } from "./copy";

/** One piece of text whose language can differ from the surrounding
 *  document - a creator's own Room name shown back to them
 *  (`StudioApp.tsx`'s own `<h1>{replica.display_name}</h1>`), independent of
 *  which locale they are reading the rest of the studio's chrome in. Renders
 *  nothing for an empty string, the same "nothing to show" every caller
 *  already guarded for. */
export function Localized({
  text,
  as: Tag = "span",
  className,
}: {
  text: string;
  as?: "span" | "p" | "strong";
  className?: string;
}): ReactNode {
  if (!text) return null;
  return (
    <Tag lang={detectStudioTextLang(text)} className={className}>
      {text}
    </Tag>
  );
}
