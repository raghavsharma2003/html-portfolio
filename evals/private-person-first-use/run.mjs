import assert from "node:assert/strict";
import { createServer } from "node:http";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync } from "node:fs";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const artifacts = join(root, "scratchpad/private-person-first-use", String(Date.now()));
mkdirSync(artifacts, { recursive: true });
const RID = "10000000-0000-4000-8000-000000000001";
const SHEET = "20000000-0000-4000-8000-000000000001";
const ITEM = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const statements = [
  { id: "authorize_private_text_question", text: "Use this material to answer one private question." },
  { id: "understand_ai_text_only", text: "This is a private text answer." },
  { id: "understand_private_retention_and_withdrawal", text: "I can remove this private test." },
];
const teacherDraft = { name: "Anita", identityWho: "A physics teacher", sheetKind: "teacher", subjectDomain: "physics" };
const contextItems = [{ item_id: ITEM, source_name: "notes.txt", status: "extracted", eligible: true }];

function readiness(scenario) {
  const teacher = scenario === "teacher";
  return {
    replica_id: RID,
    state: teacher ? "ready" : "needs_input",
    blockers: teacher ? [] : [{ code: "rehearsal_select_draft_and_context", responsibility: "owner" }],
    drafts: teacher ? [{ sheet_id: SHEET, name: "Anita", updated_at: "2026-10-09T00:00:00Z", status: "draft" }] : [],
    context_items: contextItems,
    selected: teacher ? {
      sheet_id: SHEET, sheet_hash: hash, context_item_id: ITEM, context_hash: hash,
      source_id: SOURCE, source_hash: hash, evidence_hash: hash, authority_epoch: "1", snapshot_hash: hash,
      material: { draft: teacherDraft, context: { source_name: "notes.txt", format: "text", body: "A short saved note." } },
    } : null,
    statement_set: "private-text-rehearsal/v1",
    statements,
    grant_scope: "private_text_rehearsal",
    can_ask: teacher,
  };
}

let server;
let browser;
const requests = [];
try {
  const built = await build({ root, configFile: false, logLevel: "silent", build: { write: false, minify: true, rolldownOptions: { input: join(root, "evals/private-person-first-use/host.html") } } });
  const assets = new Map(built.output.map(file => ["/" + file.fileName, file.type === "chunk" ? file.code : file.source]));
  server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://fixture");
    if (url.pathname.startsWith("/api/")) {
      assert(["Bearer synthetic-owner-person", "Bearer synthetic-owner-teacher"].includes(req.headers.authorization));
      requests.push(url.pathname);
      const scenario = req.headers.authorization.endsWith("teacher") ? "teacher" : "person";
      const payload = url.pathname === "/api/replica-text-rehearsal"
        ? url.searchParams.get("op") === "latest" ? { latest: null } : url.searchParams.get("op") === "readiness" ? { readiness: readiness(scenario) } : null
        : url.pathname === "/api/teacher-sheet"
          ? { sheet: scenario === "teacher" ? { draft: teacherDraft, sheet_id: SHEET, status: "draft", updated_at: null } : { draft: null, sheet_id: null, status: "", updated_at: null } }
          : null;
      assert(payload, `unexpected API ${url.pathname}`);
      res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(JSON.stringify(payload));
      return;
    }
    const asset = assets.get(url.pathname);
    if (asset !== undefined) {
      res.writeHead(200, { "content-type": extname(url.pathname) === ".html" ? "text/html" : extname(url.pathname) === ".css" ? "text/css" : "text/javascript" });
      res.end(asset);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchSuiteBrowser("private-person-first-use");

  for (const width of [390, 1440]) {
    for (const locale of ["en", "hi"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      await page.goto(`${origin}/evals/private-person-first-use/host.html?scenario=person&lang=${locale}`);
      const action = locale === "hi" ? "व्यक्तित्व जोड़ें" : "Set up personality";
      await page.getByRole("button", { name: action, exact: true }).waitFor();
      assert.equal(await page.getByLabel("Subject", { exact: true }).count(), 0);
      assert.equal(await page.getByText("rehearsal select draft and context", { exact: false }).count(), 0);
      assert.equal(await page.getByText("Question", { exact: true }).count(), 0);
      if (locale === "hi") assert.equal(await page.getByText("Test your private draft.", { exact: true }).count(), 0);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      await page.screenshot({ path: join(artifacts, `${width}-${locale}-person.png`), fullPage: true });
      await page.getByRole("button", { name: action, exact: true }).click();
      await page.getByRole("heading", { name: locale === "hi" ? "व्यक्तित्व खुल गया" : "Personality opened", exact: true }).waitFor();
      const draft = await page.evaluate(() => window.profileDraft);
      assert.deepEqual(draft, { question: "How should I explain this?", sheetId: "", contextItemId: ITEM });
      await context.close();
      console.log(`ok person ${width}px ${locale}`);
    }

    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    await page.goto(`${origin}/evals/private-person-first-use/host.html?scenario=teacher&lang=en`);
    await page.getByRole("button", { name: "Edit draft details", exact: true }).click();
    await page.getByLabel("Subject", { exact: true }).waitFor();
    assert.equal(await page.getByRole("heading", { name: "Personality opened", exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => window.profileDraft), undefined);
    await page.screenshot({ path: join(artifacts, `${width}-teacher.png`), fullPage: true });
    await context.close();
    console.log(`ok teacher ${width}px`);
  }
  assert.equal(requests.filter(path => path === "/api/teacher-sheet").length, 6);
  console.log(`PASS 6 mounted cases; ${artifacts}`);
} finally {
  await browser?.close();
  server?.closeAllConnections();
  if (server) await new Promise(resolve => server.close(resolve));
}
