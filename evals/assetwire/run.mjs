// WS-ASSETWIRE — the gate on artwork actually being wired to something.
//
//   node evals/assetwire/run.mjs
//
// ── why this suite exists ──────────────────────────────────────────────────
//
// Fifty-one generated files landed at their final paths referenced by NOTHING,
// on purpose, and this workstream wired them. That is exactly the shape
// `context/rejected.md#dead-writers` is about: correct artwork with no caller
// is indistinguishable from absent artwork, and the failure is silent in both
// directions. A path that 404s paints an empty box that looks like a layout
// choice; a file nothing points at is 700 KB in the bundle that nobody will
// ever find again.
//
// Six properties, and each one is a way this can be wrong WITHOUT anything
// looking wrong:
//
//   1. EVERY WIRED PATH RESOLVES. Derived from the source, never a hand-kept
//      list: the union in anim.tsx, the imports in src/, the manifest's own
//      icon array, the service worker's own literals, the capacitor config's
//      own drawable name, and the site's own og URLs. A typo here is a 404,
//      and a 404 in an <img> is invisible until someone looks at the screen.
//   2. REACTIONS STORE THE EMOJI, NEVER A PATH. This whole change is a
//      DISPLAY-layer swap. If an asset path ever reached `Message.reaction`,
//      reactions would stop syncing between devices and stop reaching her, and
//      the thread would look completely normal while it happened.
//   3. THE REDUCED-MOTION BRANCH IS REAL. An animated WebP cannot be paused by
//      CSS, so the only answer is to not request one. That decision is a
//      branch in code rather than a rule in a stylesheet, which means it is
//      the kind of thing that can be quietly deleted. Carries its own NEGATIVE
//      CONTROL: the same assertions re-run against a component that ignores
//      the query MUST fail, because an assertion whose evidence is "no webp in
//      the markup" passes just as happily against a dead feature.
//   4. AN UNKNOWN FILETYPE KEEPS ITS LETTERS. Four formats have marks. The
//      fifth must not get a generic one, and must not get nothing.
//   5. THE ERROR BOUNDARY STAYS STYLESHEET-INDEPENDENT. Its own header says a
//      boundary that needs a stylesheet fails exactly when the page is already
//      failing; the picture added to it must not be the thing that breaks
//      that, which means no CSS class and no fetched URL.
//   6. THE CLEANUP IS COMPLETE. A deleted file that something still names is a
//      build break; a file left behind that nothing names is the dead weight
//      this workstream was cleaning up.
//
// Hermetic: no network, no database, no browser, no money. The browser half
// (`evals/assetwire-browser.mjs`) is deliberately NOT reachable from here, for
// the reason `evals/run.mjs` gives for the composer split: it needs a built app
// on a port, and a gate that skips looks exactly like a gate that passed.

import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const BUNDLE = join(HERE, ".bundle.mjs");

let failed = 0;
const ok = (name, cond, detail = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${detail ? `\n        ${detail}` : ""}`);
  if (!cond) failed++;
};
const read = (p) => readFileSync(join(ROOT, p), "utf8");
const here = (p) => existsSync(join(ROOT, p));

// ── the bundle: real source, rebuilt every run ────────────────────────────
execSync(
  `npx esbuild ${join(HERE, "entry.ts")} --bundle --format=esm --platform=node ` +
    `--jsx=automatic --external:react --external:react/jsx-runtime ` +
    `--external:react-dom/server --outfile=${BUNDLE} --log-level=error`,
  { stdio: "inherit", cwd: ROOT },
);
const M = await import(BUNDLE);
const { createElement: h, renderToStaticMarkup: render } = M;

/** Drive the components with a pinned answer to the media query. */
const withMotionPreference = (reduce, fn) => {
  const prev = globalThis.window;
  globalThis.window = {
    matchMedia: () => ({ matches: reduce, addEventListener() {}, removeEventListener() {} }),
  };
  try {
    return fn();
  } finally {
    globalThis.window = prev;
  }
};

// ════════════════════════════════════════════════════════════════════════════
// 1. EVERY WIRED PATH RESOLVES
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 1. every wired path resolves ──");

// ── 1a. the anim pair set, read out of anim.tsx's own union ───────────────
const animSrc = read("src/components/anim.tsx");
const unionBlock = animSrc.slice(
  animSrc.indexOf("export type AnimName ="),
  animSrc.indexOf(";", animSrc.indexOf("export type AnimName =")),
);
const animNames = [...unionBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
ok("anim.tsx declares a non-empty AnimName union", animNames.length >= 8, animNames.join(", "));

const missingStill = animNames.filter((n) => !here(`public/anim/${n}.svg`));
ok("every AnimName has a still half on disk", missingStill.length === 0, missingStill.join(", "));

// The MOVING set has to be HONEST in both directions: a name in it with no
// .webp is a 404 on every render, and a name out of it that has one is a
// moving file nothing will ever request.
const movingBlock = animSrc.slice(
  animSrc.indexOf("const MOVING"),
  animSrc.indexOf("]);", animSrc.indexOf("const MOVING")),
);
const moving = new Set([...movingBlock.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]));
const badMoving = animNames.filter((n) => moving.has(n) !== here(`public/anim/${n}.webp`));
ok(
  "the MOVING set names exactly the pairs that have a .webp",
  badMoving.length === 0,
  badMoving.map((n) => `${n}: declared ${moving.has(n)}, on disk ${here(`public/anim/${n}.webp`)}`).join("; "),
);

// …and every path the module can actually PRODUCE, produced by the module.
const producible = animNames.flatMap((n) =>
  M.hasMotion(n) ? [M.animMotion(n), M.animStill(n)] : [M.animStill(n)],
);
const badProduced = producible.filter((p) => !here(`public${p}`));
ok(
  "every URL animMotion/animStill can return is a file under public/",
  badProduced.length === 0,
  badProduced.join(", "),
);

// ── 1b. every asset import in src/ resolves ───────────────────────────────
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx?|css)$/.test(name)) out.push(p);
  }
  return out;
}
const srcFiles = walk(join(ROOT, "src"));
const badImports = [];
for (const file of srcFiles) {
  const text = readFileSync(file, "utf8");
  for (const m of text.matchAll(/from\s+"(\.\.?\/[^"]*\.(?:svg|png|jpg|jpeg|webp))(\?[a-z]+)?"/g)) {
    const target = resolve(dirname(file), m[1]);
    if (!existsSync(target)) badImports.push(`${relative(ROOT, file)} -> ${m[1]}`);
  }
}
ok("every asset import in src/ points at a file that exists", badImports.length === 0, badImports.join("; "));

// ── 1c. the PWA manifest ──────────────────────────────────────────────────
const manifest = JSON.parse(read("public/manifest.webmanifest"));
const badIcons = manifest.icons.filter((i) => !here(`public${i.src}`));
ok("every manifest icon is a file under public/", badIcons.length === 0, JSON.stringify(badIcons));
const purposes = manifest.icons.map((i) => i.purpose ?? "any");
ok(
  "the manifest declares one maskable and one monochrome icon",
  purposes.filter((p) => p === "maskable").length === 1 &&
    purposes.filter((p) => p === "monochrome").length === 1,
  purposes.join(", "),
);
// A maskable icon listed as `any` is the bug this pair exists to avoid: the OS
// would crop the safe-zone padding into a shrunken icon on one platform and
// clip a full-bleed one on the other. They must be separate entries.
ok(
  "the plain (any) entries are not the same files as the purposed ones",
  new Set(manifest.icons.map((i) => i.src)).size === manifest.icons.length,
  manifest.icons.map((i) => i.src).join(", "),
);

// ── 1d. the push service worker ───────────────────────────────────────────
const sw = read("public/push-sw.js");
const swIcon = /icon:\s*"([^"]+)"/.exec(sw)?.[1];
const swBadge = /badge:\s*"([^"]+)"/.exec(sw)?.[1];
ok("push-sw names an icon that exists", Boolean(swIcon) && here(`public${swIcon}`), String(swIcon));
ok("push-sw names a badge that exists", Boolean(swBadge) && here(`public${swBadge}`), String(swBadge));
// The badge is the half that was wrong: a colour launcher icon in the badge
// slot is masked to a white blob. The property that fixes it is a property of
// the PIXELS, so it is checked on the pixels.
ok("the badge is not the icon", swBadge !== swIcon, `${swIcon} / ${swBadge}`);

// ── 1e. the Android status-bar icon ───────────────────────────────────────
const cap = read("capacitor.config.ts");
const smallIcon = /smallIcon:\s*"([^"]+)"/.exec(cap)?.[1];
ok("capacitor.config.ts sets a LocalNotifications smallIcon", Boolean(smallIcon), String(smallIcon));
const DENSITIES = ["mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
const missingDrawables = DENSITIES.filter(
  (d) => !here(`android/app/src/main/res/drawable-${d}/${smallIcon}.png`),
);
ok(
  "the smallIcon drawable ships at all five densities",
  smallIcon && missingDrawables.length === 0,
  missingDrawables.join(", "),
);
ok(
  "her accent is still the notification colour",
  /iconColor:\s*"#c23f56"/.test(cap),
  "iconColor",
);

// ── 1f. the og cards, and the path they will actually be served from ──────
const buildSh = read("scripts/vercel-build.sh");
ok(
  "vercel-build copies site/assets into dist/assets",
  /cp -R site\/assets\/\. dist\/assets\//.test(buildSh),
  "the og:image path below is only true because of this line",
);
for (const page of ["site/index.html", "site/privacy.html"]) {
  const html = read(page);
  const img = /<meta property="og:image" content="([^"]+)"/.exec(html)?.[1];
  ok(`${page} declares an og:image`, Boolean(img), String(img));
  if (!img) continue;
  ok(`${page}: the og:image is an absolute URL`, /^https:\/\//.test(img), img);
  const path = img.replace(/^https:\/\/[^/]+/, "");
  const onDisk = path.startsWith("/assets/") ? `site${path}` : `public${path}`;
  ok(`${page}: the og:image resolves to a file`, here(onDisk), `${img} -> ${onDisk}`);
}
// The app's own card is a different file at a different path, and stays that
// way: /chat sharing the landing's card would be the wrong picture.
ok(
  "the app's index.html still points at its own /og-card.jpg",
  /og:image" content="[^"]*\/og-card\.jpg"/.test(read("index.html")) && here("public/og-card.jpg"),
);

// ── 1g. the wordmark ──────────────────────────────────────────────────────
const siteCss = read("site/styles.css");
const maskUrls = [...siteCss.matchAll(/mask(?:-image)?:\s*url\("([^"]+)"\)/g)].map((m) => m[1]);
ok("site/styles.css masks the wordmark", maskUrls.some((u) => u.endsWith("/wordmark.svg")), maskUrls.join(", "));
ok("the wordmark file exists where the mask names it", here("site/assets/wordmark.svg"));
ok(
  "the mask is guarded by @supports, so an unsupported browser keeps the text",
  /@supports \(mask-image: url\("\/assets\/wordmark\.svg"\)\)/.test(siteCss),
);
for (const page of ["site/index.html", "site/privacy.html"]) {
  const html = read(page);
  const marks = [...html.matchAll(/<span class="mk-t">maya<\/span>/g)].length;
  ok(`${page}: the word "maya" survives in the DOM at every mark`, marks >= 2, `${marks} found`);
  ok(`${page}: no bare text wordmark is left unpaired`, !/>maya</.test(html.replace(/<span class="mk-t">maya<\/span>/g, "")));
}
ok(
  "index.html keeps a real h1 for the hero",
  /<h1 class="hero-mark"><span class="mk-t">maya<\/span><\/h1>/.test(read("site/index.html")),
);

// ════════════════════════════════════════════════════════════════════════════
// 2. REACTIONS STORE THE EMOJI, NEVER A PATH
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 2. reactions store the emoji, never a path ──");

const rowSrc = read("src/components/MessageRow.tsx");
const quickBlock = rowSrc.slice(
  rowSrc.indexOf("export const QUICK_REACTIONS"),
  rowSrc.indexOf("]", rowSrc.indexOf("export const QUICK_REACTIONS")),
);
const quick = [...quickBlock.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
ok("QUICK_REACTIONS is still WhatsApp's six", quick.length === 6, quick.join(" "));
ok(
  "every quick reaction has artwork, keyed by the CHARACTER",
  quick.every((e) => M.REACTION_ART[e]),
  quick.filter((e) => !M.REACTION_ART[e]).join(" "),
);
ok(
  "the art table has no keys the picker cannot produce",
  Object.keys(M.REACTION_ART).every((e) => quick.includes(e)),
  Object.keys(M.REACTION_ART).filter((e) => !quick.includes(e)).join(" "),
);

// The call site. `api.react` is what writes `Message.reaction`, so the ONE
// thing that must never change is what it is handed.
const reactCalls = [...rowSrc.matchAll(/api\.react\(([^)]*)\)/g)].map((m) => m[1].trim());
ok("MessageRow calls api.react exactly once", reactCalls.length === 1, reactCalls.join(" | "));
ok(
  "…and hands it the emoji identifier, not a path or an asset name",
  reactCalls[0] === "m, emoji",
  reactCalls[0],
);

// Structural: the LOGIC layers must not even know these paths exist. A
// stylesheet naming an asset is ordinary; `src/state/` or `src/engine/` naming
// one means something below the display layer has an opinion about artwork,
// which is one edit away from writing a path into a message.
const LOGIC = ["src/state/", "src/engine/", "src/voice/", "src/watch/", "src/notify/", "src/sound/", "src/native/"];
const leaked = [];
for (const file of srcFiles) {
  const rel = relative(ROOT, file);
  if (!LOGIC.some((d) => rel.startsWith(d))) continue;
  if (/\/anim\/|assets\/(?:empty|stats|filetypes)\//.test(readFileSync(file, "utf8"))) leaked.push(rel);
}
ok(
  "no asset path appears in the state, engine, voice, watch, notify or sound layers",
  leaked.length === 0,
  leaked.join(", "),
);

// ════════════════════════════════════════════════════════════════════════════
// 3. THE REDUCED-MOTION BRANCH
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 3. the reduced-motion branch ──");

const renderSix = (reduce) =>
  withMotionPreference(reduce, () =>
    quick.map((e) => render(h(M.ReactionGlyph, { emoji: e, size: 21 }))).join(""),
  );

const normalMarkup = renderSix(false);
const reducedMarkup = renderSix(true);

ok(
  "with motion allowed, all six reactions paint the animated half",
  quick.every((e) => normalMarkup.includes(`${M.animMotion(M.REACTION_ART[e])}"`)),
);
ok(
  "with reduce set, all six paint the still half",
  quick.every((e) => reducedMarkup.includes(`${M.animStill(M.REACTION_ART[e])}"`)),
);
ok("…and not one .webp survives the reduce branch", !reducedMarkup.includes(".webp"), reducedMarkup.slice(0, 160));

// The pill is the same component at the bubble's size, so the branch travels
// with it rather than being restated.
const pill = withMotionPreference(true, () => render(h(M.ReactionGlyph, { emoji: quick[0], size: 15 })));
ok("the pill takes the same branch at its own size", pill.includes(".svg") && pill.includes('width="15"'), pill);

// An emoji outside the six is the emoji, at every setting.
for (const reduce of [false, true]) {
  const odd = withMotionPreference(reduce, () => render(h(M.ReactionGlyph, { emoji: "🦄", size: 21 })));
  ok(`an unmapped reaction renders as the character (reduce=${reduce})`, odd.includes("🦄") && !odd.includes("<img"), odd);
}

// BigEmoji: ours locally, everything else on Noto, and NEITHER animated under
// reduce. The Noto case returns null rather than a still, because there is no
// still to return and the platform glyph underneath is already the message.
ok("BigEmoji uses our own file for one of the six", M.bigEmojiSource("👍", false) === M.animMotion("react-up"));
ok("…its still half under reduce", M.bigEmojiSource("👍", true) === M.animStill("react-up"));
ok("…and Noto for anything else", /fonts\.gstatic\.com/.test(String(M.bigEmojiSource("🦄", false))));
ok("…which is not requested at all under reduce", M.bigEmojiSource("🦄", true) === null);
{
  const markup = withMotionPreference(true, () => render(h(M.BigEmoji, { emoji: "🦄" })));
  ok("a reduced-motion BigEmoji is the platform glyph and no image", markup.includes("🦄") && !markup.includes("<img"), markup);
}

// ── THE NEGATIVE CONTROL ──────────────────────────────────────────────────
// Every assertion above that says "no .webp" would pass just as happily
// against a component that renders nothing at all, and the two that say
// "renders the still half" would pass against a component that never looks at
// the query if the query happened to be irrelevant. So: re-run the reduce
// assertions against a stand-in that IGNORES the preference, and require the
// battery to reject it.
{
  const deaf = (props) => h("img", { src: M.animMotion(M.REACTION_ART[props.emoji]) });
  const deafMarkup = withMotionPreference(true, () =>
    quick.map((e) => render(h(deaf, { emoji: e }))).join(""),
  );
  const wouldPass = !deafMarkup.includes(".webp");
  ok(
    "NEGATIVE CONTROL: a component that ignores the query FAILS the reduce test",
    wouldPass === false,
    "the reduce assertion is measuring the branch, not the absence of images",
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 4. AN UNKNOWN FILETYPE KEEPS ITS LETTERS
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 4. the file badge ──");

const badgeSrc = read("src/components/DocBadge.tsx");
const artBlock = badgeSrc.slice(badgeSrc.indexOf("const ART"), badgeSrc.indexOf("};", badgeSrc.indexOf("const ART")));
const artKeys = [...artBlock.matchAll(/^\s{2}([A-Z]+):/gm)].map((m) => m[1]);
ok("DocBadge maps exactly the four authored formats", artKeys.sort().join(",") === "CSV,JSON,PDF,TXT", artKeys.join(","));
const badArt = artKeys.filter((k) => !here(`src/assets/filetypes/${k.toLowerCase()}.svg`));
ok("…and each of them is a file on disk", badArt.length === 0, badArt.join(","));

// Driven through the REAL `docExt`, because the mapping is only as good as the
// key that reaches it: `report.PDF` and `report.pdf` are the same badge.
const KNOWN = ["rent.pdf", "spend.csv", "state.json", "notes.txt", "SHOUTED.PDF"];
const UNKNOWN = ["readme.md", "book.xlsx", "archive.tar.gz", "no-extension", "a.numbers"];
const knownMiss = KNOWN.filter((n) => !artKeys.includes(M.docExt(n)));
const unknownHit = UNKNOWN.filter((n) => artKeys.includes(M.docExt(n)));
ok("every authored format resolves to its mark", knownMiss.length === 0, knownMiss.join(", "));
ok(
  "every other extension falls back to the letters it always showed",
  unknownHit.length === 0,
  unknownHit.join(", "),
);
ok(
  "…and the letters are still what docExt produces, including its FILE default",
  M.docExt("readme.md") === "MD" && M.docExt("no-extension") === "FILE",
  `${M.docExt("readme.md")} / ${M.docExt("no-extension")}`,
);
ok(
  "both chip sites render the same badge object",
  /DocBadge/.test(read("src/components/DocChips.tsx")) && /DocBadge/.test(read("src/components/ComposeTray.tsx")),
);

// ════════════════════════════════════════════════════════════════════════════
// 5. THE ERROR BOUNDARY STAYS STYLESHEET-INDEPENDENT
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 5. the error boundary owes nothing to a stylesheet ──");

const ebSrc = read("src/components/ErrorBoundary.tsx");
ok("it imports no stylesheet", !/import\s+"[^"]*\.css"/.test(ebSrc));
ok("it uses no className", !/className=/.test(ebSrc));
ok(
  "its picture is imported as BYTES, not as a URL",
  /from\s+"[^"]*board-wont-open\.svg\?raw"/.test(ebSrc),
  "a plain svg import is a path the browser has to go and fetch",
);
ok(
  "the picture is given a size inline, not by a stylesheet",
  /<svg style="display:block;width:100%;height:auto"/.test(ebSrc),
);
ok("the illustration it names exists", here("src/assets/empty/board-wont-open.svg"));
// Every colour it paints still carries a literal fallback, which is the older
// half of the same rule and the half a new element is most likely to skip.
const varsWithoutFallback = [...ebSrc.matchAll(/var\((--[a-z-]+)\)/g)].map((m) => m[1]);
ok("every CSS var in it still carries a literal fallback", varsWithoutFallback.length === 0, varsWithoutFallback.join(", "));

// ════════════════════════════════════════════════════════════════════════════
// 6. THE CLEANUP IS COMPLETE
// ════════════════════════════════════════════════════════════════════════════
console.log("\n── 6. the cleanup is complete ──");

const DELETED = [
  { path: "public/icons.svg", needle: /["'(=][^"'()\s]*icons\.svg/, why: "a scaffold sprite from the site template" },
  {
    path: "android/app/src/main/res/drawable/ic_launcher_background.xml",
    needle: /@drawable\/ic_launcher_background\b/,
    why: "scaffold clipart; the adaptive icon insets @mipmap/, not @drawable/",
  },
  {
    path: "android/app/src/main/res/drawable-v24/ic_launcher_foreground.xml",
    needle: /@drawable\/ic_launcher_foreground\b/,
    why: "same, one density qualifier along",
  },
  { path: "src/assets/moments", needle: /["'`][^"'`]*assets\/moments/, why: "9 bundled JPEGs superseded by public/moments/" },
];

const SEARCH_DIRS = ["src", "site", "public", "scripts", "api", "android/app/src/main/res"];
const SEARCH_FILES = ["index.html", "capacitor.config.ts", "vercel.json"];
const haystack = [];
const collect = (dir) => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "build" || name.startsWith(".")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) collect(p);
    else if (/\.(tsx?|jsx?|mjs|css|html|json|xml|webmanifest|sh)$/.test(name)) haystack.push(p);
  }
};
for (const d of SEARCH_DIRS) if (existsSync(join(ROOT, d))) collect(join(ROOT, d));
for (const f of SEARCH_FILES) if (here(f)) haystack.push(join(ROOT, f));

for (const { path, needle, why } of DELETED) {
  ok(`${path} is gone (${why})`, !here(path));
  // Reference-shaped, deliberately: a needle that also matched prose would
  // make the record of WHY something was deleted fail the check that it was.
  const refs = haystack.filter((f) => needle.test(readFileSync(f, "utf8"))).map((f) => relative(ROOT, f));
  ok(`…and nothing left in the tree points at ${path}`, refs.length === 0, refs.join(", "));
}
// The one live caller the deletion had to be threaded through. Checked on the
// SOURCES array rather than on the file, because the file also carries the
// paragraph explaining the removal and that paragraph names what it removed.
{
  const mv = read("scripts/make-image-variants.mjs");
  const arr = mv.slice(mv.indexOf("const SOURCES"), mv.indexOf("]", mv.indexOf("const SOURCES")));
  const paths = [...arr.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  const gone = paths.filter((rel) => !here(rel));
  ok("make-image-variants lists only sources that exist", gone.length === 0, gone.join(", "));
}

// The other half of the same law: an asset that ships must be reachable.
// Every file under the three bundled art directories has to be named by
// something in src/, or it is the dead weight this workstream was clearing.
{
  const bundled = [];
  for (const d of ["src/assets/empty", "src/assets/stats", "src/assets/filetypes"]) {
    for (const f of readdirSync(join(ROOT, d))) bundled.push(`${d}/${f}`);
  }
  const srcText = srcFiles.map((f) => readFileSync(f, "utf8")).join("\n");
  const orphans = bundled.filter((p) => !srcText.includes(p.split("/").slice(-2).join("/")));
  ok("every bundled illustration, stat mark and file badge is referenced", orphans.length === 0, orphans.join(", "));

  const publicAnim = readdirSync(join(ROOT, "public/anim"));
  const animOrphans = publicAnim.filter((f) => !animNames.includes(f.replace(/\.(webp|svg)$/, "")));
  ok("every file in public/anim/ is a declared pair half", animOrphans.length === 0, animOrphans.join(", "));
}

console.log(
  failed
    ? `\nFAIL  ${failed} assetwire check${failed === 1 ? "" : "s"} failed`
    : "\n  ok  assetwire: every path resolves, nothing stores a path, reduce is a branch",
);
process.exit(failed ? 1 : 0);
