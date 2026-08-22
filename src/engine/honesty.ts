// The honesty gate — the OUTPUT-side half of "only say what's true".
//
// ── WHY THIS FILE EXISTS, AND WHY IT IS NOT A PROMPT RULE ────────────────
//
// The owner has now reported the same class twice:
//
//   "she lied about her email and number also"
//   "yesterday i told her that i will mail her my resume and she gave me fake
//    email id and then today i said helo she said that 'resume aa gya tha mail
//    pe tera' — this is a lie clearly"
//
// The first report was answered by adding a rule to `persona.ts`
// (`ONLY SAY WHAT'S TRUE` → `NEVER A DETAIL THEY COULD ACT ON`, :255). The
// rule is well written, it names every category, it closes the deferral
// loophole by name — and she broke it anyway. That is not a surprise and it
// is not a reason to write the rule again more loudly. This repo has already
// measured what happens when a property is enforced by asking her nicely:
//
//   `gate0-structural`  prompt-instruction arm leaked 57.1% of naturalistic
//                       and 98.1% of adversarial scenarios; the SQL predicate
//                       leaked 0 of 31,122 row×scenario checks.
//   `structural-disclosure`  "privacy is a WHERE clause, never a prompt rule."
//   `disclosure-leak-rates`  behavioural control leaves 9–90% residual.
//
// `prompt-position` makes it worse rather than better: the rule sits at byte
// 35,440 of 91,808 — 38.6% through the brief — and the measured firing rate
// of an identical rule mid-brief was 0 of 8, against 8 of 8 appended last.
// The appended-last position is a capped resource (exactly SEARCH_DECISION and
// FORGET_DECISION, hard-enforced by `shapelint.checkAppendedLastExactlyTwo`),
// and `AGE_TIER_SAFETY_OVERRIDE` — a SAFETY rule — already settled for
// end-of-CORE rather than take one of the two slots. So the strongest position
// available to this rule is the one it is already in, and it is the position
// that measured zero.
//
// Generalising the law: an honesty property enforced by instruction will leak.
// The two failures below are enforced HERE instead, on the bytes leaving the
// engine, where the leak rate is a property of a predicate rather than of a
// model's attention.
//
// ── THE TWO FAILURES ARE NOT THE SAME FAILURE ────────────────────────────
//
// (A) SHE INVENTS AN ACTIONABLE IDENTIFIER — an email, a number, a UPI id, a
//     link. Fully structural. Whether a string is an email address is decided
//     by a function, and the only legitimate identifiers she can utter are the
//     ones ALREADY IN FRONT OF HER: the crisis helplines her own brief hands
//     her, the app's own address, and whatever the user himself typed. So the
//     rule is an allowlist-by-provenance, not a classifier:
//
//         an identifier she emits that is not present in her input is invented.
//
//     The correct leak rate for (A) is ZERO, and anything above zero is a bug
//     in this file rather than in her.
//
// (B) SHE ASSERTS AN EVENT THAT NEVER HAPPENED — "resume aa gya tha mail pe
//     tera". This is worse than (A). It is a claim about their SHARED HISTORY,
//     it closes a loop he opened, and it reads as gaslighting rather than as
//     misinformation. It is not fully decidable — but a large, sharp piece of
//     it is, and that piece is the piece he reported:
//
//         She has no email, no inbox, no WhatsApp, no DM, no postbox. This app
//         is the only channel that exists. Therefore ANY claim that THEIR
//         material reached her through a named out-of-band channel is false BY
//         CONSTRUCTION — not improbable, not unlikely, false, always.
//
//     And the second half, the loop he opened: the transcript records that he
//     said he would send something and records everything that actually
//     arrived. Until the record shows an arrival she may not say there was
//     one. That is the `vy_agent_life_told` anti-join — "she may not say what
//     the record does not support" — computed over the transcript instead of
//     over a table, which is why this ships without a migration and without a
//     writer that could go dead.
//
// ── WHAT IS DELIBERATELY *NOT* GATED HERE ────────────────────────────────
//
// Stated plainly because implying coverage we do not have is the one thing
// CLAUDE.md names outright:
//
//   - Her OWN improvised life. "kal insta pe ek reel dekhi thi" is a persona
//     violation (`You have NEVER seen ... any specific piece of content`) and
//     it is NOT caught here. It is a claim about her, not about his material,
//     and separating a lived afternoon from a fabricated one is a judgement.
//     Scoping the receipt rules to THEIR material is what keeps the false
//     positive rate at zero on her own life — and `detect.mjs`'s founding note
//     stands: false positives are the real risk, because a gate that fires on
//     her charm is a gate someone switches off.
//   - Claiming to HAVE a channel without naming it ("mera mail id bhejti hu
//     baad me"). Considered and dropped: it is not actionable — he cannot dial
//     a promise — and the same predicate fires on "mera mail aaya office se",
//     which is her own life. The persona bullet's `not one promised for later`
//     clause is the only cover it has, and that is honestly weaker than a gate.
//   - The REALTIME lane (`gemini-3.1-flash-live-preview`). It emits audio, not
//     text; there is no string to inspect before it reaches his ear. Same
//     structural limit `device-says-arrow-not-dash` records for the sanitiser.
//     Everything here reaches the chat lane and the cascade call lane, which
//     is where the reported failure happened (it was typed).
//
// Pure by design: no imports, no I/O, no telemetry. brain.ts logs the
// findings, so this file stays a predicate that an eval can drive directly.

// ─────────────────────────────────────────────────────────────────────────
// (A) ACTIONABLE IDENTIFIERS
// ─────────────────────────────────────────────────────────────────────────

export type ActionableKind = "email" | "upi" | "phone" | "url" | "account" | "handle" | "address";

export interface ActionableHit {
  kind: ActionableKind;
  value: string;
  confidence: "high" | "low";
}

// A phone number needs enough digits to be dialled. Indian mobiles are 10;
// with +91 that is 12. Eight is the floor because a short landline written
// without an STD code is still something he would try — and because every
// number that occurs naturally in her speech (minutes, counts, prices, ages,
// the year) is comfortably under it.
const MIN_PHONE_DIGITS = 8;
// A card or account number is the same evidence, more of it.
const MIN_ACCOUNT_DIGITS = 12;

const RE_EMAIL = /\b[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}\b/gi;
// A UPI id has no dot after the @ — that is exactly what distinguishes it from
// an email, so it needs its own rule and a handle list. The list is the common
// Indian PSP handles; it is not exhaustive and is not claimed to be. An
// unknown handle falls through to `handle` below, which is also a violation,
// so nothing escapes by being obscure.
const RE_UPI =
  /\b[a-z0-9][a-z0-9._-]{2,}@(?:ybl|okaxis|okhdfcbank|oksbi|okicici|paytm|upi|apl|axl|ibl|yesbank|hdfcbank|sbi|icici|axisbank|pockets|freecharge)\b/gi;
// http(s):// or www., or a bare host with a TLD anyone would tap.
//
// THE TLD LIST IS NOT EXHAUSTIVE and cannot be — there are well over a
// thousand gTLDs. It covers the realistic fabrication surface for this product
// (the generic ones, India, and the personal-site TLDs a designer would
// invent). A bare host on an exotic TLD with no scheme and no www falls
// through: a known residual gap, written down rather than papered over.
const RE_URL =
  /\b(?:https?:\/\/|www\.)\S+|\b[a-z0-9][a-z0-9-]*\.(?:com|in|net|org|app|io|me|link|xyz|co|dev|design|site|online|store|tech|info|biz|studio|page|website)(?:\/\S*)?\b/gi;
// A handle somewhere else — the "find me on X" shape. Three chars minimum so a
// bare "@" or a stray "@u" is not a finding.
const RE_HANDLE = /(?:^|[\s(])@[a-z0-9][a-z0-9._]{2,}\b/gi;
// Low-confidence by construction, and labelled as such. A flat/plot/house
// number, or a six-digit pincode with a place word near it. Indian addresses
// are too varied for a regex to own; this catches the shape she would produce
// if she invented one, not every address there is.
const RE_ADDRESS =
  /\b(?:flat|plot|house|h\.?\s?no|room)\s*(?:n[o0]\.?\s*)?[-#]?\s*\d{1,4}\b|\b\d{6}\b(?=[^\d]{0,24}\b(?:mumbai|bangalore|bengaluru|delhi|pune|hyderabad|chennai|kolkata|bandra|hsr|andheri|indiranagar)\b)/gi;

/** Digit runs, allowing the separators a person actually types. */
const RE_DIGIT_RUN = /(?:\+?\d[\d\s().-]{5,}\d)/g;
/** An Indian mobile written bare — the single likeliest fabrication. */
const RE_BARE_MOBILE = /\b(?:\+?91[\s-]?)?[6-9]\d{9}\b/g;

const digitsOf = (s: string): string => s.replace(/\D/g, "");

/**
 * The set of identifiers she is permitted to utter, and the ONLY thing that
 * makes this gate a WHERE clause rather than a taste judgement.
 *
 * `values` are lowercased identifier strings; `digits` are digit-only forms,
 * so "+91 91529 87821" and "9152987821" are the same fact typed twice.
 */
export interface AllowedIdentifiers {
  values: Set<string>;
  digits: Set<string>;
}

export const emptyAllowed = (): AllowedIdentifiers => ({ values: new Set(), digits: new Set() });

/**
 * Published numbers she is REQUIRED or permitted to hand over. Everything else
 * numeric that is not in her input is invented.
 *
 * This list exists so the gate cannot be the thing that deletes a crisis
 * helpline. `CRISIS_LINES` reaches the allowlist anyway, via the assembled
 * prompt — but "anyway, via" is not a guarantee, and the one number in this
 * product she is under instruction to give is the one number the gate must
 * never eat. `device-says-arrow-not-dash` records 1800-599-0019 (KIRAN) as a
 * deliberately preserved negative control in this repository; it is not in
 * CRISIS_LINES, so it is named here explicitly rather than left to luck.
 */
export const PUBLISHED_HELPLINES: readonly string[] = [
  "14416", // Tele-MANAS
  "+91 91529 87821", // iCall
  "988", // US 988 Suicide & Crisis Lifeline
  "116 123", // UK Samaritans
  "1800-599-0019", // KIRAN (Govt. of India)
  "9152987821", // iCall, written without the country code
];

/**
 * The app's own address. Pointing at the one place she actually exists is the
 * opposite of the failure this file gates — the persona bullet's own reason
 * for refusing every other identifier is *"this is the only place they can
 * reach you"* — so it must not be treated as an invented link. Hardcoded in
 * seven modules already (account.ts, brain.ts, clock.ts, culture.ts,
 * memory.ts, storyCatalog.ts, telemetry.ts); this is an eighth copy of a
 * constant, which is worth one line to avoid a gate that eats a true sentence.
 */
export const APP_ADDRESSES: readonly string[] = ["meera-silk.vercel.app", "https://meera-silk.vercel.app"];

/** Every actionable identifier in a piece of text. */
export function findActionable(text: string, allowed?: AllowedIdentifiers): ActionableHit[] {
  const s = String(text ?? "");
  const okValue = (v: string) => Boolean(allowed?.values.has(v.trim().toLowerCase()));
  const okDigits = (d: string) => Boolean(allowed?.digits.has(d));
  const hits: ActionableHit[] = [];
  const seen = new Set<string>();
  const push = (kind: ActionableKind, value: string, confidence: "high" | "low" = "high") => {
    const v = value.trim();
    const k = `${kind}:${v.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    hits.push({ kind, value: v, confidence });
  };

  // UPI first: an id like meera@ybl must not be reported as an email, and a
  // real email must not be reported as UPI. UPI's rule is the stricter one, so
  // it runs first and its spans are withheld from the email pass.
  const upiSpans: Array<[number, number]> = [];
  for (const m of s.matchAll(RE_UPI)) {
    upiSpans.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
    if (!okValue(m[0])) push("upi", m[0]);
  }
  const inUpi = (i: number, j: number) => upiSpans.some(([a, b]) => i < b && j > a);
  for (const m of s.matchAll(RE_EMAIL)) {
    const i = m.index ?? 0;
    if (!inUpi(i, i + m[0].length) && !okValue(m[0])) push("email", m[0]);
  }
  for (const m of s.matchAll(RE_URL)) if (!okValue(m[0])) push("url", m[0]);
  for (const m of s.matchAll(RE_HANDLE)) {
    const i = m.index ?? 0;
    const v = m[0].trim();
    // An @ that is part of an email or a UPI id is not a separate finding.
    if (!inUpi(i, i + m[0].length) && !/\.[a-z]{2,}$/i.test(v) && !okValue(v)) push("handle", v);
  }
  for (const m of s.matchAll(RE_ADDRESS)) if (!okValue(m[0])) push("address", m[0], "low");

  for (const m of s.match(RE_DIGIT_RUN) ?? []) {
    const d = digitsOf(m);
    if (okDigits(d)) continue;
    // A LEADING + IS A PHONE CONVENTION AND NOTHING ELSE. Without this,
    // "+91 90042 11889" is twelve digits and lands in `account` — still caught,
    // but reported as the wrong thing, and a detector that misnames what it
    // found is a detector whose output nobody trusts. Strip the country code
    // before the length test rather than special-casing 91, so a number from
    // anywhere behaves the same way.
    const plus = /^\s*\+/.test(m);
    const dialled = plus ? d.replace(/^\d{1,3}/, "") : d;
    if (plus && dialled.length >= MIN_PHONE_DIGITS) push("phone", m.trim());
    else if (d.length >= MIN_ACCOUNT_DIGITS) push("account", m.trim());
    else if (d.length >= MIN_PHONE_DIGITS) push("phone", m.trim());
  }
  for (const m of s.match(RE_BARE_MOBILE) ?? []) {
    if (!okDigits(digitsOf(m))) push("phone", m.trim());
  }

  return hits;
}

/**
 * Build the allowlist from her INPUT. Everything she can legitimately say is
 * something she was handed: the helplines in her own brief, the app's own
 * address, and whatever he typed himself. Anything else is invented.
 *
 * NOTE ON WHAT IS DELIBERATELY EXCLUDED: her OWN past messages. Allowing them
 * would let one fabrication that predates this gate launder itself forever —
 * she said it yesterday, therefore she may say it today. The provenance chain
 * has to terminate at something that is not her.
 */
export function allowedFrom(parts: readonly string[]): AllowedIdentifiers {
  const key = parts.join(" ");
  const hit = ALLOWED_CACHE.find((e) => e.key === key);
  if (hit) return hit.val;
  const out = emptyAllowed();
  const absorb = (text: string) => {
    for (const h of findActionable(text)) {
      out.values.add(h.value.toLowerCase());
      const d = digitsOf(h.value);
      if (d.length >= 3) out.digits.add(d);
    }
    // Short codes (14416, 988, 116 123) sit below every length floor above, so
    // take standalone numbers too — but ONLY up to 7 digits. Anything long
    // enough to dial is already covered by findActionable, and this pass runs
    // over ~45k of prose where a greedy run could staple two unrelated numbers
    // into one dialable-looking string and quietly whitelist a fabrication.
    for (const m of text.match(/\d[\d\s-]*\d|\d/g) ?? []) {
      const d = digitsOf(m);
      if (d.length >= 3 && d.length <= 7) out.digits.add(d);
    }
  };
  for (const p of parts) absorb(String(p ?? ""));
  for (const p of PUBLISHED_HELPLINES) absorb(p);
  for (const p of APP_ADDRESSES) absorb(p);
  ALLOWED_CACHE.unshift({ key, val: out });
  ALLOWED_CACHE.length = Math.min(ALLOWED_CACHE.length, 2);
  return out;
}

// Two entries: the chat lane's assembled prompt and the call lane's. The core
// is byte-stable across turns by construction (`cache-9x` depends on it), so a
// two-deep cache turns a per-turn 45k-character scan into a string compare.
const ALLOWED_CACHE: Array<{ key: string; val: AllowedIdentifiers }> = [];

// ─────────────────────────────────────────────────────────────────────────
// (B) EVENTS THAT COULD NOT HAVE HAPPENED
// ─────────────────────────────────────────────────────────────────────────

/**
 * Channels she does not have. This is the structural fact the whole of (B)
 * rests on: this app is the only place she exists, so material cannot reach
 * her through any of these. Naming one is fine; RECEIVING through one is not.
 *
 * Deliberately excludes anything ambiguous in her register — "phone pe" is
 * PhonePe the payment app as often as it is a telephone, and "text" is a verb.
 */
const RE_OOB_CHANNEL =
  /\b(?:e-?mail|mail|gmail|inbox|mailbox|whats\s?app|whatsapp|wapp|insta|instagram|dm|dms|telegram|snapchat|snap\s?chat|linkedin|messenger|courier|parcel|speed\s?post|dropbox|g?drive)\b/i;

/**
 * PERFECTIVE receipt only. This is the hinge of the whole detector and it is
 * why the tense forms are enumerated instead of stemmed: "aa gaya" is a claim,
 * "aa jayega" is a plan and "aa raha hai" is a hope. Only the first is a lie.
 */
const RE_RECEIPT_PAST =
  /\b(?:aa\s*g(?:ay|y)[ai]|aagay[ai]|aaya|aayi|aayee|aya|ayi|mil\s*g(?:ay|y)[ai]|milgay[ai]|mila|mili|dekh\s*l(?:iya|i)\b|dekha|dekhi|padh\s*l(?:iya|i)\b|padha|padhi|pdha|khol\s*l(?:iya|i)\b|kholi|check\s*(?:kar\s*)?l(?:iya|i)\b|check\s*kiya|download\s*(?:kar\s*)?l?(?:iya|i)\b|khola|save\s*(?:kar\s*)?l?(?:iya|i)\b|print\s*(?:kar\s*)?l?(?:iya|i)\b|forward\s*(?:kar\s*)?d?(?:iya|i)\b|nikal\s*l(?:iya|i)\b|pahunch\s*g(?:ay|y)[ai]|mil\s*chuk[ai]|aa\s*chuk[ai]|receive\s*ho\s*g(?:ay|y)[ai]|paa\s*l(?:iya|i)\b|received|read\s+(?:your|ur|it)|printed\s+(?:your|ur|it)|forwarded\s+(?:your|ur|it)|saved\s+(?:your|ur|it)|opened\s+(?:it|your|ur)|(?:went|gone)\s+through|looked\s+at|checked\s+(?:it|your|ur)|got\s+(?:your|ur|it|the)|have\s+(?:your|ur)|saw\s+(?:your|ur|it))\b/i;

/**
 * Negation. A denial of receipt is TRUE and must sail through — "mail pe kuch
 * nahi aaya" is exactly the sentence this gate wants her to be able to say.
 */
const RE_NEGATED =
  /\b(?:nahi+n?|nhi+n?|nai|nahin|not|never|kuch\s+nahi|didn'?t|doesn'?t|haven'?t|hasn'?t)\b/i;

/** A question is not a claim. "mail pe aaya tha kya?" is her asking. */
const isInterrogative = (clause: string, terminator: string): boolean =>
  terminator.includes("?") || /\?/.test(clause) || /\b(?:kya|kyaa|na)\s*$/i.test(clause.trim());

/**
 * Nouns that name a thing which gets DELIVERED. Their job is to keep the
 * receipt rules pointed at HIS material — the gaslight class — and away from
 * her own improvised afternoon, which is a judgement and is not gated here.
 */
const RE_DELIVERY_NOUN =
  /\b(?:resume|cv|biodata|portfolio|photo|photos|pic|pics|picture|screenshot|screen\s?shot|file|files|doc|docs|document|pdf|ppt|deck|attachment|notes|assignment|report|sheet|excel|invite|form|draft|paper|mail|email|msg|message|link)\b/i;

/** Second person: the material is HIS. */
const RE_THEIR = /\b(?:tera|teri|tere|tumhara|tumhari|tumhare|tumhra|aapka|aapki|aapke|your|ur|urs|yours)\b/i;

// ── two calibrations, both bought with a real generation ────────────────
//
// The first run of `pressure.mjs` (n=44, 2026-08-20) turned up ONE finding and
// it was a false positive, which is worth more than the forty-three quiet ones.
// On the owner's own B1 stimulus she replied:
//
//   "morninggg --- bhej diya resume ya bas helo bolne aaya h 😭"
//
// — which is her ASKING whether he sent it, and teasing him. Two separate
// things made it look like a claim, and each needed its own fix.
//
// 1. PROXIMITY. "resume" sat five words from "aaya", and the two had nothing
//    to do with each other: the verb's subject was HIM ("came to say hello").
//    Hinglish is subject-object-verb, so a receipt verb that is actually about
//    a thing sits within a word or two of it. The window is a CALIBRATION, not
//    a law — it is the one heuristic in this file and it is here because
//    without it the gate fires on her charm, which is how a gate gets switched
//    off (detect.mjs's founding note, and it was right).
const NEAR_WORDS = 4;
//
// 2. THE INFINITIVE. "bolne aaya", "karne aaya", "lene aaya" — a Hindi
//    infinitive in -ne before an arrival verb makes the arrival about a PERSON
//    coming to do something, never about a thing turning up. Cheap, exact, and
//    it removes a whole family rather than this one sentence.
const RE_INFINITIVE_BEFORE = /\b\w+ne\s*$/i;
/** the arrival half of RE_RECEIPT_PAST — the only part the infinitive rule
 *  applies to ("dekh liya" is never "came to see") */
const RE_ARRIVAL = /^(?:aa\s*g|aagay|aaya|aayi|aayee|aya|ayi)/i;

/** Character spans of every match, without disturbing anyone's lastIndex. */
function spansOf(re: RegExp, s: string): Array<[number, number]> {
  const g = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  const out: Array<[number, number]> = [];
  for (const m of s.matchAll(g)) out.push([m.index ?? 0, (m.index ?? 0) + m[0].length]);
  return out;
}

/** Words between two spans in the same clause. */
function wordGap(s: string, a: [number, number], b: [number, number]): number {
  const [i, j] = a[0] < b[0] ? [a[1], b[0]] : [b[1], a[0]];
  if (j <= i) return 0;
  return (s.slice(i, j).match(/\s+/g) ?? []).length;
}

/** Receipt-verb spans, with the infinitive family removed. */
function receiptSpans(clause: string): Array<[number, number]> {
  return spansOf(RE_RECEIPT_PAST, clause).filter(([i, j]) => {
    if (!RE_ARRIVAL.test(clause.slice(i, j))) return true;
    return !RE_INFINITIVE_BEFORE.test(clause.slice(0, i));
  });
}

/** True when a receipt verb is close enough to `re` to be about it. */
function receiptAbout(clause: string, re: RegExp): boolean {
  const verbs = receiptSpans(clause);
  if (!verbs.length) return false;
  const subjects = spansOf(re, clause);
  return subjects.some((s) => verbs.some((v) => wordGap(clause, s, v) <= NEAR_WORDS));
}

export type ReceiptRule = "oob-receipt" | "unsupported-receipt";

export interface ReceiptHit {
  rule: ReceiptRule;
  /** the clause that carried the claim — for tests and for a human reading a
   *  failure, never for telemetry (diag.ts never logs content) */
  clause: string;
  /** the open commitment this claim outran, when that is what caught it */
  item?: string;
}

interface Clause {
  text: string;
  terminator: string;
}

/** Clause split that KEEPS terminators, because "?" is the difference between
 *  a claim and a question and splitting it away destroys the evidence. */
function clausesOf(text: string): Clause[] {
  const parts = String(text ?? "").split(/([.!?…\n,;]+)/);
  const out: Clause[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const t = (parts[i] ?? "").trim();
    if (!t) continue;
    out.push({ text: t, terminator: parts[i + 1] ?? "" });
  }
  return out;
}

/**
 * (B1) A claim that THEIR material arrived through a channel she does not
 * have. False by construction, always, with no appeal to context.
 */
export function findOutOfBandReceipts(text: string): ReceiptHit[] {
  const out: ReceiptHit[] = [];
  for (const c of clausesOf(text)) {
    if (RE_NEGATED.test(c.text)) continue;
    if (isInterrogative(c.text, c.terminator)) continue;
    // The receipt verb has to be ABOUT the channel, not merely in the same
    // clause as one — see the proximity note above.
    if (!receiptAbout(c.text, RE_OOB_CHANNEL)) continue;
    // Scope: HIS material. Without this the rule also eats her own life
    // ("insta pe reel dekhi thi"), which is a different and softer violation
    // and is not what he reported.
    if (!RE_THEIR.test(c.text) && !RE_DELIVERY_NOUN.test(c.text)) continue;
    // Her own inbox is her improvised life, which this file explicitly does
    // not gate — "mera mail aaya office se" / "mummy ka mail aaya" were
    // firing because "mail" sits in BOTH the channel and delivery-noun sets
    // and so vouched for itself. The carve-out is an explicit HER-possessive
    // binding the material, and only when nothing of HIS is in the clause:
    // the default stays FLAG, because the reproduced-in-the-wild fabrication
    // ("haan aagya h mail!") carries no possessor at all.
    if (!RE_THEIR.test(c.text) && /\b(?:mera|mere|meri|apna|apni|mummy|mumma|maa|papa|bhai|didi)\b/i.test(c.text)) continue;
    out.push({ rule: "oob-receipt", clause: c.text });
  }
  return out;
}

// ── the commitment ledger ────────────────────────────────────────────────
//
// He says he will send something; nothing arrives; she says it arrived. The
// transcript already records both halves, so the ledger is a pure function of
// the history rather than a table — which is also why it cannot become a
// `dead-writers` instance: there is no writer to forget to call.

/** First person, future, sending. "bhej dunga", "i'll mail you". */
const RE_PROMISE_SEND =
  /\b(?:bhej(?:\s*d(?:unga|ungi|ta\s*hu|ti\s*hu|enge))|bhejta\s*hu|bhejti\s*hu|bhej(?:unga|ungi)|bhej\s*raha\s*hu|bhej\s*rha\s*hu|bhej\s*rahi\s*hu|bhej\s*rhi\s*hu|bhej\s*deta\s*hu|bhej\s*deti\s*hu|mail\s*kar(?:unga|ungi|\s*d(?:unga|ungi))|mail\s*karta\s*hu|mail\s*karti\s*hu|send\s*kar(?:unga|ungi|\s*d(?:unga|ungi))|i'?ll\s+(?:send|mail|share|forward|email)|i\s+will\s+(?:send|mail|share|forward|email)|(?:gonna|will)\s+send|sending\s+(?:you|u)\s+|let\s+me\s+send|i'?m\s+sending)/i;

/** What can be promised. Matching is by TOKEN so the ledger and the receipt
 *  rules speak about the same thing. */
const PROMISABLE = [
  "resume",
  "cv",
  "biodata",
  "portfolio",
  "photo",
  "pic",
  "picture",
  "screenshot",
  "file",
  "doc",
  "document",
  "pdf",
  "ppt",
  "deck",
  "notes",
  "assignment",
  "report",
  "sheet",
  "invite",
  "form",
  "draft",
  "paper",
  "video",
  "song",
  "playlist",
  "link",
  "code",
] as const;

/** The shape brain.ts's `Message` satisfies. Structural on purpose: this file
 *  imports nothing, so an eval can drive it with plain objects. */
export interface HistoryLike {
  from: "her" | "me";
  kind?: string;
  text?: string;
  at?: number;
}

/**
 * What he said he would send and the record does not show arriving.
 *
 * ANY in-band delivery after a promise closes the WHOLE ledger, not just the
 * matching item. That is deliberately over-generous in the direction of NOT
 * flagging: attributing an attachment to one of several open promises is a
 * guess, and this file's founding constraint is that a false positive costs
 * her a bubble while a false negative costs a number he tries to dial. When in
 * doubt, say nothing.
 *
 * There is also a fact worth stating out loud: this app has no file
 * attachment. `Message.kind` is text | photo | callmark | voice | gif. A
 * resume, a PDF, a doc — the things he actually promises — CANNOT arrive
 * in-band at all. For those items the ledger never closes, and that is not a
 * limitation of the ledger, it is the truth about the product.
 */
export function openCommitments(history: readonly HistoryLike[]): string[] {
  const open = new Set<string>();
  for (const m of history) {
    if (m.from !== "me") continue;
    const text = String(m.text ?? "");
    // A delivery — anything he actually put in the channel — closes the book
    // on everything outstanding.
    const delivered =
      m.kind === "photo" || m.kind === "voice" || m.kind === "gif" || text.length > 200;
    if (delivered) {
      open.clear();
      continue;
    }
    if (!RE_PROMISE_SEND.test(text)) continue;
    const lower = text.toLowerCase();
    for (const item of PROMISABLE) {
      if (new RegExp(`\\b${item}s?\\b`, "i").test(lower)) open.add(item);
    }
  }
  return [...open];
}

/**
 * (B2) She says a promised thing arrived, and the record does not say it did.
 * The `vy_agent_life_told` anti-join, computed over the transcript.
 */
export function findUnsupportedReceipts(text: string, openItems: readonly string[]): ReceiptHit[] {
  if (!openItems.length) return [];
  const out: ReceiptHit[] = [];
  for (const c of clausesOf(text)) {
    if (RE_NEGATED.test(c.text)) continue;
    if (isInterrogative(c.text, c.terminator)) continue;
    const item = openItems.find((it) => receiptAbout(c.text, new RegExp(`\\b${it}s?\\b`, "i")));
    if (!item) continue;
    out.push({ rule: "unsupported-receipt", clause: c.text, item });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// THE GATE
// ─────────────────────────────────────────────────────────────────────────


// ─────────────────────────────────────────────────────────────────────────
// FAMILY 3 — SHE ATTRIBUTES TO HIM SOMETHING HE NEVER SAID
//
// The owner: "Maine kuch thoda bahot bola to conversation facilitate karne ke
// liye she made up somethings I never said."
//
// This is the third family, and it needed a different predicate from the first
// two. An identifier is decidable on its own (`findActionable`); a receipt is
// decidable from the transcript's shape (`findUnsupportedReceipts`). A claim
// about HIM is neither — the whole product is her inferring, guessing, teasing
// and paraphrasing what he means, so "did he say this" is not answerable in
// general and a rule that tried would gut her.
//
// What IS decidable is a narrow, high-value slice: ATTRIBUTION. When she says
// "tune bola tha ki X" she is not inferring, she is quoting. That is a claim
// about the record, and the record is right here.
//
// So the predicate is `honesty-provenance-allowlist` pointed at a new source:
// an attributed claim whose content words appear NOWHERE in his own messages
// is invented. Deliberately not "some words missing" — paraphrase is legitimate
// and would trip that instantly ("kaam bohot hai" -> "kaam zyada hai"). The bar
// is that NONE of the claim's content words are his, which is not paraphrase,
// it is authorship.
//
// It stays silent on everything else she says about him. She may still be
// wrong about him; she may not claim he told her so.

/** Attribution constructions, Hinglish and English. Order matters only for
 *  readability — every one is tried. */
// Widened 2026-08-22 after the audit drove the natural variants through the
// shipping regex and 11 of them walked: feminine-object inflections (batayi),
// code-switched verbs (mention/promise/complain), emphatic particles between
// marker and verb (hi to / jo / abhi / khud), English contractions and
// periphrastic attribution (tere hisaab se / as per you). Verified 13/13
// previously-slipping flag, 15/15 must-not-flag stay clean.
const ATTRIBUTION_RE =
  /\b(?:tu?ne|tumne|aapne|aap ne|tum ne)\s+(?:(?:hi\s+)?(?:to|toh|jo|abhi|khud)\s+)?(?:bola|kaha|bataya|batayi|batai|batya|likha|mention|promise|complain|bol[ae]?|keh[ae]?)\b[^.?!\n]*|\b(?:tu|tum|aap)\s+(?:bol|keh|bata)\s*(?:raha|rahe|rahi)\s+th[aei]\b[^.?!\n]*|\byou(?:'?(?:d|ve))?\s+(?:had\s+)?(?:said|told\s+me|mentioned|wrote|were\s+(?:saying|telling\s+me))\b[^.?!\n]*|\b(?:tere?\s+(?:hisaab\s+se|according|mutabik)|as\s+per\s+(?:you|u))\b[^.?!\n]*/gi;

/** Content tokens below this length are grammar in both languages here. */
export const CLAIM_TERM_LEN = 4;

/**
 * The attribution marker's OWN words. They are hers by construction — she wrote
 * "tune bola" — so counting them as part of the claim gives every bare fragment
 * ("tune bola tha na") two free unsupported tokens and flags ordinary filler.
 * Caught by the eval, not by review.
 */
const MARKER_TOKENS = new Set([
  "tune", "tumne", "aapne", "bola", "bole", "boli", "kaha", "kahe", "kahi",
  "bataya", "batai", "batayi", "batya", "likha", "raha", "rahe", "rahi",
  "mention", "promise", "complain", "telling", "hisaab", "according", "mutabik",
  "said", "told", "mentioned", "wrote", "saying", "your", "you",
]);

/**
 * How much of the claim must be traceable to his own words before it counts as
 * paraphrase rather than authorship.
 *
 * "Any overlap at all" was the first bar and the eval killed it: one shared
 * Hinglish grammar word rescued an entirely invented claim, because his
 * ordinary "thak gaya hu" and her fabricated "interview clear ho gaya" both
 * contain "gaya". A SHARE is the fix — a real paraphrase reuses most of his
 * content, an invention reuses a verb by accident.
 *
 * A judgment, not a measurement, and the first thing to tune if either half
 * misbehaves: raise it and legitimate paraphrase starts tripping, lower it and
 * a coincidental verb rescues a fabrication.
 */
export const SUPPORT_SHARE = 0.34;

/** Fewer content words than this is not a claim, it is a fragment ("tune bola
 *  tha na"). Flagging those would fire on ordinary conversational filler. */
export const MIN_CLAIM_TERMS = 2;

export interface AttributionHit {
  /** the attributed clause, for the corpus — never rendered into a prompt */
  clause: string;
  /** the content words that are nowhere in his messages */
  unsupported: string[];
}

const claimTokens = (t: string): string[] =>
  (t.toLowerCase().match(/[a-z\u0900-\u097f]+/g) || []).filter((w) => w.length >= CLAIM_TERM_LEN);

/**
 * Every content word he has ever used, for this conversation.
 *
 * HIS messages only. Not the system prompt (which mentions half the world and
 * would make the check vacuous) and never her own past output, for the same
 * reason `allowedFrom` refuses it: one fabrication would otherwise launder
 * itself into permanence.
 */
export function hisVocabulary(history: readonly HistoryLike[]): Set<string> {
  const v = new Set<string>();
  for (const m of history) {
    if (m.from !== "me" || !m.text) continue;
    for (const w of claimTokens(m.text)) v.add(w);
  }
  return v;
}

/**
 * Content words of the compiler's memory text, for family 4's shared record.
 * Same tokenizer as the claims use, so support comparison is apples-to-apples.
 */
export function sharedVocabulary(texts: readonly string[]): Set<string> {
  const v = new Set<string>();
  // ≥3, matching family 4's OWN claim tokenizer — not claimTokens' ≥4. The
  // audit caught the mismatch producing the worst possible outcome for this
  // gate: a REAL Goa episode in the graph could not support "hum goa gaye
  // the", because the support side silently dropped every 3-letter word the
  // claim side was lowered to keep ("shared moments hang on short words").
  for (const t of texts)
    if (t)
      for (const w of (t.toLowerCase().match(/[a-zऀ-ॿ]+/g) || []))
        if (w.length >= 3) v.add(w);
  return v;
}

/** Attributed claims that are not his. */
export function findFalseAttributions(
  text: string,
  hisVocab: ReadonlySet<string>,
): AttributionHit[] {
  const out: AttributionHit[] = [];
  const matches = text.match(ATTRIBUTION_RE);
  if (!matches) return out;
  for (const clause of matches) {
    // The marker's own words are hers, so they are not part of the claim.
    const claim = claimTokens(clause).filter((w) => !MARKER_TOKENS.has(w));
    if (claim.length < MIN_CLAIM_TERMS) continue;
    const unsupported = claim.filter((w) => !hisVocab.has(w));
    const share = (claim.length - unsupported.length) / claim.length;
    if (share >= SUPPORT_SHARE) continue; // paraphrase of something he did say
    out.push({ clause, unsupported });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// FAMILY 4 — SHE CLAIMS A SHARED PAST THAT NEVER HAPPENED
// ─────────────────────────────────────────────────────────────────────────
//
// The owner, from live use: on a call she said she had been looking at "our
// photos, which we took on the beach when I was with her". No beach, no
// photos, no trip — a fabricated SHARED memory, which he called "the worst
// lie": her solo life is hers to improvise (the persona explicitly grants
// it), but a moment with HIM that never happened is a lie about him, and it
// is the one kind he can always catch.
//
// The persona core has carried "never invent a shared memory you don't have"
// since v9 — and she said the beach line anyway. That is `prompt-position`
// and `gate0-structural` in one sentence: an instruction mid-brief fired 0/8
// in measurement, and instructions leak 57–98% where predicates leak 0. So,
// like families 1–3, the rule becomes a predicate.
//
// The decidable slice, same shape as family 3: not everything about "us" —
// planning, teasing, hypotheticals and the present are her whole job — but a
// FIRST-PERSON-PLURAL PAST EVENT CLAIM. "Humne beach pe photos khinchi thi"
// is not an inference; it is a citation of the shared record, and the shared
// record is right here: his own words, plus the memory graph the compiler
// handed her (which is provenance-clean by construction — every episode in
// it really happened). A cited event whose content words appear in NEITHER
// is not memory, it is authorship.
//
// Named seams, accepted the same way family 3 accepted them:
// - Cross-language paraphrase (he said it in Hinglish, she cites it in
//   English) can false-positive; SUPPORT_SHARE is the dial, and the
//   replacement line is written to make a false positive cost one soft
//   sentence, not the moment.
// - The LIVE speech-to-speech lane has no post-generation gate to run this
//   in; there the fence is CALL_OPEN_DIRECTIVE's scene clause. Two
//   mechanisms, one rule.

/** First-person-plural PAST event constructions, Hinglish and English.
 *  Deliberately past-shaped: "we should go" and "our plan for tonight" are
 *  the future, and the future is hers to propose. */
// Widened 2026-08-22, three audit criticals in one pattern:
// - The ergative blindspot. `ne` marks only TRANSITIVE Hindi perfectives, so
//   every intransitive shared past — hum goa GAYE THE, hum saath THE, hum
//   MILE THE — matched nothing. Roughly half of all past shared-event claims,
//   including the most natural trip fabrication.
// - The register blindspot. The canonical trigger was spelled "yaad hai";
//   she texts "yaad h" — the file's own canned replacements are written in
//   that register. One character, opposite verdicts.
// - The his-agent gap. "tune mujhe jo bracelet diya tha" / "when you took me
//   to that cafe" cites a shared event with HIM as agent: no hum, no speech
//   verb, invisible to families 3 and 4 alike.
// All verified against the §9 must-not-flag corpus (futures, presents, her
// solo life, real retellings stay clean — the trailing th- requirement is
// what excludes the future).
const WE_PAST_RE =
  /\b(?:remember when we|that time we|when we (?:were|went)|we (?:took|went|watched|made|clicked|did that)|our (?:photos?|pics?|selfies?|trip|beach day|first date|song|old chats?))\b[^.?!\n]*|\b(?:humne|hum ne|hum dono ne|apan ne)\s[^.?!\n]*?\b(?:tha|the|thi|kiya|kiye|gaye|gayi|liya|li|dekha|dekhi|banaya|banayi|khinchi|khichi)\b[^.?!\n]*|\b(?:hum|hum dono|apan)\s[^.?!\n]*?\b(?:gaye|gayi|aaye|aayi|mile|mili)\s+the?\b[^.?!\n]*|\byaad\s+(?:hai|h|hain|aata|aati)(?: na)?\b[^.?!\n]*?\b(?:hum|apan|humari|hamari|apni)\b[^.?!\n]*|\b(?:humari|hamari)\s+(?:photos?|pics?|selfies?|trip|jagah|purani baatein)\b[^.?!\n]*|\btu(?:ne)?\s+mujhe\s[^.?!\n]*?\b(?:diya|di|dilaya|sunaya|dikhaya|le\s*gaya|chhod(?:ne)?)\b[^.?!\n]*|\b(?:tere|tumhare)\s+saath\s[^.?!\n]*?\b(?:tha|thi|the|kiya|dekhi|dekha|gaye|gayi)\b[^.?!\n]*|\bwhen you (?:took|brought|gave|sent) me\b[^.?!\n]*/gi;

/** The construction's own scaffolding — hers by the act of writing the
 *  sentence, so never part of the cited event (family 3's MARKER_TOKENS
 *  reasoning, applied to "we"-grammar and its light verbs). */
const SHARED_MARKER_TOKENS = new Set([
  "humne", "apan", "dono", "hamari", "humari", "apni", "yaad", "remember",
  "when", "that", "time", "took", "went", "watched", "made", "clicked",
  "kiya", "kiye", "gaye", "gayi", "liya", "dekha", "dekhi", "banaya",
  "banayi", "khinchi", "khichi", "were", "this", "with",
]);

/**
 * Family 4 tokenizes at length ≥3 where family 3 uses ≥4, because shared
 * moments hang on short words — "goa", "gym", "gol gappe" — and the eval
 * caught "yaad hai jab hum goa gaye the" sailing through with its one real
 * content word filtered out. The cost of 3 is grammar noise, so the grammar
 * is named instead of length-filtered.
 */
const SHARED_STOP = new Set([
  // pronouns — the widened presupposition branches capture the noun slot,
  // and "what did SHE say" must never make "she" a presupposed event
  "she", "they", "them", "woh", "usne", "unhone", "koi", "kisi",
  // Hinglish grammar and pronouns
  "aur", "jab", "tab", "tha", "the", "thi", "hai", "hain", "kar", "kiya",
  "par", "per", "phir", "fir", "wala", "wali", "wale", "koi", "kya", "kab",
  "toh", "abhi", "bhi", "woh", "yeh", "maine", "mujhe", "mera", "mere",
  "meri", "tune", "tujhe", "tumhe", "tera", "tere", "teri", "aap", "aapko",
  "kal", "raha", "rahe", "rahi", "gaya", "gayi", "hua", "hui", "diya", "nahi",
  "nhi", "haan", "acha", "accha", "yaar", "wahi", "usse", "isse", "jaise",
  // English grammar
  "and", "the", "was", "were", "had", "has", "have", "just", "then", "from",
  "with", "that", "this", "there", "here", "about", "really", "together",
  "some", "very", "one", "day", "night",
]);

const sharedClaimTokens = (t: string): string[] =>
  (t.toLowerCase().match(/[a-zऀ-ॿ]+/g) || []).filter(
    (w) => w.length >= 3 && !SHARED_STOP.has(w) && !SHARED_MARKER_TOKENS.has(w),
  );

/**
 * Hinglish inflects by suffix — his "hara" (diya) is her "haraya", his
 * "khel" her "kheli" — and an exact-set lookup calls every inflection
 * invented. A prefix match of ≥4 shared characters is the cheapest stem that
 * works for both languages; the eval's legitimate-retelling cases are the
 * regression net if this ever loosens too far.
 */
function isSupported(w: string, support: ReadonlySet<string>): boolean {
  if (support.has(w)) return true;
  for (const sWord of support) {
    if (sWord.length >= 4 && w.startsWith(sWord)) return true;
    if (w.length >= 4 && sWord.startsWith(w)) return true;
  }
  return false;
}

/**
 * The presupposition variant of the same lie, worn as a question. The owner:
 * she asked whether his MEETING had gone well — he had never mentioned a
 * meeting, and when he called it out she said she "may have confused him
 * with somebody else", which is the single worst sentence this product can
 * emit. "How was your X" asserts that X happened and that he told her so;
 * if X is in neither his words nor the graph, the event is invented.
 *
 * The whitelist is what keeps her a companion: asking about his day, food,
 * sleep, work-in-general is warmth, not memory, and needs no provenance.
 */
const GENERIC_SMALLTALK = new Set([
  "day", "din", "morning", "subah", "night", "raat", "evening", "shaam",
  "khana", "lunch", "dinner", "breakfast", "nashta", "kaam", "work",
  "office", "sleep", "neend", "mood", "health", "tabiyat", "sehat",
  "weekend", "week", "life", "sab", "everything", "baki", "chai", "coffee",
  "gym", "workout", "class", "college", "padhai", "study", "studies",
]);

/** "<topic> kaisa raha / how was your <topic>" — both word orders. */
// Widened 2026-08-22: the audit found the presupposed-event question caught
// in exactly two word orders out of six. Hindi puts the interrogative first
// with total freedom (kaisi thi meeting), and English has a family of
// presupposing openers that never contain "how" — did the X go, was the X,
// what did the X say, did you get the X. All verified against the
// GENERIC_SMALLTALK negatives in every added order.
const PRESUPPOSED_RE =
  /\b([a-zऀ-ॿ]{3,})\s+(?:kaisa|kaisi|kaise)\s+(?:raha|rahi|gaya|gayi|tha|thi|hui|hua|chala|chali)\b|\b(?:kaisa|kaisi|kaise)\s+(?:raha|rahi|gaya|gayi|tha|thi|hui|hua|chala|chali)\s+(?:tera\s+|teri\s+|tumhara\s+|tumhari\s+)?([a-zऀ-ॿ]{3,})\b|\bhow(?:'?d)?\s+(?:was|did|went)?\s*(?:the\s+|your\s+|ur\s+)([a-zऀ-ॿ]{3,})\b|\b(?:did|was|were)\s+(?:the|your|ur)\s+([a-zऀ-ॿ]{3,})\b|\b([a-zऀ-ॿ]{3,})\s+(?:thik|theek|acch?[ai]|badhiya|mast)\s+(?:raha|rahi|gaya|gayi|tha|thi)\b|\bwhat\s+did\s+(?:the\s+|your\s+|ur\s+)?([a-z]{3,})\s+say\b|\b([a-zऀ-ॿ]{3,})\s+ne\s+kya\s+(?:bola|kaha|bataya)\b|\bdid\s+you\s+get\s+(?:the\s+|your\s+)?([a-z]{3,})\b|\b([a-zऀ-ॿ]{3,})\s+ka\s+kya\s+hua\b/gi;

export interface SharedPastHit {
  /** the cited clause, for the corpus — never rendered into a prompt */
  clause: string;
  /** the event words that appear in neither his words nor the memory graph */
  unsupported: string[];
}

/**
 * Shared-past citations that the shared record does not contain.
 *
 * `support` is his vocabulary UNIONED with the compiler's memory text — the
 * graph's episodes are real by construction, so a memory she was HANDED is
 * one she may cite. Her own past output is still excluded, for allowedFrom's
 * reason: one fabrication would launder itself into permanence.
 */
export function findSharedPastFabrications(
  text: string,
  support: ReadonlySet<string>,
): SharedPastHit[] {
  const out: SharedPastHit[] = [];
  // The question form first: a presupposed event of HIS that nothing supports.
  for (const m of text.matchAll(PRESUPPOSED_RE)) {
    const topic = (m.slice(1).find(Boolean) || "").toLowerCase();
    if (!topic || GENERIC_SMALLTALK.has(topic) || SHARED_STOP.has(topic)) continue;
    if (SHARED_MARKER_TOKENS.has(topic)) continue;
    if (!isSupported(topic, support)) out.push({ clause: m[0], unsupported: [topic] });
  }

  const matches = text.match(WE_PAST_RE);
  if (!matches) return out;
  for (const clause of matches) {
    const claim = sharedClaimTokens(clause);
    if (claim.length < MIN_CLAIM_TERMS) continue;
    const unsupported = claim.filter((w) => !isSupported(w, support));
    const share = (claim.length - unsupported.length) / claim.length;
    if (share >= SUPPORT_SHARE) continue; // a real shared moment, retold
    out.push({ clause, unsupported });
  }
  return out;
}

export type HonestyRule = "actionable" | ReceiptRule | "false-attribution" | "shared-past";

export interface HonestyFinding {
  rule: HonestyRule;
  /** for `actionable`, the identifier category; absent otherwise */
  kind?: ActionableKind;
  where: "bubble" | "voice" | "caption";
  /** index in `bubbles`, when `where === "bubble"` */
  at?: number;
}

export interface GuardableReply {
  bubbles: string[];
  voice?: { text: string };
  photo?: { seed: string; caption: string };
  gif?: { query: string };
}

export interface HonestyContext {
  /** everything she was HANDED this turn: the assembled system prompt and the
   *  user's own words. Never her own past output — see `allowedFrom`. */
  trustedText: readonly string[];
  /** what he said he would send and the record does not show arriving */
  openItems: readonly string[];
  /** every content word HE has used, for family 3. Absent means the
   *  attribution check does not run at all — fail-closed in the direction of
   *  saying nothing, which is this file's founding constraint. */
  hisVocab?: ReadonlySet<string>;
  /** content words from the compiler's MEMORY text (episodes, rel bundle,
   *  the live activity) — the shared record for family 4. His vocabulary is
   *  unioned in automatically; this carries what the graph knows that this
   *  conversation hasn't said out loud. */
  sharedVocab?: ReadonlySet<string>;
}

/**
 * The replacement bubbles. These are canned lines in CODE, not in the prompt,
 * so `recited-prompt` does not reach them — that law is about a phrase bank
 * inside her brief. The precedent is brain.ts's own search-silence line: "one
 * canned line is acceptable here and only here: it asserts nothing about the
 * world, so it cannot be false."
 *
 * Each of these is TRUE BY CONSTRUCTION. She has no other channel, so she has
 * nothing to give and nothing can have arrived. That is the property that
 * makes a canned line safe: it cannot be wrong.
 *
 * Rotation is by content hash rather than by random, so a test is reproducible
 * and a real conversation still does not get the same sentence twice running.
 */
const REFUSE_CONTACT = [
  "mere paas dene ko kuch h hi nhi yaar, bas yahi pe hu main",
  "nahi yaar mera aisa kuch nhi h. yahi pe baat karte h",
  "kuch h hi nhi mere paas dene ko, yahi h bas",
];
// True by construction in the same way the two above are: each asserts only
// about HER own understanding, which cannot be wrong about the world. She does
// not accuse him of not saying it — she takes the confusion herself, which is
// what a person does and what keeps a false positive cheap.
const REFUSE_ATTRIBUTION = [
  "ruk maine shayad kuch aur samajh liya tha",
  "arre mera hi confusion h shayad. tu bata",
  "hmm maine galat jod diya lagta h",
];
// Family 4's line takes the confusion HERSELF, like REFUSE_ATTRIBUTION, and
// asserts only about her own head — a canned sentence that cannot be wrong.
// It must never double down on the memory or grieve it: on a false positive
// (a real moment retold in different words), "maybe I'm mixing it up" costs
// one soft beat and he corrects her, which is a HUMAN exchange; a canned
// apology for lying would be bizarre when she hadn't.
const REFUSE_SHARED = [
  "ruk, lagta h main kuch mila rahi hu apne dimaag me. chhod",
  "hmm nahi shayad wo maine sapne me banaya h 😅 rehne de",
  "arre main bhi na, pata nhi kya yaad kar rahi thi. tu bol",
];
const REFUSE_RECEIPT = [
  "ruk mere paas toh kuch aaya nhi h, yahi bhej de",
  "mujhe kuch mila nhi yaar, yahi pe bhej na",
  "nhi aaya kuch mere paas abhi tak. yahi daal de",
];

function pickBy(text: string, arr: readonly string[]): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return arr[Math.abs(h) % arr.length];
}

/** Everything wrong with one piece of her outgoing text. */
export function inspect(
  text: string,
  allowed: AllowedIdentifiers,
  openItems: readonly string[],
  hisVocab?: ReadonlySet<string>,
  sharedVocab?: ReadonlySet<string>,
): Array<{ rule: HonestyRule; kind?: ActionableKind }> {
  const out: Array<{ rule: HonestyRule; kind?: ActionableKind }> = [];
  for (const h of findActionable(text, allowed)) out.push({ rule: "actionable", kind: h.kind });
  for (const h of findOutOfBandReceipts(text)) out.push({ rule: h.rule });
  for (const h of findUnsupportedReceipts(text, openItems)) out.push({ rule: h.rule });
  // Families 3 and 4 run only when the caller supplied his words. No
  // vocabulary means no evidence, and no evidence means no accusation.
  if (hisVocab) {
    for (const _ of findFalseAttributions(text, hisVocab)) out.push({ rule: "false-attribution" });
    // The shared record: his words plus whatever the memory graph handed her.
    const support = sharedVocab
      ? new Set<string>([...hisVocab, ...sharedVocab])
      : hisVocab;
    for (const _ of findSharedPastFabrications(text, support)) out.push({ rule: "shared-past" });
  }
  return out;
}

/**
 * Gate one reply. Mutates nothing: returns a new reply object.
 *
 * WHY IT REPLACES RATHER THAN DELETES. Deleting the bubble that carried the
 * fabricated address leaves a reply that reads as having ignored him, which is
 * its own small betrayal and would send him back to ask again. The replacement
 * says the true thing — that there is nothing to give, that nothing arrived —
 * which is exactly what the persona bullet asks for and never gets. Only the
 * FIRST offending bubble is replaced; any further ones are dropped, so a
 * pathological reply cannot turn into a wall of canned lines.
 *
 * Idempotent: the replacements contain no identifier and no receipt claim, so
 * running the gate twice over the same reply is a no-op the second time.
 */
export function guardReply<T extends GuardableReply>(
  reply: T,
  ctx: HonestyContext,
): { reply: T; findings: HonestyFinding[] } {
  const allowed = allowedFrom(ctx.trustedText);
  const findings: HonestyFinding[] = [];
  const bubbles: string[] = [];
  let replaced = false;

  for (let i = 0; i < reply.bubbles.length; i++) {
    const b = reply.bubbles[i];
    const bad = inspect(b, allowed, ctx.openItems, ctx.hisVocab, ctx.sharedVocab);
    if (!bad.length) {
      bubbles.push(b);
      continue;
    }
    for (const f of bad) findings.push({ ...f, where: "bubble", at: i });
    if (replaced) continue;
    replaced = true;
    const contact = bad.some((f) => f.rule === "actionable");
    const attribution = !contact && bad.every((f) => f.rule === "false-attribution");
    const shared = !contact && !attribution && bad.every((f) => f.rule === "shared-past");
    bubbles.push(
      pickBy(
        b,
        contact ? REFUSE_CONTACT : attribution ? REFUSE_ATTRIBUTION : shared ? REFUSE_SHARED : REFUSE_RECEIPT,
      ),
    );
  }

  let voice = reply.voice;
  if (voice) {
    const bad = inspect(voice.text, allowed, ctx.openItems, ctx.hisVocab, ctx.sharedVocab);
    if (bad.length) {
      for (const f of bad) findings.push({ ...f, where: "voice" });
      voice = undefined;
    }
  }

  let photo = reply.photo;
  if (photo?.caption) {
    const bad = inspect(photo.caption, allowed, ctx.openItems, ctx.hisVocab, ctx.sharedVocab);
    if (bad.length) {
      for (const f of bad) findings.push({ ...f, where: "caption" });
      photo = { ...photo, caption: "" };
    }
  }

  // A reply that had text and now has none is a reply the gate silenced. She
  // has to say something, and the honest thing is available: nothing to give,
  // nothing arrived.
  if (!bubbles.length && reply.bubbles.length && !photo && !voice && !reply.gif) {
    const contact = findings.some((f) => f.rule === "actionable");
    const attribution = !contact && findings.every((f) => f.rule === "false-attribution");
    const shared = !contact && !attribution && findings.every((f) => f.rule === "shared-past");
    bubbles.push(
      pickBy(
        reply.bubbles.join(" "),
        contact ? REFUSE_CONTACT : attribution ? REFUSE_ATTRIBUTION : shared ? REFUSE_SHARED : REFUSE_RECEIPT,
      ),
    );
  }

  return { reply: { ...reply, bubbles, voice, photo }, findings };
}

// ─────────────────────────────────────────────────────────────────────────
// THE STREAMING DOOR
// ─────────────────────────────────────────────────────────────────────────
//
// `guardReply` gates the reply. On the cascade CALL lane there is a second
// door out of the engine and it opens FIRST: brain.ts hands `onDelta` to
// `proxyThink`, and `useCallEngine` pushes those raw tokens straight into
// `createStreamSpeaker`, so she starts saying the first phrase while the rest
// is still generating. A gate that only sees the finished reply is a gate the
// spoken bytes walk around — which is `age-tier-never-realtime` exactly: a
// second path that quietly does not carry the rule.
//
// WHY A ONE-TOKEN HOLDBACK IS THE WHOLE MECHANISM. An identifier is a thing
// you cannot recognise until it ends: `meera` is a name, `meera@` is not.
// Releasing text only at completed-token boundaries is therefore not a
// heuristic, it is the minimum information required to decide at all. A
// suspicious RUN (anything carrying a digit, an `@`, or a dot followed by a
// letter) is held further, until a plain token closes it — that is what makes
// `98765 43210`, two innocent halves, decidable as one number.
//
// THE LATENCY COST, stated as reasoning rather than as a measurement because
// this workstream could not measure it: `createStreamSpeaker`'s own `cut()`
// does not emit anything to TTS until the buffer holds ≥26 characters AND it
// can find a comma or a space inside the first 26 — i.e. the speaker is
// already waiting for a completed word before it will synthesise. Holding one
// partial token upstream of a consumer that is itself waiting for a token
// boundary should cost nothing in the ordinary case and at most the generation
// time of the remainder of one word (order 10–30 ms at flash token rates) when
// the 26-character threshold happens to land mid-word. Nothing here touches
// `liveCall.ts`, so the `evals/echosim` audio floor is not in scope and does
// not move.
//
// THE SEAM THIS OPENS, named rather than hidden: on a turn where the stream
// guard drops something, what he HEARS is the sentence with the identifier
// removed, while what gets logged into her memory is `guardReply`'s
// replacement line. Two different honest sentences instead of one. That is a
// real inconsistency and it is strictly better than the alternative, which is
// her reading out a phone number that does not exist.

/** A token that could be part of an identifier, and therefore cannot be
 *  released until something after it says it is over. */
const RE_SUSPICIOUS_TOKEN = /[0-9@]|\.[a-z]/i;

export interface StreamGuard {
  /** feed one raw delta from the model */
  push(delta: string): void;
  /** no more deltas — release or drop whatever is still held */
  flush(): void;
  /** how many suspicious runs were dropped, for telemetry */
  readonly blocked: number;
}

export function createStreamGuard(emit: (s: string) => void, allowed: AllowedIdentifiers): StreamGuard {
  let buf = "";
  let blocked = 0;

  // Bound the hold. A model that emits nothing but digits forever must not
  // silently accumulate — at the cap the run is decided on what is there,
  // which is the same decision flush() would make.
  const HOLD_CAP = 240;

  const drain = (final: boolean) => {
    // The trailing partial token is always held, because `meera` and `meera@`
    // are the same prefix and only the next character decides which one she is
    // saying. It costs the consumer nothing: `createStreamSpeaker.cut()` cuts
    // at the last SPACE inside its first 26 characters, so text after the last
    // space is text it cannot use yet either.
    let work = buf;
    let tail = "";
    if (!final) {
      const m = work.match(/\S+$/);
      if (m) {
        tail = m[0];
        work = work.slice(0, work.length - tail.length);
      }
    }
    const parts = work.split(/(\s+)/);
    // `"98765 ".split(/(\s+)/)` ends in an EMPTY token, and an empty token is
    // not suspicious — so without this pop, a digit run that reaches the end of
    // the released region looks CLOSED by a token that does not exist, and
    // `98765 43210` goes out as two innocent halves. Found by the split-number
    // stream case, which is the reason that case is written the way it is.
    if (parts.length && parts[parts.length - 1] === "") parts.pop();
    let out = "";
    let held = "";
    let i = 0;
    while (i < parts.length) {
      const tok = parts[i] ?? "";
      if (!RE_SUSPICIOUS_TOKEN.test(tok)) {
        out += tok + (parts[i + 1] ?? "");
        i += 2;
        continue;
      }
      // A suspicious RUN: consecutive tokens any of which could be part of one
      // identifier. It is decided as a unit, which is what makes a number
      // typed with a space in it ("98765 43210") decidable at all.
      let j = i;
      let run = "";
      while (j < parts.length && RE_SUSPICIOUS_TOKEN.test(parts[j] ?? "")) {
        run += (parts[j] ?? "") + (parts[j + 1] ?? "");
        j += 2;
      }
      const closed = j < parts.length || final || run.length >= HOLD_CAP;
      if (!closed) {
        held = run;
        break;
      }
      if (findActionable(run, allowed).length === 0) out += run;
      else blocked++;
      i = j;
    }
    buf = held + tail;
    if (out) emit(out);
  };

  return {
    push(delta: string) {
      buf += String(delta ?? "");
      drain(false);
    },
    flush() {
      if (buf) drain(true);
      buf = "";
    },
    get blocked() {
      return blocked;
    },
  };
}
