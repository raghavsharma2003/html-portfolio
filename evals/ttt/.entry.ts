// Bundle entry for the TIC-TAC-TOE PARITY gate (WS-TTT).
//
// Everything the battery probes, from the REAL source, rebuilt on every run —
// the rule `evals/run.mjs`, `evals/lanes/run.mjs` and `evals/lifecycle/run.mjs`
// are all under, for the reason `gates-that-live-nowhere` records: a gate that
// bundles once and caches is a gate that passes forever while the tree rots.
//
// Nothing here is a fixture of the shipping code. Every board this battery
// reasons about is played out through `playTtt`/`herTttMove`, every fact is
// produced by the adapter the app calls, and the block is rendered by the
// compiler the lanes call.

// The ttt rules engine and her opponent — boards are PLAYED, never hand-built.
export { newTttGame, playTtt, herTttMove, legalCells, winningCells } from "../../src/engine/ttt";

// The ttt → words adapter. The whole subject of this battery.
export {
  tttActivity,
  tttRecord,
  tttMoveFact,
  tttMoveNote,
  tttSettledClause,
  tttThreats,
  tttUrgent,
  tttNoteworthy,
  tttBoardFact,
} from "../../src/engine/tttTalk";

// Chess's equivalents, so "parity" is measured against the real thing rather
// than against a description of it.
export { chessActivity, chessRecord, threatFacts } from "../../src/engine/chessTalk";
export { newGame as newChessGame, play as playChess, assessLast } from "../../src/engine/chess";

// The generic seam both games ride.
export { renderActivity, activityNote, ACTIVITY_BUDGET, ACTIVITY_BLOCK_MAX, STATE_LAW, LABEL } from "../../src/engine/activity";

// The single derivation both lanes read, the staleness seam, the think table,
// and the head-to-head reader.
export {
  activityOf,
  activityPickupLine,
  gamePly,
  noteIsStale,
  noteVerdict,
  turnPhase,
  tttThinkMs,
  seriesOf,
  THINK_BANDS,
  THINK_FLOOR_MS,
  THINK_CEIL_MS,
  RECENT_END_MS,
  OPEN_STALE_MS,
} from "../../src/state/game";

// The lifecycle facts. `boardWord` is exported for the gate that catches the
// literal key reaching her mouth.
export {
  boardWord,
  boardClosedFact,
  boardOverFact,
  boardOpenedFact,
  boardTurnFact,
  lifecycleStateNote,
  formatActivityLedgerForCall,
  LIFECYCLE_MATRIX,
  LIFECYCLE_FACT_MAX_CHARS,
} from "../../src/voice/callHistory";

// The memory writer, so "a finished ttt game becomes an episode" is asserted
// against the thing that writes one rather than against a claim that it does.
export {
  activityEpisodeSummary,
  formatActivityLedger,
  withActivityRecord,
  episodeDateLabel,
  EPISODE_SUMMARY_MAX,
} from "../../src/engine/memory";

// The component-side close, which is where a taken-over board is settled.
export { settleOccupant, emitClosedActivity } from "../../src/components/activityClose";

// The real compiler — an assertion that a block "reaches her" has to be made
// against a compiled prompt, never against a render function (`selfbundle-
// never-set`: a slot is wired when a REAL PROMPT CONTAINS ITS BYTES).
export { compile } from "../../src/engine/compiler";
export { CALL_OPEN_DIRECTIVE } from "../../src/engine/persona";

// The shape rules every fact is held to.
export { lintLine } from "../../src/engine/shapelint";
