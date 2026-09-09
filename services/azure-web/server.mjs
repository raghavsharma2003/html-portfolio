import { createServer, IncomingMessage } from 'node:http';
import { readFile, readdir, realpath, lstat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { resolve, join, extname, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isIP } from 'node:net';
import { createHash } from 'node:crypto';
import { compileRoutes, routeRequest } from './routing.mjs';

const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.txt':'text/plain; charset=utf-8','.zip':'application/zip' };
export function publicAsset(path) {
  return typeof path === 'string' && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(p => p && !p.startsWith('.') && p !== '..')
    && !/(?:^|\/)(?:api|context|docs|evals|scratchpad|node_modules|services)(?:\/|$)/i.test(path)
    && !/(?:fixture|_config|keyring|owner-reference)/i.test(path)
    && !/(?:^|\/)private(?:\/|\.)/i.test(path) && Boolean(types[extname(path).toLowerCase()]);
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const requestCancellation = new WeakMap();
function cancellationFor(req) {
  let state = requestCancellation.get(req);
  if (!state) { state = { controller: new AbortController() }; requestCancellation.set(req, state); }
  return state;
}
// Recent Node 24 releases expose a getter-only platform signal. Keep the
// native stream and combine its cancellation with our response/deadline scope.
class AzureIncomingMessage extends IncomingMessage {
  get signal() {
    const state = cancellationFor(this);
    if (!state.signal) {
      const nativeSignal = super.signal;
      state.signal = nativeSignal ? AbortSignal.any([nativeSignal, state.controller.signal]) : state.controller.signal;
    }
    return state.signal;
  }
}
async function boundedFile(root, path) {
  const target = resolve(root, path);
  if (!target.startsWith(root + sep)) throw new Error('private_file');
  let cursor = root;
  for (const part of path.split('/')) { cursor = join(cursor, part); if ((await lstat(cursor)).isSymbolicLink()) throw new Error('private_file'); }
  const actual = await realpath(target);
  if (!actual.startsWith(root + sep) || !(await lstat(actual)).isFile()) throw new Error('private_file');
  return actual;
}
function json(res, status, body) {
  if (res.headersSent) { res.destroy(); return; }
  res.writeHead(status, { 'Content-Type':'application/json', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(body));
}
export async function createWebServer({ root, manifest, config, loadHandler, trustedIngress = false, publicOrigin, bodyLimit = 8 * 1024 * 1024, handlerTimeoutMs = 300000 } = {}) {
  root = resolve(root);
  if ((await lstat(join(root,'dist'))).isSymbolicLink() || (await lstat(join(root,'api'))).isSymbolicLink()) throw new Error('azure_web_root_symlink');
  const dist = await realpath(join(root, 'dist'));
  const routes = compileRoutes(config || JSON.parse(await readFile(join(root, 'vercel.json'), 'utf8')));
  if (manifest?.contract !== 'vyakti-azure-web-artifact/v1' || manifest?.product !== 'vyakti-clone' || !/^sha256:[0-9a-f]{64}$/.test(manifest?.source_commitment || '') || !Array.isArray(manifest?.assets) || !Array.isArray(manifest?.runtimeFiles)) throw new Error('azure_web_manifest_invalid');
  const runtimePaths = new Set();
  for (const f of manifest.runtimeFiles) {
    if (typeof f.path !== 'string' || f.path.includes('..') || f.path.includes('\\') || f.path.startsWith('/') || f.path.split('/').some(p=>p.startsWith('.')) || runtimePaths.has(f.path) || !/^[0-9a-f]{64}$/.test(f.sha256 || '') || f.path === 'api/_config.js') throw new Error('azure_web_runtime_manifest_invalid');
    runtimePaths.add(f.path);
    if (digest(await readFile(await boundedFile(root,f.path))) !== f.sha256) throw new Error('azure_web_runtime_changed');
  }
  const assets = new Map();
  for (const entry of manifest.assets) {
    if (!publicAsset(entry.path) || assets.has(entry.path) || !/^[0-9a-f]{64}$/.test(entry.sha256 || '')) throw new Error('azure_web_asset_invalid');
    const path = await boundedFile(dist, entry.path), bytes = await readFile(path);
    if (digest(bytes) !== entry.sha256 || bytes.length !== entry.bytes) throw new Error('azure_web_asset_changed');
    assets.set(entry.path, entry);
  }
  for (const required of ['index.html','studio.html','room.html','vyakti-release.json']) if (!assets.has(required)) throw new Error('azure_web_shell_missing');
  const release = JSON.parse(await readFile(join(dist, 'vyakti-release.json'), 'utf8'));
  if (release.source_commitment !== manifest.source_commitment || release.product !== 'vyakti-clone') throw new Error('azure_web_release_mismatch');
  const apiRoot = await realpath(join(root, 'api'));
  const names = new Set((await readdir(apiRoot)).filter(n => /^[a-z][a-z0-9-]*\.js$/.test(n)));
  if ([...names].some(name=>!runtimePaths.has(`api/${name}`))) throw new Error('azure_web_uncommitted_handler');
  const loader = loadHandler || (async name => import(pathToFileURL(await boundedFile(apiRoot, name)).href));
  const server = createServer({ IncomingMessage: AzureIncomingMessage }, async (req, res) => {
    let deadline;
    const cancellation = cancellationFor(req).controller;
    req.once('aborted', () => cancellation.abort(new Error('client_aborted')));
    res.once('close', () => { if (!res.writableFinished) cancellation.abort(new Error('client_closed')); });
    try {
      let route;
      try { route = routeRequest(req.url, req.headers, routes); } catch { return json(res,400,{error:'invalid_path'}); }
      for (const [key, value] of Object.entries(route.headers)) res.setHeader(key, value);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      // Headers trusted by Vercel are not trustworthy on another platform.
      delete req.headers['x-real-ip']; delete req.headers['x-vercel-forwarded-for'];
      const forwarded = String(req.headers['x-forwarded-for'] || '').split(',').at(-1)?.trim();
      req.headers['x-real-ip'] = trustedIngress && isIP(forwarded) ? forwarded : req.socket.remoteAddress;
      delete req.headers['x-forwarded-for'];
      if (route.pathname === '/healthz' || route.pathname === '/readyz') {
        if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'method_not_allowed'});
        return json(res,200,{status:'ready',product:'vyakti-clone',source_commitment:manifest.source_commitment,scope:'web_artifact_only'});
      }
      if (publicOrigin && req.headers.host !== new URL(publicOrigin).host) return json(res,421,{error:'host_not_allowed'});
      if (!route.destination.startsWith('/api/')) {
        if (!['GET','HEAD'].includes(req.method)) return json(res,405,{error:'method_not_allowed'});
        const relative = route.destination === '/' ? 'index.html' : decodeURIComponent(route.destination.slice(1));
        if (!assets.has(relative)) return json(res,404,{error:'not_found'});
        const file = await boundedFile(dist, relative), entry = assets.get(relative);
        res.setHeader('Content-Type', types[extname(relative).toLowerCase()]);
        res.setHeader('Content-Length',entry.bytes);
        if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', /(?:^|\/)[^/]+-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2)$/.test(relative) ? 'public, max-age=31536000, immutable' : 'no-cache');
        if (req.method === 'HEAD') return res.end();
        const stream = createReadStream(file); stream.on('error', () => res.destroy()); res.on('close',()=>stream.destroy()); stream.pipe(res); return;
      }
      const name = route.destination.slice(5).replace(/\.js$/, '') + '.js';
      if (!names.has(name)) return json(res,404,{error:'not_found'});
      const module = await loader(name);
      if (typeof module.default !== 'function') return json(res,503,{error:'handler_unavailable'});
      req.query = route.query;
      // Preserve raw IncomingMessage for signed webhooks and upload streams.
      if (module.config?.api?.bodyParser !== false) {
        const chunks = []; let size = 0;
        for await (const chunk of req) { size += chunk.length; if (size > bodyLimit) return json(res,413,{error:'body_too_large'}); chunks.push(chunk); }
        const bytes = Buffer.concat(chunks), mime = String(req.headers['content-type'] || '').split(';')[0].trim();
        if (!bytes.length) req.body = {};
        else if (mime === 'application/json') { try { req.body = JSON.parse(bytes.toString('utf8')); } catch { return json(res,400,{error:'invalid_json'}); } }
        else if (mime === 'application/x-www-form-urlencoded') req.body = Object.fromEntries(new URLSearchParams(bytes.toString('utf8')));
        else if (mime.startsWith('text/')) req.body = bytes.toString('utf8');
        else req.body = bytes;
      }
      res.status = code => { res.statusCode = code; return res; };
      res.json = value => { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify(value)); return res; };
      res.send = value => { if (typeof value === 'object' && !Buffer.isBuffer(value)) return res.json(value); res.end(value); return res; };
      res.redirect = (code, url) => { if (typeof code === 'string') { url = code; code = 307; } res.writeHead(code,{Location:url}); res.end(); return res; };
      const declared = module.config?.maxDuration ?? module.maxDuration;
      if (declared !== undefined && (!Number.isSafeInteger(declared) || declared <= 0)) return json(res,503,{error:'handler_duration_invalid'});
      const duration = declared === undefined ? handlerTimeoutMs : Math.min(handlerTimeoutMs,declared * 1000);
      deadline = setTimeout(() => { cancellation.abort(new Error('handler_deadline')); json(res,504,{error:'handler_deadline'}); req.destroy(); }, duration); deadline.unref();
      res.once('finish',()=>clearTimeout(deadline)); res.once('close',()=>clearTimeout(deadline));
      await module.default(req,res);
    } catch {
      json(res,500,{error:'web_handler_failed'});
    }
  });
  server.requestTimeout = 300000; server.headersTimeout = 30000; server.keepAliveTimeout = 5000;
  return server;
}
