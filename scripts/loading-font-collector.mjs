// Passive local-font evidence only. Does not wait for fonts or evaluate page style.
export function startLoadingFontCollector(cdp, origin) {
  const rows = new Map(), listeners = []; let dropped = 0, stopped = false;
  const local = value => { try { const u = new URL(value); return u.origin === origin && /^\/assets\/[A-Za-z0-9_.-]{1,180}$/.test(u.pathname) ? u.pathname : null; } catch { return null; } };
  const bind = (name, fn) => { cdp.on(name, fn); listeners.push([name, fn]); };
  const timestamp = value => Number.isFinite(value) ? value : null;
  bind('Network.requestWillBeSent', e => {
    const path = local(e.request?.url);
    if (!path || !/\.(woff2?|ttf|otf)$/.test(path)) return;
    if (rows.has(e.requestId)) return;
    if (rows.size >= 16) { dropped++; return; }
    const frames = e.initiator?.stack?.callFrames || [];
    // No function names, query strings, headers, post data or arbitrary URLs.
    rows.set(e.requestId, { path, requestedAt: timestamp(e.timestamp),
      initiator: { type: ['parser','script','preload','preflight','other'].includes(e.initiator?.type) ? e.initiator.type : 'unknown', path: local(e.initiator?.url), frames: frames.slice(0,4).map(f => ({path:local(f.url),line:Number.isInteger(f.lineNumber)?f.lineNumber:null})).filter(f => f.path) },
      responseAt:null, finishedAt:null, failedAt:null, status:null, encodedBytes:null, cache:false });
  });
  bind('Network.responseReceived', e => {const r=rows.get(e.requestId);if(r){r.responseAt=timestamp(e.timestamp);r.status=Number.isInteger(e.response?.status)?e.response.status:null;r.cache=!!(e.response?.fromDiskCache||e.response?.fromServiceWorker||e.response?.fromPrefetchCache);}});
  bind('Network.requestServedFromCache', e => {const r=rows.get(e.requestId);if(r)r.cache=true;});
  bind('Network.loadingFinished', e => {const r=rows.get(e.requestId);if(r){r.finishedAt=timestamp(e.timestamp);r.encodedBytes=timestamp(e.encodedDataLength);}});
  bind('Network.loadingFailed', e => {const r=rows.get(e.requestId);if(r)r.failedAt=timestamp(e.timestamp);});
  return { snapshot(nodeReceivedAt) { return { acceptance:false, boundary:'settled-performance-received-by-node', nodeReceivedAt, dropped, complete:dropped===0, requests:[...rows.values()].map(r=>structuredClone({...r,pending:r.finishedAt===null&&r.failedAt===null})) }; },
    stop(){if(stopped)return;stopped=true;for(const [name,fn]of listeners)cdp.off(name,fn);} };
}
