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

let fail = 0;
const ok = (name, cond, extra = "") => {
  if (!cond) {
    fail++;
    console.log(`FAIL ${name}${extra ? " — " + extra : ""}`);
  }
};
const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

// ── the three states ──────────────────────────────────────────────────────
ok("three choices, no more", THEMES.length === 3);
ok("every choice has a label", THEMES.every((t) => THEME_LABEL[t]));
ok("guard accepts the three", THEMES.every(isThemeChoice));
for (const junk of ["", "Dark", "auto", null, undefined, 0, {}]) {
  ok(`guard rejects ${JSON.stringify(junk)}`, !isThemeChoice(junk));
}

// An explicit choice must not consult the OS at all — that is the entire
// difference between "Light" and "Auto that happens to be light right now".
ok("explicit light resolves light", resolveTheme("light") === "light");
ok("explicit dark resolves dark", resolveTheme("dark") === "dark");
// No `window` in node, so `system` must fall back rather than throw. A theme
// helper that throws server-side would take the whole bundle down.
ok("system resolves without a window", resolveTheme("system") === "light");
ok("undefined behaves as system", resolveTheme(undefined) === "light");

// ── the CSS contract ──────────────────────────────────────────────────────
const css = src("styles/global.css");

// THE ONE THAT MATTERS. Dark has to be reachable BOTH ways: by the OS setting
// and by an explicit pick. Defining only the media query is the easy mistake,
// and it makes the Dark button in Settings do nothing at all on a light phone.
const mediaDark = /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/.test(css);
const attrDark = /:root\[data-theme=["']dark["']\]/.test(css);
ok("dark is defined for the OS setting", mediaDark);
ok("dark is defined for an explicit pick", attrDark);

// And an explicit LIGHT pick has to beat a dark OS, which is what the
// :not() guard inside the media query is for. Without it, choosing Light on a
// dark phone silently does nothing.
ok(
  "an explicit light choice overrides a dark OS",
  /:root:not\(\[data-theme=["']light["']\]\)/.test(css),
);

// ── the two dark blocks must not drift ────────────────────────────────────
// Same palette, two selectors, no mixins. If they diverge, the app is one
// colour when the OS says dark and another when the user says dark — which
// nobody would think to test, and which reads as a rendering bug.
function tokensOf(block) {
  const out = new Map();
  for (const m of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    out.set(m[1], m[2].trim().replace(/\s+/g, " "));
  }
  return out;
}
function blockAfter(text, startRe) {
  const m = startRe.exec(text);
  if (!m) return null;
  // walk braces from the first { after the match
  const open = text.indexOf("{", m.index + m[0].length - 1);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return null;
}

if (mediaDark && attrDark) {
  const media = blockAfter(css, /@media\s*\(\s*prefers-color-scheme:\s*dark\s*\)/);
  const attr = blockAfter(css, /:root\[data-theme=["']dark["']\]/);
  const a = tokensOf(media || "");
  const b = tokensOf(attr || "");
  ok("the OS-dark block defines tokens", a.size > 0, `${a.size}`);
  ok("the picked-dark block defines tokens", b.size > 0, `${b.size}`);
  const onlyA = [...a.keys()].filter((k) => !b.has(k));
  const onlyB = [...b.keys()].filter((k) => !a.has(k));
  ok("both dark blocks define the same tokens", !onlyA.length && !onlyB.length,
    `os-only: ${onlyA.join(",")} | picked-only: ${onlyB.join(",")}`);
  const differing = [...a.keys()].filter((k) => b.has(k) && a.get(k) !== b.get(k));
  ok("both dark blocks agree on every value", differing.length === 0,
    differing.map((k) => `${k}: ${a.get(k)} vs ${b.get(k)}`).join(" | "));

  // A dark palette that does not restate the ground and the ink is not a dark
  // palette — it is a tint. These four carry the whole inversion.
  for (const must of ["--bg", "--surface", "--ink", "--ink-dim"]) {
    ok(`dark redefines ${must}`, a.has(must), [...a.keys()].join(",").slice(0, 120));
  }
}

// ── the wiring ────────────────────────────────────────────────────────────
// `dead-writers`: a theme module nothing calls is a Settings control that does
// nothing, and it would look completely finished.
const app = src("App.tsx");
ok("App applies the theme", /applyTheme\(/.test(app));
ok("App keeps following the OS while on system", /watchSystemTheme\(/.test(app));

// The flash. An effect runs after the first paint, so without an earlier call
// a dark-mode user watches the app go paper-white on every launch.
ok("the theme is applied before React renders", /applyTheme\(/.test(src("main.tsx")));

ok("Settings can change it", /theme:\s*t\b/.test(src("components/MoreSheet.tsx")));
ok("the choice is persisted on AppState", /theme\?:\s*ThemeChoice/.test(src("state/store.ts")));

// The board must follow the theme rather than overriding it — an explicit
// Light that gets repainted dark because a call is up is the app arguing with
// a setting the person just chose.
const chessAct = src("components/ChessActivity.tsx");
ok("the board follows the theme", /resolveTheme\(state\.theme\)/.test(chessAct));
ok("the board no longer forces dark on a call", !/status\.live \? "dark"/.test(chessAct));

console.log(fail ? `${fail} FAILURES` : "ALL PASS");
process.exit(fail ? 1 : 0);
