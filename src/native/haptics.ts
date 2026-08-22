// Haptics — @capacitor/haptics on device, navigator.vibrate as the web
// fallback.
//
// ── THE VOCABULARY (three levels, and nothing else) ────────────────────────
//
// Touch is a channel with almost no bandwidth. It can carry a handful of
// distinct meanings before it stops meaning anything at all, and the failure
// mode is not "too loud" — it is that the user stops feeling any of it, which
// silently costs you the two moments that were worth spending on. So this file
// defines exactly three levels, and every caller in the app picks one of them
// rather than inventing an intensity at the call site.
//
//   tap()     LIGHT   — "the app heard you". A deliberate act of HIS that
//                       started something: sending, committing a swipe-reply,
//                       opening the mic, a board move. Frequent, so it is the
//                       quietest thing the hardware can do.
//
//   land()    MEDIUM  — "something arrived and it is about you". A reaction
//                       going onto a message, a call connecting. Occasional.
//                       One step up because an arrival that felt identical to
//                       a keypress would not read as an arrival.
//
//   moment()  NOTIFY  — "this is a thing that happened between you two". A
//                       crossed milestone, a celebration. Rare by design: if
//                       this fires more than a few times a week it has stopped
//                       being a moment and should be a land().
//
// ── WHERE EACH ONE IS SPENT TODAY ─────────────────────────────────────────
//
//   tap()    Chat: send, swipe-reply commit, mic open, undo. ChessBoard: a
//            move. HomeScreen: a card press. CallVoice: the mute toggle.
//   land()   Chat: a reaction going on, either his or hers. CallVoice already
//            spends the identical `tap(ImpactStyle.Medium)` on connect and on
//            the curtain, which is this level under its old spelling.
//   moment() NO CALLER YET, and that is a handoff rather than an oversight:
//            the one site it belongs on is `Celebration.tsx`, which fires
//            `tap(ImpactStyle.Light)` for a crossed milestone — the rarest
//            event in the product answered with the quietest thing the phone
//            can do. That file belongs to another workstream, so the level is
//            defined and named here and the swap is a one-line change there.
//            If it is still uncalled in a month, delete it: this repo's own
//            rule is that a writer connected to nothing is worse than absent.
//
// ── WHAT DELIBERATELY GETS NOTHING ────────────────────────────────────────
//
// HER MESSAGES LAND SILENTLY. A three-bubble reply is three arrivals inside
// four seconds, and in an active conversation that is a phone buzzing
// continuously in someone's hand. The visual arrival carries it — that is what
// the bubble's entrance is FOR — and spending haptics there would drown both
// levels above it. Same reasoning for typing indicators, scroll, and anything
// ambient: a haptic is for an event, never for a state.
//
// ── THE TIMING RULE ───────────────────────────────────────────────────────
//
// Always fire in the SAME handler that sets the visual state — never after a
// timeout or a transition, or the senses drift apart and the effect dies.

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";

export { ImpactStyle };

/** Level 1 — he did something and the app felt it. */
export function tap(style: ImpactStyle = ImpactStyle.Light) {
  Haptics.impact({ style }).catch(() => {
    try {
      navigator.vibrate?.(style === ImpactStyle.Medium ? 16 : 10);
    } catch {
      /* iOS Safari has no vibrate — the visual carries it alone */
    }
  });
}

/** Level 2 — something arrived: a reaction on his message, a call connecting. */
export function land() {
  tap(ImpactStyle.Medium);
}

/**
 * Level 3 — a moment between them. `notification` rather than a heavy impact
 * because a milestone is not a collision: on iOS this is the two-beat success
 * pattern, which reads as an event rather than as a bigger thump. The web
 * fallback spells the same two beats out by hand.
 */
export function moment() {
  Haptics.notification({ type: NotificationType.Success }).catch(() => {
    try {
      navigator.vibrate?.([14, 60, 22]);
    } catch {
      /* no vibrate — the visual carries it alone */
    }
  });
}
