// The motion lint — the animation rejection checklist, run by the build.
//
// The owner asked for the Apple-design / impeccable / animation-review skills
// to be applied. The one-off audit they imply is worth about a day: a rule
// nothing enforces is a rule the next feature quietly breaks, and this repo has
// a name for that shape — `engine-bundle-check-uncalled`, a guard that existed,
// worked, and was invoked by nothing. So the checklist is a script and the
// script is a gate.
//
// WHAT IT DOES NOT DO, deliberately: it does not have taste. It cannot tell you
// the board's browns are wrong against a warm-rose accent, or that a transition
// feels sluggish. It catches the MECHANICAL failures — the ones that are wrong
// regardless of what is being animated — and leaves judgment to eyes. Every
// rule below is one an animation reviewer would auto-block.
//
// Sources, fetched and recorded in docs/DESIGN-STANDARDS.md:
//   - emilkowalski/skills `animate` + `review-animations` (the checklist)
//   - emilkowalski/skills `apple-design` (interruptibility, springs, materials)
//   - pbakaus/impeccable (anti-patterns)
//
// ESCAPE HATCH. A deliberate exception is written next to the code, not argued
// in a review: put `motion-lint: allow <reason>` in a comment on the offending
// line or the line above it. The reason is required — an allow with no reason
// is how a checklist rots into a formality. Existing example: the 7px onboarding
// dot animates `width`, and says so.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const ALLOW = /motion-lint:\s*allow\b/;

/** Longest a UI TRANSITION may run. Looping ambience is judged separately. */
const MAX_UI_MS = 300;

/** Properties whose animation costs layout or paint on every frame. */
const LAYOUT_PROPS =
  /\b(width|height|margin|margin-\w+|padding|padding-\w+|top|left|right|bottom|inset)\b/;

const findings = [];
const note = (file, line, rule, text) =>
  findings.push({ file, line, rule, text: text.trim().slice(0, 120) });

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(css|tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

for (const path of walk(join(ROOT, "src"))) {
  const file = relative(ROOT, path);
  const src = readFileSync(path, "utf8");
  const lines = src.split("\n");
  const whole = src;
  // A comment-blind copy, newline-preserving, used ONLY to find statement
  // boundaries. Without it the scan below stops at any `;` that happens to be
  // inside prose — which it did, on this very file's own justification text.
  // Punctuation in a reason is not a statement.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .split("\n");

  lines.forEach((raw, i) => {
    const ln = i + 1;
    // An allow exempts this line if it is on it, or anywhere in the comment
    // block immediately above it. Looking back only ONE line was the first
    // version and it was wrong in the direction that matters: it rejected
    // multi-line reasons, which are the good ones. A rule that only accepts
    // terse justifications selects for terse justifications.
    // Everything between the previous STATEMENT BOUNDARY and this line is the
    // comment block attached to it, so that is where the reason may live.
    //
    // Two earlier versions of this were wrong in the same direction, which is
    // worth recording: looking back exactly one line rejected multi-line
    // reasons, and then requiring each looked-back line to LOOK like a comment
    // rejected CSS block comments, whose continuation lines are plain indented
    // prose. Both bugs punished the more thoughtful justification. Scanning to
    // the last `;`/`{`/`}` has no opinion about comment syntax at all.
    let start = i;
    while (start > 0 && !/[;{}]/.test(codeOnly[start - 1] ?? "")) start--;
    if (ALLOW.test(lines.slice(start, i + 1).join("\n"))) return;
    const line = raw.replace(/\/\*.*?\*\//g, ""); // ignore inline comments
    if (/^\s*(\/\/|\*|\/\*)/.test(raw)) return; // whole-line comment

    // 1. `transition: all` — animates properties nobody chose, including
    //    layout ones added later by someone else.
    if (/transition:\s*all\b/.test(line)) note(file, ln, "transition-all", raw);

    // 2. scale(0) entrance — a thing that grows from nothing has no size to
    //    grow FROM; it reads as a pop rather than an arrival. 0.9–0.97.
    if (/scale\(\s*0\s*\)|scale\(\s*0px\s*\)|scale3d\(\s*0\s*,/.test(line))
      note(file, ln, "scale-zero", raw);

    // 3. bare `ease-in` on UI — it delays the first movement, which is the
    //    exact moment attention is highest.
    if (/(transition|animation)[^;]*\bease-in\b(?!-out)/.test(line))
      note(file, ln, "ease-in", raw);

    // 4. layout-property animation.
    const t = line.match(/transition(?:-property)?:\s*([^;]+)/);
    if (t && LAYOUT_PROPS.test(t[1])) note(file, ln, "layout-prop", raw);

    // 5. a UI transition longer than the budget. Animations are exempt here
    //    because looping ambience (a breathing indicator, a ring pulse) is
    //    legitimately slow — rule 6 governs those instead.
    if (/transition[^;]*:/.test(line)) {
      for (const m of line.matchAll(/(\d+(?:\.\d+)?)(ms|s)\b/g)) {
        const ms = m[2] === "s" ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
        if (ms > MAX_UI_MS) note(file, ln, `over-${MAX_UI_MS}ms`, raw);
      }
    }
  });

  // 6. any file that declares @keyframes must also answer prefers-reduced-motion.
  //    Per-file rather than per-rule on purpose: the reduced-motion branch is
  //    conventionally one block at the end, and demanding it adjacent to each
  //    keyframe would push authors toward scattering it.
  if (/@keyframes/.test(whole) && !/prefers-reduced-motion/.test(whole))
    note(file, 0, "no-reduced-motion", "@keyframes with no prefers-reduced-motion branch");
}

const byRule = new Map();
for (const f of findings) byRule.set(f.rule, (byRule.get(f.rule) || 0) + 1);

if (!findings.length) {
  console.log("motion lint ok — no auto-block findings");
  process.exit(0);
}
console.log(`motion lint: ${findings.length} finding(s)\n`);
for (const f of findings) {
  console.log(`  ${f.rule.padEnd(18)} ${f.file}:${f.line}`);
  console.log(`    ${f.text}`);
}
console.log(
  "\nEach is an auto-block in the animation review standards. Fix it, or write" +
    "\n`motion-lint: allow <reason>` next to it — the reason is not optional.",
);
process.exit(1);
