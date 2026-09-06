// Two tiny template helpers, pulled out of RoomApp.tsx (WS-R139) into their
// own file so a lazy-loaded screen (`TasteScreen.tsx`) can use them without
// importing FROM `RoomApp.tsx` — that would pull the lazy chunk back into
// the eager module graph the moment RoomApp.tsx's own module runs (`LanguageSwitch.tsx`'s
// own header explains the cycle in full). `copy.ts` already carries the
// locale-generic template helpers (`withName`, `withPrice`, `withRetry`,
// `withDate`, `withDuration`); these two are Room-shell-specific counting
// templates that were never part of that file, restated here rather than
// added there.
export const withCount = (template: string, n: number) => template.split("{n}").join(String(n));

export const withIncluded = (template: string, n: number, included: number) =>
  withCount(template, n).split("{included}").join(String(included));
