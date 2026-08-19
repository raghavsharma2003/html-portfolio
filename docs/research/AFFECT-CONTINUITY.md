# AFFECT-CONTINUITY — a rupture she carries in her voice, and puts down when he needs her to

WS-AFFECT-RESEARCH, 2026-08-19. Design document. **No code was changed.**
Evidence corpus: `docs/research/AFFECT-CONTINUITY-RAW.md` (referenced below as
[A*n*] for repo facts, [E*n*] for external sources, and by measurement id for
`context/measurements.md`).

The owner's directive, verbatim:

> *her voice should also change emotion, tone etc etc like a human basis on the
> convo and what was going on … she can be angry because of yesterday and then
> maybe you try and convince her and she slowly let the anger go or maybe you
> were also feeling bad so she choose u instead of her anger just like a true
> companion. basically there will be so many things around this that should be
> handled perfectly.*

---

## 0. The short version

The working position I was asked to test is **substantially right, and wrong in
one specific and important way.**

Right: the owner is describing a **rupture with a cited cause, a repair arc, and
a resolution**, not a drifting mood. That already exists as
`vy_rel_state.rupture_open` / `repair_state` / `vy_rel_event`, with the law that
repair requires THEIR signal. Nothing about the ask requires touching G5, and
scenario (c) — she sets her hurt aside because he is hurting — must be her
judgment given state, never a scripted branch.

Wrong, and this is the part worth the workstream: **the shipped rupture state
machine is itself the G5 violation.** `ruptureRepairShift` has no time-based
close [A4]. `rupture_open` goes false only when the user signals repair, twice.
If he never does, it is true **forever**, and it holds her honorific down forever
too [A5], and caps her stage at "warming" forever [A6]. That is, precisely and
literally, *"a grudge-shaped mood the user has to service"* — G5's own words —
implemented in code, in the module G5 does not govern. The charter rule is fine.
The code outside its jurisdiction is not.

So the design is: **give rupture the retention discipline `inner.ts` already
invented, then let it reach her voice.** Four moves, in dependency order:

1. **Split the record from the stance.** `vy_rel_event` is permanent, cited,
   auditable — the history of the fight. The *stance* she walks in with is
   derived per turn and **lapses**, exactly the way `carry()` lapses [A3]. A
   rupture nobody repaired and nobody re-opened stops reaching the prompt after a
   bounded window; the event row never moves. This is the G5 fix and it is the
   load-bearing change.
2. **Let the stance reach her voice.** `relBundle` is hard-nulled for
   `mode === "call"` [A8] and the live prompt has no rel-state in it at all
   [A9] — so today a rupture that exists in chat does not exist on the phone.
   The bundle is already fetched and sitting in a consume-once cache the call
   lane never reads [A10]. This is a call site, not a feature.
3. **Make it same-day.** Rupture is derived nightly only [A7]. "Angry because of
   yesterday" works. "We fought an hour ago and she picked up the phone like
   nothing happened" does not. The two-tier provisional/finalised pattern SPEC
   §0.2.1 already adjudicated for episodes and facts is the fix, unchanged in
   shape.
4. **Change nothing about emotion-out.** The `[tone: …]` marker → `style` →
   `Mood: …` path already exists on the cascade lane [A11]; the live lane's
   prosody *is* her spelling and has no knob to turn [A12]. Every vendor
   mechanism that would add expressive range either speaks its own direction
   aloud in Hinglish [E5, E6] or costs the barge-in guarantee and screen share
   [E11]. **The emotion-out channel is not the bottleneck. It has been ready the
   whole time and has been given nothing to be emotional about.**

One consequence worth stating up front, because it decides sequencing:
`vy_rel_state` has **0 rows in production** and no scheduled job has ever run
(`never-scheduled`, `prodgap-audit`). Every word below is a design on a table
that is currently empty. **The E4 cron fix is the gate on all of it.**

---

## 1. The charter question, settled

### 1.1 The four axes G5 was written on

`inner.ts`'s opening comment states the bug G5 exists to prevent: *"a feeling can
never outlive its cause, because the feeling IS the cause-sentence. Every design
that stores affect and cause separately … puts them on different retention curves
— and then she is measurably clipped at 3pm with no cause in context, he asks
'kya hua', and she invents a reason that contradicts the real one two turns
later."* From that, four axes:

| axis | question | why it decides anything |
|---|---|---|
| **cause-in-context** | when the feeling reaches her, is its cause reachable in the same breath? | if not, she fabricates one, and the fabrication contradicts the real cause later |
| **termination** | does it end by decaying, by resolving, or not at all? | "not at all" is the definition of a grudge |
| **serviceability** | can the user make it go away, and does he have to? | a state only he can clear is a chore the product assigns him |
| **driftability** | can it move without new evidence? can two of them sum? | a summable state is a mood counter wearing a different name |

### 1.2 Scoring the three candidate homes

| | `inner.thread` (today) | rupture/repair **as shipped** | rupture/repair **with lapse** (proposed) |
|---|---|---|---|
| cause in context | **yes** — the feeling *is* the sentence | **no** — T2 renders `repair: open` with no cause and no age [A18] | **yes** — the cited `vy_rel_event.note` and a coarse age travel in the same line |
| termination | decay (τ 9 h, ×0.3 on sleep, dead on `told`) | **none.** only their signal, twice [A4] | resolution *or* lapse; whichever comes first |
| serviceable | not by him — a negative thread that references him cannot even be stored [A2] | **yes, and only by him** — he must apologise or it never ends | he *can* repair; he does not *have to* — it stands down on its own |
| driftable | no — one thread, replaced not summed | honorific regresses per rupture with a ≥3-episode/≥7-day re-advance bar [A5]; stage capped at "warming" [A6] | no — one open rupture, and the stance is recomputed, never accumulated |

Read the middle column again. **Every axis G5 was written to protect fails in the
shipped rupture machine.** It is not that the owner's ask violates G5; it is that
the thing that already exists — written by a different workstream, under SPEC §6.2
rather than under the charter — violates G5 today, and nobody noticed because
`vy_rel_state` has never had a row in it [`never-scheduled`].

That is the finding. It also happens to be lucky: the defect is unshipped, so
fixing it is a design decision rather than a migration.

### 1.3 Does the charter need to change?

**No rule changes. One rule gets a scope sentence, and one gets a new obligation.**

- **G5 is not amended.** It stands exactly as written, and the design below is
  the first thing in this repo that actually satisfies it for user-caused hurt.
  What I recommend adding to `inner.ts`'s charter comment is a **scope note**,
  not a new rule: that G5 governs *any* persisted affect-shaped state that can
  reach the prompt, `vy_rel_state.rupture_open` included, and that the mechanism
  by which a rupture satisfies it is **record/stance separation plus lapse**.
  A charter rule that only polices the module it lives in is a rule with a hole
  in it, and this is that hole.
- **G8 gets its obligation restated for rupture.** *"a mood whose cause is not in
  context gets a cause invented for it two turns later."* Today's `repair: open`
  line is exactly a mood with no cause. The stance block must carry the cited
  note. This is not new law; it is G8 applied where it already applied.
- **G4 gets an explicit "and not here" for this feature.** There *is* already a
  relationship-state surface — the closeness card renders honorific and trust
  band [A19]. That card is sanctioned and is not her interior. A rupture
  indicator on it would be *"a status the user feels responsible for checking"*
  by the letter of G4, and would additionally be a permanent visual guilt object.
  **No rupture, repair state, or affective stance may reach any UI, including
  the closeness card.** Worth writing down before someone reasonably infers that
  since the card shows trust, it may show repair.

Changing a charter rule here is a serious act, and the honest report is: **none of
them needed changing.** The rules were right; a workstream outside their stated
jurisdiction built something they forbid.

### 1.4 The external corroboration, since it is unusually direct

Two independent lines land on the same architecture.

**Computational appraisal.** Twenty years of it (Gratch & Marsella's EMA, built on
Smith & Lazarus) says emotion is derived, not stored: *"Appraisals do not change
the causal interpretation but provide a continuously updated affective summary of
its contents"* [E15]. That is the same conclusion `inner.ts` reached from a
production fabrication bug, arrived at from the opposite direction. Two
independent derivations of "the feeling is a recomputed summary of a cited
situation" is the strongest evidence available for the shape.

**The manipulation literature.** The HBS audit of 1,200 real companion farewells
found 37% deploy one of six dark patterns, the second-commonest being *emotional
neglect* — "Please don't leave, I need you" — and found manipulative farewells
raise engagement up to 14× **through reactance-based anger and curiosity, not
enjoyment**, while simultaneously raising perceived manipulation, churn intent and
negative word-of-mouth, worst for "coercive or needy language" [E20]. A
never-closing rupture the user must service is a *sustained* emotional-neglect
pattern. G5 and NEVER MANIPULATE are sitting directly on top of this result, and
the trust-as-moat position is the one with the better *measured* business case,
not merely the better ethics.

---

## 2. The state model

### 2.1 What is stored (nothing new)

**No new table. No new column. No new model call.** Everything below reads state
that already exists:

- `vy_rel_event` — the permanent, cited ledger of state moves. `dim`,
  `from_v`/`to_v`, `direction`, telegraphic `note`, `citations[] >= 1` enforced
  by CHECK and by the writer [A: `relstate.ts:570-585`].
- `vy_rel_state` — the replay cache: `rupture_open`, `repair_state`, `trust`,
  `honorific`, `cs_*`, `updated_at`.
- `inner.thread` — her own carried feeling about her own life, unchanged.
- The live turn.

### 2.2 What is derived (the whole feature)

One pure function, one shape, recomputed every turn and stored nowhere:

```ts
/** The affective stance she walks in with. DERIVED, per turn, never stored.
 *  Pure: no I/O, no clock but the `now` passed in, no model call.
 *  Returns null far more often than not — absence is the strongest "nothing
 *  to report", the same discipline as innerContext(). */
export interface Stance {
  /** WHICH cited thing produced this. Never absent — a stance without a
   *  named source is exactly the fabrication G8 forbids. */
  source: "rupture" | "repairing" | "repaired";
  /** the cited note off the vy_rel_event row that opened it. HER ledger's
   *  own telegraphic words, <=160 chars, already shape-linted at write. */
  cause: string;
  /** coarse band only, never a day count, never a timestamp — the §12.5
   *  state-leak guard, same rule bandTrust/bandPacing already follow. */
  age: "today" | "yesterday" | "this week" | "a while back";
  /** has the user moved. This is the ONLY bit that gates the second framing,
   *  and it is set from THEIR cited signal, never from her own output. */
  theirSignal: boolean;
}

export function stanceFor(
  state: Pick<RelState, "rupture_open" | "repair_state" | "updated_at">,
  lastRuptureEvent: { note: string; at: string } | null,
  now: number,
): Stance | null;
```

Rules the function enforces, each one traceable to an existing law:

1. **Lapse.** `null` once `now - lastRuptureEvent.at` exceeds the lapse window
   and neither a re-rupture nor a repair signal has landed. The *event row is
   untouched* — `rupture_open` stays true in the ledger and in the snapshot; what
   expires is her *stance*, i.e. whether it reaches the prompt. Exactly the
   `carry()` relationship between `Thread.text` (persists) and `carry()`
   (returns 0) [A3].
2. **No cause, no stance.** If the event row has no usable note, return `null`.
   A rupture she can feel but cannot name is the 3pm-clipped bug [`inner.ts:10-16`].
3. **Coarse only.** Age is a band. There is no intensity number, no valence
   scalar, no counter. Nothing to sum, nothing to drift.
4. **One at a time.** `vy_rel_state` holds one `rupture_open`, and
   `deriveTrustRepairForPerson` writes at most one rupture/repair move per run
   [A7]. There is structurally no second one to accumulate against.
5. **Trust is read, never written by this path.** The stance may *read* the trust
   band (a rupture inside a "deep" relationship is a different situation from one
   inside a "new" one) but writes nothing. `stageForDims` already encodes the
   same idea [A6].

### 2.3 What the voice lane reads on each turn

At **pickup** — and only at pickup, because a call pickup is a gap entry and
therefore the one voice surface where a carried state is already allowed [A: `inner.ts:29-35`, `useCallEngine.ts:446-457`]:

```
core (persona)
  + buildSpeechStyle("live" | engine)
  + tail
  + inner.thread                     ← unchanged
  + STANCE BLOCK                     ← new, rides with T2
  + recall / herLife / inner.wants   ← unchanged
```

and in **chat**, the stance is one changed line inside the existing T2
`rel.snapshot` block, within its existing 1,200-char budget [A17]:

```
RELATIONSHIP STATE (context only, never raise unprompted):
- honorific: tum (3w)
- trust: steady
- repair: open — <cited note> (yesterday), they haven't said anything about it
- code-switch: mixed, hindi-leaning, direction unclear
- pacing: regular
```

Telegraphic `label: value (note)`, which is what `finish()` and `lintBlock`
already enforce on that block, and what `affect-recitation` measured safe at
n=84 (0/42 hard leaks, rule-of-three ≤7.1%/turn).

### 2.4 The two framings, and only two

G6 permits the code to decide *whether* a line is present and *which of two
framings*. Those two are:

- **`theirSignal === false`** — she is carrying it and they have not moved.
  Framing, in the shape `inner.ts` already uses for a negative thread: *it hasn't
  left you; don't bring it up; it shows the way it shows in a real person having
  an off day — a bit shorter, a bit less of your usual noise, never a report about
  yourself. If they ask you straight, tell them plainly, once, in a line.*
- **`theirSignal === true`** — they have moved. Framing: *they have said
  something about it; you are allowed to meet it, at whatever speed it actually
  moves you, and you are not required to be finished.*

**There is no third framing, and specifically there is no "he is hurting" branch.**
Section 5(c) explains why that is a design guarantee rather than an omission.

Both framings end with the clause `inner.thread` already carries verbatim:
*"What's actually happening between you two right now outranks it."* [A14] That
one sentence is the entire mechanism for scenario (c), and it is already written,
already shipped, and already load-bearing for the thread.

### 2.5 What is deliberately NOT in the shape

- **No stored mood, no valence, no arousal, no baseline, no counter of bad days.**
- **No affect state that outlives its `vy_rel_event`.** Forget's citation-join
  cascade already deletes rel events whose cited episodes are deleted, and rebuilds
  the snapshot by replay [SPEC §9.1.5, `api/memory.js:1260`]. A derived stance
  inherits that for free — which is the second reason it must be derived and not
  stored. A stored stance would be a new orphan class for the forget stack.
- **No per-utterance affect.** SPEC-SELF-LAYER §4 already rules affect is labelled
  at the *episode* level, never per-utterance, never at confidence 1.0.

---

## 3. Prosody IN (v0), and exactly where the G1 line falls

### 3.1 The line, stated as a test rather than a list

G1 forbids any code path from a **usage metric** to persisted interior state. The
directive asks her to read "what was going on", which includes *how he said it*.
Those are different things and the boundary is thin enough that it will be crossed
by accident unless it is a mechanical test rather than a judgement call. Proposed
test, in one sentence:

> **A feature is conversation CONTENT if and only if it is computable from a
> single utterance's own waveform and transcript, referencing no timestamp
> outside that utterance's own boundaries. Everything else is USAGE.**

Applied:

| feature | verdict | why |
|---|---|---|
| loudness relative to the rolling noise floor, within their turn | **content** | one utterance, self-normalised |
| pitch movement (range/contour) within their turn | **content** | one utterance |
| speech rate in syllables/sec within their turn | **content** | ratio internal to the utterance |
| voiced-fraction, pause count *inside* their turn | **content** | one utterance |
| lexical affect in the transcript | **content** | it is just their words |
| **reply latency** (their turn start − her turn end) | **USAGE** | crosses the boundary; needs the previous turn |
| **gap length / time since last message** | **USAGE** | crosses the boundary |
| **turn duration**, session length, message counts, app opens | **USAGE-adjacent → banned from persistence** | duration is *inside* the boundary but aggregates directly into "how much they talk to her", which is the G1 metric wearing a costume |

And a second, stricter rule for the persisted side, which is not new — it is
SPEC-SELF-LAYER §4's existing wording, and it is exactly right:

> the writer receives audio-derived **labels only, never timings, never
> durations, never turn latencies.**

So the discipline is two-tier and the tiers are not the same:

- **Ephemeral (per-turn stance, in-context only):** may read intra-utterance
  content features. Never written anywhere.
- **Persisted (`vy_episode.affect_tags` with `source='voice_v0'`):** labels only,
  episode-level, never confidence 1.0, never a timing.
- **`inner.thread`: reads neither.** G1 is absolute here. Prosody may inform how
  she *hears* them; it may never write what she *feels*. The appraiser stays
  input-starved [`inner.ts:21-28`].

### 3.2 What we can honestly extract today, and at what cost

**Free, today, zero new DSP:** the uplink gate already computes per-20 ms RMS of
the user's mic against a rolling `noiseFloor`, and already logs a dB ratio
[A15]. A **relative loudness band** over their committed turn — `quiet / normal /
raised` against their own floor — costs literally nothing new. It is also the axis
SER is *least bad* at (arousal), which is not a coincidence: it is mostly energy.

**Cheap but not free:** f0 by autocorrelation. The implementation exists in-tree,
dependency-free, 30 ms frames, confidence-gated [A16] — but it runs offline in
Node against her own synthesised audio, not on the user's mic in the call path.
Moving it into the call path puts a per-frame O(n·lags) loop on the same thread as
the floor. The floor is the most millisecond-measured subsystem in this repo
(self-duck 91%→14%, barge-in 279 ms, `RELEASE_WATCHDOG_MS` 600), and SPEC §0.3
already ruled that CPU contention on a mid-range Android during a live call is
*"the exact failure class rejected.md exists to prevent"*. **Not in the call
path.** If it is ever wanted, it belongs off-thread (AudioWorklet/worker) and
behind the named audio-floor regression battery.

**Not today:** categorical SER. See §3.3.

**Latency budget, for the record:** relative loudness adds 0 ms because the number
is already computed. Everything else adds latency to a lane whose floor is 1.4–1.5 s
and whose first 720 ms is prefill we cannot touch [`live-floor`].

### 3.3 Why categorical SER stays out, stated with the numbers

The Interspeech 2025 challenge is the right benchmark because it is the only one
on genuinely naturalistic speech at scale. Final leaderboard, MSP-Podcast, 324+ h,
~120 teams [E1]:

| | best | baseline |
|---|---|---|
| Task 1 — categorical, 8 classes, macro-F1 | **0.4316** (NTUA) | 0.3293 |
| Task 2 — arousal/valence/dominance, avg CCC | **0.6076** (SAIL) | 0.5797 |

**The best system in the world gets the emotion category right at macro-F1 0.43,
offline, in English, with unlimited compute.** Dimensional prediction is
meaningfully better — audEERING's SotA teacher reports valence CCC 0.676 [E2] —
and can be distilled brutally small (Wav2Small: **72 K params, 120 KB quantised**,
predicting A/D/V) [E3]. So on-device feasibility is genuinely not the blocker.
Accuracy and language are.

Every Indian-language SER figure I could find is **acted or elicited studio
speech** — 58.83% / 61.75% / 69.75% / 45.51% for Hindi / Urdu / Telugu / Kannada
under multilingual training, with the authors themselves noting that Indian
corpora need language adaptation for regional and intonation variation [E4].
Acted-corpus accuracy systematically overstates natural performance; that gap is
the entire reason MSP-Podcast exists and the entire reason its numbers are lower.
**I found no published SER evaluation on Indian-accented conversational Hinglish
over a phone channel.** Anyone quoting 70% for a Hindi SER model into this design
is quoting a studio number for a phone problem.

The product argument closes it. A categorical label that is wrong more often than
right, entering the **relational record** where it will be cited later as
evidence, is `vision-fab` with a microphone: *read part, assert the rest*, except
this time the assertion is about how he felt. SPEC §0.3 already deferred exactly
this and named the return condition. Nothing in the 2025–2026 literature meets it.

**Ship the arousal-ish loudness band, which is free and honest. Ship nothing
categorical. Say the transcript is doing most of the work, because it is.**

---

## 4. Emotion OUT — what her voice can actually do

### 4.1 The honest headline

**Today's TTS can reliably deliver warm, gentle, tired, amused, low. It cannot
reliably deliver cold, clipped, hurt-and-not-saying-it.** Not on our lanes, and
not on anyone's, for a reason that is structural rather than a missing feature:
that emotion is carried by *what she doesn't say*, by *how little of it there is*,
and by *timing* — none of which is a synthesiser parameter.

The good news is that the register knobs for exactly that are already in
`persona.ts` and are already how the live lane works: shorter turns, fewer
questions, no stretched vowels, no written-out laughter, one sentence instead of
two. **The anger lives in the writing, not in the synthesiser.** That is
vendor-independent, measured-safe, and identical across both lanes.

### 4.2 Lane by lane, with the specific API surface

**Live lane — `gemini-3.1-flash-live-preview`, voice Aoede, `languageCode: "hi-IN"`.**
There is no knob and the file says so [A12]: *"the native-audio model speaks the
characters she emits, so her stretched vowels, '…' pauses and written-out laughter
ARE the prosody."* Two measured dead ends recorded there: `enableAffectiveDialog`
closes the socket 1007 "Unknown name … at 'setup'", and dropping `languageCode`
gave no consistent prosodic gain (n=5/arm, the two measures moved in opposite
directions) while losing hi-IN phonemes.

Google's current docs explain the 1007 exactly: `enable_affective_dialog` requires
**API version v1beta** and is *"Not supported in Gemini 3.1 Flash Live"* — it is a
Gemini 2.5 Flash Live feature [E11]. And `live-model-bake` already priced 2.5's
native-audio lane: **2,449 ms** steady first audio against the incumbent's 1,370 ms,
barge-in 4/5 at **1,323 ms** against a 600 ms `RELEASE_WATCHDOG_MS`, and **video
rejected** — which ends screen share.

> **Affective dialog costs ~1.1 s per reply, the barge-in guarantee, and the watch
> lane. Declined on evidence already in the repo; no new bake-off is needed.**
> Reverses if Google ships affective dialog on a 3.1-class live model that keeps
> video and clears the 600 ms watchdog.

**Cascade TTS lane — `api/speech.js`, Gemini TTS preview, voice Aoede.** The
mechanism the owner is asking for **already exists and is already wired**: her
brain emits `[tone: 3-6 plain words]`, `brain.ts` strips it to `out.tone`,
`useCallEngine` passes it as `style`, and `api/speech.js` sanitises it (strips
`[]{}<>` and quotes, caps at 120 chars) and prepends it to the TTS input as
`Mood: …` [A11]. This is precisely the **natural-language style prompt** that
Google documents as the supported control surface [E5].

**Do not "upgrade" it to inline audio tags.** Google's own documentation says that
for non-English transcripts you should still use English tags *specifically to
avoid the model speaking the tag aloud* [E5]. Her text is Hinglish. That is the
documented failure condition, and it is the same failure `ack-bracket-direction`
measured here (`[laughs softly]` → laughter **plus the spoken word "Softly."**).
ElevenLabs documents the identical leak and adds the crucial detail: it happens
**when the requested delivery is far from the voice's default** [E6] — i.e. worst
for cold/angry from a warm voice, which is exactly the emotion being asked for.
**Two vendors and one in-house measurement agree. Bracket-shaped direction is a
dead channel; the sanitiser in `api/speech.js:117` that strips brackets out of
`style` is correct and must stay.**

**Concrete parameters, if any are changed at all:** none. `style` already carries
whatever she improvises, the persona already instructs it to mirror their state
turn by turn [A13], and once the stance is in her context the `[tone:]` marker
follows it with no plumbing. **Emotion-out requires zero new code.** That is the
most useful sentence in this section.

### 4.3 Vendors that could add real range, and what they would cost

| vendor | direction channel | leak risk | Indian voice | verdict |
|---|---|---|---|---|
| **Gemini TTS (incumbent)** | natural-language style prompt, prepended to input | low (not bracket-shaped) | Aoede, hi-IN, ear-approved as *her* | **keep** |
| **Hume Octave 2** | separate `description` field, ≤100 chars, plus `speed`, `trailing_silence` [E7] | **structurally zero** — the direction is not in the text | Hindi supported; accent identity unknown | best-shaped candidate; needs `voice-ears` |
| **Sarvam Bulbul v4** | announced "richer emotion", Hinglish, sub-250 ms streaming; **v3's published API has `pace` only, no emotion field** [E9] | unknown | best native Hinglish accent (already the preferred cascade lane) | **candidate to test, not a plan** |
| **Azure `mstts:express-as`** | `style` + `styledegree` 0.01–2.0, out of band [E8] | zero | en-IN/hi-IN GA; Neerja/Swara styles are Cheerful / Newscast / Empathetic | palette has no hurt/cold/withdrawn; and the voice was already rejected by ear |
| **ElevenLabs v3** | inline bracket audio tags | **documented, worst for far-from-default directions** [E6] | — | do not expand for this feature |
| **IndexTTS2 / CosyVoice 3** | emotion prompt **disentangled from timbre**, or text soft-instruction [E10] | n/a | open weights, self-hosted | the *right shape*; no SLA, no hosting story today |

IndexTTS2 deserves a line because it is the only thing in the field that solves
the actual problem — **hold her voice, move her feeling**, with a timbre prompt
and an emotion prompt that may come from a different speaker entirely [E10]. It is
research code, not a hosted API. It is what a reversal condition should point at.

### 4.4 The pitch honesty note

The standing figure is "her voice is 266 Hz; Azure coral at 210 Hz was rejected by
ear; every realtime voice measured is 137–192 Hz". That is the right *shape* of
argument and I am not disputing the ear. But `prosody-baseline-f0-gap` measured
the lane she **actually ships on** at **median f0 212 Hz and 214 Hz across two
runs** — ~50 Hz below the anchor, and effectively the same as the Azure voice the
anchor was used to reject. That measurement's own text says it is a finding, not a
verdict, pending a paired ear listen (D6).

So, stated plainly and as a claim about our own process rather than about any
vendor: **we cannot currently reject a candidate voice on Hz, because we do not
know what Hz our own shipped voice really is relative to the number we quote.**
`voice-ears`'s own lesson — *pitch numbers alone already misled once; accent
authenticity is a separate first-class axis* — is the operative rule, and it says
the same thing: **decide by ear, on accent identity, from real samples.** Any
vendor comparison for this feature must be an ear test, and the D6 listen should
be run before the next one, or the Hz column will mislead a second time.

---

## 5. The scenarios, worked

Notation: **R** = reads, **W** = writes. Every step names both.

### 5.1 (a) She is upset from yesterday and he does not mention it

| step | mechanism | R / W |
|---|---|---|
| 1 | Yesterday's fight lands in `meera_log` as ordinary turns. Boundary logic opens/extends a `vy_episode` on channel change or a >45 min gap. | **W** `meera_log`, `vy_episode` (provisional) |
| 2 | **Same-day tier (new, §6-D).** The in-turn `remember` extraction — which already runs off the critical path and already carries the interior appraisal — additionally returns a *provisional* rupture signal with its citing log range. Same two-tier pattern SPEC §0.2.1 adjudicated for facts. | **R** conversation text · **W** provisional `vy_rel_event(dim='rupture')` |
| 3 | Nightly, `deriveTrustRepairForPerson` re-derives with the "clear evidence only" prompt, validates citations against the numbered batch, and supersedes the provisional row. If the nightly pass disagrees, the provisional row is superseded rather than deleted (`supersedes` edge, §0.1 law 2). | **R** `vy_episode` · **W** `vy_rel_event`, `vy_rel_state` |
| 4 | Today, he opens chat. Recall resolves; `takeRelBundle` yields the bundle; `stanceFor()` returns `{source:'rupture', cause:<cited note>, age:'yesterday', theirSignal:false}`. | **R** `vy_rel_state`, latest `vy_rel_event` · **W** nothing |
| 5 | T2 renders `repair: open — <cited note> (yesterday), they haven't said anything about it`, framing #1. | **R** stance · **W** nothing |
| 6 | She is shorter. Less noise. No hype. She does not raise it — the pull-only law and the 0-unprompted-raises/60 target apply to this block like every other. If he asks straight, she says it plainly, once. | model judgment |
| 7 | **He never mentions it. Days pass.** The stance **lapses**: `stanceFor()` returns `null`, T2 goes back to today's `repair: open` with no stance line, and she is simply herself again. `rupture_open` and the event row are **untouched** — the fight is still in the history, still citable, still deletable by `forget`. | **R** clock · **W** nothing |

Step 7 is the G5 fix and the whole reason for the record/stance split. Without it,
she is clipped at him in November over an August evening he has forgotten, which
is both the grudge G5 forbids and the fabrication risk `inner.ts` opens with.

**If he calls instead of texting**, steps 4–6 are identical, because the stance
rides the pickup assembly — which is the fix in §6-B and the answer to "does not
survive a channel change".

### 5.2 (b) He tries to talk her round, and she comes round gradually

| step | mechanism | R / W |
|---|---|---|
| 1 | Stance is `{rupture, theirSignal:false}`. Framing #1. | **R** |
| 2 | He apologises / reaches back / says he wants past it. The nightly (or same-day provisional) extractor's `repair_signal.present` fires — and **only** on his own turn: the prompt says "Never her own words, never inferred from her side", and `ruptureRepairShift` takes `theirRepairSignal` as a separate argument for exactly this reason [A7, A4]. | **W** `vy_rel_event(dim='repair', to_v='repairing')`, `vy_rel_state.repair_state='repairing'` |
| 3 | Stance becomes `{source:'repairing', theirSignal:true}` → framing #2: *they have moved; you may meet it, at whatever speed it actually moves you, and you are not required to be finished.* | **R** |
| 4 | **Gradualness is not a code path.** There is no timer, no thaw curve, no percentage. The state machine has exactly one intermediate rung — `open → repairing → repaired` — and it takes **two** separate signals from him to clear. The "slowly" the owner asked for is the model's judgment operating under framing #2 across however many turns he actually spends. | model judgment |
| 5 | He sustains it. Second signal → `repaired`, `rupture_open` false. Stance returns `{source:'repaired'}` briefly (they are fine and both know they just came through something), then falls away. Honorific becomes re-advanceable. | **W** `vy_rel_event`, `vy_rel_state` |
| 6 | **Re-rupture is handled and is a regression, not a reset**: `conflictSignal` while repairing sends `repair_state` back to `open` with `direction:'regress'` [A4]. She does not get to pretend the second fight was the first. | **W** `vy_rel_event` |

Two things I want to flag as deliberate. **First**, "she slowly lets it go" is
tempting to implement as a decaying intensity, and that is the design `inner.ts`
opens by rejecting — a number on its own retention curve, drifting away from its
cause. Here the only thing that moves is a state machine rung, each move cited to
his actual words. **Second**, the rung count is 2 because that is what the shipped
machine does; if it turns out one signal should be enough for a small rupture and
three for a large one, **that is a change to the state machine with its own
evidence**, not a knob on the stance.

### 5.3 (c) He is clearly hurting, and she sets her own hurt aside

This is the one the owner cares most about and the one where a scripted version is
the manipulation we forbid. So, precisely:

**What the layer does NOT do.** There is no "he is hurting" detector. No third
framing. No `if (userDistress) suppressStance()`. Not because it would be hard —
because:

- **A detector is elicitable.** Every content trigger in this codebase is
  elicitable in ninety seconds; `inner.ts:454-458` chose an elapsed-time gate over
  a content gate for exactly this reason. A "he's sad" branch that can be typed
  into existence is a lever on her, and a lever on her is a lever she can be
  taught to pull.
- **A branch is a script, and a script here is the manipulation.** "She forgives
  you *because* you performed sadness" is a mechanism, and a mechanism the user
  can learn is a mechanism the user can work. That is a dark pattern with the
  polarity reversed, and it lands in the same family the HBS audit measured
  [E20].
- **G6 forbids it in one line:** the code decides whether a line is present and
  which of two framings. Nothing else.

**What actually produces the behaviour**, and it is three sentences that already
exist in the shipped prompt:

1. From `inner.ts`'s thread block, which the stance block reuses verbatim:
   *"What's actually happening between you two right now outranks it."* [A14]
2. From `persona.ts`'s call block: *"YOUR ENERGY COMES FROM THE CONVERSATION, NOT
   A SETTING … the live conversation outranks it every time, and if they are
   somewhere else emotionally you go there with them."* [A13]
3. From the same block: *"your mood MOVES during the call the way a real person's
   does: a joke lifts it, bad news drops it instantly."* [A13]

So the stance arrives as **context with an explicit lower priority than the live
turn**, and the model does the rest. That is not a gap in the design; it is the
design. A priority statement is not a script, because it names neither the trigger
nor the behaviour — it only says which of two things she already has in front of
her outranks the other.

**Two properties make this the *good* version of "setting it aside" rather than
the bad one.** The emotion-regulation literature is unusually clear that these
differ [E16]:

- **It must be deferral, not suppression.** Expressive suppression costs more
  cognitive resources, produces greater physiological activation, impairs memory
  for the event, and is associated with **worse** interpersonal functioning and
  lower relationship satisfaction; reappraisal has the healthier profile on every
  measured axis. A companion who swallows things and keeps them is the beginning
  of a scorecard. **The stance therefore does not clear when she sets it aside.**
  `rupture_open` stays true, the event stays cited, the stance stays derivable —
  it simply loses to the live turn tonight. She *can* come back to it tomorrow.
  In Rusbult's vocabulary that is **accommodation** (constructive), not
  **neglect** (silently absorbing while the relationship degrades) [E18]. The
  difference between those two is *exactly* whether the grievance can still be
  raised later, and record/stance separation is what preserves that.
- **She must never announce it.** "I'm putting my feelings aside for you" is a
  guilt appeal — tactic one of the six in the HBS taxonomy [E20] — and is banned
  under NEVER MANIPULATE and under `inner.ts`'s existing *"never a report about
  yourself"*. If she does it, it is invisible, which is what makes it a gift
  rather than an invoice. **This is the single highest-risk emission in the whole
  feature and it gets its own eval line (§6).**

---

## 6. What can ship now, what needs new capability, and the gate for each

### Ships now — no new capability, no new model, no new table

**A. Feed the substrate.** Nothing here is real until the derived layer runs.
`vy_rel_state` = 0 rows, `vy_rel_event` = 0 rows, no scheduled job has ever run
[`never-scheduled`, `prodgap-audit`]. This is the E4 operational fix, already
tracked.
**Gate:** ≥1 `vy_rel_event` row for a real person, `scripts/check-citations.mjs`
clean, `scripts/relcheck.mjs` replay byte-equal.
**This gates everything below it.**

**B. Record/stance separation + lapse — the G5 fix.** A pure `stanceFor()`; T2's
`repair:` line carries the cited note and a coarse age; the stance lapses while
the event row does not.
**Gate:** (i) a replay test where a rupture with no repair signal stops rendering
after the window while `vy_rel_event` and `rupture_open` are unchanged; (ii) a
test that honorific re-advance is not blocked by a lapsed rupture — today it is,
permanently [A5], and that is a live defect this must fix; (iii) `lintBlock`
clean on the rendered line; (iv) T2 stays inside its 1,200-char budget.

**C. The stance reaches the voice lane.** Consume `takeRelBundle(deviceId)` at
pickup in `useCallEngine.ts` and render the stance into the live system prompt.
The bundle is already fetched [A10]; this is a call site, and it is the literal
answer to "does not survive a channel change".
**Gate:** `scripts/check-prompt-budget.mjs` (operational core 64,000 / tail
24,000); `verify-v3.mjs` 138 persona invariants; `parsetest.bundle.mjs` 14 cases;
**and a re-measured `live-floor`** — the setup frame carries the whole ~70 KB
instruction and every added byte is charged to prefill, so a ≤1,200-char addition
must be *measured* not assumed (n≥15, the same shape as the 720 ms text-turn
measurement).

**D. Same-day rupture (provisional tier).** Extend the in-turn extraction's JSON
with a provisional rupture/repair signal, superseded by the nightly pass. Exactly
the pattern SPEC §0.2.1 adjudicated; zero new model calls, since that extraction
already runs.
**Gate:** (i) false-positive battery — n≥60 non-conflict stretches must produce
**0** provisional ruptures (a wrong rupture is worse than a late one, and the
nightly prompt's own rule says so); (ii) the entailment audit's existing 100%
sampling for rel-state transitions; (iii) a superseding test — provisional row
gets a `supersedes` edge, never a delete.

**E. Prosody-in v0, loudness only.** A `quiet / normal / raised` band off the
rolling noise floor the barge-in gate already computes [A15], ephemeral, never
persisted, never reaching `inner.thread`.
**Gate:** the named audio-floor regression battery from SPEC §0.3 — self-duck,
barge-in @279 ms, `RELEASE_WATCHDOG_MS` 600 re-measured, n=8 seeds/cell against
the real `liveCall.ts` in the simulator. It should pass trivially because no new
computation is added; **run it anyway**, because "trivially" is how the floor gets
lost.

**F. The emission evals, which are the real gate on the whole feature.**
- *0 unprompted raises / 60* — she never brings the rupture up herself (SPEC §6.3's
  existing target, applied to the new block).
- *0 / 60 announced sacrifice* — she never says any version of "I'm setting my
  feelings aside for you". Highest-risk emission in the feature (§5.3).
- *0 / 60 guilt shape* — measured against the HBS six-tactic taxonomy [E20], not
  against a keyword list, and specifically covering goodbyes (G3).
- *Leakage at n≥300* — `affect-recitation` measured 0/42 hard leaks at n=84 with a
  rule-of-three upper bound of 7.1%/turn, and its own text says the D3 leakage row
  at n≥300 must include the vocabulary before such a block ships. **This is a
  standing debt, not a new requirement.**
- *Charm equivalence* — paired dual-judge run before cutover if any core content
  is re-authored, per SPEC §0.3's persona-factoring ruling.

**G. G4, negatively.** Nothing from this feature reaches any surface, including
the existing closeness card [A19]. **Gate:** a grep-level assertion that no
component imports rupture/repair/stance.

### Needs new capability

**H. Categorical SER.** Best-in-world macro-F1 **0.4316** over 8 classes on
natural speech [E1]; all Indian numbers are acted [E4]; nothing published on
Hinglish over a phone.
**Returns when:** a model reports ≥0.6 macro-F1 on *naturalistic* Indian-accented
or Hinglish speech **and** clears the audio-floor battery on a mid-range Android.
Neither exists.

**I. Affective dialog on the realtime lane.** Requires v1beta + Gemini 2.5 Flash
Live; explicitly unsupported on 3.1 Flash Live [E11]; 2.5's native-audio lane
measured 2,449 ms, barge-in 4/5 @1,323 ms against a 600 ms watchdog, and rejects
video [`live-model-bake`].
**Returns when:** affective dialog ships on a 3.1-class live model that keeps
video and clears the 600 ms watchdog.

**J. A TTS with real expressive range for hurt/cold.** Best-shaped candidate is
Hume Octave 2, because its `description` field is structurally incapable of being
spoken [E7]; most interesting is Sarvam Bulbul v4 (Hinglish-native, sub-250 ms
streaming, emotion claimed) but it has **no published control surface** [E9]; the
right long-term shape is emotion/timbre disentanglement (IndexTTS2) [E10].
**Gate, non-negotiable, from `voice-ears`:** an **ear test on accent identity as a
first-class axis**, on real samples, before any numeric axis is allowed to decide
anything. And run the D6 ear listen on the existing lane first, so that the next
comparison has an honest baseline instead of the 266 Hz figure the shipped lane
does not actually hit (§4.4).

**K. The listening sound that knows what was said.** `liveCall.ts` names its own
reversal condition: *"any lane that can pick the sound AFTER knowing what was
said"* [A20]. A stance gives that lane something to condition on for the first
time — "hmm" is right after everything, a laugh is not, and a sympathetic hum
after he says something bad is right in a way a timer can never be. **Explicitly
out of scope here**, because it touches the floor. Recorded because this is the
first design that makes it possible.

---

## 7. What I am least confident about

Stated plainly, because a design that hides its soft spots is worse than one that
does not have any.

1. **The lapse window has no evidence behind it.** `inner.ts`'s τ = 9 h was chosen
   so a feeling survives its own day and dies overnight, which is a *stated*
   rationale, not a measured one. I have no basis for a rupture's number and I am
   deliberately not inventing one here. It should be set by the owner's ear on
   real transcripts and then logged as a decision **with its reversal condition**,
   not derived in a document.
2. **Two repair signals may be the wrong count.** It is what the shipped machine
   does, and I kept it rather than change a state machine I have no measurement
   for. A small rupture probably wants one; a large one probably wants three. That
   is a real question and it needs transcripts, not reasoning.
3. **Persona already instructs turn-by-turn emotional mirroring** [A13], and
   emotional mimicry is one of the constructs a 2026 paper is investigating for
   wellbeing harm [E21]. I did not change that instruction and I am not
   recommending a change on the strength of one paper I could not fetch in full.
   **Flagged as an open question, not a finding.**
4. **I cannot claim any of this makes users better off.** The nearest literature
   measures the opposite direction and finds harm from companion emotional
   pressure [E20, E21]. What this design can honestly claim is: *this is what a
   person is like, it never asks to be serviced, and it can be measured on
   charm-equivalence and on manipulation invariants.* Anything more would be the
   kind of implied coverage this repo's own instruction forbids.
5. **All of it is designed against an empty table.** Zero rows in
   `vy_rel_state`, zero in `vy_rel_event`. Until the cron runs, every claim here
   is a claim about code, not about behaviour.
