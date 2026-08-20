// The turn trace, client half — docs/TRACE.md.
//
// One conversational turn is the unit. This module mints its id, collects a
// leg from every layer that touches it, and posts the whole thing to
// /api/trace long after the reply has already landed on screen.
//
// ── why this is not just more telemetry ───────────────────────────────────
//
// telemetry.ts records EVENTS, ordered by seq inside a session. That answers
// "what happened, in what order". It cannot answer "what did she have in front
// of her when she said that", because nothing ties a compile to the retrieval
// that fed it, to the model that served it, to the row that stored it. Four
// bugs in one session were invisible for exactly that reason (docs/TRACE.md
// §0). The trace adds one thing telemetry does not have: a TURN ID that the
// client, the recall endpoint and the model proxy all name.
//
// ── the three rules, inherited and one added ──────────────────────────────
//
//  1. NEVER BLOCKS. Buffered in memory, flushed on a timer / at turn close /
//     at pagehide, fire-and-forget. `live-floor` is 1.4-1.5s and api/chat.js
//     has a 720ms text floor; nothing here is ever awaited by either.
//  2. NEVER STORES CONTENT. Lengths, counts, ids, hashes, timings, decisions.
//     Conversation lives in meera_log and is referenced by row id. The server
//     sanitiser (api/_trace.js) enforces this structurally as well, so a
//     mistake here is caught there rather than stored.
//  3. A FAILURE TO TRACE IS NEVER A FAILURE OF THE APP. Everything is caught.
//  4. NEW: NOTHING READS IT BACK. There is no getter that returns a stored
//     turn, no endpoint that serves one, and no path from this module into a
//     prompt. inner.ts G1 (her interior never reads the user) and G4 (her
//     interior has no UI) both depend on that staying true.
//
// ── how it is wired today, and the one seam that is not ───────────────────
//
// The client legs are derived from the diag()/tel() events brain.ts and
// Chat.tsx ALREADY emit, via a tap installed on telemetry.ts's tel(). That is
// deliberate: brain.ts belongs to another workstream this cycle, and a trace
// that required editing it would be a trace that did not exist yet. The tap
// costs one function call per telemetry event and adds no network traffic of
// its own.
//
// Two fields cannot be recovered that way and need the hook documented in the
// WS-TRACE report:
//   - per-slot `sections` on turns where core_hash did NOT change (brain.ts
//     throttles the full compile.manifest record to core-hash changes, so they
//     arrive on the first turn of every app run and after every deploy, and
//     not in between);
//   - the model leg api/chat.js now returns (`served_by`, token counts,
//     fallbacks and WHY each fired), which needs a caller to read the response
//     field and hand it to traceServer().
//
// Both are additive. Until they land the turn is still reconstructible, just
// with those two fields absent rather than wrong — which is the distinction
// `manifest-sourcestatus` is named for.

import { Capacitor } from "@capacitor/core";
import { setTelTap, telDevice, telSession } from "./telemetry";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
const ENDPOINT = `${BASE}/api/trace`;

const FLUSH_MS = 5_000;
const MAX_LEGS = 40;
// A turn that never closes must still reach the database — a crash between
// send and reply is precisely the turn someone asks about.
const TURN_MAX_MS = 120_000;
// Bounded, and dropping the OLDEST keeps the newest context. No IndexedDB
// mirror here on purpose: telemetry.ts already owns the offline queue, and a
// second one would be a second thing to keep correct for a record that is
// diagnostic rather than product state. The drop is counted, never silent.
const BUFFER_MAX = 400;

export type TraceChannel = "chat" | "call" | "watch";

export interface TraceSpinePatch {
  turn_id?: string;
  device_id?: string;
  person_id?: string | null;
  session_id?: string | null;
  surface?: string;
  channel?: string;
  lane?: string;
  started_at?: number;
  ended_at?: number;
  in_msg_id?: string;
  in_log_id?: number;
  out_msg_id?: string;
  out_log_ids?: number[];
  in_kind?: string;
  in_chars?: number;
  out_bubbles?: number;
  out_chars?: number;
  core_hash?: string;
  manifest_hash?: string;
  core_bytes?: number;
  tail_bytes?: number;
  sections?: Record<string, number>;
  dropped?: Array<Record<string, unknown>>;
  recall_bytes?: number;
  retrieval?: Record<string, unknown>;
  model?: string;
  served_by?: string;
  latency_ms?: number;
  tokens_in?: number;
  tokens_out?: number;
  tokens_cached?: number;
  retries?: number;
  fallbacks?: Array<Record<string, unknown>>;
}

interface TraceLegRow {
  turn_id: string;
  leg: string;
  seq: number;
  t_ms: number;
  at: number;
  payload: Record<string, unknown>;
}

interface TurnCtx {
  id: string;
  channel: TraceChannel;
  t0: number;
  seq: number;
  timer: ReturnType<typeof setTimeout> | null;
}

let enabled = true;
let installed = false;
let device = "";
let surface = "web";
let dropped = 0;

const legs: TraceLegRow[] = [];
const spines = new Map<string, TraceSpinePatch>();
const open: Partial<Record<TraceChannel, TurnCtx>> = {};
let timer: ReturnType<typeof setTimeout> | null = null;

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
const rand = () => Math.random().toString(36).slice(2, 8);

/** Who this device is. Late-bound: listeners boot before React state exists. */
export function traceIdentify(deviceId: string, surfaceName?: string) {
  if (deviceId) device = deviceId;
  if (surfaceName) surface = surfaceName;
}

export function traceEnabled(on: boolean) {
  enabled = on;
}

/** The open turn id for a channel, or "" — what memory.ts threads into recall. */
export function traceTurnId(channel: TraceChannel = "chat"): string {
  return open[channel]?.id || "";
}

/**
 * Open a turn. Idempotent per channel: a second open closes the first, because
 * a turn that never closed is a turn whose reply never arrived, and that is a
 * fact worth storing rather than a state to reconcile.
 */
export function traceOpen(channel: TraceChannel, patch: TraceSpinePatch = {}): string {
  if (!enabled) return "";
  try {
    if (open[channel]) traceClose(channel, { ended_at: Date.now() });
    // `t-` prefixed so a turn id is recognisable in a log line, base36 time so
    // it sorts, six random chars so two devices in the same millisecond cannot
    // collide. Matches api/_trace.js TURN_ID_RE.
    const id = `t-${Date.now().toString(36)}-${rand()}`;
    const ctx: TurnCtx = {
      id,
      channel,
      t0: now(),
      seq: 0,
      timer: setTimeout(() => traceClose(channel, { ended_at: Date.now() }), TURN_MAX_MS),
    };
    open[channel] = ctx;
    tracePatch(channel, {
      started_at: Date.now(),
      surface,
      channel,
      session_id: telSession() || null,
      ...patch,
    });
    return id;
  } catch {
    return "";
  }
}

/** Merge fields into the open turn's spine row. Later, better-informed wins. */
export function tracePatch(channel: TraceChannel, patch: TraceSpinePatch) {
  if (!enabled) return;
  try {
    const ctx = open[channel];
    if (!ctx) return;
    const cur = spines.get(ctx.id) || { turn_id: ctx.id };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined || v === null) continue;
      if (k === "sections" || k === "retrieval") {
        (cur as Record<string, unknown>)[k] = {
          ...((cur as Record<string, Record<string, unknown>>)[k] || {}),
          ...(v as Record<string, unknown>),
        };
      } else {
        (cur as Record<string, unknown>)[k] = v;
      }
    }
    cur.device_id = cur.device_id || device;
    spines.set(ctx.id, cur);
  } catch {
    /* tracing must never break the app */
  }
}

/** Record one leg of the funnel against the open turn. */
export function traceLeg(channel: TraceChannel, leg: string, payload: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    const ctx = open[channel];
    if (!ctx) return;
    if (legs.length >= BUFFER_MAX) {
      legs.shift();
      dropped++;
    }
    legs.push({
      turn_id: ctx.id,
      leg,
      seq: ++ctx.seq,
      t_ms: Math.round(now() - ctx.t0),
      at: Date.now(),
      payload,
    });
    arm();
    if (legs.length >= MAX_LEGS) traceFlush();
  } catch {
    /* never */
  }
}

/**
 * Close a turn and flush it. Flushing at close rather than only on the timer is
 * what keeps a turn's legs in ONE batch, which is what lets api/_trace.js
 * derive its flags from everything known about the turn at once instead of from
 * whichever half arrived first.
 */
export function traceClose(channel: TraceChannel, patch: TraceSpinePatch = {}) {
  if (!enabled) return;
  try {
    const ctx = open[channel];
    if (!ctx) return;
    tracePatch(channel, { ended_at: Date.now(), ...patch });
    if (ctx.timer) clearTimeout(ctx.timer);
    delete open[channel];
    traceFlush();
  } catch {
    /* never */
  }
}

/**
 * Fold a server-returned trace block into the open turn.
 *
 * The server legs ride the response they were ALREADY sending — op:"recall"
 * returns `trace`, /api/chat returns `trace` — so a server leg costs a few
 * hundred bytes on a body in flight and zero extra round trips. That is the
 * whole reason no leg is ever written from a request path: there is nothing to
 * write, only something to carry home.
 */
export function traceServer(channel: TraceChannel, leg: string, block: unknown) {
  if (!enabled || !block || typeof block !== "object") return;
  try {
    const b = block as Record<string, unknown>;
    traceLeg(channel, leg, b);
    const patch: TraceSpinePatch = {};
    if (typeof b.person_id === "string") patch.person_id = b.person_id;
    if (typeof b.memories_bytes === "number") patch.recall_bytes = b.memories_bytes;
    if (typeof b.served_by === "string") patch.served_by = b.served_by;
    if (typeof b.model === "string") patch.model = b.model;
    if (typeof b.ms === "number") patch.latency_ms = b.ms;
    if (typeof b.tokens_in === "number") patch.tokens_in = b.tokens_in;
    if (typeof b.tokens_out === "number") patch.tokens_out = b.tokens_out;
    if (typeof b.tokens_cached === "number") patch.tokens_cached = b.tokens_cached;
    if (Array.isArray(b.fallbacks)) patch.fallbacks = b.fallbacks as Array<Record<string, unknown>>;
    if (leg === "retrieval") patch.retrieval = summariseRetrieval(b);
    if (Object.keys(patch).length) tracePatch(channel, patch);
  } catch {
    /* never */
  }
}

// ── the brain.ts hook ─────────────────────────────────────────────────────
//
// brain.ts belongs to another workstream this cycle, so these three functions
// are the seam rather than the edit. They are NOT a dead interface: the eval
// suite drives them (evals/trace/run.mjs section F) and the live round trip
// stores what they produce (evals/trace/roundtrip.mjs), so the only thing
// missing is the three call sites. Written here rather than described in a
// report so the diff is a paste, not a translation.
//
//   1. proxyThink's request body — carry the turn id up:
//        body: JSON.stringify({ system, ..., ...traceRequestFields(mode) })
//
//   2. proxyThink's non-streaming return — fold the model leg back:
//        const data = await res.json();
//        traceModelResponse(mode, data);                    // <- this line
//        return typeof data?.text === "string" && ... ;
//
//   3. proxyThink's SSE loop — the same, off the trailing frame:
//        const j = JSON.parse(payload);
//        if (traceModelResponse(mode, j)) continue;         // <- this line
//        const delta = j?.choices?.[0]?.delta?.content;
//
// And one edit that is not a call at all: brain.ts's `compile.manifest` diag
// emits `sections` ONLY when core_hash changed. Per-slot bytes are the highest-
// value field in the whole record (they are what makes a slot that renders
// nothing distinguishable from a slot that is switched off), they are ~200
// bytes, and the throttle was sized for a different consumer. Emit them every
// turn: move `sections` out of the `...(coreChanged ? {...} : {})` spread.

/** Turn a brain.ts ThinkMode into a trace channel. */
export function traceChannelFor(mode: string): TraceChannel {
  return mode === "call" ? "call" : "chat";
}

/**
 * Fields to merge into a /api/chat request body so the proxy can name the turn.
 * Empty when no turn is open — the server then omits its leg entirely rather
 * than inventing a turn to hang it on.
 */
export function traceRequestFields(mode: string): { turn_id?: string; lane?: string } {
  const ch = traceChannelFor(mode);
  const id = traceTurnId(ch);
  return id ? { turn_id: id, lane: "proxy" } : {};
}

/**
 * Fold /api/chat's returned model leg into the open turn.
 *
 * Accepts either shape: the non-streaming body's `trace`, or a streamed frame's
 * `meera_trace`. Returns true when the argument WAS a trace frame and nothing
 * else — which is what lets the SSE loop `continue` past it in one line.
 */
export function traceModelResponse(mode: string, payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  const block = p.meera_trace ?? p.trace;
  if (!block || typeof block !== "object") return false;
  traceServer(traceChannelFor(mode), "model", block);
  // a `meera_trace` frame carries nothing else; a `trace` field rides a real
  // response body that the caller still has to read
  return p.meera_trace !== undefined;
}

/** The spine's copy of the retrieval leg: counts and presence, never the ids —
 *  the ids stay in the leg, where a reader who wants them goes looking. */
function summariseRetrieval(b: Record<string, unknown>): Record<string, unknown> {
  const n = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const kw = (b.keyword || {}) as Record<string, unknown>;
  const sem = (b.semantic || {}) as Record<string, unknown>;
  const rel = (b.relbundle || {}) as Record<string, unknown>;
  const self = (b.selfbundle || {}) as Record<string, unknown>;
  return {
    attempted: true,
    matched_n: n(kw.matched_ids),
    background_n: n(kw.background_ids),
    semantic_n: n(sem.fact_ids),
    observations_n: n((b.observations as Record<string, unknown> | undefined)?.ids),
    relbundle: rel.present === true,
    selfbundle: self.present === true,
    ms: typeof b.ms_total === "number" ? b.ms_total : null,
  };
}

// ── transport ─────────────────────────────────────────────────────────────

function arm() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    traceFlush();
  }, FLUSH_MS);
}

/** Push what's buffered. Safe at any time; never awaited by anything. */
export function traceFlush(mode: "normal" | "beacon" = "normal") {
  if (!enabled) return;
  try {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    // Identity is late-bound: the device id lives in React state and the
    // listeners boot before App mounts. telemetry.ts already resolves it, so
    // this reads that rather than keeping a second copy that can disagree.
    if (!device) device = telDevice();
    if (!device) return; // nothing can be attributed yet — hold, don't guess
    // Only turns that are CLOSED, or that have legs waiting, are sent. An open
    // turn with nothing recorded is not a turn yet.
    const sendTurns: TraceSpinePatch[] = [];
    const openIds = new Set(Object.values(open).map((c) => c!.id));
    for (const [id, patch] of spines) {
      const hasLegs = legs.some((l) => l.turn_id === id);
      if (openIds.has(id) && !hasLegs) continue;
      sendTurns.push({ ...patch, turn_id: id, device_id: patch.device_id || device });
      if (!openIds.has(id)) spines.delete(id);
    }
    const sendLegs = legs.splice(0, legs.length);
    if (!sendTurns.length && !sendLegs.length) return;
    const body = JSON.stringify({
      device,
      session: telSession() || null,
      surface,
      dropped,
      turns: sendTurns,
      legs: sendLegs,
    });
    dropped = 0;
    post(body, mode);
  } catch {
    /* never */
  }
}

function post(body: string, mode: "normal" | "beacon") {
  try {
    // pagehide/visibilitychange: sendBeacon is the only transport the browser
    // guarantees will survive the page going away, and it cannot send
    // application/json without a preflight it structurally cannot wait for —
    // api/trace.js accepts text/plain for exactly this reason.
    if (mode === "beacon" && typeof navigator !== "undefined" && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "text/plain" }));
      return;
    }
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: body.length < 60_000,
    }).catch(() => {});
  } catch {
    /* never */
  }
}

// ── the correlator ────────────────────────────────────────────────────────
//
// Derives the client legs from events that already exist. Every branch below
// names an event brain.ts or Chat.tsx or useCallEngine.ts emits TODAY; nothing
// here asks any of them to change.
//
// Reading tel() rather than diag(): diag() forwards INTO tel(), so one tap
// catches both, and it also catches the events Chat.tsx sends directly (send,
// reply, error, media) which diag() never sees. It also means src/engine/diag.ts
// is untouched, which is what keeps evals/echosim's standalone transpile of
// liveCall.ts byte-identical — that transpile is the only proof the audio floor
// did not move, and it rewrites a fixed list of emitted files.

function onTel(event: string, props: Record<string, unknown>) {
  if (!enabled) return;
  try {
    const p = props || {};
    switch (event) {
      case "app.start":
        if (typeof p.platform === "string") surface = p.platform === "web" ? "web" : String(p.platform);
        return;

      // ── ingress ──
      case "chat.send":
        traceOpen("chat", {
          in_msg_id: typeof p.msg_id === "string" ? p.msg_id : undefined,
          in_kind: typeof p.kind === "string" ? p.kind : "text",
          in_chars: typeof p.chars === "number" ? p.chars : undefined,
          lane: "proxy",
        });
        traceLeg("chat", "ingress", {
          kind: p.kind,
          chars: p.chars,
          quoted: p.quoted,
          msg_id: p.msg_id,
          surface,
        });
        return;

      // ── interior (inner.ts, under the G1-G8 charter: SHAPE ONLY) ──
      case "chat.inner_tail":
        traceLeg("chat", "interior", {
          // brain.ts reports the RENDERED byte lengths of her thread and her
          // wants, not their text — which is exactly the shape the charter
          // permits: G6 says the code decides only whether a line is present.
          thread_bytes: p.thread,
          wants_bytes: p.wants,
          tail_bytes: p.tail,
          over: p.over,
        });
        return;

      // ── assembly: the highest-value leg ──
      case "chat.compile.manifest": {
        const sections = (p.sections && typeof p.sections === "object" ? p.sections : null) as
          | Record<string, number>
          | null;
        traceLeg("chat", "assembly", {
          core_hash: p.core_hash,
          manifest_hash: p.manifest_hash,
          core_changed: p.core_changed,
          core_bytes: p.core_bytes,
          tail_bytes: p.tail_bytes,
          medium: p.medium,
          model: p.model,
          adapter_version: p.adapter_version,
          ...(sections ? { sections, zero_slots: Object.keys(sections).filter((k) => !sections[k]) } : {}),
        });
        tracePatch("chat", {
          core_hash: typeof p.core_hash === "string" ? p.core_hash : undefined,
          manifest_hash: typeof p.manifest_hash === "string" ? p.manifest_hash : undefined,
          core_bytes: typeof p.core_bytes === "number" ? p.core_bytes : undefined,
          tail_bytes: typeof p.tail_bytes === "number" ? p.tail_bytes : undefined,
          model: typeof p.model === "string" ? p.model : undefined,
          ...(sections ? { sections } : {}),
        });
        return;
      }

      case "chat.route.decision":
        traceLeg("chat", "route", { ...p });
        tracePatch("chat", { model: typeof p.model === "string" ? p.model : undefined });
        return;

      // ── the lookup round trip ──
      case "chat.search_fire":
      case "chat.search_done":
      case "chat.search_pass2":
      case "chat.search_silence_saved":
        traceLeg("chat", event.replace("chat.", ""), { ...p });
        return;

      case "chat.forget_fire":
        traceLeg("chat", "forget", { ...p });
        return;

      // ── egress, and the close ──
      case "chat.reply":
        traceLeg("chat", "egress", {
          bubbles_n: p.bubbles,
          kind: p.kind,
          lane_requested: p.lane,
          latency_ms: p.latency_ms,
          critical: p.critical,
          searched: p.searched,
          forgot: p.forgot,
          msg_id: p.msg_id,
        });
        traceClose("chat", {
          out_msg_id: typeof p.msg_id === "string" ? p.msg_id : undefined,
          out_bubbles: typeof p.bubbles === "number" ? p.bubbles : undefined,
          latency_ms: typeof p.latency_ms === "number" && p.latency_ms >= 0 ? p.latency_ms : undefined,
          lane: typeof p.lane === "string" ? p.lane : undefined,
        });
        return;

      case "chat.error":
        traceLeg("chat", "error", { ...p });
        traceClose("chat", { out_bubbles: 0 });
        return;

      // ── the call lane. A spoken round is one turn: THEY speak, she answers. ──
      case "call.turn":
        if (p.who === "them") {
          traceOpen("call", {
            channel: "call",
            lane: typeof p.lane === "string" ? p.lane : undefined,
            in_kind: "speech",
          });
          traceLeg("call", "ingress", { words: p.words, lane: p.lane, call_id: p.call_id });
        } else {
          traceLeg("call", "egress", { words: p.words, lane: p.lane, call_id: p.call_id });
          traceClose("call", { lane: typeof p.lane === "string" ? p.lane : undefined });
        }
        return;

      case "err.fetch":
        // attach to whichever turn is open — an upstream failure with no turn
        // around it is what made `startup-failure-is-invisible` invisible
        for (const ch of ["chat", "call"] as TraceChannel[]) {
          if (open[ch]) traceLeg(ch, "error", { ...p });
        }
        return;

      default:
        // watch.* rides the call turn it happened inside, unchanged
        if (event.startsWith("watch.") && open.call) traceLeg("call", event.replace(".", "_"), { ...p });
        return;
    }
  } catch {
    /* never */
  }
}

/**
 * Install the correlator and the lifecycle flushes. Idempotent.
 *
 * Called once from src/main.tsx, beside installTelemetry().
 */
export function installTrace(deviceId = "", surfaceName = "web") {
  if (installed) return;
  installed = true;
  if (deviceId) device = deviceId;
  if (surfaceName) surface = surfaceName;
  setTelTap(onTel);
  if (typeof document !== "undefined") {
    // the last batch of a session is the one someone asks about
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") traceFlush("beacon");
    });
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pagehide", () => traceFlush("beacon"));
  }
}
