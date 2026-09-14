// Development fetch boundary. This is not a sandbox for node:http, browser
// requests or remote workers; their provider routes need independent review.
const AZURE_HOST = /^(?:[a-z0-9-]+\.(?:openai\.azure\.com|services\.ai\.azure\.com|cognitiveservices\.azure\.com|blob\.core\.windows\.net)|[a-z0-9.-]+\.azurecontainerapps\.io|[a-z0-9-]+\.(?:stt|tts)\.speech\.microsoft\.com)$/i;
const denied = () => Object.assign(new Error('azure_only_destination_denied'), {
  code: 'azure_only_destination_denied', status: 503,
});

export function createAzureOnlyFetch({ fetchImpl = globalThis.fetch, databaseHost, authOrigin } = {}) {
  // These are the exact existing non-model services, not arbitrary exceptions.
  if (!/^[a-z0-9.-]+\.neon\.tech$/i.test(databaseHost || '')) throw new Error('azure_only_database_host_invalid');
  let auth;
  try { auth = new URL(authOrigin); } catch { throw new Error('azure_only_auth_origin_invalid'); }
  if (auth.protocol !== 'https:' || !/^[a-z0-9-]+\.supabase\.co$/i.test(auth.hostname) ||
      auth.username || auth.password || auth.port || auth.search || auth.hash || auth.pathname !== '/') {
    throw new Error('azure_only_auth_origin_invalid');
  }
  return async (input, init) => {
    let url;
    try { url = new URL(input instanceof Request ? input.url : input); } catch { throw denied(); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port ||
        !(AZURE_HOST.test(url.hostname) ||
          (url.hostname === databaseHost && url.pathname === '/sql') ||
          (url.origin === auth.origin && /^\/(?:auth|rest|storage)\/v1(?:\/|$)/.test(url.pathname)))) {
      throw denied();
    }
    // A trusted URL must not redirect a request body or credentials outside
    // the boundary. No automatic follow, even if a caller requests it.
    return fetchImpl(input, { ...init, redirect: 'error' });
  };
}
