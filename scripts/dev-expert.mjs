// Loopback development server: real Vercel handlers and Vite, no Docker.
// Credentials come from the parent process. An explicit database identity check
// prevents accidentally using the production Neon database as the write target.
import { createServer } from 'node:http';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { createServer as createViteServer } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const database = process.env.VYAKTI_DEV_DATABASE;
if (!database || !/^vyakti_expert_integration_[0-9]{8}$/.test(database)) {
  throw new Error('Set VYAKTI_DEV_DATABASE to the isolated development database name.');
}
const connection = new URL(process.env.NEON_URL || 'https://missing.invalid');
if (decodeURIComponent(connection.pathname.slice(1)) !== database) {
  throw new Error('NEON_URL must target the named development database.');
}
const check = await fetch(`https://${connection.hostname}/sql`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Neon-Connection-String': connection.href },
  body: JSON.stringify({ query: 'SELECT current_database() AS name', params: [] }),
  signal: AbortSignal.timeout(15000),
});
if (!check.ok || (await check.json()).rows?.[0]?.name !== database) {
  throw new Error('Development database identity check failed.');
}

const names = new Set((await readdir(join(root, 'api')))
  .filter(name => /^[a-z][a-z0-9-]*\.js$/.test(name)));
const config = JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8'));
const rewrites = config.rewrites.filter(rule => !rule.has).map(rule => {
  const keys = [];
  const pattern = rule.source.split('/').map(part => {
    if (part.startsWith(':')) { keys.push(part.slice(1)); return '([^/]+)'; }
    return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  return { pattern: new RegExp(`^${pattern}$`), keys, destination: rule.destination };
});
const vite = await createViteServer({
  root,
  server: { middlewareMode: true, fs: { allow: [root], deny: ['**/.env*', '**/api/**', '**/.git/**'] } },
});
const server = createServer(async (req, res) => {
  try {
    const incoming = new URL(req.url, 'http://127.0.0.1');
    if (req.headers.origin && !/^http:\/\/(127\.0\.0\.1|localhost):[0-9]+$/.test(req.headers.origin)) {
      res.writeHead(403).end('Local origin required'); return;
    }
    if (incoming.pathname === '/' || incoming.pathname === '/local') {
      res.writeHead(302, { Location: '/studio' }).end(); return;
    }
    let destination = incoming.pathname;
    for (const rule of rewrites) {
      const match = rule.pattern.exec(incoming.pathname);
      if (!match) continue;
      destination = rule.destination;
      rule.keys.forEach((key, index) => { destination = destination.replaceAll(`:${key}`, encodeURIComponent(decodeURIComponent(match[index + 1]))); });
      break;
    }
    const routed = new URL(destination, incoming);
    incoming.searchParams.forEach((value, key) => { if (!routed.searchParams.has(key)) routed.searchParams.set(key, value); });
    if (!routed.pathname.startsWith('/api/')) {
      req.url = routed.pathname + routed.search;
      vite.middlewares(req, res, () => res.writeHead(404).end('Not found'));
      return;
    }
    const name = routed.pathname.slice(5).replace(/\.js$/, '') + '.js';
    if (!names.has(name)) { res.writeHead(404).end('Unknown endpoint'); return; }
    const module = await import(pathToFileURL(join(root, 'api', name)).href);
    req.query = Object.fromEntries(routed.searchParams);
    if (module.config?.api?.bodyParser !== false) {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 8 * 1024 * 1024) { res.writeHead(413).end('Request too large'); return; }
        chunks.push(chunk);
      }
      const body = Buffer.concat(chunks);
      if (body.length) {
        if ((req.headers['content-type'] || '').includes('application/json')) {
          try { req.body = JSON.parse(body.toString('utf8')); }
          catch { res.writeHead(400).end('Invalid JSON'); return; }
        } else req.body = body;
      } else req.body = {};
    }
    res.status = code => { res.statusCode = code; return res; };
    res.json = value => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); return res; };
    res.send = value => { res.end(value); return res; };
    res.redirect = (code, url) => { if (typeof code === 'string') { url = code; code = 302; } res.writeHead(code, { Location: url }).end(); return res; };
    await module.default(req, res);
  } catch {
    // Handler errors may contain provider payloads or private source text.
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    if (!res.writableEnded) res.end(JSON.stringify({ error: 'local_handler_failed' }));
  }
});
const port = Number(process.env.VYAKTI_DEV_PORT || 5177);
server.listen(port, '127.0.0.1', () => console.log(`Expert development: http://127.0.0.1:${port}/studio (isolated database)`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { server.close(); await vite.close(); process.exit(0); });
