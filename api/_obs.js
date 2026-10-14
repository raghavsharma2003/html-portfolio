// WS-OBS — the server-side ops event stream (owner directive 2026-08-25:
// "track literally everything... which model is powering at that time, when
// the Gemini key is exhausted we know about that automatically").
//
// One writer, one table: rows land in the EXISTING meera_diag table under
// scope "ops" with device_id "server", so the client diagnostics and the
// server ops stream share storage, indexes, and a future dashboard's query
// surface. No migration needed; db/schema.sql already ships the table and
// its (event, at) index.
//
// The contract callers rely on:
//   - obs() NEVER throws and NEVER blocks the product path. In a serverless
//     runtime a floating promise can be frozen mid-write when the response
//     goes out, so callers on a response path should `await obs(...)` only
//     where they already await other writes, and otherwise call
//     `obsBestEffort()` which swallows the promise deliberately (a lost ops
//     row is priced in; a slowed reply is not).
//   - detail is COUNTS, LABELS AND DECISIONS, never conversation text —
//     same law api/diag.js states for the client stream. A key LABEL is
//     explicitly fine (docs/KEYRING.md: "it names WHOSE key, never the
//     key"); a key VALUE never appears here.
import { q } from "./_db.js";

export async function obs(event, detail = {}, tMs = 0) {
  try {
    // The params go as ONE ARRAY. `q(query, params, timeoutMs)` — this call
    // used to spread the seven values as seven arguments, which handed
    // `params` the string "server" and `timeoutMs` the empty string, so every
    // ops row this module has ever written was rejected by Neon and swallowed
    // by the catch below. The stream reported nothing and looked healthy,
    // which is `startup-failure-is-invisible` inside the very file built to
    // make failures visible. Found by WS-COST while wiring `paid_turn`.
    await q(
      `insert into meera_diag (device_id, session_id, scope, event, t_ms, detail, at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        "server",
        "",
        "ops",
        String(event).slice(0, 48),
        Math.round(tMs) || 0,
        JSON.stringify(detail).slice(0, 4000),
        new Date().toISOString(),
      ],
    );
  } catch {
    /* observability must never become the outage */
  }
}

/** Fire-and-forget variant for hot paths (key walks, stream loops). */
export function obsBestEffort(event, detail = {}, tMs = 0) {
  obs(event, detail, tMs).catch(() => {});
}
