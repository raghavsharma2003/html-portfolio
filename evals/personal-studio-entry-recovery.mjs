// Browser fixture for the real parent entry. It injects only the session and
// deferred-module boundaries so the recovery path is exercised without a
// provider or workspace API call. The account responses are local fixtures.
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temp = await mkdtemp(join(tmpdir(), "personal-studio-entry-recovery-"));
let browser, server;
try {
  const source = `import React from "react";
    import { createRoot } from "react-dom/client";
    import PersonalStudioEntry from "./src/studio/PersonalStudioEntry";
    import "./src/studio/design/tokens.css"; import "./src/studio/studio-entry.css"; import "./src/studio/auth-entry.css"; import "./src/studio/vyakti-mark.css";
    const session = { userId:"fixture-owner", email:"owner@example.com", accessToken:"a".repeat(24), refreshToken:"refresh", expiresAt:Date.now()+600000 };
    let loads=0, retries=0, received=[];
    const Workspace = props => { received.push(props); return <main data-fixture-workspace="ready">workspace ready</main>; };
    const root = createRoot(document.getElementById("studio-root"));
    if (window.fixtureCallbackCase) {
      window.fetch = async input => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        if (path === "/api/replica") return new Response(JSON.stringify({replicas:[{replica_id:window.fixtureOwnedReplica}]}), {status:200,headers:{"content-type":"application/json"}});
        return new Response(JSON.stringify({error:"unexpected " + path}),{status:500,headers:{"content-type":"application/json"}});
      };
      const CallbackWorkspace = () => <main data-fixture-workspace="callback" data-search={location.search}>callback workspace</main>;
      root.render(<PersonalStudioEntry restore={async()=>session} loadWorkspace={async()=>({default:CallbackWorkspace})} />);
    } else if (new URLSearchParams(location.search).has("reload")) {
      const loadWorkspace = () => localStorage.getItem("fixture.workspace.reload.retry")
        ? Promise.resolve({default:Workspace})
        : (localStorage.setItem("fixture.workspace.reload.retry", "1"), Promise.reject(new Error("fixture deferred chunk unavailable")));
      root.render(<PersonalStudioEntry loadWorkspace={loadWorkspace} />);
    } else {
    const loadWorkspace = () => ++loads === 1 ? Promise.reject(new Error("fixture deferred chunk unavailable")) : Promise.resolve({default:Workspace});
    window.fixture = {get loads(){return loads},get retries(){return retries},get received(){return received}};
    window.startRecovery = () => root.render(<PersonalStudioEntry restore={async()=>session} loadWorkspace={loadWorkspace} retryWorkspace={()=>{retries++}} />);
    window.startRelogin = () => {
      root.unmount(); const replacement = createRoot(document.getElementById("studio-root")); let replicaReads=0;
      const replacementSession = { ...session, accessToken:"b".repeat(24) };
      window.fixture.relogin = { get replicaReads(){return replicaReads}, replacementSession };
      window.fetch = async (input, init={}) => {
        const path = new URL(typeof input === "string" ? input : input.url, location.href).pathname;
        if (path === "/api/replica") return new Response(JSON.stringify(++replicaReads === 1 ? {error:"expired"} : {replicas:[]}), {status:replicaReads === 1 ? 401 : 200, headers:{"content-type":"application/json"}});
        if (path === "/api/account") { const body=JSON.parse(init.body); if(body.op === "send_otp") return new Response("{}",{status:200}); if(body.op === "verify_otp") return new Response(JSON.stringify({access_token:replacementSession.accessToken,refresh_token:replacementSession.refreshToken,expires_in:3600,user:{id:replacementSession.userId,email:replacementSession.email}}),{status:200,headers:{"content-type":"application/json"}}); }
        return new Response(JSON.stringify({error:"unexpected " + path}),{status:500,headers:{"content-type":"application/json"}});
      };
      replacement.render(<PersonalStudioEntry restore={async()=>session} />);
    };
    window.startRecovery(); }`;
  await build({
    stdin: { contents: source, resolveDir: root, sourcefile: "personal-studio-entry-recovery.tsx", loader: "tsx" },
    absWorkingDir: root,
    outdir: temp,
    entryNames: "fixture",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    jsx: "automatic",
    logLevel: "silent",
    define: { "import.meta.env": "{}", "process.env.NODE_ENV": '"production"' },
    loader: { ".woff2": "file", ".woff": "file", ".svg": "file", ".png": "file", ".webp": "file" },
    plugins: [{
      name: "public-root-assets",
      setup(bundle) {
        bundle.onResolve({ filter: /^\/expert\// }, args => ({ path: args.path, external: true }));
      },
    }],
  });
  const mime = { ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".webp": "image/webp" };
  server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url, "http://local").pathname;
      if (path === "/" || path === "/studio") { res.setHeader("content-type", "text/html; charset=utf-8"); res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="studio-root"></div><script type="module" src="/fixture.js"></script>'); return; }
      const publicAsset = path.startsWith("/expert/");
      const base = publicAsset ? resolve(root, "public") : resolve(temp);
      const file = resolve(base, `.${decodeURIComponent(path)}`);
      assert.ok(file.startsWith(base + sep));
      res.setHeader("content-type", mime[extname(file)] || "application/octet-stream"); res.end(await readFile(file));
    } catch { res.statusCode = 404; res.end("Not found"); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  browser = await launchSuiteBrowser("personal-studio-entry-recovery");
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/studio`);
  await page.getByRole("alert").waitFor();
  assert.match(await page.getByRole("alert").innerText(), /studio could not open/i);
  assert.equal(await page.locator("[data-fixture-workspace=ready]").count(), 0, "a rejected lazy module never renders a plausible workspace");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await page.locator("[data-fixture-workspace=ready]").waitFor();
  const fixture = await page.evaluate(() => window.fixture);
  assert.equal(fixture.loads, 2, "retry creates a fresh lazy module load");
  assert.equal(fixture.retries, 1, "the recovery action is functional, not a no-op");
  assert.equal(fixture.received.length, 1);
  assert.deepEqual(fixture.received[0], { initialSession: { userId:"fixture-owner", email:"owner@example.com", accessToken:"a".repeat(24), refreshToken:"refresh", expiresAt: fixture.received[0].initialSession.expiresAt }, sessionAlreadyRestored: true });
  assert.deepEqual(errors, [], "the boundary owns the rejected module error");
  await page.evaluate(() => window.startRelogin());
  await page.locator("#studio-email").waitFor();
  assert.equal(await page.locator("#studio-email").inputValue(), "owner@example.com", "the internal sign-out preserves the owner context for relogin");
  await page.getByRole("button", { name: "Email me a sign-in link", exact: true }).click();
  await page.locator("#studio-code").waitFor();
  await page.locator("#studio-code").fill("123456");
  await page.getByRole("button", { name: "Verify and enter", exact: true }).click();
  await page.waitForFunction(() => window.fixture.relogin.replicaReads === 2);
  assert.equal(await page.locator("#studio-email").count(), 0, "relogin returns to the internal workspace instead of the parent auth screen");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1")).auth.accessToken), "b".repeat(24));
  const resumeReplica = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const resumeRequest = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const callbackEnvelope = {version:1,created_at:Date.now(),replica:resumeReplica,step:"meet",view:"rehearsal",rehearsal_request:resumeRequest};
  const callbackContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await callbackContext.addInitScript(({envelope, ownedReplica}) => {
    window.fixtureCallbackCase = "owned"; window.fixtureOwnedReplica = ownedReplica;
    sessionStorage.setItem("vyakti.studio.full-page-auth-resume.v1", JSON.stringify(envelope));
  }, {envelope:callbackEnvelope,ownedReplica:resumeReplica});
  const callbackPage = await callbackContext.newPage();
  await callbackPage.goto(`http://127.0.0.1:${server.address().port}/studio?mode=replica#access_token=fixture`);
  await callbackPage.locator("[data-fixture-workspace=callback]").waitFor();
  assert.equal(await callbackPage.locator("[data-fixture-workspace=callback]").getAttribute("data-search"),
    `?mode=replica&replica=${resumeReplica}&step=meet&view=rehearsal&rehearsal_request=${resumeRequest}`,
    "a full-page callback restores the allowlisted route after the owned replica read");
  assert.equal(await callbackPage.evaluate(() => sessionStorage.getItem("vyakti.studio.full-page-auth-resume.v1")), null, "the callback consumes the route envelope once");
  await callbackContext.close();
  const foreignContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  await foreignContext.addInitScript(({envelope}) => {
    window.fixtureCallbackCase = "foreign"; window.fixtureOwnedReplica = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    sessionStorage.setItem("vyakti.studio.full-page-auth-resume.v1", JSON.stringify(envelope));
  }, {envelope:callbackEnvelope});
  const foreignPage = await foreignContext.newPage();
  await foreignPage.goto(`http://127.0.0.1:${server.address().port}/studio?mode=replica#access_token=fixture`);
  await foreignPage.locator("[data-fixture-workspace=callback]").waitFor();
  assert.equal(await foreignPage.locator("[data-fixture-workspace=callback]").getAttribute("data-search"), "?mode=replica", "a foreign-account replica cannot restore any saved view");
  assert.equal(await foreignPage.evaluate(() => sessionStorage.getItem("vyakti.studio.full-page-auth-resume.v1")), null, "foreign context is discarded rather than retained");
  await foreignContext.close();
  const reloadContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const persisted = { userId: "reload-owner", email: "reload@example.com", accessToken: "c".repeat(24), refreshToken: "reload-refresh", expiresAt: Date.now() + 600_000 };
  await reloadContext.addInitScript(session => localStorage.setItem("meera.state.v1", JSON.stringify({ auth: session })), persisted);
  const reloadPage = await reloadContext.newPage();
  await reloadPage.goto(`http://127.0.0.1:${server.address().port}/studio?reload=1`);
  await reloadPage.getByRole("alert").waitFor();
  await reloadPage.getByRole("button", { name: "Try again", exact: true }).click();
  await reloadPage.locator("[data-fixture-workspace=ready]").waitFor();
  assert.deepEqual(await reloadPage.evaluate(() => JSON.parse(localStorage.getItem("meera.state.v1")).auth), persisted, "the production reload retry keeps the stored authenticated session");
  await reloadContext.close();
  console.log("personal-studio-entry-recovery: parent restore, lazy failure, retry, logout, relogin, and full-page auth resume passed");
} finally {
  await browser?.close();
  if (server) { server.closeAllConnections(); await new Promise(done => server.close(done)); }
  assert.equal(dirname(resolve(temp)), resolve(tmpdir()));
  assert.ok(temp.split(/[\\/]/).at(-1).startsWith("personal-studio-entry-recovery-"));
  await rm(temp, { recursive: true, force: true });
}
