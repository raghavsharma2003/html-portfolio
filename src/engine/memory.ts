// Client side of the Supabase-backed memory: everything goes through our
// serverless proxy (/api/memory) — the app never holds a database key.
// log/remember are fire-and-forget; recall races a short timeout so her
// reply is never held hostage by the network.

import { Capacitor } from "@capacitor/core";
import type { Message } from "../state/store";
import type { InnerPatch } from "./inner";
import { diagTimer } from "./diag";

const BASE = Capacitor.isNativePlatform() ? "https://meera-silk.vercel.app" : "";

function post(body: unknown): Promise<Response> {
  return fetch(`${BASE}/api/memory`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export function logTurns(device: string, msgs: Message[]) {
  const turns = msgs
    .filter((m) => m.kind !== "callmark")
    .map((m) => ({
      role: m.from === "me" ? "me" : "her",
      channel: m.channel === "call" ? "call" : "chat",
      kind: m.kind,
      content: m.text,
      at: m.at,
    }));
  if (turns.length) post({ op: "log", device, turns }).catch(() => {});
}

// Distils the recent conversation into her graph memory AND hands back the
// things she claimed about her OWN life plus her carried interior, so the
// caller can keep them. ONE model call, already off the critical path — the
// interior rides its JSON, it never gets a call of its own.
//
// What goes UP is conversation text only: no timestamps, no gap markers, no
// counts. That starvation is what makes it structurally impossible for the
// appraiser to turn his reply speed or his silence into her mood (inner.ts G1).
export interface RememberResult {
  self: string[];
  inner: InnerPatch | null;
}

export async function rememberFrom(
  device: string,
  msgs: Message[],
  wants: string[] = [],
): Promise<RememberResult> {
  const recent = msgs
    .filter((m) => m.kind === "text")
    .slice(-16)
    .map((m) => ({ role: m.from === "me" ? "me" : "her", content: m.text }));
  if (recent.length < 2) return { self: [], inner: null };
  const done = diagTimer("chat", "remember_pass", { turns: recent.length, wants: wants.length });
  try {
    const r = await post({ op: "remember", device, recent, wants });
    const d = r.ok ? await r.json() : null;
    const self = Array.isArray(d?.self)
      ? d.self.filter((s: unknown): s is string => typeof s === "string" && Boolean(s.trim())).slice(0, 4)
      : [];
    const inner: InnerPatch | null =
      d && (d.now !== undefined || d.wants !== undefined || d.owed !== undefined || d.told !== undefined)
        ? {
            now: d.now ?? null,
            wants: Array.isArray(d.wants) ? d.wants : null,
            // [] is a real answer here ("she settled up"), so it must not be
            // collapsed to null the way an absent key is
            owed: Array.isArray(d.owed) ? d.owed : null,
            told: d.told === true,
          }
        : null;
    done({ ok: Boolean(d), self: self.length, thread: Boolean(inner?.now) });
    return { self, inner };
  } catch {
    done({ ok: false });
    return { self: [], inner: null };
  }
}

export async function uploadPhoto(device: string, dataB64: string, mime: string): Promise<string | null> {
  try {
    const r = await post({ op: "upload_photo", device, data: dataB64, mime });
    const d = await (r.ok ? r.json() : null);
    return d?.url || null;
  } catch {
    return null;
  }
}

export async function describePhoto(device: string, url: string): Promise<string> {
  try {
    const r = await post({ op: "describe", device, url });
    const d = await (r.ok ? r.json() : null);
    return d?.desc || "";
  } catch {
    return "";
  }
}

// ── forgetting ─────────────────────────────────────────────────────────────
// The inverse of everything above, and the thing that makes the rest of it
// consensual. The server hard-deletes rows (api/memory.js opForget); what
// lives here is the seam that decides WHAT gets asked for, because the two
// dangerous decisions — how wide a scope is, and whether a whole-memory wipe
// can be triggered by a generated marker — belong in code, not in a brief.

export type ForgetTarget =
  | { scope: "item"; name: string }
  | { scope: "session"; from: number; to: number; channel?: "chat" | "call" }
  | { scope: "day"; day: string; tzMin: number }
  | { scope: "all" };

export interface ForgetResult {
  scope: ForgetTarget["scope"];
  deleted: { log: number; nodes: number; edges: number };
}

export async function forgetMemories(
  device: string,
  target: ForgetTarget,
): Promise<ForgetResult | null> {
  if (!device) return null;
  const done = diagTimer("chat", "forget", { scope: target.scope });
  try {
    const r = await post({ op: "forget", device, ...target });
    const d = r.ok ? await r.json() : null;
    if (!d?.ok) {
      done({ ok: false });
      return null;
    }
    const deleted = {
      log: Number(d.deleted?.log) || 0,
      nodes: Number(d.deleted?.nodes) || 0,
      edges: Number(d.deleted?.edges) || 0,
    };
    // the SCOPE is telemetry; the name of the thing they asked her to drop
    // never is — a diag row naming it would outlive the memory it deleted
    done({ ok: true, ...deleted });
    return { scope: d.scope, deleted };
  } catch {
    done({ ok: false });
    return null;
  }
}

const localDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// "the call" = the run of spoken turns at the end of the history. Spoken
// turns never render in the chat, and meera_log has no session column, so a
// time window is the only handle either side has on one.
function lastCallWindow(history: Message[]): { from: number; to: number } | null {
  let end = -1;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].channel === "call") {
      end = i;
      break;
    }
  }
  if (end < 0) return null;
  let start = end;
  while (start > 0) {
    const prev = history[start - 1];
    if (prev.channel === "call" || prev.kind === "callmark") start -= 1;
    else break;
  }
  const from = history[start].at || 0;
  const to = (history[end].at || 0) + 1000;
  return to > from ? { from, to } : null;
}

/**
 * Turn a `[forget: …]` marker into a scope, or refuse it.
 *
 * A WHOLE-MEMORY WIPE IS DELIBERATELY NOT IN THIS VOCABULARY. Every other
 * scope here is bounded and re-learnable — they can just tell her again.
 * "everything" is neither, and routing it through a generated marker would
 * put the single irreversible action in the product one stray token away
 * from happening. It lives in the settings sheet instead: named in words,
 * with ten seconds to take it back. The refusal is structural rather than a
 * line in her brief precisely so that a wording regression cannot reach it.
 */
export function resolveForget(
  marker: string,
  history: Message[],
  now = Date.now(),
): ForgetTarget | null {
  const t = marker.trim().toLowerCase().replace(/[.!?,]+$/, "");
  if (!t) return null;
  if (/^(all|everything|sab|sab ?kuch|sabhi|puri|poora|whole|us)\b/.test(t)) return null;
  if (/\b(call|phone|video)\b/.test(t)) {
    const win = lastCallWindow(history);
    return win ? { scope: "session", from: win.from, to: win.to, channel: "call" } : null;
  }
  const tzMin = -new Date(now).getTimezoneOffset();
  if (/^(today|aaj)\b/.test(t)) return { scope: "day", day: localDay(new Date(now)), tzMin };
  // "kal" is both yesterday and tomorrow in Hinglish; in a forget it can only
  // ever be the one that has already happened
  if (/^(yesterday|kal)\b/.test(t))
    return { scope: "day", day: localDay(new Date(now - 86_400_000)), tzMin };
  const name = t.slice(0, 60);
  return name.length >= 3 ? { scope: "item", name } : null;
}

/**
 * The other half of a forget, and the half that is easy to miss: the turns
 * still sitting in the local store are the context window she thinks with.
 * Deleting them server-side and leaving them here means she has "forgotten"
 * something she can still read three lines above.
 *
 * Only window scopes prune. Forgetting one FACT does not delete the chat they
 * said it in — that would shred their own history as a side effect of asking
 * her to drop a detail, which is not what anyone means by "bhool ja".
 */
export function messagesAfterForget(messages: Message[], target: ForgetTarget): Message[] {
  if (target.scope === "all") return [];
  if (target.scope === "item") return messages;
  let from: number;
  let to: number;
  let channel: "chat" | "call" | undefined;
  if (target.scope === "session") {
    ({ from, to, channel } = target);
  } else {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(target.day);
    if (!m) return messages;
    from = Date.UTC(+m[1], +m[2] - 1, +m[3]) - target.tzMin * 60_000;
    to = from + 86_400_000;
  }
  return messages.filter((msg) => {
    const at = msg.at || 0;
    if (at < from || at >= to) return true;
    if (channel && (msg.channel || "chat") !== channel) return true;
    return false;
  });
}

// WS-INTEGRATE seam 1: opRecall's response now also carries a server-
// assembled relstate bundle (api/memory.js's fetchRelBundle — field names
// mirror compiler.ts's RelBundleInput exactly). This file is unowned by any
// §13 workstream, and its ONE existing network call to op:"recall" is the
// only client-side carrier for that field — duplicating the request in
// brain.ts to also read it would double a round trip Chat.tsx's
// prefetchRecall() already races against a 2s timeout, a latency regression
// the owner's standing "speed and quality are never traded away" instruction
// forbids. So the same response is read twice, additively: `recallMemories`
// keeps its exact existing signature and return value (a string) for every
// existing caller (brain.ts's mode==="call" prefetch in useCallEngine.ts
// included), and the bundle rides a tiny last-value cache a caller can pull
// right after `recallMemories`/`prefetchRecall`'s promise resolves — see
// `takeRelBundle` below. A caller that never calls it simply never reads the
// field; nothing about `recallMemories`'s own behavior changes.
//
// T-H1 (`selfbundle-never-set`): the SELF bundle rides the identical seam.
// op:"recall" now also carries `self` (api/memory.js's fetchSelfBundle —
// field names mirror compiler.ts's SelfBundleInput exactly), for the reason
// stated at that function: the self-layer tables are read server-side through
// an injected QueryFn the browser does not have, and the alternative to
// reusing this response is a second round trip in front of a reply, which the
// standing "speed and quality are never traded away" instruction forbids.
// Everything below is additive: `recallMemories`'s signature and return value
// are untouched, and a caller that never pulls the self bundle simply never
// reads the field.
import type { RelBundleInput, SelfBundleInput } from "./compiler";

let lastBundle: { device: string; query: string; bundle: RelBundleInput | null } | null = null;
let lastSelf: { device: string; query: string; bundle: SelfBundleInput | null } | null = null;

function runRecall(device: string, query: string): Promise<string> {
  try {
    // measured: ~165ms warm, ~900ms cold. 2s is generous headroom and still
    // can't park a reply behind a slow lookup.
    const timeout = new Promise<string>((r) => setTimeout(() => r(""), 2000));
    const fetchIt = post({ op: "recall", device, query })
      .then((r) => (r.ok ? r.json() : { memories: "" }))
      .then((d) => {
        lastBundle = { device, query, bundle: (d?.relstate as RelBundleInput | null | undefined) ?? null };
        lastSelf = { device, query, bundle: (d?.self as SelfBundleInput | null | undefined) ?? null };
        return typeof d?.memories === "string" ? d.memories : "";
      })
      .catch(() => "");
    return Promise.race([fetchIt, timeout]);
  } catch {
    return Promise.resolve("");
  }
}

// The chat starts the lookup the instant they hit send, so its round trip is
// spent inside the burst-wait instead of sitting in front of the model call.
let pending: { device: string; query: string; p: Promise<string> } | null = null;

export function prefetchRecall(device: string, query: string) {
  if (!device) return;
  pending = { device, query, p: runRecall(device, query) };
}

export async function recallMemories(device: string, query: string): Promise<string> {
  if (pending && pending.device === device && pending.query === query) {
    const { p } = pending;
    pending = null;
    return p;
  }
  return runRecall(device, query);
}

/**
 * Pulls whatever relstate bundle rode the LAST resolved recall for this
 * device (consumed once, so a stale bundle from an unrelated earlier query
 * can never leak into a later turn — call it immediately after awaiting
 * `recallMemories`/a `prefetchRecall`'d promise for the same device). `null`
 * covers three cases identically, on purpose: no bundle has landed yet, the
 * server found no vy_rel_state row for this person (no consolidation has
 * run), or the request timed out — every one of them means "render nothing,"
 * which is exactly the T2/T3/T4/T6 byte-identity default.
 */
export function takeRelBundle(device: string): RelBundleInput | null {
  if (!lastBundle || lastBundle.device !== device) return null;
  const b = lastBundle.bundle;
  lastBundle = null;
  return b;
}

/**
 * T-H1 — `takeRelBundle`'s twin for the self layer (T11 rel.texture, T12
 * self.arc, T13 life.untold). Same consume-once contract and the same three
 * collapsed-to-null cases: no bundle has landed, the server found no self rows
 * for this person, or the request timed out. Every one of them means "render
 * nothing", which is the T11/T12/T13 byte-identity default.
 *
 * Separate from `takeRelBundle` rather than folded into it, deliberately: the
 * two are gated independently inside compile() ("Gated on selfBundle ALONE,
 * deliberately OUTSIDE the relBundle branch"), and one cache consumed by two
 * callers would hand the second one null.
 *
 * `sheInitiated` is NOT set here. It is a property of the turn, not of the
 * database, and the caller that knows whether SHE started this turn sets it —
 * brain.ts threads inner.ts's own flag through rather than deriving a second
 * notion of it.
 */
export function takeSelfBundle(device: string): SelfBundleInput | null {
  if (!lastSelf || lastSelf.device !== device) return null;
  const b = lastSelf.bundle;
  lastSelf = null;
  return b;
}

// ── the call lane's self bundle ────────────────────────────────────────────
// The call lane cannot use the consume-once cache the way chat does. It
// fetches ONCE during the ring and then compiles from that same bundle for
// every turn of the call — the realtime lane compiles at connect, the cascade
// lane compiles per spoken turn, and the native watch lane compiles when a
// share starts. Three readers, one fetch, and a consume-once cache would give
// the first reader the bundle and the other two null.
//
// So `recallForCall` moves it out of the consume-once cache into this holder,
// in the SAME continuation the fetch resolves in — which is the ordering
// `takeRelBundle`'s doc says is easy to lose and the reason `recallForCall`
// exists at all. Device-keyed, and written UNCONDITIONALLY on every ring
// fetch (including a failed one, which writes null) so a bundle from an
// earlier call can never outlive the fetch that replaced it. That is strictly
// tighter than the ref it sits alongside.
let callSelf: { device: string; bundle: SelfBundleInput | null } | null = null;

/**
 * What the ring fetch found, for this device. Null when no ring fetch has
 * landed for this device, or when it landed and found nothing — both mean
 * "render nothing", which is compile()'s default for an absent bundle.
 *
 * Read at compile time rather than captured at call start, for the reason
 * every ref in useCallEngine.ts is: a value captured at call start freezes
 * her. It is NOT a ref read in the tick its promise was created in —
 * `rejected.md#realtime-recall-never` — because tryStartLive() awaits the ring
 * fetch (awaitRingFetch) before it compiles.
 */
export function callSelfBundle(device: string): SelfBundleInput | null {
  return callSelf && callSelf.device === device ? callSelf.bundle : null;
}

/**
 * WS-CONTINUITY seam 1 (docs/SPEC-CONTINUITY.md §1). The call lane's ONE
 * memory lookup, fetched during the ring.
 *
 * It exists because `takeRelBundle` is a consume-once cache tied to the
 * resolution of the recall it rode in on: a caller that forgets to pull it in
 * the same continuation gets `null` and never finds out. The chat lane gets
 * that ordering for free (brain.ts awaits `recallMemories` and pulls the
 * bundle on the next line); the call lane fires its recall during the ring and
 * reads it hundreds of ms later, which is exactly the shape that silently
 * loses the bundle. So the ordering is written down ONCE, here, rather than
 * trusted to a second call site.
 *
 * One round trip, the same one `recallMemories` already makes — no new network
 * call, no new latency. Both halves fail to their existing "render nothing"
 * defaults ("" and null) independently.
 */
export async function recallForCall(
  device: string,
  query: string,
): Promise<{ memories: string; relBundle: RelBundleInput | null }> {
  if (!device) {
    callSelf = null;
    return { memories: "", relBundle: null };
  }
  const memories = await recallMemories(device, query);
  // T-H1: both bundles are pulled here, in the one continuation that is
  // guaranteed to be the right one. The self half moves into the call-lane
  // holder rather than out through the return value because the three call-
  // lane compile sites do not share one call frame — see `callSelfBundle`.
  const relBundle = takeRelBundle(device);
  callSelf = { device, bundle: takeSelfBundle(device) };
  return { memories, relBundle };
}

// GAP 2 (WS-FELT) — day-1 seed. Telemetry-style, fire-and-forget ONLY,
// same discipline as useCallEngine.ts's postEpisodeCallEnd (its own
// comment: "never awaited by anything ... its promise is always caught").
// Called once, right after onboarding, so the relational engine has
// something to render before the first 03:30 IST cron ever runs — the
// cron remains the backstop regardless of whether this call lands.
export function seedDayOneConsolidation(device: string) {
  if (!device) return;
  try {
    void fetch(`${BASE}/api/consolidate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device }),
      keepalive: true, // survives onboarding's own screen transition right after
    }).catch(() => {});
  } catch {
    /* never let a seed attempt throw into onboarding */
  }
}

// GAP 3 (WS-FELT) — vibe chips → vy_currency. Telemetry-style, fire-and-
// forget, same discipline as seedDayOneConsolidation above — the chips are
// a nicety, never a blocker, and a failed write here costs nothing but the
// chip going unused (exactly what happens today).
export function seedCurrencyChips(device: string, chips: string[]) {
  if (!device || !chips.length) return;
  post({ op: "seed_currency", device, chips }).catch(() => {});
}

// GAP 4 (WS-FELT) — closeness card. A dedicated read of the same relstate
// bundle op:"recall" already carries (api/memory.js's fetchRelBundle), so
// MoreSheet gets a fresh read on its own schedule instead of depending on
// `takeRelBundle`'s consume-once cache, which is tied to the chat lane's
// own recall timing and may be stale or already consumed by the time
// someone opens Settings. Same 2s-timeout discipline as runRecall — a slow
// network must not hang a settings sheet. `null` on any failure, same as
// every other "no data yet" case in this file.
export async function fetchRelState(device: string): Promise<RelBundleInput | null> {
  if (!device) return null;
  try {
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 2500));
    const fetchIt = post({ op: "recall", device, query: "" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => (d?.relstate as RelBundleInput | null | undefined) ?? null)
      .catch(() => null);
    return await Promise.race([fetchIt, timeout]);
  } catch {
    return null;
  }
}
