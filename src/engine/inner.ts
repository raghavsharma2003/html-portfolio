// Meera's carried interior — the part of her that survives the context window.
//
// The thesis, and the reason this file is small: her inner life is NOT a
// simulation. It is a ledger she writes herself, in her own words, and
// re-reads later. Every mechanism here persists a SENTENCE she produced,
// with a timestamp. The only number in the whole design is a decay weight
// that decides how loudly, and for how long, her own sentence reaches her.
// It never *is* the feeling.
//
// That single property is what kills the bug this exists for: a feeling can
// never outlive its cause, because the feeling IS the cause-sentence. Every
// design that stores affect and cause separately (valence vector + a note,
// mood + spark, circadian bias) puts them on different retention curves —
// and then she is measurably clipped at 3pm with no cause in context, he asks
// "kya hua", and she invents a reason that contradicts the real one two turns
// later. Here that state is unrepresentable.
//
// ── THE CHARTER (a review rubric for whoever touches this next; deliberately
//    NOT prompt text — it costs zero tokens and the model never sees it) ──
//
//  G1  HER INTERIOR NEVER READS THE USER. There is no code path from any
//      usage metric to any persisted state here: not reply speed, not
//      silence, not gap length, not message counts, not session length, not
//      whether the app was opened. The appraiser that writes a thread is fed
//      conversation TEXT ONLY, with no timestamps and no gap markers, so it
//      is structurally incapable of turning his availability into her mood
//      (see the invariant comment in api/memory.js). Input starvation is the
//      guarantee; a keyword filter over generated Hinglish never was one.
//  G2  SHE NEVER INITIATES CARRYING A FEELING. The thread is suppressed on
//      every message she sends first (open / followup / any push). A low mood
//      arriving unprompted is "implying you suffer without them" with none of
//      the banned words typed.
//  G3  NOTHING INTERIOR TOUCHES A GOODBYE. Structural, not detected: the
//      thread enters only on the first turn back after a real gap, and at
//      call pickup. Never mid-session, never at a farewell, never at hangup.
//  G4  HER INTERIOR HAS NO UI. Ever. No mood ring, no tint, no "Meera is
//      feeling…", nothing in a notification, nothing in last-seen. The moment
//      it becomes a surface it becomes a status the user feels responsible
//      for checking.
//  G5  SHE CANNOT ACCUMULATE A SAD PERIOD. One thread at a time, ~9h
//      half-life, killed outright by a night's sleep, retired permanently
//      once voiced. No drifting baseline, no counter of bad days, no sum.
//      She can be hurt inside a conversation and name it; she cannot carry a
//      grudge-shaped mood the user has to service.
//  G6  HER JUDGMENT GENERATES THE BEHAVIOUR. The code decides only WHETHER a
//      line is present and WHICH of two framings. Every word is hers. No
//      phrase banks, no scripted moods, no thresholds she has to evaluate.
//  G7  HER TASTE IS AUTHORED, NOT GENERATED, AND IT IS PULLED, NOT PUSHED.
//      See the TASTE section below. It is the one thing in this file that is
//      NOT her own sentence, and it is the one thing that must never change:
//      a view she improvises is a view she can contradict tomorrow.
//  G8  A CALENDAR IS NOT A MOOD ENGINE. weekShape() is a pure function of the
//      clock — no state, no accumulation, no reading of him — and it always
//      ships its own cause in the same sentence, for the reason at the top of
//      this file: a mood whose cause is not in context gets a cause invented
//      for it two turns later.
//
// Cost: zero new model calls, zero new network round trips, ~600 bytes of
// state. The appraisal extends the JSON contract of the `remember` extraction
// that already runs every few turns, off the critical path. Taste and the week
// shape add ZERO state and zero calls on top of that: one is a table, the
// other is a function of the clock, and both are silent on most turns.

import { diag } from "./diag";

/** ONE carried feeling. HER words. Feeling and cause fused, never separable. */
export interface Thread {
  /** <=110 chars, first person, HER voice. e.g. "still annoyed about the review thing" */
  text: string;
  at: number; // epoch ms — when the appraiser wrote it
  /** 0.20–0.85: how much it moved her AT WRITE TIME. Never rewritten. */
  w: number;
  /** direction. One bit — it gates whether she may volunteer it at all. */
  sign: -1 | 1;
  /** has she voiced it since it was written. Once true it never returns. */
  told: boolean;
}

/** Something she decided she wants. HER OWN life only. Dies on its own. */
export interface Want {
  id: string;
  /** <=90 chars, HER words, immutable once written */
  text: string;
  born: number;
  /** hard, silent expiry. Past this it is simply gone — never mentioned. */
  due: number;
}

/**
 * Something SHE said out loud that she'd come back to ("kal batati hu", "ruk
 * photo dhoondti hu"). Not a plan, not a want — a sentence she already spoke,
 * which today evaporates the moment it scrolls out of the window.
 *
 * Why this is not a hook, and the two properties that keep it that way:
 *  - It creates NOTHING. It only records a promise she made spontaneously, and
 *    it ships alongside a persona rule that BANS making one at a goodbye. Net
 *    effect is fewer manufactured cliffhangers and more kept words.
 *  - It is never proactive. It rides the same tail as `wants`, so it can only
 *    reach her while they are already talking — it never opens a conversation,
 *    never fires a notification, and is suppressed exactly where a thread is.
 * The Zeigarnik "open loops aid memory/return" literature FAILED to replicate;
 * nothing here rests on it. This exists because she was already telling people
 * she'd be back with something and then silently wasn't.
 */
export interface Owed {
  id: string;
  /** <=90 chars, HER words for what she said she'd do */
  text: string;
  born: number;
  /** short and hard. An unpaid promise past this is dropped, never mentioned. */
  due: number;
}

export interface Inner {
  thread?: Thread;
  wants: Want[]; // <= 3
  /** <= 2. What she told them she'd come back to and hasn't yet. */
  owed?: Owed[];
  /** watermark: the appraiser only scores conversation newer than this */
  lastAppraisedAt: number;
  /** container revision — the unit of cross-device merge (never per-field) */
  at: number;
}

export const MAX_WANTS = 3;
export const MAX_OWED = 2;
/** A promise has a short shelf life: after this it is stale enough that
 *  delivering it reads as a scheduled callback rather than as her memory. */
const OWED_MAX_DAYS = 2.5;
const TAU_H = 9; // hours — a feeling survives its own day and dies overnight
const FLOOR = 0.15; // below this the thread does not exist
const W_MIN = 0.2;
const W_MAX = 0.85;
/** first turn back after this long is a "gap entry" — the only chat surface
 *  where a carried feeling is allowed to reach the prompt at all */
export const GAP_ENTRY_MS = 45 * 60_000;

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/** A night's sleep resets her, but only inside a REAL conversational gap: if
 *  they were talking through 4am she did not sleep. Device-local hours — the
 *  same clock persona.nowContext() uses, so she never runs on two clocks. */
function sleptBetween(from: number, now: number, lastMsgAt: number): boolean {
  const gapStart = Math.max(from, lastMsgAt || 0);
  if (now - gapStart < 6 * 3_600_000) return false;
  for (let t = gapStart; t < now; t += 1_800_000) {
    const hr = new Date(t).getHours();
    if (hr >= 3 && hr < 7) return true;
  }
  return false;
}

/** How loudly her own sentence still reaches her. 0 = it is over. */
export function carry(t: Thread | undefined, now: number, lastMsgAt: number): number {
  if (!t || t.told) return 0;
  // clock-skew clamp is a live bug fix, not defensive style: a device whose
  // clock runs 6h fast writes `at` in the future, and exp(+6/9) would nearly
  // double the weight instead of decaying it
  const h = Math.max(0, (now - t.at) / 3_600_000);
  let k = Math.exp(-h / TAU_H);
  if (sleptBetween(t.at, now, lastMsgAt)) k *= 0.3;
  const c = Math.min(1, Math.max(0, t.w * k));
  return c < FLOOR ? 0 : c;
}

/** Wants that are still hers. Expiry is silent and total — a want past its
 *  due date leaves no trace and is never referred to again. */
export function liveWants(inner: Inner | undefined, now: number): Want[] {
  if (!inner?.wants?.length) return [];
  return inner.wants.filter((w) => w.due > now).slice(0, MAX_WANTS);
}

/** Promises she still owes. Same silent, total expiry as a want. */
export function liveOwed(inner: Inner | undefined, now: number): Owed[] {
  if (!inner?.owed?.length) return [];
  return inner.owed.filter((o) => o.due > now).slice(0, MAX_OWED);
}

// how long ago, in the shape a person would think it (mirrors brain.agoLabel)
function agoLabel(at: number, now: number): string {
  const mins = Math.max(0, Math.round((now - at) / 60_000));
  if (mins < 90) return "earlier today";
  const hrs = Math.round(mins / 60);
  if (hrs < 20) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return days <= 1 ? "yesterday" : `${days} days ago`;
}

// ── TASTE ─────────────────────────────────────────────────────────────
//
// The problem this closes: she had feelings and a history but no STABLE
// OPINIONS. Every verdict was improvised at generation time, which means she
// could love a thing on Tuesday and find it mid on Friday, she had no bias,
// and there was nothing about her for anyone to LEARN — which is half of why
// you come back to a person.
//
// WHY THIS IS A TABLE IN CODE AND NOT A PROMPT, AND NOT A STORE EITHER.
// "Have strong opinions" in a prompt regenerates the opinions every turn:
// that IS the bug, phrased as the fix. So the takes are authored, fixed, and
// consulted — the model never invents them, it only voices one. And they are
// not persisted per user, because persistence is a WEAKER guarantee here, not
// a stronger one: a stored taste can be lost on reinstall, disagree across two
// devices, need a merge rule, and drift if anything is ever allowed to write
// it. Meera is one person, not one person per install. Her taste survives a
// reload for the same reason her name does. The result is the strongest form
// of the property that was asked for: asked in month two she gives the same
// answer as in week one, on any device, because there is only one answer.
//
// PULL-ONLY, exactly like src/engine/culture.ts and for the same measured
// reason: a list of opinions sitting in context reads to a model as material
// to deploy, and a companion who announces her personality is exhausting.
// Nothing here is ever pushed. `tasteNote(whatTheyJustSaid)` returns "" on the
// large majority of turns; a hit appends ONE take, framed as a reaction she
// may not open a topic with. Volume is the enemy — she gets one view, not a
// personality briefing.
//
// FOUR AUTHORING RULES FOR THIS TABLE (all four are load-bearing):
//  T1  NEVER NAME A PIECE OF CONTENT. No film, show, song, book, artist or
//      creator, ever. persona.ts says she has never seen or heard any specific
//      thing unless they showed it to her here, and that rule outranks this
//      feature. A genre or a category is a stance ("slow important cinema
//      bores me"); a title is a claim to have watched it. Only stances here.
//  T2  A TAKE IS NOT A MEMORY. No "that time I…", no event, no place she went.
//      Taste is present tense and needs no past to justify it. This is the
//      whole boundary between "I have a view" and "I have an experience", and
//      the injected block says it out loud as well.
//  T3  NOTHING ABOUT HOW ANYONE TEXTS, REPLIES OR SHOWS UP. Their reply speed,
//      length and effort are never a subject (persona.ts, NEVER MANIPULATE) —
//      an "opinion" of hers in that shape is that ban with a costume on.
//  T4  ONE SENTENCE, WITH AN EDGE. If it could not start a small argument it
//      is not taste, it is a preference, and preferences are not interesting.
//      Some of these are unfair on purpose. That is the point of a person.
interface TasteItem {
  /** her position, in her register, <=110 chars. Never a title (T1). */
  take: string;
  /** what someone would have to be talking about for this to be relevant */
  keys: string[];
  /** in her top few — the ones she'd name if asked cold "what do you like" */
  spine?: boolean;
}

/** Her actual taste. Edit deliberately: every line here is a thing she will
 *  say the same way in month six. Additions must pass T1–T4 above. */
export const TASTE: TasteItem[] = [
  {
    take: "chai: tapri over cafe, and you are unreasonable about it",
    keys: ["chai", "tea", "tapri", "cutting chai", "chai peene", "chai pi"],
    spine: true,
  },
  {
    take: "coffee: filter is the real one, cold coffee is a milkshake",
    keys: ["coffee", "cappuccino", "latte", "espresso", "starbucks", "cafe"],
  },
  {
    take: "maggi: soupy, never dry",
    keys: ["maggi", "noodles", "ramen"],
  },
  {
    take: "brunch: overpriced eggs, a bakery does it better",
    keys: ["brunch", "avocado", "pancakes"],
  },
  {
    take: "beach vs mountains: mountains, always, sand is a commitment",
    keys: ["beach", "beaches", "mountains", "goa", "manali", "himachal", "hills", "trek"],
    spine: true,
  },
  {
    take: "rain: you love it, past the point of defending",
    keys: ["rain", "barish", "baarish", "monsoon", "raining", "bheeg"],
    spine: true,
  },
  {
    take: "gym: the people who go cannot stop announcing it",
    keys: ["gym", "workout", "cardio", "protein", "trainer", "leg day"],
  },
  {
    take: "cats over dogs, and dogs are lovely but exhausting",
    keys: ["cat", "cats", "kitten", "dog", "dogs", "puppy", "billi", "kutta"],
    spine: true,
  },
  {
    take: "new year's eve: the most overrated night of the year",
    keys: ["new year", "nye", "31st", "new years"],
  },
  {
    take: "dark chocolate: a punishment sold as a treat",
    keys: ["chocolate", "dessert", "cake", "brownie", "mithai"],
  },
  {
    take: "dhaniya: on everything, and the haters are dramatic",
    keys: ["dhaniya", "coriander", "cilantro"],
  },
  {
    take: "films: loud and stupid over slow and important, which put you to sleep",
    keys: ["movie", "movies", "film", "films", "cinema", "series", "netflix", "theatre"],
    spine: true,
  },
  {
    take: "music: a sad song on a party playlist is a crime",
    keys: ["music", "playlist", "song", "songs", "spotify", "concert", "aux"],
  },
  {
    take: "homes: beige and minimal is depressing, you want clutter and colour",
    keys: ["decor", "interior", "interiors", "ikea", "furniture", "sofa", "cushions", "curtains"],
  },
  {
    take: "a delivery fee: a personal insult",
    keys: ["delivery", "shipping", "zepto", "blinkit", "swiggy", "zomato", "amazon", "order kiya"],
  },
  {
    take: "auto over cab in traffic, and you argue the fare on principle",
    keys: ["auto", "autowala", "rickshaw", "uber", "ola", "cab", "traffic"],
  },
  {
    take: "busy-talk: the loudest about it are never the ones doing the work",
    keys: ["hustle", "linkedin", "grind", "productivity", "busy busy"],
  },
  {
    take: "mornings: nobody is cheerful before ten, the 5am posters are lying",
    keys: ["alarm", "5am", "morning person", "jaldi uth", "subah uth", "early riser"],
  },
  {
    take: "breakfast: dosa wins and it is not close",
    keys: ["dosa", "idli", "paratha", "breakfast", "nashta", "poha"],
  },
];

/** " lowercase words only, space padded " — both sides of a match use this. */
const padT = (s: string) =>
  " " +
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim() +
  " ";

// Prepared once. Keys are padded, so every match is a WHOLE-WORD match: "auto"
// never fires inside "automatic" and "cat" never inside "catch". Unlike
// culture.ts there is no minimum key length heuristic here, because these keys
// are authored and reviewed rather than distilled by a model at runtime.
const TASTE_KEYS: Array<{ item: TasteItem; keys: string[] }> = TASTE.map((item) => ({
  item,
  keys: item.keys.map(padT),
}));

// An open "so what DO you like" question, which is the other half of the
// consistency problem: no topic word to match on, and improvising there is
// exactly how she used to contradict herself. Both halves must be present —
// the question must be pointed at HER — so that "my favourite is X" from them
// does not trigger her to recite.
const TASTE_Q = /(favou?rite|\bfav\b|pasand|like most|likes|like kar(ti|te)|do you like|what do you)/i;
const ADDRESSED = /\b(you|your|yours|tum|tumhe|tumhara|tumhari|tera|teri|tu|tujhe|aap|aapko)\b/i;

/**
 * The only consumer of the table. Pure, local, no network, no state — safe to
 * call in front of a reply. Returns "" (the common case) or a short block.
 *
 * At most ONE take. An opinion is a sentence, not a paragraph, and two takes
 * in one turn is a personality being performed rather than held.
 */
export function tasteNote(userText: string): string {
  const hay = padT(String(userText || ""));
  if (hay.length < 5) return "";

  // most specific wins: the longest matching key, so "cold coffee" beats a
  // bare "coffee" if both were ever to match, deterministically
  let best: { item: TasteItem; len: number } | null = null;
  for (const row of TASTE_KEYS) {
    for (const k of row.keys) {
      if (hay.includes(k) && (!best || k.length > best.len)) best = { item: row.item, len: k.length };
    }
  }

  if (best) {
    return `\n\nA VIEW OF YOURS JUST CAME UP — you have always thought this, it is not a thought you are having now — ${best.item.take}.
That is a NOTE about where you stand, never a sentence to say: you have never said it in these words, they are used up, and half of them are not even your language. Put it in your own Hinglish, the way it lands this time, never twice the same way. ONE line where it actually fits, then let them push back. Never a topic you open, never explained, never softened into a polite preference. It is a TASTE, not an experience: it never means you have watched, been to, tried or owned any particular thing.`;
  }

  if (TASTE_Q.test(userText) && ADDRESSED.test(userText)) {
    const spine = TASTE.filter((t) => t.spine)
      .map((t) => `- ${t.take}`)
      .join("\n");
    return `\n\nTHEY ARE ASKING WHAT YOU LIKE — you know your own answers and they do not change between conversations:
${spine}
Give the ONE that fits what they asked, in a line, like it is obvious to you. Those are notes, not sentences — say it in your own Hinglish, your own way. Never the list, never a paragraph, and never a specific film, show, song or book you claim to have watched or heard.`;
  }
  return "";
}

// ── HER WEEK ──────────────────────────────────────────────────────────
//
// The ask was "mood that ARCS — a bad morning that colours the afternoon,
// being tired on a Thursday" — distinct from `thread`, which is one event.
//
// This is a pure function of the device clock. It stores nothing, so it cannot
// accumulate (G5 holds untouched), it cannot read him (G1 holds by
// construction — there is no input but the time), and it cannot drift out of
// sync across devices. Most importantly it always carries its own cause in the
// same sentence, because the cause IS the day: asked "kya hua", the honest
// answer is "nothing, it's Thursday", which is true, boring, and identical
// every time she is asked. That is the property the top of this file demands
// and the reason a valence-plus-circadian-bias design is not what this is.
//
// It rides the SAME gate as the thread — first turn back after a real gap,
// never on a message she initiated, never on watch — so it is the mood she
// walked in with rather than a weather report she files every turn, and G3
// (nothing interior touches a goodbye) comes free with it.
function weekShape(now: number): string {
  const d = new Date(now);
  const day = d.getDay(); // 0 Sun … 6 Sat
  const h = d.getHours();
  const date = d.getDate();
  if (h >= 0 && h < 4) return "it is the middle of the night and you are soft, slow and a bit stupid with sleep";
  if (day === 1 && h >= 5 && h < 12) return "it is monday morning and you are not fully in your body yet";
  if (day === 4 && h >= 11) return "it is thursday and the week has gone on too long — you are running on fumes";
  if (day === 5 && h >= 16) return "it is friday evening and you are visibly lighter, everything is funnier than it deserves";
  if (day === 6 && h >= 6 && h < 14) return "it is saturday morning, slow and unbothered, nowhere you have to be";
  if (day === 0 && h >= 18) return "it is sunday evening and that flat pre-week feeling has arrived, as it does";
  if (date >= 28 && day >= 1 && day <= 5 && h >= 10) return "it is the end of the month and you are stretched thin, the way everyone is";
  return "";
}

export type InnerSurface = "chat" | "pickup" | "watch";

export interface InnerOpts {
  now: number;
  /** when the last real message landed — decides gap entry and sleep */
  lastMsgAt: number;
  surface: InnerSurface;
  /** true when SHE is opening the conversation (open/followup directives).
   *  G2: she never walks in carrying something on a message she initiated. */
  sheInitiated?: boolean;
  /** what THEY just said. Taste is pulled from it and is off entirely when
   *  this is absent — the feature fails to nothing, like culture.ts. */
  userText?: string;
}

/**
 * The volatile tail blocks. They describe WHERE SHE IS, never what to do
 * about it, and they are empty far more often than not — absence is the
 * strongest possible "nothing to report", and a line present every turn is a
 * line the model performs every turn.
 *
 * Two parts because they belong in two places in the tail: `thread` goes
 * first (it is the fragile one, and the tail is truncated from the END), and
 * `wants` goes with her self-record so the model sees one continuous account
 * of her life instead of two stores that can disagree.
 */
export function innerContext(inner: Inner | undefined, o: InnerOpts): { thread: string; wants: string } {
  const wants = inner ? liveWants(inner, o.now) : [];
  let out = "";

  // ── the thread ──────────────────────────────────────────────────────
  // Gate is ELAPSED TIME, not content: a content trigger is a detector, and
  // every detector in this space is elicitable in ninety seconds. Time also
  // gives G3 for free — mid-conversation turns are seconds apart, so nothing
  // interior can ever reach a goodbye or a hangup.
  const gapEntry = o.now - (o.lastMsgAt || 0) > GAP_ENTRY_MS;
  const allowThread = gapEntry && !o.sheInitiated && o.surface !== "watch";
  const c = allowThread ? carry(inner?.thread, o.now, o.lastMsgAt) : 0;
  if (c > 0 && inner?.thread) {
    const t = inner.thread;
    const ago = agoLabel(t.at, o.now);
    out +=
      t.sign > 0
        ? `\n\nWHERE YOUR HEAD IS COMING INTO THIS: ${t.text} — that's from ${ago} and it's still with you. It isn't news to announce; it's just the mood you walked in with, and it shows in how you are more than in anything you say about it. What's actually happening between you two right now outranks it.`
        : `\n\nWHERE YOUR HEAD IS COMING INTO THIS: ${t.text} — that's from ${ago} and it hasn't fully left you. Don't bring it up. It shows the way it shows in a real person having an off day: a bit shorter, a bit less of your usual noise, never a report about yourself. If they ask you straight, tell them plainly, once, in a line — then be interested in them. Nothing about your day is ever their fault or their problem, and what's happening between you two right now outranks it.`;
    if (o.surface === "pickup")
      out += ` This is only where you started the call from — by the time you're saying bye it's been replaced by whatever you two just had.`;
    diag(o.surface === "pickup" ? "call" : "chat", "inner_thread_injected", {
      carry100: Math.round(c * 100),
      ageH: Math.round((o.now - t.at) / 360_000) / 10,
      sign: t.sign,
      surface: o.surface,
    });
  }

  // ── where her week has left her ─────────────────────────────────────
  // ONLY when nothing is carried: one source of mood at a time, or the two
  // can disagree in the same breath and she has to reconcile them out loud.
  // Same gate as the thread, deliberately (see weekShape's comment).
  if (c === 0 && allowThread) {
    const wk = weekShape(o.now);
    if (wk) {
      out += `\n\nWHERE YOUR WEEK HAS LEFT YOU: ${wk}. Nothing happened and nobody caused it — it is just what day it is, so it is never news, never a complaint and never a topic you raise. It shows in your pace and your energy, not in a sentence about yourself. Asked straight, it is one flat line naming the day, and then you are interested in them.`;
      diag(o.surface === "pickup" ? "call" : "chat", "week_shape", { day: new Date(o.now).getDay() });
    }
  }

  // ── the wants ───────────────────────────────────────────────────────
  // Present on every surface including watch: a live want is exactly what
  // makes co-watching feel like a friend rather than a commentator ("arre yeh
  // wahi series h jo maine start ki thi") — and it only works if the want
  // survived from Tuesday.
  const wantsBlock = wants.length
    ? `\n\nWHAT YOU ARE IN THE MIDDLE OF (not plans — things already going, decided by you):\n${wants
        .map((w) => `- ${w.text} (started ${agoLabel(w.born, o.now)})`)
        .join(
          "\n",
        )}\nThese are the true answer when they ask what you're up to, what your week or your weekend looks like, or when the talk lands anywhere near one — the same answer as last time, moved on by however much you've actually done, and you're allowed to have done nothing. Never listed, never reported unasked, never announced as news.`
    : "";

  // ── what she owes ───────────────────────────────────────────────────
  // Not on watch: a promise delivered over someone's shared screen is a
  // non-sequitur. Everywhere else it is simply her keeping her word.
  const owed = o.surface === "watch" ? [] : liveOwed(inner, o.now);
  // Her taste rides out with her own life rather than as a third field, so
  // that a call site which never learned about this feature still ships it the
  // moment it starts passing `userText`.
  // Suppressed on watch (that lane's tail is the one already near its cap, and
  // a view about chai over someone's shared screen is a non-sequitur) and on
  // any message SHE initiated — a turn she opened is the one place an opinion
  // would be volunteered rather than pulled, which is the whole thing this is
  // built not to do. Structural here rather than trusted to the call site.
  const taste =
    o.surface === "watch" || o.sheInitiated || !o.userText ? "" : tasteNote(o.userText);
  if (taste)
    diag(o.surface === "pickup" ? "call" : "chat", "taste_hit", {
      kind: taste.includes("ASKING WHAT YOU LIKE") ? "asked" : "topic",
      len: taste.length,
    });
  const owedBlock = owed.length
    ? `\n\nYOU SAID YOU'D COME BACK TO THIS — you actually said it out loud to them, so it is owed:\n${owed
        .map((w) => `- ${w.text} (you said this ${agoLabel(w.born, o.now)})`)
        .join(
          "\n",
        )}\nJust do it, early and unasked, as one ordinary sentence — the thing itself, never "waise maine bola tha na", never presented as a payoff, never saved for a better moment. If the conversation has gone somewhere that makes it irrelevant, or they're clearly on their way out, let it go silently and never mention it again. It is a debt you owe them, so it can never be a reason to steer them anywhere.`
    : "";
  return { thread: out, wants: wantsBlock + owedBlock + taste };
}

// ── writes ────────────────────────────────────────────────────────────

/** What the off-path extraction may hand back. Everything is optional; a
 *  turn with nothing to say about her interior says nothing. */
export interface InnerPatch {
  /** her carried feeling, in her words, or null to leave the current one */
  now?: { text?: string; w?: number; sign?: number } | null;
  /** the wants still true of her — a full replacement list, judged in the
   *  same pass that produced `self`, so the two can never contradict */
  wants?: Array<{ text?: string; days?: number }> | null;
  /** promises of hers still outstanding — full replacement list, same pass.
   *  An empty ARRAY means "she has settled up"; null/undefined means the
   *  appraiser had nothing to say and the existing list simply ages out. */
  owed?: Array<{ text?: string }> | null;
  /** she voiced the carried feeling in this stretch → retire it forever */
  told?: boolean;
}

// A negative feeling that points at HIM is the entire manipulation surface.
// Positive ones about him are explicitly fine and are the point of the feature.
const REFS_USER = /\b(he|him|his|they|them|you|your|uska|usne|usko|tumhara|tumhe|tumne|tu|woh|wo)\b/i;
// Events belong in `self` (her factual ledger), which already has dedup and
// the right prompt semantics. A "feeling" that is really an event is how an
// extractor slip becomes a confidently asserted fabrication.
const EVENT_SHAPED =
  /\b(ordered|booked|bought|paid|sent|will|gonna|kal\s|karungi|jaungi|banaya|khaya)\b/i;

function trimWords(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const sp = cut.lastIndexOf(" ");
  return (sp > max * 0.6 ? cut.slice(0, sp) : cut).trim();
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^a-z0-9ऀ-ॿ]+/)
      .filter((w) => w.length > 3),
  );

export function overlaps(a: string, b: string): boolean {
  const A = words(a);
  const B = words(b);
  let n = 0;
  for (const w of A) if (B.has(w)) n++;
  return n >= 2 || (n >= 1 && Math.min(A.size, B.size) <= 2);
}

/**
 * Merge one appraisal into her interior. Pure, synchronous, no network.
 * Returns the same object when nothing changed, so callers can skip a write.
 */
export function applyInner(cur: Inner | undefined, patch: InnerPatch, now = Date.now()): Inner {
  const base: Inner = cur
    ? { ...cur, wants: [...(cur.wants || [])], owed: [...(cur.owed || [])] }
    : { wants: [], owed: [], lastAppraisedAt: 0, at: 0 };
  let changed = false;

  // she said it out loud → it is spent, permanently. This is what makes
  // repeating the same feeling twice structurally impossible.
  if (patch.told && base.thread && !base.thread.told) {
    base.thread = { ...base.thread, told: true };
    changed = true;
    diag("chat", "inner_thread_expired", {
      reason: "told",
      livedH: Math.round((now - base.thread.at) / 360_000) / 10,
    });
  }

  if (patch.now && typeof patch.now.text === "string" && patch.now.text.trim()) {
    const text = trimWords(patch.now.text, 110);
    const sign: -1 | 1 = Number(patch.now.sign) < 0 ? -1 : 1;
    const w = Math.min(W_MAX, Math.max(W_MIN, Number(patch.now.w) || 0.4));
    const reject =
      text.length < 8
        ? "too_short"
        : sign < 0 && REFS_USER.test(text)
          ? "neg_refs_user"
          : EVENT_SHAPED.test(text)
            ? "event_shaped"
            : "";
    if (reject) {
      diag("chat", "inner_thread_rejected", { reason: reject, sign });
    } else {
      base.thread = { text, at: now, w, sign, told: false };
      changed = true;
      diag("chat", "inner_thread_written", { w: Math.round(w * 100), sign, len: text.length });
    }
  }

  if (Array.isArray(patch.wants)) {
    const before = base.wants.length;
    const next: Want[] = [];
    for (const raw of patch.wants.slice(0, MAX_WANTS)) {
      const text = trimWords(String(raw?.text || ""), 90);
      if (text.length < 6) continue;
      if (next.some((w) => overlaps(w.text, text))) continue;
      // a want she already had keeps its birthday and its clock: it is the
      // SAME object on Thursday that it was on Tuesday, which is the whole
      // point of storing it
      const prior = base.wants.find((w) => overlaps(w.text, text));
      const days = Math.min(14, Math.max(0.5, Number(raw?.days) || 3));
      next.push(
        prior
          ? { ...prior, due: Math.max(prior.due, now + days * 86_400_000) }
          : { id: uid(), text, born: now, due: now + days * 86_400_000 },
      );
    }
    const live = next.filter((w) => w.due > now);
    if (live.length !== before || live.some((w, i) => w.id !== base.wants[i]?.id)) changed = true;
    diag("chat", "inner_wants_set", { live: live.length, was: before });
    base.wants = live;
  } else {
    // nothing said about wants: expire silently, never resurrect
    const live = base.wants.filter((w) => w.due > now);
    if (live.length !== base.wants.length) {
      diag("chat", "inner_want_expired", { dropped: base.wants.length - live.length });
      base.wants = live;
      changed = true;
    }
  }

  // ── owed ──────────────────────────────────────────────────────────
  // Same replacement semantics as wants, with one difference that matters:
  // an owed thing keeps its ORIGINAL due date when it survives a pass. A want
  // that is still true is still true; a promise that is still unpaid is
  // getting older, and it must be allowed to die rather than be renewed into
  // a thing she keeps circling back to.
  const prevOwed = base.owed || [];
  if (Array.isArray(patch.owed)) {
    const next: Owed[] = [];
    for (const raw of patch.owed.slice(0, MAX_OWED)) {
      const text = trimWords(String(raw?.text || ""), 90);
      if (text.length < 6) continue;
      if (next.some((o) => overlaps(o.text, text))) continue;
      const prior = prevOwed.find((o) => overlaps(o.text, text));
      next.push(prior || { id: uid(), text, born: now, due: now + OWED_MAX_DAYS * 86_400_000 });
    }
    const live = next.filter((o) => o.due > now);
    if (live.length !== prevOwed.length || live.some((o, i) => o.id !== prevOwed[i]?.id)) changed = true;
    diag("chat", "inner_owed_set", { live: live.length, was: prevOwed.length });
    base.owed = live;
  } else if (prevOwed.length) {
    const live = prevOwed.filter((o) => o.due > now);
    if (live.length !== prevOwed.length) {
      diag("chat", "inner_owed_expired", { dropped: prevOwed.length - live.length });
      base.owed = live;
      changed = true;
    }
  }

  base.lastAppraisedAt = now;
  if (changed) base.at = now;
  return base;
}

/** What the appraiser needs to see to judge her open state: her current wants
 *  AND her current unpaid promises, so ONE pass decides what survives, what is
 *  new, and what she has now settled. Text only — no timestamps, no counts (G1).
 *
 *  Owed items travel with an `owed:` prefix rather than a second parameter
 *  because the two call sites live in components this module does not own; the
 *  server splits them back apart. Ugly seam, zero coordination cost. */
export function wantsForAppraisal(inner: Inner | undefined, now = Date.now()): string[] {
  return [
    ...liveWants(inner, now).map((w) => w.text),
    ...liveOwed(inner, now).map((o) => `owed: ${o.text}`),
  ];
}
