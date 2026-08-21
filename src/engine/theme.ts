// Light, dark, or whatever the phone is doing.
//
// The owner asked whether this should be light-only or choosable. Choosable,
// for a reason specific to this product rather than a general preference: the
// hours people actually talk to a companion are late ones, and a paper-white
// screen at 1am is a physical annoyance. "System" is the default because the
// person has usually already made this decision once, at the OS level, and
// asking them to make it again is a worse product than honouring it.
//
// ── how the three states are expressed ───────────────────────────────────
//
//   "light"   -> <html data-theme="light">
//   "dark"    -> <html data-theme="dark">
//   "system"  -> NO attribute at all
//
// The absent attribute is the load-bearing part. It means `system` is not a
// third palette that has to be kept in sync with the other two — it is the
// media query being left alone to decide, which is the only version of
// "follow the system" that keeps following it when the system changes at
// sunset with the app open. The stylesheet pairs this with
// `:root:not([data-theme="light"])` inside the dark media query, so an
// explicit light choice still beats a dark OS.

export type ThemeChoice = "system" | "light" | "dark";

export const THEMES: readonly ThemeChoice[] = ["system", "light", "dark"];

export function isThemeChoice(v: unknown): v is ThemeChoice {
  return v === "system" || v === "light" || v === "dark";
}

/** What the browser will actually paint, given the choice and the OS. */
export function resolveTheme(choice: ThemeChoice | undefined): "light" | "dark" {
  if (choice === "light" || choice === "dark") return choice;
  if (typeof window === "undefined" || !window.matchMedia) return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/**
 * Apply the choice to the document.
 *
 * The browser-chrome colour is READ BACK from the stylesheet rather than
 * duplicated here as a hex. That is deliberate: a colour written in two places
 * is a colour that will disagree with itself the first time one of them is
 * tuned, and the disagreement shows up as a status bar that is subtly the wrong
 * shade — visible, annoying, and very hard to attribute. The stylesheet owns
 * every colour in this app; this function only asks it what it decided.
 */
export function applyTheme(choice: ThemeChoice | undefined): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (choice === "light" || choice === "dark") root.setAttribute("data-theme", choice);
  else root.removeAttribute("data-theme");

  // Let the attribute change settle into computed styles before reading --bg
  // back out. Same tick is fine — style resolution is synchronous on read —
  // but the read must come AFTER the attribute write, never before.
  const bg = getComputedStyle(root).getPropertyValue("--bg").trim();
  if (bg) {
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = bg;
  }
}

/**
 * Watch the OS setting, for `system` only.
 *
 * Returns a teardown. Without this, choosing "system" would mean "whatever the
 * system was when the app started", which is exactly wrong at the moment it
 * matters most — the phone switching to dark at sunset while the app is open.
 * `data-theme` is already absent in this state, so the CSS flips on its own;
 * what the listener is actually for is re-reading --bg into the chrome colour.
 */
export function watchSystemTheme(choice: ThemeChoice | undefined, onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  if (choice === "light" || choice === "dark") return () => {};
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const fn = () => onChange();
  // Safari below 14 has addListener only; this app ships to real phones.
  if (mq.addEventListener) mq.addEventListener("change", fn);
  else mq.addListener(fn);
  return () => {
    if (mq.removeEventListener) mq.removeEventListener("change", fn);
    else mq.removeListener(fn);
  };
}

export const THEME_LABEL: Record<ThemeChoice, string> = {
  system: "Auto",
  light: "Light",
  dark: "Dark",
};
