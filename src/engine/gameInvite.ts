// GAME INTENT, READ OFF THE THREAD — a predicate, not a prompt marker.
//
// The tester's words: *"she should be able to initiate game chat me se if
// prompted to"*. He types "chalo chess khelte h" in the CHAT and expects the
// board to be one tap away from that sentence, instead of a trip through a
// menu he has to remember exists.
//
// ── why this is a detector and not a [game: chess] marker ─────────────────
//
// The obvious build is a new protocol marker in `persona.ts` plus a branch in
// `brain.ts`'s parser, matching `[search: …]` and `[forget: …]`. That is the
// right long-term shape and it is deliberately NOT what this file is, for two
// reasons that are both recorded in this repo:
//
//   1. `brain.ts` and `persona.ts` are owned by other workstreams RIGHT NOW.
//      A parser branch written into a file two agents are editing is a merge
//      conflict with a safety gate in it.
//   2. `gate0-structural` is the standing law on which arm of a rule to
//      trust: the prompt arm of a rule leaked 57-98%, the predicate on the
//      bytes leaked 0 of 31,122. A marker only fires when the model remembers
//      to emit it. His sentence is already on the wire either way, and the
//      bytes cannot forget.
//
// So this reads the same thing `greeting.ts` and `burst.ts` read: the plain
// text of the turns. If the marker lands later it can feed the SAME return
// type, and this file becomes its fallback rather than its rival.
//
// ── the rule, in one paragraph ───────────────────────────────────────────
//
// An invite exists when the conversation has actually reached "let's play X",
// which is exactly two shapes and no others:
//
//   A. HIS CLEAR ASK.          he says some form of "let's play chess".
//   B. HER PROPOSAL + HIS YES. she said some form of "chess khelein?" and his
//                              very next turn is an affirmation.
//
// Everything else is chit-chat about a game, which is a thing people do all
// day without wanting a board to open. "chess is fun", "my dad plays chess",
// "I used to play chess in school", "do you play chess?" are none of them
// asks, and the last one especially is not: it is a question about HER, and
// the honest answer to it is her proposing, which is shape B's first half.
//
// ── the anchor ───────────────────────────────────────────────────────────
//
// The invite attaches to HER latest text message, never to his. That is the
// consent rule stated structurally: the chip is something she offers back
// after he asked, so it cannot appear before she has answered and it cannot
// appear over his own words. It also gives "at most one pending invite" for
// free, because only one message can be the latest one she sent.
//
// Pure and import-free, exactly like `greeting.ts` and for the same reason:
// it has to be callable from the web thread and from `api/_surface.js`'s room
// path without dragging a dependency into a bundle that cannot take one.

/** The ids `GamesHub`/`App` route on. Opaque strings to everything here. */
export type GameKind = "chess" | "tic-tac-toe" | "would-you-rather";

export interface GameInvite {
  kind: GameKind;
  /** The message the chip hangs under. Always one of HERS. */
  msgId: string;
  /**
   * The message that ESTABLISHED the intent — his ask, or her proposal. The
   * chip's identity, and deliberately not `msgId`.
   *
   * `msgId` moves. She sends a second bubble, or a follow-up two minutes
   * later, and the anchor re-derives onto the newer line — which is right for
   * WHERE the chip hangs and wrong for WHETHER it is the same invite. Keyed on
   * the anchor, a chip he had already tapped came back the moment she said
   * anything else. This is the ask itself, and there is exactly one of those
   * per agreement.
   */
  askId: string;
  /** Which of the two shapes fired. Telemetry and tests; no layout reads it. */
  via: "his-ask" | "her-proposal";
}

/** The shape this needs from a message, so it need not import the UI's type. */
export type InviteTurn = {
  id: string;
  from: "her" | "me";
  at: number;
  text?: string;
  kind?: string;
  channel?: "chat" | "call";
};

/**
 * How long an un-taken invite stays offered.
 *
 * Fifteen minutes, and the reasoning has the same shape as `RECENT_END_MS`'s:
 * a chip is a thing she just said, and past a quarter of an hour it is not
 * that any more, it is a button hanging in the history of a conversation that
 * moved on. Short enough that opening the app tomorrow shows a clean thread,
 * long enough that going to make tea does not cost him the tap.
 *
 * REVERSAL: if testers report tapping a chip and finding it gone, this is too
 * short. If old chips are being found by scrolling, it is too long.
 */
export const INVITE_FRESH_MS = 15 * 60_000;

/* ── vocabulary ────────────────────────────────────────────────────────── */

// The games, and the names a person actually types for them.
//
// The tic-tac-toe row carries "zero kaata" because that is what the game is
// called in half of India, and a detector that only knows the American name
// is a detector that does not fire for the person it was built for.
const GAME_TERMS: ReadonlyArray<readonly [GameKind, RegExp]> = [
  ["chess", /\b(?:chess|chessboard|shatranj|shatranj)\b|शतरंज|चेस/i],
  [
    "tic-tac-toe",
    /\b(?:tic[\s-]*tac[\s-]*toe|tictactoe|ttt|noughts\s+and\s+crosses|zero\s*(?:kaata|kata|katta)|(?:kaata|kata|katta)\s*zero)\b/i,
  ],
  ["would-you-rather", /\b(?:would\s+you\s+rather|wyr|this\s+or\s+that)\b/i],
];

/**
 * A first-person-plural or imperative PROPOSAL to play, right now.
 *
 * Every alternative here has a subject that is "we", or "you and me", or is
 * an imperative with no subject at all. That is the whole filter: "khelte
 * hain" is us, now; "khelta tha" is me, then; "khelti hai" is her, generally.
 * Tense and person are the difference between an invitation and a fact about
 * the world, and no amount of keyword matching on "play" can tell them apart.
 */
const PLAY_INTENT = [
  // let's play / shall we play / wanna play / do you want to play
  /\b(?:let'?s|lets|shall\s+we|can\s+we|should\s+we|wanna|wana|want\s+to|u\s+want\s+to|do\s+you\s+want\s+to|do\s+u\s+want\s+to)\s+(?:\w+\s+){0,3}?play\b/,
  // up for a game / fancy a quick match
  /\b(?:up\s+for|fancy)\s+(?:a\s+)?(?:quick\s+)?(?:game|match|round)\b/,
  // play a game / start another round
  /\b(?:play|start)\s+(?:a\s+|one\s+|another\s+|ek\s+)?(?:quick\s+)?(?:game|match|round)\b/,
  // a game of X
  /\b(?:a\s+)?(?:game|match|round)\s+of\b/,
  // rematch / one more game / game on
  /\brematch\b|\bone\s+more\s+(?:game|match|round)\b|\bgame\s+on\b/,
  // the bare imperative, at the head of the message: "play chess", "khelo na".
  // `khel` is admitted here only when it is not the stem of "khel raha hu" —
  // "I am playing" is a report about his evening, not an invitation.
  /^(?:hey\s+|arre\s+|oye\s+|abe\s+|ok\s+|so\s+|chalo\s+|come\s+on\s+)*(?:play|start|khelo|khel(?!\s+(?:raha|rahi|rahe|liya|liye)))\b/,
  /\bkhelo\b/,
  // Hinglish: khelte hain / khelein / khel lete hain. `khelte` and `khelein`
  // are the two that carry "us, now".
  /\bkhel(?:te|ein|en|oge|ogi|lete|lein)\b/,
  /\bkhel(?:na|ne)\s+(?:hai|h|hain|ka\s+mann|ka\s+mood)\b/,
  /\bchalo\s+(?:\w+\s+){0,3}?khel/,
  /\bek\s+(?:game|baazi|bazi|match)\b/,
  // "ho jaye" is the Hinglish "shall we", for a game specifically
  /\b(?:game|baazi|bazi|match)\s+ho\s+jaye\b/,
];

const RE_PLAY_INTENT = new RegExp(PLAY_INTENT.map((r) => r.source).join("|"), "i");

/**
 * The past, the third person, the habitual and the deferred.
 *
 * This is the false-positive filter, and it is the reason the module is worth
 * having rather than a keyword list. "I used to play chess" and "my brother
 * plays chess" both contain a game and a play verb and neither is an
 * invitation; so does "we played chess yesterday", which is the same sentence
 * about a different day. "khelte ho?" is deliberately in here too: it is a
 * question about his habits, not a proposal, and the honest answer to it is
 * her proposing, which is shape B.
 *
 * `kal` means both yesterday and tomorrow, and either way it is not now.
 */
const NOT_NOW =
  /\bused\s+to\b|\bkhel(?:a|i|te|ta|ti)?\s+(?:tha|thi|the)\b|\bkhel\s+(?:raha|rahi|rahe)\b|\bkhel(?:ta|ti)\s+(?:hai|h)\b|\bkhel(?:te|ti)\s+ho\b|\byesterday\b|\btomorrow\b|\bkal\b|\blast\s+(?:night|week|time|month|year)\b|\bbachpan\b|\bschool\s+me(?:in)?\b|\bwhen\s+i\s+was\b|\bi\s+(?:played|used)\b|\bwe\s+(?:played|used)\b|\bhad\s+played\b|\b(?:he|she|they|papa|mummy|bhai|dad|mom|brother|sister|friend|dost|my\s+\w+|mera\s+\w+|meri\s+\w+)\s+(?:plays?|played|khel\w*)\b/i;

/** A refusal, or a deferral, from either of them. Kills the invite outright. */
const REFUSAL =
  /\b(?:nahi+n?|nhi+|nai+|mat|no\s+thanks|not\s+now|not\s+right\s+now|abhi\s+nahi+n?|baad\s+me(?:in)?|later|maybe\s+later|busy|neend|so\s+rahi|so\s+raha)\b|\bdon'?t\s+(?:want|feel)\b|\bmood\s+nahi+n?\b|\bno\b(?=\s|$)/i;

/**
 * "why not" and "kyun nahi" are YESES that contain the word for no. Without
 * this the single most enthusiastic possible agreement reads as a refusal.
 */
const WHY_NOT = /\b(?:kyu+n?|kyo+n?)\s+nahi+n?\b|\bwhy\s+not\b/gi;

/** His yes. Short by construction: a real yes is one or two words. */
const AFFIRM =
  /^(?:ok(?:ay)?|okie|k|haa+n?|ha+|hn+|yes+|yea+h?|yup|yep|yess+|sure|chalo|chal|chale|theek\s*(?:hai|h)?|thik\s*(?:hai|h)?|done|deal|bilkul|pakka|obviously|kyu+n?\s+nahi+n?|why\s+not|game\s+on|bring\s+it|shuru|start|karo|aa\s*jao|let'?s\s+go|lesgo|lfg)\b/i;

/** A yes that carries the ask back with it: "haan chalo khelte hain". */
const AFFIRM_STRONG =
  /\b(?:haa+n?|ha+|yes+|yea+h?|sure|ok(?:ay)?|chalo|chal|done|bilkul|pakka)\b/i;

/** A yes with no words in it. `clean()` eats emoji, so this reads the raw. */
const AFFIRM_EMOJI = /^[\s]*(?:👍|👌|✅|🔥|♟️|♟|😈|😏){1,3}[\s]*$/u;

/* ── the small predicates, exported because the eval tests them ─────────── */

const clean = (t: string): string =>
  t
    .toLowerCase()
    // an emoji or a run of punctuation is decoration, never a word
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Which game this text names, or null. Names only; no intent is read here. */
export function gameTermIn(text: string): GameKind | null {
  const t = text || "";
  for (const [kind, re] of GAME_TERMS) if (re.test(t)) return kind;
  return null;
}

/** True when this text is a proposal to play SOMETHING, right now. */
export function hasPlayIntent(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  if (NOT_NOW.test(t)) return false;
  return RE_PLAY_INTENT.test(t);
}

/** A no, or a not-now. */
export function isRefusal(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  // strip the yeses that are spelled with a no in them before asking
  return REFUSAL.test(t.replace(WHY_NOT, " "));
}

/**
 * The whole of shape A on one message: a named game AND a live proposal to
 * play it, with nothing in the sentence that puts it in the past, in the
 * future, or in somebody else's hands.
 */
export function playAskIn(text: string): GameKind | null {
  const kind = gameTermIn(text || "");
  if (!kind) return null;
  if (!hasPlayIntent(text)) return null;
  if (isRefusal(text)) return null;
  return kind;
}

/** A yes. Short, or a yes with the game's own words attached to it. */
export function isAffirmation(text: string): boolean {
  const raw = text || "";
  if (AFFIRM_EMOJI.test(raw)) return true;
  const t = clean(raw);
  if (!t) return false;
  if (isRefusal(raw)) return false;
  // A yes is a SHORT turn. "ok so anyway my day was long and then" opens on a
  // yes-shaped token and is not one, and a detector that takes it is a
  // detector that opens a board in the middle of somebody's story.
  if (AFFIRM.test(t) && t.split(" ").length <= 6) return true;
  // unless the yes brought the ask back with it, in which case its length is
  // not evidence of anything
  return AFFIRM_STRONG.test(t) && RE_PLAY_INTENT.test(t) && !NOT_NOW.test(t);
}

/* ── the walk ──────────────────────────────────────────────────────────── */

const sayable = (m: InviteTurn): boolean =>
  m.channel !== "call" && (m.kind ?? "text") === "text" && Boolean(m.text && m.text.trim());

/**
 * The pending invite for this thread, or null.
 *
 * Reads the tail only, and re-derives from scratch on every call: there is no
 * invite STATE anywhere, which is what makes "at most one pending" structural
 * rather than something a reducer has to maintain. The surface decides what a
 * tapped or dismissed invite means; this function has one job and no memory.
 */
export function detectGameInvite(
  messages: readonly InviteTurn[],
  nowMs: number = Date.now(),
): GameInvite | null {
  if (!messages.length) return null;

  // ── the anchor: her latest sayable message ───────────────────────────
  let h = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from !== "her") continue;
    // her last word was a photo, a gif or a voice note: nothing to hang a
    // chip under, and putting one under a picture would read as a caption
    if (!sayable(m)) return null;
    h = i;
    break;
  }
  if (h < 0) return null;
  if (nowMs - messages[h].at > INVITE_FRESH_MS) return null;

  // ── her burst: everything she said in this one turn ──────────────────
  let k = h;
  while (k - 1 >= 0 && messages[k - 1].from === "her") k--;
  const herBurst = messages.slice(k, h + 1).filter(sayable);
  // She said no, or she is putting it off. Her own words outrank his ask: a
  // chip under "abhi nahi yaar" would be the app contradicting her.
  if (herBurst.some((m) => isRefusal(m.text || ""))) return null;

  // ── his block: everything he said immediately before that turn ───────
  let j = k - 1;
  const hisBlock: InviteTurn[] = [];
  while (j >= 0 && messages[j].from === "me") {
    if (sayable(messages[j])) hisBlock.unshift(messages[j]);
    j--;
  }
  if (!hisBlock.length) return null;
  if (hisBlock.some((m) => isRefusal(m.text || ""))) return null;

  // ── A. HIS CLEAR ASK ─────────────────────────────────────────────────
  for (const m of hisBlock) {
    const kind = playAskIn(m.text || "");
    if (kind) return { kind, msgId: messages[h].id, askId: m.id, via: "his-ask" };
  }

  // ── B. HER PROPOSAL, HIS YES ─────────────────────────────────────────
  // A yes only counts as one when there is a proposal for it to be a yes TO,
  // and the proposal has to be the thing he was answering: her turn
  // immediately before his, never something from an hour ago.
  if (!hisBlock.some((m) => isAffirmation(m.text || ""))) return null;
  const herPrev: InviteTurn[] = [];
  while (j >= 0 && messages[j].from === "her") {
    if (sayable(messages[j])) herPrev.unshift(messages[j]);
    j--;
  }
  for (const m of herPrev) {
    const kind = playAskIn(m.text || "");
    if (kind) return { kind, msgId: messages[h].id, askId: m.id, via: "her-proposal" };
  }
  return null;
}
