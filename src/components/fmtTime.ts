// One clock formatter for the thread, shared by Chat.tsx and MessageRow.tsx.
//
// Intl formatting is not free and the thread holds up to 500 messages, each of
// which needs its time twice (the visible stamp and the bubble's accessible
// name). One formatter, and one cache keyed to the minute — the answer cannot
// change within a minute, and the map is bounded by the number of distinct
// minutes in a conversation.
//
// It lives here rather than in Chat.tsx because the bubble moved out into its
// own memoised component and both files need the same cache; two caches would
// be two Intl instances and two maps for one thread.

const timeFmt = new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
const timeCache = new Map<number, string>();

export const fmtTime = (t: number): string => {
  const key = Math.floor(t / 60_000);
  let v = timeCache.get(key);
  if (v === undefined) {
    v = timeFmt.format(t);
    if (timeCache.size > 2000) timeCache.clear();
    timeCache.set(key, v);
  }
  return v;
};
