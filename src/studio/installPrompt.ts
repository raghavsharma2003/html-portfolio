/* WS-R157. The install card's own rule — never on the first visit, ready
 * from the second, quiet for 30 days after a dismissal, iOS gets static
 * instructions instead of a button — is not a Room-specific idea. It is
 * already three PURE functions of a storage object and a string key
 * (`../room/installPrompt`'s own `noteInstallVisit`, `markInstallDismissed`,
 * `shouldShowInstallCard`), and nothing in any of the three reads a Room, a
 * follower or a slug's shape — the Room's own file simply names its
 * parameter `slug` because that is what ITS caller happens to have. This
 * workstream's own law 5 is "src/studio/installPrompt.ts (new, reusing the
 * Room's)", so this file re-exports those three functions rather than
 * retyping the identical visit-count/dismiss-window logic a second time —
 * a second copy is a second place the 30-day window or the second-visit
 * rule could drift the next time either gets edited.
 *
 * `STUDIO_INSTALL_KEY` stands in for the "slug" every call site below
 * passes: the studio is ONE installable surface (unlike a Room, which is
 * one per creator), so every studio visitor shares the same localStorage
 * key rather than being keyed per anything.
 */
export {
  noteInstallVisit,
  markInstallDismissed,
  shouldShowInstallCard,
  type InstallStorage,
  type InstallVisitState,
  type InstallCardInputs,
} from "../room/installPrompt";

export const STUDIO_INSTALL_KEY = "studio";
