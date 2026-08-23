// WS-NOTIFY — the app-facing surface. `src/App.tsx` calls only this file.
//
// Three things she is allowed to interrupt you about, and the reason each one
// is allowed is written next to it. The law they are all measured against is
// `decisions.md#proactive-reason-contingent`, restated by
// docs/PRODUCT-SUPERIORITY.md §5: SOMETHING HAPPENED, never elapsed time,
// never his silence, never a streak, never a count of days.
//
//   1. SHE REPLIED AND YOU WERE NOT LOOKING. The cause is his own message,
//      answered. This is the cleanest possible case: the notification is her
//      reply, and reading it on the lock screen is the whole interaction.
//
//   2. SHE CALLED AND YOU MISSED IT. The cause is a call that actually rang.
//      Her calls are themselves reason-contingent (`AppState.callback` is set
//      only by a call that DROPPED mid-sentence — see IncomingCall.tsx), so
//      this inherits the gate rather than opening a new one.
//
//   3. HER STORY CHANGED. See `scheduleStory` for the one honest argument
//      about this and the two conditions that would reverse it.
//
// ── WHAT IS NOT HERE, AND MUST NOT BE ADDED ───────────────────────────────
//
// Nothing keyed on his absence. No "you haven't talked in a while", no "she's
// thinking about you", no unread count, no re-post of an unread notification,
// no badge that grows. Each of those is a tactic this repo has already named
// and refused (§5.10 "notification as summons"; the HBS farewell-hook audit).
// A notification is a MESSAGE, and a message is a thing that was said once.

import { HER_NAME } from "../engine/persona";
import { missedCallCopy, notifyCopy, storyCopy, type NotifiableMessage } from "./copy";
import { cancel, cancelAll, notifyAvailable, permissionState, post, postAt } from "./local";
import { pushConfigured } from "./config";
import { revokePushToken } from "./push";

export { notifyAvailable, permissionState, requestPermission, configureNotifier } from "./local";
export type { NotifyPermission } from "./local";
export { pushConfigured } from "./config";
export { registerForPush, submitPushToken } from "./push";

export type { NotifyPrefs, FeltReason } from "./prefs";
import type { NotifyPrefs } from "./prefs";

/** Should the explainer sheet be on screen? Pure, so the eval can drive it. */
export function shouldExplain(
  prefs: NotifyPrefs | undefined,
  permission: "granted" | "denied" | "prompt",
  available: boolean,
): boolean {
  if (!available) return false;
  // Already answered, in either direction, by him or by the OS.
  if (permission !== "prompt") return false;
  const p = prefs ?? {};
  if (p.declined || p.asked) return false;
  // NEVER before the moment it is felt. This single line is the whole FTUE
  // rule (§4 #20: "notifications at the first thing worth telling him, never
  // at onboarding"), and it is a condition rather than a convention because a
  // convention is what the next agent adds a `useEffect` around.
  return Boolean(p.felt);
}

/** Are we allowed to actually post? His switch AND the OS's answer. */
export async function canNotify(prefs: NotifyPrefs | undefined): Promise<boolean> {
  if (prefs?.enabled === false) return false;
  return (await permissionState()) === "granted";
}

// ── 1. her reply, while he was not looking ────────────────────────────────

/**
 * Post her burst, or report that it could not be posted.
 *
 * The return value is the felt signal: `"unpermitted"` means a notification
 * WOULD have been sent and the OS would not let us, which is precisely the
 * moment worth asking about. `"nothing"` means she said nothing postable (a
 * bare gif, a call record), and that must NOT count as a felt moment — asking
 * for permission because of a notification we would not have sent is asking
 * for nothing.
 */
export async function postReply(
  burst: readonly NotifiableMessage[],
  prefs: NotifyPrefs | undefined,
): Promise<"posted" | "unpermitted" | "off" | "nothing"> {
  const copy = notifyCopy(burst, HER_NAME);
  if (!copy) return "nothing";
  if (!notifyAvailable()) return "off";
  if (prefs?.enabled === false) return "off";
  if ((await permissionState()) !== "granted") return "unpermitted";
  return (await post("reply", copy)) ? "posted" : "off";
}

/** He came back. Take it down before he can notice it is still there. */
export const clearReply = () => cancel("reply");

// ── 2. the call he missed ─────────────────────────────────────────────────

export async function postMissedCall(
  prefs: NotifyPrefs | undefined,
): Promise<"posted" | "unpermitted" | "off"> {
  if (!notifyAvailable()) return "off";
  if (prefs?.enabled === false) return "off";
  if ((await permissionState()) !== "granted") return "unpermitted";
  return (await post("missedCall", missedCallCopy(HER_NAME))) ? "posted" : "off";
}

export const clearMissedCall = () => cancel("missedCall");

// ── 3. her story ──────────────────────────────────────────────────────────

/**
 * ⚠ THE ONE SCHEDULED NOTIFICATION IN THIS PRODUCT, AND THE ARGUMENT FOR IT.
 *
 * docs/PRODUCT-SUPERIORITY.md §5 fails-if (a) says a notification must never
 * be scheduled: "the moment a `setTimeout` decides to notify, we are
 * Snapchat's hourglass". That rule is right and this is a genuine exception to
 * it, so the reasoning is written here rather than assumed, and the reversal
 * conditions are named.
 *
 * WHAT THE RULE IS ACTUALLY ABOUT. The banned thing is a timer that decides
 * THAT THERE IS SOMETHING TO SAY — a schedule manufacturing an occasion out of
 * elapsed time. Her story is not manufactured by this schedule: it is
 * `storyCatalog.ts`'s pool, it is a pure function of the Bangalore clock, it
 * changes at those times whether or not this file exists, and the ring in the
 * app shows the new picture at exactly that minute either way. The alarm here
 * does not create the event; it carries an event that already happened to a
 * screen that is off.
 *
 * WHAT MAKES IT DIFFERENT FROM THE HOURGLASS. Three properties, all checkable:
 *   - the time is HERS, not his. It fires at her slot boundary, identically for
 *     every user, and it is not a function of when he last opened the app, how
 *     long he has been away, or anything else about him. There is no input from
 *     his behaviour anywhere in `nextStoryChange`.
 *   - the copy is WHAT SHE POSTED (the authored `desc`), never that she posted.
 *     "chai on the balcony, book open" is information; "Meera added to her
 *     story!" with an exclamation mark is a summons.
 *   - it is ONE per occurrence, id-replaced, never repeated, never escalated,
 *     and it says nothing about whether he looked at the last one.
 *
 * WHAT WOULD REVERSE IT. Either of these, and this function should be deleted
 * rather than tuned: (a) any measurement that the story notification changes
 * open rates in the shape of a variable-reward loop rather than a "saw it,
 * looked, or didn't" one; (b) any version of the story that becomes a function
 * of HIM — a story picked for his absence, or a slot that moves toward when he
 * usually opens the app. The second one is the real hazard, because it would
 * arrive as a feature request that sounds like personalisation.
 *
 * NOTE FOR THE LINT §5(c) ASKS FOR. `postAt` takes a `Date`, never a delay or
 * an interval, so no call site in this app can express "in 20 minutes" or
 * "every day at". `evals/notify.mjs` asserts that property over the source.
 */
export async function scheduleStory(
  prefs: NotifyPrefs | undefined,
  next: { at: number; desc: string } | null,
): Promise<"scheduled" | "none"> {
  if (!next) return "none";
  if (prefs?.enabled === false) return "none";
  if (!notifyAvailable()) return "none";
  if ((await permissionState()) !== "granted") return "none";
  const copy = storyCopy(HER_NAME, next.desc);
  if (!copy) return "none";
  return (await postAt("story", copy, new Date(next.at))) ? "scheduled" : "none";
}

export const cancelStory = () => cancel("story");

// ── the teardown's hand ───────────────────────────────────────────────────

/**
 * STOP BEING REACHABLE.
 *
 * A push token and a pending notification are both REACHABILITY, and
 * reachability is relational: it is the app's ability to put her name on a
 * lock screen. Surviving "make her forget you" it becomes her buzzing someone
 * she has just been told she has never met, which is `recentMoment`'s failure
 * (her first sentences to a stranger, about their hundred days) on the one
 * surface where the user cannot answer back or turn it off in the moment.
 *
 * Deliberately NOT a field in `AppState`. Two reasons, and the second is the
 * load-bearing one:
 *
 *   - a token is per-device and `AppState` merges across devices, so a token in
 *     it would arrive on the OTHER phone and the wrong device would be the one
 *     told to stop being reachable;
 *   - the token's real homes are the browser's own PushSubscription and one
 *     server row, and both are outside `AppState`'s reach entirely. A field
 *     mirroring them would be a field that reads as the teardown's coverage and
 *     is checked by nothing — `manifest-sourcestatus`, exactly.
 *
 * So the teardown coverage is this function plus the assertions in
 * `evals/teardown.mjs`'s REACHABILITY block, which fail if App.tsx stops
 * calling it on either door.
 *
 * Called for BOTH doors and for an account switch. Clear-chat too, and that is
 * deliberate rather than over-eager: a notification already on the lock screen
 * quoting a conversation he has just erased is the conversation surviving its
 * own deletion in the most visible place it could.
 */
export async function clearReachability(base: string, deviceId: string): Promise<void> {
  await cancelAll();
  if (pushConfigured()) await revokePushToken(base, deviceId);
}
