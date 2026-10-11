import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { launchSuiteBrowser } from "./rehearsal/browser.mjs";

const base = process.env.CONTEXT_PROPOSAL_TEST_URL || "http://localhost:5177";
const out = resolve("scratchpad/context-proposal-review");
mkdirSync(out, { recursive: true });
const browser = await launchSuiteBrowser("context-proposal-review-ui");
let checks = 0;
const ok = (condition, name) => { assert.ok(condition, name); console.log(`ok ${++checks} - ${name}`); };
try {
  for (const [name, viewport, reducedMotion] of [
    ["phone", { width: 390, height: 844 }, "reduce"],
    ["desktop", { width: 1355, height: 900 }, "no-preference"],
  ]) {
    const context = await browser.newContext({ viewport, reducedMotion });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    const openFiles = async (suffix = "") => {
      await page.goto(`${base}/studio-layout-fixture.html?scenario=knowledge-phrases&step=feed${suffix}`);
      await page.getByRole("button", { name: "Add knowledge first" }).click();
      await page.getByRole("button", { name: "Files, images, links" }).click();
      await page.getByRole("button", { name: "View phrases" }).first().waitFor();
    };
    await openFiles();
    ok(await page.locator(".vx-room-nav").count() === 0, `${name}: phrases reachable before voice navigation`);
    await page.locator("#context-locker input[type=file]").setInputFiles([
      { name: "My lesson notes.txt", mimeType: "text/plain", buffer: Buffer.from("Fixture writing") },
      { name: "Unreadable.pdf", mimeType: "application/pdf", buffer: Buffer.from("Fixture scan") },
    ]);
    await page.getByText("Unreadable.pdf", { exact: true }).waitFor();
    const trigger = page.getByRole("button", { name: "View phrases" }).last();
    await trigger.focus(); await page.keyboard.press("Enter");
    await page.getByText("Private. Not applied to your AI yet.", { exact: true }).waitFor();
    ok(await page.getByRole("heading", { name: "Suggested phrases" }).evaluate(el => document.activeElement === el), `${name}: deliberate open focuses heading`);
    ok(await page.getByText("Unreadable.pdf", { exact: true }).count() === 1, `${name}: mixed upload results retained`);
    ok(await page.locator(".context-proposal-review script").count() === 0 && await page.getByText("<script>alert(1)</script>", { exact: true }).count() === 1, `${name}: hostile fragment rendered as text`);
    const geometry = await page.locator(".context-proposal-review").evaluate(el => ({
      width: el.getBoundingClientRect().width,
      overflow: document.documentElement.scrollWidth > innerWidth,
      font: getComputedStyle(el.querySelector("p")).fontSize,
      color: getComputedStyle(el).color,
      animation: getComputedStyle(el).animationName,
    }));
    ok(!geometry.overflow && geometry.width > 280 && parseFloat(geometry.font) >= 16, `${name}: readable width/type without page overflow`);
    ok(geometry.animation === "none", `${name}: no added motion in ${reducedMotion} mode`);
    await page.screenshot({ path: resolve(out, `${name}.png`), fullPage: false });
    await page.getByRole("button", { name: "Back to files" }).click();
    ok(await trigger.evaluate(el => document.activeElement === el), `${name}: close restores trigger focus`);
    await trigger.click();
    await page.getByRole("heading", { name: "Suggested phrases" }).waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.getByText("Nothing yet.", { exact: true }).waitFor();
    ok(await page.locator(".context-proposal-review").count() === 0 && await page.getByRole("button", { name: "View phrases" }).count() === 0, `${name}: removal clears both recent and stored proposal access`);
    await openFiles("&phrases=unavailable");
    await page.getByRole("button", { name: "View phrases" }).click();
    await page.getByText("These suggestions are no longer available. Your file may have been removed.").waitFor();
    ok(await page.getByRole("button", { name: "Try again" }).isVisible(), `${name}: unavailable source has recovery, no invented phrases`);
    await openFiles("&phrases=historical");
    await page.getByRole("button", { name: "View phrases" }).click();
    await page.getByText("We cannot confirm whether these suggestions were saved to a draft.").waitFor();
    ok(await page.getByText("Private. Not applied to your AI yet.", { exact: true }).count() === 0, `${name}: historical run cannot claim unconfirmed outcome`);
    ok(await page.getByRole("button", { name: /Approve|Apply|Reject/ }).count() === 0, `${name}: read-only panel has no dead mutation controls`);
    await openFiles("&phrases=delayed");
    await page.getByRole("button", { name: "View phrases" }).click();
    await page.getByText("Loading phrases", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.locator('body[data-phrase-read-completed="true"]').waitFor();
    ok(await page.locator(".context-proposal-review").count() === 0 && await page.getByText("Private. Not applied to your AI yet.", { exact: true }).count() === 0, `${name}: late read cannot restore removed source content`);
    ok(errors.length === 0, `${name}: no page errors (${errors.join(", ")})`);
    await context.close();
  }
  console.log(`PASS ${checks} browser fixture checks; screenshots: ${out}`);
} finally { await browser.close(); }
