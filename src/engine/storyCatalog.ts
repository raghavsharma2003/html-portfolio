// Her daily story — Instagram-style. One entry per image; a story stays
// live for 24h from its `at` timestamp, then the ring disappears on its own.
//
// PUBLISHING A NEW DAY: drop the image(s) into public/stories/ and add
// entries here (id = filename stem, at = when "she posted it", desc = what's
// in it — the desc is injected into her brain so she KNOWS her own story).

import { Capacitor } from "@capacitor/core";

export interface Story {
  id: string;
  src: string; // under /stories/
  at: number; // epoch ms — when she "posted" it
  desc: string; // what's in it, for her own awareness
}

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

export const STORIES: Story[] = [
  {
    id: "2026-08-09-1",
    src: "/stories/2026-08-09-1.jpg",
    at: new Date("2026-08-09T17:40:00+05:30").getTime(),
    desc: "golden-hour POV from your bed — open book in hand, sun on the pages, plants and your photo wall behind",
  },
  {
    id: "2026-08-09-2",
    src: "/stories/2026-08-09-2.jpg",
    at: new Date("2026-08-09T17:44:00+05:30").getTime(),
    desc: "mirror selfie sitting cross-legged on the bed in the same golden light, oversized black tee, hair in a messy bun, notebook and book open in front of you",
  },
];

const LIVE_MS = 24 * 3600_000;

export const activeStories = (): Story[] =>
  STORIES.filter((s) => {
    const age = Date.now() - s.at;
    return age >= 0 && age < LIVE_MS;
  });

export const storySrc = (s: Story) => `${BASE}${s.src}`;

// short relative age, insta-style: "2h", "35m", "just now"
export function storyAge(s: Story): string {
  const mins = Math.max(0, Math.round((Date.now() - s.at) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}

// ── seen-state (device-local, like insta's grey ring) ──
const SEEN_KEY = "meera.stories.seen.v1";

export function seenStoryIds(): string[] {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function markStorySeen(id: string) {
  try {
    const seen = new Set(seenStoryIds());
    seen.add(id);
    // keep it tidy — only remember ids that could still matter
    localStorage.setItem(SEEN_KEY, JSON.stringify([...seen].slice(-40)));
  } catch {
    /* seen-state is cosmetic */
  }
}

export const hasUnseenStory = () => {
  const seen = seenStoryIds();
  return activeStories().some((s) => !seen.includes(s.id));
};

// injected into her system prompt — she knows what's on her own story
export function storyContext(): string {
  const live = activeStories();
  if (!live.length) return "";
  return `\n\nYOUR STORY TODAY (like an insta/whatsapp status they can see by tapping your profile photo): ${live
    .map((s) => s.desc)
    .join("; then ")}. You posted it yourself, so you know exactly what's in it — if they mention it ("story dekhi", "kya padh rahi thi"), react naturally like someone whose story got noticed, never confused. Don't bring it up unprompted more than once.`;
}
