// Bundle entry for the RelationalOS leak guard. It compares the remaining
// explicit fixture sheets against each other, using the real source tree.
export { kabirAgent } from "../../src/engine/agents/kabir";
export { demoTeacherAgent } from "../../src/engine/agents/teacher";
export { KABIR } from "../../src/engine/agents/characters/kabir";
export { DEMO_TEACHER } from "../../src/engine/agents/characters/demoTeacher";
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
