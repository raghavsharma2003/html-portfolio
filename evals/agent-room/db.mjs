import { route } from "./store.mjs";

export async function q(sql, params = [], timeoutMs = 10_000) {
  void timeoutMs;
  return route(sql, params);
}
