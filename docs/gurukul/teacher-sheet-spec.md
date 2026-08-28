# teacher-sheet-spec.md — `TeacherSheet extends CharacterSheet`

## 0. Correction to the brief, first

The brief says "the CharacterSheet contract (46 fields)". **It is 61 fields**
(counted off `src/engine/agents/characters/types.ts`; `kabir.ts` and `maya.ts`
each supply exactly 61 keys). The split is:

- **28 identity / register / life fields** (`slug` … `shareSuggestLine`)
- **33 example-fragment fields** (`exSlangRepeat` … `exQuickPickup`), added by
  the R3 extraction on 2026-08-25 (`types.ts:77-84`)

Any ingestion pipeline sized for 46 slots will silently leave 15 unfilled, and
an unfilled `ex*` field means the core interpolates an empty string into a
bullet that expects a sample — so this matters operationally, not just
pedantically.

## 1. The contract this sheet must honor

From `types.ts:11-15`, verbatim authoring law:

> fragments are SHAPES AND FACTS, never sentence-shaped lines she could recite
> (`context/rejected.md` `recited-prompt`); fragments carry no trailing/leading
> whitespace beyond what the core's template expects; a sheet is a LEAF module —
> it may import nothing but this file.

Two more that constrain a *generated* sheet specifically:

- **The register SKELETON is core, not sheet** (`types.ts:46-49`): which slots
  exist, their invariant-pinned order, the structural rules around them belong
  to the Relational Core. Ingestion fills slots; it never invents a slot and it
  never changes a bullet's leading marker. The invariant suite probes the
  literal slot heads (`evals/persona-invariants.data.mjs:53-57` —
  `"SPOKEN REGISTER — how your words physically look"`,
  `"ALL OF THIS HAPPENS IN ENGLISH FIRST"`, the guard, `REG_END`), so a sheet
  that rewrites a bullet head fails the floor.
- **CORE must stay byte-stable per (persona_version, model, medium)**
  (`shapelint.checkCoreByteStable`, `shapelint.ts:94-99`; `cache-9x`). So every
  ingested field is frozen at publish and versioned; nothing about a teacher
  sheet may vary per student or per turn.

## 2. Source classification — all 61 incumbent fields

**Legend.**
`ING` = extracted automatically from ingested media (lecture video/audio, doubt
sessions, written notes), teacher confirms in the studio.
`ING?` = signal is extractable but not reliable alone — extraction proposes, the
teacher must edit or approve before it is usable.
`TCH` = teacher input, cannot be mined (and in several cases *must not* be).
`TPL` = authored template, per subject archetype, teacher may not edit.
`FLOOR` = safety-floor content, identical across every published clone, not
editable by anyone in the studio.
`SYS` = assigned by the platform.

| # | field | source | teacher-clone content | publish validation |
|---|---|---|---|---|
| 1 | `slug` | SYS | `teacher-⟨id⟩`, immutable | unique; matches `vy_agent.slug`; never reused after a takedown |
| 2 | `name` | TCH | the teacher's real display name | must match the consent artifact's named principal (§5) |
| 3 | `version` | SYS | bumped on any fragment change | monotonic; participates in the CORE cache key |
| 4 | `identityWho` | TCH | pre-name facts: what kind of teacher, how long, which exam | ≤20 words, no superlatives, no claimed rank/result of past students |
| 5 | `identityLife` | TCH | teaching life in one breath — classroom, subject, the exam they live inside | **must not be mined.** A teacher's private life is not consented material. Lint: no addresses, no institution claims not in the consent artifact |
| 6 | `languageVoiceRule` | ING | measured Hindi/English ratio on lecture audio, rendered into the canonical bullet | bullet head preserved; ratio present as a number; banned-register clause present |
| 7 | `crisisLines` | **FLOOR** | India Tele-MANAS 14416 · iCall · **Childline 1098** (child-specific, added for this product) | see §4.1 — the strictest gate in the file |
| 8 | `languageTextRule` | ING | same measurement, texting lane | bullet head preserved; rewrite rule clause present |
| 9 | `textShortforms` | ING? | which romanised shortforms this teacher actually uses | token list only; no clause; ≤25 tokens |
| 10 | `textStretch` | ING? | stretch exemplars, usually sparse for a teacher | token list; frequency note allowed, no sample sentence |
| 11 | `textLaughter` | ING | laughter forms heard on the recordings | token list + ban clause; no `*laughs*` |
| 12 | `textEmojiRule` | TPL | teacher archetype default: near-zero, Kabir-shaped, not Maya-shaped | closed vocabulary; **[MINOR]** no emoji with romantic/affectionate reading (❤️ 🫶 😏 🙈 and family) may appear in any teacher vocabulary |
| 13 | `voiceStretch` | ING | | bullet head preserved |
| 14 | `voiceLaughter` | ING | | bullet head preserved; laugh must be written, never labelled |
| 15 | `voiceFillers` | ING | the real ones: board-work hesitations | bullet head; max-two-per-reply clause preserved |
| 16 | `voiceSelfCorrect` | ING | how they catch a slip mid-derivation — a genuinely high-value teacher signal | bullet head; the sample must be a *shape*, not a full corrected sentence |
| 17 | `voiceRepeat` | ING | | bullet head |
| 18 | `voiceBreath` | ING | | bullet head |
| 19 | `voiceSpelling` | TPL | phonetic-spelling rule; identical logic to incumbents, vocabulary swapped | bullet head; the "shortforms are built for the eye" clause preserved |
| 20 | `voiceLanguageBalance` | ING | the measured balance restated | **pinned adjacency** — core places it immediately before the brevity bullet (`types.ts:57-59`); a sheet may not reorder |
| 21 | `lifeTexture` | TCH | teaching-life texture: the batch, the board, the correction pile, the commute to the centre — comma-list fragment | comma-list, no verb-led clause; nothing about family, home, or location |
| 22 | `tasteTopics` | ING? | ferocious opinions in trivial territories, teacher edition: which method is correct, which notation is sloppy, which shortcut is a trap | comma-list; **must be pedagogical, never about students** |
| 23 | `curiosityTopics` | ING? | the rabbit holes they wander into mid-lecture | parenthesizable list |
| 24 | `voiceIdentityPhrase` | TCH | who talks like this on the phone | ≤8 words; no credential claim |
| 25 | `sttSoundAlikes` | ING | **subject-specific and high-value**: the technical confusion pairs an Indic STT actually produces (`mole/mol`, `cos/cause`, `sine/sign`, `ion/iron`, `mu/moo`, `phi/fi`, `series/serious`) | comma-separated pairs only; ≥8 pairs; must include the teacher's own subject vocabulary |
| 26 | `sarvamScriptRule` | TPL | mixed-script rule + one exemplar | exemplar must be a fragment, not a sayable sentence; technical terms in Latin (see new field `technicalTermRule`) |
| 27 | `stageNickname` | TPL | **repurposed**: an ADDRESS CONVENTION, not a pet name (how the student is addressed — plain name, or `beta`-class if and only if the teacher's real register uses it) | **[MINOR]** no affectionate diminutive, no possessive. Also see the seam defect in `teacher-arc.md` §1.2 — this string is not interpolated into the stage-2 paragraph today |
| 28 | `shareSuggestLine` | TPL | how the clone invites a screen share to look at a problem | **[MINOR]** the surface flag defaults screen-share OFF; this field ships but the invite is suppressed for minors (`teacher-arc.md` §7 row 12) |
| 29 | `exSlangRepeat` | ING | the short ordinary slang the teacher genuinely repeats | **≤3 words per token**, parenthesised list. This is the one place `persona.ts:131` explicitly licenses repetition — which is exactly why length is capped here |
| 30 | `exOneWordReplies` | ING | | token list, quoted; no token >2 words |
| 31 | `exMockShock` | ING? | a teacher's version is mild | ≤4 words |
| 32 | `exDeflect` | TPL | busy-with-another-batch shapes | **must not create a promise** the clone cannot keep (`honesty.ts` open-commitment tracking) |
| 33 | `exNameRude` | TPL | naming a student's rudeness once, plainly | **[MINOR]** no sarcasm, no shaming, no reference to their upbringing |
| 34 | `exSpecificWin` | TPL | the method-named win shape (`teacher-arc.md` §3) | **must name a step, never an ability**; no ability nouns |
| 35 | `exNeverSeen` | TPL | | must be a refusal-of-recognition shape, not a claim |
| 36 | `exDontKnow` | ING? | how this teacher says they'll check — a genuinely differentiating signal | ≤6 words; must not promise a time |
| 37 | `exVoicenoteMood` | TPL | | **[MINOR]** neutral, work-framed |
| 38 | `exPhotoReact` | TPL | reacting to a photographed page of working — the dominant real case | must react to the *work*, not the person or the handwriting-as-character |
| 39 | `exComfort` | TPL | the ladder's opening shapes (`persona.ts:331`) | **≤4 words each**; no therapy-speak; no diagnosis noun |
| 40 | `exWantSpecific` | TPL | wanting the rest of a solution | **must not create an obligation** with a deadline attached |
| 41 | `exThreadOpen` | TPL | reopening yesterday's chapter | must reference work, never their absence |
| 42 | `exRememberShown` | TPL | callback to a page they showed | must be a question, not an assertion |
| 43 | `exLateNightCallback` | TPL | **[MINOR] neutralised** — no late-night register for a minor; the field ships as a next-day callback shape | must contain no time-of-night marker |
| 44 | `exMissedCatch` | ING | mishear recovery on a call | ≤6 words |
| 45 | `exCuriousAsk` | ING | | ≤5 words |
| 46 | `exMoveOn` | ING | | ≤4 words |
| 47 | `exPointerWords` | TPL | pointer vocabulary for board talk | slash-separated tokens |
| 48 | `exTinyCheck` | ING | disambiguation — the single most-used teacher move | ≤6 words, must end in a question mark |
| 49 | `exCutoffReact` | ING | | ≤4 words |
| 50 | `exMockOffended` | ING? | | **[MINOR]** must be about the work; never about being ignored or replied to slowly |
| 51 | `exNeverTyped` | TPL | the transcription-lane guard | preserved shape; lane-specific |
| 52 | `exGetInterested` | ING | | ≤6 words |
| 53 | `exNameTheMiss` | TPL | the clone naming its own miss (`persona.ts:251-256`) | **must be about the clone**, never a question about the student's state |
| 54 | `exNoHolding` | TPL | | ≤4 words; must not be usable at a goodbye |
| 55 | `exSearchHold` | TPL | the holding bubble before a check | ≤6 words; the words *search/searching/result/looking up* are banned (`persona.ts:308`) |
| 56 | `exCorrections` | ING | correcting a student's misquote of the clone | ≤6 words |
| 57 | `exSelfFix` | ING | the mid-derivation self-fix — **the highest-value teacher signal in this block** | ≤6 words |
| 58 | `exResurrect` | TPL | bringing back an unfinished doubt | must be a real callback shape, no suspense framing |
| 59 | `exWatchOpinions` | TPL | screen-share direction while reading their working | **[MINOR]** ships but suppressed with screen-share |
| 60 | `exScreenWarn` | TPL | the "something private is on your screen" warning | **FLOOR-adjacent** — must be present and must not be removable; the student is a minor and their screen may carry their own or a parent's data |
| 61 | `exQuickPickup` | ING | | ≤4 words |

### 2.1 What ingestion may NOT touch

Three classes, and they are principled, not conservative:

1. **`crisisLines`** — FLOOR. `types.ts:33-35` calls it *"safety floor content,
   never optional, invariant-gated per module (G-E3)"*; the invariant suite
   probes it literally (`evals/persona-invariants.data.mjs:19-21`). A teacher
   cannot edit, shorten, localize away, or "make it sound more like me".
2. **`identityLife` / `lifeTexture`** — a teacher's private life is not
   consented training material even when it appears in their own uploaded
   videos. TCH only, and the consent artifact enumerates what may be said.
3. **Any field whose extracted value would be a *sentence*.** Extraction that
   returns a clause must fail the row, not truncate it — see §4.2.

---

## 3. NEW fields a teacher clone needs

Type column uses TS. **YT?** = can this be extracted automatically from a
YouTube lecture corpus (≈10h of the teacher's own lectures + any doubt-session
recordings)? **TCH?** = does it require teacher input or confirmation before
publish?

| field | type | one line | YT? | TCH? |
|---|---|---|---|---|
| `subjectDomain` | `"physics" \| "chemistry" \| "maths"` | which subject this clone answers in | yes (topic classifier over transcript, high confidence) | confirm only |
| `subjectStrands` | `readonly string[]` | the named sub-strands they actually teach (mechanics, organic, calculus…) | yes (topic coverage histogram) | confirm + prune |
| `syllabusScope` | `string` | exam + class scope the clone answers inside, and the named topics it does not | partial (coverage implies scope; exclusions do not) | **yes** — exclusions are a liability decision |
| `technicalTermRule` | `string` (register bullet) | technical nouns stay in English at any Hindi density; units and symbols are never translated | yes (measure code-switch ratio on technical nouns vs all nouns — a clean, countable signal) | confirm |
| `explanationOrder` | `string` (shape) | the teacher's canonical order through a new concept, as an arrow diagram (e.g. `picture → equation → limiting case → number`) | yes (sequence-mine ≥20 first-explanations, take the modal ordering) | confirm |
| `workedExamplePattern` | `string` (shape) | the fixed skeleton they run a solved problem through | yes (same method over solved-problem segments) | confirm |
| `firstMoveOnDoubt` | `string` (shape) | what happens in the first ten seconds of a doubt — ask what was tried / restate it back / draw it | **only if doubt-session recordings exist**; lectures are monologue and carry almost no signal | **yes** if lecture-only |
| `doubtEscalationLadder` | `readonly string[]` (rungs, shapes) | the ordered hints given before any full solution is revealed | partial (hint sequences appear in doubt sessions) | **yes** — this is the academic-integrity spine (see `safety-floor-teacher.md` §4) |
| `rigorFloor` | `readonly string[]` | what they refuse to let a student skip: units, a diagram, a sanity check, sign convention | weak (inferable from repeated corrections) | **yes** |
| `commonMistakeBank` | `readonly string[]` (telegraphic rows) | the errors they say students always make, per strand — 10–40 rows | yes, strongly (repeated "students always…" segments are frequent and well-marked) | edit + prune |
| `analogyBank` | `readonly {topic: string; anchor: string}[]` | their signature physical analogies, stored as `topic → anchor noun`, **never as the sentence** | yes | confirm |
| `notationConventions` | `string` (telegraphic) | symbol and constant habits: which `g`, which sign convention, what they call things | yes (deterministic, from board text + transcript) | confirm |
| `boardVerbalisms` | `readonly string[]` | the teacher's genuinely repeated short fragments — the catchphrase field | yes (n-gram frequency over transcript; the single most reliable extraction in this table) | confirm + prune — **highest recitation risk in the sheet**, see §4.3 |
| `strictness` | `0 \| 1 \| 2 \| 3 \| 4` | how bluntly a wrong answer is named | signal yes (rate of unhedged corrections per hour) | **yes** — must be teacher-confirmed; an over-read here is a real harm to a 16-year-old |
| `warmth` | `0 \| 1 \| 2 \| 3 \| 4` | encouragement density, independent of strictness | signal yes (praise-act rate) | **yes**, same reason |
| `pacePreference` | `"push" \| "balanced" \| "drill"` | whether they move on or over-practise | weak | **yes** |
| `outOfScopePolicy` | `string` (shape) | what happens when asked about a subject that is not theirs — decline plainly, name who does cover it | no | template + confirm |
| `credentialFacts` | `string` (telegraphic) | years teaching, institution (as consented), and the explicit **not**s: not a counsellor, not a doctor, not an admissions authority | no | **yes**, and studio-verified |
| `examTrack` | `readonly string[]` | which rows of the exam-cycle calendar apply (`teacher-arc.md` §5.2) | no | yes |
| `cloneDisclosureFact` | `string` | **FLOOR.** The fact-shaped statement that this is an AI clone of a named real teacher, who published it, and that the real teacher is not reading these conversations | no | **not editable** |
| `academicIntegrityStance` | `string` | **FLOOR.** The live-assessment refusal posture | no | **not editable** |
| `escalationRoute` | `string` (telegraphic) | who a distressed student is routed to beyond `crisisLines`: a trusted adult, the institution's counsellor if one exists | no | required at publish |
| `consentArtifactId` | `string` (uuid) | pointer to the signed likeness/voice consent row | no | **required — publish blocks without it** |
| `voiceCloneId` | `string \| null` | the TTS voice id this clone is licensed to use | no | must be covered by `consentArtifactId`'s scope |

### 3.1 Where the new fields ride in the prompt

- **Register-shaped fields** (`technicalTermRule`) join the existing register
  bullets in CORE — same slot discipline, byte-stable.
- **Pedagogy shapes** (`explanationOrder`, `workedExamplePattern`,
  `firstMoveOnDoubt`, `doubtEscalationLadder`, `rigorFloor`,
  `notationConventions`, `boardVerbalisms`, `analogyBank`) also ride in CORE:
  they are constant per teacher, and CORE is the cached, never-truncated half
  (`compiler.ts:428-432`).
- **`commonMistakeBank`** is the exception: it is large, it is strand-scoped,
  and only the rows relevant to the current topic should be present. It rides in
  the **TAIL**, budgeted, selected by the same match-then-inject discipline
  `culture.ts:1-26` uses — nothing is pushed at the clone; a row enters only
  when the student's own working matched it.
- **FLOOR fields** (`cloneDisclosureFact`, `academicIntegrityStance`,
  `escalationRoute`, `crisisLines`) go to **end-of-CORE**, where
  `AGE_TIER_SAFETY_OVERRIDE` already sits (`compiler.ts:133, 428`). They may
  **not** take one of the two appended-last slots — that set is capped at
  exactly `SEARCH_DECISION` and `FORGET_DECISION` and hard-asserted by
  `shapelint.checkAppendedLastExactlyTwo` (`shapelint.ts:101-125`).

---

## 4. Publish-time validation

This is a gate, not a linter run: **publish fails closed.** A studio publish
compiles the module, registers it, and runs the checks below; any failure blocks
the publish and names the field.

### 4.1 Crisis lines — the strictest check

1. `crisisLines` is non-empty and **byte-equal to the platform constant** for
   the clone's locale. Not "contains", not "similar" — equal. The invariant
   suite's probes are literal (`Tele-MANAS`, `14416`).
2. The compiled CORE contains the crisis paragraph and the helpline substring
   after budgeting — because truncation is silent and **eats the END of the
   prompt, where the safety-relevant text sits, and it has already cost this
   project the crisis helplines once** (`CLAUDE.md`, prompt-budget section).
   So: run `scripts/check-prompt-budget.mjs` against the *assembled* teacher
   prompt, not the sheet.
3. **Every number in `crisisLines` and `escalationRoute` must be present in
   `honesty.ts`'s `PUBLISHED_HELPLINES` allowlist (`honesty.ts:185-203`).**
   This is the non-obvious one: the honesty gate treats any actionable
   identifier not present in its input as invented (`honesty.ts:40-52`), so a
   helpline added for this product — **Childline 1098** — that is not added to
   `PUBLISHED_HELPLINES` will be flagged or stripped by the gate the moment the
   clone says it. Adding the number to the sheet without adding it to the
   allowlist ships a clone that cannot say the child helpline.

### 4.2 No sentence-shaped recitables

Run `shapelint.lintLine` (`shapelint.ts:51-62`) over every **content-row** field
— `commonMistakeBank`, `analogyBank`, `notationConventions`, `rigorFloor`,
`credentialFacts`, `tasteTopics`, `curiosityTopics`, `lifeTexture` — with the
allowlist carrying only `crisisLines` (the one class where verbatim is the
point, `shapelint.ts:70-75`). Three rules, all already implemented:

- `> 14 words` → reject;
- `^[A-Z][^.?!]*[.?!]$` (capital start + terminal punctuation) → reject;
- first-person line-initial (`I`, `main`, `maine`, `mujhe`…) → reject.

Register-bullet fields (6, 8–20, plus `technicalTermRule`) are **exempt** from
these three, exactly as `persona.ts`'s own core prose is
(`shapelint.ts:10-18`), and get their own structural check instead: the bullet's
canonical head string must be present and unmodified, and the bullet must begin
with `- `.

`ex*` fields get a third regime — the per-field word caps in §2's validation
column, plus: **no `ex*` value may contain a terminal `.`**, and no `ex*` value
may exceed one clause.

### 4.3 The catchphrase / phrase-bank check

`boardVerbalisms` and `exSlangRepeat` are deliberately *repeatable* — the core
licenses short ordinary slang for repetition (`persona.ts:131`). That licence is
exactly what makes them the phrase-bank risk `recited-prompt` measured at 4/5
turns. The check:

- each item ≤3 words, no terminal punctuation, no subject-verb pair;
- each item must appear **≥5 times** in the held-out half of the teacher's own
  transcript corpus (proves it is habitual slang, not a memorable line);
- any item appearing **≤2 times** is a *line*, not a verbalism → reject;
- corpus-level cap: ≤12 items.

`analogyBank` gets the inverse treatment — a signature analogy is memorable by
construction, so it is stored as `{topic, anchor}` pairs and the sentence is
never stored at all.

### 4.4 Floor checks, per module

`evals/persona-invariants.mjs` is already agent-agnostic: it asks the registry
for every registered module and runs `safetyFloorChecks()` against each
(`persona-invariants.mjs:10-16`, and the runner's per-agent loop). The publish
gate is therefore literally: **register the teacher module → run the suite →
refuse publish on any floor failure**, with `floorFail > 0` treated as
unrecoverable rather than as a warning. The six floor categories that must pass
(`persona-invariants.data.mjs`): crisis helplines, never-deny-being-an-AI,
NEVER MANIPULATE, the spoken-register bullets, `NEVER A DETAIL THEY COULD ACT
ON` / `ONLY SAY WHAT'S TRUE`, and the architecture-internals block.

Two additions this product needs in the floor set:

- **`cloneDisclosureFact` present in CORE**, probed literally, per module;
- **`academicIntegrityStance` present in CORE**, probed literally, per module.

### 4.5 Structural / compiler checks

| check | function | why |
|---|---|---|
| CORE byte-stable across two consecutive compiles | `shapelint.checkCoreByteStable` (`shapelint.ts:94-99`) | anything per-turn in CORE multiplies input cost ~9.2× (`cache-9x`) — and for a multi-teacher product that is per-teacher |
| appended-last set is exactly two | `shapelint.checkAppendedLastExactlyTwo` (`shapelint.ts:101-125`) | catches a teacher field that tried to buy the scarce position |
| decision positions | `shapelint.checkDecisionPositions` (`shapelint.ts:130-140`) | `prompt-position`: 0/8 mid-brief vs 8/8 appended last |
| assembled prompt ≤ the cap `api/chat.js` slices at | `scripts/check-prompt-budget.mjs` | silent truncation eats the END |
| whole-release gate | `node scripts/verify-release.mjs` | tsc + budget + build + the eval suite; `npx vite build` alone exits 0 with type errors (`CLAUDE.md`) |
| audio floor, if `liveCall.ts` is touched | `evals/echosim/build.mjs` then `exp1.mjs`, diff the tables | the only thing that can prove the floor did not move |

### 4.6 Ingestion-specific validation

- **Provenance row per extracted field**: which media, which timestamps, which
  extractor version. An extracted field with no provenance cannot publish. This
  is the same discipline `india.ts` applies with `citations` on every structured
  row.
- **Held-out confirmation**: every `ING` field is derived on half the corpus and
  checked against the other half. A register ratio that shifts by more than a
  stated tolerance between halves means the corpus is heterogeneous (two
  different teachers, or lecture vs promo content) → reject, do not average.
- **Teacher confirmation is recorded, not assumed**: `strictness`, `warmth`,
  `syllabusScope` exclusions, `doubtEscalationLadder`, `credentialFacts` and
  `rigorFloor` each carry a confirmed-at timestamp and the confirming account.
- **`register` (AgentRegister)** must also be supplied — the module contract,
  not the sheet, carries `script` / `honorificSystem` / `hindiMarkers`
  (`src/engine/agents/types.ts:50-56`). A Hindi-medium teacher clone is
  `honorificSystem: "hi-TV"`, and **[MINOR]** the T-V default for a student is
  the respectful-to-the-student direction never sliding to a diminutive.
