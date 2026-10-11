/* THE ROOM'S ONE DIALOG MECHANISM (WS-R63), not five separate copies of it.
 *
 * `context/rejected.md#ws-r43-room-dialogs-render-in-flow-not-scrolled-into-view`
 * found and did not fix this: every one of the Room's in-flow dialogs
 * (`.room-menu[role="dialog"]` - the data menu, check-ins, handoff, the
 * subscription panel, the account page) is a plain block appended AFTER
 * `.room-composer` in `RoomApp.tsx`'s own DOM order. On a conversation
 * taller than the viewport, opening one from a header button while scrolled
 * anywhere but the very bottom put the whole dialog below the fold with
 * nothing on screen telling a follower it opened at all - the exact defect
 * `#ws-r43-viewport-only-screenshot-missed-in-flow-dialogs` also describes
 * from the OTHER side (a viewport-only screenshot missed it too, for the
 * same underlying reason).
 *
 * The fix is deliberately NOT "make dialogs fixed overlays" - DESIGN-LAW and
 * WS-R43's own note both point the other way (`.room-menu`'s box-shadow and
 * radius already read as a card, but this product's dialogs stay part of the
 * document, never a layer stacked over it). So this hook does the other
 * thing an in-flow dialog can do about being off-screen: bring the reader TO
 * it, the moment it opens.
 *
 * Every one of the five callers is a component that only ever exists in the
 * tree while it is open (`{checkinsOpen && session && <CheckinsPanel/>}`,
 * `RoomApp.tsx`'s own pattern for all five) - mount IS open and unmount IS
 * close, so there is no separate `open` boolean to thread through here.
 *
 * What it does, once, on mount:
 *   1. Scrolls the dialog element into view (`block: "nearest"` - a dialog
 *      already fully visible is left exactly where it is; only an
 *      off-screen one moves, and only as far as it has to), instantly
 *      rather than smoothly under `prefers-reduced-motion: reduce`.
 *   2. Moves focus to the dialog's first focusable control, or (a dialog
 *      with no focusable content, which none of today's five are, but a
 *      future one might be) its own heading, given `tabindex="-1"` so it can
 *      take focus programmatically without joining the page's own Tab order.
 *   3. Listens for Escape and calls `onClose` - WS-R50's own rule, now written
 *      once instead of once per component.
 * And on unmount (close, by any path - Escape, a Close button, a successful
 * action that closes the panel itself):
 *   4. Returns focus to whatever had it the instant before this dialog
 *      mounted - the opener button, on every real path into this hook.
 *
 * `onClose` is read once, at mount, deliberately never re-subscribed: every
 * caller passes an inline arrow (a fresh function identity on every render of
 * the parent), and re-running this effect on that churn would re-capture
 * `opener` from whatever happened to have focus at that later moment and
 * re-run the scroll/focus steps on a dialog that never actually closed and
 * reopened. The arrow itself is stable in EFFECT (it calls a `useState`
 * setter, itself referentially stable), so calling the one captured at mount
 * is exactly as correct as calling a fresh one would have been.
 */
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function useDialogInView(onClose: () => void) {
  const ref = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const opener = (typeof document !== "undefined" ? document.activeElement : null) as HTMLElement | null;

    const el = ref.current;
    if (el) {
      const reduceMotion =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      el.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" });

      const focusable = el.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      const heading = focusable ? null : el.querySelector<HTMLElement>("h1, h2");
      const target = focusable ?? heading;
      if (target) {
        // `heading` is only ever set when nothing focusable was found (the
        // selector above never matches a heading itself) - give it a
        // tabindex so it can take focus programmatically without joining
        // the page's own Tab order.
        if (target === heading && !target.hasAttribute("tabindex")) {
          target.setAttribute("tabindex", "-1");
        }
        target.focus({ preventScroll: true });
      }
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);

    return () => {
      window.removeEventListener("keydown", onKey);
      opener?.focus?.({ preventScroll: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return ref;
}
