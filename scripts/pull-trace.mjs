// #115 GLITCH TRACE-PULL — pull every diag + turn-trace record for one
// device across one time window, in a single command, chronologically
// merged. Built for the next "it glitched during the call" report: give it
// the device id and roughly when, get back exactly what happened.
//
// Deliberately does NOT add an HTTP read endpoint. api/trace.js's own header
// states the access rule for meera_turn / meera_turn_leg in so many words:
// "There is no GET, no op, no query parameter that returns a row. Reading
// the trace requires the NEON_URL in the gitignored api/_config.js — i.e. an
// operator on their own machine running scripts/trace.mjs." scripts/trace.mjs
// is that path already; this script follows the identical, deliberate
// precedent (`structural-disclosure`: the access rule is an absent code path,
// not a promise) for meera_diag, which had no read path of any kind before
// this file. "keyed on NEON_URL presence server-side, never a new secret"
// (the ticket's own words) is exactly what this is: no auth token, no admin
// endpoint — the only credential is the NEON_URL an operator already has
// locally, same as every other scripts/*.mjs that touches the live DB.
//
// api/diag.js itself is untouched by this ticket — still write-only, same as
// api/trace.js. Its content-free contract (timings/counts/decisions, never
// conversation text) means merging meera_diag alongside meera_turn here adds
// no new disclosure surface beyond what scripts/trace.mjs already prints.
//
//   node scripts/pull-trace.mjs --device <id> --minutes 30
//   node scripts/pull-trace.mjs --device <id> --from <iso> --to <iso>
//   node scripts/pull-trace.mjs --device <id> --minutes 30 --legs   (full leg payloads, not just counts)
import { q } from "../api/_db.js";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d = null) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function stamp(t) {
  return t ? new Date(t).toISOString().replace("T", " ").slice(0, 23) : "—";
}

const device = val("--device");
if (!device) {
  console.error(red("usage: node scripts/pull-trace.mjs --device <id> [--minutes N | --from <iso> --to <iso>] [--legs]"));
  process.exit(1);
}

let from, to;
if (has("--minutes")) {
  const mins = Number(val("--minutes", "30")) || 30;
  to = new Date();
  from = new Date(to.getTime() - mins * 60_000);
} else if (val("--from")) {
  from = new Date(val("--from"));
  to = val("--to") ? new Date(val("--to")) : new Date();
} else {
  // default: last 30 minutes — the common "just reported it, pull now" case
  to = new Date();
  from = new Date(to.getTime() - 30 * 60_000);
}
if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
  console.error(red("bad --from/--to — expected ISO timestamps"));
  process.exit(1);
}

console.log(bold(`\npull-trace: device ${device}`));
console.log(dim(`  window ${stamp(from)} .. ${stamp(to)}\n`));

// ── 1. meera_diag: the call-path audit trail (api/diag.js) ────────────────
const diagRows = await q(
  `select session_id, scope, event, t_ms, detail, at
     from meera_diag
    where device_id = $1 and at >= $2 and at <= $3
    order by at asc, id asc`,
  [device, from.toISOString(), to.toISOString()],
);

// ── 1b. meera_tel: WHERE THE CALL AND WATCH RECORDS ACTUALLY LIVE ────────
//
// WS-WATCHPERF found this the hard way, chasing a screen-share latency report.
// `src/engine/diag.ts` stopped being a transport some time ago — its own
// header says so: "every diag() forwards into telemetry.ts as
// `<scope>.<event>` and there is exactly one buffer, one seq and one clock".
// So every call.* and watch.* record this script was written to fetch has
// been landing in `meera_tel`, and this script has only ever queried
// `meera_diag`, which today receives writes from `api/culture.js` and
// essentially nothing else.
//
// The failure shape is the one docs/TRACE.md opens with — the artefact
// existed and nothing observed it — with the halves swapped: here the READER
// existed and pointed at the wrong table, so "pull the trace for that share"
// returned an empty window and read exactly like a share that produced no
// records at all. Those are opposite bugs and they looked identical.
//
// Both tables are read now rather than one being swapped for the other:
// meera_diag still holds real history, and a reader that silently stops
// covering a table is how this happened in the first place.
const telRows = await q(
  `select session_id, area, event, seq, t_ms, props, at
     from meera_tel
    where device_id = $1 and at >= $2 and at <= $3
    order by at asc, seq asc`,
  [device, from.toISOString(), to.toISOString()],
);

// ── 2. meera_turn: the assembled spine for turns started in this window ───
const turnRows = await q(
  `select turn_id, started_at, ended_at, surface, channel, lane, served_by, model,
          in_chars, out_bubbles, latency_ms, legs, flags
     from meera_turn
    where device_id = $1 and started_at >= $2 and started_at <= $3
    order by started_at asc`,
  [device, from.toISOString(), to.toISOString()],
);

// ── 3. meera_turn_leg: every leg for those turns (or, if none matched by
//    turn window, any leg for the device directly in the window — a leg can
//    land a few ms after its turn's started_at bucket) ────────────────────
const turnIds = turnRows.map((t) => t.turn_id);
const legRows = turnIds.length
  ? await q(
      `select turn_id, leg, seq, t_ms, payload, at
         from meera_turn_leg
        where turn_id = any($1)
        order by at asc, id asc`,
      [turnIds],
    )
  : await q(
      `select turn_id, leg, seq, t_ms, payload, at
         from meera_turn_leg
        where device_id = $1 and at >= $2 and at <= $3
        order by at asc, id asc`,
      [device, from.toISOString(), to.toISOString()],
    );

if (!diagRows.length && !telRows.length && !turnRows.length && !legRows.length) {
  console.log(yellow("nothing found for this device in this window — check the device id and widen --minutes"));
  process.exit(0);
}

// ── merged chronological timeline ──────────────────────────────────────────
const timeline = [
  ...diagRows.map((r) => ({ at: new Date(r.at), kind: "diag", row: r })),
  ...telRows.map((r) => ({ at: new Date(r.at), kind: "tel", row: r })),
  ...turnRows.map((r) => ({ at: new Date(r.started_at), kind: "turn-start", row: r })),
  ...legRows.map((r) => ({ at: new Date(r.at), kind: "leg", row: r })),
];
timeline.sort((a, b) => a.at - b.at);

console.log(bold(`── timeline (${timeline.length} record(s)) ──`));
for (const item of timeline) {
  if (item.kind === "diag") {
    const r = item.row;
    console.log(
      `  ${stamp(item.at)}  ${cyan("diag ")} ${String(r.event).padEnd(24)} ` +
        `${r.scope ? dim("[" + r.scope + "] ") : ""}` +
        `${Number.isFinite(r.t_ms) ? dim(`+${r.t_ms}ms `) : ""}` +
        (r.detail && Object.keys(r.detail).length ? JSON.stringify(r.detail) : ""),
    );
  } else if (item.kind === "tel") {
    const r = item.row;
    console.log(
      `  ${stamp(item.at)}  ${cyan("tel  ")} ${String(r.event).padEnd(24)} ` +
        `${r.area ? dim("[" + r.area + "] ") : ""}` +
        `${Number.isFinite(r.t_ms) ? dim(`+${r.t_ms}ms `) : ""}` +
        (r.props && Object.keys(r.props).length ? JSON.stringify(r.props) : ""),
    );
  } else if (item.kind === "turn-start") {
    const r = item.row;
    const flags = Object.keys(r.flags || {});
    console.log(
      `  ${stamp(item.at)}  ${bold("TURN ")} ${r.turn_id}  ${r.surface ?? "?"}/${r.channel ?? "?"}  ` +
        `served_by=${r.served_by ?? r.lane ?? "—"}  in=${r.in_chars ?? "—"}ch out=${r.out_bubbles ?? "—"}bub  ` +
        `lat=${r.latency_ms ?? "—"}ms  legs=${r.legs ?? "—"}` +
        (flags.length ? "  " + red("FLAGS " + flags.join(",")) : ""),
    );
  } else {
    const r = item.row;
    const payload = has("--legs") ? JSON.stringify(r.payload) : `${Object.keys(r.payload || {}).length} field(s)`;
    console.log(`  ${stamp(item.at)}    ${dim("leg  ")} ${r.turn_id}  #${r.seq ?? "—"} ${r.leg.padEnd(12)} ${payload}`);
  }
}

// ── WS-WATCHPERF: the screen-share latency budget, per share ──────────────
// The timeline above is every record; this is the one question the owner
// actually asked, answered. Everything here is derived from records that were
// already printed — nothing is fetched twice and nothing is inferred that the
// stream does not say.
//
// The legs, in the order they happen:
//   encode_ms   capture -> base64 in hand (native: on the encoder thread)
//   frame       whether the socket TOOK it, and if not, which gate refused
//   wake        the geometry asked her to look, and whether that went out
//   reaction    wake -> her voice actually starts
//
// A `wake` with `sent:false` and a `frame` with `delivered:false` next to each
// other is the failure WatchPacer was written for, and it will say so here
// rather than being reconstructed from source a year from now.
const watchEvents = telRows.filter((r) => String(r.event || "").startsWith("watch."));
if (watchEvents.length) {
  const byShare = new Map();
  for (const r of watchEvents) {
    const id = (r.props && (r.props.watch_id || r.props.watch_id_)) || "(no watch_id)";
    if (!byShare.has(id)) byShare.set(id, []);
    byShare.get(id).push(r);
  }
  console.log(bold(`\n── screen-share latency (${byShare.size} share(s)) ──`));
  // NOT named `q`: that is the imported Neon query function, and shadowing it
  // inside a block that happens to make no query is a trap for the next edit.
  const pct = (xs, p) => {
    if (!xs.length) return null;
    const s = [...xs].sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(s.length * p))];
  };
  for (const [id, rs] of byShare) {
    const ev = (name) => rs.filter((r) => r.event === name).map((r) => r.props || {});
    const frames = ev("watch.frame");
    const wakes = ev("watch.wake");
    const reactions = ev("watch.reaction");
    const lane = (rs.find((r) => r.props?.lane) || {}).props?.lane ?? "?";
    // "sent" is the web lane's field name, "delivered" the native one — both
    // mean the socket took it, and a summary that knew only one of them would
    // report the other lane as perfect.
    const took = (f) => (f.delivered ?? f.sent) === true;
    const refusedFrames = frames.filter((f) => !took(f));
    const lostWakes = wakes.filter((w) => w.sent === false || w.suppressed_by === "stale_frame");
    const encodeMs = frames.map((f) => Number(f.encode_ms)).filter(Number.isFinite);
    const reactMs = reactions.map((r) => Number(r.ms)).filter(Number.isFinite);
    const frameAges = wakes.map((w) => Number(w.frame_age_ms)).filter((v) => Number.isFinite(v) && v >= 0);
    console.log(`\n  ${bold(id)}  lane=${lane}`);
    console.log(
      `    frames: ${frames.length} recorded, ${red(String(refusedFrames.length))} refused` +
        (refusedFrames.length
          ? dim(
              "  by " +
                [...new Set(refusedFrames.map((f) => f.refused_by || "?"))].join("/"),
            )
          : ""),
    );
    if (encodeMs.length)
      console.log(`    encode_ms: p50 ${pct(encodeMs, 0.5)}  p90 ${pct(encodeMs, 0.9)}  max ${Math.max(...encodeMs)}`);
    console.log(
      `    wakes: ${wakes.length}` +
        (lostWakes.length ? `  ${red(lostWakes.length + " never went out")}` : "") +
        dim(
          "  classes " +
            [...new Set(wakes.map((w) => w.class ?? w.cls ?? "?"))].join(","),
        ),
    );
    if (frameAges.length)
      console.log(`    frame age at wake: p50 ${pct(frameAges, 0.5)}ms  p90 ${pct(frameAges, 0.9)}ms`);
    if (reactMs.length)
      console.log(
        `    ${bold("wake -> her voice")}: p50 ${pct(reactMs, 0.5)}ms  p90 ${pct(reactMs, 0.9)}ms  (n=${reactMs.length})`,
      );
    else
      console.log(
        yellow(
          "    wake -> her voice: no reaction records. Either she never spoke, or an\n" +
            "    older shell without the WS-WATCHPERF instrumentation produced this share.",
        ),
      );
    const media = ev("watch.media_audio");
    if (media.length)
      console.log(`    device audio: ${media.map((x) => (x.on ? "on" : "off")).join(" -> ")}`);
  }
}

console.log(
  bold(
    `\n${diagRows.length} diag record(s), ${telRows.length} tel record(s), ` +
      `${turnRows.length} turn(s), ${legRows.length} leg(s).`,
  ),
);
if (turnRows.length && !has("--legs")) {
  console.log(dim("re-run with --legs for full leg payloads, or scripts/trace.mjs --turn <id> --content for one turn in full."));
}
