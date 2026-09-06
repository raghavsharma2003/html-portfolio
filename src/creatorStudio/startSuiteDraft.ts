// Suites sell themselves (WS-R48). "Start a Suite" on site/suites.html signs
// a visitor in (if they are not already) and lands them in the studio's own
// Suite card with a Suite already created and its seat subscription already
// started - `SuiteCard.tsx` does the create/start work, reusing `orgApi.ts`'s
// existing `createSuite`/`startSuiteSubscription` verbatim (this file never
// calls the API itself). This module's whole job is getting the visitor's
// typed name/plan/seats safely across whatever the sign-in round trip does.
//
// `studioAuth.ts`'s `restoreStudioMode` solved the identical problem for
// `?mode=` and states why the obvious fix is wrong: putting the value on the
// OAuth redirect only works if it survives the PROVIDER's own redirect allow
// list, which is configured outside this repo, so a value that must survive
// the trip is remembered in `localStorage` BEFORE React mounts and read back
// after, never carried through the redirect itself. This file restates that
// exact pattern for a Suite's name, plan and seat count instead of a mode
// string - `restoreStartSuiteDraft()` is `main.tsx`'s own call, ONCE, before
// render, mirroring `restoreStudioMode()`'s own contract.
const KEY = "vyakti.studio.startSuite.v1";

export interface StartSuiteDraft {
  name: string;
  plan: "starter" | "institute";
  seats: number;
}

/** Pure. No DOM, no storage - the one place an untrusted `{name, plan,
 *  seats}` shape (from a URL query string OR a JSON.parse of whatever this
 *  browser's own localStorage held) is turned into a safe draft or nothing.
 *  Exported so an offline eval can drive the real boundary logic rather than
 *  a hand-typed re-description of it. */
export function sanitizeStartSuiteDraft(input: {
  name?: unknown;
  plan?: unknown;
  seats?: unknown;
}): StartSuiteDraft | null {
  const name = String(input?.name ?? "").trim().slice(0, 120);
  if (!name) return null;
  const plan: StartSuiteDraft["plan"] = input?.plan === "institute" ? "institute" : "starter";
  const seatsNum = Math.trunc(Number(input?.seats));
  const seats = Math.max(1, Math.min(500, Number.isFinite(seatsNum) ? seatsNum : 1));
  return { name, plan, seats };
}

/**
 * Call ONCE, before render (`main.tsx`, right beside `restoreStudioMode()`).
 * Reads an explicit `?start_suite=1&suite_name=...&suite_plan=...&suite_seats=...`
 * (site/suites.html's own redirect shape), stores the sanitised draft in
 * `localStorage`, and strips those four params from the URL immediately - so
 * a bookmark or a screenshot of the address bar never repeats someone's
 * Suite name back to them. Does nothing when the URL carries no such intent:
 * on the return trip from a sign-in redirect the draft is already in
 * storage, and this function's job here is done.
 */
export function restoreStartSuiteDraft(): void {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get("start_suite") !== "1") return;
    const draft = sanitizeStartSuiteDraft({
      name: params.get("suite_name"),
      plan: params.get("suite_plan"),
      seats: params.get("suite_seats"),
    });
    params.delete("start_suite");
    params.delete("suite_name");
    params.delete("suite_plan");
    params.delete("suite_seats");
    const q = params.toString();
    history.replaceState(null, "", `${window.location.pathname}${q ? `?${q}` : ""}${window.location.hash}`);
    if (draft) localStorage.setItem(KEY, JSON.stringify(draft));
  } catch {
    // Storage denied, or an unparseable URL. The manual "Create Suite" form
    // SuiteCard.tsx already ships still works either way - this is a
    // convenience, never the only path to a Suite.
  }
}

/**
 * Read-and-consume: the stored draft is removed as it is read, so a
 * re-render, a second mount (React StrictMode double-invoke) or a second
 * visit to the Suite card can run the automatic create-and-start flow AT
 * MOST ONCE per draft - `studioAuth.ts`'s `consumeStudioOAuthCallback`'s own
 * shape, restated for a Suite instead of a session token.
 */
export function takeStartSuiteDraft(): StartSuiteDraft | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    localStorage.removeItem(KEY);
    return sanitizeStartSuiteDraft(JSON.parse(raw));
  } catch {
    return null;
  }
}
