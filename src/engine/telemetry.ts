// Telemetry capture — the client half of docs/TELEMETRY.md.
//
// This is diag.ts's successor for BREADTH, and it keeps diag's discipline
// unchanged: it never blocks, never awaits on a hot path, never throws out of
// a call site, and a failure to record is never a failure of the app.
//
// Four things in here are mechanism rather than taste, and each has cost a bug
// somewhere:
//
//  - `seq` is a per-session counter with no gaps. A hole in it is the ONLY
//    way a consumer can tell "nothing happened" from "a batch was lost", so
//    every drop path below increments seq anyway and lets the hole show.
//  - `t_ms` comes from performance.now(). Wall clock jumps (NTP, timezone,
//    the OS suspending a backgrounded WebView) and a timeline sorted on it
//    reorders itself; both are stored, only t_ms is orderable.
//  - Content lives in exactly one place. Sent messages are already in
//    meera_log and are referenced here by msg_id only. The single exception
//    is draft text (compose.draft), which exists nowhere else.
//  - A ui.tap label is NEVER element text. Message bubbles carry conversation
//    content in their own accessible name (Chat.tsx builds it from m.text),
//    so "use the accessible name" is not safe by itself — the thread is
//    marked data-tel-private and every control that matters carries an
//    explicit data-tel.
//
// The offline queue exists because the session someone asks about later is
// almost always the one that happened on a train.

import { Capacitor } from "@capacitor/core";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";
const ENDPOINT = `${BASE}/api/telemetry`;

const FLUSH_MS = 4000;
const MAX_BATCH = 60;
// records held before a device id exists (boot listeners fire before App
// mounts). Bounded, and dropping the OLDEST keeps the newest context — the
// seq holes it leaves are the point, not a defect.
const MAX_HOLD = 300;
const QUEUE_MAX_RECORDS = 2000;
const QUEUE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
// per-value ceiling. Deliberately generous for compose.draft (the one event
// allowed to carry text) and tight enough that a runaway string cannot become
// the payload.
const MAX_STR = 2000;

export interface TelRecord {
  seq: number;
  t_ms: number;
  at: number;
  area: string;
  event: string;
  props: Record<string, unknown>;
}

interface TelBatch {
  device: string;
  user_id: string | null;
  session: string;
  surface: string;
  records: TelRecord[];
}

let sessionId = "";
let surface = "app";
let t0 = 0;
let seq = 0;
let device = "";
let userId: string | null = null;
let buffer: TelRecord[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let enabled = true;
let installed = false;

const now = () =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

const rand = () => Math.random().toString(36).slice(2, 8);

/** Open the app session. Idempotent — a second call is ignored. */
export function telStart(surfaceName = "app", deviceId = "") {
  if (sessionId) return sessionId;
  surface = surfaceName;
  t0 = now();
  seq = 0;
  sessionId = `${surfaceName}-${Date.now().toString(36)}-${rand()}`;
  if (deviceId) device = deviceId;
  return sessionId;
}

/** Late-bound identity: the device id lives in React state, the listeners do not. */
export function telIdentify(deviceId: string, user?: string | null) {
  if (deviceId && deviceId !== device) device = deviceId;
  userId = user ?? userId ?? null;
  if (buffer.length) telFlush();
  void queueDrain();
}

export function telSession() {
  return sessionId;
}

export function telEnabled(on: boolean) {
  enabled = on;
}

/** A nested id for a call or a watch session — a filter over one app session,
 *  never a stream of its own (docs/TELEMETRY.md, "Identity and sessions"). */
export function telSubId(kind: string) {
  return `${kind}-${Date.now().toString(36)}-${rand()}`;
}

// shallow, allocation-light. A deep walk or a JSON.stringify per record (what
// diag.ts does) is real work on a path that runs per keystroke elsewhere.
function clip(props: Record<string, unknown>): Record<string, unknown> {
  for (const k in props) {
    const v = props[k];
    if (typeof v === "string" && v.length > MAX_STR) props[k] = v.slice(0, MAX_STR);
  }
  return props;
}

/** Record one event. Never throws, never awaits, never blocks the caller. */
export function tel(event: string, props: Record<string, unknown> = {}) {
  if (!enabled) return;
  try {
    if (!sessionId) telStart(surface);
    const dot = event.indexOf(".");
    buffer.push({
      seq: ++seq,
      t_ms: Math.round(now() - t0),
      at: Date.now(),
      area: dot > 0 ? event.slice(0, dot) : "app",
      event,
      props: clip(props),
    });
    if (!device) {
      // nowhere to send it yet. Hold a bounded tail rather than retaining
      // everything AND attempting a flush per event — that combination is
      // the bug diag.ts carries a comment about.
      if (buffer.length > MAX_HOLD) buffer.splice(0, buffer.length - MAX_HOLD);
      return;
    }
    // an error is the record most likely to be followed by the page dying
    if (buffer.length >= MAX_BATCH || event.startsWith("err.")) telFlush();
    else if (!timer) timer = setTimeout(telFlush, FLUSH_MS);
  } catch {
    /* telemetry must never surface as a product failure */
  }
}

/** Push what's buffered. `beacon` for the page going away. */
export function telFlush(mode: "normal" | "beacon" = "normal") {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (!buffer.length || !device) return;
  const records = buffer;
  buffer = [];
  send({ device, user_id: userId, session: sessionId, surface, records }, mode);
}

function send(batch: TelBatch, mode: "normal" | "beacon") {
  let body: string;
  try {
    body = JSON.stringify(batch);
  } catch {
    return; // unserializable payload: drop it, never retry it
  }
  if (mode === "beacon" && typeof navigator !== "undefined" && navigator.sendBeacon) {
    try {
      // the page is going away: a beacon survives it, a fetch may not.
      if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }))) return;
    } catch {
      /* fall through to keepalive fetch */
    }
  }
  try {
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    })
      .then((r) => {
        // 4xx means the batch is malformed — retrying it forever would poison
        // the queue with a payload that can never land. 5xx and network
        // failures are the server's problem and are worth keeping.
        if (r.ok) void queueDrain();
        else if (r.status >= 500) void queuePut(batch);
      })
      .catch(() => {
        void queuePut(batch);
      });
  } catch {
    void queuePut(batch);
  }
}

// ── offline queue (IndexedDB) ─────────────────────────────────────────────
// A flight-mode session must not vanish; that is exactly the session someone
// asks about later. Capped at 2000 records / 24h so a device that is offline
// for a week does not carry a week of dead weight.

const DB_NAME = "meera_tel";
const STORE = "q";
let dbPromise: Promise<IDBDatabase | null> | null = null;
let draining = false;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE))
          db.createObjectStore(STORE, { keyPath: "k", autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      // private-mode Safari can hang the open forever rather than erroring
      setTimeout(() => resolve(null), 3000);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function queuePut(batch: TelBatch) {
  try {
    const db = await openDb();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).add({ at: Date.now(), n: batch.records.length, batch });
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    });
    await queueTrim();
  } catch {
    /* the queue is best-effort by definition */
  }
}

// oldest-first eviction against BOTH caps. Runs after a put, never on a hot
// path, and a failure here just means the caps are enforced next time.
async function queueTrim() {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const rows: { k: IDBValidKey; at: number; n: number }[] = [];
      const cur = store.openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (c) {
          const v = c.value as { k: IDBValidKey; at: number; n: number };
          rows.push({ k: c.primaryKey, at: v.at, n: v.n || 0 });
          c.continue();
          return;
        }
        const cutoff = Date.now() - QUEUE_MAX_AGE_MS;
        let total = 0;
        for (const r of rows) total += r.n;
        for (const r of rows) {
          if (r.at < cutoff || total > QUEUE_MAX_RECORDS) {
            store.delete(r.k);
            total -= r.n;
          } else break; // rows are oldest-first; nothing later can qualify
        }
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/** Drain whatever the network refused earlier. Serial and fail-fast: one
 *  failure stops the drain rather than spraying a dead link with the backlog. */
export async function queueDrain() {
  if (draining || (typeof navigator !== "undefined" && navigator.onLine === false)) return;
  draining = true;
  try {
    const db = await openDb();
    if (!db) return;
    const rows = await new Promise<{ k: IDBValidKey; batch: TelBatch }[]>((resolve) => {
      const out: { k: IDBValidKey; batch: TelBatch }[] = [];
      try {
        const tx = db.transaction(STORE, "readonly");
        const cur = tx.objectStore(STORE).openCursor();
        cur.onsuccess = () => {
          const c = cur.result;
          if (c) {
            out.push({ k: c.primaryKey, batch: (c.value as { batch: TelBatch }).batch });
            c.continue();
          }
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => resolve(out);
        tx.onabort = () => resolve(out);
      } catch {
        resolve(out);
      }
    });
    for (const row of rows) {
      let ok = false;
      try {
        const r = await fetch(ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(row.batch),
        });
        // a 4xx batch will never land: delete it rather than block the queue
        ok = r.ok || (r.status >= 400 && r.status < 500);
      } catch {
        ok = false;
      }
      if (!ok) break;
      await new Promise<void>((resolve) => {
        try {
          const tx = db.transaction(STORE, "readwrite");
          tx.objectStore(STORE).delete(row.k);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch {
          resolve();
        }
      });
    }
  } catch {
    /* ignore */
  } finally {
    draining = false;
  }
}

// ── labels and paths ──────────────────────────────────────────────────────

const PRIVATE = "[data-tel-private]";

/** A stable element path. Tag, first class and position — never text. */
export function telPath(el: Element | null): string {
  const parts: string[] = [];
  let n: Element | null = el;
  for (let d = 0; n && d < 5; d++) {
    let s = n.tagName ? n.tagName.toLowerCase() : "?";
    const id = n.getAttribute?.("id");
    if (id) {
      parts.unshift(`${s}#${id}`);
      break;
    }
    const cls = n.getAttribute?.("class");
    if (cls) {
      const first = cls.trim().split(/\s+/)[0];
      if (first) s += `.${first}`;
    }
    let i = 1;
    let sib = n.previousElementSibling;
    while (sib) {
      if (sib.tagName === n.tagName) i++;
      sib = sib.previousElementSibling;
    }
    if (i > 1) s += `:${i}`;
    parts.unshift(s);
    n = n.parentElement;
  }
  return parts.join(">");
}

/** The label rule, and the one place it is enforced.
 *
 *  data-tel is authored by us and always wins. Failing that the accessible
 *  name is used — but ONLY outside a data-tel-private region, because in this
 *  app the accessible name of a message bubble IS the message ("Meera at
 *  4:06: <what she said>. Reply"). innerText is never read here at all. */
export function telLabel(el: Element | null): string {
  if (!el || !el.closest) return "";
  const explicit = el.closest("[data-tel]");
  if (explicit) return (explicit.getAttribute("data-tel") || "").slice(0, 60);
  if (el.closest(PRIVATE)) return "private";
  const named = el.closest("[aria-label]");
  if (named) return (named.getAttribute("aria-label") || "").slice(0, 60);
  const tag = el.tagName ? el.tagName.toLowerCase() : "";
  const type = el.getAttribute?.("type");
  return type ? `${tag}[${type}]` : tag;
}

/** Named entities in a spoken line, COUNT ONLY — the fabrication audit needs
 *  to know how much she asserted, never what she asserted. */
export function countNamedEntities(text: string): number {
  let n = 0;
  const toks = text.split(/\s+/);
  for (let i = 0; i < toks.length; i++) {
    const w = toks[i].replace(/[^\p{L}\p{N}]/gu, "");
    if (!w) continue;
    if (i > 0 && /^\p{Lu}/u.test(w)) n++;
    else if (/^\d{2,}$/.test(w)) n++;
  }
  return n;
}

// ── route ─────────────────────────────────────────────────────────────────

let route = "/";
let routeAt = 0;

export function telRoute(to: string, via: "tap" | "back" | "deeplink" | "auto" = "tap") {
  if (to === route) return;
  const from = route;
  route = to;
  routeAt = now();
  tel("app.route", { from, to, via });
}

/** Non-zero whenever a route change has happened since `t` — the dead-tap
 *  check needs "did anything navigate", not the route itself. */
const routedSince = (t: number) => routeAt > t;

// ── global DOM capture ────────────────────────────────────────────────────

let lastPaintAt = 0;
let paintArmed = false;
// The honest name for this is "ms since the last paint we SAMPLED". One rAF
// is armed per input rather than a permanent rAF loop, because a loop keeps
// the main thread waking 60x/s for a number that is only ever read on the
// next input — and a battery cost to measure responsiveness is self-defeating.
// The consequence is that after a long idle the last sample is ancient and
// says nothing about this tap, so anything past the ceiling reports -1 rather
// than a large number that would read as "the UI was frozen for 31 seconds".
const PAINT_CEILING_MS = 5000;
function armPaint() {
  if (paintArmed || typeof requestAnimationFrame === "undefined") return;
  paintArmed = true;
  requestAnimationFrame(() => {
    paintArmed = false;
    lastPaintAt = now();
  });
}

let mutations = 0;
// A tap on an interactive control that changes nothing is the signal; the
// threshold exists because a once-a-second call timer redraws one node on its
// own. HEURISTIC, unvalidated against real sessions — a dead_tap rate that
// tracks the call timer rather than the taps is the tell that it needs work.
const DEAD_TAP_MUTATIONS = 2;
const INTERACTIVE = "button,a,input,textarea,select,[role=button],[data-tel],[tabindex]";

interface TapMark {
  path: string;
  at: number;
  n: number;
}
let lastTap: TapMark | null = null;

function install() {
  if (installed || typeof document === "undefined") return;
  installed = true;

  // ── app.start ──
  const script = document.querySelector<HTMLScriptElement>("script[src*='assets/index-']");
  const conn = (navigator as unknown as { connection?: { effectiveType?: string } }).connection;
  tel("app.start", {
    platform: Capacitor.getPlatform?.() ?? "web",
    native: Capacitor.isNativePlatform(),
    // the bundle hash IS the deployed version here — a package.json number
    // does not change per deploy and cannot be matched to a session
    build: script ? (script.src.split("/").pop() ?? "") : "dev",
    locale: navigator.language,
    tz_offset: new Date().getTimezoneOffset(),
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio,
    net: conn?.effectiveType ?? "",
    online: navigator.onLine,
    cold: true,
  });

  // ── visibility, foreground/background, and the flush boundaries ──
  let hiddenAt = 0;
  document.addEventListener("visibilitychange", () => {
    const hidden = document.visibilityState === "hidden";
    tel("app.visibility", { state: hidden ? "hidden" : "visible" });
    if (hidden) {
      hiddenAt = Date.now();
      tel("app.background", {});
      telFlush("beacon");
    } else {
      tel("app.foreground", { away_ms: hiddenAt ? Date.now() - hiddenAt : 0 });
      void queueDrain();
    }
  });
  window.addEventListener("pagehide", () => {
    tel("app.background", { via: "pagehide" });
    telFlush("beacon");
  });

  // ── network ──
  window.addEventListener("online", () => {
    tel("app.net", { online: true, net: conn?.effectiveType ?? "" });
    void queueDrain();
  });
  window.addEventListener("offline", () => tel("app.net", { online: false }));
  try {
    (conn as unknown as EventTarget | undefined)?.addEventListener?.("change", () =>
      tel("app.net", { online: navigator.onLine, net: conn?.effectiveType ?? "" }),
    );
  } catch {
    /* no NetworkInformation here */
  }

  // ── geometry ──
  window.addEventListener("orientationchange", () =>
    tel("app.orientation", { w: window.innerWidth, h: window.innerHeight }),
  );
  let resizeT: ReturnType<typeof setTimeout> | null = null;
  window.addEventListener("resize", () => {
    if (resizeT) clearTimeout(resizeT);
    resizeT = setTimeout(
      () => tel("app.resize", { w: window.innerWidth, h: window.innerHeight }),
      250,
    );
  });

  // ── taps ──
  // pointerdown, not click: a tap that produces nothing never becomes a click
  // on some targets, and "produced nothing" is the event worth having.
  let downAt = 0;
  let downX = 0;
  let downY = 0;
  let downEl: Element | null = null;
  let longT: ReturnType<typeof setTimeout> | null = null;

  document.addEventListener(
    "pointerdown",
    (e) => {
      const el = e.target as Element | null;
      const t = now();
      const gap = lastPaintAt ? Math.round(t - lastPaintAt) : -1;
      const sincePaint = gap > PAINT_CEILING_MS ? -1 : gap;
      armPaint();
      downAt = Date.now();
      downX = e.clientX;
      downY = e.clientY;
      downEl = el;
      const path = telPath(el);
      const label = telLabel(el);
      tel("ui.tap", {
        label,
        path,
        x: Math.round(e.clientX),
        y: Math.round(e.clientY),
        since_paint_ms: sincePaint,
      });

      // rage: 3+ on the same target inside 800ms
      if (lastTap && lastTap.path === path && Date.now() - lastTap.at < 800) {
        lastTap.n++;
        lastTap.at = Date.now();
        if (lastTap.n >= 3) {
          tel("ui.rage_tap", { label, path, taps: lastTap.n });
          lastTap = null;
        }
      } else {
        lastTap = { path, at: Date.now(), n: 1 };
      }

      // dead tap: an interactive target that moves nothing within 1s
      if (el?.closest?.(INTERACTIVE)) {
        const m0 = mutations;
        const t1 = now();
        setTimeout(() => {
          if (mutations - m0 < DEAD_TAP_MUTATIONS && !routedSince(t1))
            tel("ui.dead_tap", { label, path });
        }, 1000);
      }

      if (longT) clearTimeout(longT);
      longT = setTimeout(() => {
        longT = null;
        tel("ui.long_press", { label, path });
      }, 550);
    },
    true,
  );

  const endPointer = (e: PointerEvent) => {
    if (longT) {
      clearTimeout(longT);
      longT = null;
    }
    if (!downAt) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    const dist = Math.round(Math.hypot(dx, dy));
    downAt = 0;
    if (dist < 30) return;
    const dir =
      Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up";
    tel("ui.swipe", { dir, dist, label: telLabel(downEl), path: telPath(downEl) });
  };
  document.addEventListener("pointerup", endPointer, true);
  document.addEventListener("pointercancel", endPointer, true);
  document.addEventListener(
    "pointermove",
    () => {
      // a moving finger is a scroll or a swipe, never a long press
      if (longT) {
        clearTimeout(longT);
        longT = null;
      }
    },
    true,
  );

  // ── scroll, throttled to 250ms ──
  let scrollAt = 0;
  let scrollTop = 0;
  document.addEventListener(
    "scroll",
    (e) => {
      const t = Date.now();
      if (t - scrollAt < 250) return;
      const tgt = e.target as unknown;
      const el = (tgt === document || tgt === window
        ? document.scrollingElement
        : tgt) as HTMLElement | null;
      if (!el || !el.scrollHeight) return;
      const range = el.scrollHeight - el.clientHeight;
      const top = el.scrollTop;
      const dt = scrollAt ? t - scrollAt : 0;
      const depth = range > 0 ? Math.round((top / range) * 100) : 100;
      tel("ui.scroll", {
        path: telPath(el),
        depth_pct: depth,
        dir: top >= scrollTop ? "down" : "up",
        velocity: dt ? Math.round(Math.abs(top - scrollTop) / (dt / 1000)) : 0,
      });
      scrollAt = t;
      scrollTop = top;
    },
    true,
  );

  // ── focus ──
  const fieldOf = (el: Element | null) => {
    if (!el) return "";
    const explicit = el.getAttribute?.("data-tel");
    if (explicit) return explicit;
    return telLabel(el);
  };
  document.addEventListener("focusin", (e) => {
    const el = e.target as Element | null;
    if (!el || !el.matches?.("input,textarea,select,[contenteditable]")) return;
    tel("ui.focus", { field: fieldOf(el) });
  });
  document.addEventListener("focusout", (e) => {
    const el = e.target as Element | null;
    if (!el || !el.matches?.("input,textarea,select,[contenteditable]")) return;
    tel("ui.blur", { field: fieldOf(el) });
  });

  // ── errors ──
  window.addEventListener("error", (e) => {
    tel("err.js", {
      msg: String(e.message || "").slice(0, 200),
      stack: String((e.error && e.error.stack) || "").slice(0, 600),
      where: `${e.filename || ""}:${e.lineno || 0}`,
    });
  });
  window.addEventListener("unhandledrejection", (e) => {
    const r = (e as PromiseRejectionEvent).reason;
    tel("err.promise", {
      msg: String((r && (r.message ?? r)) || "").slice(0, 200),
      stack: String((r && r.stack) || "").slice(0, 600),
    });
  });

  // ── fetch failures ──
  // url_path only, never the query: keys and search terms live in query
  // strings and this table is not where they get a second home.
  if (typeof window.fetch === "function") {
    const orig = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      let path = "";
      try {
        const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        path = new URL(raw, location.href).pathname;
      } catch {
        /* opaque input — no path to report */
      }
      // never observe our own transport: that is an infinite regress on a
      // failing link, and the queue already knows what did not land
      if (path === "/api/telemetry") return orig(input, init);
      const t = now();
      return orig(input, init).then(
        (r) => {
          if (!r.ok)
            tel("err.fetch", { url_path: path, status: r.status, ms: Math.round(now() - t) });
          return r;
        },
        (err: unknown) => {
          tel("err.fetch", {
            url_path: path,
            status: 0,
            ms: Math.round(now() - t),
            msg: String((err as Error)?.message ?? err).slice(0, 120),
          });
          throw err;
        },
      );
    };
  }

  // ── DOM churn, for dead-tap detection only ──
  try {
    const obs = new MutationObserver((recs) => {
      mutations += recs.length;
    });
    obs.observe(document.body, { subtree: true, childList: true, attributes: true });
  } catch {
    /* no MutationObserver: dead_tap simply never fires */
  }

  // periodic drain attempt for a link that came back without an online event
  // (captive portals, flaky mobile data) — cheap, and only when visible
  setInterval(() => {
    if (document.visibilityState === "visible") void queueDrain();
  }, 60_000);
}

/** Install the global listeners. Call once, as early as possible. */
export function installTelemetry(surfaceName = "app") {
  telStart(surfaceName);
  try {
    install();
  } catch {
    /* a capture library that breaks boot is worse than no capture library */
  }
}

// ── compose ───────────────────────────────────────────────────────────────
// The delicate one. Keystroke dynamics are rolled up every 2s or on send —
// never one event per keystroke, which would be both a flood and a cost on
// the single most latency-visible interaction in the product.
//
// Everything on the per-keystroke path below is integer arithmetic and array
// pushes. No JSON, no allocation of objects, no DOM reads beyond the caret
// offsets the caller already has. Percentiles, sorting and event construction
// all happen in the 2s rollup, off the typing path.

const IKI_CAP = 512; // bounded so the rollup's sort can never grow with the draft
const PAUSE_MS = 2000;
// a correction is only interesting if it followed a think, or removed enough
// to be a rewrite rather than a typo
const EDIT_PAUSE_MS = 700;
const EDIT_RUN_LEN = 4;

export interface ComposeTracker {
  focus(lastMsgAt: number): void;
  key(key: string, selStart: number, selEnd: number): void;
  /** No caret argument on purpose — see the note in the implementation. */
  change(next: string): void;
  paste(chars: number): void;
  imeStart(): void;
  imeEnd(): void;
  send(msgId: string, text: string): void;
  /** unmount, navigation, page hide — an unsent draft is an abandoned one */
  leave(): void;
}

export function createComposeTracker(field: string): ComposeTracker {
  let keys = 0;
  let backspaces = 0;
  let deletes = 0;
  let selectionReplaces = 0;
  let pastes = 0;
  let imeCompositions = 0;
  let charsGross = 0;
  let charsAtWindow = 0;
  let pausesOver2s = 0;
  let longestPause = 0;
  let iki: number[] = [];
  let lastKeyAt = 0;
  let lastSelStart = 0;

  let prev = "";
  let startedAt = 0;
  let revisions = 0;
  let bsRun = 0;
  // the gap BEFORE the run began. Computed at run start, because by the time
  // the run closes `lastKeyAt` is the key that closed it and the subtraction
  // would be negative — a correction 'after a pause' would never be detected.
  let bsRunPause = 0;
  let bsRunPos = 0;
  let composing = false;
  let peakChars = 0;
  let rollTimer: ReturnType<typeof setInterval> | null = null;
  let live = false;

  const pct = (arr: number[], p: number) => {
    if (!arr.length) return 0;
    const s = arr.slice().sort((a, b) => a - b);
    return Math.round(s[Math.min(s.length - 1, Math.floor((s.length - 1) * p))]);
  };

  const resetWindow = (len: number) => {
    keys = 0;
    backspaces = 0;
    deletes = 0;
    selectionReplaces = 0;
    pastes = 0;
    imeCompositions = 0;
    charsGross = 0;
    pausesOver2s = 0;
    longestPause = 0;
    iki = [];
    charsAtWindow = len;
  };

  const rollup = (final = false) => {
    if (!keys && !backspaces && !deletes && !pastes && !imeCompositions && !charsGross) {
      if (!final && rollTimer) {
        // nothing happened this window — stop the interval instead of ticking
        // forever behind an idle composer
        clearInterval(rollTimer);
        rollTimer = null;
      }
      return;
    }
    tel("compose.keys", {
      field,
      keys,
      backspaces,
      deletes,
      selection_replaces: selectionReplaces,
      pastes,
      ime_compositions: imeCompositions,
      iki_p50: pct(iki, 0.5),
      iki_p90: pct(iki, 0.9),
      pauses_over_2s: pausesOver2s,
      longest_pause_ms: Math.round(longestPause),
      chars_net: prev.length - charsAtWindow,
      chars_gross: charsGross,
    });
    resetWindow(prev.length);
  };

  const arm = () => {
    if (rollTimer) return;
    rollTimer = setInterval(() => rollup(), 2000);
  };

  const begin = (lastMsgAt = 0) => {
    if (live) return;
    live = true;
    startedAt = Date.now();
    revisions = 0;
    peakChars = 0;
    resetWindow(prev.length);
    tel("compose.start", {
      field,
      t_since_last_msg_ms: lastMsgAt ? Date.now() - lastMsgAt : -1,
    });
  };

  const closeBsRun = () => {
    if (!bsRun) return;
    if (bsRun >= EDIT_RUN_LEN || bsRunPause > EDIT_PAUSE_MS) {
      revisions++;
      tel("compose.edit", {
        field,
        pos: bsRunPos,
        removed_len: bsRun,
        added_len: 0,
        kind: "backspace_run",
      });
    }
    bsRun = 0;
  };

  const end = () => {
    live = false;
    if (rollTimer) {
      clearInterval(rollTimer);
      rollTimer = null;
    }
  };

  return {
    focus(lastMsgAt: number) {
      begin(lastMsgAt);
    },
    key(key, selStart, selEnd) {
      // HOT PATH — keep it arithmetic
      const t = now();
      const prevKeyAt = lastKeyAt;
      if (lastKeyAt) {
        const gap = t - lastKeyAt;
        if (gap > longestPause) longestPause = gap;
        if (gap > PAUSE_MS) pausesOver2s++;
        else if (iki.length < IKI_CAP) iki.push(gap);
      }
      lastKeyAt = t;
      lastSelStart = selStart;
      if (!live) begin(0);
      arm();
      if (key === "Backspace") {
        backspaces++;
        if (!bsRun) {
          bsRunPause = prevKeyAt ? t - prevKeyAt : 0;
          bsRunPos = selStart;
        }
        bsRun++;
        return;
      }
      if (key === "Delete") {
        deletes++;
        return;
      }
      if (key.length === 1) {
        keys++;
        if (selEnd > selStart) selectionReplaces++;
        if (bsRun) closeBsRun();
      }
    },
    change(next) {
      // HOT PATH, and the one place in this file where the obvious
      // implementation was measurably wrong.
      //
      // This used to take the caret as an argument, read in the composer's
      // onChange as `e.target.selectionStart`. That read happens AFTER the
      // new value is in the control, so it forces a synchronous text-control
      // layout — and the composer's autosize (`style.height = "auto"` then
      // `scrollHeight`) forces a second one immediately after. Two forced
      // layouts per keystroke instead of one, measured at +0.6ms p50 on the
      // per-keystroke path. Whether the edit was an append is derivable from
      // the two strings with no DOM read at all, and `pos` comes from the
      // caret already read at keydown, when layout is clean.
      const d = next.length - prev.length;
      charsGross += d < 0 ? -d : d;
      if (next.length > peakChars) peakChars = next.length;
      if (d > 0 && !composing) {
        const appended = next.startsWith(prev);
        if (!appended) {
          // an insert away from the end, after a think, is a real correction
          const paused = now() - lastKeyAt;
          if (paused > EDIT_PAUSE_MS || d > 1) {
            revisions++;
            tel("compose.edit", {
              field,
              pos: lastSelStart,
              removed_len: 0,
              added_len: d,
              kind: d > 1 ? "select_replace" : "mid_edit",
            });
          }
        }
      }
      // typed, then cleared, without sending
      if (prev.length && !next.length && live) {
        rollup(true);
        tel("compose.abandon", { field, chars: peakChars, alive_ms: Date.now() - startedAt });
        prev = "";
        end();
        peakChars = 0;
        return;
      }
      prev = next;
    },
    paste(chars) {
      pastes++;
      charsGross += chars;
      if (!live) begin(0);
      arm();
    },
    imeStart() {
      composing = true;
    },
    imeEnd() {
      composing = false;
      imeCompositions++;
    },
    send(msgId, text) {
      closeBsRun();
      rollup(true);
      // the ONE place draft text is captured, because it exists nowhere else.
      // Deletable on the same terms as the log (rule 3).
      tel("compose.draft", { field, msg_id: msgId, text, final: true });
      tel("compose.send", {
        field,
        msg_id: msgId,
        chars: text.length,
        compose_ms: startedAt ? Date.now() - startedAt : 0,
        revisions,
      });
      prev = "";
      peakChars = 0;
      end();
    },
    leave() {
      if (!live) return;
      rollup(true);
      if (prev.length) {
        tel("compose.draft", { field, text: prev, final: false });
        tel("compose.abandon", {
          field,
          chars: prev.length,
          alive_ms: startedAt ? Date.now() - startedAt : 0,
          via: "leave",
        });
      }
      end();
    },
  };
}
