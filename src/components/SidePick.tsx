// SidePick — which side he is playing, chosen at the table.
//
// The tester asked for two things that are one thing: *"mechanism to pick side
// chess me (black or white)"* and *"ability to play both sides chess and tic
// tac toe pe"*. The engines were already side-parametric (`herSide` has been a
// real field in `GameSession` since the activity layer landed, and every fact
// in `chessTalk.ts`/`tttTalk.ts` reads it); what did not exist was any way for
// a person to say which one he wanted. Every call site passed the same
// constant.
//
// ── why the choice is here and not in the hub ─────────────────────────────
//
// `GamesHub.tsx` states the rule this component had to obey: *"There is no
// difficulty picker, no new-game/continue fork, no lobby — a fork before a
// game is a form, and nobody fills in a form to play chess with a friend."*
// That rule is right and a colour dialog on the way in would break it, so the
// board opens INSTANTLY on the default it always used, and the choice sits on
// the table next to it, the way the pieces do.
//
// Three properties fall out of putting it there rather than in front:
//
//   1. NOTHING BLOCKS. One tap still starts a game. The pick is an
//      alternative, never a toll.
//   2. IT IS ONLY OFFERED WHILE IT IS TRUE. A side cannot be changed on move
//      nine, so the row exists exactly while the board is empty and vanishes
//      on the first move rather than sitting there greyed out.
//   3. IT WORKS THE SAME FROM BOTH DOORS. The chat invite chip and the games
//      hub open the same room, so neither has to carry a colour and neither
//      can disagree with the other about the default.
//
// Presentation only: it owns no state, knows nothing about chess or marks
// beyond the two labels it is handed, and hands a value back.

import { tap, ImpactStyle } from "../native/haptics";
import "../styles/games.css";

export interface SidePickOption<T extends string> {
  value: T;
  /** "White", "X". Short: this is a chip, not a sentence. */
  label: string;
  /** Spoken to a screen reader in place of the label when it needs words. */
  aria?: string;
}

export interface SidePickProps<T extends string> {
  /** "your side", "your mark". App-voiced, never a line she would say. */
  legend: string;
  options: readonly [SidePickOption<T>, SidePickOption<T>];
  /** HIS side, not hers. The room converts. */
  value: T;
  onChange: (v: T) => void;
  /** `chess.side` / `ttt.mark` — the telemetry stem for both halves. */
  tel?: string;
  className?: string;
}

export default function SidePick<T extends string>({
  legend,
  options,
  value,
  onChange,
  tel,
  className = "",
}: SidePickProps<T>) {
  return (
    <div
      className={`as-pick ${className}`.trim()}
      role="radiogroup"
      aria-label={legend}
    >
      <span className="as-pick-lg" aria-hidden="true">
        {legend}
      </span>
      <span className="as-pick-set">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              className="as-pick-b"
              role="radio"
              aria-checked={on}
              aria-label={o.aria ?? o.label}
              data-on={on ? "" : undefined}
              data-tel={tel ? `${tel}.${o.value}` : undefined}
              // Feedback on pointerdown and the change on click, the same
              // split every other control in this app uses: the press is felt
              // while the finger is still down, and a scroll that began on
              // this row changes nothing.
              onPointerDown={() => {
                if (!on) tap(ImpactStyle.Light);
              }}
              onClick={() => {
                if (!on) onChange(o.value);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </span>
    </div>
  );
}
