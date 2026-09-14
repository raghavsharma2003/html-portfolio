// URL validation shared by passwordless email callers. GoTrue remains the
// authority for whether a URL is in the project's configured allow-list.
export function emailRedirect(value) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password || url.hash) return null;
    return url.toString();
  } catch {
    return null;
  }
}
