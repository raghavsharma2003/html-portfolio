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

/**
 * The ARC-OVERRIDE seam (SPEC-GURUKUL.md §2, "Inherited with parameterization":
 * *"Stage paragraphs / rituals / currency: the mechanisms stay; the content
 * becomes sheet-suppliable optional overrides (absent → today's bytes,
 * preserving the 83-fixture byte-identity gate for Maya)."*)
 *
 * Every field here is OPTIONAL and every one of them is read in persona.ts as
 * `${C.field ?? DEFAULT}` (or `?? ""` for the two additive ones). A sheet that
 * supplies none of them compiles to the byte the incumbent compiles today —
 * that is the gate, not a hope: `scripts/check-prompt-budget.mjs` runs the
 * 83-fixture byte-identity battery and Maya supplies none of these.
 *
 * WHY THE SEAM EXISTS AT ALL, stated so it is not widened by accident: the
 * incumbent's relationship arc is a ROMANTIC-COMPANION arc — it escalates
 * intimacy with message count and its boundary paragraph carries a live
 * "warmth can deepen naturally" clause. A teacher clone whose users are
 * mostly minors may not inherit that content (docs/gurukul/
 * safety-floor-teacher.md §3.1: the clause is *deleted from the content*, not
 * merely gated, because `GATE_CONFIG.unverified` can be misconfigured and two
 * independent layers is the house rule). So these are not styling knobs. The
 * three stage fields and `boundaryParagraph` are the four a teacher module
 * MUST supply, and `teacherTypes.ts` re-declares all of them as required.
 *
 * Authoring law is unchanged and applies with extra force here, because these
 * are the longest fragments a sheet can carry: `persona.ts`'s own core prose is
 * instructional English and is exempt from the content-row lints
 * (`shapelint.ts:10-18`), so a REPLACEMENT for a paragraph of it may be prose
 * too — but every example inside it is a shape, a token list or an arrow
 * diagram, never a clause the character could say (`context/rejected.md`
 * `recited-prompt`, measured twice: 4/5 turns recited, and taste-as-sentences
 * read out verbatim eight turns apart).
 */
export interface ArcOverrides {
  /** replaces the stage-1 paragraph (msgCount < 30, dims new/warming) */
  stageEarly?: string;
  /** replaces the stage-2 paragraph (30 ≤ msgCount < 150, dims settled) */
  stageGettingClose?: string;
  /** replaces the stage-3 paragraph (msgCount ≥ 150, dims close/deep) */
  stageEstablished?: string;
  /** replaces the ROMANCE BOUNDARY paragraph wholesale — the one override
   *  that is a safety delta rather than a character delta */
  boundaryParagraph?: string;
  /** the parenthesised SHAPES of a pattern worth christening, inside the
   *  ritual bullet — the mechanism (india.ts `dueRituals`, 20h spacing,
   *  cold_last exclusion) is untouched; only the examples are sheet content */
  ritualPatternShapes?: string;
  /** APPENDED to the never-name-what-they-have bullet (`?? ""`): the
   *  ability-label ban, which a teaching relationship needs and a companion
   *  one does not (docs/gurukul/teacher-arc.md §2.2 — handing a 16-year-old a
   *  category for their own capability is a diagnosis, and a stickier one) */
  abilityLabelBan?: string;
  /** APPENDED to the specifics-not-volume win bullet (`?? ""`): praise the
   *  METHOD, never the ability (teacher-arc.md §3.2 — the category of praise
   *  changes what the student attempts next) */
  winMethodRule?: string;
}

export interface CharacterSheet extends ArcOverrides {
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
  exNeverTyped: string;
  exGetInterested: string;
  exNameTheMiss: string;
  exNoHolding: string;
  exSearchHold: string;
  exCorrections: string;
  exSelfFix: string;
  exResurrect: string;
  exWatchOpinions: string;
  exScreenWarn: string;
  exQuickPickup: string;
}
