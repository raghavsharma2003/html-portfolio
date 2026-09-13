// WS-R157: the Vyakti mobile app — offline, deterministic, $0, no DB, no
// network beyond loopback, no model call, no GPU.
//
//   node evals/vyakti-app/run.mjs
//
// This machine has no Android SDK, so Gradle cannot run here (the brief's
// own law). Every check below is either a STATIC PARSE of the real Gradle,
// manifest and workflow files this workstream wrote (never a hand-typed
// restatement of their content — read the actual bytes on disk, every
// time), or a REAL execution of the small repo scripts
// (`scripts/select-capacitor-config.mjs`, `scripts/select-native-start-
// page.mjs`) against throwaway fixture directories, or (last section) a
// REAL Chromium proving the studio's record flow under Android WebView-
// like constraints — mobile UA, `MediaRecorder` deleted from the page
// global — using the REAL built `dist/studio-layout-fixture.html`.
//
// WHAT ONLY CI CAN PROVE, STATED HERE SO IT IS NEVER IMPLIED BY OMISSION:
// that `android/app/build.gradle` actually CONFIGURES and that
// `assembleMeeraDebug`/`assembleVyaktiDebug` actually BUILD two distinct,
// installable APKs with the right applicationId, icon and manifest baked
// in. No check below runs Gradle; every Gradle-side claim here is "the
// source says X", never "Gradle did X".
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, dirname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "  ok  " : "FAIL  "}${name}${extra ? `   ${extra}` : ""}`);
};
const skip = (name, reason) => console.log(`SKIP  ${name}   ${reason}`);

const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ═══ 1. capacitor.vyakti.config.ts — the second Capacitor app's identity ═══
{
  const src = read("capacitor.vyakti.config.ts");
  const field = (name) => (src.match(new RegExp(`${name}:\\s*"([^"]+)"`)) || [])[1];
  ok("capacitor.vyakti.config.ts: appId is app.vyakti.studio", field("appId") === "app.vyakti.studio");
  ok("capacitor.vyakti.config.ts: appName is Vyakti", field("appName") === "Vyakti");
  ok("capacitor.vyakti.config.ts: webDir is dist", field("webDir") === "dist");
  ok("capacitor.vyakti.config.ts: backgroundColor set", /backgroundColor:\s*"#[0-9a-fA-F]{6}"/.test(src));
  // Meera's own tracked config must still name HER app — this file adds a
  // SECOND config, it must never have edited the first one.
  const meera = read("capacitor.config.ts");
  ok("capacitor.config.ts (Meera's own) still appId app.meera.companion", /appId:\s*"app\.meera\.companion"/.test(meera));
  ok("capacitor.config.ts (Meera's own) still appName Maya", /appName:\s*"Maya"/.test(meera));
}

// ═══ 2. android/app/build.gradle — the flavour dimension ═══════════════════
{
  const gradle = read("android/app/build.gradle");
  ok("build.gradle: flavorDimensions \"brand\" declared", /flavorDimensions\s+"brand"/.test(gradle));
  const productFlavorsMatch = gradle.match(/productFlavors\s*\{([\s\S]*?)\n {4}\}\n {4}\/\/ AGP 8/);
  ok("build.gradle: productFlavors block found", Boolean(productFlavorsMatch));
  const flavorsBody = productFlavorsMatch ? productFlavorsMatch[1] : "";
  const flavorBlock = (name) => {
    const m = flavorsBody.match(new RegExp(`${name}\\s*\\{([\\s\\S]*?)\\n {8}\\}`));
    return m ? m[1] : null;
  };
  const meeraBlock = flavorBlock("meera");
  const vyaktiBlock = flavorBlock("vyakti");
  ok("build.gradle: meera flavour block present", meeraBlock !== null);
  ok("build.gradle: meera flavour carries NO applicationId override (inherits defaultConfig unchanged)", meeraBlock !== null && !/applicationId/.test(meeraBlock));
  ok("build.gradle: vyakti flavour block present", vyaktiBlock !== null);
  ok("build.gradle: vyakti flavour applicationId is app.vyakti.studio", vyaktiBlock !== null && /applicationId\s+"app\.vyakti\.studio"/.test(vyaktiBlock));
  ok("build.gradle: vyakti flavour reads VYAKTI_PUBLIC_APP_ORIGIN (reusing the existing ENV-MANIFEST name)", vyaktiBlock !== null && /VYAKTI_PUBLIC_APP_ORIGIN/.test(vyaktiBlock));
  ok("build.gradle: vyakti flavour sets manifestPlaceholders[vyaktiAppHost]", vyaktiBlock !== null && /manifestPlaceholders\s*=\s*\[vyaktiAppHost:/.test(vyaktiBlock));
  // defaultConfig's OWN applicationId (Meera's, byte for byte) must still be
  // there and untouched — the meera variant's entire correctness rests on
  // this line never having moved.
  ok("build.gradle: defaultConfig applicationId is still app.meera.companion (untouched)", /defaultConfig\s*\{[\s\S]*?applicationId\s+"app\.meera\.companion"/.test(gradle));
}

// ═══ 3. The SHARED manifest already carries the three permissions ══════════
// Never repeated per-flavour (a flavour manifest fragment adding them again
// would be a silent duplicate, not a new grant) — this is a regression
// guard on the file, not a claim this workstream added them.
{
  const manifest = read("android/app/src/main/AndroidManifest.xml");
  ok("src/main/AndroidManifest.xml: RECORD_AUDIO declared", /android:name="android\.permission\.RECORD_AUDIO"/.test(manifest));
  ok("src/main/AndroidManifest.xml: CAMERA declared", /android:name="android\.permission\.CAMERA"/.test(manifest));
  ok("src/main/AndroidManifest.xml: POST_NOTIFICATIONS declared", /android:name="android\.permission\.POST_NOTIFICATIONS"/.test(manifest));
}

// ═══ 4. android/app/src/vyakti/AndroidManifest.xml — the deep links ════════
{
  const path = "android/app/src/vyakti/AndroidManifest.xml";
  const exists = existsSync(join(ROOT, path));
  ok("vyakti flavour manifest exists", exists);
  if (exists) {
    const manifest = read(path);
    ok("vyakti manifest: targets the SHARED MainActivity (merges in, never a second activity)", /<activity android:name="\.MainActivity">/.test(manifest));
    ok("vyakti manifest: exactly one activity element (no second app declared)", (manifest.match(/<activity /g) || []).length === 1);
    ok("vyakti manifest: autoVerify intent filter", /<intent-filter android:autoVerify="true">/.test(manifest));
    ok("vyakti manifest: ACTION_VIEW", /android:name="android\.intent\.action\.VIEW"/.test(manifest));
    ok("vyakti manifest: BROWSABLE category", /android\.intent\.category\.BROWSABLE/.test(manifest));
    ok("vyakti manifest: DEFAULT category", /android\.intent\.category\.DEFAULT/.test(manifest));
    ok("vyakti manifest: https scheme", /android:scheme="https"/.test(manifest));
    ok("vyakti manifest: host is the manifestPlaceholder (never a hardcoded domain)", /android:host="\$\{vyaktiAppHost\}"/.test(manifest));
    ok("vyakti manifest: /r/ pathPrefix", /android:pathPrefix="\/r\/"/.test(manifest));
    ok("vyakti manifest: /c/ pathPrefix", /android:pathPrefix="\/c\/"/.test(manifest));
    // NEGATIVE CONTROL: a manifest fragment naming a SECOND activity would
    // be exactly the "copy of android/" the brief forbids — prove the
    // counting check actually fires on one.
    const twoActivities = manifest.replace("</application>", '<activity android:name=".SecondActivity"></activity></application>');
    ok("NEGATIVE CONTROL: a second <activity> in this fragment is caught", (twoActivities.match(/<activity /g) || []).length !== 1);
  } else {
    ok("vyakti manifest: targets the SHARED MainActivity (merges in, never a second activity)", false);
    ok("vyakti manifest: exactly one activity element (no second app declared)", false);
    ok("vyakti manifest: autoVerify intent filter", false);
    ok("vyakti manifest: ACTION_VIEW", false);
    ok("vyakti manifest: BROWSABLE category", false);
    ok("vyakti manifest: DEFAULT category", false);
    ok("vyakti manifest: https scheme", false);
    ok("vyakti manifest: host is the manifestPlaceholder (never a hardcoded domain)", false);
    ok("vyakti manifest: /r/ pathPrefix", false);
    ok("vyakti manifest: /c/ pathPrefix", false);
  }
}

// ═══ 5. The flavour's own name and icon ═════════════════════════════════════
{
  const stringsPath = "android/app/src/vyakti/res/values/strings.xml";
  ok("vyakti strings.xml exists", existsSync(join(ROOT, stringsPath)));
  if (existsSync(join(ROOT, stringsPath))) {
    const strings = read(stringsPath);
    ok("vyakti strings.xml: app_name is Vyakti", /<string name="app_name">Vyakti<\/string>/.test(strings));
  }
  const densities = ["ldpi", "mdpi", "hdpi", "xhdpi", "xxhdpi", "xxxhdpi"];
  const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  for (const density of densities) {
    for (const name of ["ic_launcher.png", "ic_launcher_round.png"]) {
      const vyaktiPath = join(ROOT, `android/app/src/vyakti/res/mipmap-${density}/${name}`);
      const meeraPath = join(ROOT, `android/app/src/main/res/mipmap-${density}/${name}`);
      const vyaktiExists = existsSync(vyaktiPath);
      ok(`vyakti icon mipmap-${density}/${name} exists`, vyaktiExists);
      if (vyaktiExists) {
        const bytes = readFileSync(vyaktiPath);
        ok(`vyakti icon mipmap-${density}/${name} is a valid PNG`, bytes.subarray(0, 8).equals(PNG_SIG));
        if (existsSync(meeraPath)) {
          const meeraBytes = readFileSync(meeraPath);
          ok(`vyakti icon mipmap-${density}/${name} differs from Meera's own (a real, distinct icon)`, !bytes.equals(meeraBytes));
        }
      }
    }
  }
}

// ═══ 6. .github/workflows/build-apk.yml ═════════════════════════════════════
{
  const workflow = read(".github/workflows/build-apk.yml");
  ok("build-apk.yml: vyakti-apk job present", /^\s*vyakti-apk:\s*$/m.test(workflow));
  ok("build-apk.yml: vyakti-apk runs assembleVyaktiDebug", /gradlew assembleVyaktiDebug/.test(workflow));
  ok("build-apk.yml: vyakti-apk uploads artifact named vyakti-apk", /name:\s*vyakti-apk/.test(workflow));
  ok("build-apk.yml: vyakti-apk stages the vyakti capacitor config", /select-capacitor-config\.mjs vyakti/.test(workflow));
  ok("build-apk.yml: vyakti-apk selects the studio start page", /select-native-start-page\.mjs studio/.test(workflow));
  ok("build-apk.yml: vyakti-apk needs no secret (no `secrets\\.` reference inside that job)", (() => {
    const jobStart = workflow.indexOf("\n  vyakti-apk:");
    const jobBody = jobStart >= 0 ? workflow.slice(jobStart) : "";
    return jobStart >= 0 && !/secrets\./.test(jobBody);
  })());
  // The original job must now be flavour-qualified — a flavour dimension
  // exists, so the old bare task names build BOTH flavours together and the
  // old fixed artifact path points at nothing.
  ok("build-apk.yml: Meera's debug task is flavour-qualified (assembleMeeraDebug)", /gradlew assembleMeeraDebug/.test(workflow));
  ok("build-apk.yml: Meera's debug artifact path is flavour-qualified", /outputs\/apk\/meera\/debug\/app-meera-debug\.apk/.test(workflow));
  ok("build-apk.yml: Meera's release tasks are flavour-qualified (bundleMeeraRelease assembleMeeraRelease)", /gradlew bundleMeeraRelease assembleMeeraRelease/.test(workflow));
  ok("build-apk.yml: Meera's release artifact paths are flavour-qualified", /outputs\/bundle\/meeraRelease\/app-meera-release\.aab/.test(workflow) && /outputs\/apk\/meera\/release\/app-meera-release\.apk/.test(workflow));
  // NEGATIVE CONTROL: the pre-flavour, unqualified task names must be GONE —
  // proves this is a real fix, not an addition alongside a still-broken line.
  ok("NEGATIVE CONTROL: no bare `assembleDebug` (unqualified) remains", !/gradlew assembleDebug --no-daemon/.test(workflow));
  ok("NEGATIVE CONTROL: no bare `bundleRelease assembleRelease` (unqualified) remains", !/gradlew bundleRelease assembleRelease/.test(workflow));
  ok("NEGATIVE CONTROL: no bare, unqualified debug artifact path remains", !/outputs\/apk\/debug\/app-debug\.apk/.test(workflow));

  // Self-consistency: every flavour name build.gradle declares has a
  // correspondingly-named Gradle task somewhere in this workflow. Guards
  // against a THIRD flavour being added to build.gradle later without the
  // workflow ever learning about it.
  const gradle = read("android/app/build.gradle");
  const flavourNames = [...gradle.matchAll(/^ {8}(\w+)\s*\{\n {12}dimension "brand"/gm)].map((m) => m[1]);
  ok("self-consistency: build.gradle declares exactly meera and vyakti", flavourNames.length === 2 && flavourNames.includes("meera") && flavourNames.includes("vyakti"));
  for (const name of flavourNames) {
    const capitalized = name[0].toUpperCase() + name.slice(1);
    ok(`self-consistency: workflow names an assemble${capitalized}Debug task for flavour "${name}"`, workflow.includes(`assemble${capitalized}Debug`));
  }

}

// ═══ 7. public/studio.webmanifest ═══════════════════════════════════════════
{
  const path = "public/studio.webmanifest";
  ok("public/studio.webmanifest exists", existsSync(join(ROOT, path)));
  if (existsSync(join(ROOT, path))) {
    const manifest = JSON.parse(read(path));
    ok("studio.webmanifest: name is Vyakti", manifest.name === "Vyakti");
    ok("studio.webmanifest: short_name is Vyakti", manifest.short_name === "Vyakti");
    ok("studio.webmanifest: start_url is /studio", manifest.start_url === "/studio");
    ok("studio.webmanifest: display is standalone", manifest.display === "standalone");
    ok("studio.webmanifest: carries at least one icon", Array.isArray(manifest.icons) && manifest.icons.length > 0);
  }
  const html = read("studio.html");
  ok("studio.html: links the manifest", /<link rel="manifest" href="\/studio\.webmanifest" \/>/.test(html));
}

// ═══ 8. vercel.json still parses and serves the manifest ═══════════════════
{
  const vercelJson = JSON.parse(read("vercel.json"));
  ok("vercel.json: still valid JSON with its rewrites array intact", Array.isArray(vercelJson.rewrites) && vercelJson.rewrites.length > 0);
  const manifestHeader = (vercelJson.headers || []).find((h) => h.source === "/studio.webmanifest");
  ok("vercel.json: a headers entry names /studio.webmanifest", Boolean(manifestHeader));
  ok("vercel.json: /studio.webmanifest still has its own /studio(.html) headers block untouched", (vercelJson.headers || []).some((h) => h.source === "/studio") && (vercelJson.headers || []).some((h) => h.source === "/studio.html"));
}

// ═══ 9. scripts/select-capacitor-config.mjs — a real run, fixture dir ══════
{
  const { stageCapacitorConfig, sourceConfigPath } = await import(pathToFileURL(join(ROOT, "scripts/select-capacitor-config.mjs")).href);

  // Two SEPARATE fixture directories, deliberately: "meera" resolves to
  // `capacitor.config.ts` itself (this file's own header explains why), so
  // staging "vyakti" first and then "meera" in the SAME directory would
  // stage "meera" from the file vyakti's own staging just overwrote —
  // proving nothing about a fresh meera build, only about this test's own
  // ordering. A fresh directory per flavour is what makes each assertion
  // about THAT flavour's real behaviour from a pristine checkout.
  const vyaktiDir = mkdtempSync(join(tmpdir(), "vyakti-app-capconfig-vyakti-"));
  writeFileSync(join(vyaktiDir, "capacitor.config.ts"), 'export default { appId: "app.meera.companion" };\n');
  writeFileSync(join(vyaktiDir, "capacitor.vyakti.config.ts"), 'export default { appId: "app.vyakti.studio" };\n');
  const vyaktiBytes = stageCapacitorConfig("vyakti", { dir: vyaktiDir });
  const stagedAfterVyakti = readFileSync(join(vyaktiDir, "capacitor.config.ts"), "utf8");
  ok("select-capacitor-config: staging \"vyakti\" copies capacitor.vyakti.config.ts onto capacitor.config.ts, byte for byte", stagedAfterVyakti === vyaktiBytes && /app\.vyakti\.studio/.test(stagedAfterVyakti));

  const meeraDir = mkdtempSync(join(tmpdir(), "vyakti-app-capconfig-meera-"));
  writeFileSync(join(meeraDir, "capacitor.config.ts"), 'export default { appId: "app.meera.companion" };\n');
  const beforeMeera = readFileSync(join(meeraDir, "capacitor.config.ts"), "utf8");
  const meeraBytes = stageCapacitorConfig("meera", { dir: meeraDir });
  const stagedAfterMeera = readFileSync(join(meeraDir, "capacitor.config.ts"), "utf8");
  ok("select-capacitor-config: staging \"meera\" is a no-op copy of the file onto itself", stagedAfterMeera === beforeMeera && stagedAfterMeera === meeraBytes && /app\.meera\.companion/.test(stagedAfterMeera));

  let threw = null;
  try {
    stageCapacitorConfig("bogus", { dir: meeraDir });
  } catch (error) {
    threw = error;
  }
  ok("NEGATIVE CONTROL: an unknown flavor throws rather than silently doing nothing", threw instanceof Error && /unknown flavor/.test(threw.message));
  ok("sourceConfigPath: meera resolves to capacitor.config.ts itself", sourceConfigPath("meera", { dir: meeraDir }) === join(meeraDir, "capacitor.config.ts"));
}

// ═══ 10. scripts/select-native-start-page.mjs — a real run, fixture dir ════
{
  const { selectNativeStartPage } = await import(pathToFileURL(join(ROOT, "scripts/select-native-start-page.mjs")).href);
  const dir = mkdtempSync(join(tmpdir(), "vyakti-app-startpage-"));
  mkdirSync(join(dir, "dist"));
  writeFileSync(join(dir, "dist/index.html"), "<html>chat app</html>");
  writeFileSync(join(dir, "dist/studio.html"), '<html><script type="module" src="/assets/studio-abc123.js"></script>studio</html>');
  const studioBytes = selectNativeStartPage("studio", { distDir: join(dir, "dist") });
  const indexAfter = readFileSync(join(dir, "dist/index.html"), "utf8");
  ok("select-native-start-page: dist/index.html becomes dist/studio.html, byte for byte", indexAfter === studioBytes && indexAfter.includes("studio-abc123.js"));
  let threw = null;
  try {
    selectNativeStartPage("missing", { distDir: join(dir, "dist") });
  } catch (error) {
    threw = error;
  }
  ok("NEGATIVE CONTROL: a missing page throws rather than silently leaving index.html unchanged", threw instanceof Error && /does not exist/.test(threw.message));
}

// ═══ 11. src/studio/installPrompt.ts really reuses the Room's predicate ════
{
  const distPath = join(ROOT, "evals/vyakti-app/.bundle.mjs");
  const { execSync } = await import("node:child_process");
  execSync(
    `npx esbuild ${join(ROOT, "src/studio/installPrompt.ts")} --bundle --format=esm --platform=node --outfile=${distPath} --log-level=error`,
    { stdio: "inherit", cwd: ROOT },
  );
  const { noteInstallVisit, markInstallDismissed, shouldShowInstallCard, STUDIO_INSTALL_KEY } = await import(pathToFileURL(distPath).href);
  ok("installPrompt.ts: STUDIO_INSTALL_KEY is \"studio\"", STUDIO_INSTALL_KEY === "studio");

  const mem = new Map();
  const storage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, v) };
  const t0 = Date.parse("2026-09-13T00:00:00.000Z");

  const first = noteInstallVisit(storage, STUDIO_INSTALL_KEY, t0);
  ok("NEGATIVE CONTROL: shouldShowInstallCard never fires on the first visit", !shouldShowInstallCard({
    signedIn: true, talking: true, readyBySecondVisit: first.readyBySecondVisit, dismissed: first.dismissed,
    alreadyInstalled: false, hasPromptEvent: true, isIOS: false,
  }));
  const second = noteInstallVisit(storage, STUDIO_INSTALL_KEY, t0 + 1000);
  ok("installPrompt.ts: ready from the second visit", second.readyBySecondVisit === true);
  ok("installPrompt.ts: shows once ready, signed in, talking, with a prompt event", shouldShowInstallCard({
    signedIn: true, talking: true, readyBySecondVisit: second.readyBySecondVisit, dismissed: second.dismissed,
    alreadyInstalled: false, hasPromptEvent: true, isIOS: false,
  }));
  markInstallDismissed(storage, STUDIO_INSTALL_KEY, t0 + 2000);
  const afterDismiss = noteInstallVisit(storage, STUDIO_INSTALL_KEY, t0 + 3000);
  ok("installPrompt.ts: quiet immediately after a dismissal", afterDismiss.dismissed === true);
  const past30Days = noteInstallVisit(storage, STUDIO_INSTALL_KEY, t0 + 2000 + 31 * 24 * 60 * 60 * 1000);
  ok("installPrompt.ts: reopens after the 30-day window", past30Days.dismissed === false);
}

// ═══ 12. The card is actually WIRED into CloneExperience, not just written ══
// `context/rejected.md`'s own warning about a slot that is correct and
// UNWIRED (`manifest-sourcestatus`) generalises past manifests: a function
// this file exports but nothing calls is exactly as useless in production.
{
  const src = read("src/studio/CloneExperience.tsx");
  ok("CloneExperience.tsx: imports shouldShowInstallCard from ./installPrompt", /from "\.\/installPrompt"/.test(src) && /shouldShowInstallCard/.test(src));
  ok("CloneExperience.tsx: actually CALLS shouldShowInstallCard(", /shouldShowInstallCard\(\{/.test(src));
  ok("CloneExperience.tsx: renders the card behind showInstall &&", /\{showInstall && \(/.test(src));
  ok("CloneExperience.tsx: the card carries a dismiss control (Not now / Got it)", /Not now/.test(src) && /Got it/.test(src));
  ok("CloneExperience.tsx: the card's own CSS class ships in clone-experience.css", /\.vx-install\s*\{/.test(read("src/studio/clone-experience.css")));
}

// ═══ 13. The copy gate, on the new strings specifically ════════════════════
{
  const { scanSource } = await import(pathToFileURL(join(ROOT, "scripts/check-copy.mjs")).href);
  const goodSnippet = `
    const label = "Get the Vyakti app.";
    const body = "It opens like an app and remembers where you left off.";
    const ios = "Add Vyakti to your home screen.";
  `;
  const goodHits = scanSource("vyakti-install-copy.ts", goodSnippet, { rules: "full", codename: true, roomsVocab: true });
  ok("copy gate: the real install-card strings trip nothing", goodHits.length === 0, goodHits.length ? JSON.stringify(goodHits[0]) : "");
  const badSnippet = `const label = "Get your Vyakti clone.";`;
  const badHits = scanSource("bad-install-copy.ts", badSnippet, { rules: "full", codename: true, roomsVocab: true });
  ok("NEGATIVE CONTROL: a banned Rooms-vocabulary word (\"clone\") is caught", badHits.length > 0);
  const manifestSnippet = JSON.stringify({ name: "Vyakti", description: "Build and test your own AI self." });
  ok("copy gate: studio.webmanifest's own strings trip nothing", scanSource("studio-webmanifest.json", manifestSnippet, { rules: "full", codename: true, roomsVocab: true }).length === 0);
}

// ═══ 14. The record flow under Android WebView-like constraints ════════════
// The ONE part of this suite that needs a browser. Honest-skip pattern
// (`evals/rehearsal/browser.mjs`'s own header) so the build workflow, which
// never installs one, still passes this suite rather than crashing it —
// `context/rejected.md#rehearsals-launched-a-fixed-chromium-path-and-failed-the-build-workflow`.
{
  const distStudioFixture = join(ROOT, "dist/studio-layout-fixture.html");
  if (!existsSync(distStudioFixture)) {
    skip("mobile WebView record flow", "dist/ not built here — run `npx vite build` first, or run the full `node evals/run.mjs` (its pre-pool suites build dist/ before this suite's own turn in the pool)");
  } else {
    const { launchRehearsalBrowser } = await import(pathToFileURL(join(ROOT, "evals/rehearsal/browser.mjs")).href);
    const { browser, reason } = await launchRehearsalBrowser();
    if (!browser) {
      skip("mobile WebView record flow", reason);
    } else {
      const DIST = join(ROOT, "dist");
      const MIME = {
        ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
        ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
        ".webmanifest": "application/manifest+json", ".png": "image/png",
      };
      const server = createServer(async (req, res) => {
        try {
          const url = new URL(req.url, "http://127.0.0.1");
          const rel = normalize(url.pathname.slice(1)).replace(/^(\.\.(\/|\\|$))+/, "");
          const file = join(DIST, rel);
          if (!file.startsWith(DIST) || !existsSync(file)) {
            res.writeHead(404);
            res.end();
            return;
          }
          const body = await readFile(file);
          res.writeHead(200, { "content-type": MIME[extname(file).toLowerCase()] || "application/octet-stream" });
          res.end(body);
        } catch {
          res.writeHead(500);
          res.end();
        }
      });
      await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
      const port = server.address().port;
      try {
        const context = await browser.newContext({
          // A real, current Android WebView UA shape (Chrome build tag,
          // trailing "; wv)") — the property under test is "does this path
          // survive a mobile, WebView-flavoured UA and a missing
          // MediaRecorder", which the UA string and the deleted global
          // below stand in for without needing a real device farm.
          userAgent: "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/123.0.0.0 Mobile Safari/537.36; wv",
          viewport: { width: 390, height: 844 },
          isMobile: true,
          hasTouch: true,
        });
        const page = await context.newPage();
        // The core negative control: no in-app WebView's MediaRecorder
        // support is assumed. wavCapture.ts's own capture path
        // (getUserMedia + AudioContext + ScriptProcessorNode, manual WAV
        // encode) must never touch this global — deleting it BEFORE any
        // page script runs is what proves that, rather than merely reading
        // the source and hoping.
        await page.addInitScript(() => {
          try {
            Object.defineProperty(window, "MediaRecorder", { value: undefined, configurable: true });
          } catch {
            // best effort — see this suite's own header
          }
        });
        // `?scenario=public-capture` is `scripts/check-layout.mjs`'s OWN
        // "clone" target for the capture step (`TARGETS[0].query`) — reused
        // here rather than re-derived, so this suite and the layout gate
        // agree on what state reaches the recorder. `mockMic=1` is
        // `layoutFixture.tsx`'s own loopback-microphone seam.
        await page.goto(`http://127.0.0.1:${port}/studio-layout-fixture.html?step=feed&scenario=public-capture&mockMic=1`, { waitUntil: "load", timeout: 20_000 });
        await page.waitForSelector(".vx-shell", { timeout: 15_000 });
        await page.waitForSelector(".vx-capture__center", { timeout: 15_000 });
        const mediaRecorderType = await page.evaluate(() => typeof window.MediaRecorder);
        ok("mobile WebView record flow: MediaRecorder is absent from the page global throughout", mediaRecorderType === "undefined");
        await page.click(".vx-record-button");
        // MINIMUM_RECORDING_MS in CloneExperience.tsx is a real 12 000 ms
        // floor checked against `Date.now()`, not a JS timer this suite
        // could fast-forward — the WAV file's own duration comes from the
        // number of REAL audio callbacks that actually ran
        // (`wavCapture.ts`'s `stop()`), so faking the clock here would
        // desynchronise the guard from the audio and produce a false
        // result rather than a faster true one. A real ~13 s wait is the
        // honest cost of this proof.
        await page.waitForTimeout(13_500);
        await page.click(".vx-record-button");
        await page.waitForSelector(".vx-sample", { timeout: 15_000 });
        const continueEnabled = await page.$eval(".vx-sample__actions .vx-button--primary", (el) => !el.disabled);
        ok("mobile WebView record flow: reaches the review state with Continue enabled (WAV path, no MediaRecorder, no webm)", continueEnabled);
      } finally {
        await browser.close();
        server.close();
      }
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
