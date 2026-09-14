import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments } from "../lib/source-scan.mjs";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";
import react from "@vitejs/plugin-react";
import { createServer } from "vite";
import { clientSourceOverview, listOwnedSourcesOverview } from "../../api/_replica-source.js";
import { ownedSourceRemovalImpact } from "../../api/_replica-source-erasure.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const RID = "11111111-1111-4111-8111-111111111111";
const OWNER = "22222222-2222-4222-8222-222222222222";
const SID = "33333333-3333-4333-8333-333333333333";
let checks = 0;
function ok(name, condition, detail = "") {
  assert.ok(condition, detail ? `${name}: ${detail}` : name);
  console.log(`ok ${++checks} - ${name}`);
}

const sourceRow = (extra = {}) => ({
  source_id: SID, kind: "audio", capture_mode: "upload", purpose: "memory",
  duration_ms: 30_000, state: "ready", contains_third_parties: false,
  rejection_code: "", created_at: "2026-09-14T00:00:00Z", provenance: {},
  item_id: null, item_kind: null, source_name: null, source_url: null,
  item_state: null, refusal_reason: "", routed_to: "", mine_skip_reason: "",
  claims_approved: 2, claims_proposed: 1, ...extra,
});

const recording = clientSourceOverview(sourceRow());
ok("memory audio maps to a recording with measured voice time",
  recording.kind === "recording" && recording.yield.voice_seconds === 30);
ok("overview exposes no private storage locator",
  !("object_path" in recording) && !("storage_bucket" in recording));

const context = clientSourceOverview(sourceRow({
  kind: "text", purpose: "context_item", duration_ms: 0, state: "ready",
  item_id: "item-1", item_kind: "file", source_name: "notes.txt",
  item_state: "refused", refusal_reason: "unsupported_document",
}));
ok("context item uses its authoritative item state and detail code",
  context.kind === "file" && context.display_name === "notes.txt"
    && context.state === "refused" && context.state_detail_code === "unsupported_document");
ok("non-media context never reports voice time from a stray duration",
  clientSourceOverview(sourceRow({
    kind: "text", purpose: "context_item", duration_ms: 50_000,
    item_id: "item-2", item_kind: "file", source_name: "notes.txt", item_state: "mined",
  })).yield.voice_seconds === 0);

const call = clientSourceOverview(sourceRow({ capture_mode: "derived", provenance: { purpose: "mirror_window" } }));
ok("derived Mirror Call evidence maps to a call clip", call.kind === "call");

const declared = clientSourceOverview(sourceRow({ state: "quarantined", contains_third_parties: true }));
ok("third-party declaration stays separate from the processing state",
  declared.state === "quarantined" && declared.contains_third_parties === true && declared.state_detail_code === "");

{
  let sql = "";
  let params;
  const rows = await listOwnedSourcesOverview(async (query, values) => {
    sql = query; params = values; return [sourceRow()];
  }, OWNER, RID);
  ok("overview read scopes by replica and owner", JSON.stringify(params) === JSON.stringify([RID, OWNER]));
  ok("overview joins owner context and active claims without reading object paths",
    /left join vy_context_item/.test(sql) && /vy_replica_claim/.test(sql) && !/object_path/.test(sql));
  ok("overview omits sources already being erased", /s\.state<>'deleting'/.test(sql));
  ok("overview mapping returns live approved and proposed counts",
    rows[0].yield.claims_approved === 2 && rows[0].yield.claims_proposed === 1);
}

await assert.rejects(() => listOwnedSourcesOverview(async () => [], OWNER, "bad"), /valid replica_id required/);
console.log(`ok ${++checks} - NEGATIVE CONTROL: malformed replica id is rejected before the query`);

{
  let sql = "";
  let params;
  const impact = await ownedSourceRemovalImpact(async (query, values) => {
    sql = query; params = values;
    return [{ source_id: SID, claims_approved: 3, claims_proposed: 4, voice_seconds: 31, is_primary_voice: true }];
  }, OWNER, RID, SID);
  ok("impact read scopes by replica, owner, and source", JSON.stringify(params) === JSON.stringify([RID, OWNER, SID]));
  ok("impact matches erasure by counting every active claim that cites the source",
    /status='approved'/.test(sql) && /status='proposed'/.test(sql)
      && /source_id=any\(c\.source_ids\)/.test(sql) && !/cardinality/.test(sql));
  ok("impact reports exact active counts, voice time, and selected voice role",
    impact.claims_approved === 3 && impact.claims_proposed === 4
      && impact.voice_seconds === 31 && impact.is_primary_voice === true);
  ok("impact omits sources already being erased", /s\.state<>'deleting'/.test(sql));
}

ok("NEGATIVE CONTROL: unknown or another owner's source returns no impact",
  await ownedSourceRemovalImpact(async () => [], OWNER, RID, SID) === null);
await assert.rejects(() => ownedSourceRemovalImpact(async () => [], OWNER, RID, "bad"));
console.log(`ok ${++checks} - NEGATIVE CONTROL: malformed source id is rejected before the query`);

const door = stripComments(read("api/replica-source.js"));
ok("HTTP door wires the overview operation to the owner-scoped read",
  /op\s*===\s*"overview"[\s\S]{0,220}listOwnedSourcesOverview/.test(door));
ok("HTTP door requires a successful impact read before removal can be described",
  /op\s*===\s*"removal_preview"[\s\S]{0,260}ownedSourceRemovalImpact[\s\S]{0,160}404/.test(door));

const client = stripComments(read("src/studio/sourcesApi.ts"));
ok("context items reuse their established item removal door",
  /source\.context_item_id[\s\S]{0,220}removeContextItem/.test(client));
ok("other sources reuse their established source removal door",
  /await\s+deleteSource\(/.test(client) && !/op:\s*"delete"/.test(client));
ok("client validates the impact source identity",
  /impact\.source_id[\s\S]{0,80}sourceId/.test(client));

const screen = stripComments(read("src/studio/SourcesStudio.tsx"));
ok("removal stays locked unless impact loaded successfully",
  /impactState\s*!==\s*"ready"/.test(screen) && /disabled=\{removing \|\| impactState/.test(screen));
ok("screen asks for typed confirmation before destructive removal",
  /confirmation\s*!==\s*copy\.confirmWord/.test(screen) && /copy\.confirmInstructionTemplate/.test(screen));
ok("unknown state and reason codes remain visible instead of inventing a cause",
  /copy\.statusUnavailable/.test(screen) && /copy\.detailCodeTemplate/.test(screen));

const en = stripComments(read("src/studio/copy.ts"));
const hi = stripComments(read("src/studio/hiCopy.ts"));
ok("English and Hindi both own a wired Sources copy block",
  /sourcesStudio:\s*EN_SOURCES_STUDIO/.test(en) && /sourcesStudio:\s*HI_SOURCES_STUDIO/.test(hi));
ok("new screen avoids attributing quarantine to other people",
  !/quarantined[^\n]{0,160}(other people|दूसरे लोग)/i.test(`${en}\n${hi}`));

// Real mounted race controls. The fixture injects deferred API promises into
// the actual component; Playwright changes scope and dialog selection before
// those promises settle, the failure shape a source scan cannot observe.
const browserSource = (id, name) => ({
  source_id: id, context_item_id: null, kind: "recording", display_name: name,
  state: "ready", state_detail_code: "", contains_third_parties: false,
  created_at: "2026-09-14T00:00:00.000Z",
  yield: { claims_approved: 1, claims_proposed: 0, voice_seconds: 12 },
});
const vite = await createServer({
  root: ROOT,
  configFile: false,
  plugins: [react()],
  logLevel: "silent",
  server: { host: "127.0.0.1", port: 0 },
});
let browser;
try {
  await vite.listen();
  const address = vite.httpServer.address();
  assert.ok(address && typeof address === "object");
  browser = await launchSuiteBrowser("sources-studio mounted races");
  const page = await browser.newPage({ viewport: { width: 900, height: 800 } });
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(String(error)));
  page.on("console", (message) => { if (message.type() === "error") runtimeErrors.push(message.text()); });
  await page.goto(`http://127.0.0.1:${address.port}/evals/sources-studio/mounted-fixture.html`);
  await page.waitForFunction(() => window.sourcesRaceTest?.snapshot().lists.length === 1);

  await page.click("#switch-scope");
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().lists.length === 2);
  await page.evaluate((rows) => window.sourcesRaceTest.resolveList(0, rows), [browserSource("old-a", "Old workspace source")]);
  await page.waitForTimeout(30);
  ok("mounted race: a late list from the old token and replica never paints",
    await page.getByText("Old workspace source").count() === 0);

  const currentRows = [browserSource("current-one", "Current source one"), browserSource("current-two", "Current source two")];
  await page.evaluate((rows) => window.sourcesRaceTest.resolveList(1, rows), currentRows);
  await page.getByText("Current source two").waitFor();
  await page.locator(".sources-row").filter({ hasText: "Current source one" }).getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().impacts.length === 1);
  await page.getByRole("button", { name: "Keep source" }).click();
  await page.locator(".sources-row").filter({ hasText: "Current source two" }).getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().impacts.length === 2);
  await page.evaluate(() => window.sourcesRaceTest.resolveImpact(0, {
    source_id: "current-one", claims_approved: 91, claims_proposed: 0, voice_seconds: 0, is_primary_voice: false,
  }));
  await page.waitForTimeout(30);
  ok("mounted race: a late impact from a closed source dialog never enters the next dialog",
    await page.getByText("91 accepted details").count() === 0
      && await page.getByText("Checking what will be removed").count() === 1);

  await page.evaluate(() => window.sourcesRaceTest.resolveImpact(1, {
    source_id: "current-two", claims_approved: 2, claims_proposed: 1, voice_seconds: 12, is_primary_voice: false,
  }));
  await page.getByText("2 accepted details").waitFor();
  await page.getByLabel("Confirmation text").fill("REMOVE");
  await page.getByRole("button", { name: "Remove forever" }).evaluate((button) => { button.click(); button.click(); });
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().removals.length === 1);
  ok("mounted race: two same-turn confirms dispatch one removal",
    (await page.evaluate(() => window.sourcesRaceTest.snapshot())).removals.length === 1);

  await page.evaluate(() => document.querySelector("#switch-scope").click());
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().lists.length === 3);
  await page.evaluate((rows) => window.sourcesRaceTest.resolveList(2, rows), [browserSource("new-scope", "New scope source")]);
  await page.getByText("New scope source").waitFor();
  await page.evaluate(() => window.sourcesRaceTest.resolveRemoval(0, { erasure: "pending", rebuild_required: true }));
  await page.waitForTimeout(30);
  const afterLateRemoval = await page.evaluate(() => window.sourcesRaceTest.snapshot());
  ok("mounted race: a late old-scope removal cannot erase current UI, show a receipt, or refresh enrollment",
    await page.getByText("New scope source").count() === 1
      && await page.getByText("Removal started. Private storage cleanup is still running.").count() === 0
      && afterLateRemoval.changedCallbacks === 0);

  await page.locator(".sources-row").filter({ hasText: "New scope source" }).getByRole("button", { name: "Remove" }).click();
  await page.waitForFunction(() => window.sourcesRaceTest.snapshot().impacts.length === 3);
  await page.evaluate(() => document.querySelector("#unmount-sources").click());
  await page.evaluate(() => window.sourcesRaceTest.resolveImpact(2, {
    source_id: "new-scope", claims_approved: 4, claims_proposed: 0, voice_seconds: 0, is_primary_voice: false,
  }));
  await page.waitForTimeout(30);
  ok("mounted race: an impact settling after unmount performs no visible work and raises no runtime error",
    await page.locator(".sources-studio").count() === 0 && runtimeErrors.length === 0,
    runtimeErrors.join(" | "));
} finally {
  await browser?.close();
  await vite.close();
}

console.log(`\n${checks} sources-studio checks passed`);
