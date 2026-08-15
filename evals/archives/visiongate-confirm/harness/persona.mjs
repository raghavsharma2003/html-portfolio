// Pull the REAL WATCH_* strings out of persona.ts so nothing measured here can
// drift from what ships. No retyping: the file is stripped of types and
// evaluated, and the exports are read straight off it.
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const SRC = "/home/user/html-portfolio/src/engine/persona.ts";
const TMP = path.join(path.dirname(fileURLToPath(import.meta.url)), ".persona.tmp.mts");

// persona.ts imports from other engine modules; we only want the WATCH block,
// which is self-contained except for timeOfDay(). Slice it out verbatim.
const src = fs.readFileSync(SRC, "utf8");
function grab(name) {
  const i = src.indexOf(`export const ${name}`);
  if (i < 0) throw new Error("not found: " + name);
  // ends at the first "`;" that closes the template literal
  const j = src.indexOf("`;", src.indexOf("`", i));
  if (j < 0) throw new Error("unterminated: " + name);
  return src.slice(i, j + 2);
}

const block =
  grab("WATCH_MODE_NOTE") +
  "\n" +
  grab("WATCH_COMMENT_DIRECTIVE") +
  "\n" +
  grab("WATCH_START_DIRECTIVE") +
  "\n" +
  grab("WATCH_SCENE_DIRECTIVE") +
  "\n" +
  grab("WATCH_ALONG_DIRECTIVE") +
  "\n" +
  grab("WATCH_IDLE_DIRECTIVE") +
  "\n" +
  grab("WATCH_SHOW_DIRECTIVE") +
  "\n" +
  grab("WATCH_RESHOW_DIRECTIVE") +
  "\n" +
  grab("WATCH_POINT_DIRECTIVE") +
  "\n";
fs.writeFileSync(TMP, block);
const P = await import(TMP + "?v=" + Date.now());
fs.unlinkSync(TMP);

export const WATCH_MODE_NOTE = P.WATCH_MODE_NOTE;
export const WATCH_COMMENT_DIRECTIVE = P.WATCH_COMMENT_DIRECTIVE;
export const WATCH_START_DIRECTIVE = P.WATCH_START_DIRECTIVE;
export const WATCH_SCENE_DIRECTIVE = P.WATCH_SCENE_DIRECTIVE;
export const WATCH_ALONG_DIRECTIVE = P.WATCH_ALONG_DIRECTIVE;
export const WATCH_IDLE_DIRECTIVE = P.WATCH_IDLE_DIRECTIVE;
export const WATCH_SHOW_DIRECTIVE = P.WATCH_SHOW_DIRECTIVE;
export const WATCH_RESHOW_DIRECTIVE = P.WATCH_RESHOW_DIRECTIVE;
export const WATCH_POINT_DIRECTIVE = P.WATCH_POINT_DIRECTIVE;

// The identity stub the model battery used, so numbers stay comparable with
// scratchpad/vision-battery.md. NOT the full ~10k persona.
export const IDENTITY =
  "You are Meera — a warm, opinionated Hinglish-speaking friend on a live voice call with someone in India. You speak the way a close friend actually speaks: casual Hinglish, short, present tense, never like an assistant.\n";

export const SYSTEM = IDENTITY + WATCH_MODE_NOTE;
