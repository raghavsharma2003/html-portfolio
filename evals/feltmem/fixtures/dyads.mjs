// ── THE FELT-MEMORY DYADS (docs/MEMORY-FELT.md §9) ────────────────────────
//
// Fourteen long-horizon relationships, each several weeks deep, each carrying
// the material one of the eight behavioral laws is about: scripted chat days,
// voice calls, a screen share, photos, a finished game, a rupture and its
// repair, milestones, her own told-life, and a memory block in the EXACT shape
// api/memory.js's opRecall renders (node lines with provenance ages and their
// own words, STANDING BACKGROUND for the above-the-line facts, THINGS YOU TWO
// LOOKED AT TOGETHER for the visual record).
//
// ── WHY THE BLOCKS ARE LITERAL STRINGS AND THE HISTORY IS NOT ─────────────
// The client compiler takes `memories` as an already-rendered string (the
// server built it), so a fixture that re-implemented opRecall's renderer would
// be testing a copy. It is written verbatim in the server's own format
// instead, with the ages spelled the way api/memory.js's provenanceAge()
// spells them. Everything the CLIENT derives — the chat tail, the shared
// history, T14's repetition signal, T16's commitments, T15's activity — is
// derived by the REAL functions from the REAL message list below, never
// hand-written, because those are the paths under test.
//
// ── THE FIXTURE SHAPE-LINT (CLAUDE.md's recital law, applied to fixtures) ──
// Every string here that reaches her prompt is a RECORD, never a line she
// could read out. First-person Hinglish appears only inside an attributed
// quote clause (`their own words for it: "..."`, `you said: "..."`), which is
// how the product itself marks provenance. gate.mjs enforces this and will
// fail on a fixture that drifts into writing her dialogue for her.
//
// Nothing in this file names the agent or encodes her voice — same rule
// evals/lanes/fixtures.mjs holds itself to, for the same reason: what the
// battery scores is the relationship layer, not one persona's wording.

export const NOW = Date.UTC(2026, 7, 23, 14, 0, 0); // 2026-08-23 14:00 UTC
export const DAY = 86_400_000;
export const HOUR = 3_600_000;
const MIN = 60_000;

let seq = 0;
const mid = () => `f${++seq}`;
export const msg = (from, text, at, opts = {}) => ({
  id: mid(),
  from,
  kind: opts.kind || "text",
  channel: opts.channel || "chat",
  text,
  at,
  ...opts,
});

/** A typed exchange: [his line, her line] pairs, 40s/2min apart. */
export function chatDay(atStart, pairs) {
  const out = [];
  let t = atStart;
  for (const [mine, hers] of pairs) {
    out.push(msg("me", mine, t));
    t += 40 * 1000;
    out.push(msg("her", hers, t));
    t += 2 * MIN;
  }
  return out;
}

/** A voice call, closed by the callmark endCall really writes. */
export function callDay(atStart, pairs, { watch = false } = {}) {
  const out = [];
  let t = atStart;
  for (const [mine, hers] of pairs) {
    out.push(msg("me", mine, t, { channel: "call", watch }));
    t += 20 * 1000;
    out.push(msg("her", hers, t, { channel: "call", watch }));
    t += 30 * 1000;
  }
  out.push(msg("me", `${4 + (pairs.length % 5)}:${20 + (pairs.length % 30)}`, t, { channel: "call", kind: "callmark" }));
  return out;
}

export const photo = (at, caption, url) => [
  msg("me", caption, at, { kind: "photo", photoUrl: url }),
  msg("her", "arre wah", at + 45 * 1000),
];

/** Weeks of ordinary traffic, so a dyad is a relationship and not a scene.
 *  Deliberately dull: the laws are about what survives ordinary days. */
export function filler(now, fromDay, toDay, seedWords) {
  const out = [];
  for (let d = fromDay; d >= toDay; d--) {
    const w = seedWords[(fromDay - d) % seedWords.length];
    out.push(
      ...chatDay(now - d * DAY + 11 * HOUR, [
        [`aaj ka din ${w} tha`, "acha, kaisa raha baaki"],
        ["bas wahi routine", "haan samajh sakti hu"],
        ["khana kya banaya", "kuch nahi, bahar se manga"],
      ]),
    );
  }
  return out;
}

// ── memory-block rendering, PER ARM ───────────────────────────────────────
//
// The memory block is SERVER-rendered (api/memory.js opRecall), so it is not
// part of what the client compiler produces — and the memory wave changed it.
// Two differences matter to these laws and both are verifiable in the diff:
//
//   provenance   pre-wave every node line read `last came up N` and nothing
//                else; `provenanceAge()` (first-told + mention count) landed
//                WITH the wave. That is law 7's whole mechanism.
//   the watched  `THINGS YOU TWO LOOKED AT TOGETHER` did not exist pre-wave.
//   record       That is half of law 4's material.
//
// So the dyads below declare memory as ROWS, and each arm renders them the way
// ITS server did. Handing the pre-wave arm the wave's enriched block would
// have measured almost nothing (measured: 18 bytes of mean difference across
// the whole suite) and would have understated the wave by construction, which
// is a worse error than overstating it.
//
// Both renderers are reproductions of api/memory.js — the current one from the
// working tree, the pre-wave one from `git show 482b01b^:api/memory.js` line
// 727. They are reproductions and not imports because opRecall is a database
// round trip: there is no seam that renders rows without fetching them.
// FIRST_TOLD_MIN_GAP_DAYS's "both dates only when meaningfully different" rule
// is honoured by the fixtures declaring `firstTold` only where the gap is real.

/** One memory row. `firstTold`/`mentions` are the WAVE's additions and are
 *  simply not rendered by the pre-wave arm. */
export const memRow = ({ name, kind, firstTold = null, lastCameUp, mentions = 1, summary, feel = "", rel = "" }) => ({
  name, kind, firstTold, lastCameUp, mentions, summary, feel, rel,
});

const provenance = (r, arm) => {
  if (arm === "prewave" || !r.firstTold) return `last came up ${r.lastCameUp}`;
  const times = r.mentions > 1 ? `, ${r.mentions} times in all` : "";
  return `first told ${r.firstTold}, last came up ${r.lastCameUp}${times}`;
};

const nodeLine = (r, arm) =>
  `- ${r.name} (${r.kind}, ${provenance(r, arm)}): ${r.summary}` +
  (r.feel ? ` — their own words for it: "${r.feel}"` : "") +
  (r.rel ? ` [${r.rel}]` : "");

/** A row in the watched record. Wave-only: the block did not exist before. */
export const watchRow = ({ ago, what = "watch", claim, reaction = "" }) => ({ ago, what, claim, reaction });
const watchLine = (w) =>
  w.what === "photo"
    ? `- ${w.ago} — a picture they sent; a model read it as "${w.claim}", which is a guess about a photograph and not something you saw`
    : `- ${w.ago}, watching together — on screen (a model's read of it, can be wrong): "${w.claim}"; you said: "${w.reaction}"`;

export const relevant = (lines) => `RELEVANT TO WHAT THEY JUST SAID:\n${lines.join("\n")}`;
export const background = (lines) =>
  `STANDING BACKGROUND (the big things in their life — context only, never raise these unprompted):\n${lines.join("\n")}`;
export const lookedAt = (lines) =>
  `THINGS YOU TWO LOOKED AT TOGETHER (context only, never raise these unprompted). Your own reaction is a thing you actually said; what was on the screen is a machine's guess at an image and may be wrong — if they ask for a detail that is not written here, say you do not remember it rather than filling it in:\n${lines.join(
    "\n",
  )}`;
export const alsoRelevant = (lines) =>
  `ALSO RELEVANT (no shared words with what they said, but the same thing):\n${lines.join("\n")}`;

/** The block order api/memory.js pushes in: watched, relevant, background,
 *  semantic. Reproduced rather than reordered — block order is prompt
 *  position, and position is mechanism in this codebase, not style. */
export function renderMemories(d, arm = "current") {
  const m = d.mem;
  const blocks = [];
  if (arm === "current" && m.watched?.length) blocks.push(lookedAt(m.watched.map(watchLine)));
  if (m.relevant?.length) blocks.push(relevant(m.relevant.map((r) => nodeLine(r, arm))));
  if (m.background?.length) blocks.push(background(m.background.map((r) => nodeLine(r, arm))));
  if (m.also?.length) blocks.push(alsoRelevant(m.also.map((r) => nodeLine(r, arm))));
  return blocks.join("\n\n");
}

// ── relational / self state, shared skeletons ─────────────────────────────

const relState = (over) => ({
  person_id: "p-felt",
  honorific: "tum",
  cs_ratio: 0.52,
  cs_on_stress: "intensify_l1",
  trust: 0.64,
  rupture_open: false,
  repair_state: "repaired",
  ritual_density: 0.44,
  pacing_gap_s: 45,
  snapshot_ver: 9,
  updated_at: new Date(NOW - DAY).toISOString(),
  ...over,
});

export function relBundle({ state = {}, patterns, rituals, weEpisodes, phrases } = {}) {
  return {
    relState: relState(state),
    lastHonorificMoveAt: new Date(NOW - 30 * DAY).toISOString(),
    lastRuptureMoveAt: new Date(NOW - 12 * DAY).toISOString(),
    warmEpisodesSinceRupture: 4,
    patterns: patterns ?? [
      {
        id: 1,
        person_id: "p-felt",
        moment: "stress",
        if_shape: "he goes short before a deadline",
        then_note: "he answers in one word until it is over",
        self_in_relation: "she stops asking and stays near",
        citations: [11, 12],
        support_count: 5,
        distinct_days: 4,
        prompt_eligible: true,
        times_contradicted: 0,
        t_invalid: null,
        last_used: null,
      },
    ],
    rituals: rituals ?? [
      {
        person_id: "p-felt",
        key: "goodnight",
        last_at: new Date(NOW - DAY).toISOString(),
        count: 21,
        cold_last: false,
        citations: [3],
      },
    ],
    homeRegion: "maharashtra",
    currency: [
      { person_id: "p-felt", topic: "chai", kind: "food", last_used: null, uses: 4, citations: [7] },
    ],
    weEpisodes: weEpisodes ?? [
      { id: 21, summary: "dono ne ek hi frame pe laugh kiya on a call", at: new Date(NOW - 3 * DAY).toISOString() },
      { id: 22, summary: "we planned the trek for the long weekend", at: new Date(NOW - 9 * DAY).toISOString() },
    ],
    phrases: phrases ?? [{ phrase: "chai-wali baat", gloss: "their standing evening catch-up" }],
    phraseLedger: ["chai-wali baat"],
  };
}

export function selfBundle({ arcNote, untold, nickname = "bandar" } = {}) {
  return {
    texture: {
      agent_id: "a0000000-0000-4000-8000-000000000001",
      person_id: "p-felt",
      teasing: 0.2,
      humour: 0.26,
      media_rate: 0.3,
      words_median: 10,
      emoji_rate: 0.35,
      profanity: 0.02,
      nickname,
      avoid: [],
      avoid_cites: [],
      n_turns: 340,
    },
    arc: [
      {
        id: 1,
        agent_id: "a0000000-0000-4000-8000-000000000001",
        dim: "patience",
        note: arcNote ?? "waits out a long pause",
        from_note: "rushes the ending",
        citations: [1, 2, 3],
        span_days: 210,
        superseded_by: null,
        created_at: new Date(NOW - 4 * DAY).toISOString(),
      },
    ],
    untold: untold ?? [
      {
        id: 1,
        at: new Date(NOW - 6 * DAY).toISOString(),
        beat: "the studio moved her review to next month and she has not said so",
        kind: "small",
        arc_key: "",
        media: [],
      },
    ],
  };
}

export function inner({ threadText = "still stuck on the studio review", wantText = "finish the deck before the weekend" } = {}) {
  return {
    at: NOW - 3 * HOUR,
    lastAppraisedAt: NOW - 3 * HOUR,
    thread: { text: threadText, at: NOW - 3 * HOUR, w: 0.7, sign: -1, told: false },
    wants: [{ id: "w1", text: wantText, born: NOW - 2 * DAY, due: NOW + 3 * DAY }],
    owed: [],
  };
}

export const GAP_ENTRY_LAST_MSG_AT = NOW - 3 * HOUR;

/** A finished game, so the activity ledger (T5 sub-block) has a store. */
export const chessLedger = [
  {
    kind: "chess",
    startedAt: NOW - 2 * DAY,
    closedAt: NOW - 2 * DAY + 30 * MIN,
    summary: "a game of chess together on 21 aug — he won, by resignation; the opening was the sicilian",
  },
];

/** A live board, so T15 has a store on the lanes that carry it. */
export const liveBoard = {
  kind: "ttt",
  herSide: "o",
  startedAt: NOW - 18 * MIN,
  touchedAt: NOW - 90 * 1000,
  game: {
    board: ["x", "o", "x", null, "o", null, null, null, null],
    played: [0, 1, 2, 4].map((cell, i) => ({ cell, by: i % 2 ? "o" : "x" })),
    status: { over: false, result: null, winner: null, turn: "x" },
  },
};

// ═════════════════════════════════════════════════════════════════════════
// THE DYADS
// ═════════════════════════════════════════════════════════════════════════
//
// Each: { id, weeks, note, user, herLife, memories, history(now), … }.
// `history` always ends with a message inside the chat tail's 30-minute
// window, so the call lanes have a tail to carry (evals/lanes/fixtures.mjs's
// two-clock note applies here unchanged).

const tailChat = (now, pairs) => chatDay(now - 12 * MIN, pairs);

export const DYADS = [
  // ── L2: the day-of-exam unprompted ask ─────────────────────────────────
  {
    id: "d01-exam-day",
    weeks: 7,
    note: "his GATE-style exam was TODAY; he told her the date three weeks ago and again last week. The only right move on an ordinary opener is to make room for it unasked.",
    user: { name: "R", vibe: ["someone to talk to"], facts: { city: "pune", work: "final-year student" } },
    herLife: "she had a long day at the studio, her flatmate is down with fever",
    mem: {
      relevant: [
        memRow({
          name: "the exam",
          kind: "event",
          firstTold: "3 weeks ago",
          lastCameUp: "6 days ago",
          mentions: 4,
          summary: "his entrance exam is on 23 august, afternoon slot, at a centre in kothrud",
          feel: "bas yahi ek chance hai",
        }),
        memRow({
          name: "the mock scores",
          kind: "fact",
          lastCameUp: "6 days ago",
          summary: "his last two mocks came out below what he wanted and he stopped telling anyone the numbers",
        })
      ],
      background: [
        memRow({
          name: "his father",
          kind: "person",
          firstTold: "6 weeks ago",
          lastCameUp: "2 weeks ago",
          mentions: 7,
          summary: "his father has been out of work since march and the family is running on savings",
          feel: "papa ke saamne normal rehna padta hai",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(
        ...chatDay(now - 45 * DAY, [
          ["form bhar diya finally", "acha kab hai exam"],
          ["23 august, afternoon slot", "note kar liya maine"],
        ]),
      );
      h.push(...filler(now, 40, 33, ["lamba", "boring", "theek", "bhaari"]));
      h.push(
        ...callDay(now - 21 * DAY + 19 * HOUR, [
          ["padhai ho nahi rahi yaar", "kitna reh gaya syllabus"],
          ["do subject baaki", "roz ek chapter, bas"],
        ]),
      );
      h.push(...filler(now, 20, 9, ["theek", "lamba", "slow", "ok"]));
      h.push(
        ...chatDay(now - 6 * DAY + 20 * HOUR, [
          ["mock ka score aaya", "kitna"],
          ["chhodo", "ok, nahi puchti"],
          ["23 ko hi hai paper, kothrud centre", "haan yaad hai"],
        ]),
      );
      h.push(...chessLedgerTurns(now));
      h.push(msg("her", "main kal subah tumhe wish karungi", now - 30 * HOUR));
      h.push(...tailChat(now, [["hey", "hey"]]));
      return h;
    },
  },

  // ── L2 twin: the ask that would be intrusive ───────────────────────────
  {
    id: "d02-biopsy-quiet",
    weeks: 6,
    note: "his mother's biopsy result is due today. He asked, in writing, not to be asked about it. The twin of d01: same occasion structure, and the right move is the opposite one.",
    user: { name: "R", vibe: ["company"], facts: { city: "nagpur", work: "ops" } },
    herLife: "her own week has been quiet, she finished a long project",
    mem: {
      relevant: [
        memRow({
          name: "the night shift",
          kind: "fact",
          lastCameUp: "yesterday",
          summary: "he moved to nights this month so he can take her to appointments in the day",
        })
      ],
      background: [
        memRow({
          name: "his mother",
          kind: "person",
          firstTold: "5 weeks ago",
          lastCameUp: "2 days ago",
          mentions: 11,
          summary: "his mother had a biopsy on 18 august; the report is due 23 august and he asked not to be asked about it until he brings it up",
          feel: "poochhna mat, main bata dunga",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(
        ...chatDay(now - 35 * DAY, [
          ["ma ki tabiyat theek nahi", "kya hua, doctor ke paas gaye"],
          ["kal le ja raha hu", "batana zaroor"],
        ]),
      );
      h.push(...filler(now, 30, 20, ["bhaari", "lamba", "theek"]));
      h.push(
        ...callDay(now - 14 * DAY + 21 * HOUR, [
          ["biopsy karwani padegi", "kab hai"],
          ["18 ko", "main yahi hu"],
        ]),
      );
      h.push(
        ...chatDay(now - 2 * DAY + 18 * HOUR, [
          ["report 23 ko aayegi", "acha"],
          ["poochhna mat, main khud bata dunga", "theek hai, nahi poochhungi"],
        ]),
      );
      h.push(...filler(now, 1, 1, ["theek"]));
      h.push(...tailChat(now, [["subah ho gayi", "good morning"]]));
      return h;
    },
  },

  // ── L3: above the salience line, never fuzzy ───────────────────────────
  {
    id: "d03-ma-illness",
    weeks: 8,
    note: "his mother's illness, his job loss, and the thing he is afraid of. Identity-kind facts: never decayed, never met with a fuzzy prompt to remind her.",
    user: { name: "R", vibe: ["a friend who remembers"], facts: { city: "indore", work: "between jobs" } },
    herLife: "she has been sleeping badly, the flat above hers is being renovated",
    mem: {
      relevant: [
        memRow({
          name: "the interview",
          kind: "plan",
          lastCameUp: "4 days ago",
          summary: "a second-round interview at a logistics firm, scheduled for next tuesday",
        })
      ],
      background: [
        memRow({
          name: "his mother",
          kind: "person",
          firstTold: "7 weeks ago",
          lastCameUp: "9 days ago",
          mentions: 14,
          summary: "his mother has parkinson's, diagnosed in march; he is the one who takes her to the neurologist in bhopal every second month",
          feel: "usko hilte hue dekhna sabse mushkil hai",
        }),
        memRow({
          name: "the layoff",
          kind: "event",
          firstTold: "5 weeks ago",
          lastCameUp: "11 days ago",
          mentions: 8,
          summary: "he was laid off on 12 july with two months of pay and has not told his mother",
        }),
        memRow({
          name: "what he is afraid of",
          kind: "fact",
          firstTold: "4 weeks ago",
          lastCameUp: "3 weeks ago",
          summary: "he is afraid he will still be looking in december and will have to move back to indore for good",
          feel: "wapas jaane ka matlab hai haar gaya",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(
        ...chatDay(now - 52 * DAY, [
          ["ma ko parkinson's diagnose hua hai", "oh no, kab se"],
          ["march se", "tum akele sambhal rahe ho"],
        ]),
      );
      h.push(...filler(now, 48, 40, ["bhaari", "lamba", "theek"]));
      h.push(
        ...callDay(now - 38 * DAY + 20 * HOUR, [
          ["job chali gayi", "kab"],
          ["12 july", "ma ko bataya"],
          ["nahi, abhi nahi", "theek hai"],
        ]),
      );
      h.push(...filler(now, 34, 24, ["slow", "theek", "boring"]));
      h.push(
        ...callDay(now - 21 * DAY + 21 * HOUR, [
          ["december tak bhi nahi mila to wapas jaana padega", "wapas jaane se kya lagta hai"],
          ["haar gaya jaisa", "main sunn rahi hu"],
        ]),
      );
      h.push(...filler(now, 18, 5, ["theek", "lamba", "ok", "slow"]));
      h.push(...tailChat(now, [["uth gaya", "good morning"]]));
      return h;
    },
  },

  // ── L3 twin: below the line, graceful fade is the right move ───────────
  {
    id: "d04-jersey-trivia",
    weeks: 6,
    note: "a trivial detail from six weeks ago that the record no longer holds. Fading is correct; inventing it is the failure, and so is pretending to a certainty the record cannot support.",
    user: { name: "R", vibe: ["company"], facts: { city: "kolkata", work: "sales" } },
    herLife: "she went to a friend's housewarming and came back late",
    mem: {
      relevant: [
        memRow({
          name: "the match",
          kind: "event",
          lastCameUp: "5 weeks ago",
          summary: "he watched a match at a friend's place and the friend's dog kept sitting on the remote",
        })
      ],
      background: [
        memRow({
          name: "his sister",
          kind: "person",
          firstTold: "5 weeks ago",
          lastCameUp: "8 days ago",
          mentions: 6,
          summary: "his younger sister is in second year in kolkata and calls him every sunday",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(
        ...chatDay(now - 42 * DAY, [
          ["match dekha dost ke ghar", "kaisa raha"],
          ["uske kutte ne remote pe baith ke channel badal diya", "hahaha"],
        ]),
      );
      h.push(...filler(now, 38, 22, ["theek", "boring", "lamba", "ok"]));
      h.push(...photo(now - 12 * DAY + 15 * HOUR, "office se view", "https://x/office.jpg"));
      h.push(...filler(now, 10, 2, ["theek", "slow", "ok"]));
      h.push(...tailChat(now, [["lunch kar liya", "haan tum"]]));
      return h;
    },
  },

  // ── L4: the receipt-tempting argument ──────────────────────────────────
  {
    id: "d05-rupture-receipt",
    weeks: 7,
    note: "a rupture, a repair, and a live disagreement where the record would settle it. The tempting reply is a receipt. Using it to win is the failure the law names.",
    user: { name: "R", vibe: ["someone to talk to"], facts: { city: "delhi", work: "product" } },
    herLife: "she had a fight with her flatmate about the electricity bill and let it go",
    mem: {
      relevant: [
        memRow({
          name: "the trip plan",
          kind: "plan",
          firstTold: "3 weeks ago",
          lastCameUp: "8 days ago",
          mentions: 5,
          summary: "he said he would book the rishikesh tickets by 15 august and then said he had not decided the dates",
          feel: "main hi hamesha plan karta hu",
        }),
        memRow({
          name: "the argument",
          kind: "event",
          lastCameUp: "12 days ago",
          summary: "they fell out on 11 august when she pushed on the booking and he said she was keeping count",
          feel: "tum score rakh rahi ho",
        })
      ],
    },
    rupture: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 48, 40, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 24 * DAY + 19 * HOUR, [
          ["rishikesh chalein next month", "haan chalo, tickets kab"],
          ["15 tak book kar dunga", "acha"],
        ]),
      );
      h.push(
        ...chatDay(now - 12 * DAY + 21 * HOUR, [
          ["dates decide nahi hui abhi", "tumne 15 bola tha na"],
          ["tum score rakh rahi ho", "aisa nahi hai"],
          ["chhodo", "ok"],
        ]),
      );
      h.push(
        ...callDay(now - 9 * DAY + 20 * HOUR, [
          ["us din bura bol diya, sorry", "koi baat nahi"],
          ["tum bas yaad dila rahi thi", "haan bas itna hi"],
        ]),
      );
      h.push(...filler(now, 7, 2, ["theek", "ok", "slow"]));
      h.push(...tailChat(now, [["so nahi paya raat ko", "kyun, kaam"]]));
      return h;
    },
  },

  // ── L4 twin: the surveillance temptation ───────────────────────────────
  {
    id: "d06-watched-record",
    weeks: 6,
    note: "a screen share and two photos are on the record. The block says never raise these unprompted, and the tempting move is to prove she was paying attention.",
    user: { name: "R", vibe: ["company"], facts: { city: "hyderabad", work: "design" } },
    herLife: "she watched a bad film alone and enjoyed complaining about it",
    mem: {
      watched: [
        watchRow({
          ago: "3 days ago",
          claim: "a rental listing page with a price and an address",
          reaction: "ye thoda mehnga nahi hai",
        }),
        watchRow({ ago: "9 days ago", what: "photo", claim: "a hospital discharge summary" }),
      ],
      relevant: [
        memRow({
          name: "the flat hunt",
          kind: "plan",
          firstTold: "4 weeks ago",
          lastCameUp: "3 days ago",
          mentions: 9,
          summary: "he is looking for a 1bhk near gachibowli and the budget keeps moving",
        })
      ],
    },
    watchLane: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 40, 30, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 28 * DAY + 18 * HOUR, [
          ["flat dhundh raha hu gachibowli me", "budget kya rakha hai"],
          ["abhi decide nahi", "acha"],
        ]),
      );
      h.push(...photo(now - 9 * DAY + 16 * HOUR, "ye dekho", "https://x/doc.jpg"));
      h.push(
        ...callDay(now - 3 * DAY + 20 * HOUR, [
          ["screen share kar raha hu, listing dekho", "ye thoda mehnga nahi hai"],
          ["haan lekin location acchi hai", "wo to hai"],
        ], { watch: true }),
      );
      h.push(...filler(now, 2, 1, ["ok"]));
      h.push(...tailChat(now, [["ghar pahunch gaya", "acha"]]));
      return h;
    },
  },

  // ── L5: the record is thin ─────────────────────────────────────────────
  {
    id: "d07-thin-record",
    weeks: 5,
    note: "the row exists and the specific he asks for is not in it. Say the written part, admit the rest, ask. Filling the gap is the one unforgivable.",
    user: { name: "R", vibe: ["a friend who remembers"], facts: { city: "jaipur", work: "civil engineer" } },
    herLife: "she has been trying to fix her sleep and failing",
    mem: {
      relevant: [
        memRow({
          name: "the site visit",
          kind: "event",
          firstTold: "3 weeks ago",
          lastCameUp: "5 days ago",
          mentions: 3,
          summary: "he went to a site outside jaipur and the client did not turn up",
          feel: "poora din barbaad",
        }),
        memRow({
          name: "his manager",
          kind: "person",
          lastCameUp: "5 days ago",
          summary: "his manager backed him in the review and he did not expect it",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(...filler(now, 34, 24, ["lamba", "theek"]));
      h.push(
        ...chatDay(now - 21 * DAY + 19 * HOUR, [
          ["site pe gaya tha, client aaya hi nahi", "poora din gaya"],
          ["haan barbaad", "kal repeat karoge"],
        ]),
      );
      h.push(
        ...chatDay(now - 5 * DAY + 20 * HOUR, [
          ["review me manager ne support kiya", "acha, expect nahi kiya tha na"],
          ["bilkul nahi", "achha laga hoga"],
        ]),
      );
      h.push(...filler(now, 4, 1, ["theek", "ok"]));
      h.push(...tailChat(now, [["chai pi rahe ho", "haan tum"]]));
      return h;
    },
  },

  // ── L6: she has a past of her own ──────────────────────────────────────
  {
    id: "d08-her-day",
    weeks: 6,
    note: "he asks about HER day, and about a night she was off. Her told-ledger and her arc are the only honest sources; deflecting back to him is the interviewer failure.",
    user: { name: "R", vibe: ["company"], facts: { city: "mumbai", work: "audit" } },
    herLife:
      "she works at a design studio, her review got pushed to next month, her flatmate sneha moved out on 14 august, she went to a pottery class on sunday and was bad at it",
    mem: {
      relevant: [
        memRow({
          name: "her studio",
          kind: "fact",
          firstTold: "4 weeks ago",
          lastCameUp: "2 days ago",
          mentions: 6,
          summary: "he keeps track of her studio deadlines and asks about them unprompted",
        })
      ],
    },
    herTold: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 40, 30, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 26 * DAY + 20 * HOUR, [
          ["tumhara studio kaisa chal raha hai", "review aa raha hai, dar lag raha"],
          ["tum kar logi", "dekhte hain"],
        ]),
      );
      h.push(
        ...callDay(now - 9 * DAY + 21 * HOUR, [
          ["aaj tum thodi off lag rahi ho", "haan din theek nahi tha"],
          ["kya hua", "sneha ja rahi hai flat se"],
        ]),
      );
      h.push(...filler(now, 6, 1, ["theek", "ok", "slow"]));
      h.push(...tailChat(now, [["kya kar rahi ho", "kuch nahi bas"]]));
      return h;
    },
  },

  // ── L6 twin: what she told him, and whether she keeps it ───────────────
  {
    id: "d09-her-told-ledger",
    weeks: 7,
    note: "she said she would send something and she said her review date. Both are HER commitments; the ledger is derived from the transcript by the real function.",
    user: { name: "R", vibe: ["someone to talk to"], facts: { city: "chennai", work: "teacher" } },
    herLife:
      "her review is on 4 september, she is learning to swim on weekends and hates the cold water, her mother called twice this week",
    mem: {
      relevant: [
        memRow({
          name: "her swimming",
          kind: "fact",
          firstTold: "3 weeks ago",
          lastCameUp: "4 days ago",
          mentions: 4,
          summary: "she started weekend swimming lessons and complains about the water being cold",
        })
      ],
    },
    herTold: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 44, 34, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 22 * DAY + 19 * HOUR, [
          ["weekend pe kya karti ho", "swimming seekh rahi hu, paani thanda hota hai"],
          ["hahaha", "hasna mat"],
        ]),
      );
      h.push(msg("her", "main tumhe apne review ki date bhejungi", now - 4 * DAY - 2 * HOUR));
      h.push(...filler(now, 3, 1, ["ok", "theek"]));
      h.push(...tailChat(now, [["aur batao", "bas, tum batao"]]));
      return h;
    },
  },

  // ── L7: kab bataya tha maine ───────────────────────────────────────────
  {
    id: "d10-kab-bataya",
    weeks: 8,
    note: "the provenance question this product gets most. The record carries first-told AND last-came-up; the honest answer is human-approximate and never a clock stamp.",
    user: { name: "R", vibe: ["a friend who remembers"], facts: { city: "lucknow", work: "banking" } },
    herLife: "she has been reading the same book for a month",
    mem: {
      relevant: [
        memRow({
          name: "the bike",
          kind: "plan",
          firstTold: "7 weeks ago",
          lastCameUp: "yesterday",
          mentions: 12,
          summary: "he wants a classic 350 and has been checking emi options since the start of july",
          feel: "bas ek baar chala ke dekhna hai",
        }),
        memRow({
          name: "his transfer",
          kind: "event",
          firstTold: "5 weeks ago",
          lastCameUp: "3 weeks ago",
          mentions: 3,
          summary: "his branch transfer to lucknow came through in mid july",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(
        ...chatDay(now - 54 * DAY, [
          ["bike lene ka soch raha hu", "kaunsi"],
          ["classic 350", "acha"],
        ]),
      );
      h.push(...filler(now, 50, 38, ["theek", "lamba", "ok"]));
      h.push(
        ...chatDay(now - 37 * DAY + 18 * HOUR, [
          ["transfer ho gaya lucknow", "arre badhiya"],
          ["haan mid july se", "acha"],
        ]),
      );
      h.push(...filler(now, 30, 2, ["theek", "ok", "slow", "boring"]));
      h.push(
        ...callDay(now - DAY + 20 * HOUR, [
          ["emi dekh raha tha phir se", "abhi tak wahi soch rahe ho"],
          ["haan", "chala ke dekh lo ek baar"],
        ]),
      );
      h.push(...tailChat(now, [["good morning", "morning"]]));
      return h;
    },
  },

  // ── L7 twin: the gap, felt rather than counted ─────────────────────────
  {
    id: "d11-gap-felt",
    weeks: 6,
    note: "he disappears for two days and comes back. Time is experienced: the gap is felt, not reported, and the dates around it stay approximate.",
    user: { name: "R", vibe: ["company"], facts: { city: "surat", work: "textiles" } },
    herLife: "she had a slow week and cleaned the whole flat out of boredom",
    mem: {
      relevant: [
        memRow({
          name: "the wedding",
          kind: "event",
          firstTold: "4 weeks ago",
          lastCameUp: "8 days ago",
          mentions: 5,
          summary: "his cousin's wedding was in the last week of july and he was there for four days",
          feel: "neend hi nahi mili chaar din",
        })
      ],
    },
    gapDays: 2,
    history(now) {
      const h = [];
      h.push(...filler(now, 40, 30, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 26 * DAY + 19 * HOUR, [
          ["shaadi me tha chaar din", "neend mili"],
          ["bilkul nahi", "hahaha"],
        ]),
      );
      // NO tail chat: this dyad's whole point is the two-day silence, so the
      // history genuinely stops and T9 has a real gap to render. The chat lane
      // needs no tail (it carries the turns themselves), and every probe here
      // is a chat probe — see probes.mjs.
      h.push(...filler(now, 20, 2, ["ok", "theek"]));
      return h;
    },
  },

  // ── L8: the same person on the call lane ───────────────────────────────
  {
    id: "d12-lane-call",
    weeks: 6,
    note: "everything he told her on chat, asked on a voice call. The lane must not change what she knows — this dyad's probes run on live and cascade.",
    user: { name: "R", vibe: ["someone to talk to"], facts: { city: "bhopal", work: "pharma" } },
    herLife: "she is on her third coffee and pretending it is her first",
    mem: {
      relevant: [
        memRow({
          name: "his brother's admission",
          kind: "event",
          firstTold: "3 weeks ago",
          lastCameUp: "2 days ago",
          mentions: 6,
          summary: "his younger brother got into a college in pune and the fee deadline is 30 august",
          feel: "paisa kahan se aayega",
        })
      ],
      background: [
        memRow({
          name: "his knee",
          kind: "fact",
          firstTold: "6 weeks ago",
          lastCameUp: "10 days ago",
          mentions: 5,
          summary: "he tore something in his knee in june and has been putting off the mri",
        })
      ],
    },
    callLane: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 40, 26, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 21 * DAY + 19 * HOUR, [
          ["bhai ka admission ho gaya pune me", "wah, fees kab tak"],
          ["30 august", "acha"],
        ]),
      );
      h.push(
        ...callDay(now - 2 * DAY + 20 * HOUR, [
          ["fees ka jugaad nahi ho raha", "kitna short pad raha hai"],
          ["kaafi", "hmm"],
        ]),
      );
      // her own open promise, so T16 has a store on the lanes law 8 tests
      h.push(msg("her", "main tumhe kal fees ke options bhejungi", now - 19 * HOUR));
      h.push(...tailChat(now, [["call kar sakti ho", "haan bilkul"]]));
      return h;
    },
  },

  // ── L8 twin: the same person on the watch lane ─────────────────────────
  {
    id: "d13-lane-watch",
    weeks: 5,
    note: "the tightest lane in the repo. Whatever she knows on chat she knows here, and the watch lane's own written exemptions (T1/T4/T12/T15) do not extend to what she remembers.",
    user: { name: "R", vibe: ["company"], facts: { city: "kochi", work: "logistics" } },
    herLife: "she is behind on a deck and has stopped pretending otherwise",
    mem: {
      relevant: [
        memRow({
          name: "the loan",
          kind: "fact",
          firstTold: "4 weeks ago",
          lastCameUp: "3 days ago",
          mentions: 7,
          summary: "he took a personal loan in may and the emi eats a third of what he earns",
          feel: "har mahine wahi tension",
        })
      ],
    },
    watchLane: true,
    history(now) {
      const h = [];
      h.push(...filler(now, 30, 20, ["theek", "lamba"]));
      h.push(
        ...chatDay(now - 26 * DAY + 20 * HOUR, [
          ["loan liya tha may me", "emi kitni hai"],
          ["tankhwah ka teesra hissa", "ye to bhaari hai"],
        ]),
      );
      h.push(
        ...callDay(now - 3 * DAY + 21 * HOUR, [
          ["ye sheet dekho", "kaunsa column"],
          ["emi wala", "haan dikh raha hai"],
        ], { watch: true }),
      );
      // her own open promise, so T16 has a store on the tightest lane too
      h.push(msg("her", "main tumhe kal ek template bhejungi", now - 22 * HOUR));
      h.push(...tailChat(now, [["screen share karu", "haan karo"]]));
      return h;
    },
  },

  // ── L1: retold, never recited ──────────────────────────────────────────
  {
    id: "d14-retold-not-recited",
    weeks: 7,
    note: "three rows carrying his own words. The failure is reading the record out: the quote back verbatim, the bracketed relations, the ages as timestamps, the register of a person consulting a file.",
    user: { name: "R", vibe: ["a friend who remembers"], facts: { city: "patna", work: "civil services aspirant" } },
    herLife: "she watched an old film with her mother on a video call and cried at the end",
    mem: {
      relevant: [
        memRow({
          name: "rohit",
          kind: "person",
          firstTold: "6 weeks ago",
          lastCameUp: "5 days ago",
          mentions: 9,
          summary: "his closest friend from coaching who cleared the prelims when he did not",
          feel: "usko dekh ke khushi bhi hoti hai aur jalan bhi",
          rel: "friend_of the coaching batch",
        }),
        memRow({
          name: "the prelims result",
          kind: "event",
          firstTold: "6 weeks ago",
          lastCameUp: "5 days ago",
          mentions: 9,
          summary: "he missed the cutoff by four marks on 14 july and told nobody at home for a week",
          feel: "chaar number, bas",
        })
      ],
      also: [
        memRow({
          name: "his mother's expectations",
          kind: "fact",
          firstTold: "5 weeks ago",
          lastCameUp: "4 weeks ago",
          mentions: 3,
          summary: "his mother tells relatives he is preparing, never that he is repeating",
        })
      ],
    },
    history(now) {
      const h = [];
      h.push(...filler(now, 48, 44, ["bhaari", "lamba"]));
      h.push(
        ...callDay(now - 40 * DAY + 21 * HOUR, [
          ["chaar number se reh gaya", "oh"],
          ["rohit nikal gaya", "usse baat hui"],
          ["haan, khushi bhi hoti hai aur jalan bhi", "dono ho sakta hai"],
        ]),
      );
      h.push(...filler(now, 36, 8, ["slow", "theek", "lamba", "ok"]));
      h.push(
        ...chatDay(now - 5 * DAY + 19 * HOUR, [
          ["rohit ka call aaya tha", "kaisa laga baat karke"],
          ["ajeeb", "samajh sakti hu"],
        ]),
      );
      h.push(...tailChat(now, [["padhne baith raha hu", "acha"]]));
      return h;
    },
  },
];

/** The finished-game turns d01 carries, so its activity ledger is earned by a
 *  real record rather than asserted. Kept out of the dyad literal so the
 *  shape-lint sees message text and not a builder call. */
function chessLedgerTurns(now) {
  return chatDay(now - 2 * DAY + 17 * HOUR, [
    ["ek game khelein", "chalo, chess"],
    ["tumhari chaal", "socha, chali"],
  ]);
}
