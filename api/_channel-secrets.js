// Where a channel credential actually lives — the other half of migration
// 055's `credentials_ref`.
//
// The table stores a uuid. This file stores the value the uuid points at, and
// it is a separate file for one structural reason: `vy_clone_channel` is
// selected, joined and logged by the routing path on every inbound event, and
// a column that a `select *` can carry into a log aggregator is not a place
// for a live Telegram bot token belonging to a real, named teacher. The column
// type already makes that impossible (a token cannot be cast to uuid); this
// module is the place the value goes instead.
//
// ── the default backend REFUSES, and that is the feature ──────────────────
//
// `CHANNEL_SECRET_BACKEND` is unset by default and resolves to `none`, whose
// `put`/`get` throw `channel_secret_store_unconfigured`. A deployment that has
// not configured a secret store therefore CANNOT connect a credentialed
// channel: the studio's connect flow fails loudly at the moment the owner
// pastes the token, rather than succeeding and leaving a channel row that
// looks live and can never send.
//
// The alternative — writing the token to the database "for now" — is the
// `silent-truncation` shape wearing a different hat: it works, everything
// returns 200, and a credential for someone else's business is somewhere it
// was promised not to be. There is no "for now" for that.
//
// ── what is implemented, and what is not ──────────────────────────────────
//
// IMPLEMENTED: `azure-keyvault`, over the REST API with a client-credentials
// token, one secret per `credentials_ref`. Chosen because this repo already
// signs C2PA manifests with Azure Key Vault (`services/audio-protection`), so
// it is a store the project already operates rather than a new dependency.
//
// NOT VERIFIED: no secret has ever been written. There are no Azure service
// principal credentials in this environment, so what is proven offline is the
// refusal path, the reference shape, and the request the backend would make —
// never a round trip. Named here rather than implied to work, in the same
// words api/tg.js uses about `send()`.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ChannelSecretError extends Error {
  constructor(code, status = 500, details) {
    super(code);
    this.code = code;
    this.status = status;
    if (details) this.details = details;
  }
}

/** One secret name per reference, and the reference is a uuid — so a name can
 *  never be built out of attacker-supplied text. Key Vault names allow
 *  `[0-9a-zA-Z-]` only, which a uuid satisfies by construction. */
export function secretNameFor(credentialsRef) {
  const ref = String(credentialsRef || "").toLowerCase();
  if (!UUID.test(ref)) throw new ChannelSecretError("channel_secret_ref_invalid", 400);
  return `clone-channel-${ref}`;
}

/** Cheap shape checks per kind, run BEFORE the value leaves this process.
 *  Not authentication — the surface proves that — but it catches the ordinary
 *  paste error (a bot username where a token goes) while the owner is still
 *  looking at the screen, and it never echoes the value back. */
export function looksLikeCredential(kind, value) {
  const v = String(value ?? "");
  if (!v || v.length > 4096) return false;
  if (kind === "telegram") return /^\d{5,20}:[A-Za-z0-9_-]{30,}$/.test(v);
  // Meta access tokens are opaque and their prefixes have changed more than
  // once, so the only honest check is a length floor. A tighter regex here
  // would reject valid tokens on the day Meta changes the shape, which is a
  // failure mode with no upside.
  if (kind === "whatsapp" || kind === "instagram_dm") return v.length >= 40;
  return false;
}

// ── the backends ──────────────────────────────────────────────────────────

const backends = {
  /** The default. Refuses both directions, loudly. */
  none: {
    name: "none",
    async put() {
      throw new ChannelSecretError("channel_secret_store_unconfigured", 503);
    },
    async get() {
      throw new ChannelSecretError("channel_secret_store_unconfigured", 503);
    },
  },

  "azure-keyvault": {
    name: "azure-keyvault",
    async put(name, value) {
      const { vault, token } = await keyVaultAuth();
      const r = await fetch(`${vault}/secrets/${encodeURIComponent(name)}?api-version=7.4`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ value: String(value) }),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      // The response body is never read on failure and never logged on
      // success: Key Vault echoes the secret value back in its 200, and a
      // module whose whole purpose is to keep a token out of a log does not
      // get to make an exception for its own happy path.
      if (!r || !r.ok) throw new ChannelSecretError("channel_secret_write_failed", 502);
      return { ok: true };
    },
    async get(name) {
      const { vault, token } = await keyVaultAuth();
      const r = await fetch(`${vault}/secrets/${encodeURIComponent(name)}?api-version=7.4`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      if (!r || !r.ok) throw new ChannelSecretError("channel_secret_read_failed", 502);
      const body = await r.json().catch(() => ({}));
      const value = body?.value;
      if (typeof value !== "string" || !value) throw new ChannelSecretError("channel_secret_missing", 404);
      return value;
    },
  },
};

async function keyVaultAuth() {
  const vault = String(process.env.AZURE_KEY_VAULT_URL || "").replace(/\/+$/, "");
  const tenant = process.env.AZURE_TENANT_ID || "";
  const clientId = process.env.AZURE_CLIENT_ID || "";
  const clientSecret = process.env.AZURE_CLIENT_SECRET || "";
  if (!vault || !tenant || !clientId || !clientSecret) {
    // A PARTIAL set is the same as none — ENV-MANIFEST §1's rule, and the
    // reason is that a half-configured store fails at write time with a
    // provider error nobody can act on, instead of at boot with a name.
    throw new ChannelSecretError("channel_secret_store_unconfigured", 503);
  }
  const r = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://vault.azure.net/.default",
    }).toString(),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r || !r.ok) throw new ChannelSecretError("channel_secret_auth_failed", 502);
  const body = await r.json().catch(() => ({}));
  if (!body?.access_token) throw new ChannelSecretError("channel_secret_auth_failed", 502);
  return { vault, token: body.access_token };
}

/** Which backend this deployment runs. Resolved per call rather than cached at
 *  import, so an eval can drive both arms in one process without module
 *  surgery — and so a serverless instance that warms before the env is present
 *  does not pin `none` for its whole life. */
export function activeBackend(name = process.env.CHANNEL_SECRET_BACKEND) {
  const key = String(name || "none");
  const backend = backends[key];
  if (!backend) throw new ChannelSecretError("channel_secret_backend_unknown", 500);
  return backend;
}

/**
 * Store a channel credential under `credentialsRef`.
 *
 * The value is validated for SHAPE, written, and then not returned, echoed, or
 * logged — the return is `{ ok, credentials_ref, backend }` and carries no
 * fragment of the secret. A caller that needs to tell an owner "that doesn't
 * look like a bot token" gets that from the thrown code, not from a diff.
 */
export async function putChannelSecret(credentialsRef, kind, value, backend = activeBackend()) {
  const name = secretNameFor(credentialsRef);
  if (!looksLikeCredential(kind, value)) throw new ChannelSecretError("channel_secret_shape_invalid", 400);
  await backend.put(name, value);
  return { ok: true, credentials_ref: String(credentialsRef).toLowerCase(), backend: backend.name };
}

/** Read one back, for the outbound half of a surface. The ONLY consumer is a
 *  `send()` path; nothing that answers an HTTP request may call this, and
 *  nothing that does may put the result in a response body. */
export async function getChannelSecret(credentialsRef, backend = activeBackend()) {
  return await backend.get(secretNameFor(credentialsRef));
}
