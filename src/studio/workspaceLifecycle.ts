import type { ReplicaLifecycle } from "./types";

const labels: Record<"en" | "hi", Record<ReplicaLifecycle, string>> = {
  en: {
    draft: "Getting started", consent_pending: "Finish setup", enrolling: "Add your voice",
    calibrating: "Preparing your AI", ready: "Ready to try", active: "Live",
    paused: "Paused", revoked: "Disabled", purging: "Deleting",
  },
  hi: {
    draft: "शुरुआत करें", consent_pending: "सेटअप पूरा करें", enrolling: "अपनी आवाज़ जोड़ें",
    calibrating: "आपका AI तैयार हो रहा है", ready: "आज़माने के लिए तैयार", active: "लाइव",
    paused: "रुका हुआ", revoked: "बंद", purging: "मिटाया जा रहा है",
  },
};

export function workspaceLifecycleLabel(state: ReplicaLifecycle, locale: string): string {
  const language = locale === "hi" ? "hi" : "en";
  return labels[language][state] || (language === "hi" ? "आपका AI" : "Your AI");
}
