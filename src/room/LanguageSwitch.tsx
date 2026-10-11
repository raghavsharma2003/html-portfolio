// LanguageSwitch, pulled out of RoomApp.tsx (WS-R139) so TasteScreen.tsx and
// DataMenu.tsx can import it without a cycle back into RoomApp.tsx — those
// two files are now themselves `React.lazy`-loaded FROM RoomApp.tsx
// (`context/decisions.md#ws-r139-room-secondary-screens-are-lazy-chunks`),
// and a lazy chunk importing something back out of the file that lazily
// imports IT would defeat the whole split (the "lazy" chunk would still be
// pulled into the eager graph the moment RoomApp.tsx's own module runs,
// because ES module cycles are resolved by loading every file in the cycle
// up front). One tiny shared file, not a cycle, is the whole fix.
//
// WS-R24's own component, byte-for-byte: two words, both shown, in both
// locales, always — a follower who can only read one script still has to be
// able to find the OTHER one's name to reach it. The current locale reads as
// pressed (`aria-pressed`) rather than disabled, so it stays announced by a
// screen reader as the state it is.
import { ROOM_LANGUAGE_LABELS, ROOM_LOCALES, type RoomLocale } from "./copy";

export function LanguageSwitch({
  locale,
  busy,
  onSwitch,
}: {
  locale: RoomLocale;
  busy: boolean;
  onSwitch: (next: RoomLocale) => void;
}) {
  return (
    <div className="room-lang-switch" role="group" aria-label="हिन्दी / English">
      {ROOM_LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          className="room-lang-btn"
          // WS-R79: this button's own label is in `l`'s script, not
          // necessarily the DOCUMENT's — both are always shown, side by
          // side, in every locale (`ROOM_LANGUAGE_LABELS`'s own comment),
          // so on an English page the "हिन्दी" button needs its own `lang`
          // or a screen reader reads it in an English voice.
          lang={l}
          aria-pressed={locale === l}
          disabled={busy}
          onClick={() => onSwitch(l)}
        >
          {ROOM_LANGUAGE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
