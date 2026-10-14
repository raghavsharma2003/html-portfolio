// Bundle entry for the RelationalOS leak guard — exports both registered
// agents and Maya's sheet so the guard scans the REAL tree, not a copy.
export { meeraAgent } from "../../src/engine/agents/meera";
export { kabirAgent } from "../../src/engine/agents/kabir";
export { MAYA } from "../../src/engine/agents/characters/maya";
export { KABIR } from "../../src/engine/agents/characters/kabir";
// R3 tail: the call/watch directives are OS constants every agent's call
// lane ships verbatim — so they are lanes the leak guard must scan too.
export {
  CALL_OPEN_DIRECTIVE,
  WATCH_ALONG_DIRECTIVE,
  WATCH_COMMENT_DIRECTIVE,
  WATCH_IDLE_DIRECTIVE,
  WATCH_POINT_DIRECTIVE,
  WATCH_RESHOW_DIRECTIVE,
  WATCH_SCENE_DIRECTIVE,
  WATCH_SHOW_DIRECTIVE,
  WATCH_START_DIRECTIVE,
} from "../../src/engine/persona";
