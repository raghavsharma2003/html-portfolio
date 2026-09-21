/** Navigation carries the exact replica, never a name-derived identity. */
export function expertWorkspaceUrl(replicaId: string, destination: "share" | "voice", search = ""): string {
  const params = new URLSearchParams(search);
  params.set("replica", replicaId);
  params.set("mode", destination === "share" ? "teacher" : "replica");
  params.set("step", destination === "share" ? "deploy" : "meet");
  params.set("view", destination === "share" ? "share" : "voice");
  params.delete("panels");
  return `/studio?${params.toString()}`;
}

/** Ordinary previews share the durable private voice panel, including from Rooms. */
export function voiceSampleUrl(replicaId: string, search = ""): string {
  const url = new URL(expertWorkspaceUrl(replicaId, "voice", search), "https://workspace.invalid");
  url.searchParams.set("sample", "1");
  return `${url.pathname}${url.search}`;
}

export function initialMeetView(search: string, runtimeActive: boolean): "conversation" | "sample" {
  return new URLSearchParams(search).get("sample") === "1" || !runtimeActive ? "sample" : "conversation";
}

export function firstMeetSurface(input: {
  voiceWorkspaceReady: boolean;
  textReady: boolean;
  hasSavedSheet: boolean;
  hasTextMaterial: boolean;
}): "feed" | "private-rehearsal" | "conversation" {
  if (input.voiceWorkspaceReady || input.textReady) return "conversation";
  if (input.hasSavedSheet && input.hasTextMaterial) return "private-rehearsal";
  return "feed";
}

export function deploySurface(voiceWorkspaceReady: boolean): "room" | "material" {
  return voiceWorkspaceReady ? "room" : "material";
}
