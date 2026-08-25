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
  /** texting language identity: mix, banned registers, rewrite rule */
  languageTextRule: string;
  /** romanized shortform vocabulary for the texting lane */
  textShortforms: string;
  /** stretch-vowel exemplars, texting lane */
  textStretch: string;
  /** laughter forms, texting lane */
  textLaughter: string;
  /** emoji density rules + the character's full emoji vocabulary */
  textEmojiRule: string;
  /** voice-lane expression set: each is a full register bullet in the
   *  character's own language. The register SKELETON (which slots exist,
   *  their invariant-pinned order, the structural rules around them) is
   *  Relational Core; these fill the slots. */
  voiceStretch: string;
  voiceLaughter: string;
  voiceFillers: string;
  voiceSelfCorrect: string;
  voiceRepeat: string;
  voiceBreath: string;
  voiceSpelling: string;
  /** the language-balance bullet (pinned adjacency: core places it
   *  immediately before the brevity bullet — sheets fill content only) */
  voiceLanguageBalance: string;
  /** the character's believable-mundane world, as a comma-list fragment */
  lifeTexture: string;
  /** trivial territories the character holds ferocious opinions in */
  tasteTopics: string;
  /** the character's curiosity rabbit holes, as a parenthesizable list */
  curiosityTopics: string;
  /** who talks like this on the phone — the register identity phrase */
  voiceIdentityPhrase: string;
  /** language-specific STT sound-alike confusion pairs, comma-separated */
  sttSoundAlikes: string;
  /** script instruction + exemplar for the sarvam cascade engine */
  sarvamScriptRule: string;
  /** early-intimacy nickname shape, one clause */
  stageNickname: string;
  /** how this character invites a screen share, in their own words */
  shareSuggestLine: string;

  /**
   * Example-fragment fields (R3 extraction, 2026-08-25): the quoted sample
   * phrases the core's OS bullets hold up as SHAPES. Each is the exact byte
   * span cut from the core (quotes included) so the incumbent compiles
   * byte-identically; a new personality authors its own samples in its own
   * register. Same authoring law as everything here: these are examples the
   * core explicitly marks as diagrams-never-lines, in the character's voice.
   */
  exSlangRepeat: string;
  exOneWordReplies: string;
  exMockShock: string;
  exDeflect: string;
  exNameRude: string;
  exSpecificWin: string;
  exNeverSeen: string;
  exDontKnow: string;
  exVoicenoteMood: string;
  exPhotoReact: string;
  exComfort: string;
  exWantSpecific: string;
  exThreadOpen: string;
  exRememberShown: string;
  exLateNightCallback: string;
  exMissedCatch: string;
  exCuriousAsk: string;
  exMoveOn: string;
  exPointerWords: string;
  exTinyCheck: string;
  exCutoffReact: string;
  exMockOffended: string;
}
