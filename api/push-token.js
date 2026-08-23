// Per-device push tokens — the registration half of the FCM slot.
//
// ═══ THIS ENDPOINT DOES NOTHING UNTIL SOMEONE PASTES A KEY ═══════════════
//
// `pushConfigured()` below reads the same three server-side names the send
// helper does (api/_push.js). With them empty — which is the shipping state —
// every request is answered 200 `{ ok: true, stored: false, reason:
// "unconfigured" }` WITHOUT touching the database, so:
//
//   * `db/migrations/015_push_tokens.sql` does not need to have been applied,
//   * no row containing a reachability handle can exist by accident,
//   * and a client built before the config lands cannot half-register.
//
// The check is at the TOP of the handler, before any parse, because a config
// gate that runs after the work is a gate that only changes the response.
//
// ── WHY A TOKEN IS TREATED AS PRIVACY DATA AND NOT AS PLUMBING ────────────
//
// A push token is REACHABILITY: possession of it is the ability to put text on
// a person's lock screen. That makes it closer to a phone number than to a
// session id, and it gets the phone-number treatment:
//
//   * it is AGENT-SCOPED like every other row about a relationship
//     (api/_agentscope.js, SPEC-AGENT-LAYER §2 Law E1). A second agent must
//     not be able to reach a person through Meera's registration, which is the
//     same isolation the memory tables get and for a stronger reason: memory
//     leaking is embarrassing, reachability leaking is contact.
//   * it is keyed by device, and REPLACED rather than accumulated. One row per
//     (agent, device). A device that re-registers has one token, not a history
//     of them, because an old token that still resolves is an old phone still
//     buzzing.
//   * `revoke: true` DELETES the row rather than flagging it. The teardown
//     (src/notify/index.ts `clearReachability`) is the caller, and a soft
//     delete would leave the exact artefact the teardown exists to remove.
//   * it is never logged, never echoed back in a response, and never returned
//     by any read path. The only thing that reads it is api/_push.js.
//
// ── THE FORGET PATH ───────────────────────────────────────────────────────
//
// api/memory.js's forget cascade deletes by person. This table is keyed by
// DEVICE, which is what the client actually holds, and the client's own
// teardown calls `revoke` on both doors. The cascade's row is the one in
// migration 015's `on delete cascade` from vy_person_device: when the device
// mapping goes, so does the token, so a forget that never reaches this
// endpoint still cannot leave a live registration behind.
//
// Fail-soft like api/telemetry.js and api/clock.js: a storage outage answers
// 200 `{ ok: false }`. A failed token write must never surface as a product
// failure, because the product it would fail is a notification nobody has
// noticed is missing.

import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";
import { MEERA_AGENT_ID, agentValue } from "./_agentscope.js";
// NAMESPACE IMPORT, and it is a correctness requirement rather than a style.
// `api/_config.js` is gitignored and hand-maintained locally; a NAMED import of
// a key it does not export yet is a link-time SyntaxError, which would take the
// whole route down the moment this file shipped and before anyone had pasted
// anything. A namespace read of a missing key is `undefined`, which is exactly
// what "unconfigured" means here.
import * as CONFIG from "./_config.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** FCM registration tokens are ~160 chars; web ones are longer. A ceiling, not
 *  a format check: refusing a real token because its shape changed would be a
 *  silent loss of reachability, and the column is text either way. */
const MAX_TOKEN = 4096;
const PLATFORMS = new Set(["web", "android", "ios"]);

/** The server half of the slot. Mirrors src/notify/config.ts's client half —
 *  neither can turn the lane on alone, which is correct: a client with a token
 *  and a server that cannot send is a device that thinks it is reachable. */
export function pushConfigured() {
  const env = process.env;
  return Boolean(
    (env.FCM_PROJECT_ID || CONFIG.FCM_PROJECT_ID) &&
      (env.FCM_CLIENT_EMAIL || CONFIG.FCM_CLIENT_EMAIL) &&
      (env.FCM_PRIVATE_KEY || CONFIG.FCM_PRIVATE_KEY),
  );
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  // THE SLOT'S GATE. Before the body is even read: with no keys there is
  // nothing this endpoint could do with one.
  if (!pushConfigured()) {
    return res.status(200).json({ ok: true, stored: false, reason: "unconfigured" });
  }

  if (!allow(ipOf(req), "push-token", 30)) return res.status(429).json({ error: "slow down" });

  const body = typeof req.body === "object" && req.body ? req.body : {};
  const device = String(body.device || "");
  if (!UUID.test(device)) return res.status(400).json({ error: "bad device" });

  const agent = MEERA_AGENT_ID;

  // ── revoke: the teardown's call ─────────────────────────────────────────
  if (body.revoke === true) {
    try {
      await q(
        `delete from vy_push_token where device_id = $2 and agent_id = ${agentValue("$1")}`,
        [agent, device],
        5_000,
      );
      return res.status(200).json({ ok: true, revoked: true });
    } catch {
      return res.status(200).json({ ok: false });
    }
  }

  // ── register ────────────────────────────────────────────────────────────
  const token = String(body.token || "");
  if (!token || token.length > MAX_TOKEN) return res.status(400).json({ error: "bad token" });
  const platform = PLATFORMS.has(body.platform) ? body.platform : "web";

  try {
    // One row per (agent, device): the conflict target is the pair, so a
    // re-registration REPLACES rather than adds. See the header on why a token
    // history is a liability rather than a feature.
    await q(
      `insert into vy_push_token (agent_id, device_id, token, platform, updated_at)
       values (${agentValue("$1")}, $2, $3, $4, now())
       on conflict (agent_id, device_id)
       do update set token = excluded.token, platform = excluded.platform, updated_at = now()`,
      [agent, device, token, platform],
      5_000,
    );
    // The response says stored, never what was stored. A token echoed back is
    // a token in someone's network log.
    return res.status(200).json({ ok: true, stored: true });
  } catch {
    return res.status(200).json({ ok: false, stored: false });
  }
}
