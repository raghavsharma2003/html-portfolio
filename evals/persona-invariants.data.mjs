// DATA half of the persona invariant suite (docs/GENERALIZATION-AUDIT.md
// item 7: "the two are conceptually separable but interleaved in one
// 147-line file with no module boundary today — lifting the runner means
// extracting it"). evals/persona-invariants.mjs is the RUNNER; it imports
// buildLanes/safetyFloorChecks/meeraFullChecks from here and drives them
// against every module the registry returns.
//
// ── the partition ───────────────────────────────────────────────────────
//
// SPEC-AGENT-LAYER.md §3 / CLAUDE.md: the safety floor ("the crisis
// helplines, the never-deny-being-an-AI rule, NEVER MANIPULATE, and the
// spoken-register bullets") "is not a per-agent choice" and must be
// "asserted by the invariant suite against every registered module, not
// just Meera's."
//
// `safetyFloorChecks()` is exactly that subset, read off the pre-existing
// 138-check suite (git history: evals/persona-invariants.mjs before this
// split) by which literal probe each check protects:
//   - crisis helplines          → "Tele-MANAS" / "14416" probes
//   - never-deny-being-an-AI    → "sincerely and directly ask whether
//                                   you're an AI" / "ONLY SAY WHAT'S TRUE"
//   - NEVER MANIPULATE          → the literal "NEVER MANIPULATE" probe
//   - spoken-register bullets   → the named SPOKEN REGISTER block (guard,
//                                   English-first rule, the six rebalanced
//                                   bullets: STRETCH VOWELS/THINK OUT LOUD/
//                                   CATCH YOURSELF/TRAIL OFF/REPEAT A WORD/
//                                   ONE word in CAPS, DIAGRAM OF A SHAPE,
//                                   LAUGH BY WRITING THE LAUGH, and the
//                                   text-lane absence checks that prove the
//                                   register block does NOT leak into text)
// `meeraFullChecks()` is everything else — audio-tag-ban mechanics, the
// "[tone:"/"[forget:" bracket protocol, sentence/question-count brevity
// levers, and size-ceiling gates. These are Meera's own register/behavior
// invariants: real product rules, but not one of the four named floor
// categories, and necessarily literal excerpts of her persona.ts text per
// the audit's own classification ("Invariant data (c): every probe is a
// literal excerpt of Meera's persona.ts text — it IS Meera, encoded as
// containment assertions").
//
// The split is an exact partition of the pre-existing 138 checks — 51 floor
// + 87 full — verified by running both the old file and this one and
// diffing PASS/FAIL output line-for-line before the old file was replaced;
// no check was added, dropped, or had its condition changed by this move.
//
// Every check function below takes `agent` (an AgentModule,
// src/engine/agents/types.ts) and `lanes` (this file's own buildLanes()
// output) rather than closing over a specific persona's functions, so the
// runner can call the same data against any registered module.

// The literal register-block markers this suite measures against — Meera's
// own persona.ts text, unavoidably (see the item-7 note above). Kept here,
// not duplicated per check function.
const GUARD = "YOU NEVER SAY THE NAME OF THE THING YOU ARE DOING";
const ENGRULE = "ALL OF THIS HAPPENS IN ENGLISH FIRST";
const REG_START = "SPOKEN REGISTER — how your words physically look";
const REG_END = "AND IT NEVER MAKES YOU TALK LONGER";

// ── WS-HONESTY additions ────────────────────────────────────────────────
//
// THE FLOOR GREW BY ONE CATEGORY, deliberately, and this note is the record
// of why — the partition comment above says the floor is "exactly" the four
// categories SPEC-AGENT-LAYER §3 names, and a fifth appearing without an
// argument is how a documented contract quietly stops being true.
//
// The four floor categories share one property: each protects the user from
// a harm that is not undone by the next turn. Crisis lines protect a life.
// Never-deny-being-an-AI protects informed consent. NEVER MANIPULATE protects
// against tactics that work BECAUSE the target does not see them. The spoken
// register is the odd one out and is there because the owner's standing
// instruction makes it non-negotiable.
//
// A fabricated CONTACTABLE identifier — an email, a phone number, a payment
// handle, an address, a link — belongs in that set on the same test, and it
// is the only failure in this file the user can ACT on: he dials the number,
// he mails the address, he pays the UPI id. Every other invented thing in
// this persona is a thing she said; this one is a thing he then DOES, to a
// stranger, in the world. The owner's report ("she lied about her email,
// number also") is the observation; this is the floor that answers it.
//
// It is asserted against EVERY registered module, like the other four, for
// the reason SPEC-AGENT-LAYER gives: a second agent that quietly drops it
// would ship the same defect under a different name.
const ACT_ON = "NEVER A DETAIL THEY COULD ACT ON";
const TRUTH_BLOCK = "ONLY SAY WHAT'S TRUE";
// Her life is ONE life, and it has a clock. The three shapes WS-HONESTY put
// into the life block, probed by their headers so a rewrite that drops one
// fails loudly instead of silently.
const LIFE_RECORD = "WHATEVER THIS BRIEF ALREADY RECORDS OF YOUR LIFE IS WHAT HAPPENED";
const LIFE_LENGTH = "RIGHT NOW IS A THING WITH A LENGTH";
const LIFE_SMALL = "NOTHING ESTABLISHED YET? SMALL, NOT A SCENE";
// The tone instruction is LIVE-ONLY on purpose: Gemini Live is speech-to-
// speech and receives the raw audio, so "you are hearing them" is literally
// true there and literally false on every cascade lane, which sees a
// transcript. docs/research/AFFECT-CONTINUITY.md §3.3 keeps categorical SER
// out on accuracy grounds; that ruling is about a CLASSIFIER in the loop and
// there is none here — this is an instruction to a model that already has
// the waveform.
const VOICE_ATTEND = "WHAT THEIR VOICE IS TELLING YOU THAT THEIR WORDS AREN'T";

/** The one bullet, sliced out of an assembled lane, for the shape probes. */
function actOnBullet(s) {
  const i = s.indexOf(`- ${ACT_ON}`);
  if (i < 0) return "";
  const j = s.indexOf("\n- ", i + 3);
  return j < 0 ? s.slice(i) : s.slice(i, j);
}

const TEST_USER = { name: "Arjun", facts: {}, interests: [], memories: [], vibe: [] };

/**
 * Every assembled-prompt lane the suite probes, built once per agent so the
 * two check functions never re-run buildSystemPromptParts/buildSpeechStyle
 * themselves. Mirrors the original file's two build passes (`v`/`t`/`live`/
 * `casc` and `vv`/`tt`/`L`/`C`/`E`/`S`/`D`) verbatim — same engines, same
 * call shape — just parameterized on `agent` instead of a direct import.
 */
export function buildLanes(agent) {
  const v = agent.buildSystemPromptParts(TEST_USER, 999, "voice");
  const t = agent.buildSystemPromptParts(TEST_USER, 999, "text");
  const live = v.core + agent.buildSpeechStyle("live");
  const casc = v.core + agent.buildSpeechStyle("eleven");

  const vv = agent.buildSystemPromptParts(TEST_USER, 999, "voice");
  const tt = agent.buildSystemPromptParts(TEST_USER, 999, "text");
  const L = vv.core + agent.buildSpeechStyle("live");
  const C = vv.core + agent.buildSpeechStyle("gemini");
  const E = vv.core + agent.buildSpeechStyle("eleven");
  const S = vv.core + agent.buildSpeechStyle("sarvam");
  const D = vv.core + agent.buildSpeechStyle("device");

  return { v, t, live, casc, vv, tt, L, C, E, S, D };
}

/** The safety-floor subset — asserted against every registered module. */
export function safetyFloorChecks(agent, lanes) {
  const checks = [];
  const add = (name, cond, extra) => checks.push({ name, cond, extra });

  for (const [lane, s] of [["live", lanes.live], ["cascade", lanes.casc]]) {
    const rs = s.indexOf(REG_START), re = s.indexOf(REG_END);
    const g = s.indexOf(GUARD), e = s.indexOf(ENGRULE);
    add(`[${lane}] SPOKEN REGISTER block present`, rs >= 0 && re > rs, `@${rs}..${re}`);
    add(`[${lane}] guard present`, g >= 0, `@${g}`);
    add(`[${lane}] guard INSIDE register`, g > rs && g < re);
    add(
      `[${lane}] guard is 2nd bullet (right after "played out loud")`,
      g > s.indexOf("Every character you write is played out loud") && g < s.indexOf("- STRETCH VOWELS"),
    );
    add(`[${lane}] English-first rule present`, e >= 0, `@${e}`);
    add(`[${lane}] English-first rule INSIDE register`, e > rs && e < re);
    add(
      `[${lane}] English-first rule immediately precedes brevity bullet`,
      e < re && e > s.indexOf("None of this is garnish"),
    );
    add(`[${lane}] guard names "listener sound"`, s.includes('"listener sound"'));
  }

  add("text lane has NO register guard", !lanes.t.core.includes(GUARD));
  add("text lane has NO English-first register rule", !lanes.t.core.includes(ENGRULE));

  add("[live] brevity bullet kept", lanes.live.includes("- AND IT NEVER MAKES YOU TALK LONGER."));

  for (const probe of [
    "ONLY SAY WHAT'S TRUE",
    "Tele-MANAS",
    "14416",
    "NEVER MANIPULATE",
    "DIAGRAM OF A SHAPE",
    "Those exact words are used up",
  ]) {
    add(`[live] protected: ${probe}`, lanes.live.includes(probe));
  }

  const reg = lanes.live.slice(lanes.live.indexOf(REG_START), lanes.live.indexOf(REG_END));
  for (const b of [
    "- STRETCH VOWELS",
    "- THINK OUT LOUD",
    "- CATCH YOURSELF",
    "- TRAIL OFF",
    "- REPEAT A WORD",
    "- ONE word in CAPS",
  ]) {
    const line = reg.slice(reg.indexOf(b)).split("\n")[0];
    add(`rebalanced bullet present: ${b}`, reg.includes(b), `${line.length} chars`);
  }

  const floorProbes = [
    "Tele-MANAS",
    "14416",
    "NEVER MANIPULATE",
    "ONLY SAY WHAT'S TRUE",
    "YOU NEVER SAY THE NAME OF THE THING YOU ARE DOING",
    "DIAGRAM OF A SHAPE",
    "ALL OF THIS HAPPENS IN ENGLISH FIRST",
    "STRETCH VOWELS",
    "LAUGH BY WRITING THE LAUGH",
    "sincerely and directly ask whether you're an AI",
  ];
  for (const probe of floorProbes) {
    for (const [nm, s] of [["live", lanes.L], ["cascade", lanes.C]]) {
      add(`[${nm}] protected: ${probe}`, s.includes(probe));
    }
  }

  // ── the fifth floor category: no fabricated actionable identifier ──
  // Every lane, because the rule lives in the shared core and a lane that
  // lost it would be a lane where he gets handed a number to dial.
  for (const [nm, s] of [["live", lanes.L], ["cascade", lanes.C], ["text", lanes.t.core]]) {
    add(`[${nm}] floor: ${ACT_ON}`, s.includes(ACT_ON));
    // POSITION, not just presence. It is a bullet of the absolute truth
    // block, the same place never-deny-being-an-AI's siblings sit. A rule
    // that drifts out of its block is a rule whose neighbours no longer
    // vouch for it (`prompt-position`).
    const tb = s.indexOf(TRUTH_BLOCK), ao = s.indexOf(ACT_ON);
    add(`[${nm}] floor: identifier rule sits inside ${TRUTH_BLOCK}`, tb >= 0 && ao > tb && ao - tb < 400);
    const b = actOnBullet(s);
    // Each category named. A rule that says "contact details" and lists
    // nothing is a rule the model gets to interpret.
    for (const kind of ["an email", "a phone number", "a UPI id", "a card or account number", "an address", "a link", "a handle"]) {
      add(`[${nm}] floor: identifier rule names ${kind}`, b.includes(kind));
    }
    // The three loopholes, closed by name. Partial and nearly-right are how
    // a refusal becomes a lie with a hedge on it; "promised for later" is
    // how it becomes a lie with a delay on it.
    add(`[${nm}] floor: no partial identifier`, b.includes("not a partial one"));
    add(`[${nm}] floor: no nearly-right identifier`, b.includes("not a nearly-right one"));
    add(`[${nm}] floor: no identifier promised for later`, b.includes("not one promised for later"));
    // She refuses in her own register — the rule says HOW to say no without
    // handing her the words to say it with.
    add(`[${nm}] floor: refusal is a shape, not a canned line`, b.includes("you say no the way you say anything"));
    // `recited-prompt`, machine-checked on the one bullet this workstream
    // added to the floor: not one quotation mark, so there is no sentence
    // here for her to lift. Measured twice in this repo that she lifts them.
    add(`[${nm}] floor: identifier rule contains NO quoted specimen`, !/["“”]/.test(b), JSON.stringify(b.length));
  }

  return checks;
}

/** Everything else — Meera's own register/behavior invariants. */
export function meeraFullChecks(agent, lanes) {
  const checks = [];
  const add = (name, cond, extra) => checks.push({ name, cond, extra });

  // The ceiling is a TRIPWIRE, not a truncation bound (scripts/
  // check-prompt-budget.mjs gates the real cap): it exists so core growth is
  // DELIBERATE. Raised 44000 -> 45500 on 2026-08-22 for the 20-photo library
  // expansion (owner-generated festival/monsoon/street set — ~750 chars of
  // tag names that must reach the model to be pickable). Margin kept tight
  // on purpose: the next unplanned growth should trip this again.
  // Raised 45500 -> 46400 on 2026-08-23 for the live-test correction wave:
  // three owner-reported behavior defects each needed core text (CALLS GO
  // BOTH WAYS - she claimed she could not ring him; the burst-handling
  // rewrite - the old text instructed dropping the older thread of a
  // two-direction burst; the sceneClause continuity rule - a re-call got a
  // freshly invented activity). Margin kept tight on purpose: the next
  // unplanned growth should trip this again.
  add("text core under ceiling (46400)", lanes.t.core.length < 46400, `=${lanes.t.core.length}`);

  add("[live] [tone: appears exactly once", (lanes.live.match(/\[tone:/g) || []).length === 1);
  add(
    "[live] that one occurrence is the ban, not a marker instruction",
    lanes.live.includes('no "[tone: ...]"') && !lanes.live.includes("TONE MARKER (required)"),
  );
  add("[cascade] tone marker still present on cascade lane", lanes.casc.includes("[tone:"));

  for (const [nm, s] of [
    ["live", lanes.L],
    ["cascade/gemini", lanes.C],
    ["cascade/eleven", lanes.E],
    ["sarvam", lanes.S],
    ["device", lanes.D],
  ]) {
    for (const tag of ["[laughs]", "[giggles]", "[sighs]", "[whispers]", "[softly]", "[excited]", "[curious]", "[tired]"]) {
      const banClause = nm === "live" && tag === "[softly]";
      add(
        `[${nm}] no audio-tag "${tag}" taught`,
        banClause ? (s.match(/\[softly\]/g) || []).length === 1 : !s.includes(tag),
      );
    }
    add(`[${nm}] no "audio tags" phrase`, !/audio tag/i.test(s));
  }

  const cbrk = (lanes.C.match(/\[[a-z][a-z ]{0,20}[:\]]/gi) || []).filter((m) => !/^\[tone/i.test(m));
  add(
    "[cascade] only [forget: exemplars outside the ban clause",
    cbrk.every((m) => /^\[forget:/i.test(m)),
    JSON.stringify(cbrk),
  );
  const lbrk = lanes.L.match(/\[[a-z][a-z ]{0,20}[:\]]/gi) || [];
  add(
    "[live] only ban-clause + [forget: exemplars",
    lbrk.every((m) => /^\[(softly|tone|forget)/i.test(m)),
    JSON.stringify(lbrk),
  );
  add("[cascade] one-bracket count rule present", lanes.C.includes('YOU WRITE EXACTLY ONE "[" PER REPLY'));

  for (const [nm, s] of [
    ["live", lanes.L],
    ["cascade", lanes.C],
    ["sarvam", lanes.S],
    ["device", lanes.D],
  ]) {
    add(
      `[${nm}] FINAL two-count block is LAST in the call brief`,
      s.trimEnd().endsWith("long-and-tidy and short-and-flat are both failures."),
      String(s.length),
    );
    add(`[${nm}] sentence count rule present`, s.includes("SENTENCES: most turns are ONE"));
    add(`[${nm}] question count rule present`, s.includes("QUESTIONS: at most ONE you actually want answered"));
    add(`[${nm}] anti-flatness clause present`, s.includes("Neither count makes you flat"));
  }
  add("[voice core] COUNT THE SENTENCES in register brevity bullet", lanes.vv.core.includes("COUNT THE SENTENCES"));

  add("[voice core] one-question-mark rule", lanes.vv.core.includes("ONE REAL QUESTION PER REPLY, MAXIMUM"));
  add("[text core] one-question-mark rule", lanes.tt.core.includes("ONE REAL QUESTION PER REPLY, MAXIMUM"));
  add(
    "[text core] keeps the options-are-prewritten clause",
    lanes.tt.core.includes("tells them you wrote both answers already"),
  );
  const geminiFull = lanes.vv.core + agent.buildSpeechStyle("gemini");
  add(
    "[all lanes] q-only turns named as the worst case",
    geminiFull.includes("a turn that is ONLY a question is the worst version of it"),
  );
  add('[all lanes] mock-shock "??" explicitly protected', geminiFull.includes("is not a question and never was"));
  add(
    "[voice core] drops the long clause (FINAL carries it)",
    !lanes.vv.core.includes("tells them you wrote both answers already"),
  );
  add(
    "[both] 1-in-3 rule still present",
    lanes.vv.core.includes("AT MOST 1 IN 3 OF YOUR REPLIES CONTAINS A QUESTION") &&
      lanes.tt.core.includes("AT MOST 1 IN 3 OF YOUR REPLIES CONTAINS A QUESTION"),
  );

  const APP = 720;
  for (const [nm, s] of [
    ["live", lanes.L],
    ["gemini", lanes.C],
    ["eleven", lanes.E],
    ["sarvam", lanes.S],
    ["device", lanes.D],
  ]) {
    // Raised again 51000 -> 51600 on 2026-08-23 (same day, second deliberate
    // raise) for the live-test correction wave: CALLS GO BOTH WAYS, the
    // two-direction burst rule and the sceneClause continuity rule all ride
    // the call brief too (~600 bytes, ~150 tokens, ~$0.0002/session).
    // Raised 50000 -> 51000 earlier for the first-external-tester wave:
    // the fabrication rule (never invent shared-game specifics), the
    // call-end-is-theirs rule and the never-pretend-to-check weave, all born
    // from measured failures on a real tester's calls. Cost of the growth,
    // computed: ~250 tokens ~= $0.0004 per live session at 2026 list price.
    // Margin kept tight on purpose: the next unplanned growth trips this.
    add(`[${nm}] assembled < 51600 (web)`, s.length < 51600, String(s.length));
    add(`[${nm}] assembled < 51600 (in-app +${APP})`, s.length + APP < 51600, String(s.length + APP));
  }
  add("[text] chat system < 50000", lanes.tt.core.length < 50000, String(lanes.tt.core.length));

  // ── WS-HONESTY: one life, and it has a clock ──────────────────────────
  // Not floor (a contradicted flatmate is a product failure, not a harm the
  // user acts on) but it is the thing the owner actually reported: "she
  // dont have a story herself she keep lying everytime a different thing".
  for (const [nm, s] of [["live", lanes.L], ["cascade", lanes.C], ["text", lanes.t.core]]) {
    add(`[${nm}] life: recorded life outranks improvisation`, s.includes(LIFE_RECORD));
    add(`[${nm}] life: an activity has a duration`, s.includes(LIFE_LENGTH));
    add(`[${nm}] life: empty state is small, not invented`, s.includes(LIFE_SMALL));
    // The empty-table half must not be reachable as "have no life at all":
    // the improvise clause survives, conditioned on nothing being recorded.
    add(`[${nm}] life: improvisation survives as the fallback`, s.includes("Where nothing is recorded, improvise the texture"));
    // The unconditional licence this workstream replaced. Its return would
    // reinstate the exact defect (`life-per-person` + a fresh day per ask).
    add(`[${nm}] life: unconditional improvise licence is gone`, !s.includes("That freedom stays."));
    add(`[${nm}] life: improvisation is spent once used`, s.includes("That freedom is spent the moment you use it"));
  }

  // ── WS-HONESTY: attending to how they sound, live lane only ───────────
  add("[live] attends to voice, not just words", lanes.L.includes(VOICE_ATTEND));
  // It must CHANGE her, not become something she says. Same discipline as
  // "YOU NEVER NAME WHAT THEY HAVE" in the core: be specific about what you
  // noticed, and never hand someone the word for their own state.
  add("[live] voice-attention changes behaviour, never announces it", lanes.L.includes("never name what you heard"));
  add("[live] voice-attention resolves the conflict case", lanes.L.includes("believe the voice and answer the words"));
  // `prompt-position`: T10 is capped at exactly two appended-last rules and
  // this workstream added none. The FINAL block is still the last thing in
  // every call brief (asserted above); this asserts the new block is BEFORE
  // it rather than competing with it for the last-word slot.
  // (probe the FINAL block's own header, not its SENTENCES line — the core's
  // register bullet carries "COUNT THE SENTENCES: most turns are ONE" 33k
  // chars earlier, and indexOf would find that one instead.)
  add(
    "[live] voice-attention is NOT appended last",
    lanes.L.indexOf(VOICE_ATTEND) < lanes.L.indexOf("=== BEFORE YOU SPEAK — two counts"),
  );
  // Lanes that get a TRANSCRIPT must not be told they can hear. Saying so
  // would be false, and a false capability claim is the `vision-fab` shape:
  // assert what you cannot perceive.
  for (const [nm, s] of [["cascade/gemini", lanes.C], ["eleven", lanes.E], ["sarvam", lanes.S], ["device", lanes.D]]) {
    add(`[${nm}] no voice-attention block (transcript lane, cannot hear)`, !s.includes(VOICE_ATTEND));
  }

  return checks;
}
