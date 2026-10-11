// api/_operator-telegram.js — the operator's morning digest, incident alert
// and self-check verdict reaching Telegram (WS-R98). No new bot, no new HTTP
// shape: every send goes through `api/_room-telegram.js`'s own
// `sendRoomCheckinMessage` — the SAME function `api/_checkins.js`'s own
// `deliverers.telegram` already uses for a check-in delivery, reused rather
// than re-derived because it is the one function in this repo that already
// returns a real HTTP status code (not only Telegram's own `ok` boolean),
// which this file needs to tell "stop trying" (403 bot-blocked, 400 naming a
// dead chat — recorded as a `provider_telegram` incident, workstream law #1)
// apart from "try again later" (429/5xx — recorded as nothing, `_room-
// telegram.js`'s own header on `sendRoomCheckinMessage` names this exact
// distinction for the check-in sweep's identical need one caller over).
// `ROOM_TELEGRAM_BOT_TOKEN` — the SAME bot token the Room's own follower-
// facing bot already reads — is reused, never a second bot: "the bot the
// Room already has" (workstream brief's own words).
//
// ── THE LIST IS THE CONFIG, NEVER A DATABASE TABLE ─────────────────────────
//
// `OPS_TELEGRAM_CHAT_IDS` — a comma list of chat ids the operator pasted
// after `/start`-ing the bot — is the WHOLE allowlist, `api/_ops.js`'s own
// `OPS_OWNER_USER_IDS` posture restated for a Telegram chat id instead of a
// Supabase user id. A 403 (bot blocked) or 400 (chat no longer exists)
// REMOVES NOTHING from that list — there is no row to delete, the env IS the
// list — it is recorded as one `provider_telegram` incident instead, the
// SAME "a structural gap, named rather than hidden" posture
// `context/decisions.md#ws-r58-operator-push-subscription-store-does-not-
// exist` already took for a gap this repo could not yet close; here the
// gap is deliberate, not temporary — an operator who pastes a dead chat id
// sees it in the Incidents card and edits the env var themselves.
//
// ── NO IMPORT OF api/_incidents.js, ON PURPOSE ──────────────────────────────
//
// `api/_incidents.js`'s own `notifyNewIncidentKinds` is one of this file's
// three callers (workstream law #2), and it needs `recordIncident` — from
// THIS file's own header, that looks like it should just import
// `api/_incidents.js`. It does not: `api/_incidents.js` importing THIS file
// (to send its own incident-alert payload over Telegram) plus this file
// importing `api/_incidents.js` (for `recordIncident`) would be exactly the
// `api/_ops.js -> api/_incidents.js -> api/_ops.js`-shaped cycle
// `context/rejected.md#ws-r58-incidents-importing-opsownerids-from-ops-js-
// makes-a-cycle` already names, one pair of files over — `api/_operator-
// digest.js`'s own "no import of api/_ops.js" header is the third instance
// of the identical shape, restated a fourth time here. `recordIncident` is
// therefore taken as an INJECTED `deps.recordIncident` (default: a no-op),
// exactly `api/_incidents.js#notifyNewIncidentKinds`'s own
// `deps.operatorSubscriptionsFor` shape — `api/_incidents.js` itself passes
// its OWN local `recordIncident` (same file, no import needed); `api/
// _operator-digest.js` and `api/_self-check.js` each import `api/_incidents.js`
// directly (safe — `api/_incidents.js` never imports either of THEM) and
// pass the real function in.
import { sendRoomCheckinMessage } from "./_room-telegram.js";

/** `OPS_TELEGRAM_CHAT_IDS` parsed — `api/_ops.js#opsOwnerIds`'s own
 *  split/trim/filter shape, restated for a chat id instead of a user id (no
 *  lowercasing — a Telegram chat id is a signed integer string, not an
 *  identifier with a case). */
export function operatorTelegramChatIds(env = process.env) {
  return String(env.OPS_TELEGRAM_CHAT_IDS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Pure function of env, no db — `api/_ops.js#operatorPushConfig`'s own
 *  "whether a real send can ever happen at all" shape, restated for the bot
 *  token plus the chat list instead of a VAPID triple. */
export function operatorTelegramConfigured(env = process.env) {
  return Boolean(String(env.ROOM_TELEGRAM_BOT_TOKEN || "")) && operatorTelegramChatIds(env).length > 0;
}

// Every follower/room-content column this repo has ever put a name to on a
// person- or Room-identity-shaped field — `api/_operator-digest.js`'s own
// `OPERATOR_DIGEST_CONTENT_NAMES` list restated (not imported: importing it
// would pull `api/_operator-digest.js` into this file's own import graph for
// a value that never changes independently of this one — the same "kept
// independently, not imported" reasoning that file's own header already
// gives for keeping ITS list independent of `api/_creator-push.js`'s).
export const OPERATOR_TELEGRAM_CONTENT_NAMES = Object.freeze([
  "slug", "display_name", "thread_title", "content", "message_text", "payload_text", "reply_text", "person_id", "follower_id",
]);

/** Workstream law #2, restated as a RUNTIME guard rather than only a
 *  build-time static scan of a payload builder's own source (the technique
 *  `evals/operator-digest/run.mjs`'s own §3 NEGATIVE CONTROL (c) uses): this
 *  is the one channel that concatenates a caller's `title`/`body`/`url` into
 *  a single free-text message, so a genuine defense-in-depth check on the
 *  ASSEMBLED text, not only on the payload builder's source code, costs
 *  nothing and catches a future payload builder this file has never seen. A
 *  hit refuses the WHOLE send (never redacts and sends a partial message,
 *  which would be a worse, silently-wrong outcome than not sending at all). */
function operatorTelegramContentOk(text) {
  const lower = String(text || "").toLowerCase();
  return !OPERATOR_TELEGRAM_CONTENT_NAMES.some((name) => lower.includes(name));
}

/** WS-R81's own closed wire contract, `{t, title, body, url}` — `t` is
 *  accepted and ignored (Telegram has no notification "kind" to group by the
 *  way a browser's service worker does). `url` falls back to `route` — the
 *  OLDER field name `api/_operator-digest.js#operatorDigestPayload` still
 *  emits — the SAME alias `public/push-sw.js`'s own `data.url ?? data.route`
 *  already takes for the identical reason
 *  (`context/decisions.md#ws-r81-push-sw-shared-with-meera-no-closed-list`),
 *  restated here so this file needs no change to either existing payload
 *  builder. "Sends title, body and the URL as one message" (workstream law
 *  #1, verbatim) — one message: title, a blank line, body, the url on its
 *  own line — the same shape `api/_room-telegram.js`'s own app-voiced cards
 *  use for a multi-part message (`joinedCard`'s own `lines.join("\n")`
 *  after a blank-line-separated lead sentence). */
function operatorTelegramText(payload) {
  const title = String(payload?.title || "");
  const body = String(payload?.body || "");
  const url = String(payload?.url ?? payload?.route ?? "");
  const lead = [title, body].filter(Boolean).join("\n\n");
  return url ? [lead, url].filter(Boolean).join("\n") : lead;
}

/**
 * The one send. `payload` is WS-R81's push contract, exactly as a caller
 * already built it for the push channel — never a second payload shape to
 * maintain. Never throws for a per-chat send failure — every chat is its
 * own try/catch, `api/_incidents.js#notifyNewIncidentKinds`'s own posture
 * restated for a second channel. Returns `{sent, failed}` — plain numbers,
 * so `api/_sweep-run.js#sanitizeCounts` keeps them; each of this file's
 * three callers folds `sent` into ITS OWN summary as one field
 * (workstream law #2: "one summary field per channel").
 *
 * `deps.fetch` is REQUIRED, never defaulted to a global — `api/_room-
 * telegram.js#sendRoomCheckinMessage`'s own law, restated: "no calls to
 * Telegram from any eval" means an eval that forgets to inject one must get
 * a loud throw, never a silent real HTTP request. Every production caller
 * passes `fetch: globalThis.fetch` explicitly, `api/checkins-sweep.js`'s
 * own existing line for the identical reason.
 */
export async function sendOperatorTelegram(db, payload, deps = {}) {
  const summary = { sent: 0, failed: 0 };
  const env = deps.env || process.env;
  const token = String(env.ROOM_TELEGRAM_BOT_TOKEN || "");
  const chatIds = operatorTelegramChatIds(env);
  if (!token || !chatIds.length) return summary;

  const text = operatorTelegramText(payload || {});
  if (!text) return summary;
  if (!operatorTelegramContentOk(text)) {
    console.error("[operator-telegram] refused: payload text failed the content scan");
    return summary;
  }
  if (typeof deps.fetch !== "function") throw new Error("operator_telegram_send_fetch_required");
  const recordIncidentFn = typeof deps.recordIncident === "function" ? deps.recordIncident : async () => {};

  for (const chatId of chatIds) {
    try {
      const result = await sendRoomCheckinMessage(chatId, text, { token, fetch: deps.fetch });
      if (result.ok) {
        summary.sent++;
      } else {
        summary.failed++;
        // Workstream law #1: 403/400 remove nothing, they are recorded.
        if (result.status === 403 || result.status === 400) {
          await recordIncidentFn(db, { kind: "provider_telegram", door: "operator-telegram", status: result.status }).catch(() => {});
        }
      }
    } catch (error) {
      summary.failed++;
      console.error("[operator-telegram] send failure:", error?.message || "unknown");
    }
  }
  return summary;
}
