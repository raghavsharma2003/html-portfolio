// `q` — api/_db.js's exact call shape, served from the fixture store instead
// of from Neon. Duck-typed against the real signature `q(query, params,
// timeoutMs)`, which is the same contract relstate.ts's `QueryFn` documents
// and the same one every DB-facing engine function already accepts injected.
//
// The router itself lives in ../store.mjs; this file is only the seam, so the
// loader has one small, obviously-inert thing to point at.
import { route } from "../store.mjs";

export async function q(query, params = [], timeoutMs = 10_000) {
  void timeoutMs;
  return route(query, params);
}
