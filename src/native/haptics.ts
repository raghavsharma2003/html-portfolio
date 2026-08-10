// Haptics — @capacitor/haptics on device, navigator.vibrate as the web
// fallback. Spent in exactly four places (swipe-to-reply commit, call
// connect, call end, recording start): over-feedback trains people to
// ignore all of it.
//
// Always fire in the SAME handler that sets the visual state — never after
// a timeout or a transition, or the senses drift apart and the effect dies.

import { Haptics, ImpactStyle } from "@capacitor/haptics";

export { ImpactStyle };

export function tap(style: ImpactStyle = ImpactStyle.Light) {
  Haptics.impact({ style }).catch(() => {
    try {
      navigator.vibrate?.(style === ImpactStyle.Medium ? 16 : 10);
    } catch {
      /* iOS Safari has no vibrate — the visual carries it alone */
    }
  });
}
