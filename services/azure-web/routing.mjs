const fail = () => { throw new Error('azure_web_route_contract_unsupported'); };
export function compilePattern(source) {
  if (typeof source !== 'string' || !source.startsWith('/')) fail();
  const keys = [];
  const pattern = source.split('/').map(part => {
    if (part === '(.*)') return '.*';
    if (/^:[a-zA-Z][a-zA-Z0-9_]*$/.test(part)) { keys.push(part.slice(1)); return '([^/]+)'; }
    if (/[()*+:]/.test(part)) fail();
    return part.replace(/[.*+?^${}|[\]\\]/g, '\\$&');
  }).join('/');
  return { regex: new RegExp(`^${pattern}$`), keys };
}
export function compileRoutes(config) {
  if (!Array.isArray(config?.rewrites) || !Array.isArray(config?.headers)) fail();
  const rewrites = config.rewrites.map(rule => {
    if (Object.keys(rule).some(k => !['source','destination','has'].includes(k)) || !/^\/(?!\/)/.test(rule.destination || '')) fail();
    const conditions = (rule.has || []).map(c => {
      if (c.type !== 'header' || !/^[a-z0-9-]+$/.test(c.key) || typeof c.value !== 'string') fail();
      return { key: c.key, regex: new RegExp(`^(?:${c.value})$`) };
    });
    return { ...compilePattern(rule.source), destination: rule.destination, conditions };
  });
  const headers = config.headers.map(rule => {
    if (Object.keys(rule).some(k => !['source','headers'].includes(k)) || !Array.isArray(rule.headers)) fail();
    for (const h of rule.headers) if (!/^[a-z0-9-]+$/i.test(h.key) || typeof h.value !== 'string' || /[\r\n]/.test(h.value)) fail();
    return { ...compilePattern(rule.source), values: rule.headers };
  });
  return { rewrites, headers };
}
export function safePath(raw) {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.length > 16384) throw new Error('bad_path');
  const pathname = raw.split('?')[0];
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { throw new Error('bad_path'); }
  if (/[\\\x00-\x1f\x7f%]/.test(decoded) || decoded.split('/').some(p => p === '.' || p === '..' || p.startsWith('.'))) throw new Error('bad_path');
  // Encoded slashes must not introduce another routing segment.
  if (decoded.split('/').length !== pathname.split('/').length) throw new Error('bad_path');
  return pathname;
}
export function routeRequest(raw, requestHeaders, routes) {
  const pathname = safePath(raw), original = new URL(raw, 'https://route.invalid');
  let routed = new URL(original), params = {};
  for (const r of routes.rewrites) {
    const match = r.regex.exec(pathname);
    if (!match || !r.conditions.every(c => c.regex.test(String(requestHeaders[c.key] || '')))) continue;
    params = Object.fromEntries(r.keys.map((key, i) => [key, decodeURIComponent(match[i + 1])]));
    const destination = r.destination.replace(/:([a-zA-Z][a-zA-Z0-9_]*)/g, (_, key) => {
      if (!(key in params)) fail();
      return encodeURIComponent(params[key]);
    });
    routed = new URL(destination, original);
    for (const [key, value] of original.searchParams) if (!new URL(destination, original).searchParams.has(key)) routed.searchParams.append(key, value);
    break;
  }
  const query = { ...params };
  for (const key of new Set(routed.searchParams.keys())) {
    const values = routed.searchParams.getAll(key);
    query[key] = values.length === 1 ? values[0] : values;
  }
  const headers = {};
  for (const rule of routes.headers) if (rule.regex.test(pathname)) for (const h of rule.values) headers[h.key] = h.value;
  return { pathname, destination: routed.pathname, query, headers };
}
