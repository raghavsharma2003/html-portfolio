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
//   wipe_state   { access_token, mode }  → { ok, rows } — mode "forget" deletes
//                                          the row, "clear" empties the
//                                          conversation's own fields (P2-1)
//   track        { device, event, props?, user_id? } → { ok }
//   consent      { device, granted, at, version, user_id? } → { ok } — the
//                                          DPDP memory-consent ledger (#148)

import { allow, ipOf } from "./_ratelimit.js";
import { q } from "./_db.js";

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
      const existing = await q(
        `select state, updated_at from meera_state where user_id = $1`,
        [user.id],
      ).catch(() => []);
      const row0 = existing[0] ?? null;
      const base = typeof b.base_updated_at === "string" ? b.base_updated_at : null;
      if (row0 && base && new Date(row0.updated_at).getTime() > new Date(base).getTime() + 1000) {
        return res.status(409).json({ conflict: true, state: row0.state, updated_at: row0.updated_at });
      }
      const updatedAt = new Date().toISOString();
      try {
        await q(
          `insert into meera_state (user_id, state, device_id, updated_at)
           values ($1, $2, $3, $4)
           on conflict (user_id) do update
             set state = excluded.state, device_id = excluded.device_id, updated_at = excluded.updated_at`,
          [
            user.id,
            JSON.stringify(state),
            UUID.test(String(b.device || "")) ? b.device : null,
            updatedAt,
          ],
        );
        return res.status(200).json({ ok: true, updated_at: updatedAt });
      } catch {
        return res.status(502).json({ ok: false });
      }
    }
    if (op === "load_state") {
      const user = await userFromToken(b.access_token);
      if (!user) return res.status(401).json({ error: "invalid session" });
      const rows = await q(
        `select state, updated_at from meera_state where user_id = $1`,
        [user.id],
      ).catch(() => []);
      const row = rows[0] ?? null;
      return res.status(200).json({ state: row?.state ?? null, updated_at: row?.updated_at ?? null });
    }
    // ── P2-1: the authenticated door onto meera_state ──────────────────────
    //
    // api/memory.js's opForget already purges and rewrites this row, keyed on
    // `device_id` — the column save_state writes on every push. That covers
    // every anonymous user and every signed-in user forgetting from the device
    // that last synced, which is nearly all of them, and it needs no client
    // change, which is why it is the primary mechanism.
    //
    // It cannot cover one case: meera_state's real key is `user_id`, and its
    // `device_id` names only the LAST device to save. A person signed in on a
    // phone and a laptop has one row; if the laptop saved last and they forget
    // on the phone, the device-keyed delete misses, and the laptop's next
    // load_state hands the conversation back. Closing that needs the identity
    // the row is actually keyed on, and the only thing that proves it is an
    // access token — which api/memory.js never sees and should not start
    // seeing (possession of the device uuid is its whole auth posture).
    //
    // Hence this op, here, where a token is already verified for save_state
    // and load_state. Two modes, matching the two doors in the product and the
    // verdicts in evals/teardown.mjs's FATE table:
    //
    //   forget — the row goes. The relationship is over; `user` goes with it.
    //   clear  — the CONVERSATION's own fields are emptied and `user` is kept,
    //            because clear-chat's own dialog promises "her memory of you is
    //            not touched" and a server-side wipe of the profile would make
    //            that copy a lie from the other side.
    //
    // The clear list is not a second opinion about what belongs to a
    // conversation: it is exactly the "clear+forget" verdicts in that FATE
    // table, and evals/recall/fate.mjs asserts the two agree, so a field added
    // to AppState cannot be wiped on the device and left standing on the
    // server.
    if (op === "wipe_state") {
      const user = await userFromToken(b.access_token);
      if (!user) return res.status(401).json({ error: "invalid session" });
      const mode = b.mode === "forget" ? "forget" : "clear";
      if (mode === "forget") {
        const gone = await q(`delete from meera_state where user_id = $1 returning user_id`, [
          user.id,
        ]).catch(() => []);
        return res.status(200).json({ ok: true, mode, rows: gone.length });
      }
      // CLEARED_FIELDS, and the shape each is reset to. An empty ARRAY and a
      // JSON null are different things to mergeStates, so each field is reset
      // to the shape its own type declares rather than all of them to null.
      const CLEARED = {
        messages: "[]",
        herLife: "[]",
        activities: "[]",
        momentsFired: "[]",
        inner: "null",
        game: "null",
        callback: "null",
        tally: "null",
        followup: "null",
        recentMoment: "null",
      };
      // one statement (L6: no cross-call transactions, so a rewrite that took
      // ten statements would have nine states in which the server copy is
      // half-cleared and a concurrent load_state could read one of them)
      const sets = Object.entries(CLEARED)
        .map(([k, v]) => `'{${k}}', '${v}'::jsonb`)
        .reduce((acc, pair) => `jsonb_set(${acc}, ${pair})`, "state");
      const rows = await q(
        `update meera_state set state = ${sets}, updated_at = now()
          where user_id = $1 returning user_id`,
        [user.id],
      ).catch(() => []);
      return res.status(200).json({ ok: true, mode, rows: rows.length });
    }
    // ── THE MEMORY-CONSENT LEDGER (task #148, DPDP) ────────────────────────
    //
    // India's DPDP Act reaches full effect 2027-05-14. Storing cross-session
    // personal and emotional memory needs its own specific, informed,
    // unbundled consent, and a fiduciary has to be able to SHOW it was given.
    // An answer that lives only in the localStorage of the phone that gave it
    // is not evidence: the user can edit it, a reinstall erases it, and a
    // second device never sees it.
    //
    // APPEND-ONLY, and that is the whole design. Every grant and every
    // withdrawal is its own row, so the table answers "was consent in force on
    // the 3rd of March" rather than only "what is it now" — which is the
    // question a regulator asks and the one an updateable single row cannot
    // answer. The client reads nothing back; there is no get op, because the
    // binding copy of the answer is the one on the device (src/engine/
    // memory.ts's gate).
    //
    // UNAUTHENTICATED, exactly like `track` below and for its reason: most of
    // this product's users are anonymous device ids, and requiring a login to
    // record a refusal would mean the refusals we could not prove are the ones
    // from people who never signed up. `user_id` rides along when there is
    // one. Possession of the device uuid is the whole auth posture, which is
    // the same posture api/memory.js's forget path runs on.
    //
    // FOUR COLUMNS AND NO CONTENT. There is no text field in this table and
    // there must never be one: a consent ledger that accumulated conversation
    // would be a second copy of the thing being consented to, in the one place
    // a refusal must never make larger. Same content law migration 012 states.
    if (op === "consent") {
      if (!UUID.test(String(b.device || ""))) return res.status(400).json({ error: "device required" });
      if (typeof b.granted !== "boolean") return res.status(400).json({ error: "granted required" });
      // the version of the ASK this answers. Small integer, clamped rather
      // than trusted: a consent row filed under a version that never existed
      // is a row nobody can map back to the words a person actually read.
      const version = Number.isInteger(b.version) && b.version > 0 && b.version < 1000 ? b.version : 1;
      // the client's clock names the moment the person tapped; the column
      // default names the moment we heard about it. Both are kept, because a
      // device that was offline for an hour makes them differ and the honest
      // record of when consent was GIVEN is the first one.
      const at = typeof b.at === "string" && !Number.isNaN(Date.parse(b.at)) ? b.at : new Date().toISOString();
      // awaited for `track`'s reason one op down: a serverless function
      // freezes the instant the response is sent, so a fire-and-forget insert
      // dies mid-flight most of the time — and this is the one row in this
      // file whose absence is a compliance gap rather than a lost metric.
      try {
        await q(
          `insert into meera_consent (device_id, user_id, kind, granted, version, at)
           values ($1,$2,$3,$4,$5,$6)`,
          [
            b.device,
            UUID.test(String(b.user_id || "")) ? b.user_id : null,
            "memory",
            b.granted,
            version,
            at,
          ],
        );
        return res.status(200).json({ ok: true });
      } catch {
        // The device has already stopped writing memory by the time this
        // request is made, so a failed ledger insert costs the RECORD of the
        // decision and never the decision itself. 502 rather than 200 so the
        // client's own retry logic (and any future one) can tell the two apart.
        return res.status(502).json({ ok: false });
      }
    }
    if (op === "track") {
      // analytics rows are unauthenticated by design — cap them hard so the
      // table can't be bloated with megabyte props or junk event names
      const props = b.props && typeof b.props === "object" ? b.props : {};
      if (JSON.stringify(props).length > 2000) return res.status(413).json({ error: "props too large" });
      const event = String(b.event || "unknown").slice(0, 60);
      if (!/^[a-z0-9_.-]+$/i.test(event)) return res.status(400).json({ error: "bad event" });
      // awaited: a serverless function freezes the instant the response is
      // sent — a fire-and-forget insert dies mid-flight most of the time
      await q(`insert into meera_events (device_id, user_id, event, props) values ($1,$2,$3,$4)`, [
        UUID.test(String(b.device || "")) ? b.device : null,
        UUID.test(String(b.user_id || "")) ? b.user_id : null,
        event,
        JSON.stringify(props),
      ]).catch(() => {});
      return res.status(200).json({ ok: true });
    }
    return res.status(400).json({ error: "unknown op" });
  } catch {
    return res.status(500).json({ error: "account failure" });
  }
}
