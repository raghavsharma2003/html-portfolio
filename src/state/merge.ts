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
import type { GameSession } from "./game";

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

  return {
    onboarded: remote?.onboarded || local.onboarded,
    deviceId: remote?.deviceId || local.deviceId, // keep her memory graph
    user:
      local.messages.length >= (remote?.messages?.length ?? 0)
        ? local.user
        : remote?.user ?? local.user,
    messages,
    lastSeen: Math.max(local.lastSeen ?? 0, Number(remote?.lastSeen) || 0),
    clearedAt: clearedAt || undefined,
    // her side of the relationship. The interior merges WHOLESALE by
    // revision, never field-by-field: a feeling and its watermark must never
    // come from different revisions.
    herLife: remote?.herLife?.length && !local.herLife?.length ? remote.herLife : local.herLife,
    inner: (Number(remote?.inner?.at) || 0) > (local.inner?.at ?? 0) ? remote.inner : local.inner,
    game: mergeGame(local.game, remote?.game),
    tally,
    momentsFired,
    followup:
      (Number(remote?.followup?.at) || 0) > (local.followup?.at ?? 0)
        ? remote.followup
        : local.followup,
  };
}
