// Two REAL turns, replayed verbatim from production telemetry.
//
// Captured from meera_tel on 2026-08-20 with
//   select event, props from meera_tel where session_id = ... order by seq
// and copied unchanged. Nothing here is invented, which is the point: the
// correlator has to reconstruct the funnel from the events brain.ts and
// Chat.tsx ACTUALLY emit, not from the events it would be convenient for them
// to emit.
//
// WHAT IS DELIBERATELY ABSENT. The session also contained compose.draft, which
// is the one telemetry event allowed to carry text (docs/TELEMETRY.md rule 3's
// single exception) and which held this person's actual message. It is not in
// this file and must never be: a fixture committed to the repository is a copy
// of someone's conversation that outlives every forget they will ever ask for.
// The trace's own law (docs/TRACE.md L2) applies to its tests.

/**
 * TURN 1 — session app-mt1fy0m1-de8kta, seq 296-305, 2026-08-20 11:43:34Z.
 * A perfectly ordinary chat turn: 17 characters in, two bubbles out, 3327ms.
 * `chat.compile.manifest` carries NO `sections` because core_hash did not
 * change — which is the gap the brain.ts hook closes (docs/TRACE.md §7).
 */
export const REAL_TURN = [
  ["chat.send", { kind: "text", chars: 17, msg_id: "mt1gcd99mzfz0", quoted: false }],
  ["chat.inner_tail", { over: false, tail: 5204, wants: 0, thread: 0 }],
  ["chat.tail_built", { over: false, tail: 5204 }],
  [
    "chat.route.decision",
    { gate: "passed", lane: "chat", role: "incumbent", model: "google/gemini-3.6-flash", adapter_version: "baseline" },
  ],
  [
    "chat.compile.manifest",
    {
      model: "google/gemini-3.6-flash",
      medium: "text",
      core_hash: "9230f53f643430a3",
      tail_bytes: 5204,
      core_changed: false,
      manifest_hash: "179fc7a9ca4d4999",
      adapter_version: "baseline",
    },
  ],
  [
    "chat.reply",
    {
      kind: "text",
      lane: "proxy",
      forgot: false,
      msg_id: "mt1gcftq640ow",
      bubbles: 2,
      critical: false,
      searched: false,
      latency_ms: 3327,
    },
  ],
];

/**
 * TURN 2 — session app-mt1goecf-05hd54, seq 47-57, 2026-08-20 11:56:56Z.
 *
 * The FIRST turn of an app run, so brain.ts emitted the full compile.manifest
 * record and `sections` is real. Read it:
 *
 *   T5  1895b  memories                T7   609b  what she's told them
 *   T10 1280b  search + forget rules    T11  220b  rel texture
 *   T1 T2 T3 T4 T6 T8 T9 T12 T13  ...  ZERO BYTES, all of them
 *
 * Nine declared tail slots rendering nothing, in production, today — including
 * her carried interior (T1), the whole relational snapshot (T2/T3/T4/T6) and
 * two thirds of the self layer (T12/T13). That is `prodgap-audit`,
 * `relstate-zero-rows` and `selflayer-rows-zero` in a single row, and it is
 * visible ONLY because these byte counts exist. Nothing else in the system can
 * tell a slot that is switched off from a slot that is empty from a slot that
 * was never wired — which is the whole argument for the trace.
 */
export const REAL_TURN_WITH_SECTIONS = [
  ["chat.send", { kind: "text", chars: 9, msg_id: "mt1gtiti4lv0s", quoted: false }],
  ["chat.inner_tail", { over: false, tail: 5141, wants: 0, thread: 0 }],
  [
    "chat.route.decision",
    { gate: "passed", lane: "chat", role: "incumbent", model: "google/gemini-3.6-flash", adapter_version: "baseline" },
  ],
  [
    "chat.compile.manifest",
    {
      model: "google/gemini-3.6-flash",
      medium: "text",
      sections: {
        T1: 0, T2: 0, T3: 0, T4: 0, T5: 1895, T6: 0, T7: 609, T8: 0, T9: 0,
        T10: 1280, T11: 220, T12: 0, T13: 0,
        watch: 0, culture: 0, "mp.bridge": 0, "mp.roster": 0,
      },
      core_hash: "9230f53f643430a3",
      core_bytes: 43868,
      tail_bytes: 5141,
      core_changed: true,
      manifest_hash: "179fc7a9ca4d4999",
      adapter_version: "baseline",
    },
  ],
  [
    "chat.reply",
    {
      kind: "text",
      lane: "proxy",
      forgot: false,
      msg_id: "mt1gtmc7afhbr",
      bubbles: 2,
      critical: false,
      searched: false,
      latency_ms: 4557,
    },
  ],
];

/** The nine slots that rendered zero bytes in TURN 2 — asserted, so a future
 *  change that fixes one of them fails this list and has to say so. */
export const TURN2_ZERO_SLOTS = [
  "T1", "T2", "T3", "T4", "T6", "T8", "T9", "T12", "T13",
  "watch", "culture", "mp.bridge", "mp.roster",
];
