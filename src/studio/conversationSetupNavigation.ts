/** Private setup carries the current replica and locale into the existing gate. */
export function conversationSetupUrl(replicaId: string, search = ""): string {
  const params = new URLSearchParams(search);
  params.set("replica", replicaId);
  params.set("mode", "setup");
  params.set("step", "deploy");
  for (const key of ["sample", "view", "panels"]) params.delete(key);
  return `/studio?${params.toString()}#runtime-gate`;
}
