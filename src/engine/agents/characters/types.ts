// The CharacterSheet contract — who an agent IS, separated from how the
// relational layer BEHAVES (persona.ts, becoming the Relational Core).
//
// Owner directive `os-first-optimization` (context/decisions.md, 2026-08-24)
// is the law this file exists to serve: interaction nuance lives in the OS
// and carries to every personality; a new companion is a sheet dropped onto
// the core. Every field here is a byte-exact fragment the core interpolates
// — the extraction from Maya was proven against the 83-fixture byte-identity
// gate at every step, so the split provably changed nothing about her.
//
// RULES FOR AUTHORING A SHEET (the next personality-building agent reads
// this): fragments are SHAPES AND FACTS, never sentence-shaped lines she
// could recite (context/rejected.md `recited-prompt`); fragments carry no
// trailing/leading whitespace beyond what the core's template expects; a
// sheet is a LEAF module — it may import nothing but this file.
export interface CharacterSheet {
  /** matches vy_agent.slug */
  slug: string;
  /** display name — every UI surface hangs off this (maya-rename-display-only) */
  name: string;
  /** CORE cache-key component; bump when any fragment changes */
  version: string;

  /** "a modern, urban 24-year-old Indian girl" — who she is, pre-name facts */
  identityWho: string;
  /** her life in one breath: job, city texture, cultural wiring */
  identityLife: string;

  /** the spoken-language identity bullet for the voice lane (language mix,
   *  what her register never sounds like) */
  languageVoiceRule: string;

  /** locale-correct crisis helplines — safety floor content, never optional,
   *  invariant-gated per module (G-E3) */
  crisisLines: string;
}
