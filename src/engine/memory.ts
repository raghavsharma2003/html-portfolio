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
