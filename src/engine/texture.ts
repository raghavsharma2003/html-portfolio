// Relational texture — the same person, a different rapport.
// SPEC-SELF-LAYER §6 (T11 `rel.texture`, budget 600), migration 011's
// `vy_rel_texture`. WS-TEXTURE.
//
// Ownership: this file belongs to WS-TEXTURE exclusively. Nothing here is
// wired — every export is called by something outside this workstream (the
// deriver by a consolidate cron step, the renderer by compiler.ts's TAIL
// assembly), listed as interface tickets in the WS-TEXTURE report rather
// than wired here (SPEC §13's collision contract).
//
// ARCHITECTURE NOTE — this file is relstate.ts's sibling and deliberately
// looks like it. src/engine/*.ts is the CLIENT bundle, so this file never
// imports api/_db.js or api/_config.js: every DB-facing function takes a
// `QueryFn` (duck-typed against api/_db.js's `q`, imported as a TYPE only)
// so a server caller passes the real thing and a test passes a fake one.
// The counting and the renderer are pure — no I/O, no clock reads at all.
//
// ── WHY THIS EXISTS ──────────────────────────────────────────────────────
// vy_rel_state already varies honorific, code-switch, trust, repair, ritual
// density and pacing. Everything else about how she talks is uniform: the
// same teasing, the same humour, the same swearing, for a best friend of six
// months and someone who signed up yesterday. Real rapport is mostly
// texture, and texture is fully derivable from turns that already exist —
// no LLM call, no judgment, just counting.
//
// ── THE FOUR RULES THIS FILE IS BUILT OUT OF ─────────────────────────────
//
// 1. COARSE BANDS ONLY, NEVER NUMBERS. vy_rel_state's state-leak guard
//    (§12.5), applied unchanged: a model handed `teasing: 0.34` starts
//    reasoning about the number; handed `teasing: regular` it just talks
//    that way. Enforced here beyond the spirit of the rule: `renderTexture`
//    emits NO DIGIT AT ALL, ever — a free-text field (nickname, an avoid
//    topic) containing a digit is dropped rather than rendered, so "T11
//    contains no digits" is one regex a future reader can check forever
//    instead of an argument about which numbers count as leaks.
//
// 2. THE n_turns FLOOR IS A GATE, NOT ADVICE. Below `TEXTURE_N_TURNS_FLOOR`
//    of her turns the renderer returns nothing. A ratio over six turns is
//    noise, and noise rendered as "she teases him a lot" is a personality
//    assigned at random. The gate is the first statement in the renderer,
//    before any band is computed, so there is no path around it.
//
// 3. `avoid` FAILS CLOSED. Over-avoiding is a mild flatness; under-avoiding
//    re-opens a wound. Same asymmetry that decided `speaker-id`
//    (rejected.md): "someone else can also take the floor" is an annoyance,
//    "she stopped answering me" ends the product — so the cheap failure is
//    chosen deliberately and the expensive one is made unreachable. Here
//    that means an UNCITED avoid entry cannot render, and any structural
//    doubt about which citation belongs to which topic drops the WHOLE
//    column rather than guessing a pairing. See `renderTexture`.
//    The deriver writes NO avoid entries at all today — see DERIVER NOTES.
//
// 4. TEXTURE VARIES RAPPORT, NOT HER REGISTER. §11's reversal condition for
//    this section is that texture bands move judged register scores *at
//    all*; the register is the product. So the render set is defined by a
//    rule rather than by taste: **T11 renders only axes persona.ts does not
//    already govern with an authored rule.** persona.ts governs emoji rate
//    (its EMOJI RULES line: "roughly 4–5 messages per 10 carry one"),
//    reaction/gif frequency ("a couple of times per 10 messages") and
//    message length (the register rules). Those axes are DERIVED AND
//    STORED — §11 needs them to be measurable — and never rendered, because
//    a band competing with an authored register rule is exactly how texture
//    would move the register instead of the rapport. Teasing, humour,
//    swearing, nickname and avoid carry no authored numeric rule, and those
//    are the five that render.
//
// ── THE CONTENT / USAGE LINE (G1), DRAWN EXPLICITLY ──────────────────────
// inner.ts G1: no code path from any usage metric — reply speed, silence,
// gap length, message counts, session length, app opens — into persisted
// state. SPEC §0's restatement: "every new self-state writer is fed
// conversation TEXT ONLY. Input starvation is the guarantee, not a filter."
//
// CONTENT (what was said — allowed): a media tag inside the text she sent,
// the words of a turn, an emoji in a turn, a laughter/tease marker, a swear
// word. All of these are properties of the STRING. Every one of them
// survives shuffling the rows and deleting every timestamp, which is the
// test used here for whether something is content.
//
// USAGE (when/how often — excluded): reply latency, gap length, session
// length, time of day, app opens, messages per day, relationship age,
// streaks. NONE of these are read. The guarantee is structural, not a
// filter: `TEXTURE_SCAN_SQL` projects exactly one column, `l.content`, and
// names no time column anywhere — not even in its ORDER BY, which sorts by
// `l.id` (monotonic identity) precisely so no timestamp is touched at any
// point in the derivation. There is no `Date` in this file.
//
// THE ONE AMBIGUOUS METRIC, named rather than argued away: `n_turns` is a
// message count, and message counts are on G1's usage list by name. It is
// kept because the floor cannot exist without it, and it is defanged three
// ways: (a) it is capped by `TEXTURE_SCAN_LIMIT`, so it saturates and cannot
// track engagement; (b) it is never rendered in any form, coarse or
// otherwise; (c) it is consumed as a boolean (`n_turns >= FLOOR`) and
// nothing else. A sample-size gate over a fixed window is not a reading of
// the user, but it is close enough to the line that it is written down here
// rather than left for someone to discover.
//
// ── THE FEEDBACK LOOP, named because it is this design's real risk ───────
// Every counter here measures HER OWN output and then feeds a band back to
// her. Left alone that is a runaway: teases → "constant" → teases more.
// Three dampers: bands are coarse (three or four buckets, so ordinary drift
// does not flip one), the window is a fixed trailing `TEXTURE_SCAN_LIMIT`
// (old behaviour ages out instead of accumulating), and the render header
// frames the block as description of a rapport rather than an instruction.
// If §11's judged runs show register movement, rule 4 above is where to look
// first and the drop priority (7, the lowest in the tail) is what makes
// removing this block cheap.

import type { QueryFn, RenderResult } from "./relstate";
import { MEERA_AGENT_ID } from "./relstate";
import { lintLine, lintBlock } from "./shapelint";

export type { QueryFn, RenderResult };

// ─────────────────────────────────────────────────────────────────────────
// Types — mirror db/migrations/011_self_layer.sql's vy_rel_texture exactly.
// ─────────────────────────────────────────────────────────────────────────

export interface TextureRow {
  agent_id: string;
  person_id: string;
  /** her teasing turns / her turns */
  teasing: number;
  /** her turns carrying laughter / her turns */
  humour: number;
  /** gif+voicenote+photo+selfie+sticker tags / her turns — STORED, NOT RENDERED (rule 4) */
  media_rate: number;
  /** median words per turn — STORED, NOT RENDERED (rule 4) */
  words_median: number;
  /** her turns carrying an emoji / her turns — STORED, NOT RENDERED (rule 4) */
  emoji_rate: number;
  /** her turns carrying a swear / her turns */
  profanity: number;
  /** free text, never written by the deriver — see DERIVER NOTES */
  nickname: string;
  /** topics that went badly, cited. Never written by the deriver — see DERIVER NOTES */
  avoid: string[];
  /** one anchor episode id per `avoid` entry, same index. See `renderTexture` */
  avoid_cites: number[];
  /** SAMPLE-SIZE GATE ONLY. Never rendered. See the G1 note in the header */
  n_turns: number;
}

/** The floor, §6: "texture is not rendered below a floor (≥40 of her
 *  turns)". A hard gate in the renderer, not advice to a caller. */
export const TEXTURE_N_TURNS_FLOOR = 40;

/** Fixed trailing window of her turns. Bounded on purpose: it makes
 *  `n_turns` saturate (see the G1 note) and it ages old behaviour out
 *  instead of accumulating it. Same order of magnitude as
 *  consolidate.js's PHRASE_SCAN_LIMIT and relstate.ts's 200-row cs_ratio
 *  window — a texture that reaches back further would describe a rapport
 *  neither of them is in any more. */
export const TEXTURE_SCAN_LIMIT = 400;

// ─────────────────────────────────────────────────────────────────────────
// The marker sets. Three are MIRRORED from lists that already exist in this
// repo; one is new and says so. Mirrors rather than imports for the reason
// relstate.ts mirrors MEERA_AGENT_ID: the sources are either not exported
// (moment.ts's MOMENT_KEYS) or live in a file this bundle must not reach
// (evals/*.mjs). Every mirror below has a drift guard in
// evals/self/texture.mjs — a copied constant drifts unless something fails.
// ─────────────────────────────────────────────────────────────────────────

/** MIRROR of evals/dbattery/common.mjs's MEDIA_RE, which is itself kept
 *  byte-identical to evals/fixtures.mjs's — that module's own words: "two
 *  batteries measuring 'a media tag' differently is exactly the drift this
 *  module exists to prevent." Three copies now, one guard (the eval asserts
 *  source equality against the dbattery original). */
export const TEXTURE_MEDIA_RE = /\[(gif|sent a meme gif|voicenote|photo|selfie|sticker)[:\]]/i;

/** REUSE, not a new list: the repo's existing emoji predicate is
 *  BigEmoji.tsx's `/^\p{Extended_Pictographic}️?$/u`. persona.ts's EMOJI
 *  RULES line is a *vocabulary* (which emoji she may use), not a detector,
 *  and copying it here would create a second list that drifts the moment
 *  persona edits its own — and would also miss the emoji she is banned from
 *  using, which still count as "she used an emoji" when measuring what
 *  actually happened. The Unicode property is the detector; there is no list. */
export const TEXTURE_EMOJI_RE = /\p{Extended_Pictographic}/u;

/** MIRROR of moment.ts's `MOMENT_KEYS.teasing`, split in two.
 *
 *  Why split: moment.ts's single teasing list mixes pure laughter ("haha",
 *  "lol") with actual teasing ("roast", "chhed"). Counting both as one
 *  number would make `teasing` and `humour` the same counter wearing two
 *  names, and two identical bands rendered under different labels is worse
 *  than one band — it reads as corroboration.
 *
 *  Why mirrored and not imported: MOMENT_KEYS is not exported, and
 *  `detectMomentShape` may not be called on her own output — moment.ts's own
 *  contract ("Reads ONLY the current user turn… never her own output, so it
 *  cannot be gamed into a self-fulfilling moment", plus the pull-only law in
 *  its header). Reading her turns is exactly what this file does, so the
 *  classifier is off-limits and the vocabulary is mirrored instead.
 *
 *  FOUND WHILE MIRRORING (reported, not fixed — moment.ts is not this
 *  workstream's file): the emoji entries in MOMENT_KEYS.teasing ("🙄",
 *  "😏") are dead there. moment.ts's `padT` strips every non-letter/digit
 *  character before matching, so those two keys can never fire inside
 *  `detectMomentShape`. They work here because `padTexture` below preserves
 *  emoji deliberately. */
export const TEASING_MARKERS = [
  "joke", "mazak", "chill kar", "chhed", "tease", "roast", "savage",
  "just kidding", "obviously not", "🙄", "😏",
] as const;

/** MIRROR of the laughter half of moment.ts's `MOMENT_KEYS.teasing`, plus
 *  the three emoji persona.ts's own EMOJI RULES line glosses as laughter
 *  ("😭 (laughing/drama) 😂 💀 (dead/done)") — her declared laughter
 *  vocabulary, taken from where it is already written down rather than
 *  guessed at. `humour` is measured as laughter she produced: zero judgment,
 *  purely lexical, and it never claims a joke was funny. */
export const HUMOUR_MARKERS = [
  "lol", "haha", "hehe", "lmao", "😭", "😂", "💀",
] as const;

/** Elongation, which a fixed marker list cannot cover and which persona.ts's
 *  register rules make routine ("the stretched vowels… the laughter — is
 *  your actual vocabulary"). Whole-token, against the padded text, so
 *  "hahahaha" and "looool" count and an ordinary word never does. Not a new
 *  vocabulary: it is the same four tokens as HUMOUR_MARKERS with their
 *  repeats. */
export const LAUGH_ELONGATION_RE = /(?:^| )(?:(?:ha|he){2,}h?|l+o+l+z?|lm+f?a+o+)(?: |$)/u;

/** NEW LIST, and the only one in this file. Flagged as required: no
 *  profanity vocabulary exists anywhere in this repo (grepped across src/,
 *  api/ and evals/ — persona.ts has no swearing rule at all), so `profanity`
 *  cannot be counted without one.
 *
 *  Deliberately small, common and mild, whole-word matched. It is a COUNTER
 *  ONLY: no entry in this list ever reaches a prompt — the render path emits
 *  a band word ("occasional"), never a matched token — so it carries no
 *  `recited-prompt` exposure. It is under-inclusive on purpose, which is the
 *  cheap direction here: a missed swear reads as a slightly more formal
 *  rapport, an over-eager match reads as "swearing: free" for someone she
 *  has never sworn at. */
export const PROFANITY_MARKERS = [
  "fuck", "fucking", "fucked", "shit", "bullshit", "bitch", "damn", "asshole",
  "bhenchod", "behenchod", "bc", "madarchod", "mc", "chutiya", "chutiye",
  "gandu", "harami", "kamina", "kamine", "saala", "saali", "bakchod",
  "bakchodi", "randi", "lauda", "chodu",
] as const;

// ─────────────────────────────────────────────────────────────────────────
// Pure counting. No I/O, no clock, no timestamps — the whole derivation is
// a function of an array of strings, which is the G1 guarantee stated as a
// type signature rather than as a promise.
// ─────────────────────────────────────────────────────────────────────────

/** Lowercase, punctuation-to-space, space-padded — relstate.ts's `padT` and
 *  moment.ts's `padT`, with ONE deliberate difference: Extended_Pictographic
 *  characters survive, because two of the teasing markers and three of the
 *  laughter markers are emoji. (This is why those keys are dead in moment.ts
 *  and live here.) */
export function padTexture(s: string): string {
  return (
    " " +
    String(s || "")
      .toLowerCase()
      // emoji are space-separated FIRST: they arrive glued to words ("haha😭")
      // and a whole-token match would miss every one of them otherwise.
      .replace(/(\p{Extended_Pictographic})/gu, " $1 ")
      .replace(/[^\p{L}\p{N}\p{Extended_Pictographic}]+/gu, " ")
      .replace(/\s+/g, " ")
      .trim() +
    " "
  );
}

/** MIRROR of evals/dbattery/common.mjs's `rawWords`: "computes on RAW text,
 *  no cleaning" is that module's counting discipline and this must match it
 *  exactly, or the D-battery's words/turn band and this column would be two
 *  different measurements sharing a name. */
export function rawWords(text: string): number {
  return String(text || "").split(/\s+/).filter(Boolean).length;
}

/** MIRROR of evals/dbattery/common.mjs's `percentile` — same ceil-indexed
 *  definition, for the same no-two-definitions reason as `rawWords`. */
export function percentile(nums: readonly number[], p: number): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1));
  return s[idx];
}

/** Whole-token / whole-phrase containment against the padded text — the
 *  same match discipline as relstate.ts's address markers and culture.ts's
 *  COMMON set. Never a substring match: "assholes" must not make "asshole"
 *  fire is the easy case; "bc" inside "abc" is the one that would actually
 *  happen. */
const hasAny = (padded: string, markers: readonly string[]): boolean =>
  markers.some((m) => padded.includes(padTexture(m)));

/** Ratios rounded to 3dp exactly as relstate.ts's computeCsRatio does — a
 *  stored float that re-derives to a different last bit is a byte-identity
 *  failure waiting for the next replay gate. */
const r3 = (n: number): number => Math.round(n * 1000) / 1000;

export interface TextureCounts {
  teasing: number;
  humour: number;
  media_rate: number;
  words_median: number;
  emoji_rate: number;
  profanity: number;
  n_turns: number;
}

/**
 * THE DERIVATION, entire. Pure: same array in, byte-identical object out,
 * with no ordering dependence (every metric is a count or a median, both
 * permutation-invariant) — so the determinism gate reduces to "is this
 * function pure", which is checkable by reading it.
 *
 * Denominator is her turns throughout, per §6's own definitions ("her
 * teasing turns / her turns", "gif+voicenote+photo / her turns"). A turn
 * counts once for an axis no matter how many markers it carries: this
 * measures how often a rapport shows up, not how loud one message was.
 */
export function textureCounts(contents: readonly string[]): TextureCounts {
  const n = contents.length;
  if (!n) {
    return { teasing: 0, humour: 0, media_rate: 0, words_median: 0, emoji_rate: 0, profanity: 0, n_turns: 0 };
  }
  let teasing = 0;
  let humour = 0;
  let media = 0;
  let emoji = 0;
  let profanity = 0;
  const words: number[] = [];
  for (const raw of contents) {
    const text = String(raw || "");
    const padded = padTexture(text);
    if (hasAny(padded, TEASING_MARKERS)) teasing++;
    if (hasAny(padded, HUMOUR_MARKERS) || LAUGH_ELONGATION_RE.test(padded)) humour++;
    if (hasAny(padded, PROFANITY_MARKERS)) profanity++;
    // media and emoji test the RAW string: the media tag is bracket-shaped
    // ("[gif: ...]") and padTexture would eat the bracket the regex anchors
    // on. dbattery's counters test raw text for the same reason.
    if (TEXTURE_MEDIA_RE.test(text)) media++;
    if (TEXTURE_EMOJI_RE.test(text)) emoji++;
    words.push(rawWords(text));
  }
  return {
    teasing: r3(teasing / n),
    humour: r3(humour / n),
    media_rate: r3(media / n),
    words_median: percentile(words, 50),
    emoji_rate: r3(emoji / n),
    profanity: r3(profanity / n),
    n_turns: n,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// DB-facing — QueryFn-injected, see the file header.
// ─────────────────────────────────────────────────────────────────────────

/**
 * The scan. Exported as a string so the G1 gate can assert its shape
 * structurally instead of reviewing it by eye (SPEC §9's G-S4: "asserted
 * structurally, not reviewed by eye").
 *
 * What the gate checks, and why each clause is here:
 *  - the projection is exactly `l.content` — ONE column, no timestamps, no
 *    counts, no ids. Nothing time-shaped can reach JS because nothing
 *    time-shaped is selected.
 *  - ORDER BY is `l.id desc`, never `l.at`. The identity column is
 *    monotonic, so this is the same "most recent N" window without the
 *    query so much as naming a time column.
 *  - `role = 'her'` — HER turns. meera_log's roles are 'her'/'me'
 *    (api/memory.js's opLog is the only writer; consolidate.js:827 records
 *    the same finding after a stale comment claimed otherwise). Texture is
 *    how SHE talks to this person, so the user's own turns are not scanned
 *    at all — which is also the cheapest possible form of "her interior
 *    never reads the user".
 *  - `channel = 'chat'` — call transcripts are excluded, and this is a G1
 *    point rather than a tidiness one. persona.ts's call rules forbid emoji,
 *    gifs, photos and voicenotes on a call, so a person who CALLS more has a
 *    structurally lower media and emoji rate. Mixing channels would turn
 *    those columns into a measure of how much they call, which is usage.
 *  - `group_id is null` — 1:1 only. `multiparty-v1-design` made group
 *    episodes state-inert in v1; texture is per-dyad state.
 *  - the device set is `vy_person_device` UNION the person id itself,
 *    copied from consolidate.js's honorific query, which carries the legacy
 *    case where a device row was never written and device_id == person_id.
 *
 * NOT AGENT-SCOPED, and it cannot be: meera_log has no agent_id column
 * (migrations 009/010 added one to fourteen tables and not to this one).
 * The row this feeds is keyed (agent_id, person_id) and the agent id is
 * carried through the writer, but the SCAN is agent-blind. Today Meera is
 * the only agent writing to meera_log so the two agree; a second agent
 * sharing a device would need a log-side column first. Logged as an
 * interface ticket rather than papered over with a filter that would silently
 * match nothing.
 */
export const TEXTURE_SCAN_SQL = `select l.content
       from meera_log l
      where l.role = 'her'
        and l.channel = 'chat'
        and l.group_id is null
        and l.device_id in (
              select d.device_id from vy_person_device d where d.person_id = $1
              union select $1::uuid)
      order by l.id desc
      limit $2`;

/**
 * `deriveTexture(q, personId, agentId)` — one query, pure counting, no LLM.
 *
 * Returns the derived columns only. `nickname`, `avoid` and `avoid_cites`
 * come back EMPTY from the deriver by design, never as a guess — see
 * DERIVER NOTES below and `upsertTexture`, which cannot overwrite a curated
 * value with these empties.
 *
 * DERIVER NOTES — the two columns this deriver deliberately does not write:
 *
 * `avoid`. The honest answer today is that no signal in this database
 * supports it, and an empty column reported honestly beats a populated one
 * that guesses, because this is the column that hurts when it is wrong.
 * Every candidate was checked:
 *   - `vy_rel_event` dim='rupture' is cited and conservative, but a rupture
 *     is damage to the RELATIONSHIP, not a topic — its note is a free-text
 *     LLM sentence about what hurt, and the state it produces is already
 *     rendered in T2 as repair state. "Rupture happened" does not name a
 *     topic to walk around, and rendering the note would put a generated
 *     sentence into a prompt (`recited-prompt`).
 *   - `vy_episode.affect_tags` are episode-level symbolic labels with no
 *     topic axis and, outside `extractor='user-own-words'`, sub-1.0
 *     confidence by schema law.
 *   - `meera_nodes.feel` is the closest thing to "a topic and how it felt",
 *     and it is the user's OWN words — but the table is device-keyed with no
 *     citations column, and classifying free-text feel as bad-enough-to-
 *     avoid needs a sentiment lexicon, which is guessing wearing a list.
 *   - `vy_ritual.cold_last` is a reception read on a RITUAL key
 *     (good_morning, khana_khaya). She should not stop saying good morning.
 *   - `meera_forget` is explicit, user-authored and exactly wrong to use:
 *     that table's own schema comment says it "is never read by recall,
 *     never enters a prompt", and reading it into T11 would resurrect, as an
 *     avoid topic, the very term the user asked to be deleted.
 * So: nothing writes `avoid` yet. The RENDERER is nevertheless complete and
 * fails closed, so an owner-review writer (vy_taste_candidate's shape) can
 * fill the column later with no change here.
 *
 * `nickname`. Deriving it by counting needs a baseline for "ordinary word",
 * and every available baseline is either a pet-name list this file would
 * have to invent, or a live cross-person frequency query — and the repo has
 * already ruled on the second one: consolidate.js's CORPUS_COMMON_PHRASES is
 * a frozen corpus scan, "static and dated on purpose… rather than a live
 * per-run query". More decisively, a nickname already has a home:
 * `vy_phrase` / `meera_nodes kind='phrase'` is defined as "a word, nickname
 * or running joke the two of THEM made up together", stored with an origin
 * episode. A second store for the same object is the `life-per-person`
 * shape of bug that migration 011's own header warns about — two places
 * holding one thing, drifting. So the field is fed from that store by a
 * writer outside this workstream (interface ticket), and the deriver never
 * invents one.
 */
export async function deriveTexture(
  q: QueryFn,
  personId: string,
  agentId: string = MEERA_AGENT_ID,
): Promise<TextureRow> {
  const rows = await q(TEXTURE_SCAN_SQL, [personId, TEXTURE_SCAN_LIMIT]);
  const contents = (rows ?? []).map((r: any) => String(r?.content ?? ""));
  const counts = textureCounts(contents);
  return {
    agent_id: agentId,
    person_id: personId,
    ...counts,
    nickname: "",
    avoid: [],
    avoid_cites: [],
  };
}

/**
 * Writes the derived columns and NOTHING ELSE. The `do update` set list
 * omits nickname/avoid/avoid_cites on purpose: it is structurally impossible
 * for a nightly derivation to clobber a curated nickname or an owner-
 * approved avoid list with its own empties. Same reasoning as
 * `reinforcePattern` leaving `prompt_eligible` to Postgres — the writer that
 * does not own a column does not name it.
 */
export async function upsertTexture(q: QueryFn, row: TextureRow): Promise<void> {
  await q(
    `insert into vy_rel_texture
       (agent_id, person_id, teasing, humour, media_rate, words_median,
        emoji_rate, profanity, n_turns, updated_at)
     values (($1)::uuid,($2)::uuid,$3,$4,$5,$6,$7,$8,$9, now())
     on conflict (agent_id, person_id) do update set
       teasing = excluded.teasing, humour = excluded.humour,
       media_rate = excluded.media_rate, words_median = excluded.words_median,
       emoji_rate = excluded.emoji_rate, profanity = excluded.profanity,
       n_turns = excluded.n_turns, updated_at = now()`,
    [
      row.agent_id,
      row.person_id,
      row.teasing,
      row.humour,
      row.media_rate,
      row.words_median,
      row.emoji_rate,
      row.profanity,
      row.n_turns,
    ],
  );
}

/** Derive + write, the one call a nightly step needs. Returns what it wrote. */
export async function refreshTexture(
  q: QueryFn,
  personId: string,
  agentId: string = MEERA_AGENT_ID,
): Promise<TextureRow> {
  const row = await deriveTexture(q, personId, agentId);
  await upsertTexture(q, row);
  return row;
}

/** The render path's read — returns the STORED row (curated nickname/avoid
 *  included), or null when the pair has no texture row yet. `renderTexture`
 *  accepts that null directly, so a missing row and a row under the floor
 *  take the same silent path. */
/** Neon's SQL-over-HTTP endpoint decodes an EMPTY Postgres array as `[""]`,
 *  not `[]` — verified live against this database (`select '{}'::text[]`
 *  returns `[""]`, and `'{}'::bigint[]` likewise). A reader that trusts
 *  `Array.isArray` alone therefore sees a one-element array of nothing, which
 *  for `avoid` would be an avoid TOPIC of empty string. It fails closed here
 *  anyway (an empty topic is dropped by `safeFreeText`), but silently relying
 *  on a downstream guard for a decoding bug is how the guard gets removed
 *  later by someone who cannot see what it was for. Parsed explicitly
 *  instead. Non-numeric entries drop for the same reason. */
function pgTextArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "")).filter((s) => s.length > 0);
}

function pgBigintArray(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => Number(x)).filter((n) => Number.isFinite(n));
}

export async function readTexture(
  q: QueryFn,
  personId: string,
  agentId: string = MEERA_AGENT_ID,
): Promise<TextureRow | null> {
  const rows = await q(
    `select agent_id, person_id, teasing, humour, media_rate, words_median,
            emoji_rate, profanity, nickname, avoid, avoid_cites, n_turns
       from vy_rel_texture where agent_id = ($1)::uuid and person_id = ($2)::uuid`,
    [agentId, personId],
  );
  const r: any = (rows ?? [])[0];
  if (!r) return null;
  return {
    agent_id: String(r.agent_id),
    person_id: String(r.person_id),
    teasing: Number(r.teasing ?? 0),
    humour: Number(r.humour ?? 0),
    media_rate: Number(r.media_rate ?? 0),
    words_median: Number(r.words_median ?? 0),
    emoji_rate: Number(r.emoji_rate ?? 0),
    profanity: Number(r.profanity ?? 0),
    nickname: String(r.nickname ?? ""),
    avoid: pgTextArray(r.avoid),
    avoid_cites: pgBigintArray(r.avoid_cites),
    n_turns: Number(r.n_turns ?? 0),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// BANDS — the state-leak guard. Same shape and same intent as relstate.ts's
// bandTrust / bandCsRatio / bandPacing: a small number of coarse words, no
// number ever leaving the module. Boundaries are chosen so the DEFAULT row
// (all zeros, straight out of migration 011's column defaults) reads as the
// quietest band rather than as a claim, for the same reason bandTrust made
// 0.3 read as "building" — a fresh relationship must never render as a
// personality it has not earned.
// ─────────────────────────────────────────────────────────────────────────

export function bandTeasing(rate: number): string {
  if (rate < 0.04) return "rare";
  if (rate < 0.12) return "light";
  if (rate < 0.25) return "regular";
  return "constant";
}

export function bandHumour(rate: number): string {
  if (rate < 0.06) return "quiet";
  if (rate < 0.18) return "easy";
  if (rate < 0.35) return "loud";
  return "nonstop";
}

/** Returns "" for a rate of exactly zero — the caller drops the line rather
 *  than rendering "swearing: none". A rendered "none" is not a description,
 *  it is a prohibition she would read as one, and this block is not allowed
 *  to instruct (rule 4). */
export function bandProfanity(rate: number): string {
  if (rate <= 0) return "";
  if (rate < 0.02) return "occasional";
  if (rate < 0.08) return "easy";
  return "free";
}

// ─────────────────────────────────────────────────────────────────────────
// RENDER — T11 `rel.texture`, budget 600, drop priority 7 (§8). Pure, no
// I/O. Telegraphic k:v lines, lint-checked here so a violation surfaces in
// this workstream rather than in a compile-time fixture nobody is reading
// that day (relstate.ts's convention, kept).
// ─────────────────────────────────────────────────────────────────────────

export const TEXTURE_BUDGET = 600;

/** Never raise unprompted (§0.1, pull-only, ships in every tail block), and
 *  the register disclaimer that makes §11's reversal condition structural
 *  rather than hoped for. One line: it is a header, not a content row. */
const TEXTURE_HEADER =
  "HOW YOU TWO TALK — rapport only, context, never raise unprompted and never mention noticing it (your register, length, emoji and gif habits are unchanged by this):";

/** A free-text field (nickname, an avoid topic) may reach the prompt only if
 *  it survives all four: non-empty, short, digit-free, lint-clean.
 *
 *  The digit rule is the state-leak guard taken literally — see rule 1 in
 *  the file header. The lint is `recited-prompt` protection: a "nickname"
 *  that is sentence-shaped is not a nickname, it is a line she would say,
 *  and it gets dropped rather than trimmed. Dropping is always the correct
 *  repair here because every field this guards is optional garnish. */
function safeFreeText(value: string, maxChars: number): string | null {
  const v = String(value ?? "").trim();
  if (!v) return null;
  if (v.length > maxChars) return null;
  if (/\d/.test(v)) return null;
  if (lintLine(v).reasons.length) return null;
  return v;
}

/**
 * T11. `renderTexture(row)` — the whole contract:
 *
 *   - `null` row, or `n_turns` below the floor → empty text. FIRST
 *     statement in the function; there is no path around it and no option
 *     to override it.
 *   - bands only, and no digit ever appears in the output.
 *   - `media_rate`, `words_median`, `emoji_rate` and `n_turns` are NEVER
 *     rendered — rule 4 (persona.ts already governs those axes) and the G1
 *     note (n_turns is a gate).
 *   - `avoid` renders only under 1:1 citation pairing, capped at 3 entries.
 *
 * THE avoid PAIRING RULE, stated because the schema does not encode it:
 * migration 011 stores `avoid text[]` and `avoid_cites bigint[]` as two
 * parallel arrays with no per-entry structure, so "which citation belongs to
 * which topic" is a convention someone has to fix. This file fixes it as
 * ONE ANCHOR CITATION PER TOPIC AT THE SAME INDEX — the same shape as
 * vy_phrase.origin_episode ("the coining episode", a single bigint, not an
 * array) — and any length mismatch drops the ENTIRE column rather than
 * pairing what it can. That is rule 3: a mismatch means the writer and the
 * reader disagree about the data, and the failure mode of guessing is an
 * avoid topic attached to the wrong evidence, which is indistinguishable
 * from an uncited one. An uncited avoid entry cannot be rendered by this
 * function under any input.
 */
export function renderTexture(row: TextureRow | null): RenderResult {
  const empty: RenderResult = { text: "", lint: { clean: true, violations: 0 } };
  if (!row) return empty;
  if (!Number.isFinite(row.n_turns) || row.n_turns < TEXTURE_N_TURNS_FLOOR) return empty;

  const lines: string[] = [];
  lines.push(`teasing: ${bandTeasing(row.teasing)}`);
  lines.push(`humour: ${bandHumour(row.humour)}`);

  const swearing = bandProfanity(row.profanity);
  if (swearing) lines.push(`swearing: ${swearing}`);

  const nick = safeFreeText(row.nickname, 24);
  // A nickname is one or two words. Anything longer is a phrase she would
  // recite, whatever it lints as.
  if (nick && nick.split(/\s+/).length <= 2) lines.push(`nickname: "${nick}"`);

  const avoid = row.avoid ?? [];
  const cites = row.avoid_cites ?? [];
  if (avoid.length && avoid.length === cites.length) {
    const safe: string[] = [];
    for (let i = 0; i < avoid.length && safe.length < 3; i++) {
      const cite = cites[i];
      if (!Number.isFinite(cite) || Number(cite) <= 0) continue; // uncited: unrenderable
      const topic = safeFreeText(avoid[i], 40);
      if (topic) safe.push(topic);
    }
    for (const t of safe) lines.push(`avoid: ${t}`);
  }

  const text = `${TEXTURE_HEADER}\n${lines.map((l) => `- ${l}`).join("\n")}`;
  const lint = lintBlock(lines.join("\n"));
  let violations = lint.violations.length;
  // SPEC §3.2: "The compiler NEVER slices — it drops whole blocks." Overflow
  // is ANNOTATED so the caller's drop machinery sees it; never truncated
  // here (relstate.ts's capToRenderResult, same behaviour).
  if (text.length > TEXTURE_BUDGET) violations++;
  return { text, lint: { clean: violations === 0, violations } };
}
