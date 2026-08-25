// THE BADGE ON A FILE — the drawn one where we have a drawing, the letters
// where we do not.
//
// Four formats carry ~95% of what anybody attaches here, and those four have
// authored marks at `src/assets/filetypes/`. Everything else keeps the badge
// this app has always shown: the extension, in caps, in the same 38px tile.
// That fallback is not a placeholder waiting to be replaced — an extension is
// the single most recognisable thing about a file, and inventing a generic
// "document" icon for `.md` would tell the reader LESS than the word MD does.
//
// ── WHY THE MARKS ARE INLINED AND NOT <img> ───────────────────────────────
//
// They are drawn in `currentColor`, and the tile recolours: `--accent` on the
// app's own ground, `--accent-deep` on white inside his own bubble, and both
// again in dark. An <img> resolves `currentColor` against the SVG document
// rather than against the tile, so every one of those would come out the same
// black. Inlining is what makes the badge take the tile's ink.
//
// Same object in both places (`DocChips` in the thread, `ComposeTray` above the
// composer), which is the point `DocChips`'s header makes: what he staged and
// what he sent have to be recognisably the same thing.

import { docExt } from "./attachments";
import csvArt from "../assets/filetypes/csv.svg?raw";
import jsonArt from "../assets/filetypes/json.svg?raw";
import pdfArt from "../assets/filetypes/pdf.svg?raw";
import txtArt from "../assets/filetypes/txt.svg?raw";

/** Keyed by what `docExt` returns, which is the extension upper-cased. */
const ART: Readonly<Record<string, string>> = {
  CSV: csvArt,
  JSON: jsonArt,
  PDF: pdfArt,
  TXT: txtArt,
};

/** Is there a drawing for this filename? Exported for the wiring eval. */
export const hasFiletypeArt = (name: string) => docExt(name) in ART;

interface Props {
  name: string;
  /** `docchip-ext` in the thread, `tray-doc-ext` in the tray */
  className: string;
}

export default function DocBadge({ name, className }: Props) {
  const ext = docExt(name);
  const art = ART[ext];
  // `data-ext` is on BOTH branches: it is what the CSS keys the drawn variant
  // off, and what a test can read to see which branch ran without caring how
  // the mark was produced.
  if (art) {
    return (
      <span
        className={className}
        data-ext={ext}
        data-art=""
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: art }}
      />
    );
  }
  return (
    <span className={className} data-ext={ext} aria-hidden="true">
      {ext}
    </span>
  );
}
