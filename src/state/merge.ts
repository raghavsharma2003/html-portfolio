// Two devices, one relationship: the sync merge.
//
// Extracted from App.tsx the day the audit found that half of it was dead:
// `mergeStates` merged `herLife`/`inner` from remote, but `syncableState`
// never SENT them — the push list predated the fields, so the merge lines
// could never receive data. The same audit found `game`, `tally` and
// `momentsFired` neither pushed nor merged, which on a second device meant a
// lost chess game and — worse — a REPLAYED celebration, because the
// fired-ledger is exactly the thing that must be a union across devices.
// A module with an eval is how that class of drift stays caught.
//
// Merge principles, per field kind:
// - append-only logs (messages) merge by id, bounded, tombstone-aware
// - LEDGERS (momentsFired) merge by UNION — the whole point of a ledger is
//   that an entry, once made anywhere, holds everywhere
// - monotonic counters (tally) merge by per-field MAX. Two devices closing
//   DIFFERENT games before syncing undercounts one — max is the safe floor;
//   summing would double-count the common history, which is worse
// - single-object state (game, inner) merges WHOLESALE by recency — a game's
//   moves and its clock must never come from different revisions
// - device preferences (theme) do not sync at all: a phone on dark and a
//   laptop on light is a feature, not a conflict

import type { AppState, Message } from "./store";
import type { UserProfile } from "../engine/persona";
import type { ActivityRecord } from "../engine/memory";
import type { GameSession } from "./game";
import { isGameSession } from "./game";

/** Hand-kept mirror of `engine/memory.ts`'s ACTIVITY_LEDGER_MAX, restated
 *  rather than imported for the reason `memory.ts`'s CHAT_TAIL_MAX_WORDS is
 *  restated in the other direction: importing a VALUE from `engine/memory.ts`
 *  would drag Capacitor and the network layer into the state bundle to read
 *  one integer, and this file is on the state boundary every parse crosses.
 *  `evals/sync.mjs` pins the two together so the restatement cannot drift. */
const LEDGER_MAX = 20;

/**
 * `user`, coerced to a shape the prompt builder can survive.
 *
 * It lives here, next to `isGameSession`'s use, because this file is where
 * state crosses a TRUST BOUNDARY — another device's parse of its own
 * localStorage, a server row written by an older build, a hand-edited blob.
 * `game` has been guarded at that boundary since the last audit; `user` was
 * not, and it is dereferenced harder: `buildSystemPromptParts` opens with
 * `Object.entries(user.facts)`, which THROWS on a user without `facts`. That
 * throw is not a blank screen — it is worse. It happens on the reply path, on
 * every send, on that device, forever: she types and never answers. A person
 * who has stopped replying is indistinguishable from a person who has left.
 *
 * Kept total on purpose (never throws, never returns undefined) so it can be
 * applied at every boundary without the caller reasoning about it. `String()`
 * rather than a type test on `name` because a name that arrived as a number is
 * still a name; a `facts` that arrived as an array is not a fact table.
 *
 * NOTE this is the SHAPE floor, not a validator: bad values pass, and that is
 * correct. The failure being prevented is a throw, not a lie.
 */
export function safeUser(u: unknown): UserProfile {
  const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
  return {
    name: typeof o.name === "string" ? o.name : o.name == null ? "" : String(o.name),
    vibe: Array.isArray(o.vibe) ? (o.vibe as string[]) : [],
    facts:
      o.facts && typeof o.facts === "object" && !Array.isArray(o.facts)
        ? (o.facts as Record<string, string>)
        : {},
  };
}

/** progress = how far a session has advanced, for same-session comparison */
function progressOf(g: GameSession): number {
  if (g.kind === "wyr") return g.rounds.length;
  return g.game.played.length;
}

export function mergeGame(
  local: GameSession | null | undefined,
  remote: GameSession | null | undefined,
): GameSession | null {
  if (!local) return remote ?? null;
  if (!remote) return local;
  // different sessions: the newer sitting wins outright
  if (local.startedAt !== remote.startedAt || local.kind !== remote.kind) {
    return remote.startedAt > local.startedAt ? remote : local;
  }
  // same session on both devices: more progress wins; a close beats an open
  if (Boolean(remote.closedAt) !== Boolean(local.closedAt)) {
    return remote.closedAt ? remote : local;
  }
  return progressOf(remote) > progressOf(local) ? remote : local;
}

export function mergeStates(local: AppState, remote: any): Partial<AppState> {
  const clearedAt = Math.max(local.clearedAt ?? 0, Number(remote?.clearedAt) || 0);
  const byId = new Map<string, Message>();
  for (const m of Array.isArray(remote?.messages) ? remote.messages : [])
    if (m && m.id && (m.at ?? 0) >= clearedAt) byId.set(m.id, m);
  for (const m of local.messages) if ((m.at ?? 0) >= clearedAt) byId.set(m.id, m);
  const messages = [...byId.values()].sort((a, b) => (a.at ?? 0) - (b.at ?? 0)).slice(-500);

  const t = local.tally ?? {};
  const rt = remote?.tally ?? {};
  const tally =
    local.tally || remote?.tally
      ? {
          chessGames: Math.max(t.chessGames ?? 0, Number(rt.chessGames) || 0),
          chessWinsHim: Math.max(t.chessWinsHim ?? 0, Number(rt.chessWinsHim) || 0),
          chessWinsHer: Math.max(t.chessWinsHer ?? 0, Number(rt.chessWinsHer) || 0),
          tttGames: Math.max(t.tttGames ?? 0, Number(rt.tttGames) || 0),
          wyrCards: Math.max(t.wyrCards ?? 0, Number(rt.wyrCards) || 0),
        }
      : local.tally;

  const momentsFired =
    local.momentsFired?.length || remote?.momentsFired?.length
      ? [...new Set([...(local.momentsFired ?? []), ...(remote?.momentsFired ?? [])])]
      : local.momentsFired;

  // The activity ledger is a LEDGER, so it merges by union, for the reason
  // stated at the top of this file: an entry made anywhere holds everywhere.
  // Keyed on the session's own identity — the same `kind:startedAt` the server
  // dedupes the episode on, so one game played on a phone and synced to a
  // laptop is one memory on both, never two. Bounded and newest-first on the
  // way out, so a union of two full ledgers cannot grow without limit.
  // Both halves crossed a trust boundary — another device's parse of its own
  // localStorage, or a server row written by an older build — so the SHAPE is
  // checked before either is spread. Spreading a non-array throws, and a throw
  // in the sync path is a blank screen that then syncs.
  const localActs = Array.isArray(local.activities) ? local.activities : [];
  const remoteActs = Array.isArray(remote?.activities) ? (remote.activities as ActivityRecord[]) : [];
  const activities =
    localActs.length || remoteActs.length
      ? (() => {
          const byKey = new Map<string, ActivityRecord>();
          for (const r of [...remoteActs, ...localActs])
            if (r && r.kind && Number.isFinite(r.startedAt) && r.summary)
              byKey.set(`${r.kind}:${r.startedAt}`, r);
          return [...byKey.values()]
            .sort((a, b) => (b.closedAt || 0) - (a.closedAt || 0))
            .slice(0, LEDGER_MAX);
        })()
      : local.activities;

  return {
    onboarded: remote?.onboarded || local.onboarded,
    deviceId: remote?.deviceId || local.deviceId, // keep her memory graph
    // whichever copy wins, it is SHAPED before it is adopted — the remote half
    // crossed a trust boundary and the local half may itself be an older
    // build's adoption of one. `safeUser` is total, so this cannot be the
    // thing that fails.
    user: safeUser(
      local.messages.length >= (remote?.messages?.length ?? 0)
        ? local.user
        : remote?.user ?? local.user,
    ),
    messages,
    lastSeen: Math.max(local.lastSeen ?? 0, Number(remote?.lastSeen) || 0),
    clearedAt: clearedAt || undefined,
    // her side of the relationship. The interior merges WHOLESALE by
    // revision, never field-by-field: a feeling and its watermark must never
    // come from different revisions.
    herLife: remote?.herLife?.length && !local.herLife?.length ? remote.herLife : local.herLife,
    inner: (Number(remote?.inner?.at) || 0) > (local.inner?.at ?? 0) ? remote.inner : local.inner,
    // the remote half crosses a trust boundary (another device's parse of
    // its own localStorage) — shape-guard it, or a malformed session becomes
    // a blank screen that SYNCS. isGameSession is the same guard loadState
    // applies to its own boundary.
    game: mergeGame(local.game, isGameSession(remote?.game) ? remote.game : null),
    activities,
    tally,
    momentsFired,
    followup:
      (Number(remote?.followup?.at) || 0) > (local.followup?.at ?? 0)
        ? remote.followup
        : local.followup,
  };
}
