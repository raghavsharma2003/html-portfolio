// LAYOUT READABILITY GATE.
//
// Why this exists, stated plainly so nobody deletes it as redundant: the end to
// end journey passed 12 of 15 while the studio was rendering an 83 character
// paragraph 46 pixels wide, one word per line, on a 1355 pixel desktop. It
// passed because the checks asked the wrong question. "No horizontal overflow"
// was TRUE. "Primary action above the fold" was TRUE. Neither can see a column
// that has collapsed, because a collapsed column overflows nothing.
//
// The cause was a grid reserving a 58px rail for a `.panel-index` child that a
// copy purge had correctly deleted. CSS kept a memory of a DOM that no longer
// existed. That is a class of bug, not an incident: any rule whose track list
// counts children breaks silently the moment a child is removed.
//
// So this gate asks the question a person asks: CAN I READ THIS. It renders the
// built studio in a real browser at real viewport widths and fails when a block
// of prose is too narrow to be prose.
//
// It is deliberately NOT a screenshot diff. A screenshot test tells you
// something changed; it cannot tell you whether the change was good, and it
// fails on every legitimate edit until someone stops reading its output.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const DIST = join(ROOT, "dist");
const PORT = 8931;

// A paragraph narrower than this cannot hold a readable line at any sane font
// size. Chosen well below a real content column (which is 600px and up) so the
// gate flags catastrophe and never bikeshed.
const MIN_PROSE_WIDTH = 220;
// Only judge blocks with enough text that narrowness is definitely wrong. A
// short label may legitimately sit in a narrow cell.
const MIN_CHARS_TO_JUDGE = 60;
// Below this, the page under test is not the page we meant to test.
const MIN_BLOCKS_JUDGED = 6;

const VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "tablet", width: 834, height: 1112 },
  { name: "desktop", width: 1355, height: 800 },
];

const MIME = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".woff2": "font/woff2", ".ico": "image/x-icon",
};

function serveDist() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
    let path = join(DIST, url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    if (url.pathname === "/studio") path = join(DIST, "studio.html");
    try {
      const body = await readFile(path);
      res.writeHead(200, { "content-type": MIME[extname(path)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((ok) => server.listen(PORT, "127.0.0.1", () => ok(server)));
}

async function main() {
  if (!existsSync(DIST)) {
    console.log("  skip  layout readability: dist/ absent, run `npx vite build` first");
    return 0;
  }
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.log("  skip  layout readability: playwright not installed");
    return 0;
  }
  const executablePath = [
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    process.env.CHROMIUM_PATH,
  ].find((p) => p && existsSync(p));

  const server = await serveDist();
  const browser = await chromium.launch(
    executablePath ? { executablePath, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] },
  ).catch(() => null);
  if (!browser) {
    server.close();
    console.log("  skip  layout readability: no chromium binary available");
    return 0;
  }

  const findings = [];
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/studio`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1200);

    const bad = await page.evaluate((limits) => {
      const out = [];
      for (const el of document.querySelectorAll("p, h1, h2, h3, h4, li")) {
        const text = (el.textContent || "").trim();
        if (text.length < limits.chars) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue; // not rendered at all
        if (r.width > 0 && r.width < limits.width) {
          out.push({
            tag: el.tagName.toLowerCase(),
            cls: String(el.className || "").slice(0, 40),
            width: Math.round(r.width),
            chars: text.length,
            text: text.slice(0, 50),
          });
        }
      }
      return out;
    }, { width: MIN_PROSE_WIDTH, chars: MIN_CHARS_TO_JUDGE });

    const overflow = await page.evaluate(() =>
      document.documentElement.scrollWidth - document.documentElement.clientWidth);

    // A CHECK THAT JUDGED NOTHING MUST NOT REPORT OK. The first version of this
    // gate passed against the reintroduced bug because `/studio` signed out
    // renders none of the panels that break, so it measured an empty screen and
    // called it readable. That is the same defect class it exists to catch, so
    // the count of judged blocks is itself asserted.
    const judged = await page.evaluate((chars) =>
      [...document.querySelectorAll("p, h1, h2, h3, h4, li")]
        .filter((el) => (el.textContent || "").trim().length >= chars).length, MIN_CHARS_TO_JUDGE);
    if (judged < MIN_BLOCKS_JUDGED) {
      findings.push({ vp: vp.name, tag: "coverage", cls: "", width: 0, chars: judged,
        text: `only ${judged} prose blocks rendered; this gate cannot see the signed-in panels` });
    }

    for (const b of bad) findings.push({ vp: vp.name, ...b });
    if (overflow > 2) findings.push({ vp: vp.name, tag: "document", cls: "", width: overflow, chars: 0, text: `${overflow}px of horizontal overflow` });
    await ctx.close();
  }

  await browser.close();
  server.close();

  if (findings.length) {
    console.log(`FAIL  layout readability: ${findings.length} unreadable block(s)`);
    for (const f of findings.slice(0, 12)) {
      console.log(`        ${f.vp.padEnd(8)} ${String(f.width).padStart(5)}px  <${f.tag}${f.cls ? " class=" + f.cls : ""}>  ${f.chars} chars  "${f.text}"`);
    }
    console.log(`        prose under ${MIN_PROSE_WIDTH}px cannot be read. Usually a grid or flex track`);
    console.log("        reserving space for a child that no longer exists.");
    return 1;
  }
  console.log(`  ok    layout readability: prose readable at ${VIEWPORTS.map((v) => v.width).join(", ")}px`);
  return 0;
}

process.exit(await main());
