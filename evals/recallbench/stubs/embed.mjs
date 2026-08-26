// api/_embed.js's surface, with the embedder OFF.
//
// `embedOne` returning null is not a broken stub — it is the DOCUMENTED
// degrade path of the real module ("an embedding is an enhancement, never the
// only path to a memory", api/_embed.js), and opRecall's semantic leg handles
// it explicitly: `traceSem.skipped = "no_vector"`, return [].
//
// THE CONSEQUENCE IS A COVERAGE GAP AND IT IS NOT PAPERED OVER: the semantic
// (halfvec) leg of recall is NOT exercised by this benchmark, because scoring
// it offline would mean re-implementing pgvector's distance operator in
// JavaScript and then measuring the re-implementation. run.mjs prints this in
// its header and the per-class table carries no semantic row.
export async function embedOne() {
  return null;
}
export async function embedBatch(items) {
  return (items || []).map(() => null);
}
export function toHalfvecLiteral(v) {
  return `[${(v || []).join(",")}]`;
}
