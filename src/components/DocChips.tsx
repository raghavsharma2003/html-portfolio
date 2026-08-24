// A DOCUMENT, IN THE THREAD.
//
// What is left of a file after it has been sent: its name, its format and its
// size. Not its contents — see `attachments.ts`'s note on why the bytes are
// never persisted. The text reached her once, in the turn it was sent with, and
// what stays is the same thing that stays for a person: they remember you sent
// them a PDF called `rent-agreement` in August.
//
// ── IT IS NOT A BUTTON, AND THAT IS THE HONEST CHOICE ──────────────────────
//
// A tappable chip promises to open the file. The app cannot open it: the bytes
// were never kept, there is no storage bucket for documents the way there is
// for photos, and a chip that answered a tap with nothing (or with a download
// of something we no longer hold) would be a control that lies. So it is a
// record, it looks like a record, and it does not invite a tap it cannot
// honour. If documents get a storage bucket later, this is the one file that
// has to change and the change is to make it a button.
//
// The chip is the SAME object as the compose tray's (`.tray-doc` shares the
// extension badge and the two-line text block through `docExt` / `docSize`), so
// what he staged and what he sent are recognisably the same thing.

import type { DocRef } from "./attachments";
import { docSize } from "./attachments";
import DocBadge from "./DocBadge";

interface Props {
  docs: readonly DocRef[];
}

export default function DocChips({ docs }: Props) {
  if (!docs.length) return null;
  return (
    <div className="docchips" data-tel="chat.docchips">
      {docs.map((d, i) => (
        <div className="docchip" key={`${i}-${d.name}`}>
          <DocBadge name={d.name} className="docchip-ext" />
          <span className="docchip-text">
            <span className="docchip-name">{d.name}</span>
            <span className="docchip-size">{docSize(d.size)}</span>
          </span>
        </div>
      ))}
    </div>
  );
}
