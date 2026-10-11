// Configuration-free pieces of the authentication boundary. Kept separate so
// offline ownership gates never need a generated secrets file.
export class AuthError extends Error {
  constructor(code, status = 401) {
    super(code);
    this.name = "AuthError";
    this.code = code;
    this.status = status;
  }
}

export function bearerToken(req) {
  const raw = req?.headers?.authorization ?? req?.headers?.Authorization;
  const value = Array.isArray(raw) ? raw[0] : raw;
  const match = typeof value === "string" ? /^Bearer\s+([^\s]+)$/i.exec(value.trim()) : null;
  return match?.[1] ?? null;
}
