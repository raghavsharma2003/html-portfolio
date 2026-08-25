// "What she knows", as data — the read-only half of the Knows surface.
//
// ── why this file exists at all ────────────────────────────────────────────
//
// docs/PRODUCT-SUPERIORITY.md #2 names the two ways a memory screen fails, and
// both are failures of DATA rather than of layout: (a) it renders a
// DESCRIPTION of memory instead of the rows the prompt actually compiles from,
// which is a screen that reads as verification and is checked by nothing; and
// (b) an edit or a delete writes somewhere the compiler does not read, so
// correcting a fact changes nothing she says. So every row this module emits
// is derived from a store that is already read on a real turn — the local
// ledgers `AppState` carries into every prompt, and the relational bundle
// api/memory.js's `op:recall` hands the compiler — and every row that offers a
// FORGET carries the term the EXISTING scoped-forget op can actually reach it
// by. Where the op cannot reach a row, `forgetTerm` is null and the surface
// offers no button, because an affordance that deletes nothing is worse than
// no affordance: it is a promise the product does not keep.
//
// ── what is NOT here, deliberately ────────────────────────────────────────
//
// Nothing writes. Nothing fetches. These are pure functions of state that was
// already read, which is what lets the whole surface be tested offline (see
// evals/knows.mjs) and what keeps a memory browser from becoming a second,
// unmeasured reader of the memory store.
//
// ── the state layer must not import the engine ────────────────────────────
//
// store.ts states that rule and states why (a state module that pulls in
// `engine/` drags Capacitor and the network into `localStorage`). Milestone
// TITLES live in engine/milestones.ts beside their detector, on purpose, so
// the two vocabularies cannot drift. This module therefore takes the titler as
// a PARAMETER — the same duck-typed injection `relstate.ts` uses for its query
// function, and for the same reason.
//
// ── the shape of the copy ─────────────────────────────────────────────────
//
// Human dates, never clock stamps: docs/MEMORY-FELT.md law 4 bans "as you said
// at 3:42pm" from her mouth, and a UI that renders the same receipt on every
// row is the same failure with better typography. Dates are hand-rolled and
// lowercase rather than `toLocaleDateString`, for the reason engine/memory.ts's
// own `agoDaysLabel` gives: a label has to be byte-identical in a browser, in
// Node and in an eval, or the eval is testing a different string than the one
// that ships.

import type { AppState, Message, SelfFact } from "./store";

// ── budgets ───────────────────────────────────────────────────────────────
// Curation over completeness (PRODUCT-SUPERIORITY #2's failure (d), and Apple
// Photos Memories' own rule). A page that shows every row looks sparse on day
// two and clinical on day two hundred; these caps are what make it a scrapbook
// at both ends.

/** Months of story kept on the surface. A year of months is already a long
 *  scroll, and the record itself is never truncated by this — only the view. */
export const KNOWS_MONTHS_MAX = 14;
/** Entries kept per month, newest first. */
export const KNOWS_MONTH_MAX = 10;
/** Rows of hers kept. */
export const KNOWS_HER_MAX = 24;
/** A scoped forget's own limits, mirrored from api/memory.js opForget: a term
 *  under three characters is refused there ("a two-letter term would word-match
 *  half the log"), and a term is sliced to 60 characters — a longer one would
 *  be cut mid-word and match either nothing or the wrong thing. Rows whose
 *  only handle falls outside this window get no forget button. */
export const FORGET_TERM_MIN = 3;
export const FORGET_TERM_MAX = 60;

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];
const MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** "21 aug" — the same shape relstate.ts's `weDay` writes into her own
 *  callbacks, so the date on the screen and the date in her head match. */
export function dayLabel(atMs: number): string {
  const d = new Date(atMs);
  if (!Number.isFinite(d.getTime())) return "";
  return `${d.getDate()} ${MON[d.getMonth()]}`;
}

/** "august" this year, "august 2025" otherwise. The year only when it is not
 *  this one: a heading that says the year every time reads like a filing
 *  system, which is the one thing this surface may not read like. */
export function monthLabel(atMs: number, nowMs: number): string {
  const d = new Date(atMs);
  const n = new Date(nowMs);
  const name = MONTHS[d.getMonth()] ?? "";
  return d.getFullYear() === n.getFullYear() ? name : `${name} ${d.getFullYear()}`;
}

const monthKey = (atMs: number) => {
  const d = new Date(atMs);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

/** callmark.text is the "m:ss" written at hangup (useCallEngine) — the same
 *  parse UsScreen does, and it fails to zero rather than to a guess. */
function callMins(m: Message): number {
  const parts = String(m.text || "").split(":");
  if (parts.length !== 2) return 0;
  const mins = Number(parts[0]);
  const secs = Number(parts[1]);
  if (!Number.isFinite(mins) || !Number.isFinite(secs)) return 0;
  return Math.max(0, Math.round(mins + secs / 60));
}

// ── 1. THE TIMELINE ───────────────────────────────────────────────────────

export type KnowsEntryKind = "met" | "moment" | "call" | "photo" | "game" | "us";

export interface KnowsEntry {
  id: string;
  at: number;
  kind: KnowsEntryKind;
  /** one line, app-voiced, already trimmed to fit a row */
  text: string;
  /** "21 aug" */
  day: string;
}

export interface KnowsMonth {
  key: string;
  label: string;
  entries: KnowsEntry[];
}

/** One dated episode as the relational bundle carries it (vy_episode's `we`
 *  rows). Structurally identical to compiler.ts's WeEpisodeRow; restated as a
 *  local shape so this module imports no engine type at all. */
export interface KnowsEpisode {
  id: number | string;
  summary: string;
  at: string;
}

export interface TimelineInput {
  /** engine/milestones.ts `titleFor`, injected — see the header. */
  titleFor?: (id: string) => string | null;
  /** relstate.weEpisodes from op:recall, or nothing. */
  weEpisodes?: readonly KnowsEpisode[];
  nowMs?: number;
}

const clip = (s: string, n = 92) => {
  const t = String(s || "").trim().replace(/\s+/g, " ");
  return t.length <= n ? t : `${t.slice(0, n - 1).trimEnd()}…`;
};

/**
 * Their story, by month, newest first.
 *
 * Every entry is a thing that HAPPENED and is already recorded somewhere the
 * product reads: the first message, a milestone the detector fired, a call, a
 * picture, a finished game, an episode only the two of them bring up. Messages
 * themselves are deliberately NOT enumerated — a timeline with one row per
 * message is a log file, and the chat is already the place to read those.
 */
export function timelineFrom(state: AppState, input: TimelineInput = {}): KnowsMonth[] {
  const nowMs = input.nowMs ?? Date.now();
  const msgs = Array.isArray(state.messages) ? state.messages : [];
  const out: KnowsEntry[] = [];
  const push = (id: string, at: number, kind: KnowsEntryKind, text: string) => {
    if (!Number.isFinite(at) || at <= 0 || !text) return;
    out.push({ id, at, kind, text, day: dayLabel(at) });
  };

  // the day it started. Always true, always first in the record, and the one
  // row that makes a two-day-old timeline a page rather than an empty state.
  const firstAt = msgs.find((m) => m.at)?.at ?? null;
  const firstFrom = msgs.find((m) => m.at)?.from ?? "me";
  if (firstAt) {
    push(
      "met",
      firstAt,
      "met",
      firstFrom === "her" ? "she texted you first" : "you texted her first",
    );
  }

  // ── milestones, dated the way UsScreen dates them ────────────────────────
  // The fired-ledger stores no timestamps (ids are all it needs to guarantee
  // once-only), but three of the five families are exactly recoverable from the
  // record itself. The rest are dropped from THIS view rather than approximated:
  // an undated row cannot be placed in a month, and a month is the whole
  // organising idea here. UsScreen renders them undated instead, which is the
  // right answer for a list and the wrong one for a calendar.
  const chat = msgs.filter((m) => m.kind !== "callmark");
  const calls = msgs.filter((m) => m.kind === "callmark");
  const titleFor = input.titleFor;
  if (titleFor) {
    const seen = new Set<string>();
    const DAY = 86_400_000;
    for (const id of state.momentsFired ?? []) {
      if (seen.has(id)) continue;
      seen.add(id);
      const title = titleFor(id);
      if (!title) continue;
      let at: number | null = null;
      if (id.startsWith("days-") && firstAt) at = firstAt + Number(id.slice(5)) * DAY;
      else if (id.startsWith("msgs-")) at = chat[Number(id.slice(5)) - 1]?.at ?? null;
      else if (id.startsWith("calls-")) at = calls[Number(id.slice(6)) - 1]?.at ?? null;
      if (at) push(`moment:${id}`, at, "moment", title);
    }
  }

  for (const m of calls) {
    const mins = callMins(m);
    push(
      `call:${m.id}`,
      m.at,
      "call",
      mins >= 1 ? `a call, ${mins} min` : "a call",
    );
  }

  for (const m of msgs) {
    if (m.kind !== "photo" && !m.photoUrl) continue;
    push(
      `photo:${m.id}`,
      m.at,
      "photo",
      m.from === "her" ? "she sent you a picture" : "you sent her a picture",
    );
  }

  for (const a of state.activities ?? []) {
    if (!a || !a.summary) continue;
    push(`game:${a.kind}:${a.startedAt}`, a.closedAt, "game", clip(a.summary));
  }

  // the episodes only the two of them bring up, straight off the bundle the
  // compiler reads. These are the rows her own callbacks are built from, which
  // is exactly why they belong on a page about what she knows.
  for (const e of input.weEpisodes ?? []) {
    const at = new Date(e?.at ?? "").getTime();
    if (!Number.isFinite(at) || !e?.summary) continue;
    push(`us:${e.id}`, at, "us", clip(e.summary));
  }

  // ── into months ──────────────────────────────────────────────────────────
  const byMonth = new Map<string, KnowsEntry[]>();
  for (const e of out.sort((a, b) => b.at - a.at)) {
    const k = monthKey(e.at);
    const arr = byMonth.get(k);
    if (arr) arr.push(e);
    else byMonth.set(k, [e]);
  }
  return [...byMonth.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, KNOWS_MONTHS_MAX)
    .map(([key, entries]) => ({
      key,
      label: monthLabel(entries[0].at, nowMs),
      entries: entries.slice(0, KNOWS_MONTH_MAX),
    }));
}

// ── 2. FACTS SHE HOLDS ────────────────────────────────────────────────────

export type KnowsFactKind =
  | "name"
  | "looking"
  | "kin"
  | "region"
  | "currency"
  | "ritual"
  | "phrase"
  | "pattern";

export interface KnowsFact {
  id: string;
  kind: KnowsFactKind;
  /** the row, in words. App chrome, never a line she would say. */
  text: string;
  /**
   * The word the EXISTING `op:forget` `scope:"item"` can reach this row by, or
   * null when it cannot. Null is not laziness and it is not a TODO: api/memory.js's
   * cascade deletes vy_kin by `name`, vy_currency by `topic`, vy_phrase by
   * `phrase`/`gloss` and vy_pattern by `if_shape`/`then_note` on a term match —
   * and deletes vy_ritual ONLY by citation, which a term forget cannot supply.
   * The India profile (home region) is reached only by a whole wipe. Rows that
   * name null are shown WITHOUT a forget control, and the honest route for them
   * is the one that always works: telling her.
   */
  forgetTerm: string | null;
  /** what the composer is prefilled with when he taps the correction. */
  correct: string;
}

/** The relational bundle, as much of it as this surface reads. Restated
 *  locally (no engine import) and every field optional: a bundle that has not
 *  been built yet, or a read that timed out, renders nothing rather than a
 *  placeholder — the same absence-not-a-zero default the rest of the app takes. */
export interface KnowsBundle {
  kin?: readonly { name?: string; relation?: string; address_term?: string; provisional?: boolean }[];
  rituals?: readonly { key?: string; count?: number }[];
  currency?: readonly { topic?: string; kind?: string }[];
  phrases?: readonly { phrase?: string; gloss?: string }[];
  patterns?: readonly { then_note?: string; if_shape?: string; prompt_eligible?: boolean }[];
  homeRegion?: string | null;
  /** the dated episodes only the two of them bring up — the timeline reads
   *  these, `factsFrom` does not. Same bundle, one read. */
  weEpisodes?: readonly KnowsEpisode[];
}

/** The correction opener, verbatim from the brief and from the way a person
 *  actually opens this in Hinglish. It is HIS message, not hers: the whole
 *  mechanism is that a correction arrives the way every other fact arrived, as
 *  a normal turn she reads, so the corrected bytes reach a compiled prompt by
 *  the route that is already proven rather than a new one. */
export const CORRECT_OPENER = "waise wo galat yaad hai tumhe... ";

const correctFor = (subject: string) => `${CORRECT_OPENER}${subject}`.trimEnd();

const reachable = (term: string | null | undefined): string | null => {
  const t = String(term ?? "").trim().toLowerCase();
  if (t.length < FORGET_TERM_MIN || t.length > FORGET_TERM_MAX) return null;
  return t;
};

/** Ritual keys are enum-ish (`khana_khaya`, `good_morning`) because that is
 *  what the writer and the model both read. A person is not shown a key. An
 *  unknown key falls back to its own words rather than being dropped: a ritual
 *  this map has not learned yet is still a true thing about them. */
const RITUAL_LABEL: Record<string, string> = {
  khana_khaya: "she asks if you've eaten",
  good_morning: "you two say good morning",
  good_night: "you two say good night",
  match_checkin: "you check in on the match",
  chai: "the chai check-in",
};
export function ritualLabel(key: string): string {
  const k = String(key || "").trim().toLowerCase();
  return RITUAL_LABEL[k] ?? k.replace(/_/g, " ");
}

/**
 * The things she holds about him, as rows.
 *
 * Order is deliberate and is the opposite of a database's: the two he told her
 * himself come first, then the people in his life, then where he is from, then
 * what he is into, then the two of them, and the derived observations LAST.
 * A page that opens on machine-derived inferences about a person reads as a
 * dossier no matter how warm the font is.
 */
export function factsFrom(state: AppState, bundle: KnowsBundle | null | undefined): KnowsFact[] {
  const out: KnowsFact[] = [];
  const b = bundle ?? {};

  const name = String(state.user?.name || "").trim();
  if (name) {
    out.push({
      id: "name",
      kind: "name",
      text: `she calls you ${name}`,
      // meera_state is rewritten by a whole wipe, not by a term forget, and a
      // name is the one fact nobody wants deleted anyway. Corrected, not dropped.
      forgetTerm: null,
      correct: correctFor("mera naam"),
    });
  }

  const vibe = (state.user?.vibe ?? []).filter(Boolean);
  if (vibe.length) {
    out.push({
      id: "looking",
      kind: "looking",
      text: `you came here for ${vibe.join(", ")}`,
      forgetTerm: null,
      correct: correctFor("jo main dhoond raha tha"),
    });
  }

  for (const k of b.kin ?? []) {
    const kn = String(k?.name ?? "").trim();
    const rel = String(k?.relation ?? "").trim();
    if (!kn || !rel) continue;
    const addr = String(k?.address_term ?? "").trim();
    out.push({
      id: `kin:${kn}:${rel}`,
      kind: "kin",
      // the hedge is carried, not hidden: `provisional !== false` is the same
      // under-claiming read renderKin takes, so a row she is unsure about
      // looks unsure here too.
      text:
        `${kn} is your ${rel}` +
        (addr ? `, you call them ${addr}` : "") +
        (k?.provisional !== false ? ", she thinks" : ""),
      forgetTerm: reachable(kn),
      correct: correctFor(kn),
    });
  }

  const region = String(b.homeRegion ?? "").trim();
  if (region) {
    out.push({
      id: "region",
      kind: "region",
      text: `you're from ${region}`,
      forgetTerm: null,
      correct: correctFor("main kahan se hoon"),
    });
  }

  for (const c of b.currency ?? []) {
    const topic = String(c?.topic ?? "").trim();
    if (!topic) continue;
    out.push({
      id: `currency:${topic}`,
      kind: "currency",
      text: `you're into ${topic}`,
      forgetTerm: reachable(topic),
      correct: correctFor(topic),
    });
  }

  for (const r of b.rituals ?? []) {
    const key = String(r?.key ?? "").trim();
    if (!key) continue;
    out.push({
      id: `ritual:${key}`,
      kind: "ritual",
      text: ritualLabel(key),
      // see KnowsFact.forgetTerm: vy_ritual dies by citation only.
      forgetTerm: null,
      correct: correctFor(ritualLabel(key)),
    });
  }

  for (const p of b.phrases ?? []) {
    const phrase = String(p?.phrase ?? "").trim();
    if (!phrase) continue;
    const gloss = String(p?.gloss ?? "").trim();
    out.push({
      id: `phrase:${phrase}`,
      kind: "phrase",
      text: gloss ? `"${phrase}" means ${gloss}` : `"${phrase}" is yours`,
      forgetTerm: reachable(phrase),
      correct: correctFor(phrase),
    });
  }

  // LAST, and only the ones she is actually allowed to use. A pattern row that
  // is not prompt-eligible has never reached a prompt, and showing it would be
  // this screen claiming she knows something she does not.
  for (const p of b.patterns ?? []) {
    if (p?.prompt_eligible === false) continue;
    const note = String(p?.then_note ?? "").trim();
    if (!note) continue;
    out.push({
      id: `pattern:${note.slice(0, 40)}`,
      kind: "pattern",
      text: clip(note),
      forgetTerm: reachable(note),
      correct: correctFor("wo baat"),
    });
  }

  return out;
}

// ── 3. HER SIDE ───────────────────────────────────────────────────────────

export interface KnowsHerRow {
  id: string;
  at: number;
  day: string;
  text: string;
}

/**
 * What she has told him about her own life — the told-ledger, which is already
 * on the device (`AppState.herLife`) and already compiled into every prompt by
 * `formatHerLife`. docs/MEMORY-FELT.md law 6: "a companion with memory of him
 * and none of herself is an interviewer."
 *
 * Momentary claims are dropped. `SelfFactKind` splits durable facts ("my
 * flatmate is sneha") from activities ("khana bana rahi hu"), and an activity
 * is true for an hour: a scrapbook page listing what she was doing on a
 * Tuesday in June is a log, and worse, it is a log of a thing that has ended.
 * Absent kind means "fact" — the same byte-identical read `formatHerLife`
 * takes for every ledger that predates the field.
 */
export function herSideFrom(state: AppState): KnowsHerRow[] {
  const rows = (state.herLife ?? []) as SelfFact[];
  return rows
    .filter((f) => f && f.text && f.kind !== "activity" && Number.isFinite(f.at))
    .sort((a, b) => b.at - a.at)
    .slice(0, KNOWS_HER_MAX)
    .map((f, i) => ({
      id: `her:${f.at}:${i}`,
      at: f.at,
      day: dayLabel(f.at),
      text: clip(f.text, 120),
    }));
}

/** Is there anything at all to show? Absence is a state this surface renders
 *  in one warm line, never as three empty sections with headings over them. */
export function knowsIsEmpty(
  months: readonly KnowsMonth[],
  facts: readonly KnowsFact[],
  her: readonly KnowsHerRow[],
): boolean {
  return months.length === 0 && facts.length === 0 && her.length === 0;
}
