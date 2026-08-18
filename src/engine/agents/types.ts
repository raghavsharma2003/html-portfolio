// The AgentModule contract — SPEC-AGENT-LAYER.md §3 (Law E2), §7 (G-E2/G-E3).
// This file OWNS the shape; it produces no persona content of its own.
//
// The spec's interface sketch (§3) is indicative — the signatures below are
// the REAL ones, read off persona.ts's actual exports rather than guessed:
//
//   - `buildSystemPromptParts` in persona.ts has default parameter values
//     (`messageCount = 999`, `medium: "text" | "voice" = "text"`) and a
//     4th param `dimsStage` that is untyped-optional
//     (`"new"|"warming"|"settled"|"close"|"deep"|null`, no `undefined` in its
//     own union — TS widens that at the call site). The interface here
//     mirrors the real signature exactly rather than the spec's abbreviated
//     `(user, messageCount, medium, dimsStage)`.
//   - `buildSpeechStyle` takes `VoiceEngine | "live"`, exactly as spec'd.
//   - persona.ts exports no `personaVersion`-shaped constant today (grepped:
//     zero hits for personaVersion/PERSONA_VERSION/persona_version anywhere
//     in src/, api/, db/). It is metadata ABOUT a persona module, not persona
//     content, so it is invented once here as a contract field and each
//     module supplies its own literal — see agents/meera.ts's comment.
//   - persona.ts exports no `register`-shaped data (script/honorificSystem/
//     hindiMarkers) either — SPEC-AGENT-LAYER.md §3 confirms this is new,
//     reserved surface ("register.honorificSystem: 'none' is reserved... as
//     the seam a future non-T-V agent widens"), not something read off
//     existing code.
//
// Everything else (WATCH_MODE_NOTE, SEARCH_DECISION, FORGET_DECISION,
// CRISIS_LINES) is a plain persona.ts string export, typed here as `string`
// exactly as spec'd.
import type { UserProfile, VoiceEngine } from "../persona";

// Re-exported so call sites can depend on the agents module for these types
// without a direct import from persona.ts (persona.ts stays READ-ONLY and
// its only remaining reader in this seam is agents/meera.ts itself). Shape
// is untouched — these are the identical persona.ts type declarations,
// forwarded, never redeclared.
export type { UserProfile, VoiceEngine };

export type Medium = "text" | "voice";

// Matches persona.ts's own (unexported, inferred) dimsStage union exactly.
export type DimsStage = "new" | "warming" | "settled" | "close" | "deep" | null;

export interface PromptParts {
  core: string;
  tail: string;
}

// SPEC-AGENT-LAYER.md §3: "The register dimensions are Hindi-specific, and
// that is not fixed here." `honorificSystem: "none"` is the reserved seam
// for a future non-T-V agent; Phase E does not attempt that redesign.
export interface AgentRegister {
  script: "latin" | "deva";
  honorificSystem: "hi-TV" | "none";
  hindiMarkers?: readonly string[];
}

export interface AgentModule {
  // matches vy_agent.slug (db/migrations/009_agents.sql, WS-AGENT-SCHEMA)
  slug: string;
  displayName: string;
  // part of the CORE cache key (SPEC-AGENT-LAYER.md §3) — bump by hand when
  // a module's persona content changes in a way that should bust the cache.
  personaVersion: string;

  buildSystemPromptParts(
    user: UserProfile,
    messageCount: number,
    medium: Medium,
    dimsStage?: DimsStage,
  ): PromptParts;
  buildSpeechStyle(engine: VoiceEngine | "live"): string;

  WATCH_MODE_NOTE: string;
  // appended LAST — prompt-position is mechanism, not style (CLAUDE.md,
  // context/decisions.md `prompt-position`). Never move these off the end.
  SEARCH_DECISION: string;
  FORGET_DECISION: string;
  // invariant-protected, never optional — safety-floor content (SPEC-AGENT-
  // LAYER.md §3, §7 G-E3).
  CRISIS_LINES: string;

  register: AgentRegister;
}
