// Exact source parity by default; --browser additionally exercises the built
// ordinary /studio route, real deferred CSS and computed auth styles.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, extname } from "node:path";
import { createServer } from "node:http";
import postcss from "postcss";

const root = fileURLToPath(new URL("../", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");
const original = read("src/studio/studio.css");
const entry = read("src/studio/studio-entry.css");
const workspace = read("src/studio/studio-workspace.css");
const app = read("src/studio/StudioApp.tsx");
let checks = 0;
function check(name, run) { run(); checks++; console.log(`ok ${name}`); }
function rules(css) {
  const result = [];
  postcss.parse(css).walkRules((rule) => {
    const ancestors = [];
    for (let p = rule.parent; p?.type !== "root"; p = p.parent) ancestors.unshift(`@${p.name} ${p.params}`);
    result.push({ selector: rule.selector, ancestors, declarations: rule.nodes.filter(n => n.type === "decl").map(n => [n.prop, n.value, !!n.important]) });
  });
  return result;
}
const originalRules = rules(original);
function assertExactSubset(css) {
  let cursor = 0;
  for (const rule of rules(css)) {
    const key = JSON.stringify(rule);
    const next = originalRules.findIndex((candidate, i) => i >= cursor && JSON.stringify(candidate) === key);
    assert.ok(next >= cursor, `Changed or reordered entry declaration: ${rule.selector}`);
    cursor = next + 1;
  }
}
check("entry declarations and ancestor conditions preserve original values and order", () => assertExactSubset(entry));
check("workspace complement preserves its original declarations and order", () => assertExactSubset(workspace));
check("entry and workspace contain every original rule exactly once", () => {
  const keys = list => list.map(rule => JSON.stringify(rule)).sort();
  assert.deepEqual(keys([...rules(entry), ...rules(workspace)]), keys(originalRules));
});
check("negative control catches a changed actual declaration", () => {
  const mutant = postcss.parse(entry);
  mutant.walkDecls("color", declaration => { declaration.value = "rebeccapurple"; });
  assert.throws(() => assertExactSubset(mutant.toString()));
});
const authCode = app.slice(app.indexOf("function AuthGate("), app.indexOf("function CreateReplicaCard("));
const authClasses = new Set([...authCode.matchAll(/className="([^"]+)"/g)].flatMap(m => m[1].split(/\s+/)));
for (const cls of ["boot-page", "mark", "spinner", "deferred-workspace", "visually-hidden"]) authClasses.add(cls);
const relevant = originalRules.filter(rule => {
  if (rule.ancestors.some(a => a.includes("keyframes"))) return rule.ancestors.some(a => a === "@keyframes spin");
  return postcss.list.comma(rule.selector).some(selector => [...selector.matchAll(/\.([a-zA-Z_][\w-]*)/g)].every(m => authClasses.has(m[1])));
});
check("all original rules matching real auth and opening-state classes remain eager", () => {
  const current = new Set(rules(entry).map(rule => JSON.stringify(rule)));
  for (const rule of relevant) assert.ok(current.has(JSON.stringify(rule)), `Missing ${rule.selector}`);
});
check("negative control catches a missing responsive auth rule", () => {
  const missing = relevant.find(rule => rule.selector.includes(".auth-page") && rule.ancestors.some(a => a.startsWith("@media")));
  assert.ok(missing);
  const current = new Set(rules(entry).map(rule => JSON.stringify(rule)));
  current.delete(JSON.stringify(missing));
  assert.ok(relevant.some(rule => !current.has(JSON.stringify(rule))));
});
check("full authenticated cascade retains its original stylesheet order", () => {
  const loader = read("src/studio/StudioWorkspaceStyles.tsx");
  assert.deepEqual([...loader.matchAll(/import "([^"]+\.css)"/g)].map(m => m[1]), ["./studio-workspace.css", "./design/honesty.css", "./design/mobile.css"]);
  const main = read("src/studio/personalMain.tsx");
  assert.ok(main.includes('import "./studio-entry.css"'));
  assert.ok(!/import "\.\/(?:studio\.css|design\/(?:honesty|mobile)\.css)"/.test(main));
});

if (process.argv.includes("--browser")) {
  const { chromium } = await import("playwright");
  const { transform } = await import("lightningcss");
  const dist = join(root, "dist");
  const cssAssets = readdirSync(join(dist, "assets")).filter(name => name.endsWith(".css"));
  // The actual new lazy module owns this asset. Fixture and creator bundles
  // retain separate historical full styles and must not be injected here.
  const fullCssAssets = new Set(cssAssets.filter(name => /^StudioWorkspaceStyles-.*\.css$/.test(name)));
  assert.ok(fullCssAssets.size, "built full workspace CSS must exist");
  const builtFullCss = transform({ filename: "original-studio-cascade.css", minify: true,
    code: Buffer.from(original + read("src/studio/design/honesty.css") + read("src/studio/design/mobile.css") + read("src/studio/auth-entry.css")),
  }).code.toString();
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".webp": "image/webp" };
  const server = createServer((req, res) => {
    const path = new URL(req.url, "http://localhost").pathname;
    const file = join(dist, path === "/studio" ? "studio.html" : path.slice(1));
    if (!file.startsWith(dist) || !existsSync(file)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}), args: ["--no-sandbox"] });
  const shots = join(root, "scratchpad", "studio-entry-css-20260907");
  mkdirSync(shots, { recursive: true });
  const snapshot = async (page, selector = ".auth-page") => page.evaluate(selector => [...document.querySelectorAll(`${selector}, ${selector} *`)].map(el => {
    const style = getComputedStyle(el);
    return { tag: el.tagName, cls: el.className, style: Object.fromEntries([...style].filter(key => !key.startsWith("--")).map(key => [key, style.getPropertyValue(key)])) };
  }), selector);
  try {
    for (const width of [390, 1440]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      const requested = [];
      page.on("request", request => requested.push(new URL(request.url()).pathname.split("/").pop()));
      await page.route("**/api/**", route => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ replicas: [] }) }));
      await page.goto(`${base}/studio`);
      await page.locator(".auth-card").waitFor();
      await page.evaluate(() => document.fonts.ready);
      assert.ok(!requested.some(name => fullCssAssets.has(name)), "signed-out page fetched workspace CSS");
      check(`built ${width}px auth does not request workspace CSS`, () => {});
      for (const state of ["email", "code"]) {
        if (state === "code") {
          await page.locator("#studio-email").fill("fixture@example.test");
          await page.getByRole("button", { name: "Email me a sign-in link" }).click();
          await page.locator("#studio-code").waitFor();
        }
        const before = await snapshot(page);
        // Compare compiled CSS on both sides. Comparing raw source to built
        // CSS would mistake minifier color normalization for a visual change.
        const baseline = await page.addStyleTag({ content: builtFullCss });
        assert.deepEqual(await snapshot(page), before, `${width}px ${state} computed styles differ from full cascade`);
        await baseline.evaluate(el => el.remove());
        check(`built ${width}px ${state} auth computed styles match full original cascade`, () => {});
      }
      await page.screenshot({ path: join(shots, `auth-code-${width}.png`), fullPage: true });
      // A real returning-session render must wait for its stylesheet before
      // showing the ordinary clone workspace. No live auth or API call occurs.
      await page.evaluate(() => localStorage.setItem("meera.state.v1", JSON.stringify({ auth: {
        userId: "css-fixture-owner", email: "fixture@example.test", accessToken: "css-fixture-not-a-real-token", refreshToken: "css-fixture-not-a-real-token", expiresAt: Date.now() + 3600000,
      } })));
      let release;
      let reached;
      const held = new Promise(resolve => { release = resolve; });
      const seen = new Promise(resolve => { reached = resolve; });
      await page.route("**/*.css", async route => {
        if (fullCssAssets.has(new URL(route.request().url()).pathname.split("/").pop())) { reached(); await held; }
        await route.continue();
      });
      await page.reload({ waitUntil: "domcontentloaded" });
      await Promise.race([seen, new Promise((_, reject) => setTimeout(() => reject(new Error("workspace CSS was not requested")), 15000))]);
      await page.locator(".deferred-workspace").waitFor();
      assert.equal(await page.locator(".vx-shell").count(), 0);
      release();
      await page.locator(".deferred-workspace").waitFor({ state: "detached" });
      await page.locator(".vx-shell").waitFor();
      await page.evaluate(() => document.fonts.ready);
      const workspaceBefore = await snapshot(page, ".vx-shell");
      const workspaceBaseline = await page.addStyleTag({ content: builtFullCss });
      assert.deepEqual(await snapshot(page, ".vx-shell"), workspaceBefore, `${width}px authenticated workspace differs from original cascade`);
      await workspaceBaseline.evaluate(el => el.remove());
      check(`built ${width}px authenticated workspace computed styles match original cascade`, () => {});
      check(`built ${width}px returning session waits for full stylesheet before workspace`, () => {});
      await page.screenshot({ path: join(shots, `workspace-${width}.png`), fullPage: true });
      await page.getByRole("button", { name: "Open account menu", exact: true }).click();
      await page.getByRole("menuitem", { name: "Sign out", exact: true }).click();
      await page.locator(".auth-card").waitFor();
      const signedOutBefore = await snapshot(page);
      const signedOutBaseline = await page.addStyleTag({ content: builtFullCss });
      assert.deepEqual(await snapshot(page), signedOutBefore, `${width}px sign-out styles differ from original cascade`);
      await signedOutBaseline.evaluate(el => el.remove());
      check(`built ${width}px sign out returns to styled auth`, () => {});
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
}
console.log(`${checks} Studio entry CSS checks passed`);
