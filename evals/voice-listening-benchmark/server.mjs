import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const MIME = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".wav": "audio/wav",
});
const STIMULUS_PATH = /^\/stimuli\/[0-9a-f]{24}\.wav$/;

export function listeningRouter(paths, { onSaved } = {}) {
  return (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    if (request.method === "POST" && url.pathname === "/answers") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
        if (body.length > 2_000_000) request.destroy();
      });
      request.on("end", () => {
        let parsed;
        try {
          parsed = JSON.parse(body);
        } catch {
          response.writeHead(400).end("bad json");
          return;
        }
        if (parsed?.runId !== paths.runId) {
          response.writeHead(409).end("run mismatch");
          return;
        }
        const listener = String(parsed?.listener || "anonymous").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "anonymous";
        mkdirSync(paths.answers, { recursive: true });
        const file = join(paths.answers, `${listener}.json`);
        writeFileSync(file, JSON.stringify({ ...parsed, listener, runId: paths.runId }, null, 2));
        if (onSaved) onSaved(file);
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }).end(JSON.stringify({ ok: true }));
      });
      return;
    }

    if (request.method !== "GET") {
      response.writeHead(405).end("method not allowed");
      return;
    }
    const name = url.pathname === "/" ? "/page.html" : url.pathname;
    const allowed = name === "/page.html" || name === "/manifest.json" || name === "/trials.json" || STIMULUS_PATH.test(name);
    if (!allowed) {
      response.writeHead(404).end("not found");
      return;
    }
    const file = join(paths.served, name);
    if (!existsSync(file)) {
      response.writeHead(404).end("not found");
      return;
    }
    const bytes = readFileSync(file);
    response.writeHead(200, {
      "Content-Type": MIME[extname(file)] || "application/octet-stream",
      "Content-Length": bytes.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; media-src 'self'; connect-src 'self'; img-src 'none'; font-src 'none'",
    }).end(bytes);
  };
}

export function serveListeningBenchmark(paths, port, options = {}) {
  const server = createServer(listeningRouter(paths, options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve(server));
  });
}
