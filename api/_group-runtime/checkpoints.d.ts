export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonRecord | readonly JsonValue[];
export interface JsonRecord { readonly [key: string]: JsonValue }
export type DeepReadonly<T> = T extends JsonPrimitive ? T
  : T extends readonly (infer V)[] ? readonly DeepReadonly<V>[]
  : { readonly [K in keyof T]: DeepReadonly<T[K]> };

export interface ReaderContext<S extends JsonRecord> {
  readonly scope: DeepReadonly<S>;
  readonly policyVersion: string;
}
export type SnapshotReader<S extends JsonRecord, V extends JsonValue> =
  (context: ReaderContext<S>) => V | Promise<V>;

export type CheckpointFailureReason =
  | "invalid_configuration" | "invalid_scope"
  | "authority_read_failed" | "invalid_authority_snapshot" | "authority_changed"
  | "sources_unbound" | "sources_already_bound" | "invalid_source_reader"
  | "invalid_source_snapshot" | "source_read_failed" | "sources_changed"
  | "too_many_pending_checks";

/** Errors have no adapter cause, source snapshot, scope or private values. */
export interface TurnCheckpointError extends Error {
  readonly name: "TurnCheckpointError";
  readonly code: "turn_checkpoint_unavailable";
  readonly reason: CheckpointFailureReason;
}

export interface TurnCheckpoints<S extends JsonRecord, A extends JsonRecord> {
  readonly guarantee: "checkpointed";
  readonly scope: DeepReadonly<S>;
  readonly policyVersion: string;
  readonly authority: DeepReadonly<A>;
  /** Exactly once; binding never adopts a later or replacement source set. */
  bindSources<V extends JsonValue>(reader: SnapshotReader<S, V>, sourceSnapshot: V): void;
  /** Serialized authority/source/authority/source reads; sticky on failure. */
  assertCurrent(): Promise<void>;
}

export const CHECKPOINT_LIMITS: Readonly<{
  policyVersionCharacters: 128;
  pendingChecks: 64;
  scope: Readonly<{ depth: 8; nodes: 256; entries: 64; stringCharacters: 2048; serializedCharacters: 16384 }>;
  snapshot: Readonly<{ depth: 32; nodes: 32768; entries: 4096; stringCharacters: 262144; serializedCharacters: 1048576 }>;
}>;

export function createTurnCheckpoints<S extends JsonRecord, A extends JsonRecord>(options: {
  scope: S;
  policyVersion: string;
  readAuthority: SnapshotReader<S, A>;
}): Promise<TurnCheckpoints<S, A>>;
