// SOURCE-ONLY until explicitly approved. Eight mounted AuthGate views, one pass.
// API responses are simulated; this does not prove provider authentication.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { dirname, resolve, join, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "personal-auth-browser-"));
const receipts = join(root, "scratchpad", `personal-auth-locale-browser-${Date.now()}`);
await mkdir(receipts, { recursive: true });
let server, browser, timer;
const rows = [];
const appPath = join(root, "src/studio/StudioApp.tsx");
const sourceHash = createHash("sha256").update(await readFile(appPath)).digest("hex");
const started = Date.now();
const eagerCssPaths = new Set(["src/studio/design/tokens.css", "src/studio/studio-entry.css", "src/studio/auth-entry.css", "src/studio/vyakti-mark.css", "src/studio/expert-experience.css"].map(path => resolve(root, path).replaceAll("\\", "/")));
const excludedCss = new Set();
const allowCss = path => eagerCssPaths.has(resolve(path).replaceAll("\\", "/")) || /\/node_modules\/@fontsource(?:-variable)?\//.test(resolve(path).replaceAll("\\", "/"));
const cssPlugin = { name: "personal-entry-css-only", setup(builder) {
  builder.onLoad({ filter: /\.css$/ }, async args => {
    if (!allowCss(args.path)) { excludedCss.add(args.path); return { contents: "", loader: "css" }; }
    return { contents: await readFile(args.path, "utf8"), loader: "css", resolveDir: dirname(args.path) };
  });
} };
let cssEvidence;
try {
  const imports = ["@fontsource-variable/geist", "@fontsource-variable/instrument-sans", "@fontsource/noto-sans-devanagari/devanagari-600.css", "./src/studio/design/tokens.css", "./src/studio/studio-entry.css", "./src/studio/auth-entry.css", "./src/studio/vyakti-mark.css"];
  const entry = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import { AuthGate } from './src/studio/StudioApp';
    import { loadStudioCopyAuth, STUDIO_COPY_TABLE } from './src/creatorStudio/copy';
    ${imports.map(path => `import ${JSON.stringify(path)};`).join("\n")}
    const params = new URLSearchParams(location.search); const lang = params.get('lang') === 'hi' ? 'hi' : 'en';
    await loadStudioCopyAuth(lang); window.fixtureCopy = STUDIO_COPY_TABLE[lang].personalAuth;
    window.acceptedSessions = []; window.fixtureReady = true;
    createRoot(document.getElementById('studio-root')).render(<AuthGate testEnvironment={params.get('theme') === 'test'} resumeIntent={null} onAuthed={session => window.acceptedSessions.push(session)} />);`;
  await build({ stdin: { contents: entry, resolveDir: root, sourcefile: "auth-fixture.tsx", loader: "tsx" }, absWorkingDir: root,
    outdir: temp, entryNames: "fixture", bundle: true, format: "esm", splitting: true, platform: "browser", jsx: "automatic", logLevel: "silent",
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".svg": "file", ".png": "file", ".webp": "file" },
    plugins: [cssPlugin, { name: "expose-real-authgate-for-fixture", setup(builder) {
      builder.onLoad({ filter: /[\\/]src[\\/]studio[\\/]StudioApp\.tsx$/ }, async args => ({ contents: `${await readFile(args.path, "utf8")}\nexport { AuthGate };`, loader: "tsx", resolveDir: dirname(args.path) }));
    } }],
  });
  // A JS bundle's generated CSS can include styles from lazy signed-in panels.
  // Link a separate eager cascade matching personalMain plus its static visual.
  const eagerImports = [...imports.slice(0, 3), "./src/studio/expert-experience.css", ...imports.slice(3)];
  const eagerBuild = await build({ stdin: { contents: eagerImports.map(path => `import ${JSON.stringify(path)};`).join("\n"), resolveDir: root, sourcefile: "auth-eager.js" },
    absWorkingDir: root, outfile: join(temp, "eager.js"), bundle: true, format: "esm", platform: "browser", logLevel: "silent",
    loader: { ".woff2": "file", ".woff": "file", ".ttf": "file", ".svg": "file", ".png": "file", ".webp": "file" },
    plugins: [cssPlugin], metafile: true,
  });
  const cssInputs = Object.keys(eagerBuild.metafile.inputs).filter(path => path.endsWith(".css"));
  assert.ok(cssInputs.length > 0);
  assert.ok(cssInputs.every(path => allowCss(resolve(root, path))), "Every emitted eager CSS input is allowed");
  cssEvidence = { method: "Separate linked eager.css plus onLoad exclusion of all deferred CSS", allowedProductPaths: [...eagerCssPaths], allowedFontPattern: "node_modules/@fontsource*/", emittedCssInputs: cssInputs, excludedDeferredCss: [...excludedCss], sha256: createHash("sha256").update(await readFile(join(temp, "eager.css"))).digest("hex") };
  await writeFile(join(receipts, "css-inputs.json"), JSON.stringify(cssEvidence, null, 2));
  const mime = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff", ".webp": "image/webp", ".svg": "image/svg+xml" };
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://local").pathname;
      if (path === "/" || path === "/studio") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/eager.css"></head><body><div id="studio-root"></div><script type="module" src="/fixture.js"></script></body></html>'); return; }
      if (path === "/second-tab") { res.setHeader("content-type", "text/html"); res.end("<!doctype html><title>Same-origin session fixture</title>"); return; }
      const base = path.startsWith("/expert/") ? join(root, "public") : temp;
      const file = resolve(base, `.${decodeURIComponent(path)}`);
      assert.ok(file.startsWith(resolve(base) + sep));
      res.setHeader("content-type", mime[extname(file)] || "application/octet-stream"); res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end("Not found"); }
  });
  await new Promise(resolveListen => server.listen(0, "127.0.0.1", resolveListen));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  let deadlineExceeded = false;
  timer = setTimeout(() => { deadlineExceeded = true; void browser.close(); }, 240_000);
  for (const lang of ["en", "hi"]) for (const width of [390, 1440]) for (const theme of ["general", "test"]) {
    const context = await browser.newContext({ viewport: { width, height: 1000 }, reducedMotion: "reduce", serviceWorkers: "block" });
    try {
      let sends = 0, verifies = 0, refreshStatus = 503;
      const calls = [], errors = [], blocked = [];
      const fresh = { access_token: "f".repeat(32), refresh_token: "fresh-refresh", expires_in: 3600, user: { id: "fresh-owner", email: "owner@example.com" } };
      await context.route("**/*", async route => {
        const request = route.request(); const url = new URL(request.url());
        if (url.origin !== origin) { blocked.push(url.origin); await route.abort(); return; }
        if (url.pathname !== "/api/account") { await route.continue(); return; }
        const body = request.postDataJSON(); calls.push(body.op);
        let status = 500, payload = { error: "PRIVATE_PROVIDER_PAYLOAD" };
        if (body.op === "send_otp") { status = ++sends === 1 ? 503 : 200; if (status === 200) payload = {}; }
        if (body.op === "verify_otp") status = ++verifies === 1 ? 429 : 400;
        if (body.op === "refresh") { status = refreshStatus; if (status === 200) payload = fresh; }
        await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(payload) });
      });
      const page = await context.newPage(); page.setDefaultTimeout(8000); page.setDefaultNavigationTimeout(15000);
      page.on("pageerror", error => errors.push(error.message));
      await page.goto(`${origin}/studio?lang=${lang}&theme=${theme}&step=meet&replica=fixture`);
      await page.locator(`[data-studio-auth-locale="${lang}"]`).waitFor();
      await page.evaluate(() => document.fonts.ready);
      const copy = await page.evaluate(() => window.fixtureCopy);
      assert.equal(await page.locator("#studio-title").innerText(), copy.variant[theme === "test" ? "test" : "generic"].introTitle);
      assert.equal(await page.locator('label[for="studio-email"]').innerText(), copy.emailLabel);
      if (theme === "general") { assert.equal(await page.locator(".legal-copy").innerText(), copy.legalNotice); assert.equal(await page.locator(".expert-entry-visual img").getAttribute("alt"), copy.visualAlt); }
      else { assert.equal(await page.locator(".legal-copy").count(), 0); assert.equal(await page.locator(".expert-entry-visual").count(), 0); }
      const geometry = await page.locator("#studio-auth-language").evaluate(node => {
        const rect = node.getBoundingClientRect(), style = getComputedStyle(node), header = node.closest("header"), headerRect = header.getBoundingClientRect();
        const rgb = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
        const luminance = color => rgb(color).map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
        const fg = luminance(style.color), bg = luminance(style.backgroundColor);
        return { width: rect.width, height: rect.height, left: rect.left, right: rect.right, headerLeft: headerRect.left, headerRight: headerRect.right, headerScroll: header.scrollWidth, headerWidth: header.clientWidth, viewport: innerWidth, ratio: (Math.max(fg, bg) + .05) / (Math.min(fg, bg) + .05), color: style.color, background: style.backgroundColor };
      });
      assert.ok(geometry.width >= 44 && geometry.height >= 44, "Actual language target is at least 44 by 44 CSS pixels");
      assert.ok(geometry.headerScroll <= geometry.headerWidth + 1 && geometry.headerLeft >= 0 && geometry.headerRight <= width + 1 && geometry.left >= 0 && geometry.right <= width, "Header and selector fit viewport");
      assert.ok(geometry.ratio >= 4.5, "Language selector text contrast meets 4.5:1");
      await page.locator(".auth-brand a").focus(); await page.keyboard.press("Tab");
      assert.equal(await page.evaluate(() => document.activeElement.id), "studio-auth-language");
      assert.ok(await page.locator("#studio-auth-language").evaluate(node => node.matches(":focus-visible") && parseFloat(getComputedStyle(node).outlineWidth) >= 2));
      await page.screenshot({ path: join(receipts, `${lang}-${width}-${theme}.png`), fullPage: true });

      const alert = page.locator(".inline-error");
      async function expectError(value) { await page.waitForFunction(expected => document.querySelector(".inline-error")?.textContent === expected, value); assert.doesNotMatch(await alert.innerText(), /PRIVATE_PROVIDER_PAYLOAD/); }
      await page.locator("#studio-email").fill("owner@example.com");
      await page.getByRole("button", { name: copy.sendLink, exact: true }).click(); await expectError(copy.serviceUnavailableError);
      await page.getByRole("button", { name: copy.sendLink, exact: true }).click(); await page.locator("#studio-code").waitFor();
      assert.equal(await page.locator('label[for="studio-code"]').innerText(), copy.codeLabel);
      assert.equal(await page.locator("#signin-title").innerText(), copy.inboxTitle);
      await page.locator("#studio-code").fill("654321");
      await page.getByRole("button", { name: copy.verify, exact: true }).click(); await expectError(copy.rateLimitError);
      assert.equal(await page.locator("#studio-code").inputValue(), "654321");
      await page.getByRole("button", { name: copy.verify, exact: true }).click(); await expectError(copy.codeMismatchError);
      assert.equal(await page.locator("#studio-code").inputValue(), "");
      await page.getByRole("button", { name: copy.differentEmail, exact: true }).click(); await page.locator("#studio-email").waitFor();
      await page.getByRole("button", { name: copy.sendLink, exact: true }).click(); await page.locator("#studio-code").waitFor();

      // Genuine same-origin second-tab storage event, not a synthetic dispatch.
      const candidate = { userId: "stale-owner", accessToken: "s".repeat(32), refreshToken: "retry-refresh", expiresAt: 1 };
      const second = await context.newPage(); await second.goto(`${origin}/second-tab`);
      await second.evaluate(value => localStorage.setItem("meera.state.v1", JSON.stringify({ auth: value, unrelated: "keep" })), candidate);
      await page.bringToFront();
      await page.getByRole("button", { name: copy.openedLink, exact: true }).click(); await expectError(copy.serviceUnavailableError);
      assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1")).auth), candidate);
      assert.deepEqual(await page.evaluate(() => window.acceptedSessions), []);
      refreshStatus = 200;
      await page.getByRole("button", { name: copy.openedLink, exact: true }).click();
      await page.waitForFunction(() => window.acceptedSessions.length > 0);
      const accepted = await page.evaluate(() => window.acceptedSessions);
      assert.ok(accepted.every(session => session.userId === "fresh-owner" && session.accessToken === "f".repeat(32)), "Only freshly refreshed sessions authenticate");
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1")).auth.userId), "fresh-owner");
      assert.deepEqual(errors, []); assert.deepEqual(blocked, []);
      rows.push({ lang, width, theme, geometry, operations: calls, acceptedCount: accepted.length, screenshot: `${lang}-${width}-${theme}.png`, passed: true });
      await writeFile(join(receipts, "progress.json"), JSON.stringify(rows, null, 2));
    } finally { await context.close(); }
  }
  assert.equal(deadlineExceeded, false); assert.equal(rows.length, 8);
  assert.equal(createHash("sha256").update(await readFile(appPath)).digest("hex"), sourceHash);
  await writeFile(join(receipts, "result.json"), JSON.stringify({ passed: true, sourceHash, cssEvidence, elapsedMs: Date.now() - started, rows }, null, 2));
  console.log(`personal-auth-locale-browser: 8 views passed; ${receipts}`);
} catch (error) {
  await writeFile(join(receipts, "failure.json"), JSON.stringify({ passed: false, sourceHash, cssEvidence, elapsedMs: Date.now() - started, error: String(error.stack || error), rows }, null, 2));
  throw error;
} finally {
  clearTimeout(timer);
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(resolveClose => server.close(resolveClose)); }
  assert.equal(dirname(resolve(temp)), resolve(tmpdir())); assert.ok(temp.split(/[\\/]/).at(-1).startsWith("personal-auth-browser-"));
  await rm(temp, { recursive: true, force: true });
}
