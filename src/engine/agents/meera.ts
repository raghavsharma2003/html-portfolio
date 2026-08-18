// Zero-content re-export of persona.ts (SPEC-AGENT-LAYER.md §3, Law E2):
// "agents/meera.ts is a re-export of persona.ts with zero content edits, so
// byte-identity (83/83 fixtures), the 138 persona invariants, and the prompt
// budget all hold BY CONSTRUCTION rather than by re-measurement."
//
// NO PERSONA TEXT IS COPIED, REWRITTEN, OR PARAPHRASED INTO THIS FILE. It
// wires the LIVE functions and constants persona.ts already exports into the
// AgentModule shape (./types.ts) so there is exactly one copy of her
// personality in the repo — copying text here would create a second source
// of truth that silently drifts (CLAUDE.md, context/rejected.md
// `recited-prompt`). persona.ts is READ-ONLY for the whole phase
// (docs/SPEC-AGENT-LAYER.md §8) and nothing below touches it beyond reading
// its exports.
import {
  HER_NAME,
  buildSystemPromptParts,
  buildSpeechStyle,
  WATCH_MODE_NOTE,
  SEARCH_DECISION,
  FORGET_DECISION,
  CRISIS_LINES,
} from "../persona";
import type { AgentModule } from "./types";

// persona.ts has no version constant to read (see types.ts's header comment
// for the grep that confirms it) — this literal is metadata ABOUT the
// module, not persona content. Bump it by hand if persona.ts's CORE content
// is ever charm-gated and re-authored (docs/SPEC.md §0.3); nothing derives
// it automatically today.
const PERSONA_VERSION = "meera-1";

export const meeraAgent: AgentModule = {
  slug: "meera",
  displayName: HER_NAME,
  personaVersion: PERSONA_VERSION,

  buildSystemPromptParts,
  buildSpeechStyle,

  WATCH_MODE_NOTE,
  SEARCH_DECISION,
  FORGET_DECISION,
  CRISIS_LINES,

  // SPEC-AGENT-LAYER.md §3: Meera's register — romanized Hinglish, tu/tum/aap
  // T-V honorific system. `hindiMarkers` is left unset here: the detector
  // word lists (HINDI_MARKER_WORDS, TU/AAP/TUM_MARKERS) live in
  // api/memory.js's consolidate derivations (generalization audit item 6),
  // not in persona.ts, so there is nothing to re-export at this seam without
  // reaching into a file this workstream does not own (api/**). Left absent
  // rather than guessed or duplicated.
  register: {
    script: "latin",
    honorificSystem: "hi-TV",
  },
};

export default meeraAgent;
