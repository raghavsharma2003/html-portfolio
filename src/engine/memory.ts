// Client side of the Supabase-backed memory: everything goes through our
// serverless proxy (/api/memory) — the app never holds a database key.
// log/remember are fire-and-forget; recall races a short timeout so her
// reply is never held hostage by the network.

import { Capacitor } from "@capacitor/core";
import type { Message } from "../state/store";

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
// things she claimed about her OWN life, so the caller can keep them.
export async function rememberFrom(device: string, msgs: Message[]): Promise<string[]> {
  const recent = msgs
    .filter((m) => m.kind === "text")
    .slice(-16)
    .map((m) => ({ role: m.from === "me" ? "me" : "her", content: m.text }));
  if (recent.length < 2) return [];
  try {
    const r = await post({ op: "remember", device, recent });
    const d = r.ok ? await r.json() : null;
    if (!Array.isArray(d?.self)) return [];
    return d.self.filter((s: unknown): s is string => typeof s === "string" && Boolean(s.trim())).slice(0, 4);
  } catch {
    return [];
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
