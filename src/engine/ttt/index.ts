// The ttt module's entire public surface. Import from here, not from the
// files behind it — same discipline as `src/engine/chess/index.ts`.

export type { Cell, ChoiceKind, Game, GameResult, GameStatus, Mark, PlayedMove, Strength } from "./types";

export { EMPTY_BOARD, legalCells, newTttGame, playTtt, statusOfBoard, winningCells } from "./board";

export { DEFAULT_STRENGTH, STRENGTHS, herTttMove, resolveStrength } from "./opponent";
