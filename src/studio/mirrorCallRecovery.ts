const KEY_PREFIX = "vy.mirrorCall.session.v1.";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface MirrorCallOperationFence {
  readonly active: boolean;
  tryEnter(): boolean;
  leave(): void;
}

export interface MirrorCallRecoveryIntent {
  version: 1;
  replicaId: string;
  sessionId: string;
  openedAt: number;
  endRequestedAt: number | null;
  endedAt: string | null;
}

/**
 * React state is not an immediate mutex: two taps can run before a render
 * commits `busy=true`. This tiny synchronous fence serializes the network
 * operations whose double-submit would make call ownership ambiguous.
 */
export function createMirrorCallOperationFence(): MirrorCallOperationFence {
  let active = false;
  return {
    get active() { return active; },
    tryEnter() {
      if (active) return false;
      active = true;
      return true;
    },
    leave() { active = false; },
  };
}

function browserStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function key(replicaId: string) {
  return `${KEY_PREFIX}${replicaId}`;
}

function validIntent(value: unknown, replicaId: string): value is MirrorCallRecoveryIntent {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<MirrorCallRecoveryIntent>;
  return item.version === 1
    && item.replicaId === replicaId
    && UUID.test(String(item.replicaId || ""))
    && UUID.test(String(item.sessionId || ""))
    && typeof item.openedAt === "number"
    && Number.isFinite(item.openedAt)
    && item.openedAt > 0
    && (item.endRequestedAt === null || (typeof item.endRequestedAt === "number" && Number.isFinite(item.endRequestedAt)))
    && (item.endedAt === null || typeof item.endedAt === "string");
}

/**
 * This record is deliberately content-free. It contains no audio, transcript,
 * caption, proposal, score, or speaker decision. The bearer token still owns
 * every server read; this only lets the same tab replay an idempotent end.
 */
export function readMirrorCallRecovery(
  replicaId: string,
  storage: StorageLike | null = browserStorage(),
): MirrorCallRecoveryIntent | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(key(replicaId));
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (validIntent(value, replicaId)) return value;
    storage.removeItem(key(replicaId));
  } catch {
    // A blocked or corrupt session store removes only recovery convenience.
  }
  return null;
}

export function rememberMirrorCall(
  replicaId: string,
  sessionId: string,
  openedAt = Date.now(),
  storage: StorageLike | null = browserStorage(),
): MirrorCallRecoveryIntent {
  const value: MirrorCallRecoveryIntent = {
    version: 1,
    replicaId,
    sessionId,
    openedAt,
    endRequestedAt: null,
    endedAt: null,
  };
  try { storage?.setItem(key(replicaId), JSON.stringify(value)); } catch {
    // The current call still works when private browsing blocks persistence.
  }
  return value;
}

export function rememberMirrorCallEnd(
  value: MirrorCallRecoveryIntent,
  endedAt: string | null = value.endedAt,
  now = Date.now(),
  storage: StorageLike | null = browserStorage(),
): MirrorCallRecoveryIntent {
  const next: MirrorCallRecoveryIntent = {
    ...value,
    endRequestedAt: value.endRequestedAt ?? now,
    endedAt,
  };
  try { storage?.setItem(key(value.replicaId), JSON.stringify(next)); } catch {
    // The in-memory copy still owns retry for the current mount.
  }
  return next;
}

export function clearMirrorCallRecovery(
  replicaId: string,
  storage: StorageLike | null = browserStorage(),
) {
  try { storage?.removeItem(key(replicaId)); } catch {
    // There is no content to clean up if persistence was unavailable.
  }
}
