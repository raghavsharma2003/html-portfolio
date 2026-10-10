import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { launchSuiteBrowser } from "../rehearsal/browser.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = join(root, "scratchpad", "private-voice-test27");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
await build({
  root,
  configFile: false,
  logLevel: "error",
  define: { "process.env.NODE_ENV": JSON.stringify("production") },
  build: {
    outDir: out,
    emptyOutDir: true,
    lib: { entry: join(root, "evals/private-voice-test27/host.tsx"), formats: ["iife"], name: "PrivateVoiceTestFixture", fileName: () => "fixture.js" },
  },
});
const js = readFileSync(join(out, "fixture.js"));
const cssName = readdirSync(out).find((name) => name.endsWith(".css"));
assert.ok(cssName, "focused fixture must emit the component CSS");
const css = readFileSync(join(out, cssName));
const server = createServer((request, response) => {
  if (request.url === "/fixture.js") {
    response.writeHead(200, { "content-type": "text/javascript" });
    response.end(js);
    return;
  }
  if (request.url === "/style.css") {
    response.writeHead(200, { "content-type": "text/css" });
    response.end(css);
    return;
  }
  response.writeHead(200, { "content-type": "text/html" });
  response.end(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/style.css"><style>body{margin:0;padding:20px;background:#f7f8fa;font:15px Instrument Sans,Arial,sans-serif;color:#20242d}nav{display:flex;gap:8px;margin-bottom:16px}nav button{min-height:44px}</style><div id="root"></div><script src="/fixture.js"></script>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const replicaId = "10000000-0000-4000-8000-000000000027";
const statementSet = "private-own-voice/v1";
const permissionStatement = "This recording is my own voice. Use it to make this private AI voice sample for me.";
const wav = (() => {
  const samples = 800, bytes = samples * 2, buffer = Buffer.alloc(44 + bytes);
  buffer.write("RIFF", 0); buffer.writeUInt32LE(36 + bytes, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(8000, 24); buffer.writeUInt32LE(16000, 28); buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(bytes, 40);
  return buffer;
})();
const config = (account) => ({
  enabled: true,
  scope: "private_voice_test",
  statement_set: statementSet,
  statement: permissionStatement,
  config: { text: account === "B" ? "खाता बी का नमूना" : "fixture", language_id: "hi", model_arm: "hindi_v3", seed: 27, public_release: false },
  text_limits: { max_code_points: 280, language_id: "hi", english_supported: false },
  candidates: [{ source_id: `source-${account}`, artifact_id: `artifact-${account}`, reference_sha256: "a".repeat(64), duration_ms: 24000, snapshot_hash: `snapshot-${account}` }],
});
const run = (runId, state, account = "A") => ({
  run_id: runId,
  source_id: `source-${account}`,
  artifact_id: `artifact-${account}`,
  state,
  scope: "private_voice_test",
  identity_scope: "account_self_attestation",
  release_eligible: false,
  identity_claim_allowed: false,
  config: config(account).config,
  created_at: "2026-09-27T00:00:00.000Z",
  expires_at: "2026-09-28T00:00:00.000Z",
  error_code: null,
  cleanup_pending: false,
  metrics: state === "ready" ? { total_ms: 9000, model_elapsed_ms: 8000, duration_ms: 4200, real_time_factor: 2, first_audible_ms: null } : null,
  ratings: null,
  audio_available: state === "ready",
});
let checks = 0;
const pass = (name) => console.log(`ok ${++checks} - ${name}`);
const browser = await launchSuiteBrowser("private-voice-test27");
const errors = [];

async function pageWithRoute(handler, query = "") {
  const context = await browser.newContext({ viewport: { width: 390, height: 900 } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/private-voice**", handler);
  await page.goto(`${origin}/${query}`, { waitUntil: "domcontentloaded" });
  return { context, page };
}

try {
  {
    let posts = 0;
    const { context, page } = await pageWithRoute((route) => {
      if (route.request().method() === "POST") posts += 1;
      return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ enabled: false, error: "private_voice_disabled" }) });
    });
    await page.getByRole("heading", { name: "Private voice test is not available yet" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Make private sample" }).count(), 0);
    assert.equal(posts, 0);
    assert.deepEqual(await page.evaluate(() => window.privateVoiceProbe.availability), [false]);
    pass("disabled mode is an honest read-only refusal with no generation control");
    await context.close();
  }

  {
    const { context, page } = await pageWithRoute((route) => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: "private_voice_session_invalid" }) }));
    await page.getByRole("heading", { name: "We could not check the private voice test" }).waitFor();
    assert.equal(await page.evaluate(() => window.privateVoiceProbe.authErrors), 1);
    assert.deepEqual(await page.evaluate(() => window.privateVoiceProbe.availability), []);
    pass("authentication failure reaches the owner callback without caching capability false");
    await context.close();
  }

  {
    let postCount = 0, statusReads = 0, audioReads = 0, activeRun = "";
    const requests = [];
    const { context, page } = await pageWithRoute(async (route) => {
      const request = route.request(), url = new URL(request.url());
      requests.push({ method: request.method(), url: request.url(), authorization: request.headers().authorization, body: request.postDataJSON?.() });
      assert.equal(request.headers().authorization, "Bearer synthetic-account-A");
      if (url.searchParams.get("action") === "audio") {
        audioReads += 1;
        assert.equal(url.searchParams.get("run_id"), activeRun);
        assert.equal(url.searchParams.has("token"), false);
        return route.fulfill({ status: 200, contentType: "audio/wav", body: wav });
      }
      if (url.searchParams.get("action") === "status") {
        statusReads += 1;
        assert.equal(url.searchParams.get("run_id"), activeRun);
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ run: run(activeRun, statusReads === 1 ? "queued" : "ready") }) });
      }
      if (request.method() === "POST") {
        postCount += 1;
        const body = request.postDataJSON();
        activeRun = body.run_id;
        assert.deepEqual(body, {
          action: "generate", replica_id: replicaId, source_id: "source-A", artifact_id: "artifact-A",
          run_id: activeRun, expected_snapshot_hash: "snapshot-A", statement_set: statementSet,
          attestations: { own_voice_private_use: true },
          text: "आज नया AI concept समझेंगे।",
        });
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "private_voice_dispatch_uncertain", blocker_class: "us" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    });
    await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
    assert.equal(postCount, 0);
    const generate = page.getByRole("button", { name: "Make private sample" });
    assert.equal(await generate.isDisabled(), true);
    const sampleText = page.getByRole("textbox", { name: "What should your voice say?" });
    assert.equal(await sampleText.inputValue(), "fixture");
    await sampleText.fill("आज नया AI concept समझेंगे।");
    await page.getByRole("checkbox").check();
    assert.equal(await generate.isEnabled(), true);
    assert.ok((await generate.boundingBox()).height >= 44);
    await generate.click();
    await page.getByRole("heading", { name: "Sample ready" }).waitFor({ timeout: 10000 });
    const audio = page.locator('audio[src^="blob:"]');
    await audio.waitFor();
    assert.equal(postCount, 1);
    assert.ok(statusReads >= 2);
    assert.equal(audioReads, 1);
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
    const source = await audio.getAttribute("src");
    assert.ok(source.startsWith("blob:"));
    assert.equal(requests.some((item) => item.url.includes(activeRun) && item.url.includes("token=")), false);
    pass("explicit attested generation preserves one UUID through uncertain POST reconciliation, polling and bearer WAV playback");

    await page.getByRole("button", { name: "Leave voice test" }).click();
    await page.getByRole("heading", { name: "Voice test closed" }).waitFor();
    await page.waitForFunction((url) => window.privateVoiceProbe.revoked.includes(url), source);
    pass("unmount revokes the authenticated WAV blob URL");
    await context.close();
  }

  {
    let posts = 0;
    const malformed = config("A");
    delete malformed.config.text;
    const { context, page } = await pageWithRoute((route) => {
      if (route.request().method() === "POST") posts += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(malformed) });
    });
    await page.getByRole("heading", { name: "We could not check the private voice test" }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Make private sample" }).count(), 0);
    assert.equal(await page.getByRole("textbox", { name: "What should your voice say?" }).count(), 0);
    const details = page.getByText("Technical details", { exact: true });
    assert.equal(await details.isVisible(), true);
    assert.equal(await page.getByText("private_voice_response_invalid", { exact: true }).isVisible(), false);
    await details.click();
    assert.equal(await page.getByText("private_voice_response_invalid", { exact: true }).isVisible(), true);
    assert.equal(posts, 0);
    pass("a malformed spoken-text config is rejected before the component can dereference it");
    await context.close();
  }

  {
    let posts = 0;
    const { context, page } = await pageWithRoute((route) => {
      if (route.request().method() === "POST") posts += 1;
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    });
    await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
    await page.getByRole("textbox", { name: "What should your voice say?" }).fill("अ".repeat(281));
    await page.getByRole("checkbox").check();
    assert.equal(await page.getByRole("button", { name: "Make private sample" }).isDisabled(), true);
    assert.equal(await page.getByText("281 of 280 characters", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Use Hindi or Hinglish. This Hindi model does not support English-only text.", { exact: true }).count(), 1);
    assert.equal(posts, 0);
    pass("the owner text editor enforces its code-point bound before generation and names the English limit");
    await context.close();
  }

  {
    const postBodies = [];
    let statusReads = 0;
    const { context, page } = await pageWithRoute((route) => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === "POST") {
        const body = request.postDataJSON(); postBodies.push(body);
        if (postBodies.length === 1) return route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "private_voice_english_not_supported", blocker_class: "you" }) });
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ created: true, run: run(body.run_id, "failed") }) });
      }
      if (url.searchParams.get("action") === "status") {
        statusReads += 1;
        return route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "private_voice_request_unavailable" }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    });
    await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
    const editor = page.getByRole("textbox", { name: "What should your voice say?" });
    await editor.fill("Explain this concept in English.");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Make private sample" }).click();
    await page.getByText("Use Hindi or Hinglish, then try again.", { exact: true }).waitFor();
    assert.equal(await editor.inputValue(), "Explain this concept in English.");
    assert.equal(await page.getByRole("radio", { name: /Recording 1/ }).isChecked(), true);
    await editor.fill("आज यह concept समझेंगे।");
    await page.getByRole("button", { name: "Make private sample" }).click();
    await page.getByRole("heading", { name: "Sample failed" }).waitFor();
    assert.equal(statusReads, 1);assert.equal(postBodies.length, 2);
    assert.notEqual(postBodies[0].run_id, postBodies[1].run_id);
    assert.equal(postBodies[0].text, "Explain this concept in English.");
    assert.equal(postBodies[1].text, "आज यह concept समझेंगे।");
    pass("a confirmed text refusal reopens the same setup and correction uses a new request ID");
    await context.close();
  }

  {
    let posts = 0, statusReads = 0;
    let holdStatus;
    const statusArrived = new Promise((resolve) => { holdStatus = resolve; });
    const { context, page } = await pageWithRoute((route) => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() === "POST") {
        posts += 1;
        return route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "private_voice_dispatch_uncertain", blocker_class: "us" }) });
      }
      if (url.searchParams.get("action") === "status") {
        statusReads += 1;
        holdStatus(route);
        return;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    });
    await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
    await page.getByRole("textbox", { name: "What should your voice say?" }).fill("आज यह concept समझेंगे।");
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Make private sample" }).click();
    const heldStatus = await statusArrived;
    await page.getByRole("heading", { name: "Status needs checking" }).waitFor();
    assert.equal(posts, 1);assert.equal(statusReads, 1);
    await heldStatus.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "private_voice_request_unavailable" }) });
    const settledCode = page.locator(".private-voice-test__run .private-voice-test__code code").filter({ hasText: "private_voice_request_unavailable" });
    await settledCode.waitFor({ state: "attached" });
    assert.equal(await settledCode.textContent(), "private_voice_request_unavailable");
    assert.equal(posts, 1);assert.equal(statusReads, 1);
    assert.equal(await page.getByRole("textbox", { name: "What should your voice say?" }).count(), 0);
    assert.equal(await page.getByText("Use Hindi or Hinglish, then try again.", { exact: true }).count(), 0);
    pass("an ambiguous dispatch followed by not-found preserves the unknown request and blocks a second submission");
    await context.close();
  }

  {
    const legacy = { ...config("A") };
    legacy.config = { ...legacy.config, text: "आज हम यह सवाल समझेंगे।" };
    delete legacy.text_limits;
    let posted;
    const { context, page } = await pageWithRoute((route) => {
      if (route.request().method() === "POST") {
        posted = route.request().postDataJSON();
        return route.fulfill({ status: 202, contentType: "application/json", body: JSON.stringify({ created: true, run: run(posted.run_id, "failed") }) });
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(legacy) });
    });
    await page.getByRole("heading", { name: "Test your voice privately" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "What should your voice say?" }).count(), 0);
    assert.equal(await page.getByText("This voice test will speak the fixed sample below.", { exact: true }).count(), 1);
    assert.equal(await page.getByRole("heading", { name: "Your permission" }).count(), 1);
    assert.equal(await page.getByText("आज हम यह सवाल समझेंगे।", { exact: true }).count(), 1);
    const spoken = page.locator("blockquote").filter({ hasText: "आज हम यह सवाल समझेंगे।" });
    const permission = page.locator("blockquote").filter({ hasText: permissionStatement });
    assert.equal(await spoken.getAttribute("lang"), "hi");
    assert.equal(await permission.getAttribute("lang"), "en");
    assert.equal(await permission.innerText(), permissionStatement);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Make private sample" }).click();
    await page.getByRole("heading", { name: "Sample failed" }).waitFor();
    assert.equal(Object.hasOwn(posted, "text"), false);
    pass("an older CPU keeps the fixed sample path and receives no unsupported text field");
    await context.close();
  }

  {
    let held;
    const { context, page } = await pageWithRoute((route) => {
      const token = route.request().headers().authorization;
      if (token === "Bearer synthetic-account-A") {
        held = route;
        return;
      }
      assert.equal(token, "Bearer synthetic-account-B");
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("B")) });
    });
    while (!held) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.getByRole("button", { name: "Switch account" }).click();
    await page.waitForFunction(() => document.querySelector("#private-voice-sample-text")?.value === "खाता बी का नमूना");
    await held.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    await page.waitForTimeout(100);
    assert.equal(await page.locator("#private-voice-sample-text").inputValue(), "खाता बी का नमूना");
    assert.equal(await page.getByText(permissionStatement, { exact: true }).count(), 1);
    pass("a late previous-account configuration cannot render into the current scope");
    await context.close();
  }

  {
    let reads = 0, held;
    const empty = { ...config("A"), candidates: [] };
    const { context, page } = await pageWithRoute((route) => {
      reads += 1;
      if (reads === 1) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(empty) });
      if (reads === 2) {
        held = route;
        return;
      }
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(config("A")) });
    }, "?processing=1");
    await page.getByText("Your recording is being prepared.", { exact: true }).waitFor();
    assert.equal(await page.getByRole("button", { name: "Add a recording" }).count(), 0);
    await page.getByRole("button", { name: "Check again" }).click();
    while (!held) await new Promise((resolve) => setTimeout(resolve, 10));
    await page.getByRole("button", { name: "Finish source processing" }).click();
    await page.getByText("Recording 1", { exact: true }).waitFor();
    assert.equal(await page.getByText("Hindi and Hinglish", { exact: true }).count(), 1);
    await held.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(empty) });
    await page.waitForTimeout(100);
    assert.equal(await page.getByText("Recording 1", { exact: true }).count(), 1);
    assert.equal(await page.getByText("Your recording is being prepared.", { exact: true }).count(), 0);
    pass("source processing refresh reveals candidates and an older same-account availability response cannot clobber them");
    await context.close();
  }

  {
    const { context, page } = await pageWithRoute((route) => route.fulfill({
      status: 200, contentType: "application/json", body: JSON.stringify(config("A")),
    }), "?lang=hi");
    await page.getByRole("heading", { name: "अपनी आवाज़ निजी रूप से जाँचें" }).waitFor();
    assert.equal(await page.getByRole("textbox", { name: "आवाज़ क्या बोले?" }).count(), 1);
    assert.equal(await page.getByText("हिंदी या हिंग्लिश लिखें। यह हिंदी मॉडल केवल अंग्रेज़ी वाक्य नहीं बोलता।", { exact: true }).count(), 1);
    assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true);
    assert.ok((await page.getByRole("button", { name: "निजी नमूना बनाएँ" }).boundingBox()).height >= 44);
    pass("Hindi copy reflows at phone width with a 44px primary action");
    await context.close();
  }

  {
    let requests = 0;
    const { context } = await pageWithRoute((route) => { requests += 1; return route.abort(); }, "?no-token=1");
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(requests, 0);
    pass("missing authentication material issues no private voice request");
    await context.close();
  }


  {
    const id = "88888888-8888-4888-8888-888888888888";
    let posts = 0, reads = 0;
    const {context,page} = await pageWithRoute(route => {
      const u = new URL(route.request().url());
      if (route.request().method() === "POST") { posts++; return route.fulfill({status:500,body:"{}"}); }
      if (u.searchParams.get("action") === "status") { reads++; return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({run:run(id,"failed")})}); }
      return route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({...config(),resume_run_id:id})});
    });
    await page.getByRole("heading",{name:"Sample failed",exact:true}).waitFor();
    assert.equal(reads,1);assert.equal(posts,0);
    await context.close();
    pass("a fresh browser discovers the account's saved request without a second generation");
  }
  assert.deepEqual(errors, []);
  console.log(`PASS ${checks} mounted component groups; synthetic HTTP and WAV only, no provider, account, likeness or quality evidence.`);
} finally {
  await Promise.race([browser.close(), new Promise((resolve) => setTimeout(resolve, 3000))]);
  server.closeAllConnections?.();
  await Promise.race([
    new Promise((resolve) => server.close(resolve)),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]);
}
process.exit(0);
