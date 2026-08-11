// Read a session back. The tool you open when someone says "she lied to me
// last night" and you have thirty seconds to find out whether she did.
//
//   node scripts/session.mjs --list [--device X] [--since 24h] [--limit 30]
//   node scripts/session.mjs --session <id> [--all]
//   node scripts/session.mjs --session <id> --rca
//
// Three things about the timeline that are not arbitrary:
//
//   ORDER IS t_ms, NEVER at. `at` is client wall clock: it steps on NTP sync,
//   it moves when they cross a timezone, it lurches when a backgrounded phone
//   catches up. Sorting a timeline on it produces events in an order that
//   never happened, which is the one failure mode a forensic tool cannot have.
//   `at` is shown, and only ever used to line telemetry up against meera_log.
//
//   WHAT WAS SAID IS JOINED IN, NOT STORED. Telemetry carries msg_id and no
//   content (docs/TELEMETRY.md rule 2), so the transcript is fetched from
//   meera_log at read time. That is what makes `forget` honest: delete the
//   message and this tool stops being able to show it, with no second copy
//   to go stale or to leak.
//
//   THE JOIN IS CURRENTLY PART HEURISTIC — see resolveSaid(). meera_log has no
//   msg_id column, so a client-minted id cannot address a row directly.
//
// --all keeps the sampled high-volume events (ui.scroll, watch.frame,
// compose.keys). They are excluded by default because a hundred scroll rows
// between two interesting ones is how a readable timeline stops being read.
import { q } from "../api/_db.js";

const args = process.argv.slice(2);
const arg = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);
const has = (name) => args.includes(name);

// ── terminal ────────────────────────────────────────────────────────────────
const tty = process.stdout.isTTY && !process.env.NO_COLOR;
const c = (n) => (s) => (tty ? `\x1b[${n}m${s}\x1b[0m` : String(s));
const dim = c(2);
const bold = c(1);
const red = c(31);
const yellow = c(33);
const green = c(32);
const cyan = c(36);
const magenta = c(35);
const blue = c(34);

const AREA_COLOR = {
  app: blue,
  ui: cyan,
  compose: magenta,
  chat: green,
  call: yellow,
  watch: magenta,
  err: red,
};

// ── formatting ──────────────────────────────────────────────────────────────
const pad = (s, n) => String(s ?? "").padEnd(n);
const lpad = (s, n) => String(s ?? "").padStart(n);

function dur(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

function stamp(t) {
  const d = new Date(t);
  return (
    `${String(d.getDate()).padStart(2, "0")} ` +
    `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()]} ` +
    `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`
  );
}

// mm:ss.mmm from session start — the axis every reconstruction is read on
function offset(ms) {
  // same width as a real offset, so a finding that applies to the whole
  // session does not knock the column out of line
  if (!Number.isFinite(ms)) return "  session  ";
  const neg = ms < 0;
  const v = Math.abs(ms);
  const m = Math.floor(v / 60000);
  const s = Math.floor((v % 60000) / 1000);
  const f = Math.floor(v % 1000);
  return `${neg ? "-" : "+"}${lpad(m, 3)}:${String(s).padStart(2, "0")}.${String(f).padStart(3, "0")}`;
}

const sinceMs = (spec) => {
  const m = /^(\d+)\s*([smhdw])$/.exec(String(spec || "").trim().toLowerCase());
  if (!m) return null;
  const mult = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[m[2]];
  return Number(m[1]) * mult;
};

const oneLine = (s, n = 100) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

// ── --list ──────────────────────────────────────────────────────────────────
async function list() {
  const device = arg("--device");
  const since = sinceMs(arg("--since") || "7d") ?? 7 * 86_400_000;
  const limit = Math.min(200, Number(arg("--limit")) || 30);
  const from = new Date(Date.now() - since).toISOString();

  const params = [from];
  let where = "started_at >= $1";
  if (device) {
    params.push(device);
    where += ` and device_id = $2`;
  }
  const rows = await q(
    `select session_id, device_id, surface, platform, app_version, events,
            started_at, ended_at
       from meera_tel_session
      where ${where}
      order by started_at desc
      limit ${limit}`,
    params,
    30_000,
  );

  if (!rows.length) {
    console.log(dim(`no sessions in the last ${arg("--since") || "7d"}${device ? ` for ${device}` : ""}`));
    return;
  }

  console.log(
    dim(
      `  ${pad("started", 13)} ${pad("session", 30)} ${pad("surface", 8)} ${pad("platform", 9)} ` +
        `${pad("version", 8)} ${lpad("events", 6)} ${lpad("dur", 7)}  device`,
    ),
  );
  for (const r of rows) {
    const started = new Date(r.started_at).getTime();
    const ended = r.ended_at ? new Date(r.ended_at).getTime() : null;
    console.log(
      `  ${pad(stamp(started), 13)} ${bold(pad(r.session_id, 30))} ${pad(r.surface, 8)} ` +
        `${pad(r.platform, 9)} ${pad(r.app_version, 8)} ${lpad(r.events, 6)} ` +
        `${lpad(ended ? dur(ended - started) : "open", 7)}  ${dim(r.device_id)}`,
    );
  }
  console.log(dim(`\n  ${rows.length} session(s). node scripts/session.mjs --session <id> [--rca]`));
}

// ── loading one session ─────────────────────────────────────────────────────
async function load(sessionId) {
  const [head] = await q(
    `select * from meera_tel_session where session_id = $1`,
    [sessionId],
    30_000,
  );
  // t_ms first, id as the tiebreak: two events inside the same millisecond
  // still have an insertion order, and it is the order they were buffered in.
  // nulls last rather than first — a record with no t_ms cannot be placed, and
  // guessing zero would put it at the top of a timeline it may not belong to.
  const rows = await q(
    `select id, seq, area, event, t_ms, props, at
       from meera_tel
      where session_id = $1
      order by t_ms asc nulls last, id asc`,
    [sessionId],
    30_000,
  );
  return { head, rows };
}

/**
 * Pull in what was actually SAID, from meera_log.
 *
 * THE GAP, STATED PLAINLY: meera_log has no msg_id column. api/memory.js
 * opLog inserts turns and returns nothing, so the client never learns the row
 * id and cannot put it in props — the direct join the contract describes has
 * nothing to join on yet. Two paths, in order:
 *
 *   1. props.msg_id === meera_log.id, for the day a producer can supply it
 *      (that needs a msg_id column on meera_log and an opLog that returns
 *      ids; neither is in this change's scope).
 *   2. nearest unclaimed log row of the expected role within CORRELATE_MS.
 *      Correlation, not identity — so it is marked `~` in the output and must
 *      never be read as proof of which message a record refers to.
 *
 * A wrong pairing here would put words in her mouth in the exact tool used to
 * decide whether words were put in her mouth, so the ambiguity is printed
 * rather than hidden.
 */
const CORRELATE_MS = 90_000;
const HER = new Set(["chat.reply", "watch.comment", "call.turn"]);
const ME = new Set(["chat.send", "compose.send", "compose.draft", "chat.media"]);

async function resolveSaid(head, rows) {
  const said = new Map(); // telemetry row id -> { role, content, exact }
  if (!head?.device_id) return said;
  const wanted = rows.filter((r) => r.props && r.props.msg_id != null);
  if (!wanted.length) return said;

  const t0 = new Date(head.started_at).getTime() - CORRELATE_MS;
  const t1 = (head.ended_at ? new Date(head.ended_at).getTime() : Date.now()) + CORRELATE_MS;
  // device_id is uuid on meera_log and text on meera_tel (telemetry must store
  // a row even when the id is malformed), so the cast is load-bearing
  const log = await q(
    `select id, role, channel, kind, content, at
       from meera_log
      where device_id::text = $1 and at >= $2 and at < $3
      order by at asc`,
    [head.device_id, new Date(t0).toISOString(), new Date(t1).toISOString()],
    30_000,
  ).catch(() => []);
  if (!log.length) return said;

  const byId = new Map(log.map((l) => [String(l.id), l]));
  const claimed = new Set();

  for (const r of wanted) {
    const key = String(r.props.msg_id);
    const exact = byId.get(key);
    if (exact) {
      said.set(r.id, { ...exact, exact: true });
      claimed.add(exact.id);
      continue;
    }
    const role = HER.has(r.event) ? "her" : ME.has(r.event) ? "me" : null;
    if (!role) continue;
    const at = new Date(r.at).getTime();
    let best = null;
    let bestD = Infinity;
    for (const l of log) {
      if (l.role !== role || claimed.has(l.id)) continue;
      const d = Math.abs(new Date(l.at).getTime() - at);
      if (d < bestD) {
        bestD = d;
        best = l;
      }
    }
    if (best && bestD <= CORRELATE_MS) {
      said.set(r.id, { ...best, exact: false, off: bestD });
      claimed.add(best.id);
    }
  }
  return said;
}

// ── event rendering ─────────────────────────────────────────────────────────
const NOISY = new Set(["ui.scroll", "watch.frame", "compose.keys", "app.resize"]);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
const ms = (v) => (num(v) == null ? null : `${Math.round(num(v))}ms`);

// Per-event shapes for the events that carry the story. Everything else falls
// through to key=value, which is also what an UNKNOWN event gets — the schema
// stores those (rule: never lose an event), so the reader must show them too.
const SHAPE = {
  // each field only when the producer actually sent it — a default printed as
  // if it were reported is a fact invented by the reader
  "app.start": (p) =>
    [
      p.platform,
      p.version && `v${p.version}`,
      p.build && `build ${p.build}`,
      p.network,
      p.native === undefined ? null : p.native ? "native" : "web",
      p.cold === undefined ? null : p.cold ? "cold" : "warm",
      p.locale,
    ]
      .filter(Boolean)
      .join(" "),
  "app.route": (p) => `${p.from ?? "?"} → ${p.to ?? "?"}${p.via ? ` (${p.via})` : ""}`,
  "app.foreground": (p) => (p.away_ms ? `away ${dur(num(p.away_ms))}` : ""),
  "ui.tap": (p) => `${p.label ?? p.path ?? "?"}${p.since_paint_ms ? dim(` ${ms(p.since_paint_ms)} after paint`) : ""}`,
  "ui.rage_tap": (p) => red(`${p.label ?? p.path ?? "?"} ×${p.count ?? "?"}`),
  "ui.dead_tap": (p) => yellow(`${p.label ?? p.path ?? "?"} — nothing happened`),
  "compose.start": (p) => `${p.field ?? ""}${p.t_since_last_msg_ms ? dim(` after ${dur(num(p.t_since_last_msg_ms))} quiet`) : ""}`,
  "compose.keys": (p) =>
    `${p.keys ?? 0} keys, ${p.backspaces ?? 0} bs, iki ${p.iki_p50 ?? "?"}/${p.iki_p90 ?? "?"}` +
    `${p.pauses_over_2s ? `, ${p.pauses_over_2s} pause(s)` : ""}` +
    `${p.longest_pause_ms ? `, longest ${ms(p.longest_pause_ms)}` : ""}`,
  "compose.edit": (p) => `${p.kind ?? "edit"} at ${p.pos ?? "?"} −${p.removed_len ?? 0}/+${p.added_len ?? 0}`,
  // the text itself gets its own line below the row, so it is not also
  // dumped into the props summary
  "compose.draft": (p) => `${p.final ? "sent" : "abandoned"}, ${String(p.text ?? "").length} chars`,
  "compose.abandon": (p) => yellow(`typed ${p.chars ?? "?"} chars, cleared after ${dur(num(p.alive_ms))}`),
  "compose.send": (p) => `${p.chars ?? "?"} chars in ${dur(num(p.compose_ms))}, ${p.revisions ?? 0} revision(s)`,
  "chat.send": (p) => `${p.kind ?? "text"} ${p.chars ?? "?"} chars`,
  "chat.reply": (p) =>
    `${p.lane ? `${p.lane} ` : ""}${p.model ?? ""} ${ms(p.latency_ms) ?? "?"}` +
    `${p.stream_first_token_ms ? dim(` first token ${ms(p.stream_first_token_ms)}`) : ""}` +
    `${p.bubbles ? `, ${p.bubbles} bubble(s)` : ""}${p.truncated ? red(" TRUNCATED") : ""}`,
  "chat.error": (p) => red(`${p.stage ?? "?"} ${p.status ?? ""}${p.retried ? " (retried)" : ""}`),
  "call.start": (p) => `${p.lane ?? ""}`,
  "call.end": (p) => `${p.reason ?? "?"} after ${dur(num(p.duration_ms))}`,
  "call.turn": (p) => `${p.who ?? "?"} ${dur(num(p.dur_ms))}${p.words ? `, ${p.words}w` : ""}${p.first_audio_ms ? dim(` first audio ${ms(p.first_audio_ms)}`) : ""}`,
  "call.bargein": (p) => `${p.accepted ? "accepted" : red("rejected")} at ${ms(p.at_ms_into_her_turn) ?? "?"} into her turn`,
  "call.lane_change": (p) => yellow(`${p.from ?? "?"} → ${p.to ?? "?"} (${p.reason ?? "?"})`),
  "call.tts": (p) => `${p.lane ?? "?"} ${ms(p.first_audio_ms) ?? "?"}${p.cached ? " cached" : ""}${p.chars ? `, ${p.chars} chars` : ""}`,
  "call.silence": (p) => `${dur(num(p.ms))}, broken by ${p.who_broke_it ?? "?"}`,
  "call.audio_glitch": (p) => red(`${p.kind ?? "glitch"}`),
  "watch.start": (p) => `${p.lane ?? ""}`,
  "watch.stop": (p) => `${p.reason ?? "?"} after ${dur(num(p.duration_ms))}`,
  "watch.frame": (p) => `${p.w ?? "?"}×${p.h ?? "?"} ${p.bytes ?? "?"}B age ${ms(p.age_ms) ?? "?"}${p.blank ? yellow(" BLANK") : ""}`,
  "watch.scene": (p) => `${p.class ?? "?"} hold ${ms(p.hold_ms) ?? "?"}`,
  "watch.wake": (p) => `${p.class ?? "?"} frame ${ms(p.frame_age_ms) ?? "?"}${p.suppressed_by && p.suppressed_by !== "none" ? yellow(` suppressed:${p.suppressed_by}`) : ""}`,
  "watch.comment": (p) => `${p.words ?? "?"}w on a ${ms(p.frame_age_ms) ?? "?"} frame`,
  "watch.no_comment": (p) => dim(`${p.reason ?? p.why ?? "?"}`),
  "watch.grounding": (p) =>
    (p.had_frame === false ? red("NO FRAME") : green("frame ok")) +
    ` ${ms(p.frame_age_ms) ?? "?"}, ${p.named_entities ?? 0} entity(ies) named`,
  "err.js": (p) => red(`${oneLine(p.msg, 70)}${p.where ? dim(` @${p.where}`) : ""}`),
  "err.promise": (p) => red(oneLine(p.msg, 70)),
  "err.fetch": (p) => red(`${p.status ?? "?"} ${p.url_path ?? "?"}${p.ms ? ` ${ms(p.ms)}` : ""}`),
  "err.render": (p) => red(`${p.component ?? p.where ?? "?"}`),
};

function generic(p) {
  return Object.entries(p || {})
    .filter(([k]) => k !== "msg_id")
    .slice(0, 8)
    .map(([k, v]) => `${dim(k + "=")}${oneLine(typeof v === "object" ? JSON.stringify(v) : v, 40)}`)
    .join(" ");
}

function describe(row) {
  const p = row.props || {};
  const shaped = SHAPE[row.event]?.(p);
  // a shaped formatter that produced nothing means the props were empty, not
  // that the event is uninteresting — fall through rather than print a blank
  return shaped || generic(p);
}

// ── --session ───────────────────────────────────────────────────────────────
function header(head, rows) {
  if (!head) {
    console.log(yellow(`no meera_tel_session row — showing ${rows.length} raw event(s)\n`));
    return;
  }
  const started = new Date(head.started_at).getTime();
  const ended = head.ended_at ? new Date(head.ended_at).getTime() : null;
  console.log(
    bold(head.session_id) +
      dim("  ·  ") +
      `${head.surface ?? "?"}${head.platform ? `/${head.platform}` : ""}${head.app_version ? ` v${head.app_version}` : ""}` +
      dim("  ·  ") +
      `${stamp(started)}${ended ? ` → ${stamp(ended)}` : ""} (${ended ? dur(ended - started) : "open"})` +
      dim("  ·  ") +
      `${head.events} events` +
      dim(`  ·  device ${head.device_id}`),
  );
  // the rollup counts what ingest accepted; the table is what survived. A gap
  // between them is a purge (forget did its job) or a partial write — either
  // way it is the first thing worth knowing.
  if (rows.length !== head.events) {
    console.log(yellow(`  rollup says ${head.events} events, ${rows.length} are present — purged or partially written`));
  }
  console.log("");
}

async function timeline(sessionId) {
  const { head, rows } = await load(sessionId);
  if (!rows.length && !head) return console.log(yellow(`no such session: ${sessionId}`));
  header(head, rows);

  const said = await resolveSaid(head, rows);
  const showAll = has("--all");
  let hidden = 0;

  for (const r of rows) {
    if (!showAll && NOISY.has(r.event) && !said.has(r.id)) {
      hidden++;
      continue;
    }
    const color = AREA_COLOR[r.area] || ((s) => s);
    console.log(`  ${dim(offset(r.t_ms))}  ${color(pad(r.event, 18))} ${describe(r)}`);
    // compose.draft renders its own text below; the log row it resolves to is
    // the same words a second time
    const s = r.event === "compose.draft" ? null : said.get(r.id);
    if (s) {
      const who = s.role === "her" ? magenta("her") : cyan("me ");
      const mark = s.exact ? " " : dim("~");
      console.log(`             ${mark} ${who} ${bold(oneLine(s.content, 96))}`);
    }
    // draft text is the one content telemetry owns outright — it never
    // reached meera_log, so it can only be shown from here
    if (r.event === "compose.draft" && r.props?.text) {
      console.log(
        `               ${dim(r.props.final ? "draft (sent)" : "draft (abandoned)")} ${bold(oneLine(r.props.text, 96))}`,
      );
    }
  }
  if (hidden) console.log(dim(`\n  ${hidden} sampled event(s) hidden — pass --all`));
  const approx = [...said.values()].filter((s) => !s.exact).length;
  if (approx) {
    console.log(
      dim(
        `  ${approx} transcript line(s) marked ~ are TIME-CORRELATED, not id-matched ` +
          `(meera_log has no msg_id column yet) — treat as likely, not certain`,
      ),
    );
  }
}

// ── --rca ───────────────────────────────────────────────────────────────────
//
// Thresholds, and where each number comes from — a threshold with no source
// becomes folklore and then becomes wrong.
const REPLY_BUDGET_MS = 11_000; // brain.ts TURN_BUDGET_MS: the deadline a turn is built to
const REPLY_SLOW_MS = 6_000; // under budget but visibly slow in a chat
const STALE_FRAME_MS = 4_000; // scene.ts measured wake p90 4200ms; older than this and
//                               the picture she is talking about is not the one on screen
const CLUSTER_MS = 60_000;
const CLUSTER_N = 3;

function findings(head, rows) {
  const out = [];
  const add = (level, t, title, detail, flag) => out.push({ level, t, title, detail, flag });

  // 1. dropped batches. seq is per-session and contiguous by construction, so
  //    a hole is a batch that left the client and never arrived — everything
  //    downstream of that gap is being read with pieces missing, which is the
  //    single most important thing to know before trusting anything else here.
  const seqs = [...new Set(rows.map((r) => r.seq).filter((s) => Number.isFinite(s)))].sort((a, b) => a - b);
  if (seqs.length) {
    if (seqs[0] > 1) add("high", null, "batches missing from the start", `seq begins at ${seqs[0]}, expected 1 — ${seqs[0] - 1} record(s) never arrived`);
    const gaps = [];
    for (let i = 1; i < seqs.length; i++) {
      if (seqs[i] !== seqs[i - 1] + 1) gaps.push(`${seqs[i - 1] + 1}..${seqs[i] - 1}`);
    }
    if (gaps.length) add("high", null, "dropped batch(es)", `seq gap(s): ${gaps.join(", ")} — the timeline below is incomplete there`);
  } else if (rows.length) {
    add("low", null, "no seq on any record", "gap detection is unavailable for this session");
  }

  // 2. the app was not responding to them
  const rage = rows.filter((r) => r.event === "ui.rage_tap");
  for (const r of rage) add("high", r.t_ms, "rage tap", `${r.props?.label ?? r.props?.path ?? "?"} — tapped ${r.props?.count ?? "3+"} times, nothing moved`);
  const deadBy = new Map();
  for (const r of rows.filter((x) => x.event === "ui.dead_tap")) {
    const k = r.props?.label ?? r.props?.path ?? "?";
    if (!deadBy.has(k)) deadBy.set(k, { n: 0, t: r.t_ms });
    deadBy.get(k).n++;
  }
  for (const [k, v] of deadBy) add(v.n >= 3 ? "high" : "med", v.t, "dead tap", `${k} ×${v.n} — tapped, no state change and no navigation within 1s`);

  // 3. the voice-swap class of bug: her voice changing partway through a call
  //    is the thing a user reports as "that wasn't her"
  const calls = [];
  let open = null;
  for (const r of rows) {
    if (r.event === "call.start") open = { start: r.t_ms, id: r.props?.call_id, lanes: new Map() };
    if (open && r.area === "call") {
      const lane = r.props?.lane ?? r.props?.to;
      if (lane) open.lanes.set(String(lane), (open.lanes.get(String(lane)) || 0) + 1);
      if (r.event === "call.lane_change") {
        add("high", r.t_ms, "lane changed mid-call", `${r.props?.from ?? "?"} → ${r.props?.to ?? "?"} (${r.props?.reason ?? "no reason given"}) — her voice changed while she was talking`);
      }
    }
    if (r.event === "call.end" && open) {
      open.end = r.t_ms;
      calls.push(open);
      open = null;
    }
  }
  if (open) calls.push(open);
  for (const call of calls) {
    if (call.lanes.size > 1) {
      add("med", call.start, "more than one lane inside one call", [...call.lanes].map(([l, n]) => `${l}×${n}`).join(", "));
    }
  }

  // 4. THE FABRICATION AUDIT. She commented on a screen without a picture of
  //    it, or with one old enough that the screen had already moved on. This
  //    is the finding that answers "she lied to me" directly.
  for (const r of rows) {
    const p = r.props || {};
    const age = num(p.frame_age_ms);
    if (r.event === "watch.grounding") {
      if (p.had_frame === false) {
        add("high", r.t_ms, "spoke about the screen with no frame", `named ${p.named_entities ?? "?"} entity(ies) with had_frame=false — anything specific she said here was not read off a picture`, "fabrication");
      } else if (age != null && age > STALE_FRAME_MS) {
        add(num(p.named_entities) > 0 ? "high" : "med", r.t_ms, "grounded on a stale frame", `frame was ${age}ms old (>${STALE_FRAME_MS}ms), ${p.named_entities ?? 0} entity(ies) named`, num(p.named_entities) > 0 ? "fabrication" : undefined);
      }
    }
    if (r.event === "watch.comment" && age != null && age > STALE_FRAME_MS) {
      add("med", r.t_ms, "commented on a stale frame", `${p.words ?? "?"} words about a ${age}ms-old frame`);
    }
  }

  // 5. she took too long
  for (const r of rows) {
    if (r.event !== "chat.reply") continue;
    const l = num(r.props?.latency_ms);
    if (l == null) continue;
    if (l > REPLY_BUDGET_MS) add("high", r.t_ms, "reply over budget", `${Math.round(l)}ms > ${REPLY_BUDGET_MS}ms deadline (lane ${r.props?.lane ?? "?"}, model ${r.props?.model ?? "?"})`);
    else if (l > REPLY_SLOW_MS) add("med", r.t_ms, "slow reply", `${Math.round(l)}ms (lane ${r.props?.lane ?? "?"})`);
    if (r.props?.truncated) add("high", r.t_ms, "reply truncated", `lane ${r.props?.lane ?? "?"} — she was cut off mid-answer`);
  }

  // 6. errors, clustered. Three of the same error in a minute is one incident
  //    and reads as one line; three scattered across an hour are three.
  const errs = rows.filter((r) => r.area === "err" || r.event === "chat.error" || r.event === "call.audio_glitch");
  const byKind = new Map();
  for (const r of errs) {
    const k = `${r.event}|${oneLine(r.props?.msg ?? r.props?.stage ?? r.props?.kind ?? r.props?.status ?? "", 50)}`;
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k).push(r);
  }
  for (const [k, group] of byKind) {
    const [event, msg] = k.split("|");
    const times = group.map((g) => g.t_ms).filter(Number.isFinite);
    const span = times.length > 1 ? Math.max(...times) - Math.min(...times) : 0;
    const clustered = group.length >= CLUSTER_N && span <= CLUSTER_MS;
    add(
      clustered || group.length >= CLUSTER_N ? "high" : "med",
      times[0],
      clustered ? "error burst" : group.length > 1 ? "repeated error" : "error",
      `${event}${msg ? ` — ${msg}` : ""} ×${group.length}${group.length > 1 ? ` over ${dur(span)}` : ""}`,
    );
  }

  // 7. they typed something and did not send it. Not a fault, but it is
  //    frequently the answer to "why did they stop talking to her".
  for (const r of rows) {
    if (r.event === "compose.abandon") {
      add("low", r.t_ms, "draft abandoned", `${r.props?.chars ?? "?"} chars typed and cleared after ${dur(num(r.props?.alive_ms))}`);
    }
  }

  const order = { high: 0, med: 1, low: 2 };
  out.sort((a, b) => order[a.level] - order[b.level] || (a.t ?? -1) - (b.t ?? -1));
  return out;
}

async function rca(sessionId) {
  const { head, rows } = await load(sessionId);
  if (!rows.length && !head) return console.log(yellow(`no such session: ${sessionId}`));
  header(head, rows);

  const f = findings(head, rows);
  if (!f.length) {
    console.log(green("  nothing flagged — no dropped batches, no rage/dead taps, no lane changes,"));
    console.log(green("  no ungrounded comments, no replies over budget, no errors."));
    console.log(dim("\n  That is not proof nothing went wrong; it is proof nothing INSTRUMENTED went wrong."));
    return;
  }

  // The question this tool exists to answer fastest is "did she make something
  // up", so if the grounding audit says she did it goes above everything else
  // rather than being found by reading down a sorted list.
  const fab = f.filter((x) => x.flag === "fabrication");
  if (fab.length) {
    console.log(red(bold(`  ⚠ ${fab.length} ungrounded claim(s) — she described the screen without a usable picture of it:`)));
    for (const x of fab) console.log(red(`      at ${offset(x.t).replace(/\s+/g, "")} — ${x.detail}`));
    console.log(dim(`      the words themselves are in the timeline (--session ${sessionId})`));
    console.log("");
  }

  const tag = { high: red("HIGH"), med: yellow("MED "), low: dim("LOW ") };
  let last = "";
  for (const x of f) {
    if (x.level !== last) {
      console.log("");
      last = x.level;
    }
    console.log(`  ${tag[x.level]} ${dim(offset(x.t))}  ${bold(x.title)}`);
    console.log(`               ${x.detail}`);
  }

  const n = (lvl) => f.filter((x) => x.level === lvl).length;
  console.log(
    dim(`\n  ${n("high")} high · ${n("med")} medium · ${n("low")} low   —   ` +
      `node scripts/session.mjs --session ${sessionId} for the full timeline`),
  );
}

// ── entry ───────────────────────────────────────────────────────────────────
const session = arg("--session");
try {
  if (has("--list")) await list();
  else if (session) await (has("--rca") ? rca(session) : timeline(session));
  else {
    console.log(`  node scripts/session.mjs --list [--device X] [--since 24h] [--limit 30]
  node scripts/session.mjs --session <id> [--all]
  node scripts/session.mjs --session <id> --rca`);
    process.exit(1);
  }
} catch (e) {
  console.error(red(`session.mjs: ${e.message}`));
  process.exit(1);
}
