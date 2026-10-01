export type SelectionMode = "recency" | "lexical_recency";
export type SourceCandidate = Readonly<{
  sourceId: string;
  /** Canonical unsigned decimal string, at most 40 digits. Unique in the pool. */
  order: string;
  episodeId: string;
  speakerId: string;
  /** Current roster label only; null when unknown. Not a historical name or verified identity. */
  speakerLabel: string | null;
  /** Canonical UTC YYYY-MM-DDTHH:mm:ss.sssZ or null. Recording time, not event time. */
  recordedAt: string | null;
  text: string;
}>;
export type SourceRecord = SourceCandidate & Readonly<{
  speakerLabelKind: "current_roster_label" | null;
  sourceRevision: null;
  occurredAt: null;
  replyToSourceId: null;
  subjectIds: null;
  span: Readonly<{ unit: "utf16"; start: 0; end: number }>;
}>;
export type SourceTurn = Readonly<{ role: "user"; content: string }>;
export type SourcePacket = Readonly<{
  schema: "source_turns/v1";
  interpretation: "historical_observations";
  currentStateEstablished: false;
  coverage: "host_supplied_candidate_pool";
  temporalOrder: "recorded_source_order_not_event_time";
  replyAncestryAvailable: false;
  selection: Readonly<{ mode: SelectionMode; candidateCount: number; mandatoryCount: number;
    optionalCount: number; queryTermCount: number }>;
  limits: Readonly<{ sourceTextUtf16: 4000; selectedSources: 32; payloadUtf8Bytes: 32768 }>;
  current: SourceRecord;
  history: readonly SourceRecord[];
}>;
export type SourceSelection = Readonly<{
  packet: SourcePacket;
  turns: readonly SourceTurn[];
  serializedTurns: string;
  rawTexts: readonly string[];
  selectedSourceIds: readonly string[];
  metadata: Readonly<{ mode: SelectionMode; candidateCount: number; selectedCount: number;
    mandatoryCount: number; optionalCount: number; queryTermCount: number;
    optionalSkippedForBudgetCount: number; payloadUtf8Bytes: number; candidateUtf8Bytes: number }>;
}>;
export interface SourceSelectionError extends Error {
  readonly name: "SourceSelectionError";
  readonly code: "source_selection_unavailable";
  readonly reason: "invalid_input" | "current_source_mismatch" |
    "candidate_context_over_budget" | "required_context_over_budget";
}
export const SOURCE_SELECTION_LIMITS: Readonly<{
  candidates: 160; mandatoryRecent: 20; optionalOlder: 12; selected: 32; textUtf16: 4000;
  identityUtf16: 160; orderDigits: 40; queryTerms: 32; candidateUtf8Bytes: 524288; payloadUtf8Bytes: 32768;
}>;
/** Select already-authorized inert sources; selection does not grant authority.
 * Throws a content-free SourceSelectionError. Current source must be latest and
 * exactly match query/currentSpeakerId. See README for snapshot and byte scope.
 * The 32-unique-query-term cap applies only to lexical_recency; recency does not
 * tokenize its query and reports queryTermCount: 0. Both retain the text limit.
 */
export function selectSourceTurns(input: Readonly<{
  query: string;
  currentSourceId: string;
  currentSpeakerId: string;
  candidates: readonly SourceCandidate[];
  mode: SelectionMode;
}>): SourceSelection;
