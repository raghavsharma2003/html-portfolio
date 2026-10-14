// Kabir's agent module — the second registered personality, composed from
// the SAME Relational Core as Maya's (persona.ts builders, parameterized by
// sheet). Nothing behavioral is authored here: the OS carries every
// interaction nuance; this file binds a character to it.
//
// v1 scope, declared honestly: WATCH_MODE_NOTE / SEARCH_DECISION /
// FORGET_DECISION are reused from the core as-is — they are OS-dominant but
// still carry a few of Maya's Hinglish example phrases. The cross-agent leak
// guard (R3) measures exactly this so the remaining extractions are chosen
// by evidence, not guesswork.
import {
  buildSystemPromptParts,
  buildSpeechStyle,
  buildWatchModeNote,
  SEARCH_DECISION,
  FORGET_DECISION,
} from "../persona";
import { KABIR } from "./characters/kabir";
import type { AgentModule, DimsStage, Medium, UserProfile, VoiceEngine } from "./types";

export const kabirAgent: AgentModule = {
  slug: KABIR.slug,
  displayName: KABIR.name,
  personaVersion: KABIR.version,

  buildSystemPromptParts: (
    user: UserProfile,
    messageCount: number,
    medium: Medium,
    dimsStage?: DimsStage,
  ) => buildSystemPromptParts(user, messageCount, medium, dimsStage, KABIR),
  buildSpeechStyle: (engine: VoiceEngine | "live") => buildSpeechStyle(engine, KABIR),

  WATCH_MODE_NOTE: buildWatchModeNote(KABIR),
  SEARCH_DECISION,
  FORGET_DECISION,
  CRISIS_LINES: KABIR.crisisLines,

  register: { script: "latin", honorificSystem: "hi-TV" },
};
