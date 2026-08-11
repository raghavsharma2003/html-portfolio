// Session telemetry sink: the batched ingest half of docs/TELEMETRY.md.
//
// Same shape as api/diag.js (multi-row INSERT, one round trip, fail-soft) with
// three differences that are not cosmetic:
//
//  1. IT MUST ACCEPT BODIES THAT ARE NOT application/json. The most valuable
//     batch in any session is the last one — the flush at visibilitychange /
//     pagehide, which carries the end of the session and is the only place a
//     "she went weird and I closed the app" complaint is reconstructible from.
//     That flush goes out via navigator.sendBeacon, and sendBeacon cannot send
//     application/json without a CORS preflight it is structurally unable to
//     wait for, so real clients send text/plain or x-www-form-urlencoded. A
//     handler that only reads req.body-as-object drops every one of those and
//     looks perfectly healthy while doing it.
//  2. Sessions are rolled up as they arrive (meera_tel_session), so listing
//     sessions never scans the event table.
//  3. Content caps are per-record, because compose.draft legitimately carries
//     draft text (rule 2's one exception) and must not be trimmed to nothing.
//
// Fail-soft: 200 unless the batch is structurally invalid. A telemetry outage
// must never surface as a product failure — rule 1.
import { q } from "./_db.js";
import { allow, ipOf } from "./_ratelimit.js";

// A live batch is 60 records (4s timer / 60 records, whichever first). The
// headroom is for the IndexedDB offline drain, which arrives as a burst on
// reconnect — the flight-mode session is exactly the one someone asks about,
// so the ceiling is set above the drain rather than below it.
const MAX_RECORDS = 500;
const MAX_EVENT = 64;
const MAX_AREA = 24;
const MAX_SESSION = 96;
const MAX_DEVICE = 64;
// 4000 matches meera_log's content cap: a draft that would have been sendable
// as a message must survive as a draft.
const MAX_PROPS_CHARS = 4000;
const MAX_PROP_STR = 1500;
// wall clock is client-supplied and can be years off (rule 4 is why t_ms
// exists at all); anything outside this window is stamped at receipt instead
const AT_SLACK_MS = 7 * 86_400_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Collect a request body that no framework parsed for us. */
function rawBody(req) {
  return new Promise((resolve) => {
    if (typeof req.on !== "function" || req.readableEnded || req.complete) return resolve("");
    let out = "";
    let bytes = 0;
    req.setEncoding?.("utf8");
    req.on("data", (c) => {
      bytes += c.length;
      // a runaway upload must not become memory pressure; the parse below
      // will fail on the truncated tail and the batch is rejected, which is
      // the correct outcome for a body this size
      if (bytes < 4_000_000) out += c;
    });
    req.on("end", () => resolve(out));
    req.on("error", () => resolve(""));
  });
}

function parseJson(s) {
  if (typeof s !== "string") return null;
  const a = s.indexOf("{");
  if (a < 0) return null;
  try {
    return JSON.parse(s.slice(a, s.lastIndexOf("}") + 1));
  } catch {
    return null;
  }
}

/**
 * Get the batch out of whatever shape the body arrived in.
 *
 * Four real cases, all of which happen in production:
 *   fetch keepalive + application/json  → req.body is already the object
 *   sendBeacon Blob text/plain          → req.body is a string (or a Buffer)
 *   sendBeacon x-www-form-urlencoded    → a body parser split the JSON on
 *                                         `&` and `=` into an object whose
 *                                         keys are fragments of the document
 *   no body parser at all (bare node)   → nothing is set; read the stream
 */
async function readBatch(req) {
  const b = req.body;

  if (b && typeof b === "object" && !Buffer.isBuffer(b) && !Array.isArray(b)) {
    if (Array.isArray(b.records)) return b;
    // urlencoded parse of a raw JSON document: reverse the split that made it.
    // Lossy in principle (a literal `+` in a draft decodes to a space), which
    // is why the client is asked for text/plain first — but a slightly bruised
    // batch beats a silently discarded one.
    const parts = Object.entries(b).map(([k, v]) => (v === "" || v == null ? k : `${k}=${v}`));
    const rebuilt = parseJson(parts.join("&"));
    if (rebuilt) return rebuilt;
    return null;
  }

  const direct = parseJson(Buffer.isBuffer(b) ? b.toString("utf8") : b);
  if (direct) return direct;
  return parseJson(await rawBody(req));
}

/**
 * Fit one props object under the per-record cap without throwing away the
 * fields RCA is actually made of. A record over budget is almost always one
 * long string (a draft, a stack trace); msg_id, lane and the timings next to
 * it are small and are the whole reason the record is worth keeping.
 */
function fitProps(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  if (JSON.stringify(raw).length <= MAX_PROPS_CHARS) return raw;
  const out = {};
  for (const [k, v] of Object.entries(raw)) {
    out[k] = typeof v === "string" && v.length > MAX_PROP_STR ? v.slice(0, MAX_PROP_STR) : v;
  }
  out.tel_trimmed = true;
  const s = JSON.stringify(out);
  if (s.length <= MAX_PROPS_CHARS) return out;
  return { tel_truncated: true, chars: s.length };
}

const clampAt = (v, now) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return now;
  return Math.abs(n - now) > AT_SLACK_MS ? now : n;
};

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  // ~15 batches/min in steady state (4s timer), plus the immediate flushes on
  // err.*, call end, watch end and pagehide, plus offline drains. Generous
  // enough that a legitimately noisy session is never clipped, bounded enough
  // that a loop cannot mine the table.
  if (!allow(ipOf(req), "tel", 300)) return res.status(429).json({ error: "slow down" });

  const batch = await readBatch(req);
  const device = String(batch?.device || "").slice(0, MAX_DEVICE);
  const records = Array.isArray(batch?.records) ? batch.records : null;
  // structurally invalid is the ONLY 400: a client that cannot form a batch
  // has a bug worth surfacing, everything downstream of that is our problem
  if (!device || !records || !records.length) return res.status(400).json({ error: "bad batch" });

  const session = String(batch.session || "").slice(0, MAX_SESSION);
  if (!session) return res.status(400).json({ error: "bad batch" });
  const userId = UUID.test(String(batch.user_id || "")) ? String(batch.user_id) : null;
  const surface = String(batch.surface || "app").slice(0, 24);

  const now = Date.now();
  const kept = records
    .slice(0, MAX_RECORDS)
    .filter((r) => r && typeof r.event === "string" && r.event.trim());
  const dropped = records.length - kept.length;
  if (!kept.length) return res.status(200).json({ ok: true, stored: 0, dropped });

  const values = [];
  const params = [];
  let i = 1;
  let firstAt = Infinity;
  let lastAt = -Infinity;
  let platform = null;
  let appVersion = null;
  let meta = null;

  for (const r of kept) {
    const event = String(r.event).trim().slice(0, MAX_EVENT);
    // UNKNOWN EVENTS ARE STORED, NOT REJECTED. A schema that can refuse an
    // event name is a schema that decides which future questions are
    // answerable, and it always decides wrong — the event nobody allowlisted
    // is the one the incident turns out to be about.
    const area = String(r.area || event.split(".")[0] || "app")
      .trim()
      .slice(0, MAX_AREA);
    const props = fitProps(r.props);
    const at = clampAt(r.at, now);
    if (at < firstAt) firstAt = at;
    if (at > lastAt) lastAt = at;
    if (event === "app.start" && props && typeof props === "object") {
      platform = props.platform != null ? String(props.platform).slice(0, 40) : platform;
      appVersion = props.version != null ? String(props.version).slice(0, 40) : appVersion;
      meta = props;
    }
    values.push(`($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`);
    params.push(
      device,
      userId,
      session,
      Number.isFinite(r.seq) ? Math.round(r.seq) : null,
      area,
      event,
      Number.isFinite(r.t_ms) ? Math.round(r.t_ms) : null,
      JSON.stringify(props),
      new Date(at).toISOString(),
    );
  }

  const pSession = [
    session,
    device,
    userId,
    surface,
    new Date(firstAt).toISOString(),
    new Date(lastAt).toISOString(),
    kept.length,
    platform,
    appVersion,
    JSON.stringify(meta || {}),
  ];
  const base = i;
  const sp = pSession.map((_, n) => `$${base + n}`);
  params.push(...pSession);

  try {
    // ONE statement, so the events and the rollup that counts them cannot
    // disagree, and one round trip for the whole batch.
    //
    // The rollup is an upsert rather than select-then-update because batches
    // from the same session overlap in flight (the pagehide flush races the
    // 4s timer) and a read-then-write would lose one of them. least()/
    // greatest() rather than assignment because batches also arrive out of
    // order — an offline drain lands after the live traffic it preceded, and
    // must not drag started_at forward or ended_at back.
    //
    // serverless freezes the moment the response is sent, so this is awaited:
    // fire-and-forget here means the batch silently disappears.
    await q(
      `with ins as (
         insert into meera_tel
           (device_id, user_id, session_id, seq, area, event, t_ms, props, at)
         values ${values.join(", ")}
       )
       insert into meera_tel_session
         (session_id, device_id, user_id, surface, started_at, ended_at, events, platform, app_version, meta)
       values (${sp[0]}, ${sp[1]}, ${sp[2]}, ${sp[3]}, ${sp[4]}, ${sp[5]}, ${sp[6]}, ${sp[7]}, ${sp[8]}, ${sp[9]}::jsonb)
       on conflict (session_id) do update set
         started_at  = least(meera_tel_session.started_at, excluded.started_at),
         ended_at    = greatest(meera_tel_session.ended_at, excluded.ended_at),
         events      = meera_tel_session.events + excluded.events,
         user_id     = coalesce(excluded.user_id, meera_tel_session.user_id),
         platform    = coalesce(excluded.platform, meera_tel_session.platform),
         app_version = coalesce(excluded.app_version, meera_tel_session.app_version),
         meta        = meera_tel_session.meta || excluded.meta`,
      params,
    );
    return res.status(200).json({ ok: true, stored: kept.length, dropped });
  } catch {
    // storage trouble is ours, not the app's — rule 1
    return res.status(200).json({ ok: false });
  }
}
