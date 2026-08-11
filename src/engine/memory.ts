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

function runRecall(device: string, query: string): Promise<string> {
  try {
    // measured: ~165ms warm, ~900ms cold. 2s is generous headroom and still
    // can't park a reply behind a slow lookup.
    const timeout = new Promise<string>((r) => setTimeout(() => r(""), 2000));
    const fetchIt = post({ op: "recall", device, query })
      .then((r) => (r.ok ? r.json() : { memories: "" }))
      .then((d) => (typeof d?.memories === "string" ? d.memories : ""))
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
