// The chess module's entire public surface. Import from here, not from the
// files behind it.
//
// x88.ts is deliberately NOT re-exported. It is a search-internal board with
// no legality guarantees at its edges, and the moment anything outside this
// directory can reach it, the "chess.js is the rules authority" invariant
// becomes a convention instead of a structural fact. The eval suite reaches
// past this file on purpose, to run perft; nothing in `src/` may.

export type {
  ChoiceKind,
  ChoiceReason,
  FlavourTag,
  Game,
  GamePhase,
  GameResult,
  GameStatus,
  HangingPiece,
  HerMove,
  LegalMove,
  MoveAssessment,
  MoveInput,
  MoveTag,
  MoveVerdict,
  PieceType,
  PlayedMove,
  RootCandidate,
  SearchInfo,
  Side,
  Standing,
  Strength,
} from "./types";

export {
  START_FEN,
  isLegalMove,
  isValidFen,
  legalMoves,
  newGame,
  pieceAt,
  play,
  positionKey,
  sanFromUci,
  statusOfFen,
} from "./board";

export {
  ASSESS_LIMITS,
  assessLast,
  assessMove,
  isRecapture,
  materialCount,
} from "./assess";
export type { AssessOptions } from "./assess";

export {
  DEFAULT_STRENGTH,
  STRENGTHS,
  chooseMove,
  chooseMoveAsync,
  limitsFor,
  resolveStrength,
} from "./opponent";
export type { ChooseOptions } from "./opponent";
