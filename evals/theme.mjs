// Light, dark, and "follow the phone".
//
// Almost everything here is structural, on the real source, because the failure
// modes of a theme are all silent. A dark block that is defined under the media
// query but not under `[data-theme="dark"]` looks fine on a dark phone and does
// nothing when someone picks Dark by hand. Two copies of the dark palette that
// have drifted apart produce an app that is subtly a different colour depending
// on HOW you asked for dark. Neither shows up in a build, a typecheck, or a
// screenshot taken by someone who already had the right OS setting.
//
// `gate0-structural` is the reason this is a predicate rather than a note in a
// review: an instruction leaked 57–98% of the time, a SQL predicate leaked 0
// times in 31,122.
import { readFileSync } from "node:fs";
import { resolveTheme, isThemeChoice, THEMES, THEME_LABEL } from "./.bundle.mjs";

// Bangalore minutes, for the "sky" mode's clock-driven half. IST is UTC+5:30
// with no DST, ever, so these are exact instants rather than approximations.
const IST = 330 * 60_000;
const DAY = 86_400_000;
const MIDNIGHT = Math.floor((Date.UTC(2026, 7, 22) + IST) / DAY) * DAY - IST;
const atMin = (m) => MIDNIGHT + m * 60_000;

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

// ── the four states ───────────────────────────────────────────────────────
// Four now, not three: "sky" joined Light/Dark/Auto (docs/DESIGN-WORLD.md §4).
// It is a MODE and not a third palette — it resolves to one of the two that
// already exist and writes the same `data-theme` an explicit pick writes,
// which is why every invariant below about the two dark blocks is unchanged.
ok("four choices, no more", THEMES.length === 4, String(THEMES.length));
ok("sky is one of them", THEMES.includes("sky"));
ok("every choice has a label", THEMES.every((t) => THEME_LABEL[t]));
ok("guard accepts the four", THEMES.every(isThemeChoice));
for (const junk of ["", "Dark", "auto", "Sky", null, undefined, 0, {}]) {
  ok(`guard rejects ${JSON.stringify(junk)}`, !isThemeChoice(junk));
}

// An explicit choice must not consult the OS at all — that is the entire
// difference between "Light" and "Auto that happens to be light right now".
ok("explicit light resolves light", resolveTheme("light") === "light");
ok("explicit dark resolves dark", resolveTheme("dark") === "dark");
// No `window` in node, so `system` must fall back rather than throw. A theme
// helper that throws server-side would take the whole bundle down.
ok("system resolves without a window", resolveTheme("system") === "light");

// ── the default, and the reason it did NOT move ───────────────────────────
// `undefined` is what every install that never opened Settings carries, and
// it still means "system". Changing its meaning would move those people off
// the OS setting they had implicitly accepted, at a time of day, on a build
// where they changed nothing — see engine/theme.ts. "sky" is stamped forward,
// at onboarding, for new installs only. This assertion is the guard on that:
// if someone later makes `undefined` mean sky, this fails and they have to
// come and read the note first.
ok("undefined still behaves as system", resolveTheme(undefined) === "light");
// ── "sky" follows the clock, not the OS ───────────────────────────────────
// The whole mode in two assertions: a light sky resolves light, a dark sky
// resolves dark, and NEITHER consults `matchMedia` (there is no window here,
// so a version that did would throw or fall back to "light" at 2am).
ok("sky at noon resolves light", resolveTheme("sky", atMin(720)) === "light");
ok("sky at 2am resolves dark", resolveTheme("sky", atMin(120)) === "dark");
ok("sky at 5am (predawn) resolves dark", resolveTheme("sky", atMin(300)) === "dark");
ok("sky at 5pm (golden) resolves light", resolveTheme("sky", atMin(1020)) === "light");
ok("sky at 6:30pm (dusk) resolves dark", resolveTheme("sky", atMin(1110)) === "dark");
// An explicit pick must still beat the sky, or "Dark" would silently stop
// working at noon for anyone on the new default.
ok("explicit dark beats a noon sky", resolveTheme("dark", atMin(720)) === "dark");
ok("explicit light beats a midnight sky", resolveTheme("light", atMin(60)) === "light");

// ── the sky choice leaves a trace of ITSELF (WS-SKYFELT) ──────────────────
//
// The owner's defect was not a bug in resolveTheme: "sky at noon resolves
// light" above is CORRECT and still is. The defect is that being correct was
// all it did — `data-theme="light"` is the same attribute explicit Light
// writes, so from 06:10 to 18:10 the two modes painted identical pixels and
// the tap read as broken.
//
// `applyTheme` now stamps a second attribute for the CHOICE. It is not a third
// palette and this eval's whole point is that it stays that way: the two dark
// blocks below are unchanged, resolveTheme is unchanged, and the only thing
// that reads the new attribute is the thread's wallpaper VEIL in world.css —
// how much of a picture you can see through, which is not a colour.
{
  const themeSrc = src("engine/theme.ts");
  ok("sky stamps a presence attribute", /setAttribute\("data-sky-choice"/.test(themeSrc));
  ok("every other choice removes it", /removeAttribute\("data-sky-choice"\)/.test(themeSrc));
}

// The Meera application, palette and settings wiring were retired in wave25.
// Keep the real shared theme engine controls without pretending its old UI ships.

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
