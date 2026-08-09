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

export function rememberFrom(device: string, msgs: Message[]) {
  const recent = msgs
    .filter((m) => m.kind === "text")
    .slice(-16)
    .map((m) => ({ role: m.from === "me" ? "me" : "her", content: m.text }));
  if (recent.length >= 2) post({ op: "remember", device, recent }).catch(() => {});
}

export async function recallMemories(device: string, query: string): Promise<string> {
  try {
    const timeout = new Promise<string>((r) => setTimeout(() => r(""), 2800));
    const fetchIt = post({ op: "recall", device, query })
      .then((r) => (r.ok ? r.json() : { memories: "" }))
      .then((d) => (typeof d?.memories === "string" ? d.memories : ""))
      .catch(() => "");
    return await Promise.race([fetchIt, timeout]);
  } catch {
    return "";
  }
}
