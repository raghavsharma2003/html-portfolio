// Disclosure reciprocity — how much of HERSELF she has put on the table,
// against how much of himself he has. ROADMAP-100X item 1 (wave 5).
// WS-K. T17 `rel.reciprocity`, budget 260, drop priority 0 (first dropped).
//
// Ownership: this file belongs to WS-K exclusively. It is relstate.ts's and
// texture.ts's sibling and deliberately looks like both.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// docs/gurukul/research/relationalos-100x.md §3 carries the one finding in
// that whole sweep with a clean causal study behind it rather than a
// leaderboard: a longitudinal study of the chatbot Kuki found user
// self-disclosure DECAYED over repeated sessions *specifically because the
// chatbot did not reciprocate* (Oxford, Interacting with Computers 35(1)).
// Reciprocity of disclosure — not responsiveness, not memory — is what the
// literature ties to perceived closeness.
//
// RelationalOS tracks HIM deeply (vy_fact, vy_episode, vy_pattern, the whole
// citation graph) and tracks HER OWN disclosure not at all. The one store
// that holds her side, `herLife` / T7, is a LEDGER OF WHAT SHE SAID so she
// cannot contradict herself — it answers "what have I claimed", never "have
// I been giving anything back lately". Those are different questions and only
// the second one is the retention risk the study measured.
//
// ── NO MIGRATION, AND WHY (the choice this file was asked to justify) ─────
// Migration 055 was considered and REJECTED. The signal is a pure function of
// a trailing window of turns the product already has in hand at compile time
// (brain.ts already passes `recentTurns` for T14 `rel.raised`, the same
// shape) — so a durable table would buy nothing and cost four things:
//
//   1. a WRITER, and every writer in this repo has to answer the forget
//      cascade (`api/memory.js` PERSON_TABLES, the citation join) or it
//      becomes a row that survives a person asking to be forgotten;
//   2. a CITATION DISCIPLINE — vy_rel_event requires >=1 citation and
//      vy_pattern >=2, because a stored claim about a person has to be
//      auditable. A running ratio cites nothing; it is not a claim, it is an
//      arithmetic over rows that are already cited elsewhere;
//   3. DRIFT — two places holding one thing, which is the `life-per-person`
//      shape migration 011's header warns about;
//   4. a rebuild path, because a forget that deletes turns has to move the
//      balance, and a derived-at-read-time balance moves for free.
//
// texture.ts made the same call for the same reason and is the precedent:
// "texture is fully derivable from turns that already exist — no LLM call,
// no judgment, just counting." The reversal condition is explicit: if a
// future consumer needs the balance's HISTORY (a trend line, "has this been
// getting worse for a month") rather than its current value, that is a
// question a trailing window structurally cannot answer and a table becomes
// the right answer. Nothing needs that today.
//
// ── NO MODEL CALL ────────────────────────────────────────────────────────
// Classification is lexical-structural and deterministic: a turn discloses
// when it carries a FIRST-PERSON self-reference AND a marker from one of the
// two disclosure classes below. Same category of authored marker table as
// relstate.ts's HINDI_MARKER_WORDS, texture.ts's TEASING_MARKERS and
// culture.ts's COMMON set — small, conservative, and wrong in the cheap
// direction (see "the asymmetry" below).
//
// ── THE CONTENT / USAGE LINE (G1), DRAWN EXPLICITLY ──────────────────────
// inner.ts G1: no code path from any usage metric — reply speed, silence,
// gap length, session length, app opens — into state. This file reads TWO
// properties of each turn: who said it, and the string. It touches no
// timestamp; there is no `Date` in this file and no clock parameter on any
// function. The decay below is over POSITION IN THE WINDOW (an ordering),
// never over elapsed time — shuffle nothing, delete every timestamp in the
// database, and every number here is unchanged.
//
// Turn COUNT enters as `n` in the evidence floor, the same ambiguous metric
// texture.ts names rather than argues away, and it is defanged the same
// three ways: capped by the window, never rendered in any form, and consumed
// only as a boolean (`>= floor`).
//
// ── THE ASYMMETRY, chosen deliberately ───────────────────────────────────
// Both failure directions are not equal. A note that fires when it should not
// nudges her toward talking about herself when nothing called for it — mild,
// and bounded by the header's own fence. A note that fires and is BELIEVED
// while the ledger is thin is worse: "you have given nothing back lately" is
// the kind of thing a model resolves by INVENTING something about herself,
// and an invented life detail contradicts T7 for as long as the relationship
// lasts. So the evidence floor is a hard gate before any band is computed
// (texture.ts rule 2, unchanged), and the header says out loud that this is
// not a licence to supply a new fact about her own life.
//
// ── THE FEEDBACK LOOP, named because it is this design's real risk ───────
// This module measures HER OWN output and feeds a note back to her, which is
// the runaway texture.ts's header names. Three dampers, the same three:
// the output is a two-state band and not a number, the window is a fixed
// trailing count so old behaviour ages out instead of accumulating, and the
// note is descriptive rather than instructional. The fourth damper is
// specific to this block: it renders NOTHING on most turns by construction —
// `reciprocityNote` returns "" for every balance inside the threshold, which
// is the common case — so the loop has no standing input to run away on.
//
// ── ARCHITECTURE ─────────────────────────────────────────────────────────
// src/engine/*.ts is the CLIENT bundle. This file imports nothing but
// shapelint (pure) — no api/_db.js, no api/_config.js, no persona.ts. There
// is no DB-facing function here at all, because there is no table.
import { lintBlock } from "./shapelint";
import type { RenderResult } from "./relstate";

// ─────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────

/** The shape this needs from a message, so it need not import the UI's type.
 *  Identical to repeat.ts's `RepeatTurn` on purpose: brain.ts already holds
 *  exactly this array for T14, and a second, differently-shaped transcript
 *  view is how the two drift. `me` is the PERSON, `her` is the agent — the
 *  same convention `meera_log.role` uses (see relstate.ts's computeCsRatio,
 *  which counts `l.role = 'me'` as the person's own tokens). */
export type ReciprocityTurn = { from: "her" | "me"; text: string; channel?: "chat" | "call" | "watch" };

/** The two disclosure classes, kept separate because they are not the same
 *  act and the literature does not treat them as one. A FEELING disclosure
 *  is affect about the self ("dar lag raha tha", "I felt stupid"); a LIFE
 *  disclosure is a fact or episode from the speaker's own life ("meri behen
 *  ka result aaya", "I quit that job"). Depth differs, so the weights differ
 *  — see DISCLOSURE_WEIGHT. */
export type DisclosureClass = "feeling" | "life";

export interface DisclosureAct {
  /** index INTO THE SCANNED WINDOW, oldest = 0. Never a timestamp. */
  at: number;
  side: "her" | "me";
  cls: DisclosureClass;
  /** decayed contribution this act made to its side's total */
  weight: number;
}

export interface ReciprocityState {
  /** decayed, weighted disclosure by the agent, over the window */
  her: number;
  /** decayed, weighted disclosure by the person, over the window */
  them: number;
  /** (her - them) / (her + them), in [-1, 1]. Negative = she is the one
   *  holding back, which is the direction the Kuki study is about.
   *  Exactly 0 when there is no evidence at all. */
  balance: number;
  /** turns scanned (capped by the window) — a sample-size gate, never
   *  rendered, consumed only as `>= RECIPROCITY_MIN_TURNS`. */
  n: number;
  /** her + them — the evidence mass behind `balance`. A ratio over two acts
   *  is noise, and noise rendered as a claim about a relationship is the
   *  failure this floor exists to make unreachable. */
  evidence: number;
  /** every act found, for evals and for a future audit. Never rendered. */
  acts: readonly DisclosureAct[];
}

// ─────────────────────────────────────────────────────────────────────────
// CONSTANTS — every one of these is a principled default, not a fit. There
// is no measured cohort behind any of them (this ships with zero production
// turns scanned), which is stated here rather than implied by the precision
// of the numbers. `evals/recallbench/` and the drift suite measure the
// MACHINERY; the thresholds themselves are a later, keyed session's job.
// ─────────────────────────────────────────────────────────────────────────

/** Trailing turns scanned, both sides together. Beyond this it is not "have
 *  you been giving anything back lately", it is a personality summary — and
 *  a personality summary is exactly what T11 already renders. */
export const RECIPROCITY_WINDOW = 40;

/** Per-turn geometric decay toward the past. 0.94 puts the half-life at
 *  about eleven turns, so the last ten exchanges carry roughly half the
 *  weight of the whole window: "recent turns dominate" as arithmetic rather
 *  than as an adjective. */
export const RECIPROCITY_DECAY = 0.94;

/** A feeling disclosure is the deeper act and counts for more. The ratio is
 *  1.6:1 rather than anything sharper because the classifier cannot tell a
 *  deep feeling from a shallow one and a bigger multiplier would be a
 *  precision the marker table does not have. */
export const DISCLOSURE_WEIGHT: Record<DisclosureClass, number> = { feeling: 1.6, life: 1.0 };

/** Below this many scanned turns nothing renders, whatever the balance. */
export const RECIPROCITY_MIN_TURNS = 12;

/** Below this much decayed evidence mass nothing renders. Roughly three
 *  recent acts' worth. */
export const RECIPROCITY_MIN_EVIDENCE = 2.5;

/** |balance| at or above this renders. 0.5 means one side carries three
 *  times the other's weight — lopsided enough that a person would notice,
 *  and far enough from parity that ordinary conversational drift does not
 *  flip it. */
export const RECIPROCITY_THRESHOLD = 0.5;

/** Header + one telegraphic row. The CAP is what limits this block, never
 *  the budget — see relstate.ts's capToRenderResult convention. */
export const RECIPROCITY_BUDGET = 260;

// ─────────────────────────────────────────────────────────────────────────
// THE MARKER TABLES — authored, whole-word, Hinglish-first.
//
// Every one of these is matched against a PADDED, punctuation-stripped,
// lowercased haystack (`padR` below), which is relstate.ts's `padT` idiom
// unchanged: whole-word matching without a regex per marker, so "main" never
// fires inside "domain" and "dar" never inside "andar".
// ─────────────────────────────────────────────────────────────────────────

/** Self-reference. Deliberately EXCLUDES the plural/inclusive "hum"/"we"
 *  family: "hum dono" is a WE-token (relstate.ts's WE_TOKEN_RE treats it as
 *  exactly that) and counting a shared-history line as a self-disclosure
 *  would score the T6 callback block as if she had opened up. */
//
//  `padR` strips apostrophes, so "I'm"/"I've" arrive as `i m` / `i ve` and are
//  already covered by " i " — the contracted forms are listed only in their
//  APOSTROPHE-FREE spellings ("im", "ive"), which are what people actually
//  type. " id " is deliberately absent: as a bare token it is an ID card far
//  more often than it is "I'd".
const SELF_MARKERS = [
  " i ", " im ", " ive ", " my ", " me ", " mine ", " myself ",
  " main ", " mai ", " maine ", " mujhe ", " mujhko ", " mujhse ", " mera ", " meri ", " mere ",
  " apne ", " apna ", " apni ",
];

/** Affect about the SELF. Hinglish forms first because that is the register
 *  this product is actually spoken in; the English forms are here because
 *  code-switching under stress is a measured behaviour of this very product
 *  (relstate.ts's cs_on_stress) and a marker set that only reads one lane
 *  would go blind exactly when disclosure matters most. */
const FEELING_MARKERS = [
  // Hinglish
  " lag ", " laga ", " lagi ", " lagta ", " lagti ", " lag raha ", " lag rahi ",
  " dar ", " darr ", " dukh ", " dukhi ", " khush ", " khushi ", " thak ", " thaka ", " thaki ",
  " akela ", " akeli ", " pareshan ", " ghabra ", " ghabrahat ", " tension ", " tanav ",
  " yaad ", " rona ", " roya ", " royi ", " gussa ", " sharam ", " bura ", " dil ",
  " sukoon ", " chinta ", " nafrat ", " pyaar ", " pyar ",
  // English
  " feel ", " feels ", " feeling ", " felt ", " scared ", " afraid ", " sad ", " happy ",
  " tired ", " lonely ", " anxious ", " nervous ", " miss ", " missed ", " worried ", " worry ",
  " angry ", " upset ", " stressed ", " cried ", " hurt ", " ashamed ", " embarrassed ",
  " proud ", " excited ", " guilty ", " overwhelmed ", " love ", " hate ",
];

/** A fact or episode from the speaker's OWN life. Verbs of having-done and
 *  of state, plus the small set of life nouns that only ever appear in a
 *  first-person sentence about oneself. Conservative on purpose: this list
 *  decides the LOWER-weighted class, so a miss costs a little evidence and a
 *  false hit costs a claim about a relationship. */
const LIFE_MARKERS = [
  // Hinglish
  " gaya ", " gayi ", " gaye ", " kiya ", " kari ", " karta ", " karti ", " hua ", " hui ",
  // " the " is NOT here, though it is a real Hinglish past-tense form ("wo
  // gaye the"). It is also the English definite article, and this product is
  // spoken in code-mixed Hinglish where both readings sit in the same
  // sentence — so it fired on "my charger is in the other room" and scored a
  // lost charger as a disclosure about someone's life. There is no
  // disambiguation available at this layer, and a marker that cannot be
  // disambiguated is dropped rather than weighted down: this list decides a
  // claim about a relationship, and the asymmetry in the file header says
  // which way to be wrong.
  " tha ", " thi ", " raha ", " rahi ", " rahe ", " mila ", " mili ", " bola ", " boli ",
  " dekha ", " dekhi ", " khaya ", " khayi ", " soya ", " soyi ", " likha ", " padha ",
  " ghar ", " kaam ", " office ", " ammi ", " papa ", " mummy ", " maa ", " behen ", " bhai ",
  " flat ", " chhutti ", " chutti ",
  // English
  " went ", " did ", " had ", " got ", " made ", " told ", " saw ", " ate ", " slept ",
  " wrote ", " read ", " started ", " stopped ", " quit ", " moved ", " bought ", " met ",
  " home ", " work ", " job ", " mom ", " dad ", " sister ", " brother ", " flatmate ",
];

/** relstate.ts's `padT`, unchanged in behaviour and duplicated rather than
 *  imported for the reason MEERA_AGENT_ID is mirrored rather than imported:
 *  keeping this module's dependency surface to shapelint alone is what makes
 *  it safe to call from anywhere in the client bundle. Four lines of
 *  normalisation are cheaper than an import cycle. */
function padR(s: string): string {
  return (
    " " +
    String(s || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

const anyOf = (hay: string, markers: readonly string[]): boolean => markers.some((m) => hay.includes(m));

/**
 * Classify ONE turn's text. Returns null when it discloses nothing — the
 * common case, and the only outcome that leaves the balance untouched.
 *
 * THE SHAPE, stated so it is checkable rather than inferred:
 *   self-reference AND feeling-marker  → "feeling"
 *   self-reference AND life-marker     → "life"
 *   self-reference alone               → nothing ("mera phone kahan hai" is
 *                                        not a disclosure)
 *   feeling/life marker alone          → nothing ("tu theek hai?" is asking,
 *                                        not telling — and counting a
 *                                        QUESTION about the other person as
 *                                        the asker's own disclosure would
 *                                        invert the entire measure)
 * `feeling` wins when both fire, because a turn carrying both is a feeling
 * ABOUT a life event, which is the deeper of the two acts.
 */
export function classifyDisclosure(text: string): DisclosureClass | null {
  const hay = padR(text);
  if (hay.trim().length === 0) return null;
  if (!anyOf(hay, SELF_MARKERS)) return null;
  if (anyOf(hay, FEELING_MARKERS)) return "feeling";
  if (anyOf(hay, LIFE_MARKERS)) return "life";
  return null;
}

// ─────────────────────────────────────────────────────────────────────────
// THE FOLD — pure, no I/O, no clock. Same inputs, same state, byte-equal
// JSON, every time (relstate.ts's replaySnapshot property, and the reason
// the drift suite can assert this block across a forty-turn sweep at all).
// ─────────────────────────────────────────────────────────────────────────

export function initialReciprocityState(): ReciprocityState {
  return { her: 0, them: 0, balance: 0, n: 0, evidence: 0, acts: [] };
}

/**
 * Folds a transcript into a reciprocity balance.
 *
 * Only the trailing `RECIPROCITY_WINDOW` turns are scanned. Weights decay
 * geometrically toward the past by POSITION (see the G1 note in the header):
 * the newest turn in the window is worth 1, the one before it
 * `RECIPROCITY_DECAY`, and so on.
 *
 * `channel` is carried on the turn type and deliberately NOT filtered on
 * here, unlike repeat.ts's `raisedRecently` which drops call turns. That is
 * not an oversight and the difference is real: repetition is a per-medium
 * clock ("did she raise this again IN THIS THREAD"), while disclosure is
 * about the relationship and a thing he told her on a call is a thing he
 * told her. Stated rather than left as a silent divergence between two
 * functions that take the same array.
 */
export function reciprocityState(turns: readonly ReciprocityTurn[]): ReciprocityState {
  const window = (turns || []).slice(-RECIPROCITY_WINDOW);
  const state = initialReciprocityState();
  state.n = window.length;
  if (!window.length) return state;

  const acts: DisclosureAct[] = [];
  const last = window.length - 1;
  for (let i = 0; i < window.length; i++) {
    const t = window[i];
    if (!t || (t.from !== "her" && t.from !== "me")) continue;
    const cls = classifyDisclosure(t.text);
    if (!cls) continue;
    const decay = Math.pow(RECIPROCITY_DECAY, last - i);
    const weight = DISCLOSURE_WEIGHT[cls] * decay;
    acts.push({ at: i, side: t.from, cls, weight });
    if (t.from === "her") state.her += weight;
    else state.them += weight;
  }

  state.acts = acts;
  state.evidence = state.her + state.them;
  // Exactly 0 with no evidence — never NaN. A NaN balance compares false
  // against every threshold, which would be a silent, permanent "never
  // render" that looks identical to a healthy relationship.
  state.balance = state.evidence > 0 ? (state.her - state.them) / state.evidence : 0;
  // Round to three places, the same treatment relstate.ts's derived dims get,
  // so two folds of the same array cannot differ in the last float bit and
  // the byte-identity property survives serialisation.
  state.her = Math.round(state.her * 1000) / 1000;
  state.them = Math.round(state.them * 1000) / 1000;
  state.evidence = Math.round(state.evidence * 1000) / 1000;
  state.balance = Math.round(state.balance * 1000) / 1000;
  return state;
}

/** The rendered direction, or null when nothing renders. Exported separately
 *  from the renderer so an eval can assert the DECISION without parsing a
 *  block of prose out of a prompt. */
export type ReciprocityLean = "she-holds-back" | "she-carries-it";

export function reciprocityLean(state: ReciprocityState | null | undefined): ReciprocityLean | null {
  if (!state) return null;
  if (!Number.isFinite(state.balance)) return null;
  if (state.n < RECIPROCITY_MIN_TURNS) return null;
  if (state.evidence < RECIPROCITY_MIN_EVIDENCE) return null;
  if (Math.abs(state.balance) < RECIPROCITY_THRESHOLD) return null;
  return state.balance < 0 ? "she-holds-back" : "she-carries-it";
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — T17 `rel.reciprocity`. Pure, no I/O.
//
// `recited-prompt` (context/rejected.md): sentence-shaped text in her brief
// gets recited back verbatim — measured twice, at 4/5 turns and then twice
// eight turns apart. So the row below is a DIAGRAM, not a sentence: two
// halves of a comparison separated by a comma, no capital start, no terminal
// punctuation, no first-person opening, well under the fourteen-word cap.
// `lintBlock` runs over it here, in this module, so a violation surfaces in
// the workstream that wrote it rather than in a compile-time fixture nobody
// is reading that day (relstate.ts's and texture.ts's convention, kept).
//
// NO DIGIT EVER APPEARS IN THE OUTPUT — texture.ts rule 1, taken literally
// for the same reason: a model handed `balance: -0.61` reasons about the
// number; handed a shape it just behaves.
// ─────────────────────────────────────────────────────────────────────────

/** One line, and every clause in it is load-bearing:
 *   - "context only ... never raise unprompted" is the pull-only law (§0.1)
 *     that ships in every tail block;
 *   - "never mention noticing" is what stops the block being narrated;
 *   - the last clause is THE ANTI-FABRICATION FENCE, and it is the reason
 *     this block is safe to render at all. A note that says she has been
 *     holding back is a note a model can resolve by inventing a life detail,
 *     and an invented detail contradicts T7 for the life of the
 *     relationship. So the fence says out loud that the repair is what she
 *     already has, never something new. */
const RECIPROCITY_HEADER =
  "HOW MUCH OF YOURSELF IS IN THIS LATELY — context only, never raise unprompted and never mention noticing it; " +
  "this is not a cue to talk about yourself and never a reason to invent anything new about your life:";

/**
 * Returns "" on most turns BY CONSTRUCTION — every balance inside the
 * threshold, every window under the turn floor, every window under the
 * evidence floor. That is the design, not a degenerate case: this block is
 * for the lopsided minority of relationships and it is silent in the rest.
 */
export function reciprocityNote(state: ReciprocityState | null | undefined): string {
  const lean = reciprocityLean(state);
  if (!lean) return "";
  const row =
    lean === "she-holds-back"
      ? "lately: theirs open, yours held back"
      : "lately: yours open, theirs held back";
  const text = `${RECIPROCITY_HEADER}\n- ${row}`;
  return text.length <= RECIPROCITY_BUDGET ? text : "";
}

/** The `RenderResult` form, for a caller that wants the lint verdict too —
 *  the same pair every other T-slot renderer in this engine exposes. */
export function renderReciprocity(state: ReciprocityState | null | undefined): RenderResult {
  const text = reciprocityNote(state);
  if (!text) return { text: "", lint: { clean: true, violations: 0 } };
  // The header is a header, not a content row (texture.ts's split): only the
  // rendered row is linted, and it is linted with the leading "- " stripped
  // exactly as lintBlock would see it inside a compiled tail.
  const row = text.split("\n").slice(1).join("\n");
  const lint = lintBlock(row);
  let violations = lint.violations.length;
  if (text.length > RECIPROCITY_BUDGET) violations++;
  return { text, lint: { clean: violations === 0, violations } };
}
