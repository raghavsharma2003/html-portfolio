// The WhatsApp Cloud API surface — SPEC-AGENT-LAYER §4 (Law E3).
//
// NOT WIRED. No credentials, no registered webhook, never contacted Meta. Code
// and tests only. What is verified offline: the four functions, the HMAC over
// a locally-signed body, the GET hub.challenge handshake, the fail-closed
// paths, and the 24-hour window refusal. What is NOT verified: anything
// requiring a real WABA — whether Meta's actual payload nesting matches the
// shape parsed here for every message type, template approval, and the real
// behaviour of the window on Meta's side. Named in docs/SURFACES.md rather
// than implied to work.
//
// ── the constraint that belongs HERE and nowhere else ─────────────────────
//
// THE 24-HOUR CUSTOMER-SERVICE WINDOW. Meta allows free-form messages only
// within 24 hours of the user's last inbound message; outside it, ONLY an
// approved template may be sent. This is the exact class of thing Law E3
// exists to contain: it is a property of one wire, it would be catastrophic to
// generalize (no other surface has it), and if the engine learned about it,
// every future surface would inherit a rule that is false for it.
//
// So `send()` refuses, here, and returns `{ok:false, error:'outside 24h
// window', requiresTemplate:true}`. It does NOT silently drop and it does NOT
// silently substitute a template — a template in place of what she meant to
// say is `silent-truncation` wearing a different hat: it returns success and
// she is quietly someone else.
//
// ── the group question is already decided ─────────────────────────────────
//
// `group-distribution` (2026-08-13): the Cloud API's group messaging works
// only for groups the BUSINESS creates; joining a group users already have is
// infeasible without unofficial-client ban risk. So the room lane on this
// surface is business-created groups, and 1:1 is the shipping path. Nothing
// here assumes otherwise.
import { createHmac, timingSafeEqual } from "node:crypto";
import { allow, ipOf } from "./_ratelimit.js";
import { dispatch, loadEngine, makeCtx, splitForLimit } from "./_surface.js";
import { q } from "./_db.js";
import { resolveInboundClone } from "./_clonechannel.js";
import { getChannelSecret } from "./_channel-secrets.js";

/** Raw bytes are required for the HMAC — see api/discord.js's property 1. */
export const config = { api: { bodyParser: false } };

// Env only; api/_config.js is another workstream's file. Absent => refused.
const APP_SECRET = process.env.WHATSAPP_APP_SECRET || "";
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN || "";
const ACCESS_TOKEN = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE_ID = process.env.WHATSAPP_PHONE_NUMBER_ID || "";
const BOT_NAME = process.env.WHATSAPP_DISPLAY_NAME || "Meera";
const API = "https://graph.facebook.com/v21.0";

/** Cloud API text body limit. */
export const WA_TEXT_LIMIT = 4096;
/** The customer-service window, in milliseconds. */
export const WA_WINDOW_MS = 24 * 60 * 60 * 1000;

// ── 1. verify ─────────────────────────────────────────────────────────────

/**
 * Two shapes, because Meta uses two.
 *
 * GET  — the subscription handshake: echo `hub.challenge` as PLAIN TEXT when
 *        `hub.verify_token` matches. A mismatch is refused; an unset token
 *        refuses everything, which is the correct state for an endpoint with
 *        no credentials.
 * POST — `X-Hub-Signature-256: sha256=<hex>` HMAC-SHA256 of the RAW body under
 *        the app secret, compared in constant time over equal-length digests.
 */
export async function verify(req) {
  if (req?.method === "GET") {
    const url = new URL(String(req.url || "/"), "https://local");
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";
    if (!VERIFY_TOKEN) return { ok: false, reason: "no verify token" };
    if (mode !== "subscribe" || !tokenOk(token)) return { ok: false, reason: "bad verify token" };
    return {
      ok: true,
      reason: "handshake",
      payload: null,
      respond: { status: 200, body: challenge, contentType: "text/plain" },
    };
  }
  if (!APP_SECRET) return { ok: false, reason: "no app secret" };
  const header = String(req?.headers?.["x-hub-signature-256"] || "");
  if (!header.startsWith("sha256=")) return { ok: false, reason: "bad signature header" };
  const raw = await rawBodyOf(req);
  if (!raw) return { ok: false, reason: "raw body unavailable" };
  if (!signatureOk(APP_SECRET, raw, header)) return { ok: false, reason: "bad signature" };
  try {
    return { ok: true, reason: "", payload: JSON.parse(raw.toString("utf8")) };
  } catch {
    return { ok: false, reason: "bad json" };
  }
}

/** Constant-time, and length-safe: timingSafeEqual throws on unequal lengths,
 *  which would leak length through an exception instead of a comparison. */
export function signatureOk(secret, rawBody, header) {
  const want = createHmac("sha256", secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), "utf8"))
    .digest();
  const got = Buffer.from(String(header).slice("sha256=".length), "hex");
  if (got.length !== want.length) return false;
  return timingSafeEqual(got, want);
}

function tokenOk(token) {
  const a = createHmac("sha256", "wa-verify").update(String(token || "")).digest();
  const b = createHmac("sha256", "wa-verify").update(VERIFY_TOKEN).digest();
  return timingSafeEqual(a, b);
}

export async function rawBodyOf(req) {
  if (req?.rawBody) return Buffer.isBuffer(req.rawBody) ? req.rawBody : Buffer.from(req.rawBody);
  if (typeof req?.on !== "function") return null;
  if (req.readableEnded || req.complete) return null;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    const b = Buffer.isBuffer(c) ? c : Buffer.from(c);
    size += b.length;
    if (size > 1_000_000) return null;
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}

// ── 2. parse ──────────────────────────────────────────────────────────────

/**
 * THE WINDOW LEDGER. Every inbound message refreshes the 24-hour clock for its
 * chat, so parse() is where the clock is wound and send() is where it is read.
 *
 * A module-level Map is warm-lambda state and therefore BEST EFFORT: a cold
 * start forgets it and `send` then fails CLOSED (no record = treat as outside
 * the window), which is the safe direction — a refused message is visible and
 * a policy violation is not. The durable version reads the last inbound turn
 * from meera_log, which is api/memory.js's file and not this workstream's;
 * ticketed in docs/SURFACES.md rather than half-built here.
 */
const lastInbound = new Map();

export function noteInbound(chatKey, atMs = Date.now()) {
  lastInbound.set(String(chatKey), atMs);
  if (lastInbound.size > 5000)
    for (const [k, v] of lastInbound) if (Date.now() - v > WA_WINDOW_MS) lastInbound.delete(k);
}

export function windowOpen(chatKey, now = Date.now()) {
  const at = lastInbound.get(String(chatKey));
  return at != null && now - at < WA_WINDOW_MS;
}

/** Test seam: reset the ledger without exporting the Map itself. */
export function resetWindow() {
  lastInbound.clear();
}

const base = (over = {}) => ({
  surface: "whatsapp",
  kind: "ignore",
  // The BINDING address (Gurukul WS-N): Meta's `phone_number_id`, which is the
  // WABA-side identity of the number this delivery arrived on. It is NOT the
  // chatKey and must never be confused with it — the chatKey addresses a
  // human, this addresses the business line, and `vy_clone_channel` routes on
  // the second. Meta puts it on `value.metadata`, per delivery, which is why
  // one POST can in principle carry two clones' traffic and the resolution
  // below is per EVENT rather than per request.
  channelRef: "",
  chatKey: "",
  chatName: "",
  isGroup: false,
  surfaceUserId: null,
  handle: "",
  text: "",
  caption: "",
  messageId: null,
  replyToSelf: false,
  fromBot: false,
  reason: "",
  adminBits: {},
  raw: null,
  ...over,
});

/**
 * One POST carries `entry[].changes[].value.messages[]` and MAY hold several —
 * this is the reason the contract's parse() returns an array at all. Status
 * callbacks (`value.statuses`) are delivery receipts, not events, and are
 * dropped with a named reason rather than silently.
 */
export function parse(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry?.changes || []) {
      const v = change?.value || {};
      const channelRef = String(v?.metadata?.phone_number_id || "");
      const names = new Map(
        (v.contacts || []).map((c) => [String(c.wa_id), String(c.profile?.name || "").slice(0, 64)]),
      );
      if (!v.messages?.length) {
        out.push(base({ channelRef, reason: v.statuses?.length ? "status callback" : "no messages" }));
        continue;
      }
      for (const m of v.messages) {
        const from = m.from == null ? null : String(m.from);
        // Group messages carry the group id; 1:1 messages do not. Per
        // `group-distribution` the group lane is business-created groups only.
        const groupId = m.group_id || v.group_id || null;
        const at = Number(m.timestamp) * 1000;
        const chatKey = String(groupId || from || "");
        if (chatKey) noteInbound(chatKey, Number.isFinite(at) ? at : Date.now());
        out.push(
          base({
            kind: "message",
            channelRef,
            chatKey,
            chatName: String(v.group_subject || ""),
            isGroup: Boolean(groupId),
            surfaceUserId: from,
            handle: names.get(from) || "",
            text: String(m.text?.body ?? m.button?.text ?? m.interactive?.list_reply?.title ?? ""),
            caption: String(m.image?.caption ?? m.video?.caption ?? m.document?.caption ?? ""),
            messageId: m.id == null ? null : String(m.id),
            replyToSelf: Boolean(m.context?.id) && Boolean(m.context?.from_me),
            fromBot: false,
            raw: m,
          }),
        );
      }
    }
  }
  return out.length ? out : [base({ reason: "empty payload" })];
}

// ── 3. send ───────────────────────────────────────────────────────────────

/**
 * Fail-closed twice over: no token, no send; outside the 24-hour window, no
 * free-form send.
 *
 * The refusal is REPORTED, not swallowed. The caller (api/_surface.js's
 * deliver) gets `{ok:false, error, requiresTemplate:true}` and the turn is
 * still logged, so "she went quiet on WhatsApp last Tuesday" is a query rather
 * than a mystery. Sending an approved template instead is a product decision
 * with its own copy review and its own consent question; it is not something
 * an adapter gets to do on her behalf.
 */
export async function send(chatKey, msg, now = Date.now(), creds = null) {
  if (!(creds?.accessToken || ACCESS_TOKEN) || !(creds?.phoneId || PHONE_ID))
    return { ok: false, error: "no access token" };
  if (msg.kind === "reaction") {
    if (!windowOpen(chatKey, now))
      return { ok: false, error: "outside 24h window", requiresTemplate: true };
    return await post(
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: String(chatKey),
        type: "reaction",
        reaction: { message_id: String(msg.replyTo), emoji: msg.emoji },
      },
      creds,
    );
  }
  if (!windowOpen(chatKey, now))
    return { ok: false, error: "outside 24h window", requiresTemplate: true };
  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: String(chatKey),
    type: "text",
    text: { body: String(msg.text ?? "").slice(0, WA_TEXT_LIMIT), preview_url: true },
  };
  if (msg.replyTo != null) body.context = { message_id: String(msg.replyTo) };
  // WhatsApp has no link button in a text message; a URL in the body IS the
  // affordance here, and it is appended by the app rail rather than spoken by
  // her — the room card's button becomes a line the card owns.
  if (msg.buttons?.length)
    body.text.body = `${body.text.body}\n${msg.buttons.map((b) => `${b.text}: ${b.url}`).join("\n")}`.slice(
      0,
      WA_TEXT_LIMIT,
    );
  return await post(body, creds);
}

/** The credentials one send uses. Defaulted to the module-level pair so every
 *  existing call is unchanged; overridden per clone by `sendWith()` below,
 *  whose values come from api/_channel-secrets.js and never from the database.
 *  A module-level mutable would have been the small change here and it is the
 *  wrong one: two clones' deliveries interleave inside one warm lambda. */
async function post(body, creds) {
  const phoneId = creds?.phoneId || PHONE_ID;
  const accessToken = creds?.accessToken || ACCESS_TOKEN;
  if (!phoneId || !accessToken) return { ok: false, error: "no access token" };
  const r = await fetch(`${API}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => null);
  if (!r) return { ok: false, error: "network" };
  return { ok: r.ok };
}

// ── 4. render ─────────────────────────────────────────────────────────────

export const render = (text) => splitForLimit(text, WA_TEXT_LIMIT);

/** One clone's outbound half. `send` stays the module-level default so nothing
 *  that already calls it changes; a bound lane builds its own. */
export const sendWith = (creds) => (chatKey, msg) => send(chatKey, msg, Date.now(), creds);

// ── the adapter ───────────────────────────────────────────────────────────

export const adapter = { surface: "whatsapp", verify, parse, send, render };

/**
 * `deps.bind` is the clone binding seam (Gurukul WS-N) and it is OPTIONAL by
 * design: absent, this is byte-for-byte the single-agent lane that shipped,
 * and `evals/mp/*` measure it unchanged. Present, it is called ONCE PER EVENT
 * with that event's `channelRef` and must return `{agent, agentId, send}` for
 * the clone bound to that business line, or null.
 *
 * NULL MEANS THE EVENT IS DROPPED — not answered by a default, not answered
 * with an apology. An unbound number, a paused or revoked binding, an
 * unpublished clone and a withdrawn consent artifact all arrive here as the
 * same null (api/_clonechannel.js flattens them on purpose), and the only safe
 * response to "I do not know who should answer this" is silence. A fallback
 * here would put a companion persona built for consenting adults in front of
 * whoever messaged a teacher's number.
 */
export async function handleEvents(payload, deps = {}) {
  const engine = deps.engine !== undefined ? deps.engine : await loadEngine();
  const results = [];
  for (const ev of parse(payload)) {
    let bound = null;
    if (deps.bind) {
      bound = await deps.bind(ev).catch(() => null);
      if (!bound) {
        results.push({ ok: false, skipped: "clone_unavailable", channelRef: ev.channelRef || "" });
        continue;
      }
    }
    const ctx = makeCtx(adapter, {
      ...deps,
      engine,
      botHandle: bound?.botHandle || BOT_NAME,
      agent: bound?.agent ?? deps.agent,
      agentId: bound?.agentId ?? deps.agentId,
      send: bound?.send ?? deps.send,
    });
    results.push(await dispatch(ev, ctx));
  }
  return results;
}

// ── the clone binding (Gurukul WS-N) ──────────────────────────────────────

/**
 * `phone_number_id` → the published clone that answers on that business line,
 * with ITS OWN access token read from the secret store.
 *
 * Two credentials, one reference: the token is the secret, the phone id is the
 * public half and already lives in `vy_clone_channel.external_ref`. So the
 * secret store holds exactly one string per channel and there is nothing to
 * keep in step.
 *
 * NOT VERIFIED: no WhatsApp channel has ever been connected and no secret has
 * ever been written — the default secret backend is `none` and refuses, so
 * this path currently ends in a null and a dropped event. That is the honest
 * state and it is named here rather than implied to work, in the same words
 * this file's header uses about everything else Meta-side.
 */
export async function bindWhatsappClone(ev, deps = {}) {
  const ref = String(ev?.channelRef || "");
  if (!ref) return null;
  const db = deps.db || q;
  const resolved = await resolveInboundClone(db, "whatsapp", ref, deps).catch(() => null);
  if (!resolved) return null;
  const read = deps.readSecret || getChannelSecret;
  const accessToken = await read(resolved.channel.credentials_ref).catch(() => null);
  // No token, no lane. Binding a clone we cannot send as would log the
  // student's turn and then go silent, which is worse than never resolving.
  if (!accessToken) return null;
  return {
    agent: resolved.module,
    agentId: resolved.agentId,
    botHandle: resolved.module?.displayName || BOT_NAME,
    send: sendWith({ accessToken, phoneId: ref }),
  };
}

// ── HTTP ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST")
    return res.status(405).json({ error: "GET or POST only" });
  if (!allow(ipOf(req), "whatsapp", 120)) return res.status(429).json({ error: "slow down" });
  const auth = await verify(req);
  if (!auth.ok) return res.status(401).json({ error: auth.reason });
  if (auth.respond) {
    if (auth.respond.contentType) res.setHeader?.("Content-Type", auth.respond.contentType);
    return res.status(auth.respond.status).send
      ? res.status(auth.respond.status).send(auth.respond.body)
      : res.status(auth.respond.status).json(auth.respond.body);
  }
  try {
    // The clone binder is wired at the EDGE, never inside the adapter: an
    // adapter that could reach the database would be an adapter holding a
    // query, which docs/SURFACES.md §"What you must NOT do" forbids.
    await handleEvents(auth.payload, { bind: (ev) => bindWhatsappClone(ev) });
    // Meta retries on non-2xx and would re-run the writes above.
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error("[whatsapp] handler failure:", e?.message || "unknown");
    return res.status(200).json({ ok: true });
  }
}
