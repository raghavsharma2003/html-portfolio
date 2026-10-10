/* THE INSTALL CARD'S OWN VISIBILITY LAW (WS-R59), pulled out of RoomApp.tsx
 * as PURE functions so `evals/room-install/run.mjs` can drive the real rule
 * with a fake storage — no browser, no `localStorage`, no React. RoomApp.tsx
 * is the only real caller; it hands these `window.localStorage` (or nothing,
 * when storage throws — private browsing, a blocked site setting) and this
 * file never touches `window`/`navigator`/`document` itself.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────
 *
 * Never on the FIRST visit to a given Room — a follower who just tapped a
 * bio link has not decided anything about this creator's AI yet, and asking
 * before the conversation has even started is the exact shape of nag
 * WS-R39's "review your settings" line was written to avoid for a different
 * screen. Ready from the SECOND visit on; once shown and dismissed (a tap on
 * "Not now", OR a completed native prompt either way), quiet for 30 days —
 * `context/rejected.md`'s `ws-r39` precedent for "never a nag", applied to
 * an install prompt instead of a settings reminder.
 *
 * Visits and dismissals are counted PER SLUG, in `localStorage` keys keyed
 * by it: a follower on their second visit to Anjali's Room has told this
 * file nothing about whether they have ever opened Priya's.
 */

export interface InstallStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const DISMISS_DAYS = 30;
const DISMISS_MS = DISMISS_DAYS * 24 * 60 * 60 * 1000;

const visitsKey = (slug: string) => `room_install_visits_${slug}`;
const dismissedKey = (slug: string) => `room_install_dismissed_${slug}`;

export interface InstallVisitState {
  visits: number;
  readyBySecondVisit: boolean;
  dismissed: boolean;
}

/**
 * Called once per mount of a real Room (never the layout fixture). Increments
 * the visit counter for THIS slug and reads back whether a live dismissal is
 * still inside its 30-day window. Best effort by construction
 * (`recordRoomArrival`'s own posture, `api/_room-surface.js`): a storage that
 * throws, or is absent, answers "not ready" rather than ever turning the
 * Room's first screen into an error over a growth feature.
 */
export function noteInstallVisit(
  storage: InstallStorage | null | undefined,
  slug: string,
  now: number,
): InstallVisitState {
  if (!storage || !slug) return { visits: 0, readyBySecondVisit: false, dismissed: false };
  try {
    const prior = Number(storage.getItem(visitsKey(slug)) || "0");
    const visits = (Number.isFinite(prior) && prior > 0 ? prior : 0) + 1;
    storage.setItem(visitsKey(slug), String(visits));
    const dismissedAt = Number(storage.getItem(dismissedKey(slug)) || "0");
    const dismissed = Number.isFinite(dismissedAt) && dismissedAt > 0 && now - dismissedAt < DISMISS_MS;
    return { visits, readyBySecondVisit: visits >= 2, dismissed };
  } catch {
    return { visits: 0, readyBySecondVisit: false, dismissed: false };
  }
}

/** A tap on "Not now", OR a completed (accepted or declined) native install
 *  prompt — either way, quiet for 30 days, never reappearing the moment the
 *  same tab reloads. */
export function markInstallDismissed(storage: InstallStorage | null | undefined, slug: string, now: number): void {
  if (!storage || !slug) return;
  try {
    storage.setItem(dismissedKey(slug), String(now));
  } catch {
    // Best effort — see `noteInstallVisit`'s own header.
  }
}

export interface InstallCardInputs {
  /** No card for a signed-out visitor — the workstream brief's own law 3. */
  signedIn: boolean;
  /** Only the conversation screen, never join/account/gone/offline. */
  talking: boolean;
  readyBySecondVisit: boolean;
  dismissed: boolean;
  /** `window.matchMedia("(display-mode: standalone)").matches` (or iOS's
   *  own `navigator.standalone`) — a browser already running installed has
   *  nothing left to offer. */
  alreadyInstalled: boolean;
  /** Whether `beforeinstallprompt` has fired and been captured this tab. */
  hasPromptEvent: boolean;
  /** iOS Safari never fires `beforeinstallprompt` at all — WebKit's own
   *  choice, not a bug this file can route around. */
  isIOS: boolean;
}

/**
 * PURE. Every law in this file's header, as one predicate. iOS is the ONE
 * browser allowed to show the card WITHOUT a captured prompt event — it is
 * rendered there as static "Add to Home Screen" instructions
 * (`RoomApp.tsx`) rather than a working button, because no such button can
 * ever exist on that platform. Every other browser with nothing to trigger
 * would be a dead end, not a hint, so it never shows there at all.
 */
export function shouldShowInstallCard(inputs: InstallCardInputs): boolean {
  if (!inputs.signedIn || !inputs.talking) return false;
  if (!inputs.readyBySecondVisit || inputs.dismissed) return false;
  if (inputs.alreadyInstalled) return false;
  return inputs.isIOS || inputs.hasPromptEvent;
}
