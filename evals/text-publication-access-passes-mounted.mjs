import { launchSuiteBrowser } from "./rehearsal/browser.mjs";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { build } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const out = join(root, "scratchpad", "text-publication-access-passes-mounted", String(Date.now()));
mkdirSync(out, { recursive: true });
const sourcePaths = [
  "src/studio/publication/PublicationApp.tsx",
  "src/studio/publication/MaterialSharePanel.tsx",
  "src/studio/publication/publicationApi.ts",
  "src/studio/publication/publication.css",
];
const sourceHashes = Object.fromEntries(sourcePaths.map(path => [path, createHash("sha256").update(readFileSync(join(root, path))).digest("hex")]));
const absolute = path => JSON.stringify(join(root, path).replaceAll("\\", "/"));
writeFileSync(join(out, "entry.tsx"), `import React from'react';import{createRoot}from'react-dom/client';import'@fontsource-variable/geist';import'@fontsource-variable/instrument-sans';import PublicationApp from ${absolute(sourcePaths[0])};import MaterialSharePanel from ${absolute(sourcePaths[1])};const q=new URLSearchParams(location.search);createRoot(document.getElementById('root')).render(q.has('owner')?<MaterialSharePanel token="owner-token" replicaId="10000000-0000-4000-8000-000000000001" onReview={()=>{}}/>:<PublicationApp publicId={q.get('publication')||''}/>);`);
const bundle = join(out, "bundle");
await build({ root, configFile: false, logLevel: "error", build: { outDir: bundle, emptyOutDir: true, lib: { entry: join(out, "entry.tsx"), name: "AccessPassFixture", formats: ["iife"], fileName: () => "fixture.js" }, cssCodeSplit: false }, define: { "process.env.NODE_ENV": JSON.stringify("production") } });
const js = readFileSync(join(bundle, "fixture.js"));
const css = readFileSync(join(bundle, readdirSync(bundle).find(path => path.endsWith(".css"))));

const RID = "10000000-0000-4000-8000-000000000001";
const SID = "20000000-0000-4000-8000-000000000001";
const IID = "30000000-0000-4000-8000-000000000001";
const HASH = "a".repeat(64);
const visitor = { userId: "50000000-0000-4000-8000-000000000001", accessToken: "synthetic-visitor-token-0000", refreshToken: "visitor-refresh", expiresAt: Date.now() + 3_600_000 };
const baseTerms = { audience: "signed_in_adult_attestation", publication_days: 30, retention_days: 30, visitor_question_limit: 20, total_question_limit: 200, budget_microusd: 100000, quota_policy: "admission_counts", memory: false, voice: false };
const codeOne = "A".repeat(32), codeTwo = "B".repeat(32);
const passIds = ["60000000-0000-4000-8000-000000000001", "60000000-0000-4000-8000-000000000002"];
let publication = null, calls = [], passes = [], boundPass = null, revokedBinding = false, holdList = false, heldList = null;
const browserErrors = [], consoleText = [];
const publicationFor = (id, mode) => ({ public_id: id, replica_id: RID, version: 1, state: "active", title: "Physics with Mira", subject_domain: "physics", disclosure: "AI answers from published material.", disclosure_hash: HASH,
  terms: { ...baseTerms, ...(mode === "pass" ? { access_mode: "pass" } : {}) }, created_at: "2026-10-10T00:00:00Z", expires_at: "2026-11-09T00:00:00Z", can_text: true, can_voice: false });
const passWire = pass => ({ pass_id: pass.pass_id, state: pass.state, created_at: pass.created_at, expires_at: pass.expires_at, ...(pass.claimed_at ? { claimed_at: pass.claimed_at } : {}), ...(pass.revoked_at ? { revoked_at: pass.revoked_at } : {}) });

const server = createServer(async (req, res) => {
  const send = (data, status = 200) => { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(data)); };
  try {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname === "/fixture.js") { res.setHeader("Content-Type", "text/javascript"); return res.end(js); }
    if (url.pathname === "/fixture.css") { res.setHeader("Content-Type", "text/css"); return res.end(css); }
    if (!url.pathname.startsWith("/api/")) { res.setHeader("Content-Type", "text/html"); return res.end('<!doctype html><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><style>body{margin:0}body:has(.vp-owner){max-width:780px;margin:24px auto;padding:0 12px}</style><div id="root"></div><script src="/fixture.js"></script>'); }
    let raw = ""; for await (const part of req) raw += part;
    const input = raw ? JSON.parse(raw) : Object.fromEntries(url.searchParams), op = input.op;
    calls.push({ path: url.pathname, method: req.method, url: url.pathname + url.search, input });
    if (url.pathname === "/api/replica-text-publication") {
      assert.equal(req.headers.authorization, "Bearer owner-token");
      if (op === "readiness") {
        const mode = input.access_mode === "pass" ? "pass" : "open";
        const terms = { ...baseTerms, ...(mode === "pass" ? { access_mode: "pass" } : {}) };
        return send({ readiness: { replica_id: RID, state: "ready", blockers: [], drafts: [{ sheet_id: SID, name: "Physics profile", sheet_kind: "teacher", updated_at: "2026-10-10T00:00:00Z", status: "draft" }],
          context_items: [{ item_id: IID, source_name: "pendulum.txt", status: "mined", format: "text", authorship: "mine", source_id: IID, source_ready: true, eligible: true, reason: null }],
          selected: input.sheet_id === SID && input.context_item_id === IID ? { review_hash: (mode === "pass" ? "b" : "c").repeat(64), source_name: "pendulum.txt", projection: { name: "Physics with Mira", subjectDomain: "physics" }, material_text: "The period is two seconds.", terms } : null,
          statement_set: "account-material-publication/v1", statements: [{ id: "publish", text: "I approve this publication." }], can_publish: input.sheet_id === SID && input.context_item_id === IID, publications: publication ? [publication] : [] } });
      }
      if (op === "publish") { publication = publicationFor(input.publication_id, input.access_mode === "pass" ? "pass" : "open"); return send({ publication }, 201); }
      if (op === "access_passes") {
        if (holdList) { holdList = false; heldList = () => send({ passes: passes.map(passWire) }); return; }
        return send({ passes: passes.map(passWire) });
      }
      if (op === "create_access_passes") {
        const codes = [codeOne, codeTwo].slice(0, input.count);
        const created = codes.map((code, index) => ({ pass_id: passIds[index], state: "available", created_at: "2026-10-10T01:00:00Z", expires_at: publication.expires_at, code }));
        passes.push(...created.map(({ code: _code, ...pass }) => pass));
        return send({ passes: created }, 201);
      }
      if (op === "revoke_access_pass") {
        passes = passes.map(pass => pass.pass_id === input.pass_id ? { ...pass, state: "revoked", revoked_at: "2026-10-10T02:00:00Z" } : pass);
        if (boundPass === input.pass_id) { boundPass = null; revokedBinding = true; }
        return send({ pass: passWire(passes.find(pass => pass.pass_id === input.pass_id)) });
      }
      if (op === "unpublish") { publication = { ...publication, state: "revoked", can_text: false }; return send({ publication }); }
    }
    if (url.pathname === "/api/text-publication") {
      if (op === "open") return send({ publication });
      assert.equal(req.headers.authorization, "Bearer synthetic-visitor-token-0000");
      if (op === "join") {
        if (!boundPass) {
          const index = [codeOne, codeTwo].indexOf(input.access_pass);
          const pass = passes[index];
          if (index < 0 || !pass || pass.state !== "available") return send({ error: "text_publication_access_required" }, 403);
          boundPass = pass.pass_id; revokedBinding = false; passes[index] = { ...pass, state: "claimed", claimed_at: "2026-10-10T01:30:00Z" };
        } else if (passes.find(pass => pass.pass_id === boundPass)?.state === "revoked") return send({ error: "text_publication_access_revoked" }, 403);
        return send({ publication, session_token: "synthetic-publication-session", expires_at: publication.expires_at, remaining_questions: 20 });
      }
      if (op === "ask") {
        if (revokedBinding || passes.find(pass => pass.pass_id === boundPass)?.state === "revoked") return send({ error: "text_publication_access_revoked" }, 403);
        return send({ request: { public_id: publication.public_id, request_id: input.request_id, state: "complete", billing_state: "settled", answer: "Two seconds.", can_voice: false, created_at: "2026-10-10T01:45:00Z" } });
      }
      if (op === "forget") return send({ forgotten: true, private_payload_erased: true });
    }
    return send({ error: "fixture_unexpected_request" }, 500);
  } catch (error) {
    browserErrors.push(error.message); return send({ error: "fixture_failure" }, 500);
  }
});

await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launchSuiteBrowser("text-publication-access-passes-mounted");
const results = [];
const check = name => { results.push(name); console.log(`PASS ${name}`); };
const routeLocal = context => context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
const storageHas = (page, needle) => page.evaluate(value => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage } }).includes(value), needle);

try {
  for (const width of [390, 1440]) {
    publication = null; calls = []; passes = []; boundPass = null; revokedBinding = false; holdList = false; heldList = null;
    const openContext = await browser.newContext({ viewport: { width, height: 950 } }); await routeLocal(openContext);
    const openOwner = await openContext.newPage(); openOwner.on("pageerror", error => browserErrors.push(error.message));
    await openOwner.goto(`${origin}/?owner=1`);
    await openOwner.getByLabel("Teaching profile").selectOption(SID); await openOwner.getByLabel("Material").selectOption(IID);
    await openOwner.getByRole("checkbox", { name: "I approve this publication." }).check(); await openOwner.getByRole("button", { name: "Publish link", exact: true }).click();
    await openOwner.getByLabel("Share link").waitFor();
    const openReadiness = calls.filter(call => call.op === undefined && call.input.op === "readiness");
    assert(openReadiness.every(call => !("access_mode" in call.input)));
    assert.equal("access_mode" in calls.find(call => call.input.op === "publish").input, false);
    check(`${width} open publication preserves the legacy readiness and publish wire shape`);
    await openContext.close();

    publication = null; calls = []; passes = []; boundPass = null; revokedBinding = false; holdList = true; heldList = null;
    const ownerContext = await browser.newContext({ viewport: { width, height: 950 } }); await routeLocal(ownerContext);
    const ownerPage = await ownerContext.newPage(); ownerPage.on("pageerror", error => browserErrors.push(error.message)); ownerPage.on("console", message => consoleText.push(message.text()));
    const language = width === 390 ? "&lang=hi" : "";
    await ownerPage.goto(`${origin}/?owner=1${language}`);
    await ownerPage.locator('input[name="publication-access"][value="pass"]').check();
    await ownerPage.getByLabel("Teaching profile").selectOption(SID); await ownerPage.getByLabel("Material").selectOption(IID);
    await ownerPage.getByRole("checkbox", { name: "I approve this publication." }).check(); await ownerPage.getByRole("button", { name: "Publish link", exact: true }).click();
    await ownerPage.getByRole("heading", { name: width === 390 ? "एक्सेस पास" : "Access passes" }).waitFor();
    const createButton = ownerPage.getByRole("button", { name: width === 390 ? "पास बनाएं" : "Create passes", exact: true });
    assert.equal(await createButton.isDisabled(), true); for (let i = 0; !heldList && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10)); assert(heldList, "pass list request held"); heldList(); heldList = null;
    await createButton.waitFor({ state: "visible" }); await ownerPage.waitForFunction(label => ![...document.querySelectorAll("button")].find(button => button.textContent === label)?.disabled, width === 390 ? "पास बनाएं" : "Create passes");
    assert(calls.filter(call => call.input.op === "readiness" && call.input.sheet_id === SID).every(call => call.input.access_mode === "pass"));
    assert.equal(calls.find(call => call.input.op === "publish").input.access_mode, "pass");
    check(`${width} pass choice is immutable and create waits for a confirmed list`);

    await ownerPage.getByLabel(width === 390 ? "कितने पास बनाने हैं" : "Number of passes").fill("2");
    await createButton.click();
    const revealed = ownerPage.getByLabel(width === 390 ? "नया एक्सेस पास" : "New access pass"); await revealed.first().waitFor();
    assert.deepEqual(await revealed.evaluateAll(inputs => inputs.map(input => input.value)), [codeOne, codeTwo]);
    await ownerPage.getByRole("button", { name: width === 390 ? "कॉपी करें" : "Copy", exact: true }).first().click();
    await ownerPage.getByRole("button", { name: width === 390 ? "कॉपी हो गया" : "Copied", exact: true }).waitFor();
    const createCall = calls.find(call => call.input.op === "create_access_passes"); assert.equal(createCall.input.count, 2);
    assert.equal(await storageHas(ownerPage, codeOne), false); assert.equal(ownerPage.url().includes(codeOne), false); assert.equal(consoleText.some(text => text.includes(codeOne)), false);
    check(`${width} new opaque codes appear once with explicit copy and never enter URL or storage`);

    const sharedLink = await ownerPage.getByLabel("Share link").inputValue();
    const visitorContext = await browser.newContext({ viewport: { width, height: 950 } }); await routeLocal(visitorContext);
    await visitorContext.addInitScript(value => localStorage.setItem("meera.state.v1", JSON.stringify({ auth: value })), visitor);
    const visitorPage = await visitorContext.newPage(); visitorPage.on("pageerror", error => browserErrors.push(error.message)); visitorPage.on("console", message => consoleText.push(message.text()));
    await visitorPage.goto(sharedLink + language);
    const passLabel = width === 390 ? "एक्सेस पास (पहली बार)" : "Access pass (first visit)";
    await visitorPage.waitForFunction(() => !document.body.textContent.includes("Opening conversation"));
    if (await visitorPage.getByLabel(passLabel).count() === 0) throw new Error(`pass entry missing: ${await visitorPage.locator("body").innerText()} calls=${JSON.stringify(calls.slice(-5))}`);
    await visitorPage.getByRole("checkbox", { name: /I am 18/ }).check(); await visitorPage.getByRole("button", { name: "Start conversation", exact: true }).click();
    await visitorPage.getByText(width === 390 ? "पहली बार बातचीत शुरू करने के लिए अपना एक्सेस पास डालें।" : "Enter your access pass to start this conversation for the first time.", { exact: true }).waitFor();
    assert.equal("access_pass" in calls.filter(call => call.input.op === "join").at(-1).input, false);
    await visitorPage.getByLabel(passLabel).fill(codeOne);
    await visitorPage.getByRole("button", { name: "Start conversation", exact: true }).click(); await visitorPage.getByLabel("Your question", { exact: true }).waitFor();
    const firstJoin = calls.filter(call => call.input.op === "join").at(-1); assert.equal(firstJoin.input.access_pass, codeOne);
    const ownerListUrl = new URL(calls.find(call => call.path === "/api/replica-text-publication" && call.input.op === "access_passes").url, origin);
    assert.equal(ownerListUrl.searchParams.get("op"), "access_passes"); assert.equal(ownerListUrl.searchParams.has("access_pass"), false);
    const visitorUrls = calls.filter(call => call.path === "/api/text-publication").map(call => new URL(call.url, origin));
    assert(visitorUrls.every(url => !url.searchParams.has("access_pass"))); assert.equal(firstJoin.url.includes(codeOne), false);
    assert.equal(await storageHas(visitorPage, codeOne), false); assert.equal(visitorPage.url().includes(codeOne), false); assert.equal(consoleText.some(text => text.includes(codeOne)), false);
    check(`${width} first visitor join sends the pass in the POST body only`);

    await visitorPage.reload(); await visitorPage.getByLabel(passLabel).waitFor(); assert.equal(await visitorPage.getByLabel(passLabel).inputValue(), "");
    await visitorPage.getByRole("checkbox", { name: /I am 18/ }).check(); await visitorPage.getByRole("button", { name: "Start conversation", exact: true }).click(); await visitorPage.getByLabel("Your question", { exact: true }).waitFor();
    assert.equal("access_pass" in calls.filter(call => call.input.op === "join").at(-1).input, false);
    check(`${width} bound visitor rejoins without a code`);

    await ownerPage.reload(); await ownerPage.getByRole("heading", { name: width === 390 ? "एक्सेस पास" : "Access passes" }).waitFor();
    assert.equal(await ownerPage.getByLabel(width === 390 ? "नया एक्सेस पास" : "New access pass").count(), 0);
    assert.equal((await ownerPage.locator("body").innerText()).includes(codeOne), false); assert.equal((await ownerPage.locator("body").innerText()).includes(codeTwo), false);
    const listCalls = calls.filter(call => call.input.op === "access_passes"); assert(listCalls.length >= 2); assert(listCalls.every(call => !JSON.stringify(call.input).includes(codeOne)));
    await ownerPage.getByRole("button", { name: width === 390 ? "रद्द करें" : "Revoke", exact: true }).first().click();
    await ownerPage.getByText(width === 390 ? "रद्द" : "Revoked", { exact: true }).waitFor();
    check(`${width} reload discards plaintext while metadata remains revocable`);

    await visitorPage.getByLabel("Your question", { exact: true }).fill("What is the period?"); await visitorPage.getByRole("button", { name: "Ask", exact: true }).click();
    await visitorPage.getByText(width === 390 ? "आपका एक्सेस पास रद्द हो चुका है। बातचीत जारी रखने के लिए मालिक से नया पास मांगें।" : "Your access pass was revoked. Ask the owner for a new pass to continue.", { exact: true }).waitFor();
    await visitorPage.getByLabel(passLabel).fill(codeTwo); await visitorPage.getByRole("button", { name: "Rejoin conversation", exact: true }).click(); await visitorPage.getByLabel("Your question", { exact: true }).waitFor();
    assert.equal(calls.filter(call => call.input.op === "join").at(-1).input.access_pass, codeTwo);
    check(`${width} revoked access closes the session and accepts a fresh pass`);

    await ownerPage.screenshot({ path: join(out, `owner-${width}.png`), fullPage: true });
    await visitorPage.screenshot({ path: join(out, `visitor-${width}.png`), fullPage: true });
    assert.equal(await ownerPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.equal(await visitorPage.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await visitorContext.close(); await ownerContext.close();
  }
  assert.deepEqual(browserErrors, []);
  for (const [path, hash] of Object.entries(sourceHashes)) assert.equal(createHash("sha256").update(readFileSync(join(root, path))).digest("hex"), hash, `${path} changed during mounted proof`);
  writeFileSync(join(out, "result.json"), JSON.stringify({ at: new Date().toISOString(), groups: results.length, results, sourceHashes, scope: "Mounted synthetic HTTP fixture only; no real SQL, auth provider, or model call." }, null, 2));
  console.log(JSON.stringify({ groups: results.length, out }));
} finally {
  await browser.close(); await new Promise(resolve => server.close(resolve));
}
