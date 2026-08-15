// Shape-lint — SPEC §3.3. Mechanized, deterministic, no LLM. Guards the
// `recited-prompt` law (context/decisions.md, context/rejected.md): anything
// sentence-shaped in a prompt gets recited back verbatim. Measured twice on
// this codebase — example quotes recited 4/5 turns, authored taste written
// as English sentences recited twice 8 turns apart and triggered register
// defection on 13/96 turns. "Write shapes, never lines she could say."
//
// TWO SEPARATE JOBS, do not conflate them:
//
//  1. Content-row lints (word count, sentence shape, first-person-line-
//     initial) target AUTHORED-DATA rows destined for the volatile TAIL —
//     facts, episode summaries, pattern notes, taste rows. They do NOT run
//     over persona.ts's core prose, which is instructional English by
//     design (it tells the model how to sound; it is not itself a line she
//     says) and is owned, read-only, by a different law entirely
//     (`prompt-position`). Running these lints over the whole core would
//     flag the persona brief itself as broken. `lintBlock` takes an explicit
//     allowlist for exactly this reason.
//  2. Structural checks (core byte-stability, appended-last-set-of-two,
//     T10 position) are compiler-shape assertions, unrelated to word-level
//     content lint. They run over compiler.ts's actual output.
//
// SPEC's own calibration note applies: "Rules carry a Hinglish calibration
// set before enforcement." These are the mechanized rules only — the
// Hinglish calibration corpus is WS-BATTERY's job (M4/M6), logged here as an
// interface dependency, not built in this file.

import { SEARCH_DECISION, FORGET_DECISION } from "./persona";
import { hashCore } from "./compiler";

export interface LineViolation {
  line: string;
  reasons: string[];
}

const MAX_WORDS = 14;
// capital start + terminal punctuation — the two cheap signals of "this
// reads like a line a person could say out loud", not a telegraphic note
const SENTENCE_SHAPED_RE = /^[A-Z][^.?!]*[.?!]$/;
// a line that OPENS as her speaking in first person is the shape a phrase
// bank recites from — telegraphic notes are written in third person / as
// bare facts ("flatmate: sneha"), never "I told him...", "main..."
const FIRST_PERSON_LINE_INITIAL_RE = /^(i\b|i'm\b|i've\b|main\b|mai\b|mujhe\b|meri\b|mera\b|maine\b)/i;

function wordsOf(line: string): string[] {
  return line.trim().split(/\s+/).filter(Boolean);
}

/** Lints ONE line of authored content (a fact row, a summary, a taste row —
 * never a whole persona brief). Returns the empty array when clean. */
export function lintLine(line: string): LineViolation {
  const trimmed = line.trim();
  const reasons: string[] = [];
  if (!trimmed) return { line, reasons };

  const words = wordsOf(trimmed);
  if (words.length > MAX_WORDS) reasons.push(`too long: ${words.length} words (cap ${MAX_WORDS})`);
  if (SENTENCE_SHAPED_RE.test(trimmed)) reasons.push("sentence-shaped (capital start + terminal punctuation)");
  if (FIRST_PERSON_LINE_INITIAL_RE.test(trimmed)) reasons.push("first-person-Meera voice, line-initial");

  return { line, reasons };
}

export interface LintReport {
  violations: LineViolation[];
  linesChecked: number;
  clean: boolean;
}

/** Lints a block of authored content, one line per row (the shape everything
 * in T3–T7 renders as: "- subject: telegraphic note (when)"). `allowlist`
 * lines are skipped verbatim — for the ONE class where the rule is inverted
 * on purpose: CRISIS_LINES must ship exactly as written (§3.1 C2), and
 * shared-language / phrase-ledger rows are "THEIR line, not a line written
 * for her" (SPEC §2.4 vy_phrase comment) — verbatim storage is the point. */
export function lintBlock(text: string, allowlist: readonly string[] = []): LintReport {
  const violations: LineViolation[] = [];
  let linesChecked = 0;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    if (allowlist.some((a) => line.includes(a))) continue;
    linesChecked++;
    const result = lintLine(line);
    if (result.reasons.length) violations.push(result);
  }
  return { violations, linesChecked, clean: violations.length === 0 };
}

// ─────────────────────────────────────────────────────────────────────────
// Structural checks — compiler-shape assertions over real compiled output.
// ─────────────────────────────────────────────────────────────────────────

/** cache-9x guard: CORE must be byte-identical across consecutive turns for
 * the same (persona_version, model, medium) — any per-turn byte here
 * multiplies cost 9.2× (context/decisions.md `cache-9x`). */
export function checkCoreByteStable(coreA: string, coreB: string): { stable: boolean; hashA: string; hashB: string } {
  return { stable: coreA === coreB, hashA: hashCore(coreA), hashB: hashCore(coreB) };
}

/** The appended-last set is capped at EXACTLY these two rules
 * (SEARCH_DECISION, FORGET_DECISION) — "position is a scarce resource;
 * adding rules here dilutes the mechanism that makes them fire" (SPEC T10
 * row). Asserts: FORGET_DECISION is the tail's literal suffix, and when
 * SEARCH_DECISION is present (chat mode) it sits immediately before
 * FORGET_DECISION with nothing else between or after. */
export function checkAppendedLastExactlyTwo(
  tail: string,
  hasSearch: boolean,
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  if (!tail.endsWith(FORGET_DECISION)) {
    reasons.push("FORGET_DECISION is not the tail's literal suffix (T10 must be pinned last)");
  }
  if (hasSearch) {
    const wantSuffix = SEARCH_DECISION + FORGET_DECISION;
    if (!tail.endsWith(wantSuffix)) {
      reasons.push(
        "SEARCH_DECISION + FORGET_DECISION are not contiguous at the tail's end — " +
          "the appended-last set must be exactly these two, adjacent, nothing between",
      );
    }
  }
  return { ok: reasons.length === 0, reasons };
}

/** Position assertions for SEARCH_DECISION/FORGET_DECISION specifically
 * (SPEC §3.3, `prompt-position` law: identical rule fired 0/8 mid-brief,
 * 8/8 appended last). */
export function checkDecisionPositions(
  tail: string,
  hasSearch: boolean,
): { searchLast: boolean; forgetLast: boolean } {
  const forgetIdx = tail.lastIndexOf(FORGET_DECISION);
  const forgetLast = forgetIdx !== -1 && forgetIdx === tail.length - FORGET_DECISION.length;
  if (!hasSearch) return { searchLast: true, forgetLast }; // vacuously true: no search rule this lane
  const searchIdx = tail.lastIndexOf(SEARCH_DECISION);
  const searchLast = searchIdx !== -1 && searchIdx === forgetIdx - SEARCH_DECISION.length;
  return { searchLast, forgetLast };
}
