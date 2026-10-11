// The local listening server. Loopback only, no dependencies, and a WHITELIST
// router rather than a static file server.
//
// The router matters more than it looks. The answer key for a run lives outside
// the served tree entirely (`earbench-out/keys/`), but a static handler that
// joins a request path onto a directory will happily walk out of it, and the
// one file it must never serve is two directories away. So this serves exactly
// four shapes — the page, the manifest, the listener-facing trial list, and a
// stimulus whose name matches the 16-hex-character blind id — and 404s
// everything else, including anything it did not itself write.
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const MIME = { ".html": "text/html; charset=utf-8", ".json": "application/json", ".wav": "audio/wav" };
const STIMULUS = /^\/stimuli\/[0-9a-f]{16}\.wav$/;

export function benchRouter(paths, { onSaved } = {}) {
  return (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (req.method === "POST" && url.pathname === "/answers") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 4_000_000) req.destroy();
      });
      req.on("end", () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch { res.writeHead(400).end("bad json"); return; }
        const listener = String(parsed?.listener || "anonymous").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "anonymous";
        mkdirSync(paths.answers, { recursive: true });
        // One file per listener per run, overwritten as they go: a sheet that
        // appended would be counted twice by the scorer the moment somebody
        // pressed Back.
        const file = join(paths.answers, `${listener}.json`);
        writeFileSync(file, JSON.stringify({ ...parsed, listener, runId: paths.runId }, null, 2));
        if (onSaved) onSaved(file);
        res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method !== "GET") { res.writeHead(405).end("method not allowed"); return; }
    const name = url.pathname === "/" ? "/page.html" : url.pathname;
    const allowed = name === "/page.html" || name === "/trials.json" || name === "/manifest.json" || STIMULUS.test(name);
    if (!allowed) { res.writeHead(404).end("not found"); return; }
    const file = join(paths.served, name);
    if (!existsSync(file)) { res.writeHead(404).end("not found"); return; }
    const bytes = readFileSync(file);
    res.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
    }).end(bytes);
  };
}

/** Resolves once listening. Pass port 0 for an ephemeral port (tests). */
export function serveBench(paths, port, options = {}) {
  const server = createServer(benchRouter(paths, options));
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => done(server));
  });
}
