// Full real Studio entry modules, StudioApp, shell and styles. No component
// substitutions. Only synthetic auth/HTTP data from the incumbent layout fixture.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { build } from "vite";

const ownRoot = fileURLToPath(new URL("../", import.meta.url));
const sourceFlag = process.argv.indexOf("--source-root");
const root = sourceFlag < 0 ? ownRoot : resolve(process.argv[sourceFlag + 1]);
const RID = "10000000-0000-4000-8000-000000000001", OTHER = "10000000-0000-4000-8000-000000000002";
const OWNER = "20000000-0000-4000-8000-000000000001", TOKEN = "full-shell-synthetic-owner-token";
const sha = value => createHash("sha256").update(value).digest("hex");
const artifactDir = join(ownRoot, "scratchpad/private-draft-full-shell", String(Date.now())); mkdirSync(artifactDir, { recursive: true });
const criticalFiles = ["studio.html", "src/studio/main.tsx", "src/studio/conversationSetupNavigation.ts", "src/creatorStudio/main.tsx",
  "src/creatorStudio/StudioApp.tsx", "src/creatorStudio/TeacherSheetStudio.tsx", "src/studio/teacherSheetEditorView.ts", "src/creatorStudio/teacherSheetApi.ts", "src/creatorStudio/StudioShell.tsx", "src/creatorStudio/RuntimeGate.tsx", "src/creatorStudio/layoutFixture.tsx"];
const identity = { head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(), source_root: root,
  hashes: Object.fromEntries(criticalFiles.map(file => [file, sha(readFileSync(join(root, file)))])) };
// Reuse the existing data declarations only. Never execute layoutFixture's
// window.fetch override or its direct StudioApp render (those bypass entries).
const fixtureSource = readFileSync(join(root, "src/creatorStudio/layoutFixture.tsx"), "utf8");
const fixtureAst = ts.createSourceFile("fixture.tsx", fixtureSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["FIXTURE_REPLICA", "ROUTES", "ACTIVITY_LANES", "LANE_LABELS", "VOICE_DRAFT_REVIEW", "SCENARIOS"]);
const declarations = fixtureAst.statements.filter(node => ts.isVariableStatement(node)
  && node.declarationList.declarations.some(declaration => ts.isIdentifier(declaration.name) && names.has(declaration.name.text)));
assert.equal(declarations.length, names.size, "incumbent fixture declarations must remain explicit");
const dataCode = ts.transpileModule(declarations.map(node => node.getText(fixtureAst)).join("\n") + "\nglobalThis.data={ROUTES,FIXTURE_REPLICA,SCENARIOS};",
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const context = {}; runInNewContext(dataCode, context);
const base = JSON.parse(JSON.stringify(context.data));
const helper = ts.transpileModule(readFileSync(join(root, "src/studio/conversationSetupNavigation.ts"), "utf8"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { conversationSetupUrl } = await import(`data:text/javascript;base64,${Buffer.from(helper).toString("base64")}`);
const remap = (value, rid) => JSON.parse(JSON.stringify(value).replaceAll(base.FIXTURE_REPLICA.replica_id, rid));
const replica = rid => ({ ...remap(base.FIXTURE_REPLICA, rid), owner_user_id: OWNER,
  display_name: rid === RID ? "Synthetic Setup Expert" : "Other Synthetic Workspace" });
const routesFor = rid => ({ ...remap(base.ROUTES, rid),
  "/api/replica-runtime": remap(base.SCENARIOS.processing["/api/replica-runtime"], rid),
  "/api/teacher-sheet": {sheet:{draft:{name:"Synthetic minimal teacher",identityWho:"Synthetic physics educator",subjectDomain:"physics",custom_private:{preserve:true}},updated_at:"2026-09-07T00:00:00Z"}},
});
writeFileSync(join(artifactDir, "manifest.json"), JSON.stringify({ ...identity, fixture_sha256: sha(fixtureSource), owner: OWNER, requested_replica: RID,
  other_replica: OTHER, fixture: { base: "creatorStudio/layoutFixture.tsx ROUTES", runtime: "processing scenario inactive/readiness-only", owner_scope: "synthetic bearer token, two owned replicas" },
  scope: "Actual full application, synthetic session/API responses. No real authentication, DB, identity, provider or activation." }, null, 2), { flag: "wx" });

let server, browser, result, fatal; const checks = [], cases = [], requests = [], unexpected = [];
let replicaOrder = [RID], activeCase = "";
function check(name, passed, details) { checks.push({ name, passed: !!passed, ...(details === undefined ? {} : { details }) }); }
try {
  // No test plugin, no changed imports or JSX, no destination placeholder.
  result = process.argv.includes("--dist") ? { output: readdirSync(join(root, "dist"), { recursive: true })
    .filter(file => /\.(?:js|css|html|woff2|svg)$/.test(file)).map(file => ({ type: "asset", fileName: file.replaceAll("\\", "/"), source: readFileSync(join(root, "dist", file)) })) }
    : await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true,
    rolldownOptions: { input: join(root, "studio.html"), output: { entryFileNames: "app.js" } } } });
  const assets = new Map(result.output.map(item => ["/" + item.fileName, item.type === "chunk" ? item.code : item.source]));
  const built = result.output.map(item => ({ file: item.fileName, sha256: sha(item.type === "chunk" ? item.code : item.source) }));
  writeFileSync(join(artifactDir, "build.json"), JSON.stringify(built, null, 2), { flag: "wx" });
  for (const item of result.output.filter(item => item.fileName.endsWith(".css") || item.fileName.endsWith(".html"))) {
    const destination = join(artifactDir, "build", item.fileName); mkdirSync(resolve(destination, ".."), { recursive: true });
    writeFileSync(destination, item.source);
  }
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1"), method = req.method || "GET";
    const json = (status, body) => { res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); };
    if (url.pathname.startsWith("/api/")) {
      let raw = ""; for await (const part of req) raw += part;
      const body = raw ? JSON.parse(raw) : null, rid = url.searchParams.get("replica_id") || body?.replica_id;
      requests.push({ case: activeCase, path: url.pathname, method, replica_id: rid, op: body?.op });
      if (req.headers.authorization !== `Bearer ${TOKEN}`) { unexpected.push("unbound_synthetic_owner"); return json(401, { error: "synthetic_owner_required" }); }
      if (rid && ![RID, OTHER].includes(rid)) { unexpected.push("unowned_replica"); return json(404, { error: "replica_not_found" }); }
      // The real shell marks studio_opened. Record this known analytics call
      // in memory only; never permit activation, identity or publication writes.
      if (method !== "GET") {
        if (url.pathname === "/api/replica" && body?.op === "funnel_mark" && body.step === "studio_opened") return json(200, { ok: true });
        const readOps = { "/api/replica-consent": "list", "/api/replica-source": "list", "/api/replica-liveness": "status",
          "/api/replica-review": "status", "/api/replica-provider-consent": "status", "/api/replica-identity": "status", "/api/replica-voice": "status", "/api/replica-candidate-eval": "status" };
        if (readOps[url.pathname] === body?.op) return json(200, routesFor(rid)[url.pathname]);
        unexpected.push(`${method} ${url.pathname} ${body?.op || ""}`); return json(409, { error: "synthetic_mutation_refused" });
      }
      if (url.pathname === "/api/replica") return json(200, { replicas: replicaOrder.map(replica), replica: replica(rid || replicaOrder[0]), push: { configured: false, vapid_public: null } });
      if (["/api/readiness", "/api/drift-watch"].includes(url.pathname)) return json(503, { error: "synthetic_measurement_unavailable" });
      const routes = routesFor(rid || replicaOrder[0]);
      if (!Object.hasOwn(routes, url.pathname)) { unexpected.push(`GET ${url.pathname}`); return json(404, { error: "synthetic_route_unavailable" }); }
      return json(200, routes[url.pathname]);
    }
    if (assets.has(url.pathname)) {
      res.writeHead(200, { "content-type": ({ ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".woff": "font/woff" })[extname(url.pathname)] || "application/octet-stream" });
      return res.end(assets.get(url.pathname));
    }
    const publicRoot = resolve(root, "public"), publicFile = resolve(publicRoot, "." + url.pathname);
    if (publicFile.startsWith(publicRoot + "/") || publicFile.startsWith(publicRoot + "\\")) {
      if (existsSync(publicFile) && statSync(publicFile).isFile()) {
        res.writeHead(200, { "content-type": ({ ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(publicFile)] || "application/octet-stream" });
        return res.end(readFileSync(publicFile));
      }
    }
    res.writeHead(200, { "content-type": "text/html" });
    // Actual transformed HTML includes Vite's shared entry CSS in correct order.
    res.end(assets.get("/studio.html"));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const { chromium } = await import("playwright"); browser = await chromium.launch({ headless: true });

  for (const width of [390,1440]) {
    activeCase=width+'-minimal-teacher-meet'; replicaOrder=[OTHER,RID];
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    const errors=[],blockedOrigins=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blockedOrigins.push(new URL(route.request().url()).origin);return route.abort();});
    await page.addInitScript(({token,owner})=>{localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:owner,accessToken:token,refreshToken:token,expiresAt:Date.now()+3600000,email:'minimal@fixture.test'}}));localStorage.setItem('vyakti.studio.mode.v1','teacher');},{token:TOKEN,owner:OWNER});
    await page.goto(origin+'/studio?mode=teacher&replica='+RID+'&step=meet&lang=en');
    await page.locator('.studio-shell .studio-header').waitFor();
    await page.locator('#teacher-sheet-title').filter({hasText:'Synthetic minimal teacher'}).waitFor({state:'attached',timeout:20000});
    // Open only the actual enclosing mobile disclosure, through its native control.
    const closed=page.locator('details:not([open])').filter({has:page.locator('#teacher-sheet-studio')});
    if(await closed.count())await closed.locator(':scope > summary').click();
    await page.locator('#teacher-sheet-studio').scrollIntoViewIfNeeded();
    await page.evaluate(()=>document.fonts.ready);
    check(activeCase+': actual full entry loads partial draft without render exception',errors.length===0,errors);
    check(activeCase+': owned saved draft reached actual editor',requests.some(r=>r.case===activeCase&&r.path==='/api/teacher-sheet'&&r.replica_id===RID));
    check(activeCase+': present subject remains selected',await page.locator('#subject-domain').inputValue()==='physics');
    check(activeCase+': absent optional scope remains empty',await page.locator('#syllabus-scope').inputValue()==='');
    check(activeCase+': no automatic write or external provider',unexpected.length===0&&blockedOrigins.length===0,{unexpected,blockedOrigins});
    const geometry=await page.locator('#teacher-sheet-studio').evaluate(node=>({width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,left:node.getBoundingClientRect().left,right:node.getBoundingClientRect().right}));
    check(activeCase+': editor fits phone or desktop',!geometry.overflow&&geometry.left>=0&&geometry.right<=width+1,geometry);
    await page.screenshot({path:join(artifactDir,width+'-minimal-meet.png'),fullPage:false});
    cases.push({case:activeCase,url:page.url(),errors,geometry});await page.close();
  }

  for(const width of [390,1440]){
    activeCase=width+'-unavailable-requested-teacher';
    const page=await browser.newPage({viewport:{width,height:1000},reducedMotion:'reduce'});
    await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
    await page.addInitScript(({token,owner})=>{localStorage.setItem('meera.state.v1',JSON.stringify({auth:{userId:owner,accessToken:token,refreshToken:token,expiresAt:Date.now()+3600000,email:'minimal@fixture.test'}}));localStorage.setItem('vyakti.studio.mode.v1','teacher');},{token:TOKEN,owner:OWNER});
    await page.goto(origin+'/studio?mode=teacher&replica=10000000-0000-4000-8000-000000000099&step=meet&lang=en');
    await page.locator('.error-banner').filter({hasText:'This workspace is unavailable. Open your AI from Studio and try again.'}).waitFor({timeout:20000});
    check(activeCase+': explicit unavailable workspace never falls back to first owned draft',!requests.some(r=>r.case===activeCase&&r.path==='/api/teacher-sheet'));
    check(activeCase+': no wrong editor or publication action is mounted',await page.locator('#teacher-sheet-studio').count()===0);
    await page.close();
  }
} catch (error) { fatal = error; }
finally {
  await browser?.close(); if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  writeFileSync(join(artifactDir, "result.json"), JSON.stringify({ identity, checks, cases, requests, unexpected, fatal: fatal?.message || null,
    passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length,
    scope: "Full real app and routes; only synthetic owner/session/API data, no real service acceptance." }, null, 2));
  console.log(JSON.stringify({ artifactDir, passed: checks.filter(check => check.passed).length, failed: checks.filter(check => !check.passed).length, fatal: fatal?.message || null }));
}
if (fatal) throw fatal;
if (checks.some(check => !check.passed)) process.exitCode = 1;
