// SHE-SHOULD-CALL-ME, READ OFF THE THREAD — a predicate, not a prompt marker.
//
// The owner's screenshot, and the defect it caught in one exchange:
//
//     him: "U can call me"
//     her: "call button click kar na, main thodi kar sakti hu"
//
// She believes she cannot ring him. The product has rung him for months: a
// call that drops mid-sentence arms `AppState.callback`, App renders
// `IncomingCall`, and accepting mounts the live call with `sheCalled=true` so
// she answers as the CALLER (task #107). The machinery was real and her
// self-model was stale, which is the worst possible pairing — she declined a
// thing she can do, in her own voice, to the person paying for it.
//
// This file is the half of the fix that lives in the bytes: WHEN HE ASKS HER
// TO CALL, SHE CALLS. The other half is her brief, and it is deliberately not
// here (see the header note at the bottom of this comment).
//
// ── why this is a detector and not a [call] marker ────────────────────────
//
// The same two reasons `gameInvite.ts` gives, and this module is written in
// its idiom on purpose so there is one shape to learn rather than two:
//
//   1. `brain.ts` and `persona.ts` are owned by other workstreams. A parser
//      branch written into a file two agents are editing is a merge conflict
//      with a safety gate in it.
//   2. `gate0-structural` is the standing law on which arm of a rule to
//      trust: the prompt arm leaked 57-98%, the predicate on the bytes leaked
//      0 of 31,122. A marker only fires when the model remembers to emit it —
//      and this defect IS the model not remembering. Asking the arm that just
//      failed to carry the fix is how the same screenshot arrives twice.
//
// His sentence is already on the wire either way, and the bytes cannot forget.
//
// ── the rule, in one paragraph ────────────────────────────────────────────
//
// A call invite exists when the conversation has actually reached "you call
// me", which is exactly two shapes and no others:
//
//   A. HIS CLEAR ASK.          "call me", "u can call me", "mujhe call karo",
//                              "phone kar na", "ring me", "call karle".
//   B. HER PROPOSAL + HIS YES. she offered ("call karu?", "should i call
//                              you?") and his very next turn is a yes.
//
// Everything else is talk about calling, which people do all day without
// wanting a phone to ring. The four families that are NOT asks are each a
// separate guard below and each has its own block in the eval, because every
// one of them is a full-screen ring arriving uninvited:
//
//   DIRECTION.   "can i call you", "i'll call you", "main call karta hu" —
//                he is the one dialling, and the call button is right there.
//   TENSE.       "usne call kiya", "you called me", "call cut gaya" — a call
//                that already happened is not a call being asked for.
//   CAPABILITY.  "can you call?", "kya tu call kar sakti hai?" — a question
//                ABOUT her, whose honest answer is words (and may include an
//                offer, which is shape B's first half). Judgment, documented
//                at RE_CAPABILITY: a capability question that names HIM as
//                the recipient ("can you call me?") IS an invite, because the
//                felt intent is yes-call and answering it with a lecture on
//                what she is capable of is the exact failure this file exists
//                to end.
//   DEFERRAL.    "call me later", "kal call karna" — a time he named that is
//                not now. She answers in words; nothing is armed. `abhi` is
//                deliberately absent from that list: `abhi call kar` is now.
//
// ── the anchor ────────────────────────────────────────────────────────────
//
// The invite attaches to HER latest text message, exactly like the game chip,
// and for a reason that is worth more here than there: the ring must not
// arrive before she has answered. Anchoring on her reply IS the sequencing —
// her line lands, and the ring follows it 2-6 seconds later. No hook into the
// reply cycle, no second clock, nothing that could ring over her silence.
//
// It also gives "at most one pending she-call" for free, because only one
// message can be the latest one she sent.
//
// ── what this file does NOT decide ────────────────────────────────────────
//
// It does not decide what she SAYS. Her pre-ring line ("achha ruk, karti hu"
// in shape) is her brief's business, and the shape of that text is a
// coordinator edit to `persona.ts`. This module returns a predicate; the
// surface arms the ring the callback path already owns. Nothing here writes
// a sentence she could recite (`persona.ts`'s first hard-learned rule).
//
// Pure and import-free, exactly like `gameInvite.ts` and `greeting.ts`, so it
// is callable from the web thread and from `api/_surface.js`'s room path
// without dragging a dependency into a bundle that cannot take one.

export interface CallInvite {
  /** The message the invite is anchored to. Always one of HERS. */
  msgId: string;
  /**
   * The message that ESTABLISHED the intent — his ask, or her proposal. The
   * invite's identity, and deliberately not `msgId`.
   *
   * `gameInvite.ts` learned this the expensive way: `msgId` moves every time
   * she says anything else, so an invite keyed on the anchor comes back after
   * it has been answered. Here that would mean a SECOND ring for one ask,
   * which is worse than a chip reappearing by the whole difference between a
   * button and a phone. There is exactly one ask per agreement; key on it.
   */
  askId: string;
  /** Which of the two shapes fired. Telemetry and tests; no surface reads it. */
  via: "his-ask" | "her-proposal";
}

/** The shape this needs from a message, so it need not import the UI's type. */
export type CallTurn = {
  id: string;
  from: "her" | "me";
  at: number;
  text?: string;
  kind?: string;
  channel?: "chat" | "call";
};

/**
 * How long an unanswered ask stays live.
 *
 * TWO MINUTES, and it is short for a reason the game chip does not have. A
 * chip is an offer that waits; a ring is an interruption that arrives. The
 * window has to be long enough to cover her reply landing (a burst-waited
 * reply plus typing rhythm is seconds, not minutes) and short enough that
 * re-opening the app on a thread where he once said "call me" cannot ring
 * him out of nowhere — which is a silence-triggered call, the exact shape
 * `decisions.md#proactive-reason-contingent` forbids in any form.
 *
 * REVERSAL: if a real ask is measured missing the window (a slow model turn,
 * a lookup round trip), raise it. If a ring is ever reported arriving out of
 * context, it is still too long.
 */
export const CALL_INVITE_FRESH_MS = 2 * 60_000;

/**
 * The gap between her line and the ring: 2-6 seconds.
 *
 * She said she would call. This is how long "she would call" is allowed to
 * take before it stops being true. Under 2s reads as a machine that had the
 * call queued before she spoke; past ~6s the sentence has gone cold and the
 * ring is a surprise rather than the thing she just said.
 *
 * It is also the ONLY promise her pre-ring line is allowed to make — which is
 * why the line must not name a time. A minute she says out loud is a minute
 * this constant has to keep.
 */
export const RING_MIN_MS = 2_000;
export const RING_MAX_MS = 6_000;

/** When the ring should land, given now. `rnd` is injected so the eval can
 *  pin both ends of the window instead of sampling and hoping. */
export function ringAt(nowMs: number, rnd: number = Math.random()): number {
  const r = Math.min(1, Math.max(0, rnd));
  return nowMs + RING_MIN_MS + Math.round(r * (RING_MAX_MS - RING_MIN_MS));
}

/* ── vocabulary ────────────────────────────────────────────────────────── */

const clean = (t: string): string =>
  t
    .toLowerCase()
    // an emoji or a run of punctuation is decoration, never a word
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * A NAMED RECIPIENT, second person. The difference between an invitation and
 * a question about the world, and the one token most of this file turns on.
 */
const RE_ME = /\b(?:me|mujhe|muje|mujhko|mujko|mereko|mere\s*ko|hume|humein|humko)\b/;

/**
 * HIM DIALLING. Every one of these is a person reaching for the call button,
 * and the call button is one tap away on every surface in the product. A ring
 * arriving because he said "can i call you" is the app answering a question
 * he did not ask.
 */
const RE_HE_DIALS =
  /\b(?:can|may|shall|should|could)\s+i\s+(?:\w+\s+){0,2}?(?:call|ring|phone|dial)\b|\bi'?(?:ll|m)\s+(?:gonna\s+|just\s+)?(?:call|ring|phone|dial)\w*\b|\bi\s+(?:will|wanna|want\s+to|would\s+like\s+to|am\s+going\s+to)\s+(?:\w+\s+){0,2}?(?:call|ring|phone|dial)\b|\blet\s+me\s+(?:just\s+)?(?:call|ring|phone|dial)\b|\b(?:main|mai|mein)\s+(?:\w+\s+){0,3}?(?:call|phone|fone)\s+(?:kar|kr|laga|lga)/;

/**
 * THE PAST, THE PROGRESSIVE AND THE THIRD PERSON. "usne call kiya" is a
 * report about his evening; "call cut gaya" is why the last one ended;
 * "call kar raha hu" is him on another line right now. All three contain a
 * call and a verb and none of them is a request for one.
 */
const RE_PAST =
  /\b(?:called|calling|rang|phoned|dialled|dialed)\b|\bcall\s+(?:kiya|kiye|kari|kara|kra|krke|karke)\b|\bcall\s+(?:aaya|aya|aayi|ayi|aa\s*rah[ai]|aa\s*rh[ai])\b|\b(?:kiya|kari)\s+tha\b|\bcall\s+(?:cut|kat|katt|kata|drop|dropped|disconnect|disconnected|end|ended)\b|\bwas\s+on\s+(?:a\s+)?call\b|\bon\s+(?:a\s+)?call\s+(?:with|se)\b|\bkar\s+(?:raha|rahi|rhi|rha|rahe|rhe)\b|\bmissed\s+call\b|\bpe\s+tha\b|\blast\s+(?:call|night|time|week)\b/;

/**
 * A TIME HE NAMED THAT IS NOT NOW.
 *
 * "call me later" arms nothing. That is not a limitation, it is the honest
 * reading: he named a time, and a ring two seconds after he named a different
 * one is the app not listening. She answers it in words like anyone would.
 *
 * `abhi` ("right now") is deliberately NOT in this list, and neither is
 * "now" — those are the opposite instruction and they must reach the ring.
 */
const RE_LATER =
  /\blater\b|\bbaad\s*me(?:in)?\b|\bbaad\s+m\b|\bkal\b|\bparso\b|\btomorrow\b|\btomo\b|\btonight\b|\btonite\b|\bsometime\b|\bsome\s+time\b|\bafter\s+(?:\w+)\b|\bin\s+(?:a|an|\d+|kuch|thodi)\b|\bthodi\s*(?:der|deir)\b|\braat\s*ko\b|\bsubah\s*ko\b|\bshaam\s*ko\b|\bwhen\s+(?:you|u|i|ur|you're)\b|\bjab\b|\bfree\s+ho\b|\bghar\s+(?:aa|ja)\w*\s*ke\b|\bmin(?:s|ute|utes)?\s+(?:me|mein|later)\b/;

/**
 * A REFUSAL OR A PROHIBITION, from either of them. Kills the invite outright.
 * "mat call kar" and "don't call" are the same sentence in two languages.
 */
const RE_NEG =
  /\bmat\b|\bmt\b|\bnahi+n?\b|\bnhi+\b|\bnai\b|\bnaa+hi\b|\bdon'?t\b|\bdont\b|\bdo\s+not\b|\bno\s+need\b|\bkoi\s+(?:zarurat|zaroorat|need)\b|\bnever\b|\bstop\b|\bcancel\b|\bbusy\b|\bnot\s+(?:now|free|possible)\b|\bno\s+thanks\b/;

/**
 * THE NOS THAT ARE YESES. "why not" and "kyun nahi" are the most enthusiastic
 * possible agreement spelled with the word for no in it — `gameInvite.ts` has
 * the identical guard for the identical reason.
 *
 * "why don't you call me" is this file's own addition and it is not optional:
 * it is one of the commonest forms of the exact ask this module exists for,
 * and without the strip the negation guard eats it whole.
 */
const WHY_NOT =
  /\b(?:kyu+n?|kyo+n?)\s+nahi+n?\b|\bwhy\s+not\b|\bwhy\s+(?:don'?t|dont)\s+(?:you|u)\b/g;

/**
 * A QUESTION ABOUT WHAT SHE CAN DO.
 *
 * ── THE JUDGMENT THIS FILE MAKES, WRITTEN DOWN ──────────────────────────
 *
 * "Can you call me?" and "can you call?" are grammatically the same question
 * and are not the same act. The first names him as the recipient: it is an
 * invitation wearing a modal, and everyone who has ever said it meant "call
 * me". The second asks what she is — a fair question, whose honest answer is
 * words, possibly ending in her offering (which is shape B's first half).
 *
 * So the rule is the RECIPIENT, not the modal: capability + `RE_ME` fires,
 * capability alone does not. The leaning is deliberate and it is the one the
 * owner's screenshot argues for — the failure that started this workstream
 * was her answering a felt "call me" with a claim about her own limits.
 *
 * REVERSAL: if a ring is ever reported landing on a sincere "can you even
 * call?", tighten this to require an imperative. Nothing measured yet says
 * it should be; this is a judgment, and it is here rather than in a commit
 * message so the next person can overturn it with evidence.
 */
const RE_CAPABILITY =
  /\b(?:can|could)\s+(?:you|u)\b|\bare\s+(?:you|u)\s+able\b|\bkar\s+sakt[iaeou]+\b|\bsakt[iaeou]+\s+(?:h|hai|ho|hain)\b|\bpossible\s+(?:h|hai|hai\?|is\s+it)\b|\bkya\s+(?:tu|tum|tume|aap)\b/;

/**
 * The tokens that may follow "call me" and leave it an ask.
 *
 * ── WHY A CLOSED LIST RATHER THAN A PATTERN ─────────────────────────────
 *
 * "You can call me" is the owner's exact sentence and must fire. "You can
 * call me Sam" is the naming idiom and must not, and the only thing telling
 * them apart is whether the next word is a NAME. There is no regex for
 * "is a name"; there is a short, closed list for "is one of the particles,
 * politeness markers, vocatives and time words that follow a request", and
 * anything outside it is treated as naming (or as a new clause) and dropped.
 *
 * Erring toward NOT firing is the right direction here for the reason the
 * game chip's eval states in its header, doubled: a missed ask costs him one
 * tap on a call button that is on every screen, and a spurious one is a
 * full-screen ring over whatever he was doing.
 */
const TAIL_OK = new Set([
  // Hinglish particles — "call me na" is the single commonest form of this ask
  "na", "naa", "naaa", "naaaa", "naan", "naah", "toh", "to", "bhi", "hi", "phir", "fir",
  // politeness
  "please", "pls", "plz", "plss", "pleasee", "pleaseee", "pliz",
  // now
  "now", "abhi", "abhii", "rightnow", "right", "asap", "jaldi", "fast", "quick", "quickly", "soon",
  // the request's own furniture
  "back", "once", "instead", "again", "ok", "okay", "okie", "k",
  "karo", "kar", "kro", "krna", "karna", "karo", "kr", "karke", "krke", "do", "dena",
  // vocatives — he is talking to her, not naming himself
  "yaar", "yr", "yarr", "jaan", "jaana", "baby", "babe", "bro", "dude", "meri", "meree",
  // standing permission. Judgment: "call me anytime" is a yes, not a deferral —
  // he did not name another time, he declined to name one. `RE_LATER` keeps the
  // sentences that DO name one ("later", "kal", "in 5 min") out.
  "anytime", "whenever", "kabhi", "jab", "when", "if", "agar",
  // conjunctions that start a new clause rather than a name
  "and", "or", "aur", "ya", "but", "par", "lekin",
]);

/* ── the small predicates, exported because the eval tests them ─────────── */

/** True when this text puts the call in the past, in someone else's hands,
 *  or in the middle of happening. */
export function isReportedCall(text: string): boolean {
  return RE_PAST.test(clean(text || ""));
}

/** True when this text names a time that is not now. */
export function isDeferred(text: string): boolean {
  return RE_LATER.test(clean(text || ""));
}

/** A no, a prohibition or a not-now. */
export function isCallRefusal(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  // strip the yeses that are spelled with a no in them before asking
  return RE_NEG.test(t.replace(WHY_NOT, " "));
}

/** True when this text asks what she is CAPABLE of without naming him as the
 *  one to be called — the question that gets an answer in words. */
export function isBareCapabilityQuestion(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  return RE_CAPABILITY.test(t) && !RE_ME.test(t);
}

/** "call me", with the naming idiom ("call me Sam") kept out by TAIL_OK. */
function callMeAsk(t: string): boolean {
  const re = /\b(?:call|ring|phone|fone|dial|buzz)\s+me\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t))) {
    const rest = t.slice(m.index + m[0].length).trim();
    if (!rest) return true;
    if (TAIL_OK.has(rest.split(" ")[0])) return true;
  }
  return false;
}

/** The Hinglish and English request shapes that are not "call me". */
const ASK_SHAPES: readonly RegExp[] = [
  // give me a call / a ring / a buzz
  /\bgive\s+me\s+(?:a|ek)\s+(?:call|ring|buzz|missed\s+call)\b/,
  // mujhe call karo / mereko phone kar de / mujhe ek call kar
  /\b(?:mujhe|muje|mujhko|mujko|mereko|mere\s*ko|hume|humein|humko)\s+(?:\w+\s+){0,3}?(?:call|phone|fone|ring)\s*(?:kar|kr|laga|lga|maar|mar)/,
  // call kar na / call karo / call karle / phone kar do / call kardo
  /\b(?:call|phone|fone)\s+(?:kar|kr)(?:o|na|naa|de|do|le|lo|dena|lena|deo|diyo)?\b/,
  /\b(?:call|phone|fone)\s+(?:karo|karna|karle|kardo|karde|karlo|kardena|kar\s*le|kar\s*do)\b/,
  // phone laga / call ghuma / call maar — the dial idioms
  /\b(?:phone|call|fone)\s+(?:lagao?|laga|lga|ghumao?|ghuma|maar|mar)\b/,
  // tu / tum / aap call karo
  /\b(?:tu|tum|tume|tune|aap|ap)\s+(?:\w+\s+){0,3}?(?:call|phone|fone)\s+(?:kar|kr)/,
  // ek call kar / ek call maar
  /\bek\s+(?:call|phone)\s+(?:kar|kr|maar|mar|de)\b/,
  // you should call / why don't you call / u can call (with `me` handled by
  // callMeAsk, this covers "you can call na")
  /\b(?:you|u)\s+(?:can|could|should|shud|must|may)\s+(?:\w+\s+){0,2}?(?:call|ring|phone|dial)\b/,
  /\bwhy\s+(?:don'?t|dont)\s+(?:you|u)\s+(?:\w+\s+){0,2}?(?:call|ring|phone)\b/,
];

/**
 * SHAPE A on one message: he is asking HER to call HIM, right now, and
 * nothing in the sentence puts it in the past, in his own hands, in a named
 * later, or under a question about what she is.
 */
export function callAskIn(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  if (isCallRefusal(t)) return false;
  if (RE_PAST.test(t)) return false;
  if (RE_LATER.test(t)) return false;
  if (RE_HE_DIALS.test(t)) return false;
  // capability WITHOUT a recipient is a question about her, not a request
  if (RE_CAPABILITY.test(t) && !RE_ME.test(t)) return false;
  // ── "call me" DECIDES ITSELF, and nothing downstream may overrule it ────
  //
  // "You can call me Sam" contains "you can call", which is one of the
  // request shapes below, so a plain `some()` over the shapes would name the
  // naming idiom an invitation. When the sentence contains "call me" at all,
  // the token after it is the whole question and `callMeAsk` is the whole
  // answer — a failed tail is a hard no, not a fall-through.
  if (/\b(?:call|ring|phone|fone|dial|buzz)\s+me\b/.test(t)) return callMeAsk(t);
  return ASK_SHAPES.some((re) => re.test(t));
}

/**
 * SHAPE B's first half: HER offering to call.
 *
 * ── WHY THIS IS INTERROGATIVE-ONLY, AND WHAT IT DELIBERATELY DROPS ──────
 *
 * Only questions and offers are admitted: "call karu?", "should i call you",
 * "want me to call", "let me call you". A DECLARATIVE future of hers —
 * "i'll call you", "call karungi" — is not here, and dropping it is a
 * deliberate trade rather than an oversight.
 *
 * The reason is the ring she has already been sent to place. Her pre-ring
 * line is a promise ("achha ruk, karti hu"), his next turn is very often an
 * ordinary "ok", and if her own promise counted as an offer then that "ok"
 * would be a fresh agreement with a fresh `askId` — a SECOND ring for one
 * ask, on a path built to guarantee exactly one. The pending-callback guard
 * catches most of that at the surface, but a guard that has to catch a shape
 * the detector should never have produced is one refactor from not catching
 * it. One ring per agreement is cheaper to keep here.
 *
 * Cost, stated: "i'll call you" / "haan" does not ring by itself. It does not
 * need to — her saying it after HIS ask is already covered by shape A, and
 * her saying it unprompted is her opening a call nobody asked for, which is
 * not this slice's to arm.
 */
const HER_OFFER: readonly RegExp[] = [
  /\b(?:should|shall|can|may|could)\s+i\s+(?:\w+\s+){0,2}?(?:call|ring|phone|dial)\b/,
  /\b(?:want|chahiye|chaiye)\s+me\s+to\s+(?:call|ring|phone)\b/,
  /\bwant\s+me\s+to\s+(?:call|ring)\b/,
  /\blet\s+me\s+(?:call|ring|phone)\s+(?:you|u)\b/,
  // call karu? / call kar lu? / main call karun kya
  /\b(?:call|phone|fone)\s+kar\s*(?:u+n?|oon|un|lu+n?)\b/,
  /\b(?:main|mai|mein)\s+(?:\w+\s+){0,3}?(?:call|phone)\s+kar\s*(?:u+n?|oon|un)\b/,
];

/** True when this text is HER offering to place the call. */
export function herCallOfferIn(text: string): boolean {
  const t = clean(text || "");
  if (!t) return false;
  if (isCallRefusal(t)) return false;
  if (RE_PAST.test(t)) return false;
  if (RE_LATER.test(t)) return false;
  return HER_OFFER.some((re) => re.test(t));
}

/** His yes. Short by construction: a real yes is one or two words. */
const AFFIRM =
  /^(?:ok(?:ay)?|okie|k|haa+n?|ha+|hn+|hm+|yes+|yea+h?|yup|yep|yess+|sure|chalo|chal|chale|theek\s*(?:hai|h)?|thik\s*(?:hai|h)?|done|deal|bilkul|pakka|obviously|kyu+n?\s+nahi+n?|why\s+not|please|plz|pls|karo|kar\s*(?:na|le|lo)|aa\s*jao|do\s+it|go\s+ahead|call\s+kar\w*)\b/;

/** A yes with no words in it. `clean()` eats emoji, so this reads the raw. */
const AFFIRM_EMOJI = /^[\s]*(?:👍|👌|✅|🔥|📞|☎️|😊|😁|🥺|❤️|😈|😏){1,3}[\s]*$/u;

/** A yes. Short, or a yes that carries the ask back with it. */
export function isCallAffirmation(text: string): boolean {
  const raw = text || "";
  if (AFFIRM_EMOJI.test(raw)) return true;
  const t = clean(raw);
  if (!t) return false;
  if (isCallRefusal(raw)) return false;
  if (RE_LATER.test(t)) return false;
  // A yes is a SHORT turn. "ok so anyway my day was long and then" opens on a
  // yes-shaped token and is not one — `gameInvite.ts`'s measurement, and a
  // ring is a more expensive thing to be wrong about than a chip.
  if (AFFIRM.test(t) && t.split(" ").length <= 6) return true;
  // unless the yes brought the ask back with it, in which case its length is
  // not evidence of anything
  return /\b(?:haa+n?|ha+|yes+|yea+h?|sure|ok(?:ay)?|chalo|bilkul|pakka)\b/.test(t) && callAskIn(t);
}

/* ── the walk ──────────────────────────────────────────────────────────── */

const sayable = (m: CallTurn): boolean =>
  m.channel !== "call" && (m.kind ?? "text") === "text" && Boolean(m.text && m.text.trim());

/**
 * The pending call invite for this thread, or null.
 *
 * Reads the tail only and re-derives from scratch on every call: there is no
 * invite STATE anywhere, which is what makes "at most one pending" true by
 * construction rather than something a reducer has to maintain. The surface
 * decides what an armed or answered invite means; this function has one job
 * and no memory.
 *
 * Structurally identical to `detectGameInvite` — same anchor, same burst
 * walk, same refusal precedence — because they are the same question asked
 * about two different asks, and two walks that drift apart is how one of them
 * starts firing on a case the other one fixed.
 */
export function detectCallInvite(
  messages: readonly CallTurn[],
  nowMs: number = Date.now(),
): CallInvite | null {
  if (!messages.length) return null;

  // ── the anchor: her latest sayable message ───────────────────────────
  let h = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.from !== "her") continue;
    // her last word was a photo, a gif or a voice note. Nothing has been
    // ANSWERED yet in words, and a ring landing on top of a picture is a ring
    // arriving before she replied.
    if (!sayable(m)) return null;
    h = i;
    break;
  }
  if (h < 0) return null;
  if (nowMs - messages[h].at > CALL_INVITE_FRESH_MS) return null;

  // ── her burst: everything she said in this one turn ──────────────────
  let k = h;
  while (k - 1 >= 0 && messages[k - 1].from === "her") k--;
  const herBurst = messages.slice(k, h + 1).filter(sayable);
  // She said no. Her own words outrank his ask: a ring landing under "abhi
  // nahi yaar" would be the app contradicting her.
  //
  // A DEFERRAL OF HERS IS DELIBERATELY NOT CHECKED HERE, and the asymmetry
  // with `RE_LATER` on HIS side is the point. His "call me later" names a
  // time and arms nothing. HER "2 min me karti hu" is a promise already
  // made — the worst available outcome there is silence, because that is the
  // promise quietly abandoned. Ringing 4 seconds after she said 2 minutes is
  // slightly eager and keeps her word; not ringing breaks it.
  if (herBurst.some((m) => isCallRefusal(m.text || ""))) return null;

  // ── his block: everything he said immediately before that turn ───────
  let j = k - 1;
  const hisBlock: CallTurn[] = [];
  while (j >= 0 && messages[j].from === "me") {
    if (sayable(messages[j])) hisBlock.unshift(messages[j]);
    j--;
  }
  if (!hisBlock.length) return null;
  // A refusal ANYWHERE in his block kills it, ask or no ask: "call me" and
  // "actually don't" in one breath is one instruction, and it is the second.
  if (hisBlock.some((m) => isCallRefusal(m.text || ""))) return null;

  // ── A. HIS CLEAR ASK ─────────────────────────────────────────────────
  for (const m of hisBlock) {
    if (callAskIn(m.text || "")) return { msgId: messages[h].id, askId: m.id, via: "his-ask" };
  }

  // ── B. HER OFFER, HIS YES ────────────────────────────────────────────
  // A yes only counts as one when there is an offer for it to be a yes TO,
  // and the offer has to be the thing he was answering: her turn immediately
  // before his, never something from an hour ago.
  if (!hisBlock.some((m) => isCallAffirmation(m.text || ""))) return null;
  const herPrev: CallTurn[] = [];
  while (j >= 0 && messages[j].from === "her") {
    if (sayable(messages[j])) herPrev.unshift(messages[j]);
    j--;
  }
  for (const m of herPrev) {
    if (herCallOfferIn(m.text || "")) return { msgId: messages[h].id, askId: m.id, via: "her-proposal" };
  }
  return null;
}
