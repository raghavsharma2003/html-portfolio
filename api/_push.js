// The server-side send helper for the FCM slot. Underscore prefix = not a
// deployed function; it is imported, never called over the network.
//
// ═══ INERT WITH ZERO KEYS ════════════════════════════════════════════════
//
// `sendPush()` returns `{ sent: 0, reason: "unconfigured" }` before doing
// anything at all when the three FCM_* names are empty. No database read, no
// token lookup, no outbound fetch. Nothing in this repo calls it yet either —
// which is stated here rather than left to be discovered, because
// `dead-writers` is this repo's law: a writer connected to nothing is worse
// than one that is absent. It is connected to nothing ON PURPOSE and for a
// bounded time — the caller is whatever server-side lane first has something
// to say to a phone that is not running the app, and that lane does not exist
// yet. If push is still unconfigured and this is still uncalled in a month,
// DELETE IT rather than leaving it as evidence of a feature.
//
// ── WHY DATA-ONLY, NEVER AN FCM `notification` BLOCK ──────────────────────
//
// An FCM `notification` block is rendered by the browser or by Android before
// any code of ours runs. That would put the copy rules — "her actual words,
// never a generic line" (src/notify/copy.ts) — on the far side of a boundary
// nothing in this repo can check, and it would route the tap at the origin
// rather than at `#chat`. Data-only means `public/push-sw.js` is the single
// display path, with one set of rules and one gate over it.
//
// ── WHAT THIS FILE MAY NEVER GROW ─────────────────────────────────────────
//
// A caller keyed on absence. There is no `sendIfQuiet`, no `sendReminder`, no
// schedule. The parameter is a `copy` object built by the same builder the
// local lane uses, so a push and a local notification cannot say different
// kinds of thing. Anything that wants to send text nobody said has to add a
// second builder, which is a reviewable diff rather than a runtime state.

import { createSign } from "node:crypto";
import { q } from "./_db.js";
import { MEERA_AGENT_ID, agentScopePredicate } from "./_agentscope.js";
// See api/push-token.js for why this is a namespace import and not a named one.
import * as CONFIG from "./_config.js";

const cfg = (name) => process.env[name] || CONFIG[name] || "";

export function pushConfigured() {
  return Boolean(cfg("FCM_PROJECT_ID") && cfg("FCM_CLIENT_EMAIL") && cfg("FCM_PRIVATE_KEY"));
}

// ── the access token, minted from the service account ─────────────────────
//
// One RS256 JWT exchanged for an OAuth access token, cached until a minute
// before it expires. The alternative is the googleapis package, which is tens
// of megabytes of dependency to sign one assertion.
let cachedToken = { value: "", exp: 0 };

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.exp > now + 60) return cachedToken.value;

  const b64 = (o) =>
    Buffer.from(JSON.stringify(o)).toString("base64url");
  const header = b64({ alg: "RS256", typ: "JWT" });
  const claims = b64({
    iss: cfg("FCM_CLIENT_EMAIL"),
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  // The private key arrives from config with literal \n sequences (that is how
  // it survives an environment variable), and node's key parser needs real
  // newlines. Getting this wrong yields "error:1E08010C:DECODER routines" from
  // deep inside crypto, which reads like a corrupt key rather than a formatting
  // one and has cost other projects an afternoon.
  const key = cfg("FCM_PRIVATE_KEY").replace(/\\n/g, "\n");
  const sig = signer.sign(key, "base64url");

  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${sig}`,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`oauth ${r.status}`);
  const j = await r.json();
  cachedToken = { value: j.access_token, exp: now + (Number(j.expires_in) || 3600) };
  return cachedToken.value;
}

/**
 * Send one notification to every device registered for a person's devices.
 *
 * @param {string[]} deviceIds  the devices to reach (agent-scoped on read)
 * @param {{title:string, body:string, largeBody?:string}} copy
 *        built by src/notify/copy.ts's builders. Never a literal here.
 * @param {"reply"|"missedCall"|"story"} kind
 * @returns {Promise<{sent:number, reason?:string}>}
 */
export async function sendPush(deviceIds, copy, kind) {
  if (!pushConfigured()) return { sent: 0, reason: "unconfigured" };
  if (!Array.isArray(deviceIds) || !deviceIds.length) return { sent: 0, reason: "no-devices" };
  if (!copy || !copy.title || !copy.body) {
    // The same refusal copy.ts makes on the client: there is no placeholder to
    // fall back to, here or there.
    return { sent: 0, reason: "no-copy" };
  }

  let rows;
  try {
    rows = await q(
      `select token, platform from vy_push_token
        where device_id = any($2::uuid[])
          ${agentScopePredicate("vy_push_token", { agentId: "$1" })}`,
      [MEERA_AGENT_ID, deviceIds],
      5_000,
    );
  } catch {
    return { sent: 0, reason: "store-unavailable" };
  }
  if (!rows.length) return { sent: 0, reason: "no-tokens" };

  let bearer;
  try {
    bearer = await accessToken();
  } catch {
    return { sent: 0, reason: "auth-failed" };
  }

  const project = cfg("FCM_PROJECT_ID");
  let sent = 0;
  const stale = [];
  await Promise.all(
    rows.map(async (row) => {
      try {
        const r = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token: row.token,
              // DATA ONLY. See the header.
              data: {
                title: String(copy.title),
                body: String(copy.body),
                ...(copy.largeBody ? { largeBody: String(copy.largeBody) } : {}),
                kind: String(kind),
                route: "#chat",
              },
              webpush: { headers: { Urgency: "normal", TTL: "3600" } },
              android: { priority: "normal", ttl: "3600s" },
            },
          }),
          signal: AbortSignal.timeout(10_000),
        });
        if (r.ok) sent++;
        // 404/UNREGISTERED is FCM saying the app was uninstalled or the
        // subscription was replaced. Keeping that row is keeping a dead
        // reachability handle, which is the thing this table is not allowed to
        // accumulate — so it is deleted here rather than swept later.
        else if (r.status === 404 || r.status === 400) stale.push(row.token);
      } catch {
        /* one device failing is not the send failing */
      }
    }),
  );

  if (stale.length) {
    await q(
      `delete from vy_push_token where token = any($2::text[])
        ${agentScopePredicate("vy_push_token", { agentId: "$1" })}`,
      [MEERA_AGENT_ID, stale],
      5_000,
    ).catch(() => {});
  }

  return { sent };
}
