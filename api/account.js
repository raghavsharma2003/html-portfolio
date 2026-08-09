// Meera accounts — Supabase Auth + synced state + event tracking, all behind
// this proxy so the database key never reaches the client.
// POST { op, ... }:
//   send_otp     { email }               → 6-digit code / magic mail
//   verify_otp   { email, token }        → session { access_token, refresh_token, user }
//   send_sms     { phone }               → sms code (needs an SMS provider configured)
//   verify_sms   { phone, token }        → session
//   google_url   { redirect }            → { url } to redirect the browser to
//   refresh      { refresh_token }       → fresh session
//   save_state   { access_token, state, device } → { ok }
//   load_state   { access_token }        → { state } | { state: null }
//   track        { device, event, props?, user_id? } → { ok }

import { allow, ipOf } from "./_ratelimit.js";

import { SUPABASE_URL, SUPABASE_KEY } from "./_config.js";

const SB_URL = process.env.SUPABASE_URL || SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY || SUPABASE_KEY;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const authFetch = (path, body, headers = {}) =>
  fetch(`${SB_URL}/auth/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      apikey: SB_KEY,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const rest = (path, params, opts = {}) => {
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  return fetch(`${SB_URL}/rest/v1/${path}${qs}`, {
    ...opts,
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      ...(opts.headers || {}),
    },
  });
};

async function userFromToken(accessToken) {
  if (typeof accessToken !== "string" || accessToken.length < 20) return null;
  const res = await authFetch("user", undefined, { Authorization: `Bearer ${accessToken}` });
  if (!res.ok) return null;
  const u = await res.json();
  return u?.id ? u : null;
}

async function passthrough(res, upstream) {
  const data = await upstream.json().catch(() => ({}));
  return res.status(upstream.ok ? 200 : upstream.status >= 500 ? 502 : upstream.status).json(data);
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!allow(ipOf(req), "account", 20)) return res.status(429).json({ error: "slow down" });
  if (!SB_URL || !SB_KEY) return res.status(500).json({ error: "no backend configured" });

  try {
    const b = req.body || {};
    const op = b.op;

    if (op === "send_otp") {
      const email = String(b.email || "").trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: "valid email required" });
      // per-DESTINATION throttle (independent of IP): stops email-bombing a
      // victim address through rotating IPs
      if (!allow(email, "otp_dest", 3)) return res.status(429).json({ error: "slow down" });
      return passthrough(res, await authFetch("otp", { email, create_user: true }));
    }
    if (op === "verify_otp") {
      const email = String(b.email || "").trim().toLowerCase();
      return passthrough(res, await authFetch("verify", { type: "email", email, token: String(b.token || "") }));
    }
    if (op === "send_sms") {
      const phone = String(b.phone || "").replace(/[^\d+]/g, "");
      if (phone.length < 8) return res.status(400).json({ error: "valid phone required" });
      // per-DESTINATION throttle: SMS pumping is real toll fraud — a number
      // can be hit at most twice a minute regardless of source IPs
      if (!allow(phone, "otp_dest", 2)) return res.status(429).json({ error: "slow down" });
      return passthrough(res, await authFetch("otp", { phone, create_user: true }));
    }
    if (op === "verify_sms") {
      const phone = String(b.phone || "").replace(/[^\d+]/g, "");
      return passthrough(res, await authFetch("verify", { type: "sms", phone, token: String(b.token || "") }));
    }
    if (op === "google_url") {
      const redirect = typeof b.redirect === "string" ? b.redirect : "https://meera-silk.vercel.app/chat";
      return res.status(200).json({
        url: `${SB_URL}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirect)}`,
      });
    }
    if (op === "refresh") {
      return passthrough(
        res,
        await fetch(`${SB_URL}/auth/v1/token?grant_type=refresh_token`, {
          method: "POST",
          headers: { apikey: SB_KEY, "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: String(b.refresh_token || "") }),
        }),
      );
    }
    if (op === "save_state") {
      const user = await userFromToken(b.access_token);
      if (!user) return res.status(401).json({ error: "invalid session" });
      const state = b.state;
      if (!state || typeof state !== "object") return res.status(400).json({ error: "state required" });
      // size cap: the client strips photo data URLs before syncing; anything
      // this large is a bug or abuse, and unbounded JSONB is real cost
      if (JSON.stringify(state).length > 900_000) return res.status(413).json({ error: "state too large" });
      // conflict detection: if another device saved since the caller last
      // looked, reject with the server copy so the client merges instead of
      // clobbering — last-write-wins was silently destroying messages
      const existing = await rest("meera_state", {
        user_id: `eq.${user.id}`,
        select: "state,updated_at",
      })
        .then((r) => r.json())
        .catch(() => []);
      const row0 = Array.isArray(existing) && existing[0] ? existing[0] : null;
      const base = typeof b.base_updated_at === "string" ? b.base_updated_at : null;
      if (row0 && base && new Date(row0.updated_at).getTime() > new Date(base).getTime() + 1000) {
        return res.status(409).json({ conflict: true, state: row0.state, updated_at: row0.updated_at });
      }
      const updatedAt = new Date().toISOString();
      const row = {
        user_id: user.id,
        state,
        device_id: UUID.test(String(b.device || "")) ? b.device : null,
        updated_at: updatedAt,
      };
      const up = await rest("meera_state", { on_conflict: "user_id" }, {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify([row]),
      });
      return res.status(up.ok ? 200 : 502).json({ ok: up.ok, updated_at: updatedAt });
    }
    if (op === "load_state") {
      const user = await userFromToken(b.access_token);
      if (!user) return res.status(401).json({ error: "invalid session" });
      const rows = await rest("meera_state", { user_id: `eq.${user.id}`, select: "state,updated_at" }).then((r) =>
        r.json(),
      );
      const row = Array.isArray(rows) && rows[0] ? rows[0] : null;
      return res.status(200).json({ state: row?.state ?? null, updated_at: row?.updated_at ?? null });
    }
    if (op === "track") {
      // analytics rows are unauthenticated by design — cap them hard so the
      // table can't be bloated with megabyte props or junk event names
      const props = b.props && typeof b.props === "object" ? b.props : {};
      if (JSON.stringify(props).length > 2000) return res.status(413).json({ error: "props too large" });
      const event = String(b.event || "unknown").slice(0, 60);
      if (!/^[a-z0-9_.-]+$/i.test(event)) return res.status(400).json({ error: "bad event" });
      const row = {
        device_id: UUID.test(String(b.device || "")) ? b.device : null,
        user_id: UUID.test(String(b.user_id || "")) ? b.user_id : null,
        event,
        props,
      };
      rest("meera_events", null, { method: "POST", body: JSON.stringify([row]) }).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "unknown op" });
  } catch {
    return res.status(500).json({ error: "account failure" });
  }
}
