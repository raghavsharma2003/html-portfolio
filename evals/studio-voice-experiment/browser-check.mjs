import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.VYAKTI_VISUAL_BASE || "http://127.0.0.1:5173";
const bundle = resolve(process.env.VYAKTI_VOICE_STUDIO_BUNDLE || "scratchpad/voice-matched-pack-20260828-r2/reports/owner-studio-bundle.json");
const review = resolve(".impeccable/review");
const systemChrome = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || (existsSync(systemChrome) ? systemChrome : undefined);
assert.ok(existsSync(bundle), `sealed fixture bundle is missing: ${bundle}`);
mkdirSync(review, { recursive: true });
const lifecycleTemp = mkdtempSync(join(tmpdir(), "vyakti-studio-lifecycle-"));
const replacementBundle = join(lifecycleTemp, "replacement-studio-bundle.json");
const invalidReplacementBundle = join(lifecycleTemp, "invalid-replacement.json");
const replacement = JSON.parse(readFileSync(bundle, "utf8"));
const originalRunId = replacement.runId;
replacement.runId = `${originalRunId}-replacement`;
replacement.manifest.runId = replacement.runId;
replacement.trials.runId = replacement.runId;
writeFileSync(replacementBundle, JSON.stringify(replacement));
writeFileSync(invalidReplacementBundle, "{}");

const browser = await chromium.launch({ headless: true, executablePath });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
  const issues = [];
  await page.addInitScript(() => {
    function TrackedAudio() {
      const audio = new EventTarget();
      audio.onended = null;
      audio.pause = () => {};
      audio.play = async () => {};
      const nativeDispatch = audio.dispatchEvent.bind(audio);
      audio.dispatchEvent = (event) => {
        const dispatched = nativeDispatch(event);
        if (event.type === "ended") audio.onended?.(event);
        return dispatched;
      };
      window.__voiceExperimentAudios ||= [];
      window.__voiceExperimentAudios.push(audio);
      window.__voiceExperimentAudio = audio;
      return audio;
    }
    window.Audio = TrackedAudio;
  });
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204, body: "" }));
  page.on("console", (message) => { if (["warning", "error"].includes(message.type())) issues.push(`${message.type()}:${message.text()}`); });
  page.on("pageerror", (error) => issues.push(`pageerror:${error.message}`));
  await page.goto(`${base}/evals/studio-voice-experiment/harness.html`, { waitUntil: "networkidle" });
  const attestationChecks = await page.evaluate(async () => {
    const api = window.__voiceExperimentCrypto;
    const bytesToBase64 = (bytes) => btoa(Array.from(new Uint8Array(bytes), (value) => String.fromCharCode(value)).join(""));
    const hash = async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (value) => value.toString(16).padStart(2, "0")).join("");
    const makeKey = async () => {
      const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
      const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
      const keyId = await hash(spki);
      return { pair, publicKey: { contract: "vyakti-studio-report-attestation/v1", algorithm: "RSASSA-PKCS1-v1_5", hash: "SHA-256", keyId, publicKeySha256: keyId, publicKeySpkiBase64: bytesToBase64(spki) } };
    };
    const first = await makeKey();
    const means = { owner_likeness: 3, naturalness: 3, indian_accent: 3, pronunciation: 3 };
    const candidate = (label) => ({ armLabel: label, model: `${label}-model`, modelRevision: "fixture-revision", n: 1, means, disclosure: { full: 1, partial: 0, absent: 0 }, descriptiveOverallMean: 3 });
    const body = {
      contract: "vyakti-exact-text-owner-voice-pack/v1",
      runId: "fixture-signed-run",
      sealedKeySha256: "a".repeat(64),
      status: "ratings_locked_mapping_unsealed",
      acceptedListeners: 1,
      cells: [{ languageId: "hi", comparison: "exact_text_cross_provider", winnerClaim: null, winnerReason: "Descriptive only.", candidates: [candidate("A"), candidate("B")] }],
      overallWinner: null,
      overallWinnerReason: "Language cells stay separate.",
    };
    const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", first.pair.privateKey, new TextEncoder().encode(api.canonical(body)));
    const attestation = { contract: "vyakti-studio-report-attestation/v1", algorithm: "RSASSA-PKCS1-v1_5", hash: "SHA-256", keyId: first.publicKey.keyId, signatureBase64: bytesToBase64(signature) };
    const bundleFor = (reportKey) => ({ runId: body.runId, manifest: { sealedKeySha256: body.sealedKeySha256, reportAttestation: reportKey } });
    const refused = async (candidateBody, candidateAttestation, candidateKey) => {
      try { await api.parseResult(JSON.stringify({ ...candidateBody, attestation: candidateAttestation }), bundleFor(candidateKey)); return false; }
      catch { return true; }
    };
    const parsed = await api.parseResult(JSON.stringify({ ...body, attestation }), bundleFor(first.publicKey));
    const second = await makeKey();
    return {
      valid: parsed.cells[0].candidates[0].model === "A-model",
      bitFlipRefused: await refused({ ...body, acceptedListeners: 2 }, attestation, first.publicKey),
      wrongKeyRefused: await refused(body, { ...attestation, keyId: second.publicKey.keyId }, second.publicKey),
      missingSignatureRefused: await refused(body, { ...attestation, signatureBase64: "" }, first.publicKey),
    };
  });
  assert.deepEqual(attestationChecks, { valid: true, bitFlipRefused: true, wrongKeyRefused: true, missingSignatureRefused: true }, "browser report attestation must fail closed");
  await page.getByText("Blind voice experiment", { exact: true }).click();
  await page.locator(".voice-experiment-import input[type=file]").setInputFiles(bundle);
  await page.getByRole("heading", { name: "First, learn the owner's real voice" }).waitFor({ timeout: 30_000 });
  await page.evaluate(async () => {
    localStorage.setItem("vy.voiceExperiment.progress.other-replica.sentinel-run", "keep-progress");
    localStorage.setItem("vy.voiceExperiment.result.other-replica.sentinel-run", "keep-result");
    localStorage.setItem("vy.voiceExperiment.latest.other-replica", "sentinel-run");
    await new Promise((resolve, reject) => {
      const open = indexedDB.open("vyakti-private-voice-experiments", 1);
      open.onsuccess = () => {
        const transaction = open.result.transaction("sealed-bundles", "readwrite");
        transaction.objectStore("sealed-bundles").put({ runId: "sentinel-run" }, "other-replica:sentinel-run");
        transaction.oncomplete = () => { open.result.close(); resolve(); };
        transaction.onerror = () => reject(transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  const sealedText = (await page.locator(".voice-experiment").innerText()).toLowerCase();
  assert.equal(["chatterbox", "qwen", "voxcpm", "indicf5", "zonos"].some((name) => sealedText.includes(name)), false, "model name leaked before rating");
  await page.getByRole("button", { name: "Play real owner" }).click();
  assert.equal(await page.getByRole("button", { name: "Start blind rating" }).isDisabled(), true, "starting audio must not count as hearing the reference");
  await page.evaluate(() => window.__voiceExperimentAudio.dispatchEvent(new Event("ended")));
  await page.getByRole("button", { name: "Start blind rating" }).click();
  await page.getByRole("button", { name: "Play hidden clip" }).click();
  for (const fieldset of await page.locator(".voice-experiment-axes fieldset").all()) await fieldset.getByRole("button", { name: /3 of 5$/ }).click();
  await page.locator(".voice-experiment-disclosure button").first().click();
  assert.equal(await page.getByRole("button", { name: "Save and continue" }).isDisabled(), true, "starting a candidate must not count as hearing it");
  await page.evaluate(() => { window.__interruptedVoiceExperimentAudio = window.__voiceExperimentAudio; });
  await page.getByRole("button", { name: "Play real owner" }).click();
  await page.evaluate(() => window.__interruptedVoiceExperimentAudio.dispatchEvent(new Event("ended")));
  assert.equal(await page.getByRole("button", { name: "Save and continue" }).isDisabled(), true, "a stale ended event from an interrupted candidate must not enable advance");
  await page.evaluate(() => window.__voiceExperimentAudio.dispatchEvent(new Event("ended")));
  assert.equal(await page.getByRole("button", { name: "Save and continue" }).isDisabled(), true, "interrupting a candidate with the reference must not enable advance");
  await page.getByRole("button", { name: "Play hidden clip" }).click();
  await page.evaluate(() => window.__voiceExperimentAudio.dispatchEvent(new Event("ended")));
  await page.waitForFunction(() => Array.from(document.querySelectorAll("button")).some((button) => button.textContent?.trim() === "Save and continue" && !button.disabled));
  assert.equal(await page.getByRole("button", { name: "Save and continue" }).isEnabled(), true);
  const progressbar = page.getByRole("progressbar", { name: "Blind experiment progress" });
  assert.equal(await progressbar.getAttribute("aria-valuemin"), "0");
  assert.equal(await progressbar.getAttribute("aria-valuemax"), "10");
  assert.equal(await progressbar.getAttribute("aria-valuenow"), "1");
  assert.equal(await progressbar.getAttribute("aria-valuetext"), "1 of 10 ratings complete");
  await page.locator(".voice-experiment > summary").focus();
  assert.equal(await page.locator(".voice-experiment > summary").evaluate((summary) => getComputedStyle(summary).outlineWidth), "3px", "experiment summary needs a visible keyboard focus ring");
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true, "desktop horizontal overflow");
  const desktop = resolve(review, "voice-experiment-desktop.png");
  await page.screenshot({ path: desktop, fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth), true, "mobile horizontal overflow");
  const shortMobileActions = await page.locator(".voice-experiment button, .voice-experiment summary, .voice-experiment label.button, .voice-experiment-portability label, .voice-experiment-lifecycle label").evaluateAll((elements) => elements
    .filter((element) => element instanceof HTMLElement && element.offsetParent !== null)
    .map((element) => ({ text: element.textContent?.trim() || element.getAttribute("aria-label") || element.tagName, height: element.getBoundingClientRect().height }))
    .filter(({ height }) => height < 44));
  assert.deepEqual(shortMobileActions, [], `mobile actions below 44px: ${JSON.stringify(shortMobileActions)}`);
  await page.locator(".voice-experiment-portability input[type=file]").focus();
  assert.equal(await page.locator(".voice-experiment-portability label").evaluate((label) => getComputedStyle(label).outlineWidth), "3px", "file action needs a focus-within ring");
  await page.evaluate(() => document.activeElement?.blur());
  const mobile = resolve(review, "voice-experiment-mobile.png");
  await page.screenshot({ path: mobile, fullPage: true });

  await page.reload({ waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Play hidden clip" }).waitFor({ timeout: 30_000 });
  assert.equal(await page.getByRole("button", { name: "Save and continue" }).isDisabled(), true, "resumed trial must be replayed before continuing");
  assert.equal((await page.locator(".voice-experiment").innerText()).includes("Progress saved locally"), true, "local progress did not resume");

  for (let attempt = 0; attempt < 24 && await page.getByText("Ratings locked on this browser", { exact: true }).count() === 0; attempt += 1) {
    const hidden = page.getByRole("button", { name: /^Play hidden clip/ });
    const check = page.getByRole("button", { name: /^Play check/ });
    if (await hidden.count()) {
      await hidden.click();
      await page.evaluate(() => window.__voiceExperimentAudio.dispatchEvent(new Event("ended")));
      for (const fieldset of await page.locator(".voice-experiment-axes fieldset").all()) await fieldset.getByRole("button", { name: /3 of 5$/ }).click();
      await page.locator(".voice-experiment-disclosure button").first().click();
    } else {
      assert.equal(await check.count(), 1, "expected a rating or attention trial");
      await check.click();
      await page.evaluate(() => window.__voiceExperimentAudio.dispatchEvent(new Event("ended")));
      await page.locator(".voice-experiment-attention > div button").first().click();
    }
    const lock = page.getByRole("button", { name: "Lock ratings" });
    if (await lock.count()) {
      await page.getByText("Ready to lock", { exact: true }).waitFor();
      assert.equal((await page.locator(".voice-experiment-lock-warning").innerText()).includes("irreversible"), true, "lock must be explained before the final action");
      await lock.click();
    } else {
      await page.getByRole("button", { name: "Save and continue" }).click();
    }
  }
  await page.getByText("Ratings locked on this browser", { exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Review ratings" }).count(), 0, "locked ratings must be read-only");
  assert.equal(await page.locator(".voice-experiment-axes").count(), 0, "locked ratings must not expose edit controls");
  assert.equal(await page.getByRole("button", { name: "Export locked ratings" }).count(), 1, "locked sheet must remain exportable");
  const lockedSheet = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((candidate) => candidate.startsWith("vy.voiceExperiment.progress."));
    return key ? JSON.parse(localStorage.getItem(key)) : null;
  });
  assert.equal(lockedSheet?.complete, true, "lock must persist the accepted complete state");
  assert.match(lockedSheet?.finishedAt || "", /^\d{4}-\d{2}-\d{2}T/, "lock must persist a completion timestamp");

  await page.evaluate((runId) => localStorage.setItem(`vy.voiceExperiment.result.fixture-owner-replica.${runId}`, "superseded-result"), originalRunId);
  await page.evaluate(() => {
    window.__voiceExperimentDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = () => { throw new DOMException("fixture cleanup failure", "UnknownError"); };
  });
  await page.locator(".voice-experiment-lifecycle input[type=file]").setInputFiles(replacementBundle);
  await page.getByRole("alert").getByText("The new pack was not loaded because browser storage could not fully remove the old private experiment. The current experiment remains open.", { exact: true }).waitFor();
  assert.equal(await page.getByText("Ratings locked on this browser", { exact: true }).count(), 1, "cleanup failure must retain the current UI");
  const retainedAfterCleanupFailure = await page.evaluate((runId) => ({
    pointer: localStorage.getItem("vy.voiceExperiment.latest.fixture-owner-replica"),
    progress: localStorage.getItem(`vy.voiceExperiment.progress.fixture-owner-replica.${runId}`),
    result: localStorage.getItem(`vy.voiceExperiment.result.fixture-owner-replica.${runId}`),
  }), originalRunId);
  assert.equal(retainedAfterCleanupFailure.pointer, originalRunId, "cleanup failure must retain the current pointer");
  assert.ok(retainedAfterCleanupFailure.progress, "cleanup failure must retain current progress");
  assert.equal(retainedAfterCleanupFailure.result, "superseded-result", "cleanup failure must retain the current result");
  await page.evaluate(() => { IDBObjectStore.prototype.delete = window.__voiceExperimentDelete; });
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.locator(".voice-experiment-lifecycle input[type=file]").setInputFiles(invalidReplacementBundle);
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByText("Ratings locked on this browser", { exact: true }).count(), 1, "an invalid replacement must not remove the current experiment");
  const retainedAfterInvalid = await page.evaluate((runId) => new Promise((resolve, reject) => {
    const open = indexedDB.open("vyakti-private-voice-experiments", 1);
    open.onsuccess = () => {
      const request = open.result.transaction("sealed-bundles", "readonly").objectStore("sealed-bundles").get(`fixture-owner-replica:${runId}`);
      request.onsuccess = () => { open.result.close(); resolve(request.result?.runId || null); };
      request.onerror = () => reject(request.error);
    };
    open.onerror = () => reject(open.error);
  }), originalRunId);
  assert.equal(retainedAfterInvalid, originalRunId, "replacement cleanup must begin only after the new pack validates");
  await page.getByRole("button", { name: "Dismiss" }).click();
  await page.locator(".voice-experiment-lifecycle input[type=file]").setInputFiles(replacementBundle);
  await page.getByRole("heading", { name: "First, learn the owner's real voice" }).waitFor();
  const afterReplace = await page.evaluate(async ({ oldRunId, newRunId }) => {
    const readBundle = (runId) => new Promise((resolve, reject) => {
      const open = indexedDB.open("vyakti-private-voice-experiments", 1);
      open.onsuccess = () => {
        const request = open.result.transaction("sealed-bundles", "readonly").objectStore("sealed-bundles").get(`fixture-owner-replica:${runId}`);
        request.onsuccess = () => { open.result.close(); resolve(request.result || null); };
        request.onerror = () => reject(request.error);
      };
      open.onerror = () => reject(open.error);
    });
    const oldBundle = await readBundle(oldRunId);
    const newBundle = await readBundle(newRunId);
    return {
      oldBundle: oldBundle ? oldBundle.runId : null,
      newBundle: newBundle ? newBundle.runId : null,
      oldProgress: localStorage.getItem(`vy.voiceExperiment.progress.fixture-owner-replica.${oldRunId}`),
      oldResult: localStorage.getItem(`vy.voiceExperiment.result.fixture-owner-replica.${oldRunId}`),
      pointer: localStorage.getItem("vy.voiceExperiment.latest.fixture-owner-replica"),
    };
  }, { oldRunId: originalRunId, newRunId: replacement.runId });
  assert.equal(afterReplace.oldBundle, null, "superseded IndexedDB bundle must be purged");
  assert.equal(afterReplace.oldProgress, null, "superseded progress must be purged");
  assert.equal(afterReplace.oldResult, null, "superseded result must be purged");
  assert.equal(afterReplace.newBundle, replacement.runId, "replacement bundle must be the only current run");
  assert.equal(afterReplace.pointer, replacement.runId, "replacement pointer must bind to the new run");

  await page.evaluate(() => {
    window.__voiceExperimentDelete = IDBObjectStore.prototype.delete;
    IDBObjectStore.prototype.delete = () => { throw new DOMException("fixture delete failure", "UnknownError"); };
  });
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove private experiment" }).click();
  await page.getByRole("alert").getByText("Browser storage failed while removing this private experiment. The current experiment remains open. Try again before leaving this device.", { exact: true }).waitFor();
  assert.equal(await page.getByRole("heading", { name: "First, learn the owner's real voice" }).count(), 1, "delete cleanup failure must retain the current UI");
  const retainedAfterDeleteFailure = await page.evaluate((runId) => ({
    pointer: localStorage.getItem("vy.voiceExperiment.latest.fixture-owner-replica"),
    runId,
  }), replacement.runId);
  assert.deepEqual(retainedAfterDeleteFailure, { pointer: replacement.runId, runId: replacement.runId }, "delete cleanup failure must retain the current pointer");
  await page.evaluate(() => { IDBObjectStore.prototype.delete = window.__voiceExperimentDelete; });
  await page.getByRole("button", { name: "Dismiss" }).click();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Remove private experiment" }).click();
  await page.getByRole("heading", { name: "Open a sealed listening pack" }).waitFor();
  const afterRemove = await page.evaluate(async (runId) => {
    const stored = await new Promise((resolve, reject) => {
      const open = indexedDB.open("vyakti-private-voice-experiments", 1);
      open.onsuccess = () => {
        const request = open.result.transaction("sealed-bundles", "readonly").objectStore("sealed-bundles").get(`fixture-owner-replica:${runId}`);
        request.onsuccess = () => { open.result.close(); resolve(request.result || null); };
        request.onerror = () => reject(request.error);
      };
      open.onerror = () => reject(open.error);
    });
    const sentinel = await new Promise((resolve, reject) => {
      const open = indexedDB.open("vyakti-private-voice-experiments", 1);
      open.onsuccess = () => {
        const request = open.result.transaction("sealed-bundles", "readonly").objectStore("sealed-bundles").get("other-replica:sentinel-run");
        request.onsuccess = () => { open.result.close(); resolve(request.result || null); };
        request.onerror = () => reject(request.error);
      };
      open.onerror = () => reject(open.error);
    });
    return {
      stored,
      progress: localStorage.getItem(`vy.voiceExperiment.progress.fixture-owner-replica.${runId}`),
      result: localStorage.getItem(`vy.voiceExperiment.result.fixture-owner-replica.${runId}`),
      pointer: localStorage.getItem("vy.voiceExperiment.latest.fixture-owner-replica"),
      sentinelRun: sentinel?.runId || null,
      sentinelProgress: localStorage.getItem("vy.voiceExperiment.progress.other-replica.sentinel-run"),
      sentinelResult: localStorage.getItem("vy.voiceExperiment.result.other-replica.sentinel-run"),
      sentinelPointer: localStorage.getItem("vy.voiceExperiment.latest.other-replica"),
    };
  }, replacement.runId);
  assert.deepEqual(afterRemove, {
    stored: null,
    progress: null,
    result: null,
    pointer: null,
    sentinelRun: "sentinel-run",
    sentinelProgress: "keep-progress",
    sentinelResult: "keep-result",
    sentinelPointer: "sentinel-run",
  }, "removal must purge only the current replica/run and reset the pointer");
  assert.deepEqual(issues, [], `browser issues: ${issues.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, desktop, mobile, issues: issues.length }, null, 2));
} finally {
  await browser.close();
  rmSync(lifecycleTemp, { recursive: true, force: true });
}
