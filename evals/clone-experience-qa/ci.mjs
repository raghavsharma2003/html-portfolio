// Exercise the real recorder states in Chromium through the release registry.
import { createServer } from "vite";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { rehearsalChromiumPath } from "../rehearsal/browser.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const server = await createServer({ root, logLevel: "error", server: { host: "127.0.0.1", port: 0, strictPort: true, open: false } });
try {
  await server.listen();
  const port = server.httpServer.address().port;
  const browserPath = rehearsalChromiumPath();
  const child = spawn(process.execPath, [fileURLToPath(new URL("mobile-studio26.mjs", import.meta.url))], {
    cwd: root, stdio: "inherit", env: { ...process.env, ...(browserPath ? { CHROMIUM_PATH: browserPath } : {}), VYAKTI_VISUAL_BASE: `http://127.0.0.1:${port}` },
  });
  const timer = setTimeout(() => child.kill(), 180_000);
  timer.unref();
  const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  clearTimeout(timer);
  process.exitCode = code === 0 ? 0 : 1;
} finally { await server.close(); }
